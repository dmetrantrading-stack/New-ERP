import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, ArrowLeft, Eye, Printer, FileText } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { printDocument } from '../../lib/printDocument';

const PRIMARY = '#1E40AF';

export default function SalesMemos() {
  const { hasPerm } = useAuth();
  const [memos, setMemos] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    memo_type: 'Credit', customer_id: '', invoice_id: '', amount: '', reason: '', notes: '', memo_date: new Date().toISOString().split('T')[0],
  });
  const limit = 20;

  const load = () => {
    setLoading(true);
    api.get(`/sales/memos?page=${page}&limit=${limit}`)
      .then((r) => { setMemos(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load memos'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);

  const openCreate = () => {
    setForm({ memo_type: 'Credit', customer_id: '', invoice_id: '', amount: '', reason: '', notes: '', memo_date: new Date().toISOString().split('T')[0] });
    setCreating(true);
    api.get('/customers?limit=200').then((r) => setCustomers(r.data.data || [])).catch(() => {});
  };

  const loadInvoices = (customerId: string) => {
    if (!customerId) { setInvoices([]); return; }
    api.get(`/sales/invoices?customer_id=${customerId}&limit=50&status=Posted`)
      .then((r) => setInvoices(r.data.data || []))
      .catch(() => setInvoices([]));
  };

  const submit = async () => {
    if (!form.customer_id) { toast.error('Select customer'); return; }
    if (!form.amount || parseFloat(form.amount) <= 0) { toast.error('Enter valid amount'); return; }
    setSubmitting(true);
    try {
      await api.post('/sales/memos', { ...form, amount: parseFloat(form.amount), invoice_id: form.invoice_id || null });
      toast.success('Memo posted');
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
      const r = await api.get(`/sales/memos/${id}`);
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
        <h1 className="text-xl font-semibold mb-4">New Sales Memo</h1>
        <div className="bg-white rounded-lg border p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Type</label>
              <select className="w-full border rounded px-3 py-2 text-sm" value={form.memo_type} onChange={(e) => setForm({ ...form, memo_type: e.target.value })}>
                <option value="Credit">Credit Memo (reduce AR)</option>
                <option value="Debit">Debit Memo (increase AR)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Date</label>
              <input type="date" className="w-full border rounded px-3 py-2 text-sm" value={form.memo_date} onChange={(e) => setForm({ ...form, memo_date: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Customer</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.customer_id}
              onChange={(e) => { setForm({ ...form, customer_id: e.target.value, invoice_id: '' }); loadInvoices(e.target.value); }}>
              <option value="">Select customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.customer_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Invoice Reference (optional)</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.invoice_id} onChange={(e) => setForm({ ...form, invoice_id: e.target.value })}>
              <option value="">None</option>
              {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} — {formatCurrency(i.balance || i.total)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Amount (VAT-inclusive)</label>
            <input type="number" className="w-full border rounded px-3 py-2 text-sm" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Reason</label>
            <input className="w-full border rounded px-3 py-2 text-sm" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Notes</label>
            <textarea className="w-full border rounded px-3 py-2 text-sm" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          {hasPerm('sales.sales-invoice.create') && (
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
            <button onClick={() => printDocument(`/api/sales/memos/${viewDoc.id}/print`)} className="flex items-center gap-1 px-3 py-1.5 text-sm border rounded"><Printer size={14} /> Print</button>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-gray-500">Date</dt><dd>{formatDate(viewDoc.memo_date)}</dd></div>
            <div><dt className="text-gray-500">Customer</dt><dd>{viewDoc.customer_name}</dd></div>
            <div><dt className="text-gray-500">Amount</dt><dd className="font-semibold">{formatCurrency(viewDoc.amount)}</dd></div>
            <div><dt className="text-gray-500">Invoice</dt><dd>{viewDoc.invoice_number || '—'}</dd></div>
          </dl>
          {viewDoc.reason && <p className="mt-4 text-sm"><span className="text-gray-500">Reason:</span> {viewDoc.reason}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50">
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <FileText size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm">Sales Credit / Debit Memos</h1>
        </div>
        {hasPerm('sales.sales-invoice.create') && (
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
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>
              ) : memos.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No memos yet</td></tr>
              ) : memos.map((m) => (
                <tr key={m.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{m.memo_number}</td>
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded text-xs ${m.memo_type === 'Credit' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>{m.memo_type}</span></td>
                  <td className="px-4 py-2">{m.customer_name}</td>
                  <td className="px-4 py-2">{formatDate(m.memo_date)}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(m.amount)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => viewMemo(m.id)} className="p-1 text-gray-500 hover:text-blue-600"><Eye size={16} /></button>
                    <button onClick={() => printDocument(`/api/sales/memos/${m.id}/print`)} className="p-1 text-gray-500 hover:text-blue-600"><Printer size={16} /></button>
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
