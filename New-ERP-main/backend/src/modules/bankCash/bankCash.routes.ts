import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const generateRefNumber = async (prefix: string, table: string, field: string): Promise<string> => {
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeField = field.replace(/[^a-z_]/g, '');
  const safePrefix = prefix.replace(/[^A-Z0-9]/g, '');
  const startPos = safePrefix.length + 2;
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeField} FROM ${startPos}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeField} ~ '^${safePrefix}-'`
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const generateJENumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next FROM journal_entries WHERE entry_number ~ '^JE-'");
  return `JE-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

// ==================== CASH TRANSACTIONS ====================
router.get('/cash-transactions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const from = req.query.from as string;
    const to = req.query.to as string;

    let whereClause = '';
    const params: any[] = [];
    let paramIndex = 1;
    if (from) { whereClause += ` AND ct.created_at::date >= $${paramIndex}`; params.push(from); paramIndex++; }
    if (to) { whereClause += ` AND ct.created_at::date <= $${paramIndex}`; params.push(to); paramIndex++; }

    const total = await query(`SELECT COUNT(*) FROM cash_transactions ct WHERE 1=1 ${whereClause}`, params);
    const result = await query(
      `SELECT ct.*, u.full_name as created_by_name FROM cash_transactions ct LEFT JOIN users u ON ct.created_by = u.id WHERE 1=1 ${whereClause} ORDER BY ct.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );
    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/cash-in', authenticate, auditLog('Bank & Cash', 'Cash In'), async (req: AuthRequest, res: Response) => {
  try {
    const txnNumber = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
    const { amount, notes } = req.body;
    const id = uuidv4();

    await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by) VALUES ($1,$2,'Cash In',$3,$4,$5)`, [id, txnNumber, amount, notes, req.user!.id]);

    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,'Cash In',$3,$4,$5,$5,$6)`, [entryId, entryNumber, id, `Cash In ${txnNumber}`, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$3,$4,0,'Cash In',$5),($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='3000'),$7,0,$4,'Cash In',$5)`, [uuidv4(), entryId, `Cash In ${txnNumber}`, amount, id, uuidv4(), `Cash In ${txnNumber}`]);

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/cash-out', authenticate, auditLog('Bank & Cash', 'Cash Out'), async (req: AuthRequest, res: Response) => {
  try {
    const txnNumber = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
    const { amount, notes } = req.body;
    const id = uuidv4();

    await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by) VALUES ($1,$2,'Cash Out',$3,$4,$5)`, [id, txnNumber, amount, notes, req.user!.id]);

    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,'Cash Out',$3,$4,$5,$5,$6)`, [entryId, entryNumber, id, `Cash Out ${txnNumber}`, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='3010'),$3,$4,0,'Cash Out',$5),($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$7,0,$4,'Cash Out',$5)`, [uuidv4(), entryId, `Cash Out ${txnNumber}`, amount, id, uuidv4(), `Cash Out ${txnNumber}`]);

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/petty-cash', authenticate, auditLog('Bank & Cash', 'Petty Cash'), async (req: AuthRequest, res: Response) => {
  try {
    const txnNumber = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
    const { amount, notes } = req.body;
    const id = uuidv4();

    await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by) VALUES ($1,$2,'Petty Cash',$3,$4,$5)`, [id, txnNumber, amount, notes, req.user!.id]);

    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,'Petty Cash',$3,$4,$5,$5,$6)`, [entryId, entryNumber, id, `Petty Cash ${txnNumber}`, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='6080'),$3,$4,0,'Petty Cash',$5),($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$7,0,$4,'Petty Cash',$5)`, [uuidv4(), entryId, `Petty Cash ${txnNumber}`, amount, id, uuidv4(), `Petty Cash ${txnNumber}`]);

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/x-reading', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await query("SELECT * FROM pos_shifts WHERE user_id = $1 AND status = 'Open' ORDER BY created_at DESC LIMIT 1", [req.user!.id]);
    if (shift.rows.length === 0) return res.json({ message: 'No open shift' });
    const s = shift.rows[0];
    res.json({ shift: s, opening_cash: s.opening_cash, cash_sales: s.cash_sales, gcash_sales: s.gcash_sales, maya_sales: s.maya_sales, card_sales: s.card_sales, charge_sales: s.charge_sales, total_sales: s.total_sales, discounts: s.discount_total, returns: s.return_total, net_sales: s.net_sales, expected_cash: parseFloat(s.opening_cash) + parseFloat(s.cash_sales) - parseFloat(s.return_total) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.delete('/cash-transactions/:id', authenticate, auditLog('Bank & Cash', 'Void Cash Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query("UPDATE cash_transactions SET status = 'Void' WHERE id = $1 AND status != 'Void' RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Transaction not found or already voided' });
    res.json({ message: 'Transaction voided' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== BANK ACCOUNTS ====================
router.get('/accounts', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT ba.*,
        COALESCE((SELECT SUM(amount) FROM bank_transactions WHERE bank_account_id = ba.id AND transaction_type = 'Deposit'), 0) as total_deposits,
        COALESCE((SELECT SUM(amount) FROM bank_transactions WHERE bank_account_id = ba.id AND transaction_type = 'Withdrawal'), 0) as total_withdrawals,
        COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel
          JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted'
          JOIN chart_of_accounts coa ON jel.account_id = coa.id
          WHERE coa.account_code = ba.gl_account_code), 0) as gl_balance
      FROM bank_accounts ba
      WHERE ba.is_active = true
      ORDER BY ba.bank_name
    `);
    // Use GL balance if mapped, otherwise use direct balance
    const rows = result.rows.map((r: any) => ({
      ...r,
      computed_balance: r.gl_account_code ? parseFloat(r.gl_balance) : parseFloat(r.balance || 0),
    }));
    res.json(rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/accounts/all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM bank_accounts ORDER BY bank_name');
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/accounts/:id/ledger', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const account = await query('SELECT * FROM bank_accounts WHERE id = $1', [req.params.id]);
    if (account.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    const acct = account.rows[0];

    const txns = await query(`
      SELECT bt.id, bt.transaction_date as date, bt.transaction_type as type,
             bt.amount, bt.notes as description, 'Bank' as source_module,
             bt.reference_type, bt.reference_id
      FROM bank_transactions bt WHERE bt.bank_account_id = $1
      UNION ALL
      SELECT ct.id, ct.created_at::date, ct.transaction_type,
             ct.amount, ct.notes, 'Cash' as source_module,
             ct.reference_type, ct.reference_id
      FROM cash_transactions ct
      WHERE ct.transaction_type IN ('Cash In','Cash Out','Petty Cash')
      ORDER BY date DESC
    `, [req.params.id]);

    let running = parseFloat(acct.balance);
    const ledger = txns.rows.map((t: any) => {
      const amount = parseFloat(t.amount);
      const isDebit = ['Deposit', 'Cash In'].includes(t.type);
      running = isDebit ? running - amount : running + amount;
      return { ...t, running_balance: running, debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount };
    }).reverse();

    // If GL mapped, pull journal entries from that GL account
    let glEntries: any[] = [];
    if (acct.gl_account_code) {
      const glResult = await query(`
        SELECT je.entry_date as date, je.reference_type as type, je.entry_number,
               jel.debit, jel.credit, je.description,
               je.reference_type as source_module, je.reference_id
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id
        JOIN chart_of_accounts coa ON jel.account_id = coa.id
        WHERE coa.account_code = $1 AND je.status = 'Posted'
        ORDER BY je.entry_date DESC LIMIT 200
      `, [acct.gl_account_code]);
      glEntries = glResult.rows.map((r: any) => ({
        date: r.date, type: r.type, description: r.description || '',
        source_module: r.source_module, debit: parseFloat(r.debit) || 0,
        credit: parseFloat(r.credit) || 0,
      }));
    }

    res.json({ account: acct, ledger, gl_entries: glEntries, balance: parseFloat(acct.balance) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/accounts', authenticate, auditLog('Bank & Cash', 'Create Account'), async (req: AuthRequest, res: Response) => {
  try {
    const { account_code, bank_name, account_name, account_number, account_type } = req.body;
    if (!bank_name || !account_name) return res.status(400).json({ error: 'Bank name and account name are required' });
    const result = await query(
      'INSERT INTO bank_accounts (account_code, bank_name, account_name, account_number, account_type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [account_code || null, bank_name, account_name, account_number || '', account_type || 'Savings']
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/accounts/:id', authenticate, auditLog('Bank & Cash', 'Update Account'), async (req: AuthRequest, res: Response) => {
  try {
    const { account_code, bank_name, account_name, account_number, account_type, gl_account_code, is_active } = req.body;
    const result = await query('UPDATE bank_accounts SET account_code=COALESCE($1,account_code), bank_name=COALESCE($2,bank_name), account_name=COALESCE($3,account_name), account_number=COALESCE($4,account_number), account_type=COALESCE($5,account_type), gl_account_code=COALESCE($6,gl_account_code), is_active=COALESCE($7,is_active), updated_at=CURRENT_TIMESTAMP WHERE id=$8 RETURNING *', [account_code, bank_name, account_name, account_number, account_type, gl_account_code, is_active, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    res.json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== BANK TRANSACTIONS ====================
router.post('/transactions', authenticate, auditLog('Bank & Cash', 'Create Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    const { bank_account_id, transaction_type, amount, notes } = req.body;
    if (!bank_account_id || !transaction_type || !amount || amount <= 0) return res.status(400).json({ error: 'Account, type, and valid amount are required' });
    const id = uuidv4();

    await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6)`, [id, bank_account_id, transaction_type, amount, notes, req.user!.id]);
    await query(`UPDATE bank_accounts SET balance = balance + (CASE WHEN $1='Deposit' THEN $2::decimal ELSE -($2::decimal) END), updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [transaction_type, amount, bank_account_id]);

    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    const refType = transaction_type === 'Deposit' ? 'Bank Deposit' : 'Bank Withdrawal';
    const description = `${refType} - $${amount}`;
    const debtAccount = transaction_type === 'Deposit' ? '1010' : '1000';
    const creditAccount = transaction_type === 'Deposit' ? '1000' : '1010';

    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$6,$7)`, [entryId, entryNumber, refType, id, description, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,$6,$7),($8,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$9),$10,0,$5,$6,$7)`, [uuidv4(), entryId, debtAccount, description, amount, refType, id, uuidv4(), creditAccount, description]);

    const cashTxnType = transaction_type === 'Deposit' ? 'Cash Out' : 'Cash In';
    await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), cashTxnType, amount, refType, id, description, req.user!.id]);

    res.status(201).json({ id });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/transactions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const account_id = req.query.account_id as string;
    let whereClause = ''; if (account_id) whereClause = 'WHERE bank_account_id = $1';
    const result = await query(`SELECT bt.*, ba.bank_name, ba.account_name FROM bank_transactions bt JOIN bank_accounts ba ON bt.bank_account_id = ba.id ${whereClause} ORDER BY bt.created_at DESC`, account_id ? [account_id] : []);
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.delete('/transactions/:id', authenticate, auditLog('Bank & Cash', 'Delete Bank Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query("DELETE FROM bank_transactions WHERE id = $1 RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    res.json({ message: 'Transaction deleted' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== BANK TRANSFERS ====================
router.post('/transfers', authenticate, auditLog('Bank & Cash', 'Transfer'), async (req: AuthRequest, res: Response) => {
  try {
    const { from_account_id, to_account_id, amount, notes } = req.body;
    if (!from_account_id || !to_account_id || !amount || amount <= 0) return res.status(400).json({ error: 'Both accounts and valid amount are required' });

    const fromAcct = await query('SELECT * FROM bank_accounts WHERE id = $1', [from_account_id]);
    const toAcct = await query('SELECT * FROM bank_accounts WHERE id = $1', [to_account_id]);
    if (fromAcct.rows.length === 0 || toAcct.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

    const fromBalance = parseFloat(fromAcct.rows[0].balance);
    if (amount > fromBalance) return res.status(400).json({ error: `Insufficient balance. Available: ${formatCurrency(fromBalance)}` });

    // Debit destination, Credit source
    await query('UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [amount, from_account_id]);
    await query('UPDATE bank_accounts SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [amount, to_account_id]);

    // Journal entry
    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    const desc = `Transfer from ${fromAcct.rows[0].bank_name} to ${toAcct.rows[0].bank_name}`;
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,'Bank Transfer',NULL,$3,$4,$4,$5)`, [entryId, entryNumber, desc, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1010'),$3,$4,0,'Bank Transfer',NULL),($5,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1010'),$6,0,$4,'Bank Transfer',NULL)`, [uuidv4(), entryId, `Transfer to ${toAcct.rows[0].account_name}`, amount, uuidv4(), `Transfer from ${fromAcct.rows[0].account_name}`]);

    res.json({ message: 'Transfer complete' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== RECONCILIATION ====================
router.post('/reconcile', authenticate, auditLog('Bank & Cash', 'Reconcile'), async (req: AuthRequest, res: Response) => {
  try {
    const { bank_account_id, statement_balance, as_of_date } = req.body;
    const bank = await query('SELECT * FROM bank_accounts WHERE id = $1', [bank_account_id]);
    if (bank.rows.length === 0) return res.status(404).json({ error: 'Bank account not found' });

    const bookBalance = parseFloat(bank.rows[0].balance);
    const difference = statement_balance - bookBalance;
    res.json({ bank_account: bank.rows[0], book_balance: bookBalance, statement_balance, difference, as_of_date, is_reconciled: Math.abs(difference) < 0.01 });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.delete('/accounts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query("UPDATE bank_accounts SET is_active = false WHERE id = $1 RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    res.json({ message: 'Account deactivated' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

function formatCurrency(amount: number) { return `₱${amount.toFixed(2)}`; }

export default router;
