import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, Eye, Send, ArrowLeft, Edit2, Printer, Package, FileText } from 'lucide-react';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { navigateReceiveFromPo, navigateApvFromPo, fetchPrCopyToPo, buildPoFormFromPrCopy, fetchSupplierCatalogCopyToPo, buildPoFormFromSupplierCatalog } from '../../lib/purchaseCopy';
import { printDocument } from '../../lib/printDocument';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';
import { calculatePurchaseTax, lineTaxTypeFromProduct, normalizePurchaseCostBasis, PURCHASE_TAX_TYPE_OPTIONS } from '../../lib/purchaseTax';

const PRIMARY = '#1E40AF';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Sent: 'bg-blue-100 text-blue-700',
  Partial: 'bg-yellow-100 text-yellow-700',
  Received: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
};

export default function PurchaseOrders() {
  const { hasPerm } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const supplierFilter = searchParams.get('supplier');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewedPO, setViewedPO] = useState<any>(null);
  const [editingPO, setEditingPO] = useState<any>(null);
  const [currentPOId, setCurrentPOId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({
    supplier_id: supplierFilter || '', expected_date: new Date().toISOString().split('T')[0],
    notes: '', terms_conditions: '', items: [], vat_mode: 'VAT Inclusive', payment_terms: '', pr_id: '', pr_number: '',
  });
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [pendingReceiveTotal, setPendingReceiveTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [autoFocusItem, setAutoFocusItem] = useState(false);
  const limit = 20;

  const loadPendingReceiveTotal = () => {
    Promise.all([
      api.get('/purchases/orders?limit=1&status=Sent'),
      api.get('/purchases/orders?limit=1&status=Partial'),
    ]).then(([sent, partial]) => {
      setPendingReceiveTotal((sent.data.total || 0) + (partial.data.total || 0));
    }).catch(() => {});
  };

  const loadOrders = () => {
    let url = `/purchases/orders?page=${page}&limit=${limit}`;
    if (supplierFilter) url += `&supplier_id=${supplierFilter}`;
    if (statusFilter) url += `&status=${statusFilter}`;
    api.get(url)
      .then((res) => { setOrders(res.data.data || []); setTotal(res.data.total || 0); })
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
    loadPendingReceiveTotal();
    api.get('/products?limit=500').then((res) => setProducts(res.data.data || [])).catch(() => {});
    api.get('/suppliers').then((res) => setSuppliers(res.data.data || [])).catch(() => {});
    api.get('/inventory/locations').then((r) => setLocations(r.data || [])).catch(() => {
      setLocations([{ id: 1, name: 'Store' }, { id: 2, name: 'Warehouse' }]);
    });
  }, [page, supplierFilter, statusFilter]);

  useEffect(() => {
    if (supplierFilter && suppliers.length) selectSupplier(supplierFilter);
  }, [supplierFilter, suppliers]);

  useEffect(() => {
    const sid = form.supplier_id;
    if (!sid || !suppliers.length) return;
    if (String(selectedSupplier?.id) === String(sid)) return;
    selectSupplier(String(sid));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.supplier_id, suppliers]);

  useEffect(() => {
    const prId = searchParams.get('copy_from_pr');
    if (!prId) return;
    const copyKey = `pr:${prId}`;
    if (!beginCopyNavigation(copyKey)) return;
    setSearchParams({}, { replace: true });
    fetchPrCopyToPo(prId)
      .then((payload) => {
        const built = buildPoFormFromPrCopy(payload);
        setForm((prev: any) => ({ ...prev, ...built }));
        setCreating(true);
        setAutoFocusItem(true);
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load requisition'))
      .finally(() => endCopyNavigation(copyKey));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const supplierId = searchParams.get('copy_from_supplier_catalog');
    const productIdsParam = searchParams.get('product_ids');
    if (!supplierId || !productIdsParam) return;
    const productIds = productIdsParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (productIds.length === 0) return;
    const copyKey = `supplier-catalog:${supplierId}:${productIds.join(',')}`;
    if (!beginCopyNavigation(copyKey)) return;
    setSearchParams({}, { replace: true });
    fetchSupplierCatalogCopyToPo(supplierId, productIds)
      .then((payload) => {
        const built = buildPoFormFromSupplierCatalog(payload);
        setForm((prev: any) => ({ ...prev, ...built }));
        if (built.supplier_id) selectSupplier(String(built.supplier_id));
        setCreating(true);
        setAutoFocusItem(true);
      })
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load supplier catalog'))
      .finally(() => endCopyNavigation(copyKey));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const searchProducts = async (q: string) => {
    try { const res = await api.get(`/products/search/quick?q=${encodeURIComponent(q)}`); return res.data; }
    catch { return []; }
  };

  const blankLineItem = () => ({
    product_id: '', location_id: locations[0]?.id || 1,
    quantity: 1, unit_cost: 0, unit_of_measure: '', available_qty: 0,
    discount_type: '%', discount_value: '0', tax_type: 'VAT',
  });

  const selectSupplier = (supplierId: string) => {
    if (!supplierId) {
      setSelectedSupplier(null);
      setAutoFocusItem(false);
      setForm((prev: any) => ({ ...prev, supplier_id: '', supplier_name: '' }));
      return;
    }
    const s = suppliers.find((x) => String(x.id) === supplierId);
    if (!s) return;
    setSelectedSupplier(s);
    setForm((prev: any) => {
      const next = {
        ...prev,
        supplier_id: s.id,
        supplier_name: s.supplier_name,
        payment_terms: prev.payment_terms || s.payment_terms || '',
      };
      if (prev.items.length === 0) {
        next.items = [blankLineItem()];
        setAutoFocusItem(true);
      }
      return next;
    });
  };

  const addItem = () => {
    setForm({
      ...form,
      items: [...form.items, {
        product_id: '', location_id: locations[0]?.id || 1,
        quantity: 1, unit_cost: 0, unit_of_measure: '', available_qty: 0,
        discount_type: '%', discount_value: '0', tax_type: 'VAT',
      }],
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
        items[index].unit_of_measure = product.unit_of_measure || 'pc';
        items[index].tax_type = lineTaxTypeFromProduct(product);
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

  const costBasis = normalizePurchaseCostBasis(form.vat_mode);
  const taxInputs = form.items.map((item: any) => {
    const qty = parseFloat(String(item.quantity)) || 0;
    const cost = parseFloat(String(item.unit_cost)) || 0;
    const gross = qty * cost;
    const discType = item.discount_type || '%';
    const discVal = parseFloat(String(item.discount_value)) || 0;
    const discAmt = discType === '%' ? gross * (discVal / 100) : discVal;
    return {
      qty,
      unit_cost: cost,
      discount_amount: discAmt,
      tax_type: item.tax_type || 'VAT',
    };
  });
  const taxTotals = calculatePurchaseTax(taxInputs, costBasis);

  const openEditPO = async (poId: string) => {
    try {
      const res = await api.get(`/purchases/orders/${poId}`);
      const po = res.data;
      setEditingPO(po);
      setForm({
        supplier_id: String(po.supplier_id || ''),
        expected_date: po.expected_date || new Date().toISOString().split('T')[0],
        notes: po.notes || '',
        terms_conditions: po.terms_conditions || '',
        vat_mode: normalizePurchaseCostBasis(po.vat_mode),
        payment_terms: po.payment_terms || '',
        items: (po.items || []).map((i: any) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
          discount_type: i.discount_type || '%',
          discount_value: i.discount_value || 0,
          tax_type: i.tax_type || 'VAT',
          location_id: i.location_id || locations[0]?.id || 1,
          unit_of_measure: i.unit_of_measure || 'pc',
          product_name: i.product_name,
          sku: i.sku,
          available_qty: 0,
        })),
      });
      const supplier = suppliers.find((s: any) => String(s.id) === String(po.supplier_id));
      if (supplier) setSelectedSupplier(supplier);
      setCreating(true);
    } catch { toast.error('Failed to load PO for editing'); }
  };

  const filledItems = () => form.items.filter((i: any) => i.product_id);

  const createPO = async () => {
    if (!form.supplier_id) { toast.error('Please select a supplier'); return; }
    const items = filledItems();
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    for (const item of items) {
      if (parseFloat(String(item.quantity)) <= 0) { toast.error('Quantity must be > 0'); return; }
    }
    setSaving(true);
    try {
      const payload: any = {
        supplier_id: form.supplier_id,
        expected_date: form.expected_date,
        notes: form.notes,
        terms_conditions: form.terms_conditions,
        vat_mode: costBasis,
        payment_terms: form.payment_terms,
        items: items.map((i: any) => ({
          product_id: i.product_id,
          quantity: parseFloat(String(i.quantity)),
          unit_cost: parseFloat(String(i.unit_cost)),
          discount_type: i.discount_type || '%',
          discount_value: parseFloat(String(i.discount_value)) || 0,
          tax_type: i.tax_type || 'VAT',
          location_id: i.location_id,
        })),
      };
      if (form.pr_id && !editingPO) payload.pr_id = form.pr_id;
      if (editingPO) {
        await api.put(`/purchases/orders/${editingPO.id}`, payload);
        toast.success('PO Updated');
        setCreating(false);
        resetForm();
      } else {
        const res = await api.post('/purchases/orders', payload);
        toast.success(`PO ${res.data.po_number} created`);
        setCurrentPOId(res.data.id);
        await openEditPO(res.data.id);
      }
      loadOrders();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
    finally { setSaving(false); }
  };

  const resetForm = () => {
    setAutoFocusItem(false);
    setForm({
      supplier_id: supplierFilter || '',
      expected_date: new Date().toISOString().split('T')[0],
      notes: '', terms_conditions: '', items: [], vat_mode: 'VAT Inclusive', payment_terms: '', pr_id: '', pr_number: '',
    });
    if (supplierFilter) selectSupplier(supplierFilter);
    else setSelectedSupplier(null);
    setEditingPO(null);
  };

  const openCreate = () => {
    resetForm();
    setEditingPO(null);
    setCurrentPOId(null);
    setCreating(true);
  };

  const sendPO = async (id: string) => {
    try { await api.patch(`/purchases/orders/${id}/send`); toast.success('PO Sent to supplier'); loadOrders(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const viewPO = async (poId: string) => {
    try {
      const res = await api.get(`/purchases/orders/${poId}`);
      setViewedPO(res.data);
      setViewing(true);
    } catch { toast.error('Failed to load PO details'); }
  };

  const openReceive = (po: any) => {
    navigateReceiveFromPo(navigate, po.id);
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

  const totalQty = form.items.reduce((s: number, i: any) => s + (parseFloat(String(i.quantity)) || 0), 0);

  // ========== VIEW ==========
  if (viewing && viewedPO) {
    const v = viewedPO;
    const printDoc = () => printDocument(`/api/purchases/orders/${v.id}/print`);
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Order</h1>
            <span className="text-xs font-mono text-white/80">{v.po_number}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[v.status] || 'bg-gray-100 text-gray-700'}`}>{v.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {(v.status === 'Sent' || v.status === 'Partial') && hasPerm('purchases.receiving-report.create') && (
              <button onClick={() => { setViewing(false); openReceive(v); }}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded text-xs font-bold hover:bg-green-600"><Package size={13} /> Receive</button>
            )}
            {['Sent', 'Partial', 'Received'].includes(v.status) && hasPerm('purchases.apv.create') && (
              <button onClick={() => { setViewing(false); navigateApvFromPo(navigate, v.id); }}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-bold hover:bg-amber-600"><FileText size={13} /> Copy to APV</button>
            )}
            <button onClick={printDoc} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"><Printer size={13} /> Print</button>
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe ref={iframeRef} src={`/api/purchases/orders/${v.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow" style={{ width: '800px', minHeight: '1100px' }} title="PO Preview" />
        </div>
      </div>
    );
  }

  // ========== CREATE / EDIT ==========
  if (creating) {
    const docStatus = editingPO?.status || 'Draft';
    const previewPo = () => {
      if (!editingPO?.id) { toast.error('Save the PO first to preview'); return; }
      window.open(`/api/purchases/orders/${editingPO.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`, '_blank');
    };

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => { setCreating(false); resetForm(); }} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Order</h1>
            <span className="text-xs font-mono text-white/80">{editingPO?.po_number || 'NEW'}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[docStatus] || 'bg-gray-200 text-gray-700'}`}>{docStatus}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {editingPO?.id && (
              <button onClick={previewPo} className="px-3 py-1.5 bg-white/20 text-white rounded text-xs font-medium hover:bg-white/30 flex items-center gap-1"><Eye size={13} /> Preview</button>
            )}
            {editingPO?.id && ['Sent', 'Partial', 'Received'].includes(docStatus) && hasPerm('purchases.apv.create') && (
              <button onClick={() => navigateApvFromPo(navigate, editingPO.id)}
                className="px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-bold hover:bg-amber-600 flex items-center gap-1"><FileText size={13} /> Copy to APV</button>
            )}
            <button onClick={createPO} disabled={saving || !form.supplier_id || filledItems().length === 0}
              className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
              {editingPO ? 'Update PO' : 'Save PO'}
            </button>
            <button onClick={() => { setCreating(false); resetForm(); }} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Supplier</div>
                <select value={form.supplier_id} onChange={(e) => selectSupplier(e.target.value)} disabled={docStatus !== 'Draft'}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs disabled:bg-gray-50">
                  <option value="">Select Supplier</option>
                  {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
                {selectedSupplier && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-500">
                    <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-400 block">Address</span>{selectedSupplier.address || '—'}</div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Contact</span>{selectedSupplier.contact_person || '—'}</div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Phone</span>{selectedSupplier.phone || selectedSupplier.contact_number || '—'}</div>
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Order Details</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Order Date</label>
                    <input type="date" value={new Date().toISOString().split('T')[0]} readOnly
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs mt-0.5 bg-gray-50 text-gray-500" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Expected Date</label>
                    <input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Cost Basis</label>
                    <select value={costBasis} onChange={(e) => setForm({ ...form, vat_mode: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      <option value="VAT Inclusive">VAT Inclusive</option>
                      <option value="VAT Exclusive">VAT Exclusive</option>
                    </select>
                    <p className="text-[9px] text-gray-400 mt-0.5">Applies to VAT lines only</p>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Payment Terms</label>
                    <input type="text" value={form.payment_terms || ''} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                      placeholder="e.g. Net 30" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">3 · Line Items</span>
                <button onClick={addItem} className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-600 bg-blue-50 rounded hover:bg-blue-100"><Plus size={12} /> Add Item</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-2 py-2 w-5">#</th>
                      <th className="px-2 py-2 text-left">Product</th>
                      <th className="px-2 py-2 w-20">Location</th>
                      <th className="px-2 py-2 text-center w-16">Qty</th>
                      <th className="px-2 py-2 text-center w-12">UOM</th>
                      <th className="px-2 py-2 text-right w-20">Cost</th>
                      <th className="px-2 py-2 text-center w-16">Disc</th>
                      <th className="px-2 py-2 text-center w-16">Tax</th>
                      <th className="px-2 py-2 text-right w-20">Net</th>
                      <th className="px-2 py-2 w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {form.items.map((item: any, i: number) => {
                      const product = products.find((p) => p.id === item.product_id);
                      const lineTotal = computeLineTotal(item);
                      return (
                        <tr key={i} className="hover:bg-blue-50/30">
                          <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                          <td className="px-2 py-1.5">
                            <ProductAutocomplete
                              products={products}
                              value={item.product_id}
                              selectedName={product ? product.name : item.product_name || ''}
                              placeholder="Search product…"
                              getPrice={(p) => p.cost || 0}
                              onSelect={(p) => {
                                if (!products.find((x) => x.id === p.id)) setProducts((prev) => [...prev, p]);
                                setForm((prev) => {
                                  const items = [...prev.items];
                                  items[i] = {
                                    ...items[i],
                                    product_id: p.id,
                                    unit_cost: p.cost || 0,
                                    product_name: p.name,
                                    sku: p.sku,
                                    unit_of_measure: p.unit_of_measure || 'pc',
                                    tax_type: lineTaxTypeFromProduct(p),
                                  };
                                  if (i === prev.items.length - 1) {
                                    setTimeout(() => setForm((p2) => ({ ...p2, items: [...p2.items, blankLineItem()] })), 100);
                                  }
                                  return { ...prev, items };
                                });
                                setAutoFocusItem(false);
                              }}
                              searchFn={searchProducts}
                              autoFocus={autoFocusItem && i === 0}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={item.location_id} onChange={(e) => updateItem(i, 'location_id', parseInt(e.target.value))}
                              className="w-full px-1 py-1 border border-gray-200 rounded text-[10px]">
                              {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="any" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                              className="w-full px-1 py-1 border border-gray-200 rounded text-center text-xs" min="1" />
                          </td>
                          <td className="px-2 py-1.5 text-center text-gray-500">{item.unit_of_measure || 'pc'}</td>
                          <td className="px-2 py-1.5">
                            <input type="number" step="0.01" value={item.unit_cost} onChange={(e) => updateItem(i, 'unit_cost', e.target.value)}
                              className="w-full px-1 py-1 border border-gray-200 rounded text-right text-xs" />
                          </td>
                          <td className="px-2 py-1.5">
                            <div className="flex gap-0.5">
                              <input type="number" step="0.01" value={item.discount_value || ''} onChange={(e) => updateItem(i, 'discount_value', e.target.value)}
                                className="w-10 px-1 py-1 border border-gray-200 rounded text-center text-[10px]" />
                              <select value={item.discount_type || '%'} onChange={(e) => updateItem(i, 'discount_type', e.target.value)}
                                className="px-0.5 py-1 border border-gray-200 rounded text-[9px] bg-gray-50">
                                <option value="%">%</option>
                                <option value="$">$</option>
                              </select>
                            </div>
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={item.tax_type || 'VAT'} onChange={(e) => updateItem(i, 'tax_type', e.target.value)}
                              className="w-full px-1 py-1 text-[10px] border border-gray-200 rounded">
                              {PURCHASE_TAX_TYPE_OPTIONS.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-right font-semibold">{lineTotal > 0 ? formatCurrency(lineTotal) : '—'}</td>
                          <td className="px-2 py-1.5 text-center">
                            <button onClick={() => removeItem(i)} className="text-red-400 hover:text-red-600">&times;</button>
                          </td>
                        </tr>
                      );
                    })}
                    {form.items.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Add items to this purchase order</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <DocumentNotesTermsPanel
              sectionLabel="4 · Notes & Terms"
              notes={form.notes || ''}
              termsConditions={form.terms_conditions || ''}
              onNotesChange={(v) => setForm({ ...form, notes: v })}
              onTermsChange={(v) => setForm({ ...form, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.PurchaseOrder}
              referenceId={editingPO?.id || currentPOId || ''}
              notesPlaceholder="Purchase order notes or supplier instructions..."
            />
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Order Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Items</span><span>{totals.itemCount}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Qty</span><span>{totalQty}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Gross</span><span>{formatCurrency(totals.gross)}</span></div>
                {totals.lineDiscount > 0 && <div className="flex justify-between text-red-600"><span>Discount</span><span>-{formatCurrency(totals.lineDiscount)}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Net Subtotal</span><span>{formatCurrency(totals.net)}</span></div>
                {taxTotals.vatable > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">VATable</span><span>{formatCurrency(taxTotals.vatable)}</span></div>
                )}
                {taxTotals.vatExempt > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">VAT Exempt</span><span>{formatCurrency(taxTotals.vatExempt)}</span></div>
                )}
                {taxTotals.zeroRated > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">Zero Rated</span><span>{formatCurrency(taxTotals.zeroRated)}</span></div>
                )}
                {taxTotals.vat > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">Input VAT</span><span className="text-blue-600">{formatCurrency(taxTotals.vat)}</span></div>
                )}
                <div className="flex justify-between pt-2 border-t-2 border-blue-900 text-sm font-bold text-blue-900">
                  <span>Total</span><span>{formatCurrency(taxTotals.total)}</span>
                </div>
              </div>
            </div>
            <div className="text-[10px] text-gray-400">F8 Save · Esc Cancel</div>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST ==========
  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50">
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Orders</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{total} orders</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-2 py-1 rounded text-xs bg-white/20 text-white border border-white/30 outline-none">
            <option value="" className="text-gray-900">All Status</option>
            <option value="Draft" className="text-gray-900">Draft</option>
            <option value="Sent" className="text-gray-900">Sent</option>
            <option value="Partial" className="text-gray-900">Partial</option>
            <option value="Received" className="text-gray-900">Received</option>
          </select>
          {hasPerm('purchases.purchase-order.create') && (
            <button onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"><Plus size={14} /> New PO</button>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Purchase Orders</div>
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">PO #</th>
                      <th className="px-3 py-2 text-left">Supplier</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-center">Status</th>
                      <th className="px-3 py-2 text-center">Items</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {orders.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No purchase orders</td></tr>}
                    {orders.map((po) => (
                      <tr key={po.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium text-blue-700 cursor-pointer hover:underline" onClick={() => viewPO(po.id)}>{po.po_number}</td>
                        <td className="px-3 py-2">
                          {po.supplier_id ? (
                            <Link to={`/purchases?supplier=${po.supplier_id}`} className="text-blue-600 hover:underline">{po.supplier_name || 'N/A'}</Link>
                          ) : (po.supplier_name || 'N/A')}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{formatDate(po.order_date)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(po.total)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] ${STATUS_COLORS[po.status] || 'bg-gray-100 text-gray-700'}`}>{po.status}</span>
                        </td>
                        <td className="px-3 py-2 text-center">{po.item_count}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {po.status === 'Draft' && hasPerm('purchases.purchase-order.edit') && (
                              <button onClick={() => openEditPO(po.id)} className="p-1 hover:bg-yellow-50 rounded text-yellow-600" title="Edit"><Edit2 size={14} /></button>
                            )}
                            {po.status === 'Draft' && hasPerm('purchases.purchase-order.edit') && (
                              <button onClick={() => sendPO(po.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="Send"><Send size={14} /></button>
                            )}
                            {(po.status === 'Sent' || po.status === 'Partial') && hasPerm('purchases.receiving-report.create') && (
                              <button onClick={() => openReceive(po)} className="px-2 py-0.5 text-[10px] font-semibold bg-green-100 text-green-700 rounded hover:bg-green-200">Receive</button>
                            )}
                            {['Sent', 'Partial', 'Received'].includes(po.status) && hasPerm('purchases.apv.create') && (
                              <button onClick={() => navigateApvFromPo(navigate, po.id)} className="px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 rounded hover:bg-amber-200">APV</button>
                            )}
                            <button onClick={() => viewPO(po.id)} className="p-1 hover:bg-gray-50 rounded text-gray-600" title="View"><Eye size={14} /></button>
                            <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/purchases/orders/${po.id}/print?token=${t}`, '_blank'); }}
                              className="p-1 hover:bg-green-50 rounded text-green-600" title="Print"><Printer size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
              </>
            )}
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Quick Stats</div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Total POs</span><span className="font-semibold">{total}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Awaiting Receive</span><span className="font-semibold text-yellow-700">{pendingReceiveTotal}</span></div>
            </div>
          </div>
          <Link to="/goods-receipts" className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-100 rounded-lg text-xs font-semibold text-green-800 hover:bg-green-100">
            <Package size={14} /> Goods Receipts →
          </Link>
          {supplierFilter && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-800">
              Filtered by supplier. <Link to="/purchases" className="underline">Clear filter</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
