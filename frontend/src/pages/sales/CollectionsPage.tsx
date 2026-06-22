import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import { Search, ArrowLeft, Users, Printer, Eye } from 'lucide-react';
import toast from 'react-hot-toast';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';
import { computeEwtForAppliedAmount, resolveInvoiceEwtRate, type InvoiceLineInput } from '../../lib/invoiceTax';
import { useAuth } from '../../store/auth';
import { printDocument, printFromIframe } from '../../lib/printDocument';

const PAYMENT_METHODS = ['Cash', 'Check'];

export default function CollectionsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { hasPerm } = useAuth();
  const canPrintReceipt = hasPerm('sales.collection-receipt.print') || hasPerm('sales.collections.print');
  const invoiceParam = searchParams.get('invoice');

  const [activeTab, setActiveTab] = useState<'ar' | 'statements'>('ar');
  const [outstanding, setOutstanding] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [viewingCollection, setViewingCollection] = useState<any | null>(null);
  const collectionPreviewRef = useRef<HTMLIFrameElement>(null);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Customer Statements state
  const [customerStatements, setCustomerStatements] = useState<any[]>([]);
  const [csSearch, setCsSearch] = useState('');
  const [csDateFrom, setCsDateFrom] = useState('2020-01-01');
  const [csDateTo, setCsDateTo] = useState(new Date().toISOString().split('T')[0]);

  // Single-invoice modal (existing)
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [collectItems, setCollectItems] = useState<InvoiceLineInput[]>([]);
  const [form, setForm] = useState({
    applied_amount: '', cash_collected: '', ewt_amount: '0', ewt_rate: '0',
    lgu_amount: '0', payment_method: 'Cash', reference_number: '', notes: '', terms_conditions: '',
    bank_account_id: '', collection_date: new Date().toISOString().split('T')[0],
    check_date: '', check_bank: '',
  });

  useEffect(() => {
    loadData();
    api.get('/bank-cash/accounts').then(r => setBankAccounts(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!invoiceParam || outstanding.length === 0) return;
    const copyKey = `collect-invoice:${invoiceParam}`;
    if (!beginCopyNavigation(copyKey)) return;
    const inv = outstanding.find((i: any) => i.invoice_id === invoiceParam);
    if (inv) selectForPayment(inv);
    queueMicrotask(() => endCopyNavigation(copyKey));
  }, [invoiceParam, outstanding]);

  const loadData = () => {
    setLoading(true);
    Promise.all([api.get('/sales/outstanding-ar'), api.get('/sales/collections')])
      .then(([ar, col]) => { setOutstanding(ar.data || []); setCollections(col.data || []); })
      .catch(() => toast.error('Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (activeTab === 'statements') {
      api.get(`/sales/customer-statements?search=${csSearch}&from=${csDateFrom}&to=${csDateTo}`)
        .then(r => setCustomerStatements(r.data || []))
        .catch(() => toast.error('Failed to load customer statements'));
    }
  }, [activeTab, csSearch, csDateFrom, csDateTo]);

  // ---- Single Invoice ----
  const mapCollectItems = (items: any[], taxType: string): InvoiceLineInput[] =>
    (items || []).map((i: any) => ({
      quantity: i.quantity,
      unit_price: i.unit_price,
      discount: i.discount || 0,
      tax_type: i.tax_type || taxType,
    }));

  const buildCollectForm = (inv: any, items: InvoiceLineInput[], applied: number) => {
    const lgu = parseFloat(inv.lgu_final_tax || '0');
    const hasLGU = lgu > 0;
    const taxType = inv.tax_type || 'VATable';
    const ewtRate = hasLGU ? '1' : resolveInvoiceEwtRate(inv.ewt_rate, items, inv.withholding_tax, taxType);
    const ewtAmount = hasLGU
      ? parseFloat(inv.withholding_tax || '0')
      : computeEwtForAppliedAmount(items, ewtRate, taxType, applied, parseFloat(inv.total), lgu);
    const lguAmount = hasLGU ? lgu : 0;
    const cashAmt = Math.max(0, applied - ewtAmount - lguAmount);
    return {
      applied_amount: String(applied),
      cash_collected: String(Math.round(cashAmt * 100) / 100),
      ewt_amount: String(Math.round(ewtAmount * 100) / 100),
      ewt_rate: ewtRate,
      lgu_amount: String(lguAmount),
    };
  };

  const selectForPayment = async (inv: any) => {
    try {
      let detail = inv;
      let items = inv.items;
      if (!items?.length) {
        const res = await api.get(`/sales/invoices/${inv.invoice_id}`);
        detail = { ...inv, ...res.data };
        items = res.data.items || [];
      }
      const mapped = mapCollectItems(items, detail.tax_type || 'VATable');
      const applied = parseFloat(detail.balance);
      setCollectItems(mapped);
      setSelectedInvoice(detail);
      setForm((prev) => ({
        ...prev,
        ...buildCollectForm(detail, mapped, applied),
        payment_method: 'Cash',
        reference_number: '',
        notes: '',
        terms_conditions: '',
        bank_account_id: '',
        collection_date: new Date().toISOString().split('T')[0],
        check_date: '',
        check_bank: '',
      }));
    } catch {
      toast.error('Failed to load invoice');
    }
  };

  const closeCollect = () => {
    setSelectedInvoice(null);
    setCollectItems([]);
  };

  const recalcCash = (applied: string, rate: string, lguAmt: string) => {
    const app = parseFloat(applied) || 0;
    const lg = parseFloat(lguAmt) || 0;
    if (!selectedInvoice) return;
    const hasLGU = parseFloat(selectedInvoice.lgu_final_tax || '0') > 0;
    let newEwt = 0;
    if (hasLGU) {
      newEwt = parseFloat(selectedInvoice.withholding_tax || '0');
    } else if (collectItems.length > 0) {
      newEwt = computeEwtForAppliedAmount(
        collectItems,
        rate,
        selectedInvoice.tax_type || 'VATable',
        app,
        parseFloat(selectedInvoice.total),
        lg
      );
    } else if (parseFloat(rate) > 0) {
      newEwt = Math.round(app * (parseFloat(rate) / 100) * 100) / 100;
    }
    const cash = Math.max(0, app - newEwt - lg);
    setForm((f) => ({
      ...f,
      applied_amount: applied,
      ewt_rate: rate,
      ewt_amount: String(Math.round(newEwt * 100) / 100),
      lgu_amount: lguAmt,
      cash_collected: String(Math.round(cash * 100) / 100),
    }));
  };

  const submitSingle = async () => {
    const applied = parseFloat(form.applied_amount);
    const cash = parseFloat(form.cash_collected);
    const ewt = parseFloat(form.ewt_amount);
    const lgu = parseFloat(form.lgu_amount);

    if (!applied || applied <= 0) { toast.error('Enter a valid amount'); return; }
    if (applied > parseFloat(selectedInvoice.balance)) { toast.error('Amount exceeds balance'); return; }
    if (Math.abs(cash + ewt + lgu - applied) > 0.01) { toast.error('Cash + EWT + LGU must equal applied amount'); return; }
    if (cash < 0) { toast.error('Cash collected cannot be negative'); return; }

    const isBank = form.payment_method === 'Check' || form.payment_method === 'Bank Transfer';
    if (isBank && !form.bank_account_id) { toast.error('Select a bank account'); return; }

    try {
      const payload: any = {
        customer_id: selectedInvoice.customer_id,
        invoice_id: selectedInvoice.invoice_id,
        payment_method: form.payment_method,
        reference_number: form.reference_number,
        amount: applied, ewt_amount: ewt, lgu_amount: lgu,
        notes: form.notes,
        terms_conditions: form.terms_conditions,
        bank_account_id: isBank ? form.bank_account_id : undefined,
        collection_date: form.collection_date,
        check_date: form.check_date || undefined,
        check_bank: form.check_bank || undefined,
      };
      const res = await api.post('/sales/collections', payload);
      toast.success(`Collected: ${formatCurrency(cash)} | Applied: ${formatCurrency(applied)} | Balance: ${formatCurrency(res.data.new_balance)}`);
      setSelectedInvoice(null);
      setCollectItems([]);
      loadData();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const aging = outstanding.reduce((acc, inv) => {
    const bucket = inv.aging_bucket || 'Current';
    acc[bucket] = (acc[bucket] || 0) + parseFloat(inv.balance);
    acc.total = (acc.total || 0) + parseFloat(inv.balance);
    return acc;
  }, { total: 0 } as Record<string, number>);

  const agingBuckets = ['Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'] as const;
  const collectionsTotal = collections.reduce((s, c) => s + parseFloat(c.amount || 0), 0);
  const statementsGrandTotal = customerStatements.reduce((s, cs) => s + parseFloat(cs.total_outstanding || 0), 0);
  const primary = '#1E40AF';

  const taxProfile = selectedInvoice ? {
    gross: parseFloat(selectedInvoice.total),
    ewt: parseFloat(selectedInvoice.withholding_tax || 0),
    lgu: parseFloat(selectedInvoice.lgu_final_tax || 0),
    vat: parseFloat(selectedInvoice.vat_amount || 0),
    balance: parseFloat(selectedInvoice.balance),
    hasLGU: parseFloat(selectedInvoice.lgu_final_tax || '0') > 0,
    taxType: selectedInvoice.tax_type,
  } : null;

  const remainingAfter = selectedInvoice
    ? Math.max(0, parseFloat(selectedInvoice.balance) - (parseFloat(form.applied_amount) || 0))
    : 0;

  if (viewingCollection) {
    const v = viewingCollection;
    const printReceipt = () => {
      if (!printFromIframe(collectionPreviewRef.current)) {
        printDocument(`/api/sales/collection-receipt/${v.id}/print`);
      }
    };

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-slate-100">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setViewingCollection(null)}
              className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"
            >
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Collection Receipt</h1>
            <span className="text-xs font-mono text-white/80">{v.receipt_number}</span>
            <span className="text-xs text-white/70 truncate max-w-[220px]">{v.customer_name || v.employee_name || '—'}</span>
          </div>
          {canPrintReceipt && (
            <button
              type="button"
              onClick={printReceipt}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"
            >
              <Printer size={13} /> Print
            </button>
          )}
        </div>
        <div className="px-4 py-2 bg-white border-b border-slate-200 text-xs text-slate-600 flex flex-wrap gap-x-6 gap-y-1">
          <span><span className="text-slate-400">Date:</span> {formatDate(v.payment_date)}</span>
          <span><span className="text-slate-400">Method:</span> {v.payment_method}</span>
          <span><span className="text-slate-400">Amount:</span> <strong>{formatCurrency(v.amount)}</strong></span>
          {v.reference_number && <span><span className="text-slate-400">Reference:</span> {v.reference_number}</span>}
        </div>
        <div className="flex-1 p-6 overflow-y-auto flex justify-center">
          <div className="w-full max-w-[820px]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2 text-center">Document preview</div>
            <iframe
              ref={collectionPreviewRef}
              src={`/api/sales/collection-receipt/${v.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
              className="w-full border border-slate-300 bg-white shadow-lg rounded-sm"
              style={{ minHeight: '1100px' }}
              title={`Collection Receipt ${v.receipt_number}`}
            />
          </div>
        </div>
      </div>
    );
  }

  if (selectedInvoice && taxProfile) {
    const primary = '#1E40AF';
    const isBank = form.payment_method === 'Check' || form.payment_method === 'Bank Transfer';

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button onClick={closeCollect} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Collect Payment</h1>
            <span className="text-xs font-mono text-white/80">{selectedInvoice.invoice_number}</span>
            <span className="text-xs text-white/70 truncate max-w-[200px]">{selectedInvoice.customer_name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={closeCollect} className="px-3 py-1.5 bg-white/20 text-white rounded text-xs font-medium hover:bg-white/30">Cancel</button>
            <button onClick={submitSingle} className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">Post Collection</button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Invoice Information</div>
                <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                  <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Invoice Date</span><span className="text-gray-800">{formatDate(selectedInvoice.invoice_date)}</span></div>
                  <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Due Date</span><span className="text-gray-800">{formatDate(selectedInvoice.due_date)}</span></div>
                  <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Status</span><span className="font-medium text-blue-700">{selectedInvoice.status}</span></div>
                  <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Aging</span><span className="text-gray-800">{selectedInvoice.aging_bucket}</span></div>
                </div>
                <div className="border-t border-gray-100 pt-2 space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">Invoice Total</span><span className="font-semibold">{formatCurrency(taxProfile.gross)}</span></div>
                  {taxProfile.vat > 0 && <div className="flex justify-between"><span className="text-gray-500">VAT (12%)</span><span>{formatCurrency(taxProfile.vat)}</span></div>}
                  {taxProfile.lgu > 0 && <div className="flex justify-between"><span className="text-gray-500">LGU 5% Final VAT</span><span className="text-orange-600">-{formatCurrency(taxProfile.lgu)}</span></div>}
                  {taxProfile.ewt > 0 && <div className="flex justify-between"><span className="text-gray-500">EWT on Invoice</span><span className="text-orange-600">-{formatCurrency(taxProfile.ewt)}</span></div>}
                  <div className="flex justify-between"><span className="text-gray-500">Previously Paid</span><span className="text-green-600">{formatCurrency(parseFloat(selectedInvoice.amount_paid))}</span></div>
                  <div className="flex justify-between pt-1 border-t border-gray-100"><span className="font-bold text-red-600">Outstanding</span><span className="font-bold text-red-600">{formatCurrency(taxProfile.balance)}</span></div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Payment Details</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Collection Date</label>
                    <input type="date" value={form.collection_date} onChange={e => setForm({ ...form, collection_date: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Payment Method</label>
                    <select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_account_id: '' })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                {form.payment_method === 'Check' ? (
                  <>
                    <div>
                      <label className="text-[10px] text-gray-400 uppercase font-semibold">Check Number</label>
                      <input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })}
                        placeholder="e.g. 001234" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase font-semibold">Check Date</label>
                        <input type="date" value={form.check_date} onChange={e => setForm({ ...form, check_date: e.target.value })}
                          className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 uppercase font-semibold">Check Bank / Branch</label>
                        <input type="text" value={form.check_bank} onChange={e => setForm({ ...form, check_bank: e.target.value })}
                          placeholder="e.g. BPI Cagayan de Oro" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                      </div>
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">OR / CR Number</label>
                    <input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                )}

                {isBank && (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Bank Account</label>
                    <select value={form.bank_account_id} onChange={e => setForm({ ...form, bank_account_id: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      <option value="">Select bank account</option>
                      {bankAccounts.map((ba: any) => (<option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name}</option>))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">3 · Amount Application</div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Applied Amount</label>
                  <input type="number" step="0.01" value={form.applied_amount}
                    onChange={(e) => recalcCash(e.target.value, form.ewt_rate, form.lgu_amount)}
                    className="w-full px-2.5 py-2 border border-blue-200 rounded text-sm font-bold text-right mt-0.5 focus:ring-1 focus:ring-blue-300" />
                  <p className="text-[9px] text-gray-400 mt-1">Max: {formatCurrency(taxProfile.balance)}</p>
                </div>
                {!taxProfile.hasLGU && (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">EWT Rate</label>
                    <div className="flex rounded border overflow-hidden mt-0.5">
                      {['0', '1', '2'].map(r => (
                        <button key={r} type="button" onClick={() => recalcCash(form.applied_amount, r, form.lgu_amount)}
                          className={`flex-1 py-1.5 text-xs font-medium ${form.ewt_rate === r ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                          style={form.ewt_rate === r ? { backgroundColor: primary } : {}}>
                          {r === '0' ? 'None' : `${r}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DocumentNotesTermsPanel
              sectionLabel="4 · Notes & Terms"
              notes={form.notes || ''}
              termsConditions={form.terms_conditions || ''}
              onNotesChange={(v) => setForm({ ...form, notes: v })}
              onTermsChange={(v) => setForm({ ...form, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.CollectionReceipt}
              referenceId=""
              notesPlaceholder="Collection remarks or check details..."
            />
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Collection Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1"><span className="text-gray-500">Applied Amount</span><span className="font-semibold">{formatCurrency(parseFloat(form.applied_amount) || 0)}</span></div>
                {parseFloat(form.ewt_amount) > 0 && (
                  <div className="flex justify-between py-1"><span className="text-gray-500">Less: EWT {form.ewt_rate}%</span><span className="text-orange-600 font-medium">-{formatCurrency(parseFloat(form.ewt_amount))}</span></div>
                )}
                {parseFloat(form.lgu_amount) > 0 && (
                  <div className="flex justify-between py-1"><span className="text-gray-500">Less: LGU 5%</span><span className="text-orange-600 font-medium">-{formatCurrency(parseFloat(form.lgu_amount))}</span></div>
                )}
                <div className="flex justify-between py-1 border-t border-gray-100"><span className="text-gray-700 font-semibold">Total Applied</span><span className="font-bold">{formatCurrency(parseFloat(form.applied_amount) || 0)}</span></div>
              </div>
            </div>

            <div className="rounded-lg p-4 text-white" style={{ backgroundColor: primary }}>
              <div className="text-[10px] uppercase opacity-70 font-semibold mb-1">Cash / Bank to Collect</div>
              <div className="text-2xl font-bold tracking-tight">{formatCurrency(parseFloat(form.cash_collected) || 0)}</div>
            </div>

            <div className={`rounded-lg p-3 border ${remainingAfter <= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="text-[10px] font-semibold uppercase text-gray-500 mb-1">Remaining After Payment</div>
              <div className={`text-lg font-bold ${remainingAfter <= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatCurrency(remainingAfter)}</div>
            </div>

            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs">
              <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Customer</div>
              <div className="font-medium text-gray-800">{selectedInvoice.customer_name}</div>
              {selectedInvoice.customer_code && <div className="text-gray-500 mt-1 font-mono">{selectedInvoice.customer_code}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
        <div className="flex items-center gap-3">
          <h1 className="text-white font-semibold text-sm tracking-wide">Collections &amp; AR</h1>
          <div className="flex items-center gap-1 ml-2">
            <button onClick={() => setActiveTab('ar')}
              className={`px-3 py-1 rounded text-xs font-medium ${activeTab === 'ar' ? 'bg-white text-blue-900' : 'text-white/80 hover:bg-white/10'}`}>
              Outstanding AR
            </button>
            <button onClick={() => setActiveTab('statements')}
              className={`px-3 py-1 rounded text-xs font-medium ${activeTab === 'statements' ? 'bg-white text-blue-900' : 'text-white/80 hover:bg-white/10'}`}>
              Customer Statements
            </button>
          </div>
        </div>
        <div className="text-xs text-white/70">
          {activeTab === 'ar'
            ? `${outstanding.length} open invoice${outstanding.length !== 1 ? 's' : ''}`
            : `${customerStatements.length} customer${customerStatements.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && activeTab === 'ar' && (
            <div className="text-center py-12 text-gray-400 text-sm">Loading receivables...</div>
          )}

          {activeTab === 'statements' && (
            <>
              <div className="bg-white border border-gray-200 rounded-lg p-3">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search &amp; Filters</div>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Customer</label>
                    <div className="relative mt-0.5">
                      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                      <input type="text" value={csSearch} onChange={e => setCsSearch(e.target.value)} placeholder="Search customer..."
                        className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">From</label>
                    <input type="date" value={csDateFrom} onChange={e => setCsDateFrom(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">To</label>
                    <input type="date" value={csDateTo} onChange={e => setCsDateTo(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 280 }}>
                <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase">2 · Customer Statements ({customerStatements.length})</span>
                </div>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                        <th className="px-2 py-2 text-left w-14"></th>
                        <th className="px-2 py-2 text-left">Oldest Invoice</th>
                        <th className="px-2 py-2 text-left">Customer</th>
                        <th className="px-2 py-2 text-right">Unpaid</th>
                        <th className="px-2 py-2 text-right">Balance Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {customerStatements.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No customers with unpaid invoices</td></tr>
                      )}
                      {customerStatements.map((cs: any) => (
                        <tr key={cs.customer_id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => navigate(`/customer-statement/${cs.customer_id}`)}>
                          <td className="px-2 py-2"><span className="text-[10px] text-blue-600 font-medium">View</span></td>
                          <td className="px-2 py-2 text-[10px]">{formatDate(cs.oldest_invoice_date)}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium text-gray-800">{cs.customer_name}</div>
                            <div className="text-[10px] text-gray-500 font-mono">{cs.customer_code}</div>
                          </td>
                          <td className="px-2 py-2 text-right font-medium">{cs.unpaid_count}</td>
                          <td className="px-2 py-2 text-right font-bold text-red-600">{formatCurrency(cs.total_outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === 'ar' && !loading && (
            <>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 280 }}>
                <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase">1 · Outstanding Receivables ({outstanding.length})</span>
                  <span className="text-[10px] font-bold text-red-600">{formatCurrency(aging.total)}</span>
                </div>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                        <th className="px-2 py-2 text-left">Invoice #</th>
                        <th className="px-2 py-2 text-left">Customer</th>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Due</th>
                        <th className="px-2 py-2 text-right">Total</th>
                        <th className="px-2 py-2 text-right">Paid</th>
                        <th className="px-2 py-2 text-right">Balance</th>
                        <th className="px-2 py-2 text-center">Aging</th>
                        <th className="px-2 py-2 text-center">Status</th>
                        <th className="px-2 py-2 text-center w-16"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {outstanding.length === 0 && (
                        <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">No outstanding receivables</td></tr>
                      )}
                      {outstanding.map((inv) => (
                        <tr key={inv.invoice_id} className={`hover:bg-blue-50/20 ${inv.invoice_id === invoiceParam ? 'bg-blue-50/60' : ''}`}>
                          <td className="px-2 py-2 font-mono text-[10px]">{inv.invoice_number}</td>
                          <td className="px-2 py-2">
                            <div className="font-medium text-gray-800">{inv.customer_name}</div>
                            {inv.customer_code && <div className="text-[10px] text-gray-500">{inv.customer_code}</div>}
                          </td>
                          <td className="px-2 py-2 text-[10px]">{formatDate(inv.invoice_date)}</td>
                          <td className="px-2 py-2 text-[10px]">{formatDate(inv.due_date)}</td>
                          <td className="px-2 py-2 text-right text-[10px]">{formatCurrency(inv.total)}</td>
                          <td className="px-2 py-2 text-right text-[10px] text-green-600">{formatCurrency(inv.amount_paid)}</td>
                          <td className="px-2 py-2 text-right text-[10px] font-semibold text-red-600">{formatCurrency(inv.balance)}</td>
                          <td className="px-2 py-2 text-center">
                            <span className={`px-1.5 py-0.5 text-[9px] rounded-full ${parseFloat(inv.days_overdue) > 60 ? 'bg-red-100 text-red-700' : parseFloat(inv.days_overdue) > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                              {inv.aging_bucket}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span className={`px-1.5 py-0.5 text-[9px] rounded-full ${inv.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>{inv.status}</span>
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button onClick={() => selectForPayment(inv)}
                              className="px-2 py-1 text-[10px] font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200">Collect</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 200 }}>
                <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase">2 · Collection History ({collections.length})</span>
                  <span className="text-[10px] text-green-700 font-semibold">{formatCurrency(collectionsTotal)}</span>
                </div>
                <div className="overflow-auto flex-1">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                        <th className="px-2 py-2 text-left">Receipt #</th>
                        <th className="px-2 py-2 text-left">Customer</th>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Method</th>
                        <th className="px-2 py-2 text-left">Reference</th>
                        <th className="px-2 py-2 text-right">Amount</th>
                        <th className="px-2 py-2 text-center w-20">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {collections.length === 0 && (
                        <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No collections recorded</td></tr>
                      )}
                      {collections.map((col) => (
                        <tr key={col.id} className="hover:bg-gray-50/50">
                          <td className="px-2 py-2 font-mono text-[10px]">{col.receipt_number}</td>
                          <td className="px-2 py-2 text-[10px]">{col.customer_name || col.employee_name || '—'}</td>
                          <td className="px-2 py-2 text-[10px]">{formatDate(col.payment_date)}</td>
                          <td className="px-2 py-2 text-[10px]">{col.payment_method}</td>
                          <td className="px-2 py-2 text-[10px] text-gray-500">{col.reference_number || '—'}</td>
                          <td className="px-2 py-2 text-right text-[10px] font-semibold text-green-600">{formatCurrency(col.amount)}</td>
                          <td className="px-2 py-2 text-center">
                            <div className="inline-flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => setViewingCollection(col)}
                                className="inline-flex items-center justify-center p-1 text-gray-600 hover:bg-gray-100 rounded"
                                title="View collection receipt"
                              >
                                <Eye size={14} />
                              </button>
                              {canPrintReceipt && (
                                <button
                                  type="button"
                                  onClick={() => printDocument(`/api/sales/collection-receipt/${col.id}/print`)}
                                  className="inline-flex items-center justify-center p-1 text-blue-600 hover:bg-blue-50 rounded"
                                  title="Print collection receipt"
                                >
                                  <Printer size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto p-4 space-y-4">
          {activeTab === 'ar' ? (
            <>
              <div>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">AR Aging</div>
                <div className="space-y-1.5">
                  {agingBuckets.map((bucket) => {
                    const amt = aging[bucket] || 0;
                    const pct = aging.total ? Math.min(100, (amt / aging.total) * 100) : 0;
                    const bar = bucket === '90+ Days' ? 'bg-red-600' : bucket === '61-90 Days' ? 'bg-red-400' : bucket === '31-60 Days' ? 'bg-orange-500' : bucket === '1-30 Days' ? 'bg-yellow-500' : 'bg-green-500';
                    return (
                      <div key={bucket} className="text-xs">
                        <div className="flex justify-between mb-0.5">
                          <span className="text-gray-500">{bucket}</span>
                          <span className="font-medium">{formatCurrency(amt)}</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-lg p-4 text-white" style={{ backgroundColor: primary }}>
                <div className="text-[10px] uppercase opacity-70 font-semibold mb-1">Total Outstanding</div>
                <div className="text-2xl font-bold tracking-tight">{formatCurrency(aging.total)}</div>
              </div>

              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs space-y-1.5">
                <div className="flex justify-between"><span className="text-gray-500">Open Invoices</span><span className="font-medium">{outstanding.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Collections</span><span className="font-medium">{collections.length}</span></div>
                <div className="flex justify-between border-t border-gray-200 pt-1.5"><span className="text-gray-500">Collected (all)</span><span className="font-semibold text-green-700">{formatCurrency(collectionsTotal)}</span></div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg p-4 text-white" style={{ backgroundColor: primary }}>
                <div className="text-[10px] uppercase opacity-70 font-semibold mb-1">Total Balance Due</div>
                <div className="text-2xl font-bold tracking-tight">{formatCurrency(statementsGrandTotal)}</div>
              </div>

              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs space-y-1.5">
                <div className="flex justify-between"><span className="text-gray-500">Customers</span><span className="font-medium">{customerStatements.length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Unpaid Invoices</span><span className="font-medium">{customerStatements.reduce((s, cs) => s + parseInt(cs.unpaid_count || 0), 0)}</span></div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800">
                <div className="flex items-center gap-1.5 font-semibold mb-1"><Users size={12} /> Tip</div>
                Click a customer row to open their statement and record batch payments.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
