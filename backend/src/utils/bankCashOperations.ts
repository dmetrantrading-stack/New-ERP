import { query, getClient } from '../config/database';
import { ACCOUNT_BY_ID_SQL, computeAccountBalance } from './bankCashBalance';

const CASH_VOID_BLOCKED_REF_TYPES = new Set([
  'Expense',
  'Sales Invoice',
  'Collection',
  'Petty Cash Replenish',
  'POS Shift',
]);

export function resolveAccountGlCode(account: {
  account_type?: string;
  gl_account_code?: string | null;
}): string {
  const type = account.account_type || '';
  if (type === 'Cash on Hand') return account.gl_account_code || '1000';
  if (type === 'Checks on Hand') return account.gl_account_code || '1015';
  if (type === 'Petty Cash Fund') return account.gl_account_code || '1016';
  return account.gl_account_code || '1010';
}

export async function getGlobalCashBalance(): Promise<number> {
  const r = await query(`
    SELECT
      COALESCE((SELECT SUM(amount) FROM cash_transactions
        WHERE transaction_type IN ('Cash In', 'Opening') AND (status IS NULL OR status != 'Void')), 0)
      -
      COALESCE((SELECT SUM(amount) FROM cash_transactions
        WHERE transaction_type IN ('Cash Out', 'Petty Cash') AND (status IS NULL OR status != 'Void')), 0)
      AS balance
  `);
  return parseFloat(String(r.rows[0]?.balance ?? 0));
}

export async function getBankAccountComputedBalance(accountId: number): Promise<number> {
  const r = await query(ACCOUNT_BY_ID_SQL, [accountId]);
  if (r.rows.length === 0) return 0;
  return computeAccountBalance(r.rows[0]);
}

export function formatCurrency(amount: number): string {
  return `₱${amount.toFixed(2)}`;
}

/** Reverse a bank deposit/withdrawal and its companion cash transaction + JE. */
export async function reverseBankTransaction(bankTxnId: string): Promise<void> {
  const txn = await query('SELECT * FROM bank_transactions WHERE id = $1', [bankTxnId]);
  if (txn.rows.length === 0) throw new Error('Linked bank transaction not found');
  const bt = txn.rows[0];

  await query(
    `UPDATE bank_accounts SET balance = balance - (CASE WHEN $1='Deposit' THEN $2::decimal ELSE -($2::decimal) END), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
    [bt.transaction_type, bt.amount, bt.bank_account_id],
  );

  await query(
    "UPDATE cash_transactions SET status = 'Void' WHERE reference_id = $1 AND (status IS NULL OR status != 'Void')",
    [bankTxnId],
  );

  const refType = bt.reference_type === 'Opening Balance'
    ? 'Opening Balance'
    : bt.transaction_type === 'Deposit'
      ? 'Bank Deposit'
      : 'Bank Withdrawal';

  if (bt.reference_type === 'Opening Balance') {
    await query(
      `UPDATE bank_accounts SET starting_balance = 0, starting_balance_ref_id = NULL, starting_balance_set_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE starting_balance_ref_id = $1`,
      [bankTxnId],
    );
  }

  await query(
    "UPDATE journal_entries SET status = 'Void', updated_at = CURRENT_TIMESTAMP WHERE reference_id = $1 AND reference_type = $2 AND status = 'Posted'",
    [bankTxnId, refType],
  );

  await query('DELETE FROM bank_transactions WHERE id = $1', [bankTxnId]);
}

/** Reverse a bank transfer and all linked cash/bank transactions + JE. */
export async function reverseBankTransfer(transferId: string): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const bankTxns = await client.query(
      'SELECT * FROM bank_transactions WHERE reference_type = $1 AND reference_id = $2',
      ['Bank Transfer', transferId],
    );
    for (const bt of bankTxns.rows) {
      await client.query(
        `UPDATE bank_accounts SET balance = balance - (CASE WHEN $1='Deposit' THEN $2::decimal ELSE -($2::decimal) END), updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [bt.transaction_type, bt.amount, bt.bank_account_id],
      );
      await client.query('DELETE FROM bank_transactions WHERE id = $1', [bt.id]);
    }

    await client.query(
      "UPDATE cash_transactions SET status = 'Void' WHERE reference_type = 'Bank Transfer' AND reference_id = $1 AND (status IS NULL OR status != 'Void')",
      [transferId],
    );

    await client.query(
      "UPDATE journal_entries SET status = 'Void', updated_at = CURRENT_TIMESTAMP WHERE reference_id = $1 AND reference_type = 'Bank Transfer' AND status = 'Posted'",
      [transferId],
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Void opening-balance cash transaction and clear starting_balance on the linked account. */
export async function voidOpeningCashTransaction(cashTxnId: string): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const acct = await client.query(
      'SELECT id FROM bank_accounts WHERE starting_balance_ref_id = $1',
      [cashTxnId],
    );

    await client.query(
      "UPDATE cash_transactions SET status = 'Void' WHERE id = $1 AND (status IS NULL OR status != 'Void')",
      [cashTxnId],
    );

    await client.query(
      "UPDATE journal_entries SET status = 'Void', updated_at = CURRENT_TIMESTAMP WHERE reference_id = $1 AND reference_type = 'Opening Balance' AND status = 'Posted'",
      [cashTxnId],
    );

    if (acct.rows.length > 0) {
      await client.query(
        `UPDATE bank_accounts SET starting_balance = 0, starting_balance_ref_id = NULL, starting_balance_set_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [acct.rows[0].id],
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Void a cash transaction with correct cascade rules. */
export async function voidCashTransaction(cashTxnId: string): Promise<{ message: string }> {
  const result = await query(
    "SELECT * FROM cash_transactions WHERE id = $1 AND (status IS NULL OR status != 'Void')",
    [cashTxnId],
  );
  if (result.rows.length === 0) throw new Error('Transaction not found or already voided');
  const ct = result.rows[0];

  if (CASH_VOID_BLOCKED_REF_TYPES.has(ct.reference_type)) {
    throw new Error(`Void this transaction from the source module (${ct.reference_type}), not Bank & Cash`);
  }

  if (ct.reference_type === 'Bank Deposit' || ct.reference_type === 'Bank Withdrawal') {
    await reverseBankTransaction(ct.reference_id);
    return { message: 'Bank transaction reversed' };
  }

  if (ct.reference_type === 'Bank Transfer') {
    await reverseBankTransfer(ct.reference_id);
    return { message: 'Transfer reversed' };
  }

  if (ct.transaction_type === 'Opening') {
    await voidOpeningCashTransaction(cashTxnId);
    return { message: 'Opening balance voided' };
  }

  await query("UPDATE cash_transactions SET status = 'Void' WHERE id = $1", [cashTxnId]);
  await query(
    "UPDATE journal_entries SET status = 'Void', updated_at = CURRENT_TIMESTAMP WHERE reference_id = $1 AND reference_type IN ('Cash In','Cash Out','Petty Cash') AND status = 'Posted'",
    [cashTxnId],
  );
  return { message: 'Transaction voided' };
}
