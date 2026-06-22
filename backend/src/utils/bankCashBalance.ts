/** Shared balance / ledger helpers for Bank & Cash (avoids double-counting global cash). */

const CASH_ACTIVE = '(ct.status IS NULL OR ct.status != \'Void\')';

const ACCOUNTS_SELECT = `
  SELECT ba.*,
    COALESCE((SELECT SUM(amount) FROM bank_transactions WHERE bank_account_id = ba.id AND transaction_type = 'Deposit'), 0) AS total_deposits,
    COALESCE((SELECT SUM(amount) FROM bank_transactions WHERE bank_account_id = ba.id AND transaction_type = 'Withdrawal'), 0) AS total_withdrawals,
    COALESCE((
      SELECT SUM(amount) FROM cash_transactions ct
      WHERE ct.transaction_type IN ('Cash In', 'Opening') AND ${CASH_ACTIVE}
    ), 0) AS global_cash_in,
    COALESCE((
      SELECT SUM(amount) FROM cash_transactions ct
      WHERE ct.transaction_type IN ('Cash Out', 'Petty Cash') AND ${CASH_ACTIVE}
    ), 0) AS global_cash_out,
    COALESCE((
      SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted'
      JOIN chart_of_accounts coa ON jel.account_id = coa.id
      WHERE coa.account_code = '1015'
    ), 0) AS checks_gl_balance,
    (
      SELECT MIN(b2.id) FROM bank_accounts b2
      WHERE b2.is_active = true AND b2.account_type = 'Cash on Hand'
    ) AS primary_cash_on_hand_id
  FROM bank_accounts ba
`;

export const ACCOUNTS_LIST_SQL = `${ACCOUNTS_SELECT}
  WHERE ba.is_active = true
  ORDER BY ba.account_type = 'Cash on Hand' DESC, ba.bank_name
`;

export const ACCOUNT_BY_ID_SQL = `${ACCOUNTS_SELECT}
  WHERE ba.id = $1
`;

export function computeAccountBalance(row: {
  id: number;
  account_type?: string;
  total_deposits?: string | number;
  total_withdrawals?: string | number;
  global_cash_in?: string | number;
  global_cash_out?: string | number;
  checks_gl_balance?: string | number;
  primary_cash_on_hand_id?: number | null;
}): number {
  const type = row.account_type || '';
  if (type === 'Cash on Hand') {
    if (row.primary_cash_on_hand_id != null && Number(row.id) !== Number(row.primary_cash_on_hand_id)) {
      return 0;
    }
    return parseFloat(String(row.global_cash_in || 0)) - parseFloat(String(row.global_cash_out || 0));
  }
  if (type === 'Checks on Hand') {
    return parseFloat(String(row.checks_gl_balance || 0));
  }
  return parseFloat(String(row.total_deposits || 0)) - parseFloat(String(row.total_withdrawals || 0));
}

export function buildLedgerRunningBalance(
  rows: Array<{ type: string; amount: string | number; date: unknown; [key: string]: unknown }>,
): Array<{ debit: number; credit: number; running_balance: number; [key: string]: unknown }> {
  const sorted = [...rows].sort(
    (a, b) => new Date(String(a.date)).getTime() - new Date(String(b.date)).getTime(),
  );
  let running = 0;
  const withBalance = sorted.map((t) => {
    const amount = parseFloat(String(t.amount)) || 0;
    const isInflow = ['Deposit', 'Cash In', 'Opening'].includes(String(t.type));
    if (isInflow) running += amount;
    else running -= amount;
    return {
      ...t,
      debit: isInflow ? amount : 0,
      credit: isInflow ? 0 : amount,
      running_balance: running,
    };
  });
  return withBalance.reverse();
}
