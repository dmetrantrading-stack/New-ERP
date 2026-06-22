import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm, hasUserAnyPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import {
  ACCOUNTS_LIST_SQL,
  ACCOUNT_BY_ID_SQL,
  computeAccountBalance,
  buildLedgerRunningBalance,
} from '../../utils/bankCashBalance';
import { setAccountStartingBalance, isStartingBalanceEligible } from '../../utils/startingBalance';
import {
  formatCurrency,
  getGlobalCashBalance,
  getBankAccountComputedBalance,
  resolveAccountGlCode,
  reverseBankTransaction,
  voidCashTransaction,
} from '../../utils/bankCashOperations';
import { assertPeriodNotLocked } from '../../utils/periodLock';

const router = Router();

const bankCashView = hasUserPerm('finance.bank-cash.view');
const bankAccountsAll = hasUserAnyPerm([
  'finance.bank-cash.view',
  'finance.expenses.view',
  'finance.expenses.create',
  'hr.payroll.approve',
  'hr.payroll.edit',
]);

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

const parsePositiveAmount = (amount: unknown): number | null => {
  const n = parseFloat(String(amount));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
};

// ==================== CASH TRANSACTIONS ====================
router.get('/cash-transactions', authenticate, bankCashView, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const from = req.query.from as string;
    const to = req.query.to as string;

    let whereClause = " AND (ct.status IS NULL OR ct.status != 'Void')";
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

router.post('/cash-in', authenticate, hasUserPerm('finance.bank-cash.create'), auditLog('Bank & Cash', 'Cash In'), async (req: AuthRequest, res: Response) => {
  try {
    await assertPeriodNotLocked(new Date().toISOString().slice(0, 10));
    const amount = parsePositiveAmount(req.body.amount);
    if (amount == null) return res.status(400).json({ error: 'Valid amount is required' });
    const { notes } = req.body;
    const txnNumber = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
    const id = uuidv4();

    await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by) VALUES ($1,$2,'Cash In',$3,$4,$5)`, [id, txnNumber, amount, notes, req.user!.id]);

    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,'Cash In',$3,$4,$5,$5,$6)`, [entryId, entryNumber, id, `Cash In ${txnNumber}`, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$3,$4,0,'Cash In',$5),($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='3000'),$7,0,$4,'Cash In',$5)`, [uuidv4(), entryId, `Cash In ${txnNumber}`, amount, id, uuidv4(), `Cash In ${txnNumber}`]);

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/cash-out', authenticate, hasUserPerm('finance.bank-cash.create'), auditLog('Bank & Cash', 'Cash Out'), async (req: AuthRequest, res: Response) => {
  try {
    await assertPeriodNotLocked(new Date().toISOString().slice(0, 10));
    const amount = parsePositiveAmount(req.body.amount);
    if (amount == null) return res.status(400).json({ error: 'Valid amount is required' });
    const cashBalance = await getGlobalCashBalance();
    if (amount > cashBalance) {
      return res.status(400).json({ error: `Insufficient cash on hand. Available: ${formatCurrency(cashBalance)}` });
    }
    const { notes } = req.body;
    const txnNumber = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
    const id = uuidv4();

    await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by) VALUES ($1,$2,'Cash Out',$3,$4,$5)`, [id, txnNumber, amount, notes, req.user!.id]);

    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,'Cash Out',$3,$4,$5,$5,$6)`, [entryId, entryNumber, id, `Cash Out ${txnNumber}`, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='3010'),$3,$4,0,'Cash Out',$5),($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$7,0,$4,'Cash Out',$5)`, [uuidv4(), entryId, `Cash Out ${txnNumber}`, amount, id, uuidv4(), `Cash Out ${txnNumber}`]);

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/petty-cash', authenticate, hasUserPerm('finance.bank-cash.create'), auditLog('Bank & Cash', 'Petty Cash'), async (req: AuthRequest, res: Response) => {
  try {
    const amount = parsePositiveAmount(req.body.amount);
    if (amount == null) return res.status(400).json({ error: 'Valid amount is required' });
    const { notes } = req.body;
    const txnNumber = await generateRefNumber('CT', 'cash_transactions', 'transaction_number');
    const id = uuidv4();

    await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by) VALUES ($1,$2,'Petty Cash',$3,$4,$5)`, [id, txnNumber, amount, notes, req.user!.id]);

    const entryId = uuidv4(); const entryNumber = await generateJENumber();
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,CURRENT_DATE,'Petty Cash',$3,$4,$5,$5,$6)`, [entryId, entryNumber, id, `Petty Cash ${txnNumber}`, amount, req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code='6080'),$3,$4,0,'Petty Cash',$5),($6,$2,(SELECT id FROM chart_of_accounts WHERE account_code='1000'),$7,0,$4,'Petty Cash',$5)`, [uuidv4(), entryId, `Petty Cash ${txnNumber}`, amount, id, uuidv4(), `Petty Cash ${txnNumber}`]);

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/x-reading', authenticate, bankCashView, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await query("SELECT * FROM pos_shifts WHERE user_id = $1 AND status = 'Open' ORDER BY created_at DESC LIMIT 1", [req.user!.id]);
    if (shift.rows.length === 0) return res.json({ message: 'No open shift' });
    const s = shift.rows[0];
    res.json({ shift: s, opening_cash: s.opening_cash, cash_sales: s.cash_sales, gcash_sales: s.gcash_sales, maya_sales: s.maya_sales, card_sales: s.card_sales, charge_sales: s.charge_sales, total_sales: s.total_sales, discounts: s.discount_total, returns: s.return_total, net_sales: s.net_sales, expected_cash: parseFloat(s.opening_cash) + parseFloat(s.cash_sales) - parseFloat(s.return_total) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.delete('/cash-transactions/:id', authenticate, hasUserPerm('finance.bank-cash.edit'), auditLog('Bank & Cash', 'Void Cash Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await voidCashTransaction(req.params.id);
    res.json(result);
  } catch (error: any) {
    const status = error.message?.includes('not found') ? 404 : 400;
    res.status(status).json({ error: error.message });
  }
});

// ==================== BANK ACCOUNTS ====================
router.get('/accounts', authenticate, bankCashView, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(ACCOUNTS_LIST_SQL);
    const rows = result.rows.map((r: any) => ({
      ...r,
      computed_balance: computeAccountBalance(r),
      starting_balance_eligible: isStartingBalanceEligible(r),
    }));
    res.json(rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/accounts/all', authenticate, bankAccountsAll, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM bank_accounts ORDER BY bank_name');
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/accounts/:id/ledger', authenticate, bankCashView, async (req: AuthRequest, res: Response) => {
  try {
    const balResult = await query(ACCOUNT_BY_ID_SQL, [req.params.id]);
    if (balResult.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    const acctRow = balResult.rows[0];
    const acct = { ...acctRow };
    delete acct.total_deposits;
    delete acct.total_withdrawals;
    delete acct.global_cash_in;
    delete acct.global_cash_out;
    delete acct.checks_gl_balance;
    delete acct.primary_cash_on_hand_id;

    const balance = computeAccountBalance(acctRow);
    const accountType = acct.account_type || '';
    const isPrimaryCash =
      accountType === 'Cash on Hand'
      && Number(acct.id) === Number(acctRow.primary_cash_on_hand_id);

    let txnRows: any[] = [];
    if (isPrimaryCash) {
      const cashResult = await query(`
        SELECT ct.id, ct.created_at::date as date, ct.transaction_type as type,
               ct.amount, ct.notes as description, 'Cash' as source_module,
               ct.reference_type, ct.reference_id
        FROM cash_transactions ct
        WHERE ct.transaction_type IN ('Cash In','Cash Out','Petty Cash','Opening')
          AND (ct.status IS NULL OR ct.status != 'Void')
        ORDER BY ct.created_at ASC
      `);
      txnRows = cashResult.rows;
    } else if (accountType === 'Checks on Hand') {
      const glResult = await query(`
        SELECT je.entry_date as date, je.reference_type as type, je.description,
               jel.debit, jel.credit, je.reference_type as source_module, je.reference_id
        FROM journal_entry_lines jel
        JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted'
        JOIN chart_of_accounts coa ON jel.account_id = coa.id
        WHERE coa.account_code = '1015'
        ORDER BY je.entry_date ASC, je.created_at ASC
      `);
      txnRows = glResult.rows.map((r: any) => ({
        date: r.date,
        type: parseFloat(r.debit) > 0 ? 'Deposit' : 'Withdrawal',
        amount: parseFloat(r.debit) || parseFloat(r.credit),
        description: r.description || '',
        source_module: r.source_module,
        reference_type: r.source_module,
        reference_id: r.reference_id,
      }));
    } else if (accountType !== 'Cash on Hand') {
      const bankResult = await query(`
        SELECT bt.id, bt.transaction_date as date, bt.transaction_type as type,
               bt.amount, bt.notes as description, 'Bank' as source_module,
               bt.reference_type, bt.reference_id
        FROM bank_transactions bt
        WHERE bt.bank_account_id = $1
        ORDER BY bt.transaction_date ASC, bt.created_at ASC
      `, [req.params.id]);
      txnRows = bankResult.rows;
    }

    const ledger = buildLedgerRunningBalance(txnRows);

    let glEntries: any[] = [];
    if (acct.gl_account_code && accountType !== 'Checks on Hand') {
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

    res.json({ account: acct, ledger, gl_entries: glEntries, balance });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/accounts', authenticate, hasUserPerm('finance.bank-cash.create'), auditLog('Bank & Cash', 'Create Account'), async (req: AuthRequest, res: Response) => {
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

router.put('/accounts/:id', authenticate, hasUserPerm('finance.bank-cash.edit'), auditLog('Bank & Cash', 'Update Account'), async (req: AuthRequest, res: Response) => {
  try {
    const { account_code, bank_name, account_name, account_number, account_type, gl_account_code, pos_payment_method, is_active } = req.body;
    const result = await query('UPDATE bank_accounts SET account_code=COALESCE($1,account_code), bank_name=COALESCE($2,bank_name), account_name=COALESCE($3,account_name), account_number=COALESCE($4,account_number), account_type=COALESCE($5,account_type), gl_account_code=COALESCE($6,gl_account_code), pos_payment_method=COALESCE($7,pos_payment_method), is_active=COALESCE($8,is_active), updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING *', [account_code, bank_name, account_name, account_number, account_type, gl_account_code, pos_payment_method || null, is_active, req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    res.json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/accounts/:id/starting-balance', authenticate, hasUserPerm('finance.bank-cash.edit'), auditLog('Bank & Cash', 'Set Starting Balance'), async (req: AuthRequest, res: Response) => {
  try {
    const entryDate = req.body.entry_date || new Date().toISOString().slice(0, 10);
    await assertPeriodNotLocked(entryDate);
    const amount = parseFloat(String(req.body.amount ?? 0));
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ error: 'Valid amount is required (zero or greater)' });
    }
    const result = await setAccountStartingBalance(parseInt(req.params.id, 10), amount, req.user!.id, {
      notes: req.body.notes,
      entry_date: entryDate,
    });
    const acct = await query(ACCOUNT_BY_ID_SQL, [req.params.id]);
    res.json({
      ...result,
      account: acct.rows[0]
        ? { ...acct.rows[0], computed_balance: computeAccountBalance(acct.rows[0]), starting_balance_eligible: isStartingBalanceEligible(acct.rows[0]) }
        : null,
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ==================== BANK TRANSACTIONS ====================
router.post('/transactions', authenticate, hasUserPerm('finance.bank-cash.create'), auditLog('Bank & Cash', 'Create Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    await assertPeriodNotLocked(new Date().toISOString().slice(0, 10));
    const { bank_account_id, transaction_type, amount, notes } = req.body;
    if (!bank_account_id || !transaction_type || !amount || amount <= 0) return res.status(400).json({ error: 'Account, type, and valid amount are required' });

    if (transaction_type === 'Deposit') {
      const cashBalance = await getGlobalCashBalance();
      if (parseFloat(String(amount)) > cashBalance) {
        return res.status(400).json({ error: `Insufficient cash on hand for deposit. Available: ${formatCurrency(cashBalance)}` });
      }
    } else if (transaction_type === 'Withdrawal') {
      const bankBalance = await getBankAccountComputedBalance(parseInt(String(bank_account_id), 10));
      if (parseFloat(String(amount)) > bankBalance) {
        return res.status(400).json({ error: `Insufficient bank balance. Available: ${formatCurrency(bankBalance)}` });
      }
    }

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

router.get('/transactions', authenticate, bankCashView, async (req: AuthRequest, res: Response) => {
  try {
    const account_id = req.query.account_id as string;
    let whereClause = ''; if (account_id) whereClause = 'WHERE bank_account_id = $1';
    const result = await query(`SELECT bt.*, ba.bank_name, ba.account_name FROM bank_transactions bt JOIN bank_accounts ba ON bt.bank_account_id = ba.id ${whereClause} ORDER BY bt.created_at DESC`, account_id ? [account_id] : []);
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.delete('/transactions/:id', authenticate, hasUserPerm('finance.bank-cash.edit'), auditLog('Bank & Cash', 'Delete Bank Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    await reverseBankTransaction(req.params.id);
    res.json({ message: 'Transaction deleted and reversed' });
  } catch (error: any) {
    res.status(error.message?.includes('not found') ? 404 : 400).json({ error: error.message });
  }
});

// ==================== BANK TRANSFERS ====================
router.post('/transfers', authenticate, hasUserPerm('finance.bank-cash.create'), auditLog('Bank & Cash', 'Transfer'), async (req: AuthRequest, res: Response) => {
  try {
    await assertPeriodNotLocked(new Date().toISOString().slice(0, 10));
    const { from_account_id, to_account_id, amount, notes } = req.body;
    if (!from_account_id || !to_account_id || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Both accounts and valid amount are required' });
    }
    if (String(from_account_id) === String(to_account_id)) {
      return res.status(400).json({ error: 'From and to accounts must be different' });
    }

    const fromAcct = await query('SELECT * FROM bank_accounts WHERE id = $1', [from_account_id]);
    const toAcct = await query('SELECT * FROM bank_accounts WHERE id = $1', [to_account_id]);
    if (fromAcct.rows.length === 0 || toAcct.rows.length === 0) return res.status(404).json({ error: 'Account not found' });

    const fromBalRow = await query(ACCOUNT_BY_ID_SQL, [from_account_id]);
    const fromBalance = computeAccountBalance(fromBalRow.rows[0]);
    const parsedAmount = parseFloat(String(amount));
    if (parsedAmount > fromBalance) {
      return res.status(400).json({ error: `Insufficient balance. Available: ${formatCurrency(fromBalance)}` });
    }

    const from = fromAcct.rows[0];
    const to = toAcct.rows[0];
    const isFromCashHand = from.account_type === 'Cash on Hand';
    const isToCashHand = to.account_type === 'Cash on Hand';
    const isFromChecksOnHand = from.account_type === 'Checks on Hand';
    const transferId = uuidv4();
    const fromGl = resolveAccountGlCode(from);
    const toGl = resolveAccountGlCode(to);
    const postGlEntry = fromGl !== toGl;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      await client.query('UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [parsedAmount, from_account_id]);
      await client.query('UPDATE bank_accounts SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [parsedAmount, to_account_id]);

      if (isFromCashHand) {
        await client.query(
          `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
           VALUES ($1,$2,'Cash Out',$3,'Bank Transfer',$4,$5,$6)`,
          [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), parsedAmount, transferId, notes || '', req.user!.id],
        );
      } else {
        await client.query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by)
           VALUES ($1,$2,'Withdrawal',$3,CURRENT_DATE,'Bank Transfer',$4,$5,$6)`,
          [uuidv4(), from_account_id, parsedAmount, transferId, notes || '', req.user!.id],
        );
      }

      if (isToCashHand) {
        await client.query(
          `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
           VALUES ($1,$2,'Cash In',$3,'Bank Transfer',$4,$5,$6)`,
          [uuidv4(), await generateRefNumber('CT', 'cash_transactions', 'transaction_number'), parsedAmount, transferId, notes || '', req.user!.id],
        );
      } else {
        await client.query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, reference_type, reference_id, notes, created_by)
           VALUES ($1,$2,'Deposit',$3,CURRENT_DATE,'Bank Transfer',$4,$5,$6)`,
          [uuidv4(), to_account_id, parsedAmount, transferId, notes || '', req.user!.id],
        );
      }

      if (isFromChecksOnHand && req.body.receipt_ids && Array.isArray(req.body.receipt_ids)) {
        for (const rid of req.body.receipt_ids) {
          const cr = await client.query('SELECT * FROM collection_receipts WHERE id = $1', [rid]);
          if (cr.rows.length > 0 && !cr.rows[0].deposited) {
            await client.query('UPDATE collection_receipts SET deposited = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [rid]);
          }
        }
      }

      if (postGlEntry) {
        const entryId = uuidv4();
        const entryNumber = await generateJENumber();
        const desc = `Transfer from ${from.bank_name} to ${to.bank_name}`;
        await client.query(
          `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
           VALUES ($1,$2,CURRENT_DATE,'Bank Transfer',$3,$4,$5,$5,$6)`,
          [entryId, entryNumber, transferId, desc, parsedAmount, req.user!.id],
        );
        await client.query(
          `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
           VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,'Bank Transfer',$6),
                  ($7,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$8),$9,0,$5,'Bank Transfer',$6)`,
          [uuidv4(), entryId, toGl, `Transfer to ${to.account_name}`, parsedAmount, transferId, uuidv4(), fromGl, `Transfer from ${from.account_name}`],
        );
      }

      await client.query('COMMIT');
      res.json({ message: 'Transfer complete', gl_posted: postGlEntry });
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Undeposited checks — list collection receipts debited to Checks on Hand (1015)
router.get('/checks-on-hand', authenticate, bankCashView, async (req: AuthRequest, res: Response) => {
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
router.get('/accounts/:id/reconciliation', authenticate, bankCashView, async (req: AuthRequest, res: Response) => {
  try {
    const bank = await query('SELECT * FROM bank_accounts WHERE id = $1', [req.params.id]);
    if (bank.rows.length === 0) return res.status(404).json({ error: 'Bank account not found' });
    const ba = bank.rows[0];
    const txns = await query(
      `SELECT bt.*, u.full_name as cleared_by_name
       FROM bank_transactions bt
       LEFT JOIN users u ON bt.cleared_by = u.id
       WHERE bt.bank_account_id = $1
       ORDER BY bt.transaction_date DESC, bt.created_at DESC`,
      [req.params.id]
    );
    const cleared = txns.rows.filter((t: any) => t.is_cleared);
    const uncleared = txns.rows.filter((t: any) => !t.is_cleared);
    const clearedBalance = cleared.reduce((s: number, t: any) => {
      const amt = parseFloat(t.amount);
      return s + (t.transaction_type === 'Deposit' ? amt : -amt);
    }, 0);
    const unclearedTotal = uncleared.reduce((s: number, t: any) => {
      const amt = parseFloat(t.amount);
      return s + (t.transaction_type === 'Deposit' ? amt : -amt);
    }, 0);
    let bookBalance = parseFloat(ba.balance);
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
    }
    res.json({
      account: ba,
      book_balance: bookBalance,
      cleared_balance: clearedBalance,
      uncleared_total: unclearedTotal,
      transactions: txns.rows,
      cleared_count: cleared.length,
      uncleared_count: uncleared.length,
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.patch('/transactions/:id/clear', authenticate, hasUserPerm('finance.bank-cash.edit'), auditLog('Bank & Cash', 'Clear Transaction'), async (req: AuthRequest, res: Response) => {
  try {
    const { cleared } = req.body;
    const isCleared = cleared !== false;
    await query(
      `UPDATE bank_transactions SET is_cleared = $1, cleared_at = $2, cleared_by = $3 WHERE id = $4 RETURNING *`,
      [isCleared, isCleared ? new Date() : null, isCleared ? req.user!.id : null, req.params.id]
    );
    res.json({ message: isCleared ? 'Transaction marked cleared' : 'Transaction marked uncleared' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/reconcile', authenticate, hasUserPerm('finance.bank-cash.create'), auditLog('Bank & Cash', 'Reconcile'), async (req: AuthRequest, res: Response) => {
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
    const clearedResult = await query(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE -amount END), 0) as cleared_sum
       FROM bank_transactions WHERE bank_account_id = $1 AND is_cleared = true`,
      [bank_account_id]
    );
    const clearedSum = parseFloat(clearedResult.rows[0]?.cleared_sum || 0);
    res.json({
      bank_account: ba,
      book_balance: bookBalance,
      cleared_balance: clearedSum,
      statement_balance,
      difference,
      as_of_date,
      is_reconciled: Math.abs(difference) < 0.01,
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.delete('/accounts/:id', authenticate, hasUserPerm('finance.bank-cash.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query("UPDATE bank_accounts SET is_active = false WHERE id = $1 RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    res.json({ message: 'Account deactivated' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;
