import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { ArrowLeft, Eye, Package, Printer, Search, FileText } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { buildReceiveFormFromPo, fetchPoForReceive, navigateApvFromGr } from '../../lib/purchaseCopy';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import { convertToBaseQty, resolvePurchaseUom, resolveReceiveUomFromPoLine } from '../../lib/uomUtils';
import { printDocument } from '../../lib/printDocument';

const PRIMARY = '#1E40AF';

const STATUS_COLORS: Record<string, string> = {
  Completed: 'bg-green-100 text-green-700',
  Draft: 'bg-gray-100 text-gray-700',
  Cancelled: 'bg-red-100 text-red-700',
};

export default function GoodsReceipts() {
  const { hasPerm } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [receipts, setReceipts] = useState<any[]>([]);
  const [pendingPOs, setPendingPOs] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [receiving, setReceiving] = useState(false);
  const [receiveForm, setReceiveForm] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const [viewing, setViewing] = useState(false);
  const [viewGr, setViewGr] = useState<any>(null);

  const limit = 20;

  const loadReceipts = () => {
    setLoading(true);
    api.get(`/purchases/receipts?page=${page}&limit=${limit}`)
      .then((r) => { setReceipts(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load goods receipts'))
      .finally(() => setLoading(false));
  };

  const loadPendingPOs = () => {
    api.get('/purchases/orders?limit=50&status=Sent')
      .then((r) => {
        const sent = r.data.data || [];
        return api.get('/purchases/orders?limit=50&status=Partial').then((r2) => {
          setPendingPOs([...sent, ...(r2.data.data || [])]);
        });
      })
      .catch(() => {});
  };

  useEffect(() => { loadReceipts(); }, [page]);
  useEffect(() => { loadPendingPOs(); }, []);
  useEffect(() => {
    api.get('/inventory/locations').then((r) => setLocations(r.data || [])).catch(() => {
      setLocations([{ id: 1, name: 'Store' }, { id: 2, name: 'Warehouse' }]);
    });
  }, []);

  const startReceiveFromPo = async (poId: string) => {
    try {
      const po = await fetchPoForReceive(poId);
      if (!['Sent', 'Partial'].includes(po.status)) {
        toast.error('Only Sent or Partial POs can be received');
        return;
      }
      const form = buildReceiveFormFromPo(po);
      if (form.items.length === 0) {
        toast.error('No remaining quantity to receive on this PO');
        return;
      }
      const items = await Promise.all(form.items.map(async (item: any) => {
        try {
          const ur = await api.get(`/products/${item.product_id}/uoms`);
          const uoms = ur.data || [];
          const def = resolveReceiveUomFromPoLine(uoms, {
            uom_id: item.uom_id,
            conversion_to_base: item.conversion_to_base,
            unit_cost: item.unit_cost,
            net_unit_cost: item.net_unit_cost,
            unit_of_measure: item.unit_of_measure,
          });
          return {
            ...item,
            uoms,
            uom_id: def?.uom_id ?? item.uom_id,
            conversion_to_base: def?.conversion_to_base ?? item.conversion_to_base ?? 1,
            unit_of_measure: def?.uom_code || item.unit_of_measure || 'pc',
            entered_qty: item.quantity,
          };
        } catch {
          return { ...item, uoms: [], entered_qty: item.quantity };
        }
      }));
      setReceiveForm({ ...form, items });
      setReceiving(true);
    } catch {
      toast.error('Failed to load purchase order');
    }
  };

  useEffect(() => {
    const poId = searchParams.get('receive_from_po');
    if (!poId) return;
    const copyKey = `gr-po:${poId}`;
    if (!beginCopyNavigation(copyKey)) return;
    setSearchParams({}, { replace: true });
    startReceiveFromPo(poId).finally(() => endCopyNavigation(copyKey));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const updateReceiveItem = (idx: number, field: string, value: any) => {
    setReceiveForm((prev: any) => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], [field]: value };
      if (field === 'uom_id' && value) {
        const uom = resolvePurchaseUom(items[idx].uoms || [], parseInt(String(value), 10), null);
        if (uom) {
          items[idx].uom_id = uom.uom_id;
          items[idx].conversion_to_base = uom.conversion_to_base;
          items[idx].unit_of_measure = uom.uom_code || items[idx].unit_of_measure;
          const uomCost = parseFloat(String(uom.purchase_price));
          if (uomCost > 0) {
            items[idx].net_unit_cost = uomCost;
            items[idx].unit_cost = uomCost;
          }
        }
      }
      return { ...prev, items };
    });
  };

  const receiveTotal = (receiveForm?.items || []).reduce(
    (s: number, i: any) => s + parseFloat(i.quantity || 0) * parseFloat(i.net_unit_cost || i.unit_cost || 0),
    0
  );

  const submitReceive = async () => {
    if (!receiveForm?.items?.length) { toast.error('No items to receive'); return; }
    for (const item of receiveForm.items) {
      if (parseFloat(item.quantity) <= 0) { toast.error('Quantity must be greater than zero'); return; }
    }
    setSubmitting(true);
    try {
      const res = await api.post('/purchases/receipts', {
        po_id: receiveForm.po_id,
        supplier_id: receiveForm.supplier_id,
        location_id: receiveForm.location_id,
        supplier_invoice_number: receiveForm.supplier_invoice_number,
        notes: receiveForm.notes,
        terms_conditions: receiveForm.terms_conditions,
        items: receiveForm.items.map((i: any) => {
          const uom = resolvePurchaseUom(i.uoms || [], i.uom_id, null);
          const enteredQty = parseFloat(i.quantity);
          const conversion = uom?.conversion_to_base ?? i.conversion_to_base ?? 1;
          return {
            po_item_id: i.po_item_id,
            product_id: i.product_id,
            quantity: enteredQty,
            entered_qty: enteredQty,
            uom_id: i.uom_id || uom?.uom_id || null,
            conversion_to_base: conversion,
            base_qty: convertToBaseQty(enteredQty, conversion),
            unit_cost: parseFloat(i.unit_cost),
            net_unit_cost: parseFloat(i.net_unit_cost || i.unit_cost),
            discount_amount: parseFloat(i.discount_amount || 0),
            batch_number: i.batch_number,
            expiry_date: i.expiry_date || undefined,
          };
        }),
      });
      toast.success(`Goods receipt ${res.data.gr_number} created`);
      setReceiving(false);
      setReceiveForm(null);
      loadReceipts();
      loadPendingPOs();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to receive stock');
    } finally {
      setSubmitting(false);
    }
  };

  const viewReceipt = async (id: string) => {
    try {
      const r = await api.get(`/purchases/receipts/${id}`);
      setViewGr(r.data);
      setViewing(true);
    } catch {
      toast.error('Failed to load receipt');
    }
  };

  const filteredReceipts = receipts.filter((gr) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      gr.gr_number?.toLowerCase().includes(q) ||
      gr.supplier_name?.toLowerCase().includes(q) ||
      gr.po_number?.toLowerCase().includes(q) ||
      gr.supplier_invoice_number?.toLowerCase().includes(q)
    );
  });

  // ========== VIEW ==========
  if (viewing && viewGr) {
    const printDoc = () => printDocument(`/api/purchases/receipts/${viewGr.id}/print`);
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Goods Receipt</h1>
            <span className="text-xs font-mono text-white/80">{viewGr.gr_number}</span>
            <span className={`px-2 py-0.5 text-xs rounded-full ${STATUS_COLORS[viewGr.status] || 'bg-gray-100 text-gray-700'}`}>{viewGr.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {viewGr.status === 'Completed' && hasPerm('purchases.apv.create') && (
              <button onClick={() => { setViewing(false); navigateApvFromGr(navigate, viewGr.id); }}
                className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-bold hover:bg-amber-600"><FileText size={13} /> Copy to APV</button>
            )}
            <button onClick={printDoc} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"><Printer size={13} /> Print</button>
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe ref={iframeRef} src={`/api/purchases/receipts/${viewGr.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow" style={{ width: '800px', minHeight: '1100px' }} title="GR Preview" />
        </div>
      </div>
    );
  }

  // ========== RECEIVE ==========
  if (receiving && receiveForm) {
    const totalQty = receiveForm.items.reduce((s: number, i: any) => s + parseFloat(i.quantity || 0), 0);
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => { setReceiving(false); setReceiveForm(null); }} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Receive Goods</h1>
            <span className="text-xs font-mono text-white/80">PO {receiveForm.po_number}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={submitReceive} disabled={submitting}
              className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
              {submitting ? 'Saving…' : 'Complete Receipt'}
            </button>
            <button onClick={() => { setReceiving(false); setReceiveForm(null); }} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Supplier & PO</div>
                <div className="text-sm font-medium text-gray-900">{receiveForm.supplier_name || '—'}</div>
                <div className="text-xs text-gray-500 font-mono">PO Ref: {receiveForm.po_number}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Receipt Details</div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Receive Location *</label>
                  <select value={receiveForm.location_id} onChange={(e) => setReceiveForm({ ...receiveForm, location_id: parseInt(e.target.value) })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                    {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Supplier Invoice #</label>
                  <input type="text" value={receiveForm.supplier_invoice_number || ''}
                    onChange={(e) => setReceiveForm({ ...receiveForm, supplier_invoice_number: e.target.value })}
                    placeholder="Supplier SI / DR number" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">3 · Items to Receive</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-2 py-2 text-left">Product</th>
                      <th className="px-2 py-2 text-center w-20">Ordered</th>
                      <th className="px-2 py-2 text-center w-20">Recv Qty</th>
                      <th className="px-2 py-2 text-center w-20">UOM</th>
                      <th className="px-2 py-2 text-center w-24">= Base</th>
                      <th className="px-2 py-2 text-right w-24">Net Cost</th>
                      <th className="px-2 py-2 text-left w-28">Batch #</th>
                      <th className="px-2 py-2 text-left w-28">Expiry</th>
                      <th className="px-2 py-2 text-right w-24">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {receiveForm.items.map((item: any, i: number) => {
                      const lineTotal = parseFloat(item.quantity || 0) * parseFloat(item.net_unit_cost || item.unit_cost || 0);
                      const uom = resolvePurchaseUom(item.uoms || [], item.uom_id, null);
                      const basePreview = convertToBaseQty(
                        parseFloat(item.quantity || 0),
                        uom?.conversion_to_base ?? item.conversion_to_base ?? 1,
                      );
                      return (
                        <tr key={i} className="hover:bg-blue-50/30">
                          <td className="px-2 py-2">
                            <div className="font-medium text-gray-800">{item.product_name}</div>
                            <div className="text-[10px] text-gray-400">{item.sku}</div>
                          </td>
                          <td className="px-2 py-2 text-center text-gray-500">
                            {item.already_received} / {item.ordered_qty}
                            <span className="block text-[9px] uppercase text-gray-400">{(uom?.uom_code || item.unit_of_measure || 'pc')}</span>
                          </td>
                          <td className="px-2 py-2">
                            <input type="number" step="any" min="0" value={item.quantity}
                              onChange={(e) => updateReceiveItem(i, 'quantity', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-center text-xs" />
                          </td>
                          <td className="px-2 py-2">
                            {(item.uoms?.length || 0) > 1 ? (
                              <select value={item.uom_id || ''} onChange={(e) => updateReceiveItem(i, 'uom_id', parseInt(e.target.value, 10))}
                                className="w-full px-1 py-1 border border-gray-200 rounded text-xs uppercase">
                                {(item.uoms || []).map((u: any) => (
                                  <option key={u.uom_id} value={u.uom_id}>{(u.uom_code || '').toUpperCase()}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs uppercase text-gray-600">{(uom?.uom_code || 'pc').toUpperCase()}</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center text-xs text-gray-600">{basePreview} pc</td>
                          <td className="px-2 py-2 text-right font-mono">{formatCurrency(parseFloat(item.net_unit_cost || item.unit_cost))}</td>
                          <td className="px-2 py-2">
                            <input type="text" value={item.batch_number || ''} onChange={(e) => updateReceiveItem(i, 'batch_number', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                          </td>
                          <td className="px-2 py-2">
                            <input type="date" value={item.expiry_date || ''} onChange={(e) => updateReceiveItem(i, 'expiry_date', e.target.value)}
                              className="w-full px-2 py-1 border border-gray-200 rounded text-xs" />
                          </td>
                          <td className="px-2 py-2 text-right font-semibold">{formatCurrency(lineTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <DocumentNotesTermsPanel
              sectionLabel="4 · Notes & Terms"
              notes={receiveForm.notes || ''}
              termsConditions={receiveForm.terms_conditions || ''}
              onNotesChange={(v) => setReceiveForm({ ...receiveForm, notes: v })}
              onTermsChange={(v) => setReceiveForm({ ...receiveForm, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.GoodsReceipt}
              referenceId=""
              notesPlaceholder="Receiving notes, batch remarks, or inspection details..."
            />
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Receipt Summary</div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Line Items</span><span className="font-medium">{receiveForm.items.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Qty</span><span className="font-medium">{totalQty}</span></div>
                <div className="flex justify-between pt-2 border-t-2 border-blue-900 text-sm font-bold text-blue-900">
                  <span>Total Value</span><span>{formatCurrency(receiveTotal)}</span>
                </div>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800 leading-relaxed">
              Completing this receipt updates inventory, batch records, PO received quantities, and creates AP journal entries.
            </div>
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
          <Package size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Goods Receipts</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{total} records</span>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="GR #, PO, supplier, invoice…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Receipt History</div>
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">GR #</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">PO Ref</th>
                      <th className="px-3 py-2 text-left">Supplier</th>
                      <th className="px-3 py-2 text-left">Location</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2 text-center">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredReceipts.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No goods receipts found</td></tr>
                    )}
                    {filteredReceipts.map((gr) => (
                      <tr key={gr.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium text-blue-700">{gr.gr_number}</td>
                        <td className="px-3 py-2">{formatDate(gr.received_date)}</td>
                        <td className="px-3 py-2 font-mono text-gray-600">{gr.po_number || '—'}</td>
                        <td className="px-3 py-2">{gr.supplier_name || '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{gr.location_name || '—'}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(parseFloat(gr.total_amount || 0))}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] ${STATUS_COLORS[gr.status] || 'bg-gray-100 text-gray-700'}`}>{gr.status}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => viewReceipt(gr.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="View"><Eye size={14} /></button>
                            {gr.status === 'Completed' && hasPerm('purchases.apv.create') && (
                              <button onClick={() => navigateApvFromGr(navigate, gr.id)} className="p-1 hover:bg-amber-50 rounded text-amber-700" title="Copy to APV"><FileText size={14} /></button>
                            )}
                            <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/purchases/receipts/${gr.id}/print?token=${t}`, '_blank'); }}
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
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Pending Receive</div>
            <p className="text-xs text-gray-500 mb-3">POs awaiting goods receipt</p>
            {pendingPOs.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No open POs</p>
            ) : (
              <div className="space-y-2">
                {pendingPOs.slice(0, 12).map((po) => (
                  <div key={po.id} className="border border-gray-100 rounded-lg p-2.5 hover:border-blue-200">
                    <div className="font-mono text-[10px] text-blue-700">{po.po_number}</div>
                    <div className="text-xs font-medium text-gray-800 truncate">{po.supplier_name}</div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${po.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>{po.status}</span>
                      {hasPerm('purchases.receiving-report.create') && (
                        <button onClick={() => startReceiveFromPo(po.id)}
                          className="text-[10px] font-semibold text-green-700 hover:text-green-900">Receive →</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-[10px] text-gray-500 leading-relaxed">
            Tip: From Purchase Orders, click <strong>Receive</strong> to open this page pre-filled from the PO.
          </div>
          <Link to="/purchases" className="block text-center text-xs text-blue-600 hover:underline">View Purchase Orders →</Link>
        </div>
      </div>
    </div>
  );
}
