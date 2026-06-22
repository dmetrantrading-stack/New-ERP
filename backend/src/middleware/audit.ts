import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { query } from '../config/database';
import {
  auditCreatePayload,
  resolveAuditReferenceId,
  resolveAuditReferenceType,
} from '../utils/auditHelpers';

export const auditLog = (module: string, action: string, referenceType?: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);

    res.status = function (code: number) {
      res.statusCode = code;
      return originalStatus(code);
    };

    res.json = function (body: any) {
      try {
        const statusCode = res.statusCode || 200;
        if (statusCode >= 400 || !req.user) {
          return originalJson(body);
        }

        const oldValues = (req as any).oldValues ?? null;
        const explicitNew = (req as any).newValues;
        const newValues = explicitNew ?? auditCreatePayload(body) ?? body;

        const refType =
          (req as any).auditReferenceType
          || resolveAuditReferenceType(module, (req as any).auditAction || action, referenceType);
        const refId = resolveAuditReferenceId(req, body);

        query(
          `INSERT INTO audit_logs (user_id, username, action, module, reference_type, reference_id, old_values, new_values, ip_address, device_info)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            req.user.id,
            req.user.username,
            (req as any).auditAction || action,
            module,
            refType,
            refId,
            oldValues ? JSON.stringify(oldValues) : null,
            newValues ? JSON.stringify(newValues) : null,
            req.ip,
            req.headers['user-agent'] || null,
          ]
        ).catch((err) => console.error('Audit log error:', err));
      } catch (error) {
        console.error('Audit error:', error);
      }

      return originalJson(body);
    };

    next();
  };
};
