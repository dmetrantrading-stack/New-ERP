import { query } from '../config/database';
import {
  buildComparativePeriodBalanceSelect,
  ComparativePeriodColumn,
} from './chartOfAccountsBalance';
import { runCashBasisComparativeIncomeStatement } from './cashBasisIncomeStatement';

export type NormalizedPeriodColumn = { from: string; to: string; label: string };

export function defaultColumnLabel(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${from} – ${to}`;
  }
  const isFirstOfMonth = start.getDate() === 1;
  const lastDayOfMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const isLastOfSameMonth =
    end.getFullYear() === start.getFullYear()
    && end.getMonth() === start.getMonth()
    && end.getDate() === lastDayOfMonth;
  if (isFirstOfMonth && isLastOfSameMonth) {
    return start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function normalizeComparativeColumns(rawColumns: ComparativePeriodColumn[]): NormalizedPeriodColumn[] {
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) {
    throw new Error('At least one period column is required');
  }
  if (rawColumns.length > 24) {
    throw new Error('Maximum 24 comparative columns allowed');
  }
  return rawColumns.map((col, i) => {
    const from = String(col.from || '').trim();
    const to = String(col.to || '').trim();
    if (!from || !to) {
      throw new Error(`Column ${i + 1}: from and to dates are required`);
    }
    if (from > to) {
      throw new Error(`Column ${i + 1}: from date must be on or before to date`);
    }
    const label = String(col.label || '').trim() || defaultColumnLabel(from, to);
    return { from, to, label };
  });
}

export async function runComparativeIncomeStatement(options: {
  columns: ComparativePeriodColumn[];
  excludeZero?: boolean;
  basis?: string;
}) {
  const basis = options.basis === 'cash' ? 'cash' : 'accrual';
  const columns = normalizeComparativeColumns(options.columns);
  const excludeZero = options.excludeZero !== false;

  if (basis === 'cash') {
    return runCashBasisComparativeIncomeStatement(columns, excludeZero);
  }

  const { selectSql, params } = buildComparativePeriodBalanceSelect(columns);
  const result = await query(
    `SELECT coa.id, coa.account_type, coa.account_code, coa.account_name,
            ${selectSql}
     FROM chart_of_accounts coa
     WHERE coa.account_type IN ('Income', 'Expense', 'Cost of Goods Sold')
       AND coa.is_active = true
     ORDER BY coa.account_type, coa.account_code`,
    params,
  );

  const colCount = columns.length;
  const parseColBalances = (row: Record<string, unknown>) =>
    Array.from({ length: colCount }, (_, i) => parseFloat(String(row[`col_${i}`] || 0)));

  const hasAnyBalance = (balances: number[]) =>
    balances.some((b) => Math.abs(b) > 0.009);

  const mapRows = (type: string) => {
    const rows = result.rows.filter((r: { account_type: string }) => r.account_type === type);
    return rows
      .map((r: Record<string, unknown>) => {
        const balances = parseColBalances(r);
        const total = balances.reduce((sum, b) => sum + b, 0);
        return {
          id: r.id,
          account_code: r.account_code,
          account_name: r.account_name,
          balances,
          total,
        };
      })
      .filter((r) => !excludeZero || hasAnyBalance(r.balances));
  };

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
    basis,
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
