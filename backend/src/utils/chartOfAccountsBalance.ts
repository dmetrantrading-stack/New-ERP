import { query } from '../config/database';

/** SQL expression: signed GL balance for a chart_of_accounts row joined as `coa`. */
export const COA_SIGNED_BALANCE_SQL = `
  CASE
    WHEN coa.account_type IN ('Asset', 'Expense', 'Cost of Goods Sold')
      THEN COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)
    ELSE COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)
  END
`;

export const COA_PERIOD_BALANCE_SUBQUERY = (dateFromParam: string, dateToParam: string) => `
  COALESCE((
    SELECT SUM(${COA_SIGNED_BALANCE_SQL.replace(/jel\./g, 'jelp.')})
    FROM journal_entry_lines jelp
    JOIN journal_entries je ON jelp.entry_id = je.id
      AND je.status = 'Posted'
      AND je.entry_date >= ${dateFromParam}
      AND je.entry_date <= ${dateToParam}
    WHERE jelp.account_id = coa.id
  ), 0)
`;

const COA_SIGNED_BALANCE_JELP = COA_SIGNED_BALANCE_SQL.replace(/jel\./g, 'jelp.');

export type ComparativePeriodColumn = { from: string; to: string; label?: string };

/** Build SELECT expressions for multiple period columns on chart_of_accounts (alias `coa`). */
export function buildComparativePeriodBalanceSelect(columns: ComparativePeriodColumn[]): {
  selectSql: string;
  params: string[];
} {
  const params: string[] = [];
  const parts = columns.map((_col, i) => {
    const fromIdx = params.length + 1;
    params.push(_col.from, _col.to);
    const fromParam = `$${fromIdx}`;
    const toParam = `$${fromIdx + 1}`;
    return `COALESCE((
      SELECT SUM(${COA_SIGNED_BALANCE_JELP})
      FROM journal_entry_lines jelp
      JOIN journal_entries je ON jelp.entry_id = je.id
        AND je.status = 'Posted'
        AND je.entry_date >= ${fromParam}
        AND je.entry_date <= ${toParam}
      WHERE jelp.account_id = coa.id
    ), 0) AS col_${i}`;
  });
  return { selectSql: parts.join(',\n             '), params };
}

export const COA_LIFETIME_BALANCE_SUBQUERY = `
  COALESCE((
    SELECT SUM(${COA_SIGNED_BALANCE_SQL.replace(/jel\./g, 'jell.')})
    FROM journal_entry_lines jell
    JOIN journal_entries je ON jell.entry_id = je.id AND je.status = 'Posted'
    WHERE jell.account_id = coa.id
  ), 0)
`;

export async function listChartOfAccountsWithBalance(asOf?: string) {
  if (asOf) {
    const result = await query(
      `SELECT coa.*,
              COALESCE(SUM(${COA_SIGNED_BALANCE_SQL}), 0) AS balance
       FROM chart_of_accounts coa
       LEFT JOIN journal_entry_lines jel ON jel.account_id = coa.id
       LEFT JOIN journal_entries je ON jel.entry_id = je.id
         AND je.status = 'Posted'
         AND je.entry_date <= $1
       GROUP BY coa.id
       ORDER BY coa.account_code`,
      [asOf],
    );
    return result.rows;
  }

  const result = await query(
    `SELECT coa.*, ${COA_LIFETIME_BALANCE_SUBQUERY} AS balance
     FROM chart_of_accounts coa
     ORDER BY coa.account_code`,
  );
  return result.rows;
}

export const CATEGORY_GL_ACCOUNTS: Array<[string, string, string]> = [
  ['4010', 'Sales - Fish', 'Income'],
  ['4011', 'Sales - Vegetable', 'Income'],
  ['4012', 'Sales - Pork Meat', 'Income'],
  ['4013', 'Sales - Beef Meat', 'Income'],
  ['4014', 'Sales - Frozen Foods', 'Income'],
  ['4015', 'Sales - Rice', 'Income'],
  ['5110', 'Cost of Sales - Fish', 'Cost of Goods Sold'],
  ['5111', 'Cost of Sales - Vegetable', 'Cost of Goods Sold'],
  ['5112', 'Cost of Sales - Pork Meat', 'Cost of Goods Sold'],
  ['5113', 'Cost of Sales - Beef Meat', 'Cost of Goods Sold'],
  ['5114', 'Cost of Sales - Frozen Foods', 'Cost of Goods Sold'],
  ['5115', 'Cost of Sales - Rice', 'Cost of Goods Sold'],
];

/** Category name aliases → [revenue_code, cogs_code] */
export const CATEGORY_ACCOUNT_ALIASES: Array<[string[], string, string]> = [
  [['fish'], '4010', '5110'],
  [['vegetable', 'vegetables', 'veg'], '4011', '5111'],
  [['pork meat', 'pork', 'pork pigue', 'pork pata'], '4012', '5112'],
  [['beef meat', 'beef', 'beef tenderloin', 'beef spareribs', 'beef kamto'], '4013', '5113'],
  [['frozen foods', 'frozen food', 'frozen'], '4014', '5114'],
  [['rice', 'rice products', 'grains'], '4015', '5115'],
];

export async function ensureCategoryGlAccounts(db: { query: typeof query }) {
  for (const [code, name, type] of CATEGORY_GL_ACCOUNTS) {
    await db.query(
      `INSERT INTO chart_of_accounts (account_code, account_name, account_type, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (account_code) DO UPDATE SET
         account_name = EXCLUDED.account_name,
         account_type = EXCLUDED.account_type,
         is_active = true,
         updated_at = CURRENT_TIMESTAMP`,
      [code, name, type],
    );
  }

  for (const [names, revenueCode, cogsCode] of CATEGORY_ACCOUNT_ALIASES) {
    for (const name of names) {
      await db.query(
        `UPDATE categories SET revenue_account_code = $2, cogs_account_code = $3, updated_at = CURRENT_TIMESTAMP
         WHERE LOWER(TRIM(name)) = LOWER($1)
           AND (revenue_account_code IS NULL OR revenue_account_code IN ('4000'))
           AND (cogs_account_code IS NULL OR cogs_account_code IN ('5000'))`,
        [name, revenueCode, cogsCode],
      );
    }
  }

  await db.query(
    `UPDATE categories SET revenue_account_code = '4015', cogs_account_code = '5115', updated_at = CURRENT_TIMESTAMP
     WHERE is_active = true AND name ILIKE '%rice%'
       AND (revenue_account_code IS NULL OR revenue_account_code IN ('4000'))
       AND (cogs_account_code IS NULL OR cogs_account_code IN ('5000'))`,
  );
}
