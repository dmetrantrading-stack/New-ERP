import { v4 as uuidv4 } from 'uuid';

type DbClient = { query: (text: string, params?: any[]) => Promise<any> };

export interface FefoDeductOptions {
  product_id: string;
  location_id: number;
  quantity: number;
  reference_type: string;
  reference_id: string;
  created_by: string;
  notes?: string | null;
}

export interface FefoDeductResult {
  totalCost: number;
  unitCost: number;
  runningQuantity: number;
}

/** Deduct stock using FEFO batch order (expiry first), then fall back to inventory avg cost. */
export async function deductInventoryFefo(
  db: DbClient,
  opts: FefoDeductOptions,
): Promise<FefoDeductResult> {
  const qty = parseFloat(String(opts.quantity));
  if (qty <= 0) return { totalCost: 0, unitCost: 0, runningQuantity: 0 };

  const inv = await db.query(
    'SELECT id, quantity, unit_cost FROM inventory WHERE product_id = $1 AND location_id = $2',
    [opts.product_id, opts.location_id],
  );
  const availableQty = inv.rows[0] ? parseFloat(inv.rows[0].quantity) : 0;
  const fallbackCost = inv.rows[0] ? parseFloat(inv.rows[0].unit_cost) : 0;

  const batches = await db.query(
    `SELECT id, quantity, unit_cost FROM batches
     WHERE product_id = $1 AND location_id = $2 AND quantity > 0
     ORDER BY expiry_date ASC NULLS LAST, created_at ASC`,
    [opts.product_id, opts.location_id],
  );

  const allocations: Array<{ batch_id: string | null; quantity: number; unit_cost: number }> = [];
  let remaining = qty;

  for (const batch of batches.rows) {
    if (remaining <= 0) break;
    const batchQty = parseFloat(batch.quantity);
    const take = Math.min(remaining, batchQty);
    if (take <= 0) continue;
    const unitCost = parseFloat(batch.unit_cost || fallbackCost || 0);
    allocations.push({ batch_id: batch.id, quantity: take, unit_cost: unitCost });
    remaining -= take;
    await db.query(
      'UPDATE batches SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [take, batch.id],
    );
  }

  if (remaining > 0) {
    allocations.push({ batch_id: null, quantity: remaining, unit_cost: fallbackCost });
  }

  const totalCost = allocations.reduce((s, a) => s + a.quantity * a.unit_cost, 0);
  const newQty = Math.max(0, availableQty - qty);

  if (inv.rows.length > 0) {
    await db.query(
      'UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [newQty, inv.rows[0].id],
    );
  }

  for (const alloc of allocations) {
    await db.query(
      `INSERT INTO inventory_ledger (id, product_id, location_id, batch_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'OUT',$7,$8,$9,$10,$11,$12)`,
      [
        uuidv4(), opts.product_id, opts.location_id, alloc.batch_id,
        opts.reference_type, opts.reference_id, alloc.quantity, newQty,
        alloc.unit_cost, alloc.quantity * alloc.unit_cost,
        opts.notes || null, opts.created_by,
      ],
    );
  }

  const unitCost = qty > 0 ? Math.round((totalCost / qty) * 100) / 100 : fallbackCost;
  return {
    totalCost: Math.round(totalCost * 100) / 100,
    unitCost,
    runningQuantity: newQty,
  };
}

/** Restore stock from prior OUT ledger rows (e.g. DR cancel). */
export async function restoreInventoryFromLedger(
  db: DbClient,
  opts: {
    reference_type: string;
    reference_id: string;
    restore_reference_type: string;
    created_by: string;
    notes?: string;
  },
): Promise<void> {
  const rows = await db.query(
    `SELECT product_id, location_id, batch_id, quantity, unit_cost
     FROM inventory_ledger
     WHERE reference_type = $1 AND reference_id = $2 AND transaction_type = 'OUT'`,
    [opts.reference_type, opts.reference_id],
  );

  for (const row of rows.rows) {
    const qty = parseFloat(row.quantity);
    const locId = row.location_id || 1;

    if (row.batch_id) {
      await db.query(
        'UPDATE batches SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [qty, row.batch_id],
      );
    }

    const inv = await db.query(
      'SELECT id, quantity FROM inventory WHERE product_id = $1 AND location_id = $2',
      [row.product_id, locId],
    );
    let runningQty = qty;
    if (inv.rows.length > 0) {
      runningQty = parseFloat(inv.rows[0].quantity) + qty;
      await db.query('UPDATE inventory SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [runningQty, inv.rows[0].id]);
    } else {
      await db.query(
        'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)',
        [row.product_id, locId, qty, row.unit_cost || 0],
      );
    }

    await db.query(
      `INSERT INTO inventory_ledger (id, product_id, location_id, batch_id, reference_type, reference_id, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'IN',$7,$8,$9,$10,$11,$12)`,
      [
        uuidv4(), row.product_id, locId, row.batch_id,
        opts.restore_reference_type, opts.reference_id, qty, runningQty,
        row.unit_cost || 0, qty * parseFloat(row.unit_cost || 0),
        opts.notes || 'Inventory restored', opts.created_by,
      ],
    );
  }
}
