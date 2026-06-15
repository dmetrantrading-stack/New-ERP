import { Router, Response } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: (_req, file, cb) => { const ok = file.mimetype === 'text/csv' || file.originalname.endsWith('.csv') || file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.originalname.endsWith('.xlsx'); cb(null, ok); } });

const router = Router();

const generateRefNumber = async (prefix: string, table: string, column: string): Promise<string> => {
  const safePrefix = prefix.replace(/[^A-Z]/g, '');
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeColumn = column.replace(/[^a-z_]/g, '');
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeColumn}, ${safePrefix.length + 2}) AS INTEGER)), 0) + 1 as next FROM ${safeTable} WHERE ${safeColumn} ~ '^${safePrefix}-'`
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

// Get inventory with product details (original flat list)
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || '';
    const location_id = req.query.location_id || '';
    const low_stock = req.query.low_stock === 'true';

    let whereClause = 'WHERE p.is_active = true';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (location_id) {
      whereClause += ` AND i.location_id = $${paramIndex}`;
      params.push(location_id);
      paramIndex++;
    }

    if (low_stock) {
      whereClause += ` AND i.quantity <= p.reorder_level AND p.reorder_level > 0`;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM products p
       JOIN inventory i ON p.id = i.product_id
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT i.*, p.sku, p.name as product_name, p.reorder_level, p.unit_of_measure,
              l.name as location_name, l.type as location_type
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       JOIN locations l ON i.location_id = l.id
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

// Get pivoted inventory stock list with summary cards
router.get('/stock-list', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const search = req.query.search as string || '';
    const lowStockOnly = req.query.low_stock === 'true';

    let whereClause = 'WHERE p.is_active = true';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramIndex} OR p.sku ILIKE $${paramIndex} OR p.barcode ILIKE $${paramIndex} OR COALESCE(c.name,'') ILIKE $${paramIndex} OR p.unit_of_measure ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const result = await query(
      `SELECT
        p.id as product_id, p.sku, p.name, p.barcode, p.unit_of_measure,
        p.reorder_level, p.retail_price, p.wholesale_price, p.distributor_price,
        COALESCE(c.name, '') as category_name,
        COALESCE(s_store.quantity, 0) as store_qty,
        COALESCE(s_warehouse.quantity, 0) as warehouse_qty,
        COALESCE(s_store.quantity, 0) + COALESCE(s_warehouse.quantity, 0) as total_qty,
        COALESCE(s_store.quantity, 0) + COALESCE(s_warehouse.quantity, 0) as stock,
        COALESCE(
          CASE
            WHEN COALESCE(s_store.quantity, 0) + COALESCE(s_warehouse.quantity, 0) > 0
            THEN ROUND(
              (COALESCE(s_store.unit_cost * s_store.quantity, 0) + COALESCE(s_warehouse.unit_cost * s_warehouse.quantity, 0))
              / NULLIF(COALESCE(s_store.quantity, 0) + COALESCE(s_warehouse.quantity, 0), 0)
            , 2)
            ELSE COALESCE(s_store.unit_cost, s_warehouse.unit_cost, 0)
          END, 0
        ) as avg_cost
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN inventory s_store ON p.id = s_store.product_id AND s_store.location_id = 1
       LEFT JOIN inventory s_warehouse ON p.id = s_warehouse.product_id AND s_warehouse.location_id = 2
       ${whereClause}
       ORDER BY p.name ASC`,
      params
    );

    let rows = result.rows;

    if (lowStockOnly) {
      rows = rows.filter((r: any) => parseFloat(r.total_qty) <= parseFloat(r.reorder_level) && parseFloat(r.reorder_level) > 0);
    }

    const totalSkus = rows.length;
    const lowStock = rows.filter((r: any) => parseFloat(r.total_qty) <= parseFloat(r.reorder_level) && parseFloat(r.reorder_level) > 0).length;
    const totalValue = rows.reduce((s: number, r: any) => s + (parseFloat(r.total_qty) * parseFloat(r.avg_cost)), 0);

    const expiryResult = await query(
      `SELECT COUNT(DISTINCT b.product_id)::int as count
       FROM batches b
       JOIN products p ON b.product_id = p.id
       WHERE b.expiry_date IS NOT NULL
         AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
         AND b.quantity > 0 AND p.is_active = true`
    );
    const expiringSoon = expiryResult.rows[0]?.count || 0;

    res.json({
      summary: {
        total_skus: totalSkus,
        low_stock: lowStock,
        expiring_soon: expiringSoon,
        inventory_value: Math.round(totalValue * 100) / 100,
      },
      data: rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get inventory for a specific product
router.get('/product/:productId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT i.*, l.name as location_name
       FROM inventory i
       JOIN locations l ON i.location_id = l.id
       WHERE i.product_id = $1`,
      [req.params.productId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get stock card / inventory ledger
router.get('/ledger/:productId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const location_id = req.query.location_id || 1;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = (page - 1) * limit;

    const countResult = await query(
      'SELECT COUNT(*) FROM inventory_ledger WHERE product_id = $1 AND location_id = $2',
      [req.params.productId, location_id]
    );

    const result = await query(
      `SELECT il.*, u.full_name as created_by_name
       FROM inventory_ledger il
       LEFT JOIN users u ON il.created_by = u.id
       WHERE il.product_id = $1 AND il.location_id = $2
       ORDER BY il.created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.params.productId, location_id, limit, offset]
    );

    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      page,
      limit,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get batches for a product
router.get('/batches/:productId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT b.*, l.name as location_name
       FROM batches b
       JOIN locations l ON b.location_id = l.id
       WHERE b.product_id = $1 AND b.quantity > 0
       ORDER BY b.expiry_date ASC NULLS LAST, b.created_at DESC`,
      [req.params.productId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Adjust inventory
router.post('/adjust', authenticate, auditLog('Inventory', 'Adjust'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { product_id, location_id, quantity, reason } = req.body;
    if (!product_id || quantity === undefined) throw new AppError('Product ID and quantity are required');
    if (!location_id) throw new AppError('Location ID is required');

    const inventory = await client.query(
      'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
      [product_id, location_id]
    );

    if (inventory.rows.length === 0) {
      throw new AppError('Inventory record not found');
    }

    const currentQty = parseFloat(inventory.rows[0].quantity);
    const currentCost = parseFloat(inventory.rows[0].unit_cost);
    const newQty = currentQty + parseFloat(quantity);
    const adjAmount = Math.abs(parseFloat(quantity)) * currentCost;

    // Check negative inventory
    if (newQty < 0) {
      const setting = await client.query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
      if (setting.rows[0]?.setting_value !== 'true') {
        throw new AppError('Negative inventory not allowed. Enable in settings.');
      }
    }

    const ledgerId = uuidv4();
    await client.query(
      `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
       VALUES ($1, $2, $3, 'Manual Adjustment', $4, $5, $6, $7, $8, $9, $10)`,
      [ledgerId, product_id, location_id, quantity > 0 ? 'IN' : 'OUT', Math.abs(quantity), newQty, currentCost, adjAmount, reason, req.user!.id]
    );

    await client.query('UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2 AND location_id = $3',
      [newQty, product_id, location_id]);

    // Journal entry for inventory adjustment
    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, created_by)
       VALUES ($1, $2, CURRENT_DATE, 'Inventory Adjustment', $3, $4, $5, $5, $6)`,
      [entryId, entryNumber, ledgerId, `Inventory Adjustment: ${reason || 'Manual'}`, adjAmount, req.user!.id]
    );

    const invAccount = await client.query("SELECT id FROM chart_of_accounts WHERE account_code = '1200'");
    const adjAccount = await client.query("SELECT id FROM chart_of_accounts WHERE account_code = '5020'");

    if (invAccount.rows.length > 0 && adjAccount.rows.length > 0) {
      if (parseFloat(quantity) > 0) {
        // Increase: Debit Inventory, Credit Adjustment account
        await client.query(
          `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, 0, 'Inventory Adjustment', $6),
                  ($7, $2, $8, $9, 0, $10, 'Inventory Adjustment', $6)`,
          [uuidv4(), entryId, invAccount.rows[0].id, `Inventory Increase`, adjAmount, ledgerId,
           uuidv4(), adjAccount.rows[0].id, `Inventory Adjustment Offset`]
        );
      } else {
        // Decrease: Credit Inventory, Debit Adjustment account
        await client.query(
          `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
           VALUES ($1, $2, $3, $4, $5, 0, 'Inventory Adjustment', $6),
                  ($7, $2, $8, $9, 0, $10, 'Inventory Adjustment', $6)`,
          [uuidv4(), entryId, adjAccount.rows[0].id, `Inventory Decrease`, adjAmount, ledgerId,
           uuidv4(), entryId, invAccount.rows[0].id, `Inventory Decrease Offset`]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Inventory adjusted', new_quantity: newQty });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Low stock alerts
router.get('/alerts/low-stock', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT p.id, p.sku, p.name, p.reorder_level, p.unit_of_measure,
              i.quantity, i.location_id, l.name as location_name
       FROM products p
       JOIN inventory i ON p.id = i.product_id
       JOIN locations l ON i.location_id = l.id
       WHERE p.is_active = true AND i.quantity <= p.reorder_level AND p.reorder_level > 0
       ORDER BY (i.quantity::float / NULLIF(p.reorder_level, 0)) ASC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Expiry alerts
router.get('/alerts/expiring', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const result = await query(
      `SELECT b.*, p.sku, p.name as product_name, l.name as location_name
       FROM batches b
       JOIN products p ON b.product_id = p.id
       JOIN locations l ON b.location_id = l.id
       WHERE b.expiry_date IS NOT NULL
         AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1
         AND b.quantity > 0
       ORDER BY b.expiry_date ASC`,
      [days]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Expired items
router.get('/alerts/expired', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT b.*, p.sku, p.name as product_name, l.name as location_name
       FROM batches b
       JOIN products p ON b.product_id = p.id
       JOIN locations l ON b.location_id = l.id
       WHERE b.expiry_date < CURRENT_DATE AND b.quantity > 0
       ORDER BY b.expiry_date ASC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Locations
router.get('/locations', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM locations WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Items expiring within a range (e.g. 60-90 days)
router.get('/alerts/expiring-range', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const fromDays = parseInt(req.query.from as string) || 60;
    const toDays = parseInt(req.query.to as string) || 90;
    const result = await query(
      `SELECT b.*, p.sku, p.name as product_name, p.unit_of_measure,
              l.name as location_name,
              (b.expiry_date - CURRENT_DATE) as days_left
       FROM batches b
       JOIN products p ON b.product_id = p.id
       JOIN locations l ON b.location_id = l.id
       WHERE b.expiry_date IS NOT NULL
         AND b.expiry_date BETWEEN CURRENT_DATE + $1 AND CURRENT_DATE + $2
         AND b.quantity > 0
       ORDER BY b.expiry_date ASC`,
      [fromDays, toDays]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Bulk Inventory Import/Export ──────────────────────────────────

const esc = (v: any) => { const s = v == null ? '' : String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const parseFile = (buffer: Buffer, originalName: string): { headers: string[]; rows: string[][] } => {
  if (originalName.endsWith('.xlsx')) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (aoa.length < 2) throw new AppError('File must have a header row and at least one data row');
    return {
      headers: aoa[0].map((h: any) => String(h).trim()),
      rows: aoa.slice(1).filter((r: any[]) => r.some(c => String(c).trim())).map(r => r.map((c: any) => String(c).trim())),
    };
  }
  const content = buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new AppError('File must have a header row and at least one data row');
  const parseLine = (line: string): string[] => {
    const result: string[] = []; let current = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) { if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; } else if (ch === '"') { inQuotes = false; } else { current += ch; } }
      else { if (ch === '"') { inQuotes = true; } else if (ch === ',') { result.push(current.trim()); current = ''; } else { current += ch; } }
    }
    result.push(current.trim()); return result;
  };
  return { headers: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
};

// Download blank inventory import template
router.get('/export/template', authenticate, async (_req: AuthRequest, res: Response) => {
  const headerRow = ['SKU','Barcode','Product Name','Location','Quantity','Unit','Batch Number','Expiration Date','Average Cost','Remarks'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=inventory_import_template.csv');
  res.send('\uFEFF' + headerRow.map(esc).join(','));
});

// Preview inventory import
router.post('/import/preview', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File is required' });
    const { headers, rows: rawRows } = parseFile(req.file.buffer, req.file.originalname);

    const ci = (name: string) => headers.findIndex(h => h.toLowerCase().replace(/[\s_-]/g, '') === name.toLowerCase().replace(/[\s_-]/g, ''));
    const skuIdx = ci('SKU');
    const barcodeIdx = ci('Barcode');
    const nameIdx = ci('Product Name');
    const locIdx = ci('Location');
    const qtyIdx = ci('Quantity');
    const uomIdx = ci('Unit');
    const batchIdx = ci('Batch Number');
    const expIdx = ci('Expiration Date');
    const costIdx = ci('Average Cost');
    const remIdx = ci('Remarks');

    const getVal = (row: string[], idx: number) => (idx >= 0 && idx < row.length) ? row[idx] : '';
    const getNum = (row: string[], idx: number) => { const v = parseFloat(getVal(row, idx)); return isNaN(v) ? 0 : v; };

    const products = await query('SELECT id, sku, barcode, name, unit_of_measure FROM products');
    const productBySku = new Map(products.rows.map(r => [r.sku?.toLowerCase(), r]));
    const productByBarcode = new Map(products.rows.map(r => [r.barcode?.toLowerCase(), r]));
    const locMap = new Map([['store', 1], ['warehouse', 2], ['1', 1], ['2', 2], ['main store', 1], ['main warehouse', 2]]);

    const settings = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
    const allowNegative = settings.rows[0]?.setting_value === 'true';

    const previewRows: any[] = [];
    const errors: { row: number; message: string; field?: string }[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 2;
      const sku = getVal(row, skuIdx);
      const barcode = getVal(row, barcodeIdx);
      const name = getVal(row, nameIdx);
      const locationRaw = getVal(row, locIdx);
      const quantity = getNum(row, qtyIdx);
      const batch = getVal(row, batchIdx);
      const expiry = getVal(row, expIdx);
      const cost = getNum(row, costIdx);

      const rowErrors: string[] = [];

      if (!sku && !barcode && !name) { errors.push({ row: rowNum, message: 'SKU, Barcode, or Product Name is required', field: 'SKU' }); continue; }

      // Find product
      let product = sku ? productBySku.get(sku.toLowerCase()) : null;
      if (!product && barcode) product = productByBarcode.get(barcode.toLowerCase());
      if (!product && name) product = products.rows.find(p => p.name?.toLowerCase() === name.toLowerCase());
      if (!product) { rowErrors.push('Product not found in system'); }

      // Resolve location
      const locId = locationRaw ? locMap.get(locationRaw.toLowerCase().trim()) : null;
      if (!locId) { rowErrors.push(`Location "${locationRaw}" not recognized (use Store or Warehouse)`); }

      if (quantity < 0 && !allowNegative) { rowErrors.push('Negative stock not allowed by system settings'); }

      previewRows.push({
        row: rowNum,
        sku: sku || product?.sku || '',
        barcode: barcode || product?.barcode || '',
        product_name: product?.name || name || '',
        product_id: product?.id || null,
        location: locId === 1 ? 'Store' : locId === 2 ? 'Warehouse' : locationRaw,
        location_id: locId,
        quantity,
        unit: getVal(row, uomIdx) || product?.unit_of_measure || '',
        batch_number: batch,
        expiration_date: expiry,
        average_cost: cost,
        remarks: getVal(row, remIdx),
        errors: rowErrors,
        has_errors: rowErrors.length > 0,
        is_new: !product,
        duplicate_warning: false,
        warnings: [],
      });
    }

    // Detect duplicate product+location combinations
    const dupKey = new Map<string, number[]>();
    previewRows.forEach((r, idx) => {
      if (r.product_id && r.location_id) {
        const k = `${r.product_id}|${r.location_id}`;
        if (dupKey.has(k)) dupKey.get(k)!.push(idx);
        else dupKey.set(k, [idx]);
      }
    });
    for (const [, indices] of dupKey) {
      if (indices.length > 1) {
        for (const idx of indices) {
          previewRows[idx].duplicate_warning = true;
          previewRows[idx].warnings.push(`Duplicate: this product+location appears ${indices.length} times. Quantities will be accumulated.`);
        }
      }
    }

    res.json({
      file_name: req.file.originalname,
      total_rows: rawRows.length,
      valid_rows: previewRows.filter(r => !r.has_errors).length,
      error_rows: errors.length + previewRows.filter(r => r.has_errors).length,
      rows: previewRows,
      errors,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Execute inventory import
router.post('/import', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    if (!req.file) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'File is required' }); }
    const { headers, rows: rawRows } = parseFile(req.file.buffer, req.file.originalname);

    const ci = (name: string) => headers.findIndex(h => h.toLowerCase().replace(/[\s_-]/g, '') === name.toLowerCase().replace(/[\s_-]/g, ''));
    const skuIdx = ci('SKU');
    const barcodeIdx = ci('Barcode');
    const nameIdx = ci('Product Name');
    const locIdx = ci('Location');
    const qtyIdx = ci('Quantity');
    const batchIdx = ci('Batch Number');
    const expIdx = ci('Expiration Date');
    const costIdx = ci('Average Cost');
    const remIdx = ci('Remarks');

    const getVal = (row: string[], idx: number) => (idx >= 0 && idx < row.length) ? row[idx] : '';
    const getNum = (row: string[], idx: number) => { const v = parseFloat(getVal(row, idx)); return isNaN(v) ? 0 : v; };

    const products = await client.query('SELECT id, sku, barcode, name FROM products');
    const productBySku = new Map(products.rows.map(r => [r.sku?.toLowerCase(), r]));
    const productByBarcode = new Map(products.rows.map(r => [r.barcode?.toLowerCase(), r]));
    const locMap = new Map([['store', 1], ['warehouse', 2], ['1', 1], ['2', 2], ['main store', 1], ['main warehouse', 2]]);

    const settings = await client.query("SELECT setting_value FROM system_settings WHERE setting_key = 'enable_negative_inventory'");
    const allowNegative = settings.rows[0]?.setting_value === 'true';

    let imported = 0;
    const errors: { row: number; message: string }[] = [];
    const warnings: { row: number; message: string }[] = [];
    const refNumber = 'BII-' + String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const processKey = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowNum = i + 2;
      try {
        const sku = getVal(row, skuIdx);
        const barcode = getVal(row, barcodeIdx);
        const name = getVal(row, nameIdx);
        const locationRaw = getVal(row, locIdx);
        const quantity = getNum(row, qtyIdx);
        const batch = getVal(row, batchIdx);
        const expiry = getVal(row, expIdx);
        const cost = getNum(row, costIdx);
        const remarks = getVal(row, remIdx);

        let product = sku ? productBySku.get(sku.toLowerCase()) : null;
        if (!product && barcode) product = productByBarcode.get(barcode.toLowerCase());
        if (!product && name) product = products.rows.find(p => p.name?.toLowerCase() === name.toLowerCase());
        if (!product) { errors.push({ row: rowNum, message: 'Product not found' }); continue; }

        const locId = locationRaw ? locMap.get(locationRaw.toLowerCase().trim()) : null;
        if (!locId) { errors.push({ row: rowNum, message: `Invalid location "${locationRaw}"` }); continue; }

        // Check negative
        if (quantity < 0 && !allowNegative) { errors.push({ row: rowNum, message: 'Negative stock not allowed' }); continue; }

        // Track duplicate product+location
        const pkey = `${product.id}|${locId}`;
        if (processKey.has(pkey)) {
          warnings.push({ row: rowNum, message: `Duplicate: ${product.name} (${product.sku}) at this location appears multiple times` });
        }
        processKey.add(pkey);

        // Get or create inventory record
        let inv = await client.query('SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2', [product.id, locId]);
        const oldQty = inv.rows.length > 0 ? parseFloat(inv.rows[0].quantity) : 0;
        const oldCost = inv.rows.length > 0 ? parseFloat(inv.rows[0].unit_cost) : 0;

        // Calculate new average cost
        const totalValue = (oldQty * oldCost) + (quantity * cost);
        const newQty = oldQty + quantity;
        const newAvgCost = newQty > 0 ? totalValue / newQty : cost;

        if (inv.rows.length > 0) {
          await client.query('UPDATE inventory SET quantity = $1, unit_cost = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [newQty, newAvgCost, inv.rows[0].id]);
        } else {
          await client.query('INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)', [product.id, locId, quantity, cost]);
        }

        // Create inventory ledger entry
        await client.query(
          `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [uuidv4(), product.id, locId, 'Bulk Import', quantity >= 0 ? 'IN' : 'OUT', Math.abs(quantity), newQty, cost, Math.abs(quantity) * cost, `Bulk Inventory Import: ${remarks || refNumber}`, req.user!.id]
        );

        // Create batch record if batch number provided
        if (batch) {
          const existingBatch = await client.query('SELECT id FROM batches WHERE product_id = $1 AND location_id = $2 AND batch_number = $3', [product.id, locId, batch]);
          if (existingBatch.rows.length > 0) {
            await client.query('UPDATE batches SET quantity = quantity + $1, expiry_date = COALESCE($2, expiry_date), updated_at = CURRENT_TIMESTAMP WHERE id = $3', [quantity, expiry || null, existingBatch.rows[0].id]);
          } else {
            await client.query(
              `INSERT INTO batches (id, product_id, location_id, batch_number, quantity, expiry_date, manufacturing_date, created_by)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [uuidv4(), product.id, locId, batch, quantity, expiry || null, null, req.user!.id]
            );
          }
        }

        imported++;
      } catch (err: any) {
        errors.push({ row: rowNum, message: err.message });
      }
    }

    await client.query('COMMIT');

    // Audit log
    await query(
      `INSERT INTO audit_logs (id, user_id, username, action, module, reference_type, new_values, created_at)
       VALUES ($1,$2,$3,'Import','Inventory','Bulk Inventory Import',$4,CURRENT_TIMESTAMP)`,
      [uuidv4(), req.user!.id, req.user!.username, JSON.stringify({ file: req.file.originalname, imported, errors: errors.length, reference: refNumber })]
    );

    res.json({ imported, errors, warnings, total: rawRows.length, reference: refNumber });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Export inventory
router.get('/export', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const format = (req.query.format as string) || 'csv';
    const location = (req.query.location as string) || '';
    const search = req.query.search as string || '';

    let where = 'WHERE p.is_active = true';
    const params: any[] = [];
    let idx = 1;
    if (search) { where += ` AND (p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    if (location) { where += ` AND i.location_id = $${idx}`; params.push(location); idx++; }

    const result = await query(
      `SELECT p.sku, p.name as product_name, p.barcode, l.name as location_name,
              i.quantity, p.unit_of_measure, i.unit_cost,
              COALESCE((SELECT b.batch_number FROM batches b WHERE b.product_id = p.id AND b.location_id = i.location_id AND b.quantity > 0 ORDER BY b.expiry_date ASC NULLS LAST LIMIT 1), '') as batch_number,
              COALESCE((SELECT b.expiry_date::text FROM batches b WHERE b.product_id = p.id AND b.location_id = i.location_id AND b.quantity > 0 ORDER BY b.expiry_date ASC NULLS LAST LIMIT 1), '') as expiry_date
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       JOIN locations l ON i.location_id = l.id
       ${where}
       ORDER BY p.name ASC`
    );

    const headerRow = ['SKU','Product Name','Barcode','Location','Quantity','Unit','Average Cost','Batch Number','Expiration Date'];
    const dataRows = result.rows.map((r: any) => [r.sku, r.product_name, r.barcode || '', r.location_name, r.quantity, r.unit_of_measure || '', r.unit_cost, r.batch_number, r.expiry_date]);

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
      XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=inventory.xlsx');
      res.send(buf);
    } else {
      const lines = dataRows.map(r => r.map(esc).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=inventory.csv');
      res.send('\uFEFF' + headerRow.map(esc).join(',') + '\r\n' + lines.join('\r\n'));
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
