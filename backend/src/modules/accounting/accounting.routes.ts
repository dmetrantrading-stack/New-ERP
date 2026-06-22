import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { runTransactionAudit } from '../../utils/transactionAudit';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { auditAfter, auditBefore, auditSnapshot, AUDIT_FIELDS } from '../../utils/auditHelpers';
import { getApAgingReport, getArAgingReport } from '../../utils/financeAging';
import { COA_PERIOD_BALANCE_SUBQUERY, listChartOfAccountsWithBalance } from '../../utils/chartOfAccountsBalance';
import { findDuplicateCogsInvoices, repairDuplicateInvoiceCogs } from '../../utils/glIntegrity';

const router = Router();

// ==================== CHART OF ACCOUNTS ====================
router.get('/chart-of-accounts', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const asOf = req.query.as_of as string | undefined;
    const rows = await listChartOfAccountsWithBalance(asOf);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/chart-of-accounts', authenticate, hasUserPerm('finance.accounting.edit'), auditLog('Accounting', 'Create Account'), async (req: AuthRequest, res: Response) => {
  try {
    const { account_code, account_name, account_type, parent_id } = req.body;
    if (!account_code || !account_name || !account_type) {
      return res.status(400).json({ error: 'Account code, name, and type are required' });
    }
    const result = await query(
      'INSERT INTO chart_of_accounts (account_code, account_name, account_type, parent_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [account_code, account_name, account_type, parent_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: 'Account code already exists' });
    res.status(500).json({ error: error.message });
  }
});

