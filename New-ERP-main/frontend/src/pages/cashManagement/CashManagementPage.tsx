import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDateTime } from '../../lib/utils';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CashManagementPage() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('transactions');
  const [xReading, setXReading] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ type: 'Cash In', amount: 0, notes: '' });

  const loadData = () => {
    api.get('/cash-management').then((res) => setTransactions(res.data.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    api.get('/cash-management/x-reading').then((res) => setXReading(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  };

  useEffect(() => { loadData(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to void this transaction?')) return;
    try { await api.delete(`/cash-management/${id}`); toast.success('Transaction voided'); loadData(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot void'); }
  };

  const handleSubmit = async () => {
    try {
      const endpoint = form.type === 'Cash In' ? '/cash-management/cash-in' : form.type === 'Cash Out' ? '/cash-management/cash-out' : '/cash-management/petty-cash';
      await api.post(endpoint, { amount: parseFloat(form.amount as any) || 0, notes: form.notes });
      toast.success(`${form.type} recorded`);
      setShowModal(false);
      setForm({ type: 'Cash In', amount: 0, notes: '' });
      const res = await api.get('/cash-management'); setTransactions(res.data.data);
      const xRes = await api.get('/cash-management/x-reading'); setXReading(xRes.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Cash Management</h1>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">New Transaction</button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('transactions')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'transactions' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200'}`}>Transactions</button>
        <button onClick={() => setActiveTab('x-reading')} className={`px-4 py-2 rounded-lg text-sm font-medium ${activeTab === 'x-reading' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200'}`}>X-Reading</button>
      </div>

      {activeTab === 'transactions' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Ref #</th><th>Type</th><th>Amount</th><th>Notes</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
              {transactions.map((t: any) => (
                <tr key={t.id}>
                  <td className="font-mono text-xs">{t.transaction_number}</td>
                  <td><span className={`px-2 py-1 text-xs rounded-full ${t.transaction_type === 'Cash In' || t.transaction_type === 'Collection' ? 'bg-green-100 text-green-700' : t.transaction_type === 'Cash Out' || t.transaction_type === 'Disbursement' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{t.transaction_type}</span></td>
                  <td className="font-medium">{formatCurrency(t.amount)}</td>
                  <td className="text-sm text-gray-500">{t.notes || '-'}</td>
                  <td className="text-xs">{formatDateTime(t.created_at)}</td>
                  <td>
                    <button onClick={() => handleDelete(t.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'x-reading' && xReading && (
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="font-semibold text-lg mb-4">X-Reading</h3>
            <div className="space-y-3">
              <div className="flex justify-between"><span className="text-gray-500">Opening Cash</span><span className="font-medium">{formatCurrency(xReading.opening_cash)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Cash Sales</span><span className="font-medium">{formatCurrency(xReading.cash_sales)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">GCash Sales</span><span className="font-medium">{formatCurrency(xReading.gcash_sales)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Maya Sales</span><span className="font-medium">{formatCurrency(xReading.maya_sales)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Card Sales</span><span className="font-medium">{formatCurrency(xReading.card_sales)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Charge Sales</span><span className="font-medium">{formatCurrency(xReading.charge_sales)}</span></div>
              <div className="border-t pt-3 flex justify-between font-bold text-lg"><span>Total Sales</span><span>{formatCurrency(xReading.total_sales)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Discounts</span><span className="text-red-600">-{formatCurrency(xReading.discounts)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Returns</span><span className="text-red-600">-{formatCurrency(xReading.returns)}</span></div>
              <div className="border-t pt-3 flex justify-between font-bold text-xl"><span>Expected Cash</span><span className="text-green-600">{formatCurrency(xReading.expected_cash)}</span></div>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">New Cash Transaction</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Type</label>
                  <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Cash In">Cash In</option><option value="Cash Out">Cash Out</option><option value="Petty Cash">Petty Cash</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount</label>
                  <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label>
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={3} /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Record</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
