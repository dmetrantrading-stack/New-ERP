import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

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
    const { first_name, last_name, middle_name, address, phone, email, position, department, daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, hire_date, credit_limit, sss_default_amount } = req.body;
    if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name are required' });

    const code = await getNextCode('employees', 'employee_code', 'DME-', 5);

    const result = await query(
      `INSERT INTO employees (employee_code, first_name, last_name, middle_name, address, phone, email, position, department, daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, hire_date, credit_limit, sss_default_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [code, first_name, last_name, middle_name, address, phone, email, position, department, daily_rate || 0, monthly_rate || 0, sss, philhealth, pagibig, tin, employment_type || 'Regular', hire_date, credit_limit || 0, sss_default_amount || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/employees/:id', authenticate, auditLog('HR', 'Update Employee'), async (req: AuthRequest, res: Response) => {
  try {
    const { first_name, last_name, middle_name, address, phone, email, position, department, daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, is_active, hire_date, credit_limit, sss_default_amount } = req.body;
    const result = await query(
      `UPDATE employees SET first_name=COALESCE($1,first_name), last_name=COALESCE($2,last_name),
        middle_name=COALESCE($3,middle_name), address=COALESCE($4,address), phone=COALESCE($5,phone),
        email=COALESCE($6,email), position=COALESCE($7,position), department=COALESCE($8,department),
        daily_rate=COALESCE($9,daily_rate), monthly_rate=COALESCE($10,monthly_rate),
        sss=COALESCE($11,sss), philhealth=COALESCE($12,philhealth), pagibig=COALESCE($13,pagibig),
        tin=COALESCE($14,tin), employment_type=COALESCE($15,employment_type),
        is_active=COALESCE($16,is_active), hire_date=COALESCE($17,hire_date),
        credit_limit=COALESCE($18,credit_limit), sss_default_amount=COALESCE($19,sss_default_amount), updated_at=CURRENT_TIMESTAMP WHERE id=$20 RETURNING *`,
      [first_name, last_name, middle_name, address, phone, email, position, department, daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, is_active, hire_date, credit_limit, sss_default_amount, req.params.id]
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

router.get('/attendance/worked-days', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, from, to } = req.query;
    if (!employee_id || !from || !to) return res.status(400).json({ error: 'employee_id, from, and to are required' });

    const result = await query(
      `SELECT COUNT(*)::int as worked
       FROM attendance
       WHERE employee_id = $1 AND date >= $2 AND date <= $3 AND status IN ('Present', 'Late', 'Half-day')`,
      [employee_id, from, to]
    );
    res.json({ worked_days: result.rows[0].worked });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Attendance Sheet — pivoted grid: employees × dates
router.get('/attendance/sheet', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().slice(0, 7) + '-01';
    const to = req.query.to as string || new Date().toISOString().slice(0, 7) + '-15';
    const employeeId = req.query.employee_id as string;

    // Generate date list
    const dates: string[] = [];
    const d = new Date(from);
    const end = new Date(to);
    while (d <= end) { dates.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() + 1); }

    // Fetch employees
    let empQuery = "SELECT id, first_name, last_name, employee_code, department, daily_rate FROM employees WHERE is_active = true";
    const empParams: any[] = [];
    if (employeeId) { empQuery += " AND id = $1"; empParams.push(employeeId); }
    empQuery += " ORDER BY last_name, first_name";
    const emps = await query(empQuery, empParams);

    // Fetch attendance for all employees in date range
    const att = await query(
      `SELECT a.* FROM attendance a
       WHERE a.date >= $1 AND a.date <= $2
       ${employeeId ? 'AND a.employee_id = $3' : ''}
       ORDER BY a.date`,
      employeeId ? [from, to, employeeId] : [from, to]
    );

    // Pivot: employee_id -> date -> { status, time_in, time_out, id }
    const attMap: Record<string, Record<string, any>> = {};
    for (const row of att.rows) {
      if (!attMap[row.employee_id]) attMap[row.employee_id] = {};
      const dstr = `${row.date.getFullYear()}-${String(row.date.getMonth()+1).padStart(2,'0')}-${String(row.date.getDate()).padStart(2,'0')}`;
      attMap[row.employee_id][dstr] = {
        id: row.id,
        status: row.status,
        time_in: row.time_in ? new Date(row.time_in).toTimeString().slice(0, 5) : null,
        time_out: row.time_out ? new Date(row.time_out).toTimeString().slice(0, 5) : null,
      };
    }

    const employees = emps.rows.map((e: any) => {
      const days: Record<string, any> = {};
      const summary: Record<string, number> = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0, rest_day: 0, worked: 0 };
      for (const dt of dates) {
        const rec = attMap[e.id]?.[dt];
        days[dt] = rec || { status: null, time_in: null, time_out: null, id: null };
        if (rec) {
          const s = (rec.status || '').toLowerCase();
          if (s === 'present') { summary.present++; summary.worked++; }
          else if (s === 'absent') summary.absent++;
          else if (s === 'late') { summary.late++; summary.worked++; }
          else if (s === 'half-day') { summary.half_day++; summary.worked += 0.5; }
          else if (s === 'leave') summary.leave++;
          else if (s === 'rest day') summary.rest_day++;
        }
      }
      return { id: e.id, name: `${e.last_name}, ${e.first_name}`, code: e.employee_code, department: e.department, daily_rate: e.daily_rate, days, summary };
    });

    res.json({ from, to, dates, employees });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Batch upsert attendance sheet entries
router.post('/attendance/sheet', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { entries } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array required' });
    }
    let upserted = 0;
    for (const e of entries) {
      if (!e.employee_id || !e.date) continue;
      await query(
        `INSERT INTO attendance (employee_id, date, status, time_in, time_out)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (employee_id, date) DO UPDATE SET status = $3, time_in = COALESCE($4, attendance.time_in), time_out = COALESCE($5, attendance.time_out)`,
        [e.employee_id, e.date, e.status || 'Present', e.time_in || null, e.time_out || null]
      );
      upserted++;
    }
    res.json({ upserted });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Attendance Sheet Print — dot-matrix HTML
router.get('/attendance/sheet/print', async (req: AuthRequest, res: Response) => {
  try {
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try { jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Invalid token' }); }

    const from = req.query.from as string || new Date().toISOString().slice(0, 7) + '-01';
    const to = req.query.to as string || new Date().toISOString().slice(0, 7) + '-15';
    const employeeId = req.query.employee_id as string;

    const dates: string[] = [];
    const d = new Date(from);
    const end = new Date(to);
    while (d <= end) { dates.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() + 1); }

    let empQuery = "SELECT id, first_name, last_name, employee_code, department FROM employees WHERE is_active = true";
    const empParams: any[] = [];
    if (employeeId) { empQuery += " AND id = $1"; empParams.push(employeeId); }
    empQuery += " ORDER BY last_name, first_name";
    const emps = await query(empQuery, empParams);

    const att = await query(
      `SELECT a.* FROM attendance a WHERE a.date >= $1 AND a.date <= $2 ${employeeId ? 'AND a.employee_id = $3' : ''} ORDER BY a.date`,
      employeeId ? [from, to, employeeId] : [from, to]
    );
    const attMap: Record<string, Record<string, any>> = {};
    for (const row of att.rows) {
      if (!attMap[row.employee_id]) attMap[row.employee_id] = {};
      attMap[row.employee_id][`${row.date.getFullYear()}-${String(row.date.getMonth()+1).padStart(2,'0')}-${String(row.date.getDate()).padStart(2,'0')}`] = row;
    }

    const fmtDate = (dt: string) => new Date(dt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    const statusLabel = (s: string) => s === 'Present' ? 'P' : s === 'Absent' ? 'A' : s === 'Late' ? 'L' : s === 'Half-day' ? 'H' : s === 'Leave' ? 'LV' : s === 'Rest Day' ? 'RD' : '';

    let rows = '';
    for (const e of emps.rows) {
      let cells = `<td style="font-size:9px;padding:3px 4px;text-align:left">${e.last_name}, ${e.first_name}</td>`;
      let p = 0, a = 0, l = 0, h = 0, lv = 0, rd = 0;
      for (const dt of dates) {
        const rec = attMap[e.id]?.[dt];
        if (!rec) { cells += '<td></td>'; continue; }
        const s = rec.status;
        cells += `<td style="text-align:center;font-size:9px">${statusLabel(s)}</td>`;
        if (s === 'Present') p++; else if (s === 'Absent') a++; else if (s === 'Late') l++;
        else if (s === 'Half-day') h++; else if (s === 'Leave') lv++; else if (s === 'Rest Day') rd++;
      }
      cells += `<td style="text-align:center;font-weight:bold">${p}</td><td style="text-align:center">${a}</td><td style="text-align:center">${l}</td><td style="text-align:center">${h}</td><td style="text-align:center">${lv}</td><td style="text-align:center">${rd}</td><td style="text-align:center;font-weight:bold">${p + l + h*0.5}</td>`;
      rows += `<tr>${cells}</tr>`;
    }

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const bizName = b.business_name || 'D METRAN TRADING';

    const style = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Courier New",monospace;font-size:10px;color:#111;padding:6mm 8mm;max-width:297mm;margin:0 auto}
.header{text-align:center;margin-bottom:8px}
.header h1{font-size:16px;font-weight:bold;letter-spacing:3px;margin:0}
.header p{font-size:9px;margin:2px 0}
.doc-title{text-align:center;border:1px dotted #444;padding:5px 0;margin:8px 0}
.doc-title h2{font-size:13px;font-weight:bold;letter-spacing:4px;margin:0}
.info{font-size:9px;margin:6px 0;display:flex;gap:20px}
table{width:100%;border-collapse:collapse;margin:6px 0}
th{background:#f8f8f8;border:1px dotted #444;padding:3px 4px;font-size:8px;text-align:center;font-weight:bold}
td{border:1px dotted #444;padding:2px 4px;font-size:8px}
.legend{font-size:8px;margin-top:6px}
.footer{text-align:center;font-size:7px;color:#666;margin-top:10px;border-top:1px dotted #999;padding-top:4px}
@media print{body{padding:4mm 6mm}}
`.trim();

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Attendance Sheet ${from} to ${to}</title><style>${style}</style></head><body>
<div class="header"><h1>${bizName}</h1><p>Attendance Sheet</p></div>
<div class="doc-title"><h2>ATTENDANCE SHEET</h2></div>
<div class="info"><span><strong>Period:</strong> ${fmtDate(from)} — ${fmtDate(to)}</span><span><strong>Employees:</strong> ${emps.rows.length}</span></div>
<table><thead><tr><th style="text-align:left">Employee</th>${dates.map(dt => `<th>${new Date(dt).getDate()}</th>`).join('')}<th>P</th><th>A</th><th>L</th><th>H</th><th>LV</th><th>RD</th><th>W</th></tr></thead><tbody>${rows}</tbody></table>
<div class="legend"><strong>Legend:</strong> P=Present A=Absent L=Late H=Half-day LV=Leave RD=Rest Day W=Worked Days</div>
<div class="footer">Printed: ${new Date().toLocaleString('en-PH')} | Attendance Sheet | ${bizName}</div>
</body></html>`;
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
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
    const { employee_id, amount, payment_account_type, payment_account_id, notes, installment_amount, installment_count } = req.body;
    if (!employee_id || !amount || amount <= 0) return res.status(400).json({ error: 'Employee and valid amount are required' });

    const emp = await query('SELECT credit_limit, cash_advance_balance, employee_code FROM employees WHERE id = $1', [employee_id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    if (emp.rows[0].credit_limit > 0 && emp.rows[0].cash_advance_balance + amount > emp.rows[0].credit_limit) {
      return res.status(400).json({ error: 'Exceeds employee credit limit' });
    }

    const instAmt = parseFloat(installment_amount || '0');
    const instCount = parseInt(installment_count || '0');
    if (instAmt > 0 && instAmt > amount) return res.status(400).json({ error: 'Installment amount cannot exceed advance amount' });

    const id = uuidv4();
    await query(
      `INSERT INTO cash_advances (id, employee_id, amount, remaining_balance, installment_amount, installment_count, payment_account_type, payment_account_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, employee_id, amount, amount, instAmt, instCount, payment_account_type, payment_account_id, notes, req.user!.id]
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

router.post('/payroll', authenticate, hasUserPerm('hr.payroll.create'), auditLog('HR', 'Create Payroll'), async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, pay_period_start, pay_period_end, days_worked, other_deductions, notes } = req.body;
    if (!employee_id || !pay_period_start || !pay_period_end) return res.status(400).json({ error: 'Employee and pay period are required' });

    const emp = await query('SELECT * FROM employees WHERE id = $1', [employee_id]);
    if (emp.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });

    const dailyRate = parseFloat(emp.rows[0].daily_rate);
    const grossPay = (days_worked || 0) * dailyRate;

    // Auto-compute cash advance deduction
    // Compute cash advance deduction — respect installment caps
    const activeCAs = await query(
      `SELECT id, remaining_balance, installment_amount FROM cash_advances WHERE employee_id = $1 AND status = 'Active' ORDER BY advance_date ASC`,
      [employee_id]
    );
    let caDeduction = 0;
    for (const ca of activeCAs.rows) {
      const bal = parseFloat(ca.remaining_balance);
      const instAmt = parseFloat(ca.installment_amount || '0');
      const cap = instAmt > 0 ? Math.min(instAmt, bal) : bal;
      const deduct = Math.min(cap, Math.max(0, grossPay - caDeduction));
      caDeduction += deduct;
    }
    caDeduction = Math.min(caDeduction, grossPay);

    // Auto-compute grocery credit deduction
    const gcResult = await query(
      `SELECT COALESCE(SUM(balance), 0) as total FROM sales_invoices
       WHERE employee_id = $1 AND customer_type = 'Employee' AND status IN ('Posted', 'Partial')`,
      [employee_id]
    );
    const gcBalance = parseFloat(gcResult.rows[0].total);

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

