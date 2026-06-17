import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Search, Plus, CheckSquare, Square } from 'lucide-react';
import Pagination from '../../components/Pagination';
import ProductAutocomplete from '../../components/ProductAutocomplete';
import toast from 'react-hot-toast';

export default function PayablesPage() {
  const [tab, setTab] = useState<'payments' | 'apv'>('payments');
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [supplierInvoices, setSupplierInvoices] = useState<any[]>([]);
  const [supplierInfo, setSupplierInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<any[]>([]);

  // --- APV State ---
  const [apvs, setApvs] = useState<any[]>([]);
  const [showAPVForm, setShowAPVForm] = useState(false);
  const [editingAPV, setEditingAPV] = useState<any>(null);
  const [previewAPV, setPreviewAPV] = useState<string | null>(null);
  const [previewPV, setPreviewPV] = useState<string | null>(null);
  const [apvPage, setApvPage] = useState(1);
  const [apvTotalPages, setApvTotalPages] = useState(1);
  const [apvTotalCount, setApvTotalCount] = useState(0);
  const [apvStatusFilter, setApvStatusFilter] = useState('');
  const [apvForm, setApvForm] = useState<any>({
    supplier_id: '', po_id: '', gr_id: '', apv_date: new Date().toISOString().split('T')[0],
    due_date: '', payment_terms: '', supplier_invoice_number: '', supplier_invoice_date: '', notes: '',
    items: [] as any[],
  });
  const [goodsReceipts, setGoodsReceipts] = useState<any[]>([]);
  const [supplierPOs, setSupplierPOs] = useState<any[]>([]);

  const [form, setForm] = useState<any>({
    supplier_id: '', payment_method: 'Cash', reference_number: '',
    notes: '', bank_account_id: '', payment_date: new Date().toISOString().split('T')[0],
    check_date: '', check_bank: '',
  });

  useEffect(() => {
    api.get('/payables/vouchers').then(r => setVouchers(r.data || [])).catch(() => {});
    api.get('/suppliers').then(r => setSuppliers(r.data.data || [])).catch(() => {});
    api.get('/bank-management/accounts').then(r => setBankAccounts(r.data || [])).catch(() => {});
    api.get('/products?limit=500').then(r => setProducts(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => { if (tab === 'apv') loadAPVs(); }, [tab, apvPage, apvStatusFilter]);

  const loadAPVs = () => {
    const p = new URLSearchParams(); p.set('page', String(apvPage)); p.set('limit', '20');
    if (apvStatusFilter) p.set('status', apvStatusFilter);
    api.get('/payables/apv?' + p).then(r => {
      setApvs(r.data.data || r.data || []);
      setApvTotalCount(r.data.total || 0);
      setApvTotalPages(Math.ceil((r.data.total || 0) / 20));
    }).catch(() => {});
  };

  const statusBadge = (s: string) => {
    const c: Record<string, string> = { Draft: 'bg-gray-100 text-gray-700', Posted: 'bg-blue-100 text-blue-700', 'Partially Paid': 'bg-yellow-100 text-yellow-700', 'Fully Paid': 'bg-green-100 text-green-700', Cancelled: 'bg-red-100 text-red-700', Paid: 'bg-green-100 text-green-700', Partial: 'bg-yellow-100 text-yellow-700', Void: 'bg-gray-200 text-gray-500' };
    return 'px-2 py-1 text-xs rounded-full ' + (c[s] || 'bg-gray-100');
  };

  // --- APV Functions ---
  const addAPVItem = () => setApvForm((f: any) => ({ ...f, items: [...f.items, { product_id: '', description: '', qty: 1, uom: 'pcs', unit_cost: 0, discount_amount: 0 }] }));
  const removeAPVItem = (i: number) => setApvForm((f: any) => ({ ...f, items: f.items.filter((_: any, idx: number) => idx !== i) }));
  const updateAPVItem = (i: number, field: string, value: any) => {
    setApvForm((f: any) => { const items = [...f.items]; items[i] = { ...items[i], [field]: value }; return { ...f, items }; });
  };

  const apvTotalGross = apvForm.items.reduce((s: number, it: any) => s + (parseFloat(it.qty) || 0) * (parseFloat(it.unit_cost) || 0), 0);
  const apvTotalDiscount = apvForm.items.reduce((s: number, it: any) => s + (parseFloat(it.discount_amount) || 0), 0);
  const apvNet = apvTotalGross - apvTotalDiscount;
  const apvVatable = apvNet / 1.12;
  const apvVat = apvNet - apvVatable;
  const apvTotal = apvNet;

  const saveAPV = async () => {
    if (!apvForm.supplier_id) { toast.error('Select a supplier'); return; }
    if (apvForm.items.length === 0) { toast.error('Add at least one item'); return; }
    for (const it of apvForm.items) { if (parseFloat(it.qty) <= 0) { toast.error('Qty > 0 required'); return; } }
    try {
      const payload = { ...apvForm, items: apvForm.items.map((it: any) => ({ ...it, qty: parseFloat(it.qty), unit_cost: parseFloat(it.unit_cost), discount_amount: parseFloat(it.discount_amount) })) };
      if (editingAPV) {
        await api.patch('/payables/apv/' + editingAPV.id, payload);
        toast.success('APV updated');
        resetAPVForm();
      } else {
        const res = await api.post('/payables/apv', payload);
        toast.success('APV ' + res.data.apv_number + ' created');
        resetAPVForm();
      }
      loadAPVs();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const postAPV = async (id: string) => {
    if (!confirm('Post this APV? This will create accounting entries and update supplier balance.')) return;
    try { await api.post('/payables/apv/' + id + '/post'); toast.success('APV Posted'); loadAPVs(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const deleteAPV = async (id: string) => {
    if (!confirm('Delete this APV?')) return;
    try { await api.delete('/payables/apv/' + id); toast.success('Deleted'); loadAPVs(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const editAPV = async (id: string) => {
    try {
      const r = await api.get('/payables/apv/' + id);
      const o = r.data;
      setApvForm({
        supplier_id: o.supplier_id || '', po_id: o.po_id || '', gr_id: o.gr_id || '',
        apv_date: o.apv_date || '', due_date: o.due_date || '', payment_terms: o.payment_terms || '',
        supplier_invoice_number: o.supplier_invoice_number || '', supplier_invoice_date: o.supplier_invoice_date || '', notes: o.notes || '',
        items: (o.items || []).map((i: any) => ({ product_id: i.product_id, description: i.description || '', qty: parseFloat(i.qty), uom: i.uom || 'pcs', unit_cost: parseFloat(i.unit_cost), discount_amount: parseFloat(i.discount_amount) })),
      });
      setEditingAPV(o); setShowAPVForm(true);
    } catch { toast.error('Error loading APV'); }
  };

  const resetAPVForm = () => {
    setApvForm({ supplier_id: '', po_id: '', gr_id: '', apv_date: new Date().toISOString().split('T')[0], due_date: '', payment_terms: '', supplier_invoice_number: '', supplier_invoice_date: '', notes: '', items: [] });
    setShowAPVForm(false); setEditingAPV(null);
  };

  // --- Payment Voucher Functions (existing) ---
  const loadSupplierInvoices = (supplierId: string) => {
    if (!supplierId) { setSupplierInvoices([]); setSupplierInfo(null); return; }
    setLoading(true);
    Promise.all([
      api.get(`/payables/invoices/${supplierId}`),
      api.get(`/payables/apv-outstanding/${supplierId}`),
    ]).then(([poRes, apvRes]) => {
      const pos = ((poRes.data?.invoices || poRes.data || []) as any[]).map((inv: any) => ({ ...inv, type: 'po', selected: inv.balance_due > 0, payment_amount: inv.balance_due }));
      const apvs = ((apvRes.data || []) as any[]).map((inv: any) => ({ ...inv, type: 'apv', apv_id: inv.id, selected: inv.balance_due > 0, payment_amount: inv.balance_due }));
      setSupplierInvoices([...pos, ...apvs]);
      const supplier = suppliers.find((s: any) => s.id === parseInt(supplierId));
      setSupplierInfo(supplier || null);
    }).catch(() => toast.error('Failed to load supplier invoices')).finally(() => setLoading(false));
  };

  const toggleInvoice = (idx: number) => {
    const updated = supplierInvoices.map((inv: any, i: number) => i === idx ? { ...inv, selected: !inv.selected, payment_amount: !inv.selected ? Math.min(inv.balance_due, (form.payment_amount || inv.balance_due)) : 0 } : inv);
    setSupplierInvoices(updated);
  };

  const updatePaymentAmount = (idx: number, amount: number) => {
    setSupplierInvoices(supplierInvoices.map((inv: any, i: number) => i === idx ? { ...inv, payment_amount: Math.min(amount, inv.balance_due) } : inv));
  };

  const submitPayment = async () => {
    const selectedInvoices = supplierInvoices.filter((inv: any) => inv.selected && inv.payment_amount > 0);
    if (selectedInvoices.length === 0) { toast.error('Select at least one invoice with payment amount'); return; }
    const isBank = form.payment_method === 'Check' || form.payment_method === 'Bank Transfer';
    if (isBank && !form.bank_account_id) { toast.error('Select bank account'); return; }
    try {
      const payload = {
        supplier_id: parseInt(form.supplier_id),
        payment_method: form.payment_method,
        payment_date: form.payment_date,
        reference_number: form.reference_number,
        check_date: form.check_date || undefined,
        check_bank: form.check_bank || undefined,
        notes: form.notes,
        bank_account_id: isBank ? form.bank_account_id : undefined,
        allocations: selectedInvoices.map((inv: any) => ({
          po_id: inv.type === 'po' ? inv.po_id || inv.id : undefined,
          apv_id: inv.type === 'apv' ? inv.apv_id || inv.id : undefined,
          amount: parseFloat(inv.payment_amount),
        })),
      };
      await api.post('/payables/vouchers', payload);
      toast.success('Payment recorded');
      setShowCreate(false);
      api.get('/payables/vouchers').then(r => setVouchers(r.data || [])).catch(() => {});
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  // ============ APV FORM VIEW ============
  if (showAPVForm) return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold">{editingAPV ? 'Edit AP Voucher' : 'Create AP Voucher'}</h1>
        <button onClick={resetAPVForm} className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50">Cancel</button>
      </div>
      <div className="flex-1 overflow-auto space-y-4">
        <div className="bg-white rounded-lg border p-4">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Supplier</label>
              <select value={apvForm.supplier_id} onChange={e => {
                const sid = e.target.value;
                setApvForm({ ...apvForm, supplier_id: sid, po_id: '', gr_id: '', items: [] });
                if (sid) {
                  api.get('/payables/goods-receipts/' + sid).then(r => setGoodsReceipts(r.data || [])).catch(() => {});
                  api.get('/payables/supplier-pos/' + sid).then(r => setSupplierPOs(r.data || [])).catch(() => {});
                } else { setGoodsReceipts([]); setSupplierPOs([]); }
              }} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">-- Select --</option>
                {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
              </select>
            </div>
            <div><label className="block text-sm font-medium mb-1">APV Date</label><input type="date" value={apvForm.apv_date} onChange={e => setApvForm({ ...apvForm, apv_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">Due Date</label><input type="date" value={apvForm.due_date} onChange={e => setApvForm({ ...apvForm, due_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">Payment Terms</label><input type="text" value={apvForm.payment_terms} onChange={e => setApvForm({ ...apvForm, payment_terms: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">Supplier Invoice #</label><input type="text" value={apvForm.supplier_invoice_number} onChange={e => setApvForm({ ...apvForm, supplier_invoice_number: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">Supplier Invoice Date</label><input type="date" value={apvForm.supplier_invoice_date} onChange={e => setApvForm({ ...apvForm, supplier_invoice_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            {supplierPOs.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Load from PO</label>
                <select value={apvForm.po_id} onChange={e => {
                  const poId = e.target.value;
                  setApvForm(f => ({ ...f, po_id: poId }));
                  if (poId) {
                    api.get('/payables/po-items/' + poId).then(r => {
                      const items = (r.data || []).map((pi: any) => ({
                        product_id: pi.product_id, description: pi.product_name, qty: pi.quantity,
                        uom: pi.unit_of_measure || 'pcs', unit_cost: pi.net_unit_cost || pi.unit_cost,
                        discount_amount: pi.discount_amount || 0,
                      }));
                      setApvForm(f => ({ ...f, items }));
                    }).catch(() => toast.error('Failed to load PO items'));
                  }
                }} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">-- Select PO --</option>
                  {supplierPOs.map((po: any) => (
                    <option key={po.id} value={po.id}>{po.po_number} - {formatCurrency(po.total)} ({po.status})</option>
                  ))}
                </select>
              </div>
            )}
            <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={apvForm.notes} onChange={e => setApvForm({ ...apvForm, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            {goodsReceipts.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Load from Goods Receipt</label>
                <select value={apvForm.gr_id} onChange={e => {
                  const grId = e.target.value;
                  const selectedGR = goodsReceipts.find((gr: any) => gr.id === grId);
                  setApvForm(f => ({ ...f, gr_id: grId, supplier_invoice_number: selectedGR?.supplier_invoice_number || '', po_id: selectedGR?.po_id || f.po_id }));
                  if (grId) {
                    api.get('/payables/gr-items/' + grId).then(r => {
                      const items = (r.data || []).map((gi: any) => ({
                        product_id: gi.product_id, description: gi.product_name, qty: gi.quantity,
                        uom: gi.unit_of_measure || 'pcs', unit_cost: gi.net_unit_cost || gi.unit_cost,
                        discount_amount: gi.discount_amount || 0, gr_id: grId,
                      }));
                      setApvForm(f => ({ ...f, items }));
                    }).catch(() => toast.error('Failed to load GR items'));
                  }
                }} className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="">-- Select GR --</option>
                  {goodsReceipts.map((gr: any) => (
                    <option key={gr.id} value={gr.id}>{gr.gr_number} {gr.po_number ? ' (PO: ' + gr.po_number + ')' : ''} - {new Date(gr.received_date).toLocaleDateString('en-PH')}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg border">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">Items</h3>
            <button onClick={addAPVItem} className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700">+ Add Item</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="p-2 text-left" style={{ minWidth: 220 }}>Description</th>
              <th className="p-2" style={{ width: 60 }}>UOM</th>
              <th className="p-2" style={{ width: 70 }}>Qty</th>
              <th className="p-2" style={{ width: 100 }}>Unit Cost</th>
              <th className="p-2" style={{ width: 80 }}>Disc</th>
              <th className="p-2 text-right" style={{ width: 100 }}>Amount</th>
              <th className="p-2" style={{ width: 30 }}></th>
            </tr></thead>
            <tbody>
              {apvForm.items.map((it: any, i: number) => {
                const product = products.find(p => p.id === it.product_id);
                const netAmt = ((parseFloat(it.qty) || 0) * (parseFloat(it.unit_cost) || 0)) - (parseFloat(it.discount_amount) || 0);
                return (
                  <tr key={i} className="border-t">
                    <td className="p-1.5">
                      <ProductAutocomplete products={products} value={it.product_id} selectedName={product?.name || it.description || ''}
                        getPrice={p => p.cost || 0} placeholder="Search product..."
                        onSelect={p => { const items = [...apvForm.items]; items[i] = { ...items[i], product_id: p.id, description: p.name, unit_cost: p.cost || 0, uom: p.unit_of_measure || 'pcs' }; setApvForm({ ...apvForm, items }); }} />
                    </td>
                    <td className="p-1.5"><select value={it.uom} onChange={e => updateAPVItem(i, 'uom', e.target.value)} className="w-full px-1 py-1 border rounded text-xs"><option>pcs</option><option>kg</option><option>case</option><option>sack</option><option>box</option><option>pack</option><option>L</option></select></td>
                    <td className="p-1.5"><input type="number" value={it.qty} onChange={e => updateAPVItem(i, 'qty', e.target.value)} className="w-full px-1 py-1 border rounded text-center text-xs" step="any" /></td>
                    <td className="p-1.5"><input type="number" value={it.unit_cost} onChange={e => updateAPVItem(i, 'unit_cost', e.target.value)} className="w-full px-1 py-1 border rounded text-right text-xs" step="any" /></td>
                    <td className="p-1.5"><input type="number" value={it.discount_amount} onChange={e => updateAPVItem(i, 'discount_amount', e.target.value)} className="w-full px-1 py-1 border rounded text-right text-xs" step="any" /></td>
                    <td className="p-1.5 text-right font-medium text-xs">{formatCurrency(netAmt)}</td>
                    <td className="p-1.5"><button onClick={() => removeAPVItem(i)} className="text-red-500 text-xs">X</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-white rounded-lg border p-4">
          <div className="flex justify-end">
            <div className="space-y-1 text-sm w-72">
              <div className="flex justify-between"><span>Gross Purchases:</span><span>{formatCurrency(apvTotalGross)}</span></div>
              {apvTotalDiscount > 0 && <div className="flex justify-between"><span>Less Discount:</span><span className="text-red-600">-{formatCurrency(apvTotalDiscount)}</span></div>}
              <div className="flex justify-between"><span>Net Purchases:</span><span>{formatCurrency(apvNet)}</span></div>
              <div className="flex justify-between"><span>VATable Purchases:</span><span>{formatCurrency(apvVatable)}</span></div>
              <div className="flex justify-between"><span>Input VAT (12%):</span><span>{formatCurrency(apvVat)}</span></div>
              <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Total Payable:</span><span className="text-blue-700">{formatCurrency(apvTotal)}</span></div>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={resetAPVForm} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
            <button onClick={saveAPV} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">{editingAPV ? 'Update' : 'Save Draft'}</button>
          </div>
        </div>
      </div>
    </div>
  );

  // ============ MAIN VIEW ============
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Accounts Payable</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Pay Supplier</button>
          <button onClick={() => { resetAPVForm(); setShowAPVForm(true); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Create APV</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab('payments')} className={'px-4 py-2 text-sm font-medium rounded-lg ' + (tab === 'payments' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600')}>Payment Vouchers</button>
        <button onClick={() => setTab('apv')} className={'px-4 py-2 text-sm font-medium rounded-lg ' + (tab === 'apv' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600')}>AP Vouchers</button>
      </div>

      {/* === PAYMENT VOUCHERS TAB === */}
      {tab === 'payments' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table w-full">
            <thead><tr><th>Voucher #</th><th>PO #</th><th>Supplier</th><th>Date</th><th>Method</th><th className="text-right">Amount</th><th>Ref</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {vouchers.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">No payment vouchers yet</td></tr>}
              {vouchers.map((v) => (
                <tr key={v.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{v.voucher_number}</td>
                  <td className="px-4 py-3 font-mono text-xs text-blue-600">{v.po_number || '—'}</td>
                  <td className="px-4 py-3 text-sm">{v.supplier_name || 'N/A'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{formatDate(v.payment_date)}</td>
                  <td className="px-4 py-3 text-sm">{v.payment_method}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(v.amount)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{v.reference_number || '—'}</td>
                  <td className="px-4 py-3"><span className={statusBadge(v.status)}>{v.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => setPreviewPV(v.id)} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Preview</button>
                      <button onClick={() => { const t = localStorage.getItem('token'); window.open('/api/payables/vouchers/' + v.id + '/print?token=' + t, '_blank'); }} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Print</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* === AP VOUCHERS TAB === */}
      {tab === 'apv' && (
        <>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setApvStatusFilter('')} className={'px-3 py-1 text-xs rounded-full ' + (!apvStatusFilter ? 'bg-blue-600 text-white' : 'bg-gray-100')}>All</button>
            {['Draft', 'Posted', 'Partially Paid', 'Fully Paid', 'Cancelled'].map(s => (
              <button key={s} onClick={() => setApvStatusFilter(s)} className={'px-3 py-1 text-xs rounded-full ' + (apvStatusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100')}>{s}</button>
            ))}
          </div>
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="data-table w-full">
              <thead><tr><th>APV #</th><th>Supplier</th><th>Date</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Paid</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {apvs.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No AP vouchers yet</td></tr>}
                {apvs.map((a: any) => (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{a.apv_number}</td>
                    <td className="px-4 py-3 text-sm">{a.supplier_name || 'N/A'}</td>
                    <td className="px-4 py-3 text-xs">{formatDate(a.apv_date)}</td>
                    <td className="px-4 py-3 text-xs">{a.due_date ? formatDate(a.due_date) : '—'}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(a.total_amount)}</td>
                    <td className="px-4 py-3 text-sm text-right">{formatCurrency(a.amount_paid || 0)}</td>
                    <td className="px-4 py-3"><span className={statusBadge(a.status)}>{a.status}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => { const t = localStorage.getItem('token'); window.open('/api/payables/apv/' + a.id + '/print?token=' + t, '_blank'); }} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Print</button>
                        <button onClick={() => { setPreviewAPV(a.id); }} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">View</button>
                        {a.status === 'Draft' && (
                          <>
                            <button onClick={() => editAPV(a.id)} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Edit</button>
                            <button onClick={() => postAPV(a.id)} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Post</button>
                            <button onClick={() => deleteAPV(a.id)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Del</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={apvPage} totalPages={apvTotalPages} total={apvTotalCount} onPageChange={setApvPage} />
        </>
      )}

      {/* Preview Modal */}
      {previewAPV && (
        <div className="modal-overlay" onClick={() => setPreviewAPV(null)}>
          <div className="modal-content max-w-4xl" onClick={e => e.stopPropagation()} style={{ height: '90vh' }}>
            <div className="flex justify-between items-center p-3 border-b">
              <h2 className="font-semibold">APV Preview</h2>
              <div className="flex gap-2">
                <button onClick={() => { const t = localStorage.getItem('token'); window.open('/api/payables/apv/' + previewAPV + '/print?token=' + t, '_blank'); }} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Print</button>
                <button onClick={() => setPreviewAPV(null)} className="px-3 py-1 border rounded text-sm">Close</button>
              </div>
            </div>
            <iframe src={'/api/payables/apv/' + previewAPV + '/print?token=' + localStorage.getItem('token')} className="w-full flex-1 border-0" style={{ height: 'calc(100% - 50px)' }} />
          </div>
        </div>
      )}

      {/* Pay Supplier Modal (existing) */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Pay Supplier</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Supplier</label>
                  <select value={form.supplier_id} onChange={e => { setForm({ ...form, supplier_id: e.target.value }); loadSupplierInvoices(e.target.value); }} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">Select Supplier</option>
                    {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.supplier_name} ({formatCurrency(s.balance)})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Payment Date</label>
                  <input type="date" value={form.payment_date} onChange={e => setForm({ ...form, payment_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Payment Method</label>
                  <select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option>Cash</option><option>Check</option>
                  </select>
                </div>
                {form.payment_method === 'Check' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">Check Number</label>
                      <input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} placeholder="e.g. 001234" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Check Date</label>
                      <input type="date" value={form.check_date} onChange={e => setForm({ ...form, check_date: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Bank / Branch</label>
                      <input type="text" value={form.check_bank} onChange={e => setForm({ ...form, check_bank: e.target.value })} placeholder="e.g. BPI Cagayan de Oro" className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Deposit to Account</label>
                      <select value={form.bank_account_id} onChange={e => setForm({ ...form, bank_account_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                        <option value="">Select Bank Account</option>
                        {bankAccounts.map((ba: any) => <option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name}</option>)}
                      </select>
                    </div>
                  </>
                ) : form.payment_method === 'Bank Transfer' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">Reference #</label>
                      <input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Bank Account</label>
                      <select value={form.bank_account_id} onChange={e => setForm({ ...form, bank_account_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                        <option value="">Select Bank Account</option>
                        {bankAccounts.map((ba: any) => <option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name}</option>)}
                      </select>
                    </div>
                  </>
                ) : form.payment_method === 'GCash' || form.payment_method === 'Maya' ? (
                  <div>
                    <label className="block text-sm font-medium mb-1">Reference #</label>
                    <input type="text" value={form.reference_number} onChange={e => setForm({ ...form, reference_number: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                ) : null}
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              {loading && <p className="text-center py-4 text-gray-400">Loading...</p>}
              {supplierInvoices.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold mb-2">Unpaid Invoices & APVs</h3>
                  <table className="data-table w-full text-sm">
                    <thead><tr><th className="w-8"></th><th>Doc #</th><th>Type</th><th className="text-right">Orig. Amount</th><th className="text-right">Paid</th><th className="text-right">Balance</th><th className="text-right">Pay Amount</th></tr></thead>
                    <tbody>
                      {supplierInvoices.map((inv: any, idx: number) => (
                        <tr key={(inv.type === 'apv' ? 'apv-' : 'po-') + (inv.apv_id || inv.po_id || inv.id)} className="border-b hover:bg-gray-50">
                          <td className="px-2"><button onClick={() => toggleInvoice(idx)}>{inv.selected ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-gray-400" />}</button></td>
                          <td className="font-mono text-xs text-blue-600">{inv.type === 'apv' ? inv.apv_number : inv.invoice_number || inv.po_number}</td>
                          <td className="text-xs"><span className={'px-1.5 py-0.5 rounded text-xs ' + (inv.type === 'apv' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700')}>{inv.type === 'apv' ? 'APV' : 'PO'}</span></td>
                          <td className="text-right">{formatCurrency(inv.type === 'apv' ? inv.total_amount : inv.original_amount || inv.total)}</td>
                          <td className="text-right">{formatCurrency(inv.type === 'apv' ? inv.amount_paid : inv.amount_paid || inv.paid)}</td>
                          <td className="text-right font-medium">{formatCurrency(inv.balance_due)}</td>
                          <td className="text-right"><input type="number" value={inv.payment_amount} onChange={e => updatePaymentAmount(idx, parseFloat(e.target.value) || 0)} disabled={!inv.selected} className="w-24 px-2 py-1 border rounded text-right text-xs" step="0.01" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-between items-center mt-2 pt-2 border-t">
                    <span className="text-sm">Total: {formatCurrency(supplierInvoices.filter((i: any) => i.selected).reduce((s: number, i: any) => s + (parseFloat(i.payment_amount) || 0), 0))}</span>
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={submitPayment} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Record Payment</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Voucher Preview Modal */}
      {previewPV && (
        <div className="modal-overlay" onClick={() => setPreviewPV(null)}>
          <div className="modal-content max-w-2xl" onClick={e => e.stopPropagation()} style={{ height: '90vh' }}>
            <div className="flex justify-between items-center p-3 border-b">
              <h2 className="font-semibold">Payment Voucher Preview</h2>
              <div className="flex gap-2">
                <button onClick={() => { const t = localStorage.getItem('token'); window.open('/api/payables/vouchers/' + previewPV + '/print?token=' + t, '_blank'); }} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Print</button>
                <button onClick={() => setPreviewPV(null)} className="px-3 py-1 border rounded text-sm">Close</button>
              </div>
            </div>
            <iframe src={'/api/payables/vouchers/' + previewPV + '/print?token=' + localStorage.getItem('token')} className="w-full flex-1 border-0" style={{ height: 'calc(100% - 50px)' }} />
          </div>
        </div>
      )}
    </div>
  );
}
