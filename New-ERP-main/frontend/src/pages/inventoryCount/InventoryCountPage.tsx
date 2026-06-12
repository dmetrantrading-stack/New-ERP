import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Plus, Send, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function InventoryCountPage() {
  const [counts, setCounts] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ location_id: 1, notes: '', count_date: '', items: [] });

  useEffect(() => {
    api.get('/inventory-count').then((res) => setCounts(res.data.data)).catch(() => toast.error('Failed to load counts'));
    api.get('/products?limit=500').then((res) => setProducts(res.data.data)).catch(() => toast.error('Failed to load products'));
    api.get('/inventory/locations').then((res) => setLocations(res.data)).catch(() => toast.error('Failed to load locations'));
  }, []);

  const resetForm = () => {
    setForm({ location_id: 1, notes: '', count_date: '', items: [] });
    setEditingId(null);
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { product_id: '', actual_qty: 0 }] });

  const updateItem = (i: number, field: string, value: any) => {
    const items = [...form.items]; items[i][field] = value; setForm({ ...form, items });
  };

  const removeItem = (i: number) => setForm({ ...form, items: form.items.filter((_: any, idx: number) => idx !== i) });

  const createCount = async () => {
    try {
      await api.post('/inventory-count', form);
      toast.success('Count created');
      setShowCreate(false);
      resetForm();
      const res = await api.get('/inventory-count'); setCounts(res.data.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const editCount = async (id: string) => {
    try {
      const res = await api.get(`/inventory-count/${id}`);
      const d = res.data;
      setForm({
        location_id: d.location_id,
        notes: d.notes || '',
        count_date: d.count_date ? d.count_date.substring(0, 10) : '',
        items: d.items.map((i: any) => ({ product_id: i.product_id, actual_qty: i.actual_qty })),
      });
      setEditingId(id);
      setShowEdit(true);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const updateCount = async () => {
    try {
      await api.patch(`/inventory-count/${editingId}`, form);
      toast.success('Count updated');
      setShowEdit(false);
      resetForm();
      const res = await api.get('/inventory-count'); setCounts(res.data.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const postCount = async (id: string) => {
    try { await api.post(`/inventory-count/${id}/post`); toast.success('Count posted'); const res = await api.get('/inventory-count'); setCounts(res.data.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const deleteCount = async (id: string) => {
    try { await api.delete(`/inventory-count/${id}`); toast.success('Count deleted'); const res = await api.get('/inventory-count'); setCounts(res.data.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const renderModal = (isEdit: boolean) => {
    const visible = isEdit ? showEdit : showCreate;
    const close = () => { if (isEdit) setShowEdit(false); else setShowCreate(false); resetForm(); };
    const submit = isEdit ? updateCount : createCount;

    return visible ? (
      <div className="modal-overlay" onClick={close}>
        <div className="modal-content max-w-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">{isEdit ? 'Edit Count' : 'New Inventory Count'}</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium mb-1">Location</label>
                <select value={form.location_id} onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                  {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Count Date</label>
                <input type="date" value={form.count_date} onChange={(e) => setForm({ ...form, count_date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            </div>
            <h3 className="font-medium text-sm mb-2">Items</h3>
            {form.items.map((item: any, i: number) => (
              <div key={i} className="flex gap-2 mb-2 items-end">
                <div className="flex-1">
                  <select value={item.product_id} onChange={(e) => updateItem(i, 'product_id', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Product</option>
                    {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                  </select>
                </div>
                <div className="w-24">
                  <input type="number" value={item.actual_qty} onChange={(e) => updateItem(i, 'actual_qty', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border rounded-lg text-sm text-center focus:ring-2 focus:ring-blue-500 outline-none" step="0.01" />
                </div>
                <button onClick={() => removeItem(i)} className="p-2 text-red-500 hover:bg-red-50 rounded">×</button>
              </div>
            ))}
            <button onClick={addItem} className="text-sm text-blue-600 hover:text-blue-800">+ Add Item</button>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={close} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={submit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                {isEdit ? 'Update Count' : 'Create Count'}
              </button>
            </div>
          </div>
        </div>
      </div>
    ) : null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Inventory Counts</h1>
        <button onClick={() => { resetForm(); setShowCreate(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Plus size={16} /> New Count
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Count #</th>
              <th>Date</th>
              <th>Location</th>
              <th>Items</th>
              <th>Status</th>
              <th>Created By</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.count_number}</td>
                <td className="text-xs">{new Date(c.count_date).toLocaleDateString()}</td>
                <td>{c.location_name}</td>
                <td>{c.items_count}</td>
                <td>
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    c.status === 'Posted' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'
                  }`}>{c.status}</span>
                </td>
                <td>{c.created_by_name}</td>
                <td>
                  <div className="flex gap-1">
                    {c.status === 'Draft' && (
                      <>
                        <button onClick={() => postCount(c.id)} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Post">
                          <Send size={15} />
                        </button>
                        <button onClick={() => editCount(c.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="Edit">
                          <Edit2 size={15} />
                        </button>
                        <button onClick={() => deleteCount(c.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600" title="Delete">
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {counts.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-gray-500">No inventory counts found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {renderModal(false)}
      {renderModal(true)}
    </div>
  );
}
