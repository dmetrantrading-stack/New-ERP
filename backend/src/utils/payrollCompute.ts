import { v4 as uuidv4 } from 'uuid';
import { query as defaultQuery } from '../config/database';

type DbQuery = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

export interface PayrollOtherDeduction {
  type: string;
  amount: number | string;
}

export interface ComputedPayroll {
  employee_id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  daily_rate: number;
  days_worked: number;
  gross_pay: number;
  cash_advance_deduction: number;
  grocery_credit_deduction: number;
  other_deductions: number;
  deductions_total: number;
  net_pay: number;
  skip_reason: string | null;
  selectable: boolean;
}

const WORKED_DAYS_SQL = `
  SELECT COALESCE(SUM(
    CASE status
      WHEN 'Half-day' THEN 0.5
      WHEN 'Present' THEN 1
      WHEN 'Late' THEN 1
      ELSE 0
    END
  ), 0) AS worked
  FROM attendance
  WHERE employee_id = $1 AND date >= $2 AND date <= $3
    AND status IN ('Present', 'Late', 'Half-day')
`;

export async function getAttendanceWorkedDays(
  db: DbQuery,
  employeeId: number,
  from: string,
  to: string,
): Promise<number> {
  const r = await db(WORKED_DAYS_SQL, [employeeId, from, to]);
  return parseFloat(r.rows[0]?.worked) || 0;
}

export async function findExistingPayrollForPeriod(
  db: DbQuery,
  employeeId: number,
  payPeriodStart: string,
  payPeriodEnd: string,
): Promise<string | null> {
  const r = await db(
    `SELECT payroll_number FROM payroll
     WHERE employee_id = $1 AND pay_period_start = $2::date AND pay_period_end = $3::date
       AND status != 'Cancelled'
     LIMIT 1`,
    [employeeId, payPeriodStart, payPeriodEnd],
  );
  return r.rows[0]?.payroll_number || null;
}

export async function computeCashAdvanceDeduction(
  db: DbQuery,
  employeeId: number,
  grossPay: number,
): Promise<number> {
  if (grossPay <= 0) return 0;

  const activeCAs = await db(
    `SELECT remaining_balance, installment_amount FROM cash_advances
     WHERE employee_id = $1 AND status = 'Active' AND remaining_balance > 0
     ORDER BY advance_date ASC, created_at ASC`,
    [employeeId],
  );

  let caDeduction = 0;
  for (const ca of activeCAs.rows) {
    const bal = parseFloat(ca.remaining_balance);
    const instAmt = parseFloat(ca.installment_amount || '0');
    const cap = instAmt > 0 ? Math.min(instAmt, bal) : bal;
    const deduct = Math.min(cap, Math.max(0, grossPay - caDeduction));
    caDeduction += deduct;
  }
  return Math.min(caDeduction, grossPay);
}

export async function computeGroceryCreditDeduction(
  db: DbQuery,
  employeeId: number,
  grossPay: number,
  caDeduction: number,
): Promise<number> {
  const gcResult = await db(
    `SELECT COALESCE(SUM(balance), 0) AS total FROM sales_invoices
     WHERE employee_id = $1 AND customer_type = 'Employee' AND status IN ('Posted', 'Partial')`,
    [employeeId],
  );
  const gcBalance = parseFloat(gcResult.rows[0]?.total) || 0;
  const remainingAfterCA = grossPay - caDeduction;
  return Math.min(gcBalance, Math.max(0, remainingAfterCA));
}

export async function computePayrollAmounts(
  db: DbQuery,
  employee: { id: number; employee_code: string; first_name: string; last_name: string; daily_rate: number | string },
  daysWorked: number,
  otherDeductions: PayrollOtherDeduction[] = [],
): Promise<Omit<ComputedPayroll, 'skip_reason' | 'selectable'>> {
  const dailyRate = parseFloat(String(employee.daily_rate)) || 0;
  const days = Math.max(0, daysWorked);
  const grossPay = Math.round(days * dailyRate * 100) / 100;
  const caDeduction = await computeCashAdvanceDeduction(db, employee.id, grossPay);
  const gcDeduction = await computeGroceryCreditDeduction(db, employee.id, grossPay, caDeduction);
  const otherTotal = (otherDeductions || []).reduce(
    (s, d) => s + (parseFloat(String(d.amount)) || 0),
    0,
  );
  const deductionsTotal = caDeduction + gcDeduction + otherTotal;
  const netPay = Math.max(0, Math.round((grossPay - deductionsTotal) * 100) / 100);

  return {
    employee_id: employee.id,
    employee_code: employee.employee_code,
    first_name: employee.first_name,
    last_name: employee.last_name,
    daily_rate: dailyRate,
    days_worked: days,
    gross_pay: grossPay,
    cash_advance_deduction: caDeduction,
    grocery_credit_deduction: gcDeduction,
    other_deductions: otherTotal,
    deductions_total: deductionsTotal,
    net_pay: netPay,
  };
}

