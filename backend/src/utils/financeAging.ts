import { query } from '../config/database';

export type AgingBuckets = {
  current: number;
  '1_30': number;
  '31_60': number;
  '61_90': number;
  over_90: number;
  no_due: number;
};

export type AgingReport = {
  rows: any[];
  buckets: AgingBuckets;
  total_outstanding: number;
  count: number;
};

function emptyBuckets(): AgingBuckets {
  return { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, over_90: 0, no_due: 0 };
}

function summarizeAging(rows: any[], balanceKey: string, bucketKey: string): AgingReport {
  const buckets = emptyBuckets();
  let totalOutstanding = 0;
  for (const row of rows) {
    const bal = parseFloat(row[balanceKey]) || 0;
    totalOutstanding += bal;
    const b = row[bucketKey] as keyof AgingBuckets;
    if (buckets[b] !== undefined) buckets[b] += bal;
  }
  return { rows, buckets, total_outstanding: totalOutstanding, count: rows.length };
}

/** AP aging from posted AP vouchers (authoritative for payables). */
export async function getApAgingReport(): Promise<AgingReport> {
  const r = await query(
    `SELECT a.id, a.apv_number, a.supplier_id, s.supplier_name, s.supplier_code,
            a.apv_date, a.due_date, a.total_amount, a.amount_paid,
            (a.total_amount - COALESCE(a.amount_paid, 0)) as balance_due, a.status, a.po_id, a.gr_id,
            po.po_number, gr.gr_number,
            CASE
              WHEN a.due_date IS NULL THEN 'no_due'
              WHEN a.due_date >= CURRENT_DATE THEN 'current'
              WHEN CURRENT_DATE - a.due_date BETWEEN 1 AND 30 THEN '1_30'
              WHEN CURRENT_DATE - a.due_date BETWEEN 31 AND 60 THEN '31_60'
              WHEN CURRENT_DATE - a.due_date BETWEEN 61 AND 90 THEN '61_90'
              ELSE 'over_90'
            END as aging_bucket
     FROM ap_vouchers a
     LEFT JOIN suppliers s ON a.supplier_id = s.id
     LEFT JOIN purchase_orders po ON a.po_id = po.id
     LEFT JOIN goods_receipts gr ON a.gr_id = gr.id
     WHERE a.status IN ('Posted', 'Partially Paid')
       AND a.total_amount > COALESCE(a.amount_paid, 0)
     ORDER BY COALESCE(a.due_date, a.apv_date) ASC`
  );
  return summarizeAging(r.rows, 'balance_due', 'aging_bucket');
}

/** AR aging from open sales invoices. */
export async function getArAgingReport(): Promise<AgingReport> {
  const r = await query(
    `SELECT si.id, si.invoice_number, si.invoice_date, si.due_date, si.total,
            si.amount_paid, si.balance as balance_due, si.status, si.customer_name, si.customer_id,
            c.customer_code,
            CASE
              WHEN si.due_date IS NULL THEN 'no_due'
              WHEN si.due_date >= CURRENT_DATE THEN 'current'
              WHEN CURRENT_DATE - si.due_date BETWEEN 1 AND 30 THEN '1_30'
              WHEN CURRENT_DATE - si.due_date BETWEEN 31 AND 60 THEN '31_60'
              WHEN CURRENT_DATE - si.due_date BETWEEN 61 AND 90 THEN '61_90'
              ELSE 'over_90'
            END as aging_bucket
     FROM sales_invoices si
     LEFT JOIN customers c ON si.customer_id = c.id
     WHERE si.status IN ('Posted', 'Partial', 'Overdue')
       AND si.balance > 0
     ORDER BY COALESCE(si.due_date, si.invoice_date) ASC`
  );
  return summarizeAging(r.rows, 'balance_due', 'aging_bucket');
}
