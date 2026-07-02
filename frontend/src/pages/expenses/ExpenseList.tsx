import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, formatDate, formatDateTime, parseNumericField } from '../../lib/utils';
import NumericInput from '../../components/NumericInput';
import { Plus, Trash2, Edit2, Receipt, Banknote } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
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
  const { hasPerm } = useAuth();
  const canCreate = hasPerm('finance.expenses.create');
  const canEdit = hasPerm('finance.expenses.edit');
  const readOnly = !canCreate && !canEdit;
  const [expenses, setExpenses] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [form, setForm] = useState({
    category_id: '', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0],
    payment_method: 'Cash', reference_number: '', notes: '', pay_now: false, bank_account_id: '',
  });
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showPayModal, setShowPayModal] = useState(false);
  const [payForm, setPayForm] = useState<any>(null);
  const [paying, setPaying] = useState(false);
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
  useEffect(() => {
    api.get('/expenses/categories').then((res) => setCategories(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    api.get('/bank-cash/accounts').then((res) => setBankAccounts(res.data || [])).catch(() => {});
  }, []);

  const handleDelete = async (id: string) => {
    if (!canEdit) { toast.error('You do not have permission to cancel expenses'); return; }
    if (!confirm('Cancel this expense?')) return;
    try { await api.delete(`/expenses/${id}`); toast.success('Expense cancelled'); loadExpenses(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!canCreate) { toast.error('You do not have permission to create expenses'); return; }
    if (!form.category_id) { toast.error('Please select a category'); return; }
    if (!form.amount || parseNumericField(form.amount) <= 0) { toast.error('Amount must be greater than 0'); return; }
    const isBank = form.payment_method === 'Check' || form.payment_method === 'Bank Transfer';
    if (form.pay_now && isBank && !form.bank_account_id) { toast.error('Select a bank account'); return; }
    try {
      await api.post('/expenses', {
        ...form,
        amount: parseNumericField(form.amount),
        bank_account_id: form.pay_now && isBank ? form.bank_account_id : undefined,
      });
      toast.success(form.pay_now ? 'Expense recorded and paid' : 'Expense saved — use Pay when ready');
      setShowModal(false);
      setForm({
        category_id: '', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0],
        payment_method: 'Cash', reference_number: '', notes: '', pay_now: false, bank_account_id: '',
      });
      loadExpenses();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openPay = (e: any) => {
    if (!canEdit) { toast.error('You do not have permission to pay expenses'); return; }
    setPayForm({
      id: e.id,
      expense_number: e.expense_number,
      amount: e.amount,
      payment_method: 'Cash',
      reference_number: '',
      payment_date: new Date().toISOString().split('T')[0],
      bank_account_id: '',
      notes: '',
    });
    setShowPayModal(true);
  };

  const submitPay = async () => {
    if (!payForm) return;
    const isBank = payForm.payment_method === 'Check' || payForm.payment_method === 'Bank Transfer';
    if (isBank && !payForm.bank_account_id) { toast.error('Select a bank account'); return; }
    setPaying(true);
    try {
      await api.post(`/expenses/${payForm.id}/pay`, {
        payment_method: payForm.payment_method,
        reference_number: payForm.reference_number,
        payment_date: payForm.payment_date,
        bank_account_id: isBank ? payForm.bank_account_id : undefined,
        notes: payForm.notes || undefined,
      });
      toast.success('Payment recorded');
      setShowPayModal(false);
      setPayForm(null);
      loadExpenses();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Payment failed'); }
    setPaying(false);
  };

  const openEdit = (e: any) => {
    if (!canEdit) { toast.error('You do not have permission to edit expenses'); return; }
    if (e.status === 'Cancelled') return;
    setEditForm({ ...e });
    setShowEditModal(true);
  };
  const saveEdit = async () => {
    if (!canEdit) { toast.error('You do not have permission to edit expenses'); return; }
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
    if (!canEdit) { toast.error('You do not have permission to manage expense categories'); return; }
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
  const unpaidCount = expenses.filter((e) => e.status === 'Draft').length;

  return (
    <FinancePageShell>
      <FinanceModuleHeader
        icon={Receipt}
        title="Expenses"
        badges={<FinanceHeaderBadge>{total} records</FinanceHeaderBadge>}
        actions={canCreate ? <FinancePrimaryButton onClick={() => setShowModal(true)}><Plus size={14} /> Add expense</FinancePrimaryButton> : undefined}
      />

      {readOnly && (
        <div className="mx-4 mt-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
          Read-only — you can view expenses but cannot add, edit, or pay. Contact an administrator for edit access.
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FinanceKpiCard label="Total records" value={total} hint="All expense entries" />
            <FinanceKpiCard label="Posted (page)" value={postedCount} tone="green" />
            <FinanceKpiCard label="Unpaid (page)" value={unpaidCount} tone="amber" />
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
                    <td className="px-4 py-2.5 text-xs text-slate-600">{e.payment_method || (e.status === 'Draft' ? 'Unpaid' : '—')}</td>
                    <td className="px-4 py-2.5 text-center"><FinanceStatusBadge status={e.status === 'Draft' ? 'Draft' : e.status} /></td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {canEdit && e.status === 'Draft' && (
                        <button
                          onClick={() => openPay(e)}
                          className="inline-flex items-center gap-1 px-2 py-1 mr-1 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                          title="Record payment"
                        >
                          <Banknote size={12} /> Pay
                        </button>
                      )}
                      {canEdit && (
                        <>
                          <button onClick={() => openEdit(e)} disabled={e.status === 'Cancelled'} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 disabled:opacity-40" title="Edit"><Edit2 size={14} /></button>
                          <button onClick={() => handleDelete(e.id)} disabled={e.status === 'Cancelled'} className="p-1.5 hover:bg-red-50 rounded-lg text-red-600 disabled:opacity-40" title="Cancel"><Trash2 size={14} /></button>
                        </>
                      )}
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
          <p className="text-[11px] text-slate-500 leading-relaxed">Save as unpaid (Draft) and use Pay later, or check Pay immediately on create. Draft expenses accrue to Accounts Payable until paid.</p>
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
                    <button type="button" onClick={() => setShowCatModal(true)} disabled={!canEdit} className="px-3 py-2 border rounded-lg text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed">+ Add</button>
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
                <div className="col-span-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={form.pay_now} onChange={(e) => setForm({ ...form, pay_now: e.target.checked })}
                      className="rounded border-gray-300" />
                    Pay immediately (cash/bank out today)
                  </label>
                  <p className="text-xs text-slate-500 mt-1">Leave unchecked to save as <strong>Unpaid (Draft)</strong> — then use the green <strong>Pay</strong> button in the list.</p>
                </div>
                {form.pay_now && (
                  <>
                <div><label className="block text-sm font-medium mb-1">Payment Method</label>
                  <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Cash">Cash</option>
                    <option value="Check">Check</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select></div>
                {(form.payment_method === 'Check' || form.payment_method === 'Bank Transfer') && (
                  <div><label className="block text-sm font-medium mb-1">Bank Account</label>
                    <select value={form.bank_account_id} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                      <option value="">Select account</option>
                      {bankAccounts.map((b: any) => (
                        <option key={b.id} value={b.id}>{b.bank_name} — {b.account_name}</option>
                      ))}
                    </select></div>
                )}
                <div className={form.payment_method === 'Cash' ? 'col-span-2' : ''}><label className="block text-sm font-medium mb-1">Reference Number</label>
                  <input type="text" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                    placeholder="OR #, check #, transaction ref..."
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  </>
                )}
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

      {/* Pay Expense Modal */}
      {showPayModal && payForm && (
        <ModalOverlay onClose={() => { setShowPayModal(false); setPayForm(null); }}>
          <div className="modal-content max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-1">Pay Expense</h2>
              <p className="text-sm text-slate-500 mb-4">{payForm.expense_number} — {formatCurrency(payForm.amount)}</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1">Payment Date</label>
                  <input type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Payment Method</label>
                  <select value={payForm.payment_method} onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="Cash">Cash</option>
                    <option value="Check">Check</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select></div>
                {(payForm.payment_method === 'Check' || payForm.payment_method === 'Bank Transfer') && (
                  <div className="col-span-2"><label className="block text-sm font-medium mb-1">Bank Account</label>
                    <select value={payForm.bank_account_id} onChange={(e) => setPayForm({ ...payForm, bank_account_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select account</option>
                      {bankAccounts.map((b: any) => (
                        <option key={b.id} value={b.id}>{b.bank_name} — {b.account_name}</option>
                      ))}
                    </select></div>
                )}
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Reference Number</label>
                  <input type="text" value={payForm.reference_number} onChange={(e) => setPayForm({ ...payForm, reference_number: e.target.value })}
                    placeholder="OR #, check #, transaction ref..."
                    className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Notes</label>
                  <input type="text" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setShowPayModal(false); setPayForm(null); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={submitPay} disabled={paying} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 disabled:opacity-50">
                  {paying ? 'Processing…' : 'Record payment'}
                </button>
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
                    <button type="button" onClick={() => setShowCatModal(true)} disabled={!canEdit} className="px-3 py-2 border rounded-lg text-sm text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed">+ Add</button>
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
                {editForm.status === 'Posted' && (
                  <>
                <div><label className="block text-sm font-medium mb-1">Payment Method</label>
                  <select value={editForm.payment_method || 'Cash'} onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Cash">Cash</option><option value="Check">Check</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Reference Number</label>
                  <input type="text" value={editForm.reference_number || ''} onChange={(e) => setEditForm({ ...editForm, reference_number: e.target.value })}
                    placeholder="OR #, check #, transaction ref..."
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                  </>
                )}
                {editForm.status === 'Draft' && (
                  <div className="col-span-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">Unpaid — use the Pay button after saving edits.</div>
                )}
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
