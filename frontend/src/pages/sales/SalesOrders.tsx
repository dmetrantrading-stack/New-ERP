import React, { useState, useEffect, useRef, useMemo } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, Eye, Edit2, CheckCircle, XCircle, Archive, ArrowLeft, Printer, Paperclip, Download, X, Search, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import Pagination from '../../components/Pagination';
import AttachmentPanel from '../../components/AttachmentPanel';
import CopyToMenu from '../../components/CopyToMenu';
import {
  fetchSqCopyToOrder,
  buildOrderFormFromSqCopy,
  buildSelectedCustomerFromSqCopy,
  ensureProductsLoaded,
  mergeProductsFromCopyItems,
} from '../../lib/salesCopy';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../store/auth';
import { computeSalesDocLine, computeSalesDocTotals } from '../../lib/invoiceTax';
import { printDocument } from '../../lib/printDocument';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Confirmed: 'bg-green-100 text-green-700',
  Open: 'bg-blue-100 text-blue-700',
  'Partially Delivered': 'bg-yellow-100 text-yellow-700',
  'Fully Delivered': 'bg-green-100 text-green-700',
  Invoiced: 'bg-purple-100 text-purple-700',
  Closed: 'bg-gray-100 text-gray-500',
  Cancelled: 'bg-red-100 text-red-700',
};

const PRIMARY = '#1E40AF';

