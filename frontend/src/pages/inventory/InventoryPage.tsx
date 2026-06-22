import React, { useState, useEffect, useMemo } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, parseIntegerField } from '../../lib/utils';
import NumericInput from '../../components/NumericInput';
import { Search, Filter, Package, AlertTriangle, Clock, Eye, Warehouse, Upload, Download, FileText, X } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';

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

export default function InventoryPage({ embedded = false, onRefresh }: { embedded?: boolean; onRefresh?: () => void }) {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('inventory.inventory.edit');
  const [data, setData] = useState<StockItem[]>([]);
  const [summary, setSummary] = useState({ total_skus: 0, low_stock: 0, expiring_soon: 0, inventory_value: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const limit = 20;
  const [showLedger, setShowLedger] = useState<string | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [ledgerStartDate, setLedgerStartDate] = useState('');
  const [ledgerEndDate, setLedgerEndDate] = useState('');
  const [editingReorderId, setEditingReorderId] = useState<string | null>(null);
  const [editingReorderValue, setEditingReorderValue] = useState('');
  const [savingReorder, setSavingReorder] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustForm, setAdjustForm] = useState<any>({ product_id: '', location_id: '', quantity: '', reason: '' });
  const [products, setProducts] = useState<any[]>([]);
  const [showBatches, setShowBatches] = useState<string | null>(null);
  const [batches, setBatches] = useState<any[]>([]);
  const [expiringItems, setExpiringItems] = useState<any[]>([]);
  const [showExpiringTab, setShowExpiringTab] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [invImportFile, setInvImportFile] = useState<File | null>(null);
  const [invImporting, setInvImporting] = useState(false);
  const [invImportPreview, setInvImportPreview] = useState<any>(null);
  const [invImportResult, setInvImportResult] = useState<any>(null);
  const [showInvExportDropdown, setShowInvExportDropdown] = useState(false);

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
        onRefresh?.();
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { setPage(1); }, [search, lowStockOnly]);
  useEffect(() => { loadData(); }, [search, lowStockOnly]);
  const paginatedData = useMemo(() => data.slice((page - 1) * limit, page * limit), [data, page, limit]);
  useEffect(() => {
    api.get('/products?limit=500').then((res) => setProducts(res.data.data)).catch(() => {});
    api.get('/inventory/alerts/expiring-range?from=60&to=90').then(res => setExpiringItems(res.data || [])).catch(() => {});
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
      await api.post('/inventory/adjust', { ...adjustForm, quantity: parseIntegerField(adjustForm.quantity) });
      toast.success('Inventory adjusted');
      setShowAdjust(false);
      setAdjustForm({ product_id: '', location_id: '', quantity: '', reason: '' });
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

  const startEditReorder = (item: StockItem) => {
    if (!canEdit) return;
    setEditingReorderId(item.product_id);
    setEditingReorderValue(String(item.reorder_level ?? ''));
  };

  const cancelEditReorder = () => {
    setEditingReorderId(null);
    setEditingReorderValue('');
  };

  const saveReorderLevel = async (productId: string) => {
    if (!canEdit || savingReorder) return;
    const parsed = parseFloat(editingReorderValue);
    if (Number.isNaN(parsed) || parsed < 0) {
      toast.error('Enter a valid reorder level');
      return;
    }
    setSavingReorder(true);
    try {
      await api.patch(`/products/${productId}/reorder-level`, { reorder_level: parsed });
      toast.success('Reorder level updated');
      setData((prev) => prev.map((row) => (
        row.product_id === productId ? { ...row, reorder_level: parsed } : row
      )));
      cancelEditReorder();
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update reorder level');
    } finally {
      setSavingReorder(false);
    }
  };

  const exportInventory = (format: string) => {
    const token = localStorage.getItem('token');
    window.open(`/api/inventory/export?format=${format}&search=${search}&location=&token=${token}`, '_blank');
    setShowInvExportDropdown(false);
  };
  const downloadInvTemplate = () => { const token = localStorage.getItem('token'); window.open(`/api/inventory/export/template?token=${token}`, '_blank'); };
  const handleInvPreview = async () => {
    if (!invImportFile) { toast.error('Select a file'); return; }
    setInvImportPreview(null); setInvImportResult(null); setInvImporting(true);
    try {
      const fd = new FormData(); fd.append('file', invImportFile);
      const res = await api.post('/inventory/import/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setInvImportPreview(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Preview failed'); }
    setInvImporting(false);
  };
  const handleInvImport = async () => {
    if (!invImportFile) return;
    if (!window.confirm(`Import ${invImportPreview?.valid_rows || 0} inventory rows? Rows with errors will be skipped.`)) return;
    setInvImporting(true);
    try {
      const fd = new FormData(); fd.append('file', invImportFile);
      const res = await api.post('/inventory/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setInvImportResult(res.data); setInvImportPreview(null);
      if (res.data.imported > 0) { loadData(); toast.success(`Imported ${res.data.imported} stock records`); }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Import failed'); }
    setInvImporting(false);
  };

  const formatQty = (item: StockItem, qty: number) => {
    const uom = item.unit_of_measure || '';
    return `${qty} ${uom}`.trim();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Stock</h1>
          <p className="text-sm text-gray-500 mt-0.5">Current stock levels across all locations</p>
        </div>
      )}

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

      {/* Expiring in 2-3 Months */}
      {expiringItems.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div
            className="px-5 py-3 border-b border-gray-200 bg-orange-50 flex items-center justify-between cursor-pointer"
            onClick={() => setShowExpiringTab(!showExpiringTab)}>
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-orange-600" />
              <h3 className="font-semibold text-sm text-orange-700">Expiring in 2-3 Months ({expiringItems.length} items)</h3>
            </div>
            <span className="text-xs text-orange-500">{showExpiringTab ? 'Hide' : 'Show'}</span>
          </div>
          {showExpiringTab && (
            <table className="data-table">
              <thead><tr>
                <th>Product</th><th>SKU</th><th>Batch</th><th>Location</th><th>Qty</th><th>Expiry Date</th><th>Days Left</th>
              </tr></thead>
              <tbody>
                {expiringItems.map((item: any) => (
                  <tr key={item.id}>
                    <td className="font-medium">{item.product_name}</td>
                    <td className="text-xs text-gray-500">{item.sku}</td>
                    <td className="text-xs font-mono">{item.batch_number}</td>
                    <td className="text-xs">{item.location_name}</td>
                    <td>{item.quantity} {item.unit_of_measure || 'pcs'}</td>
                    <td className="text-xs">{new Date(item.expiry_date).toLocaleDateString('en-PH')}</td>
                    <td><span className="px-2 py-1 text-xs rounded-full bg-orange-100 text-orange-700">{item.days_left} days</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

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
        <div className="relative">
          <button onClick={() => setShowInvExportDropdown(!showInvExportDropdown)}
            className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
            <Download size={16} /> Export
          </button>
          {showInvExportDropdown && (
            <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-44">
              <button onClick={() => exportInventory('csv')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100">Export as CSV</button>
              <button onClick={() => exportInventory('xlsx')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">Export as Excel</button>
            </div>
          )}
        </div>
        <button onClick={() => setShowImportModal(true)}
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
          <Upload size={16} /> Import
        </button>
        <button onClick={() => setShowAdjust(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
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
                paginatedData.map((item) => {
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
                        {editingReorderId === item.product_id ? (
                          <div className="inline-flex items-center gap-1 justify-end">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              autoFocus
                              value={editingReorderValue}
                              onChange={(e) => setEditingReorderValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveReorderLevel(item.product_id);
                                if (e.key === 'Escape') cancelEditReorder();
                              }}
                              className="w-20 px-2 py-1 border rounded text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button
                              onClick={() => saveReorderLevel(item.product_id)}
                              disabled={savingReorder}
                              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                        ) : canEdit ? (
                          <button
                            type="button"
                            onClick={() => startEditReorder(item)}
                            className="text-sm text-gray-500 hover:text-blue-700 hover:underline tabular-nums"
                            title="Click to edit reorder level"
                          >
                            {item.reorder_level ? `${item.reorder_level} ${item.unit_of_measure || ''}`.trim() : 'Set reorder'}
                          </button>
                        ) : (
                          <span className="text-sm text-gray-500">{item.reorder_level ? `${item.reorder_level} ${item.unit_of_measure || ''}`.trim() : '-'}</span>
                        )}
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
        <Pagination page={page} totalPages={Math.ceil(data.length / limit)} total={data.length} onPageChange={setPage} />
      </div>

      {/* Adjust Inventory Modal */}
      {showAdjust && (
        <ModalOverlay onClose={() => setShowAdjust(false)}>
          <div className="modal-content max-w-lg">
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
                  <NumericInput value={adjustForm.quantity} onValueChange={(quantity) => setAdjustForm({ ...adjustForm, quantity })}
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
        </ModalOverlay>
      )}

      {/* Batches Modal */}
      {showBatches && (
        <ModalOverlay onClose={() => setShowBatches(null)}>
          <div className="modal-content max-w-2xl">
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
        </ModalOverlay>
      )}

      {/* Ledger Modal */}
      {showLedger && (
        <ModalOverlay onClose={() => setShowLedger(null)}>
          <div className="modal-content max-w-4xl">
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
        </ModalOverlay>
      )}

      {/* Import modal */}
      {showImportModal && (
        <ModalOverlay onClose={() => { setShowImportModal(false); setInvImportFile(null); setInvImportPreview(null); setInvImportResult(null); }}>
          <div className="modal-content max-w-4xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Import Inventory</h2>
                <button onClick={() => { setShowImportModal(false); setInvImportFile(null); setInvImportPreview(null); setInvImportResult(null); }}
                  className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>

              {invImportResult ? (
                /* Step 3: Results */
                <div>
                  <div className="flex items-center gap-3 mb-4 p-4 bg-gray-50 rounded-lg">
                    <span className="text-sm font-medium">Results:</span>
                    <span className="text-sm text-green-700 font-medium bg-green-50 px-3 py-1 rounded">{invImportResult.imported} imported</span>
                    {invImportResult.errors?.length > 0 && <span className="text-sm text-red-700 font-medium bg-red-50 px-3 py-1 rounded">{invImportResult.errors.length} errors</span>}
                    {invImportResult.warnings?.length > 0 && <span className="text-sm text-amber-700 font-medium bg-amber-50 px-3 py-1 rounded">{invImportResult.warnings.length} warnings</span>}
                  </div>
                  {invImportResult.errors?.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1 mb-4">
                      {invImportResult.errors.map((e: any, i: number) => (
                        <p key={i} className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{e.row > 0 ? `Row ${e.row}: ` : ''}{e.message}</p>
                      ))}
                    </div>
                  )}
                  {invImportResult.warnings?.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 mb-4">
                      <p className="text-xs font-medium text-amber-700 mb-1">Warnings:</p>
                      {invImportResult.warnings.map((w: any, i: number) => (
                        <p key={i} className="text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded">{w.row > 0 ? `Row ${w.row}: ` : ''}{w.message}</p>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setShowImportModal(false); setInvImportFile(null); setInvImportPreview(null); setInvImportResult(null); }}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Done</button>
                </div>
              ) : invImportPreview ? (
                /* Step 2: Preview table */
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{invImportPreview.file_name}</span>
                      <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">{invImportPreview.valid_rows} valid</span>
                      {invImportPreview.error_rows > 0 && <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded">{invImportPreview.error_rows} errors</span>}
                      {invImportPreview.rows?.filter((r: any) => r.duplicate_warning).length > 0 && <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{invImportPreview.rows.filter((r: any) => r.duplicate_warning).length} duplicates</span>}
                    </div>
                    <button onClick={() => setInvImportPreview(null)} className="text-xs text-blue-600 hover:underline">Back</button>
                  </div>
                  <div className="max-h-80 overflow-auto border border-gray-200 rounded-lg mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">#</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Product</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Barcode</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Location</th>
                          <th className="px-2 py-2 text-right font-semibold text-gray-500">Qty</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Batch</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Expiry</th>
                          <th className="px-2 py-2 text-center font-semibold text-gray-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {invImportPreview.rows?.map((r: any) => (
                          <tr key={r.row} className={r.has_errors ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="px-2 py-1.5 text-gray-400">{r.row}</td>
                            <td className="px-2 py-1.5 font-medium">{r.product_name}</td>
                            <td className="px-2 py-1.5 font-mono">{r.barcode || '-'}</td>
                            <td className="px-2 py-1.5">{r.location || '-'}</td>
                            <td className="px-2 py-1.5 text-right">{r.quantity}</td>
                            <td className="px-2 py-1.5 font-mono">{r.batch_number || '-'}</td>
                            <td className="px-2 py-1.5">{r.expiry_date || '-'}</td>
                            <td className="px-2 py-1.5 text-center">
                              {r.has_errors ? <span className="text-red-600 font-medium" title={r.errors?.join('; ')}>Error</span> : r.duplicate_warning ? <span className="text-amber-600 font-medium" title={r.warnings?.join('; ')}>Duplicate</span> : <span className="text-green-600 font-medium">OK</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {invImportPreview.errors?.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 mb-3">
                      {invImportPreview.errors.map((e: any, i: number) => (
                        <p key={i} className="text-xs text-red-600 bg-red-50 px-3 py-1 rounded">{e.row > 0 ? `Row ${e.row}: ` : ''}{e.message}</p>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-3">
                    <button onClick={() => { setInvImportPreview(null); setInvImportFile(null); }}
                      className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                    <button onClick={handleInvImport} disabled={invImporting || invImportPreview.valid_rows === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {invImporting ? 'Importing...' : `Import ${invImportPreview.valid_rows} Records`}
                    </button>
                  </div>
                </div>
              ) : (
                /* Step 1: Upload file */
                <div>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && (f.name.endsWith('.csv') || f.name.endsWith('.xlsx'))) setInvImportFile(f); else toast.error('Please select a CSV or Excel file'); }}>
                    {invImportFile ? (
                      <div>
                        <FileText size={32} className="mx-auto text-blue-500 mb-2" />
                        <p className="text-sm font-medium text-gray-700">{invImportFile.name}</p>
                        <p className="text-xs text-gray-400 mt-1">{(invImportFile.size / 1024).toFixed(1)} KB</p>
                        <button onClick={() => setInvImportFile(null)} className="text-xs text-red-500 hover:underline mt-2">Remove</button>
                      </div>
                    ) : (
                      <div>
                        <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                        <p className="text-sm text-gray-500">Drag & drop a CSV or Excel file here, or</p>
                        <label className="inline-block mt-2 px-4 py-2 bg-blue-600 text-white rounded text-sm cursor-pointer hover:bg-blue-700">
                          Browse Files
                          <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setInvImportFile(f); }} />
                        </label>
                        <p className="text-xs text-gray-400 mt-2">CSV or Excel (.xlsx) up to 10MB</p>
                      </div>
                    )}
                  </div>
                  <button onClick={downloadInvTemplate} className="text-xs text-blue-600 hover:underline mb-4 inline-block">
                    Download import template
                  </button>
                  <div className="flex justify-end gap-3 mt-4">
                    <button onClick={() => { setShowImportModal(false); setInvImportFile(null); }}
                      className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                    <button onClick={handleInvPreview} disabled={!invImportFile || invImporting}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {invImporting ? 'Reading file...' : 'Preview Import'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
