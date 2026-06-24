import React from 'react';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export type ComparativeColumn = {
  id: string;
  from: string;
  to: string;
  label: string;
};

export type ComparativeAccountLine = {
  id: number;
  account_code: string;
  account_name: string;
  balances: number[];
  total: number;
};

export type ComparativeIncomeStatementData = {
  basis: string;
  columns: Array<{ from: string; to: string; label: string }>;
  income: ComparativeAccountLine[];
  cost_of_goods_sold: ComparativeAccountLine[];
  expenses: ComparativeAccountLine[];
  totals: {
    total_income: number[];
    total_cogs: number[];
    gross_profit: number[];
    total_expenses: number[];
    net_income: number[];
    gross_margin_pct: number[];
    net_margin_pct: number[];
    grand_total: {
      total_income: number;
      total_cogs: number;
      gross_profit: number;
      total_expenses: number;
      net_income: number;
    };
  };
  exclude_zero: boolean;
};

type AccountClickPayload = ComparativeAccountLine & {
  drillFrom: string;
  drillTo: string;
};

type ReportProps = {
  data: ComparativeIncomeStatementData;
  businessName?: string;
  title?: string;
  footer?: string;
  showAccountCodes?: boolean;
  onAccountClick?: (account: AccountClickPayload, columnIndex: number) => void;
};

function monthRange(year: number, month: number): Omit<ComparativeColumn, 'id'> {
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  const label = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return { from, to, label };
}

