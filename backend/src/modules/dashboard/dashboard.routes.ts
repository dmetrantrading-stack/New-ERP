import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';

const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    // Daily sales (DB-native date, no timezone issues)
    const dailySales = await query(
      `SELECT COALESCE(SUM(total), 0) as total FROM pos_transactions WHERE created_at::date = CURRENT_DATE AND status = 'Completed'`
    );

    // Monthly sales (Month-to-Date)
    const monthlySales = await query(
      `SELECT COALESCE(SUM(total), 0) as total FROM pos_transactions WHERE created_at::date >= DATE_TRUNC('month', CURRENT_DATE)::date AND created_at::date <= CURRENT_DATE AND status = 'Completed'`
    );

    // Gross profit (POS + Sales Invoices) — use line-item totals to avoid JOIN blow-up
    const grossProfit = await query(
      `SELECT COALESCE(SUM(pti.total - (COALESCE(pti.cost, 0) * pti.quantity)), 0) as gross_profit
       FROM pos_transactions pt
       JOIN pos_transaction_items pti ON pt.id = pti.transaction_id
       WHERE pt.created_at::date >= CURRENT_DATE - EXTRACT(DAY FROM CURRENT_DATE)::int + 1
         AND pt.created_at::date <= CURRENT_DATE AND pt.status = 'Completed'`,
    );
    const siGrossProfit = await query(
      `SELECT COALESCE(SUM(sii.total - (COALESCE(sii.cost, 0) * sii.quantity)), 0) as gross_profit
       FROM sales_invoices si
       JOIN sales_invoice_items sii ON si.id = sii.invoice_id
       WHERE si.invoice_date >= CURRENT_DATE - EXTRACT(DAY FROM CURRENT_DATE)::int + 1
         AND si.invoice_date <= CURRENT_DATE AND si.status IN ('Posted', 'Paid', 'Partial')`,
    );

    const totalGrossProfit = parseFloat(grossProfit.rows[0]?.gross_profit || '0') + parseFloat(siGrossProfit.rows[0]?.gross_profit || '0');

    // Operating expenses
    const expenses = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE expense_date >= DATE_TRUNC('month', CURRENT_DATE)::date AND expense_date <= CURRENT_DATE AND status = 'Posted'`
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
      `SELECT COUNT(*) as count FROM products p LEFT JOIN inventory i ON p.id = i.product_id WHERE p.reorder_level > 0 AND COALESCE(i.quantity, 0) <= p.reorder_level`
    );

    // Expiring in 30 days
    const expiring = await query(
      `SELECT COUNT(*) as count FROM batches WHERE expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30 AND quantity > 0`
    );

    // Sales chart (last 7 days — CURRENT_DATE - 6 gives inclusive 7-day window)
    const salesChart = await query(
      `SELECT created_at::date as date, COALESCE(SUM(total), 0) as total
       FROM pos_transactions
       WHERE created_at::date >= CURRENT_DATE - 6 AND status = 'Completed'
       GROUP BY created_at::date
       ORDER BY date`
    );

    // Top selling products
    const topProducts = await query(
      `SELECT p.name, COALESCE(SUM(pti.quantity), 0) as qty, COALESCE(SUM(pti.total), 0) as total
       FROM pos_transaction_items pti
       JOIN products p ON pti.product_id = p.id
       JOIN pos_transactions pt ON pti.transaction_id = pt.id
       WHERE pt.created_at::date >= DATE_TRUNC('month', CURRENT_DATE)::date AND pt.created_at::date <= CURRENT_DATE AND pt.status = 'Completed'
       GROUP BY p.id, p.name
       ORDER BY total DESC
       LIMIT 10`
    );

    // Sales by cashier today
    const salesByCashier = await query(
      `SELECT u.full_name, COUNT(pt.id) as transactions, COALESCE(SUM(pt.total), 0) as total
       FROM pos_transactions pt
       JOIN users u ON pt.cashier_id = u.id
       WHERE pt.created_at::date = CURRENT_DATE AND pt.status = 'Completed'
       GROUP BY u.full_name
       ORDER BY total DESC`
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

// Executive Dashboard
router.get('/executive', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Today's Sales (POS + Sales Invoices posted today)
    const todayPos = await query(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM pos_transactions WHERE created_at::date = $1 AND status = 'Completed'`, [today]);
    const todaySi = await query(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales_invoices WHERE invoice_date = $1 AND status IN ('Posted','Partial','Paid')`, [today]);
    const todaySales = parseFloat(todayPos.rows[0].total) + parseFloat(todaySi.rows[0].total);
    const todayCount = parseInt(todayPos.rows[0].count) + parseInt(todaySi.rows[0].count);

    // Monthly Sales (POS + SI this month)
    const monthPos = await query(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM pos_transactions WHERE created_at::date >= DATE_TRUNC('month',CURRENT_DATE)::date AND created_at::date <= $1 AND status = 'Completed'`, [today]);
    const monthSi = await query(`SELECT COALESCE(SUM(total),0) as total, COUNT(*) as count FROM sales_invoices WHERE invoice_date >= DATE_TRUNC('month',CURRENT_DATE)::date AND invoice_date <= $1 AND status IN ('Posted','Partial','Paid')`, [today]);
    const monthlySales = parseFloat(monthPos.rows[0].total) + parseFloat(monthSi.rows[0].total);

    // AR
    const ar = await query(`SELECT COALESCE(SUM(balance),0) as total FROM sales_invoices WHERE status IN ('Posted','Partial','Overdue') AND balance > 0`);
    const arTotal = parseFloat(ar.rows[0].total);

    // AP
    const ap = await query(`SELECT COALESCE(SUM(balance),0) as total FROM ap_vouchers WHERE status IN ('Posted','Partially Paid') AND balance > 0`);
    const apTotal = parseFloat(ap.rows[0].total);

    // Bank & Cash (sum of all active account balances computed from transactions)
    const bankCash = await query(`SELECT COALESCE(SUM(computed_balance),0) as total FROM (
      SELECT ba.id, ba.account_type,
        CASE WHEN ba.account_type = 'Cash on Hand' THEN
          COALESCE((SELECT SUM(CASE WHEN ct.transaction_type = 'Cash In' THEN ct.amount ELSE -ct.amount END) FROM cash_transactions ct WHERE (ct.status IS NULL OR ct.status != 'Void')), 0)
        ELSE
          COALESCE((SELECT SUM(CASE WHEN bt.transaction_type = 'Deposit' THEN bt.amount ELSE -bt.amount END) FROM bank_transactions bt WHERE bt.bank_account_id = ba.id), 0)
        END as computed_balance
      FROM bank_accounts ba WHERE ba.is_active = true
    ) sub`);
    const bankCashTotal = parseFloat(bankCash.rows[0].total);

    // Net Profit = Sales - COGS - Expenses (this month)
    const sales = parseFloat(monthPos.rows[0].total) + parseFloat(monthSi.rows[0].total);
    const posCogs = await query(`SELECT COALESCE(SUM(pti.cost * pti.quantity),0) as total FROM pos_transaction_items pti JOIN pos_transactions pt ON pti.transaction_id = pt.id WHERE pt.created_at::date >= DATE_TRUNC('month',CURRENT_DATE)::date AND pt.status = 'Completed'`);
    const siCogs = await query(`SELECT COALESCE(SUM(sii.cost * sii.quantity),0) as total FROM sales_invoice_items sii JOIN sales_invoices si ON sii.invoice_id = si.id WHERE si.invoice_date >= DATE_TRUNC('month',CURRENT_DATE)::date AND si.status IN ('Posted','Partial','Paid')`);
    const cogs = parseFloat(posCogs.rows[0].total) + parseFloat(siCogs.rows[0].total);
    const exp = await query(`SELECT COALESCE(SUM(amount),0) as total FROM expenses WHERE expense_date >= DATE_TRUNC('month',CURRENT_DATE)::date AND status = 'Posted'`);
    const expenses = parseFloat(exp.rows[0].total);
    const netProfit = sales - cogs - expenses;

    // Aging Receivables
    const aging = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN si.due_date >= CURRENT_DATE OR si.due_date IS NULL THEN si.balance ELSE 0 END), 0) as current,
        COALESCE(SUM(CASE WHEN si.due_date < CURRENT_DATE AND si.due_date >= CURRENT_DATE - 30 THEN si.balance ELSE 0 END), 0) as d30,
        COALESCE(SUM(CASE WHEN si.due_date < CURRENT_DATE - 30 AND si.due_date >= CURRENT_DATE - 60 THEN si.balance ELSE 0 END), 0) as d60,
        COALESCE(SUM(CASE WHEN si.due_date < CURRENT_DATE - 60 AND si.due_date >= CURRENT_DATE - 90 THEN si.balance ELSE 0 END), 0) as d90,
        COALESCE(SUM(CASE WHEN si.due_date < CURRENT_DATE - 90 THEN si.balance ELSE 0 END), 0) as over90,
        COALESCE(SUM(si.balance), 0) as total
       FROM sales_invoices si
       WHERE si.status IN ('Posted','Partial','Overdue') AND si.balance > 0`
    );

    // Recent Collections (last 10)
    const recentCol = await query(
      `SELECT cr.receipt_number, cr.payment_date, cr.payment_method, cr.reference_number, cr.amount, cr.id,
              c.customer_name
       FROM collection_receipts cr
       LEFT JOIN customers c ON cr.customer_id = c.id
       WHERE cr.status = 'Posted'
       ORDER BY cr.created_at DESC LIMIT 10`
    );

    // Recent Payments / Disbursements (last 10 payment vouchers)
    const recentPay = await query(
      `SELECT pv.voucher_number, pv.payment_date, pv.payment_method, pv.reference_number, pv.amount, pv.id,
              s.supplier_name
       FROM payment_vouchers pv
       LEFT JOIN suppliers s ON pv.supplier_id = s.id
       WHERE pv.status = 'Posted'
       ORDER BY pv.created_at DESC LIMIT 10`
    );

    res.json({
      today_sales: { count: todayCount, amount: todaySales },
      monthly_sales: { count: parseInt(monthPos.rows[0].count) + parseInt(monthSi.rows[0].count), amount: monthlySales },
      accounts_receivable: { total: arTotal },
      accounts_payable: { total: apTotal },
      bank_cash: { total: bankCashTotal },
      net_profit: { sales, cogs, expenses, net: netProfit },
      aging_receivables: aging.rows[0],
      recent_collections: recentCol.rows,
      recent_payments: recentPay.rows,
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
