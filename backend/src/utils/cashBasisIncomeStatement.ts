import { query } from '../config/database';
import { NormalizedPeriodColumn } from './comparativeIncomeStatement';

type AccountRow = {
  id: number;
  account_code: string;
  account_name: string;
  account_type: string;
};

/** Net revenue per invoice line (matches storedInvoiceItemNetRevenue). */
const SQL_LINE_NET_REVENUE = `
  CASE
    WHEN COALESCE(sii.tax_type, 'VAT') IN ('VAT Exempt', 'Zero Rated') THEN COALESCE(sii.total, 0)::numeric
    WHEN COALESCE(sii.vat_amount, 0)::numeric > 0 THEN COALESCE(sii.total, 0)::numeric - COALESCE(sii.vat_amount, 0)::numeric
    WHEN COALESCE(sii.tax_type, 'VAT') IN ('VAT', 'VATable', 'LGU', 'LGU 5% Final VAT')
      THEN ROUND(COALESCE(sii.total, 0)::numeric / 1.12, 2)
    ELSE COALESCE(sii.total, 0)::numeric
  END
`;

/** GL COGS per invoice line (matches lineGlCogsAmount). */
const SQL_LINE_GL_COGS = `
  CASE
    WHEN COALESCE(sii.quantity, 0)::numeric * COALESCE(sii.cost, 0)::numeric <= 0 THEN 0
    WHEN COALESCE(sii.tax_type, 'VAT') IN ('VAT Exempt', 'Zero Rated')
      THEN ROUND(COALESCE(sii.quantity, 0)::numeric * COALESCE(sii.cost, 0)::numeric, 2)
    ELSE ROUND((COALESCE(sii.quantity, 0)::numeric * COALESCE(sii.cost, 0)::numeric) / 1.12, 2)
  END
`;

async function loadPlAccounts(): Promise<AccountRow[]> {
  const result = await query(
    `SELECT id, account_code, account_name, account_type
     FROM chart_of_accounts
     WHERE account_type IN ('Income', 'Expense', 'Cost of Goods Sold')
       AND is_active = true
     ORDER BY account_type, account_code`,
  );
  return result.rows;
}

function emptyBalances(accounts: AccountRow[]): Map<number, number> {
  return new Map(accounts.map((a) => [a.id, 0]));
}

function addToMap(map: Map<number, number>, accountId: number, amount: number) {
  if (!amount) return;
  map.set(accountId, (map.get(accountId) || 0) + amount);
}

async function addPosAmounts(
  map: Map<number, number>,
  from: string,
  to: string,
  accountType: 'Income' | 'Cost of Goods Sold',
) {
  const signed =
    accountType === 'Income'
      ? 'COALESCE(SUM(COALESCE(jel.credit, 0) - COALESCE(jel.debit, 0)), 0)'
      : 'COALESCE(SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)), 0)';
  const result = await query(
    `SELECT coa.id AS account_id, ${signed} AS amount
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.entry_id AND je.status = 'Posted'
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE coa.account_type = $3
       AND je.reference_type = 'POS Sale'
       AND je.entry_date >= $1 AND je.entry_date <= $2
     GROUP BY coa.id`,
    [from, to, accountType],
  );
  for (const row of result.rows) {
    addToMap(map, row.account_id, parseFloat(row.amount));
  }
}

