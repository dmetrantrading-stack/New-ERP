import React, { useState, useEffect, useMemo } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { Plus, Edit2, Trash2, Search } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BrandList({ embedded = false, onChanged }: { embedded?: boolean; onChanged?: () => void }) {
  const [brands, setBrands] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [search, setSearch] = useState('');

  const filteredBrands = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return brands;
    return brands.filter((b) =>
      b.name?.toLowerCase().includes(q) ||
      b.description?.toLowerCase().includes(q),
    );
  }, [brands, search]);

  const loadBrands = () => {
    api.get('/brands/all').then((res) => { setBrands(res.data); onChanged?.(); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  };
  useEffect(() => { loadBrands(); }, []);

  const openCreate = () => { setEditItem(null); setForm({ name: '', description: '' }); setShowModal(true); };
  const openEdit = (b: any) => { setEditItem(b); setForm({ name: b.name, description: b.description || '' }); setShowModal(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try { await api.delete(`/brands/${id}`); toast.success('Deleted'); loadBrands(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!form.name) { toast.error('Name is required'); return; }
    try {
      if (editItem) { await api.put(`/brands/${editItem.id}`, form); toast.success('Updated'); }
      else { await api.post('/brands', form); toast.success('Created'); }
      setShowModal(false);
      loadBrands();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className={`flex flex-col min-h-0 ${embedded ? 'h-full gap-0' : 'space-y-4'}`}>
      {!embedded && <h1 className="text-2xl font-bold text-gray-900">Brands</h1>}

      <div className="flex-shrink-0 flex items-center justify-between gap-3 pb-3">
        <p className="text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{filteredBrands.length}</span> brand{filteredBrands.length !== 1 ? 's' : ''}
        </p>
        <button onClick={openCreate} className="flex items-center gap-2 px-3 py-1.5 bg-blue-700 text-white rounded-lg text-xs font-semibold hover:bg-blue-800"><Plus size={14} /> Create</button>
      </div>

      <div className="flex-shrink-0 flex flex-wrap gap-3 items-center bg-white border border-gray-200 rounded-t-lg px-4 py-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search name or description…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
        </div>
      </div>

      <div className={`bg-white border border-t-0 border-gray-200 overflow-hidden flex flex-col min-h-0 ${embedded ? 'flex-1 rounded-b-lg' : 'rounded-b-lg'}`}>
        <div className="flex-1 overflow-auto min-h-0">
          <table className="data-table">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr><th>Name</th><th>Description</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filteredBrands.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-8 text-gray-400">{search ? 'No matching brands' : 'No brands yet'}</td></tr>
              ) : filteredBrands.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium">{b.name}</td>
                  <td className="text-gray-500">{b.description || '-'}</td>
                  <td><span className={`px-2 py-1 text-xs rounded-full ${b.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{b.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(b)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                      <button onClick={() => handleDelete(b.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="modal-content max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editItem ? 'Edit Brand' : 'Add Brand'}</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Name *</label>
                  <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={3} /></div>
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
