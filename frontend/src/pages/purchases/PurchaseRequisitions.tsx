import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, ArrowLeft, Eye, CheckCircle, XCircle, FileText, ClipboardList, Search, Zap, Printer } from 'lucide-react';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { fetchPrCopyToPo, navigatePoFromPr } from '../../lib/purchaseCopy';
import { lineTaxTypeFromProduct, PURCHASE_TAX_TYPE_OPTIONS } from '../../lib/purchaseTax';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import { printDocument } from '../../lib/printDocument';
import {
  applyPurchaseUomToLine,
  blankPurchaseDocLine,
  buildPurchaseDocItemPayload,
  lineBaseQty,
  loadProductUoms,
  pickPurchaseLineUom,
} from '../../lib/purchaseDocUom';
import { resolvePurchaseUom } from '../../lib/uomUtils';

const PRIMARY = '#1E40AF';

const STATUS_COLORS: Record<string, string> = {
  Draft: 'bg-gray-100 text-gray-700',
  Pending: 'bg-yellow-100 text-yellow-700',
  Approved: 'bg-green-100 text-green-700',
  Cancelled: 'bg-red-100 text-red-700',
};

export default function PurchaseRequisitions() {
  const { hasPerm } = useAuth();
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [requisitions, setRequisitions] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewPr, setViewPr] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState<any>({ notes: '', terms_conditions: '', items: [] });

  const load = () => {
    setLoading(true);
    api.get('/purchases/requisitions')
      .then((r) => setRequisitions(r.data || []))
      .catch(() => toast.error('Failed to load requisitions'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get('/products?limit=500').then((r) => setProducts(r.data.data || [])).catch(() => {});
  }, []);

  const blankItem = () => blankPurchaseDocLine();

  const generateFromLowStock = async () => {
    if (!window.confirm('Create a draft PR from all low-stock products?')) return;
    setGenerating(true);
    try {
      const r = await api.post('/purchases/requisitions/generate-from-low-stock', {});
      toast.success(`PR ${r.data.pr_number} created with ${r.data.item_count} item(s)`);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to generate PR');
    } finally {
      setGenerating(false);
    }
  };

  const searchProducts = async (q: string) => {
    try { return (await api.get(`/products/search/quick?q=${encodeURIComponent(q)}`)).data; }
    catch { return []; }
  };

  const addItem = () => setForm({ ...form, items: [...form.items, blankItem()] });

  const updateItem = async (idx: number, field: string, value: any) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: value };
    if (field === 'product_id' && value) {
      const p = products.find((x) => x.id === value);
      const uoms = await loadProductUoms(value);
      items[idx] = applyPurchaseUomToLine(
        {
          ...items[idx],
          product_name: p?.name,
          sku: p?.sku,
          tax_type: p ? lineTaxTypeFromProduct(p) : items[idx].tax_type,
        },
        uoms,
        null,
        p,
        p?.cost || 0,
      );
    }
    if (field === 'uom_id' && value) {
      const uom = resolvePurchaseUom(items[idx].uoms || [], parseInt(String(value), 10), null);
      if (uom) {
        items[idx].uom_id = uom.uom_id;
        items[idx].unit_of_measure = uom.uom_code || 'pc';
        items[idx].conversion_to_base = parseFloat(String(uom.conversion_to_base)) || 1;
        items[idx].estimated_cost = parseFloat(String(uom.purchase_price)) || items[idx].estimated_cost || 0;
      }
    }
    setForm({ ...form, items });
  };

  const removeItem = (idx: number) => setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== idx) });

  const submitCreate = async () => {
    const items = form.items.filter((i: any) => i.product_id);
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    setSaving(true);
    try {
      const res = await api.post('/purchases/requisitions', {
        notes: form.notes,
        terms_conditions: form.terms_conditions,
        items: items.map((i: any) => buildPurchaseDocItemPayload(i)),
      });
      toast.success(`Requisition ${res.data.pr_number} created`);
      setCreating(false);
      setForm({ notes: '', terms_conditions: '', items: [] });
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const viewRequisition = async (id: string) => {
    try {
      const r = await api.get(`/purchases/requisitions/${id}`);
      setViewPr(r.data);
      setViewing(true);
    } catch {
      toast.error('Failed to load requisition');
    }
  };

  const approvePr = async (id: string) => {
    try {
      await api.patch(`/purchases/requisitions/${id}/approve`);
      toast.success('Requisition approved');
      if (viewing && viewPr?.id === id) viewRequisition(id);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to approve');
    }
  };

  const cancelPr = async (id: string) => {
    if (!window.confirm('Cancel this requisition?')) return;
    try {
      await api.patch(`/purchases/requisitions/${id}/cancel`);
      toast.success('Requisition cancelled');
      if (viewing) setViewing(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to cancel');
    }
  };

  const copyToPo = async (id: string) => {
    try {
      await fetchPrCopyToPo(id);
      navigatePoFromPr(navigate, id);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Cannot create PO from this requisition');
    }
  };

  const printPr = (id: string) => printDocument(`/api/purchases/requisitions/${id}/print`);

  const estTotal = form.items.reduce((s: number, i: any) => s + (parseFloat(i.quantity || 0) * parseFloat(i.estimated_cost || 0)), 0);
  const totalQty = form.items.reduce((s: number, i: any) => s + (parseFloat(i.quantity) || 0), 0);

  const filtered = requisitions.filter((pr) => {
    if (statusFilter && pr.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return pr.pr_number?.toLowerCase().includes(q)
      || pr.requested_by_name?.toLowerCase().includes(q)
      || pr.linked_po_number?.toLowerCase().includes(q);
  });

  const pendingApproval = requisitions.filter((pr) => ['Draft', 'Pending'].includes(pr.status));
  const approvedOpen = requisitions.filter((pr) => pr.status === 'Approved' && !pr.linked_po_number);

  // ========== VIEW ==========
  if (viewing && viewPr) {
    const v = viewPr;
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Requisition</h1>
            <span className="text-xs font-mono text-white/80">{v.pr_number}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[v.status] || ''}`}>{v.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {v.status === 'Approved' && !v.linked_po_number && hasPerm('purchases.purchase-order.create') && (
              <button onClick={() => copyToPo(v.id)} className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-bold hover:bg-amber-600">
                <FileText size={13} /> Copy to PO
              </button>
            )}
            {['Draft', 'Pending'].includes(v.status) && hasPerm('purchases.purchase-order.edit') && (
              <button onClick={() => approvePr(v.id)} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-bold hover:bg-green-700">
                <CheckCircle size={13} /> Approve
              </button>
            )}
            {v.status !== 'Cancelled' && hasPerm('purchases.purchase-order.edit') && (
              <button onClick={() => cancelPr(v.id)} className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded text-xs font-bold hover:bg-red-700">
                <XCircle size={13} /> Cancel
              </button>
            )}
            <button onClick={() => printPr(v.id)} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">
              <Printer size={13} /> Print
            </button>
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe
            ref={iframeRef}
            key={`${v.id}-${v.status}`}
            src={`/api/purchases/requisitions/${v.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow"
            style={{ width: '800px', minHeight: '1100px' }}
            title="Purchase Requisition Preview"
          />
        </div>
      </div>
    );
  }

  // ========== CREATE ==========
  if (creating) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setCreating(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Requisition</h1>
            <span className="text-xs font-mono text-white/80">NEW</span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS.Draft}`}>Draft</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={submitCreate} disabled={saving} className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Requisition'}
            </button>
            <button onClick={() => setCreating(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <DocumentNotesTermsPanel
              sectionLabel="1 · Notes & Terms"
              notes={form.notes || ''}
              termsConditions={form.terms_conditions || ''}
              onNotesChange={(v) => setForm({ ...form, notes: v })}
              onTermsChange={(v) => setForm({ ...form, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.PurchaseRequisition}
              referenceId=""
              notesPlaceholder="Reason for requisition, purpose, or special instructions..."
            />

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Line Items</span>
                <button onClick={addItem} className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-600 bg-blue-50 rounded hover:bg-blue-100"><Plus size={12} /> Add Item</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left w-8">#</th>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="line-uom-col px-3 py-2 text-center">UOM</th>
                      <th className="px-3 py-2 text-right w-20">Qty (UOM)</th>
                      <th className="px-3 py-2 text-center w-16">= Base</th>
                      <th className="px-3 py-2 text-right w-24">Est. Cost</th>
                      <th className="px-3 py-2 text-center w-16">Tax</th>
                      <th className="px-3 py-2 text-right w-24">Total</th>
                      <th className="px-3 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {form.items.map((item: any, idx: number) => {
                      const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.estimated_cost) || 0);
                      const uom = pickPurchaseLineUom(item.uoms || [], item);
                      const basePreview = lineBaseQty(item);
                      return (
                        <tr key={idx} className="hover:bg-blue-50/30">
                          <td className="px-3 py-1.5 text-gray-400">{idx + 1}</td>
                          <td className="px-3 py-1.5 min-w-[200px]">
                            <ProductAutocomplete
                              products={products}
                              value={item.product_id}
                              selectedName={item.product_name || ''}
                              placeholder="Search product…"
                              getPrice={(p) => p.cost || 0}
                              searchFn={searchProducts}
                              autoFocus={idx === form.items.length - 1 && !item.product_id}
                              onSelect={async (p) => {
                                if (!products.find((x) => x.id === p.id)) setProducts((prev) => [...prev, p]);
                                const uoms = await loadProductUoms(p.id);
                                const items = [...form.items];
                                items[idx] = applyPurchaseUomToLine(
                                  {
                                    ...items[idx],
                                    product_id: p.id,
                                    product_name: p.name,
                                    sku: p.sku,
                                    tax_type: lineTaxTypeFromProduct(p),
                                  },
                                  uoms,
                                  null,
                                  p,
                                  p.cost || 0,
                                );
                                setForm({ ...form, items });
                              }}
                            />
                          </td>
                          <td className="line-uom-col px-3 py-1.5 text-center">
                            {(item.uoms?.length || 0) > 1 ? (
                              <select value={item.uom_id || ''} onChange={(e) => updateItem(idx, 'uom_id', parseInt(e.target.value, 10))}
                                className="line-uom-select px-1 py-1 border border-gray-200 rounded text-[10px] uppercase">
                                {(item.uoms || []).map((u: any) => (
                                  <option key={u.uom_id} value={u.uom_id}>{(u.uom_code || '').toUpperCase()}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs uppercase text-gray-600">{(uom?.uom_code || item.unit_of_measure || 'pc').toUpperCase()}</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                              className="w-full px-1 py-1 border border-gray-200 rounded text-right text-xs" />
                          </td>
                          <td className="px-3 py-1.5 text-center text-[10px] text-gray-500 font-mono">
                            {item.product_id ? `${basePreview} pc` : '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" min="0" step="0.01" value={item.estimated_cost} onChange={(e) => updateItem(idx, 'estimated_cost', e.target.value)}
                              className="w-full px-1 py-1 border border-gray-200 rounded text-right text-xs" />
                          </td>
                          <td className="px-3 py-1.5">
                            <select value={item.tax_type || 'VAT'} onChange={(e) => updateItem(idx, 'tax_type', e.target.value)}
                              className="w-full px-1 py-1 text-[10px] border border-gray-200 rounded">
                              {PURCHASE_TAX_TYPE_OPTIONS.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold">{lineTotal > 0 ? formatCurrency(lineTotal) : '—'}</td>
                          <td className="px-3 py-1.5 text-center">
                            <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-600">&times;</button>
                          </td>
                        </tr>
                      );
                    })}
                    {form.items.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Add items to this requisition</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Items</span><span>{form.items.filter((i: any) => i.product_id).length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Qty</span><span>{totalQty}</span></div>
                <div className="flex justify-between pt-2 border-t-2 border-blue-900 text-sm font-bold text-blue-900">
                  <span>Est. Total</span><span>{formatCurrency(estTotal)}</span>
                </div>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800 leading-relaxed">
              After saving, approve the requisition then use <strong>Copy to PO</strong> to create a purchase order.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST ==========
  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <ClipboardList size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Requisitions</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{requisitions.length} records</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2 py-1 rounded text-xs bg-white/20 text-white border border-white/30 outline-none">
            <option value="" className="text-gray-900">All Status</option>
            <option value="Draft" className="text-gray-900">Draft</option>
            <option value="Pending" className="text-gray-900">Pending</option>
            <option value="Approved" className="text-gray-900">Approved</option>
            <option value="Cancelled" className="text-gray-900">Cancelled</option>
          </select>
          {hasPerm('purchases.purchase-order.create') && (
            <>
              <button onClick={generateFromLowStock} disabled={generating}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-400 text-blue-900 rounded text-xs font-bold hover:bg-amber-300 disabled:opacity-50">
                <Zap size={14} /> {generating ? 'Generating…' : 'Auto from Low Stock'}
              </button>
              <button onClick={() => { setForm({ notes: '', terms_conditions: '', items: [blankItem()] }); setCreating(true); }}
                className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">
                <Plus size={14} /> New Requisition
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PR #, requester, linked PO…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Requisition History</div>
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left">PR #</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Requested By</th>
                    <th className="px-3 py-2 text-center">Items</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-left">Linked PO</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No requisitions found</td></tr>
                  )}
                  {filtered.map((pr) => (
                    <tr key={pr.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono font-medium text-blue-700 cursor-pointer hover:underline" onClick={() => viewRequisition(pr.id)}>{pr.pr_number}</td>
                      <td className="px-3 py-2">{formatDate(pr.created_at)}</td>
                      <td className="px-3 py-2">{pr.requested_by_name}</td>
                      <td className="px-3 py-2 text-center">{pr.item_count}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${STATUS_COLORS[pr.status] || ''}`}>{pr.status}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-600">{pr.linked_po_number || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => viewRequisition(pr.id)} className="flex items-center gap-1 px-2 py-1 hover:bg-blue-50 rounded text-blue-600 text-[10px] font-semibold" title="View">
                            <Eye size={14} /> View
                          </button>
                          <button onClick={() => printPr(pr.id)} className="flex items-center gap-1 px-2 py-1 hover:bg-green-50 rounded text-green-600 text-[10px] font-semibold" title="Print">
                            <Printer size={14} /> Print
                          </button>
                          {pr.status === 'Approved' && !pr.linked_po_number && hasPerm('purchases.purchase-order.create') && (
                            <button onClick={() => copyToPo(pr.id)} className="p-1 hover:bg-amber-50 rounded text-amber-700" title="Copy to PO"><FileText size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Pending Approval</div>
            <p className="text-2xl font-bold text-blue-900">{pendingApproval.length}</p>
            <p className="text-xs text-gray-500 mt-1">Draft / Pending requisitions</p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Ready for PO</div>
            {approvedOpen.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No approved PRs awaiting PO</p>
            ) : (
              <div className="space-y-2">
                {approvedOpen.slice(0, 8).map((pr) => (
                  <div key={pr.id} className="border border-gray-100 rounded-lg p-2.5 hover:border-blue-200">
                    <div className="font-mono text-[10px] text-blue-700">{pr.pr_number}</div>
                    <div className="text-xs text-gray-600 truncate">{pr.requested_by_name}</div>
                    {hasPerm('purchases.purchase-order.create') && (
                      <button onClick={() => copyToPo(pr.id)} className="mt-1.5 text-[10px] font-semibold text-amber-700 hover:text-amber-900">Copy to PO →</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-[10px] text-gray-500 leading-relaxed">
            Tip: Approve requisitions before copying to a Purchase Order.
          </div>
          <Link to="/purchases" className="block text-center text-xs text-blue-600 hover:underline">View Purchase Orders →</Link>
        </div>
      </div>
    </div>
  );
}
