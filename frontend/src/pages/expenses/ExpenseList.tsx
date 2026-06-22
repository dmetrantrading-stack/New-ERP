import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, formatDate, formatDateTime, parseNumericField } from '../../lib/utils';
import NumericInput from '../../components/NumericInput';
import { Plus, Trash2, Edit2, Receipt } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import {
  FinancePageShell,
  FinanceModuleHeader,
  FinanceHeaderBadge,
  FinanceKpiCard,
  FinanceSearchToolbar,
  FinanceDataCard,
  FinanceTableWrap,
  financeTableHeadClass,
  FinanceStatusBadge,
  FinanceSidebar,
  FinanceSidebarStat,
  FinanceQuickLinks,
  FinancePrimaryButton,
} from '../../components/finance/FinanceModuleLayout';

export default function ExpenseList() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [form, setForm] = useState({ category_id: '', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], payment_method: 'Cash', reference_number: '', notes: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCatModal, setShowCatModal] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', account_code: '' });
  const [search, setSearch] = useState('');
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
    if (!form.amount || parseNumericField(form.amount) <= 0) { toast.error('Amount must be greater than 0'); return; }
    try {
      await api.post('/expenses', { ...form, amount: parseNumericField(form.amount) });
      toast.success('Expense recorded');
      setShowModal(false);
      setForm({ category_id: '', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], payment_method: 'Cash', reference_number: '', notes: '' });
      loadExpenses();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openEdit = (e: any) => { setEditForm({ ...e }); setShowEditModal(true); };
  const saveEdit = async () => {
    if (!editForm?.amount || parseNumericField(editForm.amount) <= 0) { toast.error('Amount must be greater than 0'); return; }
    try {
      await api.put(`/expenses/${editForm.id}`, { ...editForm, amount: parseNumericField(editForm.amount) });
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

  const filtered = expenses.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return e.expense_number?.toLowerCase().includes(q) || e.category_name?.toLowerCase().includes(q) || e.description?.toLowerCase().includes(q);
  });
  const pageTotal = filtered.reduce((s, e) => s + parseFloat(e.amount || 0), 0);
  const postedCount = expenses.filter((e) => e.status === 'Posted').length;

  return (
    <FinancePageShell>
      <FinanceModuleHeader
        icon={Receipt}
        title="Expenses"
        badges={<FinanceHeaderBadge>{total} records</FinanceHeaderBadge>}
        actions={<FinancePrimaryButton onClick={() => setShowModal(true)}><Plus size={14} /> Add expense</FinancePrimaryButton>}
      />

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FinanceKpiCard label="Total records" value={total} hint="All expense entries" />
            <FinanceKpiCard label="Posted (page)" value={postedCount} tone="green" />
            <FinanceKpiCard label="Page total" value={formatCurrency(pageTotal)} tone="red" hint="Current page only" />
            <FinanceKpiCard label="Categories" value={categories.length} tone="blue" />
          </div>

          <FinanceSearchToolbar search={search} onSearchChange={setSearch} placeholder="Ref #, category, description…" />

          <FinanceDataCard title="Expense register" subtitle="Operating expenses with automatic journal posting">
            <FinanceTableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className={financeTableHeadClass}>
                  <th className="py-2.5 px-4 text-left">Ref #</th>
                  <th className="py-2.5 px-4 text-left">Category</th>
                  <th className="py-2.5 px-4 text-left">Description</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                  <th className="py-2.5 px-4 text-left">Expense Date</th>
                  <th className="py-2.5 px-4 text-left">Recorded</th>
                  <th className="py-2.5 px-4 text-left">Payment</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400 italic">No expenses match your search</td></tr>
                )}
                {filtered.map((e: any) => (
                  <tr key={e.id} className="hover:bg-blue-50/40 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-blue-700">{e.expense_number}</td>
                    <td className="px-4 py-2.5"><span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-700 ring-1 ring-slate-200">{e.category_name}</span></td>
                    <td className="px-4 py-2.5 text-slate-700">{e.description || '—'}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-red-700">{formatCurrency(e.amount)}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{formatDate(e.expense_date)}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500 tabular-nums whitespace-nowrap">{e.created_at ? formatDateTime(e.created_at) : '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{e.payment_method}</td>
                    <td className="px-4 py-2.5 text-center"><FinanceStatusBadge status={e.status} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => openEdit(e)} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="Edit"><Edit2 size={14} /></button>
                      <button onClick={() => handleDelete(e.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-600" title="Cancel"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </FinanceTableWrap>
            <div className="px-4 py-3 border-t border-slate-100">
              <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
            </div>
          </FinanceDataCard>
        </div>

        <FinanceSidebar>
          <FinanceSidebarStat label="Page total" value={formatCurrency(pageTotal)} hint={`${postedCount} posted on this page`} />
          <FinanceQuickLinks links={[
            { to: '/accounting', label: 'Accounting →' },
            { to: '/petty-cash', label: 'Petty Cash →' },
            { to: '/bank-cash', label: 'Bank & Cash →' },
          ]} />
          <p className="text-[11px] text-slate-500 leading-relaxed">Expenses post journal entries automatically when saved. Cancelled expenses reverse the entry.</p>
        </FinanceSidebar>
      </div>

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="modal-content max-w-md">
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
                  <NumericInput step="0.01" value={form.amount} onValueChange={(amount) => setForm({ ...form, amount })}
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
        </ModalOverlay>
      )}

      {/* Edit Expense Modal */}
      {showEditModal && editForm && (
        <ModalOverlay onClose={() => setShowEditModal(false)}>
          <div className="modal-content max-w-md">
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
                  <NumericInput step="0.01" value={editForm.amount} onValueChange={(amount) => setEditForm({ ...editForm, amount })}
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
        </ModalOverlay>
      )}

      {/* Add Category Modal */}
      {showCatModal && (
        <ModalOverlay onClose={() => setShowCatModal(false)}>
          <div className="modal-content max-w-sm">
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
        </ModalOverlay>
      )}
    </FinancePageShell>
  );
}