async function addProratedInvoiceAmounts(
  map: Map<number, number>,
  from: string,
  to: string,
  accountType: 'Income' | 'Cost of Goods Sold',
) {
  const amountExpr =
    accountType === 'Income'
      ? SQL_LINE_NET_REVENUE
      : SQL_LINE_GL_COGS;
  const accountField =
    accountType === 'Income'
      ? "COALESCE(c.revenue_account_code, '4000')"
      : "COALESCE(c.cogs_account_code, '5000')";

  const collectionSql = `
    WITH cash_events AS (
      SELECT cra.invoice_id,
             cr.payment_date AS event_date,
             cra.applied_amount::numeric AS cash_amount
      FROM collection_receipt_allocations cra
      JOIN collection_receipts cr ON cr.id = cra.receipt_id
      JOIN sales_invoices si ON si.id = cra.invoice_id
      WHERE cr.payment_date >= $1 AND cr.payment_date <= $2
        AND si.status NOT IN ('Void', 'Cancelled')
        AND cra.applied_amount > 0

      UNION ALL

      SELECT ct.reference_id::uuid AS invoice_id,
             ct.created_at::date AS event_date,
             ct.amount::numeric AS cash_amount
      FROM cash_transactions ct
      JOIN sales_invoices si ON si.id = ct.reference_id::uuid
      WHERE ct.reference_type = 'Sales Invoice'
        AND ct.transaction_type = 'Cash In'
        AND (ct.status IS NULL OR ct.status != 'Void')
        AND ct.created_at::date >= $1 AND ct.created_at::date <= $2
        AND si.status NOT IN ('Void', 'Cancelled')
        AND ct.amount > 0
    ),
    line_amounts AS (
      SELECT sii.invoice_id,
             si.total::numeric AS invoice_total,
             ${accountField} AS account_code,
             SUM(${amountExpr}) AS line_amount
      FROM sales_invoice_items sii
      JOIN sales_invoices si ON si.id = sii.invoice_id
      JOIN products p ON p.id = sii.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE si.status NOT IN ('Void', 'Cancelled')
      GROUP BY sii.invoice_id, si.total, ${accountField}
    )
    SELECT coa.id AS account_id,
           SUM(la.line_amount * ce.cash_amount / NULLIF(la.invoice_total, 0)) AS amount
    FROM cash_events ce
    JOIN line_amounts la ON la.invoice_id = ce.invoice_id
    JOIN chart_of_accounts coa ON coa.account_code = la.account_code
    WHERE coa.account_type = $3
    GROUP BY coa.id
  `;

  const result = await query(collectionSql, [from, to, accountType]);
  for (const row of result.rows) {
    addToMap(map, row.account_id, parseFloat(row.amount));
  }
}

async function addCashExpenses(map: Map<number, number>, from: string, to: string) {
  const result = await query(
    `SELECT coa.id AS account_id,
            COALESCE(SUM(e.amount::numeric), 0) AS amount
     FROM expenses e
     JOIN expense_categories ec ON ec.id = e.category_id
     JOIN chart_of_accounts coa ON coa.account_code = ec.account_code
     WHERE e.status = 'Posted'
       AND COALESCE(e.payment_date, e.expense_date) >= $1
       AND COALESCE(e.payment_date, e.expense_date) <= $2
       AND coa.account_type = 'Expense'
     GROUP BY coa.id`,
    [from, to],
  );
  for (const row of result.rows) {
    addToMap(map, row.account_id, parseFloat(row.amount));
  }
}

async function addLoanInterestPaid(map: Map<number, number>, from: string, to: string) {
  const result = await query(
    `SELECT coa.id AS account_id,
            COALESCE(SUM(lpt.interest_component::numeric), 0) AS amount
     FROM loan_payable_transactions lpt
     JOIN chart_of_accounts coa ON coa.account_code = '6130'
     WHERE lpt.txn_type = 'Payment'
       AND lpt.txn_date >= $1 AND lpt.txn_date <= $2
       AND lpt.interest_component > 0
     GROUP BY coa.id`,
    [from, to],
  );
  for (const row of result.rows) {
    addToMap(map, row.account_id, parseFloat(row.amount));
  }
}

async function addPettyCashExpenses(map: Map<number, number>, from: string, to: string) {
  const result = await query(
    `SELECT coa.id AS account_id,
            COALESCE(SUM(COALESCE(jel.debit, 0) - COALESCE(jel.credit, 0)), 0) AS amount
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.entry_id AND je.status = 'Posted'
     JOIN chart_of_accounts coa ON coa.id = jel.account_id
     WHERE coa.account_type = 'Expense'
       AND je.reference_type = 'Petty Cash'
       AND je.entry_date >= $1 AND je.entry_date <= $2
     GROUP BY coa.id`,
    [from, to],
  );
  for (const row of result.rows) {
    addToMap(map, row.account_id, parseFloat(row.amount));
  }
}

