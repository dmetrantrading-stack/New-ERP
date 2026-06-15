import { Router, Response } from 'express';
import { query } from '../../config/database';
import { authenticate, AuthRequest } from '../../middleware/auth';
import { auditLog } from '../../middleware/audit';
import { AppError } from '../../middleware/errorHandler';

const router = Router();

// Save supplier price history from goods receipt
export const savePriceHistoryFromGR = async (
  client: any,
  data: {
    product_id: string;
    supplier_id: number;
    product_name: string;
    supplier_name: string;
    po_id: string;
    po_number: string;
    gr_id: string;
    gr_number: string;
    gr_item_id: string;
    received_date: string;
    unit_cost: number;
    quantity_received: number;
    uom: string;
    location_id: number;
    location_name: string;
    batch_number: string;
    expiry_date: string;
    created_by: string;
    remarks: string;
  }
) => {
  // Get previous cost for this product from last history entry with this supplier
  const prev = await client.query(
    `SELECT unit_cost FROM supplier_price_history
     WHERE product_id = $1 AND supplier_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [data.product_id, data.supplier_id]
  );
  const previous_cost = prev.rows.length > 0 ? parseFloat(prev.rows[0].unit_cost) : 0;
  const price_difference = data.unit_cost - previous_cost;

  // Check for duplicate (same GR item)
  const dup = await client.query(
    `SELECT id FROM supplier_price_history
     WHERE product_id = $1 AND supplier_id = $2 AND gr_id = $3 AND gr_item_id = $4`,
    [data.product_id, data.supplier_id, data.gr_id, data.gr_item_id]
  );
  if (dup.rows.length > 0) return;

  await client.query(
    `INSERT INTO supplier_price_history
     (id, product_id, supplier_id, product_name, supplier_name,
      po_id, po_number, gr_id, gr_number, gr_item_id,
      received_date, unit_cost, previous_cost, price_difference,
      quantity_received, uom, location_id, location_name,
      batch_number, expiry_date, remarks, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
    [data.product_id, data.supplier_id, data.product_name, data.supplier_name,
     data.po_id, data.po_number, data.gr_id, data.gr_number, data.gr_item_id,
     data.received_date, data.unit_cost, previous_cost, price_difference,
     data.quantity_received, data.uom, data.location_id, data.location_name,
     data.batch_number, data.expiry_date, data.remarks, data.created_by]
  );

};

// Get supplier price history for a product
router.get('/product/:productId', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { productId } = req.params;
    const { supplier_name, date_from, date_to, sort_by, sort_order } = req.query;

    let where = 'WHERE sph.product_id = $1';
    const params: any[] = [productId];
    let idx = 2;

    if (supplier_name) {
      where += ` AND sph.supplier_name ILIKE $${idx++}`;
      params.push(`%${supplier_name}%`);
    }
    if (date_from) {
      where += ` AND sph.received_date >= $${idx++}`;
      params.push(date_from);
    }
    if (date_to) {
      where += ` AND sph.received_date <= $${idx++}`;
      params.push(date_to);
    }

    let orderBy = 'sph.created_at DESC';
    if (sort_by === 'unit_cost') orderBy = `sph.unit_cost ${sort_order === 'asc' ? 'ASC' : 'DESC'}`;
    else if (sort_by === 'received_date') orderBy = `sph.received_date ${sort_order === 'asc' ? 'ASC' : 'DESC'}`;

    const result = await query(
      `SELECT sph.*, l.name as location_name_ref
       FROM supplier_price_history sph
       LEFT JOIN locations l ON sph.location_id = l.id
       ${where}
       ORDER BY ${orderBy}`,
      params
    );

    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get supplier price comparison for a product
router.get('/product/:productId/comparison', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { productId } = req.params;

    // Latest price per supplier
    const latestPrices = await query(
      `SELECT DISTINCT ON (sph.supplier_id)
        sph.supplier_id, sph.supplier_name, sph.unit_cost as latest_cost,
        sph.previous_cost, sph.price_difference,
        sph.received_date as last_purchase_date,
        sph.po_number, sph.gr_number,
        sph.quantity_received, sph.uom
       FROM supplier_price_history sph
       WHERE sph.product_id = $1
       ORDER BY sph.supplier_id, sph.created_at DESC`,
      [productId]
    );

    // Summary stats
    const stats = await query(
      `SELECT
        COUNT(DISTINCT supplier_id) as supplier_count,
        MIN(unit_cost) as cheapest_price,
        MAX(unit_cost) as highest_price,
        AVG(unit_cost) as avg_cost,
        (SELECT supplier_name FROM supplier_price_history
         WHERE product_id = $1 ORDER BY unit_cost ASC LIMIT 1) as cheapest_supplier,
        (SELECT supplier_name FROM supplier_price_history
         WHERE product_id = $1 ORDER BY unit_cost DESC LIMIT 1) as most_expensive_supplier
       FROM supplier_price_history
       WHERE product_id = $1`,
      [productId]
    );

    // Get current product cost
    const product = await query(
      `SELECT cost, name FROM products WHERE id = $1`,
      [productId]
    );

    // Trend analysis per supplier (compare first vs latest cost)
    const trends = await query(
      `SELECT supplier_id,
        (SELECT unit_cost FROM supplier_price_history
         WHERE product_id = $1 AND supplier_id = sph.supplier_id
         ORDER BY created_at DESC LIMIT 1) as latest,
        (SELECT unit_cost FROM supplier_price_history
         WHERE product_id = $1 AND supplier_id = sph.supplier_id
         ORDER BY created_at ASC LIMIT 1) as first
       FROM (SELECT DISTINCT supplier_id FROM supplier_price_history WHERE product_id = $1) sph`,
      [productId]
    );

    const trendMap: Record<number, string> = {};
    trends.rows.forEach((r: any) => {
      const latest = parseFloat(r.latest);
      const first = parseFloat(r.first);
      if (latest > first) trendMap[r.supplier_id] = 'Increased';
      else if (latest < first) trendMap[r.supplier_id] = 'Decreased';
      else trendMap[r.supplier_id] = 'No Change';
    });

    res.json({
      suppliers: latestPrices.rows.map((r: any) => ({
        ...r,
        latest_cost: parseFloat(r.latest_cost),
        previous_cost: parseFloat(r.previous_cost || 0),
        price_difference: parseFloat(r.price_difference || 0),
        trend: trendMap[r.supplier_id] || 'No Change',
        is_best_price: stats.rows[0]?.cheapest_price && parseFloat(r.latest_cost) === parseFloat(stats.rows[0].cheapest_price),
      })),
      stats: {
        supplier_count: parseInt(stats.rows[0]?.supplier_count || '0'),
        cheapest_supplier: stats.rows[0]?.cheapest_supplier || '',
        most_expensive_supplier: stats.rows[0]?.most_expensive_supplier || '',
        cheapest_price: parseFloat(stats.rows[0]?.cheapest_price || '0'),
        highest_price: parseFloat(stats.rows[0]?.highest_price || '0'),
        avg_cost: parseFloat(stats.rows[0]?.avg_cost || '0'),
        current_cost: parseFloat(product.rows[0]?.cost || '0'),
        last_purchase_price: latestPrices.rows.length > 0
          ? parseFloat(latestPrices.rows[0].latest_cost) : 0,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Supplier Price History Report
router.get('/report', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { supplier_id, product_id, date_from, date_to, format } = req.query;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (supplier_id) { where += ` AND sph.supplier_id = $${idx++}`; params.push(parseInt(supplier_id as string)); }
    if (product_id) { where += ` AND sph.product_id = $${idx++}`; params.push(product_id); }
    if (date_from) { where += ` AND sph.received_date >= $${idx++}`; params.push(date_from); }
    if (date_to) { where += ` AND sph.received_date <= $${idx++}`; params.push(date_to); }

    const result = await query(
      `SELECT sph.product_name, sph.supplier_name, sph.unit_cost as latest_cost,
        sph.previous_cost, sph.price_difference,
        CASE WHEN sph.previous_cost > 0
          THEN ROUND(((sph.unit_cost - sph.previous_cost) / sph.previous_cost * 100)::numeric, 2)
          ELSE 0
        END as difference_percent,
        sph.received_date as last_purchase_date,
        sph.po_number, sph.gr_number, sph.quantity_received, sph.uom
       FROM supplier_price_history sph
       ${where}
       ORDER BY sph.received_date DESC, sph.product_name`,
      params
    );

    if (format === 'csv') {
      const headerRow = ['Product','Supplier','Latest Cost','Previous Cost','Difference','Difference %','Last Purchase Date','PO Number','RR Number','Qty','UOM'];
      const esc = (v: any) => { const s = v == null ? '' : String(v); return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = '\uFEFF' + headerRow.join(',') + '\n' + result.rows.map((r: any) => [
        esc(r.product_name), esc(r.supplier_name), r.latest_cost, r.previous_cost,
        r.price_difference, r.difference_percent, r.last_purchase_date,
        esc(r.po_number), esc(r.gr_number), r.quantity_received, esc(r.uom),
      ].join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=supplier_price_history_report.csv');
      return res.send(csv);
    }

    if (format === 'xlsx') {
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(result.rows.map((r: any) => ({
        Product: r.product_name,
        Supplier: r.supplier_name,
        'Latest Cost': r.latest_cost,
        'Previous Cost': r.previous_cost,
        Difference: r.price_difference,
        'Difference %': r.difference_percent,
        'Last Purchase Date': r.last_purchase_date,
        'PO Number': r.po_number,
        'RR Number': r.gr_number,
        Qty: r.quantity_received,
        UOM: r.uom,
      })));
      XLSX.utils.book_append_sheet(wb, ws, 'Price History');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=supplier_price_history_report.xlsx');
      return res.send(buf);
    }

    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
