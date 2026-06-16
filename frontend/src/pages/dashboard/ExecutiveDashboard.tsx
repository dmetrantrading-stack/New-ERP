import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, Receipt, CreditCard, Banknote, Users } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ExecutiveDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
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

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
    </div>
  );

  const kpis = [
    { label: "Today's Sales", value: data?.today_sales?.amount || 0, sub: `${data?.today_sales?.count || 0} transactions`, icon: DollarSign, color: 'from-blue-500 to-blue-700', action: () => navigate('/sales') },
    { label: 'Monthly Sales', value: data?.monthly_sales?.amount || 0, sub: `${data?.monthly_sales?.count || 0} transactions`, icon: TrendingUp, color: 'from-emerald-500 to-emerald-700', action: () => navigate('/reports') },
    { label: 'Accounts Receivable', value: data?.accounts_receivable?.total || 0, icon: Receipt, color: 'from-orange-500 to-orange-700', action: () => navigate('/collections') },
    { label: 'Accounts Payable', value: data?.accounts_payable?.total || 0, icon: CreditCard, color: 'from-red-500 to-red-700', action: () => navigate('/payables') },
    { label: 'Bank & Cash', value: data?.bank_cash?.total || 0, icon: Banknote, color: 'from-purple-500 to-purple-700', action: () => navigate('/bank-cash') },
    { label: 'Net Profit', value: data?.net_profit?.net || 0, sub: `${data?.net_profit?.net >= 0 ? '+' : ''}${formatCurrency(data?.net_profit?.net || 0)}`, icon: data?.net_profit?.net >= 0 ? TrendingUp : TrendingDown, color: data?.net_profit?.net >= 0 ? 'from-green-500 to-green-700' : 'from-red-500 to-red-700', action: () => navigate('/accounting') },
  ];

  const aging = data?.aging_receivables || {};
  const agingBuckets = [
    { label: 'Current', value: aging.current || 0, color: 'bg-green-50 border-green-200 text-green-700' },
    { label: '1-30 Days', value: aging.d30 || 0, color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
    { label: '31-60 Days', value: aging.d60 || 0, color: 'bg-orange-50 border-orange-200 text-orange-700' },
    { label: '61-90 Days', value: aging.d90 || 0, color: 'bg-red-50 border-red-200 text-red-700' },
    { label: '90+ Days', value: aging.over90 || 0, color: 'bg-red-100 border-red-300 text-red-800' },
    { label: 'Total AR', value: aging.total || 0, color: 'bg-blue-50 border-blue-200 text-blue-700' },
  ];

  const collections = data?.recent_collections || [];
  const payments = data?.recent_payments || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Executive Dashboard</h1>
          <p className="text-sm text-gray-500">D METRAN TRADING — Real-time financial overview</p>
        </div>
        <button onClick={loadData} disabled={refreshing} className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} onClick={kpi.action}
              className="bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:shadow-lg hover:border-blue-300 transition-all group">
              <div className="flex items-start justify-between mb-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{kpi.label}</span>
                <div className={`p-1.5 rounded-lg bg-gradient-to-br ${kpi.color}`}>
                  <Icon size={14} className="text-white" />
                </div>
              </div>
              <p className={`text-xl font-bold ${kpi.label === 'Net Profit' ? (kpi.value >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-900'}`}>
                {formatCurrency(kpi.value)}
              </p>
              {kpi.sub && <p className="text-xs text-gray-400 mt-0.5">{kpi.sub}</p>}
              <p className="text-[10px] text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity mt-1">Click to view details →</p>
            </div>
          );
        })}
      </div>

      {/* Aging Receivables */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Aging Receivables</h2>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {agingBuckets.map(b => (
            <div key={b.label}
              onClick={() => navigate('/collections')}
              className={`border rounded-lg p-3 text-center cursor-pointer hover:shadow transition ${b.color}`}>
              <p className="text-xs font-medium uppercase">{b.label}</p>
              <p className="text-lg font-bold mt-1">{formatCurrency(parseFloat(b.value) || 0)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Collections + Recent Payments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Collections */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Recent Collections</h2>
            <button onClick={() => navigate('/collections')} className="text-xs text-blue-600 hover:underline">View All</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">CR #</th><th className="px-4 py-2 text-left">Customer</th><th className="px-4 py-2 text-left">Method</th><th className="px-4 py-2 text-left">Ref</th><th className="px-4 py-2 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {collections.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No recent collections</td></tr>}
              {collections.map((c: any) => (
                <tr key={c.id} onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/sales/collection-receipt/${c.id}/print?token=${t}`, '_blank'); }}
                  className="border-t border-gray-50 hover:bg-blue-50 cursor-pointer">
                  <td className="px-4 py-2 text-xs">{formatDate(c.payment_date)}</td>
                  <td className="px-4 py-2 text-xs font-mono text-blue-600">{c.receipt_number}</td>
                  <td className="px-4 py-2">{c.customer_name || '—'}</td>
                  <td className="px-4 py-2 text-xs">{c.payment_method}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{c.reference_number || '—'}</td>
                  <td className="px-4 py-2 text-right font-medium text-green-600">{formatCurrency(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent Payments */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Recent Payments</h2>
            <button onClick={() => navigate('/payables')} className="text-xs text-blue-600 hover:underline">View All</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">DV #</th><th className="px-4 py-2 text-left">Supplier</th><th className="px-4 py-2 text-left">Method</th><th className="px-4 py-2 text-left">Ref</th><th className="px-4 py-2 text-right">Amount</th>
            </tr></thead>
            <tbody>
              {payments.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No recent payments</td></tr>}
              {payments.map((p: any) => (
                <tr key={p.id} onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/payables/vouchers/${p.id}/print?token=${t}`, '_blank'); }}
                  className="border-t border-gray-50 hover:bg-blue-50 cursor-pointer">
                  <td className="px-4 py-2 text-xs">{formatDate(p.payment_date)}</td>
                  <td className="px-4 py-2 text-xs font-mono text-blue-600">{p.voucher_number}</td>
                  <td className="px-4 py-2">{p.supplier_name || '—'}</td>
                  <td className="px-4 py-2 text-xs">{p.payment_method}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{p.reference_number || '—'}</td>
                  <td className="px-4 py-2 text-right font-medium text-red-600">{formatCurrency(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
