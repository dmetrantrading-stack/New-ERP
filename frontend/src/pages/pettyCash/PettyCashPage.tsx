import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PettyCashPage() {
  const [pcvList, setPcvList] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedPcvs, setSelectedPcvs] = useState<Record<string, boolean>>({});

  // Create state
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<any>({ payee: '', amount: 0, category: '', description: '', voucher_date: new Date().toISOString().split('T')[0] });

  // Edit state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<any>({ payee: '', amount: 0, category: '', description: '', voucher_date: '' });

  // Add Category state
  const [showCatModal, setShowCatModal] = useState(false);
  const [catForm, setCatForm] = useState({ name: '', account_code: '' });

  useEffect(() => {
    api.get('/petty-cash').then(r => setPcvList(r.data || [])).catch(() => {});
    api.get('/expenses/categories').then(r => setCategories(r.data || [])).catch(() => {});
  }, []);

  const refresh = () => {
    api.get('/petty-cash').then(r => setPcvList(r.data || [])).catch(() => {});
  };

  // Create PCV
  const savePcv = async () => {
    if (!form.payee || !form.amount) { toast.error('Payee and amount required'); return; }
    try {
      await api.post('/petty-cash', form);
      toast.success('PCV created');
      setShowModal(false);
      setForm({ payee: '', amount: 0, category: '', description: '', voucher_date: new Date().toISOString().split('T')[0] });
      refresh();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  // Edit PCV
  const openEdit = (v: any) => { setEditForm({ ...v }); setShowEditModal(true); };
  const saveEdit = async () => {
    if (!editForm.payee || !editForm.amount) { toast.error('Payee and amount required'); return; }
    try {
      await api.put(`/petty-cash/${editForm.id}`, editForm);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Petty Cash</h1>
          <p className="text-sm text-gray-500">Petty Cash Vouchers &amp; Fund Replenishment</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700"><Plus size={16} /> New Voucher</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h2 className="font-semibold text-sm">Vouchers</h2>
          <button onClick={replenish} disabled={Object.values(selectedPcvs).filter(Boolean).length === 0}
            className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50">
            Replenish ({Object.values(selectedPcvs).filter(Boolean).length})
          </button>
        </div>
        <table className="data-table">
          <thead><tr><th style={{width:30}}></th><th>PCV #</th><th>Date</th><th>Payee</th><th>Category</th><th>Description</th><th className="text-right">Amount</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {pcvList.length === 0 && <tr><td colSpan={9} className="text-center text-gray-500 py-6">No vouchers</td></tr>}
            {pcvList.map((v) => (
              <tr key={v.id} className="border-t hover:bg-gray-50">
                <td>{v.status === 'Unreplenished' && <input type="checkbox" checked={selectedPcvs[v.id] || false} onChange={() => togglePcv(v.id)} />}</td>
                <td className="font-mono text-xs">{v.pcv_number}</td>
                <td className="text-xs">{formatDate(v.voucher_date)}</td>
                <td>{v.payee}</td>
                <td className="text-xs text-gray-500">{v.category || '—'}</td>
                <td className="text-xs text-gray-500 max-w-[200px] truncate">{v.description || '—'}</td>
                <td className="text-right font-medium">{formatCurrency(v.amount)}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${v.status === 'Replenished' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{v.status}</span></td>
                <td>{v.status === 'Unreplenished' && <button onClick={() => openEdit(v)} className="p-1 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create PCV Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
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
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={savePcv} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit PCV Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content max-w-sm" onClick={e => e.stopPropagation()}>
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
                <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" step="0.01" value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
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
                <div><label className="block text-sm font-medium mb-1">Name *</label><input type="text" value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Code *</label><input type="text" value={catForm.account_code} onChange={e => setCatForm({ ...catForm, account_code: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
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
