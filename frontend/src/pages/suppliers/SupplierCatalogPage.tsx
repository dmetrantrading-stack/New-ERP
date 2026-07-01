import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import ModalOverlay from '../../components/ModalOverlay';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { navigatePoFromSupplierCatalog } from '../../lib/purchaseCopy';
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  ShoppingCart,
  Trash2,
  Package,
  AlertTriangle,
  Upload,
  Download,
  X,
} from 'lucide-react';

const PRIMARY = '#1E40AF';

interface PendingProduct {
  id: string;
  name: string;
  sku: string;
}

interface CatalogItem {
  catalog_item_id: string;
  product_id: string;
  sku: string;
  name: string;
  unit_of_measure: string;
  reorder_level: number;
  store_qty: number;
  warehouse_qty: number;
  total_qty: number;
  deficit: number;
  is_low_stock: boolean;
  standard_order_qty: number | null;
  suggested_order_qty: number | null;
  order_qty_multiplier: number;
  fixed_order_qty: number | null;
  unit_cost: number;
  unit_cost_uom?: string;
  has_supplier_price?: boolean;
  tax_type: string;
}

export default function SupplierCatalogPage() {
  const { supplierId } = useParams<{ supplierId: string }>();
  const navigate = useNavigate();
  const { hasPerm } = useAuth();

  const canEdit = hasPerm('purchases.suppliers.edit');
  const canEditProduct = hasPerm('inventory.inventory.edit');
  const canCreatePo = hasPerm('purchases.purchase-order.create');

  const [supplier, setSupplier] = useState<any>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [summary, setSummary] = useState({ total_items: 0, low_stock_count: 0 });
  const [loading, setLoading] = useState(true);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [addProductLabel, setAddProductLabel] = useState('');
  const [pendingProducts, setPendingProducts] = useState<PendingProduct[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [editingReorderId, setEditingReorderId] = useState<string | null>(null);
  const [editingReorderValue, setEditingReorderValue] = useState('');
  const [savingReorder, setSavingReorder] = useState(false);
  const [editingOrderQtyId, setEditingOrderQtyId] = useState<string | null>(null);
  const [editingOrderQtyValue, setEditingOrderQtyValue] = useState('');
  const [savingOrderQty, setSavingOrderQty] = useState(false);

  const existingProductIds = useMemo(() => new Set(items.map((i) => i.product_id)), [items]);

  const load = async () => {
    if (!supplierId) return;
    setLoading(true);
    try {
      const params = lowStockOnly ? '?low_stock=true' : '';
      const res = await api.get(`/suppliers/${supplierId}/catalog${params}`);
      setSupplier(res.data.supplier);
      setItems(res.data.items || []);
      setSummary(res.data.summary || { total_items: 0, low_stock_count: 0 });

      const nextSelected: Record<string, boolean> = {};
      for (const item of res.data.items || []) {
        if (item.is_low_stock) nextSelected[item.product_id] = true;
      }
      setSelected(nextSelected);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [supplierId, lowStockOnly]);

  useEffect(() => {
    api.get('/products?limit=500').then((r) => setProducts(r.data.data || [])).catch(() => {});
  }, []);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected],
  );

  const selectedCount = selectedIds.length;

  const toggleAllLowStock = () => {
    const next: Record<string, boolean> = { ...selected };
    for (const item of items) {
      if (item.is_low_stock) next[item.product_id] = true;
    }
    setSelected(next);
  };

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const item of items) next[item.product_id] = true;
    setSelected(next);
  };

  const searchProducts = async (q: string) => {
    try {
      return (await api.get(`/products/search/quick?q=${encodeURIComponent(q)}`)).data;
    } catch {
      return [];
    }
  };

  const openAddModal = () => {
    setPendingProducts([]);
    setAddProductId('');
    setAddProductLabel('');
    setShowAddModal(true);
  };

  const addToPending = (p: any) => {
    if (existingProductIds.has(p.id)) {
      toast.error('Already in supplier catalog');
      return;
    }
    if (pendingProducts.some((x) => x.id === p.id)) {
      toast.error('Already in list');
      return;
    }
    setPendingProducts((prev) => [...prev, { id: p.id, name: p.name, sku: p.sku || '' }]);
    setAddProductId('');
    setAddProductLabel('');
    if (!products.find((x) => x.id === p.id)) setProducts((prev) => [...prev, p]);
  };

  const removePending = (id: string) => {
    setPendingProducts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleBulkAdd = async () => {
    if (pendingProducts.length === 0) {
      toast.error('Add at least one product to the list');
      return;
    }
    setAdding(true);
    try {
      const res = await api.post(`/suppliers/${supplierId}/catalog/bulk`, {
        product_ids: pendingProducts.map((p) => p.id),
      });
      const { added = 0, reactivated = 0, skipped = 0 } = res.data;
      toast.success(`Added ${added + reactivated} product(s)${skipped ? `, ${skipped} skipped` : ''}`);
      setShowAddModal(false);
      setPendingProducts([]);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add products');
    } finally {
      setAdding(false);
    }
  };

  const downloadImportTemplate = () => {
    const token = localStorage.getItem('token');
    window.open(`/api/suppliers/${supplierId}/catalog/import/template?token=${token}`, '_blank');
  };

  const handleImportPreview = async () => {
    if (!importFile) { toast.error('Select a file'); return; }
    setImportPreview(null);
    setImportResult(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post(`/suppliers/${supplierId}/catalog/import/preview`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportPreview(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Preview failed');
    } finally {
      setImporting(false);
    }
  };

  const handleImportExecute = async () => {
    if (!importFile) return;
    if (!window.confirm(`Import ${importPreview?.valid_rows || 0} product(s) to catalog?`)) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post(`/suppliers/${supplierId}/catalog/import/execute`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
      setImportPreview(null);
      const total = (res.data.added || 0) + (res.data.reactivated || 0);
      if (total > 0) {
        toast.success(`Imported ${total} product(s)`);
        load();
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleRemove = async (item: CatalogItem) => {
    if (!window.confirm(`Remove ${item.name} from this supplier catalog?`)) return;
    try {
      await api.delete(`/suppliers/${supplierId}/catalog/${item.catalog_item_id}`);
      toast.success('Removed from catalog');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to remove');
    }
  };

  const startEditReorder = (item: CatalogItem) => {
    if (!canEditProduct) return;
    setEditingReorderId(item.product_id);
    setEditingReorderValue(String(item.reorder_level ?? ''));
  };

  const cancelEditReorder = () => {
    setEditingReorderId(null);
    setEditingReorderValue('');
  };

  const saveReorderLevel = async (productId: string) => {
    if (!canEditProduct || savingReorder) return;
    const parsed = parseFloat(editingReorderValue);
    if (Number.isNaN(parsed) || parsed < 0) {
      toast.error('Enter a valid reorder level');
      return;
    }
    setSavingReorder(true);
    try {
      await api.patch(`/products/${productId}/reorder-level`, { reorder_level: parsed });
      toast.success('Reorder level updated');
      cancelEditReorder();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update reorder level');
    } finally {
      setSavingReorder(false);
    }
  };

  const startEditOrderQty = (item: CatalogItem) => {
    if (!canEdit) return;
    setEditingOrderQtyId(item.catalog_item_id);
    setEditingOrderQtyValue(
      item.fixed_order_qty != null
        ? String(item.fixed_order_qty)
        : item.standard_order_qty != null
          ? String(item.standard_order_qty)
          : '',
    );
  };

  const cancelEditOrderQty = () => {
    setEditingOrderQtyId(null);
    setEditingOrderQtyValue('');
  };

  const saveOrderQty = async (item: CatalogItem) => {
    if (!canEdit || savingOrderQty) return;
    const parsed = parseFloat(editingOrderQtyValue);
    if (Number.isNaN(parsed) || parsed <= 0) {
      toast.error('Enter a valid PO quantity greater than zero');
      return;
    }
    setSavingOrderQty(true);
    try {
      await api.put(`/suppliers/${supplierId}/catalog/${item.catalog_item_id}`, {
        fixed_order_qty: parsed,
      });
      toast.success('PO quantity updated');
      cancelEditOrderQty();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update PO quantity');
    } finally {
      setSavingOrderQty(false);
    }
  };

  const resetOrderQty = async (item: CatalogItem) => {
    if (!canEdit || savingOrderQty) return;
    if (!window.confirm('Reset PO qty to auto (reorder level × multiplier)?')) return;
    setSavingOrderQty(true);
    try {
      await api.put(`/suppliers/${supplierId}/catalog/${item.catalog_item_id}`, {
        fixed_order_qty: null,
      });
      toast.success('PO quantity reset to auto');
      cancelEditOrderQty();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to reset PO quantity');
    } finally {
      setSavingOrderQty(false);
    }
  };

  const copyToPo = () => {
    if (!canCreatePo) {
      toast.error('You do not have permission to create purchase orders');
      return;
    }
    if (selectedIds.length === 0) {
      toast.error('Select at least one item');
      return;
    }
    navigatePoFromSupplierCatalog(navigate, supplierId!, selectedIds);
  };

  if (!supplierId) {
    return <div className="p-6 text-gray-500">Invalid supplier</div>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl text-white p-5 shadow-sm" style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, #1e3a8a 100%)` }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/suppliers" className="inline-flex items-center gap-1.5 text-blue-100 hover:text-white text-sm mb-2">
              <ArrowLeft size={16} /> Back to Suppliers
            </Link>
            <h1 className="text-xl font-bold">{supplier?.supplier_name || 'Supplier Catalog'}</h1>
            <p className="text-blue-100 text-sm mt-1">
              Low stock catalog · PO qty defaults to reorder × 1 — click PO Qty to override per item
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={load} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
              <RefreshCw size={14} /> Refresh
            </button>
            {canEdit && (
              <>
                <button onClick={() => setShowImportModal(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">
                  <Upload size={14} /> Import CSV
                </button>
                <button onClick={openAddModal} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-blue-800 text-sm font-medium hover:bg-blue-50">
                  <Plus size={14} /> Add Products
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-4">
          <div className="px-3 py-2 rounded-lg bg-white/10 text-sm">
            <span className="text-blue-100">Catalog items</span>
            <span className="ml-2 font-bold">{summary.total_items}</span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-orange-500/30 text-sm">
            <span className="text-orange-100">Low stock</span>
            <span className="ml-2 font-bold">{summary.low_stock_count}</span>
          </div>
          <div className="px-3 py-2 rounded-lg bg-white/10 text-sm">
            <span className="text-blue-100">Selected</span>
            <span className="ml-2 font-bold">{selectedCount}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setLowStockOnly(!lowStockOnly)}
            className={`px-3 py-2 rounded-lg text-sm border ${lowStockOnly ? 'bg-orange-50 border-orange-200 text-orange-800' : 'bg-white border-gray-200 text-gray-700'}`}
          >
            {lowStockOnly ? 'Showing low stock only' : 'Show all catalog items'}
          </button>
          <button onClick={toggleAllLowStock} className="px-3 py-2 rounded-lg text-sm border border-gray-200 bg-white hover:bg-gray-50">
            Select all low stock
          </button>
        </div>
        {canCreatePo && (
          <button
            onClick={copyToPo}
            disabled={selectedCount === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            <ShoppingCart size={16} /> Copy to Purchase Order ({selectedCount})
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400">Loading catalog…</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    checked={items.length > 0 && items.every((i) => selected[i.product_id])}
                    onChange={(e) => toggleAll(e.target.checked)}
                    title="Select all visible"
                  />
                </th>
                <th>Product</th>
                <th>SKU</th>
                <th className="text-right">On Hand</th>
                <th className="text-right">Reorder</th>
                <th>Status</th>
                <th className="text-right">PO Qty (pc)</th>
                <th className="text-right">Unit Cost</th>
                {canEdit && <th className="w-12" />}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.catalog_item_id} className={item.is_low_stock ? 'bg-orange-50/60' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={!!selected[item.product_id]}
                      onChange={(e) => setSelected((prev) => ({ ...prev, [item.product_id]: e.target.checked }))}
                    />
                  </td>
                  <td className="font-medium">{item.name}</td>
                  <td className="font-mono text-xs text-gray-500">{item.sku}</td>
                  <td className="text-right tabular-nums">
                    <span className={item.is_low_stock ? 'text-orange-700 font-semibold' : ''}>{item.total_qty}</span>
                    <span className="text-[10px] text-gray-400 block">S:{item.store_qty} W:{item.warehouse_qty}</span>
                  </td>
                      <td className="text-right tabular-nums">
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
                              className="w-16 px-2 py-1 border rounded text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button
                              onClick={() => saveReorderLevel(item.product_id)}
                              disabled={savingReorder}
                              className="px-2 py-0.5 text-[10px] bg-blue-600 text-white rounded disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                        ) : canEditProduct ? (
                          <button
                            type="button"
                            onClick={() => startEditReorder(item)}
                            className="hover:text-blue-700 hover:underline"
                            title="Click to edit reorder level"
                          >
                            {item.reorder_level || '—'}
                          </button>
                        ) : (
                          item.reorder_level || '—'
                        )}
                      </td>
                  <td>
                    {item.is_low_stock ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-orange-100 text-orange-800">
                        <AlertTriangle size={10} /> Low ({item.deficit} short)
                      </span>
                    ) : item.reorder_level > 0 ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700">OK</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-gray-100 text-gray-500">No reorder set</span>
                    )}
                  </td>
                  <td className="text-right font-semibold tabular-nums text-blue-700">
                    {editingOrderQtyId === item.catalog_item_id ? (
                      <div className="inline-flex flex-col items-end gap-1">
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            autoFocus
                            value={editingOrderQtyValue}
                            onChange={(e) => setEditingOrderQtyValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveOrderQty(item);
                              if (e.key === 'Escape') cancelEditOrderQty();
                            }}
                            className="w-20 px-2 py-1 border rounded text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                          <button
                            onClick={() => saveOrderQty(item)}
                            disabled={savingOrderQty}
                            className="px-2 py-0.5 text-[10px] bg-blue-600 text-white rounded disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                        {item.fixed_order_qty != null && (
                          <button
                            type="button"
                            onClick={() => resetOrderQty(item)}
                            disabled={savingOrderQty}
                            className="text-[10px] text-gray-500 hover:text-blue-600 hover:underline"
                          >
                            Reset to auto
                          </button>
                        )}
                      </div>
                    ) : canEdit ? (
                      <button
                        type="button"
                        onClick={() => startEditOrderQty(item)}
                        className="hover:text-blue-900 hover:underline text-right"
                        title="Click to edit PO quantity (pieces)"
                      >
                        {item.standard_order_qty ?? '—'}
                        {item.fixed_order_qty != null && (
                          <span className="block text-[9px] font-normal text-blue-500">custom</span>
                        )}
                      </button>
                    ) : (
                      item.standard_order_qty ?? '—'
                    )}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatCurrency(item.unit_cost)}
                    {item.unit_cost_uom && (
                      <span className="block text-[9px] text-gray-400 uppercase">/{item.unit_cost_uom}</span>
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <button onClick={() => handleRemove(item)} className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Remove from catalog">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 9 : 8} className="text-center py-12 text-gray-400">
                    <Package size={32} className="mx-auto mb-2 opacity-40" />
                    {lowStockOnly ? 'No low stock items in this catalog.' : 'No products in catalog yet. Add items this supplier regularly supplies.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showAddModal && (
        <ModalOverlay onClose={() => setShowAddModal(false)}>
          <div className="modal-content max-w-2xl">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-1">Add Products to Catalog</h2>
              <p className="text-sm text-gray-500 mb-4">Search and add multiple products, then save all at once.</p>
              <label className="block text-sm font-medium mb-1">Search product</label>
              <ProductAutocomplete
                products={products}
                value={addProductId}
                selectedName={addProductLabel}
                searchFn={searchProducts}
                getPrice={(p) => p.cost || 0}
                placeholder="Search product name or SKU…"
                onSelect={(p) => addToPending(p)}
              />
              <p className="text-xs text-gray-400 mt-2">Select a product to add it to the list below.</p>

              <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Products to add ({pendingProducts.length})</span>
                  {pendingProducts.length > 0 && (
                    <button onClick={() => setPendingProducts([])} className="text-xs text-red-600 hover:underline">Clear all</button>
                  )}
                </div>
                {pendingProducts.length === 0 ? (
                  <p className="px-3 py-6 text-sm text-gray-400 text-center">No products selected yet</p>
                ) : (
                  <ul className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
                    {pendingProducts.map((p) => (
                      <li key={p.id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
                        <div>
                          <span className="font-medium text-gray-800">{p.name}</span>
                          <span className="ml-2 font-mono text-[10px] text-gray-400">{p.sku}</span>
                        </div>
                        <button onClick={() => removePending(p.id)} className="p-1 hover:bg-red-50 rounded text-red-600" title="Remove">
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowAddModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleBulkAdd} disabled={adding || pendingProducts.length === 0} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {adding ? 'Adding…' : `Add ${pendingProducts.length || ''} to Catalog`.trim()}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showImportModal && (
        <ModalOverlay onClose={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}>
          <div className="modal-content max-w-4xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Import Supplier Catalog</h2>
                <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }} className="p-1 hover:bg-gray-100 rounded">
                  <X size={18} />
                </button>
              </div>

              {importResult ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <span className="text-sm text-green-700 font-medium bg-green-50 px-3 py-1 rounded">{importResult.added || 0} added</span>
                    {(importResult.reactivated || 0) > 0 && (
                      <span className="text-sm text-blue-700 font-medium bg-blue-50 px-3 py-1 rounded">{importResult.reactivated} reactivated</span>
                    )}
                    {(importResult.skipped || 0) > 0 && (
                      <span className="text-sm text-gray-700 font-medium bg-gray-100 px-3 py-1 rounded">{importResult.skipped} skipped</span>
                    )}
                    {importResult.errors?.length > 0 && (
                      <span className="text-sm text-red-700 font-medium bg-red-50 px-3 py-1 rounded">{importResult.errors.length} errors</span>
                    )}
                  </div>
                  <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Done</button>
                </div>
              ) : importPreview ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{importPreview.file_name}</span>
                    <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">{importPreview.valid_rows} valid</span>
                    {importPreview.error_rows > 0 && (
                      <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded">{importPreview.error_rows} errors</span>
                    )}
                    <button onClick={() => setImportPreview(null)} className="text-xs text-blue-600 hover:underline ml-auto">Back to file upload</button>
                  </div>
                  <div className="border rounded-lg overflow-auto max-h-64">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Row</th>
                          <th className="px-2 py-1.5 text-left">SKU</th>
                          <th className="px-2 py-1.5 text-left">Product</th>
                          <th className="px-2 py-1.5 text-left">Action</th>
                          <th className="px-2 py-1.5 text-left">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importPreview.rows?.map((r: any) => (
                          <tr key={r.row} className={r.has_errors ? 'bg-red-50/50' : ''}>
                            <td className="px-2 py-1.5">{r.row}</td>
                            <td className="px-2 py-1.5 font-mono">{r.resolved_sku || r.sku || '—'}</td>
                            <td className="px-2 py-1.5">{r.resolved_name || r.name || '—'}</td>
                            <td className="px-2 py-1.5">{r.action || '—'}</td>
                            <td className="px-2 py-1.5 text-red-600">{r.has_errors ? r.errors?.join('; ') : 'OK'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => { setImportPreview(null); setImportFile(null); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                    <button onClick={handleImportExecute} disabled={importing || importPreview.valid_rows === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                      {importing ? 'Importing…' : `Import ${importPreview.valid_rows} Products`}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    Upload CSV or Excel with columns: <strong>SKU</strong>, <strong>Product Name</strong> (at least one required),
                    optional <strong>Order Qty Multiplier</strong> (default 1), <strong>Fixed Order Qty</strong>.
                  </p>
                  <div
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const f = e.dataTransfer.files[0];
                      if (f && (f.name.endsWith('.csv') || f.name.endsWith('.xlsx'))) setImportFile(f);
                      else toast.error('Please select a CSV or Excel file');
                    }}
                  >
                    {importFile ? (
                      <div>
                        <p className="text-sm font-medium text-gray-700">{importFile.name}</p>
                        <p className="text-xs text-gray-400 mt-1">{(importFile.size / 1024).toFixed(1)} KB</p>
                        <button onClick={() => setImportFile(null)} className="text-xs text-red-500 hover:underline mt-2">Remove</button>
                      </div>
                    ) : (
                      <label className="cursor-pointer">
                        <Upload size={28} className="mx-auto text-gray-400 mb-2" />
                        <p className="text-sm text-gray-600">Drop CSV/XLSX here or click to browse</p>
                        <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportFile(f); }} />
                      </label>
                    )}
                  </div>
                  <button onClick={downloadImportTemplate} className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                    <Download size={14} /> Download import template
                  </button>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => setShowImportModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                    <button onClick={handleImportPreview} disabled={!importFile || importing}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                      {importing ? 'Reading file…' : 'Preview Import'}
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
