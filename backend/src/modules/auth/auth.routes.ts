import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { z } from 'zod';
import { validate } from '../../middleware/validation';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../../middleware/errorHandler';
import {
  getRegistrationSettings,
  resolveDefaultRegistrationRoleId,
} from '../../utils/registrationSettings';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(50)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128),
  full_name: z.string().min(1, 'Full name is required').max(255),
  email: z.string().email('Invalid email').max(255).optional().or(z.literal('')),
  phone: z.string().max(50).optional().or(z.literal('')),
});

router.get('/register-config', async (_req: Request, res: Response) => {
  try {
    const settings = await getRegistrationSettings();
    res.json({
      enabled: settings.enabled,
      require_approval: settings.require_approval,
      default_role: settings.default_role,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const settings = await getRegistrationSettings();
    if (!settings.enabled) {
      return res.status(403).json({ error: 'Self-registration is disabled. Contact your administrator.' });
    }

    const { username, password, full_name, email, phone } = req.body;
    const normalizedUsername = String(username).trim().toLowerCase();

    const existingUser = await query(
      'SELECT id FROM users WHERE LOWER(username) = $1',
      [normalizedUsername],
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const emailTrimmed = String(email || '').trim();
    if (emailTrimmed) {
      const existingEmail = await query(
        'SELECT id FROM users WHERE LOWER(email) = $1',
        [emailTrimmed.toLowerCase()],
      );
      if (existingEmail.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }
    }

    const roleId = await resolveDefaultRegistrationRoleId(settings.default_role);
    if (!roleId) {
      return res.status(500).json({ error: 'No roles configured. Contact your administrator.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const isActive = !settings.require_approval;

    await query(
      `INSERT INTO users (id, username, password_hash, email, full_name, role_id, phone, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        normalizedUsername,
        passwordHash,
        emailTrimmed || null,
        String(full_name).trim(),
        roleId,
        String(phone || '').trim() || null,
        isActive,
      ],
    );

    res.status(201).json({
      id,
      username: normalizedUsername,
      full_name: String(full_name).trim(),
      pending_approval: settings.require_approval,
      message: settings.require_approval
        ? 'Account created. An administrator must activate your account before you can sign in.'
        : 'Account created. You can sign in now.',
    });
  } catch (error: any) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    const result = await query(
      `SELECT u.*, r.name as role_name
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE LOWER(u.username) = LOWER($1)`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({
        error: 'Your account is pending administrator approval. Please contact your system administrator.',
      });
    }

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
      `INSERT INTO audit_logs (user_id, username, action, module, reference_type, reference_id, new_values, device_info)
       VALUES ($1, $2, 'Login', 'Auth', 'User', $3, $4, $5)`,
      [user.id, user.username, user.id, JSON.stringify({ username: user.username }), req.headers['user-agent']]
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
