import { v4 as uuidv4 } from 'uuid';

/** Run queries on the same connection (typically inside BEGIN/COMMIT). */
export type QueryFn = (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

export async function getNextCodeTx(
  q: QueryFn,
  table: string,
  field: string,
  prefix: string,
  startPos: number,
): Promise<string> {
  const r = await q(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${field} FROM ${startPos}) AS INTEGER)), 0) + 1 as next FROM ${table} WHERE ${field} ~ '^${prefix}'`,
  );
  return `${prefix}${String(r.rows[0]?.next || 1).padStart(5, '0')}`;
}

export async function createJournalEntryTx(
  q: QueryFn,
  entryNumber: string,
  date: Date | string,
  refType: string,
  refId: string,
  desc: string,
  lines: { accountCode: string; description: string; debit: number; credit: number }[],
  createdBy: string,
): Promise<string> {
  const entryId = uuidv4();
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

  await q(
    `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
     VALUES ($1, $2, $3::date, $4, $5::uuid, $6, $7, $8, $9::uuid)`,
    [entryId, entryNumber, date, refType, refId, desc, totalDebit, totalCredit, createdBy],
  );

  for (const line of lines) {
    await q(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3::varchar), $4, $5, $6, $7, $8::uuid)`,
      [uuidv4(), entryId, line.accountCode, line.description, line.debit, line.credit, refType, refId],
    );
  }

  return entryId;
}

/** Apply CA deductions FIFO and record exact allocations per cash_advance row. */
export async function applyCashAdvanceDeductions(
  q: QueryFn,
  payrollId: string,
  employeeId: number,
  totalAmount: number,
): Promise<void> {
  if (totalAmount <= 0) return;

  let remaining = totalAmount;
  const activeCAs = await q(
    `SELECT * FROM cash_advances
     WHERE employee_id = $1 AND status = 'Active' AND remaining_balance > 0
     ORDER BY advance_date ASC, created_at ASC
     FOR UPDATE`,
    [employeeId],
  );

  for (const ca of activeCAs.rows) {
    if (remaining <= 0) break;
    const caBal = parseFloat(ca.remaining_balance);
    const deduct = Math.min(caBal, remaining);
    if (deduct <= 0) continue;

    const newBal = caBal - deduct;
    await q(
      `UPDATE cash_advances SET remaining_balance = $1::numeric,
        status = CASE WHEN $1::numeric <= 0 THEN 'Fully Paid' ELSE 'Active' END,
        updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newBal, ca.id],
    );
    await q(
      `INSERT INTO payroll_deduction_allocations (id, payroll_id, allocation_type, cash_advance_id, amount)
       VALUES ($1, $2, 'Cash Advance', $3, $4)`,
      [uuidv4(), payrollId, ca.id, deduct],
    );
    remaining -= deduct;
  }

  if (remaining > 0.005) {
    throw new Error(
      `Cash advance deduction could not be fully applied (${remaining.toFixed(2)} remaining). ` +
        'Employee advance balances may have changed since payroll was computed — refresh and recompute if needed.',
    );
  }
}

/** Apply grocery credit deductions FIFO and record exact allocations per sales invoice. */
export async function applyGroceryCreditDeductions(
  q: QueryFn,
  payrollId: string,
  employeeId: number,
  totalAmount: number,
): Promise<void> {
  if (totalAmount <= 0) return;

  let remaining = totalAmount;
  const invoices = await q(
    `SELECT * FROM sales_invoices
     WHERE employee_id = $1 AND customer_type = 'Employee' AND status IN ('Posted', 'Partial') AND balance > 0
     ORDER BY invoice_date ASC, created_at ASC
     FOR UPDATE`,
    [employeeId],
  );

  for (const inv of invoices.rows) {
    if (remaining <= 0) break;
    const invBal = parseFloat(inv.balance);
    const deduct = Math.min(invBal, remaining);
    if (deduct <= 0) continue;

    const newBalance = invBal - deduct;
    const newPaid = (parseFloat(inv.amount_paid) || 0) + deduct;
    const newStatus = newBalance <= 0.005 ? 'Deducted' : 'Partial';

    await q(
      `UPDATE sales_invoices SET balance = $1, amount_paid = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [Math.max(0, newBalance), newPaid, newStatus, inv.id],
    );
    await q(
      `INSERT INTO payroll_deduction_allocations (id, payroll_id, allocation_type, sales_invoice_id, amount)
       VALUES ($1, $2, 'Grocery Credit', $3, $4)`,
      [uuidv4(), payrollId, inv.id, deduct],
    );
    remaining -= deduct;
  }

  if (remaining > 0.005) {
    throw new Error(
      `Grocery credit deduction could not be fully applied (${remaining.toFixed(2)} remaining). ` +
        'Invoice balances may have changed since payroll was computed — refresh and recompute if needed.',
    );
  }
}

/** Restore CA/GC balances from stored allocations (exact reversal of approve). */
export async function restorePayrollDeductionAllocations(q: QueryFn, payrollId: string): Promise<void> {
  const allocs = await q(
    `SELECT * FROM payroll_deduction_allocations WHERE payroll_id = $1 ORDER BY created_at ASC`,
    [payrollId],
  );

  for (const a of allocs.rows) {
    const amount = parseFloat(a.amount);
    if (amount <= 0) continue;

    if (a.allocation_type === 'Cash Advance' && a.cash_advance_id) {
      const ca = await q(`SELECT * FROM cash_advances WHERE id = $1 FOR UPDATE`, [a.cash_advance_id]);
      if (ca.rows.length === 0) {
        throw new Error(`Cash advance record ${a.cash_advance_id} not found during payroll cancel restore`);
      }
      const row = ca.rows[0];
      const original = parseFloat(row.amount);
      const newBal = parseFloat(row.remaining_balance) + amount;
      if (newBal > original + 0.005) {
        throw new Error(`Restore would exceed original cash advance amount (${row.id})`);
      }
      await q(
        `UPDATE cash_advances SET remaining_balance = $1::numeric,
          status = CASE WHEN $1::numeric <= 0 THEN 'Fully Paid' ELSE 'Active' END,
          updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newBal, a.cash_advance_id],
      );
    } else if (a.allocation_type === 'Grocery Credit' && a.sales_invoice_id) {
      const inv = await q(`SELECT * FROM sales_invoices WHERE id = $1 FOR UPDATE`, [a.sales_invoice_id]);
      if (inv.rows.length === 0) {
        throw new Error(`Sales invoice ${a.sales_invoice_id} not found during payroll cancel restore`);
      }
      const row = inv.rows[0];
      const total = parseFloat(row.total);
      const newPaid = Math.max(0, (parseFloat(row.amount_paid) || 0) - amount);
      const newBalance = Math.max(0, total - newPaid);
      const newStatus = newBalance <= 0.005 ? 'Deducted' : newPaid > 0.005 ? 'Partial' : 'Posted';
      await q(
        `UPDATE sales_invoices SET balance = $1, amount_paid = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
        [newBalance, newPaid, newStatus, a.sales_invoice_id],
      );
    }
  }

  await q(`DELETE FROM payroll_deduction_allocations WHERE payroll_id = $1`, [payrollId]);
}

export async function countPayrollAllocations(q: QueryFn, payrollId: string): Promise<number> {
  const r = await q(`SELECT COUNT(*)::int AS cnt FROM payroll_deduction_allocations WHERE payroll_id = $1::uuid`, [payrollId]);
  return r.rows[0]?.cnt || 0;
}
