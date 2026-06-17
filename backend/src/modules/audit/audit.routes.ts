import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = (page - 1) * limit;
    const module = req.query.module as string;
    const action = req.query.action as string;
    const from = req.query.from as string;
    const to = req.query.to as string;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (module) { whereClause += ` AND al.module = $${paramIndex}`; params.push(module); paramIndex++; }
    if (action) { whereClause += ` AND al.action = $${paramIndex}`; params.push(action); paramIndex++; }
    if (from) { whereClause += ` AND al.created_at >= $${paramIndex}`; params.push(from); paramIndex++; }
    if (to) { whereClause += ` AND al.created_at <= $${paramIndex}`; params.push(to); paramIndex++; }

    const total = await query(`SELECT COUNT(*) FROM audit_logs al ${whereClause}`, params);
    const result = await query(
      `SELECT al.*
       FROM audit_logs al
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get modules list for filter
router.get('/modules', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT DISTINCT module FROM audit_logs ORDER BY module');
    res.json(result.rows.map((r: any) => r.module));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
