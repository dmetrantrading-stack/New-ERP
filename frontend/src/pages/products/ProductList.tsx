import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, generateBarcode } from '../../lib/utils';
import { Plus, Search, Edit2, Eye, Download, Upload, ToggleLeft, Barcode, Trash2, FileText, X } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

export default function ProductList() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importPreview, setImportPreview] = useState<any>(null);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [detailProduct, setDetailProduct] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'details' | 'price-history'>('details');
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [priceComparison, setPriceComparison] = useState<any>(null);
  const [phLoading, setPhLoading] = useState(false);
  const [phFilterSupplier, setPhFilterSupplier] = useState('');
  const [phDateFrom, setPhDateFrom] = useState('');
  const [phDateTo, setPhDateTo] = useState('');
  const [form, setForm] = useState<any>({
    name: '', barcode: '', category_id: '', brand_id: '', unit_of_measure: 'pc', description: '',
    cost: 0, retail_price: 0, wholesale_price: 0, distributor_price: 0, reorder_level: 0, tax_type: 'VAT', price_type: 'VAT Inclusive',
    retail_markup: 0, wholesale_markup: 0, distributor_markup: 0,
    has_chilled_variant: false, chilled_price: 0
  });

  // Auto-calculate prices when cost or markup changes
  useEffect(() => {
    const cost = parseFloat(form.cost) || 0;
    const rm = parseFloat(form.retail_markup);
    const wm = parseFloat(form.wholesale_markup);
    const dm = parseFloat(form.distributor_markup);
    if (!form._manualRetail && !isNaN(rm)) {
      setForm((f: any) => ({ ...f, retail_price: Math.round(cost * (1 + rm / 100) * 100) / 100 }));
    }
    if (!form._manualWholesale && !isNaN(wm)) {
      setForm((f: any) => ({ ...f, wholesale_price: Math.round(cost * (1 + wm / 100) * 100) / 100 }));
    }
    if (!form._manualDistributor && !isNaN(dm)) {
      setForm((f: any) => ({ ...f, distributor_price: Math.round(cost * (1 + dm / 100) * 100) / 100 }));
    }
  }, [form.cost, form.retail_markup, form.wholesale_markup, form.distributor_markup]);

  const loadProducts = () => {
    setLoading(true);
    api.get(`/products?search=${search}&is_active=${statusFilter}&page=${page}&limit=${limit}`)
      .then((res) => { setProducts(res.data.data); setTotal(res.data.total); })
      .catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { setPage(1); }, [search, statusFilter]);
  useEffect(() => { loadProducts(); }, [page, search, statusFilter]);
  useEffect(() => {
    api.get('/categories/all').then((res) => setCategories(res.data)).catch(console.error);
    api.get('/brands/all').then((res) => setBrands(res.data)).catch(console.error);
  }, []);

  const openCreate = () => { setEditProduct(null); setForm({ name: '', barcode: '', category_id: '', brand_id: '', unit_of_measure: 'pc', description: '', cost: 0, retail_price: 0, wholesale_price: 0, distributor_price: 0, reorder_level: 0, tax_type: 'VAT', price_type: 'VAT Inclusive', retail_markup: 0, wholesale_markup: 0, distributor_markup: 0, has_chilled_variant: false, chilled_price: 0 }); setShowModal(true); };
  const openEdit = (p: any) => {
    const cost = parseFloat(p.cost) || 0;
    setEditProduct(p);
    setForm({
      ...p,
      retail_markup: cost > 0 ? Math.round(((parseFloat(p.retail_price) || 0) / cost - 1) * 100 * 100) / 100 : 0,
      wholesale_markup: cost > 0 ? Math.round(((parseFloat(p.wholesale_price) || 0) / cost - 1) * 100 * 100) / 100 : 0,
      distributor_markup: cost > 0 ? Math.round(((parseFloat(p.distributor_price) || 0) / cost - 1) * 100 * 100) / 100 : 0,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('Product name is required'); return; }
    try {
      const payload = { ...form };
      delete payload._manualRetail; delete payload._manualWholesale; delete payload._manualDistributor;
      delete payload.retail_markup; delete payload.wholesale_markup; delete payload.distributor_markup;
      payload.category_id = payload.category_id || null;
      payload.brand_id = payload.brand_id || null;
      payload.cost = parseFloat(payload.cost) || 0;
      payload.retail_price = parseFloat(payload.retail_price) || 0;
      payload.wholesale_price = parseFloat(payload.wholesale_price) || 0;
      payload.distributor_price = parseFloat(payload.distributor_price) || 0;
      payload.reorder_level = parseFloat(payload.reorder_level) || 0;
      payload.chilled_price = parseFloat(payload.chilled_price) || 0;
      payload.has_chilled_variant = Boolean(payload.has_chilled_variant);
      if (editProduct) {
        await api.put(`/products/${editProduct.id}`, payload);
        toast.success('Product updated');
      } else {
        await api.post('/products', payload);
        toast.success('Product created');
      }
      setShowModal(false);
      loadProducts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error saving product'); }
  };

  const toggleStatus = async (id: string) => {
    try { await api.patch(`/products/${id}/toggle`); loadProducts(); toast.success('Status toggled'); } catch (err: any) { toast.error('Error toggling product'); }
  };

  const deleteProduct = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this product? This cannot be undone.')) return;
    try { await api.delete(`/products/${id}`); loadProducts(); toast.success('Product deleted'); } catch (err: any) { toast.error(err.response?.data?.error || 'Error deleting product'); }
  };

  const exportProducts = (format: string) => {
    const token = localStorage.getItem('token');
    window.open(`/api/products/export?format=${format}&search=${search}&status=${statusFilter}&token=${token}`, '_blank');
    setShowExportDropdown(false);
  };
  const downloadTemplate = () => { const token = localStorage.getItem('token'); window.open(`/api/products/export/template?token=${token}`, '_blank'); };

  const handlePreview = async () => {
    if (!importFile) { toast.error('Select a file'); return; }
    setImportPreview(null);
    setImportResult(null);
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post('/products/import/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportPreview(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Preview failed'); }
    setImporting(false);
  };

  const handleExecuteImport = async () => {
    if (!importFile) return;
    if (!window.confirm(`Import ${importPreview?.valid_rows || 0} products? Rows with errors will be skipped.`)) return;
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await api.post('/products/import/execute', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(res.data);
      setImportPreview(null);
      if (res.data.imported > 0 || res.data.updated > 0) { loadProducts(); toast.success(`Imported ${res.data.imported} new, updated ${res.data.updated}`); }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Import failed'); }
    setImporting(false);
  };

  const loadPriceHistory = async (productId: string) => {
    setPhLoading(true);
    try {
      const params = new URLSearchParams();
      if (phFilterSupplier) params.set('supplier_name', phFilterSupplier);
      if (phDateFrom) params.set('date_from', phDateFrom);
      if (phDateTo) params.set('date_to', phDateTo);
      const [histRes, compRes] = await Promise.all([
        api.get(`/supplier-price-history/product/${productId}?${params.toString()}`),
        api.get(`/supplier-price-history/product/${productId}/comparison`),
      ]);
      setPriceHistory(histRes.data);
      setPriceComparison(compRes.data);
    } catch (err: any) { toast.error('Failed to load price history'); }
    setPhLoading(false);
  };

  const openDetail = (product: any) => {
    setDetailProduct(product);
    setDetailTab('details');
    setShowDetail(true);
    setPriceHistory([]);
    setPriceComparison(null);
  };

  const handleGenerateBarcode = () => {
    const raw = String(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000000));
    const barcode = generateBarcode(raw);
    setForm({ ...form, barcode });
    toast.success('Barcode generated');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Products</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"><Upload size={16} /> Import</button>
          <div className="relative">
            <button onClick={() => setShowExportDropdown(!showExportDropdown)} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"><Download size={16} /> Export</button>
            {showExportDropdown && (
              <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-40">
                <button onClick={() => exportProducts('csv')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-100">Export as CSV</button>
                <button onClick={() => exportProducts('xlsx')} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50">Export as Excel</button>
              </div>
            )}
          </div>
          <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Product</button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, SKU, or barcode..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="all">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th><th>Name</th><th>Category</th><th>Cost</th><th>Retail</th><th>Wholesale</th><th>Stock</th><th>Status</th><th className="w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">No products found</td></tr>
              ) : products.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.sku}</td>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.category_name || '-'}</td>
                  <td>{formatCurrency(p.cost)}</td>
                  <td>{formatCurrency(p.retail_price)}</td>
                  <td>{formatCurrency(p.wholesale_price)}</td>
                  <td>{p.store_stock || 0} / {p.warehouse_stock || 0}</td>
                  <td><span className={`px-2 py-1 text-xs rounded-full ${p.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{p.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openDetail(p)} className="p-1.5 hover:bg-gray-50 rounded" title="View Details"><Eye size={15} /></button>
                      <button onClick={() => openEdit(p)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                      <button onClick={() => toggleStatus(p.id)} className="p-1.5 hover:bg-gray-50 rounded"><ToggleLeft size={15} /></button>
                      <button onClick={() => deleteProduct(p.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} limit={limit} onLimitChange={(l) => setPage(1)} showSizeChanger />
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editProduct ? 'Edit Product' : 'Add Product'}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">Product Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Barcode</label>
                  <div className="flex gap-2">
                    <input type="text" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    <button type="button" onClick={handleGenerateBarcode} title="Generate barcode" className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 text-blue-600"><Barcode size={16} /></button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category</label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Category</option>
                    {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Brand</label>
                  <select value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Brand</option>
                    {brands.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Unit of Measure</label>
                  <select value={form.unit_of_measure} onChange={(e) => setForm({ ...form, unit_of_measure: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="pc">Piece (pc)</option><option value="case">Case</option><option value="box">Box</option>
                    <option value="sack">Sack</option><option value="kg">Kilogram</option><option value="liter">Liter</option>
                    <option value="pack">Pack</option><option value="bottle">Bottle</option><option value="can">Can</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cost</label>
                  <input type="number" step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value, _manualRetail: false, _manualWholesale: false, _manualDistributor: false })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div className="border rounded-lg p-3 bg-gray-50 col-span-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Pricing &amp; Markup</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Retail Markup %</label>
                      <input type="number" step="0.01" value={form.retail_markup} onChange={(e) => setForm({ ...form, retail_markup: e.target.value, _manualRetail: false })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Retail Price</label>
                      <input type="number" step="0.01" value={form.retail_price} onChange={(e) => setForm({ ...form, retail_price: e.target.value, _manualRetail: true })}
                        className="w-full px-3 py-2 border rounded-lg text-sm font-medium text-blue-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="flex items-end text-xs text-gray-400 pb-2">
                      {form.cost > 0 && form.retail_price > 0 ? `+${Math.round(((parseFloat(form.retail_price) / parseFloat(form.cost)) - 1) * 100 * 100) / 100}%` : ''}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Wholesale Markup %</label>
                      <input type="number" step="0.01" value={form.wholesale_markup} onChange={(e) => setForm({ ...form, wholesale_markup: e.target.value, _manualWholesale: false })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Wholesale Price</label>
                      <input type="number" step="0.01" value={form.wholesale_price} onChange={(e) => setForm({ ...form, wholesale_price: e.target.value, _manualWholesale: true })}
                        className="w-full px-3 py-2 border rounded-lg text-sm font-medium text-green-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="flex items-end text-xs text-gray-400 pb-2">
                      {form.cost > 0 && form.wholesale_price > 0 ? `+${Math.round(((parseFloat(form.wholesale_price) / parseFloat(form.cost)) - 1) * 100 * 100) / 100}%` : ''}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Distributor Markup %</label>
                      <input type="number" step="0.01" value={form.distributor_markup} onChange={(e) => setForm({ ...form, distributor_markup: e.target.value, _manualDistributor: false })}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Distributor Price</label>
                      <input type="number" step="0.01" value={form.distributor_price} onChange={(e) => setForm({ ...form, distributor_price: e.target.value, _manualDistributor: true })}
                        className="w-full px-3 py-2 border rounded-lg text-sm font-medium text-purple-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div className="flex items-end text-xs text-gray-400 pb-2">
                      {form.cost > 0 && form.distributor_price > 0 ? `+${Math.round(((parseFloat(form.distributor_price) / parseFloat(form.cost)) - 1) * 100 * 100) / 100}%` : ''}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Reorder Level</label>
                  <input type="number" step="0.01" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tax Type</label>
                  <select value={form.tax_type} onChange={(e) => setForm({ ...form, tax_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="VAT">VAT 12%</option><option value="VAT Exempt">VAT Exempt</option>
                    <option value="Zero Rated">Zero Rated</option><option value="LGU 5% Final VAT">LGU 5% Final VAT</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Price Type</label>
                  <select value={form.price_type} onChange={(e) => setForm({ ...form, price_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="VAT Inclusive">VAT Inclusive</option>
                    <option value="VAT Exclusive">VAT Exclusive</option>
                  </select>
                </div>
                <div className="col-span-2 border rounded-lg p-3 bg-blue-50/50">
                  <label className="flex items-center gap-2 cursor-pointer mb-2">
                    <input type="checkbox" checked={form.has_chilled_variant} onChange={(e) => setForm({ ...form, has_chilled_variant: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm font-medium text-gray-700">Enable Chilled Variant</span>
                  </label>
                  {form.has_chilled_variant && (
                    <div className="mt-2">
                      <label className="block text-xs text-gray-500 mb-1">Chilled Selling Price (Retail only)</label>
                      <input type="number" step="0.01" value={form.chilled_price} onChange={(e) => setForm({ ...form, chilled_price: e.target.value })}
                        className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm font-medium text-cyan-700 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import modal */}
      {showImportModal && (
        <div className="modal-overlay" onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}>
          <div className="modal-content max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Import Products</h2>
                <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}
                  className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>

              {importResult ? (
                /* Step 3: Results */
                <div>
                  <div className="flex items-center gap-3 mb-4 p-4 bg-gray-50 rounded-lg">
                    <span className="text-sm font-medium">Results:</span>
                    <span className="text-sm text-green-700 font-medium bg-green-50 px-3 py-1 rounded">{importResult.imported} created</span>
                    {importResult.updated > 0 && <span className="text-sm text-blue-700 font-medium bg-blue-50 px-3 py-1 rounded">{importResult.updated} updated</span>}
                    {importResult.errors?.length > 0 && <span className="text-sm text-red-700 font-medium bg-red-50 px-3 py-1 rounded">{importResult.errors.length} errors</span>}
                  </div>
                  {importResult.errors?.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1 mb-4">
                      {importResult.errors.map((e: any, i: number) => (
                        <p key={i} className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded">{e.row > 0 ? `Row ${e.row}: ` : ''}{e.message}</p>
                      ))}
                    </div>
                  )}
                  <button onClick={() => { setShowImportModal(false); setImportFile(null); setImportPreview(null); setImportResult(null); }}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Done</button>
                </div>
              ) : importPreview ? (
                /* Step 2: Preview table with errors */
                <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium">{importPreview.file_name}</span>
                        <span className="text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded">{importPreview.valid_rows} valid</span>
                        {(() => { const creates = importPreview.rows?.filter((r: any) => r.action === 'Create').length || 0; const updates = importPreview.rows?.filter((r: any) => r.action === 'Update').length || 0; return <><span className="text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{creates} to create</span><span className="text-xs text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">{updates} to update</span></>; })()}
                        {importPreview.error_rows > 0 && <span className="text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded">{importPreview.error_rows} errors</span>}
                      </div>
                    <button onClick={() => setImportPreview(null)} className="text-xs text-blue-600 hover:underline">Back to file upload</button>
                  </div>
                  <div className="max-h-80 overflow-auto border border-gray-200 rounded-lg mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">#</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Name</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">SKU</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Barcode</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Category</th>
                          <th className="px-2 py-2 text-right font-semibold text-gray-500">Cost</th>
                          <th className="px-2 py-2 text-right font-semibold text-gray-500">Retail</th>
                          <th className="px-2 py-2 text-center font-semibold text-gray-500">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {importPreview.rows?.map((r: any) => (
                          <tr key={r.row} className={r.has_errors ? 'bg-red-50' : 'hover:bg-gray-50'}>
                            <td className="px-2 py-1.5 text-gray-400">{r.row}</td>
                            <td className="px-2 py-1.5 font-medium">{r.name}</td>
                            <td className="px-2 py-1.5 font-mono text-xs">{r.sku || '-'}</td>
                            <td className="px-2 py-1.5 font-mono">{r.barcode || '-'}</td>
                            <td className="px-2 py-1.5">{r.category || '-'}</td>
                            <td className="px-2 py-1.5 text-right">{r.cost}</td>
                            <td className="px-2 py-1.5 text-right">{r.retail_price}</td>
                            <td className="px-2 py-1.5 text-center">
                              {r.has_errors ? (
                                <span className="text-red-600 font-medium" title={r.errors?.join('; ')}>Error</span>
                              ) : (
                                <span className={`font-medium ${r.action === 'Update' ? 'text-blue-600' : 'text-green-600'}`}>{r.action}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importPreview.errors?.length > 0 && (
                    <div className="max-h-32 overflow-y-auto space-y-1 mb-3">
                      {importPreview.errors.map((e: any, i: number) => (
                        <p key={i} className="text-xs text-red-600 bg-red-50 px-3 py-1 rounded">{e.row > 0 ? `Row ${e.row}: ` : ''}{e.message}</p>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-end gap-3">
                    <button onClick={() => { setImportPreview(null); setImportFile(null); }}
                      className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                    <button onClick={handleExecuteImport} disabled={importing || importPreview.valid_rows === 0}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {importing ? 'Importing...' : `Import ${importPreview.valid_rows} Products`}
                    </button>
                  </div>
                </div>
              ) : (
                /* Step 1: Upload file */
                <div>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-4"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && (f.name.endsWith('.csv') || f.name.endsWith('.xlsx'))) setImportFile(f); else toast.error('Please select a CSV or Excel file'); }}>
                    {importFile ? (
                      <div>
                        <FileText size={32} className="mx-auto text-blue-500 mb-2" />
                        <p className="text-sm font-medium text-gray-700">{importFile.name}</p>
                        <p className="text-xs text-gray-400 mt-1">{(importFile.size / 1024).toFixed(1)} KB</p>
                        <button onClick={() => setImportFile(null)} className="text-xs text-red-500 hover:underline mt-2">Remove</button>
                      </div>
                    ) : (
                      <div>
                        <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                        <p className="text-sm text-gray-500">Drag & drop a CSV or Excel file here, or</p>
                        <label className="inline-block mt-2 px-4 py-2 bg-blue-600 text-white rounded text-sm cursor-pointer hover:bg-blue-700">
                          Browse Files
                          <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportFile(f); }} />
                        </label>
                        <p className="text-xs text-gray-400 mt-2">CSV or Excel (.xlsx) up to 10MB</p>
                      </div>
                    )}
                  </div>
                  <button onClick={downloadTemplate} className="text-xs text-blue-600 hover:underline mb-4 inline-block">
                    Download import template
                  </button>
                  <div className="flex justify-end gap-3 mt-4">
                    <button onClick={() => { setShowImportModal(false); setImportFile(null); }}
                      className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                    <button onClick={handlePreview} disabled={!importFile || importing}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {importing ? 'Reading file...' : 'Preview Import'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {showDetail && detailProduct && (
        <div className="modal-overlay" onClick={() => setShowDetail(false)}>
          <div className="modal-content max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">{detailProduct.name}</h2>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 text-xs rounded-full ${detailProduct.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{detailProduct.is_active ? 'Active' : 'Inactive'}</span>
                  <button onClick={() => setShowDetail(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 mb-4">
                <button onClick={() => setDetailTab('details')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 ${detailTab === 'details' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Product Details</button>
                <button onClick={() => { setDetailTab('price-history'); loadPriceHistory(detailProduct.id); }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 ${detailTab === 'price-history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>Supplier Price History</button>
              </div>

              {detailTab === 'details' && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-gray-500">SKU:</span> <span className="font-mono ml-2">{detailProduct.sku}</span></div>
                  <div><span className="text-gray-500">Barcode:</span> <span className="font-mono ml-2">{detailProduct.barcode || '-'}</span></div>
                  <div><span className="text-gray-500">Category:</span> <span className="ml-2">{detailProduct.category_name || '-'}</span></div>
                  <div><span className="text-gray-500">Brand:</span> <span className="ml-2">{detailProduct.brand_name || '-'}</span></div>
                  <div><span className="text-gray-500">Unit of Measure:</span> <span className="ml-2">{detailProduct.unit_of_measure}</span></div>
                  <div><span className="text-gray-500">Cost:</span> <span className="ml-2 font-semibold">{formatCurrency(detailProduct.cost)}</span></div>
                  <div><span className="text-gray-500">Retail Price:</span> <span className="ml-2">{formatCurrency(detailProduct.retail_price)}</span></div>
                  <div><span className="text-gray-500">Wholesale Price:</span> <span className="ml-2">{formatCurrency(detailProduct.wholesale_price)}</span></div>
                  <div><span className="text-gray-500">Distributor Price:</span> <span className="ml-2">{formatCurrency(detailProduct.distributor_price)}</span></div>
                  <div><span className="text-gray-500">Reorder Level:</span> <span className="ml-2">{detailProduct.reorder_level}</span></div>
                  <div><span className="text-gray-500">Tax Type:</span> <span className="ml-2">{detailProduct.tax_type}</span></div>
                  <div><span className="text-gray-500">Price Type:</span> <span className="ml-2">{detailProduct.price_type}</span></div>
                  {detailProduct.description && <div className="col-span-2"><span className="text-gray-500">Description:</span> <span className="ml-2">{detailProduct.description}</span></div>}
                </div>
              )}

              {detailTab === 'price-history' && (
                <div className="space-y-4">
                  {/* Price Comparison Summary Cards */}
                  {priceComparison && priceComparison.stats && (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <p className="text-xs text-green-700 uppercase font-semibold">Cheapest Supplier</p>
                        <p className="text-lg font-bold text-green-800">{priceComparison.stats.cheapest_supplier || '-'}</p>
                        <p className="text-sm text-green-600">{formatCurrency(priceComparison.stats.cheapest_price)}</p>
                      </div>
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <p className="text-xs text-red-700 uppercase font-semibold">Highest Supplier</p>
                        <p className="text-lg font-bold text-red-800">{priceComparison.stats.most_expensive_supplier || '-'}</p>
                        <p className="text-sm text-red-600">{formatCurrency(priceComparison.stats.highest_price)}</p>
                      </div>
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-xs text-blue-700 uppercase font-semibold">Average Cost</p>
                        <p className="text-lg font-bold text-blue-800">{formatCurrency(priceComparison.stats.avg_cost)}</p>
                        <p className="text-sm text-blue-600">{priceComparison.stats.supplier_count} supplier(s)</p>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                        <p className="text-xs text-gray-700 uppercase font-semibold">Current Product Cost</p>
                        <p className="text-lg font-bold text-gray-800">{formatCurrency(priceComparison.stats.current_cost)}</p>
                        <p className="text-sm text-gray-600">Last purchase: {formatCurrency(priceComparison.stats.last_purchase_price)}</p>
                      </div>
                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                        <p className="text-xs text-purple-700 uppercase font-semibold">Last Purchase Price</p>
                        <p className="text-lg font-bold text-purple-800">{formatCurrency(priceComparison.stats.last_purchase_price)}</p>
                        <p className="text-sm text-purple-600">on last GR</p>
                      </div>
                    </div>
                  )}

                  {/* Supplier Price Comparison */}
                  {priceComparison?.suppliers?.length > 0 && (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-semibold text-sm text-gray-700">Supplier Price Comparison</div>
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-2 text-left font-semibold text-gray-500">Supplier</th>
                            <th className="px-4 py-2 text-right font-semibold text-gray-500">Latest Cost</th>
                            <th className="px-4 py-2 text-right font-semibold text-gray-500">Previous Cost</th>
                            <th className="px-4 py-2 text-right font-semibold text-gray-500">Difference</th>
                            <th className="px-4 py-2 text-center font-semibold text-gray-500">Trend</th>
                            <th className="px-4 py-2 text-left font-semibold text-gray-500">Last Purchase</th>
                            <th className="px-4 py-2 text-left font-semibold text-gray-500">PO#</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {priceComparison.suppliers.map((s: any) => (
                            <tr key={s.supplier_id} className={`${s.is_best_price ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                              <td className="px-4 py-2 font-medium">{s.supplier_name} {s.is_best_price && <span className="text-green-600 text-xs font-semibold">(Best Price)</span>}</td>
                              <td className="px-4 py-2 text-right font-semibold">{formatCurrency(s.latest_cost)}</td>
                              <td className="px-4 py-2 text-right">{formatCurrency(s.previous_cost)}</td>
                              <td className={`px-4 py-2 text-right ${s.price_difference > 0 ? 'text-red-600' : s.price_difference < 0 ? 'text-green-600' : ''}`}>
                                {s.price_difference > 0 ? '+' : ''}{formatCurrency(s.price_difference)}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <span className={`px-2 py-0.5 text-xs rounded-full ${
                                  s.trend === 'Increased' ? 'bg-red-100 text-red-700' :
                                  s.trend === 'Decreased' ? 'bg-green-100 text-green-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>{s.trend}</span>
                              </td>
                              <td className="px-4 py-2">{s.last_purchase_date ? new Date(s.last_purchase_date).toLocaleDateString() : '-'}</td>
                              <td className="px-4 py-2 font-mono text-xs">{s.po_number || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <input type="text" placeholder="Filter by supplier..." value={phFilterSupplier}
                      onChange={(e) => setPhFilterSupplier(e.target.value)} className="px-3 py-1.5 border rounded text-sm w-48" />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">From:</span>
                      <input type="date" value={phDateFrom} onChange={(e) => setPhDateFrom(e.target.value)} className="px-2 py-1.5 border rounded text-sm" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">To:</span>
                      <input type="date" value={phDateTo} onChange={(e) => setPhDateTo(e.target.value)} className="px-2 py-1.5 border rounded text-sm" />
                    </div>
                    <button onClick={() => loadPriceHistory(detailProduct.id)} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Apply</button>
                    <div className="flex-1" />
                    <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/supplier-price-history/report?product_id=${detailProduct.id}&format=csv&token=${token}`, '_blank'); }}
                      className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Export CSV</button>
                    <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/supplier-price-history/report?product_id=${detailProduct.id}&format=xlsx&token=${token}`, '_blank'); }}
                      className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Export Excel</button>
                    <button onClick={() => window.print()} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Print Report</button>
                  </div>

                  {/* Price History Table */}
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 font-semibold text-sm text-gray-700">
                      Price History Records ({priceHistory.length})
                    </div>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Supplier</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-500">Unit Cost</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-500">Prev Cost</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-500">Diff</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-500">Qty</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">UOM</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Date</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">PO#</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">RR#</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Location</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Batch#</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Expiry</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-500">Remarks</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {phLoading ? (
                            <tr><td colSpan={13} className="text-center py-8 text-gray-400">Loading...</td></tr>
                          ) : priceHistory.length === 0 ? (
                            <tr><td colSpan={13} className="text-center py-8 text-gray-400">No price history records</td></tr>
                          ) : priceHistory.map((h: any) => (
                            <tr key={h.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-medium">{h.supplier_name}</td>
                              <td className="px-3 py-2 text-right font-semibold">{formatCurrency(h.unit_cost)}</td>
                              <td className="px-3 py-2 text-right text-gray-500">{formatCurrency(h.previous_cost)}</td>
                              <td className={`px-3 py-2 text-right ${h.price_difference > 0 ? 'text-red-600' : h.price_difference < 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                {h.price_difference > 0 ? '+' : ''}{formatCurrency(h.price_difference)}
                              </td>
                              <td className="px-3 py-2 text-right">{h.quantity_received}</td>
                              <td className="px-3 py-2">{h.uom}</td>
                              <td className="px-3 py-2 text-xs">{h.received_date ? new Date(h.received_date).toLocaleDateString() : '-'}</td>
                              <td className="px-3 py-2 font-mono text-xs">{h.po_number || '-'}</td>
                              <td className="px-3 py-2 font-mono text-xs">{h.gr_number || '-'}</td>
                              <td className="px-3 py-2">{h.location_name || h.location_name_ref || '-'}</td>
                              <td className="px-3 py-2 font-mono text-xs">{h.batch_number || '-'}</td>
                              <td className="px-3 py-2 text-xs">{h.expiry_date ? new Date(h.expiry_date).toLocaleDateString() : '-'}</td>
                              <td className="px-3 py-2 text-xs text-gray-500">{h.remarks || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
