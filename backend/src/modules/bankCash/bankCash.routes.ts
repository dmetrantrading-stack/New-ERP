import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
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
        COALESCE((SELECT SUM(amount) FROM cash_transactions WHERE transaction_type = 'Cash In' AND (status IS NULL OR status != 'Void')), 0) as cash_in_total,
        COALESCE((SELECT SUM(amount) FROM cash_transactions WHERE transaction_type IN ('Cash Out','Petty Cash') AND (status IS NULL OR status != 'Void')), 0) as cash_out_total,
        COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted' JOIN chart_of_accounts coa ON jel.account_id = coa.id WHERE coa.account_code = '1015'), 0) as checks_gl_balance
      FROM bank_accounts ba
      WHERE ba.is_active = true
      ORDER BY ba.account_type = 'Cash on Hand' DESC, ba.bank_name
    `);
    const rows = result.rows.map((r: any) => ({
      ...r,
      computed_balance: r.account_type === 'Cash on Hand'
        ? parseFloat(r.cash_in_total) - parseFloat(r.cash_out_total)
        : r.account_type === 'Checks on Hand'
        ? parseFloat(r.checks_gl_balance)
        : parseFloat(r.total_deposits) - parseFloat(r.total_withdrawals),
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
      const entryBalance = running;
      running = isDebit ? running - amount : running + amount;
      return { ...t, running_balance: entryBalance, debit: isDebit ? amount : 0, credit: isDebit ? 0 : amount };
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
    const { account_code, bank_name, account_name, account_number, account_type, gl_account_code, pos_payment_method } = req.body;
    if (!bank_name || !account_name) return res.status(400).json({ error: 'Bank name and account name are required' });
    const result = await query(
      'INSERT INTO bank_accounts (account_code, bank_name, account_name, account_number, account_type, gl_account_code, pos_payment_method) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [account_code || null, bank_name, account_name, account_number || '', account_type || 'Savings', gl_account_code || null, pos_payment_method || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/accounts/:id', authenticate, auditLog('Bank & Cash', 'Update Account'), async (req: AuthRequest, res: Response) => {
  try {
    const { account_code, bank_name, account_name, account_number, account_type, gl_account_code, pos_payment_method, is_active } = req.body;
    const result = await query('UPDATE bank_accounts SET account_code=COALESCE($1,account_code), bank_name=COALESCE($2,bank_name), account_name=COALESCE($3,account_name), account_number=COALESCE($4,account_number), account_type=COALESCE($5,account_type), gl_account_code=COALESCE($6,gl_account_code), pos_payment_method=COALESCE($7,pos_payment_method), is_active=COALESCE($8,is_active), updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING *', [account_code, bank_name, account_name, account_number, account_type, gl_account_code, pos_payment_method || null, is_active, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    res.json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== BANK TRANSACTIONS ====================
router.post('/transactions', authenticate, hasUserPerm('bank-cash.write'), auditLog('Bank & Cash', 'Create Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    const { bank_account_id, transaction_type, amount, notes } = req.body;
    if (!bank_account_id || !transaction_type || !amount || amount <= 0) return res.status(400).json({ error: 'Account, type, and valid amount are required' });
    const id = uuidv4();

    await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by) VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6)`, [id, bank_account_id, transaction_type, amount, notes, req.user!.id]);
    await query(`UPDATE bank_accounts SET balance = balance + (CASE WHEN $1='Deposit' THEN $2::decimal ELSE -($2::decimal) END), updated_at = CURRENT_TIMESTAMP WHERE id = $3`, [transaction_type, amount, bank_account_id]);

    // Use the account's gl_account_code for the bank side of the JE
    const acct = await query('SELECT gl_account_code FROM bank_accounts WHERE id = $1', [bank_account_id]);
    const bankGlCode = acct.rows.length > 0 && acct.rows[0].gl_account_code ? acct.rows[0].gl_account_code : '1010';
    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    const refType = transaction_type === 'Deposit' ? 'Bank Deposit' : 'Bank Withdrawal';
    const description = `${refType} - $${amount}`;
    const debtAccount = transaction_type === 'Deposit' ? bankGlCode : '1000';
    const creditAccount = transaction_type === 'Deposit' ? '1000' : bankGlCode;

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
    const txn = await query("SELECT * FROM bank_transactions WHERE id = $1", [req.params.id]);
    if (txn.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
    const bt = txn.rows[0];

    // Reverse bank account balance update
    await query('UPDATE bank_accounts SET balance = balance - (CASE WHEN $1=\'Deposit\' THEN $2::decimal ELSE -($2::decimal) END), updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [bt.transaction_type, bt.amount, bt.bank_account_id]);

    // Void companion cash transaction
    await query("UPDATE cash_transactions SET status = 'Void' WHERE reference_id = $1 AND (status IS NULL OR status != 'Void')", [req.params.id]);

    // Void the journal entry
    await query("UPDATE journal_entries SET status = 'Void' WHERE reference_id = $1 AND (status IS NULL OR status != 'Void')", [req.params.id]);

    // Delete the bank transaction
    await query("DELETE FROM bank_transactions WHERE id = $1", [req.params.id]);
    res.json({ message: 'Transaction deleted and reversed' });
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

    const isFromCashHand = fromAcct.rows[0].account_type === 'Cash on Hand';
    const isToCashHand = toAcct.rows[0].account_type === 'Cash on Hand';
    const isFromChecksOnHand = fromAcct.rows[0].account_type === 'Checks on Hand';
    const isToChecksOnHand = toAcct.rows[0].account_type === 'Checks on Hand';

    // Compute effective balance for source account
    let fromBalance: number;
    if (isFromCashHand) {
      const r = await query(`SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'Cash In' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN transaction_type IN ('Cash Out','Petty Cash') THEN amount ELSE 0 END), 0) as bal
        FROM cash_transactions WHERE (status IS NULL OR status != 'Void')`);
      fromBalance = parseFloat(r.rows[0].bal);
    } else if (isFromChecksOnHand) {
      const r = await query(`SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as bal
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted'
        JOIN chart_of_accounts coa ON jel.account_id = coa.id
        WHERE coa.account_code = '1015'`);
      fromBalance = parseFloat(r.rows[0].bal);
    } else {
      const r = await query(`SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0) as bal
        FROM bank_transactions WHERE bank_account_id = $1`, [from_account_id]);
      fromBalance = parseFloat(r.rows[0].bal);
    }
    if (amount > fromBalance) return res.status(400).json({ error: `Insufficient balance. Available: ${formatCurrency(fromBalance)}` });

    const transferId = uuidv4();

    // Debit destination balance, Credit source balance
    await query('UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [amount, from_account_id]);
    await query('UPDATE bank_accounts SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [amount, to_account_id]);

    // Create transaction records for proper balance tracking
    if (isFromCashHand) {
      await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by) VALUES ($1,$2,'Cash Out',$3,'Bank Transfer',$4,$5,$6)`, [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), amount, transferId, notes || '', req.user!.id]);
    } else {
      await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by) VALUES ($1,$2,'Withdrawal',$3,CURRENT_DATE,'Bank Transfer',$4,$5,$6)`, [uuidv4(), from_account_id, amount, transferId, notes || '', req.user!.id]);
    }
    if (isToCashHand) {
      await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by) VALUES ($1,$2,'Cash In',$3,'Bank Transfer',$4,$5,$6)`, [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), amount, transferId, notes || '', req.user!.id]);
    } else {
      await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by) VALUES ($1,$2,'Deposit',$3,CURRENT_DATE,'Bank Transfer',$4,$5,$6)`, [uuidv4(), to_account_id, amount, transferId, notes || '', req.user!.id]);
    }

    // Mark selected checks as deposited (Option B: integrated into transfer)
    if (isFromChecksOnHand && req.body.receipt_ids && Array.isArray(req.body.receipt_ids)) {
      let depositedTotal = 0;
      for (const rid of req.body.receipt_ids) {
        const cr = await query('SELECT * FROM collection_receipts WHERE id = $1', [rid]);
        if (cr.rows.length > 0 && !cr.rows[0].deposited) {
          depositedTotal += parseFloat(cr.rows[0].amount);
          await query('UPDATE collection_receipts SET deposited = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [rid]);
        }
      }
      if (depositedTotal > 0 && Math.abs(depositedTotal - amount) > 0.01) {
        // Warn but don't block — the transfer amount might differ from the sum of selected checks
      }
    }

    // Journal entry using each account's gl_account_code
    const fromGl = fromAcct.rows[0].gl_account_code || '1010';
    const toGl = toAcct.rows[0].gl_account_code || '1010';
    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    const desc = `Transfer from ${fromAcct.rows[0].bank_name} to ${toAcct.rows[0].bank_name}`;
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,'Bank Transfer',$3,$4,$5,$5,$6)`, [entryId, entryNumber, transferId, desc, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,'Bank Transfer',$6),($7,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$8),$9,0,$5,'Bank Transfer',$6)`, [uuidv4(), entryId, toGl, `Transfer to ${toAcct.rows[0].account_name}`, amount, transferId, uuidv4(), fromGl, `Transfer from ${fromAcct.rows[0].account_name}`]);

    res.json({ message: 'Transfer complete' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Undeposited checks — list collection receipts debited to Checks on Hand (1015)
router.get('/checks-on-hand', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT cr.id, cr.receipt_number, cr.payment_date, cr.reference_number as check_number,
              cr.check_date, cr.check_bank, cr.amount, cr.customer_id,
              c.customer_name, c.customer_code
       FROM collection_receipts cr
       LEFT JOIN customers c ON cr.customer_id = c.id
       WHERE cr.status = 'Posted'
         AND (cr.deposited IS NOT TRUE)
         AND EXISTS (
           SELECT 1 FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted'
           JOIN chart_of_accounts coa ON jel.account_id = coa.id
           WHERE jel.reference_type = 'Collection'
             AND jel.reference_id = cr.id::uuid
             AND coa.account_code = '1015' AND jel.debit > 0
         )
       ORDER BY cr.payment_date`
    );
    res.json(r.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== RECONCILIATION ====================
router.post('/reconcile', authenticate, auditLog('Bank & Cash', 'Reconcile'), async (req: AuthRequest, res: Response) => {
  try {
    const { bank_account_id, statement_balance, as_of_date } = req.body;
    const bank = await query('SELECT * FROM bank_accounts WHERE id = $1', [bank_account_id]);
    if (bank.rows.length === 0) return res.status(404).json({ error: 'Bank account not found' });
    const ba = bank.rows[0];

    let bookBalance: number;
    if (ba.gl_account_code) {
      const glResult = await query(
        `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as gl_balance
         FROM journal_entry_lines jel
         JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted'
         JOIN chart_of_accounts coa ON jel.account_id = coa.id
         WHERE coa.account_code = $1`,
        [ba.gl_account_code]
      );
      bookBalance = parseFloat(glResult.rows[0].gl_balance);
    } else {
      bookBalance = parseFloat(ba.balance);
    }
    const difference = statement_balance - bookBalance;
    res.json({ bank_account: ba, book_balance: bookBalance, statement_balance, difference, as_of_date, is_reconciled: Math.abs(difference) < 0.01 });
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
