import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm, hasUserAnyPerm } from '../../middleware/auth';
import { getApAgingReport } from '../../utils/financeAging';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import {
  tableRow, fmtCurrency, fmtDate,
  renderEnterpriseItemsTable, renderEnterpriseSectionTitle, renderEnterpriseNotesBlock,
} from '../../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildSupplierMetaRows,
  buildEnterpriseSignatures,
} from '../../utils/salesEnterprisePrint';
import {
  calculatePurchaseLine,
  calculatePurchaseTax,
  normalizePurchaseVatMode,
  purchaseInventoryDebitAmount,
  PurchaseVatMode,
} from '../../utils/purchaseTax';
import { prepareSupplierForPayment, syncSupplierBalanceFromApv } from '../../utils/supplierBalanceSync';
import { assertApprovalLimit } from '../../utils/approvalLimit';
import { AppError } from '../../middleware/errorHandler';

const router = Router();

async function resolveApvVatMode(po_id?: string | null, gr_id?: string | null, bodyMode?: string): Promise<PurchaseVatMode> {
  if (po_id) {
    const po = await query('SELECT vat_mode FROM purchase_orders WHERE id = $1', [po_id]);
    if (po.rows[0]?.vat_mode) return normalizePurchaseVatMode(po.rows[0].vat_mode);
  }
  if (gr_id) {
    const gr = await query('SELECT po_id FROM goods_receipts WHERE id = $1', [gr_id]);
    if (gr.rows[0]?.po_id) {
      const po = await query('SELECT vat_mode FROM purchase_orders WHERE id = $1', [gr.rows[0].po_id]);
      if (po.rows[0]?.vat_mode) return normalizePurchaseVatMode(po.rows[0].vat_mode);
    }
  }
  return normalizePurchaseVatMode(bodyMode);
}

const payablesView = hasUserAnyPerm(['purchases.apv.view', 'purchases.payment-voucher.view']);
const apvView = hasUserPerm('purchases.apv.view');
const apvForm = hasUserAnyPerm(['purchases.apv.view', 'purchases.apv.create']);
const pvView = hasUserPerm('purchases.payment-voucher.view');

const generateRefNumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number, 4) AS INTEGER)), 0) + 1 as next FROM payment_vouchers WHERE voucher_number ~ '^PV-'");
  return `PV-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const getNextCode = async (table: string, field: string, prefix: string, startPos: number) => {
  const numericOnly = table === 'cash_transactions' && prefix === 'CT-';
  const pattern = numericOnly ? `^${prefix}[0-9]+$` : `^${prefix}`;
  const r = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${field} FROM ${startPos}) AS INTEGER)), 0) + 1 as next FROM ${table} WHERE ${field} ~ '${pattern}'`
  );
  return `${prefix}${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

// Get goods receipts for supplier (for APV auto-population) — exclude GRs already linked to an APV
router.get('/goods-receipts/:supplierId', authenticate, apvForm, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT gr.*, po.po_number FROM goods_receipts gr
       LEFT JOIN purchase_orders po ON gr.po_id = po.id
       WHERE gr.supplier_id = $1 AND gr.status = 'Completed'
         AND gr.id NOT IN (
           SELECT gr_id FROM ap_vouchers
           WHERE gr_id IS NOT NULL AND status IN ('Draft','Posted','Partially Paid','Fully Paid')
         )
       ORDER BY gr.received_date DESC LIMIT 20`,
      [req.params.supplierId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get POs for a supplier (for APV auto-populate) — exclude POs that already have an APV
router.get('/supplier-pos/:supplierId', authenticate, apvForm, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT po.id, po.po_number, po.order_date, po.total, po.status FROM purchase_orders po
       WHERE po.supplier_id = $1 AND po.status IN ('Sent','Partial','Received')
         AND po.id NOT IN (
           SELECT po_id FROM ap_vouchers
           WHERE po_id IS NOT NULL AND status IN ('Draft','Posted','Partially Paid','Fully Paid')
         )
       ORDER BY po.order_date DESC LIMIT 30`,
      [req.params.supplierId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get PO items for APV population
router.get('/po-items/:poId', authenticate, apvForm, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT poi.*, p.name as product_name, p.sku,
              COALESCE(NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure
       FROM purchase_order_items poi JOIN products p ON poi.product_id = p.id WHERE poi.po_id = $1`,
      [req.params.poId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get GR items for APV population
router.get('/gr-items/:grId', authenticate, apvForm, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT gri.*, p.name as product_name, p.sku,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code,
              COALESCE(poi.tax_type, 'VAT') as tax_type
       FROM goods_receipt_items gri
       LEFT JOIN products p ON gri.product_id = p.id
       LEFT JOIN purchase_order_items poi ON gri.po_item_id = poi.id
       LEFT JOIN uoms u ON gri.uom_id = u.id
       WHERE gri.gr_id = $1 ORDER BY gri.id`,
      [req.params.grId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Prefill payload for copying PO to APV (no DB write)
router.get('/copy-from-po/:poId', authenticate, hasUserPerm('purchases.apv.create'), async (req: AuthRequest, res: Response) => {
  try {
    const po = await query(
      `SELECT po.*, s.supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       WHERE po.id = $1`,
      [req.params.poId]
    );
    if (po.rows.length === 0) return res.status(404).json({ error: 'Purchase order not found' });
    const row = po.rows[0];
    if (row.status === 'Draft') {
      return res.status(400).json({ error: 'Send the PO before creating an APV' });
    }
    if (row.status === 'Cancelled') {
      return res.status(400).json({ error: 'Cannot copy a cancelled PO to APV' });
    }

    const existing = await query(
      `SELECT apv_number, status FROM ap_vouchers WHERE po_id = $1 AND status IN ('Draft','Posted','Partially Paid','Fully Paid')`,
      [req.params.poId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `PO already has APV ${existing.rows[0].apv_number} (${existing.rows[0].status})` });
    }

    const items = await query(
      `SELECT poi.*, p.name as product_name, p.sku,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code
       FROM purchase_order_items poi
       JOIN products p ON poi.product_id = p.id
       LEFT JOIN uoms u ON poi.uom_id = u.id
       WHERE poi.po_id = $1 ORDER BY poi.id`,
      [req.params.poId]
    );
    if (items.rows.length === 0) return res.status(400).json({ error: 'No items on purchase order' });

    res.json({
      source_po_id: row.id,
      source_po_number: row.po_number,
      vat_mode: row.vat_mode || 'VAT Inclusive',
      supplier_id: row.supplier_id,
      supplier_name: row.supplier_name,
      po_id: row.id,
      gr_id: '',
      payment_terms: row.payment_terms || '',
      supplier_invoice_number: '',
      supplier_invoice_date: '',
      notes: row.notes ? `From PO ${row.po_number} — ${row.notes}` : `From PO ${row.po_number}`,
      terms_conditions: row.terms_conditions || '',
      items: items.rows.map((i: any) => ({
        product_id: i.product_id,
        description: i.product_name || '',
        qty: parseFloat(i.entered_qty ?? i.quantity),
        uom: (i.uom_code || i.unit_of_measure || 'pc').toUpperCase(),
        uom_id: i.uom_id || null,
        conversion_to_base: parseFloat(i.conversion_to_base) || 1,
        unit_cost: parseFloat(i.net_unit_cost || i.unit_cost || 0),
        discount_amount: parseFloat(i.discount_amount || 0),
        tax_type: i.tax_type || 'VAT',
      })),
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Prefill payload for copying GR to APV (no DB write)
router.get('/copy-from-gr/:grId', authenticate, hasUserPerm('purchases.apv.create'), async (req: AuthRequest, res: Response) => {
  try {
    const gr = await query(
      `SELECT gr.*, s.supplier_name, po.po_number, po.vat_mode
       FROM goods_receipts gr
       LEFT JOIN suppliers s ON gr.supplier_id = s.id
       LEFT JOIN purchase_orders po ON gr.po_id = po.id
       WHERE gr.id = $1`,
      [req.params.grId]
    );
    if (gr.rows.length === 0) return res.status(404).json({ error: 'Goods receipt not found' });
    const row = gr.rows[0];
    if (row.status !== 'Completed') {
      return res.status(400).json({ error: 'Only completed goods receipts can be copied to APV' });
    }

    const existing = await query(
      `SELECT apv_number, status FROM ap_vouchers WHERE gr_id = $1 AND status IN ('Draft','Posted','Partially Paid','Fully Paid')`,
      [req.params.grId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `GR already has APV ${existing.rows[0].apv_number} (${existing.rows[0].status})` });
    }

    const items = await query(
      `SELECT gri.*, p.name as product_name, p.sku,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as unit_of_measure,
              COALESCE(u.code, NULLIF(p.unit_of_measure, ''), 'pc') as uom_code,
              COALESCE(poi.tax_type, 'VAT') as tax_type
       FROM goods_receipt_items gri
       LEFT JOIN products p ON gri.product_id = p.id
       LEFT JOIN purchase_order_items poi ON gri.po_item_id = poi.id
       LEFT JOIN uoms u ON gri.uom_id = u.id
       WHERE gri.gr_id = $1 ORDER BY gri.id`,
      [req.params.grId]
    );
    if (items.rows.length === 0) return res.status(400).json({ error: 'No items on goods receipt' });

    res.json({
      source_gr_id: row.id,
      source_gr_number: row.gr_number,
      source_po_number: row.po_number || null,
      vat_mode: row.vat_mode || 'VAT Inclusive',
      supplier_id: row.supplier_id,
      supplier_name: row.supplier_name,
      po_id: row.po_id || '',
      gr_id: row.id,
      payment_terms: '',
      supplier_invoice_number: row.supplier_invoice_number || '',
      supplier_invoice_date: row.received_date || '',
      notes: row.notes ? `From GR ${row.gr_number} — ${row.notes}` : `From GR ${row.gr_number}`,
      terms_conditions: row.terms_conditions || '',
      items: items.rows.map((i: any) => ({
        product_id: i.product_id,
        description: i.product_name || '',
        qty: parseFloat(i.entered_qty ?? i.quantity),
        uom: (i.uom_code || i.unit_of_measure || 'pc').toUpperCase(),
        uom_id: i.uom_id || null,
        conversion_to_base: parseFloat(i.conversion_to_base) || 1,
        unit_cost: parseFloat(i.net_unit_cost || i.unit_cost || 0),
        discount_amount: parseFloat(i.discount_amount || 0),
        gr_id: row.id,
        tax_type: i.tax_type || 'VAT',
      })),
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// AP aging / outstanding payables dashboard
router.get('/ap-aging', authenticate, payablesView, async (req: AuthRequest, res: Response) => {
  try {
    res.json(await getApAgingReport());
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get posted APVs for pay-supplier allocation
router.get('/apv-outstanding/:supplierId', authenticate, payablesView, async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.supplierId, 10);
    await prepareSupplierForPayment(supplierId);
    const r = await query(
      `SELECT a.id, a.apv_number, a.apv_date, a.due_date, a.total_amount, a.amount_paid, (a.total_amount - a.amount_paid) as balance_due, a.status
       FROM ap_vouchers a WHERE a.supplier_id = $1 AND a.status IN ('Posted','Partially Paid') AND a.total_amount > a.amount_paid ORDER BY a.apv_date ASC`,
      [supplierId]
    );
    res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get supplier unpaid purchase orders (invoices)
router.get('/invoices/:supplierId', authenticate, payablesView, async (req: AuthRequest, res: Response) => {
  try {
    const { supplierId } = req.params;
    const result = await query(
      `SELECT po.id, po.po_number as invoice_number, po.order_date as invoice_date,
              po.expected_date as due_date, po.total as original_amount,
              COALESCE((SELECT SUM(pv.amount) FROM payment_vouchers pv WHERE pv.po_id = po.id AND pv.status = 'Posted'), 0) as amount_paid,
              po.total - COALESCE((SELECT SUM(pv.amount) FROM payment_vouchers pv WHERE pv.po_id = po.id AND pv.status = 'Posted'), 0) as balance_due,
              po.status, po.payment_terms, s.supplier_name, s.supplier_code,
              s.balance as supplier_balance
       FROM purchase_orders po
       JOIN suppliers s ON po.supplier_id = s.id
        WHERE po.supplier_id = $1
          AND po.status IN ('Sent', 'Partial', 'Received')
          AND po.total > COALESCE((SELECT SUM(pv.amount) FROM payment_vouchers pv WHERE pv.po_id = po.id AND pv.status = 'Posted'), 0)
          AND po.id NOT IN (SELECT apv.po_id FROM ap_vouchers apv WHERE apv.po_id IS NOT NULL AND apv.status IN ('Posted','Partially Paid','Draft','Fully Paid'))
        ORDER BY po.order_date ASC`,
      [supplierId]
    );
    const totalOutstanding = result.rows.reduce((sum: number, r: any) => sum + parseFloat(r.balance_due), 0);
    res.json({ invoices: result.rows, supplier_balance: parseFloat(result.rows[0]?.supplier_balance || 0), total_outstanding: totalOutstanding });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get payment vouchers (paginated)
router.get('/vouchers', authenticate, pvView, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const search = (req.query.search as string || '').trim();
    const params: any[] = [];
    let where = '';
    let pi = 1;
    if (search) {
      where = `WHERE (pv.voucher_number ILIKE $${pi} OR s.supplier_name ILIKE $${pi} OR po.po_number ILIKE $${pi} OR a.apv_number ILIKE $${pi})`;
      params.push(`%${search}%`);
      pi++;
    }
    const total = await query(`SELECT COUNT(*) FROM payment_vouchers pv
      LEFT JOIN suppliers s ON pv.supplier_id = s.id
      LEFT JOIN purchase_orders po ON pv.po_id = po.id
      LEFT JOIN ap_vouchers a ON pv.apv_id = a.id ${where}`, params);
    const result = await query(
      `SELECT pv.*, s.supplier_name, s.supplier_code, u.full_name as created_by_name,
              po.po_number, a.apv_number
       FROM payment_vouchers pv
       LEFT JOIN suppliers s ON pv.supplier_id = s.id
       LEFT JOIN users u ON pv.created_by = u.id
       LEFT JOIN purchase_orders po ON pv.po_id = po.id
       LEFT JOIN ap_vouchers a ON pv.apv_id = a.id
       ${where}
       ORDER BY pv.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    );
    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Print payment voucher
router.get('/vouchers/:id/print', authenticate, hasUserPerm('purchases.payment-voucher.print'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT pv.*, s.supplier_name, s.supplier_code, s.tin as supplier_tin, s.address as supplier_address,
              po.po_number, a.apv_number, u.full_name as created_by_name,
              ba.bank_name, ba.account_name, ba.account_number as bank_account_number
       FROM payment_vouchers pv
       LEFT JOIN suppliers s ON pv.supplier_id = s.id
       LEFT JOIN purchase_orders po ON pv.po_id = po.id
       LEFT JOIN ap_vouchers a ON pv.apv_id = a.id
       LEFT JOIN users u ON pv.created_by = u.id
       LEFT JOIN bank_accounts ba ON pv.bank_account_id = ba.id
       WHERE pv.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const amount = parseFloat(d.amount) || 0;
    const refNum = d.reference_number || '';
    const refLabel = d.payment_method === 'Check' ? 'Check No.' : 'Reference #';

    const acctRows = [
      tableRow([
        { html: '2000' },
        { html: 'Accounts Payable' },
        { html: `Payment to ${d.supplier_name || 'Supplier'}` },
        { html: fmtCurrency(amount), align: 'r' },
        { html: '', align: 'r' },
      ]),
      tableRow([
        { html: d.payment_method === 'Cash' ? '1000' : '1010' },
        { html: d.payment_method === 'Cash' ? 'Cash on Hand' : 'Cash in Bank' },
        { html: d.payment_method === 'Check' ? `Check #${refNum || '—'}` : `${d.payment_method} Payment` },
        { html: '', align: 'r' },
        { html: fmtCurrency(amount), align: 'r' },
      ]),
    ].join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `PV ${d.voucher_number}`,
      docTitle: 'Payment Voucher',
      docMetaRows: [
        { label: 'Voucher No.', value: d.voucher_number || '—' },
        { label: 'Payment Date', value: fmtDate(d.payment_date, 'short') },
        { label: 'Payment Method', value: d.payment_method || '—' },
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Payee Information',
      customerRows: buildSupplierMetaRows({
        name: d.supplier_name,
        code: d.supplier_code,
        address: d.supplier_address,
        tin: d.supplier_tin,
      }),
      detailsTitle: 'Payment Details',
      detailsRows: [
        { label: refLabel, value: refNum || '—' },
        ...(d.payment_method === 'Check' ? [
          { label: 'Check Date', value: fmtDate(d.check_date, 'short') },
          { label: 'Check Bank', value: d.check_bank || '—' },
        ] : []),
        { label: 'Bank Account', value: d.bank_name ? `${d.bank_name} - ${d.account_name}` : '—' },
        ...(d.apv_number ? [{ label: 'APV Reference', value: d.apv_number }] : []),
        ...(d.po_number ? [{ label: 'PO Reference', value: d.po_number }] : []),
        { label: 'Prepared By', value: d.created_by_name || '—' },
      ],
      itemHeaders: [
        { text: 'Account Code', align: 'left', width: '72px' },
        { text: 'Account Name', align: 'left' },
        { text: 'Description', align: 'left' },
        { text: 'Debit', align: 'right', width: '80px' },
        { text: 'Credit', align: 'right', width: '80px' },
      ],
      itemRows: acctRows,
      beforeItemsHtml: renderEnterpriseSectionTitle('Accounting Entry'),
      summaryRows: [{ label: 'TOTAL PAYMENT', value: fmtCurrency(amount), total: true }],
      amountInWords: amount,
      notes: d.notes ? [{ label: 'Remarks', content: d.notes }] : [],
      footerNote: 'System-generated payment voucher.',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseSignatures(b),
    });
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// Create payment voucher(s) — pay supplier (APV allocations only in UI; PO legacy still supported via API)
router.post('/vouchers', authenticate, hasUserPerm('purchases.payment-voucher.create'), auditLog('Payables', 'Create Voucher'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { supplier_id, payment_method, reference_number, notes, terms_conditions, bank_account_id, allocations, payment_date, check_date, check_bank } = req.body;
    const payDate = payment_date || new Date().toISOString().split('T')[0];

    if (!supplier_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Supplier is required' });
    }
    if (!payment_method) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payment method is required' });
    }

    const isBankPayment = payment_method === 'Check' || payment_method === 'Bank Transfer';
    const creditAccount = isBankPayment ? '1010' : '1000';

    let paymentAllocations: { po_id?: string; apv_id?: string; amount: number }[] = [];

    if (allocations && Array.isArray(allocations) && allocations.length > 0) {
      paymentAllocations = allocations.map((a: any) => ({
        po_id: a.po_id ? String(a.po_id) : undefined,
        apv_id: a.apv_id ? String(a.apv_id) : undefined,
        amount: parseFloat(a.amount || '0'),
      }));
    } else if (req.body.po_id) {
      paymentAllocations = [{ po_id: String(req.body.po_id), amount: parseFloat(req.body.amount || '0') }];
    } else if (req.body.apv_id) {
      paymentAllocations = [{ apv_id: String(req.body.apv_id), amount: parseFloat(req.body.amount || '0') }];
    } else {
      const totalAmount = parseFloat(req.body.amount || '0');
      if (totalAmount <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Amount must be greater than zero' });
      }

      const voucher_number = await generateRefNumber();
      const id = uuidv4();

      await client.query(
        `INSERT INTO payment_vouchers (id, voucher_number, supplier_id, payment_date, payment_method, reference_number, amount, status, notes, terms_conditions, bank_account_id, check_date, check_bank, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Posted', $8, $9, $10, $11, $12, $13)`,
        [id, voucher_number, supplier_id, payDate, payment_method, reference_number, totalAmount, notes, terms_conditions || null, bank_account_id || null, check_date || null, check_bank || null, req.user!.id]
      );

      await createAccounting(id, voucher_number, supplier_id, totalAmount, creditAccount, isBankPayment, bank_account_id, req.user!.id, client, payDate);
      await syncSupplierBalanceFromApv(supplier_id, client);

      await client.query('COMMIT');
      return res.status(201).json({ id, voucher_number, total_amount: totalAmount });
    }

    let totalAmount = 0;
    const supplier = await client.query('SELECT * FROM suppliers WHERE id = $1', [supplier_id]);
    if (supplier.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Supplier not found' });
    }

    for (const alloc of paymentAllocations) {
      if (alloc.amount <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Payment amount must be greater than zero' });
      }

      if (alloc.apv_id) {
        const apv = await client.query('SELECT * FROM ap_vouchers WHERE id = $1 AND supplier_id = $2', [alloc.apv_id, supplier_id]);
        if (apv.rows.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: `APV not found for this supplier` });
        }
        const apvRemaining = parseFloat(apv.rows[0].total_amount) - parseFloat(apv.rows[0].amount_paid || 0);
        if (alloc.amount > apvRemaining + 0.01) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Amount exceeds APV remaining balance ₱${apvRemaining.toFixed(2)}` });
        }
        totalAmount += alloc.amount;
        continue;
      }

      if (!alloc.po_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Pay through a posted APV. Direct PO payment is disabled in the standard workflow.' });
      }

      const po = await client.query('SELECT * FROM purchase_orders WHERE id = $1 AND supplier_id = $2', [alloc.po_id, supplier_id]);
      if (po.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `PO not found for this supplier` });
      }

      const poTotal = parseFloat(po.rows[0].total);
      const paidResult = await client.query(
        "SELECT COALESCE(SUM(amount), 0) as total_paid FROM payment_vouchers WHERE po_id = $1 AND status = 'Posted'",
        [alloc.po_id]
      );
      const remaining = poTotal - parseFloat(paidResult.rows[0].total_paid);
      if (alloc.amount > remaining + 0.01) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Amount exceeds PO remaining balance ₱${remaining.toFixed(2)}` });
      }
      totalAmount += alloc.amount;
    }

    const voucherIds: string[] = [];
    for (const alloc of paymentAllocations) {
      const voucher_number = await generateRefNumber();
      const id = uuidv4();
      voucherIds.push(id);

      await client.query(
        `INSERT INTO payment_vouchers (id, voucher_number, supplier_id, po_id, apv_id, payment_date, payment_method, reference_number, amount, status, notes, terms_conditions, bank_account_id, check_date, check_bank, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Posted', $10, $11, $12, $13, $14, $15)`,
        [id, voucher_number, supplier_id, alloc.po_id || null, alloc.apv_id || null, payDate, payment_method, reference_number, alloc.amount, notes, terms_conditions || null, bank_account_id || null, check_date || null, check_bank || null, req.user!.id]
      );

      if (alloc.apv_id) {
        const apv = await client.query('SELECT * FROM ap_vouchers WHERE id = $1', [alloc.apv_id]);
        const newPaid = parseFloat(apv.rows[0].amount_paid || 0) + alloc.amount;
        const newStatus = newPaid >= parseFloat(apv.rows[0].total_amount) - 0.01 ? 'Fully Paid' : 'Partially Paid';
        await client.query(
          'UPDATE ap_vouchers SET amount_paid = $1, balance = total_amount - $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
          [newPaid, newStatus, alloc.apv_id]
        );
        continue;
      }

      const po = await client.query('SELECT * FROM purchase_orders WHERE id = $1', [alloc.po_id]);
      const poTotal = parseFloat(po.rows[0].total);
      const paidResult = await client.query(
        "SELECT COALESCE(SUM(amount), 0) as total_paid FROM payment_vouchers WHERE po_id = $1 AND status = 'Posted'",
        [alloc.po_id]
      );
      const totalPaid = parseFloat(paidResult.rows[0].total_paid);
      if (totalPaid >= poTotal - 0.01) {
        await client.query("UPDATE purchase_orders SET status = 'Paid', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [alloc.po_id]);
      } else {
        await client.query("UPDATE purchase_orders SET status = 'Partial', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [alloc.po_id]);
      }
    }

    await createAccounting(voucherIds[0], `Bulk-${voucherIds.length}-Payments`, supplier_id, totalAmount, creditAccount, isBankPayment, bank_account_id, req.user!.id, client, payDate);
    await syncSupplierBalanceFromApv(supplier_id, client);

    await client.query('COMMIT');
    res.status(201).json({
      voucher_ids: voucherIds,
      total_amount: totalAmount,
      message: `${voucherIds.length} payment voucher(s) created`,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

async function createAccounting(
  refId: string, refLabel: string, supplierId: number, amount: number,
  creditAccount: string, isBank: boolean, bankAccountId: string | undefined,
  createdBy: string,
  db: { query: typeof query } = { query },
  entryDate?: string,
) {
  const txnDate = entryDate || new Date().toISOString().split('T')[0];
  const entryId = uuidv4();
  const entryNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);

  await db.query(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1, $2, $3, 'Payment Voucher', $4, $5, $6, $6, $7)`,
    [entryId, entryNumber, txnDate, refId, `Payment to supplier ${supplierId}`, amount, createdBy]
  );

  await db.query(
    `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
     VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), $3, $4, 0, 'Payment Voucher', $5),
            ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $7), $8, 0, $4, 'Payment Voucher', $5)`,
    [uuidv4(), entryId, `AP Payment ${refLabel}`, amount, refId,
     uuidv4(), creditAccount, `AP Payment ${refLabel}`]
  );

  if (isBank && bankAccountId) {
    await db.query(
      `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by)
       VALUES ($1, $2, 'Withdrawal', $3, $4, 'Payment Voucher', $5, $6, $7)`,
      [uuidv4(), bankAccountId, amount, txnDate, refId, `Payment ${refLabel}`, createdBy]
    );
    await db.query(`UPDATE bank_accounts SET balance = balance - $1 WHERE id = $2`, [amount, bankAccountId]);
  } else {
    await db.query(
      `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
       VALUES ($1, $2, 'Disbursement', $3, 'Payment Voucher', $4, $5, $6)`,
      [uuidv4(), await getNextCode('cash_transactions', 'transaction_number', 'CT-', 4), amount, refId, `Payment ${refLabel}`, createdBy]
    );
  }
}

async function createApvJournalEntry(client: any, apv: any, createdBy: string) {
  const total = parseFloat(apv.total_amount) || 0;
  const vat = parseFloat(apv.vat_amount) || 0;
  const inventoryDebit = purchaseInventoryDebitAmount(total, vat);
  if (total <= 0) return;

  const entryId = uuidv4();
  const entryNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);

  const entryDate = apv.apv_date || new Date().toISOString().split('T')[0];
  await client.query(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1, $2, $3, 'AP Voucher', $4, $5, $6, $6, $7)`,
    [entryId, entryNumber, entryDate, apv.id, `APV ${apv.apv_number}`, total, createdBy]
  );

  if (inventoryDebit > 0) {
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1200'), $3, $4, 0, 'AP Voucher', $5)`,
      [uuidv4(), entryId, `Purchases ${apv.apv_number}`, inventoryDebit, apv.id]
    );
  }
  if (vat > 0) {
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1106'), $3, $4, 0, 'AP Voucher', $5)`,
      [uuidv4(), entryId, `Input VAT ${apv.apv_number}`, vat, apv.id]
    );
  }
  await client.query(
    `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
     VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), $3, 0, $4, 'AP Voucher', $5)`,
    [uuidv4(), entryId, `AP ${apv.apv_number}`, total, apv.id]
  );
}

