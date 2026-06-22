import { query } from '../src/config/database';

async function main() {
  const voided = await query(
    `SELECT je.entry_number, je.reference_type, je.description, je.status, pcv.pcv_number
     FROM journal_entries je
     LEFT JOIN petty_cash_vouchers pcv ON je.reference_id = pcv.id AND je.reference_type = 'Petty Cash'
     WHERE je.reference_type IN ('Petty Cash', 'Petty Cash Replenish')
       AND je.status = 'Void'`,
  );
  console.log('Voided petty cash JEs:', voided.rows.length);
  console.table(voided.rows);

  const pcvNoJe = await query(
    `SELECT pcv.pcv_number, pcv.amount, pcv.status
     FROM petty_cash_vouchers pcv
     WHERE pcv.status != 'Cancelled'
       AND NOT EXISTS (
         SELECT 1 FROM journal_entries je
         WHERE je.reference_type = 'Petty Cash' AND je.reference_id = pcv.id AND je.status = 'Posted'
       )
     ORDER BY pcv.pcv_number`,
  );
  console.log('\nPCVs without posted JE:');
  console.table(pcvNoJe.rows);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
