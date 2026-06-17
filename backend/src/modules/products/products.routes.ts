import { Router, Response } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { const ok = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv') || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.originalname.endsWith('.xlsx'); cb(null, ok); } });

const router = Router();

// Generate next SKU
const generateSKU = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(sku, 5) AS INTEGER)), 0) + 1 as next_num FROM products WHERE sku ~ '^DMT-'");
  const nextNum = result.rows[0]?.next_num || 1;
  return `DMT-${String(nextNum).padStart(5, '0')}`;
};

// Get all products with search, pagination
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || '';
    const category_id = req.query.category_id as string;
    const is_active = req.query.is_active as string;

    let whereClause = 'WHERE p.is_active = true';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex} OR p.barcode ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category_id) {
      whereClause += ` AND p.category_id = $${paramIndex}`;
      params.push(category_id);
      paramIndex++;
    }

    if (is_active === 'all') {
      whereClause = whereClause.replace('WHERE p.is_active = true', 'WHERE 1=1');
    } else if (is_active === 'false') {
      whereClause = whereClause.replace('WHERE p.is_active = true', 'WHERE p.is_active = false');
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM products p ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT p.*, c.name as category_name, b.name as brand_name,
              COALESCE(i.quantity, 0) as store_stock,
              COALESCE(i2.quantity, 0) as warehouse_stock,
              (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true) as variant_count
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       LEFT JOIN inventory i ON p.id = i.product_id AND i.location_id = 1
       LEFT JOIN inventory i2 ON p.id = i2.product_id AND i2.location_id = 2
       ${whereClause}
       ORDER BY p.name ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({
      data: result.rows,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Helper: escape CSV field
const esc = (v: any) => {
  const s = v == null ? '' : String(v);
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// Parse uploaded file (CSV or XLSX) into rows of arrays
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
  // CSV
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

// Search products (for POS/autocomplete)
router.get('/search/quick', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const search = req.query.q as string || '';
    const location_id = req.query.location_id || 1;

    const result = await query(
      `SELECT p.id, p.sku, p.name, p.barcode, p.retail_price, p.wholesale_price,
        p.distributor_price, p.cost, p.tax_type, p.price_type, p.has_variants, p.has_chilled_variant,
        p.chilled_price, COALESCE(i.quantity, 0) as stock
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = $3
       WHERE p.is_active = true AND (
         p.name ILIKE $1 OR p.barcode ILIKE $1 OR p.sku ILIKE $1
       )
       ORDER BY
         CASE WHEN p.barcode = $2 THEN 1 WHEN p.sku = $2 THEN 2 ELSE 3 END,
         p.name
       LIMIT 20`,
      [`%${search}%`, search, location_id]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Exact barcode / SKU lookup (no wildcard) — used by POS scanner Enter
router.get('/search/exact', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query.q as string || '';
    const location_id = req.query.location_id || 1;

    const result = await query(
      `SELECT p.id, p.sku, p.name, p.barcode, p.retail_price, p.wholesale_price,
        p.distributor_price, p.cost, p.tax_type, p.price_type, p.has_variants, p.has_chilled_variant,
        p.chilled_price, COALESCE(i.quantity, 0) as stock
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id AND i.location_id = $3
       WHERE p.is_active = true AND (p.barcode = $1 OR p.sku = $2)
       ORDER BY CASE WHEN p.barcode = $1 THEN 1 ELSE 2 END
       LIMIT 1`,
      [q, q, location_id]
    );
    res.json(result.rows[0] || null);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export products
router.get('/export', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const format = (req.query.format as string) || 'csv';
    const search = req.query.search as string || '';
    const status = req.query.status as string || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (search) { where += ` AND (p.name ILIKE $${idx} OR p.barcode ILIKE $${idx} OR p.sku ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (status === 'active') { where += ` AND p.is_active = true`; }
    else if (status === 'inactive') { where += ` AND p.is_active = false`; }

    const result = await query(
      `SELECT p.sku, p.name, p.barcode, c.name as category, b.name as brand,
        p.unit_of_measure, p.cost, p.retail_price, p.wholesale_price, p.distributor_price,
        p.reorder_level, p.tax_type, p.price_type, p.description, p.is_active
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       ${where}
       ORDER BY p.name`,
      params
    );

    const rows = result.rows;

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Products');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=products_export.xlsx');
      return res.send(buf);
    }

    // Default CSV
    const headerRow = ['SKU','Name','Barcode','Category','Brand','Unit of Measure','Cost','Retail Price','Wholesale Price','Distributor Price','Reorder Level','Tax Type','Price Type','Description','Active'];
    const csv = '\uFEFF' + headerRow.join(',') + '\n' + rows.map((r: any) => [
      esc(r.sku), esc(r.name), esc(r.barcode), esc(r.category), esc(r.brand),
      esc(r.unit_of_measure), r.cost, r.retail_price, r.wholesale_price, r.distributor_price,
      r.reorder_level, esc(r.tax_type), esc(r.price_type), esc(r.description), r.is_active
    ].join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=products_export.csv');
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download blank template
router.get('/export/template', authenticate, async (_req: AuthRequest, res: Response) => {
  const headerRow = ['Name','Barcode','Category','Brand','Unit of Measure','Cost','Retail Price','Wholesale Price','Distributor Price','Reorder Level','Tax Type','Price Type','Description','Has Chilled Variant','Chilled Price'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=product_import_template.csv');
  res.send('\uFEFF' + headerRow.map(esc).join(','));
});

// Import products — preview (no save)
router.post('/import/preview', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) throw new AppError('No file uploaded');
    const { headers, rows } = parseFile(req.file.buffer, req.file.originalname);

    const headerMap: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (h === 'name') headerMap['Name'] = i;
      else if (h === 'barcode') headerMap['Barcode'] = i;
      else if (h === 'sku') headerMap['SKU'] = i;
      else if (h === 'category') headerMap['Category'] = i;
      else if (h === 'brand') headerMap['Brand'] = i;
      else if (h === 'unit of measure' || h === 'uom') headerMap['Unit of Measure'] = i;
      else if (h === 'cost') headerMap['Cost'] = i;
      else if (h === 'retail price' || h === 'price') headerMap['Retail Price'] = i;
      else if (h === 'wholesale price') headerMap['Wholesale Price'] = i;
      else if (h === 'distributor price') headerMap['Distributor Price'] = i;
      else if (h === 'reorder level') headerMap['Reorder Level'] = i;
      else if (h === 'tax type') headerMap['Tax Type'] = i;
      else if (h === 'price type') headerMap['Price Type'] = i;
      else if (h === 'description') headerMap['Description'] = i;
      else if (h === 'has chilled variant') headerMap['Has Chilled Variant'] = i;
      else if (h === 'chilled price') headerMap['Chilled Price'] = i;
      else if (h === 'active' || h === 'is_active') headerMap['Active'] = i;
    }

    if (!('Name' in headerMap)) throw new AppError('Missing required column: Name');

    // Pre-fetch existing products for match detection
    const existingProds = await query('SELECT id, sku, barcode, name FROM products');
    const bySku = new Map(existingProds.rows.map((r: any) => [r.sku, r]));
    const byBarcode = new Map(existingProds.rows.map((r: any) => [r.barcode?.toLowerCase(), r]));
    const byName = new Map(existingProds.rows.map((r: any) => [r.name.toLowerCase(), r]));

    const previewRows: any[] = [];
    const errors: { row: number; message: string }[] = [];
    let validRows = 0;

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const rowNum = ri + 2; // 1-indexed, skip header
      const entry: any = { row: rowNum, has_errors: false, errors: [] };
      entry.name = headerMap['Name'] !== undefined ? row[headerMap['Name']] || '' : '';
      entry.sku = headerMap['SKU'] !== undefined ? row[headerMap['SKU']] || '' : '';
      entry.barcode = headerMap['Barcode'] !== undefined ? row[headerMap['Barcode']] || '' : '';
      entry.category = headerMap['Category'] !== undefined ? row[headerMap['Category']] || '' : '';
      entry.brand = headerMap['Brand'] !== undefined ? row[headerMap['Brand']] || '' : '';
      entry.unit_of_measure = headerMap['Unit of Measure'] !== undefined ? row[headerMap['Unit of Measure']] || '' : '';
      entry.cost = headerMap['Cost'] !== undefined ? row[headerMap['Cost']] || '0' : '0';
      entry.retail_price = headerMap['Retail Price'] !== undefined ? row[headerMap['Retail Price']] || '0' : '0';
      entry.wholesale_price = headerMap['Wholesale Price'] !== undefined ? row[headerMap['Wholesale Price']] || '0' : '0';
      entry.distributor_price = headerMap['Distributor Price'] !== undefined ? row[headerMap['Distributor Price']] || '0' : '0';
      entry.reorder_level = headerMap['Reorder Level'] !== undefined ? row[headerMap['Reorder Level']] || '0' : '0';
      entry.tax_type = headerMap['Tax Type'] !== undefined ? row[headerMap['Tax Type']] || '' : '';
      entry.price_type = headerMap['Price Type'] !== undefined ? row[headerMap['Price Type']] || '' : '';
      entry.description = headerMap['Description'] !== undefined ? row[headerMap['Description']] || '' : '';
      entry.has_chilled_variant = headerMap['Has Chilled Variant'] !== undefined ? row[headerMap['Has Chilled Variant']] || '' : '';
      entry.chilled_price = headerMap['Chilled Price'] !== undefined ? row[headerMap['Chilled Price']] || '0' : '0';

      if (!entry.name) { entry.has_errors = true; entry.errors.push('Product name is required'); }

      // Validate numeric fields
      ['cost','retail_price','wholesale_price','distributor_price','reorder_level','chilled_price'].forEach(f => {
        if (isNaN(parseFloat(entry[f]))) { entry.has_errors = true; entry.errors.push(`${f} must be a number`); }
      });

      // Look up category
      if (entry.category) {
        try {
          const catRes = await query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [entry.category]);
          entry.category_id = catRes.rows.length > 0 ? catRes.rows[0].id : null;
          if (!entry.category_id) { entry.has_errors = true; entry.errors.push(`Category "${entry.category}" not found`); }
        } catch { entry.has_errors = true; entry.errors.push('Error looking up category'); }
      }

      // Look up brand
      if (entry.brand) {
        try {
          const brandRes = await query('SELECT id FROM brands WHERE LOWER(name) = LOWER($1)', [entry.brand]);
          entry.brand_id = brandRes.rows.length > 0 ? brandRes.rows[0].id : null;
          if (!entry.brand_id) { entry.has_errors = true; entry.errors.push(`Brand "${entry.brand}" not found`); }
        } catch { entry.has_errors = true; entry.errors.push('Error looking up brand'); }
      }

      // Detect if this row would update or create
      let match: any = null;
      const sku = entry.sku.trim();
      const barcode = entry.barcode.trim();
      if (sku) match = bySku.get(sku);
      if (!match && barcode) match = byBarcode.get(barcode.toLowerCase());
      if (!match) match = byName.get(entry.name.toLowerCase());
      entry.action = match ? 'Update' : 'Create';

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

// Import products — execute (create/update)
router.post('/import/execute', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) throw new AppError('No file uploaded');
    const { headers, rows } = parseFile(req.file.buffer, req.file.originalname);

    const headerMap: Record<string, number> = {};
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      if (h === 'name') headerMap['Name'] = i;
      else if (h === 'barcode') headerMap['Barcode'] = i;
      else if (h === 'sku') headerMap['SKU'] = i;
      else if (h === 'category') headerMap['Category'] = i;
      else if (h === 'brand') headerMap['Brand'] = i;
      else if (h === 'unit of measure' || h === 'uom') headerMap['Unit of Measure'] = i;
      else if (h === 'cost') headerMap['Cost'] = i;
      else if (h === 'retail price' || h === 'price') headerMap['Retail Price'] = i;
      else if (h === 'wholesale price') headerMap['Wholesale Price'] = i;
      else if (h === 'distributor price') headerMap['Distributor Price'] = i;
      else if (h === 'reorder level') headerMap['Reorder Level'] = i;
      else if (h === 'tax type') headerMap['Tax Type'] = i;
      else if (h === 'price type') headerMap['Price Type'] = i;
      else if (h === 'description') headerMap['Description'] = i;
      else if (h === 'has chilled variant') headerMap['Has Chilled Variant'] = i;
      else if (h === 'chilled price') headerMap['Chilled Price'] = i;
      else if (h === 'active' || h === 'is_active') headerMap['Active'] = i;
    }

    if (!('Name' in headerMap)) throw new AppError('Missing required column: Name');

    // Pre-fetch all categories, brands, and existing products for fast lookup
    const [catRows, brandRows, existingProds] = await Promise.all([
      query('SELECT id, LOWER(name) as name FROM categories'),
      query('SELECT id, LOWER(name) as name FROM brands'),
      query('SELECT id, sku, barcode FROM products')
    ]);
    const catMap: Record<string, string> = {};
    catRows.rows.forEach((r: any) => { catMap[r.name] = r.id; });
    const brandMap: Record<string, string> = {};
    brandRows.rows.forEach((r: any) => { brandMap[r.name] = r.id; });

    // Build lookup maps for matching
    const bySku = new Map(existingProds.rows.map((r: any) => [r.sku, r]));
    const byBarcode = new Map(existingProds.rows.map((r: any) => [r.barcode?.toLowerCase(), r]));
    const byName = new Map(existingProds.rows.map((r: any) => [r.name.toLowerCase(), r]));

    let created = 0, updated = 0;
    const errors: { row: number; message: string }[] = [];

    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const rowNum = ri + 2;
      try {
        const name = (headerMap['Name'] !== undefined ? row[headerMap['Name']] : '').trim();
        if (!name) { errors.push({ row: rowNum, message: 'Product name is required' }); continue; }

        const sku = (headerMap['SKU'] !== undefined ? row[headerMap['SKU']] : '').trim();
        const barcode = (headerMap['Barcode'] !== undefined ? row[headerMap['Barcode']] : '').trim();
        const catName = (headerMap['Category'] !== undefined ? row[headerMap['Category']] : '').trim().toLowerCase();
        const brandName = (headerMap['Brand'] !== undefined ? row[headerMap['Brand']] : '').trim().toLowerCase();
        const unit_of_measure = (headerMap['Unit of Measure'] !== undefined ? row[headerMap['Unit of Measure']] : 'pc').trim();
        const cost = parseFloat(headerMap['Cost'] !== undefined ? row[headerMap['Cost']] : '0') || 0;
        const retail_price = parseFloat(headerMap['Retail Price'] !== undefined ? row[headerMap['Retail Price']] : '0') || 0;
        const wholesale_price = parseFloat(headerMap['Wholesale Price'] !== undefined ? row[headerMap['Wholesale Price']] : '0') || 0;
        const distributor_price = parseFloat(headerMap['Distributor Price'] !== undefined ? row[headerMap['Distributor Price']] : '0') || 0;
        const reorder_level = parseFloat(headerMap['Reorder Level'] !== undefined ? row[headerMap['Reorder Level']] : '0') || 0;
        const tax_type = (headerMap['Tax Type'] !== undefined ? row[headerMap['Tax Type']] : 'VAT').trim() || 'VAT';
        const price_type = (headerMap['Price Type'] !== undefined ? row[headerMap['Price Type']] : 'VAT Inclusive').trim() || 'VAT Inclusive';
        const description = headerMap['Description'] !== undefined ? row[headerMap['Description']] : '';
        const hasChilled = (headerMap['Has Chilled Variant'] !== undefined ? row[headerMap['Has Chilled Variant']] : '').toLowerCase();
        const has_chilled_variant = hasChilled === 'yes' || hasChilled === 'true' || hasChilled === '1';
        const chilled_price = parseFloat(headerMap['Chilled Price'] !== undefined ? row[headerMap['Chilled Price']] : '0') || 0;
        const isActiveVal = (headerMap['Active'] !== undefined ? row[headerMap['Active']] : '').toLowerCase();
        const is_active = isActiveVal ? isActiveVal === 'yes' || isActiveVal === 'true' || isActiveVal === '1' || isActiveVal === 't' : undefined;
        const category_id = catName ? catMap[catName] || null : null;
        const brand_id = brandName ? brandMap[brandName] || null : null;

        // Match existing: SKU first (unique), then barcode, then name
        let existing: any = null;
        if (sku) existing = bySku.get(sku);
        if (!existing && barcode) existing = byBarcode.get(barcode.toLowerCase());
        if (!existing) existing = byName.get(name.toLowerCase());

        if (existing) {
          // Update existing
          const pid = existing.id;
          const setClauses = [
            'name = $1', 'barcode = $2', 'category_id = $3', 'brand_id = $4',
            'unit_of_measure = $5', 'cost = $6', 'retail_price = $7', 'wholesale_price = $8',
            'distributor_price = $9', 'reorder_level = $10', 'tax_type = $11', 'price_type = $12',
            'description = $13', 'has_chilled_variant = $14', 'chilled_price = $15', 'updated_at = CURRENT_TIMESTAMP'
          ];
          const params: any[] = [name, barcode || null, category_id, brand_id, unit_of_measure, cost,
            retail_price, wholesale_price, distributor_price, reorder_level, tax_type, price_type,
            description, has_chilled_variant, chilled_price];
          if (is_active !== undefined) {
            setClauses.push('is_active = $' + (params.length + 1));
            params.push(is_active);
          }
          params.push(pid);
          await query(
            `UPDATE products SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
            params
          );
          await query('UPDATE inventory SET unit_cost = $1 WHERE product_id = $2', [cost, pid]);
          updated++;
        } else {
          // Create new
          const pid = uuidv4();
          const sku = await generateSKU();
          await query(
            `INSERT INTO products (id, sku, name, barcode, category_id, brand_id, unit_of_measure,
              cost, retail_price, wholesale_price, distributor_price, reorder_level,
              tax_type, price_type, description, has_chilled_variant, chilled_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [pid, sku, name, barcode, category_id, brand_id, unit_of_measure, cost,
              retail_price, wholesale_price, distributor_price, reorder_level,
              tax_type, price_type, description, has_chilled_variant, chilled_price]
          );
          const locs = await query('SELECT id FROM locations WHERE is_active = true');
          for (const loc of locs.rows) {
            await query(
              'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, 0, $3) ON CONFLICT (product_id, location_id) DO NOTHING',
              [pid, loc.id, cost]
            );
          }
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

// Get single product
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT p.*, c.name as category_name, b.name as brand_name
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN brands b ON p.brand_id = b.id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create product
router.post('/', authenticate, auditLog('Products', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, barcode, category_id, brand_id, unit_of_measure, cost,
      retail_price, wholesale_price, distributor_price, reorder_level,
      tax_type, price_type, description, image_url, has_variants, has_chilled_variant, chilled_price
    } = req.body;

    if (!name) throw new AppError('Product name is required');
    const sku = await generateSKU();
    const id = uuidv4();

    await query(
      `INSERT INTO products (id, sku, name, barcode, category_id, brand_id, unit_of_measure, cost,
        retail_price, wholesale_price, distributor_price, reorder_level, tax_type, price_type, description, image_url, has_variants, has_chilled_variant, chilled_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [id, sku, name, barcode, category_id, brand_id, unit_of_measure || 'pc', cost || 0,
        retail_price || 0, wholesale_price || 0, distributor_price || 0, reorder_level || 0,
        tax_type || 'VAT', price_type || 'VAT Inclusive', description, image_url, has_variants || false,
        has_chilled_variant || false, chilled_price || 0]
    );

    // Create inventory records for all locations
    const locations = await query('SELECT id FROM locations WHERE is_active = true');
    for (const loc of locations.rows) {
      await query(
        'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, 0, $3) ON CONFLICT (product_id, location_id) DO NOTHING',
        [id, loc.id, cost || 0]
      );
    }

    const product = await query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = $1', [id]);
    res.status(201).json(product.rows[0]);
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

// Update product
router.put('/:id', authenticate, auditLog('Products', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    (req as any).oldValues = existing.rows[0];

    const {
      name, barcode, category_id, brand_id, unit_of_measure, cost,
      retail_price, wholesale_price, distributor_price, reorder_level,
      tax_type, price_type, description, image_url, is_active, has_chilled_variant, chilled_price
    } = req.body;

    await query(
      `UPDATE products SET name = $1, barcode = $2, category_id = $3, brand_id = $4,
        unit_of_measure = $5, cost = $6, retail_price = $7, wholesale_price = $8,
        distributor_price = $9, reorder_level = $10, tax_type = $11, price_type = $12, description = $13,
        image_url = $14, is_active = COALESCE($15, is_active), has_chilled_variant = $16,
        chilled_price = $17, updated_at = CURRENT_TIMESTAMP
       WHERE id = $18`,
      [name, barcode, category_id || null, brand_id || null, unit_of_measure, cost,
        retail_price, wholesale_price, distributor_price, reorder_level,
        tax_type, price_type, description, image_url, is_active, has_chilled_variant || false,
        chilled_price || 0, req.params.id]
    );

    // Update unit cost in inventory
    if (cost !== undefined) {
      await query('UPDATE inventory SET unit_cost = $1 WHERE product_id = $2', [cost, req.params.id]);
    }

    const product = await query('SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = $1', [req.params.id]);
    res.json(product.rows[0]);
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

// Disable product
router.patch('/:id/toggle', authenticate, auditLog('Products', 'Toggle Status'), async (req: AuthRequest, res: Response) => {
  try {
    const product = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (product.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    (req as any).oldValues = product.rows[0];

    await query('UPDATE products SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [req.params.id]);
    res.json({ message: 'Product status updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get product variants
router.get('/:id/variants', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM product_variants WHERE product_id = $1 AND is_active = true ORDER BY name',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create product variant
router.post('/:id/variants', authenticate, auditLog('Products', 'Create Variant'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, retail_price, additional_cost } = req.body;
    if (!name) throw new AppError('Variant name is required');

    const existing = await query(
      'SELECT id FROM product_variants WHERE product_id = $1 AND name = $2 AND is_active = true',
      [req.params.id, name]
    );
    if (existing.rows.length > 0) {
      throw new AppError('A variant with this name already exists for this product');
    }

    const id = uuidv4();

    await query(
      `INSERT INTO product_variants (id, product_id, name, retail_price, additional_cost)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, req.params.id, name, retail_price || 0, additional_cost || 0]
    );

    res.status(201).json({ id, product_id: req.params.id, name, retail_price, additional_cost });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

// Update product variant
router.put('/:id/variants/:variantId', authenticate, auditLog('Products', 'Update Variant'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, retail_price, additional_cost, is_active } = req.body;

    const existing = await query('SELECT * FROM product_variants WHERE id = $1 AND product_id = $2', [req.params.variantId, req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Variant not found' });
    }
    (req as any).oldValues = existing.rows[0];

    if (name) {
      const dup = await query(
        'SELECT id FROM product_variants WHERE product_id = $1 AND name = $2 AND id != $3 AND is_active = true',
        [req.params.id, name, req.params.variantId]
      );
      if (dup.rows.length > 0) {
        throw new AppError('A variant with this name already exists for this product');
      }
    }

    await query(
      `UPDATE product_variants SET name = COALESCE($1, name), retail_price = COALESCE($2, retail_price),
        additional_cost = COALESCE($3, additional_cost), is_active = COALESCE($4, is_active),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [name, retail_price, additional_cost, is_active, req.params.variantId]
    );

    const variant = await query('SELECT * FROM product_variants WHERE id = $1', [req.params.variantId]);
    res.json(variant.rows[0]);
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

// Delete product variant
router.delete('/:id/variants/:variantId', authenticate, auditLog('Products', 'Delete Variant'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT * FROM product_variants WHERE id = $1 AND product_id = $2', [req.params.variantId, req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Variant not found' });
    }
    (req as any).oldValues = existing.rows[0];

    await query('DELETE FROM product_variants WHERE id = $1', [req.params.variantId]);
    res.json({ message: 'Variant deleted' });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

// Delete product
router.delete('/:id', authenticate, auditLog('Products', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    (req as any).oldValues = existing.rows[0];

    // Delete related records
    await query('DELETE FROM inventory WHERE product_id = $1', [req.params.id]);
    await query('DELETE FROM product_variants WHERE product_id = $1', [req.params.id]);
    await query('DELETE FROM unit_conversions WHERE product_id = $1', [req.params.id]);
    await query('DELETE FROM products WHERE id = $1', [req.params.id]);

    res.json({ message: 'Product deleted' });
  } catch (error: any) {
    if (error.code === '23503') { // foreign_key_violation
      return res.status(400).json({ error: 'Cannot delete product with existing transactions. Deactivate it instead.' });
    }
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

export default router;
