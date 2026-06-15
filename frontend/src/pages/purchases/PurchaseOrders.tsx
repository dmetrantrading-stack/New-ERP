import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Plus, Eye, Send, ArrowLeft, Edit2, Printer } from 'lucide-react';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import AttachmentPanel from '../../components/AttachmentPanel';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

const LOCATIONS = [{ id: 1, name: 'Store' }, { id: 2, name: 'Warehouse' }];

export default function PurchaseOrders() {
  const [searchParams] = useSearchParams();
  const supplierFilter = searchParams.get('supplier');
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [showView, setShowView] = useState(false);
  const [viewedPO, setViewedPO] = useState<any>(null);
  const [editingPO, setEditingPO] = useState<any>(null);
  const [currentPOId, setCurrentPOId] = useState<string | null>(null);
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [form, setForm] = useState<any>({ supplier_id: supplierFilter || '', expected_date: new Date().toISOString().split('T')[0], notes: '', items: [], vat_mode: 'VAT Inclusive' });
  const [receiveForm, setReceiveForm] = useState<any>({ location_id: 1, items: [] });
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const loadOrders = () => {
    let url = supplierFilter ? `/purchases/orders?supplier_id=${supplierFilter}&page=${page}&limit=${limit}` : `/purchases/orders?page=${page}&limit=${limit}`;
    api.get(url).then((res) => { setOrders(res.data.data || []); setTotal(res.data.total || 0); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load')).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
    api.get('/products?limit=500').then((res) => setProducts(res.data.data || [])).catch(() => {});
    api.get('/suppliers').then((res) => setSuppliers(res.data.data || [])).catch(() => {});
  }, [page, supplierFilter]);

  const searchProducts = async (q: string) => {
    try { const res = await api.get(`/products/search/quick?q=${encodeURIComponent(q)}`); return res.data; }
    catch { return []; }
  };

  const selectSupplier = (supplierId: string) => {
    if (!supplierId) {
      setSelectedSupplier(null);
      setForm({ ...form, supplier_id: '', supplier_name: '' });
      return;
    }
    const s = suppliers.find(x => String(x.id) === supplierId);
    if (!s) return;
    setSelectedSupplier(s);
    setForm(prev => ({ ...prev, supplier_id: s.id, supplier_name: s.supplier_name }));
  };

  const addItem = () => {
    setForm({
      ...form,
      items: [...form.items, { product_id: '', variant_id: '', location_id: 1, quantity: 1, unit_cost: 0, unit_of_measure: '', variants: [], available_qty: 0, discount_type: '%', discount_value: '0' }],
    });
  };

  const updateItem = (index: number, field: string, value: any) => {
    const items = [...form.items];
    items[index][field] = value;
    if (field === 'product_id' && value) {
      const product = products.find((p) => p.id === value);
      if (product) {
        items[index].unit_cost = product.cost || 0;
        items[index].product_name = product.name;
        items[index].sku = product.sku;
        items[index].unit_of_measure = product.unit_of_measure || '';
        items[index].variants = product.variants || [];
        items[index].variant_id = '';
      }
    }
    setForm({ ...form, items });
  };

  const removeItem = (index: number) => {
    setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== index) });
  };

  const computeLineTotal = (item: any) => {
    const qty = parseFloat(String(item.quantity)) || 0;
    const cost = parseFloat(String(item.unit_cost)) || 0;
    const gross = qty * cost;
    const discType = item.discount_type || '%';
    const discVal = parseFloat(String(item.discount_value)) || 0;
    const discAmt = discType === '%' ? gross * (discVal / 100) : discVal;
    return Math.max(0, gross - discAmt);
  };

  const totals = form.items.reduce((acc: { gross: number; lineDiscount: number; net: number; itemCount: number }, item: any) => {
    const qty = parseFloat(String(item.quantity)) || 0;
    const cost = parseFloat(String(item.unit_cost)) || 0;
    const gross = qty * cost;
    const discType = item.discount_type || '%';
    const discVal = parseFloat(String(item.discount_value)) || 0;
    const discAmt = discType === '%' ? gross * (discVal / 100) : discVal;
    acc.gross += gross;
    acc.lineDiscount += discAmt;
    acc.net += Math.max(0, gross - discAmt);
    acc.itemCount += 1;
    return acc;
  }, { gross: 0, lineDiscount: 0, net: 0, itemCount: 0 });

  const vatMode = form.vat_mode || 'VAT Inclusive';
  let vatAmount = 0;
  let vatableAmount = totals.net;
  let grandTotal = totals.net;

  if (vatMode === 'VAT Inclusive') {
    vatableAmount = totals.net / 1.12;
    vatAmount = totals.net - vatableAmount;
    grandTotal = totals.net;
  } else if (vatMode === 'VAT Exclusive') {
    vatAmount = totals.net * 0.12;
    grandTotal = totals.net + vatAmount;
  } else {
    vatAmount = 0;
    grandTotal = totals.net;
  }

  const createPO = async () => {
    if (!form.supplier_id) { toast.error('Please select a supplier'); return; }
    if (form.items.length === 0) { toast.error('Add at least one item'); return; }
    for (const item of form.items) {
      if (!item.product_id) { toast.error('Select a product for every row'); return; }
      if (parseFloat(String(item.quantity)) <= 0) { toast.error('Quantity must be > 0'); return; }
    }
    try {
      const payload = {
        supplier_id: form.supplier_id,
        expected_date: form.expected_date,
        notes: form.notes,
        vat_mode: vatMode,
        payment_terms: form.payment_terms,
        items: form.items.map((i: any) => ({
          product_id: i.product_id,
          variant_id: i.variant_id || undefined,
          quantity: parseFloat(String(i.quantity)),
          unit_cost: parseFloat(String(i.unit_cost)),
          discount_type: i.discount_type || '%',
          discount_value: parseFloat(String(i.discount_value)) || 0,
          location_id: i.location_id,
        })),
      };
      if (editingPO) {
        await api.put(`/purchases/orders/${editingPO.id}`, payload);
        toast.success('PO Updated');
      } else {
        const res = await api.post('/purchases/orders', payload);
        toast.success('PO Created');
        setCurrentPOId(res.data.id);
      }
      setCreating(false);
      setEditingPO(null);
      resetForm();
      loadOrders();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openEditPO = async (poId: string) => {
    try {
      const res = await api.get(`/purchases/orders/${poId}`);
      const po = res.data;
      setEditingPO(po);
      setForm({
        supplier_id: String(po.supplier_id || ''),
        expected_date: po.expected_date || new Date().toISOString().split('T')[0],
        notes: po.notes || '',
        vat_mode: po.vat_mode || 'VAT Inclusive',
        payment_terms: po.payment_terms || '',
        items: (po.items || []).map((i: any) => ({
          product_id: i.product_id,
          variant_id: i.variant_id || '',
          quantity: i.quantity,
          unit_cost: i.unit_cost,
          discount_type: i.discount_type || '%',
          discount_value: i.discount_value || 0,
          location_id: i.location_id || 1,
          unit_of_measure: i.unit_of_measure || '',
          available_qty: 0,
        })),
      });
      const supplier = suppliers.find((s: any) => String(s.id) === String(po.supplier_id));
      if (supplier) setSelectedSupplier(supplier);
      setCreating(true);
    } catch { toast.error('Failed to load PO for editing'); }
  };

  const resetForm = () => {
    setForm({ supplier_id: '', expected_date: new Date().toISOString().split('T')[0], notes: '', items: [], vat_mode: 'VAT Inclusive', payment_terms: '' });
    setSelectedSupplier(null); setEditingPO(null);
  };

  const sendPO = async (id: string) => {
    try { await api.patch(`/purchases/orders/${id}/send`); toast.success('PO Sent'); loadOrders(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const viewPO = async (poId: string) => {
    try {
      const res = await api.get(`/purchases/orders/${poId}`);
      setViewedPO(res.data);
      setShowView(true);
    } catch { toast.error('Failed to load PO details'); }
  };

  const openReceive = async (po: any) => {
    try {
      setSelectedPO(po);
      const res = await api.get(`/purchases/orders/${po.id}`);
      const items = res.data.items.map((i: any) => ({
        po_item_id: i.id, product_id: i.product_id, product_name: i.product_name,
        quantity: i.quantity - i.received_quantity, unit_cost: i.unit_cost,
        net_unit_cost: i.net_unit_cost || i.unit_cost,
        discount_amount: i.discount_amount || '0',
        batch_number: '', expiry_date: '',
      }));
      setReceiveForm({ location_id: 1, supplier_invoice_number: '', items: items.filter((i: any) => i.quantity > 0) });
      setShowReceive(true);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error loading order'); }
  };

  const receiveStock = async () => {
    try {
      await api.post('/purchases/receipts', { po_id: selectedPO.id, supplier_id: selectedPO.supplier_id, ...receiveForm });
      toast.success('Stock received');
      setShowReceive(false);
      loadOrders();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error receiving stock'); }
  };

  useEffect(() => {
    if (!creating) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F8') { e.preventDefault(); createPO(); }
      if (e.key === 'Escape') { e.preventDefault(); setCreating(false); resetForm(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [creating, form]);

  // ========== FULL-SCREEN CREATE VIEW ==========
  if (creating) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50">
        {/* Header Bar */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => { setCreating(false); resetForm(); }} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} /></button>
            <h1 className="text-lg font-bold text-gray-900">{editingPO ? `Edit PO ${editingPO.po_number}` : 'New Purchase Order'}</h1>
            <span className="font-mono text-base font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded">PO-{new Date().getFullYear()}-######</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>F2: Search Product</span><span>|</span><span>F8: {editingPO ? 'Update PO' : 'Create PO'}</span><span>|</span><span>Esc: Cancel</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* Info Row */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Order Date</label>
              <input type="date" value={new Date().toISOString().split('T')[0]} readOnly
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-gray-50 text-gray-500" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Expected Date</label>
              <input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">VAT Mode</label>
              <select value={vatMode} onChange={(e) => setForm({ ...form, vat_mode: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1">
                <option value="VAT Inclusive">VAT Inclusive</option>
                <option value="VAT Exclusive">VAT Exclusive</option>
                <option value="VAT Exempt">VAT Exempt</option>
                <option value="Zero Rated">Zero Rated</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Payment Terms</label>
              <input type="text" value={form.payment_terms || ''} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                placeholder="e.g. Net 30" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1" />
            </div>
          </div>

          {/* Supplier Section */}
          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-500 uppercase">Supplier *</label>
                <select value={form.supplier_id} onChange={(e) => selectSupplier(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1">
                  <option value="">Select Supplier</option>
                  {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
              </div>
              {selectedSupplier && <>
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase">Contact Person</label>
                  <input type="text" value={selectedSupplier.contact_person || '—'} readOnly
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm mt-1 bg-gray-50 text-gray-500" />
                </div>
              </>}
            </div>
            {selectedSupplier && (selectedSupplier.address || selectedSupplier.contact_number) && (
              <div className="mt-2 text-xs text-gray-500">{selectedSupplier.address}{selectedSupplier.contact_number ? ` · ${selectedSupplier.contact_number}` : ''}</div>
            )}
          </div>

          {/* Items Table */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden mb-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase">
                    <th className="px-2 py-2 text-left w-5">#</th>
                    <th className="px-2 py-2 text-left">Product</th>
                    <th className="px-2 py-2 text-left w-24">Variant</th>
                    <th className="px-2 py-2 text-left w-24">Location</th>
                    <th className="px-2 py-2 text-center w-20">Qty</th>
                    <th className="px-2 py-2 text-center w-16">Unit</th>
                    <th className="px-2 py-2 text-right w-24">Unit Cost</th>
                    <th className="px-2 py-2 text-center w-16">Disc</th>
                    <th className="px-2 py-2 text-right w-24">Net Total</th>
                    <th className="px-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {form.items.map((item: any, i: number) => {
                    const product = products.find((p) => p.id === item.product_id);
                    const variants = item.variants || product?.variants || [];
                    const lineTotal = computeLineTotal(item);
                    return (
                      <tr key={i} className="hover:bg-blue-50/30">
                        <td className="px-2 py-1.5 text-xs text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <ProductAutocomplete
                            products={products}
                            value={item.product_id}
                            selectedName={product ? product.name : ''}
                            placeholder="Search product..."
                            getPrice={(p) => p.cost || 0}
                            onSelect={(p) => {
                              if (!products.find(x => x.id === p.id)) setProducts(prev => [...prev, p]);
                              const items = [...form.items];
                              items[i].product_id = p.id;
                              items[i].unit_cost = p.cost || 0;
                              items[i].product_name = p.name;
                              items[i].sku = p.sku;
                              items[i].unit_of_measure = p.unit_of_measure || '';
                              items[i].variants = p.variants || [];
                              items[i].variant_id = '';
                              setForm({ ...form, items });
                            }}
                            searchFn={searchProducts}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={item.variant_id || ''} onChange={(e) => updateItem(i, 'variant_id', e.target.value)}
                            disabled={variants.length === 0}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs disabled:bg-gray-50">
                            <option value="">—</option>
                            {variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <select value={item.location_id} onChange={(e) => updateItem(i, 'location_id', parseInt(e.target.value))}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs">
                            {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" step="any" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs text-center" min="1" />
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs text-gray-500">{item.unit_of_measure || '—'}</td>
                        <td className="px-2 py-1.5">
                          <input type="number" step="0.01" value={item.unit_cost} onChange={(e) => updateItem(i, 'unit_cost', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs text-right" />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-0.5">
                            <input type="number" step="0.01" value={item.discount_value || ''} onChange={(e) => updateItem(i, 'discount_value', e.target.value)}
                              className="w-12 px-1 py-1 border border-gray-200 rounded text-xs text-center" placeholder="0" />
                            <select value={item.discount_type || '%'} onChange={(e) => updateItem(i, 'discount_type', e.target.value)}
                              className="px-1 py-1 border border-gray-200 rounded text-[10px] bg-gray-50">
                              <option value="%">%</option>
                              <option value="$">$</option>
                            </select>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs font-semibold">{lineTotal > 0 ? formatCurrency(lineTotal) : '—'}</td>
                        <td className="px-2 py-1.5 text-center">
                          <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600 font-bold">&times;</button>
                        </td>
                      </tr>
                    );
                  })}
                  {form.items.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400 text-sm">Click "Add Item" below or search for a product to start.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <button onClick={addItem}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 mb-4">
            <Plus size={14} /> Add Item</button>

          {/* Notes */}
          <div className="mb-4 max-w-md">
            <label className="text-xs font-semibold text-gray-500 uppercase">Notes</label>
            <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Additional notes or instructions..." className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1" />
          </div>

          {/* Totals */}
          <div className="flex justify-end gap-4 mb-4">
            {form.items.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-3 w-72">
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Gross Amount</span><span className="font-medium">{formatCurrency(totals.gross)}</span></div>
                  {totals.lineDiscount > 0 && <div className="flex justify-between"><span className="text-gray-500">Line Discounts</span><span className="font-medium text-red-600">-{formatCurrency(totals.lineDiscount)}</span></div>}
                  <div className="flex justify-between"><span className="text-gray-500">Net Subtotal</span><span className="font-medium">{formatCurrency(totals.net)}</span></div>
                  {vatMode === 'VAT Inclusive' && <>
                    <div className="flex justify-between"><span className="text-gray-500">VATable Purchases</span><span className="font-medium">{formatCurrency(vatableAmount)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Input VAT (12%)</span><span className="font-medium text-blue-600">{formatCurrency(vatAmount)}</span></div>
                  </>}
                  {vatMode === 'VAT Exclusive' && (
                    <div className="flex justify-between"><span className="text-gray-500">VAT (12%)</span><span className="font-medium text-blue-600">{formatCurrency(vatAmount)}</span></div>
                  )}
                  {vatMode === 'VAT Exempt' && (
                    <div className="flex justify-between"><span className="text-gray-500 text-green-600">VAT Exempt</span><span className="font-medium text-green-600">₱0.00</span></div>
                  )}
                  {vatMode === 'Zero Rated' && (
                    <div className="flex justify-between"><span className="text-gray-500 text-blue-600">Zero Rated</span><span className="font-medium text-blue-600">₱0.00</span></div>
                  )}
                  <div className="flex justify-between border-t border-gray-200 pt-2"><span className="font-bold text-gray-700">Total Amount</span><span className="font-bold text-lg text-gray-900">{formatCurrency(grandTotal)}</span></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Attachments */}
        <AttachmentPanel referenceType="PurchaseOrder" referenceId={editingPO?.id || currentPOId || ''} />

        {/* Footer */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">{totals.itemCount} items · {form.items.reduce((s: number, i: any) => s + (parseFloat(String(i.quantity)) || 0), 0)} total qty · Net: {formatCurrency(grandTotal)}</div>
          <div className="flex items-center gap-4">
            <button onClick={() => { setCreating(false); resetForm(); }} className="px-6 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100">Cancel</button>
            <button onClick={createPO} disabled={form.items.length === 0} className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{editingPO ? 'Update PO' : 'Create PO'} (F8)</button>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> New PO</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>PO #</th><th>Supplier</th><th>Date</th><th>Total</th><th>Status</th><th>Items</th><th>Actions</th></tr></thead>
          <tbody>
            {orders.map((po) => (
              <tr key={po.id}>
                <td className="font-mono text-xs">{po.po_number}</td>
                <td>
                  {po.supplier_id ? (
                    <button onClick={() => window.location.href = `/purchases?supplier=${po.supplier_id}`} className="text-blue-600 hover:underline">
                      {po.supplier_name || 'N/A'}
                    </button>
                  ) : (po.supplier_name || 'N/A')}
                </td>
                <td className="text-xs">{new Date(po.order_date).toLocaleDateString()}</td>
                <td>{formatCurrency(po.total)}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${po.status === 'Received' ? 'bg-green-100 text-green-700' : po.status === 'Sent' ? 'bg-blue-100 text-blue-700' : po.status === 'Draft' ? 'bg-gray-100 text-gray-700' : po.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{po.status}</span></td>
                <td>{po.item_count}</td>
                <td>
                  <div className="flex gap-1">
                    {po.status === 'Draft' && <button onClick={() => openEditPO(po.id)} className="p-1.5 hover:bg-yellow-50 rounded text-yellow-600" title="Edit"><Edit2 size={15} /></button>}
                    {po.status === 'Draft' && <button onClick={() => sendPO(po.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Send size={15} /></button>}
                    {(po.status === 'Sent' || po.status === 'Partial') && <button onClick={() => openReceive(po)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Receive</button>}
                    <button onClick={() => viewPO(po.id)} className="p-1.5 hover:bg-gray-50 rounded"><Eye size={15} /></button>
                    <button onClick={() => { const token = localStorage.getItem('token'); window.open(`/api/purchases/orders/${po.id}/print?token=${token}`, '_blank'); }} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Print"><Printer size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
      </div>

      {/* Receive Stock Modal */}
      {showReceive && (
        <div className="modal-overlay" onClick={() => setShowReceive(false)}>
          <div className="modal-content max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Receive Stock - {selectedPO?.po_number}</h2>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Location</label>
                  <select value={receiveForm.location_id} onChange={(e) => setReceiveForm({ ...receiveForm, location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value={1}>Main Store</option>
                    <option value={2}>Main Warehouse</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Supplier Invoice #</label>
                  <input type="text" value={receiveForm.supplier_invoice_number || ''}
                    onChange={(e) => setReceiveForm({ ...receiveForm, supplier_invoice_number: e.target.value })}
                    placeholder="Supplier's SI/DR number"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              {receiveForm.items.map((item: any, i: number) => (
                <div key={i} className="border rounded-lg p-3 mb-2">
                  <p className="font-medium text-sm mb-2">{item.product_name}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500">Quantity to Receive</label>
                      <input type="number" value={item.quantity} onChange={(e) => { const items = [...receiveForm.items]; items[i].quantity = e.target.value; setReceiveForm({ ...receiveForm, items }); }}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Unit Cost</label>
                      <input type="number" step="0.01" value={item.unit_cost} onChange={(e) => { const items = [...receiveForm.items]; items[i].unit_cost = e.target.value; setReceiveForm({ ...receiveForm, items }); }}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Batch Number</label>
                      <input type="text" value={item.batch_number} onChange={(e) => { const items = [...receiveForm.items]; items[i].batch_number = e.target.value; setReceiveForm({ ...receiveForm, items }); }}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500">Expiry Date</label>
                      <input type="date" value={item.expiry_date} onChange={(e) => { const items = [...receiveForm.items]; items[i].expiry_date = e.target.value; setReceiveForm({ ...receiveForm, items }); }}
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex justify-end gap-3 mt-4">
                <button onClick={() => setShowReceive(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={receiveStock} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Receive Stock</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View PO Modal */}
      {showView && viewedPO && (
        <div className="modal-overlay" onClick={() => setShowView(false)}>
          <div className="modal-content max-w-3xl max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Purchase Order: {viewedPO.po_number}</h2>

              <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
                <div><span className="text-xs text-gray-500">Supplier</span><p className="font-medium">{viewedPO.supplier_name || 'N/A'}</p></div>
                <div><span className="text-xs text-gray-500">Order Date</span><p className="font-medium">{new Date(viewedPO.order_date).toLocaleDateString()}</p></div>
                <div><span className="text-xs text-gray-500">Expected</span><p className="font-medium">{viewedPO.expected_date ? new Date(viewedPO.expected_date).toLocaleDateString() : '—'}</p></div>
                <div><span className="text-xs text-gray-500">Status</span><p><span className={`px-2 py-0.5 text-xs rounded-full ${viewedPO.status === 'Received' ? 'bg-green-100 text-green-700' : viewedPO.status === 'Sent' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{viewedPO.status}</span></p></div>
                <div><span className="text-xs text-gray-500">Payment Terms</span><p className="font-medium">{viewedPO.payment_terms || '—'}</p></div>
                <div><span className="text-xs text-gray-500">Notes</span><p className="font-medium">{viewedPO.notes || '—'}</p></div>
              </div>

              <div className="overflow-hidden rounded-lg border mb-4">
                <table className="data-table text-xs">
                  <thead>
                    <tr>
                      <th>#</th><th>Product</th><th>Qty</th><th>Unit Cost</th>
                      <th>Disc</th><th>Net Cost</th><th>Net Total</th><th>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(viewedPO.items || []).map((item: any, i: number) => {
                      const discShow = parseFloat(item.discount_amount || '0') > 0
                        ? `${item.discount_type === '$' ? '₱' : ''}${parseFloat(item.discount_value || '0')}${item.discount_type === '%' ? '%' : ''}`
                        : '—';
                      return (
                        <tr key={i}>
                          <td className="text-gray-400">{i + 1}</td>
                          <td className="font-medium">{item.product_name || item.sku}</td>
                          <td>{parseFloat(item.quantity)}</td>
                          <td>{formatCurrency(parseFloat(item.unit_cost))}</td>
                          <td className="text-red-600">{discShow}</td>
                          <td>{formatCurrency(parseFloat(item.net_unit_cost || item.unit_cost))}</td>
                          <td className="font-semibold">{formatCurrency(parseFloat(item.net_total || item.total_cost))}</td>
                          <td>{parseFloat(item.received_quantity || '0')} / {parseFloat(item.quantity)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end">
                <div className="bg-gray-50 border rounded-lg p-3 w-64 space-y-1 text-sm">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(parseFloat(viewedPO.subtotal))}</span></div>
                  {parseFloat(viewedPO.discount || '0') > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>-{formatCurrency(parseFloat(viewedPO.discount))}</span></div>}
                  <div className="flex justify-between"><span>VAT</span><span>{formatCurrency(parseFloat(viewedPO.tax))}</span></div>
                  <div className="flex justify-between border-t pt-1 font-bold text-lg"><span>Total</span><span>{formatCurrency(parseFloat(viewedPO.total))}</span></div>
                </div>
              </div>

              <div className="flex justify-end mt-4">
                <button onClick={() => setShowView(false)} className="px-4 py-2 border rounded-lg text-sm">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
