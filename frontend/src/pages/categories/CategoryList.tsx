import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CategoryList() {
  const [categories, setCategories] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  useEffect(() => { api.get('/categories/all').then((res) => setCategories(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')); }, []);

  const openCreate = () => { setEditItem(null); setForm({ name: '', description: '' }); setShowModal(true); };
  const openEdit = (c: any) => { setEditItem(c); setForm({ name: c.name, description: c.description || '' }); setShowModal(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try { await api.delete(`/categories/${id}`); toast.success('Deleted'); const res = await api.get('/categories/all'); setCategories(res.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    try {
      if (editItem) { await api.put(`/categories/${editItem.id}`, form); toast.success('Updated'); }
      else { await api.post('/categories', form); toast.success('Created'); }
      setShowModal(false);
      const res = await api.get('/categories/all'); setCategories(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Category</button>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Description</th><th>Products</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="text-gray-500">{c.description || '-'}</td>
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
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
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
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={3} />
                </div>
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
