import { Router, Response } from 'express';
import { query, getClient } from '../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import { tableRow, fmtCurrency, fmtDate } from '../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildCustomerMetaRows,
  buildVatInclusiveSummaryRows,
  SALES_LINE_ITEM_HEADERS,
} from '../utils/salesEnterprisePrint';
import { calculateSalesDocItems } from '../utils/invoiceTax';
import { auditAfter, auditBefore, auditSnapshot, AUDIT_FIELDS } from '../utils/auditHelpers';
import { loadProductUoms } from '../utils/productUomDb';
import { resolveSalesDocLineUomFields } from '../utils/uom';
import { enrichSalesPrintLineUoms } from '../utils/salesPrintUom';

const router = Router();

const sqView = hasUserPerm('sales.sales-quotation.view');

const generateSqNumber = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const prefix = `SQ-${year}-`;
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(sq_number, ${prefix.length + 1}) AS INTEGER)), 0) + 1 as next
     FROM sales_quotations WHERE sq_number LIKE $1`,
    [`${prefix}%`]
  );
  return `${prefix}${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

// List
router.get('/', authenticate, sqView, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status, search } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const params: any[] = [];
    const conditions: string[] = [];
    if (status) {
      const statuses = (status as string).split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) { conditions.push(`sq.status = $${params.length + 1}`); params.push(statuses[0]); }
      else { conditions.push(`sq.status = ANY($${params.length + 1}::varchar[])`); params.push(statuses); }
    }
    if (search && String(search).trim()) {
      conditions.push(`(sq.sq_number ILIKE $${params.length + 1} OR c.customer_name ILIKE $${params.length + 1})`);
      params.push(`%${String(search).trim()}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const count = await query(`SELECT COUNT(*) FROM sales_quotations sq LEFT JOIN customers c ON sq.customer_id = c.id ${where}`, params);
    const result = await query(
      `SELECT sq.*, c.customer_name FROM sales_quotations sq
       LEFT JOIN customers c ON sq.customer_id = c.id
       ${where} ORDER BY sq.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit as string), offset]
    );
    const statsResult = await query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'Draft')::int AS draft_count,
        COUNT(*) FILTER (WHERE status IN ('Sent', 'Approved'))::int AS ready_count,
        COALESCE(SUM(total) FILTER (WHERE status IN ('Sent', 'Approved')), 0)::float AS pipeline_value,
        COUNT(*) FILTER (WHERE status = 'Expired')::int AS expired_count
      FROM sales_quotations
    `);
    res.json({
      data: result.rows,
      total: parseInt(count.rows[0].count),
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      stats: statsResult.rows[0],
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Detail
router.get('/:id', authenticate, sqView, async (req: AuthRequest, res: Response) => {
  try {
    const sq = await query(
      `SELECT sq.*, c.customer_name, c.address as customer_address, c.phone as customer_phone, c.tin as customer_tin, c.customer_type
       FROM sales_quotations sq LEFT JOIN customers c ON sq.customer_id = c.id WHERE sq.id = $1`,
      [req.params.id]
    );
    if (sq.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const items = await query(
      `SELECT sqi.*, p.name as product_name, p.sku,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_quotation_items sqi LEFT JOIN products p ON sqi.product_id = p.id
       LEFT JOIN uoms u ON sqi.uom_id = u.id
       WHERE sqi.quotation_id = $1 ORDER BY sqi.id`,
      [req.params.id]
    );
    res.json({ ...sq.rows[0], items: items.rows });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Create
router.post('/', authenticate, hasUserPerm('sales.sales-quotation.create'), auditLog('Sales', 'Create Quotation'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_id, valid_until, notes, items, terms_conditions, payment_terms } = req.body;
    if (!customer_id || !items || !items.length) return res.status(400).json({ error: 'Customer and items required' });

    const sqNumber = await generateSqNumber();
    const id = uuidv4();
    const { lines, totals } = calculateSalesDocItems(items);
    const subtotal = totals.lineFinalTotal;
    const discount = 0;
    const tax = totals.totalVat;
    const total = subtotal;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO sales_quotations (id, sq_number, customer_id, customer_name, valid_until, notes, terms_conditions, payment_terms, subtotal, discount, tax, total, created_by)
         VALUES ($1,$2,$3,(SELECT customer_name FROM customers WHERE id=$3),$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, sqNumber, customer_id, valid_until, notes, terms_conditions || '', payment_terms || null, subtotal, discount, tax, total, req.user!.id]
      );

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const calc = lines[i];
        const uomFields = await resolveSalesDocLineUomFields(client, item.product_id, item, calc.quantity, loadProductUoms);
        await client.query(
          `INSERT INTO sales_quotation_items (id, quotation_id, product_id, variant_id, description, quantity, unit_price, discount, tax_type, vat_amount, total, uom_id, entered_qty, conversion_to_base, base_qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [uuidv4(), id, item.product_id, item.variant_id || null, item.description, calc.quantity, calc.unit_price, calc.discount, calc.tax_type, calc.vat, calc.total, uomFields.uom_id, uomFields.enteredQty, uomFields.conversion_to_base, uomFields.base_qty]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ id, sq_number: sqNumber });
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Edit (Draft only)
router.put('/:id', authenticate, hasUserPerm('sales.sales-quotation.edit'), auditLog('Sales', 'Edit Quotation'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_id, valid_until, notes, items, terms_conditions, payment_terms } = req.body;
    const sq = await query('SELECT * FROM sales_quotations WHERE id = $1', [req.params.id]);
    if (sq.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (!['Draft', 'Approved'].includes(sq.rows[0].status)) return res.status(400).json({ error: 'Only Draft or Approved quotations can be edited' });
    auditBefore(req, auditSnapshot(sq.rows[0], AUDIT_FIELDS.salesQuotation));

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { lines, totals } = calculateSalesDocItems(items || []);
      const subtotal = totals.lineFinalTotal;
      const tax = totals.totalVat;
      const total = subtotal;
      await client.query(
        `UPDATE sales_quotations SET customer_id=$1, valid_until=$2, notes=$3, terms_conditions=$4, payment_terms=$5, subtotal=$6, tax=$7, total=$8,
         customer_name=(SELECT customer_name FROM customers WHERE id=$1), updated_at=CURRENT_TIMESTAMP WHERE id=$9`,
        [customer_id, valid_until, notes, terms_conditions || '', payment_terms || null, subtotal, tax, total, req.params.id]
      );

      if (items) {
        await client.query('DELETE FROM sales_quotation_items WHERE quotation_id = $1', [req.params.id]);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const calc = lines[i];
          const uomFields = await resolveSalesDocLineUomFields(client, item.product_id, item, calc.quantity, loadProductUoms);
          await client.query(
            `INSERT INTO sales_quotation_items (id, quotation_id, product_id, variant_id, description, quantity, unit_price, discount, tax_type, vat_amount, total, uom_id, entered_qty, conversion_to_base, base_qty)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
            [uuidv4(), req.params.id, item.product_id, item.variant_id || null, item.description, calc.quantity, calc.unit_price, calc.discount, calc.tax_type, calc.vat, calc.total, uomFields.uom_id, uomFields.enteredQty, uomFields.conversion_to_base, uomFields.base_qty]
          );
        }
      }
      await client.query('COMMIT');
      auditAfter(req, auditSnapshot({
        id: req.params.id,
        sq_number: sq.rows[0].sq_number,
        status: sq.rows[0].status,
        customer_id,
        subtotal,
        tax,
        total,
      }, AUDIT_FIELDS.salesQuotation));
      res.json({ message: 'Updated', id: req.params.id, sq_number: sq.rows[0].sq_number });
    } catch (err: any) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Status change (Send / Approve / Cancel / Reject)
router.patch('/:id/status', authenticate, hasUserPerm('sales.sales-quotation.edit'), auditLog('Sales', 'Change SQ Status'), async (req: AuthRequest, res: Response) => {
  try {
    const { status } = req.body;
    if (!['Sent', 'Approved', 'Cancelled', 'Expired'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const sq = await query('SELECT * FROM sales_quotations WHERE id = $1', [req.params.id]);
    if (sq.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (sq.rows[0].status === 'Cancelled') return res.status(400).json({ error: 'Cannot change cancelled quotation' });
    auditBefore(req, { id: req.params.id, sq_number: sq.rows[0].sq_number, status: sq.rows[0].status });
    await query('UPDATE sales_quotations SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, req.params.id]);
    auditAfter(req, { id: req.params.id, sq_number: sq.rows[0].sq_number, status });
    res.json({ message: `Status changed to ${status}`, id: req.params.id, sq_number: sq.rows[0].sq_number, status });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Prefill payload for copying SQ to SO (no DB write)
router.get('/:id/copy-to-order', authenticate, hasUserPerm('sales.sales-order.create'), async (req: AuthRequest, res: Response) => {
  try {
    const sq = await query(
      `SELECT sq.*, c.customer_name, c.customer_code, c.address as customer_address,
              c.phone as customer_phone, c.tin as customer_tin, c.customer_type,
              c.payment_terms as customer_payment_terms
       FROM sales_quotations sq LEFT JOIN customers c ON sq.customer_id = c.id WHERE sq.id = $1`,
      [req.params.id]
    );
    if (sq.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (!['Sent', 'Approved'].includes(sq.rows[0].status)) {
      return res.status(400).json({ error: `Cannot copy ${sq.rows[0].status} quotation to sales order` });
    }

    const items = await query(
      `SELECT sqi.*, p.name as product_name, p.sku,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_quotation_items sqi LEFT JOIN products p ON sqi.product_id = p.id
       LEFT JOIN uoms u ON sqi.uom_id = u.id
       WHERE sqi.quotation_id = $1 ORDER BY sqi.id`,
      [req.params.id]
    );
    if (items.rows.length === 0) return res.status(400).json({ error: 'No items on quotation' });

    const row = sq.rows[0];
    res.json({
      source_sq_id: row.id,
      source_sq_number: row.sq_number,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      customer_code: row.customer_code || '',
      customer_tin: row.customer_tin || '',
      customer_phone: row.customer_phone || '',
      customer_type: row.customer_type || 'Retail',
      delivery_address: row.customer_address || '',
      order_date: new Date().toISOString().split('T')[0],
      delivery_date: row.valid_until || '',
      payment_terms: row.payment_terms || row.customer_payment_terms || '',
      notes: row.notes || '',
      terms_conditions: row.terms_conditions || '',
      items: items.rows.map((i: any) => ({
        product_id: i.product_id,
        variant_id: i.variant_id,
        product_name: i.product_name || '',
        sku: i.sku || '',
        description: i.description || '',
        quantity: parseFloat(i.quantity),
        unit_price: parseFloat(i.unit_price),
        discount: parseFloat(i.discount || 0),
        tax_type: i.tax_type || 'VAT',
        vat_amount: parseFloat(i.vat_amount || 0),
        uom: i.uom_code || i.unit_of_measure || '',
        uom_id: i.uom_id,
        entered_qty: parseFloat(i.entered_qty ?? i.quantity),
        conversion_to_base: parseFloat(i.conversion_to_base || 1),
        base_qty: parseFloat(i.base_qty ?? i.quantity),
      })),
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Sales Quotation Print
router.get('/:id/print', authenticate, hasUserPerm('sales.sales-quotation.print'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT sq.*, c.customer_name, c.address as customer_address, c.phone as customer_phone, c.tin as customer_tin, c.customer_type
       FROM sales_quotations sq LEFT JOIN customers c ON sq.customer_id = c.id WHERE sq.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];

    const items = await query(
      `SELECT sqi.*, p.name as product_name, p.sku,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM sales_quotation_items sqi
       LEFT JOIN products p ON sqi.product_id = p.id
       WHERE sqi.quotation_id = $1 ORDER BY sqi.id`,
      [req.params.id]
    );

    const printItems = await enrichSalesPrintLineUoms({ query }, items.rows);

    const itemRows = printItems.map((row: any, idx: number) =>
      tableRow([
        { html: String(idx + 1), align: 'c' },
        { html: row.sku || '—' },
        { html: row.product_name || row.description || '—' },
        { html: String(parseFloat(row.quantity || 0)), align: 'c' },
        { html: row.display_uom || '—', align: 'c' },
        { html: fmtCurrency(parseFloat(row.unit_price || 0)), align: 'r' },
        { html: fmtCurrency(parseFloat(row.total || 0)), align: 'r' },
      ])
    ).join('');

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const subtotal = parseFloat(d.subtotal || 0);
    const discount = parseFloat(d.discount || 0);
    const tax = parseFloat(d.tax || 0);
    const total = parseFloat(d.total || 0);

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Sales Quotation ${d.sq_number}`,
      docTitle: 'Sales Quotation',
      docMetaRows: [
        { label: 'Document No.', value: d.sq_number || '—' },
        { label: 'Document Date', value: fmtDate(d.created_at, 'short') },
        { label: 'Valid Until', value: fmtDate(d.valid_until, 'short') },
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      customerRows: buildCustomerMetaRows({
        name: d.customer_name,
        address: d.customer_address,
        tin: d.customer_tin,
        phone: d.customer_phone,
      }),
      detailsRows: [
        { label: 'Payment Terms', value: d.payment_terms || '—' },
        ...(d.type ? [{ label: 'Quotation Type', value: d.type }] : []),
        { label: 'Currency', value: String(b.currency || 'PHP') },
        { label: 'Prepared By', value: String(b.prepared_by || '—') },
      ],
      itemHeaders: SALES_LINE_ITEM_HEADERS,
      itemRows,
      summaryRows: buildVatInclusiveSummaryRows({
        lineCount: printItems.length,
        subtotal,
        discount,
        tax,
        total,
      }),
      notes: [
        { label: 'Remarks', content: d.notes || '—' },
        { label: 'Terms & Conditions', content: d.terms_conditions || '—' },
      ],
      footerNote: 'This quotation is valid until the date indicated above. Prices are subject to change without prior notice.',
      status: d.status,
      biz: b,
    });
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
