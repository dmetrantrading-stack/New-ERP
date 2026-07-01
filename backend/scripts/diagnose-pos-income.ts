import { query } from '../src/config/database';
import { loadCategoryAccountsForProducts } from '../src/utils/categoryGlPosting';

async function main() {
  const pos = await query(`
    SELECT pt.transaction_number, pt.total, pt.created_at::date AS sale_date,
           je.entry_number, je.entry_date, je.status AS je_status,
           (SELECT COALESCE(SUM(jel.credit), 0) FROM journal_entry_lines jel
            JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_type = 'Income'
            WHERE jel.entry_id = je.id) AS revenue_credits,
           (SELECT string_agg(coa.account_code || ':' || jel.credit::text, ', ')
            FROM journal_entry_lines jel
            JOIN chart_of_accounts coa ON coa.id = jel.account_id
            WHERE jel.entry_id = je.id AND coa.account_type = 'Income') AS revenue_accounts
    FROM pos_transactions pt
    LEFT JOIN journal_entries je ON je.reference_type = 'POS Sale' AND je.reference_id = pt.id
    WHERE pt.status = 'Completed'
    ORDER BY pt.created_at DESC
    LIMIT 10`);
  console.log('Recent POS:', JSON.stringify(pos.rows, null, 2));

  const acct = await query(
    "SELECT account_code, account_name, is_active FROM chart_of_accounts WHERE account_code IN ('4015','5115','4000','5000') ORDER BY account_code",
  );
  console.log('Accounts:', JSON.stringify(acct.rows, null, 2));

  const rice = await query(`
    SELECT c.name, c.revenue_account_code, c.cogs_account_code,
           (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id) AS products
    FROM categories c WHERE c.name ILIKE '%rice%' OR c.revenue_account_code = '4015'`);
  console.log('Rice categories:', JSON.stringify(rice.rows, null, 2));

  const ytd = await query(`
    SELECT coa.account_code, coa.account_name, coa.is_active,
           COALESCE(SUM(CASE WHEN coa.account_type = 'Income' THEN jel.credit - jel.debit ELSE 0 END), 0) AS ytd_revenue
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
    LEFT JOIN journal_entries je ON je.id = jel.entry_id
      AND je.status = 'Posted'
      AND je.entry_date >= date_trunc('year', CURRENT_DATE)::date
    WHERE coa.account_code IN ('4015', '4000', '5000', '5115')
    GROUP BY coa.id, coa.account_code, coa.account_name, coa.is_active
    ORDER BY coa.account_code`);
  console.log('YTD balances:', JSON.stringify(ytd.rows, null, 2));

  const missingJe = await query(`
    SELECT COUNT(*)::int AS n FROM pos_transactions pt
    LEFT JOIN journal_entries je ON je.reference_type = 'POS Sale' AND je.reference_id = pt.id
    WHERE pt.status = 'Completed' AND je.id IS NULL`);
  console.log('POS without JE:', missingJe.rows[0]?.n);

  const riceProducts = await query(`
    SELECT p.id, p.name, p.category_id, c.name AS category_name, c.revenue_account_code, c.cogs_account_code
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.name ILIKE '%rice%' OR c.name ILIKE '%rice%'`);
  console.log('Rice products:', JSON.stringify(riceProducts.rows, null, 2));

  const posItems = await query(`
    SELECT pt.transaction_number, pti.description, p.name AS product_name, p.category_id,
           c.name AS category_name, c.revenue_account_code
    FROM pos_transaction_items pti
    JOIN pos_transactions pt ON pt.id = pti.transaction_id
    JOIN products p ON p.id = pti.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY pt.created_at DESC
    LIMIT 5`);
  console.log('Recent POS items:', JSON.stringify(posItems.rows, null, 2));

  const dbToday = await query('SELECT CURRENT_DATE AS today');
  console.log('DB CURRENT_DATE:', dbToday.rows[0]?.today);

  const is2025 = await query(`
    SELECT coa.account_code, COALESCE(SUM(jel.credit - jel.debit), 0) AS revenue
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
    LEFT JOIN journal_entries je ON je.id = jel.entry_id
      AND je.status = 'Posted'
      AND je.entry_date >= '2025-01-01' AND je.entry_date <= '2025-06-22'
    WHERE coa.account_type = 'Income' AND coa.account_code IN ('4000', '4015')
    GROUP BY coa.account_code`);
  console.log('Revenue Jan-Jun 22 2025 filter:', JSON.stringify(is2025.rows, null, 2));

  const is2026 = await query(`
    SELECT coa.account_code, COALESCE(SUM(jel.credit - jel.debit), 0) AS revenue
    FROM chart_of_accounts coa
    LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
    LEFT JOIN journal_entries je ON je.id = jel.entry_id
      AND je.status = 'Posted'
      AND je.entry_date >= '2026-01-01' AND je.entry_date <= '2026-12-31'
    WHERE coa.account_type = 'Income' AND coa.account_code IN ('4000', '4015')
    GROUP BY coa.account_code`);
  console.log('Revenue 2026 filter:', JSON.stringify(is2026.rows, null, 2));

  const riceProd = await query("SELECT id FROM products WHERE name ILIKE '%Rice 160%' LIMIT 1");
  if (riceProd.rows[0]?.id) {
    const map = await loadCategoryAccountsForProducts({ query }, [riceProd.rows[0].id]);
    console.log('Category GL map for rice:', map.get(riceProd.rows[0].id));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
