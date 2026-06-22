import React from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/utils';

export const ACCOUNT_TYPE_STYLES: Record<string, string> = {
  Asset: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
  Liability: 'bg-blue-50 text-blue-800 ring-blue-100',
  Equity: 'bg-violet-50 text-violet-800 ring-violet-100',
  Income: 'bg-teal-50 text-teal-800 ring-teal-100',
  Expense: 'bg-rose-50 text-rose-800 ring-rose-100',
  'Cost of Goods Sold': 'bg-amber-50 text-amber-800 ring-amber-100',
};

export function AccountTypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${ACCOUNT_TYPE_STYLES[type] || 'bg-slate-50 text-slate-700 ring-slate-200'}`}>
      {type}
    </span>
  );
}

export function ReportHeader({
  businessName,
  title,
  subtitle,
  footnote = 'Amounts in Philippine Peso (PHP) · Posted journal entries only',
}: {
  businessName?: string;
  title: string;
  subtitle?: string;
  footnote?: string;
}) {
  return (
    <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-b from-slate-50 to-white print:bg-white">
      <div className="text-center max-w-2xl mx-auto">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 mb-1 print:text-gray-500">
          Financial Report
        </p>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">{businessName || 'Company Name'}</h2>
        <h3 className="text-base font-semibold text-slate-700 mt-1">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        {footnote && <p className="text-[11px] text-slate-400 mt-2">{footnote}</p>}
      </div>
    </div>
  );
}

export function ReportKpiGrid({ items }: { items: { label: string; value: string; hint?: string; tone?: 'default' | 'green' | 'red' | 'amber' | 'blue' }[] }) {
  const toneClass = (tone?: string) => {
    if (tone === 'green') return 'text-emerald-700';
    if (tone === 'red') return 'text-red-700';
    if (tone === 'amber') return 'text-amber-700';
    if (tone === 'blue') return 'text-blue-700';
    return 'text-slate-800';
  };

  return (
    <div className="px-6 py-4 border-t border-gray-100 bg-slate-50/50 grid grid-cols-2 md:grid-cols-4 gap-3 print:bg-white">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 print:border-gray-200">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</div>
          <div className={`text-sm font-bold tabular-nums ${toneClass(item.tone)}`}>{item.value}</div>
          {item.hint && <div className="text-[10px] text-slate-400 mt-0.5">{item.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function ReportShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:border-gray-300">
      {children}
      {footer}
    </div>
  );
}

export function AsOfToolbar({
  asOf,
  loading,
  onAsOfChange,
  onRefresh,
  label = 'As of date',
}: {
  asOf: string;
  loading?: boolean;
  onAsOfChange: (v: string) => void;
  onRefresh: () => void;
  label?: string;
}) {
  return (
    <DateToolbar
      from={asOf}
      to=""
      loading={loading}
      onFromChange={onAsOfChange}
      onToChange={() => {}}
      onRefresh={onRefresh}
      fromLabel={label}
      hideTo
    />
  );
}

export function DateToolbar({
  from,
  to,
  loading,
  onFromChange,
  onToChange,
  onRefresh,
  fromLabel = 'From',
  toLabel = 'To',
  hideTo,
}: {
  from: string;
  to: string;
  loading?: boolean;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onRefresh: () => void;
  fromLabel?: string;
  toLabel?: string;
  hideTo?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{fromLabel}</label>
        <input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="input-field text-sm" />
      </div>
      {!hideTo && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">{toLabel}</label>
          <input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="input-field text-sm" />
        </div>
      )}
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
      >
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
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

export function TableSectionHeader({ label, tone = 'slate' }: { label: string; tone?: 'slate' | 'emerald' | 'blue' | 'violet' | 'amber' }) {
  const colors = {
    slate: 'text-slate-600',
    emerald: 'text-emerald-700',
    blue: 'text-blue-700',
    violet: 'text-violet-700',
    amber: 'text-amber-700',
  };
  return (
    <tr>
      <td colSpan={99} className={`py-2 px-4 text-[10px] font-bold uppercase tracking-wider ${colors[tone]} bg-white`}>
        {label}
      </td>
    </tr>
  );
}

export function EmptyReportRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 px-4 text-center text-sm text-gray-400 italic">
        {message}
      </td>
    </tr>
  );
}

export function asOfSubtitle(asOf: string) {
  return `As of ${formatDate(asOf)}`;
}

export function MoneyCell({ value, emphasize, className = '' }: { value: number; emphasize?: boolean; className?: string }) {
  return (
    <td className={`py-2 px-4 text-right tabular-nums whitespace-nowrap ${emphasize ? 'font-bold' : 'font-medium'} ${className}`}>
      {formatCurrency(value)}
    </td>
  );
}

export function AccountNameCell({
  code,
  name,
  indent,
  onClick,
}: {
  code: string;
  name: string;
  indent?: boolean;
  onClick?: () => void;
}) {
  return (
    <td
      className={`py-1.5 pr-4 text-sm text-gray-700 ${indent ? 'pl-8' : 'pl-4'} ${onClick ? 'cursor-pointer hover:text-blue-700' : ''}`}
      onClick={onClick}
    >
      <span className="font-mono text-[11px] text-gray-400 mr-2">{code}</span>
      {name}
    </td>
  );
}
