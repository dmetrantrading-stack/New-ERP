import { query } from '../src/config/database';
import { ACCOUNTS_LIST_SQL, computeAccountBalance } from '../src/utils/bankCashBalance';

async function main() {
  const fund = await query(
    "SELECT * FROM bank_accounts WHERE account_type = 'Petty Cash Fund' AND is_active = true",
  );
  console.log('=== Petty Cash Fund bank account ===');
  console.log(fund.rows);

  if (fund.rows[0]) {
    const id = fund.rows[0].id;
    const bt = await query(
      `SELECT transaction_type, SUM(amount) as total FROM bank_transactions WHERE bank_account_id = $1 GROUP BY transaction_type`,
      [id],
    );
    console.log('\n=== bank_transactions by type ===');
    console.log(bt.rows);

    const computed = await query(
      `SELECT
        COALESCE((SELECT SUM(amount) FROM bank_transactions WHERE bank_account_id = $1 AND transaction_type = 'Deposit'), 0) as deposits,
        COALESCE((SELECT SUM(amount) FROM bank_transactions WHERE bank_account_id = $1 AND transaction_type = 'Withdrawal'), 0) as withdrawals`,
      [id],
    );
    const dep = parseFloat(computed.rows[0].deposits);
    const wd = parseFloat(computed.rows[0].withdrawals);
    console.log('\n=== Bank & Cash computed (deposits - withdrawals) ===');
    console.log({ deposits: dep, withdrawals: wd, balance: dep - wd });
  }

  const gl = await query(
    `SELECT COALESCE(SUM(jel.debit - jel.credit), 0) as gl_balance
     FROM journal_entry_lines jel
     JOIN journal_entries je ON jel.entry_id = je.id AND je.status = 'Posted'
     JOIN chart_of_accounts coa ON jel.account_id = coa.id
     WHERE coa.account_code = '1016'`,
  );
  console.log('\n=== GL account 1016 balance ===');
  console.log(parseFloat(gl.rows[0].gl_balance));

  const pcv = await query(
    `SELECT status, COUNT(*)::int as cnt, SUM(amount) as total
     FROM petty_cash_vouchers WHERE status != 'Cancelled'
     GROUP BY status`,
  );
  console.log('\n=== PCV by status ===');
  console.log(pcv.rows);

  const accounts = await query(ACCOUNTS_LIST_SQL);
  const pcfRow = accounts.rows.find((r: { account_type?: string }) => r.account_type === 'Petty Cash Fund');
  if (pcfRow) {
    console.log('\n=== computeAccountBalance (Bank & Cash page) ===');
    console.log(computeAccountBalance(pcfRow));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
