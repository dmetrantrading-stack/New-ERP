import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const generateRefNumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(expense_number, 4) AS INTEGER)), 0) + 1 as next FROM expenses WHERE expense_number ~ '^EX-'");
  return `EX-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
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
      `SELECT e.*, ec.name as category_name, u.full_name as created_by_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON e.category_id = ec.id
       LEFT JOIN users u ON e.created_by = u.id
       WHERE 1=1 ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, hasUserPerm('finance.expenses.create'), auditLog('Expenses', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const expense_number = await generateRefNumber();
    const { category_id, description, amount, expense_date, payment_method, reference_number, notes } = req.body;
    const id = uuidv4();

    await query(
      `INSERT INTO expenses (id, expense_number, category_id, description, amount, expense_date, payment_method, reference_number, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, expense_number, category_id, description, amount, expense_date || new Date(), payment_method, reference_number, notes, req.user!.id]
    );

    // Accounting entry
    const entryId = uuidv4();
    const entryNumber = await (async () => {
      const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next FROM journal_entries WHERE entry_number ~ '^JE-'");
      return `JE-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
    })();

    const cat = await query('SELECT name, account_code FROM expense_categories WHERE id = $1', [category_id]);
    const accountCode = cat.rows[0]?.account_code || '6080';

    await query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, $3, 'Expense', $4, $5, $6, $6, $7)`,
      [entryId, entryNumber, expense_date || new Date(), id, `Expense ${expense_number}`, amount, req.user!.id]
    );

    // Route credit by payment method
    const isBankPayment = payment_method === 'Check' || payment_method === 'Bank Transfer';
    const creditAccount = isBankPayment ? '1010' : '1000';

    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, 0, 'Expense', $6),
              ($7, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $8), $9, 0, $5, 'Expense', $6)`,
      [uuidv4(), entryId, accountCode, `Expense ${expense_number}`, amount, id,
       uuidv4(), creditAccount, `Expense ${expense_number}`]
    );

    // Cash/Bank transaction
    if (isBankPayment) {
      const bank = await query('SELECT id FROM bank_accounts WHERE is_active = true LIMIT 1');
      if (bank.rows.length > 0) {
        await query(
          `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
           VALUES ($1, $2, 'Withdrawal', $3, CURRENT_DATE, $4, $5)`,
          [uuidv4(), bank.rows[0].id, amount, `Expense ${expense_number}`, req.user!.id]
        );
        await query(`UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [amount, bank.rows[0].id]);
      }
    } else {
      await query(
        `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
         VALUES ($1, $2, 'Cash Out', $3, 'Expense', $4, $5, $6)`,
        [uuidv4(), await (async () => {
          const r = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_number, 4) AS INTEGER)), 0) + 1 as next FROM cash_transactions WHERE transaction_number ~ '^CT-'");
          return `CT-${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
        })(), amount, id, `Expense ${expense_number}`, req.user!.id]
      );
    }

    res.status(201).json({ id, expense_number });
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

    const oldAmount = parseFloat(exp.rows[0].amount);

    await query(
      `UPDATE expenses SET category_id = $1, description = $2, amount = $3, expense_date = $4, payment_method = $5, reference_number = $6, notes = $7, updated_at = CURRENT_TIMESTAMP WHERE id = $8`,
      [category_id || exp.rows[0].category_id, description, amount, expense_date || exp.rows[0].expense_date, payment_method || exp.rows[0].payment_method, reference_number, notes, req.params.id]
    );

    // Void old JE + reverse transactions
    await query("UPDATE journal_entries SET status = 'Void' WHERE reference_type = 'Expense' AND reference_id = $1 AND status = 'Posted'", [req.params.id]);
    // Reverse old cash/bank transaction
    const oldIsBank = exp.rows[0].payment_method === 'Check' || exp.rows[0].payment_method === 'Bank Transfer';
    if (oldIsBank) {
      const bank = await query('SELECT id FROM bank_accounts WHERE is_active = true LIMIT 1');
      if (bank.rows.length > 0) {
        await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by) VALUES ($1,$2,'Deposit',$3,CURRENT_DATE,$4,$5)`, [uuidv4(), bank.rows[0].id, oldAmount, `Reverse edit ${exp.rows[0].expense_number}`, req.user!.id]);
        await query('UPDATE bank_accounts SET balance = balance + $1 WHERE id = $2', [oldAmount, bank.rows[0].id]);
      }
    } else {
      await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by) VALUES ($1,$2,'Cash In',$3,'Expense',$4,$5,$6)`, [uuidv4(), 'CT-REV-' + Date.now().toString().slice(-5), oldAmount, req.params.id, `Reverse edit ${exp.rows[0].expense_number}`, req.user!.id]);
    }
    // Create new JE
    const entryId = uuidv4(); const entryNumber = 'JE-' + String(Date.now()).slice(-5);
    const cat = await query('SELECT account_code FROM expense_categories WHERE id = $1', [category_id || exp.rows[0].category_id]);
    const accountCode = cat.rows[0]?.account_code || '6080';
    const isBank = (payment_method || exp.rows[0].payment_method) === 'Check' || (payment_method || exp.rows[0].payment_method) === 'Bank Transfer';
    const creditAccount = isBank ? '1010' : '1000';
    await query(`INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by) VALUES ($1,$2,$3,'Expense',$4,$5,$6,$6,$7)`, [entryId, entryNumber, expense_date || exp.rows[0].expense_date, req.params.id, `Expense ${exp.rows[0].expense_number} (edited)`, parseFloat(amount), req.user!.id]);
    await query(`INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id) VALUES ($1,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$3),$4,$5,0,'Expense',$6),($7,$2,(SELECT id FROM chart_of_accounts WHERE account_code=$8),$9,0,$5,'Expense',$6)`, [uuidv4(), entryId, accountCode, `Expense ${exp.rows[0].expense_number}`, parseFloat(amount), req.params.id, uuidv4(), creditAccount, `Expense ${exp.rows[0].expense_number}`]);
    if (isBank) {
      const bank = await query('SELECT id FROM bank_accounts WHERE is_active = true LIMIT 1');
      if (bank.rows.length > 0) {
        await query(`INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by) VALUES ($1,$2,'Withdrawal',$3,CURRENT_DATE,$4,$5)`, [uuidv4(), bank.rows[0].id, parseFloat(amount), `Expense ${exp.rows[0].expense_number}`, req.user!.id]);
        await query('UPDATE bank_accounts SET balance = balance - $1 WHERE id = $2', [parseFloat(amount), bank.rows[0].id]);
      }
    } else {
      await query(`INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by) VALUES ($1,$2,'Cash Out',$3,'Expense',$4,$5,$6)`, [uuidv4(), 'CT-EDT-' + Date.now().toString().slice(-5), parseFloat(amount), req.params.id, `Expense ${exp.rows[0].expense_number} (edited)`, req.user!.id]);
    }

    res.json({ id: req.params.id, expense_number: exp.rows[0].expense_number });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      "UPDATE expenses SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status != 'Cancelled' RETURNING *",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found or already cancelled' });
    res.json({ message: 'Expense cancelled' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/categories', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM expense_categories WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/categories', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, account_code } = req.body;
    if (!name || !account_code) return res.status(400).json({ error: 'Name and account code are required' });
    const result = await query(
      'INSERT INTO expense_categories (name, account_code) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [name, account_code]
    );
    if (result.rows.length === 0) return res.status(409).json({ error: 'Category already exists' });
    res.status(201).json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;
