import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditLog } from '../../middleware/audit';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM brands WHERE is_active = true ORDER BY name');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM brands ORDER BY name');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, hasUserPerm('inventory.inventory.edit'), auditLog('Brands', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Brand name is required' });

    const existing = await query('SELECT id FROM brands WHERE LOWER(name) = LOWER($1)', [name]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Brand name already exists' });

    const result = await query('INSERT INTO brands (name, description) VALUES ($1, $2) RETURNING *', [name, description]);
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, hasUserPerm('inventory.inventory.edit'), auditLog('Brands', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, is_active } = req.body;
    if (name) {
      const dup = await query('SELECT id FROM brands WHERE LOWER(name) = LOWER($1) AND id != $2', [name, req.params.id]);
      if (dup.rows.length > 0) return res.status(400).json({ error: 'Brand name already exists' });
    }
    const result = await query(
      'UPDATE brands SET name = COALESCE($1, name), description = COALESCE($2, description), is_active = COALESCE($3, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [name, description, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Brand not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, hasUserPerm('inventory.inventory.edit'), auditLog('Brands', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const prodCheck = await query('SELECT COUNT(*) as count FROM products WHERE brand_id = $1 AND is_active = true', [id]);
    if (parseInt(prodCheck.rows[0].count) > 0) {
      throw new AppError('Cannot delete brand: active products are referencing it', 409);
    }

    const result = await query(
      'UPDATE brands SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Brand not found' });
    res.json({ message: 'Brand deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