// ==================== ACCOUNTS PAYABLE VOUCHERS (APV) ====================
const generateAPVNumber = async (): Promise<string> => {
  const yr = new Date().getFullYear();
  const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(apv_number, 11) AS INTEGER)), 0) + 1 as next FROM ap_vouchers WHERE apv_number LIKE $1", ['APV-' + yr + '-%']);
  return 'APV-' + yr + '-' + String(r.rows[0]?.next || 1).padStart(6, '0');
};

router.post('/apv', authenticate, hasUserPerm('purchases.apv.create'), auditLog('Payables', 'Create APV'), async (req: AuthRequest, res: Response) => {
  try {
    const apv_number = await generateAPVNumber();
    const { supplier_id, po_id, gr_id, apv_date, due_date, payment_terms, supplier_invoice_number, supplier_invoice_date, notes, terms_conditions, items, vat_mode } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item required' });

    // Prevent duplicate APV for the same PO
    if (po_id) {
      const existing = await query(
        `SELECT apv_number, status FROM ap_vouchers WHERE po_id = $1 AND status IN ('Draft','Posted','Partially Paid','Fully Paid')`,
        [po_id]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: `PO already has an APV: ${existing.rows[0].apv_number} (${existing.rows[0].status})` });
      }
    }

    // Prevent duplicate APV for the same GR
    if (gr_id) {
      const existing = await query(
        `SELECT apv_number, status FROM ap_vouchers WHERE gr_id = $1 AND status IN ('Draft','Posted','Partially Paid','Fully Paid')`,
        [gr_id]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: `GR already has an APV: ${existing.rows[0].apv_number} (${existing.rows[0].status})` });
      }
    }

    const mode = await resolveApvVatMode(po_id, gr_id, vat_mode);
    const totals = calculatePurchaseTax(items, mode);
    const { gross, discount, vatable, vat, total } = totals;
    const id = uuidv4();

    await query(
      'INSERT INTO ap_vouchers (id, apv_number, supplier_id, po_id, gr_id, apv_date, due_date, payment_terms, supplier_invoice_number, supplier_invoice_date, status, notes, terms_conditions, gross_amount, discount_amount, vatable_amount, vat_amount, total_amount, balance, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'Draft\',$11,$12,$13,$14,$15,$16,$17,$18,$19)',
      [id, apv_number, supplier_id || null, po_id || null, gr_id || null, apv_date, due_date || null, payment_terms || null, supplier_invoice_number || null, supplier_invoice_date || null, notes || null, terms_conditions || null, gross, discount, vatable, vat, total, total, req.user!.id]
    );

    for (const it of items) {
      const line = calculatePurchaseLine({
        qty: it.qty || 1,
        unit_cost: it.unit_cost || 0,
        discount_amount: it.discount_amount || 0,
        tax_type: it.tax_type || 'VAT',
      }, mode);
      await query(
        'INSERT INTO ap_voucher_items (id, apv_id, product_id, gr_id, description, qty, uom, unit_cost, discount_amount, net_amount, vat_amount, tax_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [uuidv4(), id, it.product_id || null, it.gr_id || null, it.description || null, it.qty || 1, it.uom || 'pcs', it.unit_cost || 0, it.discount_amount || 0, line.net, line.vat_amount, it.tax_type || 'VAT']
      );
    }

    res.status(201).json({ id, apv_number });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/apv', authenticate, apvView, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = (req.query.search as string || '').trim();
    const params: any[] = [];
    const clauses: string[] = [];
    let i = 1;
    if (status) { clauses.push(`a.status = $${i++}`); params.push(status); }
    if (search) {
      clauses.push(`(a.apv_number ILIKE $${i} OR s.supplier_name ILIKE $${i} OR s.supplier_code ILIKE $${i})`);
      params.push(`%${search}%`);
      i++;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const cnt = await query(`SELECT COUNT(*) FROM ap_vouchers a LEFT JOIN suppliers s ON a.supplier_id = s.id ${where}`, params);
    const t = parseInt(cnt.rows[0].count);
    const r = await query(
      `SELECT a.*, s.supplier_name, s.supplier_code, po.po_number, gr.gr_number
       FROM ap_vouchers a
       LEFT JOIN suppliers s ON a.supplier_id = s.id
       LEFT JOIN purchase_orders po ON a.po_id = po.id
       LEFT JOIN goods_receipts gr ON a.gr_id = gr.id
       ${where} ORDER BY a.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );
    res.json({ data: r.rows, total: t, page, limit });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/apv/:id', authenticate, apvView, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT a.*, s.supplier_name, s.supplier_code, s.tin as supplier_tin, s.address as supplier_address, s.contact_person, s.phone,
              po.po_number, po.vat_mode as po_vat_mode, gr.gr_number
       FROM ap_vouchers a
       LEFT JOIN suppliers s ON a.supplier_id = s.id
       LEFT JOIN purchase_orders po ON a.po_id = po.id
       LEFT JOIN goods_receipts gr ON a.gr_id = gr.id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const items = await query(
      `SELECT avi.*, p.name as product_name, p.sku,
              COALESCE(NULLIF(avi.uom, ''), COALESCE(NULLIF(p.unit_of_measure, ''), 'pc')) as uom
       FROM ap_voucher_items avi LEFT JOIN products p ON avi.product_id = p.id WHERE avi.apv_id = $1`,
      [req.params.id]
    );
    res.json({ ...r.rows[0], items: items.rows });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.patch('/apv/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const ex = await query('SELECT * FROM ap_vouchers WHERE id = $1', [req.params.id]);
    if (ex.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (ex.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft APVs can be edited' });
    const { apv_date, due_date, payment_terms, supplier_invoice_number, supplier_invoice_date, notes, terms_conditions, items, supplier_id, po_id, gr_id, vat_mode } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item required' });
    const mode = await resolveApvVatMode(po_id, gr_id, vat_mode);
    const totals = calculatePurchaseTax(items, mode);
    const { gross, discount, vatable, vat, total } = totals;
    await query('UPDATE ap_vouchers SET supplier_id=$1, po_id=$2, gr_id=$3, apv_date=$4, due_date=$5, payment_terms=$6, supplier_invoice_number=$7, supplier_invoice_date=$8, notes=$9, terms_conditions=$10, gross_amount=$11, discount_amount=$12, vatable_amount=$13, vat_amount=$14, total_amount=$15, balance=$16, updated_at=CURRENT_TIMESTAMP WHERE id=$17',
      [supplier_id || null, po_id || null, gr_id || null, apv_date, due_date || null, payment_terms || null, supplier_invoice_number || null, supplier_invoice_date || null, notes || null, terms_conditions || null, gross, discount, vatable, vat, total, total, req.params.id]);
    await query('DELETE FROM ap_voucher_items WHERE apv_id = $1', [req.params.id]);
    for (const it of items) {
      const line = calculatePurchaseLine({
        qty: it.qty || 1,
        unit_cost: it.unit_cost || 0,
        discount_amount: it.discount_amount || 0,
        tax_type: it.tax_type || 'VAT',
      }, mode);
      await query('INSERT INTO ap_voucher_items (id, apv_id, product_id, gr_id, description, qty, uom, unit_cost, discount_amount, net_amount, vat_amount, tax_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [uuidv4(), req.params.id, it.product_id || null, it.gr_id || null, it.description || null, it.qty || 1, it.uom || 'pcs', it.unit_cost || 0, it.discount_amount || 0, line.net, line.vat_amount, it.tax_type || 'VAT']);
    }
    res.json({ id: req.params.id });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/apv/:id/post', authenticate, hasUserPerm('purchases.apv.approve'), auditLog('Payables', 'Post APV'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM ap_vouchers WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    if (r.rows[0].status !== 'Draft') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Only draft APVs can be posted' }); }
    if (r.rows[0].po_id) {
      const poCheck = await client.query('SELECT status FROM purchase_orders WHERE id = $1', [r.rows[0].po_id]);
      if (poCheck.rows.length > 0 && poCheck.rows[0].status === 'Paid') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot post APV — linked PO is already paid. Payment should be allocated to this APV instead.' });
      }
    }
    const a = r.rows[0]; const jeTotal = parseFloat(a.total_amount);
    await assertApprovalLimit(req, jeTotal, 'AP voucher');
    if (a.supplier_id) await client.query('UPDATE suppliers SET balance = balance + $1 WHERE id = $2', [jeTotal, a.supplier_id]);
    if (!a.gr_id) {
      await createApvJournalEntry(client, a, req.user!.id);
    }
    await client.query('UPDATE ap_vouchers SET status=$1, posted_by=$2, posted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$3', ['Posted', req.user!.id, req.params.id]);
    await client.query('COMMIT'); res.json({ id: req.params.id, status: 'Posted' });
  } catch (error: any) { await client.query('ROLLBACK'); if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message }); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

router.delete('/apv/:id', authenticate, hasUserPerm('purchases.apv.delete'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM ap_vouchers WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (r.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft APVs can be deleted' });
    await query('DELETE FROM ap_vouchers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/apv/:id/print', authenticate, hasUserPerm('purchases.apv.print'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT a.*, s.supplier_name, s.supplier_code, s.tin as supplier_tin, s.address as supplier_address, s.contact_person, s.phone,
              po.po_number, gr.gr_number
       FROM ap_vouchers a
       LEFT JOIN suppliers s ON a.supplier_id = s.id
       LEFT JOIN purchase_orders po ON a.po_id = po.id
       LEFT JOIN goods_receipts gr ON a.gr_id = gr.id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];
    const items = await query(
      `SELECT avi.*, p.name as product_name, p.sku,
              COALESCE(NULLIF(avi.uom, ''), COALESCE(NULLIF(p.unit_of_measure, ''), 'pc')) as uom
       FROM ap_voucher_items avi LEFT JOIN products p ON avi.product_id = p.id WHERE avi.apv_id = $1`,
      [req.params.id]
    );
    const itemRows = items.rows.map((row: any) => tableRow([
      { html: row.product_name || row.description || '—' },
      { html: row.gr_id ? 'RR' : '—', align: 'c' },
      { html: String(parseFloat(row.qty)), align: 'c' },
      { html: row.uom || 'pc', align: 'c' },
      { html: fmtCurrency(row.unit_cost), align: 'r' },
      { html: fmtCurrency(row.net_amount), align: 'r' },
    ])).join('');
    const gross = parseFloat(d.gross_amount) || 0;
    const disc = parseFloat(d.discount_amount) || 0;
    const vatable = parseFloat(d.vatable_amount) || 0;
    const vat = parseFloat(d.vat_amount) || 0;
    const total = parseFloat(d.total_amount) || 0;
    const inventoryDebit = purchaseInventoryDebitAmount(total, vat);
    const vatExemptPurchases = inventoryDebit > 0 && vatable <= 0 && vat <= 0 ? inventoryDebit : 0;

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    const summaryRows = [
      { label: 'Gross Purchases', value: fmtCurrency(gross) },
      ...(disc > 0 ? [{ label: 'Less Discount', value: fmtCurrency(disc) }] : []),
      ...(vatable > 0 ? [{ label: 'VATable Purchases', value: fmtCurrency(vatable) }] : []),
      ...(vatExemptPurchases > 0 ? [{ label: 'VAT Exempt Purchases', value: fmtCurrency(vatExemptPurchases) }] : []),
      ...(vat > 0 ? [{ label: 'Input VAT (12%)', value: fmtCurrency(vat) }] : []),
      { label: 'TOTAL PAYABLE', value: fmtCurrency(total), total: true },
    ];

    const grPostedNote = d.gr_id
      ? renderEnterpriseNotesBlock(
        'Goods Receipt Link',
        'Inventory and input VAT were recognized when the linked Goods Receipt was posted. APV posting records the supplier payable (no duplicate inventory entry).',
      )
      : '';

    const acctRows = [
      tableRow([
        { html: 'Inventory Asset (1200)' },
        { html: fmtCurrency(inventoryDebit), align: 'r' },
        { html: '', align: 'r' },
      ]),
      ...(vat > 0 ? [tableRow([
        { html: 'Input VAT Receivable (1106)' },
        { html: fmtCurrency(vat), align: 'r' },
        { html: '', align: 'r' },
      ])] : []),
      tableRow([
        { html: 'Accounts Payable (2000)' },
        { html: '', align: 'r' },
        { html: fmtCurrency(total), align: 'r' },
      ]),
      tableRow([
        { html: '<strong>Totals</strong>' },
        { html: fmtCurrency(total), align: 'r' },
        { html: fmtCurrency(total), align: 'r' },
      ]),
    ].join('');

    const afterSummaryHtml = [
      grPostedNote,
      renderEnterpriseSectionTitle('Accounting Distribution'),
      renderEnterpriseItemsTable([
        { text: 'Account Title', align: 'left' },
        { text: 'Debit', align: 'right', width: '100px' },
        { text: 'Credit', align: 'right', width: '100px' },
      ], acctRows),
    ].join('');

    const html = buildSalesEnterpriseDocument({
      pageTitle: `APV ${d.apv_number}`,
      docTitle: 'Accounts Payable Voucher',
      docMetaRows: [
        { label: 'Document No.', value: d.apv_number || '—' },
        { label: 'APV Date', value: fmtDate(d.apv_date, 'short') },
        ...(d.due_date ? [{ label: 'Due Date', value: fmtDate(d.due_date, 'short') }] : []),
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Supplier Information',
      customerRows: buildSupplierMetaRows({
        name: d.supplier_name,
        address: d.supplier_address,
        tin: d.supplier_tin,
        contact: d.contact_person,
        phone: d.phone,
      }),
      detailsTitle: 'APV Details',
      detailsRows: [
        ...(d.payment_terms ? [{ label: 'Payment Terms', value: d.payment_terms }] : []),
        ...(d.po_number ? [{ label: 'PO Reference', value: d.po_number }] : []),
        ...(d.gr_number ? [{ label: 'RR Reference', value: d.gr_number }] : []),
        ...(d.supplier_invoice_number ? [{
          label: 'Supplier Invoice',
          value: `${d.supplier_invoice_number}${d.supplier_invoice_date ? ` (${fmtDate(d.supplier_invoice_date, 'short')})` : ''}`,
        }] : []),
      ],
      itemHeaders: [
        { text: 'Description', align: 'left' },
        { text: 'Ref', align: 'center', width: '44px' },
        { text: 'Qty', align: 'center', width: '44px' },
        { text: 'UOM', align: 'center', width: '40px' },
        { text: 'Unit Cost', align: 'right', width: '76px' },
        { text: 'Amount', align: 'right', width: '80px' },
      ],
      itemRows,
      summaryRows,
      amountInWords: total,
      afterSummaryHtml,
      notes: [
        ...(d.notes ? [{ label: 'Remarks', content: d.notes }] : []),
        ...(d.terms_conditions ? [{ label: 'Terms & Conditions', content: d.terms_conditions }] : []),
      ],
      footerNote: 'System-generated accounts payable voucher.',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseSignatures(b),
      signatureCols: 3,
    });
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
