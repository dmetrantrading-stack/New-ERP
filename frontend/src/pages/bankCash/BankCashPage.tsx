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
  const [showReconcileModal, setShowReconcileModal] = useState(false);

  // Forms
  const [accountForm, setAccountForm] = useState<any>({ account_code: '', bank_name: '', account_name: '', account_number: '', account_type: 'Savings', gl_account_code: '', pos_payment_method: '' });
  const [editForm, setEditForm] = useState<any>({});
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [cashInForm, setCashInForm] = useState<any>({ amount: 0, notes: '' });
  const [cashOutForm, setCashOutForm] = useState<any>({ amount: 0, notes: '' });
  const [bankTxnForm, setBankTxnForm] = useState<any>({ bank_account_id: '', transaction_type: 'Deposit', amount: 0, notes: '' });
  const [transferForm, setTransferForm] = useState<any>({ from_account_id: '', to_account_id: '', amount: 0, notes: '' });
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

  const postTransfer = async () => {
    try { await api.post('/bank-cash/transfers', transferForm); toast.success('Transfer complete'); setShowTransferModal(false); }
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
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200'}`}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
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

      {/* Reconcile Tab */}
      {activeTab === 'reconcile' && reconcileResult && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Reconciliation Result</h2>
          <div className="grid grid-cols-3 gap-4">
            <div><p className="text-xs text-gray-500">Book Balance</p><p className="text-xl font-bold">{formatCurrency(reconcileResult.book_balance)}</p></div>
            <div><p className="text-xs text-gray-500">Statement Balance</p><p className="text-xl font-bold">{formatCurrency(reconcileResult.statement_balance)}</p></div>
            <div><p className="text-xs text-gray-500">Difference</p><p className={`text-xl font-bold ${reconcileResult.is_reconciled ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(reconcileResult.difference)}</p></div>
          </div>
        </div>
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
                    const glMap: Record<string, string> = { GCash: '1011', Maya: '1012', 'Credit Card': '1013', 'Bank Transfer': '1014' };
                    setAccountForm({ ...accountForm, pos_payment_method: method, gl_account_code: method && glMap[method] ? glMap[method] : accountForm.gl_account_code });
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">None</option>
                    <option value="Cash">Cash</option>
                    <option value="GCash">GCash</option>
                    <option value="Maya">Maya</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
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
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Transfer Funds</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">From Account *</label>
                  <select value={transferForm.from_account_id} onChange={e => setTransferForm({...transferForm, from_account_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">To Account *</label>
                  <select value={transferForm.to_account_id} onChange={e => setTransferForm({...transferForm, to_account_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={transferForm.amount} onChange={e => setTransferForm({...transferForm, amount: parseFloat(e.target.value)||0})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowTransferModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
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
                    const glMap: Record<string, string> = { GCash: '1011', Maya: '1012', 'Credit Card': '1013', 'Bank Transfer': '1014' };
                    setEditForm({ ...editForm, pos_payment_method: method, gl_account_code: method && glMap[method] ? glMap[method] : editForm.gl_account_code });
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">None</option>
                    <option value="Cash">Cash</option>
                    <option value="GCash">GCash</option>
                    <option value="Maya">Maya</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Bank Transfer">Bank Transfer</option>
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
    </div>
  );
}
