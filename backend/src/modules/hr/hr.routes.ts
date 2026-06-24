import { Router, Response } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm, hasUserAnyPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import {
  tableRow, fc, fmtCurrency, fmtDate,
  renderEnterpriseSectionTitle, renderEnterpriseNotesBlock,
} from '../../utils/printLayout';
import {
  buildSalesEnterpriseDocument,
  buildEmployeeMetaRows,
  buildEnterpriseSignatures,
} from '../../utils/salesEnterprisePrint';
import {
  applyCashAdvanceDeductions,
  applyGroceryCreditDeductions,
  restorePayrollDeductionAllocations,
  countPayrollAllocations,
  createJournalEntryTx,
  getNextCodeTx,
  type QueryFn,
} from '../../utils/payrollAllocations';
import {
  findExistingPayrollForPeriod,
  getAttendanceWorkedDays,
  insertPayrollRecord,
  previewBatchPayroll,
} from '../../utils/payrollCompute';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/csv'
      || file.originalname.endsWith('.csv')
      || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || file.originalname.endsWith('.xlsx');
    cb(null, ok);
  },
});

const empExport = hasUserPerm('hr.employees.export');
const empImport = hasUserAnyPerm(['hr.employees.create', 'hr.employees.import']);

const escCsv = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const importCell = (row: string[], headerMap: Record<string, number>, col: string, fallback = '') =>
  String(headerMap[col] !== undefined ? row[headerMap[col]] ?? fallback : fallback).trim();

const parseImportNumber = (raw: string) => {
  const n = parseFloat(String(raw).replace(/[₱$,\s]/g, ''));
  return n;
};

const cellToImportString = (cell: unknown): string => {
  if (cell instanceof Date && !isNaN(cell.getTime())) {
    return cell.toISOString().slice(0, 10);
  }
  return String(cell ?? '').trim();
};

const EMPLOYMENT_TYPES = new Set(['Regular', 'Contractual', 'Probationary', 'Part-time']);

const normalizeEmploymentType = (raw: string): string => {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  const map: Record<string, string> = {
    regular: 'Regular',
    contractual: 'Contractual',
    probationary: 'Probationary',
    'part-time': 'Part-time',
    'part time': 'Part-time',
    parttime: 'Part-time',
  };
  return map[key] || raw.trim();
};

const parseImportDate = (raw: string): string | null => {
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    const month = parseInt(slash[1], 10);
    const day = parseInt(slash[2], 10);
    const year = slash[3];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const n = parseFloat(s.replace(/,/g, ''));
  if (!isNaN(n) && n >= 1 && n < 1000000) {
    const dc = XLSX.SSF.parse_date_code(n);
    if (dc && dc.y >= 1900 && dc.y <= 2100) {
      return `${dc.y}-${String(dc.m).padStart(2, '0')}-${String(dc.d).padStart(2, '0')}`;
    }
  }

  return null;
};

const parseEmployeeFile = (buffer: Buffer, originalName: string): { headers: string[]; rows: string[][] } => {
  if (originalName.endsWith('.xlsx')) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (aoa.length < 2) throw new AppError('File must have a header row and at least one data row');
    const headers = aoa[0].map((h) => String(h).trim());
    const rows = aoa.slice(1).filter((r) => (r as unknown[]).some((c) => cellToImportString(c)));
    return { headers, rows: rows.map((r) => (r as unknown[]).map((c) => cellToImportString(c))) };
  }
  const content = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new AppError('File must have a header row and at least one data row');
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    result.push(current.trim());
    return result;
  };
  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
};

const buildEmployeeHeaderMap = (headers: string[]): Record<string, number> => {
  const headerMap: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (h === 'employee code' || h === 'code') headerMap['Employee Code'] = i;
    else if (h === 'first name') headerMap['First Name'] = i;
    else if (h === 'last name') headerMap['Last Name'] = i;
    else if (h === 'middle name') headerMap['Middle Name'] = i;
    else if (h === 'address') headerMap['Address'] = i;
    else if (h === 'phone') headerMap['Phone'] = i;
    else if (h === 'email') headerMap['Email'] = i;
    else if (h === 'position') headerMap['Position'] = i;
    else if (h === 'department') headerMap['Department'] = i;
    else if (h === 'daily rate') headerMap['Daily Rate'] = i;
    else if (h === 'monthly rate') headerMap['Monthly Rate'] = i;
    else if (h === 'sss') headerMap['SSS'] = i;
    else if (h === 'philhealth') headerMap['PhilHealth'] = i;
    else if (h === 'pag-ibig' || h === 'pagibig') headerMap['Pag-IBIG'] = i;
    else if (h === 'tin') headerMap['TIN'] = i;
    else if (h === 'employment type') headerMap['Employment Type'] = i;
    else if (h === 'hire date') headerMap['Hire Date'] = i;
    else if (h === 'credit limit') headerMap['Credit Limit'] = i;
    else if (h === 'sss default amount' || h === 'sss default') headerMap['SSS Default Amount'] = i;
    else if (h === 'active' || h === 'is_active') headerMap['Active'] = i;
  }
  return headerMap;
};

const parseEmployeeRow = (row: string[], headerMap: Record<string, number>) => {
  const entry: any = {
    employee_code: importCell(row, headerMap, 'Employee Code'),
    first_name: importCell(row, headerMap, 'First Name'),
    last_name: importCell(row, headerMap, 'Last Name'),
    middle_name: importCell(row, headerMap, 'Middle Name'),
    address: importCell(row, headerMap, 'Address'),
    phone: importCell(row, headerMap, 'Phone'),
    email: importCell(row, headerMap, 'Email'),
    position: importCell(row, headerMap, 'Position'),
    department: importCell(row, headerMap, 'Department'),
    daily_rate: importCell(row, headerMap, 'Daily Rate', '0'),
    monthly_rate: importCell(row, headerMap, 'Monthly Rate', '0'),
    sss: importCell(row, headerMap, 'SSS'),
    philhealth: importCell(row, headerMap, 'PhilHealth'),
    pagibig: importCell(row, headerMap, 'Pag-IBIG'),
    tin: importCell(row, headerMap, 'TIN'),
    employment_type: normalizeEmploymentType(importCell(row, headerMap, 'Employment Type', 'Regular') || 'Regular'),
    hire_date: importCell(row, headerMap, 'Hire Date'),
    credit_limit: importCell(row, headerMap, 'Credit Limit', '0'),
    sss_default_amount: importCell(row, headerMap, 'SSS Default Amount', '0'),
    active_raw: importCell(row, headerMap, 'Active', 'yes'),
    has_errors: false,
    errors: [] as string[],
  };

  if (!entry.first_name) { entry.has_errors = true; entry.errors.push('First name is required'); }
  if (!entry.last_name) { entry.has_errors = true; entry.errors.push('Last name is required'); }

  ['daily_rate', 'monthly_rate', 'credit_limit', 'sss_default_amount'].forEach((f) => {
    if (entry[f] && isNaN(parseImportNumber(entry[f]))) {
      entry.has_errors = true;
      entry.errors.push(`${f} must be a number`);
    }
  });

  const et = entry.employment_type;
  if (et && !EMPLOYMENT_TYPES.has(et)) {
    entry.has_errors = true;
    entry.errors.push(`Employment type must be Regular, Contractual, Probationary, or Part-time`);
  }

  if (entry.hire_date) {
    const parsedDate = parseImportDate(entry.hire_date);
    if (!parsedDate) {
      entry.has_errors = true;
      entry.errors.push('Hire date must be YYYY-MM-DD or a valid Excel date');
    } else {
      entry.hire_date = parsedDate;
    }
  }

  return entry;
};

