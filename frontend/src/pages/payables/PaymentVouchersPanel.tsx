import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate, parseNumericField } from '../../lib/utils';
import { Plus, ArrowLeft, Printer, Search, CheckSquare, Square } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { PRIMARY, statusBadgeClass } from '../../lib/payablesUtils';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import { beginCopyNavigation, endCopyNavigation } from '../../lib/copyNavigationGuard';
import { printDocument } from '../../lib/printDocument';

type Props = {
  suppliers: any[];
  bankAccounts: any[];
  onRefresh: () => void;
};

export default function PaymentVouchersPanel({ suppliers, bankAccounts, onRefresh }: Props) {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [vouchers, setVouchers] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [paying, setPaying] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [supplierInvoices, setSupplierInvoices] = useState<any[]>([]);
  const [supplierInfo, setSupplierInfo] = useState<any>(null);
  const [loadInvoices, setLoadInvoices] = useState(false);

  const [form, setForm] = useState<any>({
    supplier_id: '', payment_method: 'Cash', reference_number: '',
    notes: '', terms_conditions: '', bank_account_id: '', payment_date: new Date().toISOString().split('T')[0],
    check_date: '', check_bank: '',
  });

  const limit = 20;

  const loadVouchers = () => {
    setLoading(true);
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('limit', String(limit));
    if (search.trim()) p.set('search', search.trim());
    api.get('/payables/vouchers?' + p)
      .then((r) => { setVouchers(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load payments'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadVouchers(); }, [page]);

  useEffect(() => {
    const apvId = searchParams.get('pay_apv');
    if (!apvId) return;
    const copyKey = `pay-apv:${apvId}`;
    if (!beginCopyNavigation(copyKey)) return;
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev);
      n.delete('pay_apv');
      return n;
    }, { replace: true });
    (async () => {
      try {
        const r = await api.get('/payables/apv/' + apvId);
        const apv = r.data;
        if (!['Posted', 'Partially Paid'].includes(apv.status)) {
          toast.error('Only posted APVs can be paid');
          return;
        }
        const outstanding = await api.get(`/payables/apv-outstanding/${apv.supplier_id}`);
        const healed = (outstanding.data || []).find((row: any) => row.id === apv.id);
        const balance = healed
          ? parseFloat(healed.balance_due)
          : parseFloat(apv.total_amount) - parseFloat(apv.amount_paid || 0);
        setForm((f: any) => ({
          ...f,
          supplier_id: String(apv.supplier_id),
          notes: `Payment for ${apv.apv_number}`,
        }));
        setSupplierInvoices([{
          type: 'apv',
          apv_id: apv.id,
          apv_number: apv.apv_number,
          total_amount: healed?.total_amount ?? apv.total_amount,
          amount_paid: healed?.amount_paid ?? (apv.amount_paid || 0),
          balance_due: balance,
          selected: true,
          payment_amount: balance,
        }]);
        setSupplierInfo(suppliers.find((s) => String(s.id) === String(apv.supplier_id)) || null);
        setPaying(true);
      } catch {
        toast.error('Failed to load APV for payment');
      } finally {
        endCopyNavigation(copyKey);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadSupplierApvs = (supplierId: string) => {
    if (!supplierId) {
      setSupplierInvoices([]);
      setSupplierInfo(null);
      return;
    }
    setLoadInvoices(true);
    api.get(`/payables/apv-outstanding/${supplierId}`)
      .then((r) => {
        const apvs = (r.data || []).map((inv: any) => ({
          ...inv,
          type: 'apv',
          apv_id: inv.id,
          selected: false,
          payment_amount: parseFloat(inv.balance_due) || 0,
        }));
        setSupplierInvoices(apvs);
        setSupplierInfo(suppliers.find((s: any) => String(s.id) === supplierId) || null);
      })
      .catch(() => toast.error('Failed to load outstanding APVs'))
      .finally(() => setLoadInvoices(false));
  };

  const toggleInvoice = (idx: number) => {
    setSupplierInvoices(supplierInvoices.map((inv, i) => (
      i === idx ? { ...inv, selected: !inv.selected, payment_amount: !inv.selected ? String(inv.balance_due) : '' } : inv
    )));
  };

  const updatePaymentAmount = (idx: number, amount: string) => {
    setSupplierInvoices(supplierInvoices.map((inv, i) => (
      i === idx ? { ...inv, payment_amount: amount } : inv
    )));
  };

  const submitPayment = async () => {
    const selected = supplierInvoices.filter((inv) => inv.selected && parseNumericField(inv.payment_amount) > 0);
    if (selected.length === 0) { toast.error('Select at least one APV'); return; }
    const isBank = form.payment_method === 'Check' || form.payment_method === 'Bank Transfer';
    if (isBank && !form.bank_account_id) { toast.error('Select bank account'); return; }
    try {
      await api.post('/payables/vouchers', {
        supplier_id: parseInt(form.supplier_id, 10),
        payment_method: form.payment_method,
        payment_date: form.payment_date,
        reference_number: form.reference_number,
        check_date: form.check_date || undefined,
        check_bank: form.check_bank || undefined,
        notes: form.notes,
        terms_conditions: form.terms_conditions,
        bank_account_id: isBank ? form.bank_account_id : undefined,
        allocations: selected.map((inv) => ({ apv_id: inv.apv_id, amount: parseNumericField(inv.payment_amount) })),
      });
      toast.success('Payment recorded');
      setPaying(false);
      setForm({
        supplier_id: '', payment_method: 'Cash', reference_number: '',
        notes: '', terms_conditions: '', bank_account_id: '', payment_date: new Date().toISOString().split('T')[0],
        check_date: '', check_bank: '',
      });
      setSupplierInvoices([]);
      loadVouchers();
      onRefresh();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const payTotal = supplierInvoices.filter((i) => i.selected).reduce((s, i) => s + parseNumericField(i.payment_amount), 0);

  if (viewingId) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <button onClick={() => setViewingId(null)} className="flex items-center gap-2 text-white text-sm"><ArrowLeft size={18} /> Payment Voucher</button>
          <button onClick={() => printDocument(`/api/payables/vouchers/${viewingId}/print`)} className="px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold">Print</button>
        </div>
        <div className="flex-1 bg-gray-100 p-4 flex justify-center overflow-y-auto">
          <iframe ref={iframeRef} src={`/api/payables/vouchers/${viewingId}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border bg-white shadow" style={{ width: '800px', minHeight: '900px' }} title="PV" />
        </div>
      </div>
    );
  }

  if (paying) {
    return (
      <div className="h-full flex flex-col bg-gray-50">
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <button onClick={() => setPaying(false)} className="flex items-center gap-2 text-white text-sm"><ArrowLeft size={18} /> Pay Supplier</button>
          <button onClick={submitPayment} disabled={!hasPerm('purchases.payment-voucher.create')}
            className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold disabled:opacity-50">Record Payment</button>
        </div>
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase">1 · Supplier</div>
                <select value={form.supplier_id} onChange={(e) => { setForm({ ...form, supplier_id: e.target.value }); loadSupplierApvs(e.target.value); }}
                  className="w-full border rounded text-xs px-2 py-1.5">
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name} ({formatCurrency(s.balance || 0)})</option>)}
                </select>
                {supplierInfo && <p className="text-[10px] text-gray-500">Balance: {formatCurrency(supplierInfo.balance || 0)}</p>}
              </div>
              <div className="bg-white border rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase">2 · Payment Details</div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} className="border rounded text-xs px-2 py-1" />
                  <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })} className="border rounded text-xs px-2 py-1">
                    <option>Cash</option><option>Check</option><option>Bank Transfer</option>
                  </select>
                </div>
                {form.payment_method === 'Check' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input placeholder="Check #" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} className="border rounded text-xs px-2 py-1" />
                    <input type="date" value={form.check_date} onChange={(e) => setForm({ ...form, check_date: e.target.value })} className="border rounded text-xs px-2 py-1" />
                    <input placeholder="Bank / branch" value={form.check_bank} onChange={(e) => setForm({ ...form, check_bank: e.target.value })} className="border rounded text-xs px-2 py-1 col-span-2" />
                  </div>
                )}
                {form.payment_method === 'Bank Transfer' && (
                  <input placeholder="Reference #" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })} className="border rounded text-xs px-2 py-1 w-full" />
                )}
                {(form.payment_method === 'Check' || form.payment_method === 'Bank Transfer') && (
                  <select value={form.bank_account_id} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })} className="w-full border rounded text-xs px-2 py-1">
                    <option value="">Bank account</option>
                    {bankAccounts.map((ba) => <option key={ba.id} value={ba.id}>{ba.bank_name} — {ba.account_name}</option>)}
                  </select>
                )}
                <DocumentNotesTermsPanel
                  sectionLabel="Notes & Terms"
                  notes={form.notes || ''}
                  termsConditions={form.terms_conditions || ''}
                  onNotesChange={(v) => setForm({ ...form, notes: v })}
                  onTermsChange={(v) => setForm({ ...form, terms_conditions: v })}
                  referenceType={ATTACHMENT_REF.PaymentVoucher}
                  referenceId=""
                  notesPlaceholder="Payment voucher remarks..."
                />
              </div>
            </div>

            <div className="bg-white border rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b text-[10px] font-semibold text-gray-400 uppercase">3 · Outstanding APVs</div>
              {loadInvoices ? <div className="py-8 text-center text-gray-400 text-sm">Loading…</div> : supplierInvoices.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">Select a supplier with posted APVs</div>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50 text-[9px] uppercase text-gray-500">
                    <th className="w-8 px-2"></th>
                    <th className="px-2 text-left">APV #</th>
                    <th className="px-2 text-right">Total</th>
                    <th className="px-2 text-right">Balance</th>
                    <th className="px-2 text-right">Pay Amount</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {supplierInvoices.map((inv, idx) => (
                      <tr key={inv.apv_id} className="hover:bg-gray-50">
                        <td className="px-2"><button onClick={() => toggleInvoice(idx)}>{inv.selected ? <CheckSquare size={14} className="text-blue-600" /> : <Square size={14} className="text-gray-400" />}</button></td>
                        <td className="px-2 font-mono text-blue-700">{inv.apv_number}</td>
                        <td className="px-2 text-right">{formatCurrency(inv.total_amount)}</td>
                        <td className="px-2 text-right font-medium">{formatCurrency(inv.balance_due)}</td>
                        <td className="px-2 text-right">
                          <input type="number" value={inv.payment_amount} disabled={!inv.selected}
                            onChange={(e) => updatePaymentAmount(idx, e.target.value)}
                            className="w-24 border rounded text-right px-1 py-0.5 disabled:bg-gray-50" step="0.01" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className="w-64 border-l bg-white p-4">
            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-2">Payment Total</div>
            <div className="text-2xl font-bold text-blue-900">{formatCurrency(payTotal)}</div>
            <p className="text-[10px] text-gray-500 mt-3">Payments apply to posted APVs only. Create and post an APV from PO or GR first.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-4 py-3 bg-white border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadVouchers()}
              placeholder="Search PV #, supplier…" className="pl-7 pr-2 py-1.5 border rounded text-xs w-48" />
          </div>
          <button onClick={() => { setPage(1); loadVouchers(); }} className="px-2 py-1.5 border rounded text-xs">Search</button>
        </div>
        {hasPerm('purchases.payment-voucher.create') && (
          <button onClick={() => setPaying(true)} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700">
            <Plus size={14} /> Pay Supplier
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? <div className="py-12 text-center text-gray-400">Loading…</div> : (
          <table className="w-full text-xs bg-white">
            <thead><tr className="bg-gray-50 text-[9px] uppercase text-gray-500 sticky top-0">
              <th className="px-3 py-2 text-left">PV #</th>
              <th className="px-3 py-2 text-left">Supplier</th>
              <th className="px-3 py-2 text-left">APV / PO</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Method</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {vouchers.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-gray-400">No payment vouchers</td></tr>}
              {vouchers.map((v) => (
                <tr key={v.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono">{v.voucher_number}</td>
                  <td className="px-3 py-2">{v.supplier_name}</td>
                  <td className="px-3 py-2 text-blue-600 font-mono text-[10px]">{v.apv_number || v.po_number || '—'}</td>
                  <td className="px-3 py-2">{formatDate(v.payment_date)}</td>
                  <td className="px-3 py-2">{v.payment_method}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(v.amount)}</td>
                  <td className="px-3 py-2 text-center"><span className={statusBadgeClass(v.status)}>{v.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setViewingId(v.id)} className="px-2 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded mr-1">View</button>
                    <button onClick={() => window.open(`/api/payables/vouchers/${v.id}/print?token=${localStorage.getItem('token')}`, '_blank')}
                      className="px-2 py-0.5 text-[10px] bg-gray-100 rounded">Print</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
    </div>
  );
}
