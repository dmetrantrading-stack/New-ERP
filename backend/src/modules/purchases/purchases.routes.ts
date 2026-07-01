import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';
import { savePriceHistoryFromGR } from '../supplier-price-history/supplier-price-history.routes';
import {
  tableRow, fmtCurrency, fmtDate,
} from '../../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildSupplierMetaRows,
  buildEnterpriseSignatures,
  formatTaxLabel,
  PURCHASE_REQUISITION_HEADERS,
  PURCHASE_ORDER_HEADERS,
  GOODS_RECEIPT_HEADERS,
} from '../../utils/salesEnterprisePrint';
import {
  buildPurchaseOrderItemsFromRequest,
  calculateGrLineAccounting,
  normalizePurchaseCostBasis,
} from '../../utils/purchaseTax';
import { auditAfter, auditBefore, auditSnapshot, AUDIT_FIELDS } from '../../utils/auditHelpers';
import { calculateBaseUnitCost, convertToBaseQty, resolveLineUom, resolveReceiveLineUomFromPo, resolvePurchaseDocLineUomFields, resolvePurchaseRequestItems, purchaseQtyFromPiecesNeeded } from '../../utils/uom';
import { loadProductUoms } from '../../utils/productUomDb';
import { enrichPurchasePrintLineUoms } from '../../utils/purchasePrintUom';
import { assertApprovalLimit } from '../../utils/approvalLimit';
import { repriceFromCostChange } from '../../utils/productPricing';

const router = Router();

const poView = hasUserPerm('purchases.purchase-order.view');
const grView = hasUserPerm('purchases.receiving-report.view');

const PR_ITEM_SELECT = `
  SELECT pri.*, p.sku, p.name as product_name,
         COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
         COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code
  FROM purchase_requisition_items pri
  JOIN products p ON pri.product_id = p.id
  LEFT JOIN uoms u ON pri.uom_id = u.id`;

const GR_ITEM_SELECT = `
  SELECT gri.*, p.sku, p.name as product_name,
         COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
         COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code
  FROM goods_receipt_items gri
  JOIN products p ON gri.product_id = p.id
  LEFT JOIN uoms u ON gri.uom_id = u.id`;

