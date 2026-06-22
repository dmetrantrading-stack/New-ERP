import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, ArrowLeft, Eye, Printer, Search, RotateCcw } from 'lucide-react';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import DocumentNotesTermsPanel from '../../components/DocumentNotesTermsPanel';
import { ATTACHMENT_REF } from '../../lib/documentAttachments';
import { printDocument } from '../../lib/printDocument';

const PRIMARY = '#1E40AF';

export default function PurchaseReturns() {
  const { hasPerm } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [returns, setReturns] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<any>({ supplier_id: '', reason: '', notes: '', terms_conditions: '', items: [] });
  const limit = 20;

  const load = () => {
    setLoading(true);
    api.get(`/purchases/returns?page=${page}&limit=${limit}`)
      .then((r) => { setReturns(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load purchase returns'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);
  useEffect(() => {
    api.get('/suppliers').then((r) => setSuppliers(r.data.data || [])).catch(() => {});
    api.get('/products?limit=500').then((r) => setProducts(r.data.data || [])).catch(() => {});
    api.get('/inventory/locations').then((r) => setLocations(r.data || [])).catch(() => {
      setLocations([{ id: 1, name: 'Store' }]);
    });
  }, []);

  const searchProducts = async (q: string, locationId?: number | string) => {
    try {
      const loc = locationId || locations[0]?.id || 1;
      return (await api.get(`/products/search/quick?q=${encodeURIComponent(q)}&location_id=${loc}`)).data;
    } catch {
      return [];
    }
  };

  const defaultLocationId = () => locations[0]?.id || 1;

  const blankItem = () => ({
    product_id: '', quantity: 1, unit_cost: 0, net_unit_cost: 0,
    location_id: defaultLocationId(), unit_of_measure: '', available_stock: null as number | null,
  });

  const applyProductToItem = (item: any, p: any) => ({
    ...item,
    product_id: p.id,
    product_name: p.name,
    sku: p.sku,
    unit_cost: p.cost || 0,
    net_unit_cost: p.cost || 0,
    unit_of_measure: p.unit_of_measure || 'pc',
    available_stock: parseFloat(String(p.stock ?? p.store_stock ?? '')) || 0,
  });

  const selectedSupplier = suppliers.find((s) => String(s.id) === String(form.supplier_id));

  const selectSupplier = (id: string) => {
    setForm((prev: any) => ({
      ...prev,
      supplier_id: id,
      items: prev.items.length ? prev.items : [blankItem()],
    }));
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const items = [...form.items];
    items[idx] = { ...items[idx], [field]: value };
    if (field === 'product_id' && value) {
      const p = products.find((x) => x.id === value);
      if (p) items[idx] = applyProductToItem(items[idx], p);
    }
    if (field === 'unit_cost' || field === 'net_unit_cost') {
      items[idx].net_unit_cost = parseFloat(value) || 0;
    }
    if (field === 'location_id' && items[idx].product_id) {
      items[idx].available_stock = null;
      api.get(`/products/search/quick?q=${encodeURIComponent(items[idx].sku || items[idx].product_name || '')}&location_id=${value}`)
        .then((r) => {
          const match = (r.data || []).find((p: any) => p.id === items[idx].product_id);
          if (match) {
            setForm((prev: any) => {
              const next = [...prev.items];
              if (!next[idx] || next[idx].product_id !== items[idx].product_id) return prev;
              next[idx] = { ...next[idx], available_stock: parseFloat(String(match.stock ?? 0)) || 0 };
              return { ...prev, items: next };
            });
          }
        })
        .catch(() => {});
    }
    setForm({ ...form, items });
  };

  const returnTotal = form.items.reduce(
    (s: number, i: any) => s + parseFloat(i.quantity || 0) * parseFloat(i.net_unit_cost || i.unit_cost || 0),
    0
  );
  const totalQty = form.items.reduce((s: number, i: any) => s + (parseFloat(i.quantity) || 0), 0);

  const submit = async () => {
    if (!form.supplier_id) { toast.error('Select a supplier'); return; }
    const items = form.items.filter((i: any) => i.product_id);
    if (!items.length) { toast.error('Add at least one item'); return; }
    for (const i of items) {
      const qty = parseFloat(i.quantity) || 0;
      if (qty <= 0) { toast.error('Enter a valid return quantity for each item'); return; }
      if (i.available_stock != null && qty > i.available_stock) {
        toast.error(`Return qty exceeds stock for ${i.product_name || 'product'} (${i.available_stock} available)`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await api.post('/purchases/returns', {
        supplier_id: form.supplier_id,
        reason: form.reason,
        notes: form.notes,
        terms_conditions: form.terms_conditions,
        items: items.map((i: any) => ({
          product_id: i.product_id,
          quantity: parseFloat(i.quantity),
          unit_cost: parseFloat(i.unit_cost || 0),
          net_unit_cost: parseFloat(i.net_unit_cost || i.unit_cost || 0),
          location_id: i.location_id || 1,
        })),
      });
      toast.success(`Return ${res.data.pr_number} completed`);
      setCreating(false);
      setForm({ supplier_id: '', reason: '', notes: '', terms_conditions: '', items: [] });
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to process return');
    } finally {
      setSubmitting(false);
    }
  };

  const viewReturn = async (id: string) => {
    try {
      const r = await api.get(`/purchases/returns/${id}`);
      setViewDoc(r.data);
      setViewing(true);
    } catch {
      toast.error('Failed to load return');
    }
  };

  const filtered = returns.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.pr_number?.toLowerCase().includes(q) || r.supplier_name?.toLowerCase().includes(q);
  });

  // ========== VIEW ==========
  if (viewing && viewDoc) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Return</h1>
            <span className="text-xs font-mono text-white/80">{viewDoc.pr_number}</span>
            <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700">{viewDoc.status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => printDocument(`/api/purchases/returns/${viewDoc.id}/print`)} className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"><Printer size={13} /> Print</button>
            <button onClick={() => setViewing(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 p-4 overflow-y-auto flex justify-center">
          <iframe ref={iframeRef} src={`/api/purchases/returns/${viewDoc.id}/print?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
            className="border border-gray-300 bg-white shadow" style={{ width: '800px', minHeight: '1100px' }} title="Return Preview" />
        </div>
      </div>
    );
  }

  // ========== CREATE ==========
  if (creating) {
    return (
      <div className="h-[calc(100vh-4rem)] flex flex-col -m-6 bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
          <div className="flex items-center gap-3">
            <button onClick={() => setCreating(false)} className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded"><ArrowLeft size={18} /></button>
            <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Return</h1>
            <span className="text-xs font-mono text-white/80">NEW</span>
          </div>
          <div className="flex items-center gap-1.5">
            {hasPerm('purchases.receiving-report.edit') && (
              <button onClick={submit} disabled={submitting} className="px-4 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50 disabled:opacity-50">
                {submitting ? 'Processing…' : 'Complete Return'}
              </button>
            )}
            <button onClick={() => setCreating(false)} className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded"><span className="text-lg leading-none">&times;</span></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">1 · Supplier</div>
                <select value={form.supplier_id} onChange={(e) => selectSupplier(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs">
                  <option value="">Select Supplier</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
                {selectedSupplier && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] text-gray-500">
                    <div className="bg-gray-50 rounded p-1.5 col-span-2"><span className="text-gray-400 block">Address</span>{selectedSupplier.address || '—'}</div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Contact</span>{selectedSupplier.contact_person || '—'}</div>
                    <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400 block">Balance</span>{formatCurrency(selectedSupplier.balance || 0)}</div>
                  </div>
                )}
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Return Details</div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase font-semibold">Reason</label>
                  <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    placeholder="Defective, wrong item, expired…" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-xs mt-0.5" />
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">3 · Items to Return</span>
                <button onClick={() => setForm({ ...form, items: [...form.items, blankItem()] })}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-600 bg-blue-50 rounded hover:bg-blue-100"><Plus size={12} /> Add Item</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left w-8">#</th>
                      <th className="px-3 py-2 text-left">Product</th>
                      <th className="px-3 py-2 text-left w-28">Location</th>
                      <th className="px-3 py-2 text-center w-16">UOM</th>
                      <th className="px-3 py-2 text-right w-20">Qty</th>
                      <th className="px-3 py-2 text-right w-20">Stock</th>
                      <th className="px-3 py-2 text-right w-24">Unit Cost</th>
                      <th className="px-3 py-2 text-right w-24">Total</th>
                      <th className="px-3 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {form.items.map((item: any, idx: number) => {
                      const lineTotal = (parseFloat(item.quantity) || 0) * (parseFloat(item.net_unit_cost) || 0);
                      return (
                        <tr key={idx} className="hover:bg-blue-50/30">
                          <td className="px-3 py-1.5 text-gray-400">{idx + 1}</td>
                          <td className="px-3 py-1.5 min-w-[180px]">
                            <ProductAutocomplete
                              products={products}
                              value={item.product_id}
                              selectedName={item.product_name || ''}
                              placeholder="Search product…"
                              getPrice={(p) => p.cost || 0}
                              searchFn={(q) => searchProducts(q, item.location_id)}
                              onSelect={(p) => {
                                if (!products.find((x) => x.id === p.id)) setProducts((prev) => [...prev, p]);
                                const items = [...form.items];
                                items[idx] = applyProductToItem(items[idx], p);
                                setForm({ ...form, items });
                              }}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <select value={item.location_id} onChange={(e) => updateItem(idx, 'location_id', parseInt(e.target.value))}
                              className="w-full px-1 py-1 border border-gray-200 rounded text-[10px]">
                              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                            </select>
                          </td>
                          <td className="px-3 py-1.5 text-center text-gray-500">{item.unit_of_measure || 'pc'}</td>
                          <td className="px-3 py-1.5">
                            <input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                              className={`w-full px-1 py-1 border rounded text-right text-xs ${
                                item.available_stock != null && parseFloat(item.quantity) > item.available_stock
                                  ? 'border-red-400 bg-red-50'
                                  : 'border-gray-200'
                              }`} />
                          </td>
                          <td className="px-3 py-1.5 text-right text-gray-500">
                            {item.available_stock != null ? item.available_stock : '—'}
                          </td>
                          <td className="px-3 py-1.5">
                            <input type="number" min="0" step="0.01" value={item.net_unit_cost} onChange={(e) => updateItem(idx, 'net_unit_cost', e.target.value)}
                              className="w-full px-1 py-1 border border-gray-200 rounded text-right text-xs" />
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold">{lineTotal > 0 ? formatCurrency(lineTotal) : '—'}</td>
                          <td className="px-3 py-1.5 text-center">
                            <button onClick={() => setForm({ ...form, items: form.items.filter((_: any, i: number) => i !== idx) })} className="text-red-400 hover:text-red-600">&times;</button>
                          </td>
                        </tr>
                      );
                    })}
                    {form.items.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Add items to return</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <DocumentNotesTermsPanel
              sectionLabel="4 · Notes & Terms"
              notes={form.notes || ''}
              termsConditions={form.terms_conditions || ''}
              onNotesChange={(v) => setForm({ ...form, notes: v })}
              onTermsChange={(v) => setForm({ ...form, terms_conditions: v })}
              referenceType={ATTACHMENT_REF.PurchaseReturn}
              referenceId=""
              notesPlaceholder="Return notes or supplier communication..."
            />
          </div>

          <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Return Summary</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Items</span><span>{form.items.filter((i: any) => i.product_id).length}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Qty</span><span>{totalQty}</span></div>
                <div className="flex justify-between pt-2 border-t-2 border-blue-900 text-sm font-bold text-blue-900">
                  <span>Total Return</span><span>{formatCurrency(returnTotal)}</span>
                </div>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-[10px] text-amber-900 leading-relaxed">
              Completing this return deducts inventory, reduces supplier AP balance, and posts a reversing journal entry.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== LIST ==========
  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <RotateCcw size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Purchase Returns</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">{total} records</span>
        </div>
        {hasPerm('purchases.receiving-report.edit') && (
          <button onClick={() => { setForm({ supplier_id: '', reason: '', notes: '', terms_conditions: '', items: [blankItem()] }); setCreating(true); }}
            className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50">
            <Plus size={14} /> New Return
          </button>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Return #, supplier…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs" />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">2 · Return History</div>
            {loading ? (
              <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                      <th className="px-3 py-2 text-left">Return #</th>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Supplier</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-center">Status</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No purchase returns found</td></tr>
                    )}
                    {filtered.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono font-medium text-blue-700 cursor-pointer hover:underline" onClick={() => viewReturn(r.id)}>{r.pr_number}</td>
                        <td className="px-3 py-2">{formatDate(r.return_date || r.created_at)}</td>
                        <td className="px-3 py-2">{r.supplier_name}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(r.total || 0)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-green-100 text-green-700">{r.status}</span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => viewReturn(r.id)} className="p-1 hover:bg-blue-50 rounded text-blue-600" title="View"><Eye size={14} /></button>
                            <button onClick={() => { const t = localStorage.getItem('token'); window.open(`/api/purchases/returns/${r.id}/print?token=${t}`, '_blank'); }}
                              className="p-1 hover:bg-green-50 rounded text-green-600" title="Print"><Printer size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} limit={limit} onPageChange={setPage} />
              </>
            )}
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Total Returns</div>
            <p className="text-2xl font-bold text-blue-900">{total}</p>
            <p className="text-xs text-gray-500 mt-1">Completed purchase returns</p>
          </div>
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-[10px] text-gray-500 leading-relaxed">
            Return goods to suppliers when items are defective, wrong, or expired. Stock is deducted from the selected location.
          </div>
          <Link to="/goods-receipts" className="block text-center text-xs text-blue-600 hover:underline">View Goods Receipts →</Link>
          <Link to="/payables" className="block text-center text-xs text-blue-600 hover:underline">View Accounts Payable →</Link>
        </div>
      </div>
    </div>
  );
}
