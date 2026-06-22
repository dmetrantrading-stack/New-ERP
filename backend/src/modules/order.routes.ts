import { Router, Response } from 'express';
import { query, getClient } from '../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import { getInvoiceCopyMode } from '../utils/salesSettings';
import { calculateSalesDocItems } from '../utils/invoiceTax';
import { auditAfter, auditBefore, auditSnapshot, AUDIT_FIELDS } from '../utils/auditHelpers';
import { tableRow, fmtCurrency, fmtDate } from '../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildCustomerMetaRows,
  buildVatInclusiveSummaryRows,
  SALES_LINE_ITEM_HEADERS,
} from '../utils/salesEnterprisePrint';

const router = Router();

const soView = hasUserPerm('sales.sales-order.view');

const generateSoNumber = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const prefix = `SO-${year}-`;
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(so_number, ${prefix.length + 1}) AS INTEGER)), 0) + 1 as next
     FROM sales_orders WHERE so_number LIKE $1`,
    [`${prefix}%`]
  );
  return `${prefix}${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

// List
router.get('/', authenticate, soView, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const params: any[] = [];
    let where = '';
    if (status) { where = `WHERE so.status = $1`; params.push(status); }

    const count = await query(`SELECT COUNT(*) FROM sales_orders so ${where}`, params);
    const result = await query(
      `SELECT so.*, c.customer_name as cust_name, c.customer_type, sq.sq_number FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       LEFT JOIN sales_quotations sq ON so.sq_id = sq.id
       ${where} ORDER BY so.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit as string), offset]
    );
    res.json({ data: result.rows, total: parseInt(count.rows[0].count), page: parseInt(page as string), limit: parseInt(limit as string) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Prefill payload for copying SO to Invoice (no DB write; qty rule from system setting)
router.get('/:id/copy-to-invoice', authenticate, hasUserPerm('sales.sales-invoice.create'), async (req: AuthRequest, res: Response) => {
  try {
    const copyMode = await getInvoiceCopyMode();
    const so = await query(
      `SELECT so.*, c.customer_name, c.customer_code, c.customer_type, c.address as customer_address,
              c.phone as customer_phone, c.tin as customer_tin, sq.sq_number
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       LEFT JOIN sales_quotations sq ON so.sq_id = sq.id
       WHERE so.id = $1`,
      [req.params.id]
    );
    if (so.rows.length === 0) return res.status(404).json({ error: 'Sales Order not found' });
    if (['Draft', 'Cancelled'].includes(so.rows[0].status)) {
      return res.status(400).json({ error: `Cannot copy ${so.rows[0].status} order to invoice` });
    }

    const items = await query(
      `SELECT soi.*, p.name as product_name, p.sku, p.unit_of_measure
       FROM sales_order_items soi
       LEFT JOIN products p ON soi.product_id = p.id
       WHERE soi.order_id = $1 ORDER BY soi.id`,
      [req.params.id]
    );

    const invoiceItems = items.rows
      .map((i: any) => {
        const qty = copyMode === 'ordered'
          ? parseFloat(i.ordered_qty)
          : parseFloat(i.delivered_qty);
        const unitPrice = parseFloat(i.unit_price);
        const gross = qty * unitPrice;
        const discAmt = parseFloat(i.discount || 0);
        const discountPercent = gross > 0 ? Math.min(100, (discAmt / gross) * 100) : 0;
        return {
          product_id: i.product_id,
          variant_id: i.variant_id,
          product_name: i.product_name || '',
          sku: i.sku || '',
          unit_of_measure: i.unit_of_measure || '',
          description: i.description || i.product_name,
          quantity: qty,
          unit_price: unitPrice,
          discount: Math.round(discountPercent * 100) / 100,
          tax_type: i.tax_type || 'VAT',
          vat_amount: parseFloat(i.vat_amount || 0),
        };
      })
      .filter((i: any) => i.quantity > 0);

    if (invoiceItems.length === 0) {
      const hint = copyMode === 'delivered' ? 'No delivered items to invoice' : 'No ordered items on sales order';
      return res.status(400).json({ error: hint });
    }

    const row = so.rows[0];
    res.json({
      copy_mode: copyMode,
      source_so_id: row.id,
      source_so_number: row.so_number,
      source_sq_number: row.sq_number || null,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      customer_code: row.customer_code || '',
      customer_tin: row.customer_tin || '',
      customer_phone: row.customer_phone || '',
      customer_address: row.customer_address || '',
      delivery_address: row.delivery_address || row.customer_address || '',
      customer_type: row.customer_type || 'Retail',
      payment_terms: row.payment_terms || '',
      notes: row.notes || '',
      terms_conditions: row.terms_conditions || '',
      skip_inventory: true,
      items: invoiceItems,
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Detail
router.get('/:id', authenticate, soView, async (req: AuthRequest, res: Response) => {
  try {
    const so = await query(
      `SELECT so.*, c.customer_name as cust_name, c.address as cust_address, c.customer_type, sq.sq_number
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       LEFT JOIN sales_quotations sq ON so.sq_id = sq.id
       WHERE so.id = $1`,
      [req.params.id]
    );
    if (so.rows.length === 0) return res.status(404).json({ error: 'Sales Order not found' });
    const items = await query(
      `SELECT soi.*, p.name as product_name, p.sku,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_order_items soi LEFT JOIN products p ON soi.product_id = p.id
       WHERE soi.order_id = $1 ORDER BY soi.id`,
      [req.params.id]
    );
    res.json({ ...so.rows[0], items: items.rows });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Create
router.post('/', authenticate, hasUserPerm('sales.sales-order.create'), auditLog('Sales', 'Create Order'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_id, delivery_address, order_date, delivery_date, payment_terms, notes, terms_conditions, items, sq_id } = req.body;
    if (!customer_id || !items || !items.length) return res.status(400).json({ error: 'Customer and items required' });

    if (sq_id) {
      const sqCheck = await query('SELECT id, status FROM sales_quotations WHERE id = $1', [sq_id]);
      if (sqCheck.rows.length === 0) return res.status(400).json({ error: 'Invalid quotation reference' });
      if (!['Sent', 'Approved'].includes(sqCheck.rows[0].status)) {
        return res.status(400).json({ error: `Cannot link ${sqCheck.rows[0].status} quotation` });
      }
    }

    const soNumber = await generateSoNumber();
    const id = uuidv4();
    const { lines, totals } = calculateSalesDocItems(items);
    const subtotal = totals.lineFinalTotal;
    const discount = 0;
    const tax = totals.totalVat;
    const total = subtotal;
    const totalOrderedQty = lines.reduce((s, l) => s + l.quantity, 0);

    const client = await getClient();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO sales_orders (id, so_number, customer_id, customer_name, sq_id, delivery_address, order_date, delivery_date, payment_terms, notes, terms_conditions, subtotal, discount, tax, total, total_ordered_qty, total_remaining_qty, created_by)
         VALUES ($1,$2,$3,(SELECT customer_name FROM customers WHERE id=$3),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [id, soNumber, customer_id, sq_id || null, delivery_address, order_date || new Date().toISOString().split('T')[0], delivery_date, payment_terms, notes, terms_conditions || null, subtotal, discount, tax, total, totalOrderedQty, totalOrderedQty, req.user!.id]
      );

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const calc = lines[i];
        await client.query(
          `INSERT INTO sales_order_items (id, order_id, product_id, variant_id, description, ordered_qty, unit_price, discount, tax_type, vat_amount, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [uuidv4(), id, item.product_id, item.variant_id || null, item.description, calc.quantity, calc.unit_price, calc.discount, calc.tax_type, calc.vat, calc.total]
        );
      }

      await client.query('COMMIT');

      let sq_number: string | null = null;
      if (sq_id) {
        const sqRef = await query('SELECT sq_number FROM sales_quotations WHERE id = $1', [sq_id]);
        sq_number = sqRef.rows[0]?.sq_number || null;
        (req as any).auditAction = 'Copy SQ to SO';
        (req as any).newValues = { id, so_number: soNumber, sq_id, sq_number, source_sq_number: sq_number };
      }

      res.status(201).json({ id, so_number: soNumber, sq_id: sq_id || null, sq_number });
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Edit (Draft only)
router.put('/:id', authenticate, hasUserPerm('sales.sales-order.edit'), auditLog('Sales', 'Edit Order'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_id, delivery_address, delivery_date, payment_terms, notes, terms_conditions, items } = req.body;

    const so = await query('SELECT * FROM sales_orders WHERE id = $1', [req.params.id]);
    if (so.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (so.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only Draft orders can be edited' });
    auditBefore(req, auditSnapshot(so.rows[0], AUDIT_FIELDS.salesOrder));

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { lines, totals } = calculateSalesDocItems(items || []);
      const subtotal = totals.lineFinalTotal;
      const tax = totals.totalVat;
      const total = subtotal;
      const totalOrderedQty = lines.reduce((s, l) => s + l.quantity, 0);

      await client.query(
        `UPDATE sales_orders SET customer_id=$1, delivery_address=$2, delivery_date=$3, payment_terms=$4, notes=$5, terms_conditions=$6, subtotal=$7, tax=$8, total=$9, total_ordered_qty=$10, total_remaining_qty=$10, updated_at=CURRENT_TIMESTAMP WHERE id=$11`,
        [customer_id, delivery_address, delivery_date, payment_terms, notes, terms_conditions || null, subtotal, tax, total, totalOrderedQty, req.params.id]
      );

      if (items) {
        await client.query('DELETE FROM sales_order_items WHERE order_id = $1', [req.params.id]);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const calc = lines[i];
          await client.query(
            `INSERT INTO sales_order_items (id, order_id, product_id, variant_id, description, ordered_qty, unit_price, discount, tax_type, vat_amount, total)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [uuidv4(), req.params.id, item.product_id, item.variant_id || null, item.description, calc.quantity, calc.unit_price, calc.discount, calc.tax_type, calc.vat, calc.total]
          );
        }
      }

      await client.query('COMMIT');
      auditAfter(req, auditSnapshot({
        id: req.params.id,
        so_number: so.rows[0].so_number,
        status: 'Draft',
        customer_id,
        subtotal,
        tax,
        total,
        payment_terms,
        delivery_date,
        total_ordered_qty: totalOrderedQty,
      }, AUDIT_FIELDS.salesOrder));
      res.json({ message: 'Updated', id: req.params.id, so_number: so.rows[0].so_number });
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Confirm — reserve inventory
router.patch('/:id/confirm', authenticate, hasUserPerm('sales.sales-order.approve'), auditLog('Sales', 'Confirm Order'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const so = await client.query('SELECT * FROM sales_orders WHERE id = $1', [req.params.id]);
    if (so.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (so.rows[0].status !== 'Draft') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Only Draft orders can be confirmed' }); }
    auditBefore(req, { id: req.params.id, so_number: so.rows[0].so_number, status: so.rows[0].status });

    const items = await client.query('SELECT * FROM sales_order_items WHERE order_id = $1', [req.params.id]);
    let totalReserved = 0;
    for (const item of items.rows) {
      const qty = parseFloat(item.ordered_qty);
      totalReserved += qty;
      await client.query('UPDATE sales_order_items SET reserved_qty = $1 WHERE id = $2', [qty, item.id]);
      await client.query('UPDATE inventory SET reserved_quantity = reserved_quantity + $1 WHERE product_id = $2 AND location_id = 1', [qty, item.product_id]);
    }

    const remaining = parseFloat(so.rows[0].total_ordered_qty);
    await client.query(
      `UPDATE sales_orders SET status = 'Open', total_reserved_qty = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [totalReserved, req.params.id]
    );

    await client.query('COMMIT');
    auditAfter(req, { id: req.params.id, so_number: so.rows[0].so_number, status: 'Open', reserved: totalReserved });
    res.json({ message: 'Confirmed', reserved: totalReserved, id: req.params.id, so_number: so.rows[0].so_number, status: 'Open' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Cancel — release reservations
router.patch('/:id/cancel', authenticate, hasUserPerm('sales.sales-order.edit'), auditLog('Sales', 'Cancel Order'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const so = await client.query('SELECT * FROM sales_orders WHERE id = $1', [req.params.id]);
    if (so.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (['Cancelled', 'Closed'].includes(so.rows[0].status)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Already cancelled or closed' }); }
    auditBefore(req, { id: req.params.id, so_number: so.rows[0].so_number, status: so.rows[0].status });

    const items = await client.query('SELECT * FROM sales_order_items WHERE order_id = $1', [req.params.id]);
    for (const item of items.rows) {
      const reserved = parseFloat(item.reserved_qty || 0);
      if (reserved > 0) {
        await client.query('UPDATE inventory SET reserved_quantity = GREATEST(0, reserved_quantity - $1) WHERE product_id = $2 AND location_id = 1', [reserved, item.product_id]);
      }
      await client.query('UPDATE sales_order_items SET reserved_qty = 0 WHERE id = $1', [item.id]);
    }

    await client.query(
      `UPDATE sales_orders SET status = 'Cancelled', total_reserved_qty = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [req.params.id]
    );

    await client.query('COMMIT');
    auditAfter(req, { id: req.params.id, so_number: so.rows[0].so_number, status: 'Cancelled' });
    res.json({ message: 'Cancelled', id: req.params.id, so_number: so.rows[0].so_number, status: 'Cancelled' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Close (manual, only Fully Delivered)
router.patch('/:id/close', authenticate, hasUserPerm('sales.sales-order.edit'), auditLog('Sales', 'Close Order'), async (req: AuthRequest, res: Response) => {
  try {
    const so = await query('SELECT * FROM sales_orders WHERE id = $1', [req.params.id]);
    if (so.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (so.rows[0].status !== 'Fully Delivered') return res.status(400).json({ error: 'Only Fully Delivered orders can be closed' });
    auditBefore(req, { id: req.params.id, so_number: so.rows[0].so_number, status: so.rows[0].status });
    await query("UPDATE sales_orders SET status = 'Closed', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
    auditAfter(req, { id: req.params.id, so_number: so.rows[0].so_number, status: 'Closed' });
    res.json({ message: 'Closed', id: req.params.id, so_number: so.rows[0].so_number, status: 'Closed' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== SALES ORDER PRINT ====================
router.get('/:id/print', authenticate, hasUserPerm('sales.sales-order.print'), async (req: any, res: Response) => {
  try {
    const r = await query(
      `SELECT so.*, c.customer_name, c.customer_code, c.tin as customer_tin, c.address as customer_address, c.phone as customer_phone, c.customer_type
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       WHERE so.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const so = r.rows[0];

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const items = await query(
      `SELECT soi.*, p.name as product_name, p.sku,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_order_items soi LEFT JOIN products p ON soi.product_id = p.id WHERE soi.order_id = $1 ORDER BY soi.id`,
      [req.params.id]
    );

    const totalQty = items.rows.reduce((s: number, r: any) => s + parseFloat(r.ordered_qty), 0);
    const subtotal = parseFloat(so.subtotal) || 0;
    const discount = parseFloat(so.discount) || 0;
    const tax = parseFloat(so.tax_amount || so.tax || 0);
    const total = parseFloat(so.total_amount || so.total) || 0;

    const itemRows = items.rows.map((row: any, idx: number) =>
      tableRow([
        { html: String(idx + 1), align: 'c' },
        { html: row.sku || '—' },
        { html: row.product_name || row.description || '—' },
        { html: String(parseFloat(row.ordered_qty)), align: 'c' },
        { html: row.unit_of_measure || '—', align: 'c' },
        { html: fmtCurrency(row.unit_price), align: 'r' },
        { html: fmtCurrency(row.total), align: 'r' },
      ])
    ).join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Sales Order ${so.so_number}`,
      docTitle: 'Sales Order',
      docMetaRows: [
        { label: 'Document No.', value: so.so_number || '—' },
        { label: 'Document Date', value: fmtDate(so.order_date, 'short') },
        ...(so.delivery_date ? [{ label: 'Delivery Date', value: fmtDate(so.delivery_date, 'short') }] : []),
        { label: 'Status', value: String(so.status || 'Draft').toUpperCase() },
      ],
      customerRows: buildCustomerMetaRows({
        name: so.customer_name || 'Walk-in',
        address: so.customer_address,
        tin: so.customer_tin,
        phone: so.customer_phone,
      }),
      detailsRows: [
        { label: 'Payment Terms', value: so.payment_terms || '—' },
        { label: 'Currency', value: String(b.currency || 'PHP') },
        { label: 'Prepared By', value: String(b.prepared_by || '—') },
      ],
      itemHeaders: SALES_LINE_ITEM_HEADERS,
      itemRows,
      summaryRows: buildVatInclusiveSummaryRows({
        lineCount: items.rows.length,
        qtyTotal: totalQty,
        subtotal,
        discount,
        tax,
        total,
      }),
      notes: [
        { label: 'Remarks', content: so.notes || '—' },
        { label: 'Terms & Conditions', content: so.terms_conditions || '—' },
      ],
      footerNote: 'This sales order is subject to the terms and conditions stated above.',
      status: so.status,
      biz: b,
    });

    res.send(html);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
