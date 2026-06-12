import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { auditLog } from '../../middleware/audit';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || '';
    const type = req.query.type as string;

    let whereClause = 'WHERE c.is_active = true';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (c.customer_name ILIKE $${paramIndex} OR c.customer_code ILIKE $${paramIndex} OR c.phone ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (type) {
      whereClause += ` AND c.customer_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    const total = await query(`SELECT COUNT(*) FROM customers c ${whereClause}`, params);
    const result = await query(
      `SELECT * FROM customers c ${whereClause} ORDER BY c.customer_name LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, auditLog('Customers', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin } = req.body;
    if (!customer_name) return res.status(400).json({ error: 'Customer name is required' });

    const codeResult = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(customer_code FROM 5) AS INTEGER)), 0) + 1 as next FROM customers WHERE customer_code ~ '^DMC-'");
    const code = `DMC-${String(codeResult.rows[0].next).padStart(5, '0')}`;

    const result = await query(
      `INSERT INTO customers (customer_code, customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [code, customer_name, contact_person, address, phone, email, customer_type || 'Retail', credit_limit || 0, payment_terms, tax_type || 'VAT', tin]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, auditLog('Customers', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const { customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin, is_active } = req.body;
    const result = await query(
      `UPDATE customers SET customer_name = COALESCE($1, customer_name), contact_person = COALESCE($2, contact_person),
        address = COALESCE($3, address), phone = COALESCE($4, phone), email = COALESCE($5, email),
        customer_type = COALESCE($6, customer_type), credit_limit = COALESCE($7, credit_limit),
        payment_terms = COALESCE($8, payment_terms), tax_type = COALESCE($9, tax_type),
        tin = COALESCE($10, tin), is_active = COALESCE($11, is_active), updated_at = CURRENT_TIMESTAMP
       WHERE id = $12 RETURNING *`,
      [customer_name, contact_person, address, phone, email, customer_type, credit_limit, payment_terms, tax_type, tin, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Customer aging
router.get('/aging/report', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(`
      SELECT c.*,
        COALESCE((SELECT SUM(si.balance) FROM sales_invoices si WHERE si.customer_id = c.id AND si.status IN ('Posted', 'Partial', 'Overdue') AND si.due_date < CURRENT_DATE), 0) as overdue,
        COALESCE((SELECT SUM(si.balance) FROM sales_invoices si WHERE si.customer_id = c.id AND si.status IN ('Posted', 'Partial') AND si.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30), 0) as current_30,
        COALESCE((SELECT SUM(si.balance) FROM sales_invoices si WHERE si.customer_id = c.id AND si.status IN ('Posted', 'Partial') AND si.due_date BETWEEN CURRENT_DATE + 31 AND CURRENT_DATE + 60), 0) as current_60,
        COALESCE((SELECT SUM(si.balance) FROM sales_invoices si WHERE si.customer_id = c.id AND si.status IN ('Posted', 'Partial') AND si.due_date > CURRENT_DATE + 60), 0) as current_90_plus
      FROM customers c
      WHERE c.balance > 0
      ORDER BY c.balance DESC
    `);
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, auditLog('Customers', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const balanceCheck = await query(
      `SELECT balance, (SELECT COUNT(*) FROM sales_invoices WHERE customer_id = $1 AND balance > 0 AND status != 'Cancelled') as open_invoices FROM customers WHERE id = $1`,
      [id]
    );
    if (balanceCheck.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const { balance, open_invoices } = balanceCheck.rows[0];
    if (parseFloat(balance) > 0 || parseInt(open_invoices) > 0) {
      throw new AppError('Cannot delete customer: customer has outstanding balance or open invoices', 409);
    }

    const result = await query(
      'UPDATE customers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ message: 'Customer deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
