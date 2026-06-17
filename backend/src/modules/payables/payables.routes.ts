import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

const router = Router();

const generateRefNumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number, 4) AS INTEGER)), 0) + 1 as next FROM payment_vouchers WHERE voucher_number ~ '^PV-'");
  return `PV-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const getNextCode = async (table: string, field: string, prefix: string, startPos: number) => {
  const r = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${field} FROM ${startPos}) AS INTEGER)), 0) + 1 as next FROM ${table} WHERE ${field} ~ '^${prefix}'`
  );
  return `${prefix}${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

// Get goods receipts for supplier (for APV auto-population)
router.get('/goods-receipts/:supplierId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT gr.*, po.po_number FROM goods_receipts gr LEFT JOIN purchase_orders po ON gr.po_id = po.id WHERE gr.supplier_id = $1 AND gr.status = 'Completed' ORDER BY gr.received_date DESC LIMIT 20`,
      [req.params.supplierId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get POs for a supplier (for APV auto-populate)
router.get('/supplier-pos/:supplierId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT po.id, po.po_number, po.order_date, po.total, po.status FROM purchase_orders po WHERE po.supplier_id = $1 AND po.status IN ('Sent','Partial','Received') ORDER BY po.order_date DESC LIMIT 30`,
      [req.params.supplierId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get PO items for APV population
router.get('/po-items/:poId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT poi.*, p.name as product_name, p.sku, p.unit_of_measure FROM purchase_order_items poi JOIN products p ON poi.product_id = p.id WHERE poi.po_id = $1`,
      [req.params.poId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get GR items for APV population
router.get('/gr-items/:grId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT gri.*, p.name as product_name, p.sku, p.unit_of_measure FROM goods_receipt_items gri LEFT JOIN products p ON gri.product_id = p.id WHERE gri.gr_id = $1`,
      [req.params.grId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get posted APVs for pay-supplier allocation
router.get('/apv-outstanding/:supplierId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT a.id, a.apv_number, a.apv_date, a.due_date, a.total_amount, a.amount_paid, (a.total_amount - a.amount_paid) as balance_due, a.status
       FROM ap_vouchers a WHERE a.supplier_id = $1 AND a.status IN ('Posted','Partially Paid') AND a.total_amount > a.amount_paid ORDER BY a.apv_date ASC`,
      [req.params.supplierId]
    ); res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Get supplier unpaid purchase orders (invoices)
router.get('/invoices/:supplierId', authenticate, async (req: AuthRequest, res: Response) => {
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

// Get payment vouchers
router.get('/vouchers', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT pv.*, s.supplier_name, s.supplier_code, u.full_name as created_by_name,
              po.po_number
       FROM payment_vouchers pv
       LEFT JOIN suppliers s ON pv.supplier_id = s.id
       LEFT JOIN users u ON pv.created_by = u.id
       LEFT JOIN purchase_orders po ON pv.po_id = po.id
       ORDER BY pv.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Print payment voucher
router.get('/vouchers/:id/print', async (req: AuthRequest, res: Response) => {
  try {
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try { jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Invalid token' }); }

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
    const bizName = b.business_name || 'D METRAN TRADING';
    const bizTag = b.trade_name || 'General Merchandise & Integrated Trade Distribution';
    const bizAddr = (b.address || '') + (b.city ? ', ' + b.city : '');
    const bizTin = b.tin_number || '123-456-789-000';

    const docRef = d.apv_number ? ('APV: ' + d.apv_number) : (d.po_number ? ('PO: ' + d.po_number) : 'Direct Payment');
    const amount = parseFloat(d.amount) || 0;
    const checkNum = d.reference_number && (d.payment_method === 'Check') ? d.reference_number : '';
    const refNum = d.reference_number || '';

    const styles = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Courier New",monospace;font-size:10px;color:#111;padding:8mm 10mm;max-width:210mm;margin:0 auto;letter-spacing:.2px}
.company-header{text-align:center;margin-bottom:8px}
.company-header h1{font-size:18px;font-weight:bold;letter-spacing:4px;margin:0}
.company-header .tagline{font-size:9px;color:#111;margin:3px 0}
.dot-divider{text-align:center;font-size:11px;font-weight:bold;margin:4px 0;letter-spacing:1px}
.dot-divider-thin{text-align:center;font-size:10px;color:#444;margin:2px 0}
.doc-title{text-align:center;border:1px dotted #444;padding:6px 0;margin:8px 0}
.doc-title h2{font-size:14px;font-weight:bold;letter-spacing:6px;margin:0}
.details{display:flex;gap:20px;margin:10px 0}
.details-left{flex:1;border:1px dotted #444;padding:8px 10px}
.details-right{flex:1;border:1px dotted #444;padding:8px 10px}
.details-label{font-size:9px;font-weight:bold;text-transform:uppercase;margin-bottom:5px}
.details p{font-size:9px;margin:2px 0}
.items-table{width:100%;border-collapse:collapse;margin:10px 0}
.items-table th{background:#f8f8f8;border:1px dotted #444;padding:5px 6px;font-size:9px;text-align:left;font-weight:bold}
.items-table td{border:1px dotted #444;padding:4px 6px;font-size:9px}
.items-table td.right{text-align:right}
.computation{display:flex;justify-content:flex-end;margin:10px 0}
.comp-table{width:260px;border-collapse:collapse}
.comp-table td{padding:3px 8px;font-size:9px}
.comp-table td:last-child{text-align:right}
.comp-table .total-row{border-top:2px dotted #000;font-size:12px;font-weight:bold}
.section-title{font-size:9px;font-weight:bold;text-transform:uppercase;margin:12px 0 4px}
.signatures{display:flex;justify-content:space-between;margin-top:18px;gap:4px}
.sig-block{text-align:center;flex:1}
.sig-block .sig-line{border-bottom:1px dotted #444;height:28px;margin-bottom:4px}
.sig-block .sig-label{font-size:8px;color:#333;font-weight:bold;text-transform:uppercase}
.footer{text-align:center;font-size:8px;color:#555;margin-top:12px;border-top:1px dotted #999;padding-top:6px}
@media print{body{padding:4mm 6mm}}
`;

    const fmtCurrency = (n: number) => '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
    const refLabel = d.payment_method === 'Check' ? 'Check No.' : 'Reference #';
    const checkInfo = d.payment_method === 'Check'
      ? `<p><strong>Check Date:</strong> ${fmtDate(d.check_date)}</p><p><strong>Check Bank:</strong> ${d.check_bank || '—'}</p>`
      : '';

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>PV ${d.voucher_number}</title><style>${styles}</style></head><body>

<div class="company-header">
  <h1>${bizName}</h1>
  <div class="tagline">${bizTag}</div>
  <div class="tagline">${bizAddr}</div>
  <div class="tagline">TIN: ${bizTin}</div>
</div>

<div class="dot-divider">. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .</div>

<div class="doc-title">
  <h2>PAYMENT VOUCHER</h2>
</div>

<div class="details">
  <div class="details-left">
    <div class="details-label">Voucher Details</div>
    <p><strong>Voucher #:</strong> ${d.voucher_number}</p>
    <p><strong>Date:</strong> ${fmtDate(d.payment_date)}</p>
    <p><strong>Status:</strong> ${d.status}</p>
  </div>
  <div class="details-right">
    <div class="details-label">Payee</div>
    <p><strong>Name:</strong> ${d.supplier_name || '—'}</p>
    <p><strong>Code:</strong> ${d.supplier_code || '—'}</p>
    <p><strong>TIN:</strong> ${d.supplier_tin || '—'}</p>
    <p><strong>Address:</strong> ${d.supplier_address || '—'}</p>
  </div>
</div>

<div class="details">
  <div class="details-left">
    <div class="details-label">Payment Information</div>
    <p><strong>Method:</strong> ${d.payment_method || '—'}</p>
    <p><strong>${refLabel}:</strong> ${refNum || '—'}</p>
    ${checkInfo}
    <p><strong>Bank Account:</strong> ${d.bank_name ? d.bank_name + ' - ' + d.account_name : '—'}</p>
    ${d.apv_number ? '<p><strong>APV:</strong> ' + d.apv_number + '</p>' : ''}
    ${d.po_number ? '<p><strong>PO:</strong> ' + d.po_number + '</p>' : ''}
  </div>
  <div class="details-right">
    <div class="details-label">Amount</div>
    <p><strong>Gross Amount:</strong> ${fmtCurrency(amount)}</p>
    <p style="font-size:14px;font-weight:bold;margin-top:6px">${fmtCurrency(amount)}</p>
    <p style="margin-top:10px"><strong>Prepared by:</strong> ${d.created_by_name || 'System'}</p>
  </div>
</div>

<div class="section-title">Accounting Entry</div>
<table class="items-table">
  <thead><tr><th>Account Code</th><th>Account Name</th><th>Description</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead>
  <tbody>
    <tr>
      <td>2000</td>
      <td>Accounts Payable</td>
      <td>Payment to ${d.supplier_name || 'Supplier'}</td>
      <td class="right">${fmtCurrency(amount)}</td>
      <td class="right"></td>
    </tr>
    <tr>
      <td>${d.payment_method === 'Cash' ? '1000' : '1010'}</td>
      <td>${d.payment_method === 'Cash' ? 'Cash on Hand' : 'Cash in Bank'}</td>
      <td>${d.payment_method === 'Check' ? 'Check #' + (refNum || '—') : d.payment_method + ' Payment'}</td>
      <td class="right"></td>
      <td class="right">${fmtCurrency(amount)}</td>
    </tr>
  </tbody>
</table>

${d.notes ? '<div style="border:1px dotted #444;padding:6px 10px;margin:8px 0"><div class="details-label">Remarks</div><p style="font-size:9px">' + d.notes + '</p></div>' : ''}

<div class="signatures">
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Prepared by</div></div>
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Checked by</div></div>
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Approved by</div></div>
  <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Received by</div></div>
</div>

<div class="footer">Printed: ${new Date().toLocaleString('en-PH')} | Payment Voucher | Computer-generated document</div>
</body></html>`;
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// Create payment voucher(s) — pay supplier
router.post('/vouchers', authenticate, auditLog('Payables', 'Create Voucher'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { supplier_id, payment_method, reference_number, notes, bank_account_id, allocations, payment_date, check_date, check_bank } = req.body;
    const payDate = payment_date || new Date().toISOString().split('T')[0];

    if (!supplier_id) return res.status(400).json({ error: 'Supplier is required' });
    if (!payment_method) return res.status(400).json({ error: 'Payment method is required' });

    const isBankPayment = payment_method === 'Check' || payment_method === 'Bank Transfer';
    const creditAccount = isBankPayment ? '1010' : '1000';

    // Support both single po_id/apv_id (backward compat) and allocations array
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
      // No PO specified — pay against supplier balance only
      const totalAmount = parseFloat(req.body.amount || '0');
      if (totalAmount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

      const voucher_number = await generateRefNumber();
      const id = uuidv4();

      await query(
        `INSERT INTO payment_vouchers (id, voucher_number, supplier_id, payment_date, payment_method, reference_number, amount, status, notes, bank_account_id, check_date, check_bank, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Posted', $8, $9, $10, $11, $12)`,
        [id, voucher_number, supplier_id, payDate, payment_method, reference_number, totalAmount, notes, bank_account_id || null, check_date || null, check_bank || null, req.user!.id]
      );

      await query('UPDATE suppliers SET balance = balance - $1 WHERE id = $2', [totalAmount, supplier_id]);

      // Create accounting entries
      await createAccounting(id, voucher_number, supplier_id, totalAmount, creditAccount, isBankPayment, bank_account_id, req.user!.id);

      return res.status(201).json({ id, voucher_number, total_amount: totalAmount });
    }

    // Validate allocations
    let totalAmount = 0;
    const supplier = await query('SELECT * FROM suppliers WHERE id = $1', [supplier_id]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const supplierBalance = parseFloat(supplier.rows[0].balance);

    for (const alloc of paymentAllocations) {
      if (alloc.amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than zero' });

      if (alloc.apv_id) {
        // APV allocation
        const apv = await query('SELECT * FROM ap_vouchers WHERE id = $1 AND supplier_id = $2', [alloc.apv_id, supplier_id]);
        if (apv.rows.length === 0) return res.status(404).json({ error: `APV ${alloc.apv_id} not found for this supplier` });
        const apvTotal = parseFloat(apv.rows[0].total_amount);
        const apvPaid = parseFloat(apv.rows[0].amount_paid);
        const apvRemaining = apvTotal - apvPaid;
        if (alloc.amount > apvRemaining) return res.status(400).json({ error: `Amount exceeds APV remaining balance ₱${apvRemaining.toFixed(2)}` });
        totalAmount += alloc.amount;
        continue;
      }

      // PO allocation
      if (!alloc.po_id) return res.status(400).json({ error: 'po_id or apv_id required per allocation' });
      const po = await query('SELECT * FROM purchase_orders WHERE id = $1 AND supplier_id = $2', [alloc.po_id, supplier_id]);
      if (po.rows.length === 0) return res.status(404).json({ error: `PO ${alloc.po_id} not found for this supplier` });

      const poTotal = parseFloat(po.rows[0].total);
      const paidResult = await query(
        "SELECT COALESCE(SUM(amount), 0) as total_paid FROM payment_vouchers WHERE po_id = $1 AND status = 'Posted'",
        [alloc.po_id]
      );
      const alreadyPaid = parseFloat(paidResult.rows[0].total_paid);
      const remaining = poTotal - alreadyPaid;

      if (alloc.amount > remaining) {
        return res.status(400).json({ error: `Amount ₱${alloc.amount.toFixed(2)} exceeds remaining balance ₱${remaining.toFixed(2)} for PO ${po.rows[0].po_number}` });
      }

      totalAmount += alloc.amount;
    }

    if (totalAmount > supplierBalance && supplierBalance > 0) {
      return res.status(400).json({ error: `Total amount ₱${totalAmount.toFixed(2)} exceeds supplier balance ₱${supplierBalance.toFixed(2)}` });
    }

    // Create one voucher per allocation
    const voucherIds: string[] = [];
    for (const alloc of paymentAllocations) {
      const voucher_number = await generateRefNumber();
      const id = uuidv4();
      voucherIds.push(id);

      await query(
        `INSERT INTO payment_vouchers (id, voucher_number, supplier_id, po_id, apv_id, payment_date, payment_method, reference_number, amount, status, notes, bank_account_id, check_date, check_bank, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Posted', $10, $11, $12, $13, $14)`,
        [id, voucher_number, supplier_id, alloc.po_id || null, alloc.apv_id || null, payDate, payment_method, reference_number, alloc.amount, notes, bank_account_id || null, check_date || null, check_bank || null, req.user!.id]
      );

      if (alloc.apv_id) {
        // Update APV paid amount and status
        const apv = await query('SELECT * FROM ap_vouchers WHERE id = $1', [alloc.apv_id]);
        const newPaid = parseFloat(apv.rows[0].amount_paid) + alloc.amount;
        const newStatus = newPaid >= parseFloat(apv.rows[0].total_amount) ? 'Fully Paid' : 'Partially Paid';
        await query('UPDATE ap_vouchers SET amount_paid = $1, balance = total_amount - $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newPaid, newStatus, alloc.apv_id]);
        continue;
      }

      // Update PO status (existing logic)
      const po = await query('SELECT * FROM purchase_orders WHERE id = $1', [alloc.po_id]);
      const poTotal = parseFloat(po.rows[0].total);
      const paidResult = await query(
        "SELECT COALESCE(SUM(amount), 0) as total_paid FROM payment_vouchers WHERE po_id = $1 AND status = 'Posted'",
        [alloc.po_id]
      );
      const totalPaid = parseFloat(paidResult.rows[0].total_paid);
      if (totalPaid >= poTotal) {
        await query("UPDATE purchase_orders SET status = 'Paid', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [alloc.po_id]);
      } else {
        await query("UPDATE purchase_orders SET status = 'Partial', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [alloc.po_id]);
      }
    }

    // Update supplier balance by total
    await query('UPDATE suppliers SET balance = balance - $1 WHERE id = $2', [totalAmount, supplier_id]);

    // Create single accounting entry for total amount
    const firstId = voucherIds[0];
    await createAccounting(firstId, `Bulk-${voucherIds.length}-Payments`, supplier_id, totalAmount, creditAccount, isBankPayment, bank_account_id, req.user!.id);

    res.status(201).json({
      voucher_ids: voucherIds,
      total_amount: totalAmount,
      message: `${voucherIds.length} payment voucher(s) created`,
    });
    await client.query('COMMIT');
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
  createdBy: string
) {
  // Journal entry: Debit AP (2000), Credit Cash/Bank
  const entryId = uuidv4();
  const entryNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);

  await query(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1, $2, CURRENT_DATE, 'Payment Voucher', $3, $4, $5, $5, $6)`,
    [entryId, entryNumber, refId, `Payment to supplier ${supplierId}`, amount, createdBy]
  );

  await query(
    `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
     VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '2000'), $3, $4, 0, 'Payment Voucher', $5),
            ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $7), $8, 0, $4, 'Payment Voucher', $5)`,
    [uuidv4(), entryId, `AP Payment ${refLabel}`, amount, refId,
     uuidv4(), creditAccount, `AP Payment ${refLabel}`]
  );

  // Cash transaction
  await query(
    `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
     VALUES ($1, $2, 'Disbursement', $3, 'Payment Voucher', $4, $5, $6)`,
    [uuidv4(), await getNextCode('cash_transactions', 'transaction_number', 'CT-', 4), amount, refId, `Payment ${refLabel}`, createdBy]
  );

  // Bank transaction for Check/Bank Transfer
  if (isBank && bankAccountId) {
    await query(
      `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
       VALUES ($1, $2, 'Withdrawal', $3, CURRENT_DATE, $4, $5)`,
      [uuidv4(), bankAccountId, amount, `Payment ${refLabel}`, createdBy]
    );
    await query(`UPDATE bank_accounts SET balance = balance - $1 WHERE id = $2`, [amount, bankAccountId]);
  }
}

// ==================== ACCOUNTS PAYABLE VOUCHERS (APV) ====================
const generateAPVNumber = async (): Promise<string> => {
  const yr = new Date().getFullYear();
  const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(apv_number, 11) AS INTEGER)), 0) + 1 as next FROM ap_vouchers WHERE apv_number LIKE $1", ['APV-' + yr + '-%']);
  return 'APV-' + yr + '-' + String(r.rows[0]?.next || 1).padStart(6, '0');
};

router.post('/apv', authenticate, hasUserPerm('payables.write'), auditLog('Payables', 'Create APV'), async (req: AuthRequest, res: Response) => {
  try {
    const apv_number = await generateAPVNumber();
    const { supplier_id, po_id, gr_id, apv_date, due_date, payment_terms, supplier_invoice_number, supplier_invoice_date, notes, items } = req.body;
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

    let gross = 0, discount = 0, vatable = 0, vat = 0;
    for (const it of items) {
      const q = parseFloat(it.qty) || 0;
      const uc = parseFloat(it.unit_cost) || 0;
      const lineGross = q * uc;
      const disc = parseFloat(it.discount_amount) || 0;
      const net = lineGross - disc;
      const vatExcl = net / 1.12;
      gross += lineGross; discount += disc; vatable += vatExcl; vat += net - vatExcl;
    }
    const total = Math.round((vatable + vat) * 100) / 100;
    const id = uuidv4();

    await query(
      'INSERT INTO ap_vouchers (id, apv_number, supplier_id, po_id, gr_id, apv_date, due_date, payment_terms, supplier_invoice_number, supplier_invoice_date, status, notes, gross_amount, discount_amount, vatable_amount, vat_amount, total_amount, balance, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,\'Draft\',$11,$12,$13,$14,$15,$16,$17,$18)',
      [id, apv_number, supplier_id || null, po_id || null, gr_id || null, apv_date, due_date || null, payment_terms || null, supplier_invoice_number || null, supplier_invoice_date || null, notes || null, gross, discount, vatable, vat, total, total, req.user!.id]
    );

    for (const it of items) {
      await query(
        'INSERT INTO ap_voucher_items (id, apv_id, product_id, gr_id, description, qty, uom, unit_cost, discount_amount, net_amount, vat_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [uuidv4(), id, it.product_id || null, it.gr_id || null, it.description || null, it.qty || 1, it.uom || 'pcs', it.unit_cost || 0, it.discount_amount || 0, (it.qty * it.unit_cost) - (it.discount_amount || 0), parseFloat(it.vat_amount) || 0]
      );
    }

    res.status(201).json({ id, apv_number });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/apv', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    let where = ''; const params: any[] = []; let i = 1;
    if (status) { where = 'WHERE a.status = $' + (i++); params.push(status); }
    const cnt = await query('SELECT COUNT(*) FROM ap_vouchers a ' + where, params);
    const t = parseInt(cnt.rows[0].count);
    const r = await query(
      'SELECT a.*, s.supplier_name, s.supplier_code FROM ap_vouchers a LEFT JOIN suppliers s ON a.supplier_id = s.id ' + where + ' ORDER BY a.created_at DESC LIMIT $' + (i++) + ' OFFSET $' + (i++),
      [...params, limit, offset]
    );
    res.json({ data: r.rows, total: t, page, limit });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/apv/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT a.*, s.supplier_name, s.supplier_code, s.tin as supplier_tin, s.address as supplier_address, s.contact_person, s.phone FROM ap_vouchers a LEFT JOIN suppliers s ON a.supplier_id = s.id WHERE a.id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const items = await query('SELECT avi.*, p.name as product_name, p.sku FROM ap_voucher_items avi LEFT JOIN products p ON avi.product_id = p.id WHERE avi.apv_id = $1', [req.params.id]);
    res.json({ ...r.rows[0], items: items.rows });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.patch('/apv/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const ex = await query('SELECT * FROM ap_vouchers WHERE id = $1', [req.params.id]);
    if (ex.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (ex.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft APVs can be edited' });
    const { apv_date, due_date, payment_terms, supplier_invoice_number, supplier_invoice_date, notes, items, supplier_id, po_id, gr_id } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item required' });
    let gross = 0, discount = 0, vatable = 0, vat = 0;
    for (const it of items) { const q = parseFloat(it.qty) || 0; const uc = parseFloat(it.unit_cost) || 0; const lineGross = q * uc; const disc = parseFloat(it.discount_amount) || 0; const net = lineGross - disc; const vatExcl = net / 1.12; gross += lineGross; discount += disc; vatable += vatExcl; vat += net - vatExcl; }
    const total = Math.round((vatable + vat) * 100) / 100;
    await query('UPDATE ap_vouchers SET supplier_id=$1, po_id=$2, gr_id=$3, apv_date=$4, due_date=$5, payment_terms=$6, supplier_invoice_number=$7, supplier_invoice_date=$8, notes=$9, gross_amount=$10, discount_amount=$11, vatable_amount=$12, vat_amount=$13, total_amount=$14, balance=$15, updated_at=CURRENT_TIMESTAMP WHERE id=$16',
      [supplier_id || null, po_id || null, gr_id || null, apv_date, due_date || null, payment_terms || null, supplier_invoice_number || null, supplier_invoice_date || null, notes || null, gross, discount, vatable, vat, total, total, req.params.id]);
    await query('DELETE FROM ap_voucher_items WHERE apv_id = $1', [req.params.id]);
    for (const it of items) {
      await query('INSERT INTO ap_voucher_items (id, apv_id, product_id, gr_id, description, qty, uom, unit_cost, discount_amount, net_amount, vat_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [uuidv4(), req.params.id, it.product_id || null, it.gr_id || null, it.description || null, it.qty || 1, it.uom || 'pcs', it.unit_cost || 0, it.discount_amount || 0, (it.qty * it.unit_cost) - (it.discount_amount || 0), parseFloat(it.vat_amount) || 0]);
    }
    res.json({ id: req.params.id });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/apv/:id/post', authenticate, hasUserPerm('payables.write'), auditLog('Payables', 'Post APV'), async (req: AuthRequest, res: Response) => {
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
    if (a.supplier_id) await client.query('UPDATE suppliers SET balance = balance + $1 WHERE id = $2', [jeTotal, a.supplier_id]);
    await client.query('UPDATE ap_vouchers SET status=$1, posted_by=$2, posted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$3', ['Posted', req.user!.id, req.params.id]);
    await client.query('COMMIT'); res.json({ id: req.params.id, status: 'Posted' });
  } catch (error: any) { await client.query('ROLLBACK'); res.status(500).json({ error: error.message }); } finally { client.release(); }
});

router.delete('/apv/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT * FROM ap_vouchers WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (r.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft APVs can be deleted' });
    await query('DELETE FROM ap_vouchers WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/apv/:id/print', async (req: AuthRequest, res: Response) => {
  try {
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try { jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Invalid token' }); }
    const r = await query('SELECT a.*, s.supplier_name, s.supplier_code, s.tin as supplier_tin, s.address as supplier_address, s.contact_person, s.phone FROM ap_vouchers a LEFT JOIN suppliers s ON a.supplier_id = s.id WHERE a.id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];
    const items = await query('SELECT avi.*, p.name as product_name, p.sku FROM ap_voucher_items avi LEFT JOIN products p ON avi.product_id = p.id WHERE avi.apv_id = $1', [req.params.id]);
    const fc = (val: any) => { const n = parseFloat(val); return isNaN(n) ? '0.00' : n.toLocaleString('en-PH', { minimumFractionDigits: 2 }); };
    const itemRows = items.rows.map((row: any, idx: number) => '<tr><td style="padding:4px 6px;font-size:10px">' + (row.product_name || row.description || '-') + '</td><td style="padding:4px 6px;font-size:10px;text-align:center">' + (row.gr_id ? 'RR' : '-') + '</td><td style="padding:4px 6px;font-size:10px;text-align:center">' + parseFloat(row.qty) + '</td><td style="padding:4px 6px;font-size:10px;text-align:center">' + (row.uom || '-') + '</td><td style="padding:4px 6px;font-size:10px;text-align:right">' + fc(row.unit_cost) + '</td><td style="padding:4px 6px;font-size:10px;text-align:right">' + fc(row.net_amount) + '</td></tr>').join('');
    const gross = parseFloat(d.gross_amount) || 0, disc = parseFloat(d.discount_amount) || 0, vatable = parseFloat(d.vatable_amount) || 0, vat = parseFloat(d.vat_amount) || 0, total = parseFloat(d.total_amount) || 0;

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const bizName = b.business_name || 'D METRAN TRADING';
    const bizTag = b.trade_name || 'General Merchandise & Integrated Trade Distribution';
    const bizAddr = (b.address || '') + (b.city ? ', ' + b.city : '');
    const bizTel = b.telephone_number || b.mobile_number || '';
    const bizEmail = b.email_address || '';
    const bizTin = b.tin_number || '123-456-789-000';
    const bizVat = b.vat_type || 'VAT Registered';
    const approvedBy = b.approved_by || 'M. METRAN';
    const approvedPos = b.approved_by_position || 'Proprietor';
    const preparedBy = b.prepared_by || '';
    const preparedPos = b.prepared_by_position || '';

    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>APV ' + d.apv_number + '</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",monospace;font-size:10px;color:#111;padding:8mm 10mm;max-width:210mm;margin:0 auto;letter-spacing:.2px}.company-header{text-align:center;margin-bottom:8px}.company-header h1{font-size:18px;font-weight:bold;letter-spacing:4px;margin:0}.company-header .tagline{font-size:9px;color:#111;margin:3px 0}.dot-divider{text-align:center;font-size:11px;font-weight:bold;margin:4px 0;letter-spacing:1px}.dot-divider-thin{text-align:center;font-size:10px;color:#444;margin:2px 0}.doc-title{text-align:center;border:1px dotted #444;padding:6px 0;margin:8px 0}.doc-title h2{font-size:14px;font-weight:bold;letter-spacing:6px;margin:0}.details{display:flex;gap:20px;margin:10px 0}.details-left{flex:1;border:1px dotted #444;padding:8px 10px}.details-right{flex:1;border:1px dotted #444;padding:8px 10px}.details-label{font-size:9px;font-weight:bold;text-transform:uppercase;margin-bottom:5px}.details p{font-size:9px;margin:2px 0}.items-table{width:100%;border-collapse:collapse;margin:10px 0}.items-table th{background:#f8f8f8;border:1px dotted #444;padding:5px 6px;font-size:9px;text-align:left;font-weight:bold}.items-table td{border:1px dotted #444;padding:4px 6px;font-size:9px}.computation{display:flex;justify-content:flex-end;margin:10px 0}.comp-table{width:260px;border-collapse:collapse}.comp-table td{padding:3px 8px;font-size:9px}.comp-table td:last-child{text-align:right}.comp-table .total-row{border-top:2px dotted #000;font-size:12px;font-weight:bold}.section-title{font-size:9px;font-weight:bold;text-transform:uppercase;margin:12px 0 4px}.acct-table{width:100%;border-collapse:collapse;margin:8px 0}.acct-table th{background:#f8f8f8;border:1px dotted #444;padding:4px 6px;font-size:8px;text-align:left}.acct-table td{border:1px dotted #444;padding:3px 6px;font-size:8px}.signatures{display:flex;justify-content:space-between;margin-top:28px;gap:10px}.sig-block{text-align:center;flex:1}.sig-block .sig-line{border-bottom:1px solid #000;height:34px;margin-bottom:4px}.sig-block .sig-label{font-size:8px;color:#222}.footer-note{text-align:center;font-size:7px;color:#666;margin-top:14px}@media print{body{padding:5mm 8mm}}</style></head><body><div class="company-header"><h1>' + bizName + '</h1><div class="tagline">' + bizTag + '</div><div style="font-size:8px;margin:2px 0">' + bizAddr + ' | Tel: ' + bizTel + ' | Email: ' + bizEmail + '</div><div style="font-size:8px;margin:2px 0">TIN: ' + bizTin + ' | ' + bizVat + '</div></div><div class="dot-divider">================================================</div><div class="dot-divider-thin">------------------------------------------------</div><div class="doc-title"><h2>ACCOUNTS PAYABLE VOUCHER</h2></div><div class="details"><div class="details-left"><div class="details-label">Supplier Information</div><p><strong>Name:</strong> ' + (d.supplier_name || '-') + '</p>' + (d.supplier_address ? '<p><strong>Address:</strong> ' + d.supplier_address + '</p>' : '') + (d.supplier_tin ? '<p><strong>TIN:</strong> ' + d.supplier_tin + '</p>' : '') + (d.contact_person ? '<p><strong>Contact:</strong> ' + d.contact_person + '</p>' : '') + (d.phone ? '<p><strong>Phone:</strong> ' + d.phone + '</p>' : '') + '</div><div class="details-right"><div class="details-label">APV Details</div><p><strong>APV No:</strong> ' + d.apv_number + '</p><p><strong>Date:</strong> ' + new Date(d.apv_date).toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'}) + '</p>' + (d.due_date ? '<p><strong>Due Date:</strong> ' + new Date(d.due_date).toLocaleDateString('en-PH', {year:'numeric', month:'long', day:'numeric'}) + '</p>' : '') + (d.payment_terms ? '<p><strong>Terms:</strong> ' + d.payment_terms + '</p>' : '') + (d.po_id ? '<p><strong>PO Ref:</strong> ' + d.po_id + '</p>' : '') + (d.gr_id ? '<p><strong>RR Ref:</strong> ' + d.gr_id + '</p>' : '') + '<p><strong>Status:</strong> ' + d.status + '</p></div></div><table class="items-table"><thead><tr><th>Description</th><th style="width:50px;text-align:center">Ref</th><th style="width:40px;text-align:center">Qty</th><th style="width:40px;text-align:center">UOM</th><th style="width:70px;text-align:right">Unit Cost</th><th style="width:80px;text-align:right">Amount</th></tr></thead><tbody>' + itemRows + '</tbody></table><div class="computation"><table class="comp-table"><tr><td>Gross Purchases:</td><td>' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(gross).replace('₱','₱') + '</td></tr>' + (disc > 0 ? '<tr><td>Less Discount:</td><td>' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(disc).replace('₱','₱') + '</td></tr>' : '') + '<tr><td>VATable Purchases:</td><td>' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(vatable).replace('₱','₱') + '</td></tr><tr><td>Input VAT (12%):</td><td>' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(vat).replace('₱','₱') + '</td></tr><tr class="total-row"><td>TOTAL PAYABLE:</td><td>' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(total).replace('₱','₱') + '</td></tr></table></div>' + (d.supplier_invoice_number ? '<p style="font-size:9px;margin:4px 0"><strong>Supplier Invoice:</strong> ' + d.supplier_invoice_number + (d.supplier_invoice_date ? ' | ' + new Date(d.supplier_invoice_date).toLocaleDateString('en-PH') : '') + '</p>' : '') + (d.notes ? '<p style="font-size:9px;margin:4px 0"><strong>Remarks:</strong> ' + d.notes + '</p>' : '') + '<div class="section-title">Accounting Distribution</div><table class="acct-table"><thead><tr><th>Account Title</th><th style="text-align:right;width:100px">Debit</th><th style="text-align:right;width:100px">Credit</th></tr></thead><tbody><tr><td>Inventory Asset (1200)</td><td style="text-align:right">' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(vatable).replace('₱','₱') + '</td><td style="text-align:right"></td></tr>' + (vat > 0 ? '<tr><td>Input VAT Receivable (1105)</td><td style="text-align:right">' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(vat).replace('₱','₱') + '</td><td style="text-align:right"></td></tr>' : '') + '<tr><td>Accounts Payable (2000)</td><td style="text-align:right"></td><td style="text-align:right">' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(total).replace('₱','₱') + '</td></tr><tr style="font-weight:bold"><td>Totals</td><td style="text-align:right">' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(total).replace('₱','₱') + '</td><td style="text-align:right">' + Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP'}).format(total).replace('₱','₱') + '</td></tr></tbody></table><div class="signatures"><div class="sig-block"><div class="sig-line"></div><div class="sig-label">Prepared by<br>' + (preparedBy || 'AP Clerk') + '</div></div><div class="sig-block"><div class="sig-line"></div><div class="sig-label">Checked by<br>Accounting Officer</div></div><div class="sig-block"><div class="sig-line"></div><div class="sig-label">Approved by<br>' + approvedBy + ' (' + approvedPos + ')</div></div></div><div class="footer-note">Printed: ' + new Date().toLocaleString('en-PH') + ' | Computer-generated document</div></body></html>';
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