router.put('/chart-of-accounts/:id', authenticate, hasUserPerm('finance.accounting.edit'), auditLog('Accounting', 'Edit Account'), async (req: AuthRequest, res: Response) => {
  try {
    const { account_code, account_name, account_type, parent_id, is_active } = req.body;
    if (!account_code || !account_name || !account_type) {
      return res.status(400).json({ error: 'Account code, name, and type are required' });
    }
    // Check uniqueness (exclude self)
    const dup = await query('SELECT id FROM chart_of_accounts WHERE account_code = $1 AND id != $2', [account_code, req.params.id]);
    if (dup.rows.length > 0) return res.status(409).json({ error: 'Account code already exists' });

    const existing = await query('SELECT * FROM chart_of_accounts WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    auditBefore(req, auditSnapshot(existing.rows[0], AUDIT_FIELDS.chartAccount));

    const result = await query(
      `UPDATE chart_of_accounts SET account_code = $1, account_name = $2, account_type = $3,
        parent_id = $4, is_active = COALESCE($5, is_active), updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 RETURNING *`,
      [account_code, account_name, account_type, parent_id || null, is_active !== undefined ? is_active : null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    auditAfter(req, auditSnapshot(result.rows[0], AUDIT_FIELDS.chartAccount));
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: 'Account code already exists' });
    res.status(500).json({ error: error.message }); }
});

// ==================== JOURNAL ENTRIES ====================
router.get('/journal-entries', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const from = req.query.from as string;
    const to = req.query.to as string;

    let whereClause = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (from) { whereClause += ` AND je.entry_date >= $${paramIndex}`; params.push(from); paramIndex++; }
    if (to) { whereClause += ` AND je.entry_date <= $${paramIndex}`; params.push(to); paramIndex++; }

    const total = await query(`SELECT COUNT(*) FROM journal_entries je WHERE 1=1 ${whereClause}`, params);
    const result = await query(
      `SELECT je.*, u.full_name as created_by_name
       FROM journal_entries je
       LEFT JOIN users u ON je.created_by = u.id
       WHERE 1=1 ${whereClause}
       ORDER BY je.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/journal-entries/:id', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const entry = await query('SELECT * FROM journal_entries WHERE id = $1', [req.params.id]);
    if (entry.rows.length === 0) return res.status(404).json({ error: 'Journal entry not found' });

    const lines = await query(
      `SELECT jel.*, coa.account_code, coa.account_name
       FROM journal_entry_lines jel
       JOIN chart_of_accounts coa ON jel.account_id = coa.id
       WHERE jel.entry_id = $1
       ORDER BY jel.id`,
      [req.params.id]
    );

    res.json({ ...entry.rows[0], lines: lines.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== GENERAL LEDGER ====================
router.get('/general-ledger', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const account_id = req.query.account_id as string;
    const from = req.query.from as string;
    const to = req.query.to as string;

    let whereClause = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (account_id) { whereClause += ` AND jel.account_id = $${paramIndex}`; params.push(account_id); paramIndex++; }
    if (from) { whereClause += ` AND je.entry_date >= $${paramIndex}`; params.push(from); paramIndex++; }
    if (to) { whereClause += ` AND je.entry_date <= $${paramIndex}`; params.push(to); paramIndex++; }

    const result = await query(
      `SELECT je.entry_date, je.entry_number, je.description as entry_description,
              jel.description, jel.debit, jel.credit,
              coa.account_code, coa.account_name, coa.account_type
       FROM journal_entry_lines jel
       JOIN journal_entries je ON jel.entry_id = je.id
       JOIN chart_of_accounts coa ON jel.account_id = coa.id
       WHERE je.status = 'Posted' ${whereClause}
       ORDER BY je.entry_date ASC, je.created_at ASC`,
      params
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TRIAL BALANCE ====================
router.get('/trial-balance', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const asOf = req.query.as_of as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT coa.id, coa.account_code, coa.account_name, coa.account_type,
              COALESCE(SUM(jel.debit), 0) as total_debit,
              COALESCE(SUM(jel.credit), 0) as total_credit
       FROM chart_of_accounts coa
       LEFT JOIN (
         SELECT jel2.account_id, jel2.debit, jel2.credit
         FROM journal_entry_lines jel2
         JOIN journal_entries je ON jel2.entry_id = je.id
         WHERE je.status = 'Posted' AND je.entry_date <= $1
       ) jel ON coa.id = jel.account_id
       GROUP BY coa.id, coa.account_code, coa.account_name, coa.account_type
       HAVING COALESCE(SUM(jel.debit), 0) != COALESCE(SUM(jel.credit), 0) OR COALESCE(SUM(jel.debit), 0) > 0
       ORDER BY coa.account_code`,
      [asOf]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== BALANCE SHEET ====================
router.get('/balance-sheet', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const asOf = req.query.as_of as string || new Date().toISOString().split('T')[0];

    const result = await query(`
      SELECT coa.id, coa.account_type, coa.account_code, coa.account_name,
             COALESCE(SUM(CASE WHEN coa.account_type = 'Asset'
               THEN jel.debit - jel.credit
               ELSE jel.credit - jel.debit END), 0) as balance
      FROM chart_of_accounts coa
      LEFT JOIN (
        SELECT jel2.account_id, jel2.debit, jel2.credit
        FROM journal_entry_lines jel2
        JOIN journal_entries je ON jel2.entry_id = je.id
        WHERE je.status = 'Posted' AND je.entry_date <= $1
      ) jel ON coa.id = jel.account_id
      WHERE coa.account_type IN ('Asset', 'Liability', 'Equity')
      GROUP BY coa.id, coa.account_type, coa.account_code, coa.account_name
      ORDER BY coa.account_type, coa.account_code
    `, [asOf]);

    const assets = result.rows.filter((r: any) => r.account_type === 'Asset');
    const liabilities = result.rows.filter((r: any) => r.account_type === 'Liability');
    const equity = result.rows.filter((r: any) => r.account_type === 'Equity');

    const totalAssets = assets.reduce((sum: number, r: any) => sum + parseFloat(r.balance), 0);
    const totalLiabilities = liabilities.reduce((sum: number, r: any) => sum + parseFloat(r.balance), 0);
    const totalEquity = equity.reduce((sum: number, r: any) => sum + parseFloat(r.balance), 0);

    // Compute net income from P&L accounts up to this date
    const plResult = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN coa.account_type = 'Income' THEN jel.credit - jel.debit ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN coa.account_type IN ('Expense', 'Cost of Goods Sold') THEN jel.debit - jel.credit ELSE 0 END), 0) as net_income
      FROM chart_of_accounts coa
      LEFT JOIN (
        SELECT jel2.account_id, jel2.debit, jel2.credit
        FROM journal_entry_lines jel2
        JOIN journal_entries je ON jel2.entry_id = je.id
        WHERE je.status = 'Posted' AND je.entry_date <= $1
      ) jel ON coa.id = jel.account_id
      WHERE coa.account_type IN ('Income', 'Expense', 'Cost of Goods Sold')
    `, [asOf]);
    const netIncome = parseFloat(plResult.rows[0].net_income);
    const totalEquityWithRetained = totalEquity + netIncome;

    res.json({
      assets, liabilities, equity,
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
      total_equity: totalEquityWithRetained,
      retained_earnings: netIncome,
      total_liabilities_equity: totalLiabilities + totalEquityWithRetained,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== INCOME STATEMENT ====================
router.get('/income-statement', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];
    const includeZero = req.query.include_zero !== 'false';

    const result = await query(`
      SELECT coa.id, coa.account_type, coa.account_code, coa.account_name,
             ${COA_PERIOD_BALANCE_SUBQUERY('$1', '$2')} as balance
       FROM chart_of_accounts coa
       WHERE coa.account_type IN ('Income', 'Expense', 'Cost of Goods Sold')
         AND coa.is_active = true
       ORDER BY coa.account_type, coa.account_code
     `, [from, to]);

    const allIncome = result.rows.filter((r: any) => r.account_type === 'Income');
    const allExpenses = result.rows.filter((r: any) => r.account_type === 'Expense');
    const allCogs = result.rows.filter((r: any) => r.account_type === 'Cost of Goods Sold');

    const totalIncome = allIncome.reduce((sum: number, r: any) => sum + parseFloat(r.balance), 0);
    const totalCogs = allCogs.reduce((sum: number, r: any) => sum + parseFloat(r.balance), 0);
    const totalExpenses = allExpenses.reduce((sum: number, r: any) => sum + parseFloat(r.balance), 0);

    const hasBalance = (r: any) => Math.abs(parseFloat(r.balance)) > 0.009;
    const income = includeZero ? allIncome : allIncome.filter(hasBalance);
    const expenses = includeZero ? allExpenses : allExpenses.filter(hasBalance);
    const cogs = includeZero ? allCogs : allCogs.filter(hasBalance);

    const grossProfit = totalIncome - totalCogs;
    const netIncome = grossProfit - totalExpenses;

    res.json({
      from,
      to,
      income,
      cost_of_goods_sold: cogs,
      expenses,
      total_income: totalIncome,
      total_cogs: totalCogs,
      gross_profit: grossProfit,
      total_expenses: totalExpenses,
      net_income: netIncome,
      gross_margin_pct: totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0,
      net_margin_pct: totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0,
      include_zero: includeZero,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cash flow statement
router.get('/cash-flow', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    // Cash inflows from cash_transactions
    const cashInflows = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM cash_transactions
       WHERE transaction_type IN ('Cash In', 'Collection', 'Opening')
         AND (status IS NULL OR status != 'Void')
         AND created_at::date >= $1 AND created_at::date <= $2`,
      [from, to]
    );

    // Cash outflows from cash_transactions
    const cashOutflows = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM cash_transactions
       WHERE transaction_type IN ('Cash Out', 'Disbursement', 'Petty Cash')
         AND (status IS NULL OR status != 'Void')
         AND created_at::date >= $1 AND created_at::date <= $2`,
      [from, to]
    );

    // Bank inflows (deposits)
    const bankInflows = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM bank_transactions
       WHERE transaction_type = 'Deposit'
         AND created_at::date >= $1 AND created_at::date <= $2`,
      [from, to]
    );

    // Bank outflows (withdrawals)
    const bankOutflows = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM bank_transactions
       WHERE transaction_type = 'Withdrawal'
         AND created_at::date >= $1 AND created_at::date <= $2`,
      [from, to]
    );

    // Breakdown by reference type
    const breakdown = await query(
      `SELECT reference_type, transaction_type, COALESCE(SUM(amount), 0) as total
       FROM cash_transactions
       WHERE (status IS NULL OR status != 'Void')
         AND created_at::date >= $1 AND created_at::date <= $2
       GROUP BY reference_type, transaction_type
       ORDER BY total DESC`,
      [from, to]
    );

    const ci = parseFloat(cashInflows.rows[0].total);
    const co = parseFloat(cashOutflows.rows[0].total);
    const bi = parseFloat(bankInflows.rows[0].total);
    const bo = parseFloat(bankOutflows.rows[0].total);

    res.json({
      cash_inflows: ci,
      cash_outflows: co,
      net_cash_flow: ci - co,
      bank_inflows: bi,
      bank_outflows: bo,
      net_bank_flow: bi - bo,
      total_net_flow: (ci - co) + (bi - bo),
      breakdown: breakdown.rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AR Aging (open sales invoices — same logic as Collections)
router.get('/ar-aging', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await getArAgingReport());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AP Aging (posted AP vouchers — same logic as Payables)
router.get('/ap-aging', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    res.json(await getApAgingReport());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Payables ledger
router.get('/payables', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT s.id, s.supplier_code, s.supplier_name, s.balance,
        (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = s.id AND status IN ('Sent', 'Partial', 'Received')) as po_count
      FROM suppliers s
      WHERE s.balance > 0
      ORDER BY s.balance DESC
    `);
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Shared JOINs / expressions for account drill-down
const ACCOUNT_DETAILS_JOINS = `
       LEFT JOIN users u ON je.created_by = u.id
       LEFT JOIN sales_invoices si ON je.reference_id = si.id AND je.reference_type IN ('Sales Invoice', 'Void Invoice')
       LEFT JOIN pos_transactions pt ON je.reference_id = pt.id AND je.reference_type IN ('POS Sale', 'Void POS')
       LEFT JOIN collection_receipts cr ON je.reference_id = cr.id AND je.reference_type = 'Collection'
       LEFT JOIN payment_vouchers pv ON je.reference_id = pv.id AND je.reference_type = 'Payment Voucher'
       LEFT JOIN ap_vouchers av ON je.reference_id = av.id AND je.reference_type = 'AP Voucher'
       LEFT JOIN goods_receipts gr ON je.reference_id = gr.id AND je.reference_type = 'Goods Receipt'
       LEFT JOIN purchase_returns pr ON je.reference_id = pr.id AND je.reference_type = 'Purchase Return'
       LEFT JOIN sales_returns sr ON je.reference_id = sr.id AND je.reference_type = 'Sales Return'
       LEFT JOIN delivery_notes dn ON je.reference_id = dn.id AND je.reference_type IN ('Delivery Receipt', 'Delivery Receipt Cancel')
       LEFT JOIN inventory_counts ic ON je.reference_id = ic.id AND je.reference_type = 'Inventory Count'
       LEFT JOIN petty_cash_vouchers pcv ON je.reference_id = pcv.id AND je.reference_type = 'Petty Cash'
       LEFT JOIN expenses e ON je.reference_id = e.id AND je.reference_type = 'Expense'
       LEFT JOIN payroll p ON je.reference_id = p.id AND je.reference_type IN ('Payroll', 'Payroll Payment', 'Payroll Cancel')
       LEFT JOIN cash_transactions ct ON je.reference_id = ct.id AND je.reference_type IN ('Cash In', 'Cash Out')
       LEFT JOIN bank_transactions bt ON je.reference_id = bt.id AND je.reference_type IN ('Bank Deposit', 'Bank Withdrawal')
       LEFT JOIN sss_contributions sc ON je.reference_id = sc.id AND je.reference_type IN ('SSS Contribution', 'SSS Payment')
       LEFT JOIN cash_advances ca ON je.reference_id = ca.id AND je.reference_type IN ('Cash Advance', 'Cash Advance Cancel')
       LEFT JOIN employees emp_ca ON ca.employee_id = emp_ca.id
       LEFT JOIN employees emp_sss ON sc.employee_id = emp_sss.id
       LEFT JOIN employees emp_pay ON p.employee_id = emp_pay.id
       LEFT JOIN customers c_cr ON cr.customer_id = c_cr.id
       LEFT JOIN customers c_sr ON sr.customer_id = c_sr.id
       LEFT JOIN customers c_dn ON dn.customer_id = c_dn.id
       LEFT JOIN suppliers s_pv ON pv.supplier_id = s_pv.id
       LEFT JOIN suppliers s_gr ON gr.supplier_id = s_gr.id
       LEFT JOIN suppliers s_pr ON pr.supplier_id = s_pr.id`;

