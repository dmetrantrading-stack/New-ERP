import { query } from '../config/database';
import { DEFAULT_COGS_ACCOUNT, DEFAULT_REVENUE_ACCOUNT } from './categoryGlPosting';

type DbClient = { query: typeof query };

export interface CategoryGlHealthRow {
  category_id: number;
  category_name: string;
  product_count: number;
  revenue_account_code: string | null;
  revenue_account_name: string | null;
  cogs_account_code: string | null;
  cogs_account_name: string | null;
  issues: string[];
}

export interface CategoryGlHealthReport {
  categories_checked: number;
  issue_count: number;
  healthy_count: number;
  products_without_category: number;
  rows: CategoryGlHealthRow[];
}

function revenueIssues(
  code: string | null,
  account: { account_type?: string; is_active?: boolean } | null,
): string[] {
  const issues: string[] = [];
  const c = code?.trim() || DEFAULT_REVENUE_ACCOUNT;
  if (!account) {
    issues.push(`Sales account ${c} not found in Chart of Accounts`);
    return issues;
  }
  if (!account.is_active) issues.push(`Sales account ${c} is inactive`);
  if (account.account_type !== 'Income') {
    issues.push(`Sales account ${c} has wrong type (${account.account_type}); expected Income`);
  }
  return issues;
}

function cogsIssues(
  code: string | null,
  account: { account_type?: string; is_active?: boolean } | null,
): string[] {
  const issues: string[] = [];
  const c = code?.trim() || DEFAULT_COGS_ACCOUNT;
  if (!account) {
    issues.push(`Cost account ${c} not found in Chart of Accounts`);
    return issues;
  }
  if (!account.is_active) issues.push(`Cost account ${c} is inactive`);
  if (account.account_type !== 'Cost of Goods Sold') {
    issues.push(`Cost account ${c} has wrong type (${account.account_type}); expected Cost of Goods Sold`);
  }
  return issues;
}

export async function auditCategoryGlMapping(db: DbClient = { query }): Promise<CategoryGlHealthReport> {
  const [categoriesRes, uncategorizedRes] = await Promise.all([
    db.query(
      `SELECT c.id, c.name,
              c.revenue_account_code, rev.account_name AS revenue_account_name,
              rev.account_type AS revenue_account_type, rev.is_active AS revenue_is_active,
              c.cogs_account_code, cogs.account_name AS cogs_account_name,
              cogs.account_type AS cogs_account_type, cogs.is_active AS cogs_is_active,
              (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id AND p.is_active = true) AS product_count
       FROM categories c
       LEFT JOIN chart_of_accounts rev ON rev.account_code = c.revenue_account_code
       LEFT JOIN chart_of_accounts cogs ON cogs.account_code = c.cogs_account_code
       WHERE c.is_active = true
       ORDER BY c.name`,
    ),
    db.query(
      `SELECT COUNT(*)::int AS n FROM products WHERE is_active = true AND category_id IS NULL`,
    ),
  ]);

  const rows: CategoryGlHealthRow[] = [];
  for (const row of categoriesRes.rows) {
    const revAccount = row.revenue_account_type != null
      ? { account_type: row.revenue_account_type as string, is_active: Boolean(row.revenue_is_active) }
      : null;
    const cogsAccount = row.cogs_account_type != null
      ? { account_type: row.cogs_account_type as string, is_active: Boolean(row.cogs_is_active) }
      : null;

    const issues = [
      ...revenueIssues(row.revenue_account_code, revAccount),
      ...cogsIssues(row.cogs_account_code, cogsAccount),
    ];

    if (issues.length > 0) {
      rows.push({
        category_id: row.id,
        category_name: row.name,
        product_count: row.product_count ?? 0,
        revenue_account_code: row.revenue_account_code || DEFAULT_REVENUE_ACCOUNT,
        revenue_account_name: row.revenue_account_name || null,
        cogs_account_code: row.cogs_account_code || DEFAULT_COGS_ACCOUNT,
        cogs_account_name: row.cogs_account_name || null,
        issues,
      });
    }
  }

  const checked = categoriesRes.rows.length;
  return {
    categories_checked: checked,
    issue_count: rows.length,
    healthy_count: checked - rows.length,
    products_without_category: uncategorizedRes.rows[0]?.n ?? 0,
    rows,
  };
}
