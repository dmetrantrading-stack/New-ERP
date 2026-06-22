import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, ArrowLeft, Eye, Printer, FileCheck } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { printDocument } from '../../lib/printDocument';

const PRIMARY = '#1E40AF';

export default function Bir2307Panel() {
  const { hasPerm } = useAuth();
  const [certs, setCerts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [viewDoc, setViewDoc] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    supplier_id: '', payee_name: '', payee_tin: '',
    period_from: '', period_to: '', income_payment: '', tax_withheld: '', atc_code: '', notes: '',
  });
  const limit = 20;

  const load = () => {
    setLoading(true);
    api.get(`/payables/bir-2307?page=${page}&limit=${limit}`)
      .then((r) => { setCerts(r.data.data || []); setTotal(r.data.total || 0); })
      .catch(() => toast.error('Failed to load certificates'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);

  const openCreate = () => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    setForm({ supplier_id: '', payee_name: '', payee_tin: '', period_from: first, period_to: last, income_payment: '', tax_withheld: '', atc_code: 'WI010', notes: '' });
    setCreating(true);
    api.get('/suppliers?limit=200').then((r) => setSuppliers(r.data.data || [])).catch(() => {});
  };

  const onSupplierChange = (id: string) => {
    const s = suppliers.find((x) => String(x.id) === id);
    setForm((f) => ({ ...f, supplier_id: id, payee_name: s?.supplier_name || f.payee_name, payee_tin: s?.tin || f.payee_tin }));
  };

  const submit = async () => {
    if (!form.payee_name) { toast.error('Payee name required'); return; }
    if (!form.period_from || !form.period_to) { toast.error('Period dates required'); return; }
    setSubmitting(true);
    try {
      await api.post('/payables/bir-2307', {
        ...form,
        supplier_id: form.supplier_id || null,
        income_payment: parseFloat(form.income_payment) || 0,
        tax_withheld: parseFloat(form.tax_withheld) || 0,
      });
      toast.success('Certificate created');
      setCreating(false);
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create certificate');
    } finally {
      setSubmitting(false);
    }
  };

  if (creating) {
    return (
      <div className="p-4 max-w-2xl">
        <button onClick={() => setCreating(false)} className="flex items-center gap-2 text-sm text-gray-600 mb-4"><ArrowLeft size={16} /> Back</button>
        <h2 className="text-lg font-semibold mb-4">New BIR Form 2307</h2>
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-600">Supplier (optional)</label>
            <select className="w-full border rounded px-3 py-2 text-sm" value={form.supplier_id} onChange={(e) => onSupplierChange(e.target.value)}>
              <option value="">Manual payee</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Payee Name</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.payee_name} onChange={(e) => setForm({ ...form, payee_name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">Payee TIN</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.payee_tin} onChange={(e) => setForm({ ...form, payee_tin: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Period From</label>
              <input type="date" className="w-full border rounded px-3 py-2 text-sm" value={form.period_from} onChange={(e) => setForm({ ...form, period_from: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">Period To</label>
              <input type="date" className="w-full border rounded px-3 py-2 text-sm" value={form.period_to} onChange={(e) => setForm({ ...form, period_to: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-600">Income Payment</label>
              <input type="number" className="w-full border rounded px-3 py-2 text-sm" value={form.income_payment} onChange={(e) => setForm({ ...form, income_payment: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">Tax Withheld</label>
              <input type="number" className="w-full border rounded px-3 py-2 text-sm" value={form.tax_withheld} onChange={(e) => setForm({ ...form, tax_withheld: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-gray-600">ATC Code</label>
              <input className="w-full border rounded px-3 py-2 text-sm" value={form.atc_code} onChange={(e) => setForm({ ...form, atc_code: e.target.value })} />
            </div>
          </div>
          {hasPerm('purchases.payment-voucher.create') && (
            <button onClick={submit} disabled={submitting} className="px-4 py-2 text-sm text-white rounded" style={{ backgroundColor: PRIMARY }}>
              {submitting ? 'Saving…' : 'Save Certificate'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (viewing && viewDoc) {
    return (
      <div className="p-4 max-w-xl">
        <button onClick={() => setViewing(false)} className="flex items-center gap-2 text-sm text-gray-600 mb-4"><ArrowLeft size={16} /> Back</button>
        <div className="bg-white rounded-lg border p-4">
          <div className="flex justify-between mb-3">
            <div>
              <h2 className="font-semibold">{viewDoc.certificate_number}</h2>
              <p className="text-sm text-gray-500">{viewDoc.payee_name}</p>
            </div>
            <button onClick={() => printDocument(`/api/payables/bir-2307/${viewDoc.id}/print`)} className="flex items-center gap-1 px-3 py-1 text-sm border rounded"><Printer size={14} /> Print</button>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div><dt className="text-gray-500">Period</dt><dd>{formatDate(viewDoc.period_from)} – {formatDate(viewDoc.period_to)}</dd></div>
            <div><dt className="text-gray-500">ATC</dt><dd>{viewDoc.atc_code || '—'}</dd></div>
            <div><dt className="text-gray-500">Income</dt><dd>{formatCurrency(viewDoc.income_payment)}</dd></div>
            <div><dt className="text-gray-500">WHT</dt><dd className="font-semibold">{formatCurrency(viewDoc.tax_withheld)}</dd></div>
          </dl>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <FileCheck size={16} className="text-blue-700" />
          <h2 className="font-semibold text-sm">BIR Form 2307 Certificates</h2>
        </div>
        {hasPerm('purchases.payment-voucher.create') && (
          <button onClick={openCreate} className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white rounded" style={{ backgroundColor: PRIMARY }}>
            <Plus size={14} /> New 2307
          </button>
        )}
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-3 py-2">Certificate #</th>
              <th className="text-left px-3 py-2">Payee</th>
              <th className="text-left px-3 py-2">Period</th>
              <th className="text-right px-3 py-2">WHT</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">Loading…</td></tr>
            ) : certs.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No certificates</td></tr>
            ) : certs.map((c) => (
              <tr key={c.id} className="border-b hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">{c.certificate_number}</td>
                <td className="px-3 py-2">{c.payee_name}</td>
                <td className="px-3 py-2 text-xs">{formatDate(c.period_from)} – {formatDate(c.period_to)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(c.tax_withheld)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={async () => { const r = await api.get(`/payables/bir-2307/${c.id}`); setViewDoc(r.data); setViewing(true); }} className="p-1 text-gray-500 hover:text-blue-600"><Eye size={15} /></button>
                  <button onClick={() => printDocument(`/api/payables/bir-2307/${c.id}/print`)} className="p-1 text-gray-500 hover:text-blue-600"><Printer size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={Math.ceil(total / limit)} total={total} onPageChange={setPage} />
    </div>
  );
}
