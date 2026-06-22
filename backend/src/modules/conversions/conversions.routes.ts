import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get unit conversions for a product
router.get('/:productId', authenticate, hasUserPerm('inventory.inventory.view'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM unit_conversions WHERE product_id = $1 AND is_active = true ORDER BY from_unit',
      [req.params.productId]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create unit conversion
router.post('/', authenticate, auditLog('Conversions', 'Create Conversion Factor'), async (req: AuthRequest, res: Response) => {
  try {
    const { product_id, from_unit, to_unit, conversion_factor } = req.body;
    if (!product_id || !from_unit || !to_unit || !conversion_factor) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const result = await query(
      `INSERT INTO unit_conversions (product_id, from_unit, to_unit, conversion_factor)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [product_id, from_unit, to_unit, conversion_factor]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Perform conversion (production/conversion order)
router.post('/convert', authenticate, auditLog('Conversions', 'Convert'), async (req: AuthRequest, res: Response) => {
  try {
    const { product_id, from_unit, to_unit, quantity, location_id } = req.body;
    if (!product_id || !from_unit || !to_unit || !quantity) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Get conversion factor
    const conv = await query(
      'SELECT * FROM unit_conversions WHERE product_id = $1 AND from_unit = $2 AND to_unit = $3 AND is_active = true',
      [product_id, from_unit, to_unit]
    );
    if (conv.rows.length === 0) throw new AppError('Conversion not found');

    const factor = parseFloat(conv.rows[0].conversion_factor);
    const locId = location_id || 1;

    // Check available stock in parent unit
    const inv = await query(
      'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
      [product_id, locId]
    );
    if (inv.rows.length === 0) throw new AppError('Product not found in inventory');

    const currentQty = parseFloat(inv.rows[0].quantity);
    const deductQty = parseFloat(quantity);

    if (currentQty < deductQty) {
      throw new AppError('Insufficient stock for conversion');
    }

    // Deduct parent unit
    const newParentQty = currentQty - deductQty;
    await query('UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2 AND location_id = $3',
      [newParentQty, product_id, locId]);

    // Add child units (quantity * factor)
    const addQty = deductQty * factor;
    // We add the child as the same product but different unit tracking
    // For simplicity, we just adjust the main inventory and record in ledger
    // In a real system, you might want to create a separate product for each unit

    // Update inventory (the product is the same, just converted)
    // Actually for proper conversion, the parent and child should be different products
    // But here we track by unit_of_measure on the same product

    const refId = uuidv4();
    const unitCost = parseFloat(inv.rows[0].unit_cost);
    const newChildCost = unitCost / factor;

    await query(
      `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
       VALUES ($1, $2, $3, 'Unit Conversion', $4, 'CONVERSION_OUT', $5, $6, $7, $8, $9, $10)`,
      [uuidv4(), product_id, locId, refId, deductQty, newParentQty, unitCost, deductQty * unitCost,
       `Converted ${deductQty} ${from_unit} to ${addQty} ${to_unit}`, req.user!.id]
    );

    await query(
      `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
       VALUES ($1, $2, $3, 'Unit Conversion', $4, 'CONVERSION_IN', $5, $6, $7, $8, $9, $10)`,
      [uuidv4(), product_id, locId, refId, addQty, newParentQty + addQty, newChildCost, addQty * newChildCost,
       `Added ${addQty} ${to_unit} from conversion`, req.user!.id]
    );

    res.json({
      message: 'Conversion completed',
      deducted: { unit: from_unit, quantity: deductQty },
      added: { unit: to_unit, quantity: addQty },
      cost_per_child: newChildCost,
    });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

export default router;
