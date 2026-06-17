import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditLog } from '../../middleware/audit';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
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

router.post('/', authenticate, auditLog('Users', 'Create'), async (req: AuthRequest, res: Response) => {
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

router.put('/:id', authenticate, auditLog('Users', 'Update'), async (req: AuthRequest, res: Response) => {
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

router.delete('/:id', authenticate, auditLog('Users', 'Delete'), async (req: AuthRequest, res: Response) => {
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

// ==================== ROLES MANAGEMENT ====================
router.get('/roles', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM roles ORDER BY name');
    res.json(result.rows);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/roles/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, permissions, approval_limit } = req.body;
    // Cannot edit own role
    const role = await query('SELECT id FROM roles WHERE id = $1', [req.params.id]);
    if (role.rows.length === 0) return res.status(404).json({ error: 'Role not found' });
    if (req.user!.role_id === parseInt(req.params.id)) return res.status(403).json({ error: 'Cannot edit your own role' });

    const result = await query(
      `UPDATE roles SET name = COALESCE($1, name), description = COALESCE($2, description),
        permissions = COALESCE($3, permissions),
        approval_limit = COALESCE($4, approval_limit),
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [name, description, permissions ? JSON.stringify(permissions) : null, approval_limit !== undefined ? approval_limit : null, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/roles', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });
    const result = await query(
      `INSERT INTO roles (name, description, permissions) VALUES ($1, $2, $3) RETURNING *`,
      [name, description || null, permissions ? JSON.stringify(permissions) : '[]']
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==================== USER PERMISSIONS ====================
router.get('/:id/permissions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const r = await query('SELECT permission_key FROM user_permissions WHERE user_id = $1 ORDER BY permission_key', [req.params.id]);
    res.json({ permissions: r.rows.map((r: any) => r.permission_key) });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.put('/:id/permissions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { permissions } = req.body;
    if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions array required' });

    // Audit old permissions
    const oldPerms = await query('SELECT permission_key FROM user_permissions WHERE user_id = $1', [req.params.id]);
    const oldKeys = oldPerms.rows.map((r: any) => r.permission_key);

    await query('DELETE FROM user_permissions WHERE user_id = $1', [req.params.id]);
    for (const key of permissions) {
      await query('INSERT INTO user_permissions (user_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, String(key)]);
    }

    // Audit log
    await query(
      `INSERT INTO audit_logs (user_id, username, action, module, old_values, new_values)
       VALUES ($1, $2, 'Update Permissions', 'Users', $3, $4)`,
      [req.user!.id, req.user!.username, JSON.stringify({ permissions: oldKeys }), JSON.stringify({ permissions })]
    );

    res.json({ permissions });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/:id/copy-permissions/:fromId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const srcPerms = await query('SELECT permission_key FROM user_permissions WHERE user_id = $1', [req.params.fromId]);
    await query('DELETE FROM user_permissions WHERE user_id = $1', [req.params.id]);
    for (const row of srcPerms.rows) {
      await query('INSERT INTO user_permissions (user_id, permission_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, row.permission_key]);
    }
    res.json({ copied: srcPerms.rows.length });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

export default router;
