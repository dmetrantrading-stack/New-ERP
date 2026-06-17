import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

export default function ExpenseList() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [form, setForm] = useState({ category_id: '', description: '', amount: 0, expense_date: new Date().toISOString().split('T')[0], payment_method: 'Cash', reference_number: '', notes: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCatModal, setShowCatModal] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', account_code: '' });
  const limit = 20;

  const loadExpenses = () => {
    api.get(`/expenses?page=${page}&limit=${limit}`).then((res) => { setExpenses(res.data.data); setTotal(res.data.total); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  };

  useEffect(() => { loadExpenses(); }, [page]);
  useEffect(() => { api.get('/expenses/categories').then((res) => setCategories(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')); }, []);

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

  const openEdit = (e: any) => { setEditForm({ ...e }); setShowEditModal(true); };
  const saveEdit = async () => {
    if (!editForm?.amount || parseFloat(String(editForm.amount)) <= 0) { toast.error('Amount must be greater than 0'); return; }
    try {
      await api.put(`/expenses/${editForm.id}`, editForm);
      toast.success('Expense updated');
      setShowEditModal(false);
      setEditForm(null);
      loadExpenses();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const saveCategory = async () => {
    if (!catForm.name || !catForm.account_code) { toast.error('Name and account code required'); return; }
    try {
      await api.post('/expenses/categories', catForm);
      toast.success('Category added');
      setShowCatModal(false);
      setCatForm({ name: '', account_code: '' });
      api.get('/expenses/categories').then(r => setCategories(r.data || [])).catch(() => {});
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
                    <button onClick={() => openEdit(e)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
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
                  <div className="flex gap-2">
                    <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">Select</option>
                      {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setShowCatModal(true)} className="px-3 py-2 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">+ Add</button>
                  </div></div>
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
                    <option value="Cash">Cash</option><option value="Check">Check</option>
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

      {/* Edit Expense Modal */}
      {showEditModal && editForm && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Edit Expense</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Category</label>
                  <div className="flex gap-2">
                    <select value={editForm.category_id || ''} onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">Select</option>
                      {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setShowCatModal(true)} className="px-3 py-2 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">+ Add</button>
                  </div></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Description</label>
                  <input type="text" value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Amount</label>
                  <input type="number" step="0.01" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Date</label>
                  <input type="date" value={editForm.expense_date?.split('T')[0] || ''} onChange={(e) => setEditForm({ ...editForm, expense_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Payment Method</label>
                  <select value={editForm.payment_method} onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Cash">Cash</option><option value="Check">Check</option>
                  </select></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Reference Number</label>
                  <input type="text" value={editForm.reference_number || ''} onChange={(e) => setEditForm({ ...editForm, reference_number: e.target.value })}
                    placeholder="OR #, check #, transaction ref..."
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Notes</label>
                  <input type="text" value={editForm.notes || ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowEditModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Update</button>
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
