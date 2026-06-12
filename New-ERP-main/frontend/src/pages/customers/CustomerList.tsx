import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { Plus, Edit2, Search, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CustomerList() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editCustomer, setEditCustomer] = useState<any>(null);
  const [form, setForm] = useState<any>({ customer_name: '', contact_person: '', address: '', phone: '', email: '', customer_type: 'Retail', credit_limit: 0, payment_terms: '', tax_type: 'VAT', tin: '' });

  useEffect(() => { api.get(`/customers?search=${search}&limit=100`).then((r) => setCustomers(r.data.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data')).finally(() => setLoading(false)); }, [search]);

  const openCreate = () => { setEditCustomer(null); setForm({ customer_name: '', contact_person: '', address: '', phone: '', email: '', customer_type: 'Retail', credit_limit: 0, payment_terms: '', tax_type: 'VAT', tin: '' }); setShowModal(true); };
  const openEdit = (c: any) => { setEditCustomer(c); setForm(c); setShowModal(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this customer?')) return;
    try { await api.delete(`/customers/${id}`); toast.success('Customer deleted'); setCustomers(customers.filter(c => c.id !== id)); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    if (!form.customer_name) { toast.error('Customer name is required'); return; }
    try {
      if (editCustomer) { await api.put(`/customers/${editCustomer.id}`, form); toast.success('Updated'); }
      else { await api.post('/customers', form); toast.success('Created'); }
      setShowModal(false);
      const res = await api.get(`/customers?limit=100`); setCustomers(res.data.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add Customer</button>
      </div>
      <div className="relative max-w-md">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Phone</th><th>Terms</th><th>Credit Limit</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="font-mono text-xs">{c.customer_code}</td>
                <td className="font-medium">{c.customer_name}</td>
                <td><span className="px-2 py-0.5 text-xs rounded bg-gray-100">{c.customer_type}</span></td>
                <td>{c.phone || '-'}</td>
                <td className="text-xs">{c.payment_terms ? `${c.payment_terms} Days` : '—'}</td>
                <td>{formatCurrency(c.credit_limit)}</td>
                <td className={c.balance > 0 ? 'text-red-600 font-medium' : ''}>{formatCurrency(c.balance)}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${c.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(c)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                      <button onClick={() => handleDelete(c.id)} className="p-1.5 hover:bg-red-50 rounded text-red-600"><Trash2 size={15} /></button>
                    </div>
                  </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editCustomer ? 'Edit Customer' : 'Add Customer'}</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="block text-sm font-medium mb-1">Customer Name *</label>
                  <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })}
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
                <div><label className="block text-sm font-medium mb-1">Customer Type</label>
                  <select value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Retail">Retail</option><option value="Wholesale">Wholesale</option><option value="LGU">LGU</option>
                    <option value="Corporate">Corporate</option><option value="Mining">Mining</option><option value="Resort">Resort</option>
                    <option value="Distributor">Distributor</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Tax Type</label>
                  <select value={form.tax_type} onChange={(e) => setForm({ ...form, tax_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="VAT">VAT 12%</option><option value="VAT Exempt">VAT Exempt</option><option value="Zero Rated">Zero Rated</option>
                    <option value="LGU 5% Final VAT">LGU 5% Final VAT</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Payment Terms (Days)</label>
                  <select value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">COD / Walk-in</option>
                    <option value="7">7 Days</option><option value="15">15 Days</option><option value="30">30 Days</option>
                    <option value="45">45 Days</option><option value="60">60 Days</option><option value="90">90 Days</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Credit Limit</label>
                  <input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: parseFloat(e.target.value) || 0 })}
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
    </div>
  );
}
