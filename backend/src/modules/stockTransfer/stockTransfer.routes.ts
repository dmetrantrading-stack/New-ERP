import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const generateRefNumber = async (): Promise<string> => {
  const result = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(transfer_number, 4) AS INTEGER)), 0) + 1 as next FROM stock_transfers WHERE transfer_number ~ '^ST-'");
  return `ST-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
};

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT st.*, sl.name as source_location, dl.name as destination_location, u.full_name as created_by_name
       FROM stock_transfers st
       LEFT JOIN locations sl ON st.source_location_id = sl.id
       LEFT JOIN locations dl ON st.destination_location_id = dl.id
       LEFT JOIN users u ON st.created_by = u.id
       ORDER BY st.created_at DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, auditLog('Stock Transfer', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const transfer_number = await generateRefNumber();
    const { source_location_id, destination_location_id, items, notes } = req.body;
    const id = uuidv4();

    if (source_location_id === destination_location_id) {
      throw new AppError('Source and destination cannot be the same');
    }

    await query(
      `INSERT INTO stock_transfers (id, transfer_number, source_location_id, destination_location_id, status, notes, created_by)
       VALUES ($1, $2, $3, $4, 'Draft', $5, $6)`,
      [id, transfer_number, source_location_id, destination_location_id, notes, req.user!.id]
    );

    for (const item of items || []) {
      // Check available stock
      const inv = await query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, source_location_id]
      );
      if (inv.rows.length === 0 || parseFloat(inv.rows[0].quantity) < parseFloat(item.quantity)) {
        throw new AppError(`Insufficient stock for product ${item.product_id}`);
      }

      // Get batch info (FIFO - use oldest batches first)
      const batches = await query(
        `SELECT * FROM batches WHERE product_id = $1 AND location_id = $2 AND quantity > 0 ORDER BY expiry_date ASC NULLS LAST, created_at ASC`,
        [item.product_id, source_location_id]
      );

      let remainingQty = parseFloat(item.quantity);
      let totalCost = 0;

      for (const batch of batches.rows) {
        if (remainingQty <= 0) break;
        const batchQty = Math.min(remainingQty, parseFloat(batch.quantity));
        totalCost += batchQty * parseFloat(batch.unit_cost);
        remainingQty -= batchQty;
      }

      const avgCost = totalCost / parseFloat(item.quantity) || 0;

      await query(
        `INSERT INTO stock_transfer_items (id, transfer_id, product_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), id, item.product_id, item.quantity, avgCost]
      );
    }

    res.status(201).json({ id, transfer_number });
  } catch (error: any) {
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  }
});

// Send transfer
router.patch('/:id/send', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const transfer = await query('SELECT * FROM stock_transfers WHERE id = $1', [req.params.id]);
    if (transfer.rows.length === 0) return res.status(404).json({ error: 'Transfer not found' });

    const items = await query('SELECT * FROM stock_transfer_items WHERE transfer_id = $1', [req.params.id]);

    for (const item of items.rows) {
      const sourceInv = await query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, transfer.rows[0].source_location_id]
      );

      if (sourceInv.rows.length > 0) {
        const newQty = parseFloat(sourceInv.rows[0].quantity) - parseFloat(item.quantity);
        if (newQty < 0) throw new AppError('Negative inventory not allowed');
        await query('UPDATE inventory SET quantity = $1 WHERE id = $2', [newQty, sourceInv.rows[0].id]);
      }

      // Inventory ledger for source
      await query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, created_by)
         VALUES ($1, $2, $3, 'Stock Transfer', $4, 'TRANSFER_OUT', $5, $6)`,
        [uuidv4(), item.product_id, transfer.rows[0].source_location_id, req.params.id, item.quantity, req.user!.id]
      );
    }

    await query("UPDATE stock_transfers SET status = 'Sent', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
    res.json({ message: 'Transfer sent' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Receive transfer
router.patch('/:id/receive', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const transfer = await query('SELECT * FROM stock_transfers WHERE id = $1', [req.params.id]);
    if (transfer.rows.length === 0) return res.status(404).json({ error: 'Transfer not found' });

    const items = await query('SELECT * FROM stock_transfer_items WHERE transfer_id = $1', [req.params.id]);

    for (const item of items.rows) {
      const destInv = await query(
        'SELECT * FROM inventory WHERE product_id = $1 AND location_id = $2',
        [item.product_id, transfer.rows[0].destination_location_id]
      );

      if (destInv.rows.length > 0) {
        const newQty = parseFloat(destInv.rows[0].quantity) + parseFloat(item.quantity);
        await query('UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newQty, destInv.rows[0].id]);
      } else {
        await query(
          'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)',
          [item.product_id, transfer.rows[0].destination_location_id, item.quantity, item.unit_cost]
        );
      }

      // Inventory ledger for destination
      await query(
        `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, reference_id, transaction_type, quantity, unit_cost, created_by)
         VALUES ($1, $2, $3, 'Stock Transfer', $4, 'TRANSFER_IN', $5, $6, $7)`,
        [uuidv4(), item.product_id, transfer.rows[0].destination_location_id, req.params.id, item.quantity, item.unit_cost, req.user!.id]
      );
    }

    await query(
      "UPDATE stock_transfers SET status = 'Received', received_at = CURRENT_TIMESTAMP, received_by = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      [req.user!.id, req.params.id]
    );

    res.json({ message: 'Transfer received' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel transfer
router.patch('/:id/cancel', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const existing = await query('SELECT id FROM stock_transfers WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'Transfer not found' });
    await query("UPDATE stock_transfers SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [req.params.id]);
    res.json({ message: 'Transfer cancelled' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
