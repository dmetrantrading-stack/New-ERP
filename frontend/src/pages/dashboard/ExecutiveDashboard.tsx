import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  RefreshCw, TrendingUp, TrendingDown, DollarSign, Receipt, CreditCard,
  Banknote, LayoutDashboard, ArrowRight, FileText, ShoppingCart, Calculator,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PRIMARY, AGING_LABELS } from '../../lib/payablesUtils';

type DashboardData = {
  today_sales?: { count: number; amount: number };
  monthly_sales?: { count: number; amount: number };
  accounts_receivable?: { total: number };
  accounts_payable?: { total: number };
  bank_cash?: { total: number };
  net_profit?: { sales: number; cogs: number; expenses: number; net: number };
  aging_receivables?: {
    buckets?: Record<string, number>;
    total?: number;
    count?: number;
  };
  recent_collections?: any[];
  recent_payments?: any[];
};

const AGING_KEYS = ['current', '1_30', '31_60', '61_90', 'over_90', 'no_due'] as const;

const QUICK_LINKS = [
  { label: 'Sales Invoices', path: '/sales', icon: FileText },
  { label: 'Collections', path: '/collections', icon: Receipt },
  { label: 'Payables', path: '/payables', icon: CreditCard },
  { label: 'Bank & Cash', path: '/bank-cash', icon: Banknote },
  { label: 'Accounting', path: '/accounting', icon: Calculator },
  { label: 'POS', path: '/pos', icon: ShoppingCart },
];