async function buildCashPeriodBalances(
  accounts: AccountRow[],
  from: string,
  to: string,
): Promise<Map<number, number>> {
  const map = emptyBalances(accounts);

  await addPosAmounts(map, from, to, 'Income');
  await addPosAmounts(map, from, to, 'Cost of Goods Sold');
  await addProratedInvoiceAmounts(map, from, to, 'Income');
  await addProratedInvoiceAmounts(map, from, to, 'Cost of Goods Sold');
  await addCashExpenses(map, from, to);
  await addPettyCashExpenses(map, from, to);
  await addLoanInterestPaid(map, from, to);

  return map;
}

export async function runCashBasisComparativeIncomeStatement(
  columns: NormalizedPeriodColumn[],
  excludeZero: boolean,
) {
  const accounts = await loadPlAccounts();
  const colCount = columns.length;
  const balanceGrid = new Map<number, number[]>();

  for (const account of accounts) {
    balanceGrid.set(account.id, Array(colCount).fill(0));
  }

  for (let i = 0; i < columns.length; i++) {
    const { from, to } = columns[i];
    const periodMap = await buildCashPeriodBalances(accounts, from, to);
    for (const [accountId, amount] of periodMap) {
      const balances = balanceGrid.get(accountId);
      if (balances) balances[i] = amount;
    }
  }

  const hasAnyBalance = (balances: number[]) =>
    balances.some((b) => Math.abs(b) > 0.009);

  const mapRows = (type: string) =>
    accounts
      .filter((a) => a.account_type === type)
      .map((a) => {
        const balances = balanceGrid.get(a.id) || Array(colCount).fill(0);
        const rounded = balances.map((b) => Math.round(b * 100) / 100);
        const total = rounded.reduce((sum, b) => sum + b, 0);
        return {
          id: a.id,
          account_code: a.account_code,
          account_name: a.account_name,
          balances: rounded,
          total: Math.round(total * 100) / 100,
        };
      })
      .filter((r) => !excludeZero || hasAnyBalance(r.balances));

  const income = mapRows('Income');
  const cogs = mapRows('Cost of Goods Sold');
  const expenses = mapRows('Expense');

  const sumBalances = (rows: Array<{ balances: number[] }>) =>
    Array.from({ length: colCount }, (_, i) =>
      rows.reduce((sum, r) => sum + r.balances[i], 0),
    );

  const totalIncome = sumBalances(income);
  const totalCogs = sumBalances(cogs);
  const totalExpenses = sumBalances(expenses);
  const grossProfit = totalIncome.map((v, i) => v - totalCogs[i]);
  const netIncome = grossProfit.map((v, i) => v - totalExpenses[i]);
  const grandTotal = (arr: number[]) => arr.reduce((s, v) => s + v, 0);

  const marginPct = (numerator: number[], denominator: number[]) =>
    numerator.map((n, i) => (denominator[i] > 0 ? (n / denominator[i]) * 100 : 0));

  return {
    basis: 'cash' as const,
    columns,
    income,
    cost_of_goods_sold: cogs,
    expenses,
    totals: {
      total_income: totalIncome,
      total_cogs: totalCogs,
      gross_profit: grossProfit,
      total_expenses: totalExpenses,
      net_income: netIncome,
      gross_margin_pct: marginPct(grossProfit, totalIncome),
      net_margin_pct: marginPct(netIncome, totalIncome),
      grand_total: {
        total_income: grandTotal(totalIncome),
        total_cogs: grandTotal(totalCogs),
        gross_profit: grandTotal(grossProfit),
        total_expenses: grandTotal(totalExpenses),
        net_income: grandTotal(netIncome),
      },
    },
    exclude_zero: excludeZero,
  };
}
