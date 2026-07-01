import React from 'react';
import { Printer } from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/utils';

type AccountLine = {
  id: number;
  account_code: string;
  account_name: string;
  balance: number | string;
};

type IncomeStatementData = {
  from?: string;
  to?: string;
  income?: AccountLine[];
  cost_of_goods_sold?: AccountLine[];
  expenses?: AccountLine[];
  total_income: number;
  total_cogs: number;
  gross_profit: number;
  total_expenses: number;
  net_income: number;
  gross_margin_pct?: number;
  net_margin_pct?: number;
  server_today?: string;
  hints?: string[];
  pos_sales_count?: number;
};

type Props = {
  data: IncomeStatementData;
  businessName?: string;
  onAccountClick?: (account: AccountLine) => void;
};

function pct(amount: number, base: number): string {
  if (!base || Math.abs(base) < 0.009) return '—';
  return `${((amount / base) * 100).toFixed(1)}%`;
}

function periodLabel(from?: string, to?: string): string {
  if (!from || !to) return 'For the selected period';
  const start = new Date(from);
  const end = new Date(to);
  const yearStart = `${start.getFullYear()}-01-01`;
  if (from === yearStart && to >= from) {
    return `For the year ended ${formatDate(to)}`;
  }
  if (start.getFullYear() === end.getFullYear()) {
    return `For the period ${formatDate(from)} to ${formatDate(to)}`;
  }
  return `For the period ${formatDate(from)} to ${formatDate(to)}`;
}

