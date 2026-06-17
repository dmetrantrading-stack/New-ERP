import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, ArrowRightLeft, Search, Trash2, Edit2, FileText, X } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

export default function BankCashPage() {
  const [activeTab, setActiveTab] = useState('accounts');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [cashTxns, setCashTxns] = useState<any[]>([]);
  const [bankTxns, setBankTxns] = useState<any[]>([]);
  const [ctPage, setCtPage] = useState(1);
  const [ctTotal, setCtTotal] = useState(0);

  // Modals
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showCashInModal, setShowCashInModal] = useState(false);
  const [showCashOutModal, setShowCashOutModal] = useState(false);
  const [showBankTxnModal, setShowBankTxnModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [checksOnHand, setChecksOnHand] = useState<any[]>([]);
  const [selectedChecks, setSelectedChecks] = useState<Record<string, boolean>>({});
  const [showReconcileModal, setShowReconcileModal] = useState(false);

  // Petty Cash Vouchers
  const [pcvList, setPcvList] = useState<any[]>([]);
  const [showPcvModal, setShowPcvModal] = useState(false);
  const [pcvForm, setPcvForm] = useState<any>({ payee: '', amount: 0, category: '', description: '', voucher_date: new Date().toISOString().split('T')[0] });
  const [showEditPcvModal, setShowEditPcvModal] = useState(false);
  const [editPcvForm, setEditPcvForm] = useState<any>({ payee: '', amount: 0, category: '', description: '', voucher_date: '' });
  const [selectedPcvs, setSelectedPcvs] = useState<Record<string, boolean>>({});
  const [expenseCategories, setExpenseCategories] = useState<any[]>([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', account_code: '' });

  // Forms
  const [accountForm, setAccountForm] = useState<any>({ account_code: '', bank_name: '', account_name: '', account_number: '', account_type: 'Savings', gl_account_code: '', pos_payment_method: '' });
  const [editForm, setEditForm] = useState<any>({});
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [cashInForm, setCashInForm] = useState<any>({ amount: 0, notes: '' });
  const [cashOutForm, setCashOutForm] = useState<any>({ amount: 0, notes: '' });
  const [bankTxnForm, setBankTxnForm] = useState<any>({ bank_account_id: '', transaction_type: 'Deposit', amount: 0, notes: '' });
  const [transferForm, setTransferForm] = useState<any>({ from_account_id: '', to_account_id: '', amount: 0, notes: '', receipt_ids: [] });
  const [reconcileForm, setReconcileForm] = useState<any>({ bank_account_id: '', statement_balance: 0 });
  const [reconcileResult, setReconcileResult] = useState<any>(null);

  useEffect(() => {
    if (activeTab === 'accounts') api.get('/bank-cash/accounts').then(r => setAccounts(r.data)).catch(() => {});
    if (activeTab === 'transactions') {
      api.get(`/bank-cash/cash-transactions?page=${ctPage}&limit=20`).then(r => { setCashTxns(r.data.data || r.data || []); setCtTotal(r.data.total || 0); }).catch(() => {});
      api.get('/bank-cash/transactions').then(r => setBankTxns(r.data)).catch(() => {});
    }
  }, [activeTab, ctPage]);

  const refreshAccounts = () => api.get('/bank-cash/accounts').then(r => setAccounts(r.data));

  const saveAccount = async () => {
    try {
      await api.post('/bank-cash/accounts', accountForm);
      toast.success('Account created');
      setShowAccountModal(false);
      setAccountForm({ account_code: '', bank_name: '', account_name: '', account_number: '', account_type: 'Savings' });
      refreshAccounts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openEdit = (a: any) => { setEditForm({ ...a }); setShowEditModal(true); };
  const saveEdit = async () => {
    try { await api.put(`/bank-cash/accounts/${editForm.id}`, editForm); toast.success('Updated'); setShowEditModal(false); refreshAccounts(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const viewLedger = async (id: number) => {
    try { const r = await api.get(`/bank-cash/accounts/${id}/ledger`); setLedgerData(r.data); setShowLedgerModal(true); }
    catch { toast.error('Failed to load ledger'); }
  };

  const postCashIn = async () => {
    try { await api.post('/bank-cash/cash-in', cashInForm); toast.success('Cash In recorded'); setShowCashInModal(false); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const postCashOut = async () => {
    try { await api.post('/bank-cash/cash-out', cashOutForm); toast.success('Cash Out recorded'); setShowCashOutModal(false); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const postBankTxn = async () => {
    try { await api.post('/bank-cash/transactions', bankTxnForm); toast.success('Transaction recorded'); setShowBankTxnModal(false); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const loadChecks = async () => {
    try {
      const r = await api.get('/bank-cash/checks-on-hand');
      setChecksOnHand(r.data || []);
      setSelectedChecks({});
    } catch { toast.error('Failed to load checks'); }
  };

  const toggleCheck = (id: string) => {
    setSelectedChecks(prev => {
      const next = { ...prev, [id]: !prev[id] };
      const ids = Object.entries(next).filter(([_, v]) => v).map(([k]) => k);
      const total = checksOnHand.filter(ch => next[ch.id]).reduce((s, ch) => s + parseFloat(ch.amount), 0);
      setTransferForm(f => ({ ...f, receipt_ids: ids, amount: total }));
      return next;
    });
  };

  const postTransfer = async () => {
    try {
      const payload = { ...transferForm };
      if (payload.receipt_ids && payload.receipt_ids.length === 0) delete payload.receipt_ids;
      await api.post('/bank-cash/transfers', payload);
      toast.success('Transfer complete'); setShowTransferModal(false); refreshAccounts();
      setSelectedChecks({});
    }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const doReconcile = async () => {
    try {
      const res = await api.post('/bank-cash/reconcile', reconcileForm);
      setReconcileResult(res.data);
      toast.success(res.data.is_reconciled ? 'Account reconciled!' : 'Difference found');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const deactivateAccount = async (id: number) => {
    if (!confirm('Deactivate this account?')) return;
    try { await api.delete(`/bank-cash/accounts/${id}`); toast.success('Deactivated'); api.get('/bank-cash/accounts').then(r => setAccounts(r.data)); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const totalCash = accounts.reduce((s, a) => s + Number(a.computed_balance ?? a.balance ?? 0), 0);

  // Petty Cash Voucher functions
  const savePcv = async () => {
    if (!pcvForm.payee || !pcvForm.amount) { toast.error('Payee and amount required'); return; }
    try {
      await api.post('/bank-cash/petty-cash-vouchers', pcvForm);
      toast.success('PCV created');
      setShowPcvModal(false);
      setPcvForm({ payee: '', amount: 0, category: '', description: '', voucher_date: new Date().toISOString().split('T')[0] });
      api.get('/bank-cash/petty-cash-vouchers').then(r => setPcvList(r.data || [])).catch(() => {});
      refreshAccounts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openEditPcv = (v: any) => { setEditPcvForm({ ...v }); setShowEditPcvModal(true); };
  const saveEditPcv = async () => {
    if (!editPcvForm.payee || !editPcvForm.amount) { toast.error('Payee and amount required'); return; }
    try {
      await api.put(`/bank-cash/petty-cash-vouchers/${editPcvForm.id}`, editPcvForm);
      toast.success('PCV updated');
      setShowEditPcvModal(false);
      api.get('/bank-cash/petty-cash-vouchers').then(r => setPcvList(r.data || [])).catch(() => {});
      refreshAccounts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const togglePcv = (id: string) => setSelectedPcvs(prev => ({ ...prev, [id]: !prev[id] }));

  const replenishPcvs = async () => {
    const ids = Object.entries(selectedPcvs).filter(([_, v]) => v).map(([k]) => k);
    if (ids.length === 0) { toast.error('Select at least one voucher'); return; }
    try {
      await api.post('/bank-cash/petty-cash-vouchers/replenish', { voucher_ids: ids });
      toast.success(`${ids.length} vouchers replenished`);
      setSelectedPcvs({});
      api.get('/bank-cash/petty-cash-vouchers').then(r => setPcvList(r.data || [])).catch(() => {});
      refreshAccounts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const saveCategory = async () => {
    if (!catForm.name || !catForm.account_code) { toast.error('Name and account code required'); return; }
    try {
      await api.post('/expenses/categories', catForm);
      toast.success('Category added');
      setShowCatModal(false);
      setCatForm({ name: '', account_code: '' });
      api.get('/expenses/categories').then(r => setExpenseCategories(r.data || [])).catch(() => {});
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Bank & Cash Accounts</h1>
        <div className="flex gap-2">
          {activeTab === 'accounts' && <button onClick={() => { setAccountForm({ account_code: '', bank_name: '', account_name: '', account_number: '', account_type: 'Savings', gl_account_code: '', pos_payment_method: '' }); setShowAccountModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Account</button>}
          {activeTab === 'transactions' && (
            <>
              <button onClick={() => setShowCashInModal(true)} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"><Plus size={16} /> Cash In</button>
              <button onClick={() => setShowCashOutModal(true)} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"><Plus size={16} /> Cash Out</button>
              <button onClick={() => setShowBankTxnModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Deposit/Withdrawal</button>
              <button onClick={() => setShowTransferModal(true)} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"><ArrowRightLeft size={16} /> Transfer</button>
            </>
          )}
          {activeTab === 'reconcile' && <button onClick={() => setShowReconcileModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Search size={16} /> Reconcile</button>}
        </div>
      </div>

      <div className="flex gap-2">
        {['accounts', 'transactions', 'reconcile'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-medium capitalize ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200'}`}>
            {tab.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Accounts Tab */}
      {activeTab === 'accounts' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr>
                  <th className="w-16">Actions</th>
                  <th>Code</th>
                  <th>Bank</th>
                  <th>Account</th>
                  <th>Number</th>
                  <th>Type</th>
                  <th>Control Account</th>
                  <th className="text-right">Balance</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => openEdit(a)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="Edit"><Edit2 size={14} /></button>
                        <button onClick={() => viewLedger(a.id)} className="p-1 hover:bg-purple-50 rounded text-purple-600" title="Ledger"><FileText size={14} /></button>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{a.account_code || `ACC-${a.id}`}</td>
                    <td className="font-medium">{a.bank_name}</td>
                    <td>{a.account_name}</td>
                    <td className="font-mono text-xs">{a.account_number}</td>
                    <td><span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">{a.account_type || 'Savings'}</span></td>
                    <td className="text-xs text-gray-500">Cash & Cash Equivalents</td>
                    <td className="text-right font-bold">{formatCurrency(Number(a.computed_balance ?? a.balance ?? 0))}</td>
                    <td><span className={`px-2 py-1 text-xs rounded-full ${a.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{a.is_active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
                {accounts.length > 0 && (
                  <tr className="bg-gray-50 font-bold border-t-2 border-gray-300">
                    <td colSpan={7} className="text-right pr-4">Total Balance:</td>
                    <td className="text-right">{formatCurrency(totalCash)}</td>
                    <td></td>
                  </tr>
                )}
                {accounts.length === 0 && <tr><td colSpan={9} className="text-center text-gray-500 py-6">No accounts yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold mb-2">Cash Transactions</h2>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="data-table">
                <thead><tr><th>Ref #</th><th>Type</th><th className="text-right">Amount</th><th>Date</th><th>Notes</th></tr></thead>
                <tbody>
                  {cashTxns.map(t => (
                    <tr key={t.id}><td className="font-mono text-xs">{t.transaction_number}</td><td><span className={`px-2 py-1 text-xs rounded-full ${t.transaction_type === 'Cash In' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{t.transaction_type}</span></td><td className="text-right font-medium">{formatCurrency(t.amount)}</td><td className="text-xs">{formatDate(t.created_at)}</td><td className="text-xs text-gray-500">{t.notes || '—'}</td></tr>
                  ))}
                  {cashTxns.length === 0 && <tr><td colSpan={5} className="text-center text-gray-500 py-4">No cash transactions</td></tr>}
                </tbody>
              </table>
              <Pagination page={ctPage} totalPages={Math.ceil(ctTotal / 20)} total={ctTotal} onPageChange={setCtPage} />
            </div>
          </div>
          <div>
            <h2 className="text-lg font-semibold mb-2">Bank Transactions</h2>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="data-table">
                <thead><tr><th>Bank</th><th>Account</th><th>Type</th><th className="text-right">Amount</th><th>Date</th></tr></thead>
                <tbody>
                  {bankTxns.map(t => (
                    <tr key={t.id}><td>{t.bank_name}</td><td>{t.account_name}</td><td><span className={`px-2 py-1 text-xs rounded-full ${t.transaction_type === 'Deposit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{t.transaction_type}</span></td><td className="text-right font-medium">{formatCurrency(t.amount)}</td><td className="text-xs">{formatDate(t.transaction_date)}</td></tr>
                  ))}
                  {bankTxns.length === 0 && <tr><td colSpan={5} className="text-center text-gray-500 py-4">No bank transactions</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Petty Cash Tab */}
      {activeTab === 'petty-cash' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h2 className="font-semibold text-sm">Petty Cash Vouchers</h2>
            <button onClick={replenishPcvs} disabled={Object.values(selectedPcvs).filter(Boolean).length === 0}
              className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50">
              Replenish Selected ({Object.values(selectedPcvs).filter(Boolean).length})
            </button>
          </div>
          <table className="data-table">
            <thead><tr><th style={{width:30}}></th><th>PCV #</th><th>Date</th><th>Payee</th><th>Category</th><th>Description</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
            <tbody>
              {pcvList.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-6">No petty cash vouchers</td></tr>}
              {pcvList.map((v) => (
                <tr key={v.id} className="border-t hover:bg-gray-50">
                  <td>
                    {v.status === 'Unreplenished' && (
                      <input type="checkbox" checked={selectedPcvs[v.id] || false} onChange={() => togglePcv(v.id)} />
                    )}
                  </td>
                  <td className="font-mono text-xs">{v.pcv_number}</td>
                  <td className="text-xs">{formatDate(v.voucher_date)}</td>
                  <td>{v.payee}</td>
                  <td className="text-xs text-gray-500">{v.category || '—'}</td>
                  <td className="text-xs text-gray-500 max-w-[200px] truncate">{v.description || '—'}</td>
                  <td className="text-right font-medium">{formatCurrency(v.amount)}</td>
                  <td><span className={`px-2 py-1 text-xs rounded-full ${v.status === 'Replenished' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{v.status}</span></td>
                  <td>{v.status === 'Unreplenished' && <button onClick={() => openEditPcv(v)} className="p-1 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reconcile Tab */}
      {activeTab === 'reconcile' && (
        reconcileResult ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Reconciliation Result</h2>
            <div className="grid grid-cols-3 gap-4">
              <div><p className="text-xs text-gray-500">Book Balance</p><p className="text-xl font-bold">{formatCurrency(reconcileResult.book_balance)}</p></div>
              <div><p className="text-xs text-gray-500">Statement Balance</p><p className="text-xl font-bold">{formatCurrency(reconcileResult.statement_balance)}</p></div>
              <div><p className="text-xs text-gray-500">Difference</p><p className={`text-xl font-bold ${reconcileResult.is_reconciled ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(reconcileResult.difference)}</p></div>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">Select an account and enter a statement balance, then click "Reconcile" to compare.</p>
        )
      )}

      {/* Account Modal */}
      {showAccountModal && (
        <div className="modal-overlay" onClick={() => setShowAccountModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Add Account</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account Code</label><input type="text" value={accountForm.account_code} onChange={e => setAccountForm({...accountForm, account_code: e.target.value})} placeholder="e.g. CASH-001" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Bank Name *</label><input type="text" value={accountForm.bank_name} onChange={e => setAccountForm({...accountForm, bank_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Name *</label><input type="text" value={accountForm.account_name} onChange={e => setAccountForm({...accountForm, account_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Number *</label><input type="text" value={accountForm.account_number} onChange={e => setAccountForm({...accountForm, account_number: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Type</label>
                  <select value={accountForm.account_type} onChange={e => setAccountForm({...accountForm, account_type: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Savings">Savings</option><option value="Checking">Checking</option><option value="E-Wallet">E-Wallet</option><option value="Cash on Hand">Cash on Hand</option><option value="Clearing">Clearing</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">GL Account Code</label><input type="text" value={accountForm.gl_account_code || ''} onChange={e => setAccountForm({...accountForm, gl_account_code: e.target.value})} placeholder="e.g. 1010" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">POS Payment Method</label>
                  <select value={accountForm.pos_payment_method || ''} onChange={e => {
                    const method = e.target.value || null;
                    const glMap: Record<string, string> = {};
                    setAccountForm({ ...accountForm, pos_payment_method: method, gl_account_code: method && glMap[method] ? glMap[method] : accountForm.gl_account_code });
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">None</option>
                    <option value="Cash">Cash</option>
                    <option value="Check">Check</option>
                  </select></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowAccountModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveAccount} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cash In Modal */}
      {showCashInModal && (
        <div className="modal-overlay" onClick={() => setShowCashInModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Cash In</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={cashInForm.amount} onChange={e => setCashInForm({...cashInForm, amount: parseFloat(e.target.value)||0})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={cashInForm.notes} onChange={e => setCashInForm({...cashInForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCashInModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={postCashIn} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Post</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cash Out Modal */}
      {showCashOutModal && (
        <div className="modal-overlay" onClick={() => setShowCashOutModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Cash Out</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={cashOutForm.amount} onChange={e => setCashOutForm({...cashOutForm, amount: parseFloat(e.target.value)||0})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={cashOutForm.notes} onChange={e => setCashOutForm({...cashOutForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCashOutModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={postCashOut} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Post</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bank Transaction Modal */}
      {showBankTxnModal && (
        <div className="modal-overlay" onClick={() => setShowBankTxnModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Deposit / Withdrawal</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account *</label>
                  <select value={bankTxnForm.bank_account_id} onChange={e => setBankTxnForm({...bankTxnForm, bank_account_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Type *</label>
                  <select value={bankTxnForm.transaction_type} onChange={e => setBankTxnForm({...bankTxnForm, transaction_type: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Deposit">Deposit</option><option value="Withdrawal">Withdrawal</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={bankTxnForm.amount} onChange={e => setBankTxnForm({...bankTxnForm, amount: parseFloat(e.target.value)||0})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={bankTxnForm.notes} onChange={e => setBankTxnForm({...bankTxnForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowBankTxnModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={postBankTxn} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Post</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <div className="modal-overlay" onClick={() => setShowTransferModal(false)}>
          <div className={`modal-content ${transferForm.from_account_id && accounts.find(a => a.id === parseInt(transferForm.from_account_id))?.account_type === 'Checks on Hand' ? 'max-w-3xl' : 'max-w-sm'}`} onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Transfer Funds</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">From Account *</label>
                  <select value={transferForm.from_account_id} onChange={e => {
                    const id = e.target.value;
                    setTransferForm({...transferForm, from_account_id: id, amount: 0, receipt_ids: []});
                    setSelectedChecks({});
                    if (id && accounts.find(a => a.id === parseInt(id))?.account_type === 'Checks on Hand') loadChecks();
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">To Account *</label>
                  <select value={transferForm.to_account_id} onChange={e => setTransferForm({...transferForm, to_account_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={transferForm.amount} onChange={e => setTransferForm({...transferForm, amount: parseFloat(e.target.value)||0})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={transferForm.notes} onChange={e => setTransferForm({...transferForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>

              {transferForm.from_account_id && accounts.find(a => a.id === parseInt(transferForm.from_account_id))?.account_type === 'Checks on Hand' && checksOnHand.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <h3 className="text-sm font-semibold mb-2">Select Checks to Deposit</h3>
                  <table className="data-table w-full text-xs">
                    <thead><tr><th style={{width:30}}></th><th>CR #</th><th>Customer</th><th>Check #</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {checksOnHand.map((ch) => (
                        <tr key={ch.id} className="border-t">
                          <td><input type="checkbox" checked={selectedChecks[ch.id] || false} onChange={() => toggleCheck(ch.id)} /></td>
                          <td className="font-mono">{ch.receipt_number}</td>
                          <td>{ch.customer_name || '—'}</td>
                          <td>{ch.check_number || '—'}</td>
                          <td className="text-right font-bold">{formatCurrency(ch.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-500 mt-2">
                    {Object.values(selectedChecks).filter(Boolean).length} selected &middot;
                    Total: {formatCurrency(checksOnHand.filter(ch => selectedChecks[ch.id]).reduce((s, ch) => s + parseFloat(ch.amount), 0))}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setShowTransferModal(false); setSelectedChecks({}); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={postTransfer} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700">Transfer</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reconcile Modal */}
      {showReconcileModal && (
        <div className="modal-overlay" onClick={() => setShowReconcileModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Reconcile Account</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account *</label>
                  <select value={reconcileForm.bank_account_id} onChange={e => setReconcileForm({...reconcileForm, bank_account_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Statement Balance *</label><input type="number" value={reconcileForm.statement_balance} onChange={e => setReconcileForm({...reconcileForm, statement_balance: parseFloat(e.target.value)||0})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowReconcileModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={doReconcile} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Reconcile</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Edit Account</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account Code</label><input type="text" value={editForm.account_code || ''} onChange={e => setEditForm({...editForm, account_code: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Bank Name *</label><input type="text" value={editForm.bank_name} onChange={e => setEditForm({...editForm, bank_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Name *</label><input type="text" value={editForm.account_name} onChange={e => setEditForm({...editForm, account_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Number</label><input type="text" value={editForm.account_number} onChange={e => setEditForm({...editForm, account_number: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Type</label>
                  <select value={editForm.account_type} onChange={e => setEditForm({...editForm, account_type: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Savings">Savings</option><option value="Checking">Checking</option><option value="E-Wallet">E-Wallet</option><option value="Clearing">Clearing</option><option value="Cash on Hand">Cash on Hand</option><option value="Petty Cash">Petty Cash</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">GL Account Code</label><input type="text" value={editForm.gl_account_code || ''} onChange={e => setEditForm({...editForm, gl_account_code: e.target.value})} placeholder="e.g. 1000" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">POS Payment Method</label>
                  <select value={editForm.pos_payment_method || ''} onChange={e => {
                    const method = e.target.value || null;
                    const glMap: Record<string, string> = {};
                    setEditForm({ ...editForm, pos_payment_method: method, gl_account_code: method && glMap[method] ? glMap[method] : editForm.gl_account_code });
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">None</option>
                    <option value="Cash">Cash</option>
                    <option value="Check">Check</option>
                  </select></div>
                <div className="flex items-center gap-2"><input type="checkbox" checked={editForm.is_active !== false} onChange={e => setEditForm({...editForm, is_active: e.target.checked})} className="w-4 h-4" /><label className="text-sm">Active</label></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowEditModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Account Ledger Modal */}
      {showLedgerModal && ledgerData && (
        <div className="modal-overlay" onClick={() => setShowLedgerModal(false)}>
          <div className="modal-content max-w-4xl" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">{ledgerData.account.bank_name} — {ledgerData.account.account_name}</h2>
                  <p className="text-xs text-gray-500">Balance: {formatCurrency(ledgerData.balance)}</p>
                </div>
                <button onClick={() => setShowLedgerModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead><tr><th>Date</th><th>Type</th><th>Source</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
                  <tbody>
                    {ledgerData.ledger.map((r: any, i: number) => (
                      <tr key={i} className="text-sm">
                        <td className="text-xs">{formatDate(r.date)}</td>
                        <td><span className={`px-1.5 py-0.5 text-xs rounded-full ${['Deposit','Cash In'].includes(r.type) ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.type}</span></td>
                        <td className="text-xs">{r.source_module}</td>
                        <td className="text-right text-green-600">{r.debit > 0 ? formatCurrency(r.debit) : '—'}</td>
                        <td className="text-right text-red-600">{r.credit > 0 ? formatCurrency(r.credit) : '—'}</td>
                        <td className="text-right font-mono text-xs">{formatCurrency(r.running_balance)}</td>
                      </tr>
                    ))}
                    {ledgerData.ledger.length === 0 && <tr><td colSpan={6} className="text-center py-4 text-gray-500">No transactions</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Petty Cash Voucher Modal */}
      {showPcvModal && (
        <div className="modal-overlay" onClick={() => setShowPcvModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">New Petty Cash Voucher</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={pcvForm.voucher_date} onChange={e => setPcvForm({ ...pcvForm, voucher_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Payee *</label><input type="text" value={pcvForm.payee} onChange={e => setPcvForm({ ...pcvForm, payee: e.target.value })} placeholder="e.g. Office Supply Co." className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Category</label>
                  <div className="flex gap-2">
                    <select value={pcvForm.category} onChange={e => setPcvForm({ ...pcvForm, category: e.target.value })} className="flex-1 px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select</option>
                      {expenseCategories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    <button type="button" onClick={() => { setCatForm({ name: '', account_code: '' }); setShowCatModal(true); }} className="px-3 py-2 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">+ Add</button>
                  </div></div>
                <div><label className="block text-sm font-medium mb-1">Description</label><input type="text" value={pcvForm.description} onChange={e => setPcvForm({ ...pcvForm, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" step="0.01" value={pcvForm.amount} onChange={e => setPcvForm({ ...pcvForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowPcvModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={savePcv} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700">Save Voucher</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Petty Cash Voucher Modal */}
      {showEditPcvModal && (
        <div className="modal-overlay" onClick={() => setShowEditPcvModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Edit Petty Cash Voucher</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={editPcvForm.voucher_date?.split('T')[0] || ''} onChange={e => setEditPcvForm({ ...editPcvForm, voucher_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Payee *</label><input type="text" value={editPcvForm.payee} onChange={e => setEditPcvForm({ ...editPcvForm, payee: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Category</label>
                  <div className="flex gap-2">
                    <select value={editPcvForm.category || ''} onChange={e => setEditPcvForm({ ...editPcvForm, category: e.target.value })} className="flex-1 px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select</option>
                      {expenseCategories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    <button type="button" onClick={() => { setCatForm({ name: '', account_code: '' }); setShowCatModal(true); }} className="px-3 py-2 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">+ Add</button>
                  </div></div>
                <div><label className="block text-sm font-medium mb-1">Description</label><input type="text" value={editPcvForm.description || ''} onChange={e => setEditPcvForm({ ...editPcvForm, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" step="0.01" value={editPcvForm.amount} onChange={e => setEditPcvForm({ ...editPcvForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowEditPcvModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveEditPcv} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Update Voucher</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {showCatModal && (
        <div className="modal-overlay" onClick={() => setShowCatModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Add Category</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Category Name *</label><input type="text" value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} placeholder="e.g. Rent" className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Code *</label><input type="text" value={catForm.account_code} onChange={e => setCatForm({ ...catForm, account_code: e.target.value })} placeholder="e.g. 6050" className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCatModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveCategory} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
