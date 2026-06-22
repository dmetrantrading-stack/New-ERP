import { query } from '../src/config/database';

async function main() {
  const pcvs = await query(
    `SELECT pcv_number, voucher_date, amount, status, created_at
     FROM petty_cash_vouchers WHERE status != 'Cancelled'
     ORDER BY voucher_date, created_at`,
  );
  console.log('=== All PCVs ===');
  console.table(pcvs.rows);

  const bts = await query(
    `SELECT bt.transaction_date, bt.transaction_type, bt.amount, bt.notes, bt.created_at
     FROM bank_transactions bt
     JOIN bank_accounts ba ON bt.bank_account_id = ba.id
     WHERE ba.account_type = 'Petty Cash Fund'
     ORDER BY bt.created_at`,
  );
  console.log('\n=== Petty Cash Fund bank_transactions ===');
  console.table(bts.rows);

  const jes = await query(
    `SELECT je.entry_number, je.entry_date, je.reference_type, je.description, je.status,
            jel.debit, jel.credit, coa.account_code
     FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.entry_id = je.id
     JOIN chart_of_accounts coa ON jel.account_id = coa.id
     WHERE coa.account_code = '1016'
     ORDER BY je.entry_date, je.created_at, jel.debit DESC`,
  );
  console.log('\n=== JE lines on 1016 ===');
  console.table(jes.rows);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
