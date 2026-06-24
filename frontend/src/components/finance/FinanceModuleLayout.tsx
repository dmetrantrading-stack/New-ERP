import React from 'react';
import { LucideIcon, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PRIMARY, FINANCE_FONT, financeTabClass } from '../../lib/financeUtils';

export function FinancePageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-slate-50" style={{ fontFamily: FINANCE_FONT }}>
      {children}
    </div>
  );
}

export function FinanceModuleHeader({
  icon: Icon,
  title,
  badges,
  tabs,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  badges?: React.ReactNode;
  tabs?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3 print:hidden" style={{ backgroundColor: PRIMARY }}>
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <Icon size={18} className="text-white/90 shrink-0" />
        <h1 className="text-white font-semibold text-sm tracking-wide truncate">{title}</h1>
        {badges}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {tabs}
        {actions}
      </div>
    </div>
  );
}

export function FinanceHeaderBadge({ children }: { children: React.ReactNode }) {
  return <span className="text-xs bg-white/20 text-white px-2.5 py-0.5 rounded-full tabular-nums">{children}</span>;
}

export function FinanceTabBar({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: readonly { id: string; label: string }[];
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5">
      {tabs.map(({ id, label }) => (
        <button key={id} type="button" onClick={() => onTabChange(id)} className={financeTabClass(activeTab === id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function FinanceKpiCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'blue' | 'green' | 'amber' | 'red';
}) {
  const tones = {
    default: 'border-slate-200 bg-white',
    blue: 'border-blue-100 bg-blue-50/50',
    green: 'border-emerald-100 bg-emerald-50/50',
    amber: 'border-amber-100 bg-amber-50/50',
    red: 'border-red-100 bg-red-50/50',
  };
  const valueColors = {
    default: 'text-slate-900',
    blue: 'text-blue-900',
    green: 'text-emerald-800',
    amber: 'text-amber-800',
    red: 'text-red-700',
  };

  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-1 ${valueColors[tone]}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

export function FinanceSearchToolbar({
  search,
  onSearchChange,
  placeholder,
  children,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3 flex flex-col lg:flex-row lg:items-center gap-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={placeholder}
          className="input-field text-sm w-full pl-9"
        />
      </div>
      {children}
    </div>
  );
}

export function FinanceDataCard({
  title,
  subtitle,
  actions,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
        {actions}
      </div>
      {children}
      {footer}
    </div>
  );
}

export function FinanceTableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export const financeTableHeadClass = 'border-b border-slate-200 bg-slate-50/80 text-[10px] font-semibold uppercase tracking-wider text-slate-500';

export function FinanceStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Draft: 'bg-amber-50 text-amber-800 ring-amber-100',
    Posted: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    Active: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    'Paid Off': 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    Replenished: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    Paid: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    Unreplenished: 'bg-amber-50 text-amber-800 ring-amber-100',
    Partial: 'bg-blue-50 text-blue-800 ring-blue-100',
    Void: 'bg-slate-100 text-slate-600 ring-slate-200',
    Cancelled: 'bg-red-50 text-red-700 ring-red-100',
    Inactive: 'bg-slate-100 text-slate-600 ring-slate-200',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ring-inset ${styles[status] || 'bg-slate-50 text-slate-700 ring-slate-200'}`}>
      {status}
    </span>
  );
}

export function FinanceSidebar({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-72 flex-shrink-0 border-l border-slate-200 bg-white p-4 space-y-4 overflow-y-auto print:hidden">
      {children}
    </div>
  );
}

export function FinanceSidebarStat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{label}</div>
      <p className="text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}

export function FinanceQuickLinks({ links }: { links: { to: string; label: string }[] }) {
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-800 leading-relaxed space-y-2">
      {links.map((l) => (
        <Link key={l.to} to={l.to} className="block text-blue-700 hover:underline font-medium">{l.label}</Link>
      ))}
    </div>
  );
}

export function FinancePrimaryButton({
  onClick,
  children,
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded-lg text-xs font-bold hover:bg-blue-50 disabled:opacity-50 shadow-sm"
    >
      {children}
    </button>
  );
}
