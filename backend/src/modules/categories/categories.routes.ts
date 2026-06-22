import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditLog } from '../../middleware/audit';
import { DEFAULT_COGS_ACCOUNT, DEFAULT_REVENUE_ACCOUNT } from '../../utils/categoryGlPosting';

const router = Router();

const validateAccountCode = async (code: string | null | undefined, types: string[], label: string) => {
  if (!code) return null;
  const result = await query(
    'SELECT account_code FROM chart_of_accounts WHERE account_code = $1 AND account_type = ANY($2::text[]) AND is_active = true',
    [code, types],
  );
  if (result.rows.length === 0) {
    throw new AppError(`Invalid ${label}: account ${code} not found or wrong type`, 400);
  }
  return code;
};

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT c.*,
              rev.account_name AS revenue_account_name,
              cogs.account_name AS cogs_account_name,
              (SELECT COUNT(*) FROM products WHERE category_id = c.id AND is_active = true) AS product_count
       FROM categories c
       LEFT JOIN chart_of_accounts rev ON rev.account_code = c.revenue_account_code
       LEFT JOIN chart_of_accounts cogs ON cogs.account_code = c.cogs_account_code
       WHERE c.is_active = true
       ORDER BY c.name`,
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/all', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT c.*,
              rev.account_name AS revenue_account_name,
              cogs.account_name AS cogs_account_name,
              (SELECT COUNT(*) FROM products WHERE category_id = c.id) AS product_count
       FROM categories c
       LEFT JOIN chart_of_accounts rev ON rev.account_code = c.revenue_account_code
       LEFT JOIN chart_of_accounts cogs ON cogs.account_code = c.cogs_account_code
       ORDER BY c.name`,
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/gl-account-options', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const revenue = await query(
      `SELECT account_code, account_name FROM chart_of_accounts
       WHERE is_active = true AND account_type = 'Income'
       ORDER BY account_code`,
    );
    const cogs = await query(
      `SELECT account_code, account_name FROM chart_of_accounts
       WHERE is_active = true AND account_type = 'Cost of Goods Sold'
       ORDER BY account_code`,
    );
    res.json({ revenue: revenue.rows, cogs: cogs.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, hasUserPerm('inventory.inventory.edit'), auditLog('Categories', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, parent_id, revenue_account_code, cogs_account_code } = req.body;
    if (!name) return res.status(400).json({ error: 'Category name is required' });

    const existing = await query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [name]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Category name already exists' });

    const revenueCode = await validateAccountCode(revenue_account_code || DEFAULT_REVENUE_ACCOUNT, ['Income'], 'sales account');
    const cogsCode = await validateAccountCode(cogs_account_code || DEFAULT_COGS_ACCOUNT, ['Cost of Goods Sold'], 'cost account');

    const result = await query(
      `INSERT INTO categories (name, description, parent_id, revenue_account_code, cogs_account_code)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, description, parent_id, revenueCode, cogsCode],
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, hasUserPerm('inventory.inventory.edit'), auditLog('Categories', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, parent_id, is_active, revenue_account_code, cogs_account_code } = req.body;
    if (name) {
      const dup = await query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1) AND id != $2', [name, req.params.id]);
      if (dup.rows.length > 0) return res.status(400).json({ error: 'Category name already exists' });
    }

    let revenueCode: string | undefined;
    let cogsCode: string | undefined;
    if (revenue_account_code !== undefined) {
      revenueCode = (await validateAccountCode(revenue_account_code || DEFAULT_REVENUE_ACCOUNT, ['Income'], 'sales account'))!;
    }
    if (cogs_account_code !== undefined) {
      cogsCode = (await validateAccountCode(cogs_account_code || DEFAULT_COGS_ACCOUNT, ['Cost of Goods Sold'], 'cost account'))!;
    }

    const result = await query(
      `UPDATE categories SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         parent_id = COALESCE($3, parent_id),
         is_active = COALESCE($4, is_active),
         revenue_account_code = COALESCE($5, revenue_account_code),
         cogs_account_code = COALESCE($6, cogs_account_code),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 RETURNING *`,
      [name, description, parent_id, is_active, revenueCode, cogsCode, req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, hasUserPerm('inventory.inventory.edit'), auditLog('Categories', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const prodCheck = await query('SELECT COUNT(*) as count FROM products WHERE category_id = $1 AND is_active = true', [id]);
    if (parseInt(prodCheck.rows[0].count) > 0) {
      throw new AppError('Cannot delete category: active products are referencing it', 409);
    }

    const result = await query(
      'UPDATE categories SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING *',
      [id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ message: 'Category deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
