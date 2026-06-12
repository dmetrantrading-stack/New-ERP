import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const generateCountNumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(count_number, 4) AS INTEGER)), 0) + 1 as next FROM inventory_counts WHERE count_number ~ '^IC-'");
  return `IC-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const countResult = await query('SELECT COUNT(*) FROM inventory_counts');
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT ic.*, l.name as location_name, u.full_name as created_by_name,
              (SELECT COUNT(*) FROM inventory_count_items ici WHERE ici.count_id = ic.id) as items_count
       FROM inventory_counts ic
       LEFT JOIN locations l ON ic.location_id = l.id
       LEFT JOIN users u ON ic.created_by = u.id
       ORDER BY ic.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
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

router.post('/', authenticate, auditLog('Inventory Count', 'Create'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { location_id, items, notes, count_date } = req.body;
    if (!items || items.length === 0) throw new AppError('At least one item is required');

    const id = uuidv4();
    const countNumber = await generateCountNumber();

    await client.query(
      `INSERT INTO inventory_counts (id, count_number, location_id, count_date, status, notes, created_by)
       VALUES ($1, $2, $3, $4, 'Draft', $5, $6)`,
      [id, countNumber, location_id, count_date || new Date(), notes, req.user!.id]
    );

    for (const item of items) {
      const inv = await client.query(
        'SELECT quantity, unit_cost FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, location_id]
      );
      const systemQty = inv.rows.length > 0 ? parseFloat(inv.rows[0].quantity) : 0;
      const actualQty = parseFloat(item.actual_qty);
      const variance = actualQty - systemQty;

      await client.query(
        `INSERT INTO inventory_count_items (id, count_id, product_id, system_qty, actual_qty, variance, unit_cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uuidv4(), id, item.product_id, systemQty, actualQty, variance, inv.rows[0]?.unit_cost || 0]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id, count_number: countNumber });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const count = await query(
      `SELECT ic.*, l.name as location_name, u.full_name as created_by_name,
              up.full_name as posted_by_name
       FROM inventory_counts ic
       LEFT JOIN locations l ON ic.location_id = l.id
       LEFT JOIN users u ON ic.created_by = u.id
       LEFT JOIN users up ON ic.posted_by = up.id
       WHERE ic.id = $1`,
      [req.params.id]
    );
    if (count.rows.length === 0) return res.status(404).json({ error: 'Count not found' });

    const items = await query(
      `SELECT ici.*, p.sku, p.name as product_name, p.unit_of_measure
       FROM inventory_count_items ici
       JOIN products p ON ici.product_id = p.id
       WHERE ici.count_id = $1
       ORDER BY p.name ASC`,
      [req.params.id]
    );

    res.json({ ...count.rows[0], items: items.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id', authenticate, auditLog('Inventory Count', 'Update'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    const existing = await client.query('SELECT * FROM inventory_counts WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Count not found' });
    if (existing.rows[0].status !== 'Draft') throw new AppError('Only draft counts can be updated');

    await client.query('BEGIN');

    const { notes, count_date } = req.body;
    await client.query(
      'UPDATE inventory_counts SET notes = COALESCE($1, notes), count_date = COALESCE($2, count_date), updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [notes || null, count_date || null, req.params.id]
    );

    const { items } = req.body;
    if (items && items.length > 0) {
      await client.query('DELETE FROM inventory_count_items WHERE count_id = $1', [req.params.id]);
      for (const item of items) {
        const inv = await client.query(
          'SELECT quantity, unit_cost FROM inventory WHERE product_id = $1 AND location_id = $2',
          [item.product_id, existing.rows[0].location_id]
        );
        const systemQty = inv.rows.length > 0 ? parseFloat(inv.rows[0].quantity) : 0;
        const actualQty = parseFloat(item.actual_qty);
        const variance = actualQty - systemQty;

        await client.query(
          `INSERT INTO inventory_count_items (id, count_id, product_id, system_qty, actual_qty, variance, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uuidv4(), req.params.id, item.product_id, systemQty, actualQty, variance, inv.rows[0]?.unit_cost || 0]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'Count updated' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.post('/:id/post', authenticate, auditLog('Inventory Count', 'Post'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    const existing = await client.query('SELECT * FROM inventory_counts WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Count not found' });
    if (existing.rows[0].status !== 'Draft') throw new AppError('Count is already posted');

    await client.query('BEGIN');

    const count = existing.rows[0];
    const items = await client.query(
      'SELECT * FROM inventory_count_items WHERE count_id = $1',
      [req.params.id]
    );

    for (const item of items.rows) {
      const newQty = parseFloat(item.actual_qty);
      const diffQty = newQty - parseFloat(item.system_qty);

      const inventory = await client.query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, count.location_id]
      );

      if (inventory.rows.length > 0) {
        await client.query(
          'UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          [newQty, inventory.rows[0].id]
        );
      } else {
        await client.query(
          'INSERT INTO inventory (id, product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4, $5)',
          [uuidv4(), item.product_id, count.location_id, newQty, item.unit_cost]
        );
      }

      if (diffQty !== 0) {
        await client.query(
          `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, unit_cost, running_quantity, notes, created_by)
           VALUES ($1, $2, $3, 'Inventory Count', $4, 'ADJUSTMENT', $5, $6, $7, $8, $9)`,
          [uuidv4(), item.product_id, count.location_id, req.params.id, Math.abs(diffQty), item.unit_cost, newQty,
           `Count adjustment: system ${item.system_qty}, actual ${item.actual_qty}`, req.user!.id]
        );
      }
    }

    await client.query(
      `UPDATE inventory_counts SET status = 'Posted', posted_by = $1, posted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [req.user!.id, req.params.id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Count posted' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', authenticate, auditLog('Inventory Count', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT * FROM inventory_counts WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Count not found' });
    if (existing.rows[0].status !== 'Draft') throw new AppError('Only draft counts can be deleted');

    await query('DELETE FROM inventory_counts WHERE id = $1', [req.params.id]);
    res.json({ message: 'Count deleted' });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

export default router;
