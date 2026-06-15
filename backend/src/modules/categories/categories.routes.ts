import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditLog } from '../../middleware/audit';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id AND is_active = true) as product_count FROM categories c WHERE c.is_active = true ORDER BY c.name'
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      'SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id) as product_count FROM categories c ORDER BY c.name'
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, auditLog('Categories', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name is required' });

    const existing = await query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [name]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Category name already exists' });

    const result = await query(
      'INSERT INTO categories (name, description, parent_id) VALUES ($1, $2, $3) RETURNING *',
      [name, description, parent_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, auditLog('Categories', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, parent_id, is_active } = req.body;
    if (name) {
      const dup = await query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND id != $2', [name, req.params.id]);
      if (dup.rows.length > 0) return res.status(400).json({ error: 'Category name already exists' });
    }
    const result = await query(
      'UPDATE categories SET name = COALESCE($1, name), description = COALESCE($2, description), parent_id = COALESCE($3, parent_id), is_active = COALESCE($4, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = $5 RETURNING *',
      [name, description, parent_id, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, auditLog('Categories', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const prodCheck = await query('SELECT COUNT(*) as count FROM products WHERE category_id = $1 AND is_active = true', [id]);
    if (parseInt(prodCheck.rows[0].count) > 0) {
      throw new AppError('Cannot delete category: active products are referencing it', 409);
    }

    const result = await query(
      'UPDATE categories SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ message: 'Category deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
