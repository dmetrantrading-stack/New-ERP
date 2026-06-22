import { Router, Response } from 'express';
import { query, getClient } from '../../config/database';
import { authenticate, hasUserPerm, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const bomView = hasUserPerm('inventory.production.view');
const bomCreate = hasUserPerm('inventory.production.create');

const generateBomCode = async (): Promise<string> => {
  const r = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(bom_code, 5) AS INTEGER)), 0) + 1 as next
     FROM production_boms WHERE bom_code ~ '^BOM-'`
  );
  return `BOM-${String(r.rows[0]?.next || 1).padStart(4, '0')}`;
};

router.get('/', authenticate, bomView, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT b.*, p.name as output_product_name, p.sku as output_sku,
              (SELECT COUNT(*) FROM production_bom_lines WHERE bom_id = b.id AND line_type = 'Input') as input_count
       FROM production_boms b
       LEFT JOIN products p ON b.output_product_id = p.id
       WHERE ($1 = 'all' OR b.is_active = true)
       ORDER BY b.name`,
      [req.query.include_inactive === 'true' ? 'all' : 'active']
    );
    res.json(r.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/load', authenticate, bomView, async (req: AuthRequest, res: Response) => {
  try {
    const multiplier = parseFloat(req.query.qty as string) || 1;
    const bom = await query('SELECT * FROM production_boms WHERE id = $1', [req.params.id]);
    if (bom.rows.length === 0) return res.status(404).json({ error: 'BOM not found' });
    const b = bom.rows[0];
    const baseOut = parseFloat(b.output_qty) || 1;
    const factor = multiplier / baseOut;

    const lines = await query(
      `SELECT bl.*, p.name as product_name, p.sku, p.unit_of_measure as product_uom, p.cost
       FROM production_bom_lines bl
       LEFT JOIN products p ON bl.product_id = p.id
       WHERE bl.bom_id = $1`,
      [req.params.id]
    );

    const inputs = lines.rows.filter((l: any) => l.line_type === 'Input').map((l: any) => ({
      product_id: l.product_id,
      product_name: l.product_name,
      sku: l.sku,
      uom: l.uom || l.product_uom || 'pcs',
      quantity: parseFloat(l.quantity) * factor,
      unit_cost: parseFloat(l.cost || 0),
    }));
    const outputs = lines.rows.filter((l: any) => l.line_type === 'Output').map((l: any) => ({
      product_id: l.product_id,
      product_name: l.product_name,
      sku: l.sku,
      uom: l.uom || l.product_uom || 'pcs',
      quantity: parseFloat(l.quantity) * factor,
      unit_cost: 0,
    }));

    res.json({ bom: b, multiplier, inputs, outputs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, bomView, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query(
      `SELECT b.*, p.name as output_product_name, p.sku as output_sku
       FROM production_boms b
       LEFT JOIN products p ON b.output_product_id = p.id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'BOM not found' });
    const lines = await query(
      `SELECT bl.*, p.name as product_name, p.sku, p.unit_of_measure as product_uom, p.cost
       FROM production_bom_lines bl
       LEFT JOIN products p ON bl.product_id = p.id
       WHERE bl.bom_id = $1
       ORDER BY bl.line_type, p.name`,
      [req.params.id]
    );
    res.json({ ...r.rows[0], lines: lines.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, bomCreate, auditLog('Production', 'Create BOM'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    const { name, output_product_id, output_qty, notes, inputs, outputs } = req.body;
    if (!name) throw new AppError('BOM name is required');
    if (!inputs?.length) throw new AppError('At least one input line is required');
    if (!outputs?.length && !output_product_id) throw new AppError('Define output product or output lines');

    await client.query('BEGIN');
    const bom_code = await generateBomCode();
    const id = uuidv4();
    const outProd = output_product_id || outputs[0]?.product_id;
    const outQty = parseFloat(output_qty || outputs[0]?.quantity || 1);

    await client.query(
      `INSERT INTO production_boms (id, bom_code, name, output_product_id, output_qty, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, bom_code, name, outProd, outQty, notes || null, req.user!.id]
    );

    for (const inp of inputs) {
      if (!inp.product_id) throw new AppError('Input product required');
      await client.query(
        `INSERT INTO production_bom_lines (id, bom_id, line_type, product_id, quantity, uom)
         VALUES ($1, $2, 'Input', $3, $4, $5)`,
        [uuidv4(), id, inp.product_id, inp.quantity || 1, inp.uom || null]
      );
    }
    const outLines = outputs?.length ? outputs : [{ product_id: outProd, quantity: outQty, uom: null }];
    for (const out of outLines) {
      if (!out.product_id) continue;
      await client.query(
        `INSERT INTO production_bom_lines (id, bom_id, line_type, product_id, quantity, uom)
         VALUES ($1, $2, 'Output', $3, $4, $5)`,
        [uuidv4(), id, out.product_id, out.quantity || outQty, out.uom || null]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id, bom_code });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

router.put('/:id', authenticate, bomCreate, auditLog('Production', 'Update BOM'), async (req: AuthRequest, res: Response) => {
  const client = await getClient();
  try {
    const { name, output_product_id, output_qty, notes, is_active, inputs, outputs } = req.body;
    const existing = await client.query('SELECT id FROM production_boms WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) throw new AppError('BOM not found', 404);

    await client.query('BEGIN');
    await client.query(
      `UPDATE production_boms SET name = COALESCE($1, name), output_product_id = COALESCE($2, output_product_id),
       output_qty = COALESCE($3, output_qty), notes = COALESCE($4, notes), is_active = COALESCE($5, is_active)
       WHERE id = $6`,
      [name, output_product_id, output_qty, notes, is_active, req.params.id]
    );

    if (inputs || outputs) {
      await client.query('DELETE FROM production_bom_lines WHERE bom_id = $1', [req.params.id]);
      for (const inp of inputs || []) {
        await client.query(
          `INSERT INTO production_bom_lines (id, bom_id, line_type, product_id, quantity, uom)
           VALUES ($1, $2, 'Input', $3, $4, $5)`,
          [uuidv4(), req.params.id, inp.product_id, inp.quantity || 1, inp.uom || null]
        );
      }
      for (const out of outputs || []) {
        await client.query(
          `INSERT INTO production_bom_lines (id, bom_id, line_type, product_id, quantity, uom)
           VALUES ($1, $2, 'Output', $3, $4, $5)`,
          [uuidv4(), req.params.id, out.product_id, out.quantity || 1, out.uom || null]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ message: 'BOM updated' });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(error instanceof AppError ? error.statusCode : 500).json({ error: error.message });
  } finally {
    client.release();
  }
});

export default router;
