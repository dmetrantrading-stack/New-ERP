import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';

const router = Router();

const buildWhere = (queryParams: {
  module?: string;
  action?: string;
  from?: string;
  to?: string;
  search?: string;
}) => {
  let whereClause = 'WHERE 1=1';
  const params: unknown[] = [];
  let paramIndex = 1;

  if (queryParams.module) {
    whereClause += ` AND al.module = $${paramIndex}`;
    params.push(queryParams.module);
    paramIndex++;
  }
  if (queryParams.action) {
    whereClause += ` AND al.action ILIKE $${paramIndex}`;
    params.push(`%${queryParams.action}%`);
    paramIndex++;
  }
  if (queryParams.from) {
    whereClause += ` AND al.created_at >= $${paramIndex}::date`;
    params.push(queryParams.from);
    paramIndex++;
  }
  if (queryParams.to) {
    whereClause += ` AND al.created_at < ($${paramIndex}::date + INTERVAL '1 day')`;
    params.push(queryParams.to);
    paramIndex++;
  }
  if (queryParams.search?.trim()) {
    const term = `%${queryParams.search.trim()}%`;
    whereClause += ` AND (
      al.username ILIKE $${paramIndex}
      OR al.action ILIKE $${paramIndex}
      OR al.module ILIKE $${paramIndex}
      OR al.reference_type ILIKE $${paramIndex}
      OR al.new_values::text ILIKE $${paramIndex}
      OR al.old_values::text ILIKE $${paramIndex}
    )`;
    params.push(term);
    paramIndex++;
  }

  return { whereClause, params, paramIndex };
};

router.get('/summary', authenticate, hasUserPerm('system.audit.view'), async (req: AuthRequest, res: Response) => {
  try {
    const { whereClause, params } = buildWhere({
      module: req.query.module as string,
      action: req.query.action as string,
      from: req.query.from as string,
      to: req.query.to as string,
      search: req.query.search as string,
    });

    const [totalR, todayR, modulesR, actionsR] = await Promise.all([
      query(`SELECT COUNT(*)::int as count FROM audit_logs al ${whereClause}`, params),
      query(
        `SELECT COUNT(*)::int as count FROM audit_logs al ${whereClause} AND al.created_at::date = CURRENT_DATE`,
        params,
      ),
      query(
        `SELECT al.module, COUNT(*)::int as count
         FROM audit_logs al ${whereClause}
         GROUP BY al.module
         ORDER BY count DESC, al.module
         LIMIT 8`,
        params,
      ),
      query(
        `SELECT al.action, COUNT(*)::int as count
         FROM audit_logs al ${whereClause}
         GROUP BY al.action
         ORDER BY count DESC, al.action
         LIMIT 6`,
        params,
      ),
    ]);

    res.json({
      total: totalR.rows[0]?.count || 0,
      today: todayR.rows[0]?.count || 0,
      by_module: modulesR.rows,
      top_actions: actionsR.rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/', authenticate, hasUserPerm('system.audit.view'), async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const { whereClause, params, paramIndex } = buildWhere({
      module: req.query.module as string,
      action: req.query.action as string,
      from: req.query.from as string,
      to: req.query.to as string,
      search: req.query.search as string,
    });

    const total = await query(`SELECT COUNT(*) FROM audit_logs al ${whereClause}`, params);
    const result = await query(
      `SELECT al.*
       FROM audit_logs al
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset],
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/modules', authenticate, hasUserPerm('system.audit.view'), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT DISTINCT module FROM audit_logs ORDER BY module');
    res.json(result.rows.map((r: { module: string }) => r.module));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/actions', authenticate, hasUserPerm('system.audit.view'), async (req: AuthRequest, res: Response) => {
  try {
    const module = req.query.module as string;
    if (module) {
      const result = await query(
        'SELECT DISTINCT action FROM audit_logs WHERE module = $1 ORDER BY action',
        [module],
      );
      return res.json(result.rows.map((r: { action: string }) => r.action));
    }
    const result = await query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
    res.json(result.rows.map((r: { action: string }) => r.action));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
