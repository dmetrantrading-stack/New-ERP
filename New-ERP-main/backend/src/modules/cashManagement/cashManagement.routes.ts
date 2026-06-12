import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const generateRefNumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(transaction_number, 4) AS INTEGER)), 0) + 1 as next FROM cash_transactions WHERE transaction_number ~ '^CT-'");
  return `CT-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

const generateJENumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(entry_number, 4) AS INTEGER)), 0) + 1 as next FROM journal_entries WHERE entry_number ~ '^JE-'");
  return `JE-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
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
      `SELECT ct.*, u.full_name as created_by_name
       FROM cash_transactions ct
       LEFT JOIN users u ON ct.created_by = u.id
       WHERE 1=1 ${whereClause}
       ORDER BY ct.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/cash-in', authenticate, auditLog('Cash Management', 'Cash In'), async (req: AuthRequest, res: Response) => {
  try {
    const txnNumber = await generateRefNumber();
    const { amount, notes } = req.body;
    const id = uuidv4();

    await query(
      `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by)
       VALUES ($1, $2, 'Cash In', $3, $4, $5)`,
      [id, txnNumber, amount, notes, req.user!.id]
    );

    // Journal entry: Debit Cash on Hand (1000), Credit Owner's Capital (3000)
    const entryId = uuidv4();
    const entryNumber = await generateJENumber();

    await query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Cash In', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, id, `Cash In ${txnNumber}`, amount, req.user!.id]
    );

    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1000'), $3, $4, 0, 'Cash In', $5),
              ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '3000'), $7, 0, $4, 'Cash In', $5)`,
      [uuidv4(), entryId, `Cash In ${txnNumber}`, amount, id,
       uuidv4(), `Cash In ${txnNumber}`]
    );

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/cash-out', authenticate, auditLog('Cash Management', 'Cash Out'), async (req: AuthRequest, res: Response) => {
  try {
    const txnNumber = await generateRefNumber();
    const { amount, notes } = req.body;
    const id = uuidv4();

    await query(
      `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by)
       VALUES ($1, $2, 'Cash Out', $3, $4, $5)`,
      [id, txnNumber, amount, notes, req.user!.id]
    );

    // Journal entry: Debit Owner's Drawings (3010), Credit Cash on Hand (1000)
    const entryId = uuidv4();
    const entryNumber = await generateJENumber();

    await query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Cash Out', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, id, `Cash Out ${txnNumber}`, amount, req.user!.id]
    );

    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '3010'), $3, $4, 0, 'Cash Out', $5),
              ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1000'), $7, 0, $4, 'Cash Out', $5)`,
      [uuidv4(), entryId, `Cash Out ${txnNumber}`, amount, id,
       uuidv4(), `Cash Out ${txnNumber}`]
    );

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/petty-cash', authenticate, auditLog('Cash Management', 'Petty Cash'), async (req: AuthRequest, res: Response) => {
  try {
    const txnNumber = await generateRefNumber();
    const { amount, notes } = req.body;
    const id = uuidv4();

    await query(
      `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, notes, created_by)
       VALUES ($1, $2, 'Petty Cash', $3, $4, $5)`,
      [id, txnNumber, amount, notes, req.user!.id]
    );

    // Journal entry: Debit Miscellaneous Expense (6080), Credit Cash on Hand (1000)
    const entryId = uuidv4();
    const entryNumber = await generateJENumber();
    await query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Petty Cash', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, id, `Petty Cash ${txnNumber}`, amount, amount, req.user!.id]
    );
    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '6080'), $3, $4, 0, 'Petty Cash', $5),
              ($6, $2, (SELECT id FROM chart_of_accounts WHERE account_code = '1000'), $7, 0, $4, 'Petty Cash', $5)`,
      [uuidv4(), entryId, `Petty Cash ${txnNumber}`, amount, id,
       uuidv4(), `Petty Cash ${txnNumber}`]
    );

    res.status(201).json({ id, transaction_number: txnNumber });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// X-Reading (current shift summary)
router.get('/x-reading', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const shift = await query(
      "SELECT * FROM pos_shifts WHERE user_id = $1 AND status = 'Open' ORDER BY created_at DESC LIMIT 1",
      [req.user!.id]
    );
    if (shift.rows.length === 0) return res.json({ message: 'No open shift' });

    res.json({
      shift: shift.rows[0],
      opening_cash: shift.rows[0].opening_cash,
      cash_sales: shift.rows[0].cash_sales,
      gcash_sales: shift.rows[0].gcash_sales,
      maya_sales: shift.rows[0].maya_sales,
      card_sales: shift.rows[0].card_sales,
      charge_sales: shift.rows[0].charge_sales,
      total_sales: shift.rows[0].total_sales,
      discounts: shift.rows[0].discount_total,
      returns: shift.rows[0].return_total,
      net_sales: shift.rows[0].net_sales,
      expected_cash: parseFloat(shift.rows[0].opening_cash) + parseFloat(shift.rows[0].cash_sales) - parseFloat(shift.rows[0].return_total),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query("UPDATE cash_transactions SET status = 'Void' WHERE id = $1 AND status != 'Void' RETURNING *", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Transaction not found or already voided' });
    res.json({ message: 'Transaction voided' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;
