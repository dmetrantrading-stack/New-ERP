import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';

const LOCATIONS = [{ id: 1, name: 'Store' }, { id: 2, name: 'Warehouse' }];

export default function ProductionOrders() {
  const [orders, setOrders] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [form, setForm] = useState({
    po_date: new Date().toISOString().split('T')[0],
    source_location_id: 1,
    destination_location_id: 1,
    notes: '',
    inputs: [] as any[],
    outputs: [] as any[],
  });

  useEffect(() => {
    loadOrders();
    api.get('/products?limit=500').then(r => setProducts(r.data.data || [])).catch(() => {});
  }, []);

  const loadOrders = () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page)); params.set('limit', '20');
    if (statusFilter) params.set('status', statusFilter);
    api.get('/production?' + params).then(r => {
      setOrders(r.data.data || r.data || []);
      setTotal(r.data.total || 0);
      setTotalPages(Math.ceil((r.data.total || 0) / 20));
    }).catch(() => toast.error('Failed'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadOrders(); }, [page, statusFilter]);

  const resetForm = () => {
    setForm({ po_date: new Date().toISOString().split('T')[0], source_location_id: 1, destination_location_id: 1, notes: '', inputs: [], outputs: [] });
    setCreating(false); setEditingId(null);
  };

  const addInput = () => setForm(f => ({ ...f, inputs: [...f.inputs, { product_id: '', uom: 'pcs', quantity: 1, unit_cost: 0, batch_number: '', expiry_date: '' }] }));
  const addOutput = () => setForm(f => ({ ...f, outputs: [...f.outputs, { product_id: '', uom: 'pcs', quantity: 1, unit_cost: 0, batch_number: '', expiry_date: '' }] }));
  const removeInput = (i: number) => setForm(f => ({ ...f, inputs: f.inputs.filter((_, idx) => idx !== i) }));
  const removeOutput = (i: number) => setForm(f => ({ ...f, outputs: f.outputs.filter((_, idx) => idx !== i) }));

  const updateInput = (i: number, field: string, value: any) => {
    setForm(f => { const inputs = [...f.inputs]; inputs[i] = { ...inputs[i], [field]: value }; return { ...f, inputs }; });
  };
  const updateOutput = (i: number, field: string, value: any) => {
    setForm(f => { const outputs = [...f.outputs]; outputs[i] = { ...outputs[i], [field]: value }; return { ...f, outputs }; });
  };

  const totalInputCost = form.inputs.reduce((s, inp) => s + (parseFloat(inp.quantity) || 0) * (parseFloat(inp.unit_cost) || 0), 0);
  const totalOutputQty = form.outputs.reduce((s, out) => s + (parseFloat(out.quantity) || 0), 0);
  const outputUnitCost = totalOutputQty > 0 ? totalInputCost / totalOutputQty : 0;

  const save = async () => {
    if (!form.source_location_id || !form.destination_location_id) { toast.error('Select locations'); return; }
    if (form.inputs.length === 0) { toast.error('Add at least 1 input item'); return; }
    if (form.outputs.length === 0) { toast.error('Add at least 1 output item'); return; }
    for (const inp of form.inputs) { if (!inp.product_id) { toast.error('Select product for all inputs'); return; } if (parseFloat(inp.quantity) <= 0) { toast.error('Input qty > 0'); return; } }
    for (const out of form.outputs) { if (!out.product_id) { toast.error('Select product for all outputs'); return; } if (parseFloat(out.quantity) <= 0) { toast.error('Output qty > 0'); return; } }

    const payload = { ...form, unit_cost: undefined };
    try {
      if (editingId) {
        await api.patch('/production/' + editingId, payload);
        toast.success('Updated');
      } else {
        const res = await api.post('/production', payload);
        toast.success('Production Order ' + res.data.po_number + ' created');
      }
      resetForm(); loadOrders();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const completeOrder = async (id: string) => {
    if (!confirm('Complete this production order? Inventory will be updated.')) return;
    try { await api.post('/production/' + id + '/complete'); toast.success('Completed'); loadOrders(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const cancelOrder = async (id: string) => {
    if (!confirm('Cancel this order? Inventory will be reversed if already completed.')) return;
    try { await api.post('/production/' + id + '/cancel'); toast.success('Cancelled'); loadOrders(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const deleteOrder = async (id: string) => {
    if (!confirm('Delete?')) return;
    try { await api.delete('/production/' + id); toast.success('Deleted'); loadOrders(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const editOrder = async (id: string) => {
    try {
      const r = await api.get('/production/' + id);
      const o = r.data;
      setForm({
        po_date: o.po_date || '', source_location_id: o.source_location_id || 1,
        destination_location_id: o.destination_location_id || 1, notes: o.notes || '',
        inputs: (o.inputs || []).map((i: any) => ({ product_id: i.product_id, uom: i.uom || 'pcs', quantity: parseFloat(i.quantity), unit_cost: parseFloat(i.unit_cost), batch_number: i.batch_number || '', expiry_date: i.expiry_date || '' })),
        outputs: (o.outputs || []).map((i: any) => ({ product_id: i.product_id, uom: i.uom || 'pcs', quantity: parseFloat(i.quantity), unit_cost: 0, batch_number: i.batch_number || '', expiry_date: i.expiry_date || '' })),
      });
      setEditingId(id); setCreating(true);
    } catch { toast.error('Error loading'); }
  };

  const statusBadge = (s: string) => {
    const c: Record<string, string> = { Draft: 'bg-gray-100 text-gray-700', Completed: 'bg-green-100 text-green-700', Cancelled: 'bg-red-100 text-red-700' };
    return <span className={'px-2 py-1 text-xs rounded-full ' + (c[s] || '')}>{s}</span>;
  };

  if (creating) return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">{editingId ? 'Edit Production Order' : 'Create Production Order'}</h1>
        <button onClick={resetForm} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Cancel</button>
      </div>
      <div className="flex-1 overflow-auto space-y-4">
        <div className="bg-white rounded-lg border p-4">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Date</label>
              <input type="date" value={form.po_date} onChange={e => setForm({ ...form, po_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Source Location</label>
              <select value={form.source_location_id} onChange={e => setForm({ ...form, source_location_id: parseInt(e.target.value) })} className="w-full px-3 py-2 border rounded-lg text-sm">
                {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Destination Location</label>
              <select value={form.destination_location_id} onChange={e => setForm({ ...form, destination_location_id: parseInt(e.target.value) })} className="w-full px-3 py-2 border rounded-lg text-sm">
                {LOCATIONS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>
        </div>

        {/* Input Materials */}
        <div className="bg-white rounded-lg border">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Input Materials</h3>
            <button onClick={addInput} className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">+ Add Input</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="p-2 text-left" style={{ minWidth: 220 }}>Product</th>
              <th className="p-2" style={{ width: 60 }}>UOM</th>
              <th className="p-2" style={{ width: 90 }}>Batch #</th>
              <th className="p-2" style={{ width: 110 }}>Expiry</th>
              <th className="p-2" style={{ width: 80 }}>Qty</th>
              <th className="p-2" style={{ width: 110 }}>Unit Cost</th>
              <th className="p-2 text-right" style={{ width: 110 }}>Total</th>
              <th className="p-2" style={{ width: 30 }}></th>
            </tr></thead>
            <tbody>
              {form.inputs.map((inp, i) => {
                const product = products.find(p => p.id === inp.product_id);
                const cost = (parseFloat(inp.quantity) || 0) * (parseFloat(inp.unit_cost) || 0);
                return (
                  <tr key={i} className="border-t">
                    <td className="p-1.5">
                      <ProductAutocomplete products={products} value={inp.product_id} selectedName={product?.name || ''}
                        getPrice={p => p.cost || 0} placeholder="Search input product..."
                        onSelect={p => {
                          const inputs = [...form.inputs]; inputs[i] = { ...inputs[i], product_id: p.id, unit_cost: p.cost || 0, uom: p.unit_of_measure || 'pcs', batch_number: '', expiry_date: '' };
                          setForm({ ...form, inputs });
                          api.get('/inventory/batches/' + p.id).then(res => {
                            const batches = res.data || [];
                            if (batches.length > 0) {
                              setForm(f => {
                                const inputs2 = [...f.inputs];
                                inputs2[i].batch_number = batches[0].batch_number || '';
                                inputs2[i].expiry_date = batches[0].expiry_date || '';
                                return { ...f, inputs: inputs2 };
                              });
                            }
                          }).catch(() => {});
                        }} />
                    </td>
                    <td className="p-1.5">
                      <select value={inp.uom} onChange={e => updateInput(i, 'uom', e.target.value)} className="w-full px-1 py-1 border rounded text-xs">
                        <option value="pcs">pcs</option><option value="kg">kg</option><option value="case">case</option><option value="sack">sack</option><option value="box">box</option><option value="pack">pack</option><option value="L">L</option>
                      </select>
                    </td>
                    <td className="p-1.5"><input type="text" value={inp.batch_number} onChange={e => updateInput(i, 'batch_number', e.target.value)} className="w-full px-1 py-1 border rounded text-xs" placeholder="Batch #" /></td>
                    <td className="p-1.5"><input type="date" value={inp.expiry_date} onChange={e => updateInput(i, 'expiry_date', e.target.value)} className="w-full px-1 py-1 border rounded text-xs" /></td>
                    <td className="p-1.5"><input type="number" value={inp.quantity} onChange={e => updateInput(i, 'quantity', e.target.value)} className="w-full px-1 py-1 border rounded text-center text-xs" step="any" /></td>
                    <td className="p-1.5"><input type="number" value={inp.unit_cost} onChange={e => updateInput(i, 'unit_cost', e.target.value)} className="w-full px-1 py-1 border rounded text-right text-xs" step="any" /></td>
                    <td className="p-1.5 text-right font-medium text-xs">{formatCurrency(cost)}</td>
                    <td className="p-1.5"><button onClick={() => removeInput(i)} className="text-red-500 text-xs">X</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Output Finished Goods */}
        <div className="bg-white rounded-lg border">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Output Finished Goods</h3>
            <button onClick={addOutput} className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">+ Add Output</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="p-2 text-left" style={{ minWidth: 220 }}>Product</th>
              <th className="p-2" style={{ width: 60 }}>UOM</th>
              <th className="p-2" style={{ width: 90 }}>Batch #</th>
              <th className="p-2" style={{ width: 110 }}>Expiry</th>
              <th className="p-2" style={{ width: 80 }}>Qty</th>
              <th className="p-2" style={{ width: 110 }}>Unit Cost</th>
              <th className="p-2 text-right" style={{ width: 110 }}>Total</th>
              <th className="p-2" style={{ width: 30 }}></th>
            </tr></thead>
            <tbody>
              {form.outputs.map((out, i) => {
                const product = products.find(p => p.id === out.product_id);
                const cost = (parseFloat(out.quantity) || 0) * outputUnitCost;
                const inheritedBatch = form.inputs[0]?.batch_number || '';
                const inheritedExpiry = form.inputs[0]?.expiry_date || '';
                return (
                  <tr key={i} className="border-t">
                    <td className="p-1.5">
                      <ProductAutocomplete products={products} value={out.product_id} selectedName={product?.name || ''}
                        getPrice={p => outputUnitCost} placeholder="Search output product..."
                        onSelect={p => {
                          const batch = form.inputs[0]?.batch_number || '';
                          const exp = form.inputs[0]?.expiry_date || '';
                          const outputs = [...form.outputs]; outputs[i] = { ...outputs[i], product_id: p.id, uom: p.unit_of_measure || 'pcs', batch_number: batch, expiry_date: exp }; setForm({ ...form, outputs });
                        }} />
                    </td>
                    <td className="p-1.5">
                      <select value={out.uom} onChange={e => updateOutput(i, 'uom', e.target.value)} className="w-full px-1 py-1 border rounded text-xs">
                        <option value="pcs">pcs</option><option value="kg">kg</option><option value="case">case</option><option value="sack">sack</option><option value="box">box</option><option value="pack">pack</option><option value="L">L</option>
                      </select>
                    </td>
                    <td className="p-1.5"><input type="text" value={inheritedBatch} readOnly className="w-full px-1 py-1 border rounded text-xs bg-gray-50" /></td>
                    <td className="p-1.5"><input type="text" value={inheritedExpiry} readOnly className="w-full px-1 py-1 border rounded text-xs bg-gray-50" /></td>
                    <td className="p-1.5"><input type="number" value={out.quantity} onChange={e => updateOutput(i, 'quantity', e.target.value)} className="w-full px-1 py-1 border rounded text-center text-xs" step="any" /></td>
                    <td className="p-1.5"><input type="number" value={outputUnitCost.toFixed(2)} readOnly className="w-full px-1 py-1 border rounded text-right text-xs bg-gray-50" /></td>
                    <td className="p-1.5 text-right font-medium text-xs">{formatCurrency(cost)}</td>
                    <td className="p-1.5"><button onClick={() => removeOutput(i)} className="text-red-500 text-xs">X</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex justify-end">
            <div className="space-y-1 text-sm w-72">
              <div className="flex justify-between"><span>Total Input Cost:</span><span className="font-medium">{formatCurrency(totalInputCost)}</span></div>
              <div className="flex justify-between"><span>Total Output Qty:</span><span className="font-medium">{totalOutputQty}</span></div>
              <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Output Unit Cost:</span><span className="text-blue-700">{formatCurrency(outputUnitCost)}</span></div>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={resetForm} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
            <button onClick={save} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
              {editingId ? 'Update' : 'Save Draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Production Orders</h1>
        <button onClick={() => setCreating(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">+ Create Order</button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setStatusFilter('')} className={'px-3 py-1 text-xs rounded-full ' + (!statusFilter ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600')}>All</button>
        {['Draft', 'Completed', 'Cancelled'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)} className={'px-3 py-1 text-xs rounded-full ' + (statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600')}>{s}</button>
        ))}
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="data-table">
          <thead><tr><th>PO Number</th><th>Date</th><th>Source</th><th>Destination</th><th>Input Cost</th><th>Output Qty</th><th>Unit Cost</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {orders.map((o: any) => (
              <tr key={o.id}>
                <td className="font-mono text-xs">{o.po_number}</td>
                <td className="text-xs">{formatDate(o.po_date || o.created_at)}</td>
                <td className="text-xs">Location {o.source_location_id}</td>
                <td className="text-xs">Location {o.destination_location_id}</td>
                <td className="font-medium">{formatCurrency(o.total_input_cost)}</td>
                <td>{o.total_output_qty}</td>
                <td className="font-medium">{formatCurrency(o.output_unit_cost)}</td>
                <td>{statusBadge(o.status)}</td>
                <td>
                  <div className="flex gap-1 flex-wrap">
                    <button onClick={() => setPreviewId(o.id)} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">View</button>
                    {o.status === 'Draft' && (
                      <>
                        <button onClick={() => editOrder(o.id)} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Edit</button>
                        <button onClick={() => completeOrder(o.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Complete</button>
                        <button onClick={() => cancelOrder(o.id)} className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">Cancel</button>
                        <button onClick={() => deleteOrder(o.id)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Del</button>
                      </>
                    )}
                    {o.status === 'Completed' && (
                      <button onClick={() => cancelOrder(o.id)} className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">Cancel</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-gray-400">No production orders</td></tr>}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </div>

      {previewId && (
        <div className="modal-overlay" onClick={() => setPreviewId(null)}>
          <div className="modal-content max-w-4xl" onClick={e => e.stopPropagation()} style={{ height: '90vh' }}>
            <div className="flex justify-between items-center p-3 border-b">
              <h2 className="font-semibold">Production Order Preview</h2>
              <div className="flex gap-2">
                <button onClick={() => window.open('/api/production/' + previewId + '/print', '_blank')} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Print</button>
                <button onClick={() => setPreviewId(null)} className="px-3 py-1 border rounded text-sm">Close</button>
              </div>
            </div>
            <iframe src={'/api/production/' + previewId + '/print'} className="w-full flex-1 border-0" style={{ height: 'calc(100% - 50px)' }} />
          </div>
        </div>
      )}
    </div>
  );
}
