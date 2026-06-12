import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

interface EmployeeLedgerRow {
  date: string;
  transaction_type: string;
  reference_no: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
  source_module: string;
}

// ==================== HELPERS ====================
const getNextCode = async (table: string, field: string, prefix: string, startPos: number) => {
  const r = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${field} FROM ${startPos}) AS INTEGER)), 0) + 1 as next FROM ${table} WHERE ${field} ~ '^${prefix}'`
  );
  return `${prefix}${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
};

const createJournalEntry = async (
  entryNumber: string, date: Date | string, refType: string, refId: string, desc: string,
  lines: { accountCode: string; description: string; debit: number; credit: number }[],
  createdBy: string
) => {
  const entryId = uuidv4();
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  await query(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entryId, entryNumber, date, refType, refId, desc, totalDebit, totalCredit, createdBy]
  );

  for (const line of lines) {
    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3), $4, $5, $6, $7, $8)`,
      [uuidv4(), entryId, line.accountCode, line.description, line.debit, line.credit, refType, refId]
    );
  }

  return entryId;
};

const createCashTransaction = async (type: string, amount: number, refType: string, refId: string, notes: string, createdBy: string) => {
  const txnNumber = await getNextCode('cash_transactions', 'transaction_number', 'CT-', 4);
  await query(
    `INSERT INTO cash_transactions (id, transaction_number, transaction_type, amount, reference_type, reference_id, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [uuidv4(), txnNumber, type, amount, refType, refId, notes, createdBy]
  );
};

const createBankTransaction = async (amount: number, refType: string, refId: string, notes: string, createdBy: string, bankAccountId?: number) => {
  if (!bankAccountId) return;
  await query(
    `INSERT INTO bank_transactions (id, bank_account_id, transaction_type, amount, transaction_date, notes, created_by)
     VALUES ($1, $2, 'Withdrawal', $3, CURRENT_DATE, $4, $5)`,
    [uuidv4(), bankAccountId, amount, notes, createdBy]
  );
  await query(`UPDATE bank_accounts SET balance = balance - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [amount, bankAccountId]);
};

const updateEmployeeBalances = async (employeeId: number) => {
  const caResult = await query(
    `SELECT COALESCE(SUM(remaining_balance), 0) as total FROM cash_advances WHERE employee_id = $1 AND status = 'Active'`,
    [employeeId]
  );
  const gcResult = await query(
    `SELECT COALESCE(SUM(balance), 0) as total FROM sales_invoices
     WHERE employee_id = $1 AND customer_type = 'Employee' AND status IN ('Posted', 'Partial')`,
    [employeeId]
  );
  const caBalance = parseFloat(caResult.rows[0].total);
  const gcBalance = parseFloat(gcResult.rows[0].total);

  await query(
    `UPDATE employees SET cash_advance_balance = $1, grocery_credit_balance = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
    [caBalance, gcBalance, employeeId]
  );
};

const getOutstandingCA = async (employeeId: number) => {
  const r = await query(
    `SELECT COALESCE(SUM(remaining_balance), 0) as total FROM cash_advances WHERE employee_id = $1 AND status = 'Active'`,
    [employeeId]
  );
  return parseFloat(r.rows[0].total);
};

const getOutstandingGC = async (employeeId: number) => {
  const r = await query(
    `SELECT COALESCE(SUM(balance), 0) as total FROM sales_invoices WHERE employee_id = $1 AND customer_type = 'Employee' AND status IN ('Posted', 'Partial')`,
    [employeeId]
  );
  return parseFloat(r.rows[0].total);
};

