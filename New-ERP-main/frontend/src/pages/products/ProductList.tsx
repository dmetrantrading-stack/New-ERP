import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, generateBarcode } from '../../lib/utils';
import { Plus, Search, Edit2, Eye, Download, Upload, ToggleLeft, Barcode, Trash2 } from 'lucide-react';
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
  const [form, setForm] = useState<any>({
    name: '', barcode: '', category_id: '', brand_id: '', unit_of_measure: 'pc',
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
    api.get(`/products?search=${search}&is_active=${statusFilter}&limit=100`).then((res) => setProducts(res.data.data)).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => { loadProducts(); }, [search, statusFilter]);
  useEffect(() => {
    api.get('/categories/all').then((res) => setCategories(res.data)).catch(console.error);
    api.get('/brands/all').then((res) => setBrands(res.data)).catch(console.error);
  }, []);

  const openCreate = () => { setEditProduct(null); setForm({ name: '', barcode: '', category_id: '', brand_id: '', unit_of_measure: 'pc', cost: 0, retail_price: 0, wholesale_price: 0, distributor_price: 0, reorder_level: 0, tax_type: 'VAT', price_type: 'VAT Inclusive', retail_markup: 0, wholesale_markup: 0, distributor_markup: 0, has_chilled_variant: false, chilled_price: 0 }); setShowModal(true); };
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

  const exportCSV = () => { const token = localStorage.getItem('token'); window.open(`/api/products/export/csv?token=${token}`, '_blank'); };

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
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"><Download size={16} /> Export</button>
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
    </div>
  );
}