const ACCOUNT_DOC_NUMBER = `COALESCE(
         si.invoice_number, pt.transaction_number, cr.receipt_number, pv.voucher_number, av.apv_number,
         gr.gr_number, pr.pr_number, sr.return_number, dn.dr_number, ic.count_number, pcv.pcv_number,
         e.expense_number, p.payroll_number, ct.transaction_number, sc.contribution_number,
         CASE WHEN je.reference_type IN ('Bank Deposit', 'Bank Withdrawal') THEN 'BT-' || SUBSTRING(bt.id::text, 1, 8) ELSE NULL END,
         je.entry_number)`;

const ACCOUNT_PARTY_NAME = `COALESCE(
         si.customer_name, pt.customer_name, c_cr.customer_name, c_sr.customer_name, c_dn.customer_name,
         s_pv.supplier_name, s_gr.supplier_name, s_pr.supplier_name, pcv.payee,
         NULLIF(TRIM(COALESCE(emp_pay.last_name, '') || ', ' || COALESCE(emp_pay.first_name, '')), ','),
         NULLIF(TRIM(COALESCE(emp_ca.last_name, '') || ', ' || COALESCE(emp_ca.first_name, '')), ','),
         NULLIF(TRIM(COALESCE(emp_sss.last_name, '') || ', ' || COALESCE(emp_sss.first_name, '')), ','),
         '')`;

