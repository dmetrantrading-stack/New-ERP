import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../config/database';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    full_name: string;
    role_id: number;
    role_name: string;
    permissions: string[];
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string;
    const tokenStr = queryToken || (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);

    if (!tokenStr) return res.status(401).json({ error: 'Authentication required' });

    const token = tokenStr;
    const decoded: any = jwt.verify(token, config.jwtSecret);

    const result = await query(
      `SELECT u.id, u.username, u.full_name, u.role_id, r.name as role_name
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1 AND u.is_active = true`,
      [decoded.userId]
    );

    if (result.rows.length === 0) return res.status(401).json({ error: 'User not found or inactive' });

    const userRow = result.rows[0];
    const perms = await query('SELECT permission_key FROM user_permissions WHERE user_id = $1', [userRow.id]);
    req.user = { ...userRow, permissions: perms.rows.map((r: any) => r.permission_key) };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const hasUserPerm = (permission: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const isAdmin = req.user.role_name === 'Admin' || req.user.role_name === 'Owner';
    if (isAdmin || (req.user.permissions || []).includes(permission)) return next();
    return res.status(403).json({ error: `Permission denied: ${permission}` });
  };
};
