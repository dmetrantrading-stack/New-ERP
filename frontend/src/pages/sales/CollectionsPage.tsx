import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Search } from 'lucide-react';
import toast from 'react-hot-toast';

const PAYMENT_METHODS = ['Cash', 'Check'];

export default function CollectionsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const invoiceParam = searchParams.get('invoice');

  const [activeTab, setActiveTab] = useState<'ar' | 'statements'>('ar');
  const [outstanding, setOutstanding] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Customer Statements state
  const [customerStatements, setCustomerStatements] = useState<any[]>([]);
  const [csSearch, setCsSearch] = useState('');
  const [csDateFrom, setCsDateFrom] = useState('2020-01-01');
  const [csDateTo, setCsDateTo] = useState(new Date().toISOString().split('T')[0]);

  // Single-invoice modal (existing)
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [form, setForm] = useState({
    applied_amount: '', cash_collected: '', ewt_amount: '0', ewt_rate: '0',
    lgu_amount: '0', payment_method: 'Cash', reference_number: '', notes: '',
    bank_account_id: '', collection_date: new Date().toISOString().split('T')[0],
    check_date: '', check_bank: '',
  });

  useEffect(() => {
    loadData();
    api.get('/bank-management/accounts').then(r => setBankAccounts(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (invoiceParam && outstanding.length > 0) {
      const inv = outstanding.find((i: any) => i.invoice_id === invoiceParam);
      if (inv) selectForPayment(inv);
    }
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
  const selectForPayment = (inv: any) => {
    const ewt = parseFloat(inv.withholding_tax || '0');
    const lgu = parseFloat(inv.lgu_final_tax || '0');
    const bal = parseFloat(inv.balance);
    const hasLGU = lgu > 0;
    const hasEWT = ewt > 0;
    const ewtRate = hasLGU ? '1' : (hasEWT ? String(Math.round((ewt / bal) * 100)) : '0');
    const lguAmount = hasLGU ? lgu : '0';
    const ewtAmount = hasEWT ? ewt : '0';
    const cashAmt = bal - parseFloat(ewtAmount) - parseFloat(lguAmount);

    setSelectedInvoice(inv);
    setForm({
      applied_amount: String(bal), cash_collected: String(Math.max(0, cashAmt)),
      ewt_amount: ewtAmount, ewt_rate: ewtRate, lgu_amount: lguAmount,
      payment_method: 'Cash', reference_number: '', notes: '',
      bank_account_id: '', collection_date: new Date().toISOString().split('T')[0],
      check_date: '', check_bank: '',
    });
  };

  const recalcCash = (applied: string, rate: string, lguAmt: string) => {
    const app = parseFloat(applied) || 0;
    const r = parseFloat(rate) || 0;
    const lg = parseFloat(lguAmt) || 0;
    if (r > 0 && !selectedInvoice?.lgu_final_tax) {
      const newEwt = Math.round(app * (r / 100) * 100) / 100;
      const cash = Math.max(0, app - newEwt - lg);
      setForm(f => ({ ...f, applied_amount: applied, ewt_rate: rate, ewt_amount: String(newEwt), lgu_amount: lguAmt, cash_collected: String(Math.round(cash * 100) / 100) }));
    } else {
      const cash = Math.max(0, app - parseFloat(form.ewt_amount || '0') - lg);
      setForm(f => ({ ...f, applied_amount: applied, ewt_rate: rate, lgu_amount: lguAmt, cash_collected: String(Math.round(cash * 100) / 100) }));
    }
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
        bank_account_id: isBank ? form.bank_account_id : undefined,
        collection_date: form.collection_date,
        check_date: form.check_date || undefined,
        check_bank: form.check_bank || undefined,
      };
      const res = await api.post('/sales/collections', payload);
      toast.success(`Collected: ${formatCurrency(cash)} | Applied: ${formatCurrency(applied)} | Balance: ${formatCurrency(res.data.new_balance)}`);
      setSelectedInvoice(null);
      loadData();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const aging = outstanding.reduce((acc, inv) => {
    const bucket = inv.aging_bucket || 'Current';
    acc[bucket] = (acc[bucket] || 0) + parseFloat(inv.balance);
    acc.total = (acc.total || 0) + parseFloat(inv.balance);
    return acc;
  }, { total: 0 } as Record<string, number>);

  const taxProfile = selectedInvoice ? {
    gross: parseFloat(selectedInvoice.total),
    ewt: parseFloat(selectedInvoice.withholding_tax || 0),
    lgu: parseFloat(selectedInvoice.lgu_final_tax || 0),
    vat: parseFloat(selectedInvoice.vat_amount || 0),
    balance: parseFloat(selectedInvoice.balance),
    hasLGU: parseFloat(selectedInvoice.lgu_final_tax || '0') > 0,
    taxType: selectedInvoice.tax_type,
  } : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Collections &amp; AR</h1>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('ar')} className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === 'ar' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Outstanding AR</button>
        <button onClick={() => setActiveTab('statements')} className={`px-4 py-2 text-sm font-medium rounded-lg ${activeTab === 'statements' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>Customer Statements</button>
      </div>

      {activeTab === 'statements' && (
        <>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={csSearch} onChange={e => setCsSearch(e.target.value)} placeholder="Search customer..." className="pl-8 pr-3 py-2 border rounded-lg text-sm w-56" />
            </div>
            <div><label className="text-xs text-gray-500">From</label><input type="date" value={csDateFrom} onChange={e => setCsDateFrom(e.target.value)} className="ml-1 px-2 py-1 border rounded text-sm" /></div>
            <div><label className="text-xs text-gray-500">To</label><input type="date" value={csDateTo} onChange={e => setCsDateTo(e.target.value)} className="ml-1 px-2 py-1 border rounded text-sm" /></div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50"><h2 className="font-semibold text-sm text-gray-700">Customer Statements (Unpaid Invoices)</h2></div>
            <table className="data-table w-full">
              <thead><tr><th>View</th><th>Date</th><th>Customer</th><th style={{textAlign:'right'}}>Unpaid Invoices</th><th style={{textAlign:'right'}}>Total Balance Due</th></tr></thead>
              <tbody>
                {customerStatements.length === 0 && <tr><td colSpan={5} className="text-center py-8 text-gray-400">No customers with unpaid invoices</td></tr>}
                {customerStatements.map((cs: any) => (
                  <tr key={cs.customer_id} className="hover:bg-blue-50 cursor-pointer" onClick={() => navigate(`/customer-statement/${cs.customer_id}`)}>
                    <td><span className="text-blue-600 text-xs hover:underline">View</span></td>
                    <td className="text-xs">{formatDate(cs.oldest_invoice_date)}</td>
                    <td><div className="font-medium">{cs.customer_name}</div><div className="text-xs text-gray-500">{cs.customer_code}</div></td>
                    <td className="text-right font-medium">{cs.unpaid_count}</td>
                    <td className="text-right font-bold text-red-600">{formatCurrency(cs.total_outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {customerStatements.length > 0 && (
              <div className="flex justify-end px-4 py-3 border-t bg-gray-50">
                <span className="text-sm font-bold">Grand Total: <span className="text-red-600 text-lg">{formatCurrency(customerStatements.reduce((s, cs) => s + parseFloat(cs.total_outstanding), 0))}</span></span>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'ar' && (<>

      {/* AR Aging */}
      <div className="grid grid-cols-5 gap-3">
        {['Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'].map(bucket => (
          <div key={bucket} className={`bg-white border rounded-lg p-3 text-center ${bucket === '90+ Days' ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}>
            <p className="text-xs text-gray-500 uppercase font-semibold">{bucket}</p>
            <p className={`text-lg font-bold ${bucket === '90+ Days' ? 'text-red-600' : 'text-gray-800'}`}>{formatCurrency(aging[bucket] || 0)}</p>
          </div>
        ))}
      </div>

      {/* Outstanding AR */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-sm text-gray-700">Outstanding Receivables ({outstanding.length})</h2>
          <span className="text-sm font-bold text-blue-700">Total: {formatCurrency(aging.total)}</span>
        </div>
        <table className="data-table">
          <thead><tr><th>Invoice #</th><th>Customer</th><th>Date</th><th>Due</th><th>Total</th><th>Paid</th><th>Balance</th><th>Aging</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {outstanding.map((inv) => (
              <tr key={inv.invoice_id} className={inv.invoice_id === invoiceParam ? 'bg-blue-50' : ''}>
                <td className="font-mono text-xs">{inv.invoice_number}</td>
                <td>{inv.customer_name}{inv.customer_code ? <span className="text-gray-400 text-xs ml-1">({inv.customer_code})</span> : ''}</td>
                <td className="text-xs">{formatDate(inv.invoice_date)}</td>
                <td className="text-xs">{formatDate(inv.due_date)}</td>
                <td>{formatCurrency(inv.total)}</td>
                <td>{formatCurrency(inv.amount_paid)}</td>
                <td className="font-medium text-red-600">{formatCurrency(inv.balance)}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${parseFloat(inv.days_overdue) > 60 ? 'bg-red-100 text-red-700' : parseFloat(inv.days_overdue) > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>{inv.aging_bucket}</span></td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${inv.status === 'Partial' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>{inv.status}</span></td>
                <td>
                  <button onClick={() => selectForPayment(inv)} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Collect</button>
                </td>
              </tr>
            ))}
            {outstanding.length === 0 && <tr><td colSpan={10} className="text-center py-8 text-gray-400">No outstanding receivables</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Collection History */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50"><h2 className="font-semibold text-sm text-gray-700">Collection History</h2></div>
        <table className="data-table">
          <thead><tr><th>Receipt #</th><th>Customer</th><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead>
          <tbody>
            {collections.map((col) => (
              <tr key={col.id}>
                <td className="font-mono text-xs">{col.receipt_number}</td><td>{col.customer_name || col.employee_name || '-'}</td>
                <td className="text-xs">{formatDate(col.payment_date)}</td><td>{col.payment_method}</td>
                <td className="text-xs text-gray-500">{col.reference_number || '-'}</td>
                <td className="font-medium text-green-600">{formatCurrency(col.amount)}</td>
              </tr>
            ))}
            {collections.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-gray-400">No collections</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Single Collection Modal */}
      {selectedInvoice && (
        <div className="modal-overlay" onClick={() => setSelectedInvoice(null)}>
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-1">Collect Payment</h2>
              <p className="text-sm text-gray-500 mb-4">{selectedInvoice.invoice_number} — {selectedInvoice.customer_name}</p>

              <div className="bg-gray-50 rounded-lg p-3 mb-4 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Invoice Date</span><span className="font-medium">{formatDate(selectedInvoice.invoice_date)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Due Date</span><span className="font-medium">{formatDate(selectedInvoice.due_date)}</span></div>
                {taxProfile && taxProfile.gross > 0 && <div className="flex justify-between border-t pt-1"><span className="font-semibold">Invoice Total</span><span className="font-bold">{formatCurrency(taxProfile.gross)}</span></div>}
                {taxProfile && taxProfile.vat > 0 && <div className="flex justify-between"><span className="text-gray-500">12% VAT</span><span>{formatCurrency(taxProfile.vat)}</span></div>}
                {taxProfile && taxProfile.lgu > 0 && <div className="flex justify-between"><span className="text-gray-500">LGU 5% Final VAT</span><span className="text-orange-600">-{formatCurrency(taxProfile.lgu)}</span></div>}
                {taxProfile && taxProfile.ewt > 0 && <div className="flex justify-between"><span className="text-gray-500">EWT</span><span className="text-orange-600">-{formatCurrency(taxProfile.ewt)}</span></div>}
                <div className="flex justify-between"><span className="text-gray-500">Previously Paid</span><span className="text-green-600">{formatCurrency(parseFloat(selectedInvoice.amount_paid))}</span></div>
                <div className="flex justify-between border-t pt-1"><span className="font-bold text-red-600">Outstanding Balance</span><span className="font-bold text-red-600 text-lg">{formatCurrency(parseFloat(selectedInvoice.balance))}</span></div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Applied Amount</span>
                  <input type="number" step="0.01" value={form.applied_amount}
                    onChange={(e) => recalcCash(e.target.value, form.ewt_rate, form.lgu_amount)}
                    className="w-28 px-2 py-1 border rounded text-right text-sm font-bold" />
                </div>
                {!taxProfile?.hasLGU && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-600">EWT Rate</span>
                    <div className="flex rounded border overflow-hidden">
                      {['0', '1', '2'].map(r => (
                        <button key={r} type="button" onClick={() => recalcCash(form.applied_amount, r, form.lgu_amount)}
                          className={`px-2 py-1 text-xs font-medium ${form.ewt_rate === r ? 'bg-orange-600 text-white' : 'bg-white text-gray-600'}`}>{r === '0' ? 'None' : `${r}%`}</button>
                      ))}
                    </div>
                  </div>
                )}
                {parseFloat(form.ewt_amount) > 0 && (
                  <div className="flex justify-between bg-orange-50 rounded px-2 py-1 -mx-1"><span className="text-gray-700 font-medium">Less: EWT {form.ewt_rate}%</span><span className="font-bold text-red-600">-{formatCurrency(parseFloat(form.ewt_amount))}</span></div>
                )}
                {parseFloat(form.lgu_amount) > 0 && (
                  <div className="flex justify-between bg-orange-50 rounded px-2 py-1 -mx-1"><span className="text-gray-700 font-medium">Less: LGU 5% Final VAT</span><span className="font-bold text-red-600">-{formatCurrency(parseFloat(form.lgu_amount))}</span></div>
                )}
                <div className="flex justify-between border-t pt-1 border-blue-300"><span className="font-bold text-blue-700">Cash / Bank to Collect</span><span className="font-bold text-lg text-blue-700">{formatCurrency(parseFloat(form.cash_collected))}</span></div>
                <div className="flex justify-between border-t pt-1 border-blue-300"><span className="font-bold text-gray-700">Total Applied to Invoice</span><span className="font-bold text-lg text-gray-900">{formatCurrency(parseFloat(form.applied_amount) || 0)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Remaining After</span><span className={`font-bold ${(parseFloat(selectedInvoice.balance) - (parseFloat(form.applied_amount) || 0)) <= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(Math.max(0, parseFloat(selectedInvoice.balance) - (parseFloat(form.applied_amount) || 0)))}</span></div>
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-sm font-medium mb-1">Collection Date</label><input type="date" value={form.collection_date} onChange={e => setForm({ ...form, collection_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                  <div><label className="block text-sm font-medium mb-1">Payment Method</label>
                    <select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value, bank_account_id: '' })} className="w-full px-3 py-2 border rounded-lg text-sm">
                      {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                {form.payment_method === 'Check' && (
                  <>
                    <div><label className="block text-sm font-medium mb-1">Check Number</label><input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} placeholder="e.g. 001234" className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-sm font-medium mb-1">Check Date</label><input type="date" value={form.check_date} onChange={e => setForm({ ...form, check_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                      <div><label className="block text-sm font-medium mb-1">Check Bank / Branch</label><input type="text" value={form.check_bank} onChange={e => setForm({ ...form, check_bank: e.target.value })} placeholder="e.g. BPI Cagayan de Oro" className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                    </div>
                  </>
                )}

                {(form.payment_method === 'Check' || form.payment_method === 'Bank Transfer') && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <label className="block text-sm font-medium mb-1">Bank Account</label>
                    <select value={form.bank_account_id} onChange={e => setForm({ ...form, bank_account_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select</option>
                      {bankAccounts.map((ba: any) => (<option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name}</option>))}
                    </select>
                  </div>
                )}

                {form.payment_method !== 'Check' && <div><label className="block text-sm font-medium mb-1">OR / CR Number</label><input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>}
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setSelectedInvoice(null)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={submitSingle} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">Post Collection</button>
              </div>
            </div>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}
