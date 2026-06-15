import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const generateJENumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next FROM journal_entries WHERE entry_number ~ '^JE-'");
  return `JE-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

router.get('/accounts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM bank_accounts WHERE is_active = true ORDER BY bank_name');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/accounts', authenticate, auditLog('Bank Management', 'Create Account'), async (req: AuthRequest, res: Response) => {
  try {
    const { bank_name, account_name, account_number, account_type } = req.body;
    if (!bank_name || !account_name || !account_number || !account_type) {
      return res.status(400).json({ error: 'Bank name, account name, account number, and account type are required' });
    }
    const result = await query(
      'INSERT INTO bank_accounts (bank_name, account_name, account_number, account_type) VALUES ($1, $2, $3, $4) RETURNING *',
      [bank_name, account_name, account_number, account_type]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/transactions', authenticate, auditLog('Bank Management', 'Create Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    const { bank_account_id, transaction_type, amount, notes } = req.body;
    const id = uuidv4();

    await query(
      `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6)`,
      [id, bank_account_id, transaction_type, amount, notes, req.user!.id]
    );

    // Update balance
    await query(
      `UPDATE bank_accounts SET balance = balance + (CASE WHEN $1 = 'Deposit' THEN $2::decimal ELSE -($2::decimal) END) WHERE id = $3`,
      [transaction_type, amount, bank_account_id]
    );

    // Journal entry
    const entryId = uuidv4();
    const entryNumber = await generateJENumber();
    const refType = transaction_type === 'Deposit' ? 'Bank Deposit' : 'Bank Withdrawal';
    const description = `${refType} - $${amount}`;

    // Deposit: Debit Cash in Bank (1010), Credit Cash on Hand (1000)
    // Withdrawal: Debit Cash on Hand (1000), Credit Cash in Bank (1010)
    const debtAccount = transaction_type === 'Deposit' ? '1010' : '1000';
    const creditAccount = transaction_type === 'Deposit' ? '1000' : '1010';

    await query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $6, $7)`,
      [entryId, entryNumber, refType, id, description, amount, req.user!.id]
    );

    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, 0, $6, $7),
              ($8, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $9), $10, 0, $5, $6, $7)`,
      [uuidv4(), entryId, debtAccount, description, amount, refType, id,
       uuidv4(), creditAccount, description]
    );

    // Cash transaction — Deposit = Cash Out (cash leaves till), Withdrawal = Cash In (cash enters till)
    const cashTxnType = transaction_type === 'Deposit' ? 'Cash Out' : 'Cash In';
    await query(
      `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uuidv4(), await (async () => {
        const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_number, 4) AS INTEGER)), 0) + 1 as next FROM cash_transactions WHERE transaction_number ~ '^CT-'");
        return `CT-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
      })(), cashTxnType, amount, refType, id, description, req.user!.id]
    );

    res.status(201).json({ id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/transactions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const account_id = req.query.account_id as string;
    let whereClause = '';
    if (account_id) whereClause = 'WHERE bank_account_id = $1';

    const result = await query(
      `SELECT bt.*, ba.bank_name, ba.account_name
       FROM bank_transactions bt
       JOIN bank_accounts ba ON bt.bank_account_id = ba.id
       ${whereClause}
       ORDER BY bt.created_at DESC`,
      account_id ? [account_id] : []
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Bank reconciliation
router.post('/reconcile', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { bank_account_id, statement_balance, as_of_date } = req.body;
    const bank = await query('SELECT * FROM bank_accounts WHERE id = $1', [bank_account_id]);
    if (bank.rows.length === 0) return res.status(404).json({ error: 'Bank account not found' });

    const bookBalance = parseFloat(bank.rows[0].balance);
    const difference = statement_balance - bookBalance;

    res.json({
      bank_account: bank.rows[0],
      book_balance: bookBalance,
      statement_balance: statement_balance,
      difference,
      as_of_date,
      is_reconciled: Math.abs(difference) < 0.01,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/accounts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query("UPDATE bank_accounts SET is_active = false WHERE id = $1 RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    res.json({ message: 'Account deactivated' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.delete('/transactions/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query("DELETE FROM bank_transactions WHERE id = $1 RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ message: 'Transaction deleted' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;
