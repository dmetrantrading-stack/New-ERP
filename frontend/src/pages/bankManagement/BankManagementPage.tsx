import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Plus, Building2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BankManagementPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showTxnModal, setShowTxnModal] = useState(false);
  const [accountForm, setAccountForm] = useState({ bank_name: '', account_name: '', account_number: '', account_type: 'Savings' });
  const [txnForm, setTxnForm] = useState({ bank_account_id: '', transaction_type: 'Deposit', amount: 0, notes: '' });
  const [selectedAccount, setSelectedAccount] = useState<string>('');

  useEffect(() => {
    api.get('/bank-management/accounts').then((res) => setAccounts(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  }, []);

  useEffect(() => {
    if (selectedAccount) api.get(`/bank-management/transactions?account_id=${selectedAccount}`).then((res) => setTransactions(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  }, [selectedAccount]);

  const createAccount = async () => {
    try { await api.post('/bank-management/accounts', accountForm); toast.success('Account created'); setShowAccountModal(false); setAccountForm({ bank_name: '', account_name: '', account_number: '', account_type: 'Savings' }); const res = await api.get('/bank-management/accounts'); setAccounts(res.data); } catch (err: any) { toast.error('Error'); }
  };

  const deleteAccount = async (id: string) => {
    if (!confirm('Are you sure you want to delete this account? All associated transactions will be lost.')) return;
    try { await api.delete(`/bank-management/accounts/${id}`); toast.success('Deleted'); if (selectedAccount === id) { setSelectedAccount(''); setTransactions([]); } const res = await api.get('/bank-management/accounts'); setAccounts(res.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const deleteTransaction = async (id: string) => {
    if (!confirm('Are you sure you want to delete this transaction?')) return;
    try { await api.delete(`/bank-management/transactions/${id}`); toast.success('Deleted'); const res = await api.get(`/bank-management/transactions?account_id=${selectedAccount}`); setTransactions(res.data); const accRes = await api.get('/bank-management/accounts'); setAccounts(accRes.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const createTransaction = async () => {
    try { await api.post('/bank-management/transactions', { ...txnForm, amount: parseFloat(txnForm.amount as any) || 0 }); toast.success('Transaction recorded'); setShowTxnModal(false); setTxnForm({ bank_account_id: '', transaction_type: 'Deposit', amount: 0, notes: '' }); const res = await api.get(`/bank-management/transactions?account_id=${selectedAccount}`); setTransactions(res.data); const accRes = await api.get('/bank-management/accounts'); setAccounts(accRes.data); } catch (err: any) { toast.error('Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Bank Management</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowTxnModal(true)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">New Transaction</button>
          <button onClick={() => setShowAccountModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Account</button>
        </div>
      </div>

      {/* Bank Accounts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts.map((acc) => (
          <div key={acc.id} onClick={() => setSelectedAccount(acc.id)}
            className={`bg-white rounded-lg border p-4 cursor-pointer hover:shadow-md transition-shadow ${selectedAccount === acc.id ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-5 h-5 text-blue-600" />
              <div><p className="font-medium text-sm">{acc.bank_name}</p><p className="text-xs text-gray-500">{acc.account_name}</p></div>
            </div>
            <p className="text-xs text-gray-400">{acc.account_number}</p>
            <p className="text-lg font-bold mt-2">{formatCurrency(acc.balance)}</p>
            <div className="mt-3 flex justify-end">
              <button onClick={(e) => { e.stopPropagation(); deleteAccount(acc.id); }} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>

      {/* Transactions */}
      {selectedAccount && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Notes</th><th>Actions</th></tr></thead>
            <tbody>
              {transactions.map((t: any) => (
                <tr key={t.id}>
                  <td className="text-xs">{new Date(t.transaction_date).toLocaleDateString()}</td>
                  <td><span className={`px-2 py-1 text-xs rounded-full ${t.transaction_type === 'Deposit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{t.transaction_type}</span></td>
                  <td className="font-medium">{formatCurrency(t.amount)}</td>
                  <td className="text-sm text-gray-500">{t.notes || '-'}</td>
                  <td><button onClick={() => deleteTransaction(t.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Account Modal */}
      {showAccountModal && (
        <div className="modal-overlay" onClick={() => setShowAccountModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Add Bank Account</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Bank Name</label><input type="text" value={accountForm.bank_name} onChange={(e) => setAccountForm({ ...accountForm, bank_name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Name</label><input type="text" value={accountForm.account_name} onChange={(e) => setAccountForm({ ...accountForm, account_name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Number</label><input type="text" value={accountForm.account_number} onChange={(e) => setAccountForm({ ...accountForm, account_number: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Type</label>
                  <select value={accountForm.account_type} onChange={(e) => setAccountForm({ ...accountForm, account_type: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Savings">Savings</option><option value="Checking">Checking</option><option value="Time Deposit">Time Deposit</option>
                  </select></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowAccountModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={createAccount} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Create</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Modal */}
      {showTxnModal && (
        <div className="modal-overlay" onClick={() => setShowTxnModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Bank Transaction</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account</label>
                  <select value={txnForm.bank_account_id} onChange={(e) => setTxnForm({ ...txnForm, bank_account_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Account</option>
                    {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Type</label>
                  <select value={txnForm.transaction_type} onChange={(e) => setTxnForm({ ...txnForm, transaction_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Deposit">Deposit</option><option value="Withdrawal">Withdrawal</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount</label><input type="number" step="0.01" value={txnForm.amount} onChange={(e) => setTxnForm({ ...txnForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowTxnModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={createTransaction} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Record</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
