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

    let whereClause = 'WHERE s.is_active = true';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (s.supplier_name ILIKE $${paramIndex} OR s.supplier_code ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const total = await query(`SELECT COUNT(*) FROM suppliers s ${whereClause}`, params);
    const result = await query(
      `SELECT s.*, (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = s.id) as po_count
       FROM suppliers s ${whereClause} ORDER BY s.supplier_name LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/export/template', authenticate, async (_req: AuthRequest, res: Response) => {
  const headerRow = ['Supplier Name','Contact Person','Address','Phone','Email','Payment Terms','TIN','Default Discount Percent'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=supplier_import_template.csv');
  res.send('\uFEFF' + headerRow.map(esc).join(','));
});

router.get('/export', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const format = (req.query.format as string) || 'csv';
    const result = await query('SELECT supplier_name, contact_person, address, phone, email, payment_terms, tin, default_discount_percent, is_active FROM suppliers WHERE is_active = true ORDER BY supplier_name');
    const rows = result.rows;

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Suppliers');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=suppliers_export.xlsx');
      return res.send(buf);
    }

    const headerRow = ['Supplier Name','Contact Person','Address','Phone','Email','Payment Terms','TIN','Default Discount Percent','Active'];
    const csv = '\uFEFF' + headerRow.join(',') + '\n' + rows.map((r: any) => [
      esc(r.supplier_name), esc(r.contact_person), esc(r.address), esc(r.phone),
      esc(r.email), esc(r.payment_terms), esc(r.tin), r.default_discount_percent ?? '', r.is_active
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=suppliers_export.csv');
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
      if (h === 'supplier name' || h === 'name') hm['Supplier Name'] = i;
      else if (h === 'contact person') hm['Contact Person'] = i;
      else if (h === 'address') hm['Address'] = i;
      else if (h === 'phone') hm['Phone'] = i;
      else if (h === 'email') hm['Email'] = i;
      else if (h === 'payment terms' || h === 'terms') hm['Payment Terms'] = i;
      else if (h === 'tin') hm['TIN'] = i;
      else if (h === 'default discount percent' || h === 'discount') hm['Default Discount Percent'] = i;
      else if (h === 'active' || h === 'is_active') hm['Active'] = i;
    }

    if (!('Supplier Name' in hm)) throw new AppError('Missing required column: Supplier Name');

    const existing = await query('SELECT id, supplier_name FROM suppliers');
    const byName = new Map(existing.rows.map((r: any) => [r.supplier_name.toLowerCase(), r]));

    const previewRows: any[] = [];
    const errors: { row: number; message: string }[] = [];
    let validRows = 0;

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const rowNum = ri + 2;
      const entry: any = { row: rowNum, has_errors: false, errors: [] };
      entry.supplier_name = hm['Supplier Name'] !== undefined ? row[hm['Supplier Name']] || '' : '';
      entry.contact_person = hm['Contact Person'] !== undefined ? row[hm['Contact Person']] || '' : '';
      entry.address = hm['Address'] !== undefined ? row[hm['Address']] || '' : '';
      entry.phone = hm['Phone'] !== undefined ? row[hm['Phone']] || '' : '';
      entry.email = hm['Email'] !== undefined ? row[hm['Email']] || '' : '';
      entry.payment_terms = hm['Payment Terms'] !== undefined ? row[hm['Payment Terms']] || '' : '';
      entry.tin = hm['TIN'] !== undefined ? row[hm['TIN']] || '' : '';
      entry.default_discount_percent = hm['Default Discount Percent'] !== undefined ? row[hm['Default Discount Percent']] || '0' : '0';
      entry.is_active = hm['Active'] !== undefined ? row[hm['Active']] || '' : '';

      if (!entry.supplier_name) { entry.has_errors = true; entry.errors.push('Supplier name is required'); }

      const match = byName.get(entry.supplier_name.toLowerCase());
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
      if (h === 'supplier name' || h === 'name') hm['Supplier Name'] = i;
      else if (h === 'contact person') hm['Contact Person'] = i;
      else if (h === 'address') hm['Address'] = i;
      else if (h === 'phone') hm['Phone'] = i;
      else if (h === 'email') hm['Email'] = i;
      else if (h === 'payment terms' || h === 'terms') hm['Payment Terms'] = i;
      else if (h === 'tin') hm['TIN'] = i;
      else if (h === 'default discount percent' || h === 'discount') hm['Default Discount Percent'] = i;
      else if (h === 'active' || h === 'is_active') hm['Active'] = i;
    }

    if (!('Supplier Name' in hm)) throw new AppError('Missing required column: Supplier Name');

    const existing = await query('SELECT id, supplier_name, supplier_code FROM suppliers');
    const byName = new Map(existing.rows.map((r: any) => [r.supplier_name.toLowerCase(), r]));

    let created = 0, updated = 0;
    const errors: { row: number; message: string }[] = [];

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const rowNum = ri + 2;
      try {
        const supplier_name = (hm['Supplier Name'] !== undefined ? row[hm['Supplier Name']] : '').trim();
        if (!supplier_name) { errors.push({ row: rowNum, message: 'Supplier name is required' }); continue; }

        const contact_person = (hm['Contact Person'] !== undefined ? row[hm['Contact Person']] : '').trim() || null;
        const address = (hm['Address'] !== undefined ? row[hm['Address']] : '').trim() || null;
        const phone = (hm['Phone'] !== undefined ? row[hm['Phone']] : '').trim() || null;
        const email = (hm['Email'] !== undefined ? row[hm['Email']] : '').trim() || null;
        const payment_terms = (hm['Payment Terms'] !== undefined ? row[hm['Payment Terms']] : '').trim() || null;
        const tin = (hm['TIN'] !== undefined ? row[hm['TIN']] : '').trim() || null;
        const discountVal = (hm['Default Discount Percent'] !== undefined ? row[hm['Default Discount Percent']] : '0').trim();
        const default_discount_percent = parseFloat(discountVal) || 0;
        const activeVal = (hm['Active'] !== undefined ? row[hm['Active']] : '').toLowerCase();
        const is_active = activeVal ? activeVal === 'yes' || activeVal === 'true' || activeVal === '1' || activeVal === 't' : undefined;

        const match = byName.get(supplier_name.toLowerCase());

        if (match) {
          const setClauses = [
            'supplier_name = $1', 'contact_person = $2', 'address = $3', 'phone = $4',
            'email = $5', 'payment_terms = $6', 'tin = $7', 'default_discount_percent = $8',
            'updated_at = CURRENT_TIMESTAMP'
          ];
          const params: any[] = [supplier_name, contact_person, address, phone, email, payment_terms, tin, default_discount_percent];
          if (is_active !== undefined) {
            setClauses.push('is_active = $' + (params.length + 1));
            params.push(is_active);
          }
          params.push(match.id);
          await query(`UPDATE suppliers SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params);
          updated++;
        } else {
          const codeResult = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(supplier_code FROM 5) AS INTEGER)), 0) + 1 as next FROM suppliers WHERE supplier_code ~ '^DMS-'");
          const code = `DMS-${String(codeResult.rows[0].next).padStart(5, '0')}`;
          await query(
            `INSERT INTO suppliers (supplier_code, supplier_name, contact_person, address, phone, email, payment_terms, tin, default_discount_percent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [code, supplier_name, contact_person, address, phone, email, payment_terms, tin, default_discount_percent]
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
    const result = await query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/ledger', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.id);
    const supplier = await query('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    // Purchase Orders
    const pos = await query(
      `SELECT po.po_number as ref_no, po.order_date as date, 'Purchase Order' as type,
              po.total as debit, 0 as credit, po.status
       FROM purchase_orders po WHERE po.supplier_id = $1 AND po.status NOT IN ('Cancelled')
       ORDER BY po.order_date`,
      [supplierId]
    );

    // Goods Receipts
    const receipts = await query(
      `SELECT gr.gr_number as ref_no, gr.received_date as date, 'Goods Receipt' as type,
              (SELECT COALESCE(SUM(gri.quantity * gri.net_unit_cost), 0) FROM goods_receipt_items gri WHERE gri.gr_id = gr.id) as debit,
              0 as credit, gr.status
       FROM goods_receipts gr WHERE gr.supplier_id = $1 AND gr.status != 'Cancelled'
       ORDER BY gr.received_date`,
      [supplierId]
    );

    // Payment Vouchers
    const payments = await query(
      `SELECT pv.voucher_number as ref_no, pv.payment_date as date, 'Payment' as type,
              0 as debit, pv.amount as credit, pv.status
       FROM payment_vouchers pv WHERE pv.supplier_id = $1 AND pv.status != 'Void'
       ORDER BY pv.payment_date`,
      [supplierId]
    );

    // Purchase Returns
    const returns = await query(
      `SELECT pr.pr_number as ref_no, pr.return_date as date, 'Purchase Return' as type,
              0 as debit, 0 as credit, pr.status
       FROM purchase_returns pr WHERE pr.supplier_id = $1 AND pr.status != 'Cancelled'
       ORDER BY pr.return_date`,
      [supplierId]
    );

    // Combine and sort
    const allRows = [...pos.rows, ...receipts.rows, ...payments.rows, ...returns.rows]
      .map(r => ({
        ...r,
        debit: parseFloat(r.debit) || 0,
        credit: parseFloat(r.credit) || 0,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    const ledger = allRows.map(r => {
      running = running + r.debit - r.credit;
      return { ...r, running_balance: running };
    });

    res.json({
      supplier: supplier.rows[0],
      ledger,
      running_balance: running,
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/', authenticate, auditLog('Suppliers', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const { supplier_name, contact_person, address, phone, email, payment_terms, tin } = req.body;
    if (!supplier_name) return res.status(400).json({ error: 'Supplier name is required' });

    const codeResult = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(supplier_code FROM 5) AS INTEGER)), 0) + 1 as next FROM suppliers WHERE supplier_code ~ '^DMS-'");
    const code = `DMS-${String(codeResult.rows[0].next).padStart(5, '0')}`;

    const result = await query(
      `INSERT INTO suppliers (supplier_code, supplier_name, contact_person, address, phone, email, payment_terms, tin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [code, supplier_name, contact_person, address, phone, email, payment_terms, tin]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, auditLog('Suppliers', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const { supplier_name, contact_person, address, phone, email, payment_terms, tin, is_active } = req.body;
    const result = await query(
      `UPDATE suppliers SET supplier_name = COALESCE($1, supplier_name), contact_person = COALESCE($2, contact_person),
        address = COALESCE($3, address), phone = COALESCE($4, phone), email = COALESCE($5, email),
        payment_terms = COALESCE($6, payment_terms), tin = COALESCE($7, tin),
        is_active = COALESCE($8, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = $9 RETURNING *`,
      [supplier_name, contact_person, address, phone, email, payment_terms, tin, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, auditLog('Suppliers', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const balanceCheck = await query(
      `SELECT s.balance,
              (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = $1 AND po.status IN ('Sent', 'Partial', 'Received')) as open_pos
       FROM suppliers s WHERE s.id = $1`,
      [id]
    );
    if (balanceCheck.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const { balance, open_pos } = balanceCheck.rows[0];
    if (parseFloat(balance) > 0 || parseInt(open_pos) > 0) {
      throw new AppError('Cannot delete supplier: supplier has outstanding balance or open purchase orders', 409);
    }

    const result = await query(
      'UPDATE suppliers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ message: 'Supplier deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
