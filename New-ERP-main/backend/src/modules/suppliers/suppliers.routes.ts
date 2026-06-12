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

    let whereClause = 'WHERE s.is_active = true';
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      whereClause += ` AND (s.supplier_name ILIKE $${paramIndex} OR s.supplier_code ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const total = await query(`SELECT COUNT(*) FROM suppliers s ${whereClause}`, params);
    const result = await query(
      `SELECT s.*, (SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = s.id) as po_count
       FROM suppliers s ${whereClause} ORDER BY s.supplier_name LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    res.json({ data: result.rows, total: parseInt(total.rows[0].count), page, limit });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/ledger', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const supplierId = parseInt(req.params.id);
    const supplier = await query('SELECT * FROM suppliers WHERE id = $1', [supplierId]);
    if (supplier.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    // Purchase Orders
    const pos = await query(
      `SELECT po.po_number as ref_no, po.order_date as date, 'Purchase Order' as type,
              po.total as debit, 0 as credit, po.status
       FROM purchase_orders po WHERE po.supplier_id = $1 AND po.status NOT IN ('Cancelled')
       ORDER BY po.order_date`,
      [supplierId]
    );

    // Goods Receipts
    const receipts = await query(
      `SELECT gr.gr_number as ref_no, gr.received_date as date, 'Goods Receipt' as type,
              (SELECT COALESCE(SUM(gri.quantity * gri.net_unit_cost), 0) FROM goods_receipt_items gri WHERE gri.gr_id = gr.id) as debit,
              0 as credit, gr.status
       FROM goods_receipts gr WHERE gr.supplier_id = $1 AND gr.status != 'Cancelled'
       ORDER BY gr.received_date`,
      [supplierId]
    );

    // Payment Vouchers
    const payments = await query(
      `SELECT pv.voucher_number as ref_no, pv.payment_date as date, 'Payment' as type,
              0 as debit, pv.amount as credit, pv.status
       FROM payment_vouchers pv WHERE pv.supplier_id = $1 AND pv.status != 'Void'
       ORDER BY pv.payment_date`,
      [supplierId]
    );

    // Purchase Returns
    const returns = await query(
      `SELECT pr.pr_number as ref_no, pr.return_date as date, 'Purchase Return' as type,
              0 as debit, 0 as credit, pr.status
       FROM purchase_returns pr WHERE pr.supplier_id = $1 AND pr.status != 'Cancelled'
       ORDER BY pr.return_date`,
      [supplierId]
    );

    // Combine and sort
    const allRows = [...pos.rows, ...receipts.rows, ...payments.rows, ...returns.rows]
      .map(r => ({
        ...r,
        debit: parseFloat(r.debit) || 0,
        credit: parseFloat(r.credit) || 0,
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    const ledger = allRows.map(r => {
      running = running + r.debit - r.credit;
      return { ...r, running_balance: running };
    });

    res.json({
      supplier: supplier.rows[0],
      ledger,
      running_balance: running,
    });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

router.post('/', authenticate, auditLog('Suppliers', 'Create'), async (req: AuthRequest, res: Response) => {
  try {
    const { supplier_name, contact_person, address, phone, email, payment_terms, tin } = req.body;
    if (!supplier_name) return res.status(400).json({ error: 'Supplier name is required' });

    const codeResult = await query("SELECT COALESCE(MAX(CAST(SUBSTRING(supplier_code FROM 5) AS INTEGER)), 0) + 1 as next FROM suppliers WHERE supplier_code ~ '^DMS-'");
    const code = `DMS-${String(codeResult.rows[0].next).padStart(5, '0')}`;

    const result = await query(
      `INSERT INTO suppliers (supplier_code, supplier_name, contact_person, address, phone, email, payment_terms, tin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [code, supplier_name, contact_person, address, phone, email, payment_terms, tin]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authenticate, auditLog('Suppliers', 'Update'), async (req: AuthRequest, res: Response) => {
  try {
    const { supplier_name, contact_person, address, phone, email, payment_terms, tin, is_active } = req.body;
    const result = await query(
      `UPDATE suppliers SET supplier_name = COALESCE($1, supplier_name), contact_person = COALESCE($2, contact_person),
        address = COALESCE($3, address), phone = COALESCE($4, phone), email = COALESCE($5, email),
        payment_terms = COALESCE($6, payment_terms), tin = COALESCE($7, tin),
        is_active = COALESCE($8, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = $9 RETURNING *`,
      [supplier_name, contact_person, address, phone, email, payment_terms, tin, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, auditLog('Suppliers', 'Delete'), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const balanceCheck = await query(
      `SELECT s.balance,
              (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id = $1 AND po.status IN ('Sent', 'Partial', 'Received')) as open_pos
       FROM suppliers s WHERE s.id = $1`,
      [id]
    );
    if (balanceCheck.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });

    const { balance, open_pos } = balanceCheck.rows[0];
    if (parseFloat(balance) > 0 || parseInt(open_pos) > 0) {
      throw new AppError('Cannot delete supplier: supplier has outstanding balance or open purchase orders', 409);
    }

    const result = await query(
      'UPDATE suppliers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND is_active = true RETURNING *',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ message: 'Supplier deleted successfully' });
  } catch (error: any) {
    if (error instanceof AppError) return res.status(error.statusCode).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