export function createColumnId() {
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultComparativeColumns(): ComparativeColumn[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const current = monthRange(y, m);
  return [{ id: createColumnId(), ...current }];
}

export function fullYearColumns(year: number): ComparativeColumn[] {
  return Array.from({ length: 12 }, (_, i) => {
    const range = monthRange(year, i + 1);
    return { id: createColumnId(), ...range };
  });
}

function AmountCells({
  balances,
  total,
  emphasize,
  onCellClick,
}: {
  balances: number[];
  total: number;
  emphasize?: boolean;
  onCellClick?: (columnIndex: number) => void;
}) {
  const cellClass = `py-2 px-3 text-right tabular-nums whitespace-nowrap text-sm ${
    emphasize ? 'font-bold' : ''
  } ${onCellClick ? 'cursor-pointer hover:bg-blue-50/70' : ''}`;

  return (
    <>
      {balances.map((value, i) => (
        <td
          key={i}
          className={cellClass}
          onClick={onCellClick ? () => onCellClick(i) : undefined}
        >
          {formatCurrency(value)}
        </td>
      ))}
      <td className={`${cellClass} bg-slate-50/80 border-l border-slate-200`}>
        {formatCurrency(total)}
      </td>
    </>
  );
}

function AccountRows({
  lines,
  columns,
  showAccountCodes,
  onAccountClick,
}: {
  lines: ComparativeAccountLine[];
  columns: ComparativeIncomeStatementData['columns'];
  showAccountCodes?: boolean;
  onAccountClick?: (account: AccountClickPayload, columnIndex: number) => void;
}) {
  if (!lines.length) {
    return (
      <tr>
        <td colSpan={columns.length + 2} className="py-2 px-4 text-sm text-gray-400 italic">
          No activity in the selected periods
        </td>
      </tr>
    );
  }

  return (
    <>
      {lines.map((line) => (
        <tr key={line.id}>
          <td className="py-1.5 pl-6 pr-4 text-sm text-gray-700 sticky left-0 bg-white z-[1] min-w-[200px]">
            {showAccountCodes && (
              <span className="font-mono text-[11px] text-gray-400 mr-2">{line.account_code}</span>
            )}
            {line.account_name}
          </td>
          <AmountCells
            balances={line.balances}
            total={line.total}
            onCellClick={
              onAccountClick
                ? (columnIndex) =>
                    onAccountClick(
                      {
                        ...line,
                        drillFrom: columns[columnIndex].from,
                        drillTo: columns[columnIndex].to,
                      },
                      columnIndex,
                    )
                : undefined
            }
          />
        </tr>
      ))}
    </>
  );
}

function SubtotalRow({
  label,
  balances,
  total,
  level = 'section',
}: {
  label: string;
  balances: number[];
  total: number;
  level?: 'section' | 'major' | 'final';
}) {
  const rowClass =
    level === 'final'
      ? 'bg-slate-900 text-white print:bg-gray-100 print:text-black'
      : level === 'major'
        ? 'bg-slate-50 border-y border-slate-200'
        : 'border-t border-slate-200';

  const labelClass =
    level === 'final'
      ? 'py-3 px-4 text-sm font-bold uppercase tracking-wide sticky left-0 bg-slate-900 print:bg-gray-100'
      : level === 'major'
        ? 'py-2.5 px-4 text-sm font-bold text-slate-800 sticky left-0 bg-slate-50'
        : 'py-2 px-4 text-sm font-semibold text-slate-700 sticky left-0 bg-white';

  const amountClass = `py-2 px-3 text-right tabular-nums font-bold text-sm ${
    level === 'final' ? 'text-base print:text-black' : ''
  }`;

  return (
    <tr className={rowClass}>
      <td className={labelClass}>{label}</td>
      {balances.map((value, i) => (
        <td key={i} className={amountClass}>
          {formatCurrency(value)}
        </td>
      ))}
      <td className={`${amountClass} bg-slate-100/80 border-l border-slate-200 print:bg-gray-50`}>
        {formatCurrency(total)}
      </td>
    </tr>
  );
}

export default function ComparativeIncomeStatementReport({
  data,
  businessName,
  title,
  footer,
  showAccountCodes = true,
  onAccountClick,
}: ReportProps) {
  const { columns, totals } = data;
  const netPositive = totals.grand_total.net_income >= 0;
  const colSpan = columns.length + 2;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
        <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-b from-slate-50 to-white print:bg-white">
          <div className="text-center max-w-3xl mx-auto">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 mb-1 print:text-gray-500">
              Financial Report
            </p>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              {businessName || 'Company Name'}
            </h2>
            <h3 className="text-base font-semibold text-slate-700 mt-1">
              {title || 'Statement of Profit and Loss'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              Comparative periods · {data.basis === 'cash' ? 'Cash basis' : 'Accrual basis'}
              {data.basis === 'cash'
                ? ' · Revenue when collected · Expenses when paid'
                : ' · Posted journal entries only'}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left sticky left-0 bg-slate-50/80 z-[2] min-w-[200px]">Account</th>
                {columns.map((col, i) => (
                  <th key={i} className="py-2.5 px-3 text-right whitespace-nowrap min-w-[110px]">
                    <div>{col.label}</div>
                    <div className="font-normal normal-case text-[9px] text-slate-400 mt-0.5">
                      {col.from} – {col.to}
                    </div>
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right whitespace-nowrap min-w-[110px] bg-slate-100/80 border-l border-slate-200">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={colSpan} className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Revenue
                </td>
              </tr>
              <AccountRows
                lines={data.income}
                columns={columns}
                showAccountCodes={showAccountCodes}
                onAccountClick={onAccountClick}
              />
              <SubtotalRow
                label="Total Revenue"
                balances={totals.total_income}
                total={totals.grand_total.total_income}
              />

              <tr>
                <td colSpan={colSpan} className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-amber-700 pt-4">
                  Cost of Goods Sold
                </td>
              </tr>
              <AccountRows
                lines={data.cost_of_goods_sold}
                columns={columns}
                showAccountCodes={showAccountCodes}
                onAccountClick={onAccountClick}
              />
              <SubtotalRow
                label="Total Cost of Goods Sold"
                balances={totals.total_cogs}
                total={totals.grand_total.total_cogs}
              />
              <SubtotalRow
                label="Gross Profit"
                balances={totals.gross_profit}
                total={totals.grand_total.gross_profit}
                level="major"
              />

              <tr>
                <td colSpan={colSpan} className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-rose-700 pt-4">
                  Operating Expenses
                </td>
              </tr>
              <AccountRows
                lines={data.expenses}
                columns={columns}
                showAccountCodes={showAccountCodes}
                onAccountClick={onAccountClick}
              />
              <SubtotalRow
                label="Total Operating Expenses"
                balances={totals.total_expenses}
                total={totals.grand_total.total_expenses}
              />
              <SubtotalRow
                label={netPositive ? 'Net Income' : 'Net Loss'}
                balances={totals.net_income}
                total={totals.grand_total.net_income}
                level="final"
              />
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 bg-slate-50/50 grid grid-cols-2 md:grid-cols-4 gap-3 print:bg-white">
          {[
            { label: 'Total Revenue', value: formatCurrency(totals.grand_total.total_income) },
            { label: 'Gross Profit', value: formatCurrency(totals.grand_total.gross_profit) },
            {
              label: 'Gross Margin',
              value:
                totals.grand_total.total_income > 0
                  ? `${((totals.grand_total.gross_profit / totals.grand_total.total_income) * 100).toFixed(1)}%`
                  : '0.0%',
            },
            {
              label: 'Net Income',
              value: formatCurrency(totals.grand_total.net_income),
              highlight: netPositive,
            },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 print:border-gray-200">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</div>
              <div
                className={`text-sm font-bold tabular-nums ${
                  item.highlight === false ? 'text-red-600' : item.highlight ? 'text-emerald-700' : 'text-slate-800'
                }`}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {footer ? (
          <div className="px-6 py-3 border-t border-gray-100 text-xs text-slate-500 whitespace-pre-wrap print:text-gray-600">
            {footer}
          </div>
        ) : null}
      </div>

      <p className="text-xs text-gray-400 print:hidden">
        Click any amount to open the ledger drill-down for that period.
      </p>
    </div>
  );
}

export function ComparativeIncomeStatementToolbar({
  columns,
  loading,
  excludeZero,
  showAccountCodes,
  onColumnsChange,
  onExcludeZeroChange,
  onShowAccountCodesChange,
  onRefresh,
  runLabel = 'Run report',
}: {
  columns: ComparativeColumn[];
  loading?: boolean;
  excludeZero: boolean;
  showAccountCodes: boolean;
  onColumnsChange: (columns: ComparativeColumn[]) => void;
  onExcludeZeroChange: (v: boolean) => void;
  onShowAccountCodesChange: (v: boolean) => void;
  onRefresh: () => void;
  runLabel?: string;
}) {
  const year = new Date().getFullYear();

  const updateColumn = (id: string, patch: Partial<ComparativeColumn>) => {
    onColumnsChange(columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeColumn = (id: string) => {
    if (columns.length <= 1) return;
    onColumnsChange(columns.filter((c) => c.id !== id));
  };

  const addColumn = () => {
    if (columns.length >= 24) return;
    const last = columns[columns.length - 1];
    const lastEnd = new Date(`${last.to}T00:00:00`);
    const nextMonth = new Date(lastEnd.getFullYear(), lastEnd.getMonth() + 1, 1);
    const range = monthRange(nextMonth.getFullYear(), nextMonth.getMonth() + 1);
    onColumnsChange([...columns, { id: createColumnId(), ...range }]);
  };

  const addFullYear = () => {
    onColumnsChange(fullYearColumns(year));
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Comparative columns</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addColumn}
            disabled={columns.length >= 24}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <Plus size={14} />
            Add column
          </button>
          <button
            type="button"
            onClick={addFullYear}
            className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Full year {year}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {columns.map((col, index) => (
          <div key={col.id} className="flex flex-wrap items-end gap-2 p-2 rounded-lg bg-slate-50/80 border border-slate-100">
            <span className="text-[10px] font-semibold text-slate-400 w-6 text-center pb-2">{index + 1}</span>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={col.from}
                onChange={(e) => updateColumn(col.id, { from: e.target.value })}
                className="input-field text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={col.to}
                onChange={(e) => updateColumn(col.id, { to: e.target.value })}
                className="input-field text-sm"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] text-gray-500 mb-1">Column name</label>
              <input
                type="text"
                value={col.label}
                onChange={(e) => updateColumn(col.id, { label: e.target.value })}
                placeholder="Optional"
                className="input-field text-sm w-full"
              />
            </div>
            <button
              type="button"
              onClick={() => removeColumn(col.id)}
              disabled={columns.length <= 1}
              className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-30"
              title="Remove column"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-gray-100">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={excludeZero}
            onChange={(e) => onExcludeZeroChange(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600"
          />
          Exclude zero balances
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={showAccountCodes}
            onChange={(e) => onShowAccountCodesChange(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-blue-600"
          />
          Show account codes
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : runLabel}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
        >
          <Printer size={15} />
          Print
        </button>
      </div>
    </div>
  );
}
