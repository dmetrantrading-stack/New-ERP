import { query } from '../src/config/database';

async function main() {
  const r = await query(
    `SELECT je.entry_number, je.reference_type, je.description, je.status,
            pcv.pcv_number, coa.account_code, jel.debit, jel.credit
     FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.entry_id = je.id
     JOIN chart_of_accounts coa ON jel.account_id = coa.id
     LEFT JOIN petty_cash_vouchers pcv ON je.reference_id = pcv.id AND je.reference_type = 'Petty Cash'
     WHERE je.reference_type IN ('Petty Cash', 'Petty Cash Replenish')
     ORDER BY je.entry_date, je.entry_number, jel.debit DESC`,
  );
  console.table(r.rows);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
