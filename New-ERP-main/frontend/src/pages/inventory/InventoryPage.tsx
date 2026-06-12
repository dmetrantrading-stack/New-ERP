import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Search, Filter, Package, AlertTriangle, Clock, Eye, Warehouse } from 'lucide-react';
import toast from 'react-hot-toast';

interface StockItem {
  product_id: string;
  sku: string;
  name: string;
  barcode: string;
  unit_of_measure: string;
  category_name: string;
  reorder_level: number;
  store_qty: number;
  warehouse_qty: number;
  total_qty: number;
  avg_cost: number;
}

export default function InventoryPage() {
  const [data, setData] = useState<StockItem[]>([]);
  const [summary, setSummary] = useState({ total_skus: 0, low_stock: 0, expiring_soon: 0, inventory_value: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showLedger, setShowLedger] = useState<string | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [ledgerStartDate, setLedgerStartDate] = useState('');
  const [ledgerEndDate, setLedgerEndDate] = useState('');
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustForm, setAdjustForm] = useState<any>({ product_id: '', location_id: '', quantity: 0, reason: '' });
  const [products, setProducts] = useState<any[]>([]);
  const [showBatches, setShowBatches] = useState<string | null>(null);
  const [batches, setBatches] = useState<any[]>([]);

  const loadData = () => {
    setLoading(true);
    let endpoint = '/inventory/stock-list';
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (lowStockOnly) params.set('low_stock', 'true');
    const qs = params.toString();
    if (qs) endpoint += '?' + qs;

    api.get(endpoint)
      .then((res) => {
        setData(res.data.data);
        setSummary(res.data.summary);
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadData(); }, [search, lowStockOnly]);
  useEffect(() => {
    api.get('/products?limit=500').then((res) => setProducts(res.data.data)).catch(() => {});
  }, []);

  const viewLedger = async (productId: string) => {
    try {
      let endpoint = `/inventory/ledger/${productId}?limit=50`;
      if (ledgerStartDate) endpoint += `&start_date=${ledgerStartDate}`;
      if (ledgerEndDate) endpoint += `&end_date=${ledgerEndDate}`;
      const res = await api.get(endpoint);
      setLedger(res.data.data);
      setShowLedger(productId);
    } catch (err) { toast.error('Error loading ledger'); }
  };

  const viewBatches = async (productId: string) => {
    try {
      const res = await api.get(`/inventory/batches/${productId}`);
      setBatches(res.data.data || res.data);
      setShowBatches(productId);
    } catch (err) { toast.error('Error loading batches'); }
  };

  const adjustInventory = async () => {
    try {
      await api.post('/inventory/adjust', adjustForm);
      toast.success('Inventory adjusted');
      setShowAdjust(false);
      setAdjustForm({ product_id: '', location_id: '', quantity: 0, reason: '' });
      loadData();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error adjusting inventory'); }
  };

  const getStatus = (item: StockItem) => {
    const total = parseFloat(String(item.total_qty));
    const reorder = parseFloat(String(item.reorder_level));
    if (total === 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-700' };
    if (total <= reorder && reorder > 0) return { label: 'Low Stock', color: 'bg-orange-100 text-orange-700' };
    return { label: 'In Stock', color: 'bg-green-100 text-green-700' };
  };

  const formatQty = (item: StockItem, qty: number) => {
    const uom = item.unit_of_measure || '';
    return `${qty} ${uom}`.trim();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Inventory Stock</h1>
        <p className="text-sm text-gray-500 mt-0.5">Current stock levels across all locations</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Package size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Total SKUs</p>
              <p className="text-2xl font-bold text-gray-900">{summary.total_skus}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
              <AlertTriangle size={20} className="text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Low Stock</p>
              <p className="text-2xl font-bold text-orange-600">{summary.low_stock}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center">
              <Clock size={20} className="text-pink-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Expiring Soon</p>
              <p className="text-2xl font-bold text-pink-600">{summary.expiring_soon}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Warehouse size={20} className="text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Inventory Value</p>
              <p className="text-xl font-bold text-green-700">{formatCurrency(summary.inventory_value)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
        </div>
        <button
          onClick={() => setLowStockOnly(!lowStockOnly)}
          className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
            lowStockOnly
              ? 'bg-orange-50 border-orange-300 text-orange-700'
              : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <Filter size={15} />
          Low Stock Only
        </button>
        <button
          onClick={() => setShowAdjust(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 ml-auto"
        >
          <Package size={16} /> Adjust Inventory
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Store Qty</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Warehouse Qty</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Reorder Lvl</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Avg Cost</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Value</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading inventory...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">
                  {search || lowStockOnly ? 'No products match your filters.' : 'No inventory data. Create products and receive stock to populate.'}
                </td></tr>
              ) : (
                data.map((item) => {
                  const status = getStatus(item);
                  return (
                    <tr key={item.product_id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">{item.sku}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div>
                          <p className="font-medium text-sm text-gray-900">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.category_name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className={`font-medium text-sm ${parseFloat(String(item.store_qty)) <= parseFloat(String(item.reorder_level)) && parseFloat(String(item.reorder_level)) > 0 ? 'text-orange-600' : 'text-gray-900'}`}>
                          {formatQty(item, parseFloat(String(item.store_qty)))}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="font-medium text-sm text-gray-900">{formatQty(item, parseFloat(String(item.warehouse_qty)))}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-sm text-gray-500">{item.reorder_level ? `${item.reorder_level} ${item.unit_of_measure || ''}`.trim() : '-'}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-sm text-gray-600">{formatCurrency(item.avg_cost)}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <span className="text-sm font-semibold text-gray-800">
                          {formatCurrency(item.total_qty * item.avg_cost)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className={`inline-flex px-2.5 py-1 text-xs font-medium rounded-full ${status.color}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => viewLedger(item.product_id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="View Ledger"><Eye size={15} /></button>
                          <button onClick={() => viewBatches(item.product_id)} className="p-1.5 hover:bg-amber-50 rounded text-amber-600" title="View Batches"><Clock size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjust Inventory Modal */}
      {showAdjust && (
        <div className="modal-overlay" onClick={() => setShowAdjust(false)}>
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Adjust Inventory</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Product</label>
                  <select value={adjustForm.product_id} onChange={(e) => setAdjustForm({ ...adjustForm, product_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Product</option>
                    {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Location</label>
                  <select value={adjustForm.location_id} onChange={(e) => setAdjustForm({ ...adjustForm, location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Location</option>
                    <option value="1">Main Store</option>
                    <option value="2">Main Warehouse</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Quantity Change (+ or -)</label>
                  <input type="number" value={adjustForm.quantity} onChange={(e) => setAdjustForm({ ...adjustForm, quantity: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reason</label>
                  <select value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Reason</option>
                    <option value="Damaged">Damaged</option>
                    <option value="Lost">Lost</option>
                    <option value="Found">Found</option>
                    <option value="Return">Return</option>
                    <option value="Spoilage">Spoilage</option>
                    <option value="Expired">Expired</option>
                    <option value="Correction">Correction</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowAdjust(false)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={adjustInventory} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save Adjustment</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batches Modal */}
      {showBatches && (
        <div className="modal-overlay" onClick={() => setShowBatches(null)}>
          <div className="modal-content max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Batches</h2>
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50"><th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Batch #</th><th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Qty</th><th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Expiry</th><th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Mfg Date</th></tr></thead>
                <tbody>
                  {batches.map((b: any) => (
                    <tr key={b.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-mono text-xs">{b.batch_number}</td>
                      <td className="px-3 py-2 text-right">{b.quantity}</td>
                      <td className="px-3 py-2 text-xs">{b.expiry_date ? new Date(b.expiry_date).toLocaleDateString() : '-'}</td>
                      <td className="px-3 py-2 text-xs">{b.manufacturing_date ? new Date(b.manufacturing_date).toLocaleDateString() : '-'}</td>
                    </tr>
                  ))}
                  {batches.length === 0 && <tr><td colSpan={4} className="text-center py-4 text-gray-400">No batches</td></tr>}
                </tbody>
              </table>
              <div className="flex justify-end mt-4">
                <button onClick={() => setShowBatches(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ledger Modal */}
      {showLedger && (
        <div className="modal-overlay" onClick={() => setShowLedger(null)}>
          <div className="modal-content max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Stock Card / Inventory Ledger</h2>
              <div className="flex gap-3 mb-4 items-end">
                <div>
                  <label className="block text-xs font-medium mb-1">Start Date</label>
                  <input type="date" value={ledgerStartDate} onChange={(e) => setLedgerStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">End Date</label>
                  <input type="date" value={ledgerEndDate} onChange={(e) => setLedgerEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
                </div>
                <button onClick={() => viewLedger(showLedger!)} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700">Filter</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50"><th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Date</th><th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Reference</th><th className="px-3 py-2 text-center text-xs font-semibold text-gray-500">Type</th><th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Qty</th><th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Running</th><th className="px-3 py-2 text-right text-xs font-semibold text-gray-500">Cost</th><th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">Notes</th></tr></thead>
                  <tbody>
                    {ledger.map((l: any) => (
                      <tr key={l.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 text-xs">{new Date(l.created_at).toLocaleDateString()}</td>
                        <td className="px-3 py-2 text-xs">{l.reference_type}</td>
                        <td className="px-3 py-2 text-center"><span className={`px-2 py-0.5 text-xs rounded-full ${l.transaction_type === 'IN' || l.transaction_type === 'TRANSFER_IN' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{l.transaction_type}</span></td>
                        <td className="px-3 py-2 text-right">{l.quantity}</td>
                        <td className="px-3 py-2 text-right">{l.running_quantity}</td>
                        <td className="px-3 py-2 text-right">{formatCurrency(l.unit_cost)}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{l.notes}</td>
                      </tr>
                    ))}
                    {ledger.length === 0 && <tr><td colSpan={7} className="text-center py-4 text-gray-400">No movements</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={() => setShowLedger(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
