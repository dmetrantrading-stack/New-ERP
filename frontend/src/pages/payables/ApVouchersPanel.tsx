import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, ArrowLeft, Eye, Edit2, Printer, Search, Wallet, FileText } from 'lucide-react';
import Pagination from '../../components/Pagination';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { buildApvFormFromCopy, fetchGrCopyToApv, fetchPoCopyToApv, navigatePayApv } from '../../lib/purchaseCopy';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';
import { PRIMARY, blankApvItem, statusBadgeClass } from '../../lib/payablesUtils';
import { printDocument } from '../../lib/printDocument';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import { calculatePurchaseTax, normalizePurchaseVatMode, PURCHASE_COST_BASIS_OPTIONS, PURCHASE_TAX_TYPE_OPTIONS } from '../../lib/purchaseTax';

type Props = {
  suppliers: any[];
  products: any[];
  onRefresh: () => void;
};

export default function ApVouchersPanel({ suppliers, products, onRefresh }: Props) {
  const { hasPerm } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [apvs, setApvs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<'list' | 'form' | 'view'>('list');
  const [editingAPV, setEditingAPV] = useState<any>(null);
  const [viewApv, setViewApv] = useState<any>(null);
  const [apvForm, setApvForm] = useState<any>({
    supplier_id: '', po_id: '', gr_id: '', apv_date: new Date().toISOString().split('T')[0],
    due_date: '', payment_terms: '', supplier_invoice_number: '', supplier_invoice_date: '', notes: '', terms_conditions: '', vat_mode: 'VAT Inclusive', items: [],
  });
  const [autoFocusApvItem, setAutoFocusApvItem] = useState(false);
  const [goodsReceipts, setGoodsReceipts] = useState<any[]>([]);
  const [supplierPOs, setSupplierPOs] = useState<any[]>([]);

  const limit = 20;

  const loadApvSupplierRefs = (sid: string) => {
    if (!sid) return;
    api.get('/payables/goods-receipts/' + sid).then((r) => setGoodsReceipts(r.data || [])).catch(() => {});
    api.get('/payables/supplier-pos/' + sid).then((r) => setSupplierPOs(r.data || [])).catch(() => {});
  };

  const loadAPVs = () => {
    setLoading(true);
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', String(limit));
    if (statusFilter) p.set('status', statusFilter);
    if (search.trim()) p.set('search', search.trim());
    api.get('/payables/apv?' + p)
      .then((r) => { setApvs(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load APVs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAPVs(); }, [page, statusFilter]);

  useEffect(() => {
    const poId = searchParams.get('copy_from_po');
    const grId = searchParams.get('copy_from_gr');
    const copyKey = poId ? `apv-po:${poId}` : grId ? `apv-gr:${grId}` : '';
    if (!copyKey || !beginCopyNavigation(copyKey)) return;
    setSearchParams({}, { replace: true });
    (async () => {
      try {
        const payload = poId ? await fetchPoCopyToApv(poId) : await fetchGrCopyToApv(grId!);
        setApvForm(buildApvFormFromCopy(payload));
        setAutoFocusApvItem(false);
        setEditingAPV(null);
        setMode('form');
        if (payload.supplier_id) loadApvSupplierRefs(String(payload.supplier_id));
        toast.success(`Copied from ${payload.source_po_number || payload.source_gr_number}`);
      } catch (err: any) {
        toast.error(err.response?.data?.error || 'Failed to copy');
      } finally {
        endCopyNavigation(copyKey);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const selectApvSupplier = (sid: string) => {
    if (!sid) {
      setAutoFocusApvItem(false);
      setApvForm((f: any) => ({ ...f, supplier_id: '', po_id: '', gr_id: '', items: [] }));
      setGoodsReceipts([]);
      setSupplierPOs([]);
      return;
    }
    setApvForm((f: any) => ({ ...f, supplier_id: sid, po_id: '', gr_id: '', items: [blankApvItem()] }));
    setAutoFocusApvItem(true);
    loadApvSupplierRefs(sid);
  };

  const resetForm = () => {
    setAutoFocusApvItem(false);
    setApvForm({
      supplier_id: '', po_id: '', gr_id: '', apv_date: new Date().toISOString().split('T')[0],
      due_date: '', payment_terms: '', supplier_invoice_number: '', supplier_invoice_date: '', notes: '', terms_conditions: '', vat_mode: 'VAT Inclusive', items: [],
    });
    setEditingAPV(null);
    setMode('list');
  };

  const addAPVItem = () => setApvForm((f: any) => ({ ...f, items: [...f.items, blankApvItem()] }));
  const removeAPVItem = (i: number) => setApvForm((f: any) => ({ ...f, items: f.items.filter((_: any, idx: number) => idx !== i) }));
  const updateAPVItem = (i: number, field: string, value: any) => {
    setApvForm((f: any) => { const items = [...f.items]; items[i] = { ...items[i], [field]: value }; return { ...f, items }; });
  };

  const apvVatMode = normalizePurchaseVatMode(apvForm.vat_mode);
  const apvTaxTotals = useMemo(() => calculatePurchaseTax(apvForm.items, apvVatMode), [apvForm.items, apvVatMode]);
  const apvLockedVatMode = !!(apvForm.po_id || apvForm.gr_id);

  const saveAPV = async () => {
    if (!hasPerm('purchases.apv.create')) { toast.error('No permission'); return; }
    if (!apvForm.supplier_id) { toast.error('Select a supplier'); return; }
    const items = apvForm.items.filter((it: any) => it.product_id);
    if (items.length === 0) { toast.error('Add at least one item'); return; }
    try {
      const payload = {
        ...apvForm,
        items: items.map((it: any) => ({
          ...it, qty: parseFloat(it.qty), unit_cost: parseFloat(it.unit_cost), discount_amount: parseFloat(it.discount_amount || 0),
        })),
      };
      if (editingAPV) {
        await api.patch('/payables/apv/' + editingAPV.id, payload);
        toast.success('APV updated');
      } else {
        const res = await api.post('/payables/apv', payload);
        toast.success('APV ' + res.data.apv_number + ' created');
      }
      resetForm();
      loadAPVs();
      onRefresh();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const postAPV = async (id: string) => {
    if (!hasPerm('purchases.apv.approve')) { toast.error('No permission'); return; }
    if (!confirm('Post this APV? Supplier balance will be updated.')) return;
    try {
      await api.post('/payables/apv/' + id + '/post');
      toast.success('APV posted');
      loadAPVs();
      onRefresh();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const deleteAPV = async (id: string) => {
    if (!confirm('Delete this draft APV?')) return;
    try {
      await api.delete('/payables/apv/' + id);
      toast.success('Deleted');
      loadAPVs();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const editAPV = async (id: string) => {
    try {
      const r = await api.get('/payables/apv/' + id);
      const o = r.data;
      setApvForm({
        supplier_id: o.supplier_id || '', po_id: o.po_id || '', gr_id: o.gr_id || '',
        apv_date: o.apv_date || '', due_date: o.due_date || '', payment_terms: o.payment_terms || '',
        supplier_invoice_number: o.supplier_invoice_number || '', supplier_invoice_date: o.supplier_invoice_date || '',
        notes: o.notes || '',
        terms_conditions: o.terms_conditions || '',
        vat_mode: normalizePurchaseVatMode(o.po_vat_mode || o.vat_mode),
        items: (o.items || []).map((i: any) => ({
          product_id: i.product_id, description: i.description || '', qty: parseFloat(i.qty),
          uom: i.uom || 'pc', unit_cost: parseFloat(i.unit_cost), discount_amount: parseFloat(i.discount_amount || 0),
          tax_type: i.tax_type || 'VAT',
        })),
      });
      if (o.supplier_id) loadApvSupplierRefs(String(o.supplier_id));
      setAutoFocusApvItem(false);
      setEditingAPV(o);
      setMode('form');
    } catch { toast.error('Error loading APV'); }
  };

  const viewAPV = (a: any) => { setViewApv(a); setMode('view'); };

  const loadPoItems = (poId: string) => {
    Promise.all([
      api.get('/payables/po-items/' + poId),
      api.get('/purchases/orders/' + poId),
    ]).then(([itemsRes, poRes]) => {
      const items = (itemsRes.data || []).map((pi: any) => ({
        product_id: pi.product_id, description: pi.product_name, qty: pi.quantity,
        uom: pi.unit_of_measure || 'pc', unit_cost: pi.net_unit_cost || pi.unit_cost,
        discount_amount: pi.discount_amount || 0, tax_type: pi.tax_type || 'VAT',
      }));
      setApvForm((f: any) => ({
        ...f,
        po_id: poId,
        gr_id: '',
        vat_mode: normalizePurchaseVatMode(poRes.data?.vat_mode),
        items,
      }));
      setAutoFocusApvItem(false);
    }).catch(() => toast.error('Failed to load PO items'));
  };

  const loadGrItems = (grId: string) => {
    const selectedGR = goodsReceipts.find((gr: any) => gr.id === grId);
    const poId = selectedGR?.po_id;
    const requests: Promise<any>[] = [api.get('/payables/gr-items/' + grId)];
    if (poId) requests.push(api.get('/purchases/orders/' + poId));
    Promise.all(requests).then(([itemsRes, poRes]) => {
      const items = (itemsRes.data || []).map((gi: any) => ({
        product_id: gi.product_id, description: gi.product_name, qty: gi.quantity,
        uom: gi.unit_of_measure || 'pc', unit_cost: gi.net_unit_cost || gi.unit_cost,
        discount_amount: gi.discount_amount || 0, gr_id: grId, tax_type: gi.tax_type || 'VAT',
      }));
      setApvForm((f: any) => ({
        ...f,
        gr_id: grId,
        po_id: poId || f.po_id,
        vat_mode: poRes ? normalizePurchaseVatMode(poRes.data?.vat_mode) : f.vat_mode,
        supplier_invoice_number: selectedGR?.supplier_invoice_number || f.supplier_invoice_number,
        items,
      }));
      setAutoFocusApvItem(false);
    }).catch(() => toast.error('Failed to load GR items'));
  };

  // ========== VIEW ==========
  if (mode === 'view' && viewApv) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setMode('list')} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <span className="text-white font-semibold text-sm">AP Voucher</span>
            <span className="text-xs font-mono text-white/80">{viewApv.apv_number}</span>
            <span className={statusBadgeClass(viewApv.status)}>{viewApv.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {['Posted', 'Partially Paid'].includes(viewApv.status) && hasPerm('purchases.apv.create') && (
              <button
                onClick={() => navigate(`/purchase-memos?supplier_id=${viewApv.supplier_id}&apv_id=${viewApv.id}`)}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-bold hover:bg-amber-600"
              >
                <FileText size={13} /> Credit Memo
              </button>
            )}
            {['Posted', 'Partially Paid'].includes(viewApv.status) && hasPerm('purchases.apv.view') && (
              <button onClick={() => navigate(navigatePayApv(viewApv.id))}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded text-xs font-bold hover:bg-green-600">
                <Wallet size={13} /> Pay
              </button>
            )}
            <button onClick={() => printDocument(`/api/payables/apv/${viewApv.id}/print`)}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">
              <Printer size={13} /> Print
            </button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe ref={iframeRef} src={`/api/payables/apv/${viewApv.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow" style={{ width: '800px', minHeight: '1100px' }} title="APV Preview" />
        </div>
      </div>
    );
  }

  // ========== FORM ==========
  if (mode === 'form') {
    return (
      <div className="h-full flex flex-col bg-gray-50">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={resetForm} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <span className="text-white font-semibold text-sm">{editingAPV ? 'Edit AP Voucher' : 'Create AP Voucher'}</span>
            <span className="text-xs font-mono text-white/80">{editingAPV?.apv_number || 'NEW'}</span>
          </div>
          <button onClick={saveAPV} disabled={!hasPerm('purchases.apv.create')}
            className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
            {editingAPV ? 'Update Draft' : 'Save Draft'}
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Supplier</div>
                <select value={apvForm.supplier_id} onChange={(e) => selectApvSupplier(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs">
                  <option value="">Select supplier</option>
                  {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
                {supplierPOs.length > 0 && (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Load from PO</label>
                    <select value={apvForm.po_id} onChange={(e) => e.target.value && loadPoItems(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      <option value="">—</option>
                      {supplierPOs.map((po: any) => (
                        <option key={po.id} value={po.id}>{po.po_number} · {formatCurrency(po.total)}</option>
                      ))}
                    </select>
                  </div>
                )}
                {goodsReceipts.length > 0 && (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Load from GR</label>
                    <select value={apvForm.gr_id} onChange={(e) => e.target.value && loadGrItems(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      <option value="">—</option>
                      {goodsReceipts.map((gr: any) => (
                        <option key={gr.id} value={gr.id}>{gr.gr_number}{gr.po_number ? ` (${gr.po_number})` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Invoice Details</div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-gray-400 uppercase">APV Date</label>
                    <input type="date" value={apvForm.apv_date} onChange={(e) => setApvForm({ ...apvForm, apv_date: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-xs mt-0.5" /></div>
                  <div><label className="text-[10px] text-gray-400 uppercase">Due Date</label>
                    <input type="date" value={apvForm.due_date} onChange={(e) => setApvForm({ ...apvForm, due_date: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-xs mt-0.5" /></div>
                  <div><label className="text-[10px] text-gray-400 uppercase">Supplier Inv #</label>
                    <input type="text" value={apvForm.supplier_invoice_number} onChange={(e) => setApvForm({ ...apvForm, supplier_invoice_number: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-xs mt-0.5" /></div>
                  <div><label className="text-[10px] text-gray-400 uppercase">Supplier Inv Date</label>
                    <input type="date" value={apvForm.supplier_invoice_date} onChange={(e) => setApvForm({ ...apvForm, supplier_invoice_date: e.target.value })}
                      className="w-full px-2 py-1 border rounded text-xs mt-0.5" /></div>
                </div>
                <input type="text" value={apvForm.payment_terms} placeholder="Payment terms" onChange={(e) => setApvForm({ ...apvForm, payment_terms: e.target.value })}
                  className="w-full px-2 py-1 border rounded text-xs" />
                <div>
                  <label className="text-[10px] text-gray-400 uppercase">Cost Basis</label>
                  <select
                    value={apvVatMode}
                    disabled={apvLockedVatMode}
                    onChange={(e) => setApvForm({ ...apvForm, vat_mode: e.target.value })}
                    className="w-full px-2 py-1 border rounded text-xs mt-0.5 disabled:bg-gray-50 disabled:text-gray-500"
                  >
                    {PURCHASE_COST_BASIS_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  {apvLockedVatMode && (
                    <p className="text-[10px] text-gray-400 mt-0.5">From linked PO · VAT lines only</p>
                  )}
                </div>
              </div>
            </div>

            <DocumentNotesTermsPanel
              sectionLabel="3 · Notes & Terms"
              notes={apvForm.notes || ''}
              termsConditions={apvForm.terms_conditions || ''}
              onNotesChange={(v) => setApvForm({ ...apvForm, notes: v })}
              onTermsChange={(v) => setApvForm({ ...apvForm, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.ApVoucher}
              referenceId={editingAPV?.id || ''}
              notesPlaceholder="APV remarks or supplier invoice notes..."
            />

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b flex justify-between items-center">
                <span className="text-[10px] font-semibold text-gray-400 uppercase">4 · Line Items</span>
                <button onClick={addAPVItem} className="text-xs text-blue-600 font-semibold">+ Add row</button>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="bg-gray-50 text-[9px] uppercase text-gray-500">
                  <th className="px-2 py-2 text-left">Description</th>
                  <th className="px-2 w-14">UOM</th>
                  <th className="px-2 w-16">Qty</th>
                  <th className="px-2 w-20 text-right">Cost</th>
                  <th className="px-2 w-16 text-right">Disc</th>
                  <th className="px-2 w-16 text-center">Tax</th>
                  <th className="px-2 w-20 text-right">Amount</th>
                  <th className="w-8"></th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {apvForm.items.map((it: any, i: number) => {
                    const product = products.find((p) => p.id === it.product_id);
                    const netAmt = ((parseFloat(it.qty) || 0) * (parseFloat(it.unit_cost) || 0)) - (parseFloat(it.discount_amount) || 0);
                    return (
                      <tr key={i}>
                        <td className="px-2 py-1">
                          <ProductAutocomplete products={products} value={it.product_id} selectedName={product?.name || it.description || ''}
                            getPrice={(p) => p.cost || 0} placeholder="Search…" autoFocus={autoFocusApvItem && i === 0}
                            onSelect={(p) => {
                              setApvForm((prev: any) => {
                                const items = [...prev.items];
                                items[i] = { ...items[i], product_id: p.id, description: p.name, unit_cost: p.cost || 0, uom: p.unit_of_measure || 'pc' };
                                if (i === prev.items.length - 1) {
                                  setTimeout(() => setApvForm((p2: any) => ({ ...p2, items: [...p2.items, blankApvItem()] })), 100);
                                }
                                return { ...prev, items };
                              });
                              setAutoFocusApvItem(false);
                            }} />
                        </td>
                        <td className="px-1"><select value={it.uom} onChange={(e) => updateAPVItem(i, 'uom', e.target.value)} className="w-full border rounded text-[10px] px-1 py-1">
                          {['pc', 'pcs', 'kg', 'case', 'box', 'L'].map((u) => <option key={u}>{u}</option>)}
                        </select></td>
                        <td className="px-1"><input type="number" value={it.qty} onChange={(e) => updateAPVItem(i, 'qty', e.target.value)} className="w-full border rounded text-center text-xs px-1 py-1" /></td>
                        <td className="px-1"><input type="number" value={it.unit_cost} onChange={(e) => updateAPVItem(i, 'unit_cost', e.target.value)} className="w-full border rounded text-right text-xs px-1 py-1" /></td>
                        <td className="px-1"><input type="number" value={it.discount_amount} onChange={(e) => updateAPVItem(i, 'discount_amount', e.target.value)} className="w-full border rounded text-right text-xs px-1 py-1" /></td>
                        <td className="px-1">
                          <select value={it.tax_type || 'VAT'} onChange={(e) => updateAPVItem(i, 'tax_type', e.target.value)}
                            className="w-full border rounded text-[10px] px-1 py-1">
                            {PURCHASE_TAX_TYPE_OPTIONS.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 text-right font-medium">{formatCurrency(netAmt)}</td>
                        <td><button onClick={() => removeAPVItem(i)} className="text-red-500 text-xs">×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-3 overflow-y-auto">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Summary</div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-gray-500">Gross</span><span>{formatCurrency(apvTaxTotals.gross)}</span></div>
              {apvTaxTotals.discount > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">Discount</span><span className="text-red-600">-{formatCurrency(apvTaxTotals.discount)}</span></div>
              )}
              {apvTaxTotals.vatable > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">VATable</span><span>{formatCurrency(apvTaxTotals.vatable)}</span></div>
              )}
              {apvTaxTotals.vatExempt > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">VAT Exempt</span><span>{formatCurrency(apvTaxTotals.vatExempt)}</span></div>
              )}
              {apvTaxTotals.zeroRated > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">Zero Rated</span><span>{formatCurrency(apvTaxTotals.zeroRated)}</span></div>
              )}
              {apvTaxTotals.vat > 0 && (
                <div className="flex justify-between"><span className="text-gray-500">Input VAT</span><span>{formatCurrency(apvTaxTotals.vat)}</span></div>
              )}
              <div className="flex justify-between pt-2 border-t-2 border-blue-900 text-sm font-bold text-blue-900">
                <span>Total Payable</span><span>{formatCurrency(apvTaxTotals.total)}</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-500 leading-relaxed">Save as draft, then post to update supplier balance. GR-linked APVs use inventory GL from the receipt.</p>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST ==========
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-4 py-3 bg-white border-b flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadAPVs()}
              placeholder="Search APV #, supplier…" className="pl-7 pr-2 py-1.5 border rounded text-xs w-48" />
          </div>
          <button onClick={() => { setPage(1); loadAPVs(); }} className="px-2 py-1.5 border rounded text-xs hover:bg-gray-50">Search</button>
          {['', 'Draft', 'Posted', 'Partially Paid', 'Fully Paid'].map((s) => (
            <button key={s || 'all'} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-2 py-1 text-[10px] rounded-full ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>
        {hasPerm('purchases.apv.create') && (
          <button onClick={() => {
            setEditingAPV(null);
            setGoodsReceipts([]);
            setSupplierPOs([]);
            setApvForm({
              supplier_id: '', po_id: '', gr_id: '', apv_date: new Date().toISOString().split('T')[0],
              due_date: '', payment_terms: '', supplier_invoice_number: '', supplier_invoice_date: '', notes: '', terms_conditions: '',
              vat_mode: 'VAT Inclusive', items: [blankApvItem()],
            });
            setMode('form');
          }}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700">
            <Plus size={14} /> Create APV
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? <div className="py-12 text-center text-gray-400 text-sm">Loading…</div> : (
          <table className="w-full text-xs">
            <thead><tr className="bg-gray-50 text-[9px] uppercase text-gray-500 sticky top-0">
              <th className="px-3 py-2 text-left">APV #</th>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-left">Refs</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {apvs.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-gray-400">No AP vouchers</td></tr>}
              {apvs.map((a: any) => {
                const bal = parseFloat(a.total_amount) - parseFloat(a.amount_paid || 0);
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono font-medium text-blue-700 cursor-pointer hover:underline" onClick={() => viewAPV(a)}>{a.apv_number}</td>
                    <td className="px-3 py-2">{a.supplier_name}</td>
                    <td className="px-3 py-2 text-gray-500 text-[10px]">{[a.po_number, a.gr_number].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-3 py-2">{formatDate(a.apv_date)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatCurrency(a.total_amount)}</td>
                    <td className="px-3 py-2 text-right">{formatCurrency(bal)}</td>
                    <td className="px-3 py-2 text-center"><span className={statusBadgeClass(a.status)}>{a.status}</span></td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => viewAPV(a)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="View"><Eye size={14} /></button>
                        {a.status === 'Draft' && hasPerm('purchases.apv.create') && (
                          <button onClick={() => editAPV(a.id)} className="p-1 hover:bg-yellow-50 rounded text-yellow-600" title="Edit"><Edit2 size={14} /></button>
                        )}
                        {a.status === 'Draft' && hasPerm('purchases.apv.approve') && (
                          <button onClick={() => postAPV(a.id)} className="px-1.5 py-0.5 text-[10px] bg-green-100 text-green-700 rounded font-semibold">Post</button>
                        )}
                        {['Posted', 'Partially Paid'].includes(a.status) && bal > 0 && (
                          <button onClick={() => navigate(navigatePayApv(a.id))} className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-800 rounded font-semibold">Pay</button>
                        )}
                        {a.status === 'Draft' && (
                          <button onClick={() => deleteAPV(a.id)} className="p-1 text-red-500 text-xs">Del</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
    </div>
  );
}
