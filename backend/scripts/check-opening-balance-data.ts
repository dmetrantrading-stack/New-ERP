/** Run: npx ts-node scripts/check-opening-balance-data.ts */
import { query } from '../src/config/database';

async function main() {
  const r = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM sales_invoices WHERE notes ILIKE '%Opening A/R migrated%') AS all_ar_invoices,
      (SELECT COUNT(*)::int FROM sales_invoices WHERE status NOT IN ('Void','Cancelled') AND notes ILIKE '%Opening A/R migrated%') AS active_ar_invoices,
      (SELECT COUNT(*)::int FROM sales_invoices WHERE status = 'Void' AND notes ILIKE '%Opening A/R migrated%') AS void_ar_invoices,
      (SELECT COUNT(*)::int FROM journal_entries WHERE reference_type = 'Opening Balance' AND (description = 'Opening balance import' OR description ILIKE 'Opening A/R —%')) AS all_opening_jes,
      (SELECT COUNT(*)::int FROM journal_entries WHERE status = 'Posted' AND reference_type = 'Opening Balance' AND (description = 'Opening balance import' OR description ILIKE 'Opening A/R —%')) AS posted_opening_jes,
      (SELECT COUNT(*)::int FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id WHERE je.reference_type = 'Opening Balance' AND (je.description = 'Opening balance import' OR je.description ILIKE 'Opening A/R —%')) AS opening_je_lines,
      (SELECT COUNT(*)::int FROM inventory_ledger WHERE reference_type = 'Opening Balance' AND notes = 'Opening balance import') AS inv_ledger,
      (SELECT COUNT(*)::int FROM customers WHERE customer_code LIKE 'DMC-%' OR customer_code LIKE 'BDA-%') AS dmc_bda_customers,
      (SELECT COUNT(*)::int FROM customers WHERE (customer_code LIKE 'DMC-%' OR customer_code LIKE 'BDA-%') AND is_active = true) AS dmc_bda_active
  `);
  console.log(r.rows[0]);

  const cust = await query(`SELECT customer_code, customer_name, balance, is_active FROM customers WHERE balance != 0 OR customer_code LIKE 'DMC-%' OR customer_code LIKE 'BDA-%' ORDER BY customer_code LIMIT 20`);
  if (cust.rows.length) {
    console.log('\nCustomers with balance or DMC/BDA prefix:');
    console.table(cust.rows);
  }

  const active = await query(`SELECT customer_code, customer_name, balance, is_active FROM customers WHERE (customer_code LIKE 'DMC-%' OR customer_code LIKE 'BDA-%') AND is_active = true ORDER BY customer_code`);
  console.log('\nActive DMC/BDA:', active.rows.length);
  if (active.rows.length) console.table(active.rows);

  const invCust = await query(`
    SELECT DISTINCT c.customer_code, c.customer_name, c.is_active
    FROM sales_invoices si
    JOIN customers c ON c.id = si.customer_id
    WHERE si.notes ILIKE '%Opening A/R migrated%'
    ORDER BY c.customer_code`);
  console.log('\nCustomers on opening AR invoices:', invCust.rows.length);
  if (invCust.rows.length) console.table(invCust.rows);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
