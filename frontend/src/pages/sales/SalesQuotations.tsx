import React, { useState, useEffect, useRef, useMemo } from 'react';
import api from '../../lib/api';
import CopyToMenu from '../../components/CopyToMenu';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, Edit2, CheckCircle, XCircle, Send, Eye, Printer, Paperclip, Download, X, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import Pagination from '../../components/Pagination';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import {
  SalesDocHeader,
  SalesKpiCard,
  SalesListToolbar,
  SalesModuleHeader,
  SalesQuoteSummary,
  SalesSectionCard,
  SalesStatusBadge,
} from '../../components/sales/SalesDocumentLayout';
import { useAuth } from '../../store/auth';
import { computeSalesDocLine, computeSalesDocTotals } from '../../lib/invoiceTax';
import { getProductPriceForCustomer } from '../../lib/customerPricing';
import { printDocument, printFromIframe } from '../../lib/printDocument';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'Draft', label: 'Draft' },
  { value: 'Sent', label: 'Sent' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Expired', label: 'Expired' },
  { value: 'Cancelled', label: 'Cancelled' },
];

function isPastDate(dateStr?: string) {
  if (!dateStr) return false;
  const today = new Date().toISOString().split('T')[0];
  return dateStr < today;
}

export default function SalesQuotations() {
  const { hasPerm } = useAuth();
  const [quotations, setQuotations] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [viewSq, setViewSq] = useState<any>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [customerPriceMap, setCustomerPriceMap] = useState<Record<string, number>>({});
  const [form, setForm] = useState<any>({ customer_id: '', validity_days: 7, valid_until: '', notes: '', items: [] });
  const [loading, setLoading] = useState(false);
  const [autoFocusItem, setAutoFocusItem] = useState(false);
  const [attachModal, setAttachModal] = useState<{ open: boolean; sq: any; files: any[] }>({ open: false, sq: null, files: [] });
  const [editingMeta, setEditingMeta] = useState<{ sq_number?: string; status?: string }>({});
  const [search, setSearch] = useState('');
  const [listStats, setListStats] = useState({ draft_count: 0, ready_count: 0, pipeline_value: 0, expired_count: 0 });

  const loadQuotations = () => {
    const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
    api.get(`/sales-quotations?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}${q}`)
      .then(r => {
        setQuotations(r.data.data || []);
        setTotal(r.data.total || 0);
        if (r.data.stats) setListStats(r.data.stats);
      })
      .catch((err: any) => toast.error(err.response?.data?.error || 'Failed to load quotations'));
  };

  useEffect(() => { loadQuotations(); }, [page, statusFilter, search]);
  useEffect(() => { api.get('/customers?limit=200').then(r => setCustomers(r.data?.data || r.data || [])).catch(() => {}); }, []);
  useEffect(() => { api.get('/products?limit=200').then(r => setProducts(r.data?.data || r.data || [])).catch(() => {}); }, []);

  useEffect(() => {
    if (!selectedCustomer?.id) {
      setCustomerPriceMap({});
      return;
    }
    api.get(`/customers/${selectedCustomer.id}/prices`)
      .then((r) => {
        const map: Record<string, number> = {};
        (r.data || []).forEach((row: any) => { map[row.product_id] = parseFloat(row.unit_price); });
        setCustomerPriceMap(map);
      })
      .catch(() => setCustomerPriceMap({}));
  }, [selectedCustomer?.id]);

  useEffect(() => {
    if (!creating || !form.customer_id || customers.length === 0) return;
    const c = customers.find((x: any) => String(x.id) === String(form.customer_id));
    if (c) setSelectedCustomer(c);
  }, [customers, creating, form.customer_id]);

  const searchProducts = async (q: string) => {
    try { const r = await api.get(`/products/search/quick?q=${encodeURIComponent(q)}`); return r.data || []; } catch { return []; }
  };

  const getPrice = (p: any) => getProductPriceForCustomer(selectedCustomer, p, customerPriceMap);

  const blankSqItem = () => ({ product_id: '', product_name: '', description: '', quantity: 1, unit_price: 0, discount: 0, tax_type: 'VAT', vat_amount: 0 });

  const selectCustomer = (cid: string) => {
    if (!cid) {
      setSelectedCustomer(null);
      setCustomerPriceMap({});
      setForm((prev: any) => ({ ...prev, customer_id: '' }));
      return;
    }
    const c = customers.find((x: any) => x.id == cid);
    if (c) {
      setSelectedCustomer(c);
      setForm((prev: any) => {
        const next = { ...prev, customer_id: cid, payment_terms: c.payment_terms || '' };
        if (prev.items.length === 0) {
          next.items = [blankSqItem()];
          setAutoFocusItem(true);
        }
        return next;
      });
    }
  };

  const setValidityDays = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setForm({ ...form, validity_days: days, valid_until: d.toISOString().split('T')[0] });
  };

  const addItem = () => setForm({ ...form, items: [...form.items, blankSqItem()] });

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
    const d = new Date(); d.setDate(d.getDate() + 7);
    setForm({ customer_id: '', payment_terms: '', validity_days: 7, valid_until: d.toISOString().split('T')[0], notes: '', terms_conditions: '', items: [] });
    setCreating(true);
  };

  const openEdit = async (id: string) => {
    try {
      const r = await api.get(`/sales-quotations/${id}`);
      const sq = r.data;
      setEditingId(id);
      setEditingMeta({ sq_number: sq.sq_number, status: sq.status });
      const c = customers.find((x: any) => x.id == sq.customer_id);
      if (c) setSelectedCustomer(c);
      const existingUntil = sq.valid_until || '';
      const existingDays = existingUntil ? Math.max(1, Math.round((new Date(existingUntil).getTime() - Date.now()) / 86400000)) : 7;
      setForm({
        customer_id: sq.customer_id,
        payment_terms: sq.payment_terms || c?.payment_terms || '',
        validity_days: existingDays,
        valid_until: existingUntil,
        notes: sq.notes || '',
        terms_conditions: sq.terms_conditions || '',
        items: (sq.items || []).map((i: any) => ({
          product_id: i.product_id,
          product_name: i.product_name || '',
          description: i.description || '',
          quantity: i.quantity,
          unit_price: i.unit_price,
          discount: i.discount || 0,
          tax_type: i.tax_type || 'VAT',
          vat_amount: i.vat_amount || 0,
          uom: i.unit_of_measure || 'pc',
        })),
      });
      setCreating(true);
    } catch { toast.error('Failed to load'); }
  };

  const save = async () => {
    const items = form.items.filter((i: any) => i.product_id);
    if (!form.customer_id || items.length === 0) { toast.error('Customer and items required'); return; }
    setLoading(true);
    try {
      const payload = { ...form, items };
      if (editingId) {
        await api.put(`/sales-quotations/${editingId}`, payload);
        toast.success('Updated');
        setCreating(false);
        setEditingId(null);
        setEditingMeta({});
      } else {
        const res = await api.post('/sales-quotations', payload);
        toast.success(`Quotation ${res.data.sq_number} created`);
        setEditingId(res.data.id);
        setEditingMeta({ sq_number: res.data.sq_number, status: 'Draft' });
      }
      loadQuotations();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
    finally { setLoading(false); }
  };

  const changeStatus = async (id: string, status: string) => {
    try { await api.patch(`/sales-quotations/${id}/status`, { status }); toast.success(`Marked ${status}`); loadQuotations(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };


  const viewQuotation = async (id: string) => {
    try { const r = await api.get(`/sales-quotations/${id}`); setViewSq(r.data); setViewing(true); }
    catch { toast.error('Failed to load'); }
  };

  const openAttachments = async (sq: any) => {
    try {
      const r = await api.get(`/attachments/list/SalesQuotation/${sq.id}`);
      setAttachModal({ open: true, sq, files: r.data || [] });
    } catch { toast.error('Failed to load attachments'); }
  };

  // ========== FULL-PAGE VIEW (PRINT PREVIEW) ==========
  if (viewing && viewSq) {
    const v = viewSq;
    const printDoc = () => {
      if (!printFromIframe(iframeRef.current)) {
        printDocument(`/api/sales-quotations/${v.id}/print`);
      }
    };
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-slate-100">
        <SalesDocHeader
          title="Sales Quotation"
          docNumber={v.sq_number}
          status={v.status}
          onBack={() => setViewing(false)}
          onClose={() => setViewing(false)}
          actions={
            <>
              <CopyToMenu sourceType="SQ" docId={v.id} doc={v} hasPerm={hasPerm} onNavigate={() => setViewing(false)} />
              <button type="button" onClick={printDoc}
                className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded-lg text-xs font-bold hover:bg-blue-50 shadow-sm">
                <Printer size={13} /> Print
              </button>
            </>
          }
        />
        <div className="px-4 py-2 bg-white border-b border-slate-200 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
          <span><span className="text-slate-400">Customer:</span> <strong>{v.customer_name}</strong></span>
          <span><span className="text-slate-400">Date:</span> {formatDate(v.created_at)}</span>
          <span><span className="text-slate-400">Valid until:</span> {v.valid_until ? formatDate(v.valid_until) : '—'}</span>
          <span><span className="text-slate-400">Total:</span> <strong>{formatCurrency(v.total)}</strong></span>
        </div>
        <div className="flex-1 p-6 overflow-y-auto flex justify-center">
          <div className="w-full max-w-[820px]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 text-center">Document preview</div>
            <iframe
              ref={iframeRef}
              src={`/api/sales-quotations/${v.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
              className="w-full border border-slate-300 bg-white shadow-lg rounded-sm"
              style={{ minHeight: '1100px' }}
              title="Quotation Preview"
            />
          </div>
        </div>
      </div>
    );
  }

  // ========== FULL-PAGE CREATE/EDIT VIEW ==========
  if (creating) {
    const totalQty = form.items.reduce((s: number, i: any) => s + parseFloat(i.quantity || '0'), 0);
    const totalDisc = form.items.reduce((s: number, i: any) => s + parseFloat(i.discount || 0), 0);
    const docStatus = editingMeta.status || 'Draft';
    const previewSq = () => {
      if (!editingId) { toast.error('Save the quotation first to preview'); return; }
      window.open(`/api/sales-quotations/${editingId}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`, '_blank');
    };

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-slate-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <SalesDocHeader
          title="Sales Quotation"
          docNumber={editingMeta.sq_number || (editingId ? `#${editingId.substring(0, 8)}` : 'NEW DRAFT')}
          status={docStatus}
          onBack={() => setCreating(false)}
          onClose={() => setCreating(false)}
          actions={
            <>
              {editingId && ['Sent', 'Approved'].includes(docStatus) && (
                <CopyToMenu sourceType="SQ" docId={editingId} doc={{ id: editingId, status: docStatus }} hasPerm={hasPerm} onNavigate={() => setCreating(false)} />
              )}
              <button type="button" onClick={previewSq} className="px-3 py-1.5 bg-white/15 text-white rounded-lg text-xs font-medium hover:bg-white/25 flex items-center gap-1">
                <Eye size={13} /> Preview
              </button>
              <button type="button" onClick={save} disabled={loading || !form.customer_id || form.items.filter((i: any) => i.product_id).length === 0}
                className="px-4 py-1.5 bg-white text-blue-900 rounded-lg text-xs font-bold hover:bg-blue-50 disabled:opacity-50 shadow-sm">
                {loading ? 'Saving…' : editingId ? 'Update' : 'Save Draft'}
              </button>
            </>
          }
        />

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <SalesSectionCard title="Customer" subtitle="Bill-to party and commercial terms">
                <select value={form.customer_id} onChange={(e) => selectCustomer(e.target.value)} className="input-field text-sm w-full">
                  <option value="">Select customer…</option>
                  {customers.map((c: any) => <option key={c.id} value={c.id}>{c.customer_name}</option>)}
                </select>
                {selectedCustomer ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[
                      { label: 'Code', value: selectedCustomer.customer_code || '—' },
                      { label: 'TIN', value: selectedCustomer.tin || '—' },
                      { label: 'Contact', value: selectedCustomer.phone || '—' },
                      { label: 'Type', value: selectedCustomer.customer_type || 'Retail' },
                    ].map((field) => (
                      <div key={field.label} className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2">
                        <div className="text-[10px] font-semibold uppercase text-slate-400">{field.label}</div>
                        <div className="text-xs text-slate-700 mt-0.5 truncate">{field.value}</div>
                      </div>
                    ))}
                    <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2 col-span-2">
                      <div className="text-[10px] font-semibold uppercase text-slate-400">Address</div>
                      <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{selectedCustomer.address || '—'}</div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">Select a customer to load pricing and payment terms.</p>
                )}
              </SalesSectionCard>

              <SalesSectionCard title="Quotation details" subtitle="Validity and payment conditions">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-semibold uppercase text-slate-400">Quotation date</label>
                    <input type="date" value={new Date().toISOString().split('T')[0]} disabled className="input-field text-sm mt-1 bg-slate-50" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold uppercase text-slate-400">Valid until</label>
                    <input type="date" value={form.valid_until || ''} onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
                      className="input-field text-sm mt-1" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-[10px] font-semibold uppercase text-slate-400">Validity period</label>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {[7, 15, 30, 60].map((days) => (
                      <button key={days} type="button" onClick={() => setValidityDays(days)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                          form.validity_days === days ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                        }`}>
                        {days} days
                      </button>
                    ))}
                    <div className="flex items-center gap-1.5 ml-1">
                      <input type="number" min="1" value={form.validity_days}
                        onChange={(e) => {
                          const days = parseInt(e.target.value, 10) || 1;
                          setValidityDays(days);
                        }}
                        className="w-16 input-field text-sm text-center py-1.5" />
                      <span className="text-xs text-slate-500">custom</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="text-[10px] font-semibold uppercase text-slate-400">Payment terms</label>
                  <input type="text" value={form.payment_terms || ''} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    className="input-field text-sm mt-1" placeholder="e.g. 30 days upon delivery" />
                </div>
              </SalesSectionCard>
            </div>

            <SalesSectionCard
              title="Line items"
              subtitle={`${form.items.length} row(s) · ${totalQty} total qty`}
              action={
                <button type="button" onClick={addItem}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100">
                  <Plus size={14} /> Add item
                </button>
              }
              bodyClassName="p-0"
            >
              <div className="overflow-auto" style={{ minHeight: 280, maxHeight: '48vh' }}>
                <table className="data-table text-xs w-full min-w-[920px]">
                  <thead className="sticky top-0 z-10 bg-slate-100">
                    <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="w-10 px-2 py-2 text-left">#</th>
                      <th className="w-24 px-2 py-2 text-left">SKU</th>
                      <th className="px-2 py-2 text-left min-w-[160px]">Product</th>
                      <th className="px-2 py-2 text-left min-w-[140px]">Description</th>
                      <th className="w-12 px-2 py-2 text-center">UOM</th>
                      <th className="min-w-[5.5rem] w-[5.5rem] px-2 py-2 text-center">Qty</th>
                      <th className="min-w-[7.5rem] w-[7.5rem] px-2 py-2 text-right">Unit price</th>
                      <th className="min-w-[4.5rem] w-[4.5rem] px-2 py-2 text-center">Disc</th>
                      <th className="w-24 px-2 py-2 text-center">Tax</th>
                      <th className="w-28 px-2 py-2 text-right">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.length === 0 && (
                      <tr><td colSpan={11} className="px-4 py-16 text-center text-slate-400">Select a customer, then add your first line item.</td></tr>
                    )}
                    {form.items.map((item: any, idx: number) => {
                      const prod = products.find((p: any) => p.id == item.product_id);
                      const lineTotal = parseFloat(item.quantity) * parseFloat(item.unit_price) - parseFloat(item.discount || 0);
                      return (
                        <tr key={idx} className="hover:bg-blue-50/30 even:bg-slate-50/40">
                          <td className="px-2 py-2 text-slate-400 tabular-nums">{idx + 1}</td>
                          <td className="px-2 py-2 font-mono text-[11px] text-slate-500">{prod?.sku || '—'}</td>
                          <td className="px-1 py-1.5">
                            <ProductAutocomplete
                              products={products}
                              value={item.product_id}
                              selectedName={prod?.name || item.product_name || ''}
                              placeholder="Search product…"
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
                                    unit_price: price,
                                    tax_type: p.tax_type || 'VAT',
                                    uom: p.unit_of_measure || 'pc',
                                  });
                                  if (idx === prev.items.length - 1) {
                                    setTimeout(() => setForm((p2: any) => ({ ...p2, items: [...p2.items, blankSqItem()] })), 100);
                                  }
                                  return { ...prev, items };
                                });
                                setAutoFocusItem(false);
                              }}
                            />
                          </td>
                          <td className="px-1 py-1.5">
                            <input type="text" value={item.description || ''} onChange={(e) => updateItem(idx, 'description', e.target.value)}
                              className="input-field text-xs py-1.5" placeholder="Optional line note" />
                          </td>
                          <td className="px-2 py-2 text-center text-[11px] text-slate-500">{item.uom || prod?.unit_of_measure || 'pc'}</td>
                          <td className="px-1.5 py-1.5 min-w-[5.5rem] w-[5.5rem]">
                            <input type="number" step="0.01" min="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                              className="input-field text-xs py-1.5 text-center w-full min-w-[4.5rem]" />
                          </td>
                          <td className="px-1.5 py-1.5 min-w-[7.5rem] w-[7.5rem]">
                            <input type="number" step="0.01" value={item.unit_price} onChange={(e) => updateItem(idx, 'unit_price', e.target.value)}
                              className="input-field text-xs py-1.5 text-right tabular-nums w-full min-w-[6.5rem]" />
                          </td>
                          <td className="px-1.5 py-1.5 min-w-[4.5rem] w-[4.5rem]">
                            <input type="number" step="0.01" min="0" value={item.discount} onChange={(e) => updateItem(idx, 'discount', e.target.value)}
                              className="input-field text-xs py-1.5 text-center tabular-nums" />
                          </td>
                          <td className="px-1 py-1.5">
                            <select value={item.tax_type} onChange={(e) => updateItem(idx, 'tax_type', e.target.value)}
                              className="input-field text-[11px] py-1.5">
                              <option value="VAT">VAT</option>
                              <option value="VAT Exempt">Exempt</option>
                              <option value="Zero Rated">Zero</option>
                              <option value="LGU 5% Final VAT">LGU 5%</option>
                            </select>
                          </td>
                          <td className="px-2 py-2 text-right font-semibold tabular-nums">{formatCurrency(lineTotal)}</td>
                          <td className="px-1 py-1.5 text-center">
                            <button type="button" onClick={() => removeItem(idx)} className="text-slate-300 hover:text-red-500 text-lg leading-none">&times;</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SalesSectionCard>

            <DocumentNotesTermsPanel
              notes={form.notes}
              termsConditions={form.terms_conditions}
              onNotesChange={(value) => setForm({ ...form, notes: value })}
              onTermsChange={(value) => setForm({ ...form, terms_conditions: value })}
              referenceType={ATTACHMENT_REF.SalesQuotation}
              referenceId={editingId || ''}
              sectionLabel="Notes, terms & attachments"
              notesPlaceholder="Quotation notes, delivery remarks, or special instructions…"
              termsPlaceholder="Standard terms and conditions for this quotation…"
            />
          </div>

          <div className="w-80 flex-shrink-0 border-l border-slate-200 bg-white overflow-y-auto p-4">
            <SalesQuoteSummary
              itemCount={form.items.filter((i: any) => i.product_id).length}
              totalQty={totalQty}
              subtotal={subtotal}
              totalDisc={totalDisc}
              taxTotals={taxTotals}
              totalVat={totalVat}
              validUntil={form.valid_until}
              validityDays={form.validity_days}
              customer={selectedCustomer}
            />
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST VIEW ==========
  const pendingSend = listStats.draft_count ?? 0;
  const readyForSo = listStats.ready_count ?? 0;
  const pipelineValue = parseFloat(String(listStats.pipeline_value ?? 0));
  const expiredCount = listStats.expired_count ?? 0;

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-slate-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <SalesModuleHeader
        icon={FileText}
        title="Sales Quotations"
        badge={<span className="text-xs bg-white/20 text-white px-2.5 py-0.5 rounded-full tabular-nums">{total} records</span>}
        actions={
          hasPerm('sales.sales-quotation.create') ? (
            <button type="button" onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded-lg text-xs font-bold hover:bg-blue-50 shadow-sm">
              <Plus size={14} /> New quotation
            </button>
          ) : undefined
        }
      />

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SalesKpiCard label="Draft (unsent)" value={pendingSend} hint="Awaiting customer send" tone="blue" />
            <SalesKpiCard label="Ready for SO" value={readyForSo} hint="Sent or approved" tone="green" />
            <SalesKpiCard label="Pipeline value" value={formatCurrency(pipelineValue)} hint="Sent + approved total" tone="default" />
            <SalesKpiCard label="Expired" value={expiredCount} hint="Past validity date" tone={expiredCount > 0 ? 'amber' : 'default'} />
          </div>

          <SalesListToolbar
            search={search}
            onSearchChange={(v) => { setSearch(v); setPage(1); }}
            searchPlaceholder="Search SQ # or customer…"
            statusFilter={statusFilter}
            onStatusFilterChange={(v) => { setStatusFilter(v); setPage(1); }}
            statusOptions={STATUS_FILTERS}
          />

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-800">Quotation register</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Click document number to preview · use actions to progress workflow</div>
              </div>
            </div>
            <table className="data-table text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-slate-500 bg-slate-50">
                  <th className="px-3 py-2.5 text-left">SQ #</th>
                  <th className="px-3 py-2.5 text-left">Date</th>
                  <th className="px-3 py-2.5 text-left">Customer</th>
                  <th className="px-3 py-2.5 text-right">Amount</th>
                  <th className="px-3 py-2.5 text-left">Valid until</th>
                  <th className="px-3 py-2.5 text-center">Status</th>
                  <th className="px-3 py-2.5 text-center">Files</th>
                  <th className="px-3 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotations.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-14 text-center">
                      <div className="text-slate-400 text-sm">No quotations match your filters</div>
                      {hasPerm('sales.sales-quotation.create') && (
                        <button type="button" onClick={openCreate} className="mt-3 text-blue-700 text-xs font-semibold hover:underline">Create first quotation</button>
                      )}
                    </td>
                  </tr>
                )}
                {quotations.map((q) => (
                  <tr key={q.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-3 py-2.5 font-mono font-semibold text-blue-700 cursor-pointer hover:underline" onClick={() => viewQuotation(q.id)}>{q.sq_number}</td>
                    <td className="px-3 py-2.5 text-slate-600">{formatDate(q.created_at)}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-800">{q.customer_name}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatCurrency(q.total)}</td>
                    <td className="px-3 py-2.5">
                      {q.valid_until ? (
                        <span className={isPastDate(q.valid_until) && !['Expired', 'Cancelled', 'Approved'].includes(q.status) ? 'text-amber-700 font-medium' : 'text-slate-600'}>
                          {formatDate(q.valid_until)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center"><SalesStatusBadge status={q.status} /></td>
                    <td className="px-3 py-2.5 text-center">
                      <button type="button" onClick={() => openAttachments(q)} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="Attachments"><Paperclip size={14} /></button>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50/80 p-0.5">
                        {q.status === 'Draft' && hasPerm('sales.sales-quotation.edit') && (
                          <button type="button" onClick={() => openEdit(q.id)} className="p-1.5 hover:bg-white rounded-md text-blue-600" title="Edit"><Edit2 size={14} /></button>
                        )}
                        {q.status === 'Draft' && hasPerm('sales.sales-quotation.edit') && (
                          <button type="button" onClick={() => changeStatus(q.id, 'Sent')} className="p-1.5 hover:bg-white rounded-md text-blue-600" title="Mark sent"><Send size={14} /></button>
                        )}
                        {q.status === 'Sent' && hasPerm('sales.sales-quotation.edit') && (
                          <button type="button" onClick={() => changeStatus(q.id, 'Approved')} className="p-1.5 hover:bg-white rounded-md text-emerald-600" title="Approve"><CheckCircle size={14} /></button>
                        )}
                        {['Sent', 'Approved'].includes(q.status) && (
                          <CopyToMenu sourceType="SQ" docId={q.id} doc={q} hasPerm={hasPerm} variant="list" />
                        )}
                        {q.status === 'Approved' && hasPerm('sales.sales-quotation.edit') && (
                          <button type="button" onClick={() => openEdit(q.id)} className="p-1.5 hover:bg-white rounded-md text-blue-600" title="Edit"><Edit2 size={14} /></button>
                        )}
                        {q.status !== 'Cancelled' && (
                          <button type="button" onClick={() => viewQuotation(q.id)} className="p-1.5 hover:bg-white rounded-md text-blue-600" title="Preview"><Eye size={14} /></button>
                        )}
                        <button type="button" onClick={() => printDocument(`/api/sales-quotations/${q.id}/print`)}
                          className="p-1.5 hover:bg-white rounded-md text-emerald-600" title="Print"><Printer size={14} /></button>
                        {q.status !== 'Cancelled' && hasPerm('sales.sales-quotation.edit') && (
                          <button type="button" onClick={() => changeStatus(q.id, 'Cancelled')} className="p-1.5 hover:bg-white rounded-md text-red-600" title="Cancel"><XCircle size={14} /></button>
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

        <div className="w-80 flex-shrink-0 border-l border-slate-200 bg-white p-4 space-y-4 overflow-y-auto">
          <SalesKpiCard label="Draft (unsent)" value={pendingSend} hint="Mark as Sent when emailed to customer" tone="blue" />
          <SalesKpiCard label="Ready for sales order" value={readyForSo} hint="Use Copy to SO after approval" tone="green" />
          <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-4 text-[11px] text-blue-900 leading-relaxed space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Workflow</div>
            <ol className="list-decimal list-inside space-y-1 text-blue-800">
              <li>Create draft quotation</li>
              <li>Send to customer</li>
              <li>Mark approved when accepted</li>
              <li>Copy to Sales Order</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Attachment Modal */}
      {attachModal.open && attachModal.sq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div>
                <h3 className="font-semibold text-sm text-slate-900">Attachments</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">{attachModal.sq.sq_number}</p>
              </div>
              <button type="button" onClick={() => setAttachModal({ open: false, sq: null, files: [] })} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} /></button>
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
