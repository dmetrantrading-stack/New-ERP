import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';

const PAYMENT_METHODS = ['Cash', 'Check', 'Bank Transfer', 'GCash', 'Maya'];
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

  useEffect(() => {
    loadData();
    api.get('/bank-management/accounts').then(r => setBankAccounts(r.data?.value || r.data || [])).catch(() => {});
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

  if (loading) return <div className="text-center py-8 text-gray-400">Loading...</div>;
  if (!customer) return <div className="text-center py-8 text-gray-400">Customer not found</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Statement</h1>
          <p className="text-sm text-gray-500">{customer.customer_name} ({customer.customer_code})</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate(-1)} className="px-4 py-2 border rounded-lg text-sm">Back</button>
          <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/sales/customer-statement/${customerId}/print?token=${t}`, '_blank'); }} className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm">Print Statement</button>
          <button onClick={openBatchPayment} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Batch Payment</button>
        </div>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">Customer Details</h3>
          <p className="text-sm"><strong>Name:</strong> {customer.customer_name}</p>
          <p className="text-sm"><strong>Code:</strong> {customer.customer_code}</p>
          <p className="text-sm"><strong>Address:</strong> {customer.address || '—'}</p>
          <p className="text-sm"><strong>Contact:</strong> {customer.contact_person || '—'}</p>
          <p className="text-sm"><strong>Phone:</strong> {customer.phone || '—'}</p>
        </div>
        <div className="bg-white border rounded-lg p-4">
          <h3 className="text-sm font-semibold mb-2">Company</h3>
          <p className="font-bold text-sm">D METRAN TRADING</p>
          <p className="text-xs text-gray-500">Donnel M. Metran - Prop.</p>
          <p className="text-xs text-gray-500">VAT REG TIN: 418 944 134 000</p>
          <p className="text-xs text-gray-500">New Public Market, Sta. Cruz, Zambales 2213</p>
          <p className="text-xs text-gray-500 mt-2">Statement Date: {new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      {/* Aging */}
      <div className="grid grid-cols-6 gap-2">
        {[
          { label: 'Current', key: 'current', color: 'bg-green-100 text-green-700' },
          { label: '1-30 Days', key: 'd30', color: 'bg-yellow-100 text-yellow-700' },
          { label: '31-60 Days', key: 'd60', color: 'bg-orange-100 text-orange-700' },
          { label: '61-90 Days', key: 'd90', color: 'bg-red-100 text-red-700' },
          { label: '90+ Days', key: 'over90', color: 'bg-red-200 text-red-800' },
          { label: 'Total', key: 'total', color: 'bg-blue-100 text-blue-700' },
        ].map(({ label, key, color }) => (
          <div key={key} className={`text-center p-2 rounded-lg ${color}`}>
            <p className="text-xs font-semibold">{label}</p>
            <p className="text-sm font-bold">{formatCurrency(aging[key] || 0)}</p>
          </div>
        ))}
      </div>

      {/* Unpaid Invoices */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50"><h2 className="font-semibold text-sm">Unpaid Invoices</h2></div>
        <table className="data-table w-full">
          <thead><tr><th>Invoice #</th><th>Date</th><th>Due Date</th><th>Description</th><th style={{textAlign:'right'}}>Invoice Total</th><th style={{textAlign:'right'}}>Balance Due</th><th style={{textAlign:'right'}}>Paid</th><th className="text-center">Days Overdue</th><th>Status</th></tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-gray-400">No unpaid invoices</td></tr>}
            {invoices.map((inv: any) => (
              <tr key={inv.id}>
                <td className="font-mono text-xs">{inv.invoice_number}</td>
                <td className="text-xs">{formatDate(inv.invoice_date)}</td>
                <td className="text-xs">{formatDate(inv.due_date)}</td>
                <td className="text-xs max-w-[150px] truncate text-gray-500" title={inv.notes || ''}>{inv.notes || '—'}</td>
                <td style={{textAlign:'right'}}>{formatCurrency(inv.total)}</td>
                <td style={{textAlign:'right'}} className="font-bold text-red-600">{formatCurrency(inv.balance)}</td>
                <td style={{textAlign:'right'}}>{formatCurrency(inv.amount_paid)}</td>
                <td className="text-center">
                  <span className={`px-2 py-0.5 text-xs rounded-full ${parseInt(inv.days_past_due) > 60 ? 'bg-red-100 text-red-700' : parseInt(inv.days_past_due) > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                    {Math.max(0, parseInt(inv.days_past_due) || 0)} days
                  </span>
                </td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${inv.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>{inv.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payment History */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50"><h2 className="font-semibold text-sm">Payment History</h2></div>
        <table className="data-table w-full">
          <thead><tr><th>CR #</th><th>Date</th><th>Method</th><th>Check/Ref</th><th className="text-right">Amount</th><th>Applied Invoices</th><th>Actions</th></tr></thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">No payments</td></tr>}
            {payments.map((p: any) => (
              <tr key={p.id}>
                <td className="font-mono text-xs">{p.receipt_number}</td>
                <td className="text-xs">{formatDate(p.payment_date)}</td>
                <td>{p.payment_method}</td>
                <td className="text-xs text-gray-500">{p.reference_number || '—'}</td>
                <td className="text-right font-medium text-green-600">{formatCurrency(p.amount)}</td>
                <td className="text-xs text-gray-500">
                  {Array.isArray(p.applied_invoices) ? p.applied_invoices.map((a: any) => `${a.invoice_number} (${formatCurrency(a.amount)})`).join(', ') : '—'}
                </td>
                <td>
                  <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/sales/collection-receipt/${p.id}/print?token=${t}`, '_blank'); }} className="text-xs text-blue-600 hover:underline">Print CR</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Batch Payment Modal */}
      {showBatchPayment && (
        <div className="modal-overlay" onClick={() => setShowBatchPayment(false)}>
          <div className="modal-content max-w-4xl" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Batch Payment Allocation</h2>

              {/* Payment Header */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Customer</label>
                  <input type="text" value={customer?.customer_name || ''} readOnly className="w-full px-3 py-2 border rounded-lg text-sm bg-gray-50" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Payment Date</label>
                  <input type="date" value={batchForm.payment_date} onChange={e => setBatchForm({ ...batchForm, payment_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Payment Method</label>
                  <select value={batchForm.payment_method} onChange={e => {
                    const m = e.target.value;
                    setBatchForm(f => ({ ...f, payment_method: m, deposit_to: m === 'Cash' ? 'cash' : f.deposit_to }));
                  }} className="w-full px-3 py-2 border rounded-lg text-sm">
                    {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              {/* Check-specific fields */}
              {batchForm.payment_method === 'Check' && (
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div><label className="block text-xs font-medium mb-1">Check Number</label><input type="text" value={batchForm.reference_number} onChange={e => setBatchForm({ ...batchForm, reference_number: e.target.value })} placeholder="e.g. 001234" className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                  <div><label className="block text-xs font-medium mb-1">Check Date</label><input type="date" value={batchForm.check_date} onChange={e => setBatchForm({ ...batchForm, check_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                  <div><label className="block text-xs font-medium mb-1">Bank Name</label><input type="text" value={batchForm.check_bank} onChange={e => setBatchForm({ ...batchForm, check_bank: e.target.value })} placeholder="e.g. BPI" className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                  <div><label className="block text-xs font-medium mb-1">Branch</label><input type="text" value={batchForm.check_branch} onChange={e => setBatchForm({ ...batchForm, check_branch: e.target.value })} placeholder="e.g. Cagayan de Oro" className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                </div>
              )}

              {batchForm.payment_method !== 'Check' && batchForm.payment_method !== 'Cash' && (
                <div className="mb-4">
                  <label className="block text-xs font-medium mb-1">Reference #</label>
                  <input type="text" value={batchForm.reference_number} onChange={e => setBatchForm({ ...batchForm, reference_number: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium mb-1">Deposit To</label>
                  <select value={batchForm.deposit_to} onChange={e => setBatchForm({ ...batchForm, deposit_to: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                    {DEPOSIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {batchForm.deposit_to === 'bank' && (
                  <div>
                    <label className="block text-xs font-medium mb-1">Bank Account</label>
                    <select value={batchForm.bank_account_id} onChange={e => setBatchForm({ ...batchForm, bank_account_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select</option>
                      {bankAccounts.map((ba: any) => <option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium mb-1">Cash / Bank Received</label>
                  <input type="number" step="0.01" value={batchForm.amount_received} onChange={e => setBatchForm({ ...batchForm, amount_received: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm font-bold" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Notes</label>
                  <input type="text" value={batchForm.notes} onChange={e => setBatchForm({ ...batchForm, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              {/* Invoice allocation table */}
              <div className="bg-gray-50 rounded-lg p-3 mb-4">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-sm font-semibold">Invoice Allocation</h3>
                  <div className="text-sm space-x-3">
                    <span className="text-gray-500">Applied: </span>
                    <span className="font-bold text-blue-700">{formatCurrency(totalApplied)}</span>
                    <span className="text-gray-500">Cash/Bank: </span>
                    <span className="font-bold text-green-700">{formatCurrency(totalCash)}</span>
                    {unapplied > 0 && <span className="text-orange-600">Unapplied: {formatCurrency(unapplied)}</span>}
                  </div>
                </div>
                <table className="w-full text-sm border">
                  <thead><tr className="bg-gray-100 text-xs"><th className="p-2 text-left" style={{width:30}}></th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Invoice #</th><th className="p-2 text-right">Balance</th><th className="p-2 text-right">Applied</th><th className="p-2 text-right">EWT</th><th className="p-2 text-right">LGU</th><th className="p-2 text-right">Cash</th></tr></thead>
                  <tbody>
                    {invoices.map((inv: any) => {
                      const a = batchAllocations[inv.id];
                      const bal = parseFloat(inv.balance);
                      const ewt = parseFloat(inv.withholding_tax || '0');
                      const lgu = parseFloat(inv.lgu_final_tax || '0');
                      const cashPerInv = (parseFloat(a?.applied_amount) || 0) - (parseFloat(a?.ewt_amount) || 0) - (parseFloat(a?.lgu_amount) || 0);
                      return (
                        <tr key={inv.id} className="border-t">
                          <td className="p-2"><input type="checkbox" checked={a?.selected || false} onChange={() => toggleAllocInvoice(inv.id)} /></td>
                          <td className="p-2 text-xs">{formatDate(inv.invoice_date)}</td>
                          <td className="p-2 text-xs font-mono">{inv.invoice_number}</td>
                          <td className="p-2 text-right font-bold text-red-600">{formatCurrency(bal)}</td>
                          <td className="p-2">
                            <input type="number" step="0.01" value={a?.applied_amount || ''} onChange={e => updateAllocAmount(inv.id, e.target.value)}
                              disabled={!a?.selected}
                              className="w-24 px-2 py-1 border rounded text-right text-xs" />
                          </td>
                          <td className="p-2 text-right text-xs text-orange-600">{ewt > 0 ? `(${formatCurrency(ewt)})` : '—'}</td>
                          <td className="p-2 text-right text-xs text-orange-600">{lgu > 0 ? `(${formatCurrency(lgu)})` : '—'}</td>
                          <td className="p-2 text-right text-xs font-medium text-green-700">{a?.selected ? formatCurrency(cashPerInv) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-3">
                <button onClick={() => setShowBatchPayment(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={submitBatchPayment} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Post Collection</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
