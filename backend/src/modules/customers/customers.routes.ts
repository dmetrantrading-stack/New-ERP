import { Router, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditLog } from '../../middleware/audit';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { const ok = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv') || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.originalname.endsWith('.xlsx'); cb(null, ok); } });

const esc = (v: any) => {
  const s = v == null ? '' : String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const parseFile = (buffer: Buffer, originalName: string): { headers: string[]; rows: string[][] } => {
  if (originalName.endsWith('.xlsx')) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (aoa.length < 2) throw new AppError('File must have a header row and at least one data row');
    const headers = aoa[0].map((h: any) => String(h).trim());
    const rows = aoa.slice(1).filter((r: any[]) => r.some(c => String(c).trim()));
    return { headers, rows: rows.map(r => r.map((c: any) => String(c).trim())) };
  }
  const content = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new AppError('File must have a header row and at least one data row');
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { result.push(current.trim()); current = ''; }
        else { current += ch; }
      }
    }
    result.push(current.trim());
    return result;
  };
  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
};

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || '';
    const type = req.query.type as string;

    let whereClause = 'WHERE c.is_active = true';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (c.customer_name ILIKE $${paramIndex} OR c.customer_code ILIKE $${paramIndex} OR c.phone ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (type) {
      whereClause += ` AND c.customer_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    const total = await query(`SELECT COUNT(*) FROM customers c ${whereClause}`, params);
    const result = await query(
      `SELECT * FROM customers c ${whereClause} ORDER BY c.customer_name LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/export/template', authenticate, async (_req: AuthRequest, res: Response) => {
  const headerRow = ['Customer Name','Contact Person','Address','Phone','Email','Customer Type','Credit Limit','Payment Terms','Tax Type','TIN'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=customer_import_template.csv');
  res.send('\uFEFF' + headerRow.map(esc).join(','));
});

router.get('/export', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const format = (req.query.format as string) || 'csv';
    const result = await query('SELECT customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin, is_active FROM customers WHERE is_active = true ORDER BY customer_name');
    const rows = result.rows;

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Customers');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=customers_export.xlsx');
      return res.send(buf);
    }

    const headerRow = ['Customer Name','Contact Person','Address','Phone','Email','Customer Type','Credit Limit','Payment Terms','Tax Type','TIN','Active'];
    const csv = '\uFEFF' + headerRow.join(',') + '\n' + rows.map((r: any) => [
      esc(r.customer_name), esc(r.contact_person), esc(r.address), esc(r.phone),
      esc(r.email), esc(r.customer_type), r.credit_limit, esc(r.payment_terms),
      esc(r.tax_type), esc(r.tin), r.is_active
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=customers_export.csv');
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/import/preview', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) throw new AppError('No file uploaded');
    const { headers, rows } = parseFile(req.file.buffer, req.file.originalname);

    const hm: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (h === 'customer name' || h === 'name') hm['Customer Name'] = i;
      else if (h === 'contact person') hm['Contact Person'] = i;
      else if (h === 'address') hm['Address'] = i;
      else if (h === 'phone') hm['Phone'] = i;
      else if (h === 'email') hm['Email'] = i;
      else if (h === 'customer type' || h === 'type') hm['Customer Type'] = i;
      else if (h === 'credit limit') hm['Credit Limit'] = i;
      else if (h === 'payment terms' || h === 'terms') hm['Payment Terms'] = i;
      else if (h === 'tax type') hm['Tax Type'] = i;
      else if (h === 'tin') hm['TIN'] = i;
      else if (h === 'active' || h === 'is_active') hm['Active'] = i;
    }

    if (!('Customer Name' in hm)) throw new AppError('Missing required column: Customer Name');

    const existing = await query('SELECT id, customer_name FROM customers');
    const byName = new Map(existing.rows.map((r: any) => [r.customer_name.toLowerCase(), r]));

    const previewRows: any[] = [];
    const errors: { row: number; message: string }[] = [];
    let validRows = 0;

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const rowNum = ri + 2;
      const entry: any = { row: rowNum, has_errors: false, errors: [] };
      entry.customer_name = hm['Customer Name'] !== undefined ? row[hm['Customer Name']] || '' : '';
      entry.contact_person = hm['Contact Person'] !== undefined ? row[hm['Contact Person']] || '' : '';
      entry.address = hm['Address'] !== undefined ? row[hm['Address']] || '' : '';
      entry.phone = hm['Phone'] !== undefined ? row[hm['Phone']] || '' : '';
      entry.email = hm['Email'] !== undefined ? row[hm['Email']] || '' : '';
      entry.customer_type = hm['Customer Type'] !== undefined ? row[hm['Customer Type']] || '' : '';
      entry.credit_limit = hm['Credit Limit'] !== undefined ? row[hm['Credit Limit']] || '0' : '0';
      entry.payment_terms = hm['Payment Terms'] !== undefined ? row[hm['Payment Terms']] || '' : '';
      entry.tax_type = hm['Tax Type'] !== undefined ? row[hm['Tax Type']] || '' : '';
      entry.tin = hm['TIN'] !== undefined ? row[hm['TIN']] || '' : '';
      entry.is_active = hm['Active'] !== undefined ? row[hm['Active']] || '' : '';

      if (!entry.customer_name) { entry.has_errors = true; entry.errors.push('Customer name is required'); }

      const match = byName.get(entry.customer_name.toLowerCase());
      entry.action = match ? 'Update' : 'Create';
      if (match) entry.existing_id = match.id;

      if (!entry.has_errors) validRows++;
      if (entry.has_errors) errors.push({ row: rowNum, message: entry.errors.join('; ') });
      previewRows.push(entry);
    }

    res.json({
      file_name: req.file.originalname,
      total_rows: rows.length,
      valid_rows: validRows,
      error_rows: errors.length,
      rows: previewRows,
      errors
    });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.post('/import/execute', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) throw new AppError('No file uploaded');
    const { headers, rows } = parseFile(req.file.buffer, req.file.originalname);

    const hm: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (h === 'customer name' || h === 'name') hm['Customer Name'] = i;
      else if (h === 'contact person') hm['Contact Person'] = i;
      else if (h === 'address') hm['Address'] = i;
      else if (h === 'phone') hm['Phone'] = i;
      else if (h === 'email') hm['Email'] = i;
      else if (h === 'customer type' || h === 'type') hm['Customer Type'] = i;
      else if (h === 'credit limit') hm['Credit Limit'] = i;
      else if (h === 'payment terms' || h === 'terms') hm['Payment Terms'] = i;
      else if (h === 'tax type') hm['Tax Type'] = i;
      else if (h === 'tin') hm['TIN'] = i;
      else if (h === 'active' || h === 'is_active') hm['Active'] = i;
    }

    if (!('Customer Name' in hm)) throw new AppError('Missing required column: Customer Name');

    const existing = await query('SELECT id, customer_name, customer_code FROM customers');
    const byName = new Map(existing.rows.map((r: any) => [r.customer_name.toLowerCase(), r]));

    let created = 0, updated = 0;
    const errors: { row: number; message: string }[] = [];

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const rowNum = ri + 2;
      try {
        const customer_name = (hm['Customer Name'] !== undefined ? row[hm['Customer Name']] : '').trim();
        if (!customer_name) { errors.push({ row: rowNum, message: 'Customer name is required' }); continue; }

        const contact_person = (hm['Contact Person'] !== undefined ? row[hm['Contact Person']] : '').trim() || null;
        const address = (hm['Address'] !== undefined ? row[hm['Address']] : '').trim() || null;
        const phone = (hm['Phone'] !== undefined ? row[hm['Phone']] : '').trim() || null;
        const email = (hm['Email'] !== undefined ? row[hm['Email']] : '').trim() || null;
        const customer_type = (hm['Customer Type'] !== undefined ? row[hm['Customer Type']] : '').trim() || 'Retail';
        const credit_limit = parseFloat(hm['Credit Limit'] !== undefined ? row[hm['Credit Limit']] : '0') || 0;
        const payment_terms = (hm['Payment Terms'] !== undefined ? row[hm['Payment Terms']] : '').trim() || null;
        const tax_type = (hm['Tax Type'] !== undefined ? row[hm['Tax Type']] : 'VAT').trim() || 'VAT';
        const tin = (hm['TIN'] !== undefined ? row[hm['TIN']] : '').trim() || null;
        const activeVal = (hm['Active'] !== undefined ? row[hm['Active']] : '').toLowerCase();
        const is_active = activeVal ? activeVal === 'yes' || activeVal === 'true' || activeVal === '1' || activeVal === 't' : undefined;

        const match = byName.get(customer_name.toLowerCase());

        if (match) {
          const setClauses = [
            'customer_name = $1', 'contact_person = $2', 'address = $3', 'phone = $4',
            'email = $5', 'customer_type = $6', 'credit_limit = $7', 'payment_terms = $8',
            'tax_type = $9', 'tin = $10', 'updated_at = CURRENT_TIMESTAMP'
          ];
          const params: any[] = [customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin];
          if (is_active !== undefined) {
            setClauses.push('is_active = $' + (params.length + 1));
            params.push(is_active);
          }
          params.push(match.id);
          await query(`UPDATE customers SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params);
          updated++;
        } else {
          const codeResult = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 5) AS INTEGER)), 0) + 1 as next FROM customers WHERE customer_code ~ '^DMC-'");
          const code = `DMC-${String(codeResult.rows[0].next).padStart(5, '0')}`;
          await query(
            `INSERT INTO customers (customer_code, customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [code, customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin]
          );
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

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, auditLog('Customers', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin } = req.body;
    if (!customer_name) return res.status(400).json({ error: 'Customer name is required' });

    const codeResult = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 5) AS INTEGER)), 0) + 1 as next FROM customers WHERE customer_code ~ '^DMC-'");
    const code = `DMC-${String(codeResult.rows[0].next).padStart(5, '0')}`;

    const result = await query(
      `INSERT INTO customers (customer_code, customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [code, customer_name, contact_person, address, phone, email, customer_type || 'Retail', credit_limit || 0, payment_terms, tax_type || 'VAT', tin]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, auditLog('Customers', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin, is_active } = req.body;
    const result = await query(
      `UPDATE customers SET customer_name = COALESCE($1, customer_name), contact_person = COALESCE($2, contact_person),
        address = COALESCE($3, address), phone = COALESCE($4, phone), email = COALESCE($5, email),
        customer_type = COALESCE($6, customer_type), credit_limit = COALESCE($7, credit_limit),
        payment_terms = COALESCE($8, payment_terms), tax_type = COALESCE($9, tax_type),
        tin = COALESCE($10, tin), is_active = COALESCE($11, is_active), updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 RETURNING *`,
      [customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Customer aging
router.get('/aging/report', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT c.*,
        COALESCE((SELECT SUM(si.balance) FROM sales_invoices si WHERE si.customer_id = c.id AND si.status IN ('Posted', 'Partial', 'Overdue') AND si.due_date < CURRENT_DATE), 0) as overdue,
        COALESCE((SELECT SUM(si.balance) FROM sales_invoices si WHERE si.customer_id = c.id AND si.status IN ('Posted', 'Partial') AND si.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30), 0) as current_30,
        COALESCE((SELECT SUM(si.balance) FROM sales_invoices si WHERE si.customer_id = c.id AND si.status IN ('Posted', 'Partial') AND si.due_date BETWEEN CURRENT_DATE + 31 AND CURRENT_DATE + 60), 0) as current_60,
        COALESCE((SELECT SUM(si.balance) FROM sales_invoices si WHERE si.customer_id = c.id AND si.status IN ('Posted', 'Partial') AND si.due_date > CURRENT_DATE + 60), 0) as current_90_plus
      FROM customers c
      WHERE c.balance > 0
      ORDER BY c.balance DESC
    `);
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, auditLog('Customers', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const balanceCheck = await query(
      `SELECT balance, (SELECT COUNT(*) FROM sales_invoices WHERE customer_id = $1 AND balance > 0 AND status != 'Cancelled') as open_invoices FROM customers WHERE id = $1`,
      [id]
    );
    if (balanceCheck.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const { balance, open_invoices } = balanceCheck.rows[0];
    if (parseFloat(balance) > 0 || parseInt(open_invoices) > 0) {
      throw new AppError('Cannot delete customer: customer has outstanding balance or open invoices', 409);
    }

    const result = await query(
      'UPDATE customers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ message: 'Customer deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