// ==================== EMPLOYEES ====================
router.get('/employees', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM employees WHERE is_active = true ORDER BY last_name, first_name');
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/employees/all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM employees ORDER BY last_name, first_name');
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/employees/:id/ledger', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const employeeId = parseInt(req.params.id);
    const rows: EmployeeLedgerRow[] = [];
    let running = 0;

    // Cash advances
    const caResult = await query(
      `SELECT advance_date as date, 'Cash Advance' as transaction_type, id::text as ref_id, amount,
              remaining_balance, status, notes
       FROM cash_advances WHERE employee_id = $1 AND status != 'Cancelled'
       ORDER BY advance_date, created_at`,
      [employeeId]
    );
    for (const r of caResult.rows) {
      running += parseFloat(r.amount);
      rows.push({
        date: r.date, transaction_type: 'Cash Advance',
        reference_no: '', description: r.notes || 'Cash advance',
        debit: parseFloat(r.amount), credit: 0, running_balance: running, source_module: 'Cash Advance',
      });
    }

    // Grocery credits (from Sales Invoices)
    const gcResult = await query(
      `SELECT invoice_date as date, 'Grocery Credit' as transaction_type, id::text as ref_id, invoice_number, total, balance, status, notes
       FROM sales_invoices WHERE employee_id = $1 AND customer_type = 'Employee' AND status IN ('Posted', 'Deducted', 'Partial')
       ORDER BY invoice_date, created_at`,
      [employeeId]
    );
    for (const r of gcResult.rows) {
      running += parseFloat(r.total);
      rows.push({
        date: r.date, transaction_type: 'Grocery Credit',
        reference_no: r.invoice_number, description: r.notes || 'Employee grocery credit',
        debit: parseFloat(r.total), credit: 0, running_balance: running, source_module: 'Sales Invoice',
      });
    }

    // Payroll deductions
    const pdResult = await query(
      `SELECT pd.deduction_type, pd.amount, p.payroll_number, p.pay_period_end as date
       FROM payroll_deductions pd
       JOIN payroll p ON pd.payroll_id = p.id
       WHERE p.employee_id = $1 AND p.status != 'Cancelled' AND pd.deduction_type IN ('Cash Advance', 'Grocery Credit')
       ORDER BY p.pay_period_end`,
      [employeeId]
    );
    for (const r of pdResult.rows) {
      running -= parseFloat(r.amount);
      rows.push({
        date: r.date, transaction_type: 'Payroll Deduction',
        reference_no: r.payroll_number, description: `${r.deduction_type} deduction`,
        debit: 0, credit: parseFloat(r.amount), running_balance: running, source_module: 'Payroll',
      });
    }

    rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    res.json({ employee_id: employeeId, rows, running_balance: running });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/employees', authenticate, auditLog('HR', 'Create Employee'), async (req: AuthRequest, res: Response) => {
  try {
    const { first_name, last_name, middle_name, address, phone, email, position, department, daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, hire_date, credit_limit } = req.body;
    if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name are required' });

    const code = await getNextCode('employees', 'employee_code', 'DME-', 5);

    const result = await query(
      `INSERT INTO employees (employee_code, first_name, last_name, middle_name, address, phone, email, position, department, daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, hire_date, credit_limit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [code, first_name, last_name, middle_name, address, phone, email, position, department, daily_rate || 0, monthly_rate || 0, sss, philhealth, pagibig, tin, employment_type || 'Regular', hire_date, credit_limit || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/employees/:id', authenticate, auditLog('HR', 'Update Employee'), async (req: AuthRequest, res: Response) => {
  try {
    const { first_name, last_name, middle_name, address, phone, email, position, department, daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, is_active, hire_date, credit_limit } = req.body;
    const result = await query(
      `UPDATE employees SET first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name),
        middle_name=COALESCE($3,middle_name), address=COALESCE($4,address), phone=COALESCE($5,phone),
        email=COALESCE($6,email), position=COALESCE($7,position), department=COALESCE($8,department),
        daily_rate=COALESCE($9,daily_rate), monthly_rate=COALESCE($10,monthly_rate),
        sss=COALESCE($11,sss), philhealth=COALESCE($12,philhealth), pagibig=COALESCE($13,pagibig),
        tin=COALESCE($14,tin), employment_type=COALESCE($15,employment_type),
        is_active=COALESCE($16,is_active), hire_date=COALESCE($17,hire_date),
        credit_limit=COALESCE($18,credit_limit), updated_at=CURRENT_TIMESTAMP WHERE id=$19 RETURNING *`,
      [first_name, last_name, middle_name, address, phone, email, position, department, daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, is_active, hire_date, credit_limit, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    res.json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== ATTENDANCE ====================
router.post('/attendance', authenticate, auditLog('HR', 'Create Attendance'), async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, date, time_in, time_out, status, notes } = req.body;
    const recordDate = date || new Date().toISOString().split('T')[0];

    const toTimestamp = (timeStr: string | null) => {
      if (!timeStr) return null;
      if (/^\d{2}:\d{2}$/.test(timeStr)) return `${recordDate} ${timeStr}:00`;
      if (/^\d{2}:\d{2}:\d{2}$/.test(timeStr)) return `${recordDate} ${timeStr}`;
      return timeStr;
    };

    const result = await query(
      `INSERT INTO attendance (employee_id, date, time_in, time_out, status, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [employee_id, recordDate, toTimestamp(time_in), toTimestamp(time_out), status || 'Present', notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/attendance', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, from, to } = req.query;
    let whereClause = '';
    const params: any[] = [];
    let pi = 1;

    if (employee_id) { whereClause += ` AND a.employee_id = $${pi}`; params.push(employee_id); pi++; }
    if (from) { whereClause += ` AND a.date >= $${pi}`; params.push(from); pi++; }
    if (to) { whereClause += ` AND a.date <= $${pi}`; params.push(to); pi++; }

    const result = await query(
      `SELECT a.*, e.first_name, e.last_name, e.employee_code
       FROM attendance a JOIN employees e ON a.employee_id = e.id
       WHERE 1=1 ${whereClause} ORDER BY a.date DESC`,
      params
    );
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== CASH ADVANCES ====================
router.get('/cash-advances', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT ca.*, e.first_name, e.last_name, e.employee_code
       FROM cash_advances ca JOIN employees e ON ca.employee_id = e.id
       ORDER BY ca.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/cash-advances', authenticate, auditLog('HR', 'Create Cash Advance'), async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, amount, payment_account_type, payment_account_id, notes } = req.body;
    if (!employee_id || !amount || amount <= 0) return res.status(400).json({ error: 'Employee and valid amount are required' });

    const emp = await query('SELECT credit_limit, cash_advance_balance FROM employees WHERE id = $1', [employee_id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    if (emp.rows[0].credit_limit > 0 && emp.rows[0].cash_advance_balance + amount > emp.rows[0].credit_limit) {
      return res.status(400).json({ error: 'Exceeds employee credit limit' });
    }

    const id = uuidv4();
    await query(
      `INSERT INTO cash_advances (id, employee_id, amount, remaining_balance, payment_account_type, payment_account_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, employee_id, amount, amount, payment_account_type, payment_account_id, notes, req.user!.id]
    );

    // Accounting: Debit Employee CA Receivable, Credit Cash/Bank
    const creditAccount = payment_account_type === 'bank' ? '1010' : '1000';
    const jeNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);
    await createJournalEntry(jeNumber, new Date(), 'Cash Advance', id, `Cash Advance - ${emp.rows[0]?.employee_code || ''}`,
      [
        { accountCode: '1110', description: 'Employee Cash Advance', debit: amount, credit: 0 },
        { accountCode: creditAccount, description: 'Cash/Bank disbursement', debit: 0, credit: amount },
      ],
      req.user!.id
    );

    if (payment_account_type === 'bank' && payment_account_id) {
      await createBankTransaction(amount, 'Cash Advance', id, `Cash advance - employee ${employee_id}`, req.user!.id, payment_account_id);
    } else {
      await createCashTransaction('Cash Out', amount, 'Cash Advance', id, `Cash advance - employee ${employee_id}`, req.user!.id);
    }

    await updateEmployeeBalances(employee_id);
    res.status(201).json({ id });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/cash-advances/:id/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(`UPDATE cash_advances SET status='Cancelled', remaining_balance=0, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='Active' RETURNING *`, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Cash advance not found or already settled' });

    // Reverse accounting
    const amount = parseFloat(r.rows[0].amount);
    const creditAccount = r.rows[0].payment_account_type === 'bank' ? '1010' : '1000';
    const jeNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);
    await createJournalEntry(jeNumber, new Date(), 'Cash Advance Cancel', req.params.id, 'Reverse cash advance',
      [
        { accountCode: creditAccount, description: 'Reverse cash/bank', debit: amount, credit: 0 },
        { accountCode: '1110', description: 'Reverse employee receivable', debit: 0, credit: amount },
      ],
      req.user!.id
    );

    await updateEmployeeBalances(r.rows[0].employee_id);
    res.json({ message: 'Cash advance cancelled' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== EMPLOYEE GROCERY CREDITS (via Sales Invoices) ====================
router.get('/grocery-credits', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT si.id, si.invoice_number as credit_number, si.invoice_date as credit_date,
              si.employee_id, si.total, si.balance, si.status,
              si.notes, si.created_at,
              e.first_name, e.last_name, e.employee_code
       FROM sales_invoices si
       JOIN employees e ON si.employee_id = e.id
       WHERE si.customer_type = 'Employee'
       ORDER BY si.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/grocery-credits/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const header = await query(
      `SELECT si.id, si.invoice_number as credit_number, si.invoice_date as credit_date,
              si.employee_id, si.total, si.subtotal, si.discount, si.balance, si.status, si.notes,
              e.first_name, e.last_name, e.employee_code
       FROM sales_invoices si
       JOIN employees e ON si.employee_id = e.id
       WHERE si.id = $1 AND si.customer_type = 'Employee'`, [req.params.id]
    );
    if (header.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const items = await query(
      `SELECT sii.*, p.name as product_name, p.sku
       FROM sales_invoice_items sii
       LEFT JOIN products p ON sii.product_id = p.id
       WHERE sii.invoice_id = $1`, [req.params.id]
    );

    res.json({ ...header.rows[0], items: items.rows });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== PAYROLL ====================
router.get('/payroll', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const employee_id = req.query.employee_id as string;
    let whereClause = '';
    if (employee_id) whereClause = 'WHERE p.employee_id = $1';

    const result = await query(
      `SELECT p.*, e.first_name, e.last_name, e.employee_code
       FROM payroll p JOIN employees e ON p.employee_id = e.id
       ${whereClause} ORDER BY p.created_at DESC`,
      employee_id ? [employee_id] : []
    );
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/payroll', authenticate, auditLog('HR', 'Create Payroll'), async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, pay_period_start, pay_period_end, days_worked, other_deductions, notes } = req.body;
    if (!employee_id || !pay_period_start || !pay_period_end) return res.status(400).json({ error: 'Employee and pay period are required' });

    const emp = await query('SELECT * FROM employees WHERE id = $1', [employee_id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const dailyRate = parseFloat(emp.rows[0].daily_rate);
    const grossPay = (days_worked || 0) * dailyRate;

    // Auto-compute cash advance deduction
    const caResult = await query(
      `SELECT COALESCE(SUM(remaining_balance), 0) as total FROM cash_advances WHERE employee_id = $1 AND status = 'Active'`,
      [employee_id]
    );
    const caBalance = parseFloat(caResult.rows[0].total);

    // Auto-compute grocery credit deduction from sales_invoices
    const gcResult = await query(
      `SELECT COALESCE(SUM(balance), 0) as total FROM sales_invoices
       WHERE employee_id = $1 AND customer_type = 'Employee' AND status IN ('Posted', 'Partial')`,
      [employee_id]
    );
    const gcBalance = parseFloat(gcResult.rows[0].total);

    // Deduct from payroll
    const caDeduction = Math.min(caBalance, grossPay);
    const remainingAfterCA = grossPay - caDeduction;
    const gcDeduction = Math.min(gcBalance, remainingAfterCA);

    const otherTotal = (other_deductions || []).reduce((s: number, d: any) => s + parseFloat(d.amount || 0), 0);
    const deductionsTotal = caDeduction + gcDeduction + otherTotal;
    const netPay = Math.max(0, grossPay - deductionsTotal);

    const payroll_number = await getNextCode('payroll', 'payroll_number', 'PY-', 4);
    const id = uuidv4();

    await query(
      `INSERT INTO payroll (id, payroll_number, employee_id, pay_period_start, pay_period_end, days_worked,
        gross_pay, cash_advance_deduction, grocery_credit_deduction, other_deductions, deductions_total, net_pay, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, payroll_number, employee_id, pay_period_start, pay_period_end, days_worked,
       grossPay, caDeduction, gcDeduction, otherTotal, deductionsTotal, netPay, req.user!.id]
    );

    // Insert individual deductions
    if (caDeduction > 0) {
      await query(`INSERT INTO payroll_deductions (id, payroll_id, deduction_type, amount) VALUES ($1,$2,'Cash Advance',$3)`, [uuidv4(), id, caDeduction]);
    }
    if (gcDeduction > 0) {
      await query(`INSERT INTO payroll_deductions (id, payroll_id, deduction_type, amount) VALUES ($1,$2,'Grocery Credit',$3)`, [uuidv4(), id, gcDeduction]);
    }
    for (const d of other_deductions || []) {
      await query(`INSERT INTO payroll_deductions (id, payroll_id, deduction_type, amount) VALUES ($1,$2,$3,$4)`, [uuidv4(), id, d.type, d.amount]);
    }

    res.status(201).json({ id, payroll_number, gross_pay: grossPay, ca_deduction: caDeduction, gc_deduction: gcDeduction, net_pay: netPay });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/payroll/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const p = await query(`SELECT p.*, e.employee_code FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE p.id=$1`, [req.params.id]);
    if (p.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (p.rows[0].status !== 'Draft') return res.status(400).json({ error: 'Only draft payroll can be approved' });

    const payroll = p.rows[0];
    const grossPay = parseFloat(payroll.gross_pay);
    const caDed = parseFloat(payroll.cash_advance_deduction || 0);
    const gcDed = parseFloat(payroll.grocery_credit_deduction || 0);
    const netPay = parseFloat(payroll.net_pay);

    if (grossPay <= 0) return res.status(400).json({ error: 'Gross pay must be greater than zero' });

    // Accounting entry
    const jeNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);
    const lines: { accountCode: string; description: string; debit: number; credit: number }[] = [
      { accountCode: '6000', description: `Salaries - ${payroll.payroll_number}`, debit: grossPay, credit: 0 },
      { accountCode: '2300', description: `Payroll Payable - ${payroll.payroll_number}`, debit: 0, credit: netPay },
    ];

    if (caDed > 0) {
      lines.push({ accountCode: '1110', description: `CA deduction - ${payroll.payroll_number}`, debit: 0, credit: caDed });
      // Deduct from cash advances in FIFO order (oldest first)
      let remaining = caDed;
      const activeCAs = await query(
        `SELECT * FROM cash_advances WHERE employee_id = $1 AND status = 'Active' ORDER BY advance_date ASC`,
        [payroll.employee_id]
      );
      for (const ca of activeCAs.rows) {
        if (remaining <= 0) break;
        const caBal = parseFloat(ca.remaining_balance);
        const deduct = Math.min(caBal, remaining);
        const newBal = caBal - deduct;
        await query(
          `UPDATE cash_advances SET remaining_balance = $1, status = CASE WHEN $1 <= 0::numeric THEN 'Fully Paid' ELSE 'Active' END, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [newBal, ca.id]
        );
        remaining -= deduct;
      }
    }

    if (gcDed > 0) {
      lines.push({ accountCode: '1120', description: `GC deduction - ${payroll.payroll_number}`, debit: 0, credit: gcDed });
      // Deduct from employee sales invoices in FIFO order (oldest first)
      let remaining = gcDed;
      const invoices = await query(
        `SELECT * FROM sales_invoices WHERE employee_id = $1 AND customer_type = 'Employee' AND status IN ('Posted', 'Partial')
         ORDER BY invoice_date ASC`,
        [payroll.employee_id]
      );
      for (const inv of invoices.rows) {
        if (remaining <= 0) break;
        const invBal = parseFloat(inv.balance);
        const total = parseFloat(inv.total);
        const deduct = Math.min(invBal, remaining);
        const newBalance = invBal - deduct;
        const newPaid = (parseFloat(inv.amount_paid) || 0) + deduct;
        const newStatus = newBalance <= 0 ? 'Deducted' : 'Partial';
        await query(
          `UPDATE sales_invoices SET balance = $1, amount_paid = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
          [newBalance, newPaid, newStatus, inv.id]
        );
        remaining -= deduct;
      }
    }

    await createJournalEntry(jeNumber, new Date(), 'Payroll', req.params.id, `Payroll ${payroll.payroll_number}`,
      lines, req.user!.id
    );

    await query(`UPDATE payroll SET status='Posted', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    await updateEmployeeBalances(payroll.employee_id);
    res.json({ message: 'Payroll approved' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/payroll/:id/pay', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { payment_account_type, payment_account_id, payment_date } = req.body;
    if (!payment_account_type) return res.status(400).json({ error: 'Payment account type is required' });

    const p = await query(`SELECT * FROM payroll WHERE id=$1`, [req.params.id]);
    if (p.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (p.rows[0].status !== 'Posted') return res.status(400).json({ error: 'Only approved payroll can be paid' });
    if (p.rows[0].status === 'Paid') return res.status(400).json({ error: 'Already paid' });

    const netPay = parseFloat(p.rows[0].net_pay);
    const creditAccount = payment_account_type === 'bank' ? '1010' : '1000';

    // Accounting: Debit Payroll Payable, Credit Cash/Bank
    const jeNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);
    await createJournalEntry(jeNumber, payment_date || new Date(), 'Payroll Payment', req.params.id, `Payroll Payment ${p.rows[0].payroll_number}`,
      [
        { accountCode: '2300', description: 'Payroll Payable', debit: netPay, credit: 0 },
        { accountCode: creditAccount, description: 'Cash/Bank disbursement', debit: 0, credit: netPay },
      ],
      req.user!.id
    );

    if (payment_account_type === 'bank' && payment_account_id) {
      await createBankTransaction(netPay, 'Payroll Payment', req.params.id, `Payroll payment ${p.rows[0].payroll_number}`, req.user!.id, payment_account_id);
    } else {
      await createCashTransaction('Cash Out', netPay, 'Payroll Payment', req.params.id, `Payroll payment ${p.rows[0].payroll_number}`, req.user!.id);
    }

    await query(
      `UPDATE payroll SET status='Paid', payment_date=$1, payment_account_type=$2, payment_account_id=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [payment_date || new Date(), payment_account_type, payment_account_id, req.params.id]
    );

    res.json({ message: 'Payroll paid' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/payroll/:id/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const p = await query(`SELECT * FROM payroll WHERE id=$1`, [req.params.id]);
    if (p.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (p.rows[0].status === 'Paid') return res.status(400).json({ error: 'Cannot cancel paid payroll' });

    if (p.rows[0].status === 'Posted') {
      // Reverse accounting
      const grossPay = parseFloat(p.rows[0].gross_pay);
      const caDed = parseFloat(p.rows[0].cash_advance_deduction || 0);
      const gcDed = parseFloat(p.rows[0].grocery_credit_deduction || 0);
      const netPay = parseFloat(p.rows[0].net_pay);

      const jeNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);
      const lines: { accountCode: string; description: string; debit: number; credit: number }[] = [
        { accountCode: '2300', description: `Reverse Payroll Payable`, debit: netPay, credit: 0 },
        { accountCode: '6000', description: `Reverse Salaries`, debit: 0, credit: grossPay },
      ];
      if (caDed > 0) lines.push({ accountCode: '1110', description: 'Reverse CA deduction', debit: caDed, credit: 0 });
      if (gcDed > 0) lines.push({ accountCode: '1120', description: 'Reverse GC deduction', debit: gcDed, credit: 0 });

      await createJournalEntry(jeNumber, new Date(), 'Payroll Cancel', req.params.id, `Cancel ${p.rows[0].payroll_number}`,
        lines, req.user!.id
      );

      // Restore cash advance balances by reversing deductions
      const deductions = await query(`SELECT * FROM payroll_deductions WHERE payroll_id = $1`, [req.params.id]);
      for (const d of deductions.rows) {
        if (d.deduction_type === 'Cash Advance') {
          // Restore to most recently deducted CAs first (reverse-FIFO)
          let remaining = parseFloat(d.amount);
          const activeCAs = await query(
            `SELECT * FROM cash_advances WHERE employee_id = $1 AND status = 'Fully Paid' ORDER BY advance_date DESC`,
            [p.rows[0].employee_id]
          );
          for (const ca of activeCAs.rows) {
            if (remaining <= 0) break;
            const caOriginal = parseFloat(ca.amount);
            const caDeducted = await query(
              `SELECT COALESCE(SUM(pd.amount), 0) as total FROM payroll_deductions pd
               JOIN payroll pr ON pd.payroll_id = pr.id
               WHERE pd.deduction_type = 'Cash Advance' AND pr.employee_id = $2 AND pr.id != $3 AND pr.status != 'Cancelled'`,
              [ca.id, p.rows[0].employee_id, req.params.id]
            );
            const alreadyDeducted = parseFloat(caDeducted.rows[0].total);
            const caBal = caOriginal - alreadyDeducted;
            const restore = Math.min(caBal, remaining);
            const newBal = caBal - restore + parseFloat(d.amount); // careful: this is restoring
            await query(
              `UPDATE cash_advances SET remaining_balance = $1, status = CASE WHEN $1 > 0::numeric THEN 'Active' ELSE 'Fully Paid' END, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
              [Math.min(caOriginal, caOriginal - alreadyDeducted + parseFloat(d.amount)), ca.id]
            );
            remaining -= restore;
          }
        }
        if (d.deduction_type === 'Grocery Credit') {
          let remaining = parseFloat(d.amount);
          const invoices = await query(
            `SELECT * FROM sales_invoices WHERE employee_id = $1 AND customer_type = 'Employee' AND status = 'Deducted'
             ORDER BY invoice_date DESC`,
            [p.rows[0].employee_id]
          );
          for (const inv of invoices.rows) {
            if (remaining <= 0) break;
            const total = parseFloat(inv.total);
            const otherDeductions = await query(
              `SELECT COALESCE(SUM(pd.amount), 0) as total FROM payroll_deductions pd
               JOIN payroll pr ON pd.payroll_id = pr.id
               WHERE pd.deduction_type = 'Grocery Credit' AND pr.employee_id = $2 AND pr.id != $3 AND pr.status != 'Cancelled'`,
              [inv.id, p.rows[0].employee_id, req.params.id]
            );
            const alreadyDeducted = parseFloat(otherDeductions.rows[0].total);
            const restore = Math.min(total - alreadyDeducted, remaining);
            const newPaid = parseFloat(inv.amount_paid) - restore;
            const newBal = total - newPaid;
            const newStatus = newBal <= 0 ? 'Deducted' : newPaid > 0 ? 'Partial' : 'Posted';
            await query(
              `UPDATE sales_invoices SET balance = $1, amount_paid = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
              [newBal, newPaid, newStatus, inv.id]
            );
            remaining -= restore;
          }
        }
      }
    }

    await query(`UPDATE payroll SET status='Cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    await updateEmployeeBalances(p.rows[0].employee_id);
    res.json({ message: 'Payroll cancelled' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== PAYSLIP ====================
router.get('/payslip/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const payrollResult = await query(
      `SELECT p.*, e.employee_code, e.first_name, e.last_name, e.middle_name,
              e.position, e.department, e.daily_rate, e.monthly_rate, e.employment_type,
              e.sss, e.philhealth, e.pagibig, e.tin
       FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE p.id = $1`,
      [id]
    );
    if (payrollResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const payroll = payrollResult.rows[0];

    const deductionsResult = await query(
      `SELECT deduction_type, amount FROM payroll_deductions WHERE payroll_id = $1 ORDER BY deduction_type`,
      [id]
    );

    const attendanceResult = await query(
      `SELECT status, COUNT(*)::int as count
       FROM attendance WHERE employee_id = $1 AND date >= $2 AND date <= $3
       GROUP BY status`,
      [payroll.employee_id, payroll.pay_period_start, payroll.pay_period_end]
    );

    const attendanceSummary: Record<string, number> = {};
    let totalAttendanceDays = 0;
    for (const row of attendanceResult.rows) {
      attendanceSummary[row.status] = row.count;
      totalAttendanceDays += row.count;
    }

    res.json({
      ...payroll,
      deductions: deductionsResult.rows,
      attendance: {
        summary: attendanceSummary,
        total_days: totalAttendanceDays,
        present: attendanceSummary.Present || 0,
        absent: attendanceSummary.Absent || 0,
        late: attendanceSummary.Late || 0,
        half_day: attendanceSummary['Half-day'] || 0,
        leave: attendanceSummary.Leave || 0,
      },
      outstanding_balances: {
        cash_advance: await getOutstandingCA(payroll.employee_id),
        grocery_credit: await getOutstandingGC(payroll.employee_id),
      },
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== SSS CONTRIBUTIONS ====================
router.get('/sss-contributions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT sc.*, e.first_name, e.last_name, e.employee_code
       FROM sss_contributions sc JOIN employees e ON sc.employee_id = e.id
       ORDER BY sc.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/sss-contributions', authenticate, auditLog('HR', 'Create SSS Contribution'), async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, period_start, period_end, employer_amount, notes } = req.body;
    if (!employee_id || !period_start || !period_end) return res.status(400).json({ error: 'Employee and period are required' });

    const contributionNumber = await getNextCode('sss_contributions', 'contribution_number', 'SSS-', 5);
    const id = uuidv4();
    const amount = parseFloat(employer_amount || 0);

    await query(
      `INSERT INTO sss_contributions (id, contribution_number, employee_id, period_start, period_end, employer_amount, total_amount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, contributionNumber, employee_id, period_start, period_end, amount, amount, notes, req.user!.id]
    );

    res.status(201).json({ id, contribution_number: contributionNumber });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/sss-contributions/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const sc = await query(`SELECT * FROM sss_contributions WHERE id=$1`, [req.params.id]);
    if (sc.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const amount = parseFloat(sc.rows[0].employer_amount);

    // Accounting: Debit SSS Employer Expense, Credit SSS Payable
    const jeNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);
    await createJournalEntry(jeNumber, new Date(), 'SSS Contribution', req.params.id, `SSS ${sc.rows[0].contribution_number}`,
      [
        { accountCode: '6090', description: 'SSS Employer Expense', debit: amount, credit: 0 },
        { accountCode: '2310', description: 'SSS Payable', debit: 0, credit: amount },
      ],
      req.user!.id
    );

    await query(`UPDATE sss_contributions SET status='Posted', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    res.json({ message: 'SSS contribution approved' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/sss-contributions/:id/pay', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { payment_account_type } = req.body;
    const sc = await query(`SELECT * FROM sss_contributions WHERE id=$1`, [req.params.id]);
    if (sc.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (sc.rows[0].status !== 'Posted') return res.status(400).json({ error: 'Must be approved first' });

    const amount = parseFloat(sc.rows[0].employer_amount);
    const creditAccount = payment_account_type === 'bank' ? '1010' : '1000';

    const jeNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);
    await createJournalEntry(jeNumber, new Date(), 'SSS Payment', req.params.id, `SSS Payment ${sc.rows[0].contribution_number}`,
      [
        { accountCode: '2310', description: 'SSS Payable', debit: amount, credit: 0 },
        { accountCode: creditAccount, description: 'Cash/Bank disbursement', debit: 0, credit: amount },
      ],
      req.user!.id
    );

    if (payment_account_type === 'bank') {
      const bank = await query('SELECT id FROM bank_accounts WHERE is_active = true LIMIT 1');
      if (bank.rows.length > 0) {
        await createBankTransaction(amount, 'SSS Payment', req.params.id, `SSS payment ${sc.rows[0].contribution_number}`, req.user!.id, bank.rows[0].id);
      }
    } else {
      await createCashTransaction('Cash Out', amount, 'SSS Payment', req.params.id, `SSS payment ${sc.rows[0].contribution_number}`, req.user!.id);
    }

    await query(`UPDATE sss_contributions SET status='Paid', payment_date=CURRENT_DATE, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    res.json({ message: 'SSS contribution paid' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/sss-contributions/:id/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const sc = await query(`SELECT * FROM sss_contributions WHERE id=$1`, [req.params.id]);
    if (sc.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (sc.rows[0].status === 'Paid') return res.status(400).json({ error: 'Cannot cancel paid contribution' });

    await query(`UPDATE sss_contributions SET status='Cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    res.json({ message: 'SSS contribution cancelled' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;
