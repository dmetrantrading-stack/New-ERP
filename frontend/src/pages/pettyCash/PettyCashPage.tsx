import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, formatDate, formatDateTime, parseNumericField } from '../../lib/utils';
import NumericInput from '../../components/NumericInput';
import { Plus, Edit2, Wallet, Printer, Eye, X } from 'lucide-react';
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
import { printDocument } from '../../lib/printDocument';
import { useAuth } from '../../store/auth';

export default function PettyCashPage() {
  const { hasPerm } = useAuth();
  const [pcvList, setPcvList] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedPcvs, setSelectedPcvs] = useState<Record<string, boolean>>({});

  // Create state
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<any>({ payee: '', amount: '', category: '', description: '', voucher_date: new Date().toISOString().split('T')[0] });

  // Edit state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<any>({ payee: '', amount: 0, category: '', description: '', voucher_date: '' });

  // Add Category state
  const [showCatModal, setShowCatModal] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', account_code: '' });
  const [search, setSearch] = useState('');
  const [fundBalance, setFundBalance] = useState<number | null>(null);
  const [fundAccountName, setFundAccountName] = useState('Office Petty Cash');
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewPcv, setViewPcv] = useState<any>(null);
  const [viewLoading, setViewLoading] = useState(false);

  const loadSummary = () => {
    api.get('/petty-cash/summary')
      .then(r => {
        setFundBalance(Number(r.data.fund_balance ?? 0));
        setFundAccountName(r.data.fund_account_name || 'Office Petty Cash');
      })
      .catch(() => {});
  };

  useEffect(() => {
    api.get('/petty-cash').then(r => setPcvList(r.data || [])).catch(() => {});
    api.get('/expenses/categories').then(r => setCategories(r.data || [])).catch(() => {});
    loadSummary();
  }, []);

  const refresh = () => {
    api.get('/petty-cash').then(r => setPcvList(r.data || [])).catch(() => {});
    loadSummary();
  };

  // Create PCV
  const savePcv = async () => {
    if (!form.payee || parseNumericField(form.amount) <= 0) { toast.error('Payee and amount required'); return; }
    try {
      await api.post('/petty-cash', { ...form, amount: parseNumericField(form.amount) });
      toast.success('PCV created');
      setShowModal(false);
      setForm({ payee: '', amount: '', category: '', description: '', voucher_date: new Date().toISOString().split('T')[0] });
      refresh();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  // Edit PCV
  const openEdit = (v: any) => { setEditForm({ ...v }); setShowEditModal(true); };
  const saveEdit = async () => {
    if (!editForm.payee || parseNumericField(editForm.amount) <= 0) { toast.error('Payee and amount required'); return; }
    try {
      await api.put(`/petty-cash/${editForm.id}`, { ...editForm, amount: parseNumericField(editForm.amount) });
      toast.success('PCV updated');
      setShowEditModal(false);
      refresh();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  // Toggle + Replenish
  const togglePcv = (id: string) => setSelectedPcvs(prev => ({ ...prev, [id]: !prev[id] }));
  const replenish = async () => {
    const ids = Object.entries(selectedPcvs).filter(([_, v]) => v).map(([k]) => k);
    if (ids.length === 0) { toast.error('Select at least one voucher'); return; }
    try {
      await api.post('/petty-cash/replenish', { voucher_ids: ids });
      toast.success(`${ids.length} vouchers replenished`);
      setSelectedPcvs({});
      refresh();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  // Add Category
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

  const filtered = pcvList.filter((v) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return v.pcv_number?.toLowerCase().includes(q) || v.payee?.toLowerCase().includes(q) || v.category?.toLowerCase().includes(q);
  });
  const unreplenished = pcvList.filter((v) => v.status === 'Unreplenished');
  const selectableFiltered = filtered.filter((v) => v.status === 'Unreplenished');
  const unreplenishedTotal = unreplenished.reduce((s, v) => s + parseFloat(v.amount || 0), 0);
  const selectedCount = Object.values(selectedPcvs).filter(Boolean).length;
  const allSelectableSelected = selectableFiltered.length > 0 && selectableFiltered.every((v) => selectedPcvs[v.id]);

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedPcvs({});
      return;
    }
    const next: Record<string, boolean> = {};
    selectableFiltered.forEach((v) => { next[v.id] = true; });
    setSelectedPcvs(next);
  };

  const printPcv = (id: string) => {
    printDocument(`/api/petty-cash/${id}/print`);
  };

  const openView = async (id: string) => {
    setViewLoading(true);
    setShowViewModal(true);
    try {
      const r = await api.get(`/petty-cash/${id}`);
      setViewPcv(r.data);
    } catch {
      toast.error('Failed to load voucher');
      setShowViewModal(false);
      setViewPcv(null);
    } finally {
      setViewLoading(false);
    }
  };

  const closeView = () => {
    setShowViewModal(false);
    setViewPcv(null);
  };

  return (
    <FinancePageShell>
      <FinanceModuleHeader
        icon={Wallet}
        title="Petty Cash"
        badges={
          <>
            {fundBalance != null && <FinanceHeaderBadge>Fund: {formatCurrency(fundBalance)}</FinanceHeaderBadge>}
            <FinanceHeaderBadge>{pcvList.length} vouchers</FinanceHeaderBadge>
          </>
        }
        actions={
          <>
            {hasPerm('finance.petty-cash.replenish') && (
              <button onClick={replenish} disabled={selectedCount === 0}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                Replenish ({selectedCount})
              </button>
            )}
            {hasPerm('finance.petty-cash.create') && (
              <FinancePrimaryButton onClick={() => setShowModal(true)}>
                <Plus size={14} /> New Voucher
              </FinancePrimaryButton>
            )}
          </>
        }
      />

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FinanceKpiCard label="Fund balance" value={fundBalance != null ? formatCurrency(fundBalance) : '—'} tone="blue" hint={fundAccountName} />
            <FinanceKpiCard label="Unreplenished" value={formatCurrency(unreplenishedTotal)} tone="amber" hint={`${unreplenished.length} voucher(s)`} />
            <FinanceKpiCard label="Total vouchers" value={pcvList.length} />
            <FinanceKpiCard label="Selected" value={selectedCount} tone={selectedCount > 0 ? 'green' : 'default'} hint="For replenish batch" />
          </div>

          <FinanceSearchToolbar search={search} onSearchChange={setSearch} placeholder="PCV #, payee, category…" />

          <FinanceDataCard
            title="Petty cash vouchers"
            subtitle="Imprest fund disbursements and replenishment"
            actions={
              hasPerm('finance.petty-cash.replenish') && selectableFiltered.length > 0 ? (
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                >
                  {allSelectableSelected ? 'Clear all' : `Select all (${selectableFiltered.length})`}
                </button>
              ) : undefined
            }
          >
            <FinanceTableWrap>
              <table className="w-full text-sm">
                <thead>
                  <tr className={financeTableHeadClass}>
                    <th className="py-2.5 px-4 w-8">
                      {hasPerm('finance.petty-cash.replenish') && selectableFiltered.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allSelectableSelected}
                          onChange={toggleSelectAll}
                          title={allSelectableSelected ? 'Clear all' : 'Select all unreplenished'}
                          className="rounded border-slate-300"
                        />
                      )}
                    </th>
                    <th className="py-2.5 px-4 text-left">PCV #</th>
                    <th className="py-2.5 px-4 text-left">Voucher Date</th>
                    <th className="py-2.5 px-4 text-left">Recorded</th>
                    <th className="py-2.5 px-4 text-left">Payee</th>
                    <th className="py-2.5 px-4 text-left">Category</th>
                    <th className="py-2.5 px-4 text-left">Description</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 px-4 text-center">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-400 italic">No vouchers found</td></tr>
                  )}
                  {filtered.map((v) => (
                    <tr key={v.id} className="hover:bg-blue-50/40 transition-colors">
                      <td className="px-4 py-2.5">{v.status === 'Unreplenished' && <input type="checkbox" checked={selectedPcvs[v.id] || false} onChange={() => togglePcv(v.id)} />}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-blue-700">{v.pcv_number}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{formatDate(v.voucher_date)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500 tabular-nums whitespace-nowrap">{v.created_at ? formatDateTime(v.created_at) : '—'}</td>
                      <td className="px-4 py-2.5 text-slate-800">{v.payee}</td>
                      <td className="px-4 py-2.5 text-slate-500">{v.category || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500 max-w-[160px] truncate">{v.description || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-red-700">{formatCurrency(v.amount)}</td>
                      <td className="px-4 py-2.5 text-center"><FinanceStatusBadge status={v.status} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openView(v.id)} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="View"><Eye size={14} /></button>
                          {hasPerm('finance.petty-cash.print') && (
                            <button onClick={() => printPcv(v.id)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600" title="Print"><Printer size={14} /></button>
                          )}
                          {v.status === 'Unreplenished' && hasPerm('finance.petty-cash.edit') && (
                            <button onClick={() => openEdit(v)} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="Edit"><Edit2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </FinanceTableWrap>
          </FinanceDataCard>
        </div>

        <FinanceSidebar>
          <FinanceSidebarStat label="Petty cash fund" value={fundBalance != null ? formatCurrency(fundBalance) : '—'} hint={`${fundAccountName} · GL 1016`} />
          <FinanceSidebarStat label="Unreplenished" value={formatCurrency(unreplenishedTotal)} hint={`${unreplenished.length} voucher(s) pending replenish`} />
          <FinanceQuickLinks links={[
            { to: '/bank-cash', label: 'Bank & Cash →' },
            { to: '/expenses', label: 'Expenses →' },
            { to: '/accounting', label: 'Accounting →' },
          ]} />
          <p className="text-[11px] text-slate-500 leading-relaxed">Select unreplenished vouchers, then click Replenish to post the fund top-up journal entry from Cash on Hand.</p>
        </FinanceSidebar>
      </div>

      {/* View PCV Modal */}
      {showViewModal && (
        <ModalOverlay onClose={closeView}>
          <div className="modal-content max-w-lg">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">Petty Cash Voucher</h2>
                  {viewPcv && (
                    <p className="text-sm font-mono text-blue-700 mt-0.5">{viewPcv.pcv_number}</p>
                  )}
                </div>
                <button onClick={closeView} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>

              {viewLoading && (
                <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
              )}

              {!viewLoading && viewPcv && (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${viewPcv.status === 'Replenished' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {viewPcv.status}
                    </span>
                    <span className="text-lg font-bold text-blue-900">{formatCurrency(viewPcv.amount)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-4">
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">Voucher Date</span>
                      {formatDate(viewPcv.voucher_date)}
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">Payee</span>
                      {viewPcv.payee}
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">Category</span>
                      {viewPcv.category || '—'}
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">Expense Account</span>
                      {viewPcv.expense_account_code || '6080'}
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">Created By</span>
                      {viewPcv.created_by_name || '—'}
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-gray-400 uppercase block">Created At</span>
                      {viewPcv.created_at ? formatDateTime(viewPcv.created_at) : '—'}
                    </div>
                    {viewPcv.replenished_at && (
                      <>
                        <div>
                          <span className="text-[10px] font-semibold text-gray-400 uppercase block">Replenished</span>
                          {formatDateTime(viewPcv.replenished_at)}
                        </div>
                        <div>
                          <span className="text-[10px] font-semibold text-gray-400 uppercase block">Replenished By</span>
                          {viewPcv.replenished_by_name || '—'}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="mb-4">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase block mb-1">Description</span>
                    <p className="text-sm text-gray-700 bg-gray-50 border border-gray-100 rounded-lg p-3 min-h-[48px]">
                      {viewPcv.description || '—'}
                    </p>
                  </div>

                  <div className="flex justify-end gap-2">
                    {viewPcv.status === 'Unreplenished' && hasPerm('finance.petty-cash.edit') && (
                      <button
                        onClick={() => { closeView(); openEdit(viewPcv); }}
                        className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
                      >
                        Edit
                      </button>
                    )}
                    {hasPerm('finance.petty-cash.print') && (
                      <button
                        onClick={() => printPcv(viewPcv.id)}
                        className="flex items-center gap-1 px-4 py-2 bg-gray-100 text-gray-800 rounded-lg text-sm hover:bg-gray-200"
                      >
                        <Printer size={14} /> Print
                      </button>
                    )}
                    <button onClick={closeView} className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm hover:bg-blue-800">Close</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Create PCV Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">New Voucher</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={form.voucher_date} onChange={e => setForm({ ...form, voucher_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Payee *</label><input type="text" value={form.payee} onChange={e => setForm({ ...form, payee: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Category</label>
                  <div className="flex gap-2">
                    <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="flex-1 px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select</option>
                      {categories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    <button type="button" onClick={() => { setCatForm({ name: '', account_code: '' }); setShowCatModal(true); }} className="px-3 py-2 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">+ Add</button>
                  </div></div>
                <div><label className="block text-sm font-medium mb-1">Description</label><input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><NumericInput step="0.01" value={form.amount} onValueChange={(amount) => setForm({ ...form, amount })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={savePcv} className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm hover:bg-blue-800">Save</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Edit PCV Modal */}
      {showEditModal && (
        <ModalOverlay onClose={() => setShowEditModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Edit Voucher</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={editForm.voucher_date?.split('T')[0] || ''} onChange={e => setEditForm({ ...editForm, voucher_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Payee *</label><input type="text" value={editForm.payee} onChange={e => setEditForm({ ...editForm, payee: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Category</label>
                  <div className="flex gap-2">
                    <select value={editForm.category || ''} onChange={e => setEditForm({ ...editForm, category: e.target.value })} className="flex-1 px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select</option>
                      {categories.map((c: any) => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>
                    <button type="button" onClick={() => { setCatForm({ name: '', account_code: '' }); setShowCatModal(true); }} className="px-3 py-2 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">+ Add</button>
                  </div></div>
                <div><label className="block text-sm font-medium mb-1">Description</label><input type="text" value={editForm.description || ''} onChange={e => setEditForm({ ...editForm, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><NumericInput step="0.01" value={editForm.amount} onValueChange={(amount) => setEditForm({ ...editForm, amount })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
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
                <div><label className="block text-sm font-medium mb-1">Name *</label><input type="text" value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Code *</label><input type="text" value={catForm.account_code} onChange={e => setCatForm({ ...catForm, account_code: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
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
