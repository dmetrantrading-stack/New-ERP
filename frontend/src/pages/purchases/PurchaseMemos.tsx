import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, ArrowLeft, Eye, Printer, FileText } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { printDocument } from '../../lib/printDocument';

const PRIMARY = '#1E40AF';

const emptyForm = () => ({
  memo_type: 'Credit',
  supplier_id: '',
  apv_id: '',
  amount: '',
  reason: '',
  notes: '',
  memo_date: new Date().toISOString().split('T')[0],
});

export default function PurchaseMemos() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [memos, setMemos] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [outstandingApvs, setOutstandingApvs] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const limit = 20;

  const load = () => {
    setLoading(true);
    api.get(`/purchases/memos?page=${page}&limit=${limit}`)
      .then((r) => { setMemos(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load memos'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);

  useEffect(() => {
    api.get('/suppliers?limit=200').then((r) => setSuppliers(r.data.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!form.supplier_id) {
      setOutstandingApvs([]);
      return;
    }
    api.get(`/payables/apv-outstanding/${form.supplier_id}`)
      .then((r) => setOutstandingApvs(r.data || []))
      .catch(() => setOutstandingApvs([]));
  }, [form.supplier_id]);

  useEffect(() => {
    const supplierId = searchParams.get('supplier_id');
    const apvId = searchParams.get('apv_id');
    const amount = searchParams.get('amount');
    if (!supplierId && !apvId) return;

    setForm({
      ...emptyForm(),
      memo_type: 'Credit',
      supplier_id: supplierId || '',
      apv_id: apvId || '',
      amount: amount || '',
      reason: amount ? 'Supplier invoice deduction' : '',
    });
    setCreating(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const openCreate = () => {
    setForm(emptyForm());
    setCreating(true);
  };

  const selectedApv = outstandingApvs.find((a) => a.id === form.apv_id);

  const submit = async () => {
    if (!form.supplier_id) { toast.error('Select supplier'); return; }
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error('Enter valid amount'); return; }
    if (form.memo_type === 'Credit' && form.apv_id && selectedApv) {
      const due = parseFloat(selectedApv.balance_due || 0);
      if (parseFloat(form.amount) > due + 0.01) {
        toast.error(`Amount exceeds APV balance due (${formatCurrency(due)})`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount),
        apv_id: form.apv_id || undefined,
      };
      const res = await api.post('/purchases/memos', payload);
      toast.success(`Memo ${res.data.memo_number} posted${form.apv_id ? ' and applied to APV' : ''}`);
      setCreating(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create memo');
    } finally {
      setSubmitting(false);
    }
  };

  const viewMemo = async (id: string) => {
    try {
      const r = await api.get(`/purchases/memos/${id}`);
      setViewDoc(r.data);
      setViewing(true);
    } catch {
      toast.error('Failed to load memo');
    }
  };

  if (creating) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button onClick={() => setCreating(false)} className="flex items-center gap-2 text-sm text-gray-600 mb-4"><ArrowLeft size={16} /> Back</button>
        <h1 className="text-xl font-semibold mb-1">New Purchase Memo</h1>
        <p className="text-sm text-gray-500 mb-4">Use a <strong>Credit Memo</strong> when the supplier deducts from your purchase invoice (e.g. ₱100 discount).</p>
        <div className="bg-white rounded-lg border p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Type</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.memo_type}
                onChange={(e) => setForm({ ...form, memo_type: e.target.value, apv_id: e.target.value === 'Debit' ? form.apv_id : form.apv_id })}
              >
                <option value="Credit">Credit Memo (reduce AP / invoice deduction)</option>
                <option value="Debit">Debit Memo (increase AP)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Date</label>
              <input type="date" className="w-full border rounded px-3 py-2 text-sm" value={form.memo_date} onChange={(e) => setForm({ ...form, memo_date: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Supplier</label>
            <select
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.supplier_id}
              onChange={(e) => setForm({ ...form, supplier_id: e.target.value, apv_id: '' })}
            >
              <option value="">Select supplier</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
            </select>
          </div>
          {form.supplier_id && form.memo_type === 'Credit' && (
            <div>
              <label className="text-xs font-medium text-gray-600">Apply to purchase invoice (APV)</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.apv_id}
                onChange={(e) => setForm({ ...form, apv_id: e.target.value })}
              >
                <option value="">General supplier credit (not linked to one invoice)</option>
                {outstandingApvs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.apv_number} · due {formatCurrency(a.balance_due)} · {formatDate(a.apv_date)}
                  </option>
                ))}
              </select>
              {selectedApv && (
                <p className="text-xs text-gray-500 mt-1">
                  Balance due after memo: {formatCurrency(Math.max(parseFloat(selectedApv.balance_due) - (parseFloat(form.amount) || 0), 0))}
                </p>
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-gray-600">Amount (VAT-inclusive)</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="e.g. 100"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Reason</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="e.g. Invoice deduction — promo discount"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Notes (optional)</label>
            <input className="w-full border rounded px-3 py-2 text-sm" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {hasPerm('purchases.apv.create') && (
            <button onClick={submit} disabled={submitting} className="px-4 py-2 text-sm text-white rounded" style={{ backgroundColor: PRIMARY }}>
              {submitting ? 'Posting…' : 'Post Memo'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (viewing && viewDoc) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <button onClick={() => setViewing(false)} className="flex items-center gap-2 text-sm text-gray-600 mb-4"><ArrowLeft size={16} /> Back</button>
        <div className="bg-white rounded-lg border p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-xl font-semibold">{viewDoc.memo_type} Memo</h1>
              <p className="text-gray-500 text-sm">{viewDoc.memo_number}</p>
            </div>
            <button onClick={() => printDocument(`/api/purchases/memos/${viewDoc.id}/print`)} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded"><Printer size={14} /> Print</button>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-gray-500">Date</dt><dd>{formatDate(viewDoc.memo_date)}</dd></div>
            <div><dt className="text-gray-500">Supplier</dt><dd>{viewDoc.supplier_name}</dd></div>
            {viewDoc.apv_number && (
              <div><dt className="text-gray-500">Applied to APV</dt><dd className="font-mono text-blue-700">{viewDoc.apv_number}</dd></div>
            )}
            <div><dt className="text-gray-500">Amount</dt><dd className="font-semibold">{formatCurrency(viewDoc.amount)}</dd></div>
            {viewDoc.reason && (
              <div className="col-span-2"><dt className="text-gray-500">Reason</dt><dd>{viewDoc.reason}</dd></div>
            )}
          </dl>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50">
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm">Purchase Credit / Debit Memos</h1>
        </div>
        {hasPerm('purchases.apv.create') && (
          <button onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-white rounded-md" style={{ color: PRIMARY }}>
            <Plus size={14} /> New Memo
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Number</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Supplier</th>
                <th className="text-left px-4 py-2 font-medium">APV</th>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : memos.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No memos yet</td></tr>
              ) : memos.map((m) => (
                <tr key={m.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{m.memo_number}</td>
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs ${m.memo_type === 'Credit' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{m.memo_type}</span></td>
                  <td className="px-4 py-2">{m.supplier_name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-blue-700">{m.apv_number || '—'}</td>
                  <td className="px-4 py-2">{formatDate(m.memo_date)}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(m.amount)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => viewMemo(m.id)} className="p-1 text-gray-500 hover:text-blue-600"><Eye size={16} /></button>
                    <button onClick={() => printDocument(`/api/purchases/memos/${m.id}/print`)} className="p-1 text-gray-500 hover:text-blue-600"><Printer size={16} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
      </div>
    </div>
  );
}
