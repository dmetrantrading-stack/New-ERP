import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();

// Daily sales report
router.get('/daily-sales', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const date = req.query.date as string || new Date().toISOString().split('T')[0];
    const result = await query(
      `SELECT pt.*, u.full_name as cashier_name,
              (SELECT COUNT(*) FROM pos_transaction_items WHERE transaction_id = pt.id) as item_count
       FROM pos_transactions pt
       LEFT JOIN users u ON pt.cashier_id = u.id
       WHERE pt.created_at::date = $1 AND pt.status = 'Completed'
       ORDER BY pt.created_at`,
      [date]
    );

    const summary = await query(
      `SELECT COUNT(*) as transaction_count, COALESCE(SUM(total), 0) as total_sales,
              COALESCE(SUM(discount_total), 0) as total_discounts, COALESCE(SUM(tax_total), 0) as total_tax,
              COALESCE(SUM((SELECT SUM(pti.cost * pti.quantity) FROM pos_transaction_items pti WHERE pti.transaction_id = pt.id)), 0) as total_cost
       FROM pos_transactions pt WHERE created_at::date = $1 AND status = 'Completed'`,
      [date]
    );
    const summaryRow = summary.rows[0];
    const gp = parseFloat(summaryRow.total_sales) - parseFloat(summaryRow.total_cost);
    res.json({ transactions: result.rows, summary: { ...summaryRow, gross_profit: gp, margin_pct: parseFloat(summaryRow.total_sales) > 0 ? Math.round((gp / parseFloat(summaryRow.total_sales)) * 10000) / 100 : 0 } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sales by item
router.get('/sales-by-item', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT p.sku, p.name, p.unit_of_measure,
              COALESCE(SUM(pti.quantity), 0) as total_qty,
              COALESCE(SUM(pti.total), 0) as total_amount,
              COALESCE(SUM(pti.cost * pti.quantity), 0) as total_cost,
              COUNT(DISTINCT pt.id) as transaction_count
       FROM pos_transaction_items pti
       JOIN products p ON pti.product_id = p.id
       JOIN pos_transactions pt ON pti.transaction_id = pt.id
       WHERE pt.created_at::date >= $1 AND pt.created_at::date <= $2 AND pt.status = 'Completed'
       GROUP BY p.sku, p.name, p.unit_of_measure
       ORDER BY total_amount DESC`,
      [from, to]
    );
    const rows = result.rows.map((r: any) => ({
      ...r,
      gross_profit: parseFloat(r.total_amount) - parseFloat(r.total_cost),
      margin_pct: parseFloat(r.total_amount) > 0 ? Math.round(((parseFloat(r.total_amount) - parseFloat(r.total_cost)) / parseFloat(r.total_amount)) * 10000) / 100 : 0,
    }));
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sales by cashier
router.get('/sales-by-cashier', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT u.full_name, COUNT(pt.id) as transaction_count,
              COALESCE(SUM(pt.total), 0) as total_sales,
              COALESCE(AVG(pt.total), 0) as avg_sale
       FROM pos_transactions pt
       JOIN users u ON pt.cashier_id = u.id
       WHERE pt.created_at::date >= $1 AND pt.created_at::date <= $2 AND pt.status = 'Completed'
       GROUP BY u.full_name
       ORDER BY total_sales DESC`,
      [from, to]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sales by customer
router.get('/sales-by-customer', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT c.customer_code, c.customer_name,
              COUNT(si.id) as invoice_count,
              COALESCE(SUM(si.total), 0) as total_sales,
              COALESCE(SUM(si.balance), 0) as total_balance
       FROM sales_invoices si
       JOIN customers c ON si.customer_id = c.id
       WHERE si.invoice_date >= $1 AND si.invoice_date <= $2 AND si.status NOT IN ('Void', 'Cancelled')
       GROUP BY c.customer_code, c.customer_name
       ORDER BY total_sales DESC`,
      [from, to]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Inventory valuation report
router.get('/inventory-valuation', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT p.sku, p.name, p.unit_of_measure, p.cost,
              COALESCE(SUM(i.quantity), 0) as total_quantity,
              COALESCE(SUM(i.quantity * i.unit_cost), 0) as total_value,
              l.name as location_name
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       JOIN locations l ON i.location_id = l.id
       WHERE i.quantity > 0
       GROUP BY p.sku, p.name, p.unit_of_measure, p.cost, l.name
       ORDER BY total_value DESC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Low stock report
router.get('/low-stock', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT p.sku, p.name, p.reorder_level, p.unit_of_measure,
              i.quantity, i.location_id, l.name as location_name,
              (i.quantity - p.reorder_level) as deficit
       FROM products p
       JOIN inventory i ON p.id = i.product_id
       JOIN locations l ON i.location_id = l.id
       WHERE p.is_active = true AND p.reorder_level > 0 AND i.quantity <= p.reorder_level
       ORDER BY (i.quantity::float / NULLIF(p.reorder_level, 0)) ASC`
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Expiry report
router.get('/expiry', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const result = await query(
      `SELECT b.*, p.sku, p.name as product_name, l.name as location_name
       FROM batches b
       JOIN products p ON b.product_id = p.id
       JOIN locations l ON b.location_id = l.id
       WHERE b.expiry_date IS NOT NULL
         AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1
         AND b.quantity > 0
       ORDER BY b.expiry_date`,
      [days]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Purchase report
router.get('/purchases', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string;
    const to = req.query.to as string;
    const supplier_id = req.query.supplier_id as string;

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (from) { whereClause += ` AND po.order_date >= $${paramIndex}`; params.push(from); paramIndex++; }
    if (to) { whereClause += ` AND po.order_date <= $${paramIndex}`; params.push(to); paramIndex++; }
    if (supplier_id) { whereClause += ` AND po.supplier_id = $${paramIndex}`; params.push(supplier_id); paramIndex++; }

    const result = await query(
      `SELECT po.*, s.supplier_name
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       ${whereClause}
       ORDER BY po.order_date DESC`,
      params
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// VAT report
router.get('/vat', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const salesVat = await query(
      `SELECT COALESCE(SUM(tax_total), 0) as output_vat FROM pos_transactions WHERE created_at::date >= $1 AND created_at::date <= $2 AND status = 'Completed'`,
      [from, to]
    );

    const purchaseVat = await query(
      `SELECT COALESCE(SUM(tax), 0) as input_vat FROM purchase_orders WHERE order_date >= $1 AND order_date <= $2 AND status IN ('Received', 'Partial')`,
      [from, to]
    );

    const outputVat = parseFloat(salesVat.rows[0]?.output_vat || 0);
    const inputVat = parseFloat(purchaseVat.rows[0]?.input_vat || 0);

    res.json({
      output_vat: outputVat,
      input_vat: inputVat,
      vat_payable: outputVat - inputVat,
      period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
