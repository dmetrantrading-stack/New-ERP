import React, { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, ArrowLeft, Eye, Printer, Search, RotateCcw, Receipt } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { buildReturnFormFromInvoiceCopy, fetchInvoiceCopyToReturn } from '../../lib/salesCopy';
import { printDocument } from '../../lib/printDocument';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';

const PRIMARY = '#1E40AF';

export default function SalesReturns() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [pickInvoice, setPickInvoice] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const limit = 20;

  const load = () => {
    setLoading(true);
    api.get(`/sales/returns?page=${page}&limit=${limit}`)
      .then((r) => { setReturns(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load sales returns'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);

  const startFromInvoice = async (invoiceId: string) => {
    try {
      const payload = await fetchInvoiceCopyToReturn(invoiceId);
      setForm(buildReturnFormFromInvoiceCopy(payload));
      setCreating(true);
      setPickInvoice(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Cannot return this invoice');
    }
  };

  useEffect(() => {
    const invId = searchParams.get('copy_from_invoice');
    if (!invId) return;
    const copyKey = `return-inv:${invId}`;
    if (!beginCopyNavigation(copyKey)) return;
    setSearchParams({}, { replace: true });
    startFromInvoice(invId).finally(() => endCopyNavigation(copyKey));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const openPickInvoice = () => {
    setPickInvoice(true);
    setInvoiceSearch('');
    api.get('/sales/invoices?limit=50&status=Posted')
      .then((r) => setInvoices(r.data.data || []))
      .catch(() => toast.error('Failed to load invoices'));
  };

  const updateItemQty = (idx: number, qty: string) => {
    setForm((prev: any) => {
      const items = [...prev.items];
      items[idx] = { ...items[idx], quantity: parseFloat(qty) || 0 };
      return { ...prev, items };
    });
  };

  const returnTotal = (form?.items || []).reduce(
    (s: number, i: any) => s + (parseFloat(i.quantity || 0) / parseFloat(i.invoiced_qty || 1)) * parseFloat(i.line_total || 0),
    0
  );

  const submit = async () => {
    if (!form?.invoice_id) { toast.error('Invoice reference required'); return; }
    const items = (form.items || []).filter((i: any) => parseFloat(i.quantity) > 0);
    if (!items.length) { toast.error('Enter return quantities'); return; }
    setSubmitting(true);
    try {
      const res = await api.post('/sales/returns', {
        invoice_id: form.invoice_id,
        customer_id: form.customer_id,
        reason: form.reason,
        notes: form.notes,
        terms_conditions: form.terms_conditions,
        items: items.map((i: any) => ({
          invoice_item_id: i.invoice_item_id,
          product_id: i.product_id,
          quantity: parseFloat(i.quantity),
          location_id: i.location_id || 1,
        })),
      });
      toast.success(`Return ${res.data.return_number} completed`);
      setCreating(false);
      setForm(null);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to process return');
    } finally {
      setSubmitting(false);
    }
  };

  const viewReturn = async (id: string) => {
    try {
      const r = await api.get(`/sales/returns/${id}`);
      setViewDoc(r.data);
      setViewing(true);
    } catch {
      toast.error('Failed to load return');
    }
  };

  const filtered = returns.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.return_number?.toLowerCase().includes(q)
      || r.customer_name?.toLowerCase().includes(q)
      || r.employee_name?.toLowerCase().includes(q)
      || r.invoice_number?.toLowerCase().includes(q);
  });

  const filteredInvoices = invoices.filter((inv) => {
    if (!invoiceSearch.trim()) return true;
    const q = invoiceSearch.toLowerCase();
    return inv.invoice_number?.toLowerCase().includes(q) || inv.customer_name?.toLowerCase().includes(q) || (inv.customer_type === 'Employee' && inv.customer_name?.toLowerCase().includes(q));
  });

  // ========== VIEW ==========
  if (viewing && viewDoc) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Sales Return</h1>
            <span className="text-xs font-mono text-white/80">{viewDoc.return_number}</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">{viewDoc.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => printDocument(`/api/sales/returns/${viewDoc.id}/print`)} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"><Printer size={13} /> Print</button>
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe ref={iframeRef} src={`/api/sales/returns/${viewDoc.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow" style={{ width: '800px', minHeight: '1100px' }} title="Return Preview" />
        </div>
      </div>
    );
  }

  // ========== PICK INVOICE ==========
  if (pickInvoice) {
    return (
      <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setPickInvoice(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Select Invoice to Return</h1>
          </div>
          <button onClick={() => setPickInvoice(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
        </div>
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3 max-w-3xl mx-auto w-full">
            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Search Posted Invoices</div>
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={invoiceSearch} onChange={(e) => setInvoiceSearch(e.target.value)} placeholder="Invoice #, customer…"
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Posted Invoices</div>
              {filteredInvoices.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-sm">No invoices found</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">Invoice #</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium text-blue-700">{inv.invoice_number}</td>
                        <td className="px-3 py-2">{inv.customer_name}</td>
                        <td className="px-3 py-2">{formatDate(inv.invoice_date || inv.created_at)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(inv.total)}</td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => startFromInvoice(inv.id)} className="text-[10px] font-semibold text-amber-700 hover:text-amber-900">Return →</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== CREATE ==========
  if (creating && form) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => { setCreating(false); setForm(null); }} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Sales Return</h1>
            <span className="text-xs font-mono text-white/80">{form.invoice_number}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {hasPerm('sales.sales-invoice.create') && (
              <button onClick={submit} disabled={submitting} className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
                {submitting ? 'Processing…' : 'Complete Return'}
              </button>
            )}
            <button onClick={() => { setCreating(false); setForm(null); }} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Invoice Reference</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-[10px] text-gray-400 block uppercase">{form.customer_type === 'Employee' ? 'Employee' : 'Customer'}</span>{form.customer_name}</div>
                  <div><span className="text-[10px] text-gray-400 block uppercase">Invoice</span><span className="font-mono text-blue-700">{form.invoice_number}</span></div>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Return Details</div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Reason</label>
                  <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="Defective, wrong item…" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">3 · Return Lines</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Product</th>
                    <th className="px-3 py-2 text-center">UOM</th>
                    <th className="px-3 py-2 text-right">Invoiced</th>
                    <th className="px-3 py-2 text-right w-24">Return Qty</th>
                    <th className="px-3 py-2 text-right">Unit Price</th>
                    <th className="px-3 py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {form.items.map((item: any, idx: number) => {
                    const lineEst = (parseFloat(item.quantity || 0) / parseFloat(item.invoiced_qty || 1)) * parseFloat(item.line_total || 0);
                    return (
                      <tr key={item.invoice_item_id} className="hover:bg-blue-50/30">
                        <td className="px-3 py-2 text-gray-400">{idx + 1}</td>
                        <td className="px-3 py-2">{item.product_name}</td>
                        <td className="px-3 py-2 text-center text-gray-500">{item.unit_of_measure || 'pc'}</td>
                        <td className="px-3 py-2 text-right">{item.invoiced_qty}</td>
                        <td className="px-3 py-2">
                          <input type="number" min="0" max={item.invoiced_qty} step="0.01" value={item.quantity}
                            onChange={(e) => updateItemQty(idx, e.target.value)} className="w-full px-1 py-1 border border-gray-200 rounded text-right text-xs" />
                        </td>
                        <td className="px-3 py-2 text-right">{formatCurrency(item.unit_price)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(lineEst)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <DocumentNotesTermsPanel
              sectionLabel="4 · Notes & Terms"
              notes={form.notes || ''}
              termsConditions={form.terms_conditions || ''}
              onNotesChange={(v) => setForm({ ...form, notes: v })}
              onTermsChange={(v) => setForm({ ...form, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.SalesReturn}
              referenceId=""
              notesPlaceholder="Return notes or internal remarks..."
            />
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Return Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Lines</span><span>{form.items?.length || 0}</span></div>
                <div className="flex justify-between pt-2 border-t-2 border-blue-900 text-sm font-bold text-blue-900">
                  <span>Est. Return</span><span>{formatCurrency(returnTotal)}</span>
                </div>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800 leading-relaxed">
              Stock will be restored to inventory and customer AR balance will be reduced. Reversing journal entries are posted automatically.
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
          <RotateCcw size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Sales Returns</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{total} records</span>
        </div>
        {hasPerm('sales.sales-invoice.create') && (
          <button onClick={openPickInvoice} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">
            <Plus size={14} /> New Return
          </button>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Return #, customer, invoice…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Return History</div>
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">Return #</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Customer</th>
                      <th className="px-3 py-2 text-left">Invoice</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-center">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No sales returns found</td></tr>
                    )}
                    {filtered.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium text-blue-700 cursor-pointer hover:underline" onClick={() => viewReturn(r.id)}>{r.return_number}</td>
                        <td className="px-3 py-2">{formatDate(r.return_date || r.created_at)}</td>
                        <td className="px-3 py-2">{r.employee_name || r.customer_name || '—'}</td>
                        <td className="px-3 py-2 font-mono text-gray-600">{r.invoice_number}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.total || 0)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700">{r.status || 'Completed'}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => viewReturn(r.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="View"><Eye size={14} /></button>
                            <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/sales/returns/${r.id}/print?token=${t}`, '_blank'); }}
                              className="p-1 hover:bg-green-50 rounded text-green-600" title="Print"><Printer size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} limit={limit} onPageChange={setPage} />
              </>
            )}
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Returns (this page)</div>
            <p className="text-2xl font-bold text-blue-900">{filtered.length}</p>
            <p className="text-xs text-gray-500 mt-1">Of {total} total records</p>
          </div>
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">New Return</div>
            <p className="text-xs text-gray-500 mb-3">Start from a posted sales invoice</p>
            {hasPerm('sales.sales-invoice.create') && (
              <button onClick={openPickInvoice} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-900 text-white rounded-lg text-xs font-bold hover:bg-blue-800">
                <Receipt size={14} /> Select Invoice
              </button>
            )}
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-[10px] text-gray-500 leading-relaxed">
            Tip: From a posted Sales Invoice, use the copy menu → <strong>Sales Return</strong> to prefill this form.
          </div>
          <Link to="/sales" className="block text-center text-xs text-blue-600 hover:underline">View Sales Invoices →</Link>
          <Link to="/collections" className="block text-center text-xs text-blue-600 hover:underline">Collections & AR →</Link>
        </div>
      </div>
    </div>
  );
}
