import { query } from '../config/database';
import { applyUnlinkedMemosToOpenApvs } from './purchaseMemoApv';

type Queryable = { query: typeof query };

/** Heal APV links and recompute supplier balance before pay-supplier screens. */
export async function prepareSupplierForPayment(
  supplierId: number,
  executor: Queryable = { query },
): Promise<number> {
  await applyUnlinkedMemosToOpenApvs(supplierId, executor);
  return syncSupplierBalanceFromApv(supplierId, executor);
}

/** Recompute suppliers.balance from open APVs and unlinked purchase memos. */
export async function syncSupplierBalanceFromApv(
  supplierId: number,
  executor: Queryable = { query },
): Promise<number> {
  const apvRes = await executor.query(
    `SELECT COALESCE(SUM(GREATEST(total_amount - COALESCE(amount_paid, 0), 0)), 0) AS outstanding
     FROM ap_vouchers
     WHERE supplier_id = $1 AND status IN ('Posted', 'Partially Paid')`,
    [supplierId],
  );

  const unlinkedCredit = await executor.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM purchase_memos
     WHERE supplier_id = $1 AND memo_type = 'Credit' AND apv_id IS NULL`,
    [supplierId],
  );

  const unlinkedDebit = await executor.query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM purchase_memos
     WHERE supplier_id = $1 AND memo_type = 'Debit' AND apv_id IS NULL`,
    [supplierId],
  );

  const balance = Math.max(
    parseFloat(apvRes.rows[0]?.outstanding ?? 0)
    - parseFloat(unlinkedCredit.rows[0]?.total ?? 0)
    + parseFloat(unlinkedDebit.rows[0]?.total ?? 0),
    0,
  );

  await executor.query(
    'UPDATE suppliers SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [balance, supplierId],
  );

  return balance;
}
