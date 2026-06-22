import React from 'react';
import { ArrowLeft, LucideIcon } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';

export const SALES_PRIMARY = '#1E40AF';

export const SQ_STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
  Sent: 'bg-blue-50 text-blue-800 ring-1 ring-blue-100',
  Approved: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100',
  Expired: 'bg-amber-50 text-amber-800 ring-1 ring-amber-100',
  Cancelled: 'bg-red-50 text-red-700 ring-1 ring-red-100',
};

export function SalesStatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide ${SQ_STATUS_COLORS[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}

export function SalesModuleHeader({
  icon: Icon,
  title,
  badge,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: SALES_PRIMARY }}>
      <div className="flex items-center gap-3 min-w-0">
        <Icon size={18} className="text-white/90 shrink-0" />
        <h1 className="text-white font-semibold text-sm tracking-wide truncate">{title}</h1>
        {badge}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function SalesDocHeader({
  title,
  docNumber,
  status,
  onBack,
  onClose,
  actions,
}: {
  title: string;
  docNumber: string;
  status: string;
  onBack: () => void;
  onClose?: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: SALES_PRIMARY }}>
      <div className="flex items-center gap-3 min-w-0">
        <button type="button" onClick={onBack} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded shrink-0">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-white font-semibold text-sm tracking-wide">{title}</h1>
        <span className="text-xs font-mono text-white/80 truncate">{docNumber}</span>
        <SalesStatusBadge status={status} />
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {actions}
        {onClose && (
          <button type="button" onClick={onClose} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded">
            <span className="text-lg leading-none">&times;</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function SalesSectionCard({
  title,
  subtitle,
  action,
  children,
  className = '',
  bodyClassName,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-b from-slate-50/80 to-white">
        <div>
          <div className="text-xs font-semibold text-slate-800">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className={bodyClassName ?? 'p-4'}>{children}</div>
    </div>
  );
}

export function SalesKpiCard({
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

export function SalesListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  statusFilter,
  onStatusFilterChange,
  statusOptions,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  statusOptions: { value: string; label: string }[];
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-3 flex flex-col lg:flex-row lg:items-center gap-3">
      <div className="relative flex-1 min-w-[200px]">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="input-field text-sm w-full pl-9"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">⌕</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {statusOptions.map((opt) => (
          <button
            key={opt.value || 'all'}
            type="button"
            onClick={() => onStatusFilterChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              statusFilter === opt.value
                ? 'bg-blue-700 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SalesQuoteSummary({
  itemCount,
  totalQty,
  subtotal,
  totalDisc,
  taxTotals,
  totalVat,
  validUntil,
  validityDays,
  customer,
}: {
  itemCount: number;
  totalQty: number;
  subtotal: number;
  totalDisc: number;
  taxTotals: {
    totalVatableSales: number;
    totalVatExemptSales: number;
    totalZeroRatedSales: number;
  };
  totalVat: number;
  validUntil?: string;
  validityDays?: number | string;
  customer?: { customer_name?: string; address?: string; customer_type?: string } | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Quotation Summary</div>
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="divide-y divide-slate-100 text-xs">
            <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Line items</span><span className="font-medium tabular-nums">{itemCount}</span></div>
            <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Total quantity</span><span className="font-medium tabular-nums">{totalQty}</span></div>
            <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Subtotal</span><span className="font-medium tabular-nums">{formatCurrency(subtotal)}</span></div>
            {totalDisc > 0 && (
              <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Discount</span><span className="font-medium text-amber-700 tabular-nums">({formatCurrency(totalDisc)})</span></div>
            )}
            <div className="flex justify-between px-3 py-2"><span className="text-slate-500">VATable sales</span><span className="font-medium tabular-nums">{formatCurrency(taxTotals.totalVatableSales)}</span></div>
            {taxTotals.totalVatExemptSales > 0 && (
              <div className="flex justify-between px-3 py-2"><span className="text-slate-500">VAT exempt</span><span className="font-medium tabular-nums">{formatCurrency(taxTotals.totalVatExemptSales)}</span></div>
            )}
            {taxTotals.totalZeroRatedSales > 0 && (
              <div className="flex justify-between px-3 py-2"><span className="text-slate-500">Zero rated</span><span className="font-medium tabular-nums">{formatCurrency(taxTotals.totalZeroRatedSales)}</span></div>
            )}
            <div className="flex justify-between px-3 py-2"><span className="text-slate-500">VAT amount</span><span className="font-medium tabular-nums">{formatCurrency(totalVat)}</span></div>
          </div>
          <div className="flex justify-between px-3 py-3 bg-slate-900 text-white">
            <span className="text-sm font-bold">Grand Total</span>
            <span className="text-sm font-bold tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
        </div>
      </div>

      {validUntil && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
          <div className="text-[10px] font-semibold text-blue-700 uppercase tracking-wider mb-1">Offer validity</div>
          <div className="text-sm font-semibold text-blue-900">{new Date(validUntil).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
          {validityDays && <div className="text-[11px] text-blue-600 mt-1">{validityDays} days from quotation date</div>}
        </div>
      )}

      {customer && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Bill to</div>
          <div className="font-semibold text-slate-800 text-sm">{customer.customer_name}</div>
          {customer.customer_type && <div className="text-[11px] text-slate-500 mt-0.5">{customer.customer_type} customer</div>}
          <div className="text-[11px] text-slate-600 mt-2 leading-relaxed">{customer.address || '—'}</div>
        </div>
      )}
    </div>
  );
}
