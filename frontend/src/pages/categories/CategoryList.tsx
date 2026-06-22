import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

type GlAccount = { account_code: string; account_name: string };

const defaultForm = {
  name: '',
  description: '',
  revenue_account_code: '4000',
  cogs_account_code: '5000',
};

export default function CategoryList({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void }) {
  const [categories, setCategories] = useState<any[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<GlAccount[]>([]);
  const [cogsAccounts, setCogsAccounts] = useState<GlAccount[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState(defaultForm);

  const loadCategories = () => {
    api.get('/categories/all').then((res) => { setCategories(res.data); onChanged?.(); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  };

  const loadGlAccountOptions = () => {
    api.get('/categories/gl-account-options')
      .then((res) => {
        const revenue = res.data?.revenue || [];
        const cogs = res.data?.cogs || [];
        setRevenueAccounts(revenue);
        setCogsAccounts(cogs);
        if (!revenue.length || !cogs.length) {
          toast.error('GL account list is empty. Run database migration or add accounts in Accounting.');
        }
      })
      .catch((err) => {
        toast.error(err.response?.data?.error || 'Failed to load GL account options');
      });
  };

  useEffect(() => {
    loadCategories();
    loadGlAccountOptions();
  }, []);

  const accountLabel = (code: string | null | undefined, name: string | null | undefined) => {
    if (!code) return '—';
    return name ? `${code} — ${name}` : code;
  };

  const openCreate = () => {
    setEditItem(null);
    setForm(defaultForm);
    setShowModal(true);
  };

  const openEdit = (c: any) => {
    setEditItem(c);
    setForm({
      name: c.name,
      description: c.description || '',
      revenue_account_code: c.revenue_account_code || '4000',
      cogs_account_code: c.cogs_account_code || '5000',
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try { await api.delete(`/categories/${id}`); toast.success('Deleted'); loadCategories(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    try {
      if (editItem) { await api.put(`/categories/${editItem.id}`, form); toast.success('Updated'); }
      else { await api.post('/categories', form); toast.success('Created'); }
      setShowModal(false);
      loadCategories();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="space-y-4">
      <div className={`flex items-center ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
            <p className="text-sm text-gray-500 mt-1">Map each category to Sales and Cost of Sales GL accounts for automatic posting. Accounts are managed under <strong>Accounting → Chart of Accounts</strong>.</p>
          </div>
        )}
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Category</button>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Sales Account</th>
              <th>Cost Account</th>
              <th>Products</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="text-gray-500">{c.description || '-'}</td>
                <td className="text-xs text-gray-600">{accountLabel(c.revenue_account_code, c.revenue_account_name)}</td>
                <td className="text-xs text-gray-600">{accountLabel(c.cogs_account_code, c.cogs_account_name)}</td>
                <td>{c.product_count || 0}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                    <button onClick={() => handleDelete(c.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="modal-content max-w-lg">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editItem ? 'Edit Category' : 'Add Category'}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Sales Account (Revenue)</label>
                  <select
                    value={form.revenue_account_code}
                    onChange={(e) => setForm({ ...form, revenue_account_code: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {revenueAccounts.map((a) => (
                      <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cost Account (COGS)</label>
                  <select
                    value={form.cogs_account_code}
                    onChange={(e) => setForm({ ...form, cogs_account_code: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {cogsAccounts.map((a) => (
                      <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
