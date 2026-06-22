import { query, getClient } from '../config/database';
import { AppError } from '../middleware/errorHandler';

type Queryable = { query: typeof query };

export async function applyMemoToApv(
  executor: Queryable,
  apvId: string,
  supplierId: number,
  memoType: 'Credit' | 'Debit',
  amount: number,
) {
  const apvRes = await executor.query(
    `SELECT * FROM ap_vouchers WHERE id = $1 AND supplier_id = $2`,
    [apvId, supplierId],
  );
  if (apvRes.rows.length === 0) throw new AppError('AP voucher not found for this supplier');
  const apv = apvRes.rows[0];
  if (!['Posted', 'Partially Paid'].includes(apv.status)) {
    throw new AppError('Memo can only be applied to posted AP vouchers');
  }

  const amountPaid = parseFloat(apv.amount_paid || 0);
  const totalAmount = parseFloat(apv.total_amount || 0);
  const balanceDue = totalAmount - amountPaid;

  if (memoType === 'Credit') {
    if (amount > balanceDue + 0.01) {
      throw new AppError(`Credit amount exceeds APV balance due (₱${balanceDue.toFixed(2)})`);
    }
    const netCredit = amount / 1.12;
    const vatCredit = amount - netCredit;
    await executor.query(
      `UPDATE ap_vouchers SET
        discount_amount = COALESCE(discount_amount, 0) + $2,
        vatable_amount = GREATEST(COALESCE(vatable_amount, 0) - $3, 0),
        vat_amount = GREATEST(COALESCE(vat_amount, 0) - $4, 0),
        total_amount = total_amount - $2,
        balance = total_amount - $2 - COALESCE(amount_paid, 0),
        status = CASE
          WHEN total_amount - $2 - COALESCE(amount_paid, 0) <= 0.01 THEN 'Paid'
          WHEN COALESCE(amount_paid, 0) > 0 THEN 'Partially Paid'
          ELSE status
        END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [apvId, amount, netCredit, vatCredit],
    );
    return;
  }

  const netDebit = amount / 1.12;
  const vatDebit = amount - netDebit;
  await executor.query(
    `UPDATE ap_vouchers SET
      vatable_amount = COALESCE(vatable_amount, 0) + $3,
      vat_amount = COALESCE(vat_amount, 0) + $4,
      total_amount = total_amount + $2,
      balance = total_amount + $2 - COALESCE(amount_paid, 0),
      status = CASE
        WHEN COALESCE(amount_paid, 0) > 0 THEN 'Partially Paid'
        ELSE 'Posted'
      END,
      updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [apvId, amount, netDebit, vatDebit],
  );
}

/** Find oldest open APV that can absorb a new memo when no APV was selected. */
export async function resolveMemoApvId(
  executor: Queryable,
  supplierId: number,
  memoType: 'Credit' | 'Debit',
  amount: number,
  explicitApvId?: string | null,
): Promise<string | null> {
  if (explicitApvId) return explicitApvId;

  if (memoType === 'Credit') {
    const r = await executor.query(
      `SELECT id FROM ap_vouchers
       WHERE supplier_id = $1 AND status IN ('Posted', 'Partially Paid')
         AND (total_amount - COALESCE(amount_paid, 0)) >= $2 - 0.01
       ORDER BY apv_date ASC LIMIT 1`,
      [supplierId, amount],
    );
    return r.rows[0]?.id ?? null;
  }

  const r = await executor.query(
    `SELECT id FROM ap_vouchers
     WHERE supplier_id = $1 AND status IN ('Posted', 'Partially Paid')
     ORDER BY apv_date ASC LIMIT 1`,
    [supplierId],
  );
  return r.rows[0]?.id ?? null;
}

/** Link historical unlinked memos to open APVs (FIFO) so APV balance_due matches supplier balance. */
export async function applyUnlinkedMemosToOpenApvs(
  supplierId: number,
  executor: Queryable = { query },
): Promise<void> {
  const memos = await executor.query(
    `SELECT id, memo_type, amount FROM purchase_memos
     WHERE supplier_id = $1 AND apv_id IS NULL
     ORDER BY memo_date ASC, created_at ASC`,
    [supplierId],
  );

  for (const memo of memos.rows) {
    const amt = parseFloat(memo.amount);
    const apvId = await resolveMemoApvId(executor, supplierId, memo.memo_type, amt);
    if (!apvId) continue;

    try {
      await applyMemoToApv(executor, apvId, supplierId, memo.memo_type, amt);
      await executor.query('UPDATE purchase_memos SET apv_id = $1 WHERE id = $2', [apvId, memo.id]);
    } catch {
      // Skip memos that cannot be applied (e.g. credit exceeds remaining APV balance).
    }
  }
}

export type DbClient = Awaited<ReturnType<typeof getClient>>;
