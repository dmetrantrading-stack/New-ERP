import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import { assertPeriodNotLocked } from '../../utils/periodLock';
import { resolveAccountGlCode } from '../../utils/bankCashOperations';

const router = Router();

const ACCRUAL_PAYABLE_CODE = '2000';

const generateRefNumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(expense_number, 4) AS INTEGER)), 0) + 1 as next FROM expenses WHERE expense_number ~ '^EX-'");
  return `EX-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const nextJeNumber = async (): Promise<string> => {
  const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next FROM journal_entries WHERE entry_number ~ '^JE-'");
  return `JE-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

const nextCtNumber = async (): Promise<string> => {
  const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_number, 4) AS INTEGER)), 0) + 1 as next FROM cash_transactions WHERE transaction_number ~ '^CT-[0-9]+$'");
  return `CT-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

const isBankPayment = (method?: string) => method === 'Check' || method === 'Bank Transfer';

const creditAccountForPayment = (method?: string) => (isBankPayment(method) ? '1010' : '1000');

async function getExpenseCategoryCode(categoryId: number | string): Promise<string> {
  const cat = await query('SELECT account_code FROM expense_categories WHERE id = $1', [categoryId]);
  return cat.rows[0]?.account_code || '6080';
}

async function postJournalEntry(params: {
  entryDate: string | Date;
  referenceType: string;
  referenceId: string;
  description: string;
  amount: number;
  debitAccountCode: string;
  creditAccountCode: string;
  userId: string;
}) {
  const entryId = uuidv4();
  const entryNumber = await nextJeNumber();
  const { entryDate, referenceType, referenceId, description, amount, debitAccountCode, creditAccountCode, userId } = params;

  await query(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
    [entryId, entryNumber, entryDate, referenceType, referenceId, description, amount, userId],
  );

  await query(
    `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
     VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, 0, $6, $7),
            ($8, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $9), $10, 0, $5, $6, $7)`,
    [
      uuidv4(), entryId, debitAccountCode, description, amount, referenceType, referenceId,
      uuidv4(), creditAccountCode, description,
    ],
  );
}

async function recordCashOut(expenseId: string, expenseNumber: string, amount: number, userId: string, note?: string) {
  await query(
    `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
     VALUES ($1, $2, 'Cash Out', $3, 'Expense', $4, $5, $6)`,
    [uuidv4(), await nextCtNumber(), amount, expenseId, note || `Expense ${expenseNumber}`, userId],
  );
}

async function recordBankWithdrawal(
  bankAccountId: number,
  amount: number,
  expenseId: string,
  expenseNumber: string,
  userId: string,
  note?: string,
) {
  await query(
    `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, reference_type, reference_id, transaction_date, notes, created_by)
     VALUES ($1, $2, 'Withdrawal', $3, 'Expense', $4, CURRENT_DATE, $5, $6)`,
    [uuidv4(), bankAccountId, amount, expenseId, note || `Expense ${expenseNumber}`, userId],
  );
  await query(
    `UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [amount, bankAccountId],
  );
}

async function resolveBankGlCode(bankAccountId?: number | string | null): Promise<string> {
  if (!bankAccountId) return '1010';
  const bank = await query('SELECT account_type, gl_account_code FROM bank_accounts WHERE id = $1', [bankAccountId]);
  if (bank.rows.length === 0) return '1010';
  return resolveAccountGlCode(bank.rows[0]);
}

async function postExpenseAccrual(
  expenseId: string,
  expenseNumber: string,
  expenseDate: string | Date,
  amount: number,
  categoryId: number | string,
  userId: string,
) {
  const accountCode = await getExpenseCategoryCode(categoryId);
  await postJournalEntry({
    entryDate: expenseDate,
    referenceType: 'Expense',
    referenceId: expenseId,
    description: `Expense ${expenseNumber}`,
    amount,
    debitAccountCode: accountCode,
    creditAccountCode: ACCRUAL_PAYABLE_CODE,
    userId,
  });
}