router.put('/payroll/:id/approve', authenticate, hasUserPerm('hr.payroll.approve'), async (req: AuthRequest, res: Response) => {
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
    const { payment_account_type, payment_account_id, payment_date, reference_number } = req.body;
    if (!payment_account_type) return res.status(400).json({ error: 'Payment account type is required' });

    const p = await query(`SELECT * FROM payroll WHERE id=$1`, [req.params.id]);
    if (p.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (p.rows[0].status !== 'Posted') return res.status(400).json({ error: 'Only approved payroll can be paid' });
    if (p.rows[0].status === 'Paid') return res.status(400).json({ error: 'Already paid' });

    const netPay = parseFloat(p.rows[0].net_pay);
    const creditAccount = payment_account_type === 'bank' ? '1010' : '1000';
    const voucherNumber = await getNextCode('payroll', 'payment_voucher_number', 'PPV-', 5);

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
      `UPDATE payroll SET status='Paid', payment_date=$1, payment_account_type=$2, payment_account_id=$3, payment_ref=$4, payment_voucher_number=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6`,
      [payment_date || new Date(), payment_account_type, payment_account_id, reference_number || null, voucherNumber, req.params.id]
    );

    res.json({ message: 'Payroll paid', payment_voucher_number: voucherNumber });
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

// Auto-generate SSS contributions for all employees with a default amount
router.post('/sss-contributions/generate', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const periodStart = req.body.period_start || new Date().toISOString().slice(0, 7) + '-01';
    const periodEnd = req.body.period_end || new Date().toISOString().slice(0, 7) + '-' + new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    let created = 0;
    const emps = await query(`SELECT id, sss_default_amount FROM employees WHERE is_active = true AND sss_default_amount > 0`);
    for (const e of emps.rows) {
      const existing = await query(
        `SELECT 1 FROM sss_contributions WHERE employee_id = $1 AND period_start = $2`,
        [e.id, periodStart]
      );
      if (existing.rows.length > 0) continue;
      const contributionNumber = await getNextCode('sss_contributions', 'contribution_number', 'SSS-', 5);
      const amt = parseFloat(e.sss_default_amount);
      await query(
        `INSERT INTO sss_contributions (id, contribution_number, employee_id, period_start, period_end, employer_amount, employee_amount, total_amount, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,0,$6,'Draft','Auto-generated from employee default')`,
        [uuidv4(), contributionNumber, e.id, periodStart, periodEnd, amt]
      );
      created++;
    }
    res.json({ created, period_start: periodStart, period_end: periodEnd });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/sss-contributions', authenticate, auditLog('HR', 'Create SSS Contribution'), async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, period_start, period_end, employer_amount, employee_amount, notes } = req.body;
    if (!employee_id || !period_start || !period_end) return res.status(400).json({ error: 'Employee and period are required' });

    const contributionNumber = await getNextCode('sss_contributions', 'contribution_number', 'SSS-', 5);
    const id = uuidv4();
    const empAmt = parseFloat(employer_amount || 0);
    const eeAmt = parseFloat(employee_amount || 0);
    const totalAmt = empAmt + eeAmt;

    await query(
      `INSERT INTO sss_contributions (id, contribution_number, employee_id, period_start, period_end, employer_amount, employee_amount, total_amount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, contributionNumber, employee_id, period_start, period_end, empAmt, eeAmt, totalAmt, notes, req.user!.id]
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

    const totalAmount = parseFloat(sc.rows[0].total_amount);
    const creditAccount = payment_account_type === 'bank' ? '1010' : '1000';

    const jeNumber = await getNextCode('journal_entries', 'entry_number', 'JE-', 4);
    await createJournalEntry(jeNumber, new Date(), 'SSS Payment', req.params.id, `SSS Payment ${sc.rows[0].contribution_number}`,
      [
        { accountCode: '2310', description: 'SSS Payable', debit: totalAmount, credit: 0 },
        { accountCode: creditAccount, description: 'Cash/Bank disbursement', debit: 0, credit: totalAmount },
      ],
      req.user!.id
    );

    if (payment_account_type === 'bank') {
      const bank = await query('SELECT id FROM bank_accounts WHERE is_active = true LIMIT 1');
      if (bank.rows.length > 0) {
        await createBankTransaction(totalAmount, 'SSS Payment', req.params.id, `SSS payment ${sc.rows[0].contribution_number}`, req.user!.id, bank.rows[0].id);
      }
    } else {
      await createCashTransaction('Cash Out', totalAmount, 'SSS Payment', req.params.id, `SSS payment ${sc.rows[0].contribution_number}`, req.user!.id);
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

// Print payroll
router.get('/payroll/:id/print', async (req: AuthRequest, res: Response) => {
  try {
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try { jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Invalid token' }); }

    const r = await query(
      `SELECT p.*, e.first_name, e.last_name, e.employee_code, e.department, e.position,
              e.daily_rate, e.monthly_rate, e.cash_advance_balance, e.grocery_credit_balance AS grocery_balance,
              u.full_name as created_by_name
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN users u ON p.created_by = u.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const bizName = b.business_name || 'D METRAN TRADING';

    const gross = parseFloat(d.gross_pay) || 0;
    const ssS = parseFloat(d.sss_contribution) || 0;
    const philH = parseFloat(d.philhealth_contribution) || 0;
    const pagIbig = parseFloat(d.pagibig_contribution) || 0;
    const ca = parseFloat(d.cash_advance_deduction) || 0;
    const gc = parseFloat(d.grocery_credit_deduction) || 0;
    const otherDed = parseFloat(d.other_deductions) || 0;
    const totalDed = ssS + philH + pagIbig + ca + gc + otherDed;
    const net = parseFloat(d.net_pay) || 0;

    const fc = (v: number) => v.toLocaleString('en-PH', {minimumFractionDigits:2});

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payslip ${d.payroll_number}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#1a1a1a;padding:6mm 8mm;max-width:210mm;margin:0 auto}
.header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:8px;border-bottom:2px solid #1e3a5f}
.header h1{font-size:16px;color:#1e3a5f;margin:0}
.header .doc-num{font-size:11px;font-weight:bold;color:#1e3a5f;text-align:right}
.doc-title{text-align:center;margin:8px 0;font-size:14px;font-weight:bold;color:#1e3a5f}
.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 16px;margin:8px 0;padding:8px;border:1px solid #dde1e6;border-radius:6px;background:#f8f9fa}
.info-grid .lbl{font-size:7px;color:#5f6368;text-transform:uppercase}
.info-grid .val{font-size:9px;font-weight:600}
.items-table{width:100%;border-collapse:collapse;margin:8px 0;font-size:8px}
.items-table th{background:#1e3a5f;color:#fff;padding:5px 8px;text-align:left;font-size:7px;text-transform:uppercase}
.items-table td{padding:5px 8px;border-bottom:1px solid #e8eaed}
.items-table td:last-child{text-align:right;font-weight:600}
.summary{display:flex;justify-content:flex-end;margin:8px 0}
.summary-table{border-collapse:collapse;font-size:9px;width:260px}
.summary-table td{padding:3px 8px}
.summary-table td:last-child{text-align:right;font-weight:600}
.summary-table .grand{border-top:2px solid #1e3a5f;font-size:13px;font-weight:bold;color:#1e3a5f}
.signatures{display:flex;justify-content:space-between;margin-top:24px;gap:10px}
.sig-block{text-align:center;flex:1}
.sig-block .sig-line{border-bottom:1px solid #1e3a5f;height:30px;margin-bottom:3px}
.sig-block .sig-label{font-size:7px;color:#5f6368;font-weight:600}
.footer{text-align:center;font-size:6px;color:#999;margin-top:12px;border-top:1px solid #e8eaed;padding-top:6px}
@media print{body{padding:4mm 6mm}}
</style></head><body>
<div class="header">
<div><h1>${bizName}</h1><div style="font-size:7px;color:#666">Payroll / Payslip</div></div>
<div class="doc-num">${d.payroll_number}<br><div style="font-size:8px;font-weight:normal;color:#5f6368">${new Date(d.pay_period_start).toLocaleDateString('en-PH')} - ${new Date(d.pay_period_end).toLocaleDateString('en-PH')}</div></div>
</div>
<div class="doc-title">PAYSLIP / PAYROLL</div>
<div class="info-grid">
<div><span class="lbl">Employee</span><br><span class="val">${d.last_name}, ${d.first_name}</span></div>
<div><span class="lbl">Code</span><br><span class="val">${d.employee_code || '—'}</span></div>
<div><span class="lbl">Status</span><br><span class="val">${d.status}</span></div>
<div><span class="lbl">Department</span><br><span class="val">${d.department || '—'}</span></div>
<div><span class="lbl">Position</span><br><span class="val">${d.position || '—'}</span></div>
<div><span class="lbl">Days Worked</span><br><span class="val">${d.days_worked || 0}</span></div>
<div><span class="lbl">Daily Rate</span><br><span class="val">₱${fc(d.daily_rate || 0)}</span></div>
<div><span class="lbl">Monthly Rate</span><br><span class="val">₱${fc(d.monthly_rate || 0)}</span></div>
<div><span class="lbl">Gross Pay</span><br><span class="val">₱${fc(gross)}</span></div>
</div>
<table class="items-table">
<thead><tr><th>Description</th><th style="text-align:center">Type</th><th style="text-align:right">Amount</th></tr></thead>
<tbody>
<tr><td>Gross Pay</td><td style="text-align:center">Earnings</td><td>₱${fc(gross)}</td></tr>
${ssS > 0 ? '<tr><td>SSS Contribution</td><td style="text-align:center">Deduction</td><td>₱' + fc(ssS) + '</td></tr>' : ''}
${philH > 0 ? '<tr><td>PhilHealth Contribution</td><td style="text-align:center">Deduction</td><td>₱' + fc(philH) + '</td></tr>' : ''}
${pagIbig > 0 ? '<tr><td>Pag-IBIG Contribution</td><td style="text-align:center">Deduction</td><td>₱' + fc(pagIbig) + '</td></tr>' : ''}
${ca > 0 ? '<tr><td>Cash Advance Deduction</td><td style="text-align:center">Deduction</td><td>₱' + fc(ca) + '</td></tr>' : ''}
${gc > 0 ? '<tr><td>Grocery Credit Deduction</td><td style="text-align:center">Deduction</td><td>₱' + fc(gc) + '</td></tr>' : ''}
${otherDed > 0 ? '<tr><td>Other Deductions</td><td style="text-align:center">Deduction</td><td>₱' + fc(otherDed) + '</td></tr>' : ''}
</tbody>
</table>
<div class="summary">
<table class="summary-table">
<tr><td>Gross Pay:</td><td>₱${fc(gross)}</td></tr>
<tr><td>Total Deductions:</td><td>₱${fc(totalDed)}</td></tr>
<tr class="grand"><td>Net Pay:</td><td>₱${fc(net)}</td></tr>
</table>
</div>
<div class="signatures">
<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Prepared by</div></div>
<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Approved by</div></div>
<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Received by</div></div>
</div>
<div class="footer">Printed: ${new Date().toLocaleString('en-PH')} | Computer-generated payslip</div>
</body></html>`;
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// Print payroll payment voucher
router.get('/payroll/:id/payment-voucher/print', async (req: AuthRequest, res: Response) => {
  try {
    const token = req.query.token as string || (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Auth required' });
    try { jwt.verify(token, config.jwtSecret); } catch { return res.status(401).json({ error: 'Invalid token' }); }

    const r = await query(
      `SELECT p.*, e.first_name, e.last_name, e.employee_code, e.department, e.position,
              u.full_name as created_by_name
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN users u ON p.created_by = u.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const d = r.rows[0];
    if (!d.payment_voucher_number) return res.status(400).send('Payroll not yet paid');

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};
    const bizName = b.business_name || 'D METRAN TRADING';

    const netPay = parseFloat(d.net_pay) || 0;
    const fc = (v: number) => v.toLocaleString('en-PH', {minimumFractionDigits:2});
    const payMethod = d.payment_account_type === 'bank' ? 'Bank Transfer' : 'Cash';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payment Voucher ${d.payment_voucher_number}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Courier New',monospace;font-size:10px;color:#111;padding:8mm 12mm;max-width:210mm;margin:0 auto;letter-spacing:0.2px}
.company-header{text-align:center;margin-bottom:8px}
.company-header h1{font-size:18px;font-weight:bold;letter-spacing:4px;margin:0}
.company-header .tagline{font-size:9px;color:#111;margin:3px 0}
.company-header .info{font-size:8px;color:#111;margin:2px 0}
.dot-divider{text-align:center;font-size:11px;font-weight:bold;margin:4px 0;letter-spacing:1px}
.dot-divider-thin{text-align:center;font-size:10px;color:#444;margin:2px 0;letter-spacing:1px}
.doc-title{text-align:center;border:1px dotted #444;padding:6px 0;margin:8px 0}
.doc-title h2{font-size:14px;font-weight:bold;letter-spacing:6px;margin:0}
.doc-title .sub{font-size:9px;color:#333}
.details{display:flex;gap:20px;margin:10px 0}
.details-left{flex:1;border:1px dotted #444;padding:8px 10px}
.details-right{flex:1;border:1px dotted #444;padding:8px 10px}
.details-left .label,.details-right .label{font-size:9px;font-weight:bold;text-transform:uppercase;margin-bottom:5px}
.details p{font-size:9px;margin:2px 0}
.details .amount{font-size:16px;font-weight:bold;margin-top:4px}
.items-table{width:100%;border-collapse:collapse;margin:10px 0}
.items-table th{background:#f8f8f8;border:1px dotted #444;padding:5px 6px;font-size:9px;text-align:left;font-weight:bold}
.items-table td{border:1px dotted #444;padding:4px 6px;font-size:9px}
.computation{display:flex;justify-content:flex-end;margin:10px 0}
.comp-table{width:260px;border-collapse:collapse}
.comp-table td{padding:3px 8px;font-size:9px}
.comp-table td:last-child{text-align:right}
.comp-table .total-row{border-top:2px dotted #000;font-size:12px;font-weight:bold}
.signatures{display:flex;justify-content:space-between;margin-top:28px;gap:10px}
.sig-block{text-align:center;flex:1}
.sig-block .sig-line{border-bottom:1px solid #000;height:34px;margin-bottom:4px}
.sig-block .sig-label{font-size:8px;color:#222}
.footer-note{text-align:center;font-size:7px;color:#666;margin-top:14px}
@media print{body{padding:5mm 8mm}}
</style></head><body>

<div class="company-header">
<h1>${bizName}</h1>
<div class="tagline">${(b.trade_name || '')}</div>
<div class="info">${b.address || ''}${b.city ? ', ' + b.city : ''} | Tel: ${b.telephone_number || b.mobile_number || ''}</div>
</div>
<div class="dot-divider">================================================</div>

<div class="doc-title">
<h2>PAYMENT VOUCHER</h2>
<div class="sub">${d.payment_voucher_number}</div>
</div>

<div class="details">
<div class="details-left">
<div class="label">Payee / Employee</div>
<p><strong>Name:</strong> ${d.last_name}, ${d.first_name}</p>
<p><strong>Code:</strong> ${d.employee_code || '—'}</p>
<p><strong>Department:</strong> ${d.department || '—'}</p>
</div>
<div class="details-right">
<div class="label">Payment Details</div>
<p><strong>Payroll #:</strong> ${d.payroll_number}</p>
<p><strong>Pay Period:</strong> ${new Date(d.pay_period_start).toLocaleDateString('en-PH')} - ${new Date(d.pay_period_end).toLocaleDateString('en-PH')}</p>
<p><strong>Payment Date:</strong> ${d.payment_date ? new Date(d.payment_date).toLocaleDateString('en-PH') : '—'}</p>
<p><strong>Method:</strong> ${payMethod}</p>
${d.payment_ref ? '<p><strong>Ref #:</strong> ' + d.payment_ref + '</p>' : ''}
</div>
</div>

<table class="items-table">
<thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
<tbody>
<tr><td>Gross Pay (${d.days_worked || 0} days)</td><td style="text-align:right">₱${fc(parseFloat(d.gross_pay) || 0)}</td></tr>
<tr><td>Total Deductions</td><td style="text-align:right">₱${fc(parseFloat(d.deductions_total) || 0)}</td></tr>
</tbody>
</table>

<div class="computation">
<table class="comp-table">
<tr><td>Gross Pay:</td><td>₱${fc(parseFloat(d.gross_pay) || 0)}</td></tr>
<tr><td>Total Deductions:</td><td>₱${fc(parseFloat(d.deductions_total) || 0)}</td></tr>
<tr class="total-row"><td>NET PAY DISBURSED:</td><td>₱${fc(netPay)}</td></tr>
</table>
</div>

<div class="signatures">
<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Prepared by</div></div>
<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Approved by</div></div>
<div class="sig-block"><div class="sig-line"></div><div class="sig-label">Received by</div></div>
</div>

<div class="footer-note">Printed: ${new Date().toLocaleString('en-PH')} | Computer-generated payment voucher</div>
</body></html>`;
    res.send(html);
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
