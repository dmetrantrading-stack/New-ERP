import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Plus, Edit2, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';

export default function ProductionBOM({ embedded = false }: { embedded?: boolean }) {
  const { hasPerm } = useAuth();
  const [boms, setBoms] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', output_product_id: '', output_qty: 1, notes: '',
    inputs: [] as any[], outputs: [] as any[],
  });

  const load = () => {
    setLoading(true);
    api.get('/production/boms?include_inactive=true')
      .then((r) => setBoms(r.data || []))
      .catch(() => toast.error('Failed to load BOMs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get('/products?limit=500').then((r) => setProducts(r.data.data || [])).catch(() => {});
  }, []);

  const resetForm = () => {
    setForm({ name: '', output_product_id: '', output_qty: 1, notes: '', inputs: [], outputs: [] });
    setEditing(false);
    setEditId(null);
  };

  const openCreate = () => {
    resetForm();
    setForm((f) => ({ ...f, inputs: [{ product_id: '', quantity: 1, uom: 'pcs' }], outputs: [{ product_id: '', quantity: 1, uom: 'pcs' }] }));
    setEditing(true);
  };

  const openEdit = async (id: string) => {
    try {
      const r = await api.get(`/production/boms/${id}`);
      const d = r.data;
      setForm({
        name: d.name,
        output_product_id: d.output_product_id || '',
        output_qty: parseFloat(d.output_qty) || 1,
        notes: d.notes || '',
        inputs: (d.lines || []).filter((l: any) => l.line_type === 'Input').map((l: any) => ({ product_id: l.product_id, quantity: l.quantity, uom: l.uom || 'pcs' })),
        outputs: (d.lines || []).filter((l: any) => l.line_type === 'Output').map((l: any) => ({ product_id: l.product_id, quantity: l.quantity, uom: l.uom || 'pcs' })),
      });
      setEditId(id);
      setEditing(true);
    } catch {
      toast.error('Failed to load BOM');
    }
  };

  const save = async () => {
    if (!form.name) { toast.error('BOM name required'); return; }
    if (!form.inputs.length) { toast.error('Add input materials'); return; }
    try {
      if (editId) {
        await api.put(`/production/boms/${editId}`, form);
        toast.success('BOM updated');
      } else {
        await api.post('/production/boms', form);
        toast.success('BOM created');
      }
      resetForm();
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  if (editing) {
    return (
      <div className={embedded ? 'p-4' : 'p-6 max-w-4xl mx-auto'}>
        <h2 className="text-lg font-semibold mb-4">{editId ? 'Edit BOM' : 'New BOM / Recipe'}</h2>
        <div className="bg-white rounded-lg border p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-600">Recipe Name</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">Primary Output Qty</label>
              <input type="number" className="w-full border rounded px-3 py-2 text-sm" value={form.output_qty} onChange={(e) => setForm({ ...form, output_qty: parseFloat(e.target.value) || 1 })} />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600">Primary Output Product</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.output_product_id} onChange={(e) => setForm({ ...form, output_product_id: e.target.value })}>
              <option value="">Select product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-medium">Input Materials</h3>
              <button type="button" onClick={() => setForm({ ...form, inputs: [...form.inputs, { product_id: '', quantity: 1, uom: 'pcs' }] })} className="text-xs text-blue-600">+ Add input</button>
            </div>
            {form.inputs.map((inp, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select className="flex-1 border rounded px-2 py-1 text-sm" value={inp.product_id} onChange={(e) => { const inputs = [...form.inputs]; inputs[i] = { ...inputs[i], product_id: e.target.value }; setForm({ ...form, inputs }); }}>
                  <option value="">Select product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select>
                <input type="number" className="w-24 border rounded px-2 py-1 text-sm" value={inp.quantity} onChange={(e) => { const inputs = [...form.inputs]; inputs[i] = { ...inputs[i], quantity: parseFloat(e.target.value) || 0 }; setForm({ ...form, inputs }); }} />
                <button type="button" onClick={() => setForm({ ...form, inputs: form.inputs.filter((_, idx) => idx !== i) })} className="text-red-500 text-xs">Remove</button>
              </div>
            ))}
          </div>
          <div>
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-medium">Outputs</h3>
              <button type="button" onClick={() => setForm({ ...form, outputs: [...form.outputs, { product_id: '', quantity: 1, uom: 'pcs' }] })} className="text-xs text-blue-600">+ Add output</button>
            </div>
            {form.outputs.map((out, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select className="flex-1 border rounded px-2 py-1 text-sm" value={out.product_id} onChange={(e) => { const outputs = [...form.outputs]; outputs[i] = { ...outputs[i], product_id: e.target.value }; setForm({ ...form, outputs }); }}>
                  <option value="">Select product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                </select>
                <input type="number" className="w-24 border rounded px-2 py-1 text-sm" value={out.quantity} onChange={(e) => { const outputs = [...form.outputs]; outputs[i] = { ...outputs[i], quantity: parseFloat(e.target.value) || 0 }; setForm({ ...form, outputs }); }} />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            {hasPerm('inventory.production.create') && <button onClick={save} className="px-4 py-2 text-sm text-white bg-blue-700 rounded">Save BOM</button>}
            <button onClick={resetForm} className="px-4 py-2 text-sm border rounded">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? 'p-4' : 'p-6'}>
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-blue-700" />
          <h2 className="text-lg font-semibold">Production BOM / Recipes</h2>
        </div>
        {hasPerm('inventory.production.create') && (
          <button onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-700 text-white rounded"><Plus size={14} /> New BOM</button>
        )}
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-2">Code</th>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Output</th>
              <th className="text-left px-4 py-2">Inputs</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
            ) : boms.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No BOMs defined</td></tr>
            ) : boms.map((b) => (
              <tr key={b.id} className="border-b hover:bg-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{b.bom_code}</td>
                <td className="px-4 py-2">{b.name}</td>
                <td className="px-4 py-2">{b.output_product_name || '—'} × {b.output_qty}</td>
                <td className="px-4 py-2">{b.input_count || 0}</td>
                <td className="px-4 py-2">{b.is_active ? 'Active' : 'Inactive'}</td>
                <td className="px-4 py-2 text-right">
                  {hasPerm('inventory.production.create') && (
                    <button onClick={() => openEdit(b.id)} className="p-1 text-gray-500 hover:text-blue-600"><Edit2 size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
