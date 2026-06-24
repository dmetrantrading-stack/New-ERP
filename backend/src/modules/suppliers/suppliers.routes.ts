import { Router, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../config/database';
import { authenticate, hasUserPerm, hasUserAnyPerm, AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditLog } from '../../middleware/audit';
import { auditAfter, auditBefore, auditSnapshot, AUDIT_FIELDS } from '../../utils/auditHelpers';
import { fetchSupplierCatalogItems, addProductsToSupplierCatalog, resolveProductIdBySkuOrName } from '../../utils/supplierCatalog';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { const ok = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv') || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.originalname.endsWith('.xlsx'); cb(null, ok); } });

const supplierView = hasUserPerm('purchases.suppliers.view');
const supplierLookup = hasUserAnyPerm([
  'purchases.suppliers.view',
  'purchases.purchase-order.view',
  'purchases.apv.view',
  'purchases.receiving-report.view',
]);

const esc = (v: any) => {
  const s = v == null ? '' : String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const importCell = (row: string[], hm: Record<string, number>, col: string, fallback = '') =>
  String(hm[col] !== undefined ? row[hm[col]] ?? fallback : fallback).trim();

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

router.get('/', authenticate, supplierLookup, async (req: AuthRequest, res: Response) => {
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

router.get('/export/template', authenticate, supplierView, async (_req: AuthRequest, res: Response) => {
  const headerRow = ['Supplier Name','Contact Person','Address','Phone','Email','Payment Terms','TIN','Default Discount Percent'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=supplier_import_template.csv');
  res.send('\uFEFF' + headerRow.map(esc).join(','));
});

router.get('/export', authenticate, supplierView, async (req: AuthRequest, res: Response) => {
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

router.post('/import/preview', authenticate, hasUserPerm('purchases.suppliers.edit'), upload.single('file'), async (req: AuthRequest, res: Response) => {
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

router.post('/import/execute', authenticate, hasUserPerm('purchases.suppliers.edit'), upload.single('file'), async (req: AuthRequest, res: Response) => {
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
        const supplier_name = importCell(row, hm, 'Supplier Name');
        if (!supplier_name) { errors.push({ row: rowNum, message: 'Supplier name is required' }); continue; }

        const contact_person = importCell(row, hm, 'Contact Person') || null;
        const address = importCell(row, hm, 'Address') || null;
        const phone = importCell(row, hm, 'Phone') || null;
        const email = importCell(row, hm, 'Email') || null;
        const payment_terms = importCell(row, hm, 'Payment Terms') || null;
        const tin = importCell(row, hm, 'TIN') || null;
        const discountVal = importCell(row, hm, 'Default Discount Percent', '0');
        const default_discount_percent = parseFloat(discountVal) || 0;
        const activeVal = importCell(row, hm, 'Active').toLowerCase();
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

router.get('/:id/ledger', authenticate, supplierView, async (req: AuthRequest, res: Response) => {
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

router.get('/:id', authenticate, supplierView, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/catalog', authenticate, supplierView, async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.id, 10);
    if (Number.isNaN(supplierId)) return res.status(400).json({ error: 'Invalid supplier id' });

    const supplier = await query('SELECT id, supplier_code, supplier_name, payment_terms FROM suppliers WHERE id = $1 AND is_active = true', [supplierId]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const lowStockOnly = req.query.low_stock === 'true';
    const { items, summary } = await fetchSupplierCatalogItems(supplierId, lowStockOnly);

    res.json({
      supplier: supplier.rows[0],
      summary,
      items,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/catalog', authenticate, hasUserPerm('purchases.suppliers.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.id, 10);
    if (Number.isNaN(supplierId)) return res.status(400).json({ error: 'Invalid supplier id' });

    const supplier = await query('SELECT id FROM suppliers WHERE id = $1 AND is_active = true', [supplierId]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const { product_id, order_qty_multiplier, fixed_order_qty, sort_order } = req.body;
    if (!product_id) return res.status(400).json({ error: 'Product is required' });

    const product = await query('SELECT id FROM products WHERE id = $1 AND is_active = true', [product_id]);
    if (product.rows.length === 0) return res.status(404).json({ error: 'Product not found' });

    const id = uuidv4();
    await query(
      `INSERT INTO supplier_catalog_items (id, supplier_id, product_id, order_qty_multiplier, fixed_order_qty, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        supplierId,
        product_id,
        order_qty_multiplier != null ? parseFloat(String(order_qty_multiplier)) : 2,
        fixed_order_qty != null && String(fixed_order_qty).trim() !== '' ? parseFloat(String(fixed_order_qty)) : null,
        sort_order != null ? parseInt(String(sort_order), 10) : 0,
      ],
    );

    const { items } = await fetchSupplierCatalogItems(supplierId);
    const created = items.find((i) => i.catalog_item_id === id);
    res.status(201).json(created || { catalog_item_id: id, product_id });
  } catch (error: any) {
    if (error.code === '23505') return res.status(409).json({ error: 'Product is already in this supplier catalog' });
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/catalog/bulk', authenticate, hasUserPerm('purchases.suppliers.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.id, 10);
    if (Number.isNaN(supplierId)) return res.status(400).json({ error: 'Invalid supplier id' });

    const supplier = await query('SELECT id FROM suppliers WHERE id = $1 AND is_active = true', [supplierId]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const productIds: string[] = Array.isArray(req.body.product_ids) ? req.body.product_ids : [];
    if (productIds.length === 0) return res.status(400).json({ error: 'Select at least one product' });

    const orderQtyMultiplier = req.body.order_qty_multiplier;
    const fixedOrderQty = req.body.fixed_order_qty;
    const inputs = productIds.map((product_id: string) => ({
      product_id,
      order_qty_multiplier: orderQtyMultiplier,
      fixed_order_qty: fixedOrderQty,
    }));

    const result = await addProductsToSupplierCatalog(supplierId, inputs);
    if (result.added === 0 && result.reactivated === 0 && result.errors.length > 0) {
      return res.status(400).json({ error: result.errors[0]?.message || 'No products added', ...result });
    }

    res.status(201).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/catalog/import/template', authenticate, supplierView, async (_req: AuthRequest, res: Response) => {
  const headerRow = ['SKU', 'Product Name', 'Order Qty Multiplier', 'Fixed Order Qty'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=supplier_catalog_import_template.csv');
  res.send('\uFEFF' + headerRow.map(esc).join(','));
});

const mapCatalogImportHeaders = (headers: string[]): Record<string, number> => {
  const hm: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (h === 'sku') hm.SKU = i;
    else if (h === 'product name' || h === 'name' || h === 'product') hm['Product Name'] = i;
    else if (h === 'order qty multiplier' || h === 'multiplier') hm['Order Qty Multiplier'] = i;
    else if (h === 'fixed order qty' || h === 'fixed qty' || h === 'order qty') hm['Fixed Order Qty'] = i;
  }
  return hm;
};

const buildCatalogImportPreview = async (supplierId: number, headers: string[], rows: string[][]) => {
  const hm = mapCatalogImportHeaders(headers);
  if (!('SKU' in hm) && !('Product Name' in hm)) {
    throw new AppError('File must include SKU and/or Product Name column');
  }

  const products = await query('SELECT id, sku, name FROM products WHERE is_active = true');
  const bySku = new Map(products.rows.map((r: any) => [String(r.sku).trim(), r]));
  const bySkuLower = new Map(products.rows.map((r: any) => [String(r.sku).trim().toLowerCase(), r]));
  const byName = new Map(products.rows.map((r: any) => [String(r.name).trim().toLowerCase(), r]));

  const catalogExisting = await query(
    'SELECT product_id FROM supplier_catalog_items WHERE supplier_id = $1 AND is_active = true',
    [supplierId],
  );
  const inCatalog = new Set(catalogExisting.rows.map((r: any) => r.product_id));

  const previewRows: any[] = [];
  const errors: { row: number; message: string }[] = [];
  let validRows = 0;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const rowNum = ri + 2;
    const entry: any = { row: rowNum, has_errors: false, errors: [] };

    entry.sku = hm.SKU !== undefined ? row[hm.SKU] || '' : '';
    entry.name = hm['Product Name'] !== undefined ? row[hm['Product Name']] || '' : '';
    entry.order_qty_multiplier = hm['Order Qty Multiplier'] !== undefined ? row[hm['Order Qty Multiplier']] || '2' : '2';
    entry.fixed_order_qty = hm['Fixed Order Qty'] !== undefined ? row[hm['Fixed Order Qty']] || '' : '';

    if (!entry.sku.trim() && !entry.name.trim()) {
      entry.has_errors = true;
      entry.errors.push('SKU or Product Name is required');
    }

    const multiplier = parseFloat(entry.order_qty_multiplier);
    if (entry.order_qty_multiplier !== '' && Number.isNaN(multiplier)) {
      entry.has_errors = true;
      entry.errors.push('Order Qty Multiplier must be a number');
    } else {
      entry.order_qty_multiplier = Number.isNaN(multiplier) ? 2 : multiplier;
    }

    if (entry.fixed_order_qty !== '' && Number.isNaN(parseFloat(entry.fixed_order_qty))) {
      entry.has_errors = true;
      entry.errors.push('Fixed Order Qty must be a number');
    }

    if (!entry.has_errors) {
      const match = await resolveProductIdBySkuOrName(entry.sku, entry.name, bySku, byName, bySkuLower);
      if (!match) {
        entry.has_errors = true;
        entry.errors.push('Product not found in master catalog');
      } else {
        entry.product_id = match.id;
        entry.resolved_name = match.name;
        entry.resolved_sku = match.sku;
        entry.action = inCatalog.has(match.id) ? 'Skip (already in catalog)' : 'Add';
        if (inCatalog.has(match.id)) {
          entry.has_errors = true;
          entry.errors.push('Already in supplier catalog');
        }
      }
    }

    if (!entry.has_errors) validRows++;
    if (entry.has_errors) errors.push({ row: rowNum, message: entry.errors.join('; ') });
    previewRows.push(entry);
  }

  return {
    total_rows: rows.length,
    valid_rows: validRows,
    error_rows: errors.length,
    rows: previewRows,
    errors,
  };
};

router.post('/:id/catalog/import/preview', authenticate, hasUserPerm('purchases.suppliers.edit'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) throw new AppError('No file uploaded');
    const supplierId = parseInt(req.params.id, 10);
    if (Number.isNaN(supplierId)) return res.status(400).json({ error: 'Invalid supplier id' });

    const supplier = await query('SELECT id FROM suppliers WHERE id = $1 AND is_active = true', [supplierId]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const { headers, rows } = parseFile(req.file.buffer, req.file.originalname);
    const preview = await buildCatalogImportPreview(supplierId, headers, rows);

    res.json({
      file_name: req.file.originalname,
      ...preview,
    });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.post('/:id/catalog/import/execute', authenticate, hasUserPerm('purchases.suppliers.edit'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) throw new AppError('No file uploaded');
    const supplierId = parseInt(req.params.id, 10);
    if (Number.isNaN(supplierId)) return res.status(400).json({ error: 'Invalid supplier id' });

    const supplier = await query('SELECT id FROM suppliers WHERE id = $1 AND is_active = true', [supplierId]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const { headers, rows } = parseFile(req.file.buffer, req.file.originalname);
    const preview = await buildCatalogImportPreview(supplierId, headers, rows);
    const validRows = preview.rows.filter((r: any) => !r.has_errors);

    if (validRows.length === 0) {
      return res.status(400).json({ error: 'No valid rows to import', errors: preview.errors });
    }

    const inputs = validRows.map((r: any) => ({
      product_id: r.product_id,
      order_qty_multiplier: r.order_qty_multiplier,
      fixed_order_qty: r.fixed_order_qty !== '' ? parseFloat(r.fixed_order_qty) : null,
    }));

    const result = await addProductsToSupplierCatalog(supplierId, inputs);
    res.json({ ...result, total: rows.length, imported_rows: validRows.length });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

router.put('/:id/catalog/:itemId', authenticate, hasUserPerm('purchases.suppliers.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.id, 10);
    const { itemId } = req.params;
    const { order_qty_multiplier, fixed_order_qty, sort_order } = req.body;

    const existing = await query(
      'SELECT * FROM supplier_catalog_items WHERE id = $1 AND supplier_id = $2 AND is_active = true',
      [itemId, supplierId],
    );
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Catalog item not found' });

    await query(
      `UPDATE supplier_catalog_items SET
        order_qty_multiplier = COALESCE($1, order_qty_multiplier),
        fixed_order_qty = $2,
        sort_order = COALESCE($3, sort_order),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND supplier_id = $5`,
      [
        order_qty_multiplier != null ? parseFloat(String(order_qty_multiplier)) : null,
        fixed_order_qty != null && String(fixed_order_qty).trim() !== '' ? parseFloat(String(fixed_order_qty)) : null,
        sort_order != null ? parseInt(String(sort_order), 10) : null,
        itemId,
        supplierId,
      ],
    );

    const { items } = await fetchSupplierCatalogItems(supplierId);
    const updated = items.find((i) => i.catalog_item_id === itemId);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id/catalog/:itemId', authenticate, hasUserPerm('purchases.suppliers.edit'), async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.id, 10);
    const { itemId } = req.params;

    const result = await query(
      `UPDATE supplier_catalog_items SET is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND supplier_id = $2 AND is_active = true RETURNING id`,
      [itemId, supplierId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Catalog item not found' });
    res.json({ message: 'Removed from catalog' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/catalog/copy-to-po', authenticate, hasUserPerm('purchases.purchase-order.create'), async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.id, 10);
    if (Number.isNaN(supplierId)) return res.status(400).json({ error: 'Invalid supplier id' });

    const supplier = await query('SELECT id, supplier_name, payment_terms FROM suppliers WHERE id = $1 AND is_active = true', [supplierId]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const productIds: string[] = Array.isArray(req.body.product_ids) ? req.body.product_ids : [];
    if (productIds.length === 0) return res.status(400).json({ error: 'Select at least one product' });

    const { items } = await fetchSupplierCatalogItems(supplierId);
    const selected = items.filter((i) => productIds.includes(i.product_id));

    if (selected.length === 0) {
      return res.status(400).json({ error: 'No matching catalog products found' });
    }

    const poItems = selected
      .map((i) => ({
        product_id: i.product_id,
        product_name: i.name,
        sku: i.sku,
        quantity: i.standard_order_qty,
        unit_cost: i.unit_cost,
        unit_of_measure: i.unit_of_measure,
        tax_type: i.tax_type,
      }))
      .filter((i) => i.quantity != null && i.quantity > 0);

    if (poItems.length === 0) {
      return res.status(400).json({ error: 'Selected items have no order quantity — set reorder level on the product first' });
    }

    res.json({
      supplier_id: supplierId,
      supplier_name: supplier.rows[0].supplier_name,
      payment_terms: supplier.rows[0].payment_terms || '',
      notes: req.body.notes || 'Generated from supplier low stock catalog',
      items: poItems,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, hasUserPerm('purchases.suppliers.create'), auditLog('Suppliers', 'Create'), async (req: AuthRequest, res: Response) => {
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

router.put('/:id', authenticate, hasUserPerm('purchases.suppliers.edit'), auditLog('Suppliers', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    auditBefore(req, auditSnapshot(existing.rows[0], AUDIT_FIELDS.supplier));

    const { supplier_name, contact_person, address, phone, email, payment_terms, tin, is_active } = req.body;
    const result = await query(
      `UPDATE suppliers SET supplier_name = COALESCE($1, supplier_name), contact_person = COALESCE($2, contact_person),
        address = COALESCE($3, address), phone = COALESCE($4, phone), email = COALESCE($5, email),
        payment_terms = COALESCE($6, payment_terms), tin = COALESCE($7, tin),
        is_active = COALESCE($8, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = $9 RETURNING *`,
      [supplier_name, contact_person, address, phone, email, payment_terms, tin, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    auditAfter(req, auditSnapshot(result.rows[0], AUDIT_FIELDS.supplier));
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, hasUserPerm('purchases.suppliers.edit'), auditLog('Suppliers', 'Delete'), async (req: AuthRequest, res: Response) => {
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