export default function SalesOrders() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [viewSo, setViewSo] = useState<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [form, setForm] = useState<any>({ customer_id: '', order_date: new Date().toISOString().split('T')[0], delivery_address: '', payment_terms: '', notes: '', terms_conditions: '', sq_id: '', sq_number: '', items: [] });
  const [loading, setLoading] = useState(false);
  const [autoFocusItem, setAutoFocusItem] = useState(false);
  const [activeTab, setActiveTab] = useState<'notes' | 'terms' | 'attachments'>('notes');
  const [attachModal, setAttachModal] = useState<{ open: boolean; so: any; files: any[] }>({ open: false, so: null, files: [] });
  const [editingMeta, setEditingMeta] = useState<{ so_number?: string; status?: string }>({});
  const [search, setSearch] = useState('');

  const loadOrders = () => {
    api.get(`/sales-orders?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}`)
      .then(r => { setOrders(r.data.data || []); setTotal(r.data.total || 0); }).catch(() => {});
  };

  useEffect(() => { loadOrders(); }, [page, statusFilter]);
  useEffect(() => { api.get('/customers?limit=200').then(r => setCustomers(r.data?.data || r.data || [])).catch(() => {}); }, []);
  useEffect(() => { api.get('/products?limit=200').then(r => setProducts(r.data?.data || r.data || [])).catch(() => {}); }, []);

  const applySqCopyPayload = (payload: any) => {
    setSelectedCustomer(buildSelectedCustomerFromSqCopy(payload, customers));
    const mappedItems = buildOrderFormFromSqCopy(payload).items;
    mergeProductsFromCopyItems(mappedItems, setProducts);
    ensureProductsLoaded(mappedItems.map((i: any) => i.product_id).filter(Boolean), setProducts);
    setEditingId(null);
    setEditingMeta({});
    setActiveTab('notes');
    setForm(buildOrderFormFromSqCopy(payload));
    setCreating(true);
  };

  useEffect(() => {
    if (!form.sq_id || !form.customer_id || customers.length === 0) return;
    const c = customers.find((x: any) => String(x.id) === String(form.customer_id));
    if (c) setSelectedCustomer(c);
  }, [customers, form.sq_id, form.customer_id]);

  useEffect(() => {
    const sqId = searchParams.get('copy_from_sq');
    if (!sqId) return;
    const copyKey = `sq:${sqId}`;
    if (!beginCopyNavigation(copyKey)) return;
    setSearchParams({}, { replace: true });
    fetchSqCopyToOrder(sqId)
      .then((data) => {
        applySqCopyPayload(data);
        toast.success(`Copied from ${data.source_sq_number} — review and save`);
      })
      .catch((err: any) => toast.error(err.response?.data?.error || 'Failed to copy quotation'))
      .finally(() => endCopyNavigation(copyKey));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const searchProducts = async (query: string) => {
    try { const r = await api.get(`/products/search/quick?q=${encodeURIComponent(query)}`); return r.data || []; } catch { return []; }
  };

  const getPrice = (p: any) => {
    const ct = selectedCustomer?.customer_type || 'Retail';
    if (ct === 'Wholesale') return parseFloat(p.wholesale_price || 0);
    if (ct === 'Distributor') return parseFloat(p.distributor_price || 0);
    return parseFloat(p.retail_price || p.price || p.cost || 0);
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { product_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, tax_type: 'VAT', vat_amount: 0 }] });

  const recalcItem = (item: any) => {
    const calc = computeSalesDocLine(item);
    return { ...item, vat_amount: calc.vat_amount };
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const items = [...form.items];
    items[idx] = recalcItem({ ...items[idx], [field]: value });
    setForm({ ...form, items });
  };

  const removeItem = (idx: number) => setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== idx) });

  const taxTotals = useMemo(() => computeSalesDocTotals(form.items), [form.items]);
  const subtotal = taxTotals.lineFinalTotal;
  const totalVat = taxTotals.totalVat;

  const openCreate = () => {
    setEditingId(null);
    setEditingMeta({});
    setSelectedCustomer(null);
    setActiveTab('notes');
    setForm({ customer_id: '', order_date: new Date().toISOString().split('T')[0], delivery_address: '', payment_terms: '', notes: '', terms_conditions: '', sq_id: '', sq_number: '', items: [] });
    setCreating(true);
  };

  const selectCustomer = (cid: string) => {
    if (!cid) { setSelectedCustomer(null); return; }
    const c = customers.find((x: any) => x.id == cid);
    if (!c) return;
    setSelectedCustomer(c);
    setForm((prev: any) => {
      const next = { ...prev, customer_id: cid, delivery_address: c.address || '', payment_terms: c.payment_terms || '' };
      if (prev.items.length === 0) {
        next.items = [{ product_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, tax_type: 'VAT', vat_amount: 0 }];
        setAutoFocusItem(true);
      }
      return next;
    });
  };

  const openEdit = async (id: string) => {
    try {
      const r = await api.get(`/sales-orders/${id}`);
      const so = r.data;
      setEditingId(id);
      setEditingMeta({ so_number: so.so_number, status: so.status });
      const c = customers.find((x: any) => x.id == so.customer_id);
      if (c) setSelectedCustomer(c);
      setActiveTab('notes');
      setForm({
        customer_id: so.customer_id, order_date: so.order_date || new Date().toISOString().split('T')[0],
        delivery_address: so.delivery_address || c?.address || '',
        payment_terms: so.payment_terms || c?.payment_terms || '', notes: so.notes || '', terms_conditions: so.terms_conditions || '',
        sq_id: so.sq_id || '', sq_number: so.sq_number || '',
        items: (so.items || []).map((i: any) => ({
          product_id: i.product_id, description: i.description || '', quantity: i.ordered_qty,
          unit_price: i.unit_price, discount: i.discount || 0, tax_type: i.tax_type || 'VAT', vat_amount: i.vat_amount || 0,
          uom: i.unit_of_measure || 'pc',
        }))
      });
      setCreating(true);
    } catch { toast.error('Failed to load order'); }
  };

  const save = async () => {
    if (!form.customer_id || !form.items.length) { toast.error('Customer and at least one item required'); return; }
    setLoading(true);
    try {
      if (editingId) {
        await api.put(`/sales-orders/${editingId}`, form);
        toast.success('Order updated');
        setCreating(false);
      } else {
        const res = await api.post('/sales-orders', form);
        toast.success(`Order ${res.data.so_number} created${res.data.sq_number ? ` (from ${res.data.sq_number})` : ''}`);
        await openEdit(res.data.id);
      }
      loadOrders();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
    finally { setLoading(false); }
  };

  const confirmOrder = async (id: string) => {
    try { await api.patch(`/sales-orders/${id}/confirm`); toast.success('Order confirmed'); loadOrders(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const cancelOrder = async (id: string) => {
    if (!confirm('Cancel this order?')) return;
    try { await api.patch(`/sales-orders/${id}/cancel`); toast.success('Cancelled'); loadOrders(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const closeOrder = async (id: string) => {
    try { await api.patch(`/sales-orders/${id}/close`); toast.success('Closed'); loadOrders(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const viewOrder = async (id: string) => {
    try { const r = await api.get(`/sales-orders/${id}`); setViewSo(r.data); setViewing(true); }
    catch { toast.error('Failed to load'); }
  };

  const openAttachments = async (so: any) => {
    try {
      const r = await api.get(`/attachments/list/SalesOrder/${so.id}`);
      setAttachModal({ open: true, so, files: r.data || [] });
    } catch { toast.error('Failed to load attachments'); }
  };

  // ========== FULL-PAGE VIEW (DOT-MATRIX PRINT LAYOUT) ==========
  if (viewing && viewSo) {
    const primary = '#1E40AF';
    const v = viewSo;
    const printDoc = () => { printDocument(`/api/sales-orders/${v.id}/print`); };
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Sales Order</h1>
            <span className="text-xs font-mono text-white/80">{v.so_number}</span>
            {v.sq_number && <span className="text-xs text-white/70">from {v.sq_number}</span>}
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-700'}`}>{v.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CopyToMenu sourceType="SO" docId={v.id} doc={v} hasPerm={hasPerm} onNavigate={() => setViewing(false)} />
            <button onClick={printDoc}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"><Printer size={13} /> Print</button>
            <button onClick={() => setViewing(false)}
              className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe ref={iframeRef} src={`/api/sales-orders/${v.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow"
            style={{ width: '800px', minHeight: '1100px' }}
            title="Order Preview" />
        </div>
      </div>
    );
  }

  // ========== FULL-PAGE CREATE/EDIT VIEW ==========
  if (creating) {
    const totalQty = form.items.reduce((s: number, i: any) => s + parseFloat(i.quantity || '0'), 0);
    const totalDisc = form.items.reduce((s: number, i: any) => s + parseFloat(i.discount || 0), 0);
    const primary = '#1E40AF';
    const docStatus = editingMeta.status || 'Draft';
    const previewSo = () => {
      if (!editingId) { toast.error('Save the order first to preview'); return; }
      window.open(`/api/sales-orders/${editingId}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`, '_blank');
    };

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setCreating(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Sales Order</h1>
            <span className="text-xs font-mono text-white/80">{editingMeta.so_number || (editingId ? `#${editingId.substring(0, 8)}` : 'NEW')}</span>
            {form.sq_number && <span className="text-xs text-white/70">from {form.sq_number}</span>}
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[docStatus] || 'bg-gray-200 text-gray-700'}`}>{docStatus}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {editingId && (
              <CopyToMenu sourceType="SO" docId={editingId} doc={{ id: editingId, status: docStatus }} hasPerm={hasPerm} />
            )}
            <button onClick={previewSo} className="px-3 py-1.5 bg-white/20 text-white rounded text-xs font-medium hover:bg-white/30 flex items-center gap-1"><Eye size={13} /> Preview</button>
            <button onClick={save} disabled={loading || !form.customer_id || form.items.length === 0}
              className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
              {editingId ? 'Update' : 'Save Order'}
            </button>
            <button onClick={() => setCreating(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Customer Information</div>
                <select value={form.customer_id} onChange={e => selectCustomer(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs">
                  <option value="">Select Customer</option>
                  {customers.map((c: any) => <option key={c.id} value={c.id}>{c.customer_name}</option>)}
                </select>
                {selectedCustomer && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-500">
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Code</span><span className="font-mono text-gray-700">{selectedCustomer.customer_code || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">TIN</span><span className="text-gray-700">{selectedCustomer.tin || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-400 block">Address</span><span className="text-gray-600">{selectedCustomer.address || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Contact</span><span className="text-gray-700">{selectedCustomer.phone || '—'}</span></div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Terms</span><span className="text-gray-700">{form.payment_terms || selectedCustomer.payment_terms || '—'}</span></div>
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Order Details</div>
                {form.sq_number && (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Quotation Ref</label>
                    <input type="text" value={form.sq_number} readOnly className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs bg-blue-50 font-mono text-blue-700 mt-0.5" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Order Date</label>
                    <input type="date" value={form.order_date} onChange={e => setForm({ ...form, order_date: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Payment Terms</label>
                    <input type="text" value={form.payment_terms} onChange={e => setForm({ ...form, payment_terms: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" placeholder="e.g. 30 Days" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Delivery Address</label>
                  <input type="text" value={form.delivery_address} onChange={e => setForm({ ...form, delivery_address: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" placeholder="Delivery address..." />
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 280 }}>
              <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                <span className="text-[10px] font-semibold text-gray-500 uppercase">3 · Line Items ({form.items.length})</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">Qty: {totalQty}</span>
                  <button onClick={addItem}
                    className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded border border-blue-200 text-blue-600 bg-blue-50 hover:bg-blue-100"><Plus size={12} /> Add Item</button>
                </div>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-2 py-1.5 text-left w-8">#</th>
                      <th className="px-2 py-1.5 text-left w-20">SKU</th>
                      <th className="px-2 py-1.5 text-left" style={{ minWidth: 160 }}>Item Name</th>
                      <th className="px-2 py-1.5 text-left" style={{ minWidth: 140 }}>Description</th>
                      <th className="px-2 py-1.5 text-center w-12">UOM</th>
                      <th className="px-2 py-1.5 text-center w-16">Qty</th>
                      <th className="px-2 py-1.5 text-right w-20">Price</th>
                      <th className="px-2 py-1.5 text-center w-14">Disc</th>
                      <th className="px-2 py-1.5 text-center w-20">Tax</th>
                      <th className="px-2 py-1.5 text-right w-24">Total</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {form.items.length === 0 && (
                      <tr><td colSpan={11} className="px-4 py-16 text-center text-gray-300 text-xs">Select a customer, then click Add Item</td></tr>
                    )}
                    {form.items.map((item: any, idx: number) => {
                      const prod = products.find((p: any) => p.id == item.product_id);
                      const lineTotal = parseFloat(item.quantity) * parseFloat(item.unit_price) - parseFloat(item.discount || 0);
                      return (
                        <tr key={idx} className="hover:bg-blue-50/20">
                          <td className="px-2 py-1.5 text-gray-400 text-[10px]">{idx + 1}</td>
                          <td className="px-2 py-1.5 text-[10px] font-mono text-gray-500">{prod?.sku || item.sku || '—'}</td>
                          <td className="px-1 py-1">
                            <ProductAutocomplete
                              products={products}
                              value={item.product_id}
                              selectedName={prod?.name || item.product_name || ''}
                              placeholder="Search product..."
                              getPrice={(p: any) => getPrice(p)}
                              searchFn={searchProducts}
                              autoFocus={autoFocusItem && idx === 0}
                              onSelect={(p: any) => {
                                if (!products.find((x: any) => x.id === p.id)) setProducts((prev: any) => [...prev, p]);
                                const price = getPrice(p);
                                setForm((prev: any) => {
                                  const items = [...prev.items];
                                  items[idx] = recalcItem({
                                    ...items[idx],
                                    product_id: p.id,
                                    product_name: p.name || '',
                                    description: items[idx].description || '',
                                    unit_price: price,
                                    tax_type: p.tax_type || 'VAT',
                                    uom: p.unit_of_measure || '',
                                  });
                                  if (idx === prev.items.length - 1) {
                                    setTimeout(() => setForm((p2: any) => ({ ...p2, items: [...p2.items, { product_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, tax_type: 'VAT', vat_amount: 0 }] })), 100);
                                  }
                                  return { ...prev, items };
                                });
                                setAutoFocusItem(false);
                              }}
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input type="text" value={item.description || ''} onChange={e => updateItem(idx, 'description', e.target.value)}
                              className="w-full px-1.5 py-1 text-xs border border-gray-200 rounded" placeholder="Line description..." />
                          </td>
                          <td className="px-2 py-1.5 text-center text-[10px] text-gray-500">{item.uom || prod?.unit_of_measure || '—'}</td>
                          <td className="px-1 py-1">
                            <input type="number" step="0.01" min="0.01" value={item.quantity} onChange={e => updateItem(idx, 'quantity', e.target.value)}
                              className="w-full px-1.5 py-1 text-xs text-center border border-gray-200 rounded" />
                          </td>
                          <td className="px-1 py-1">
                            <input type="number" step="0.01" value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)}
                              className="w-full px-1.5 py-1 text-xs text-right border border-gray-200 rounded" />
                          </td>
                          <td className="px-1 py-1">
                            <input type="number" step="0.01" min="0" value={item.discount} onChange={e => updateItem(idx, 'discount', e.target.value)}
                              className="w-full px-1.5 py-1 text-xs text-center border border-gray-200 rounded" />
                          </td>
                          <td className="px-1 py-1">
                            <select value={item.tax_type} onChange={e => updateItem(idx, 'tax_type', e.target.value)}
                              className="w-full px-1 py-1 text-[10px] border border-gray-200 rounded">
                              <option value="VAT">VAT</option>
                              <option value="VAT Exempt">Exempt</option>
                              <option value="Zero Rated">Zero</option>
                              <option value="LGU 5% Final VAT">LGU 5%</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-semibold">{formatCurrency(lineTotal)}</td>
                          <td className="px-1 py-1 text-center">
                            <button onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-500 text-sm leading-none">&times;</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">4 · Notes &amp; Terms</div>
              <div className="flex gap-4 border-b border-gray-200 pb-2 mb-3">
                {(['notes', 'terms', 'attachments'] as const).map((tab) => (
                  <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                    className={`pb-2 -mb-2 text-xs font-semibold capitalize ${activeTab === tab ? 'text-blue-700 border-b-2 border-blue-700' : 'text-gray-400 hover:text-gray-600'}`}>
                    {tab === 'terms' ? 'Terms & Conditions' : tab}
                  </button>
                ))}
              </div>
              {activeTab === 'notes' && (
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={4}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs resize-none" placeholder="Order notes, remarks, or special instructions..." />
              )}
              {activeTab === 'terms' && (
                <textarea value={form.terms_conditions} onChange={e => setForm({ ...form, terms_conditions: e.target.value })} rows={4}
                  className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs resize-none" placeholder="Terms and conditions..." />
              )}
              {activeTab === 'attachments' && (
                <AttachmentPanel referenceType="SalesOrder" referenceId={editingId || ''} />
              )}
            </div>
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Sales Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1"><span className="text-gray-500">Items</span><span className="font-medium">{form.items.length}</span></div>
                <div className="flex justify-between py-1"><span className="text-gray-500">Total Qty</span><span className="font-medium">{totalQty}</span></div>
                <div className="flex justify-between py-1 border-t border-gray-100"><span className="text-gray-500">Subtotal</span><span className="font-medium">{formatCurrency(subtotal)}</span></div>
                <div className="flex justify-between py-1"><span className="text-gray-500">Discount</span><span className="font-medium text-orange-600">{totalDisc > 0 ? `(${formatCurrency(totalDisc)})` : '₱0.00'}</span></div>
                <div className="flex justify-between py-1"><span className="text-gray-500">VATable Sales</span><span className="font-medium">{formatCurrency(taxTotals.totalVatableSales)}</span></div>
                {taxTotals.totalVatExemptSales > 0 && (
                  <div className="flex justify-between py-1"><span className="text-gray-500">VAT Exempt</span><span className="font-medium">{formatCurrency(taxTotals.totalVatExemptSales)}</span></div>
                )}
                {taxTotals.totalZeroRatedSales > 0 && (
                  <div className="flex justify-between py-1"><span className="text-gray-500">Zero Rated</span><span className="font-medium">{formatCurrency(taxTotals.totalZeroRatedSales)}</span></div>
                )}
                <div className="flex justify-between py-1"><span className="text-gray-500">VAT Amount</span><span className="font-medium">{formatCurrency(totalVat)}</span></div>
                <div className="flex justify-between pt-2 mt-1 border-t-2 border-blue-900 text-sm font-bold text-blue-900">
                  <span>Grand Total</span>
                  <span>{formatCurrency(subtotal)}</span>
                </div>
              </div>
            </div>

            {form.sq_number && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs">
                <div className="text-[10px] font-semibold text-blue-700 uppercase mb-1">From Quotation</div>
                <div className="text-blue-900 font-mono font-medium">{form.sq_number}</div>
              </div>
            )}

            {selectedCustomer && (
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs">
                <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Bill To</div>
                <div className="font-medium text-gray-800">{selectedCustomer.customer_name}</div>
                <div className="text-gray-500 mt-1">{selectedCustomer.address || '—'}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return o.so_number?.toLowerCase().includes(s)
      || o.sq_number?.toLowerCase().includes(s)
      || o.customer_name?.toLowerCase().includes(s);
  });
  const draftCount = orders.filter((o) => o.status === 'Draft').length;
  const openDelivery = orders.filter((o) => ['Open', 'Partially Delivered'].includes(o.status)).length;
  const readyToClose = orders.filter((o) => o.status === 'Fully Delivered').length;

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Sales Orders</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{total} records</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-2 py-1 rounded text-xs bg-white/20 text-white border border-white/30 outline-none">
            <option value="" className="text-gray-900">All Status</option>
            <option value="Draft" className="text-gray-900">Draft</option>
            <option value="Open" className="text-gray-900">Open</option>
            <option value="Partially Delivered" className="text-gray-900">Partially Delivered</option>
            <option value="Fully Delivered" className="text-gray-900">Fully Delivered</option>
            <option value="Invoiced" className="text-gray-900">Invoiced</option>
            <option value="Closed" className="text-gray-900">Closed</option>
            <option value="Cancelled" className="text-gray-900">Cancelled</option>
          </select>
          {hasPerm('sales.sales-order.create') && (
            <button onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">
              <Plus size={14} /> New Order
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SO #, SQ ref, customer…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Order History</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">SO #</th>
                  <th className="px-3 py-2 text-left">SQ Ref</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-center">Ordered</th>
                  <th className="px-3 py-2 text-center">Delivered</th>
                  <th className="px-3 py-2 text-center">Remaining</th>
                  <th className="px-3 py-2 text-center">Status</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-center">Files</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-10 text-center text-gray-400">No orders found</td></tr>
                )}
                {filtered.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono font-medium text-blue-700 cursor-pointer hover:underline" onClick={() => viewOrder(o.id)}>{o.so_number}</td>
                    <td className="px-3 py-2 font-mono text-gray-600">{o.sq_number || '—'}</td>
                    <td className="px-3 py-2">{formatDate(o.order_date)}</td>
                    <td className="px-3 py-2 font-medium">{o.customer_name}</td>
                    <td className="px-3 py-2 text-center">{parseFloat(o.total_ordered_qty || 0)}</td>
                    <td className="px-3 py-2 text-center">{parseFloat(o.total_delivered_qty || 0)}</td>
                    <td className="px-3 py-2 text-center">{parseFloat(o.total_remaining_qty || 0)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] ${STATUS_COLORS[o.status] || 'bg-gray-100 text-gray-700'}`}>{o.status}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(o.total)}</td>
                    <td className="px-3 py-2 text-center">
                      <button onClick={() => openAttachments(o)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="Attachments"><Paperclip size={14} /></button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {o.status === 'Draft' && hasPerm('sales.sales-order.edit') && (
                          <button onClick={() => openEdit(o.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="Edit"><Edit2 size={14} /></button>
                        )}
                        {o.status === 'Draft' && hasPerm('sales.sales-order.approve') && (
                          <button onClick={() => confirmOrder(o.id)} className="p-1 hover:bg-green-50 rounded text-green-600" title="Confirm"><CheckCircle size={14} /></button>
                        )}
                        {o.status === 'Fully Delivered' && hasPerm('sales.sales-order.edit') && (
                          <button onClick={() => closeOrder(o.id)} className="p-1 hover:bg-gray-100 rounded text-gray-600" title="Close"><Archive size={14} /></button>
                        )}
                        {o.status !== 'Draft' && o.status !== 'Cancelled' && (
                          <button onClick={() => viewOrder(o.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="View"><Eye size={14} /></button>
                        )}
                        <CopyToMenu sourceType="SO" docId={o.id} doc={o} hasPerm={hasPerm} variant="list" />
                        <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/sales-orders/${o.id}/print?token=${t}`, '_blank'); }}
                          className="p-1 hover:bg-green-50 rounded text-green-600" title="Print"><Printer size={14} /></button>
                        {!['Cancelled', 'Closed'].includes(o.status) && hasPerm('sales.sales-order.edit') && (
                          <button onClick={() => cancelOrder(o.id)} className="p-1 hover:bg-red-50 rounded text-red-600" title="Cancel"><XCircle size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={Math.ceil(total / 20)} total={total} limit={20} onPageChange={setPage} />
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Draft Orders</div>
            <p className="text-2xl font-bold text-blue-900">{draftCount}</p>
            <p className="text-xs text-gray-500 mt-1">Awaiting confirmation</p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Open for Delivery</div>
            <p className="text-2xl font-bold text-amber-700">{openDelivery}</p>
            <p className="text-xs text-gray-500 mt-1">Open or partially delivered</p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Fully Delivered</div>
            <p className="text-2xl font-bold text-green-700">{readyToClose}</p>
            <p className="text-xs text-gray-500 mt-1">Ready to close or invoice</p>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800 leading-relaxed">
            Workflow: Confirm order → Create Delivery Receipt → Copy to Sales Invoice.
          </div>
        </div>
      </div>

      {/* Attachment Modal */}
      {attachModal.open && attachModal.so && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-sm">Attachments — {attachModal.so.so_number}</h3>
              <button onClick={() => setAttachModal({ open: false, so: null, files: [] })} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {attachModal.files.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No attachments.</p>
              ) : attachModal.files.map((f: any) => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100">
                  <Paperclip size={16} className="text-gray-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{f.original_name}</p>
                    <p className="text-[10px] text-gray-400">{f.file_size ? `${(f.file_size / 1024).toFixed(1)} KB` : ''} · {f.created_at ? new Date(f.created_at).toLocaleDateString('en-PH') : ''}</p>
                  </div>
                  <button onClick={() => window.open(`/api/attachments/preview/${f.id}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`, '_blank')}
                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">View</button>
                  <button onClick={() => window.open(`/api/attachments/download/${f.id}?token=${encodeURIComponent(localStorage.getItem('token') || '')}`, '_blank')}
                    className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300"><Download size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