async function postExpensePaidInFull(
  expenseId: string,
  expenseNumber: string,
  expenseDate: string | Date,
  amount: number,
  categoryId: number | string,
  paymentMethod: string,
  userId: string,
  bankAccountId?: number | null,
) {
  const accountCode = await getExpenseCategoryCode(categoryId);
  const creditCode = isBankPayment(paymentMethod)
    ? await resolveBankGlCode(bankAccountId)
    : creditAccountForPayment(paymentMethod);

  await postJournalEntry({
    entryDate: expenseDate,
    referenceType: 'Expense',
    referenceId: expenseId,
    description: `Expense ${expenseNumber}`,
    amount,
    debitAccountCode: accountCode,
    creditAccountCode: creditCode,
    userId,
  });

  if (isBankPayment(paymentMethod)) {
    const bankId = bankAccountId || (await query('SELECT id FROM bank_accounts WHERE is_active = true LIMIT 1')).rows[0]?.id;
    if (bankId) await recordBankWithdrawal(bankId, amount, expenseId, expenseNumber, userId);
  } else {
    await recordCashOut(expenseId, expenseNumber, amount, userId);
  }
}

router.get('/', authenticate, hasUserPerm('finance.expenses.view'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const from = req.query.from as string;
    const to = req.query.to as string;
    const category_id = req.query.category_id as string;

    let whereClause = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (from) { whereClause += ` AND e.expense_date >= $${paramIndex}`; params.push(from); paramIndex++; }
    if (to) { whereClause += ` AND e.expense_date <= $${paramIndex}`; params.push(to); paramIndex++; }
    if (category_id) { whereClause += ` AND e.category_id = $${paramIndex}`; params.push(category_id); paramIndex++; }

    const total = await query(`SELECT COUNT(*) FROM expenses e WHERE 1=1 ${whereClause}`, params);
    const result = await query(
      `SELECT e.*, ec.name as category_name, u.full_name as created_by_name,
              ba.bank_name, ba.account_name as bank_account_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON e.category_id = ec.id
       LEFT JOIN users u ON e.created_by = u.id
       LEFT JOIN bank_accounts ba ON e.bank_account_id = ba.id
       WHERE 1=1 ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, hasUserPerm('finance.expenses.create'), auditLog('Expenses', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      category_id, description, amount, expense_date, payment_method, reference_number, notes,
      pay_now, bank_account_id,
    } = req.body;
    const payNow = pay_now !== false;
    const expDate = expense_date || new Date().toISOString().slice(0, 10);
    await assertPeriodNotLocked(expDate);

    if (!category_id) return res.status(400).json({ error: 'Category is required' });
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Valid amount required' });
    if (payNow && isBankPayment(payment_method) && !bank_account_id) {
      return res.status(400).json({ error: 'Bank account is required for check or bank transfer' });
    }

    const expense_number = await generateRefNumber();
    const id = uuidv4();
    const parsedAmount = parseFloat(amount);
    const status = payNow ? 'Posted' : 'Draft';

    await query(
      `INSERT INTO expenses (id, expense_number, category_id, description, amount, expense_date, payment_method, reference_number, notes, status, bank_account_id, payment_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id, expense_number, category_id, description, parsedAmount, expDate,
        payNow ? (payment_method || 'Cash') : null,
        payNow ? reference_number : null,
        notes, status,
        payNow && isBankPayment(payment_method) ? bank_account_id : null,
        payNow ? expDate : null,
        req.user!.id,
      ],
    );

    if (payNow) {
      await postExpensePaidInFull(
        id, expense_number, expDate, parsedAmount, category_id,
        payment_method || 'Cash', req.user!.id,
        bank_account_id ? parseInt(bank_account_id, 10) : null,
      );
    } else {
      await postExpenseAccrual(id, expense_number, expDate, parsedAmount, category_id, req.user!.id);
    }

    res.status(201).json({ id, expense_number, status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/pay', authenticate, hasUserPerm('finance.expenses.edit'), auditLog('Expenses', 'Pay'), async (req: AuthRequest, res: Response) => {
  try {
    const exp = await query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (exp.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    const row = exp.rows[0];
    if (row.status !== 'Draft') return res.status(400).json({ error: 'Only unpaid (Draft) expenses can be paid' });
    if (row.status === 'Cancelled') return res.status(400).json({ error: 'Expense is cancelled' });

    const { payment_method, reference_number, payment_date, bank_account_id, notes } = req.body;
    if (!payment_method) return res.status(400).json({ error: 'Payment method is required' });
    if (isBankPayment(payment_method) && !bank_account_id) {
      return res.status(400).json({ error: 'Bank account is required for check or bank transfer' });
    }

    const payDate = payment_date || new Date().toISOString().slice(0, 10);
    await assertPeriodNotLocked(payDate);
    const amount = parseFloat(row.amount);

    const creditCode = isBankPayment(payment_method)
      ? await resolveBankGlCode(bank_account_id)
      : creditAccountForPayment(payment_method);

    await postJournalEntry({
      entryDate: payDate,
      referenceType: 'Expense Payment',
      referenceId: row.id,
      description: `Payment ${row.expense_number}`,
      amount,
      debitAccountCode: ACCRUAL_PAYABLE_CODE,
      creditAccountCode: creditCode,
      userId: req.user!.id,
    });

    if (isBankPayment(payment_method)) {
      await recordBankWithdrawal(parseInt(bank_account_id, 10), amount, row.id, row.expense_number, req.user!.id);
    } else {
      await recordCashOut(row.id, row.expense_number, amount, req.user!.id, `Payment ${row.expense_number}`);
    }

    await query(
      `UPDATE expenses SET status = 'Posted', payment_method = $1, reference_number = $2, payment_date = $3,
              bank_account_id = $4, notes = COALESCE($5, notes), updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [
        payment_method,
        reference_number || null,
        payDate,
        isBankPayment(payment_method) ? bank_account_id : null,
        notes || null,
        row.id,
      ],
    );

    res.json({ id: row.id, expense_number: row.expense_number, status: 'Posted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, hasUserPerm('finance.expenses.edit'), auditLog('Expenses', 'Edit'), async (req: AuthRequest, res: Response) => {
  try {
    const exp = await query('SELECT * FROM expenses WHERE id = $1', [req.params.id]);
    if (exp.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    if (exp.rows[0].status === 'Cancelled') return res.status(400).json({ error: 'Cannot edit cancelled expense' });

    const { category_id, description, amount, expense_date, payment_method, reference_number, notes } = req.body;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Valid amount required' });

    const row = exp.rows[0];
    const isDraft = row.status === 'Draft';
    const oldAmount = parseFloat(row.amount);
    const newAmount = parseFloat(amount);
    const catId = category_id || row.category_id;
    const expDate = expense_date || row.expense_date;

    await query(
      `UPDATE expenses SET category_id = $1, description = $2, amount = $3, expense_date = $4,
              payment_method = $5, reference_number = $6, notes = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8`,
      [catId, description, newAmount, expDate, payment_method || row.payment_method, reference_number, notes, req.params.id],
    );

    await query(
      `UPDATE journal_entries SET status = 'Void'
       WHERE reference_id = $1 AND reference_type IN ('Expense', 'Expense Payment') AND status = 'Posted'`,
      [req.params.id],
    );

    if (isDraft) {
      await postExpenseAccrual(req.params.id, row.expense_number, expDate, newAmount, catId, req.user!.id);
      res.json({ id: req.params.id, expense_number: row.expense_number, status: 'Draft' });
      return;
    }

    const oldIsBank = isBankPayment(row.payment_method);
    if (oldIsBank) {
      const bank = await query('SELECT id FROM bank_accounts WHERE id = $1 OR is_active = true LIMIT 1', [row.bank_account_id]);
      if (bank.rows.length > 0) {
        await query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
           VALUES ($1, $2, 'Deposit', $3, CURRENT_DATE, $4, $5)`,
          [uuidv4(), bank.rows[0].id, oldAmount, `Reverse edit ${row.expense_number}`, req.user!.id],
        );
        await query('UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2', [oldAmount, bank.rows[0].id]);
      }
    } else {
      await query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Cash In', $3, 'Expense', $4, $5, $6)`,
        [uuidv4(), `CT-REV-${Date.now().toString().slice(-5)}`, oldAmount, req.params.id, `Reverse edit ${row.expense_number}`, req.user!.id],
      );
    }

    await postExpensePaidInFull(
      req.params.id, row.expense_number, expDate, newAmount, catId,
      payment_method || row.payment_method || 'Cash', req.user!.id,
      row.bank_account_id,
    );

    res.json({ id: req.params.id, expense_number: row.expense_number });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, hasUserPerm('finance.expenses.edit'), auditLog('Expenses', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      "UPDATE expenses SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status != 'Cancelled' RETURNING *",
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found or already cancelled' });

    await query(
      `UPDATE journal_entries SET status = 'Void'
       WHERE reference_id = $1 AND reference_type IN ('Expense', 'Expense Payment') AND status = 'Posted'`,
      [req.params.id],
    );

    res.json({ message: 'Expense cancelled' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/categories', authenticate, hasUserPerm('finance.expenses.view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM expense_categories WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/categories', authenticate, hasUserPerm('finance.expenses.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, account_code } = req.body;
    if (!name || !account_code) return res.status(400).json({ error: 'Name and account code are required' });
    const result = await query(
      'INSERT INTO expense_categories (name, account_code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [name, account_code],
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'Category already exists' });
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
