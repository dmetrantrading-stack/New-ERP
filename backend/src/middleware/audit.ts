import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { query } from '../config/database';

export const auditLog = (module: string, action: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: any) {
      try {
        const oldValues = (req as any).oldValues || null;
        const newValues = (req as any).newValues || body;

        if (req.user) {
          query(
            `INSERT INTO audit_logs (user_id, username, action, module, reference_type, reference_id, old_values, new_values, ip_address, device_info)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              req.user.id,
              req.user.username,
              action,
              module,
              req.params.id ? 'id' : null,
              req.params.id || null,
              oldValues ? JSON.stringify(oldValues) : null,
              JSON.stringify(newValues),
              req.ip,
              req.headers['user-agent'] || null,
            ]
          ).catch((err) => console.error('Audit log error:', err));
        }
      } catch (error) {
        console.error('Audit error:', error);
      }

      return originalJson(body);
    };

    next();
  };
};