const EMPLOYEE_EXPORT_HEADERS = [
  'Employee Code', 'First Name', 'Last Name', 'Middle Name', 'Address', 'Phone', 'Email',
  'Position', 'Department', 'Daily Rate', 'Monthly Rate', 'SSS', 'PhilHealth', 'Pag-IBIG', 'TIN',
  'Employment Type', 'Hire Date', 'Credit Limit', 'SSS Default Amount', 'Active',
];

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
     VALUES ($1, $2, $3::date, $4, $5::uuid, $6, $7, $8, $9::uuid)`,
    [entryId, entryNumber, date, refType, refId, desc, totalDebit, totalCredit, createdBy]
  );

  for (const line of lines) {
    await query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, (SELECT id FROM chart_of_accounts WHERE account_code = $3::varchar), $4, $5, $6, $7, $8::uuid)`,
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
const HR_MODULE_VIEW = [
  'hr.employees.view',
  'hr.attendance.view',
  'hr.payroll.view',
  'hr.payslip.view',
  'hr.cash-advances.view',
] as const;

router.get('/employees', authenticate, hasUserPerm('hr.employees.view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM employees WHERE is_active = true ORDER BY last_name, first_name');
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/employees/all', authenticate, hasUserPerm('hr.employees.view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM employees ORDER BY last_name, first_name');
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.get('/employees/export/template', authenticate, empExport, async (_req: AuthRequest, res: Response) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=employee_import_template.csv');
  res.send(`\uFEFF${EMPLOYEE_EXPORT_HEADERS.map(escCsv).join(',')}\n`);
});