// ==================== DRILL-DOWN TRANSACTION DETAILS ====================
router.get('/account-details/:accountCode', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const accountCode = req.params.accountCode;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const from = req.query.from as string;
    const to = req.query.to as string;
    const search = req.query.search as string;
    const refType = req.query.ref_type as string;

    const account = await query('SELECT * FROM chart_of_accounts WHERE account_code = $1', [accountCode]);
    if (account.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
    const acc = account.rows[0];

    let whereClause = 'AND coa.account_code = $1';
    const params: any[] = [accountCode];
    let paramIndex = 2;

    if (from) { whereClause += ` AND je.entry_date >= $${paramIndex}`; params.push(from); paramIndex++; }
    if (to) { whereClause += ` AND je.entry_date <= $${paramIndex}`; params.push(to); paramIndex++; }
    if (refType) { whereClause += ` AND je.reference_type = $${paramIndex}`; params.push(refType); paramIndex++; }
    if (search) {
      whereClause += ` AND (
        je.description ILIKE $${paramIndex} OR je.entry_number ILIKE $${paramIndex}
        OR jel.description ILIKE $${paramIndex} OR je.reference_type ILIKE $${paramIndex}
        OR ${ACCOUNT_DOC_NUMBER} ILIKE $${paramIndex}
        OR ${ACCOUNT_PARTY_NAME} ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const baseFrom = `
       FROM journal_entry_lines jel
       JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted'
       JOIN chart_of_accounts coa ON jel.account_id = coa.id
       ${ACCOUNT_DETAILS_JOINS}`;

    const countQuery = await query(
      `SELECT COUNT(*) as total ${baseFrom} WHERE 1=1 ${whereClause}`,
      params
    );

    const signedAmount = acc.account_type === 'Asset' || acc.account_type === 'Expense' || acc.account_type === 'Cost of Goods Sold'
      ? 'jel.debit - jel.credit'
      : 'jel.credit - jel.debit';

    const details = await query(
      `WITH lines AS (
         SELECT je.id AS entry_id, je.entry_number, je.entry_date, je.reference_type, je.reference_id,
                je.description AS je_description, jel.id AS line_id, jel.description AS line_description,
                jel.debit, jel.credit, coa.account_code, coa.account_name, u.full_name AS created_by_name,
                ${ACCOUNT_DOC_NUMBER} AS document_number,
                ${ACCOUNT_PARTY_NAME} AS party_name,
                (${signedAmount}) AS signed_amount
         ${baseFrom}
         WHERE 1=1 ${whereClause}
       ),
       numbered AS (
         SELECT *,
           SUM(signed_amount) OVER (ORDER BY entry_date ASC, entry_number ASC, line_id ASC) AS running_balance
         FROM lines
       )
       SELECT * FROM numbered
       ORDER BY entry_date DESC, entry_number DESC, line_id DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    const refTypes = await query(
      `SELECT DISTINCT je.reference_type ${baseFrom}
       WHERE 1=1 AND coa.account_code = $1 AND je.reference_type IS NOT NULL
       ORDER BY je.reference_type`,
      [accountCode]
    );

    const totals = await query(
      `SELECT COALESCE(SUM(jel.debit), 0) AS total_debit, COALESCE(SUM(jel.credit), 0) AS total_credit
       ${baseFrom}
       WHERE 1=1 ${whereClause}`,
      params
    );

    const td = parseFloat(totals.rows[0].total_debit);
    const tc = parseFloat(totals.rows[0].total_credit);
    const netTotal = acc.account_type === 'Asset' || acc.account_type === 'Expense' || acc.account_type === 'Cost of Goods Sold'
      ? td - tc : tc - td;

    res.json({
      account: acc,
      data: details.rows,
      reference_types: refTypes.rows.map((r: any) => r.reference_type),
      total: parseInt(countQuery.rows[0].total),
      page, limit,
      total_debit: td,
      total_credit: tc,
      net_total: netTotal,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Source document lookup for multi-level drill
router.get('/source-document/:refType/:refId', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const { refType, refId } = req.params;
    let result: any;

    switch (refType) {
      case 'Sales Invoice':
        result = await query(`SELECT si.*, c.customer_name, c.customer_code FROM sales_invoices si LEFT JOIN customers c ON si.customer_id = c.id WHERE si.id = $1`, [refId]);
        break;
      case 'POS Sale':
        result = await query(`SELECT pt.*, u.full_name AS cashier_name FROM pos_transactions pt LEFT JOIN users u ON pt.cashier_id = u.id WHERE pt.id = $1`, [refId]);
        break;
      case 'Collection':
        result = await query(`SELECT cr.*, c.customer_name FROM collection_receipts cr LEFT JOIN customers c ON cr.customer_id = c.id WHERE cr.id = $1`, [refId]);
        break;
      case 'Payment Voucher':
        result = await query(`SELECT pv.*, s.supplier_name FROM payment_vouchers pv LEFT JOIN suppliers s ON pv.supplier_id = s.id WHERE pv.id = $1`, [refId]);
        break;
      case 'Goods Receipt':
        result = await query(`SELECT gr.*, s.supplier_name FROM goods_receipts gr LEFT JOIN suppliers s ON gr.supplier_id = s.id WHERE gr.id = $1`, [refId]);
        break;
      case 'Expense':
        result = await query(`SELECT e.*, ec.name AS category_name FROM expenses e LEFT JOIN expense_categories ec ON e.category_id = ec.id WHERE e.id = $1`, [refId]);
        break;
      case 'Inventory Adjustment':
        result = await query(`SELECT * FROM inventory_ledger WHERE reference_id = $1`, [refId]);
        break;
      case 'Bank Deposit':
      case 'Bank Withdrawal':
        result = await query(`SELECT bt.*, ba.bank_name, ba.account_name FROM bank_transactions bt JOIN bank_accounts ba ON bt.bank_account_id = ba.id WHERE bt.id = $1`, [refId]);
        break;
      case 'Cash In':
      case 'Cash Out':
        result = await query(`SELECT * FROM cash_transactions WHERE id = $1`, [refId]);
        break;
      case 'Payroll':
        result = await query(`SELECT p.*, e.first_name, e.last_name FROM payroll p LEFT JOIN employees e ON p.employee_id = e.id WHERE p.id = $1`, [refId]);
        break;
      case 'Payroll Payment':
      case 'Payroll Cancel':
        result = await query(`SELECT p.*, e.first_name, e.last_name FROM payroll p LEFT JOIN employees e ON p.employee_id = e.id WHERE p.id = $1`, [refId]);
        break;
      case 'SSS Contribution':
      case 'SSS Payment':
        result = await query(`SELECT sc.*, e.first_name, e.last_name FROM sss_contributions sc JOIN employees e ON sc.employee_id = e.id WHERE sc.id = $1`, [refId]);
        break;
      case 'Cash Advance':
      case 'Cash Advance Cancel':
        result = await query(`SELECT ca.*, e.first_name, e.last_name FROM cash_advances ca JOIN employees e ON ca.employee_id = e.id WHERE ca.id = $1`, [refId]);
        break;
      case 'Purchase Return':
        result = await query(`SELECT pr.*, s.supplier_name FROM purchase_returns pr LEFT JOIN suppliers s ON pr.supplier_id = s.id WHERE pr.id = $1`, [refId]);
        break;
      case 'Void Invoice':
        result = await query(`SELECT si.*, c.customer_name FROM sales_invoices si LEFT JOIN customers c ON si.customer_id = c.id WHERE si.id = $1`, [refId]);
        break;
      case 'Void POS':
        result = await query(`SELECT pt.* FROM pos_transactions pt WHERE pt.id = $1`, [refId]);
        break;
      case 'POS Shift Open':
      case 'POS Shift Close':
        result = await query(`SELECT ps.*, u.full_name as cashier_name FROM pos_shifts ps LEFT JOIN users u ON ps.user_id = u.id WHERE ps.id = $1`, [refId]);
        break;
      case 'Petty Cash':
        result = await query(`SELECT pcv.* FROM petty_cash_vouchers pcv WHERE pcv.id = $1`, [refId]);
        break;
      case 'AP Voucher':
        result = await query(`SELECT av.*, s.supplier_name FROM ap_vouchers av LEFT JOIN suppliers s ON av.supplier_id = s.id WHERE av.id = $1`, [refId]);
        break;
      case 'Delivery Receipt':
      case 'Delivery Receipt Cancel':
        result = await query(`SELECT dn.*, c.customer_name FROM delivery_notes dn LEFT JOIN customers c ON dn.customer_id = c.id WHERE dn.id = $1`, [refId]);
        break;
      case 'Sales Return':
        result = await query(`SELECT sr.*, c.customer_name FROM sales_returns sr LEFT JOIN customers c ON sr.customer_id = c.id WHERE sr.id = $1`, [refId]);
        break;
      case 'Inventory Count':
        result = await query(`SELECT ic.*, l.name as location_name FROM inventory_counts ic LEFT JOIN locations l ON ic.location_id = l.id WHERE ic.id = $1`, [refId]);
        break;
      case 'Bank Transfer':
        result = await query(`SELECT * FROM journal_entries WHERE reference_type = 'Bank Transfer' AND id = $1`, [refId]);
        break;
      default:
        return res.status(404).json({ error: 'Reference type not supported' });
    }

    if (!result || result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ reference_type: refType, document: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== TRANSACTION AUDIT ====================
router.get('/transaction-audit', authenticate, hasUserPerm('finance.accounting.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const report = await runTransactionAudit(from, to);
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Duplicate COGS — DR + Sales Invoice both posted cost of sales for same flow
router.get('/gl-integrity/duplicate-cogs', authenticate, hasUserPerm('finance.accounting.view'), async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await findDuplicateCogsInvoices();
    const totalDuplicate = rows.reduce((s, r) => s + r.duplicate_amount, 0);
    res.json({
      issue_count: rows.length,
      total_duplicate_cogs: Math.round(totalDuplicate * 100) / 100,
      rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/gl-integrity/repair-duplicate-cogs/:invoiceId', authenticate, hasUserPerm('finance.accounting.edit'), auditLog('Accounting', 'Repair Duplicate COGS'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await repairDuplicateInvoiceCogs(client, req.params.invoiceId);
    await client.query('COMMIT');
    auditAfter(req, { invoice_id: req.params.invoiceId, ...result });
    res.json({ message: 'Duplicate COGS repaired', ...result });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