export default function ExecutiveDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = () => {
    setRefreshing(true);
    api.get('/dashboard/executive')
      .then(r => setData(r.data))
      .catch(() => toast.error('Failed to load dashboard'))
      .finally(() => { setLoading(false); setRefreshing(false); });
  };

  useEffect(() => { loadData(); }, []);

  if (loading) {
    return (
      <div className="h-[calc(100vh-4rem)] -m-6 flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-700" />
      </div>
    );
  }

  const np = data?.net_profit;
  const netProfitSub = np
    ? `Sales ${formatCurrency(np.sales)} − COGS ${formatCurrency(np.cogs)} − Exp ${formatCurrency(np.expenses)}`
    : undefined;

  const kpis = [
    {
      label: "Today's Sales",
      value: data?.today_sales?.amount || 0,
      sub: `${data?.today_sales?.count || 0} transaction(s)`,
      icon: DollarSign,
      action: () => navigate('/pos'),
    },
    {
      label: 'Monthly Sales',
      value: data?.monthly_sales?.amount || 0,
      sub: `${data?.monthly_sales?.count || 0} transaction(s)`,
      icon: TrendingUp,
      action: () => navigate('/sales'),
    },
    {
      label: 'Accounts Receivable',
      value: data?.accounts_receivable?.total || 0,
      sub: 'Open invoice balances',
      icon: Receipt,
      action: () => navigate('/collections'),
    },
    {
      label: 'Accounts Payable',
      value: data?.accounts_payable?.total || 0,
      sub: 'Open AP voucher balances',
      icon: CreditCard,
      action: () => navigate('/payables'),
    },
    {
      label: 'Bank & Cash',
      value: data?.bank_cash?.total || 0,
      sub: 'Active account balances',
      icon: Banknote,
      action: () => navigate('/bank-cash'),
    },
    {
      label: 'Net Profit (MTD)',
      value: np?.net || 0,
      sub: netProfitSub,
      icon: (np?.net ?? 0) >= 0 ? TrendingUp : TrendingDown,
      positive: (np?.net ?? 0) >= 0,
      action: () => navigate('/accounting'),
    },
  ];

  const aging = data?.aging_receivables;
  const buckets = aging?.buckets || {};
  const collections = data?.recent_collections || [];
  const payments = data?.recent_payments || [];

  const openPrint = (url: string) => {
    const token = encodeURIComponent(localStorage.getItem('token') || '');
    window.open(`${url}?token=${token}`, '_blank');
  };

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <LayoutDashboard size={18} className="text-white/90" />
          <div>
            <h1 className="text-white font-semibold text-sm tracking-wide">Executive Dashboard</h1>
            <p className="text-[10px] text-white/70 leading-none mt-0.5">D METRAN TRADING — financial overview</p>
          </div>
        </div>
        <button
          onClick={loadData}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20 disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="flex-shrink-0 px-4 py-3 bg-white border-b border-gray-200">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            const isProfit = kpi.label.startsWith('Net Profit');
            return (
              <button
                key={kpi.label}
                type="button"
                onClick={kpi.action}
                className="text-left bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 hover:border-blue-300 hover:bg-blue-50/40 transition-colors group"
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide truncate">{kpi.label}</span>
                  <Icon size={13} className="text-blue-700 flex-shrink-0" />
                </div>
                <p className={`text-base font-bold leading-tight ${isProfit ? (kpi.positive ? 'text-green-700' : 'text-red-700') : 'text-gray-900'}`}>
                  {formatCurrency(kpi.value)}
                </p>
                {kpi.sub && (
                  <p className="text-[10px] text-gray-500 mt-0.5 truncate" title={kpi.sub}>{kpi.sub}</p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* AR aging strip */}
      {aging && (
        <div className="flex-shrink-0 px-4 py-3 bg-white border-b border-gray-200">
          <div className="flex flex-wrap items-stretch gap-2">
            <button
              type="button"
              onClick={() => navigate('/collections')}
              className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 min-w-[130px] text-left hover:border-blue-300"
            >
              <div className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Total AR</div>
              <div className="text-lg font-bold text-blue-900">{formatCurrency(aging.total || 0)}</div>
              <div className="text-[10px] text-blue-700">{aging.count || 0} open invoice(s)</div>
            </button>
            {AGING_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => navigate('/collections')}
                className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 min-w-[90px] text-left hover:border-blue-200"
              >
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{AGING_LABELS[key]}</div>
                <div className="text-sm font-bold text-gray-800">{formatCurrency(buckets[key] || 0)}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main + sidebar */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Recent Collections */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col min-h-[280px]">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recent Collections</h2>
                <button onClick={() => navigate('/collections')} className="text-[10px] text-blue-700 font-semibold hover:underline">
                  View all
                </button>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-500 uppercase border-b border-gray-100">
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">CR #</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Method</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {collections.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-400">No recent collections</td></tr>
                    )}
                    {collections.map((c: any) => (
                      <tr
                        key={c.id}
                        onClick={() => openPrint(`/api/sales/collection-receipt/${c.id}/print`)}
                        className="border-t border-gray-50 hover:bg-blue-50 cursor-pointer"
                      >
                        <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(c.payment_date)}</td>
                        <td className="px-3 py-1.5 font-mono text-blue-700">{c.receipt_number}</td>
                        <td className="px-3 py-1.5 truncate max-w-[120px]">{c.customer_name || '—'}</td>
                        <td className="px-3 py-1.5">{c.payment_method}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-green-700">{formatCurrency(c.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Recent Payments */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col min-h-[280px]">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Recent Payments</h2>
                <button onClick={() => navigate('/payables?tab=payments')} className="text-[10px] text-blue-700 font-semibold hover:underline">
                  View all
                </button>
              </div>
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] text-gray-500 uppercase border-b border-gray-100">
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">PV #</th>
                      <th className="px-3 py-2 text-left">Supplier</th>
                      <th className="px-3 py-2 text-left">Method</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-400">No recent payments</td></tr>
                    )}
                    {payments.map((p: any) => (
                      <tr
                        key={p.id}
                        onClick={() => openPrint(`/api/payables/vouchers/${p.id}/print`)}
                        className="border-t border-gray-50 hover:bg-blue-50 cursor-pointer"
                      >
                        <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                        <td className="px-3 py-1.5 font-mono text-blue-700">{p.voucher_number}</td>
                        <td className="px-3 py-1.5 truncate max-w-[120px]">{p.supplier_name || '—'}</td>
                        <td className="px-3 py-1.5">{p.payment_method}</td>
                        <td className="px-3 py-1.5 text-right font-medium text-red-700">{formatCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="hidden lg:flex flex-col w-52 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
            <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Quick Links</h3>
          </div>
          <nav className="p-2 space-y-0.5">
            {QUICK_LINKS.map(({ label, path, icon: Icon }) => (
              <button
                key={path}
                type="button"
                onClick={() => navigate(path)}
                className="w-full flex items-center gap-2 px-2 py-2 text-xs text-gray-700 rounded-md hover:bg-blue-50 hover:text-blue-800 group"
              >
                <Icon size={14} className="text-gray-400 group-hover:text-blue-600" />
                <span className="flex-1 text-left">{label}</span>
                <ArrowRight size={12} className="text-gray-300 group-hover:text-blue-500" />
              </button>
            ))}
          </nav>
          <div className="mt-auto p-3 border-t border-gray-100">
            <p className="text-[10px] text-gray-400 leading-relaxed">
              Click any KPI or aging bucket to drill into the related module. Row clicks open print preview.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
