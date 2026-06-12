import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, Edit2, Search, Trash2, FileText, X } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SupplierList() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editSupplier, setEditSupplier] = useState<any>(null);
  const [form, setForm] = useState<any>({ supplier_name: '', contact_person: '', address: '', phone: '', email: '', payment_terms: '', tin: '' });
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);

  useEffect(() => { api.get(`/suppliers?search=${search}&limit=100`).then((r) => setSuppliers(r.data.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')).finally(() => setLoading(false)); }, [search]);

  const openCreate = () => { setEditSupplier(null); setForm({ supplier_name: '', contact_person: '', address: '', phone: '', email: '', payment_terms: '', tin: '' }); setShowModal(true); };
  const openEdit = (s: any) => { setEditSupplier(s); setForm(s); setShowModal(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this supplier?')) return;
    try { await api.delete(`/suppliers/${id}`); toast.success('Supplier deleted'); setSuppliers(suppliers.filter(s => s.id !== id)); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!form.supplier_name) { toast.error('Supplier name is required'); return; }
    try {
      if (editSupplier) { await api.put(`/suppliers/${editSupplier.id}`, form); toast.success('Updated'); }
      else { await api.post('/suppliers', form); toast.success('Created'); }
      setShowModal(false);
      const res = await api.get(`/suppliers?limit=100`); setSuppliers(res.data.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const viewLedger = async (supplierId: number) => {
    setLoadingLedger(true);
    try {
      const res = await api.get(`/suppliers/${supplierId}/ledger`);
      setLedgerData(res.data);
      setShowLedger(true);
    } catch { toast.error('Failed to load ledger'); }
    finally { setLoadingLedger(false); }
  };

  const viewPOs = (supplierId: number) => {
    navigate(`/purchases?supplier=${supplierId}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Suppliers</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Supplier</button>
      </div>
      <div className="relative max-w-md">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search suppliers..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Contact</th><th>Phone</th><th>POs</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="font-mono text-xs">{s.supplier_code}</td>
                <td className="font-medium">
                  <button onClick={() => viewPOs(s.id)} className="text-blue-600 hover:underline text-left">
                    {s.supplier_name}
                  </button>
                </td>
                <td>{s.contact_person || '-'}</td>
                <td>{s.phone || '-'}</td>
                <td className="text-center font-medium">{s.po_count || 0}</td>
                <td className={s.balance > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(s.balance)}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${s.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{s.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <div className="flex gap-1">
                    <button onClick={() => viewLedger(s.id)} className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="View Ledger"><FileText size={15} /></button>
                    <button onClick={() => openEdit(s)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                    <button onClick={() => handleDelete(s.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && <tr><td colSpan={8} className="text-center text-gray-500 py-6">No suppliers found</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editSupplier ? 'Edit Supplier' : 'Add Supplier'}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Supplier Name *</label>
                  <input type="text" value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Contact Person</label>
                  <input type="text" value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Phone</label>
                  <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Address</label>
                  <textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" rows={2} /></div>
                <div><label className="block text-sm font-medium mb-1">Payment Terms</label>
                  <input type="text" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">TIN</label>
                  <input type="text" value={form.tin} onChange={(e) => setForm({ ...form, tin: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Supplier Ledger Modal */}
      {showLedger && ledgerData && (
        <div className="modal-overlay" onClick={() => setShowLedger(false)}>
          <div className="modal-content max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">{ledgerData.supplier.supplier_name}</h2>
                  <p className="text-xs text-gray-500">{ledgerData.supplier.supplier_code} · Balance: {formatCurrency(ledgerData.supplier.balance)}</p>
                </div>
                <button onClick={() => setShowLedger(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead><tr><th>Date</th><th>Type</th><th>Ref #</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
                  <tbody>
                    {ledgerData.ledger.map((row: any, i: number) => (
                      <tr key={i} className="text-sm">
                        <td className="text-xs">{formatDate(row.date)}</td>
                        <td>
                          <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                            row.type === 'Purchase Order' ? 'bg-blue-50 text-blue-700' :
                            row.type === 'Goods Receipt' ? 'bg-green-50 text-green-700' :
                            row.type === 'Payment' ? 'bg-amber-50 text-amber-700' :
                            'bg-red-50 text-red-700'
                          }`}>{row.type}</span>
                        </td>
                        <td className="font-mono text-xs">{row.ref_no}</td>
                        <td className="text-right text-red-600">{row.debit > 0 ? formatCurrency(row.debit) : '—'}</td>
                        <td className="text-right text-green-600">{row.credit > 0 ? formatCurrency(row.credit) : '—'}</td>
                        <td className="text-right font-mono text-xs">{formatCurrency(row.running_balance)}</td>
                        <td className="text-xs">{row.status}</td>
                      </tr>
                    ))}
                    {ledgerData.ledger.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-gray-500">No transactions</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-right text-sm font-bold">
                Balance: <span className={ledgerData.running_balance > 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(ledgerData.running_balance)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
