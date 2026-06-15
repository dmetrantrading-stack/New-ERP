import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Plus, Trash2 } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

export default function ExpenseList() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ category_id: '', description: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], payment_method: 'Cash', reference_number: '', notes: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const loadExpenses = () => {
    api.get(`/expenses?page=${page}&limit=${limit}`).then((res) => { setExpenses(res.data.data); setTotal(res.data.total); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  };

  useEffect(() => {
    loadExpenses();
    api.get('/expenses/categories').then((res) => setCategories(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  }, [page]);

  const handleDelete = async (id: string) => {
    if (!confirm('Cancel this expense?')) return;
    try { await api.delete(`/expenses/${id}`); toast.success('Expense cancelled'); loadExpenses(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!form.category_id) { toast.error('Please select a category'); return; }
    if (!form.amount || parseFloat(String(form.amount)) <= 0) { toast.error('Amount must be greater than 0'); return; }
    try {
      await api.post('/expenses', form);
      toast.success('Expense recorded');
      setShowModal(false);
      setForm({ category_id: '', description: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], payment_method: 'Cash', reference_number: '', notes: '' });
      loadExpenses();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Expense</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Ref #</th><th>Category</th><th>Description</th><th>Amount</th><th>Date</th><th>Payment</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {expenses.map((e: any) => (
              <tr key={e.id}>
                <td className="font-mono text-xs">{e.expense_number}</td>
                <td><span className="px-2 py-0.5 text-xs rounded bg-gray-100">{e.category_name}</span></td>
                <td>{e.description}</td>
                <td className="font-medium text-red-600">{formatCurrency(e.amount)}</td>
                <td className="text-xs">{new Date(e.expense_date).toLocaleDateString()}</td>
                <td>{e.payment_method}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${e.status === 'Posted' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{e.status}</span></td>
                <td>
                  <button onClick={() => handleDelete(e.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600"><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Add Expense</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Category</label>
                  <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Description</label>
                  <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Amount</label>
                  <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Date</label>
                  <input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Payment Method</label>
                  <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Cash">Cash</option><option value="GCash">GCash</option><option value="Maya">Maya</option>
                    <option value="Bank Transfer">Bank Transfer</option><option value="Check">Check</option>
                  </select></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Reference Number</label>
                  <input type="text" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                    placeholder="OR #, check #, transaction ref..."
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Notes</label>
                  <input type="text" value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
