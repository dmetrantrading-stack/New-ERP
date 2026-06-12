import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

    // Daily sales
    const dailySales = await query(
      `SELECT COALESCE(SUM(total), 0) as total FROM pos_transactions WHERE created_at::date = $1 AND status = 'Completed'`,
      [today]
    );

    // Monthly sales
    const monthlySales = await query(
      `SELECT COALESCE(SUM(total), 0) as total FROM pos_transactions WHERE created_at::date >= $1 AND created_at::date <= $2 AND status = 'Completed'`,
      [firstDayOfMonth, today]
    );

    // Gross profit (POS + Sales Invoices)
    const grossProfit = await query(
      `SELECT COALESCE(SUM(pt.total - (COALESCE(pti.cost, 0) * pti.quantity)), 0) as gross_profit
       FROM pos_transactions pt
       JOIN pos_transaction_items pti ON pt.id = pti.transaction_id
       WHERE pt.created_at::date >= $1 AND pt.created_at::date <= $2 AND pt.status = 'Completed'`,
      [firstDayOfMonth, today]
    );

    const siGrossProfit = await query(
      `SELECT COALESCE(SUM(si.total - (COALESCE(sii.cost, 0) * sii.quantity)), 0) as gross_profit
       FROM sales_invoices si
       JOIN sales_invoice_items sii ON si.id = sii.invoice_id
       WHERE si.invoice_date >= $1 AND si.invoice_date <= $2 AND si.status IN ('Posted', 'Paid', 'Partial')`,
      [firstDayOfMonth, today]
    );

    const totalGrossProfit = parseFloat(grossProfit.rows[0].gross_profit) + parseFloat(siGrossProfit.rows[0].gross_profit);

    // Operating expenses
    const expenses = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_date >= $1 AND expense_date <= $2 AND status = 'Posted'`,
      [firstDayOfMonth, today]
    );

    // Inventory value
    const inventoryValue = await query(
      `SELECT COALESCE(SUM(i.quantity * i.unit_cost), 0) as total FROM inventory i WHERE i.quantity > 0`
    );

    // Receivables
    const receivables = await query(
      `SELECT COALESCE(SUM(balance), 0) as total FROM customers WHERE balance > 0`
    );

    // Payables
    const payables = await query(
      `SELECT COALESCE(SUM(balance), 0) as total FROM suppliers WHERE balance > 0`
    );

    // Low stock count
    const lowStock = await query(
      `SELECT COUNT(*) as count FROM products p JOIN inventory i ON p.id = i.product_id WHERE p.reorder_level > 0 AND i.quantity <= p.reorder_level`
    );

    // Expiring in 30 days
    const expiring = await query(
      `SELECT COUNT(*) as count FROM batches WHERE expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 AND quantity > 0`
    );

    // Sales chart (last 7 days)
    const salesChart = await query(
      `SELECT created_at::date as date, COALESCE(SUM(total), 0) as total
       FROM pos_transactions
       WHERE created_at::date >= CURRENT_DATE - 7 AND status = 'Completed'
       GROUP BY created_at::date
       ORDER BY date`
    );

    // Top selling products
    const topProducts = await query(
      `SELECT p.name, COALESCE(SUM(pti.quantity), 0) as qty, COALESCE(SUM(pti.total), 0) as total
       FROM pos_transaction_items pti
       JOIN products p ON pti.product_id = p.id
       JOIN pos_transactions pt ON pti.transaction_id = pt.id
       WHERE pt.created_at::date >= $1 AND pt.created_at::date <= $2 AND pt.status = 'Completed'
       GROUP BY p.name
       ORDER BY total DESC
       LIMIT 10`,
      [firstDayOfMonth, today]
    );

    // Sales by cashier today
    const salesByCashier = await query(
      `SELECT u.full_name, COUNT(pt.id) as transactions, COALESCE(SUM(pt.total), 0) as total
       FROM pos_transactions pt
       JOIN users u ON pt.cashier_id = u.id
       WHERE pt.created_at::date = $1 AND pt.status = 'Completed'
       GROUP BY u.full_name
       ORDER BY total DESC`,
      [today]
    );

    res.json({
      daily_sales: parseFloat(dailySales.rows[0]?.total || 0),
      monthly_sales: parseFloat(monthlySales.rows[0]?.total || 0),
      gross_profit: totalGrossProfit,
      expenses: parseFloat(expenses.rows[0]?.total || 0),
      net_profit: totalGrossProfit - parseFloat(expenses.rows[0]?.total || 0),
      inventory_value: parseFloat(inventoryValue.rows[0]?.total || 0),
      receivables: parseFloat(receivables.rows[0]?.total || 0),
      payables: parseFloat(payables.rows[0]?.total || 0),
      low_stock_count: parseInt(lowStock.rows[0]?.count || 0),
      expiring_count: parseInt(expiring.rows[0]?.count || 0),
      sales_chart: salesChart.rows,
      top_products: topProducts.rows,
      sales_by_cashier: salesByCashier.rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sales chart by month
router.get('/sales-chart', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const result = await query(
      `SELECT EXTRACT(MONTH FROM created_at) as month, COALESCE(SUM(total), 0) as total
       FROM pos_transactions
       WHERE EXTRACT(YEAR FROM created_at) = $1 AND status = 'Completed'
       GROUP BY EXTRACT(MONTH FROM created_at)
       ORDER BY month`,
      [year]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