router.get('/employees/export', authenticate, empExport, async (req: AuthRequest, res: Response) => {
  try {
    const format = (req.query.format as string) || 'csv';
    const activeOnly = req.query.active !== 'all';
    const where = activeOnly ? 'WHERE is_active = true' : '';
    const result = await query(`SELECT * FROM employees ${where} ORDER BY last_name, first_name`);

    if (format === 'xlsx') {
      const rows = result.rows.map((r: any) => ({
        'Employee Code': r.employee_code,
        'First Name': r.first_name,
        'Last Name': r.last_name,
        'Middle Name': r.middle_name,
        Address: r.address,
        Phone: r.phone,
        Email: r.email,
        Position: r.position,
        Department: r.department,
        'Daily Rate': r.daily_rate,
        'Monthly Rate': r.monthly_rate,
        SSS: r.sss,
        PhilHealth: r.philhealth,
        'Pag-IBIG': r.pagibig,
        TIN: r.tin,
        'Employment Type': r.employment_type,
        'Hire Date': r.hire_date,
        'Credit Limit': r.credit_limit,
        'SSS Default Amount': r.sss_default_amount,
        Active: r.is_active ? 'Yes' : 'No',
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Employees');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=employees_export.xlsx');
      return res.send(buf);
    }

    const csv = `\uFEFF${EMPLOYEE_EXPORT_HEADERS.join(',')}\n${result.rows.map((r: any) => [
      escCsv(r.employee_code), escCsv(r.first_name), escCsv(r.last_name), escCsv(r.middle_name),
      escCsv(r.address), escCsv(r.phone), escCsv(r.email), escCsv(r.position), escCsv(r.department),
      r.daily_rate, r.monthly_rate, escCsv(r.sss), escCsv(r.philhealth), escCsv(r.pagibig), escCsv(r.tin),
      escCsv(r.employment_type), r.hire_date || '', r.credit_limit, r.sss_default_amount, r.is_active ? 'Yes' : 'No',
    ].join(',')).join('\n')}`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=employees_export.csv');
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/employees/import/preview', authenticate, empImport, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) throw new AppError('No file uploaded');
    const { headers, rows } = parseEmployeeFile(req.file.buffer, req.file.originalname);
    const headerMap = buildEmployeeHeaderMap(headers);
    if (!('First Name' in headerMap) || !('Last Name' in headerMap)) {
      throw new AppError('Missing required columns: First Name, Last Name');
    }

    const existing = await query('SELECT id, employee_code, email, first_name, last_name FROM employees');
    const byCode = new Map(existing.rows.map((r: any) => [r.employee_code?.toLowerCase(), r]));
    const byEmail = new Map(existing.rows.filter((r: any) => r.email).map((r: any) => [r.email.toLowerCase(), r]));
    const byName = new Map(existing.rows.map((r: any) => [`${r.last_name}|${r.first_name}`.toLowerCase(), r]));

    const previewRows: any[] = [];
    const errors: { row: number; message: string }[] = [];
    let validRows = 0;

    for (let ri = 0; ri < rows.length; ri++) {
      const entry = parseEmployeeRow(rows[ri], headerMap);
      const rowNum = ri + 2;
      entry.row = rowNum;

      let match: any = null;
      const code = entry.employee_code.trim();
      const email = entry.email.trim().toLowerCase();
      if (code) match = byCode.get(code.toLowerCase());
      if (!match && email) match = byEmail.get(email);
      if (!match) match = byName.get(`${entry.last_name}|${entry.first_name}`.toLowerCase());
      entry.action = match ? 'Update' : 'Create';

      if (!entry.has_errors) validRows++;
      else errors.push({ row: rowNum, message: entry.errors.join('; ') });
      previewRows.push(entry);
    }

    res.json({
      file_name: req.file.originalname,
      total_rows: rows.length,
      valid_rows: validRows,
      error_rows: errors.length,
      rows: previewRows,
      errors,
    });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.post('/employees/import/execute', authenticate, empImport, auditLog('HR', 'Import Employees'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) throw new AppError('No file uploaded');
    const { headers, rows } = parseEmployeeFile(req.file.buffer, req.file.originalname);
    const headerMap = buildEmployeeHeaderMap(headers);
    if (!('First Name' in headerMap) || !('Last Name' in headerMap)) {
      throw new AppError('Missing required columns: First Name, Last Name');
    }

    const existing = await query('SELECT id, employee_code, email, first_name, last_name FROM employees');
    const byCode = new Map(existing.rows.map((r: any) => [r.employee_code?.toLowerCase(), r]));
    const byEmail = new Map(existing.rows.filter((r: any) => r.email).map((r: any) => [r.email.toLowerCase(), r]));
    const byName = new Map(existing.rows.map((r: any) => [`${r.last_name}|${r.first_name}`.toLowerCase(), r]));

    let created = 0;
    let updated = 0;
    const errors: { row: number; message: string }[] = [];

    for (let ri = 0; ri < rows.length; ri++) {
      const rowNum = ri + 2;
      try {
        const entry = parseEmployeeRow(rows[ri], headerMap);
        if (entry.has_errors) {
          errors.push({ row: rowNum, message: entry.errors.join('; ') });
          continue;
        }

        const activeVal = entry.active_raw.toLowerCase();
        const is_active = !activeVal || activeVal === 'yes' || activeVal === 'true' || activeVal === '1' || activeVal === 'active';

        let match: any = null;
        const code = entry.employee_code.trim();
        const email = entry.email.trim().toLowerCase();
        if (code) match = byCode.get(code.toLowerCase());
        if (!match && email) match = byEmail.get(email);
        if (!match) match = byName.get(`${entry.last_name}|${entry.first_name}`.toLowerCase());

        const payload = {
          first_name: entry.first_name,
          last_name: entry.last_name,
          middle_name: entry.middle_name || null,
          address: entry.address || null,
          phone: entry.phone || null,
          email: entry.email || null,
          position: entry.position || null,
          department: entry.department || null,
          daily_rate: parseImportNumber(entry.daily_rate) || 0,
          monthly_rate: parseImportNumber(entry.monthly_rate) || 0,
          sss: entry.sss || null,
          philhealth: entry.philhealth || null,
          pagibig: entry.pagibig || null,
          tin: entry.tin || null,
          employment_type: entry.employment_type || 'Regular',
          hire_date: entry.hire_date || null,
          credit_limit: parseImportNumber(entry.credit_limit) || 0,
          sss_default_amount: parseImportNumber(entry.sss_default_amount) || 0,
          is_active,
        };

        if (match) {
          await query(
            `UPDATE employees SET first_name=$1, last_name=$2, middle_name=$3, address=$4, phone=$5, email=$6,
              position=$7, department=$8, daily_rate=$9, monthly_rate=$10, sss=$11, philhealth=$12, pagibig=$13,
              tin=$14, employment_type=$15, hire_date=$16, credit_limit=$17, sss_default_amount=$18, is_active=$19,
              updated_at=CURRENT_TIMESTAMP WHERE id=$20`,
            [
              payload.first_name, payload.last_name, payload.middle_name, payload.address, payload.phone, payload.email,
              payload.position, payload.department, payload.daily_rate, payload.monthly_rate, payload.sss, payload.philhealth,
              payload.pagibig, payload.tin, payload.employment_type, payload.hire_date, payload.credit_limit,
              payload.sss_default_amount, payload.is_active, match.id,
            ],
          );
          updated++;
        } else {
          const employee_code = code || await getNextCode('employees', 'employee_code', 'DME-', 5);
          const ins = await query(
            `INSERT INTO employees (employee_code, first_name, last_name, middle_name, address, phone, email, position, department,
              daily_rate, monthly_rate, sss, philhealth, pagibig, tin, employment_type, hire_date, credit_limit, sss_default_amount, is_active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id, employee_code, email, first_name, last_name`,
            [
              employee_code, payload.first_name, payload.last_name, payload.middle_name, payload.address, payload.phone,
              payload.email, payload.position, payload.department, payload.daily_rate, payload.monthly_rate, payload.sss,
              payload.philhealth, payload.pagibig, payload.tin, payload.employment_type, payload.hire_date,
              payload.credit_limit, payload.sss_default_amount, payload.is_active,
            ],
          );
          const row = ins.rows[0];
          byCode.set(row.employee_code.toLowerCase(), row);
          if (row.email) byEmail.set(row.email.toLowerCase(), row);
          byName.set(`${row.last_name}|${row.first_name}`.toLowerCase(), row);
          created++;
        }
      } catch (err: any) {
        errors.push({ row: rowNum, message: err.message });
      }
    }

    res.json({ imported: created, updated, errors, total: rows.length });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.get('/employees/:id/ledger', authenticate, hasUserPerm('hr.employees.view'), async (req: AuthRequest, res: Response) => {
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

router.post('/employees', authenticate, hasUserPerm('hr.employees.create'), auditLog('HR', 'Create Employee'), async (req: AuthRequest, res: Response) => {
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

router.put('/employees/:id', authenticate, hasUserPerm('hr.employees.edit'), auditLog('HR', 'Update Employee'), async (req: AuthRequest, res: Response) => {
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
router.post('/attendance', authenticate, hasUserPerm('hr.attendance.create'), auditLog('HR', 'Create Attendance'), async (req: AuthRequest, res: Response) => {
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

router.get('/attendance', authenticate, hasUserPerm('hr.attendance.view'), async (req: AuthRequest, res: Response) => {
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

router.get('/attendance/worked-days', authenticate, hasUserAnyPerm([...HR_MODULE_VIEW]), async (req: AuthRequest, res: Response) => {
  try {
    const { employee_id, from, to } = req.query;
    if (!employee_id || !from || !to) return res.status(400).json({ error: 'employee_id, from, and to are required' });

    const result = await query(
      `SELECT COALESCE(SUM(
         CASE status
           WHEN 'Half-day' THEN 0.5
           WHEN 'Present' THEN 1
           WHEN 'Late' THEN 1
           ELSE 0
         END
       ), 0) as worked
       FROM attendance
       WHERE employee_id = $1 AND date >= $2 AND date <= $3
         AND status IN ('Present', 'Late', 'Half-day')`,
      [employee_id, from, to]
    );
    res.json({ worked_days: parseFloat(result.rows[0].worked) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Attendance Sheet — pivoted grid: employees × dates
router.get('/attendance/sheet', authenticate, hasUserPerm('hr.attendance.view'), async (req: AuthRequest, res: Response) => {
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
router.post('/attendance/sheet', authenticate, hasUserPerm('hr.attendance.create'), async (req: AuthRequest, res: Response) => {
  try {
    const { entries } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries array required' });
    }
    let upserted = 0;
    for (const e of entries) {
      if (!e.employee_id || !e.date) continue;
      if (!e.status) {
        await query('DELETE FROM attendance WHERE employee_id = $1 AND date = $2', [e.employee_id, e.date]);
      } else {
        await query(
          `INSERT INTO attendance (employee_id, date, status, time_in, time_out)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (employee_id, date) DO UPDATE SET status = $3, time_in = COALESCE($4, attendance.time_in), time_out = COALESCE($5, attendance.time_out)`,
          [e.employee_id, e.date, e.status, e.time_in || null, e.time_out || null]
        );
      }
      upserted++;
    }
    res.json({ upserted });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Attendance Sheet Print
router.get('/attendance/sheet/print', authenticate, hasUserPerm('hr.attendance.print'), async (req: AuthRequest, res: Response) => {
  try {
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

    const statusLabel = (s: string) => s === 'Present' ? 'P' : s === 'Absent' ? 'A' : s === 'Late' ? 'L' : s === 'Half-day' ? 'H' : s === 'Leave' ? 'LV' : s === 'Rest Day' ? 'RD' : '';

    const tableHeaders = [
      { text: 'Employee' },
      ...dates.map((dt) => ({ text: String(new Date(dt).getDate()), align: 'center' as const, width: '22px' })),
      { text: 'P', align: 'center' as const, width: '24px' },
      { text: 'A', align: 'center' as const, width: '24px' },
      { text: 'L', align: 'center' as const, width: '24px' },
      { text: 'H', align: 'center' as const, width: '24px' },
      { text: 'LV', align: 'center' as const, width: '24px' },
      { text: 'RD', align: 'center' as const, width: '24px' },
      { text: 'W', align: 'center' as const, width: '28px' },
    ];

    let tableRows = '';
    for (const e of emps.rows) {
      const cells: { html: string; align?: 'c' | 'r' }[] = [
        { html: `<strong>${e.last_name}, ${e.first_name}</strong>` },
      ];
      let p = 0, a = 0, l = 0, h = 0, lv = 0, rd = 0;
      for (const dt of dates) {
        const rec = attMap[e.id]?.[dt];
        if (!rec) { cells.push({ html: '—', align: 'c' }); continue; }
        const s = rec.status;
        cells.push({ html: statusLabel(s), align: 'c' });
        if (s === 'Present') p++; else if (s === 'Absent') a++; else if (s === 'Late') l++;
        else if (s === 'Half-day') h++; else if (s === 'Leave') lv++; else if (s === 'Rest Day') rd++;
      }
      const worked = p + l + h * 0.5;
      cells.push(
        { html: `<strong>${p}</strong>`, align: 'c' },
        { html: String(a), align: 'c' },
        { html: String(l), align: 'c' },
        { html: String(h), align: 'c' },
        { html: String(lv), align: 'c' },
        { html: String(rd), align: 'c' },
        { html: `<strong>${worked}</strong>`, align: 'c' },
      );
      tableRows += tableRow(cells);
    }

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    res.send(buildSalesEnterpriseDocument({
      pageTitle: `Attendance Sheet ${from} to ${to}`,
      docTitle: 'Attendance Sheet',
      docMetaRows: [
        { label: 'Period From', value: fmtDate(from, 'short') },
        { label: 'Period To', value: fmtDate(to, 'short') },
        { label: 'Employees', value: String(emps.rows.length) },
      ],
      partySectionTitle: 'Report Information',
      customerRows: [{ label: 'Report Type', value: 'Daily Attendance Record' }],
      detailsRows: [{ label: 'Coverage', value: `${fmtDate(from, 'short')} — ${fmtDate(to, 'short')}` }],
      itemHeaders: tableHeaders,
      itemRows: tableRows,
      summaryRows: [{ label: 'Employees Listed', value: String(emps.rows.length), total: true }],
      skipBottom: true,
      showAmountInWords: false,
      afterSummaryHtml: renderEnterpriseNotesBlock(
        'Legend',
        'P = Present · A = Absent · L = Late · H = Half-day · LV = Leave · RD = Rest Day · W = Worked Days',
      ),
      footerNote: 'Attendance Sheet · Computer-generated document',
      biz: b,
      skipSignatures: true,
      landscape: true,
    }));
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// ==================== CASH ADVANCES ====================
router.get('/cash-advances', authenticate, hasUserPerm('hr.cash-advances.view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT ca.*, e.first_name, e.last_name, e.employee_code
       FROM cash_advances ca JOIN employees e ON ca.employee_id = e.id
       ORDER BY ca.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/cash-advances', authenticate, hasUserPerm('hr.cash-advances.create'), auditLog('HR', 'Create Cash Advance'), async (req: AuthRequest, res: Response) => {
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

router.put('/cash-advances/:id/cancel', authenticate, hasUserPerm('hr.cash-advances.edit'), async (req: AuthRequest, res: Response) => {
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
router.get('/grocery-credits', authenticate, hasUserAnyPerm(['hr.employees.view', 'hr.payroll.view']), async (req: AuthRequest, res: Response) => {
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

router.get('/grocery-credits/:id', authenticate, hasUserAnyPerm(['hr.employees.view', 'hr.payroll.view']), async (req: AuthRequest, res: Response) => {
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
router.get('/payroll', authenticate, hasUserPerm('hr.payroll.view'), async (req: AuthRequest, res: Response) => {
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
    if (!employee_id || !pay_period_start || !pay_period_end) {
      return res.status(400).json({ error: 'Employee and pay period are required' });
    }

    const existing = await findExistingPayrollForPeriod(query, Number(employee_id), pay_period_start, pay_period_end);
    if (existing) {
      return res.status(400).json({ error: `Employee already has payroll ${existing} for this period` });
    }

    let resolvedDays = parseFloat(String(days_worked));
    if (Number.isNaN(resolvedDays)) {
      resolvedDays = await getAttendanceWorkedDays(query, Number(employee_id), pay_period_start, pay_period_end);
    }

    const result = await insertPayrollRecord(
      query,
      () => getNextCode('payroll', 'payroll_number', 'PY-', 4),
      {
        employee_id: Number(employee_id),
        pay_period_start,
        pay_period_end,
        days_worked: resolvedDays,
        other_deductions,
        notes,
        created_by: req.user!.id,
      },
    );

    res.status(201).json({
      id: result.id,
      payroll_number: result.payroll_number,
      net_pay: result.net_pay,
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/payroll/batch/preview', authenticate, hasUserPerm('hr.payroll.create'), async (req: AuthRequest, res: Response) => {
  try {
    const { pay_period_start, pay_period_end, overrides } = req.body;
    if (!pay_period_start || !pay_period_end) {
      return res.status(400).json({ error: 'Pay period start and end are required' });
    }

    const rows = await previewBatchPayroll(pay_period_start, pay_period_end, overrides || []);
    const selectable = rows.filter((r) => r.selectable);
    res.json({
      pay_period_start,
      pay_period_end,
      rows,
      totals: {
        employee_count: rows.length,
        selectable_count: selectable.length,
        gross_pay: selectable.reduce((s, r) => s + r.gross_pay, 0),
        net_pay: selectable.reduce((s, r) => s + r.net_pay, 0),
      },
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/payroll/batch', authenticate, hasUserPerm('hr.payroll.create'), auditLog('HR', 'Batch Create Payroll'), async (req: AuthRequest, res: Response) => {
  try {
    const { pay_period_start, pay_period_end, entries, notes } = req.body;
    if (!pay_period_start || !pay_period_end) {
      return res.status(400).json({ error: 'Pay period start and end are required' });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'Select at least one employee to compute' });
    }

    const created: { employee_id: number; payroll_number: string; net_pay: number }[] = [];
    const skipped: { employee_id: number; reason: string }[] = [];

    for (const entry of entries) {
      const employeeId = Number(entry.employee_id);
      if (!employeeId) continue;

      const existing = await findExistingPayrollForPeriod(query, employeeId, pay_period_start, pay_period_end);
      if (existing) {
        skipped.push({ employee_id: employeeId, reason: `Already has payroll ${existing}` });
        continue;
      }

      const daysWorked = Math.max(0, parseFloat(String(entry.days_worked)) || 0);
      if (daysWorked <= 0) {
        skipped.push({ employee_id: employeeId, reason: 'Days worked must be greater than zero' });
        continue;
      }

      const result = await insertPayrollRecord(
        query,
        () => getNextCode('payroll', 'payroll_number', 'PY-', 4),
        {
          employee_id: employeeId,
          pay_period_start,
          pay_period_end,
          days_worked: daysWorked,
          notes,
          created_by: req.user!.id,
        },
      );
      created.push({ employee_id: employeeId, payroll_number: result.payroll_number, net_pay: result.net_pay });
    }

    if (created.length === 0) {
      return res.status(400).json({ error: 'No payroll records were created', skipped });
    }

    res.status(201).json({ created: created.length, skipped: skipped.length, records: created, skipped_details: skipped });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/payroll/:id/approve', authenticate, hasUserPerm('hr.payroll.approve'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const q: QueryFn = (text, params) => client.query(text, params);

    const p = await q(
      `SELECT p.*, e.employee_code FROM payroll p JOIN employees e ON p.employee_id = e.id WHERE p.id = $1::uuid FOR UPDATE`,
      [req.params.id],
    );
    if (p.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (p.rows[0].status !== 'Draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only draft payroll can be approved' });
    }

    const payroll = p.rows[0];
    const grossPay = parseFloat(payroll.gross_pay);
    const caDed = parseFloat(payroll.cash_advance_deduction || 0);
    const gcDed = parseFloat(payroll.grocery_credit_deduction || 0);
    const netPay = parseFloat(payroll.net_pay);

    if (grossPay <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Gross pay must be greater than zero' });
    }

    const existingAlloc = await countPayrollAllocations(q, req.params.id);
    if (existingAlloc > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Payroll deductions already allocated' });
    }

    const lines: { accountCode: string; description: string; debit: number; credit: number }[] = [
      { accountCode: '6000', description: `Salaries - ${payroll.payroll_number}`, debit: grossPay, credit: 0 },
      { accountCode: '2300', description: `Payroll Payable - ${payroll.payroll_number}`, debit: 0, credit: netPay },
    ];

    if (caDed > 0) {
      lines.push({ accountCode: '1110', description: `CA deduction - ${payroll.payroll_number}`, debit: 0, credit: caDed });
      await applyCashAdvanceDeductions(q, req.params.id, payroll.employee_id, caDed);
    }

    if (gcDed > 0) {
      lines.push({ accountCode: '1120', description: `GC deduction - ${payroll.payroll_number}`, debit: 0, credit: gcDed });
      await applyGroceryCreditDeductions(q, req.params.id, payroll.employee_id, gcDed);
    }

    const jeNumber = await getNextCodeTx(q, 'journal_entries', 'entry_number', 'JE-', 4);
    await createJournalEntryTx(
      q, jeNumber, new Date(), 'Payroll', req.params.id, `Payroll ${payroll.payroll_number}`, lines, req.user!.id,
    );

    await q(`UPDATE payroll SET status = 'Posted', updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid`, [req.params.id]);

    await client.query('COMMIT');
    await updateEmployeeBalances(payroll.employee_id);
    res.json({ message: 'Payroll approved' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.put('/payroll/:id/pay', authenticate, hasUserPerm('hr.payroll.approve'), async (req: AuthRequest, res: Response) => {
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

router.put('/payroll/:id/cancel', authenticate, hasUserPerm('hr.payroll.edit'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const q: QueryFn = (text, params) => client.query(text, params);

    const p = await q(`SELECT * FROM payroll WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (p.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    if (p.rows[0].status === 'Paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cannot cancel paid payroll' });
    }

    if (p.rows[0].status === 'Posted') {
      const grossPay = parseFloat(p.rows[0].gross_pay);
      const caDed = parseFloat(p.rows[0].cash_advance_deduction || 0);
      const gcDed = parseFloat(p.rows[0].grocery_credit_deduction || 0);
      const netPay = parseFloat(p.rows[0].net_pay);
      const hasDeductions = caDed > 0 || gcDed > 0;
      const allocCount = await countPayrollAllocations(q, req.params.id);

      if (hasDeductions && allocCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Cannot cancel: this payroll has CA/GC deductions but no allocation records (legacy approve). Re-post or adjust balances manually.',
        });
      }

      const jeNumber = await getNextCodeTx(q, 'journal_entries', 'entry_number', 'JE-', 4);
      const lines: { accountCode: string; description: string; debit: number; credit: number }[] = [
        { accountCode: '2300', description: 'Reverse Payroll Payable', debit: netPay, credit: 0 },
        { accountCode: '6000', description: 'Reverse Salaries', debit: 0, credit: grossPay },
      ];
      if (caDed > 0) lines.push({ accountCode: '1110', description: 'Reverse CA deduction', debit: caDed, credit: 0 });
      if (gcDed > 0) lines.push({ accountCode: '1120', description: 'Reverse GC deduction', debit: gcDed, credit: 0 });

      await createJournalEntryTx(
        q, jeNumber, new Date(), 'Payroll Cancel', req.params.id, `Cancel ${p.rows[0].payroll_number}`, lines, req.user!.id,
      );

      if (allocCount > 0) {
        await restorePayrollDeductionAllocations(q, req.params.id);
      }
    }

    await q(`UPDATE payroll SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [req.params.id]);

    await client.query('COMMIT');
    await updateEmployeeBalances(p.rows[0].employee_id);
    res.json({ message: 'Payroll cancelled' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ==================== PAYSLIP ====================
router.get('/payslip/:id', authenticate, hasUserAnyPerm(['hr.payslip.view', 'hr.payroll.view']), async (req: AuthRequest, res: Response) => {
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

    const deductionsTotal = deductionsResult.rows.reduce((s: number, d: any) => s + parseFloat(d.amount || 0), 0);

    res.json({
      ...payroll,
      deductions: deductionsResult.rows,
      deductions_total: deductionsTotal,
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
router.get('/sss-contributions', authenticate, hasUserPerm('hr.payroll.view'), async (req: AuthRequest, res: Response) => {
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
router.post('/sss-contributions/generate', authenticate, hasUserPerm('hr.payroll.create'), async (req: AuthRequest, res: Response) => {
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

router.post('/sss-contributions', authenticate, hasUserPerm('hr.payroll.create'), auditLog('HR', 'Create SSS Contribution'), async (req: AuthRequest, res: Response) => {
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

router.put('/sss-contributions/:id/approve', authenticate, hasUserPerm('hr.payroll.approve'), async (req: AuthRequest, res: Response) => {
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

router.put('/sss-contributions/:id/pay', authenticate, hasUserPerm('hr.payroll.edit'), async (req: AuthRequest, res: Response) => {
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

router.put('/sss-contributions/:id/cancel', authenticate, hasUserPerm('hr.payroll.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const sc = await query(`SELECT * FROM sss_contributions WHERE id=$1`, [req.params.id]);
    if (sc.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (sc.rows[0].status === 'Paid') return res.status(400).json({ error: 'Cannot cancel paid contribution' });

    await query(`UPDATE sss_contributions SET status='Cancelled', updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [req.params.id]);
    res.json({ message: 'SSS contribution cancelled' });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Print SSS contributions register (all records for a period)
router.get('/sss-contributions/register/print', authenticate, hasUserAnyPerm(['hr.payroll.print', 'hr.payslip.print']), async (req: AuthRequest, res: Response) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 7) + '-01';
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);

    const r = await query(
      `SELECT sc.*, e.first_name, e.last_name, e.employee_code, e.department, e.sss AS employee_sss_no
       FROM sss_contributions sc
       JOIN employees e ON sc.employee_id = e.id
       WHERE sc.period_start <= $2::date AND sc.period_end >= $1::date
         AND sc.status != 'Cancelled'
       ORDER BY e.last_name, e.first_name, sc.contribution_number`,
      [from, to],
    );

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    let totEmployer = 0;
    let totEmployee = 0;
    let totAmount = 0;

    const tableRows = r.rows.map((row: any) => {
      const employer = parseFloat(row.employer_amount) || 0;
      const employee = parseFloat(row.employee_amount) || 0;
      const total = parseFloat(row.total_amount) || employer + employee;
      totEmployer += employer;
      totEmployee += employee;
      totAmount += total;
      const period = `${fmtDate(row.period_start, 'short')} – ${fmtDate(row.period_end, 'short')}`;
      return tableRow([
        { html: row.employee_code || '—' },
        { html: `<strong>${row.last_name}, ${row.first_name}</strong><br><span style="font-size:9px;color:#666">${row.employee_sss_no || row.department || ''}</span>` },
        { html: row.contribution_number, align: 'c' },
        { html: period, align: 'c' },
        { html: fmtCurrency(employer), align: 'r' },
        { html: employee > 0 ? fmtCurrency(employee) : '—', align: 'r' },
        { html: `<strong>${fmtCurrency(total)}</strong>`, align: 'r' },
        { html: row.status, align: 'c' },
      ]);
    }).join('');

    const totalsRow = tableRow([
      { html: `<strong>TOTALS (${r.rows.length} record(s))</strong>`, align: 'r' },
      { html: '' },
      { html: '' },
      { html: '' },
      { html: `<strong>${fmtCurrency(totEmployer)}</strong>`, align: 'r' },
      { html: `<strong>${fmtCurrency(totEmployee)}</strong>`, align: 'r' },
      { html: `<strong>${fmtCurrency(totAmount)}</strong>`, align: 'r' },
      { html: '' },
    ]);

    const periodLabel = `${fmtDate(from, 'short')} — ${fmtDate(to, 'short')}`;

    res.send(buildSalesEnterpriseDocument({
      pageTitle: `SSS Register ${periodLabel}`,
      docTitle: 'SSS Contributions Register',
      docMetaRows: [
        { label: 'Period From', value: fmtDate(from, 'short') },
        { label: 'Period To', value: fmtDate(to, 'short') },
        { label: 'Records', value: String(r.rows.length) },
        { label: 'Total Amount', value: fmtCurrency(totAmount) },
      ],
      partySectionTitle: 'Register Information',
      customerRows: [{ label: 'Contribution Period Overlap', value: periodLabel }],
      detailsRows: [
        { label: 'Employer Share Total', value: fmtCurrency(totEmployer) },
        { label: 'Employee Share Total', value: fmtCurrency(totEmployee) },
      ],
      itemHeaders: [
        { text: 'Code', align: 'left', width: '52px' },
        { text: 'Employee', align: 'left' },
        { text: 'Ref #', align: 'center', width: '72px' },
        { text: 'Period', align: 'center', width: '88px' },
        { text: 'Employer', align: 'right', width: '76px' },
        { text: 'Employee', align: 'right', width: '76px' },
        { text: 'Total', align: 'right', width: '76px' },
        { text: 'Status', align: 'center', width: '56px' },
      ],
      itemRows: tableRows + totalsRow,
      summaryRows: [
        { label: 'Total Employer Share', value: fmtCurrency(totEmployer) },
        { label: 'Total Employee Share', value: fmtCurrency(totEmployee) },
        { label: 'GRAND TOTAL', value: fmtCurrency(totAmount), total: true },
      ],
      amountInWords: totAmount,
      footerNote: 'SSS contributions register · Excludes cancelled records',
      biz: b,
      signatures: buildEnterpriseSignatures(b),
      signatureCols: 3,
      landscape: true,
    }));
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// Print payroll register (all employees for a pay period)
router.get('/payroll/register/print', authenticate, hasUserAnyPerm(['hr.payroll.print', 'hr.payslip.print']), async (req: AuthRequest, res: Response) => {
  try {
    const from = (req.query.from as string) || new Date().toISOString().slice(0, 7) + '-01';
    const to = (req.query.to as string) || new Date().toISOString().slice(0, 10);
    const statusFilter = (req.query.status as string) || '';

    const params: any[] = [from, to];
    let statusClause = ` AND p.status != 'Cancelled'`;
    if (statusFilter) {
      const statuses = statusFilter.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length > 0) {
        statusClause = ` AND p.status = ANY($3)`;
        params.push(statuses);
      }
    }

    const r = await query(
      `SELECT p.*, e.first_name, e.last_name, e.employee_code, e.department, e.position
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       WHERE p.pay_period_start <= $2 AND p.pay_period_end >= $1
       ${statusClause}
       ORDER BY e.last_name, e.first_name, p.payroll_number`,
      params,
    );

    const biz = await query('SELECT * FROM business_details WHERE id = 1');
    const b = biz.rows[0] || {};

    let totGross = 0;
    let totCa = 0;
    let totGc = 0;
    let totOther = 0;
    let totNet = 0;
    let totDays = 0;

    const tableRows = r.rows.map((row: any) => {
      const gross = parseFloat(row.gross_pay) || 0;
      const ca = parseFloat(row.cash_advance_deduction) || 0;
      const gc = parseFloat(row.grocery_credit_deduction) || 0;
      const other = parseFloat(row.other_deductions) || 0;
      const net = parseFloat(row.net_pay) || 0;
      const days = parseInt(row.days_worked, 10) || 0;
      totGross += gross;
      totCa += ca;
      totGc += gc;
      totOther += other;
      totNet += net;
      totDays += days;
      const period = `${fmtDate(row.pay_period_start, 'short')} – ${fmtDate(row.pay_period_end, 'short')}`;
      return tableRow([
        { html: row.employee_code || '—' },
        { html: `<strong>${row.last_name}, ${row.first_name}</strong><br><span style="font-size:9px;color:#666">${row.department || ''}</span>` },
        { html: row.payroll_number, align: 'c' },
        { html: period, align: 'c' },
        { html: String(days), align: 'c' },
        { html: fmtCurrency(gross), align: 'r' },
        { html: ca > 0 ? fmtCurrency(ca) : '—', align: 'r' },
        { html: gc > 0 ? fmtCurrency(gc) : '—', align: 'r' },
        { html: other > 0 ? fmtCurrency(other) : '—', align: 'r' },
        { html: `<strong>${fmtCurrency(net)}</strong>`, align: 'r' },
        { html: row.status, align: 'c' },
      ]);
    }).join('');

    const totalsRow = tableRow([
      { html: `<strong>TOTALS (${r.rows.length} employee(s))</strong>`, align: 'r' },
      { html: '' },
      { html: '' },
      { html: '' },
      { html: `<strong>${totDays}</strong>`, align: 'c' },
      { html: `<strong>${fmtCurrency(totGross)}</strong>`, align: 'r' },
      { html: `<strong>${fmtCurrency(totCa)}</strong>`, align: 'r' },
      { html: `<strong>${fmtCurrency(totGc)}</strong>`, align: 'r' },
      { html: `<strong>${fmtCurrency(totOther)}</strong>`, align: 'r' },
      { html: `<strong>${fmtCurrency(totNet)}</strong>`, align: 'r' },
      { html: '' },
    ]);

    const periodLabel = `${fmtDate(from, 'short')} — ${fmtDate(to, 'short')}`;

    res.send(buildSalesEnterpriseDocument({
      pageTitle: `Payroll Register ${periodLabel}`,
      docTitle: 'Payroll Register',
      docMetaRows: [
        { label: 'Period From', value: fmtDate(from, 'short') },
        { label: 'Period To', value: fmtDate(to, 'short') },
        { label: 'Records', value: String(r.rows.length) },
        { label: 'Total Net Pay', value: fmtCurrency(totNet) },
      ],
      partySectionTitle: 'Register Information',
      customerRows: [{ label: 'Pay Period Overlap', value: periodLabel }],
      detailsRows: [{ label: 'Employees', value: String(r.rows.length) }],
      itemHeaders: [
        { text: 'Code', align: 'left', width: '52px' },
        { text: 'Employee', align: 'left' },
        { text: 'Ref #', align: 'center', width: '64px' },
        { text: 'Period', align: 'center', width: '88px' },
        { text: 'Days', align: 'center', width: '40px' },
        { text: 'Gross', align: 'right', width: '72px' },
        { text: 'CA Ded.', align: 'right', width: '64px' },
        { text: 'GC Ded.', align: 'right', width: '64px' },
        { text: 'Other', align: 'right', width: '64px' },
        { text: 'Net Pay', align: 'right', width: '76px' },
        { text: 'Status', align: 'center', width: '56px' },
      ],
      itemRows: tableRows + totalsRow,
      summaryRows: [{ label: 'TOTAL NET PAY', value: fmtCurrency(totNet), total: true }],
      amountInWords: totNet,
      footerNote: 'Payroll register · Excludes cancelled records unless filtered',
      biz: b,
      signatures: buildEnterpriseSignatures(b),
      signatureCols: 3,
      landscape: true,
    }));
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// Print payroll
router.get('/payroll/:id/print', authenticate, hasUserAnyPerm(['hr.payroll.print', 'hr.payslip.print']), async (req: AuthRequest, res: Response) => {
  try {
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

    const gross = parseFloat(d.gross_pay) || 0;
    const ssS = parseFloat(d.sss_contribution) || 0;
    const philH = parseFloat(d.philhealth_contribution) || 0;
    const pagIbig = parseFloat(d.pagibig_contribution) || 0;
    const ca = parseFloat(d.cash_advance_deduction) || 0;
    const gc = parseFloat(d.grocery_credit_deduction) || 0;
    const otherDed = parseFloat(d.other_deductions) || 0;
    const totalDed = ssS + philH + pagIbig + ca + gc + otherDed;
    const net = parseFloat(d.net_pay) || 0;

    const periodSubtitle = `${fmtDate(d.pay_period_start, 'short')} — ${fmtDate(d.pay_period_end, 'short')}`;

    const payRows = [
      tableRow([{ html: 'Gross Pay' }, { html: 'Earnings', align: 'c' }, { html: fmtCurrency(gross), align: 'r' }]),
      ...(ssS > 0 ? [tableRow([{ html: 'SSS Contribution' }, { html: 'Deduction', align: 'c' }, { html: fmtCurrency(ssS), align: 'r' }])] : []),
      ...(philH > 0 ? [tableRow([{ html: 'PhilHealth Contribution' }, { html: 'Deduction', align: 'c' }, { html: fmtCurrency(philH), align: 'r' }])] : []),
      ...(pagIbig > 0 ? [tableRow([{ html: 'Pag-IBIG Contribution' }, { html: 'Deduction', align: 'c' }, { html: fmtCurrency(pagIbig), align: 'r' }])] : []),
      ...(ca > 0 ? [tableRow([{ html: 'Cash Advance Deduction' }, { html: 'Deduction', align: 'c' }, { html: fmtCurrency(ca), align: 'r' }])] : []),
      ...(gc > 0 ? [tableRow([{ html: 'Grocery Credit Deduction' }, { html: 'Deduction', align: 'c' }, { html: fmtCurrency(gc), align: 'r' }])] : []),
      ...(otherDed > 0 ? [tableRow([{ html: 'Other Deductions' }, { html: 'Deduction', align: 'c' }, { html: fmtCurrency(otherDed), align: 'r' }])] : []),
    ].join('');

    res.send(buildSalesEnterpriseDocument({
      pageTitle: `Payslip ${d.payroll_number}`,
      docTitle: 'Payslip',
      docMetaRows: [
        { label: 'Payroll No.', value: d.payroll_number || '—' },
        { label: 'Pay Period', value: periodSubtitle },
        { label: 'Days Worked', value: String(d.days_worked || 0) },
        { label: 'Status', value: String(d.status || 'Draft').toUpperCase() },
      ],
      partySectionTitle: 'Employee Information',
      customerRows: buildEmployeeMetaRows({
        name: `${d.last_name}, ${d.first_name}`,
        code: d.employee_code,
        department: d.department,
        position: d.position,
      }),
      detailsTitle: 'Compensation',
      detailsRows: [
        { label: 'Daily Rate', value: fmtCurrency(d.daily_rate || 0) },
        { label: 'Monthly Rate', value: fmtCurrency(d.monthly_rate || 0) },
        { label: 'Gross Pay', value: fmtCurrency(gross) },
      ],
      beforeItemsHtml: renderEnterpriseSectionTitle('Earnings & Deductions'),
      itemHeaders: [
        { text: 'Description', align: 'left' },
        { text: 'Type', align: 'center', width: '72px' },
        { text: 'Amount', align: 'right', width: '80px' },
      ],
      itemRows: payRows,
      summaryRows: [
        { label: 'Gross Pay', value: fmtCurrency(gross) },
        { label: 'Total Deductions', value: fmtCurrency(totalDed) },
        { label: 'NET PAY', value: fmtCurrency(net), total: true },
      ],
      amountInWords: net,
      footerNote: 'Computer-generated payslip',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseSignatures(b),
      signatureCols: 3,
    }));
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

// Print payroll payment voucher
router.get('/payroll/:id/payment-voucher/print', authenticate, hasUserAnyPerm(['hr.payroll.print', 'hr.payslip.print']), async (req: AuthRequest, res: Response) => {
  try {
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

    const netPay = parseFloat(d.net_pay) || 0;
    const grossPay = parseFloat(d.gross_pay) || 0;
    const deductionsTotal = parseFloat(d.deductions_total) || 0;
    const payMethod = d.payment_account_type === 'bank' ? 'Bank Transfer' : 'Cash';
    const periodSubtitle = `${fmtDate(d.pay_period_start, 'short')} — ${fmtDate(d.pay_period_end, 'short')}`;

    res.send(buildSalesEnterpriseDocument({
      pageTitle: `Payment Voucher ${d.payment_voucher_number}`,
      docTitle: 'Payment Voucher',
      docMetaRows: [
        { label: 'Voucher No.', value: d.payment_voucher_number || '—' },
        { label: 'Payment Date', value: fmtDate(d.payment_date, 'short') },
        { label: 'Payroll No.', value: d.payroll_number || '—' },
        { label: 'Status', value: String(d.status || 'Paid').toUpperCase() },
      ],
      partySectionTitle: 'Employee Information',
      customerRows: buildEmployeeMetaRows({
        name: `${d.last_name}, ${d.first_name}`,
        code: d.employee_code,
        department: d.department,
        position: d.position,
      }),
      detailsTitle: 'Disbursement Details',
      detailsRows: [
        { label: 'Pay Period', value: periodSubtitle },
        { label: 'Payment Method', value: payMethod },
        ...(d.payment_ref ? [{ label: 'Reference No.', value: d.payment_ref }] : []),
      ],
      itemHeaders: [
        { text: 'Description', align: 'left' },
        { text: 'Amount', align: 'right', width: '100px' },
      ],
      itemRows: [
        tableRow([{ html: `Gross Pay (${d.days_worked || 0} days worked)` }, { html: fmtCurrency(grossPay), align: 'r' }]),
        tableRow([{ html: 'Total Deductions' }, { html: fmtCurrency(deductionsTotal), align: 'r' }]),
      ].join(''),
      summaryRows: [
        { label: 'Gross Pay', value: fmtCurrency(grossPay) },
        { label: 'Total Deductions', value: fmtCurrency(deductionsTotal) },
        { label: 'NET PAY DISBURSED', value: fmtCurrency(netPay), total: true },
      ],
      amountInWords: netPay,
      footerNote: 'Computer-generated payment voucher',
      status: d.status,
      biz: b,
      signatures: buildEnterpriseSignatures(b),
      signatureCols: 3,
    }));
  } catch (error: any) { res.status(500).send('<p>Error: ' + error.message + '</p>'); }
});

export default router;
