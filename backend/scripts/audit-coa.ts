import { query } from '../src/config/database';

async function main() {
  const accounts = await query(
    `SELECT account_code, account_name, account_type, is_active
     FROM chart_of_accounts
     WHERE account_code LIKE '401%' OR account_code LIKE '511%'
     ORDER BY account_code`,
  );
  console.log('Category GL accounts:', JSON.stringify(accounts.rows, null, 2));

  const cols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'categories' AND column_name IN ('revenue_account_code', 'cogs_account_code')`,
  );
  console.log('Category columns:', cols.rows.map((r: any) => r.column_name));

  const categories = await query(
    `SELECT c.name, c.revenue_account_code, c.cogs_account_code,
            rev.account_name AS revenue_name, cogs.account_name AS cogs_name
     FROM categories c
     LEFT JOIN chart_of_accounts rev ON rev.account_code = c.revenue_account_code
     LEFT JOIN chart_of_accounts cogs ON cogs.account_code = c.cogs_account_code
     ORDER BY c.name`,
  );
  console.log('Categories mapping:', JSON.stringify(categories.rows, null, 2));

  const total = await query('SELECT COUNT(*)::int AS n FROM chart_of_accounts');
  console.log('Total COA count:', total.rows[0].n);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
