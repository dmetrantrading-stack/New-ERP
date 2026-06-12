import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

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
       LEFT JOIN inventory i2 ON p.id = i2.product_id AND i.location_id = 2
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

// Search products (for POS/autocomplete)
router.get('/search/quick', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const search = req.query.q as string || '';
    const location_id = req.query.location_id || 1;

    const result = await query(
      `SELECT p.id, p.sku, p.name, p.barcode, p.retail_price, p.wholesale_price,
              p.distributor_price, p.unit_of_measure, p.cost, p.tax_type, p.has_chilled_variant, p.chilled_price,
              COALESCE(i.quantity, 0) as stock, COALESCE(i.available_quantity, 0) as available_stock,
              c.name as category_name, p.has_variants,
              COALESCE(
                (SELECT json_agg(json_build_object('id', pv.id, 'name', pv.name, 'retail_price', pv.retail_price, 'additional_cost', pv.additional_cost))
                 FROM product_variants pv WHERE pv.product_id = p.id AND pv.is_active = true),
                '[]'::json
              ) as variants
       FROM products p
       LEFT JOIN inventory i ON p.id = i.product_id AND i.location_id = $2
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true
         AND (p.name ILIKE $1 OR p.sku ILIKE $1 OR p.barcode ILIKE $1)
       ORDER BY p.name ASC
       LIMIT 20`,
      [`%${search}%`, location_id]
    );
    res.json(result.rows);
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

// Import products
router.post('/import', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { products } = req.body;
    let imported = 0;
    let errors: string[] = [];

    for (const product of products) {
      try {
        if (!product.name) {
          errors.push(`Row ${imported + 1}: Product name is required`);
          continue;
        }
        const sku = await generateSKU();
        const id = uuidv4();

        await query(
          `INSERT INTO products (id, sku, name, barcode, category_id, brand_id, cost,
            retail_price, wholesale_price, distributor_price, reorder_level, tax_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [id, sku, product.name, product.barcode, product.category_id, product.brand_id,
            product.cost || 0, product.retail_price || 0, product.wholesale_price || 0,
            product.distributor_price || 0, product.reorder_level || 0, product.tax_type || 'VAT']
        );

        const locations = await query('SELECT id FROM locations WHERE is_active = true');
        for (const loc of locations.rows) {
          await query(
            'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, 0, $3) ON CONFLICT (product_id, location_id) DO NOTHING',
            [id, loc.id, product.cost || 0]
          );
        }
        imported++;
      } catch (err: any) {
        errors.push(`Row ${imported + 1}: ${err.message}`);
      }
    }

    res.json({ imported, errors, total: products.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Export products
router.get('/export/csv', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT p.sku, p.name, p.barcode, c.name as category, p.cost,
              p.retail_price, p.wholesale_price, p.distributor_price, p.reorder_level
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.is_active = true
       ORDER BY p.name`
    );

    const csv = [
      'SKU,Name,Barcode,Category,Cost,Retail Price,Wholesale Price,Distributor Price,Reorder Level',
      ...result.rows.map((r: any) =>
        `${r.sku},"${r.name}",${r.barcode || ''},${r.category || ''},${r.cost},${r.retail_price},${r.wholesale_price},${r.distributor_price},${r.reorder_level}`
      ),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete product
router.delete('/:id', authenticate, authorize('Admin'), auditLog('Products', 'Delete'), async (req: AuthRequest, res: Response) => {
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
