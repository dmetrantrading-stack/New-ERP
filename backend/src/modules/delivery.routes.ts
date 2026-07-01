import { Router, Response } from 'express';
import { query, getClient } from '../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import { auditAfter, auditBefore, auditSnapshot, AUDIT_FIELDS } from '../utils/auditHelpers';
import {
  tableRow, renderEnterpriseNotesBlock, renderEnterpriseSectionTitle, fmtCurrency, fmtDate,
} from '../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildCustomerMetaRows,
  SALES_LINE_ITEM_HEADERS,
} from '../utils/salesEnterprisePrint';
import {
  aggregateGlCogsByAccountCode,
  insertCogsInventoryLines,
  loadCategoryAccountsForProducts,
  sumLineGlCogs,
} from '../utils/categoryGlPosting';
import { deductInventoryFefo, restoreInventoryFromLedger } from '../utils/batchFefo';
import { loadProductUoms } from '../utils/productUomDb';
import { lineItemBaseQty, resolveSalesDocLineUomFields } from '../utils/uom';
import { enrichSalesPrintLineUoms } from '../utils/salesPrintUom';

const router = Router();

const drView = hasUserPerm('sales.delivery-receipt.view');

const generateRefNumber = async (prefix: string, table: string, column: string): Promise<string> => {
  const safePrefix = prefix.replace(/[^A-Z]/g, '');
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeColumn = column.replace(/[^a-z_]/g, '');
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeColumn}, ${safePrefix.length + 2}) AS INTEGER)), 0) + 1 as next
     FROM ${safeTable} WHERE ${safeColumn} ~ '^${safePrefix}-'`
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const generateDrNumber = async (): Promise<string> => {
  const year = new Date().getFullYear();
  const prefix = `DR-${year}-`;
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(dr_number, ${prefix.length + 1}) AS INTEGER)), 0) + 1 as next
     FROM delivery_notes WHERE dr_number LIKE $1`,
    [`${prefix}%`]
  );
  return `${prefix}${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

// List
router.get('/', authenticate, drView, async (req: AuthRequest, res: Response) => {
  try {
    const { page = '1', limit = '20', status, so_id } = req.query;
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    const params: any[] = [];
    const conditions: string[] = [];
    if (status) { params.push(status); conditions.push(`dn.status = $${params.length}`); }
    if (so_id) { params.push(so_id); conditions.push(`dn.so_id = $${params.length}`); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const count = await query(`SELECT COUNT(*) FROM delivery_notes dn ${where}`, params);
    const result = await query(
      `SELECT dn.*, so.so_number, c.customer_name FROM delivery_notes dn
       LEFT JOIN sales_orders so ON dn.so_id = so.id
       LEFT JOIN customers c ON dn.customer_id = c.id
       ${where} ORDER BY dn.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit as string), offset]
    );
    res.json({ data: result.rows, total: parseInt(count.rows[0].count), page: parseInt(page as string), limit: parseInt(limit as string) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Dispatch list print — must be before /:id routes
router.get('/dispatch-list/print', authenticate, hasUserPerm('sales.delivery-receipt.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || from;
    const rows = await query(
      `SELECT dn.dr_number, dn.delivery_date, dn.driver_name, dn.vehicle_plate, dn.dispatch_notes,
              dn.delivery_address, dn.total_qty, dn.status, c.customer_name, so.so_number
       FROM delivery_notes dn
       LEFT JOIN customers c ON c.id = dn.customer_id
       LEFT JOIN sales_orders so ON so.id = dn.so_id
       WHERE dn.delivery_date >= $1 AND dn.delivery_date <= $2
         AND dn.status IN ('Posted', 'Draft')
       ORDER BY dn.delivery_date ASC, dn.dr_number ASC`,
      [from, to],
    );
    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const itemRows = rows.rows.map((r: any) => tableRow([
      { html: fmtDate(r.delivery_date, 'short') },
      { html: r.dr_number || '—' },
      { html: r.customer_name || '—' },
      { html: r.so_number || '—' },
      { html: r.driver_name || '—' },
      { html: r.vehicle_plate || '—' },
      { html: String(parseFloat(r.total_qty || 0)), align: 'c' },
      { html: String(r.status || '—') },
    ])).join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Dispatch List ${from} to ${to}`,
      docTitle: 'Delivery Dispatch List',
      docMetaRows: [
        { label: 'Period', value: `${fmtDate(from, 'short')} — ${fmtDate(to, 'short')}` },
        { label: 'Total DRs', value: String(rows.rows.length) },
      ],
      customerRows: [{ label: 'Report', value: 'Delivery Dispatch' }],
      detailsTitle: 'Dispatch Summary',
      detailsRows: [
        { label: 'Posted', value: String(rows.rows.filter((r: any) => r.status === 'Posted').length) },
        { label: 'Draft', value: String(rows.rows.filter((r: any) => r.status === 'Draft').length) },
      ],
      beforeItemsHtml: renderEnterpriseSectionTitle('Delivery Receipts'),
      itemHeaders: [
        { text: 'Date', width: '90px' },
        { text: 'DR No.' },
        { text: 'Customer' },
        { text: 'SO No.' },
        { text: 'Driver' },
        { text: 'Vehicle' },
        { text: 'Qty', align: 'center', width: '50px' },
        { text: 'Status', width: '70px' },
      ],
      itemRows,
      summaryRows: [{ label: 'Total DRs', value: String(rows.rows.length), total: true }],
      footerNote: 'Dispatch list for warehouse and driver assignment.',
      biz: b,
    });
    res.send(html);
  } catch (error: any) {
    res.status(500).send('<p>Error: ' + error.message + '</p>');
  }
});

// Prefill payload for copying DR to Invoice (no DB write)
router.get('/:id/copy-to-invoice', authenticate, hasUserPerm('sales.sales-invoice.create'), async (req: AuthRequest, res: Response) => {
  try {
    const dr = await query(
      `SELECT dn.*, so.so_number, sq.sq_number,
              c.customer_name, c.customer_code, c.address as customer_address,
              c.phone as customer_phone, c.tin as customer_tin, c.customer_type,
              c.payment_terms as customer_payment_terms
       FROM delivery_notes dn
       LEFT JOIN sales_orders so ON dn.so_id = so.id
       LEFT JOIN sales_quotations sq ON so.sq_id = sq.id
       LEFT JOIN customers c ON dn.customer_id = c.id
       WHERE dn.id = $1`,
      [req.params.id]
    );
    if (dr.rows.length === 0) return res.status(404).json({ error: 'Delivery receipt not found' });
    if (dr.rows[0].status !== 'Posted') {
      return res.status(400).json({ error: 'Only Posted delivery receipts can be copied to invoice' });
    }

    const items = await query(
      `SELECT dni.*, p.name as product_name, p.sku,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
              soi.variant_id, soi.tax_type, soi.discount as so_line_discount, soi.ordered_qty, soi.unit_price as so_unit_price
       FROM delivery_note_items dni
       LEFT JOIN products p ON dni.product_id = p.id
       LEFT JOIN uoms u ON dni.uom_id = u.id
       LEFT JOIN sales_order_items soi ON dni.order_item_id = soi.id
       WHERE dni.note_id = $1 ORDER BY dni.id`,
      [req.params.id]
    );
    if (items.rows.length === 0) return res.status(400).json({ error: 'No items on delivery receipt' });

    const row = dr.rows[0];
    const invoiceItems = items.rows.map((i: any) => {
      const qty = parseFloat(i.quantity);
      const unitPrice = parseFloat(i.unit_price || i.so_unit_price || 0);
      const gross = qty * unitPrice;
      const discAmt = parseFloat(i.so_line_discount || 0);
      const orderedQty = parseFloat(i.ordered_qty || qty) || qty;
      const lineDisc = orderedQty > 0 ? (discAmt / orderedQty) * qty : 0;
      const discountPercent = gross > 0 ? Math.min(100, (lineDisc / gross) * 100) : 0;
      return {
        product_id: i.product_id,
        variant_id: i.variant_id,
        product_name: i.product_name || '',
        sku: i.sku || '',
        unit_of_measure: i.uom_code || i.unit_of_measure || '',
        description: i.description || i.product_name || '',
        quantity: qty,
        uom_id: i.uom_id,
        entered_qty: qty,
        conversion_to_base: parseFloat(i.conversion_to_base || 1),
        base_qty: lineItemBaseQty({ ...i, quantity: qty, entered_qty: qty }),
        unit_price: unitPrice,
        discount: Math.round(discountPercent * 100) / 100,
        tax_type: i.tax_type || 'VAT',
      };
    });

    res.json({
      source_dr_id: row.id,
      source_dr_number: row.dr_number || row.dn_number,
      source_so_id: row.so_id,
      source_so_number: row.so_number || null,
      source_sq_number: row.sq_number || null,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      customer_code: row.customer_code || '',
      customer_tin: row.customer_tin || '',
      customer_phone: row.customer_phone || '',
      customer_address: row.customer_address || '',
      delivery_address: row.delivery_address || row.customer_address || '',
      customer_type: row.customer_type || 'Retail',
      payment_terms: row.payment_terms || row.customer_payment_terms || '',
      notes: row.notes || '',
      terms_conditions: row.terms_conditions || '',
      skip_inventory: true,
      items: invoiceItems,
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Detail
router.get('/:id', authenticate, drView, async (req: AuthRequest, res: Response) => {
  try {
    const dr = await query(
      `SELECT dn.*, so.so_number, so.total_ordered_qty, so.total_delivered_qty, so.total_remaining_qty, c.customer_name
       FROM delivery_notes dn
       LEFT JOIN sales_orders so ON dn.so_id = so.id
       LEFT JOIN customers c ON dn.customer_id = c.id
       WHERE dn.id = $1`,
      [req.params.id]
    );
    if (dr.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const items = await query(
      `SELECT dni.*, soi.ordered_qty, soi.delivered_qty as soi_delivered, p.name as product_name, p.sku,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM delivery_note_items dni
       LEFT JOIN sales_order_items soi ON dni.order_item_id = soi.id
       LEFT JOIN products p ON dni.product_id = p.id
       LEFT JOIN uoms u ON dni.uom_id = u.id
       WHERE dni.note_id = $1 ORDER BY dni.id`,
      [req.params.id]
    );
    res.json({ ...dr.rows[0], items: items.rows });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get SO open items for DR pre-fill (copy workflow — no DB write)
router.get('/from-so/:soId', authenticate, drView, async (req: AuthRequest, res: Response) => {
  try {
    const so = await query(
      `SELECT so.*, c.customer_name, c.customer_code, c.address as customer_address,
              c.phone as customer_phone, c.tin as customer_tin, c.payment_terms as customer_payment_terms,
              sq.sq_number
       FROM sales_orders so
       LEFT JOIN customers c ON so.customer_id = c.id
       LEFT JOIN sales_quotations sq ON so.sq_id = sq.id
       WHERE so.id = $1`,
      [req.params.soId]
    );
    if (so.rows.length === 0) return res.status(404).json({ error: 'Sales Order not found' });
    if (['Draft', 'Cancelled', 'Closed'].includes(so.rows[0].status)) {
      return res.status(400).json({ error: `Cannot create DR for ${so.rows[0].status} order` });
    }

    const items = await query(
      `SELECT soi.*, p.name as product_name, p.sku,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
              (soi.ordered_qty - soi.delivered_qty) as remaining_qty
       FROM sales_order_items soi
       LEFT JOIN products p ON soi.product_id = p.id
       LEFT JOIN uoms u ON soi.uom_id = u.id
       WHERE soi.order_id = $1 AND soi.ordered_qty > soi.delivered_qty
       ORDER BY soi.id`,
      [req.params.soId]
    );

    if (items.rows.length === 0) {
      return res.status(400).json({ error: 'No undelivered items on this sales order' });
    }

    const row = so.rows[0];
    res.json({
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
      payment_terms: row.payment_terms || row.customer_payment_terms || '',
      notes: row.notes || '',
      terms_conditions: row.terms_conditions || '',
      order: row,
      items: items.rows.map((i: any) => ({
        id: i.id,
        order_item_id: i.id,
        product_id: i.product_id,
        product_name: i.product_name || '',
        sku: i.sku || '',
        description: i.description || '',
        unit_of_measure: i.uom_code || i.unit_of_measure || '',
        uom_id: i.uom_id,
        conversion_to_base: parseFloat(i.conversion_to_base || 1),
        ordered_qty: parseFloat(i.ordered_qty),
        delivered_qty: parseFloat(i.delivered_qty),
        remaining_qty: parseFloat(i.remaining_qty),
        unit_price: parseFloat(i.unit_price),
      })),
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Create
router.post('/', authenticate, hasUserPerm('sales.delivery-receipt.create'), auditLog('Sales', 'Create DR'), async (req: AuthRequest, res: Response) => {
  try {
    const { so_id, delivery_address, notes, terms_conditions, items, driver_name, vehicle_plate, dispatch_notes } = req.body;
    if (!so_id || !items || !items.length) return res.status(400).json({ error: 'SO and items required' });

    const so = await query('SELECT * FROM sales_orders WHERE id = $1', [so_id]);
    if (so.rows.length === 0) return res.status(404).json({ error: 'Sales Order not found' });
    if (['Draft', 'Cancelled', 'Closed'].includes(so.rows[0].status)) {
      return res.status(400).json({ error: `Cannot create DR for ${so.rows[0].status} order` });
    }

    // Validate quantities against remaining
    for (const item of items) {
      const soi = await query('SELECT * FROM sales_order_items WHERE id = $1 AND order_id = $2', [item.order_item_id, so_id]);
      if (soi.rows.length === 0) return res.status(400).json({ error: `Item ${item.order_item_id} not found in SO` });
      const remaining = parseFloat(soi.rows[0].ordered_qty) - parseFloat(soi.rows[0].delivered_qty);
      const qty = parseFloat(item.quantity || 0);
      if (qty <= 0) return res.status(400).json({ error: 'Quantity must be positive' });
      if (qty > remaining) return res.status(400).json({ error: `Cannot deliver ${qty} — only ${remaining} remaining for ${item.order_item_id}` });
    }

    const drNumber = await generateDrNumber();
    const id = uuidv4();
    let totalQty = 0;
    const createdDate = new Date().toISOString().split('T')[0];

    const client = await getClient();
    try {
      await client.query('BEGIN');

      for (const item of items) totalQty += parseFloat(item.quantity || 0);

      await client.query(
        `INSERT INTO delivery_notes (id, dn_number, dr_number, so_id, customer_id, delivery_address, delivery_date, notes, terms_conditions, total_qty, driver_name, vehicle_plate, dispatch_notes, created_by)
         VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, drNumber, so_id, so.rows[0].customer_id, delivery_address || so.rows[0].delivery_address, createdDate, notes, terms_conditions || null, totalQty, driver_name || null, vehicle_plate || null, dispatch_notes || null, req.user!.id]
      );

      for (const item of items) {
        const soi = await client.query('SELECT * FROM sales_order_items WHERE id = $1', [item.order_item_id]);
        const soItem = soi.rows[0];
        const qty = parseFloat(item.quantity || 0);
        const uomFields = await resolveSalesDocLineUomFields(
          client,
          soItem.product_id,
          { uom_id: item.uom_id ?? soItem.uom_id, conversion_to_base: item.conversion_to_base ?? soItem.conversion_to_base, quantity: qty },
          qty,
          loadProductUoms,
        );
        await client.query(
          `INSERT INTO delivery_note_items (id, note_id, order_item_id, product_id, description, quantity, unit_price, total, uom_id, entered_qty, conversion_to_base, base_qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [uuidv4(), id, item.order_item_id, soItem.product_id, item.description || soItem.description, qty, soItem.unit_price, qty * parseFloat(soItem.unit_price), uomFields.uom_id, uomFields.enteredQty, uomFields.conversion_to_base, uomFields.base_qty]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ id, dr_number: drNumber });
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (error: any) { console.error('DR Create Error:', error.message); res.status(500).json({ error: error.message }); }
});

// Edit (Draft only)
router.put('/:id', authenticate, hasUserPerm('sales.delivery-receipt.edit'), auditLog('Sales', 'Edit DR'), async (req: AuthRequest, res: Response) => {
  try {
    const dr = await query('SELECT * FROM delivery_notes WHERE id = $1', [req.params.id]);
    if (dr.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (dr.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only Draft DR can be edited' });
    auditBefore(req, auditSnapshot(dr.rows[0], AUDIT_FIELDS.deliveryReceipt));

    const { delivery_address, notes, terms_conditions, items, driver_name, vehicle_plate, dispatch_notes } = req.body;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      let totalQty = 0;
      for (const item of (items || [])) totalQty += parseFloat(item.quantity || 0);

      await client.query(
        `UPDATE delivery_notes SET delivery_address=$1, notes=$2, terms_conditions=$3, total_qty=$4,
         driver_name=$5, vehicle_plate=$6, dispatch_notes=$7, updated_at=CURRENT_TIMESTAMP WHERE id=$8`,
        [delivery_address, notes, terms_conditions || null, totalQty, driver_name || null, vehicle_plate || null, dispatch_notes || null, req.params.id]
      );

      if (items) {
        await client.query('DELETE FROM delivery_note_items WHERE note_id = $1', [req.params.id]);
        for (const item of items) {
          const soi = await client.query('SELECT * FROM sales_order_items WHERE id = $1', [item.order_item_id]);
          if (soi.rows.length === 0) continue;
          const remaining = parseFloat(soi.rows[0].ordered_qty) - parseFloat(soi.rows[0].delivered_qty);
          const qty = parseFloat(item.quantity || 0);
          if (qty > remaining) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Cannot deliver ${qty} — only ${remaining} remaining` }); }
          const uomFields = await resolveSalesDocLineUomFields(
            client,
            soi.rows[0].product_id,
            { uom_id: item.uom_id ?? soi.rows[0].uom_id, conversion_to_base: item.conversion_to_base ?? soi.rows[0].conversion_to_base, quantity: qty },
            qty,
            loadProductUoms,
          );
          await client.query(
            `INSERT INTO delivery_note_items (id, note_id, order_item_id, product_id, description, quantity, unit_price, total, uom_id, entered_qty, conversion_to_base, base_qty)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [uuidv4(), req.params.id, item.order_item_id, soi.rows[0].product_id, item.description || soi.rows[0].description, qty, soi.rows[0].unit_price, qty * parseFloat(soi.rows[0].unit_price), uomFields.uom_id, uomFields.enteredQty, uomFields.conversion_to_base, uomFields.base_qty]
          );
        }
      }

      await client.query('COMMIT');
      auditAfter(req, auditSnapshot({
        id: req.params.id,
        dr_number: dr.rows[0].dr_number,
        status: 'Draft',
        delivery_address,
        total_qty: totalQty,
      }, AUDIT_FIELDS.deliveryReceipt));
      res.json({ message: 'Updated', id: req.params.id, dr_number: dr.rows[0].dr_number });
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Post — update SO delivered quantities
router.patch('/:id/post', authenticate, hasUserPerm('sales.delivery-receipt.approve'), auditLog('Sales', 'Post DR'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const dr = await client.query('SELECT * FROM delivery_notes WHERE id = $1', [req.params.id]);
    if (dr.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (dr.rows[0].status !== 'Draft') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Only Draft DR can be posted' }); }
    auditBefore(req, { id: req.params.id, dr_number: dr.rows[0].dr_number, status: dr.rows[0].status });

    const items = await client.query('SELECT * FROM delivery_note_items WHERE note_id = $1', [req.params.id]);
    if (items.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No items' }); }

    // Validate all items still within remaining
    for (const item of items.rows) {
      const soi = await client.query('SELECT * FROM sales_order_items WHERE id = $1', [item.order_item_id]);
      if (soi.rows.length === 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: `SO item ${item.order_item_id} not found` }); }
      const remaining = parseFloat(soi.rows[0].ordered_qty) - parseFloat(soi.rows[0].delivered_qty);
      const qty = parseFloat(item.quantity);
      if (qty > remaining) { await client.query('ROLLBACK'); return res.status(400).json({ error: `Overdelivery: ${qty} > ${remaining} remaining` }); }
    }

    // Update SO items and inventory
    let totalInventoryCost = 0;
    const drCogsLines: Array<{ product_id: string; cogsGrossAmount: number; tax_type?: string }> = [];
    const drProductIds = [...new Set(items.rows.map((i: any) => i.product_id))];
    const drProductTaxMap: Record<string, string> = {};
    if (drProductIds.length > 0) {
      const taxRows = await client.query(
        `SELECT id, tax_type FROM products WHERE id = ANY($1::uuid[])`,
        [drProductIds],
      );
      for (const p of taxRows.rows) {
        drProductTaxMap[p.id] = p.tax_type || 'VAT';
      }
    }
    for (const item of items.rows) {
      const enteredQty = parseFloat(item.quantity);
      const baseQty = lineItemBaseQty(item);

      const fefo = await deductInventoryFefo(client, {
        product_id: item.product_id,
        location_id: 1,
        quantity: baseQty,
        reference_type: 'Delivery Receipt',
        reference_id: req.params.id,
        created_by: req.user!.id,
      });
      const unitCost = fefo.unitCost;
      const lineCost = fefo.totalCost;
      totalInventoryCost += lineCost;
      drCogsLines.push({
        product_id: item.product_id,
        cogsGrossAmount: lineCost,
        tax_type: drProductTaxMap[item.product_id],
      });

      await client.query(
        `UPDATE sales_order_items SET delivered_qty = delivered_qty + $1, reserved_qty = GREATEST(0, reserved_qty - $1) WHERE id = $2`,
        [enteredQty, item.order_item_id]
      );
      await client.query(
        `UPDATE inventory SET reserved_quantity = GREATEST(0, reserved_quantity - $1) WHERE product_id = $2 AND location_id = 1`,
        [baseQty, item.product_id]
      );
    }

    // Mark DR as posted
    await client.query("UPDATE delivery_notes SET status = 'Posted', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);

    // Recompute SO header
    const soItems = await client.query('SELECT * FROM sales_order_items WHERE order_id = $1', [dr.rows[0].so_id]);
    let totalDelivered = 0, totalOrdered = 0, totalRemaining = 0;
    for (const si of soItems.rows) {
      totalOrdered += parseFloat(si.ordered_qty);
      totalDelivered += parseFloat(si.delivered_qty);
      totalRemaining += parseFloat(si.ordered_qty) - parseFloat(si.delivered_qty);
    }

    let newStatus = 'Open';
    if (totalRemaining <= 0) newStatus = 'Fully Delivered';
    else if (totalDelivered > 0) newStatus = 'Partially Delivered';

    await client.query(
      `UPDATE sales_orders SET total_delivered_qty = $1, total_remaining_qty = $2, total_reserved_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [totalDelivered, totalRemaining, newStatus, dr.rows[0].so_id]
    );

    // COGS Journal Entry — use inventory cost (not SO selling price), split by category
    if (totalInventoryCost > 0) {
      const glCogs = sumLineGlCogs(drCogsLines);
      const jeId = uuidv4();
      const jeNum = await generateRefNumber('JE', 'journal_entries', 'entry_number');
      await client.query(
        `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
         VALUES ($1, $2, CURRENT_DATE, 'Delivery Receipt', $3, $4, $5, $5, $6)`,
        [jeId, jeNum, req.params.id, `Delivery ${dr.rows[0].dr_number}`, glCogs, req.user!.id]
      );
      const drCategoryMap = await loadCategoryAccountsForProducts(
        client,
        drCogsLines.map((l) => l.product_id),
      );
      const drCogsBuckets = aggregateGlCogsByAccountCode(drCogsLines, drCategoryMap);
      await insertCogsInventoryLines(
        client, jeId, drCogsBuckets, 'Delivery Receipt', req.params.id, dr.rows[0].dr_number,
      );
    }

    await client.query('COMMIT');
    auditAfter(req, {
      id: req.params.id,
      dr_number: dr.rows[0].dr_number,
      status: 'Posted',
      so_status: newStatus,
      total_delivered: totalDelivered,
      total_remaining: totalRemaining,
    });
    res.json({ message: 'Posted', id: req.params.id, dr_number: dr.rows[0].dr_number, status: 'Posted', so_status: newStatus, total_delivered: totalDelivered, total_remaining: totalRemaining });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Cancel — reverse SO delivery updates
router.patch('/:id/cancel', authenticate, hasUserPerm('sales.delivery-receipt.edit'), auditLog('Sales', 'Cancel DR'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const dr = await client.query('SELECT * FROM delivery_notes WHERE id = $1', [req.params.id]);
    if (dr.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (dr.rows[0].status !== 'Posted') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Only Posted DR can be cancelled' }); }
    auditBefore(req, { id: req.params.id, dr_number: dr.rows[0].dr_number, status: dr.rows[0].status });

    const items = await client.query('SELECT * FROM delivery_note_items WHERE note_id = $1', [req.params.id]);

    // Reverse SO item updates and restore inventory (FEFO batches)
    for (const item of items.rows) {
      const enteredQty = parseFloat(item.quantity);
      const baseQty = lineItemBaseQty(item);
      await client.query(
        `UPDATE sales_order_items SET delivered_qty = GREATEST(0, delivered_qty - $1), reserved_qty = reserved_qty + $1 WHERE id = $2`,
        [enteredQty, item.order_item_id]
      );
      await client.query(
        `UPDATE inventory SET reserved_quantity = reserved_quantity + $1 WHERE product_id = $2 AND location_id = 1`,
        [baseQty, item.product_id]
      );
    }

    await restoreInventoryFromLedger(client, {
      reference_type: 'Delivery Receipt',
      reference_id: req.params.id,
      restore_reference_type: 'Delivery Receipt Cancel',
      created_by: req.user!.id,
      notes: 'DR Cancelled — inventory restored',
    });

    // Void COGS journal entry
    await client.query(
      `UPDATE journal_entries SET status = 'Void', updated_at = CURRENT_TIMESTAMP
       WHERE reference_type = 'Delivery Receipt' AND reference_id = $1 AND status = 'Posted'`,
      [req.params.id]
    );

    await client.query("UPDATE delivery_notes SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);

    // Recompute SO header
    const soItems = await client.query('SELECT * FROM sales_order_items WHERE order_id = $1', [dr.rows[0].so_id]);
    let totalDelivered = 0, totalRemaining = 0;
    for (const si of soItems.rows) {
      totalDelivered += parseFloat(si.delivered_qty);
      totalRemaining += parseFloat(si.ordered_qty) - parseFloat(si.delivered_qty);
    }
    let newStatus = 'Open';
    if (totalRemaining <= 0) newStatus = 'Fully Delivered';
    else if (totalDelivered > 0) newStatus = 'Partially Delivered';

    await client.query(
      `UPDATE sales_orders SET total_delivered_qty = $1, total_remaining_qty = $2, total_reserved_qty = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [totalDelivered, totalRemaining, newStatus, dr.rows[0].so_id]
    );

    await client.query('COMMIT');
    auditAfter(req, { id: req.params.id, dr_number: dr.rows[0].dr_number, status: 'Cancelled', so_status: newStatus });
    res.json({ message: 'Cancelled', id: req.params.id, dr_number: dr.rows[0].dr_number, status: 'Cancelled', so_status: newStatus });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Delivery Receipt Print — modern A4 layout
router.get('/:id/print', authenticate, hasUserPerm('sales.delivery-receipt.print'), async (req: AuthRequest, res: Response) => {
  try {
    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const r = await query(
      `SELECT dn.*, so.so_number, so.order_date, so.payment_terms, so.delivery_address as so_delivery_address,
              sq.sq_number,
              c.customer_name, c.customer_code, c.tin as customer_tin, c.address as customer_address, c.phone as customer_phone, c.customer_type
       FROM delivery_notes dn
       LEFT JOIN sales_orders so ON dn.so_id = so.id
       LEFT JOIN sales_quotations sq ON so.sq_id = sq.id
       LEFT JOIN customers c ON dn.customer_id = c.id
       WHERE dn.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const d = r.rows[0];

    const items = await query(
      `SELECT dni.*, soi.description as soi_description, p.name as product_name, p.sku,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM delivery_note_items dni
       LEFT JOIN sales_order_items soi ON dni.order_item_id = soi.id
       LEFT JOIN products p ON dni.product_id = p.id
       WHERE dni.note_id = $1 ORDER BY dni.id`,
      [req.params.id]
    );

    const printItems = await enrichSalesPrintLineUoms({ query }, items.rows);

    const totalQty = printItems.reduce((s: number, row: any) => s + parseFloat(row.quantity || 0), 0);
    const total = printItems.reduce((s: number, row: any) => s + parseFloat(row.total || 0), 0)
      || parseFloat(d.total_amount || d.subtotal || 0);

    const drNumber = d.dr_number || d.dn_number;
    const deliveryAddr = d.delivery_address || d.so_delivery_address || '—';

    const DR_STANDARD_NOTE = `Please Inspect upon delivery.
Report any shortages or damages within 24 hours.
Thank you for your continued support!`;
    const savedNotes = (d.notes || '').trim();
    const extraNotes = savedNotes && savedNotes !== DR_STANDARD_NOTE.trim()
      ? savedNotes.replace(DR_STANDARD_NOTE, '').trim()
      : '';

    const itemRows = printItems.map((i: any, idx: number) => tableRow([
      { html: String(idx + 1), align: 'c' },
      { html: i.sku || '—' },
      { html: i.product_name || i.soi_description || i.description || '—' },
      { html: String(parseFloat(i.quantity || 0)), align: 'c' },
      { html: i.display_uom || '—', align: 'c' },
      { html: fmtCurrency(i.unit_price), align: 'r' },
      { html: fmtCurrency(i.total), align: 'r' },
    ])).join('');

    const notesContent = extraNotes
      ? `${DR_STANDARD_NOTE}\n\n${extraNotes}`
      : DR_STANDARD_NOTE;

    const html = buildSalesEnterpriseDocument({
      pageTitle: `DR ${drNumber}`,
      docTitle: 'Delivery Receipt',
      docMetaRows: [
        { label: 'Document No.', value: drNumber || '—' },
        { label: 'Delivery Date', value: fmtDate(d.delivery_date, 'short') },
        ...(d.so_number ? [{ label: 'SO Reference', value: d.so_number }] : []),
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      customerRows: buildCustomerMetaRows({
        name: d.customer_name,
        address: d.customer_address,
        tin: d.customer_tin,
        phone: d.customer_phone,
      }),
      detailsTitle: 'Delivery Details',
      detailsRows: [
        { label: 'Delivery Address', value: deliveryAddr },
        ...(d.driver_name ? [{ label: 'Driver', value: d.driver_name }] : []),
        ...(d.vehicle_plate ? [{ label: 'Vehicle', value: d.vehicle_plate }] : []),
        ...(d.sq_number ? [{ label: 'SQ Reference', value: d.sq_number }] : []),
        { label: 'Payment Terms', value: d.payment_terms || '—' },
        { label: 'Currency', value: String(b.currency || 'PHP') },
      ],
      itemHeaders: SALES_LINE_ITEM_HEADERS,
      itemRows,
      summaryRows: [
        { label: 'No. of Line Items', value: String(printItems.length) },
        { label: 'Total Quantity', value: String(totalQty) },
        { label: 'TOTAL', value: fmtCurrency(total), total: true },
      ],
      bottomLeftHtml: [
        renderEnterpriseNotesBlock('Delivery Notes', notesContent),
        ...(d.terms_conditions?.trim() ? [renderEnterpriseNotesBlock('Terms & Conditions', d.terms_conditions)] : []),
      ].join(''),
      footerNote: 'Please inspect goods upon delivery and report shortages or damages within 24 hours.',
      status: d.status,
      biz: b,
    });
    res.send(html);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
