import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest, hasUserPerm } from '../../middleware/auth';
import { getApAgingReport, getArAgingReport } from '../../utils/financeAging';
import { COA_PERIOD_BALANCE_SUBQUERY } from '../../utils/chartOfAccountsBalance';
import { buildBir2550qWorksheet } from '../../utils/bir2550q';

const router = Router();

// Daily sales report
router.get('/daily-sales', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
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
router.get('/sales-by-item', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
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
router.get('/sales-by-cashier', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
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
router.get('/sales-by-customer', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
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
router.get('/inventory-valuation', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
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
router.get('/low-stock', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
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
router.get('/expiry', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const result = await query(
      `SELECT b.*, p.sku, p.name as product_name, l.name as location_name
       FROM batches b
       JOIN products p ON b.product_id = p.id
       JOIN locations l ON b.location_id = l.id
       WHERE b.expiry_date IS NOT NULL
         AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1::int)
         AND b.quantity > 0
       ORDER BY b.expiry_date`,
      [days]
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stock movement — inventory ledger activity
router.get('/stock-movement', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT il.id, il.created_at, il.reference_type, il.reference_id, il.transaction_type,
              il.quantity, il.running_quantity, il.unit_cost, il.total_cost, il.notes,
              p.sku, p.name AS product_name, p.unit_of_measure, l.name AS location_name
       FROM inventory_ledger il
       JOIN products p ON il.product_id = p.id
       LEFT JOIN locations l ON il.location_id = l.id
       WHERE il.created_at::date >= $1 AND il.created_at::date <= $2
       ORDER BY il.created_at DESC, p.sku`,
      [from, to]
    );

    const outTypes = new Set(['OUT', 'TRANSFER_OUT', 'CONVERSION_OUT']);
    const rows = result.rows.map((r: any) => {
      const qty = parseFloat(r.quantity || 0);
      const signedQty = outTypes.has(r.transaction_type) ? -Math.abs(qty) : qty;
      return { ...r, signed_qty: signedQty };
    });

    let totalIn = 0;
    let totalOut = 0;
    let totalAdjust = 0;
    for (const r of rows) {
      const qty = parseFloat(r.quantity || 0);
      if (['IN', 'TRANSFER_IN', 'CONVERSION_IN'].includes(r.transaction_type)) totalIn += qty;
      else if (outTypes.has(r.transaction_type)) totalOut += qty;
      else if (r.transaction_type === 'ADJUSTMENT') totalAdjust += parseFloat(r.signed_qty);
    }

    res.json({
      rows,
      summary: {
        movement_count: rows.length,
        total_in: totalIn,
        total_out: totalOut,
        total_adjustment: totalAdjust,
        net_movement: totalIn - totalOut + totalAdjust,
      },
      period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Slow-moving items — in stock with no outbound movement in N days
router.get('/slow-moving', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 90;

    const result = await query(
      `SELECT p.id AS product_id, p.sku, p.name AS product_name, p.unit_of_measure,
              l.name AS location_name, i.quantity, i.unit_cost,
              (i.quantity * i.unit_cost) AS stock_value,
              last_out.last_movement_at,
              CASE
                WHEN last_out.last_movement_at IS NULL THEN NULL
                ELSE (CURRENT_DATE - last_out.last_movement_at::date)
              END AS days_since_movement
       FROM inventory i
       JOIN products p ON i.product_id = p.id
       JOIN locations l ON i.location_id = l.id
       LEFT JOIN LATERAL (
         SELECT MAX(il.created_at) AS last_movement_at
         FROM inventory_ledger il
         WHERE il.product_id = i.product_id
           AND il.location_id = i.location_id
           AND il.transaction_type IN ('OUT', 'TRANSFER_OUT', 'CONVERSION_OUT')
       ) last_out ON true
       WHERE i.quantity > 0 AND p.is_active = true
         AND (
           last_out.last_movement_at IS NULL
           OR last_out.last_movement_at::date <= CURRENT_DATE - $1::int
         )
       ORDER BY days_since_movement DESC NULLS FIRST, stock_value DESC`,
      [days]
    );

    const summary = {
      item_count: result.rows.length,
      total_qty: result.rows.reduce((s, r) => s + parseFloat(r.quantity || 0), 0),
      total_value: result.rows.reduce((s, r) => s + parseFloat(r.stock_value || 0), 0),
      days_threshold: days,
    };

    res.json({ rows: result.rows, summary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Count variance — posted physical inventory counts
router.get('/count-variance', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT ic.id AS count_id, ic.count_number, ic.count_date, ic.status, l.name AS location_name,
              p.sku, p.name AS product_name, p.unit_of_measure,
              ici.system_qty, ici.actual_qty, ici.variance, ici.unit_cost,
              (ici.variance * ici.unit_cost) AS variance_value
       FROM inventory_count_items ici
       JOIN inventory_counts ic ON ici.count_id = ic.id
       JOIN products p ON ici.product_id = p.id
       LEFT JOIN locations l ON ic.location_id = l.id
       WHERE ic.status = 'Posted'
         AND ic.count_date >= $1 AND ic.count_date <= $2
       ORDER BY ic.count_date DESC, ic.count_number, p.sku`,
      [from, to]
    );

    const rows = result.rows;
    const withVariance = rows.filter((r) => parseFloat(r.variance || 0) !== 0);
    let shrinkageQty = 0;
    let shrinkageValue = 0;
    let overageQty = 0;
    let overageValue = 0;
    for (const r of withVariance) {
      const v = parseFloat(r.variance || 0);
      const vv = parseFloat(r.variance_value || 0);
      if (v < 0) { shrinkageQty += Math.abs(v); shrinkageValue += Math.abs(vv); }
      else { overageQty += v; overageValue += vv; }
    }

    const countIds = new Set(rows.map((r) => r.count_id));

    res.json({
      rows: withVariance,
      all_items: rows.length,
      summary: {
        count_sessions: countIds.size,
        items_counted: rows.length,
        items_with_variance: withVariance.length,
        shrinkage_qty: shrinkageQty,
        shrinkage_value: shrinkageValue,
        overage_qty: overageQty,
        overage_value: overageValue,
        net_variance_value: overageValue - shrinkageValue,
      },
      period: { from, to },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Purchase register
router.get('/purchases', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];
    const supplier_id = req.query.supplier_id as string;

    let whereClause = 'WHERE po.status NOT IN (\'Cancelled\') AND po.order_date >= $1 AND po.order_date <= $2';
    const params: any[] = [from, to];
    let paramIndex = 3;

    if (supplier_id) { whereClause += ` AND po.supplier_id = $${paramIndex}`; params.push(supplier_id); paramIndex++; }

    const result = await query(
      `SELECT po.id, po.po_number, po.order_date, po.expected_date, po.status, po.payment_terms,
              po.subtotal, po.discount, po.tax, po.vat_mode, po.vat_amount, po.vatable_amount, po.total,
              s.supplier_name, s.supplier_code, s.tin as supplier_tin
       FROM purchase_orders po
       LEFT JOIN suppliers s ON po.supplier_id = s.id
       ${whereClause}
       ORDER BY po.order_date DESC, po.po_number DESC`,
      params
    );

    const summary = await query(
      `SELECT COUNT(*)::int AS order_count,
              COALESCE(SUM(po.subtotal), 0) AS subtotal,
              COALESCE(SUM(po.discount), 0) AS discount,
              COALESCE(SUM(po.tax), 0) AS tax,
              COALESCE(SUM(po.vat_amount), 0) AS vat_amount,
              COALESCE(SUM(po.total), 0) AS total
       FROM purchase_orders po
       ${whereClause}`,
      params
    );

    res.json({ rows: result.rows, summary: summary.rows[0], period: { from, to } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AR aging (open sales invoices)
router.get('/ar-aging', authenticate, hasUserPerm('reports.view'), async (_req: AuthRequest, res: Response) => {
  try {
    const report = await getArAgingReport();
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AP aging (open AP vouchers)
router.get('/ap-aging', authenticate, hasUserPerm('reports.view'), async (_req: AuthRequest, res: Response) => {
  try {
    const report = await getApAgingReport();
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Sales invoice register
router.get('/sales-invoice-register', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT si.id, si.invoice_number, si.invoice_date, si.due_date, si.status, si.payment_terms,
              si.customer_name, c.customer_code, c.tin AS customer_tin,
              si.subtotal, si.discount, si.vatable_sales, si.vat_amount, si.total,
              si.amount_paid, si.balance
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       WHERE si.invoice_date >= $1 AND si.invoice_date <= $2
         AND si.status NOT IN ('Void', 'Cancelled', 'Draft')
       ORDER BY si.invoice_date DESC, si.invoice_number DESC`,
      [from, to]
    );

    const summary = await query(
      `SELECT COUNT(*)::int AS invoice_count,
              COALESCE(SUM(si.subtotal), 0) AS subtotal,
              COALESCE(SUM(si.discount), 0) AS discount,
              COALESCE(SUM(si.vatable_sales), 0) AS vatable_sales,
              COALESCE(SUM(si.vat_amount), 0) AS vat_amount,
              COALESCE(SUM(si.total), 0) AS total,
              COALESCE(SUM(si.amount_paid), 0) AS amount_paid,
              COALESCE(SUM(si.balance), 0) AS balance
       FROM sales_invoices si
       WHERE si.invoice_date >= $1 AND si.invoice_date <= $2
         AND si.status NOT IN ('Void', 'Cancelled', 'Draft')`,
      [from, to]
    );

    res.json({ rows: result.rows, summary: summary.rows[0], period: { from, to } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function calcMarginPct(sales: number, cost: number): number {
  return sales > 0 ? Math.round(((sales - cost) / sales) * 10000) / 100 : 0;
}

// Consolidated sales & gross profit (POS + credit invoices)
router.get('/consolidated-sales', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const pos = await query(
      `SELECT COUNT(*)::int AS doc_count,
              COALESCE(SUM(pt.total), 0) AS sales,
              COALESCE(SUM((SELECT SUM(pti.cost * pti.quantity) FROM pos_transaction_items pti WHERE pti.transaction_id = pt.id)), 0) AS cost
       FROM pos_transactions pt
       WHERE pt.created_at::date >= $1 AND pt.created_at::date <= $2 AND pt.status = 'Completed'`,
      [from, to]
    );

    const credit = await query(
      `SELECT COUNT(*)::int AS doc_count,
              COALESCE(SUM(si.total), 0) AS sales,
              COALESCE(SUM((SELECT SUM(sii.cost * sii.quantity) FROM sales_invoice_items sii WHERE sii.invoice_id = si.id)), 0) AS cost
       FROM sales_invoices si
       WHERE si.invoice_date >= $1 AND si.invoice_date <= $2
         AND si.status NOT IN ('Void', 'Cancelled', 'Draft')`,
      [from, to]
    );

    const posRow = pos.rows[0];
    const creditRow = credit.rows[0];
    const posSales = parseFloat(posRow.sales);
    const posCost = parseFloat(posRow.cost);
    const creditSales = parseFloat(creditRow.sales);
    const creditCost = parseFloat(creditRow.cost);
    const totalSales = posSales + creditSales;
    const totalCost = posCost + creditCost;
    const grossProfit = totalSales - totalCost;

    const daily = await query(
      `WITH pos_daily AS (
         SELECT pt.created_at::date AS sale_date,
                COUNT(*)::int AS pos_count,
                COALESCE(SUM(pt.total), 0) AS pos_sales,
                COALESCE(SUM((SELECT SUM(pti.cost * pti.quantity) FROM pos_transaction_items pti WHERE pti.transaction_id = pt.id)), 0) AS pos_cost
         FROM pos_transactions pt
         WHERE pt.created_at::date >= $1 AND pt.created_at::date <= $2 AND pt.status = 'Completed'
         GROUP BY pt.created_at::date
       ),
       credit_daily AS (
         SELECT si.invoice_date AS sale_date,
                COUNT(*)::int AS credit_count,
                COALESCE(SUM(si.total), 0) AS credit_sales,
                COALESCE(SUM((SELECT SUM(sii.cost * sii.quantity) FROM sales_invoice_items sii WHERE sii.invoice_id = si.id)), 0) AS credit_cost
         FROM sales_invoices si
         WHERE si.invoice_date >= $1 AND si.invoice_date <= $2
           AND si.status NOT IN ('Void', 'Cancelled', 'Draft')
         GROUP BY si.invoice_date
       )
       SELECT COALESCE(p.sale_date, c.sale_date) AS sale_date,
              COALESCE(p.pos_count, 0) AS pos_count,
              COALESCE(c.credit_count, 0) AS credit_count,
              COALESCE(p.pos_sales, 0) AS pos_sales,
              COALESCE(c.credit_sales, 0) AS credit_sales,
              COALESCE(p.pos_cost, 0) AS pos_cost,
              COALESCE(c.credit_cost, 0) AS credit_cost
       FROM pos_daily p
       FULL OUTER JOIN credit_daily c ON p.sale_date = c.sale_date
       ORDER BY sale_date DESC`,
      [from, to]
    );

    const dailyRows = daily.rows.map((r: any) => {
      const pSales = parseFloat(r.pos_sales);
      const cSales = parseFloat(r.credit_sales);
      const pCost = parseFloat(r.pos_cost);
      const cCost = parseFloat(r.credit_cost);
      const daySales = pSales + cSales;
      const dayCost = pCost + cCost;
      return {
        ...r,
        total_sales: daySales,
        total_cost: dayCost,
        gross_profit: daySales - dayCost,
        margin_pct: calcMarginPct(daySales, dayCost),
      };
    });

    res.json({
      period: { from, to },
      summary: {
        pos_sales: posSales,
        pos_cost: posCost,
        pos_gp: posSales - posCost,
        pos_margin_pct: calcMarginPct(posSales, posCost),
        pos_doc_count: parseInt(posRow.doc_count || 0),
        credit_sales: creditSales,
        credit_cost: creditCost,
        credit_gp: creditSales - creditCost,
        credit_margin_pct: calcMarginPct(creditSales, creditCost),
        credit_doc_count: parseInt(creditRow.doc_count || 0),
        total_sales: totalSales,
        total_cost: totalCost,
        gross_profit: grossProfit,
        margin_pct: calcMarginPct(totalSales, totalCost),
      },
      by_channel: [
        {
          channel: 'POS',
          doc_count: parseInt(posRow.doc_count || 0),
          sales: posSales,
          cost: posCost,
          gross_profit: posSales - posCost,
          margin_pct: calcMarginPct(posSales, posCost),
        },
        {
          channel: 'Credit',
          doc_count: parseInt(creditRow.doc_count || 0),
          sales: creditSales,
          cost: creditCost,
          gross_profit: creditSales - creditCost,
          margin_pct: calcMarginPct(creditSales, creditCost),
        },
      ],
      daily: dailyRows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function fulfillmentStage(row: any): string {
  const status = row.status;
  const orderValue = parseFloat(row.order_value || 0);
  const invoiced = parseFloat(row.invoiced_amount || 0);
  const invoiceCount = parseInt(row.invoice_count || 0, 10);
  const remaining = parseFloat(row.total_remaining_qty || 0);
  const delivered = parseFloat(row.total_delivered_qty || 0);

  if (status === 'Closed') return 'Closed';
  if (status === 'Invoiced' || (invoiceCount > 0 && orderValue > 0 && invoiced >= orderValue * 0.99)) return 'Invoiced';
  if (remaining <= 0 && delivered > 0) return 'Fully Delivered';
  if (delivered > 0 || status === 'Partially Delivered') return 'Partially Delivered';
  return 'Pending Delivery';
}

// Delivery fulfillment — SO → DR → SI pipeline
router.get('/delivery-fulfillment', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT so.id, so.so_number, so.order_date, so.delivery_date, so.status, so.customer_name,
              so.total AS order_value,
              COALESCE(so.total_ordered_qty, 0) AS total_ordered_qty,
              COALESCE(so.total_delivered_qty, 0) AS total_delivered_qty,
              COALESCE(so.total_remaining_qty, 0) AS total_remaining_qty,
              (SELECT COUNT(*)::int FROM delivery_notes dn WHERE dn.so_id = so.id AND dn.status = 'Posted') AS dr_posted_count,
              (SELECT COUNT(*)::int FROM delivery_notes dn WHERE dn.so_id = so.id AND dn.status = 'Draft') AS dr_draft_count,
              (SELECT COALESCE(SUM(si.total), 0) FROM sales_invoices si
               WHERE si.so_id = so.id AND si.status NOT IN ('Void', 'Cancelled', 'Draft')) AS invoiced_amount,
              (SELECT COUNT(*)::int FROM sales_invoices si
               WHERE si.so_id = so.id AND si.status NOT IN ('Void', 'Cancelled', 'Draft')) AS invoice_count,
              CASE WHEN COALESCE(so.total_ordered_qty, 0) > 0
                THEN ROUND((COALESCE(so.total_delivered_qty, 0) / so.total_ordered_qty) * 100, 2)
                ELSE 0 END AS delivery_pct
       FROM sales_orders so
       WHERE so.status NOT IN ('Draft', 'Cancelled')
         AND so.order_date >= $1 AND so.order_date <= $2
       ORDER BY so.order_date DESC, so.so_number DESC`,
      [from, to]
    );

    const rows = result.rows.map((r: any) => ({
      ...r,
      fulfillment_stage: fulfillmentStage(r),
      uninvoiced_amount: Math.max(0, parseFloat(r.order_value || 0) - parseFloat(r.invoiced_amount || 0)),
    }));

    const summary = {
      order_count: rows.length,
      pending_delivery: rows.filter((r) => r.fulfillment_stage === 'Pending Delivery').length,
      partially_delivered: rows.filter((r) => r.fulfillment_stage === 'Partially Delivered').length,
      fully_delivered: rows.filter((r) => r.fulfillment_stage === 'Fully Delivered').length,
      invoiced: rows.filter((r) => r.fulfillment_stage === 'Invoiced').length,
      closed: rows.filter((r) => r.fulfillment_stage === 'Closed').length,
      total_order_value: rows.reduce((s, r) => s + parseFloat(r.order_value || 0), 0),
      total_invoiced: rows.reduce((s, r) => s + parseFloat(r.invoiced_amount || 0), 0),
      pending_qty: rows.reduce((s, r) => s + parseFloat(r.total_remaining_qty || 0), 0),
    };

    res.json({ rows, summary, period: { from, to } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// VAT report (enhanced — POS + credit sales output; APV input)
router.get('/vat', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const pos = await query(
      `SELECT COALESCE(SUM(tax_total), 0) AS output_vat,
              COALESCE(SUM(total - tax_total), 0) AS vatable_sales,
              COALESCE(SUM(total), 0) AS gross_sales,
              COUNT(*)::int AS doc_count
       FROM pos_transactions
       WHERE created_at::date >= $1 AND created_at::date <= $2 AND status = 'Completed'`,
      [from, to]
    );

    const credit = await query(
      `SELECT COALESCE(SUM(vat_amount), 0) AS output_vat,
              COALESCE(SUM(vatable_sales), 0) AS vatable_sales,
              COALESCE(SUM(vat_exempt_sales), 0) AS exempt_sales,
              COALESCE(SUM(zero_rated_sales), 0) AS zero_rated_sales,
              COALESCE(SUM(total), 0) AS gross_sales,
              COUNT(*)::int AS doc_count
       FROM sales_invoices
       WHERE invoice_date >= $1 AND invoice_date <= $2
         AND status NOT IN ('Void', 'Cancelled', 'Draft')`,
      [from, to]
    );

    const apv = await query(
      `SELECT COALESCE(SUM(vat_amount), 0) AS input_vat,
              COALESCE(SUM(vatable_amount), 0) AS vatable_purchases,
              COALESCE(SUM(gross_amount), 0) AS gross_purchases,
              COUNT(*)::int AS doc_count
       FROM ap_vouchers
       WHERE apv_date >= $1 AND apv_date <= $2
         AND status NOT IN ('Draft', 'Cancelled')`,
      [from, to]
    );

    const po = await query(
      `SELECT COALESCE(SUM(tax), 0) AS input_vat,
              COALESCE(SUM(vatable_amount), 0) AS vatable_purchases,
              COALESCE(SUM(total), 0) AS gross_purchases,
              COUNT(*)::int AS doc_count
       FROM purchase_orders
       WHERE order_date >= $1 AND order_date <= $2
         AND status IN ('Received', 'Partial', 'Paid', 'Sent')`,
      [from, to]
    );

    const posRow = pos.rows[0];
    const creditRow = credit.rows[0];
    const apvRow = apv.rows[0];
    const poRow = po.rows[0];

    const posOutputVat = parseFloat(posRow.output_vat);
    const creditOutputVat = parseFloat(creditRow.output_vat);
    const outputVat = posOutputVat + creditOutputVat;

    const apvInputVat = parseFloat(apvRow.input_vat);
    const poInputVat = parseFloat(poRow.input_vat);
    const inputVat = apvInputVat > 0 ? apvInputVat : poInputVat;

    res.json({
      period: { from, to },
      output: {
        pos_vat: posOutputVat,
        pos_vatable: parseFloat(posRow.vatable_sales),
        pos_gross: parseFloat(posRow.gross_sales),
        pos_count: parseInt(posRow.doc_count || 0, 10),
        credit_vat: creditOutputVat,
        credit_vatable: parseFloat(creditRow.vatable_sales),
        credit_exempt: parseFloat(creditRow.exempt_sales),
        credit_zero_rated: parseFloat(creditRow.zero_rated_sales),
        credit_gross: parseFloat(creditRow.gross_sales),
        credit_count: parseInt(creditRow.doc_count || 0, 10),
        total_vat: outputVat,
        total_vatable: parseFloat(posRow.vatable_sales) + parseFloat(creditRow.vatable_sales),
        total_exempt: parseFloat(creditRow.exempt_sales),
        total_zero_rated: parseFloat(creditRow.zero_rated_sales),
      },
      input: {
        apv_vat: apvInputVat,
        apv_vatable: parseFloat(apvRow.vatable_purchases),
        apv_gross: parseFloat(apvRow.gross_purchases),
        apv_count: parseInt(apvRow.doc_count || 0, 10),
        po_vat: poInputVat,
        po_vatable: parseFloat(poRow.vatable_purchases),
        po_gross: parseFloat(poRow.gross_purchases),
        po_count: parseInt(poRow.doc_count || 0, 10),
        total_vat: inputVat,
        source: apvInputVat > 0 ? 'APV' : (poInputVat > 0 ? 'PO' : 'None'),
      },
      output_vat: outputVat,
      input_vat: inputVat,
      vat_payable: outputVat - inputVat,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Withholding tax report (EWT + LGU)
router.get('/withholding-tax', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const invoiceRows = await query(
      `SELECT si.id, si.invoice_number, si.invoice_date, si.customer_name, c.customer_code, c.tin AS customer_tin,
              si.total, si.withholding_tax AS ewt_amount, si.lgu_final_tax AS lgu_amount, si.status
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       WHERE si.invoice_date >= $1 AND si.invoice_date <= $2
         AND si.status NOT IN ('Void', 'Cancelled', 'Draft')
         AND (COALESCE(si.withholding_tax, 0) > 0 OR COALESCE(si.lgu_final_tax, 0) > 0)
       ORDER BY si.invoice_date DESC, si.invoice_number DESC`,
      [from, to]
    );

    const collectionRows = await query(
      `SELECT cr.id, cr.receipt_number, cr.payment_date, c.customer_name, c.customer_code, c.tin AS customer_tin,
              si.invoice_number, cra.applied_amount, cra.ewt_amount, cra.lgu_amount
       FROM collection_receipt_allocations cra
       JOIN collection_receipts cr ON cra.receipt_id = cr.id
       JOIN sales_invoices si ON cra.invoice_id = si.id
       LEFT JOIN customers c ON cr.customer_id = c.id
       WHERE cr.payment_date >= $1 AND cr.payment_date <= $2
         AND cr.status = 'Posted'
         AND (COALESCE(cra.ewt_amount, 0) > 0 OR COALESCE(cra.lgu_amount, 0) > 0)
       ORDER BY cr.payment_date DESC, cr.receipt_number DESC`,
      [from, to]
    );

    const invEwt = invoiceRows.rows.reduce((s, r) => s + parseFloat(r.ewt_amount || 0), 0);
    const invLgu = invoiceRows.rows.reduce((s, r) => s + parseFloat(r.lgu_amount || 0), 0);
    const colEwt = collectionRows.rows.reduce((s, r) => s + parseFloat(r.ewt_amount || 0), 0);
    const colLgu = collectionRows.rows.reduce((s, r) => s + parseFloat(r.lgu_amount || 0), 0);

    res.json({
      period: { from, to },
      summary: {
        invoice_ewt: invEwt,
        invoice_lgu: invLgu,
        collected_ewt: colEwt,
        collected_lgu: colLgu,
        total_ewt: invEwt + colEwt,
        total_lgu: invLgu + colLgu,
        invoice_count: invoiceRows.rows.length,
        collection_count: collectionRows.rows.length,
      },
      invoice_rows: invoiceRows.rows,
      collection_rows: collectionRows.rows,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// SLSP — Summary List of Sales (BIR)
router.get('/slsp-sales', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const posRows = await query(
      `SELECT pt.id, pt.transaction_number AS doc_number, pt.created_at::date AS doc_date,
              'POS' AS source, COALESCE(c.tin, '') AS customer_tin,
              COALESCE(c.customer_name, pt.customer_name, 'Walk-in') AS customer_name,
              COALESCE(pt.total, 0) AS gross_sales,
              0::numeric AS exempt_sales,
              0::numeric AS zero_rated_sales,
              COALESCE(pt.total - pt.tax_total, 0) AS vatable_sales,
              COALESCE(pt.tax_total, 0) AS output_vat
       FROM pos_transactions pt
       LEFT JOIN customers c ON pt.customer_id = c.id
       WHERE pt.created_at::date >= $1 AND pt.created_at::date <= $2 AND pt.status = 'Completed'
       ORDER BY pt.created_at::date DESC, pt.transaction_number DESC`,
      [from, to]
    );

    const creditRows = await query(
      `SELECT si.id, si.invoice_number AS doc_number, si.invoice_date AS doc_date,
              'Credit' AS source, COALESCE(c.tin, '') AS customer_tin,
              COALESCE(si.customer_name, c.customer_name, '') AS customer_name,
              COALESCE(si.total, 0) AS gross_sales,
              COALESCE(si.vat_exempt_sales, 0) AS exempt_sales,
              COALESCE(si.zero_rated_sales, 0) AS zero_rated_sales,
              COALESCE(si.vatable_sales, 0) AS vatable_sales,
              COALESCE(si.vat_amount, 0) AS output_vat
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       WHERE si.invoice_date >= $1 AND si.invoice_date <= $2
         AND si.status NOT IN ('Void', 'Cancelled', 'Draft')
       ORDER BY si.invoice_date DESC, si.invoice_number DESC`,
      [from, to]
    );

    const rows = [...posRows.rows, ...creditRows.rows].sort((a, b) => {
      const da = new Date(a.doc_date).getTime();
      const db = new Date(b.doc_date).getTime();
      return db - da || String(b.doc_number).localeCompare(String(a.doc_number));
    });

    const summary = rows.reduce((acc, r) => {
      acc.row_count += 1;
      acc.gross_sales += parseFloat(r.gross_sales || 0);
      acc.vatable_sales += parseFloat(r.vatable_sales || 0);
      acc.exempt_sales += parseFloat(r.exempt_sales || 0);
      acc.zero_rated_sales += parseFloat(r.zero_rated_sales || 0);
      acc.output_vat += parseFloat(r.output_vat || 0);
      return acc;
    }, { row_count: 0, gross_sales: 0, vatable_sales: 0, exempt_sales: 0, zero_rated_sales: 0, output_vat: 0 });

    res.json({ rows, summary, period: { from, to } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// SLSP — Summary List of Purchases (BIR)
router.get('/slsp-purchases', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT a.id, a.apv_number AS doc_number, a.apv_date AS doc_date,
              COALESCE(a.supplier_invoice_number, a.apv_number) AS supplier_invoice_number,
              a.supplier_invoice_date,
              s.supplier_name, s.supplier_code, s.tin AS supplier_tin,
              COALESCE(a.gross_amount, 0) AS gross_purchases,
              COALESCE(a.gross_amount - a.vatable_amount - a.vat_amount, 0) AS exempt_purchases,
              0::numeric AS zero_rated_purchases,
              COALESCE(a.vatable_amount, 0) AS vatable_purchases,
              COALESCE(a.vat_amount, 0) AS input_vat,
              a.status
       FROM ap_vouchers a
       LEFT JOIN suppliers s ON a.supplier_id = s.id
       WHERE a.apv_date >= $1 AND a.apv_date <= $2
         AND a.status NOT IN ('Draft', 'Cancelled')
       ORDER BY a.apv_date DESC, a.apv_number DESC`,
      [from, to]
    );

    const summary = result.rows.reduce((acc, r) => {
      acc.row_count += 1;
      acc.gross_purchases += parseFloat(r.gross_purchases || 0);
      acc.vatable_purchases += parseFloat(r.vatable_purchases || 0);
      acc.exempt_purchases += Math.max(0, parseFloat(r.exempt_purchases || 0));
      acc.input_vat += parseFloat(r.input_vat || 0);
      return acc;
    }, { row_count: 0, gross_purchases: 0, vatable_purchases: 0, exempt_purchases: 0, zero_rated_purchases: 0, input_vat: 0 });

    res.json({ rows: result.rows, summary, period: { from, to } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Daily payables — supplier payments (Cash & Check) by payment_date
router.get('/daily-payables', authenticate, hasUserPerm('reports.daily-payables'), async (req: AuthRequest, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    const rows = await query(
      `SELECT pv.id, pv.voucher_number, pv.payment_date, pv.payment_method,
              pv.reference_number, pv.check_date, pv.check_bank, pv.amount, pv.notes,
              s.supplier_name, s.supplier_code, a.apv_number, po.po_number,
              u.full_name AS created_by_name, pv.created_at
       FROM payment_vouchers pv
       LEFT JOIN suppliers s ON pv.supplier_id = s.id
       LEFT JOIN ap_vouchers a ON pv.apv_id = a.id
       LEFT JOIN purchase_orders po ON pv.po_id = po.id
       LEFT JOIN users u ON pv.created_by = u.id
       WHERE pv.payment_date = $1
         AND pv.status = 'Posted'
         AND pv.payment_method IN ('Cash', 'Check')
       ORDER BY pv.created_at`,
      [date]
    );

    const summary = await query(
      `SELECT COUNT(*)::int AS transaction_count,
              COALESCE(SUM(amount), 0) AS total,
              COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN amount ELSE 0 END), 0) AS cash_total,
              COALESCE(SUM(CASE WHEN payment_method = 'Check' THEN amount ELSE 0 END), 0) AS check_total
       FROM payment_vouchers
       WHERE payment_date = $1 AND status = 'Posted' AND payment_method IN ('Cash', 'Check')`,
      [date]
    );

    res.json({ date, rows: rows.rows, summary: summary.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Daily receivables — customer collections (Cash & Check) by payment_date
router.get('/daily-receivables', authenticate, hasUserPerm('reports.daily-receivables'), async (req: AuthRequest, res: Response) => {
  try {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    const rows = await query(
      `SELECT cr.id, cr.receipt_number, cr.payment_date, cr.payment_method,
              cr.reference_number, cr.check_date, cr.check_bank, cr.notes, cr.amount AS applied_amount,
              c.customer_name, c.customer_code,
              COALESCE(
                (SELECT SUM(cra.applied_amount - cra.ewt_amount - cra.lgu_amount)
                 FROM collection_receipt_allocations cra WHERE cra.receipt_id = cr.id),
                cr.amount
              ) AS amount_received,
              u.full_name AS created_by_name, cr.created_at
       FROM collection_receipts cr
       LEFT JOIN customers c ON cr.customer_id = c.id
       LEFT JOIN users u ON cr.created_by = u.id
       WHERE cr.payment_date = $1
         AND cr.status = 'Posted'
         AND cr.payment_method IN ('Cash', 'Check')
       ORDER BY cr.created_at`,
      [date]
    );

    const withAmounts = rows.rows.map((r: any) => ({
      ...r,
      amount_received: parseFloat(r.amount_received || 0),
    }));

    let cashTotal = 0;
    let checkTotal = 0;
    for (const r of withAmounts) {
      const amt = r.amount_received;
      if (r.payment_method === 'Cash') cashTotal += amt;
      else if (r.payment_method === 'Check') checkTotal += amt;
    }

    res.json({
      date,
      rows: withAmounts,
      summary: {
        transaction_count: withAmounts.length,
        total: cashTotal + checkTotal,
        cash_total: cashTotal,
        check_total: checkTotal,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const CATEGORY_MARGIN_PAIRS: Array<[string, string, string]> = [
  ['4010', '5110', 'Fish'],
  ['4011', '5111', 'Vegetable'],
  ['4012', '5112', 'Pork Meat'],
  ['4013', '5113', 'Beef Meat'],
  ['4014', '5114', 'Frozen Foods'],
];

// Category gross profit from GL (401x sales vs 511x COGS)
router.get('/category-margin', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];
    const codes = CATEGORY_MARGIN_PAIRS.flatMap(([rev, cogs]) => [rev, cogs]);

    const balances = await query(
      `SELECT coa.account_code, coa.account_name, coa.account_type,
              ${COA_PERIOD_BALANCE_SUBQUERY('$1', '$2')} AS balance
       FROM chart_of_accounts coa
       WHERE coa.account_code = ANY($3::text[])
       ORDER BY coa.account_code`,
      [from, to, codes],
    );

    const balanceMap = new Map<string, number>();
    for (const row of balances.rows) {
      balanceMap.set(row.account_code, parseFloat(row.balance || 0));
    }

    const rows = CATEGORY_MARGIN_PAIRS.map(([revenueCode, cogsCode, category]) => {
      const sales = balanceMap.get(revenueCode) || 0;
      const cogs = balanceMap.get(cogsCode) || 0;
      const grossProfit = sales - cogs;
      return {
        category,
        revenue_code: revenueCode,
        cogs_code: cogsCode,
        sales,
        cogs,
        gross_profit: grossProfit,
        margin_pct: sales > 0 ? Math.round((grossProfit / sales) * 10000) / 100 : 0,
      };
    });

    const summary = rows.reduce(
      (acc, r) => {
        acc.total_sales += r.sales;
        acc.total_cogs += r.cogs;
        acc.gross_profit += r.gross_profit;
        return acc;
      },
      { total_sales: 0, total_cogs: 0, gross_profit: 0, margin_pct: 0 },
    );
    summary.margin_pct = summary.total_sales > 0
      ? Math.round((summary.gross_profit / summary.total_sales) * 10000) / 100
      : 0;

    res.json({ period: { from, to }, rows, summary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reorder suggestions — low stock grouped by preferred supplier
router.get('/reorder-suggestions', authenticate, hasUserPerm('reports.view'), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await query(
      `SELECT p.id AS product_id, p.sku, p.name AS product_name, p.unit_of_measure, p.reorder_level, p.cost,
              COALESCE(SUM(i.quantity), 0) AS on_hand,
              GREATEST(p.reorder_level - COALESCE(SUM(i.quantity), 0), p.reorder_level) AS suggested_qty,
              sci.supplier_id, s.supplier_name,
              COALESCE(sph.unit_cost, p.cost, 0) AS est_unit_cost
       FROM products p
       LEFT JOIN inventory i ON i.product_id = p.id
       LEFT JOIN LATERAL (
         SELECT supplier_id
         FROM supplier_catalog_items
         WHERE product_id = p.id AND is_active = true
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 1
       ) sci ON true
       LEFT JOIN suppliers s ON s.id = sci.supplier_id
       LEFT JOIN LATERAL (
         SELECT unit_cost FROM supplier_price_history
         WHERE product_id = p.id AND supplier_id = sci.supplier_id
         ORDER BY received_date DESC NULLS LAST
         LIMIT 1
       ) sph ON true
       WHERE p.is_active = true AND p.reorder_level > 0
       GROUP BY p.id, p.sku, p.name, p.unit_of_measure, p.reorder_level, p.cost, sci.supplier_id, s.supplier_name, sph.unit_cost
       HAVING COALESCE(SUM(i.quantity), 0) <= p.reorder_level
       ORDER BY s.supplier_name NULLS LAST, p.name`,
    );

    const bySupplier = new Map<string, { supplier_id: number | null; supplier_name: string; items: any[]; total_suggested_qty: number }>();
    for (const row of result.rows) {
      const key = row.supplier_id ? String(row.supplier_id) : '_none';
      const name = row.supplier_name || 'No Supplier Catalog';
      if (!bySupplier.has(key)) {
        bySupplier.set(key, { supplier_id: row.supplier_id, supplier_name: name, items: [], total_suggested_qty: 0 });
      }
      const grp = bySupplier.get(key)!;
      grp.items.push(row);
      grp.total_suggested_qty += parseFloat(row.suggested_qty || 0);
    }

    res.json({
      rows: result.rows,
      suppliers: [...bySupplier.values()],
      summary: {
        product_count: result.rows.length,
        supplier_count: bySupplier.size,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Dispatch list — DRs scheduled for delivery
router.get('/dispatch-list', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || from;
    const result = await query(
      `SELECT dn.id, dn.dr_number, dn.delivery_date, dn.driver_name, dn.vehicle_plate, dn.dispatch_notes,
              dn.delivery_address, dn.total_qty, dn.status, c.customer_name, so.so_number
       FROM delivery_notes dn
       LEFT JOIN customers c ON c.id = dn.customer_id
       LEFT JOIN sales_orders so ON so.id = dn.so_id
       WHERE dn.delivery_date >= $1 AND dn.delivery_date <= $2
         AND dn.status IN ('Posted', 'Draft')
       ORDER BY dn.delivery_date ASC, dn.dr_number ASC`,
      [from, to],
    );
    res.json({ rows: result.rows, period: { from, to }, summary: { count: result.rows.length } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// BIR Form 2550Q worksheet (quarterly VAT return prep)
router.get('/bir-2550q', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    const to = req.query.to as string || new Date().toISOString().split('T')[0];
    const worksheet = await buildBir2550qWorksheet(from, to);
    res.json(worksheet);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Branch / location consolidation
router.get('/branch-summary', authenticate, hasUserPerm('reports.view'), async (req: AuthRequest, res: Response) => {
  try {
    const from = req.query.from as string || new Date().toISOString().split('T')[0];
    const to = req.query.to as string || from;

    const locations = await query(
      `SELECT l.id, l.name, l.type,
              COALESCE(SUM(i.quantity * i.unit_cost), 0) AS inventory_value,
              COALESCE(SUM(i.quantity), 0) AS total_qty
       FROM locations l
       LEFT JOIN inventory i ON i.location_id = l.id
       WHERE l.is_active = true
       GROUP BY l.id, l.name, l.type
       ORDER BY l.type, l.name`,
    );

    const creditSales = await query(
      `SELECT sii.location_id, COALESCE(SUM(sii.total), 0) AS credit_sales,
              COALESCE(SUM(sii.quantity * sii.cost), 0) AS cogs
       FROM sales_invoice_items sii
       JOIN sales_invoices si ON si.id = sii.invoice_id
       WHERE si.invoice_date >= $1 AND si.invoice_date <= $2
         AND si.status NOT IN ('Void', 'Cancelled', 'Draft')
       GROUP BY sii.location_id`,
      [from, to],
    );
    const creditMap = new Map<number, { credit_sales: number; cogs: number }>();
    for (const row of creditSales.rows) {
      creditMap.set(row.location_id || 1, {
        credit_sales: parseFloat(row.credit_sales),
        cogs: parseFloat(row.cogs),
      });
    }

    const rows = locations.rows.map((loc: any) => {
      const sales = creditMap.get(loc.id) || { credit_sales: 0, cogs: 0 };
      const invVal = parseFloat(loc.inventory_value);
      const creditSalesAmt = sales.credit_sales;
      const cogs = sales.cogs;
      return {
        location_id: loc.id,
        location_name: loc.name,
        location_type: loc.type,
        inventory_value: invVal,
        total_qty: parseFloat(loc.total_qty),
        credit_sales: creditSalesAmt,
        cogs,
        gross_profit: creditSalesAmt - cogs,
      };
    });

    const summary = {
      location_count: rows.length,
      total_inventory_value: rows.reduce((s, r) => s + r.inventory_value, 0),
      total_credit_sales: rows.reduce((s, r) => s + r.credit_sales, 0),
      total_cogs: rows.reduce((s, r) => s + r.cogs, 0),
      gross_profit: rows.reduce((s, r) => s + r.gross_profit, 0),
    };

    res.json({ period: { from, to }, rows, summary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