// Helper to generate reference numbers
const generateRefNumber = async (prefix: string, table: string, column: string): Promise<string> => {
  const safePrefix = prefix.replace(/[^A-Z]/g, '');
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeColumn = column.replace(/[^a-z_]/g, '');
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeColumn}, ${safePrefix.length + 2}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeColumn} ~ '^${safePrefix}-'`
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

// ==================== PURCHASE REQUISITIONS ====================
router.post('/requisitions', authenticate, hasUserPerm('purchases.purchase-order.create'), async (req: AuthRequest, res: Response) => {
  try {
    const pr_number = await generateRefNumber('PR', 'purchase_requisitions', 'pr_number');
    const { items, notes, terms_conditions } = req.body;
    const id = uuidv4();

    await query(
      'INSERT INTO purchase_requisitions (id, pr_number, requested_by, notes, terms_conditions) VALUES ($1, $2, $3, $4, $5)',
      [id, pr_number, req.user!.id, notes, terms_conditions || null]
    );

    for (const item of items || []) {
      const qty = parseFloat(item.quantity) || 0;
      const uomFields = item.product_id
        ? await resolvePurchaseDocLineUomFields({ query }, item.product_id, item, qty, loadProductUoms)
        : {
          enteredQty: qty,
          uom_id: item.uom_id || null,
          conversion_to_base: parseFloat(item.conversion_to_base) || 1,
          base_qty: qty,
        };
      await query(
        `INSERT INTO purchase_requisition_items (id, pr_id, product_id, quantity, estimated_cost, tax_type, uom_id, entered_qty, conversion_to_base, base_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [uuidv4(), id, item.product_id, uomFields.enteredQty, item.estimated_cost, item.tax_type || 'VAT',
         uomFields.uom_id, uomFields.enteredQty, uomFields.conversion_to_base, uomFields.base_qty]
      );
    }

    res.status(201).json({ id, pr_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/requisitions', authenticate, poView, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT pr.*, u.full_name as requested_by_name,
              (SELECT COUNT(*) FROM purchase_requisition_items WHERE pr_id = pr.id) as item_count,
              (SELECT po_number FROM purchase_orders WHERE pr_id = pr.id LIMIT 1) as linked_po_number
       FROM purchase_requisitions pr
       LEFT JOIN users u ON pr.requested_by = u.id
       ORDER BY pr.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/requisitions/:id', authenticate, poView, async (req: AuthRequest, res: Response) => {
  try {
    const pr = await query(
      `SELECT pr.*, u.full_name as requested_by_name, au.full_name as approved_by_name,
              (SELECT po_number FROM purchase_orders WHERE pr_id = pr.id LIMIT 1) as linked_po_number
       FROM purchase_requisitions pr
       LEFT JOIN users u ON pr.requested_by = u.id
       LEFT JOIN users au ON pr.approved_by = au.id
       WHERE pr.id = $1`,
      [req.params.id]
    );
    if (pr.rows.length === 0) return res.status(404).json({ error: 'Requisition not found' });
    const items = await query(
      `${PR_ITEM_SELECT} WHERE pri.pr_id = $1`,
      [req.params.id]
    );
    res.json({ ...pr.rows[0], items: items.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/requisitions/:id/print', authenticate, poView, async (req: AuthRequest, res: Response) => {
  try {
    const pr = await query(
      `SELECT pr.*, u.full_name as requested_by_name, au.full_name as approved_by_name,
              (SELECT po_number FROM purchase_orders WHERE pr_id = pr.id LIMIT 1) as linked_po_number
       FROM purchase_requisitions pr
       LEFT JOIN users u ON pr.requested_by = u.id
       LEFT JOIN users au ON pr.approved_by = au.id
       WHERE pr.id = $1`,
      [req.params.id],
    );
    if (pr.rows.length === 0) return res.status(404).send('Not found');
    const d = pr.rows[0];

    const items = await query(
      `${PR_ITEM_SELECT} WHERE pri.pr_id = $1 ORDER BY pri.id`,
      [req.params.id],
    );
    const printItems = await enrichPurchasePrintLineUoms({ query }, items.rows);

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const itemRows = printItems.map((row: any, idx: number) => {
      const lineTotal = parseFloat(row.quantity) * parseFloat(row.estimated_cost || 0);
      const taxLabel = formatTaxLabel(row.tax_type);
      return tableRow([
        { html: String(idx + 1), align: 'c' },
        { html: row.sku || '—', align: 'c' },
        { html: row.product_name || '—' },
        { html: row.display_uom || row.unit_of_measure || 'pc', align: 'c' },
        { html: String(parseFloat(row.quantity)), align: 'c' },
        { html: fmtCurrency(row.estimated_cost), align: 'r' },
        { html: taxLabel, align: 'c' },
        { html: fmtCurrency(lineTotal), align: 'r' },
      ]);
    }).join('');

    const estTotal = printItems.reduce(
      (s: number, r: any) => s + parseFloat(r.quantity) * parseFloat(r.estimated_cost || 0),
      0,
    );
    const totalQty = printItems.reduce((s: number, r: any) => s + parseFloat(r.quantity), 0);

    const summaryRows = [
      { label: 'Total Items', value: String(printItems.length) },
      { label: 'Total Quantity', value: String(totalQty) },
      { label: 'ESTIMATED TOTAL', value: fmtCurrency(estTotal), total: true },
    ];

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Purchase Requisition ${d.pr_number}`,
      docTitle: 'Purchase Requisition',
      docMetaRows: [
        { label: 'Document No.', value: d.pr_number || '—' },
        { label: 'Document Date', value: fmtDate(d.created_at, 'short') },
        { label: 'Requested By', value: d.requested_by_name || '—' },
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Requisition Details',
      customerRows: [
        { label: 'Requested By', value: d.requested_by_name || '—' },
        ...(d.approved_by_name ? [{ label: 'Approved By', value: d.approved_by_name }] : []),
        ...(d.linked_po_number ? [{ label: 'Linked PO', value: d.linked_po_number }] : []),
      ],
      detailsTitle: 'Purpose / Notes',
      detailsRows: [{ label: 'Notes', value: d.notes?.trim() || '—' }],
      itemHeaders: PURCHASE_REQUISITION_HEADERS,
      itemRows,
      summaryRows,
      amountInWords: estTotal,
      notes: [{
        label: 'Terms & Conditions',
        content: d.terms_conditions?.trim() || 'Items requested for replenishment or operational use. Final pricing and supplier selection subject to purchase order approval.',
      }],
      footerNote: 'System-generated purchase requisition.',
      status: d.status,
      biz: b,
      signatures: [
        { label: 'Prepared By', name: d.requested_by_name || undefined },
        'Reviewed By',
        { label: 'Approved By', name: d.approved_by_name || undefined },
      ],
      signatureCols: 3,
    });
    res.send(html);
  } catch (error: any) {
    res.status(500).send('<p>Error: ' + error.message + '</p>');
  }
});

router.patch('/requisitions/:id/approve', authenticate, hasUserPerm('purchases.purchase-order.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const pr = await query('SELECT * FROM purchase_requisitions WHERE id = $1', [req.params.id]);
    if (pr.rows.length === 0) return res.status(404).json({ error: 'Requisition not found' });
    if (!['Draft', 'Pending'].includes(pr.rows[0].status)) {
      return res.status(400).json({ error: 'Only draft or pending requisitions can be approved' });
    }
    const est = await query(
      `SELECT COALESCE(SUM(pri.quantity * COALESCE(pri.estimated_cost, p.cost, 0)), 0) AS total
       FROM purchase_requisition_items pri
       LEFT JOIN products p ON p.id = pri.product_id
       WHERE pri.pr_id = $1`,
      [req.params.id],
    );
    await assertApprovalLimit(req, parseFloat(est.rows[0]?.total || 0), 'purchase requisition');
    await query(
      "UPDATE purchase_requisitions SET status = 'Approved', approved_by = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [req.user!.id, req.params.id]
    );
    res.json({ message: 'Requisition approved' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.post('/requisitions/generate-from-low-stock', authenticate, hasUserPerm('purchases.purchase-order.create'), async (req: AuthRequest, res: Response) => {
  try {
    const lowStock = await query(
      `SELECT p.id as product_id, p.sku, p.name, p.reorder_level, p.cost,
              COALESCE(SUM(i.quantity), 0) as total_qty
       FROM products p
       JOIN inventory i ON p.id = i.product_id
       WHERE p.is_active = true AND p.reorder_level > 0
       GROUP BY p.id, p.sku, p.name, p.reorder_level, p.cost
       HAVING COALESCE(SUM(i.quantity), 0) <= p.reorder_level
       ORDER BY p.name`
    );
    if (lowStock.rows.length === 0) {
      return res.status(400).json({ error: 'No low-stock products found' });
    }

    const pr_number = await generateRefNumber('PR', 'purchase_requisitions', 'pr_number');
    const id = uuidv4();
    const notes = req.body.notes || 'Auto-generated from low stock alert';

    await query(
      'INSERT INTO purchase_requisitions (id, pr_number, requested_by, notes, status) VALUES ($1, $2, $3, $4, $5)',
      [id, pr_number, req.user!.id, notes, 'Draft']
    );

    let itemCount = 0;
    for (const row of lowStock.rows) {
      const reorder = parseFloat(row.reorder_level);
      const onHand = parseFloat(row.total_qty);
      const orderQty = Math.max(reorder - onHand, reorder * 0.5);
      if (orderQty <= 0) continue;
      const uomRows = await loadProductUoms({ query }, row.product_id);
      const prod = await query('SELECT default_purchase_uom_id FROM products WHERE id = $1', [row.product_id]);
      const uom = resolveLineUom(uomRows, null, prod.rows[0]?.default_purchase_uom_id);
      const qtyFromPieces = purchaseQtyFromPiecesNeeded(Math.ceil(orderQty), uom);
      if (qtyFromPieces.enteredQty <= 0) continue;
      const estimatedCost = parseFloat(String(uom?.purchase_price)) || parseFloat(row.cost) || 0;
      await query(
        `INSERT INTO purchase_requisition_items (id, pr_id, product_id, quantity, estimated_cost, tax_type, uom_id, entered_qty, conversion_to_base, base_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [uuidv4(), id, row.product_id, qtyFromPieces.enteredQty, estimatedCost, 'VAT',
         qtyFromPieces.uom_id, qtyFromPieces.enteredQty, qtyFromPieces.conversion_to_base, qtyFromPieces.base_qty]
      );
      itemCount++;
    }

    if (itemCount === 0) {
      await query('DELETE FROM purchase_requisitions WHERE id = $1', [id]);
      return res.status(400).json({ error: 'No replenishment quantities calculated' });
    }

    res.status(201).json({ id, pr_number, item_count: itemCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/requisitions/:id/cancel', authenticate, hasUserPerm('purchases.purchase-order.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const pr = await query('SELECT * FROM purchase_requisitions WHERE id = $1', [req.params.id]);
    if (pr.rows.length === 0) return res.status(404).json({ error: 'Requisition not found' });
    if (pr.rows[0].status === 'Cancelled') return res.status(400).json({ error: 'Already cancelled' });
    if (pr.rows[0].status === 'Approved') {
      const linked = await query('SELECT id FROM purchase_orders WHERE pr_id = $1 LIMIT 1', [req.params.id]);
      if (linked.rows.length > 0) return res.status(400).json({ error: 'Cannot cancel — PO already created from this requisition' });
    }
    await query(
      "UPDATE purchase_requisitions SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [req.params.id]
    );
    res.json({ message: 'Requisition cancelled' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/requisitions/:id/copy-to-po', authenticate, hasUserPerm('purchases.purchase-order.create'), async (req: AuthRequest, res: Response) => {
  try {
    const pr = await query('SELECT * FROM purchase_requisitions WHERE id = $1', [req.params.id]);
    if (pr.rows.length === 0) return res.status(404).json({ error: 'Requisition not found' });
    if (pr.rows[0].status !== 'Approved') {
      return res.status(400).json({ error: 'Requisition must be approved before creating a PO' });
    }
    const existingPo = await query('SELECT po_number FROM purchase_orders WHERE pr_id = $1 LIMIT 1', [req.params.id]);
    if (existingPo.rows.length > 0) {
      return res.status(400).json({ error: `PO ${existingPo.rows[0].po_number} already exists for this requisition` });
    }
    const items = await query(
      `${PR_ITEM_SELECT} WHERE pri.pr_id = $1`,
      [req.params.id]
    );
    res.json({
      pr_id: pr.rows[0].id,
      pr_number: pr.rows[0].pr_number,
      notes: pr.rows[0].notes || '',
      items: items.rows.map((i: any) => ({
        product_id: i.product_id,
        product_name: i.product_name,
        sku: i.sku,
        quantity: parseFloat(i.entered_qty ?? i.quantity),
        unit_cost: parseFloat(i.estimated_cost || 0),
        unit_of_measure: i.uom_code || i.unit_of_measure,
        uom_id: i.uom_id || null,
        conversion_to_base: parseFloat(i.conversion_to_base) || 1,
        base_qty: parseFloat(i.base_qty ?? i.quantity),
        tax_type: i.tax_type || 'VAT',
      })),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PURCHASE ORDERS ====================
router.post('/orders', authenticate, hasUserPerm('purchases.purchase-order.create'), auditLog('Purchases', 'Create PO'), async (req: AuthRequest, res: Response) => {
  try {
    const po_number = await generateRefNumber('PO', 'purchase_orders', 'po_number');
    const { supplier_id, pr_id, items, expected_date, payment_terms, notes, terms_conditions, vat_mode } = req.body;
    if (!supplier_id) return res.status(400).json({ error: 'Supplier is required' });
    const id = uuidv4();
    const costBasis = normalizePurchaseCostBasis(vat_mode);

    const resolvedItems = await resolvePurchaseRequestItems({ query }, items || [], loadProductUoms);
    const { orderItems, subtotal, totalLineDiscount, totals } = buildPurchaseOrderItemsFromRequest(resolvedItems, costBasis);

    await query(
      `INSERT INTO purchase_orders (id, po_number, supplier_id, pr_id, status, order_date, expected_date, payment_terms, notes, terms_conditions, subtotal, discount, tax, vat_mode, vat_amount, vatable_amount, total, created_by)
       VALUES ($1, $2, $3, $4, 'Draft', CURRENT_DATE, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [id, po_number, supplier_id, pr_id, expected_date || null, payment_terms, notes, terms_conditions || null,
       subtotal, totalLineDiscount, totals.vat, costBasis, totals.vat, totals.vatable, totals.total, req.user!.id]
    );

    for (const item of orderItems) {
      await query(
        `INSERT INTO purchase_order_items (id, po_id, product_id, quantity, unit_cost, discount_type, discount_value, discount_amount, net_unit_cost, net_total, total_cost, tax_type, uom_id, entered_qty, conversion_to_base, base_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [uuidv4(), id, item.product_id, item.quantity, item.unit_cost,
         item.discount_type, item.discount_value, item.discount_amount,
         item.net_unit_cost, item.net_total, item.net_total, item.tax_type,
         item.uom_id || null, item.entered_qty ?? item.quantity, item.conversion_to_base ?? 1, item.base_qty ?? item.quantity]
      );
    }

    res.status(201).json({ id, po_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/orders', authenticate, poView, async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string;
    const supplier_id = req.query.supplier_id as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const where: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (status) { where.push(`po.status = $${pi}`); params.push(status); pi++; }
    if (supplier_id) { where.push(`po.supplier_id = $${pi}`); params.push(supplier_id); pi++; }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = await query(`SELECT COUNT(*) FROM purchase_orders po ${whereClause}`, params);

    const result = await query(
      `SELECT po.*, s.supplier_name,
              (SELECT COUNT(*) FROM purchase_order_items WHERE po_id = po.id) as item_count
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       ${whereClause}
       ORDER BY po.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    );
    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/orders/:id', authenticate, poView, async (req: AuthRequest, res: Response) => {
  try {
    const po = await query(
      `SELECT po.*, s.supplier_name, s.supplier_code, u.full_name as created_by_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       LEFT JOIN users u ON po.created_by = u.id
       WHERE po.id = $1`,
      [req.params.id]
    );
    if (po.rows.length === 0) return res.status(404).json({ error: 'PO not found' });

    const items = await query(
      `SELECT poi.*, p.sku, p.name as product_name,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code
       FROM purchase_order_items poi
       JOIN products p ON poi.product_id = p.id
       LEFT JOIN uoms u ON poi.uom_id = u.id
       WHERE poi.po_id = $1`,
      [req.params.id]
    );

    res.json({ ...po.rows[0], items: items.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Send PO (change status to Sent)
router.patch('/orders/:id/send', authenticate, hasUserPerm('purchases.purchase-order.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT id, total FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });
    await assertApprovalLimit(req, parseFloat(existing.rows[0].total || 0), 'purchase order');
    await query("UPDATE purchase_orders SET status = 'Sent', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
    res.json({ message: 'PO sent' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// Edit Draft PO
router.put('/orders/:id', authenticate, hasUserPerm('purchases.purchase-order.edit'), auditLog('Purchases', 'Update PO'), async (req: AuthRequest, res: Response) => {
  try {
    const po = await query('SELECT * FROM purchase_orders WHERE id = $1', [req.params.id]);
    if (po.rows.length === 0) return res.status(404).json({ error: 'PO not found' });
    if (po.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft POs can be edited' });
    auditBefore(req, auditSnapshot(po.rows[0], AUDIT_FIELDS.purchaseOrder));

    const { supplier_id, items, expected_date, payment_terms, notes, terms_conditions, vat_mode } = req.body;
    if (!supplier_id) return res.status(400).json({ error: 'Supplier is required' });
    const costBasis = normalizePurchaseCostBasis(vat_mode);

    const resolvedItems = await resolvePurchaseRequestItems({ query }, items || [], loadProductUoms);
    const { orderItems, subtotal, totalLineDiscount, totals } = buildPurchaseOrderItemsFromRequest(resolvedItems, costBasis);

    await query(
      `UPDATE purchase_orders SET supplier_id = $1, expected_date = $2, payment_terms = $3, notes = $4, terms_conditions = $5,
        subtotal = $6, discount = $7, tax = $8, vat_mode = $9, vat_amount = $10, vatable_amount = $11, total = $12,
        updated_at = CURRENT_TIMESTAMP WHERE id = $13`,
      [supplier_id, expected_date || null, payment_terms, notes, terms_conditions || null,
       subtotal, totalLineDiscount, totals.vat, costBasis, totals.vat, totals.vatable, totals.total, req.params.id]
    );

    // Delete old items and re-insert
    await query('DELETE FROM purchase_order_items WHERE po_id = $1', [req.params.id]);
    for (const item of orderItems) {
      await query(
        `INSERT INTO purchase_order_items (id, po_id, product_id, quantity, unit_cost, discount_type, discount_value, discount_amount, net_unit_cost, net_total, total_cost, tax_type, uom_id, entered_qty, conversion_to_base, base_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [uuidv4(), req.params.id, item.product_id, item.quantity, item.unit_cost,
         item.discount_type, item.discount_value, item.discount_amount,
         item.net_unit_cost, item.net_total, item.net_total, item.tax_type,
         item.uom_id || null, item.entered_qty ?? item.quantity, item.conversion_to_base ?? 1, item.base_qty ?? item.quantity]
      );
    }

    auditAfter(req, auditSnapshot({
      id: req.params.id,
      po_number: po.rows[0].po_number,
      status: po.rows[0].status,
      supplier_id,
      subtotal,
      discount: totalLineDiscount,
      tax: totals.vat,
      vat_amount: totals.vat,
      total: totals.total,
      vat_mode: costBasis,
    }, AUDIT_FIELDS.purchaseOrder));
    res.json({ message: 'PO updated', id: req.params.id, po_number: po.rows[0].po_number });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== GOODS RECEIPT ====================
router.post('/receipts', authenticate, hasUserPerm('purchases.receiving-report.create'), auditLog('Purchases', 'Goods Receipt'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const gr_number = await generateRefNumber('GR', 'goods_receipts', 'gr_number');
    const { po_id, supplier_id, location_id, items, notes, terms_conditions, supplier_invoice_number } = req.body;
    if (!location_id) throw new AppError('Location ID is required');
    const id = uuidv4();

    await client.query(
      `INSERT INTO goods_receipts (id, gr_number, po_id, supplier_id, location_id, received_date, notes, terms_conditions, supplier_invoice_number, created_by)
       VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, $7, $8, $9)`,
      [id, gr_number, po_id, supplier_id, location_id, notes, terms_conditions || null, supplier_invoice_number || null, req.user!.id]
    );

    for (const item of items || []) {
      const batchId = uuidv4();
      const enteredQty = parseFloat(item.entered_qty ?? item.quantity ?? '0');
      if (enteredQty <= 0) throw new AppError('Receive quantity must be greater than zero');
      const discAmt = parseFloat(item.discount_amount || '0');
      const netUnitCost = parseFloat(item.net_unit_cost || item.unit_cost || '0');
      const totalCost = enteredQty * netUnitCost;

      const prodRow = await client.query(
        'SELECT id, unit_of_measure, default_purchase_uom_id FROM products WHERE id = $1',
        [item.product_id],
      );
      let poItemRow: {
        quantity?: number;
        received_quantity?: number;
        uom_id?: number;
        conversion_to_base?: number;
        unit_cost?: number;
        net_unit_cost?: number;
      } | null = null;
      if (item.po_item_id) {
        const poi = await client.query(
          'SELECT quantity, received_quantity, uom_id, conversion_to_base, unit_cost, net_unit_cost FROM purchase_order_items WHERE id = $1',
          [item.po_item_id],
        );
        if (poi.rows.length === 0) throw new AppError('PO line item not found');
        const poLine = poi.rows[0];
        poItemRow = poLine;
        const ordered = parseFloat(String(poLine.quantity));
        const received = parseFloat(String(poLine.received_quantity || 0));
        const remaining = ordered - received;
        if (enteredQty > remaining + 0.0001) {
          throw new AppError(`Receive quantity ${enteredQty} exceeds PO remaining ${remaining}`);
        }
      }
      const uomRows = await loadProductUoms({ query: client.query.bind(client) }, item.product_id);
      const uom = resolveReceiveLineUomFromPo(
        uomRows,
        item.uom_id ?? poItemRow?.uom_id,
        poItemRow,
        prodRow.rows[0]?.default_purchase_uom_id,
      );
      const conversionToBase = parseFloat(String(uom?.conversion_to_base ?? poItemRow?.conversion_to_base)) || 1;
      const baseQty = convertToBaseQty(enteredQty, conversionToBase);
      const baseUnitCost = calculateBaseUnitCost(netUnitCost, 1, conversionToBase);

      await client.query(
        `INSERT INTO batches (id, product_id, location_id, batch_number, supplier_batch, manufacturing_date, expiry_date, quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [batchId, item.product_id, location_id, item.batch_number || `BATCH-${Date.now()}`, item.supplier_batch,
         item.manufacturing_date, item.expiry_date, baseQty, baseUnitCost]
      );

      const griInsert = await client.query(
        `INSERT INTO goods_receipt_items (id, gr_id, po_item_id, product_id, batch_id, quantity, unit_cost, discount_amount, net_unit_cost, total_cost, expiry_date, batch_number,
          uom_id, entered_qty, conversion_to_base, base_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [uuidv4(), id, item.po_item_id || null, item.product_id, batchId, enteredQty, item.unit_cost, discAmt, netUnitCost, totalCost, item.expiry_date, item.batch_number,
          uom?.uom_id || null, enteredQty, conversionToBase, baseQty]
      );
      const grItemId = griInsert.rows[0]?.id;

      const inventory = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, location_id]
      );

      if (inventory.rows.length > 0) {
        const currentQty = parseFloat(inventory.rows[0].quantity);
        const currentCost = parseFloat(inventory.rows[0].unit_cost);
        const newQty = currentQty + baseQty;

        const totalValue = (currentCost * currentQty) + (baseUnitCost * baseQty);
        const newAvgCost = newQty > 0 ? totalValue / newQty : 0;

        await client.query(
          'UPDATE inventory SET quantity = $1, unit_cost = $2, updated_at = CURRENT_TIMESTAMP WHERE product_id = $3 AND location_id = $4',
          [newQty, newAvgCost, item.product_id, location_id]
        );
      } else {
        await client.query(
          'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4) ON CONFLICT (product_id, location_id) DO UPDATE SET quantity = EXCLUDED.quantity, unit_cost = EXCLUDED.unit_cost',
          [item.product_id, location_id, baseQty, baseUnitCost]
        );
      }

      const currentQty = inventory.rows.length > 0 ? parseFloat(inventory.rows[0].quantity) : 0;
      const newRunningQty = currentQty + baseQty;
      await client.query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, batch_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
         VALUES ($1, $2, $3, $4, 'Goods Receipt', $5, 'IN', $6, $7, $8, $9, $10, $11)`,
        [uuidv4(), item.product_id, location_id, batchId, id, baseQty, newRunningQty, baseUnitCost, baseUnitCost * baseQty, notes, req.user!.id]
      );

      if (item.po_item_id) {
        await client.query(
          'UPDATE purchase_order_items SET received_quantity = received_quantity + $1 WHERE id = $2',
          [enteredQty, item.po_item_id]
        );
      }

      await client.query('SAVEPOINT sph_save');
      try {
        const prod = await client.query('SELECT name, unit_of_measure FROM products WHERE id = $1', [item.product_id]);
        const supp = await client.query('SELECT supplier_name FROM suppliers WHERE id = $1', [supplier_id]);
        const poData = po_id ? await client.query('SELECT po_number FROM purchase_orders WHERE id = $1', [po_id]) : { rows: [] };
        const loc = await client.query('SELECT name FROM locations WHERE id = $1', [location_id]);
        if (!grItemId) throw new Error('GR line id missing after insert');

        await savePriceHistoryFromGR(client, {
          product_id: item.product_id,
          supplier_id: parseInt(supplier_id, 10),
          product_name: prod.rows[0]?.name || '',
          supplier_name: supp.rows[0]?.supplier_name || '',
          po_id: po_id || null,
          po_number: poData.rows[0]?.po_number || null,
          gr_id: id,
          gr_number: gr_number,
          gr_item_id: grItemId,
          received_date: new Date().toISOString().split('T')[0],
          unit_cost: netUnitCost,
          quantity_received: enteredQty,
          uom: uom?.uom_code || prod.rows[0]?.unit_of_measure || 'pc',
          location_id: parseInt(location_id),
          location_name: loc.rows[0]?.name || '',
          batch_number: item.batch_number || '',
          expiry_date: item.expiry_date || '',
          created_by: req.user!.id,
          remarks: `Received via ${gr_number}`,
        });
        await client.query('RELEASE SAVEPOINT sph_save');
      } catch (sphErr) {
        await client.query('ROLLBACK TO SAVEPOINT sph_save');
        console.error('Failed to save supplier price history:', sphErr);
      }
    }

    // Update product-level cost based on moving average across all locations (once per GR)
    const autoSetting = await client.query(`SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('auto_update_cost_from_rr', 'auto_reprice_on_gr')`);
    const settingsMap = Object.fromEntries(autoSetting.rows.map((r: any) => [r.setting_key, r.setting_value]));
    const autoUpdate = settingsMap.auto_update_cost_from_rr === 'true';
    const autoReprice = settingsMap.auto_reprice_on_gr === 'true';
    if (autoUpdate) {
      const uniqueProductIds = [...new Set(items.map((i: any) => i.product_id))];
      for (const pid of uniqueProductIds) {
        const prod = await client.query(
          'SELECT cost, retail_price, wholesale_price, distributor_price FROM products WHERE id = $1',
          [pid],
        );
        const inv = await client.query(
          `SELECT SUM(quantity) as total_qty, SUM(quantity * unit_cost) as total_value FROM inventory WHERE product_id = $1`,
          [pid]
        );
        const totalQty = parseFloat(inv.rows[0]?.total_qty || 0);
        const totalValue = parseFloat(inv.rows[0]?.total_value || 0);
        if (totalQty > 0) {
          const oldCost = parseFloat(prod.rows[0]?.cost) || 0;
          const newCost = totalValue / totalQty;
          const priceUpdates = autoReprice
            ? repriceFromCostChange(
              oldCost,
              newCost,
              parseFloat(prod.rows[0]?.retail_price) || 0,
              parseFloat(prod.rows[0]?.wholesale_price) || 0,
              parseFloat(prod.rows[0]?.distributor_price) || 0,
            )
            : null;
          if (priceUpdates) {
            await client.query(
              `UPDATE products SET cost = $1, retail_price = COALESCE($2, retail_price),
               wholesale_price = COALESCE($3, wholesale_price), distributor_price = COALESCE($4, distributor_price),
               updated_at = CURRENT_TIMESTAMP WHERE id = $5`,
              [newCost, priceUpdates.retail_price ?? null, priceUpdates.wholesale_price ?? null, priceUpdates.distributor_price ?? null, pid],
            );
          } else {
            await client.query(
              `UPDATE products SET cost = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
              [newCost, pid]
            );
          }
        }
      }
    }

    // Update PO status
    if (po_id) {
      const remaining = await client.query(
        `SELECT COUNT(*) as pending FROM purchase_order_items WHERE po_id = $1 AND received_quantity < quantity`,
        [po_id]
      );
      const newStatus = parseInt(remaining.rows[0].pending) > 0 ? 'Partial' : 'Received';
      await client.query(`UPDATE purchase_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [newStatus, po_id]);
    }

    // Update goods receipt status
    await client.query("UPDATE goods_receipts SET status = 'Completed' WHERE id = $1", [id]);

    // Create Accounts Payable journal entry (per-line tax from PO items)
    let poCostBasis = normalizePurchaseCostBasis('VAT Inclusive');
    const taxTypeByPoItem: Record<string, string> = {};
    if (po_id) {
      const po = await client.query('SELECT vat_mode FROM purchase_orders WHERE id = $1', [po_id]);
      if (po.rows.length > 0) poCostBasis = normalizePurchaseCostBasis(po.rows[0].vat_mode);
      const poItems = await client.query('SELECT id, tax_type FROM purchase_order_items WHERE po_id = $1', [po_id]);
      for (const row of poItems.rows) taxTypeByPoItem[row.id] = row.tax_type || 'VAT';
    }

    let netInventoryCost = 0;
    let inputVatAmt = 0;
    let apTotal = 0;
    for (const item of items || []) {
      const lineAmount = parseFloat(item.quantity) * parseFloat(item.net_unit_cost || item.unit_cost || '0');
      const taxType = taxTypeByPoItem[item.po_item_id] || 'VAT';
      const acct = calculateGrLineAccounting(lineAmount, taxType, poCostBasis);
      netInventoryCost += acct.inventoryDebit;
      inputVatAmt += acct.inputVat;
      apTotal += acct.apCredit;
    }

    const apEntryId = uuidv4();
    const apEntryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Goods Receipt', $3, $4, $5, $5, $6)`,
      [apEntryId, apEntryNumber, id, `AP from GR ${gr_number}`, apTotal, req.user!.id]
    );

    if (inputVatAmt > 0) {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, $4, 0, 'Goods Receipt', $5)`,
        [uuidv4(), apEntryId, `Inventory (net) ${gr_number}`, netInventoryCost, id]
      );
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1106'), $3, $4, 0, 'Goods Receipt', $5)`,
        [uuidv4(), apEntryId, `Input VAT ${gr_number}`, inputVatAmt, id]
      );
    } else {
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, $4, 0, 'Goods Receipt', $5)`,
        [uuidv4(), apEntryId, `Inventory ${gr_number}`, netInventoryCost, id]
      );
    }

    // Credit Accounts Payable
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), $3, 0, $4, 'Goods Receipt', $5)`,
      [uuidv4(), apEntryId, `AP from ${gr_number}`, apTotal, id]
    );

    // Note: Supplier balance is updated when APV is posted, not here

    await client.query('COMMIT');
    res.status(201).json({ id, gr_number });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/receipts', authenticate, grView, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const supplier_id = req.query.supplier_id as string;
    const po_id = req.query.po_id as string;

    const where: string[] = [];
    const params: any[] = [];
    let pi = 1;

    if (supplier_id) { where.push(`gr.supplier_id = $${pi}`); params.push(supplier_id); pi++; }
    if (po_id) { where.push(`gr.po_id = $${pi}`); params.push(po_id); pi++; }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const total = await query(`SELECT COUNT(*) FROM goods_receipts gr ${whereClause}`, params);

    const result = await query(
      `SELECT gr.*, s.supplier_name, l.name as location_name, po.po_number,
              u.full_name as created_by_name,
              (SELECT COUNT(*) FROM goods_receipt_items WHERE gr_id = gr.id) as item_count,
              (SELECT COALESCE(SUM(total_cost), 0) FROM goods_receipt_items WHERE gr_id = gr.id) as total_amount
       FROM goods_receipts gr
       LEFT JOIN suppliers s ON gr.supplier_id = s.id
       LEFT JOIN locations l ON gr.location_id = l.id
       LEFT JOIN purchase_orders po ON gr.po_id = po.id
       LEFT JOIN users u ON gr.created_by = u.id
       ${whereClause}
       ORDER BY gr.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    );
    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/receipts/:id', authenticate, grView, async (req: AuthRequest, res: Response) => {
  try {
    const gr = await query(
      `SELECT gr.*, s.supplier_name, s.supplier_code, s.tin as supplier_tin, s.address as supplier_address,
              l.name as location_name, po.po_number, po.vat_mode,
              u.full_name as created_by_name
       FROM goods_receipts gr
       LEFT JOIN suppliers s ON gr.supplier_id = s.id
       LEFT JOIN locations l ON gr.location_id = l.id
       LEFT JOIN purchase_orders po ON gr.po_id = po.id
       LEFT JOIN users u ON gr.created_by = u.id
       WHERE gr.id = $1`,
      [req.params.id]
    );
    if (gr.rows.length === 0) return res.status(404).json({ error: 'Goods receipt not found' });

    const items = await query(
      `${GR_ITEM_SELECT} WHERE gri.gr_id = $1 ORDER BY gri.id`,
      [req.params.id]
    );

    const totalAmount = items.rows.reduce((s: number, i: any) => s + parseFloat(i.total_cost || 0), 0);
    res.json({ ...gr.rows[0], items: items.rows, total_amount: totalAmount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/receipts/:id/print', authenticate, hasUserPerm('purchases.receiving-report.print'), async (req: AuthRequest, res: Response) => {
  try {
    const gr = await query(
      `SELECT gr.*, s.supplier_name, s.supplier_code, s.tin as supplier_tin, s.address as supplier_address,
              l.name as location_name, po.po_number, po.vat_mode,
              u.full_name as created_by_name
       FROM goods_receipts gr
       LEFT JOIN suppliers s ON gr.supplier_id = s.id
       LEFT JOIN locations l ON gr.location_id = l.id
       LEFT JOIN purchase_orders po ON gr.po_id = po.id
       LEFT JOIN users u ON gr.created_by = u.id
       WHERE gr.id = $1`,
      [req.params.id]
    );
    if (gr.rows.length === 0) return res.status(404).send('Not found');
    const d = gr.rows[0];

    const items = await query(
      `${GR_ITEM_SELECT} WHERE gri.gr_id = $1 ORDER BY gri.id`,
      [req.params.id]
    );
    const printItems = await enrichPurchasePrintLineUoms({ query }, items.rows);

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const totalQty = printItems.reduce((s: number, r: any) => s + parseFloat(r.quantity || 0), 0);
    const totalAmount = printItems.reduce((s: number, r: any) => s + parseFloat(r.total_cost || 0), 0);

    const itemRows = printItems.map((row: any, idx: number) => tableRow([
      { html: String(idx + 1), align: 'c' },
      { html: row.product_name || '—' },
      { html: String(parseFloat(row.quantity)), align: 'c' },
      { html: row.display_uom || row.unit_of_measure || 'pc', align: 'c' },
      { html: row.batch_number || '—', align: 'c' },
      { html: row.expiry_date ? fmtDate(row.expiry_date, 'short') : '—', align: 'c' },
      { html: fmtCurrency(row.net_unit_cost || row.unit_cost), align: 'r' },
      { html: fmtCurrency(row.total_cost), align: 'r' },
    ])).join('');

    const summaryRows = [
      { label: 'Total Items', value: String(printItems.length) },
      { label: 'Total Quantity', value: String(totalQty) },
      { label: 'TOTAL RECEIVED', value: fmtCurrency(totalAmount), total: true },
    ];

    res.send(buildSalesEnterpriseDocument({
      pageTitle: `Goods Receipt ${d.gr_number}`,
      docTitle: 'Goods Receipt',
      docMetaRows: [
        { label: 'Document No.', value: d.gr_number || '—' },
        { label: 'Received Date', value: fmtDate(d.received_date, 'short') },
        { label: 'Location', value: d.location_name || '—' },
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Supplier Information',
      customerRows: buildSupplierMetaRows({
        name: d.supplier_name,
        code: d.supplier_code,
        address: d.supplier_address,
        tin: d.supplier_tin,
      }),
      detailsTitle: 'Receipt Details',
      detailsRows: [
        ...(d.po_number ? [{ label: 'PO Reference', value: d.po_number }] : []),
        ...(d.supplier_invoice_number ? [{ label: 'Supplier Invoice', value: d.supplier_invoice_number }] : []),
        ...(d.created_by_name ? [{ label: 'Received By', value: d.created_by_name }] : []),
      ],
      itemHeaders: GOODS_RECEIPT_HEADERS,
      itemRows,
      summaryRows,
      amountInWords: totalAmount,
      notes: [{ label: 'Remarks', content: d.notes || 'Goods received and checked against purchase order.' }],
      footerNote: 'System-generated goods receipt.',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseSignatures(b),
    }));
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// ==================== PURCHASE RETURNS ====================
router.get('/returns', authenticate, grView, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const total = await query('SELECT COUNT(*) FROM purchase_returns');
    const result = await query(
      `SELECT pr.*, s.supplier_name,
              (SELECT COUNT(*) FROM purchase_return_items WHERE return_id = pr.id) as item_count
       FROM purchase_returns pr
       LEFT JOIN suppliers s ON pr.supplier_id = s.id
       ORDER BY pr.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/returns/:id', authenticate, grView, async (req: AuthRequest, res: Response) => {
  try {
    const pret = await query(
      `SELECT pr.*, s.supplier_name, s.supplier_code, u.full_name as created_by_name
       FROM purchase_returns pr
       LEFT JOIN suppliers s ON pr.supplier_id = s.id
       LEFT JOIN users u ON pr.created_by = u.id
       WHERE pr.id = $1`,
      [req.params.id]
    );
    if (pret.rows.length === 0) return res.status(404).json({ error: 'Purchase return not found' });
    const items = await query(
      `SELECT pri.*, p.sku, p.name as product_name,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
              l.name as location_name
       FROM purchase_return_items pri
       JOIN products p ON pri.product_id = p.id
       LEFT JOIN locations l ON pri.location_id = l.id
       WHERE pri.return_id = $1`,
      [req.params.id]
    );
    res.json({ ...pret.rows[0], items: items.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/returns/:id/print', authenticate, hasUserPerm('purchases.receiving-report.print'), async (req: AuthRequest, res: Response) => {
  try {
    const pret = await query(
      `SELECT pr.*, s.supplier_name, s.supplier_code, s.address as supplier_address, u.full_name as created_by_name
       FROM purchase_returns pr
       LEFT JOIN suppliers s ON pr.supplier_id = s.id
       LEFT JOIN users u ON pr.created_by = u.id
       WHERE pr.id = $1`,
      [req.params.id]
    );
    if (pret.rows.length === 0) return res.status(404).send('Not found');
    const d = pret.rows[0];
    const items = await query(
      `SELECT pri.*, p.sku, p.name as product_name,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM purchase_return_items pri
       JOIN products p ON pri.product_id = p.id
       WHERE pri.return_id = $1`,
      [req.params.id]
    );
    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const itemRows = items.rows.map((i: any) => tableRow([
      { html: i.sku || '—' },
      { html: i.product_name || '—' },
      { html: i.unit_of_measure || 'pc', align: 'c' },
      { html: parseFloat(i.quantity).toFixed(2), align: 'c' },
      { html: fmtCurrency(i.net_unit_cost || i.unit_cost), align: 'r' },
      { html: fmtCurrency(i.total_cost), align: 'r' },
    ])).join('');
    const totalReturn = parseFloat(d.total || 0);
    res.send(buildSalesEnterpriseDocument({
      pageTitle: `Purchase Return ${d.pr_number}`,
      docTitle: 'Purchase Return',
      docMetaRows: [
        { label: 'Document No.', value: d.pr_number || '—' },
        { label: 'Return Date', value: fmtDate(d.return_date, 'short') },
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Supplier Information',
      customerRows: buildSupplierMetaRows({ name: d.supplier_name, code: d.supplier_code, address: d.supplier_address }),
      detailsTitle: 'Return Details',
      detailsRows: [
        { label: 'Reason', value: d.reason || '—' },
        { label: 'Prepared By', value: d.created_by_name || '—' },
      ],
      itemHeaders: [
        { text: 'Item Code', align: 'left', width: '72px' },
        { text: 'Description', align: 'left' },
        { text: 'UOM', align: 'center', width: '40px' },
        { text: 'Qty', align: 'center', width: '44px' },
        { text: 'Unit Cost', align: 'right', width: '76px' },
        { text: 'Amount', align: 'right', width: '80px' },
      ],
      itemRows,
      summaryRows: [{ label: 'TOTAL RETURN', value: fmtCurrency(totalReturn), total: true }],
      amountInWords: totalReturn,
      notes: d.notes ? [{ label: 'Remarks', content: d.notes }] : [],
      footerNote: 'System-generated purchase return.',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseSignatures(b),
      signatureCols: 2,
    }));
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

router.post('/returns', authenticate, hasUserPerm('purchases.receiving-report.edit'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const pr_number = await generateRefNumber('PRET', 'purchase_returns', 'pr_number');
    const { supplier_id, items, reason, notes, terms_conditions } = req.body;
    const id = uuidv4();

    await client.query(
      `INSERT INTO purchase_returns (id, pr_number, supplier_id, return_date, status, reason, notes, terms_conditions, created_by)
       VALUES ($1, $2, $3, CURRENT_DATE, 'Draft', $4, $5, $6, $7)`,
      [id, pr_number, supplier_id, reason, notes, terms_conditions || null, req.user!.id]
    );

    let totalReturn = 0;
    for (const item of items || []) {
      const enteredQty = parseFloat(item.quantity);
      if (enteredQty <= 0) throw new AppError('Return quantity must be greater than zero');

      let baseQty = enteredQty;
      if (item.uom_id != null || item.conversion_to_base != null) {
        if (item.product_id) {
          const uomFields = await resolvePurchaseDocLineUomFields(
            { query: client.query.bind(client) },
            item.product_id,
            item,
            enteredQty,
            loadProductUoms,
          );
          baseQty = uomFields.base_qty;
        } else {
          baseQty = convertToBaseQty(enteredQty, parseFloat(item.conversion_to_base) || 1);
        }
      }

      const netCost = parseFloat(item.net_unit_cost || item.unit_cost || '0');
      const total = enteredQty * netCost;
      totalReturn += total;

      await client.query(
        `INSERT INTO purchase_return_items (id, return_id, product_id, location_id, batch_id, quantity, unit_cost, net_unit_cost, total_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [uuidv4(), id, item.product_id, item.location_id || 1, item.batch_id || null,
         enteredQty, parseFloat(item.unit_cost || netCost), netCost, total]
      );

      // Deduct from inventory (always in base pieces)
      const inventory = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, item.location_id || 1]
      );
      if (inventory.rows.length === 0) {
        throw new AppError('No inventory record for this product at the selected location');
      }
      const currentQty = parseFloat(inventory.rows[0].quantity);
      const newQty = currentQty - baseQty;
      if (newQty < 0) throw new AppError('Return quantity exceeds available stock');
      await client.query('UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newQty, inventory.rows[0].id]);

      // Inventory ledger entry
      await client.query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, created_by)
         VALUES ($1, $2, $3, 'Purchase Return', $4, 'OUT', $5, $6, $7, $8, $9)`,
        [uuidv4(), item.product_id, item.location_id || 1, id, baseQty, newQty,
         netCost, netCost * baseQty, req.user!.id]
      );

      // Deduct from batch
      if (item.batch_id) {
        await client.query('UPDATE batches SET quantity = quantity - $1 WHERE id = $2', [baseQty, item.batch_id]);
      }
    }

    await client.query("UPDATE purchase_returns SET status = 'Completed', total = $1 WHERE id = $2", [totalReturn, id]);

    // Update supplier balance
    if (supplier_id) {
      await client.query('UPDATE suppliers SET balance = balance - $1 WHERE id = $2', [totalReturn, supplier_id]);
    }

    // Reversing journal entry: Credit Inventory, Debit AP (reverse of GR entry)
    const returnEntryId = uuidv4();
    const returnEntryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Purchase Return', $3, $4, $5, $5, $6)`,
      [returnEntryId, returnEntryNumber, id, `Purchase Return ${pr_number}`, totalReturn, req.user!.id]
    );

    // Debit AP (reduce liability)
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), $3, $4, 0, 'Purchase Return', $5)`,
      [uuidv4(), returnEntryId, `AP Return ${pr_number}`, totalReturn, id]
    );

    // Credit Inventory (reduce asset)
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, 0, $4, 'Purchase Return', $5)`,
      [uuidv4(), returnEntryId, `Inventory Return ${pr_number}`, totalReturn, id]
    );

    await client.query('COMMIT');
    res.status(201).json({ id, pr_number });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Printable Purchase Order
router.get('/orders/:id/print', authenticate, hasUserPerm('purchases.purchase-order.print'), async (req: AuthRequest, res: Response) => {
  try {
    const po = await query(
      `SELECT po.*, s.supplier_name, s.supplier_code, s.contact_person, s.phone as contact_number, s.tin as supplier_tin, s.address as supplier_address, u.full_name as created_by_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       LEFT JOIN users u ON po.created_by = u.id
       WHERE po.id = $1`,
      [req.params.id]
    );
    if (po.rows.length === 0) return res.status(404).send('Not found');
    const d = po.rows[0];

    const items = await query(
      `SELECT poi.*, p.sku, p.name as product_name,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code
       FROM purchase_order_items poi
       JOIN products p ON poi.product_id = p.id
       LEFT JOIN uoms u ON poi.uom_id = u.id
       WHERE poi.po_id = $1 ORDER BY poi.id`,
      [req.params.id]
    );

    const printItems = await enrichPurchasePrintLineUoms({ query }, items.rows);

    const itemRows = printItems.map((row: any) => {
      const taxLabel = formatTaxLabel(row.tax_type);
      return tableRow([
        { html: row.product_name || '—' },
        { html: String(parseFloat(row.quantity)), align: 'c' },
        { html: row.display_uom || row.unit_of_measure || 'pc', align: 'c' },
        { html: fmtCurrency(row.unit_cost), align: 'r' },
        { html: taxLabel, align: 'c' },
        { html: fmtCurrency(row.discount_amount || 0), align: 'r' },
        { html: fmtCurrency(row.net_total || row.total_cost), align: 'r' },
      ]);
    }).join('');

    const grossTotal = parseFloat(d.subtotal) || 0;
    const discountAmt = parseFloat(d.discount) || 0;
    const vatableAmt = parseFloat(d.vatable_amount) || 0;
    const vatAmt = parseFloat(d.vat_amount) || 0;
    const total = parseFloat(d.total) || 0;
    const totalQty = printItems.reduce((s: number, r: any) => s + parseFloat(r.quantity), 0);
    let vatExemptAmt = 0;
    let zeroRatedAmt = 0;
    for (const row of items.rows) {
      const net = parseFloat(row.net_total || row.total_cost || 0);
      if (row.tax_type === 'VAT Exempt') vatExemptAmt += net;
      else if (row.tax_type === 'Zero Rated') zeroRatedAmt += net;
    }

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const summaryRows = [
      { label: 'Total Items', value: String(printItems.length) },
      { label: 'Total Quantity', value: String(totalQty) },
      { label: 'Trade Subtotal', value: fmtCurrency(grossTotal) },
      ...(discountAmt > 0 ? [{ label: 'Less Discount', value: fmtCurrency(discountAmt) }] : []),
      ...(vatableAmt > 0 ? [{ label: 'VATable Purchase', value: fmtCurrency(vatableAmt) }] : []),
      ...(vatExemptAmt > 0 ? [{ label: 'VAT Exempt', value: fmtCurrency(vatExemptAmt) }] : []),
      ...(zeroRatedAmt > 0 ? [{ label: 'Zero Rated', value: fmtCurrency(zeroRatedAmt) }] : []),
      ...(vatAmt > 0 ? [{ label: 'Input VAT (12%)', value: fmtCurrency(vatAmt) }] : []),
      { label: 'TOTAL PO AMOUNT', value: fmtCurrency(total), total: true },
    ];

    const html = buildSalesEnterpriseDocument({
      pageTitle: `Purchase Order ${d.po_number}`,
      docTitle: 'Purchase Order',
      docMetaRows: [
        { label: 'Document No.', value: d.po_number || '—' },
        { label: 'Order Date', value: fmtDate(d.order_date, 'short') },
        ...(d.expected_date ? [{ label: 'Expected Delivery', value: fmtDate(d.expected_date, 'short') }] : []),
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Supplier Information',
      customerRows: buildSupplierMetaRows({
        name: d.supplier_name,
        code: d.supplier_code,
        address: d.supplier_address,
        tin: d.supplier_tin,
        contact: d.contact_person,
        phone: d.contact_number,
      }),
      detailsTitle: 'Purchase Order Details',
      detailsRows: [
        ...(d.payment_terms ? [{ label: 'Payment Terms', value: d.payment_terms }] : []),
        { label: 'Cost Basis', value: normalizePurchaseCostBasis(d.vat_mode) },
        ...(d.created_by_name ? [{ label: 'Prepared By', value: d.created_by_name }] : []),
      ],
      itemHeaders: PURCHASE_ORDER_HEADERS,
      itemRows,
      summaryRows,
      amountInWords: total,
      notes: [
        {
          label: 'Purchase Terms & Supplier Instructions',
          content: d.terms_conditions?.trim() || 'Please deliver the ordered goods according to the quantities, unit cost, and delivery schedule stated in this Purchase Order.',
        },
        {
          label: 'Receiving & Inventory Conditions',
          content: d.notes?.trim() || 'All received items must be checked against this Purchase Order. Batch number, expiry date, quantity received, and receiving location must be recorded before inventory is updated.',
        },
      ],
      footerNote: 'System-generated purchase order.',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseSignatures(b),
      signatureCols: 3,
    });
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
