import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

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

export default router;
