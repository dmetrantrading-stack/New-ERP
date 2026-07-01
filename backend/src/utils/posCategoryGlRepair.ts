import {
  aggregateByAccountCode,
  aggregateGlCogsByAccountCode,
  insertCogsInventoryLines,
  insertRevenueCreditLines,
  loadCategoryAccountsForProducts,
} from './categoryGlPosting';
import { posLineRevenueAmount } from './retailTaxPolicy';
import { query } from '../config/database';

type DbClient = { query: typeof query };

export interface MisclassifiedPosRow {
  transaction_id: string;
  transaction_number: string;
  transaction_date: string;
  total: number;
  expected_revenue_accounts: string;
  actual_revenue_accounts: string;
  amount_misclassified: number;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function expectedBucketsForTransaction(db: DbClient, transactionId: string) {
  const items = await db.query(
    `SELECT pti.product_id, pti.total, pti.base_qty, pti.quantity, pti.cost,
            COALESCE(p.tax_type, 'VAT') AS tax_type
     FROM pos_transaction_items pti
     JOIN products p ON p.id = pti.product_id
     WHERE pti.transaction_id = $1`,
    [transactionId],
  );
  if (!items.rows.length) return null;

  const productIds = [...new Set(items.rows.map((r: any) => r.product_id).filter(Boolean))];
  const categoryMap = await loadCategoryAccountsForProducts(db, productIds);

  const revenueLines = items.rows.map((row: any) => ({
    product_id: row.product_id,
    revenueAmount: posLineRevenueAmount(parseFloat(row.total) || 0),
  }));
  const cogsLines = items.rows.map((row: any) => {
    const baseQty = parseFloat(row.base_qty) || parseFloat(row.quantity) || 0;
    return {
      product_id: row.product_id,
      cogsGrossAmount: baseQty * (parseFloat(row.cost) || 0),
      tax_type: row.tax_type,
    };
  });

  return {
    revenue: aggregateByAccountCode(revenueLines, categoryMap, 'revenue_account_code', 'revenueAmount'),
    cogs: aggregateGlCogsByAccountCode(cogsLines, categoryMap),
  };
}

function formatBucketSig(buckets: Map<string, number>) {
  return [...buckets.entries()]
    .filter(([, amt]) => amt > 0.009)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, amt]) => `${code} (${round2(amt)})`)
    .join(', ');
}

function compareSigFromActual(rows: { account_code: string; amount: string }[]) {
  return rows.map((r) => `${r.account_code}:${round2(parseFloat(r.amount))}`).join('|');
}

export async function findMisclassifiedPosCategoryGl(db: DbClient = { query }): Promise<MisclassifiedPosRow[]> {
  const txs = await db.query(
    `SELECT pt.id, pt.transaction_number, pt.total, pt.created_at::date AS transaction_date
     FROM pos_transactions pt
     JOIN journal_entries je ON je.reference_type = 'POS Sale' AND je.reference_id = pt.id AND je.status = 'Posted'
     WHERE pt.status = 'Completed'
     ORDER BY pt.created_at DESC
     LIMIT 200`,
  );

  const rows: MisclassifiedPosRow[] = [];
  for (const tx of txs.rows) {
    const expected = await expectedBucketsForTransaction(db, tx.id);
    if (!expected) continue;
    const expectedSig = formatBucketSig(expected.revenue);
    const actualRows = await db.query(
      `SELECT coa.account_code, ROUND(SUM(jel.credit - jel.debit)::numeric, 2)::text AS amount
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.entry_id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id
       WHERE je.reference_type = 'POS Sale' AND je.reference_id = $1 AND je.status = 'Posted'
         AND coa.account_type = 'Income'
       GROUP BY coa.account_code
       HAVING ABS(SUM(jel.credit - jel.debit)) > 0.009
       ORDER BY coa.account_code`,
      [tx.id],
    );
    const actualSig = compareSigFromActual(actualRows.rows);
    const expectedCompare = [...expected.revenue.entries()]
      .filter(([, amt]) => amt > 0.009)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, amt]) => `${code}:${round2(amt)}`)
      .join('|');
    if (expectedCompare && expectedCompare !== actualSig) {
      rows.push({
        transaction_id: tx.id,
        transaction_number: tx.transaction_number,
        transaction_date: tx.transaction_date,
        total: parseFloat(tx.total) || 0,
        expected_revenue_accounts: expectedSig,
        actual_revenue_accounts: actualRows.rows.map((r: any) => `${r.account_code} (${r.amount})`).join(', '),
        amount_misclassified: parseFloat(tx.total) || 0,
      });
    }
  }
  return rows;
}

export async function repairPosCategoryGl(db: DbClient, transactionId: string) {
  const tx = await db.query(
    `SELECT pt.id, pt.transaction_number, pt.total
     FROM pos_transactions pt
     WHERE pt.id = $1 AND pt.status = 'Completed'`,
    [transactionId],
  );
  if (!tx.rows.length) throw new Error('POS transaction not found');

  const je = await db.query(
    `SELECT id FROM journal_entries
     WHERE reference_type = 'POS Sale' AND reference_id = $1 AND status = 'Posted'
     ORDER BY created_at DESC LIMIT 1`,
    [transactionId],
  );
  if (!je.rows.length) throw new Error('Posted journal entry not found for this POS sale');

  const expected = await expectedBucketsForTransaction(db, transactionId);
  if (!expected) throw new Error('No line items found');

  const entryId = je.rows[0].id;
  const txnNumber = tx.rows[0].transaction_number;

  await db.query(
    `DELETE FROM journal_entry_lines jel
     USING chart_of_accounts coa
     WHERE jel.entry_id = $1 AND coa.id = jel.account_id
       AND (coa.account_type IN ('Income', 'Cost of Goods Sold')
            OR (coa.account_code = '1200' AND jel.credit > 0))`,
    [entryId],
  );

  await insertRevenueCreditLines(
    db, entryId, expected.revenue, 'POS Sale', transactionId, `Sales Revenue ${txnNumber} (reclassified)`,
  );

  const cogsTotal = [...expected.cogs.values()].reduce((s, v) => s + v, 0);
  if (cogsTotal > 0.009) {
    await insertCogsInventoryLines(
      db, entryId, expected.cogs, 'POS Sale', transactionId, `${txnNumber} (reclassified)`,
    );
  }

  await db.query(
    `UPDATE journal_entries je
     SET total_debit = agg.line_total, total_credit = agg.line_total, updated_at = CURRENT_TIMESTAMP
     FROM (
       SELECT entry_id, ROUND(SUM(debit)::numeric, 2) AS line_total
       FROM journal_entry_lines WHERE entry_id = $1 GROUP BY entry_id
     ) agg
     WHERE je.id = agg.entry_id`,
    [entryId],
  );

  return {
    transaction_id: transactionId,
    transaction_number: txnNumber,
    expected_revenue: formatBucketSig(expected.revenue),
    expected_cogs: formatBucketSig(expected.cogs),
  };
}
