import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { z } from 'zod';
import { validate } from '../../middleware/validation';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    const result = await query(
      `SELECT u.*, r.name as role_name
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.username = $1 AND u.is_active = true`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userPerms = await query('SELECT permission_key FROM user_permissions WHERE user_id = $1', [user.id]);

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role_name },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn as any }
    );

    await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    await query(
      `INSERT INTO audit_logs (user_id, username, action, module, new_values, device_info)
       VALUES ($1, $2, 'Login', 'Auth', $3, $4)`,
      [user.id, user.username, JSON.stringify({ username: user.username }), req.headers['user-agent']]
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        email: user.email,
        role_id: user.role_id,
        role_name: user.role_name,
        permissions: userPerms.rows.map((r: any) => r.permission_key),
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || error.code || 'Internal server error' });
  }
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    res.json({ user: req.user });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, username, action, module, device_info)
       VALUES ($1, $2, 'Logout', 'Auth', $3)`,
      [req.user!.id, req.user!.username, req.headers['user-agent']]
    );
    res.json({ message: 'Logged out successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/change-password', authenticate, auditLog('Auth', 'Change Password'), async (req: AuthRequest, res: Response) => {
  try {
    const { current_password, new_password } = req.body;
    const userResult = await query('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(current_password, userResult.rows[0].password_hash);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, req.user!.id]);

    res.json({ message: 'Password changed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
