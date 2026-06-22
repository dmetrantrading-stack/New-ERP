import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import type { AuthRequest } from '../middleware/auth';

type DbClient = { query: typeof query };

async function isEnforcementEnabled(db: DbClient = { query }): Promise<boolean> {
  const r = await db.query(
    `SELECT setting_value FROM system_settings WHERE setting_key = 'enforce_approval_limits'`,
  );
  return r.rows[0]?.setting_value === 'true';
}

/** Throws when amount exceeds the user's role approval_limit (0 = unlimited). Admin/Owner bypass. */
export async function assertApprovalLimit(
  req: AuthRequest,
  amount: number,
  label = 'transaction',
  db: DbClient = { query },
): Promise<void> {
  if (!req.user) throw new AppError('Unauthorized', 401);
  if (!(await isEnforcementEnabled(db))) return;

  const amt = parseFloat(String(amount)) || 0;
  if (amt <= 0) return;

  if (req.user.role_name === 'Admin' || req.user.role_name === 'Owner') return;

  const role = await db.query(
    'SELECT approval_limit FROM roles WHERE id = $1',
    [req.user.role_id],
  );
  const limit = parseFloat(role.rows[0]?.approval_limit || 0);
  if (limit <= 0) return;

  if (amt > limit) {
    throw new AppError(
      `Approval limit exceeded for ${label}. Amount ₱${amt.toFixed(2)} exceeds your role limit of ₱${limit.toFixed(2)}. Request approval from a higher authority.`,
      403,
    );
  }
}
