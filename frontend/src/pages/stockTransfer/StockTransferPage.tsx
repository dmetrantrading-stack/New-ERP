import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { Plus, Send, Download } from 'lucide-react';
import toast from 'react-hot-toast';

export default function StockTransferPage({ embedded = false }: { embedded?: boolean }) {
  const [transfers, setTransfers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<any>({ source_location_id: 1, destination_location_id: 2, notes: '', items: [] });

  useEffect(() => {
    api.get('/stock-transfers').then((res) => setTransfers(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    api.get('/products?limit=500').then((res) => setProducts(res.data.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  }, []);

  const addItem = () => setForm({ ...form, items: [...form.items, { product_id: '', quantity: 1 }] });

  const updateItem = (i: number, field: string, value: any) => {
    const items = [...form.items]; items[i][field] = value; setForm({ ...form, items });
  };

  const removeItem = (i: number) => setForm({ ...form, items: form.items.filter((_: any, idx: number) => idx !== i) });

  const createTransfer = async () => {
    try {
      await api.post('/stock-transfers', form);
      toast.success('Transfer created');
      setShowCreate(false);
      setForm({ source_location_id: 1, destination_location_id: 2, notes: '', items: [] });
      const res = await api.get('/stock-transfers'); setTransfers(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const sendTransfer = async (id: string) => {
    try { await api.patch(`/stock-transfers/${id}/send`); toast.success('Sent'); const res = await api.get('/stock-transfers'); setTransfers(res.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const receiveTransfer = async (id: string) => {
    try { await api.patch(`/stock-transfers/${id}/receive`); toast.success('Received'); const res = await api.get('/stock-transfers'); setTransfers(res.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const cancelTransfer = async (id: string) => {
    try { await api.patch(`/stock-transfers/${id}/cancel`); toast.success('Cancelled'); const res = await api.get('/stock-transfers'); setTransfers(res.data); }
    catch (err: any) { toast.error('Error'); }
  };

  return (
    <div className="space-y-4">
      <div className={`flex items-center ${embedded ? 'justify-end' : 'justify-between'}`}>
        {!embedded && <h1 className="text-2xl font-bold text-gray-900">Stock Transfers</h1>}
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> New Transfer</button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Ref #</th><th>From</th><th>To</th><th>Status</th><th>Created By</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <td className="font-mono text-xs">{t.transfer_number}</td>
                <td>{t.source_location}</td>
                <td>{t.destination_location}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${t.status === 'Received' ? 'bg-green-100 text-green-700' : t.status === 'Sent' ? 'bg-blue-100 text-blue-700' : t.status === 'Draft' ? 'bg-gray-100 text-gray-700' : 'bg-red-100 text-red-700'}`}>{t.status}</span></td>
                <td>{t.created_by_name}</td>
                <td className="text-xs">{new Date(t.created_at).toLocaleDateString()}</td>
                <td>
                  <div className="flex gap-1">
                    {t.status === 'Draft' && <button onClick={() => sendTransfer(t.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Send size={15} /></button>}
                    {t.status === 'Sent' && <button onClick={() => receiveTransfer(t.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Receive</button>}
                    {t.status === 'Draft' && <button onClick={() => cancelTransfer(t.id)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Cancel</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <ModalOverlay onClose={() => setShowCreate(false)}>
          <div className="modal-content max-w-2xl">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">New Stock Transfer</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div><label className="block text-sm font-medium mb-1">Source Location</label>
                  <select value={form.source_location_id} onChange={(e) => setForm({ ...form, source_location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value={1}>Main Store</option><option value={2}>Main Warehouse</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Destination Location</label>
                  <select value={form.destination_location_id} onChange={(e) => setForm({ ...form, destination_location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value={2}>Main Warehouse</option><option value={1}>Main Store</option>
                  </select></div>
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
                  <div className="w-20">
                    <input type="number" value={item.quantity} onChange={(e) => updateItem(i, 'quantity', e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm text-center focus:ring-2 focus:ring-blue-500 outline-none" min="1" />
                  </div>
                  <button onClick={() => removeItem(i)} className="p-2 text-red-500 hover:bg-red-50 rounded">×</button>
                </div>
              ))}
              <button onClick={addItem} className="text-sm text-blue-600 hover:text-blue-800">+ Add Item</button>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={createTransfer} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Create Transfer</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