function AmountCell({ value, revenueBase, emphasize }: { value: number; revenueBase: number; emphasize?: boolean }) {
  return (
    <>
      <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap ${emphasize ? 'font-semibold' : ''}`}>
        {formatCurrency(value)}
      </td>
      <td className={`py-2 px-3 text-right text-gray-500 tabular-nums text-xs print:text-[10px] ${emphasize ? 'font-semibold text-gray-700' : ''}`}>
        {pct(value, revenueBase)}
      </td>
    </>
  );
}

function AccountRows({
  lines,
  revenueBase,
  onAccountClick,
}: {
  lines: AccountLine[];
  revenueBase: number;
  onAccountClick?: (account: AccountLine) => void;
}) {
  if (!lines.length) {
    return (
      <tr>
        <td colSpan={3} className="py-2 px-4 text-sm text-gray-400 italic">
          No activity in this period
        </td>
      </tr>
    );
  }

  return (
    <>
      {lines.map((line) => {
        const amount = parseFloat(String(line.balance || 0));
        return (
          <tr
            key={line.id}
            onClick={() => onAccountClick?.(line)}
            className={onAccountClick ? 'cursor-pointer hover:bg-blue-50/70 transition-colors' : undefined}
          >
            <td className="py-1.5 pl-8 pr-4 text-sm text-gray-700">
              <span className="font-mono text-[11px] text-gray-400 mr-2">{line.account_code}</span>
              {line.account_name}
            </td>
            <AmountCell value={amount} revenueBase={revenueBase} />
          </tr>
        );
      })}
    </>
  );
}

function SubtotalRow({
  label,
  value,
  revenueBase,
  level = 'section',
}: {
  label: string;
  value: number;
  revenueBase: number;
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
      ? 'py-3 px-4 text-sm font-bold uppercase tracking-wide'
      : level === 'major'
        ? 'py-2.5 px-4 text-sm font-bold text-slate-800'
        : 'py-2 px-4 text-sm font-semibold text-slate-700';

  return (
    <tr className={rowClass}>
      <td className={labelClass}>{label}</td>
      <td className={`py-2 px-4 text-right tabular-nums font-bold ${level === 'final' ? 'text-base print:text-black' : ''}`}>
        {formatCurrency(value)}
      </td>
      <td className={`py-2 px-3 text-right tabular-nums text-xs font-semibold ${level === 'final' ? 'print:text-black' : 'text-slate-600'}`}>
        {pct(value, revenueBase)}
      </td>
    </tr>
  );
}

export default function IncomeStatementReport({ data, businessName, onAccountClick }: Props) {
  const revenueBase = data.total_income || 0;
  const netPositive = data.net_income >= 0;

  return (
    <div className="space-y-4">
      {(data.hints || []).length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
          {(data.hints || []).map((hint, i) => (
            <p key={i} className="text-xs text-amber-900">{hint}</p>
          ))}
        </div>
      )}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
        <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-b from-slate-50 to-white print:bg-white">
          <div className="text-center max-w-2xl mx-auto">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 mb-1 print:text-gray-500">
              Financial Report
            </p>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              {businessName || 'Company Name'}
            </h2>
            <h3 className="text-base font-semibold text-slate-700 mt-1">Statement of Profit and Loss</h3>
            <p className="text-sm text-slate-500 mt-1">{periodLabel(data.from, data.to)}</p>
            <p className="text-[11px] text-slate-400 mt-2">Amounts in Philippine Peso (PHP) · Accrual basis · Posted journal entries only</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-2.5 px-4 text-left">Account</th>
                <th className="py-2.5 px-4 text-right w-36">Amount</th>
                <th className="py-2.5 px-3 text-right w-24">% Rev.</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-white">
                <td colSpan={3} className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Revenue
                </td>
              </tr>
              <AccountRows lines={data.income || []} revenueBase={revenueBase} onAccountClick={onAccountClick} />
              <SubtotalRow label="Total Revenue" value={data.total_income} revenueBase={revenueBase} />

              <tr>
                <td colSpan={3} className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-amber-700 pt-4">
                  Cost of Goods Sold
                </td>
              </tr>
              <AccountRows lines={data.cost_of_goods_sold || []} revenueBase={revenueBase} onAccountClick={onAccountClick} />
              <SubtotalRow label="Total Cost of Goods Sold" value={data.total_cogs} revenueBase={revenueBase} />

              <SubtotalRow label="Gross Profit" value={data.gross_profit} revenueBase={revenueBase} level="major" />

              <tr>
                <td colSpan={3} className="py-2 px-4 text-[10px] font-bold uppercase tracking-wider text-rose-700 pt-4">
                  Operating Expenses
                </td>
              </tr>
              <AccountRows lines={data.expenses || []} revenueBase={revenueBase} onAccountClick={onAccountClick} />
              <SubtotalRow label="Total Operating Expenses" value={data.total_expenses} revenueBase={revenueBase} />

              <SubtotalRow
                label={netPositive ? 'Net Income' : 'Net Loss'}
                value={data.net_income}
                revenueBase={revenueBase}
                level="final"
              />
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 bg-slate-50/50 grid grid-cols-2 md:grid-cols-4 gap-3 print:bg-white">
          {[
            { label: 'Total Revenue', value: formatCurrency(data.total_income) },
            { label: 'Gross Profit', value: formatCurrency(data.gross_profit) },
            { label: 'Gross Margin', value: `${(data.gross_margin_pct ?? 0).toFixed(1)}%` },
            { label: 'Net Margin', value: `${(data.net_margin_pct ?? 0).toFixed(1)}%`, highlight: netPositive ? true : false },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 print:border-gray-200">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</div>
              <div className={`text-sm font-bold tabular-nums ${item.highlight === false ? 'text-red-600' : item.highlight ? 'text-emerald-700' : 'text-slate-800'}`}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400 print:hidden">
        Click any account line to open the ledger drill-down for that period.
      </p>
    </div>
  );
}

export function IncomeStatementToolbar({
  from,
  to,
  loading,
  serverToday,
  onFromChange,
  onToChange,
  onRefresh,
}: {
  from: string;
  to: string;
  loading?: boolean;
  serverToday?: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      {serverToday && (
        <p className="text-xs text-gray-500 w-full mb-1">
          Books date (server): <strong>{serverToday}</strong> — use this as the &quot;To&quot; date to include today&apos;s POS sales.
        </p>
      )}
      <div>
        <label className="block text-xs text-gray-500 mb-1">From</label>
        <input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="input-field text-sm" />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">To</label>
        <input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="input-field text-sm" />
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Loading…' : 'Apply'}
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
  );
}