export async function previewBatchPayroll(
  payPeriodStart: string,
  payPeriodEnd: string,
  overrides: { employee_id: number; days_worked?: number }[] = [],
  db: DbQuery = defaultQuery,
): Promise<ComputedPayroll[]> {
  const overrideMap = new Map(overrides.map((o) => [Number(o.employee_id), o.days_worked]));

  const emps = await db(
    `SELECT id, employee_code, first_name, last_name, daily_rate
     FROM employees WHERE is_active = true
     ORDER BY last_name, first_name`,
  );

  const rows: ComputedPayroll[] = [];
  for (const emp of emps.rows) {
    const employeeId = Number(emp.id);
    const existing = await findExistingPayrollForPeriod(db, employeeId, payPeriodStart, payPeriodEnd);
    const daysWorked = overrideMap.has(employeeId)
      ? Math.max(0, Number(overrideMap.get(employeeId)) || 0)
      : await getAttendanceWorkedDays(db, employeeId, payPeriodStart, payPeriodEnd);

    const amounts = await computePayrollAmounts(db, emp, daysWorked);
    let skipReason: string | null = null;
    if (existing) skipReason = `Already has payroll ${existing} for this period`;
    else if (daysWorked <= 0) skipReason = 'No attendance days in period';

    rows.push({
      ...amounts,
      skip_reason: skipReason,
      selectable: !skipReason,
    });
  }
  return rows;
}

export async function insertPayrollRecord(
  db: DbQuery,
  getNextPayrollNumber: () => Promise<string>,
  params: {
    employee_id: number;
    pay_period_start: string;
    pay_period_end: string;
    days_worked: number;
    other_deductions?: PayrollOtherDeduction[];
    notes?: string;
    created_by: string;
  },
  precomputed?: Omit<ComputedPayroll, 'skip_reason' | 'selectable'>,
): Promise<{ id: string; payroll_number: string; net_pay: number }> {
  const emp = await db('SELECT * FROM employees WHERE id = $1', [params.employee_id]);
  if (emp.rows.length === 0) throw new Error(`Employee ${params.employee_id} not found`);

  const amounts = precomputed
    ?? await computePayrollAmounts(db, emp.rows[0], params.days_worked, params.other_deductions);

  const payroll_number = await getNextPayrollNumber();
  const id = uuidv4();

  await db(
    `INSERT INTO payroll (id, payroll_number, employee_id, pay_period_start, pay_period_end, days_worked,
      gross_pay, cash_advance_deduction, grocery_credit_deduction, other_deductions, deductions_total, net_pay, notes, created_by)
     VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      id, payroll_number, params.employee_id, params.pay_period_start, params.pay_period_end,
      amounts.days_worked, amounts.gross_pay, amounts.cash_advance_deduction,
      amounts.grocery_credit_deduction, amounts.other_deductions, amounts.deductions_total,
      amounts.net_pay, params.notes || null, params.created_by,
    ],
  );

  if (amounts.cash_advance_deduction > 0) {
    await db(
      `INSERT INTO payroll_deductions (id, payroll_id, deduction_type, amount) VALUES ($1,$2,'Cash Advance',$3)`,
      [uuidv4(), id, amounts.cash_advance_deduction],
    );
  }
  if (amounts.grocery_credit_deduction > 0) {
    await db(
      `INSERT INTO payroll_deductions (id, payroll_id, deduction_type, amount) VALUES ($1,$2,'Grocery Credit',$3)`,
      [uuidv4(), id, amounts.grocery_credit_deduction],
    );
  }
  for (const d of params.other_deductions || []) {
    await db(
      `INSERT INTO payroll_deductions (id, payroll_id, deduction_type, amount) VALUES ($1,$2,$3,$4)`,
      [uuidv4(), id, d.type, d.amount],
    );
  }

  return { id, payroll_number, net_pay: amounts.net_pay };
}
