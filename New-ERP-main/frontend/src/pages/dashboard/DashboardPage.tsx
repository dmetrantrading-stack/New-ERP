import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { TrendingUp, TrendingDown, Package, DollarSign, AlertTriangle, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import toast from 'react-hot-toast';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/dashboard').then((res) => setData(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  const stats = [
    { label: 'Daily Sales', value: data?.daily_sales || 0, icon: DollarSign, color: 'bg-green-500', prefix: '₱' },
    { label: 'Monthly Sales', value: data?.monthly_sales || 0, icon: TrendingUp, color: 'bg-blue-500', prefix: '₱' },
    { label: 'Gross Profit', value: data?.gross_profit || 0, icon: TrendingUp, color: 'bg-emerald-500', prefix: '₱' },
    { label: 'Net Profit', value: data?.net_profit || 0, icon: TrendingDown, color: data?.net_profit >= 0 ? 'bg-green-500' : 'bg-red-500', prefix: '₱' },
    { label: 'Inventory Value', value: data?.inventory_value || 0, icon: Package, color: 'bg-purple-500', prefix: '₱' },
    { label: 'Receivables', value: data?.receivables || 0, icon: DollarSign, color: 'bg-orange-500', prefix: '₱' },
    { label: 'Payables', value: data?.payables || 0, icon: DollarSign, color: 'bg-red-500', prefix: '₱' },
    { label: 'Low Stock Items', value: data?.low_stock_count || 0, icon: AlertTriangle, color: 'bg-yellow-500', suffix: ' items' },
    { label: 'Expiring Soon', value: data?.expiring_count || 0, icon: Clock, color: 'bg-pink-500', suffix: ' items' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-gray-500 uppercase">{stat.label}</span>
                <div className={`p-2 rounded-lg ${stat.color}`}>
                  <Icon className="w-4 h-4 text-white" />
                </div>
              </div>
              <p className="text-xl font-bold text-gray-900">
                {stat.prefix || ''}{stat.value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{stat.suffix || ''}
              </p>
            </div>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Chart */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Sales (Last 7 Days)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data?.sales_chart || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickFormatter={(v) => new Date(v).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => [`₱${v.toLocaleString()}`, 'Sales']} />
              <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Products */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Top Selling Products</h3>
          <div className="space-y-3">
            {(data?.top_products || []).slice(0, 8).map((product: any, i: number) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                  <span className="text-sm text-gray-700">{product.name}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{formatCurrency(product.total)}</p>
                  <p className="text-xs text-gray-400">{product.qty} units</p>
                </div>
              </div>
            ))}
            {(!data?.top_products || data.top_products.length === 0) && (
              <p className="text-sm text-gray-400 text-center py-8">No sales data yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
