import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { BarChart3, TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ReportsPage() {
  const [activeReport, setActiveReport] = useState('daily-sales');
  const [dateRange, setDateRange] = useState({ from: new Date().toISOString().split('T')[0], to: new Date().toISOString().split('T')[0] });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setData(null);
    let endpoint = '';
    switch (activeReport) {
      case 'daily-sales': endpoint = `/reports/daily-sales?date=${dateRange.from}`; break;
      case 'sales-by-item': endpoint = `/reports/sales-by-item?from=${dateRange.from}&to=${dateRange.to}`; break;
      case 'sales-by-cashier': endpoint = `/reports/sales-by-cashier?from=${dateRange.from}&to=${dateRange.to}`; break;
      case 'sales-by-customer': endpoint = `/reports/sales-by-customer?from=${dateRange.from}&to=${dateRange.to}`; break;
      case 'inventory-valuation': endpoint = '/reports/inventory-valuation'; break;
      case 'low-stock': endpoint = '/reports/low-stock'; break;
      case 'expiry': endpoint = `/reports/expiry?days=30`; break;
      case 'vat': endpoint = `/reports/vat?from=${dateRange.from}&to=${dateRange.to}`; break;
    }
    if (endpoint) api.get(endpoint).then((res) => setData(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')).finally(() => setLoading(false));
  }, [activeReport, dateRange]);

  const reports = [
    { id: 'daily-sales', label: 'Daily Sales', icon: BarChart3 },
    { id: 'sales-by-item', label: 'Sales by Item', icon: TrendingUp },
    { id: 'sales-by-cashier', label: 'Sales by Cashier', icon: TrendingUp },
    { id: 'sales-by-customer', label: 'Sales by Customer', icon: TrendingUp },
    { id: 'inventory-valuation', label: 'Inventory Valuation', icon: BarChart3 },
    { id: 'low-stock', label: 'Low Stock', icon: AlertTriangle },
    { id: 'expiry', label: 'Expiry Report', icon: Clock },
    { id: 'vat', label: 'VAT Report', icon: BarChart3 },
  ];

  const renderReport = () => {
    if (loading) return <div className="text-center py-8 text-gray-400">Loading...</div>;

    switch (activeReport) {
      case 'daily-sales':
        return (
          <div className="p-4">
            <div className="grid grid-cols-5 gap-4 mb-4">
              <div className="bg-blue-50 p-3 rounded-lg"><p className="text-xs text-blue-600">Transactions</p><p className="text-lg font-bold">{data?.summary?.transaction_count || 0}</p></div>
              <div className="bg-green-50 p-3 rounded-lg"><p className="text-xs text-green-600">Total Sales</p><p className="text-lg font-bold">{formatCurrency(data?.summary?.total_sales || 0)}</p></div>
              <div className="bg-red-50 p-3 rounded-lg"><p className="text-xs text-red-600">Total Cost</p><p className="text-lg font-bold">{formatCurrency(data?.summary?.total_cost || 0)}</p></div>
              <div className="bg-emerald-50 p-3 rounded-lg"><p className="text-xs text-emerald-600">Gross Profit</p><p className="text-lg font-bold">{formatCurrency(data?.summary?.gross_profit || 0)}</p></div>
              <div className="bg-purple-50 p-3 rounded-lg"><p className="text-xs text-purple-600">Margin</p><p className="text-lg font-bold">{data?.summary?.margin_pct || 0}%</p></div>
            </div>
            <table className="data-table">
              <thead><tr><th>Time</th><th>Transaction #</th><th>Cashier</th><th>Items</th><th>Total</th></tr></thead>
              <tbody>
                {data?.transactions?.map((t: any) => (
                  <tr key={t.id}><td className="text-xs">{new Date(t.created_at).toLocaleTimeString()}</td><td className="font-mono text-xs">{t.transaction_number}</td><td>{t.cashier_name}</td><td>{t.item_count}</td><td>{formatCurrency(t.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'sales-by-item':
        return (
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Product</th><th>Qty Sold</th><th>Total Sales</th><th>Total Cost</th><th>Gross Profit</th><th>Margin</th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((item: any) => <tr key={item.sku}><td className="font-mono text-xs">{item.sku}</td><td>{item.name}</td><td>{item.total_qty}</td><td>{formatCurrency(item.total_amount)}</td><td>{formatCurrency(item.total_cost)}</td><td className="font-bold">{formatCurrency(item.gross_profit)}</td><td>{item.margin_pct}%</td></tr>)}
            </tbody>
          </table>
        );

      case 'sales-by-cashier':
        return (
          <table className="data-table">
            <thead><tr><th>Cashier</th><th>Transactions</th><th>Total Sales</th><th>Avg Sale</th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((c: any) => <tr key={c.full_name}><td>{c.full_name}</td><td>{c.transaction_count}</td><td>{formatCurrency(c.total_sales)}</td><td>{formatCurrency(c.avg_sale)}</td></tr>)}
            </tbody>
          </table>
        );

      case 'sales-by-customer':
        return (
          <table className="data-table">
            <thead><tr><th>Code</th><th>Customer</th><th>Invoices</th><th>Total Sales</th><th>Balance</th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((c: any) => <tr key={c.customer_code}><td className="font-mono text-xs">{c.customer_code}</td><td>{c.customer_name}</td><td>{c.invoice_count}</td><td>{formatCurrency(c.total_sales)}</td><td className={c.total_balance > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(c.total_balance)}</td></tr>)}
            </tbody>
          </table>
        );

      case 'inventory-valuation':
        return (
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Product</th><th>Location</th><th>Quantity</th><th>Unit Cost</th><th>Total Value</th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((i: any) => <tr key={`${i.sku}-${i.location_name}`}><td className="font-mono text-xs">{i.sku}</td><td>{i.name}</td><td>{i.location_name}</td><td>{i.total_quantity}</td><td>{formatCurrency(i.cost)}</td><td className="font-medium">{formatCurrency(i.total_value)}</td></tr>)}
            </tbody>
          </table>
        );

      case 'low-stock':
        return (
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Product</th><th>Location</th><th>Stock</th><th>Reorder Level</th><th>Deficit</th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((i: any) => <tr key={`${i.sku}-${i.location_name}`}><td className="font-mono text-xs">{i.sku}</td><td className="font-medium text-red-600">{i.name}</td><td>{i.location_name}</td><td className="text-red-600 font-bold">{i.quantity}</td><td>{i.reorder_level}</td><td className="text-red-600">{i.deficit}</td></tr>)}
            </tbody>
          </table>
        );

      case 'expiry':
        return (
          <table className="data-table">
            <thead><tr><th>Product</th><th>Batch</th><th>Location</th><th>Qty</th><th>Expiry Date</th><th>Days Left</th></tr></thead>
            <tbody>
              {Array.isArray(data) && data.map((b: any) => {
                const daysLeft = Math.ceil((new Date(b.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
                return <tr key={b.id}><td>{b.product_name}</td><td className="font-mono text-xs">{b.batch_number}</td><td>{b.location_name}</td><td>{b.quantity}</td><td className="text-xs">{b.expiry_date ? new Date(b.expiry_date).toLocaleDateString() : '-'}</td><td><span className={`px-2 py-0.5 text-xs rounded-full ${daysLeft <= 7 ? 'bg-red-100 text-red-700' : daysLeft <= 30 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>{daysLeft > 0 ? `${daysLeft} days` : 'Expired'}</span></td></tr>;
              })}
            </tbody>
          </table>
        );

      case 'vat':
        return (
          <div className="p-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-600">Output VAT</p><p className="text-2xl font-bold">{formatCurrency(data?.output_vat || 0)}</p></div>
              <div className="bg-orange-50 p-4 rounded-lg"><p className="text-sm text-orange-600">Input VAT</p><p className="text-2xl font-bold">{formatCurrency(data?.input_vat || 0)}</p></div>
              <div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-green-600">VAT Payable</p><p className="text-2xl font-bold">{formatCurrency(data?.vat_payable || 0)}</p></div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="space-y-1">
          {reports.map((r) => {
            const Icon = r.icon;
            return (
              <button key={r.id} onClick={() => setActiveReport(r.id)}
                className={`w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeReport === r.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                <Icon size={16} /> {r.label}
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-3">
          <div className="flex items-center gap-3 mb-4">
            {activeReport === 'daily-sales' && (
              <div><label className="text-xs text-gray-500">Date</label><input type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} className="ml-2 px-3 py-1.5 border rounded-lg text-sm" /></div>
            )}
            {activeReport !== 'daily-sales' && activeReport !== 'inventory-valuation' && activeReport !== 'low-stock' && activeReport !== 'expiry' && (
              <>
                <div><label className="text-xs text-gray-500">From</label><input type="date" value={dateRange.from} onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })} className="ml-2 px-3 py-1.5 border rounded-lg text-sm" /></div>
                <div><label className="text-xs text-gray-500">To</label><input type="date" value={dateRange.to} onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })} className="ml-2 px-3 py-1.5 border rounded-lg text-sm" /></div>
              </>
            )}
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {renderReport()}
          </div>
        </div>
      </div>
    </div>
  );
}
