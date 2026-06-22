import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';
import { ArrowLeft, Printer, Wallet, FileText } from 'lucide-react';
import { printDocument } from '../../lib/printDocument';

function computeBillingTotals(invoices: any[]) {
  let totalExcVat = 0;
  let vatAmount = 0;
  let totalIncVat = 0;
  let totalWht = 0;
  let totalLgu = 0;
  for (const inv of invoices) {
    totalExcVat += parseFloat(inv.vatable_sales || 0) + parseFloat(inv.vat_exempt_sales || 0) + parseFloat(inv.zero_rated_sales || 0);
    vatAmount += parseFloat(inv.vat_amount || inv.tax || 0);
    totalIncVat += parseFloat(inv.total || 0);
    totalWht += parseFloat(inv.withholding_tax || 0);
    totalLgu += parseFloat(inv.lgu_final_tax || 0);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  totalExcVat = round(totalExcVat);
  vatAmount = round(vatAmount);
  totalIncVat = round(totalIncVat);
  totalWht = round(totalWht);
  totalLgu = round(totalLgu);
  return {
    totalExcVat,
    vatAmount,
    totalIncVat,
    totalWht,
    totalLgu,
    netAmount: round(totalIncVat - totalWht - totalLgu),
  };
}

const PAYMENT_METHODS = ['Cash', 'Check'];
const DEPOSIT_OPTIONS = [
  { value: 'cash', label: 'Cash on Hand' },
  { value: 'checks_on_hand', label: 'Checks on Hand / Undeposited' },
  { value: 'bank', label: 'Bank Account' },
];

export default function CustomerStatementDetail() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [aging, setAging] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);

  // Batch payment modal
  const [showBatchPayment, setShowBatchPayment] = useState(false);
  const [batchForm, setBatchForm] = useState<any>({
    payment_date: new Date().toISOString().split('T')[0],
    payment_method: 'Check',
    reference_number: '', check_date: '', check_bank: '', check_branch: '',
    deposit_to: 'checks_on_hand', bank_account_id: '',
    amount_received: '', notes: '',
  });
  const [batchAllocations, setBatchAllocations] = useState<Record<string, { selected: boolean; applied_amount: string; ewt_amount: string; lgu_amount: string }>>({});

  const [billingSelected, setBillingSelected] = useState<Record<string, boolean>>({});
  const [billingDescription, setBillingDescription] = useState('');

  useEffect(() => {
    loadData();
    api.get('/bank-cash/accounts').then(r => setBankAccounts(r.data?.value || r.data || [])).catch(() => {});
  }, [customerId]);

  const loadData = () => {
    if (!customerId) return;
    setLoading(true);
    api.get(`/sales/customer-statement/${customerId}`)
      .then(r => {
        setCustomer(r.data.customer);
        setInvoices(r.data.invoices || []);
        setPayments(r.data.payments || []);
        setAging(r.data.aging || {});
        const initBilling: Record<string, boolean> = {};
        for (const inv of r.data.invoices || []) initBilling[inv.id] = false;
        setBillingSelected(initBilling);
      })
      .catch(() => toast.error('Failed to load statement'))
      .finally(() => setLoading(false));
  };

  // Batch payment helpers
  const openBatchPayment = () => {
    const init: Record<string, { selected: boolean; applied_amount: string; ewt_amount: string; lgu_amount: string }> = {};
    for (const inv of invoices) {
      const ewt = (parseFloat(inv.withholding_tax) || 0).toFixed(2);
      const lgu = (parseFloat(inv.lgu_final_tax) || 0).toFixed(2);
      init[inv.id] = { selected: false, applied_amount: String(parseFloat(inv.balance)), ewt_amount: ewt, lgu_amount: lgu };
    }
    setBatchAllocations(init);
    setBatchForm({
      payment_date: new Date().toISOString().split('T')[0],
      payment_method: 'Check',
      reference_number: '', check_date: '', check_bank: '', check_branch: '',
      deposit_to: 'checks_on_hand', bank_account_id: '',
      amount_received: '', notes: '',
    });
    setShowBatchPayment(true);
  };

  const toggleAllocInvoice = (invId: string) => {
    setBatchAllocations(prev => {
      const inv = invoices.find(i => i.id === invId);
      const ewt = (parseFloat(inv?.withholding_tax) || 0).toFixed(2);
      const lgu = (parseFloat(inv?.lgu_final_tax) || 0).toFixed(2);
      const updated = {
        ...prev,
        [invId]: { ...prev[invId], selected: !prev[invId]?.selected, applied_amount: prev[invId]?.applied_amount || String(parseFloat(inv?.balance || 0)), ewt_amount: prev[invId]?.ewt_amount || ewt, lgu_amount: prev[invId]?.lgu_amount || lgu },
      };
      const cashTotal = Object.entries(updated)
        .filter(([_, v]) => v.selected)
        .reduce((s, [_, v]) => s + (parseFloat(v.applied_amount) || 0) - (parseFloat(v.ewt_amount) || 0) - (parseFloat(v.lgu_amount) || 0), 0);
      setBatchForm(f => ({ ...f, amount_received: String(Math.max(0, Math.round(cashTotal * 100) / 100)) }));
      return updated;
    });
  };

  const updateAllocAmount = (invId: string, amount: string) => {
    setBatchAllocations(prev => {
      const updated = { ...prev, [invId]: { ...prev[invId], applied_amount: amount } };
      const cashTotal = Object.entries(updated)
        .filter(([_, v]) => v.selected)
        .reduce((s, [_, v]) => s + (parseFloat(v.applied_amount) || 0) - (parseFloat(v.ewt_amount) || 0) - (parseFloat(v.lgu_amount) || 0), 0);
      setBatchForm(f => ({ ...f, amount_received: String(Math.max(0, Math.round(cashTotal * 100) / 100)) }));
      return updated;
    });
  };

  const selectedAllocs = Object.entries(batchAllocations).filter(([_, v]) => v.selected);
  const totalApplied = selectedAllocs.reduce((s, [_, v]) => s + (parseFloat(v.applied_amount) || 0), 0);
  const totalCash = selectedAllocs.reduce((s, [_, v]) => s + (parseFloat(v.applied_amount) || 0) - (parseFloat(v.ewt_amount) || 0) - (parseFloat(v.lgu_amount) || 0), 0);
  const amountReceived = parseFloat(batchForm.amount_received) || 0;
  const unapplied = Math.max(0, amountReceived - totalCash);

  const submitBatchPayment = async () => {
    const sel = Object.entries(batchAllocations).filter(([_, v]) => v.selected);
    if (sel.length === 0) { toast.error('Select at least one invoice'); return; }
    if (amountReceived <= 0) { toast.error('Enter amount received'); return; }
    if (totalCash > amountReceived) { toast.error('Total cash/bank exceeds amount received'); return; }

    for (const [invId, v] of sel) {
      const amt = parseFloat(v.applied_amount) || 0;
      const inv = invoices.find(i => i.id === invId);
      if (amt > parseFloat(inv?.balance || 0)) {
        toast.error(`Applied amount exceeds balance for ${inv?.invoice_number}`);
        return;
      }
    }

    const isCheck = batchForm.payment_method === 'Check';
    if (isCheck && !batchForm.reference_number) { toast.error('Enter check number'); return; }
    if (batchForm.deposit_to === 'bank' && !batchForm.bank_account_id) { toast.error('Select bank account'); return; }

    try {
      const payload: any = {
        customer_id: customer?.id,
        payment_method: batchForm.payment_method,
        reference_number: batchForm.reference_number,
        notes: batchForm.notes,
        payment_date: batchForm.payment_date,
        collection_date: batchForm.payment_date,
        check_date: batchForm.check_date || undefined,
        check_bank: batchForm.check_bank ? `${batchForm.check_bank}${batchForm.check_branch ? ' - ' + batchForm.check_branch : ''}` : undefined,
        bank_account_id: batchForm.deposit_to === 'bank' ? batchForm.bank_account_id : undefined,
        deposit_to: batchForm.deposit_to,
        allocations: sel.map(([invId, v]) => ({
          invoice_id: invId,
          applied_amount: parseFloat(v.applied_amount) || 0,
          ewt_amount: parseFloat(v.ewt_amount) || 0,
          lgu_amount: parseFloat(v.lgu_amount) || 0,
        })),
      };
      const res = await api.post('/sales/collections', payload);
      toast.success(`CR ${res.data.receipt_number} | ${res.data.allocation_count} invoices | ${formatCurrency(res.data.total_applied)}`);
      setShowBatchPayment(false);
      loadData();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const billingInvoices = invoices.filter((inv) => billingSelected[inv.id]);
  const billingTotals = computeBillingTotals(billingInvoices);
  const billingSelectedCount = billingInvoices.length;
  const allBillingSelected = invoices.length > 0 && invoices.every((inv) => billingSelected[inv.id]);

  const toggleBillingInvoice = (invId: string) => {
    setBillingSelected((prev) => ({ ...prev, [invId]: !prev[invId] }));
  };

  const toggleAllBilling = () => {
    const next = !allBillingSelected;
    const updated: Record<string, boolean> = {};
    for (const inv of invoices) updated[inv.id] = next;
    setBillingSelected(updated);
  };

  const printBillingStatement = () => {
    if (billingSelectedCount === 0) {
      toast.error('Select at least one invoice for the billing statement');
      return;
    }
    const ids = billingInvoices.map((i) => i.id).join(',');
    const params = new URLSearchParams({ invoice_ids: ids });
    if (billingDescription.trim()) params.set('description', billingDescription.trim());
    printDocument(`/api/sales/customer-statement/${customerId}/billing-statement/print?${params.toString()}`);
  };

  if (loading) return <div className="text-center py-8 text-gray-400">Loading...</div>;
  if (!customer) return <div className="text-center py-8 text-gray-400">Customer not found</div>;

  if (showBatchPayment) {
    const primary = '#1E40AF';

    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: primary }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowBatchPayment(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Batch Payment Allocation</h1>
            <span className="text-xs text-white/70 truncate max-w-[220px]">{customer.customer_name}</span>
            <span className="text-xs font-mono text-white/60">{customer.customer_code}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowBatchPayment(false)} className="px-3 py-1.5 bg-white/20 text-white rounded text-xs font-medium hover:bg-white/30">Cancel</button>
            <button onClick={submitBatchPayment} className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">Post Collection</button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Customer &amp; Payment</div>
                <div className="bg-gray-50 rounded p-2 text-xs">
                  <div className="font-medium text-gray-800">{customer.customer_name}</div>
                  <div className="text-gray-500 mt-0.5">{customer.customer_code}{customer.address ? ` · ${customer.address}` : ''}</div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Payment Date</label>
                    <input type="date" value={batchForm.payment_date} onChange={e => setBatchForm({ ...batchForm, payment_date: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Payment Method</label>
                    <select value={batchForm.payment_method} onChange={e => {
                      const m = e.target.value;
                      setBatchForm(f => ({ ...f, payment_method: m, deposit_to: m === 'Cash' ? 'cash' : f.deposit_to }));
                    }} className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Deposit &amp; Receipt</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Deposit To</label>
                    <select value={batchForm.deposit_to} onChange={e => setBatchForm({ ...batchForm, deposit_to: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      {DEPOSIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Cash / Bank Received</label>
                    <input type="number" step="0.01" value={batchForm.amount_received} onChange={e => setBatchForm({ ...batchForm, amount_received: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-blue-200 rounded text-xs font-bold text-right mt-0.5" />
                  </div>
                </div>
                {batchForm.deposit_to === 'bank' && (
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Bank Account</label>
                    <select value={batchForm.bank_account_id} onChange={e => setBatchForm({ ...batchForm, bank_account_id: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5">
                      <option value="">Select bank account</option>
                      {bankAccounts.map((ba: any) => <option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>

            {batchForm.payment_method === 'Check' && (
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Check Details</div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Check Number</label>
                    <input type="text" value={batchForm.reference_number} onChange={e => setBatchForm({ ...batchForm, reference_number: e.target.value })}
                      placeholder="e.g. 001234" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Check Date</label>
                    <input type="date" value={batchForm.check_date} onChange={e => setBatchForm({ ...batchForm, check_date: e.target.value })}
                      className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Bank Name</label>
                    <input type="text" value={batchForm.check_bank} onChange={e => setBatchForm({ ...batchForm, check_bank: e.target.value })}
                      placeholder="e.g. BPI" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Branch</label>
                    <input type="text" value={batchForm.check_branch} onChange={e => setBatchForm({ ...batchForm, check_branch: e.target.value })}
                      placeholder="e.g. Cagayan de Oro" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 240 }}>
              <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
                <span className="text-[10px] font-semibold text-gray-500 uppercase">3 · Invoice Allocation ({selectedAllocs.length} selected)</span>
                <span className="text-[10px] text-gray-400">{invoices.length} unpaid invoice{invoices.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2 text-left">Date</th>
                      <th className="px-2 py-2 text-left">Invoice #</th>
                      <th className="px-2 py-2 text-right">Balance</th>
                      <th className="px-2 py-2 text-right">Applied</th>
                      <th className="px-2 py-2 text-right">EWT</th>
                      <th className="px-2 py-2 text-right">LGU</th>
                      <th className="px-2 py-2 text-right">Cash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {invoices.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400">No unpaid invoices</td></tr>
                    )}
                    {invoices.map((inv: any) => {
                      const a = batchAllocations[inv.id];
                      const bal = parseFloat(inv.balance);
                      const ewt = parseFloat(inv.withholding_tax || '0');
                      const lgu = parseFloat(inv.lgu_final_tax || '0');
                      const cashPerInv = (parseFloat(a?.applied_amount) || 0) - (parseFloat(a?.ewt_amount) || 0) - (parseFloat(a?.lgu_amount) || 0);
                      return (
                        <tr key={inv.id} className={a?.selected ? 'bg-blue-50/40' : 'hover:bg-gray-50/50'}>
                          <td className="px-2 py-2 text-center">
                            <input type="checkbox" checked={a?.selected || false} onChange={() => toggleAllocInvoice(inv.id)} className="rounded" />
                          </td>
                          <td className="px-2 py-2 text-[10px]">{formatDate(inv.invoice_date)}</td>
                          <td className="px-2 py-2 font-mono text-[10px]">{inv.invoice_number}</td>
                          <td className="px-2 py-2 text-right font-semibold text-red-600">{formatCurrency(bal)}</td>
                          <td className="px-2 py-2">
                            <input type="number" step="0.01" value={a?.applied_amount || ''} onChange={e => updateAllocAmount(inv.id, e.target.value)}
                              disabled={!a?.selected}
                              className="w-24 px-2 py-1 border border-gray-200 rounded text-right text-[10px] disabled:bg-gray-100 disabled:text-gray-400 ml-auto block" />
                          </td>
                          <td className="px-2 py-2 text-right text-[10px] text-orange-600">{ewt > 0 ? `(${formatCurrency(ewt)})` : '—'}</td>
                          <td className="px-2 py-2 text-right text-[10px] text-orange-600">{lgu > 0 ? `(${formatCurrency(lgu)})` : '—'}</td>
                          <td className="px-2 py-2 text-right text-[10px] font-medium text-green-700">{a?.selected ? formatCurrency(cashPerInv) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">4 · Notes</div>
              <input type="text" value={batchForm.notes} onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })}
                placeholder="Batch collection remarks..." className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs" />
            </div>
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto p-4 space-y-4">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Allocation Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1"><span className="text-gray-500">Invoices Selected</span><span className="font-medium">{selectedAllocs.length}</span></div>
                <div className="flex justify-between py-1"><span className="text-gray-500">Total Applied</span><span className="font-semibold text-blue-700">{formatCurrency(totalApplied)}</span></div>
                <div className="flex justify-between py-1 border-t border-gray-100"><span className="text-gray-500">Cash / Bank (allocations)</span><span className="font-semibold text-green-700">{formatCurrency(totalCash)}</span></div>
              </div>
            </div>

            <div className="rounded-lg p-4 text-white" style={{ backgroundColor: primary }}>
              <div className="text-[10px] uppercase opacity-70 font-semibold mb-1">Amount Received</div>
              <div className="text-2xl font-bold tracking-tight">{formatCurrency(amountReceived)}</div>
            </div>

            {unapplied > 0 && (
              <div className="rounded-lg p-3 bg-orange-50 border border-orange-200 text-xs">
                <div className="text-[10px] font-semibold uppercase text-orange-700 mb-1">Unapplied Balance</div>
                <div className="text-lg font-bold text-orange-700">{formatCurrency(unapplied)}</div>
              </div>
            )}

            {totalCash > amountReceived && amountReceived > 0 && (
              <div className="rounded-lg p-3 bg-red-50 border border-red-200 text-xs text-red-700">
                Allocated cash exceeds amount received by {formatCurrency(totalCash - amountReceived)}
              </div>
            )}

            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs">
              <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Customer</div>
              <div className="font-medium text-gray-800">{customer.customer_name}</div>
              <div className="text-gray-500 mt-1">Outstanding: {formatCurrency(aging.total || 0)}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: '#1E40AF' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
          <h1 className="text-white font-semibold text-sm tracking-wide">Customer Statement</h1>
          <span className="text-xs text-white/80 truncate max-w-[200px]">{customer.customer_name}</span>
          <span className="text-xs font-mono text-white/60">{customer.customer_code}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={printBillingStatement}
            disabled={billingSelectedCount === 0}
            className="px-3 py-1.5 bg-white/20 text-white rounded text-xs font-medium hover:bg-white/30 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileText size={13} /> Billing Statement
          </button>
          <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/sales/customer-statement/${customerId}/print?token=${t}`, '_blank'); }}
            className="px-3 py-1.5 bg-white/20 text-white rounded text-xs font-medium hover:bg-white/30 flex items-center gap-1"><Printer size={13} /> Print SOA</button>
          <button onClick={openBatchPayment} className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 flex items-center gap-1"><Wallet size={13} /> Batch Payment</button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Customer Information</div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-400 block">Name</span><span className="font-medium text-gray-800">{customer.customer_name}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Code</span><span className="font-mono text-gray-700">{customer.customer_code || '—'}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Phone</span><span className="text-gray-700">{customer.phone || '—'}</span></div>
                <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-400 block">Address</span><span className="text-gray-600">{customer.address || '—'}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Contact</span><span className="text-gray-700">{customer.contact_person || '—'}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">TIN</span><span className="text-gray-700">{customer.tin || '—'}</span></div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Statement Summary</div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Statement Date</span><span className="text-gray-800">{new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Unpaid Invoices</span><span className="font-semibold text-gray-800">{invoices.length}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Payments on Record</span><span className="font-semibold text-gray-800">{payments.length}</span></div>
                <div className="bg-red-50 rounded p-1.5 border border-red-100"><span className="text-red-500 block">Total Outstanding</span><span className="font-bold text-red-600">{formatCurrency(aging.total || 0)}</span></div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 200 }}>
            <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
              <span className="text-[10px] font-semibold text-gray-500 uppercase">3 · Unpaid Invoices ({invoices.length})</span>
              <span className="text-[10px] text-gray-400">{billingSelectedCount} selected for billing</span>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                    <th className="px-2 py-2 w-8 text-center">
                      <input type="checkbox" checked={allBillingSelected} onChange={toggleAllBilling} className="rounded" title="Select all for billing" />
                    </th>
                    <th className="px-2 py-2 text-left">Invoice #</th>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">Due</th>
                    <th className="px-2 py-2 text-left">Description</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2 text-right">Balance</th>
                    <th className="px-2 py-2 text-right">Paid</th>
                    <th className="px-2 py-2 text-center">Overdue</th>
                    <th className="px-2 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {invoices.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">No unpaid invoices</td></tr>
                  )}
                  {invoices.map((inv: any) => {
                    const balanceDue = Math.max(0, parseFloat(inv.total) - parseFloat(inv.amount_paid) - parseFloat(inv.withholding_tax || '0'));
                    const daysPast = Math.max(0, parseInt(inv.days_past_due) || 0);
                    const isBillingSelected = !!billingSelected[inv.id];
                    return (
                      <tr key={inv.id} className={isBillingSelected ? 'bg-blue-50/50' : 'hover:bg-blue-50/20'}>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" checked={isBillingSelected} onChange={() => toggleBillingInvoice(inv.id)} className="rounded" />
                        </td>
                        <td className="px-2 py-2 font-mono text-[10px]">{inv.invoice_number}</td>
                        <td className="px-2 py-2 text-[10px]">{formatDate(inv.invoice_date)}</td>
                        <td className="px-2 py-2 text-[10px]">{formatDate(inv.due_date)}</td>
                        <td className="px-2 py-2 text-[10px] text-gray-500 max-w-[140px] truncate" title={inv.notes || ''}>{inv.notes || '—'}</td>
                        <td className="px-2 py-2 text-right text-[10px]">{formatCurrency(inv.total)}</td>
                        <td className="px-2 py-2 text-right text-[10px] font-semibold text-red-600">{formatCurrency(balanceDue)}</td>
                        <td className="px-2 py-2 text-right text-[10px] text-green-600">{formatCurrency(inv.amount_paid)}</td>
                        <td className="px-2 py-2 text-center">
                          <span className={`px-1.5 py-0.5 text-[9px] rounded-full ${daysPast > 60 ? 'bg-red-100 text-red-700' : daysPast > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                            {daysPast}d
                          </span>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <span className={`px-1.5 py-0.5 text-[9px] rounded-full ${inv.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>{inv.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Billing Statement — Description</div>
            <textarea
              value={billingDescription}
              onChange={(e) => setBillingDescription(e.target.value)}
              rows={3}
              placeholder="Enter billing remarks or payment instructions (shown on printed statement)..."
              className="w-full px-2.5 py-2 border border-gray-200 rounded text-xs resize-y min-h-[72px]"
            />
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden flex flex-col" style={{ minHeight: 180 }}>
            <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50">
              <span className="text-[10px] font-semibold text-gray-500 uppercase">4 · Payment History ({payments.length})</span>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gray-100 text-[9px] font-semibold text-gray-500 uppercase">
                    <th className="px-2 py-2 text-left">CR #</th>
                    <th className="px-2 py-2 text-left">Date</th>
                    <th className="px-2 py-2 text-left">Method</th>
                    <th className="px-2 py-2 text-left">Reference</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2 text-left">Applied Invoices</th>
                    <th className="px-2 py-2 text-center w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No payments recorded</td></tr>
                  )}
                  {payments.map((p: any) => (
                    <tr key={p.id} className="hover:bg-gray-50/50">
                      <td className="px-2 py-2 font-mono text-[10px]">{p.receipt_number}</td>
                      <td className="px-2 py-2 text-[10px]">{formatDate(p.payment_date)}</td>
                      <td className="px-2 py-2 text-[10px]">{p.payment_method}</td>
                      <td className="px-2 py-2 text-[10px] text-gray-500">{p.reference_number || '—'}</td>
                      <td className="px-2 py-2 text-right text-[10px] font-semibold text-green-600">{formatCurrency(p.amount)}</td>
                      <td className="px-2 py-2 text-[10px] text-gray-500 max-w-[180px] truncate" title={Array.isArray(p.applied_invoices) ? p.applied_invoices.map((a: any) => a.invoice_number).join(', ') : ''}>
                        {Array.isArray(p.applied_invoices) ? p.applied_invoices.map((a: any) => `${a.invoice_number} (${formatCurrency(a.amount)})`).join(', ') : '—'}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => printDocument(`/api/sales/collection-receipt/${p.id}/print`)}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Print
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto p-4 space-y-4">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">AR Aging</div>
            <div className="space-y-1.5">
              {[
                { label: 'Current', key: 'current', bar: 'bg-green-500' },
                { label: '1–30 Days', key: 'd30', bar: 'bg-yellow-500' },
                { label: '31–60 Days', key: 'd60', bar: 'bg-orange-500' },
                { label: '61–90 Days', key: 'd90', bar: 'bg-red-400' },
                { label: '90+ Days', key: 'over90', bar: 'bg-red-600' },
              ].map(({ label, key, bar }) => {
                const amt = parseFloat(aging[key] || 0);
                const pct = aging.total ? Math.min(100, (amt / parseFloat(aging.total)) * 100) : 0;
                return (
                  <div key={key} className="text-xs">
                    <div className="flex justify-between mb-0.5">
                      <span className="text-gray-500">{label}</span>
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

          <div className="rounded-lg p-4 text-white" style={{ backgroundColor: '#1E40AF' }}>
            <div className="text-[10px] uppercase opacity-70 font-semibold mb-1">Total Outstanding</div>
            <div className="text-2xl font-bold tracking-tight">{formatCurrency(aging.total || 0)}</div>
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Unpaid Invoices</span><span className="font-medium">{invoices.length}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Collection Receipts</span><span className="font-medium">{payments.length}</span></div>
          </div>

          <div className="border border-blue-100 rounded-lg p-3 bg-blue-50/40 space-y-2">
            <div className="text-[10px] font-semibold text-blue-800 uppercase tracking-wider">Billing Statement ({billingSelectedCount})</div>
            {billingSelectedCount === 0 ? (
              <p className="text-[10px] text-gray-500">Check invoices in the list to include them on the billing statement.</p>
            ) : (
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between"><span className="text-gray-600">Total Php Exc. VAT</span><span>{formatCurrency(billingTotals.totalExcVat)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">VAT Amount</span><span>{formatCurrency(billingTotals.vatAmount)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Total Php Inc. VAT</span><span>{formatCurrency(billingTotals.totalIncVat)}</span></div>
                {billingTotals.totalWht > 0 && (
                  <div className="flex justify-between"><span className="text-gray-600">Total WHT</span><span className="text-orange-700">({formatCurrency(billingTotals.totalWht)})</span></div>
                )}
                <div className="flex justify-between pt-1 border-t border-blue-200 font-semibold text-blue-900">
                  <span>Total Net Amount</span><span>{formatCurrency(billingTotals.netAmount)}</span>
                </div>
              </div>
            )}
            <button
              onClick={printBillingStatement}
              disabled={billingSelectedCount === 0}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-700 text-white rounded-lg text-xs font-semibold hover:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileText size={14} /> Print Billing Statement
            </button>
          </div>

          <button onClick={openBatchPayment}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700">
            <Wallet size={14} /> Record Batch Payment
          </button>
        </div>
      </div>
    </div>
  );
}
