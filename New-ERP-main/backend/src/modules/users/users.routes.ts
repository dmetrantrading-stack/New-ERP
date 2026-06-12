import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, authorize } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const router = Router();

router.get('/', authenticate, authorize('Admin', 'Owner'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role_id, r.name as role_name, u.phone, u.is_active, u.last_login, u.created_at
       FROM users u JOIN roles r ON u.role_id = r.id ORDER BY u.full_name`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, authorize('Admin'), auditLog('Users', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const { username, password, email, full_name, role_id, phone } = req.body;
    if (!username || !password || !full_name) return res.status(400).json({ error: 'Username, password, and full name are required' });

    const existing = await query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await query(
      'INSERT INTO users (id, username, password_hash, email, full_name, role_id, phone) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, username, passwordHash, email, full_name, role_id, phone]
    );

    res.status(201).json({ id, username, email, full_name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, authorize('Admin'), auditLog('Users', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const { email, full_name, role_id, phone, is_active, password } = req.body;
    let passwordHash: string | undefined;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }
    const result = await query(
      `UPDATE users SET email = COALESCE($1, email), full_name = COALESCE($2, full_name),
        role_id = COALESCE($3, role_id), phone = COALESCE($4, phone),
        is_active = COALESCE($5, is_active),
        password_hash = COALESCE($6, password_hash),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $7 RETURNING id, username, email, full_name`,
      [email, full_name, role_id, phone, is_active, passwordHash || null, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Roles
router.get('/roles', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM roles ORDER BY name');
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, authorize('Admin'), auditLog('Users', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (req.user!.id === id) {
      throw new AppError('Cannot delete your own account', 400);
    }

    const result = await query(
      'UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING id, username, email, full_name',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
