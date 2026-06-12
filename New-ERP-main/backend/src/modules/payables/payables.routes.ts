import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';

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

// Create payment voucher(s) — pay supplier
router.post('/vouchers', authenticate, auditLog('Payables', 'Create Voucher'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { supplier_id, payment_method, reference_number, notes, bank_account_id, allocations } = req.body;

    if (!supplier_id) return res.status(400).json({ error: 'Supplier is required' });
    if (!payment_method) return res.status(400).json({ error: 'Payment method is required' });

    const isBankPayment = payment_method === 'Check' || payment_method === 'Bank Transfer';
    const creditAccount = isBankPayment ? '1010' : '1000';

    // Support both single po_id (backward compat) and allocations array
    let paymentAllocations: { po_id: string; amount: number }[] = [];

    if (allocations && Array.isArray(allocations) && allocations.length > 0) {
      paymentAllocations = allocations.map((a: any) => ({
        po_id: String(a.po_id),
        amount: parseFloat(a.amount || '0'),
      }));
    } else if (req.body.po_id) {
      paymentAllocations = [{ po_id: String(req.body.po_id), amount: parseFloat(req.body.amount || '0') }];
    } else {
      // No PO specified — pay against supplier balance only
      const totalAmount = parseFloat(req.body.amount || '0');
      if (totalAmount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

      const voucher_number = await generateRefNumber();
      const id = uuidv4();

      await query(
        `INSERT INTO payment_vouchers (id, voucher_number, supplier_id, payment_date, payment_method, reference_number, amount, status, notes, created_by)
         VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, 'Posted', $7, $8)`,
        [id, voucher_number, supplier_id, payment_method, reference_number, totalAmount, notes, req.user!.id]
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
        `INSERT INTO payment_vouchers (id, voucher_number, supplier_id, po_id, payment_date, payment_method, reference_number, amount, status, notes, created_by)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, 'Posted', $8, $9)`,
        [id, voucher_number, supplier_id, alloc.po_id, payment_method, reference_number, alloc.amount, notes, req.user!.id]
      );

      // Update PO status
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
    await createAccounting(firstId, `Bulk-${voucherIds.length}-POs`, supplier_id, totalAmount, creditAccount, isBankPayment, bank_account_id, req.user!.id);

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

export default router;
