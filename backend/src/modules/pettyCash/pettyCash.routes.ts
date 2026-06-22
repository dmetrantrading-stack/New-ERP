import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import { ACCOUNTS_LIST_SQL, computeAccountBalance } from '../../utils/bankCashBalance';
import {
  fmtCurrency,
  fmtDate,
  tableRow,
  fc,
  renderEnterpriseItemsTable,
  renderEnterpriseSectionTitle,
  renderEnterpriseTotalBanner,
} from '../../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildEnterpriseSignatures,
} from '../../utils/salesEnterprisePrint';
import { assertPeriodNotLocked } from '../../utils/periodLock';

const router = Router();

const generateJENumber = async (): Promise<string> => {
  const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next FROM journal_entries WHERE entry_number ~ '^JE-'");
  return `JE-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

const generateCtNumber = async (): Promise<string> => {
  const r = await query(
    "SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_number FROM 4) AS INTEGER)), 0) + 1 as next FROM cash_transactions WHERE transaction_number ~ '^CT-'",
  );
  return `CT-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

const getPrimaryCashOnHandBalance = async (): Promise<number> => {
  const accounts = await query(ACCOUNTS_LIST_SQL);
  const primaryCash = accounts.rows.find(
    (r: { account_type?: string; id?: number; primary_cash_on_hand_id?: number | null }) =>
      r.account_type === 'Cash on Hand'
      && r.primary_cash_on_hand_id != null
      && Number(r.id) === Number(r.primary_cash_on_hand_id),
  );
  return primaryCash ? computeAccountBalance(primaryCash) : 0;
};

router.get('/summary', authenticate, hasUserPerm('finance.petty-cash.view'), async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await query(ACCOUNTS_LIST_SQL);
    const pcf = accounts.rows.find((r: { account_type?: string }) => r.account_type === 'Petty Cash Fund');
    const fundBalance = pcf ? computeAccountBalance(pcf) : 0;

    const unreplenished = await query(
      `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*)::int as count
       FROM petty_cash_vouchers WHERE status = 'Unreplenished'`,
    );

    res.json({
      fund_balance: fundBalance,
      unreplenished_total: parseFloat(unreplenished.rows[0].total),
      unreplenished_count: unreplenished.rows[0].count,
      fund_account_name: pcf?.account_name || 'Office Petty Cash',
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/', authenticate, hasUserPerm('finance.petty-cash.view'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT pcv.*, u.full_name as created_by_name
       FROM petty_cash_vouchers pcv
       LEFT JOIN users u ON pcv.created_by = u.id
       WHERE pcv.status != 'Cancelled'
       ORDER BY pcv.voucher_date DESC, pcv.created_at DESC LIMIT 100`
    );
    res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/', authenticate, hasUserPerm('finance.petty-cash.create'), auditLog('Petty Cash', 'Create PCV'), async (req: AuthRequest, res: Response) => {
  try {
    await assertPeriodNotLocked(req.body.voucher_date || new Date().toISOString().slice(0, 10));
    const { payee, amount, category, description, voucher_date } = req.body;
    if (!payee || !amount || amount <= 0) return res.status(400).json({ error: 'Payee and valid amount required' });

    const pcvNumber = 'PCV-' + new Date().getFullYear() + '-' + String((await query("SELECT COALESCE(MAX(CAST(SUBSTRING(pcv_number,12) AS INTEGER)),0)+1 as next FROM petty_cash_vouchers WHERE pcv_number LIKE 'PCV-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-%'")).rows[0].next).padStart(5, '0');
    const id = uuidv4();
    const vDate = voucher_date || new Date().toISOString().split('T')[0];

    await query(
      `INSERT INTO petty_cash_vouchers (id, pcv_number, voucher_date, payee, amount, category, description, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, pcvNumber, vDate, payee, amount, category || null, description, req.user!.id]
    );

    const pettyCashAcct = await query("SELECT id, gl_account_code FROM bank_accounts WHERE account_type = 'Petty Cash Fund' AND is_active = true LIMIT 1");
    const fundGl = pettyCashAcct.rows[0]?.gl_account_code || '1016';
    const fundId = pettyCashAcct.rows[0]?.id;

    const catRow = category ? await query("SELECT account_code FROM expense_categories WHERE name = $1 AND is_active = true", [category]) : null;
    const expenseAccount = catRow?.rows[0]?.account_code || '6080';
    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
      VALUES ($1,$2,$3,'Petty Cash',$4,$5,$6,$6,$7)`, [entryId, entryNumber, vDate, id, `PCV ${pcvNumber}`, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
      VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,'Petty Cash',$6),
             ($7,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$8),$9,0,$5,'Petty Cash',$6)`,
      [uuidv4(), entryId, expenseAccount, `${category || 'Office Expense'} ${pcvNumber}`, amount, id, uuidv4(), fundGl, `${category || 'Expense'} ${pcvNumber}`]);

    if (fundId) {
      await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
        VALUES ($1,$2,'Withdrawal',$3,CURRENT_DATE,$4,$5)`, [uuidv4(), fundId, amount, `PCV ${pcvNumber}`, req.user!.id]);
    }

    res.status(201).json({ id, pcv_number: pcvNumber });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/:id/print', authenticate, hasUserPerm('finance.petty-cash.print'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT pcv.*,
              u.full_name as created_by_name,
              ru.full_name as replenished_by_name,
              ec.account_code as expense_account_code
       FROM petty_cash_vouchers pcv
       LEFT JOIN users u ON pcv.created_by = u.id
       LEFT JOIN users ru ON pcv.replenished_by = ru.id
       LEFT JOIN expense_categories ec ON ec.name = pcv.category AND ec.is_active = true
       WHERE pcv.id = $1`,
      [req.params.id],
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const accounts = await query(ACCOUNTS_LIST_SQL);
    const pcf = accounts.rows.find((row: { account_type?: string }) => row.account_type === 'Petty Cash Fund');
    const fundBalance = pcf ? computeAccountBalance(pcf) : 0;

    const printStatus = d.status === 'Replenished' ? 'Posted' : d.status;
    const amount = parseFloat(d.amount) || 0;

    res.send(buildSalesEnterpriseDocument({
      pageTitle: `Petty Cash Voucher ${d.pcv_number}`,
      docTitle: 'Petty Cash Voucher',
      docMetaRows: [
        { label: 'PCV No.', value: d.pcv_number || '—' },
        { label: 'Voucher Date', value: fmtDate(d.voucher_date, 'short') },
        { label: 'Expense Account', value: `${d.expense_account_code || '6080'}${d.category ? ` · ${d.category}` : ''}` },
        { label: 'Status', value: String(printStatus || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Payee Information',
      customerRows: [
        { label: 'Payee', value: d.payee || '—' },
        { label: 'Fund Balance (1016)', value: fmtCurrency(fundBalance) },
      ],
      detailsTitle: 'Voucher Details',
      detailsRows: [
        ...(d.replenished_at ? [{
          label: 'Replenished',
          value: `${fmtDate(d.replenished_at, 'short')}${d.replenished_by_name ? ` · ${d.replenished_by_name}` : ''}`,
        }] : []),
        { label: 'Prepared By', value: d.created_by_name || String(b.prepared_by || 'Petty Cash Custodian') },
      ],
      skipItemsTable: true,
      summaryRows: [{ label: 'VOUCHER AMOUNT', value: fmtCurrency(amount), total: true }],
      amountInWords: amount,
      notes: d.description ? [{ label: 'Description / Particulars', content: d.description }] : [],
      footerNote: 'System-generated petty cash voucher.',
      status: printStatus,
      biz: b,
      signatures: [
        { label: 'Prepared By', name: String(b.prepared_by || d.created_by_name || '') || undefined },
        { label: 'Approved By', name: String(b.approved_by || '') || undefined },
        { label: 'Received By', name: d.payee || undefined },
      ],
      signatureCols: 3,
    }));
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

router.get('/:id', authenticate, hasUserPerm('finance.petty-cash.view'), async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT pcv.*,
              u.full_name as created_by_name,
              ru.full_name as replenished_by_name,
              ec.account_code as expense_account_code
       FROM petty_cash_vouchers pcv
       LEFT JOIN users u ON pcv.created_by = u.id
       LEFT JOIN users ru ON pcv.replenished_by = ru.id
       LEFT JOIN expense_categories ec ON ec.name = pcv.category AND ec.is_active = true
       WHERE pcv.id = $1`,
      [req.params.id],
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'PCV not found' });
    res.json(r.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/:id', authenticate, hasUserPerm('finance.petty-cash.edit'), auditLog('Petty Cash', 'Edit PCV'), async (req: AuthRequest, res: Response) => {
  try {
    const pcv = await query('SELECT * FROM petty_cash_vouchers WHERE id = $1', [req.params.id]);
    if (pcv.rows.length === 0) return res.status(404).json({ error: 'PCV not found' });
    if (pcv.rows[0].status !== 'Unreplenished') return res.status(400).json({ error: 'Only unreplenished vouchers can be edited' });

    const { payee, amount, category, description, voucher_date } = req.body;
    if (!payee || !amount || amount <= 0) return res.status(400).json({ error: 'Payee and valid amount required' });

    const oldAmount = parseFloat(pcv.rows[0].amount);

    await query(
      `UPDATE petty_cash_vouchers SET payee = $1, amount = $2, category = $3, description = $4, voucher_date = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6`,
      [payee, amount, category || null, description, voucher_date || pcv.rows[0].voucher_date, req.params.id]
    );

    if (Math.abs(parseFloat(amount) - oldAmount) > 0.01) {
      await query("UPDATE journal_entries SET status = 'Void' WHERE reference_type = 'Petty Cash' AND reference_id = $1 AND status = 'Posted'", [req.params.id]);
      const pettyCashAcct = await query("SELECT id FROM bank_accounts WHERE account_type = 'Petty Cash Fund' AND is_active = true LIMIT 1");
      const fundId = pettyCashAcct.rows[0]?.id;
      if (fundId) {
        await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
          VALUES ($1,$2,'Deposit',$3,CURRENT_DATE,$4,$5)`, [uuidv4(), fundId, oldAmount, `Reverse edit PCV ${pcv.rows[0].pcv_number}`, req.user!.id]);
      }
      const catRow = category ? await query("SELECT account_code FROM expense_categories WHERE name = $1 AND is_active = true", [category]) : null;
      const expenseAccount = catRow?.rows[0]?.account_code || '6080';
      const fundGl = fundId ? '1016' : '1010';
      const entryId = uuidv4(); const entryNumber = await generateJENumber();
      const vDate = voucher_date || pcv.rows[0].voucher_date;
      await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
        VALUES ($1,$2,$3,'Petty Cash',$4,$5,$6,$6,$7)`, [entryId, entryNumber, vDate, req.params.id, `PCV ${pcv.rows[0].pcv_number} (edited)`, parseFloat(amount), req.user!.id]);
      await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
        VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,'Petty Cash',$6),
               ($7,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$8),$9,0,$5,'Petty Cash',$6)`,
        [uuidv4(), entryId, expenseAccount, `${category || 'Expense'} ${pcv.rows[0].pcv_number}`, parseFloat(amount), req.params.id, uuidv4(), fundGl, `${category || 'Expense'} ${pcv.rows[0].pcv_number}`]);
      if (fundId) {
        await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
          VALUES ($1,$2,'Withdrawal',$3,CURRENT_DATE,$4,$5)`, [uuidv4(), fundId, parseFloat(amount), `PCV ${pcv.rows[0].pcv_number} (edited)`, req.user!.id]);
      }
    }

    res.json({ id: req.params.id, pcv_number: pcv.rows[0].pcv_number });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/replenish', authenticate, hasUserPerm('finance.petty-cash.replenish'), auditLog('Petty Cash', 'Replenish PCV'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    const { voucher_ids } = req.body;
    if (!voucher_ids || !Array.isArray(voucher_ids) || voucher_ids.length === 0) {
      return res.status(400).json({ error: 'Select at least one voucher' });
    }

    let total = 0;
    for (const vid of voucher_ids) {
      const pcv = await client.query('SELECT * FROM petty_cash_vouchers WHERE id = $1', [vid]);
      if (pcv.rows.length === 0) return res.status(404).json({ error: `PCV ${vid} not found` });
      if (pcv.rows[0].status !== 'Unreplenished') {
        return res.status(400).json({ error: `PCV ${pcv.rows[0].pcv_number} already ${pcv.rows[0].status}` });
      }
      total += parseFloat(pcv.rows[0].amount);
    }

    const cashOnHand = await getPrimaryCashOnHandBalance();
    if (total > cashOnHand) {
      return res.status(400).json({
        error: `Insufficient Cash on Hand. Available: ₱${cashOnHand.toFixed(2)}`,
      });
    }

    await client.query('BEGIN');

    for (const vid of voucher_ids) {
      await client.query(
        'UPDATE petty_cash_vouchers SET status = $1, replenished_at = CURRENT_TIMESTAMP, replenished_by = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['Replenished', req.user!.id, vid],
      );
    }

    const pettyCashAcct = await client.query(
      "SELECT id, gl_account_code FROM bank_accounts WHERE account_type = 'Petty Cash Fund' AND is_active = true LIMIT 1",
    );
    const fundGl = pettyCashAcct.rows[0]?.gl_account_code || '1016';
    const fundId = pettyCashAcct.rows[0]?.id;
    const replenishRefId = uuidv4();
    const entryId = uuidv4();
    const entryNumber = await generateJENumber();
    const replenishNotes = `Replenish ${voucher_ids.length} PCV(s)`;

    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1,$2,CURRENT_DATE,'Petty Cash Replenish',$3,$4,$5,$5,$6)`,
      [entryId, entryNumber, replenishRefId, replenishNotes, total, req.user!.id],
    );
    await client.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,'Petty Cash Replenish',$6),
              ($7,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$8,0,$5,'Petty Cash Replenish',$6)`,
      [uuidv4(), entryId, fundGl, 'Restore Petty Cash Fund', total, replenishRefId, uuidv4(), 'Cash disbursement for petty cash replenish'],
    );

    if (fundId) {
      await client.query(
        `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by)
         VALUES ($1,$2,'Deposit',$3,CURRENT_DATE,'Petty Cash Replenish',$4,$5,$6)`,
        [uuidv4(), fundId, total, replenishRefId, replenishNotes, req.user!.id],
      );
    }

    const cashTxnId = uuidv4();
    const cashTxnNumber = await generateCtNumber();
    await client.query(
      `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
       VALUES ($1,$2,'Cash Out',$3,'Petty Cash Replenish',$4,$5,$6)`,
      [cashTxnId, cashTxnNumber, total, replenishRefId, replenishNotes, req.user!.id],
    );

    await client.query('COMMIT');
    res.json({ message: `${voucher_ids.length} vouchers replenished`, total, cash_transaction_number: cashTxnNumber });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
