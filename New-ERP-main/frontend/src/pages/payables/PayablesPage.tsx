import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Plus, Search, CheckSquare, Square } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PayablesPage() {
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [supplierInvoices, setSupplierInvoices] = useState<any[]>([]);
  const [supplierInfo, setSupplierInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState<any>({
    supplier_id: '', payment_method: 'Cash', reference_number: '',
    notes: '', bank_account_id: '',
  });

  const loadData = () => {
    api.get('/payables/vouchers').then((res) => setVouchers(res.data)).catch(() => {});
    api.get('/suppliers')
      .then((res) => {
        const list = res.data.data || res.data || [];
        setSuppliers(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { api.get('/bank-cash/accounts').then(r => setBankAccounts(r.data || [])).catch(() => {}); }, []);

  const handleSupplierChange = async (supplierId: string) => {
    setForm({ ...form, supplier_id: supplierId });
    if (!supplierId) { setSupplierInvoices([]); setSupplierInfo(null); return; }
    setLoading(true);
    try {
      const res = await api.get(`/payables/invoices/${supplierId}`);
      const invoices = (res.data.invoices || []).map((inv: any) => ({
        ...inv,
        selected: true,
        payment_amount: parseFloat(inv.balance_due) || 0,
      }));
      setSupplierInvoices(invoices);
      setSupplierInfo(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to load invoices'); }
    finally { setLoading(false); }
  };

  const toggleSelectAll = () => {
    const allSelected = supplierInvoices.every((inv: any) => inv.selected);
    setSupplierInvoices(supplierInvoices.map((inv: any) => ({
      ...inv, selected: !allSelected,
      payment_amount: !allSelected ? parseFloat(inv.balance_due) : 0,
    })));
  };

  const toggleInvoice = (index: number) => {
    const updated = [...supplierInvoices];
    updated[index] = {
      ...updated[index],
      selected: !updated[index].selected,
      payment_amount: !updated[index].selected ? parseFloat(updated[index].balance_due) : 0,
    };
    setSupplierInvoices(updated);
  };

  const updatePaymentAmount = (index: number, value: string) => {
    const amt = parseFloat(value) || 0;
    const updated = [...supplierInvoices];
    const inv = updated[index];
    updated[index] = { ...inv, payment_amount: Math.min(amt, parseFloat(inv.balance_due)) };
    setSupplierInvoices(updated);
  };

  const totalSelected = supplierInvoices.filter((i: any) => i.selected).reduce((s: number, i: any) => s + i.payment_amount, 0);
  const selectedCount = supplierInvoices.filter((i: any) => i.selected).length;

  const createPayment = async () => {
    if (!form.supplier_id) { toast.error('Select a supplier'); return; }
    if (!form.payment_method) { toast.error('Select a payment method'); return; }

    const allocations = supplierInvoices
      .filter((i: any) => i.selected && i.payment_amount > 0)
      .map((i: any) => ({ po_id: i.id, amount: i.payment_amount }));

    if (allocations.length === 0) {
      toast.error('Select at least one invoice with a payment amount');
      return;
    }

    const totalAmt = allocations.reduce((s: number, a: any) => s + a.amount, 0);
    if (totalAmt <= 0) { toast.error('Payment amount must be greater than zero'); return; }

    if (!window.confirm(`Post payment of ₱${totalAmt.toFixed(2)} for ${allocations.length} invoice(s)?`)) return;

    try {
      const payload: any = {
        supplier_id: form.supplier_id,
        payment_method: form.payment_method,
        reference_number: form.reference_number,
        notes: form.notes,
        bank_account_id: form.bank_account_id || undefined,
        allocations,
      };
      await api.post('/payables/vouchers', payload);
      toast.success('Payment recorded');
      setShowCreate(false);
      setForm({ supplier_id: '', payment_method: 'Cash', reference_number: '', notes: '', bank_account_id: '' });
      setSupplierInvoices([]);
      setSupplierInfo(null);
      loadData();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error recording payment'); }
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      Posted: 'bg-green-100 text-green-700', Void: 'bg-red-100 text-red-700',
      Draft: 'bg-gray-100 text-gray-600',
    };
    return `px-2 py-1 text-xs rounded-full ${map[s] || 'bg-gray-100 text-gray-700'}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Accounts Payable</h1>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
          <Plus size={16} /> Pay Supplier
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Voucher #</th><th>PO #</th><th>Supplier</th><th>Date</th><th>Method</th><th className="text-right">Amount</th><th>Ref</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {vouchers.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No payment vouchers yet</td></tr>
            )}
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-content max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Pay Supplier</h2>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Supplier *</label>
                  <select value={form.supplier_id} onChange={(e) => handleSupplierChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Supplier</option>
                    {suppliers.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.supplier_name} {s.balance > 0 ? `(Balance: ${formatCurrency(s.balance)})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Payment Method *</label>
                  <select value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Cash">Cash</option>
                    <option value="Check">Check</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="GCash">GCash</option>
                    <option value="Maya">Maya</option>
                  </select>
                </div>
              </div>

              {(form.payment_method === 'Check' || form.payment_method === 'Bank Transfer') && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <label className="block text-sm font-medium mb-1">Bank Account</label>
                  <select value={form.bank_account_id} onChange={(e) => setForm({ ...form, bank_account_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Account</option>
                    {bankAccounts.map((ba: any) => (
                      <option key={ba.id} value={ba.id}>{ba.bank_name} - {ba.account_name} ({ba.account_number})</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Reference Number</label>
                  <input type="text" value={form.reference_number} onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                    placeholder="Check #, Transaction ID, etc." className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Payment notes" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>

              {/* Unpaid Invoices Table */}
              {form.supplier_id && (
                <div className="border rounded-lg overflow-hidden mb-4">
                  <div className="bg-gray-50 px-4 py-2 border-b flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      {loading ? 'Loading invoices...' : `${supplierInvoices.length} unpaid invoice(s) found`}
                    </span>
                    {supplierInfo && (
                      <span className="text-xs text-gray-500">
                        Total Outstanding: <span className="font-bold text-red-600">{formatCurrency(supplierInfo.total_outstanding)}</span>
                      </span>
                    )}
                  </div>

                  {supplierInvoices.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b text-[11px] font-semibold text-gray-500 uppercase">
                            <th className="px-3 py-2 text-left w-8">
                              <button onClick={toggleSelectAll} className="text-gray-400 hover:text-blue-600">
                                {supplierInvoices.every((i: any) => i.selected) ? <CheckSquare size={16} /> : <Square size={16} />}
                              </button>
                            </th>
                            <th className="px-3 py-2 text-left">PO #</th>
                            <th className="px-3 py-2 text-left">Date</th>
                            <th className="px-3 py-2 text-left">Due Date</th>
                            <th className="px-3 py-2 text-right">Original</th>
                            <th className="px-3 py-2 text-right">Paid</th>
                            <th className="px-3 py-2 text-right">Balance</th>
                            <th className="px-3 py-2 text-right w-32">Payment Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {supplierInvoices.map((inv: any, i: number) => (
                            <tr key={inv.id} className={`hover:bg-blue-50/30 ${inv.selected ? 'bg-blue-50/20' : ''}`}>
                              <td className="px-3 py-2">
                                <button onClick={() => toggleInvoice(i)} className="text-gray-400 hover:text-blue-600">
                                  {inv.selected ? <CheckSquare size={16} /> : <Square size={16} />}
                                </button>
                              </td>
                              <td className="px-3 py-2 font-mono text-xs">{inv.invoice_number}</td>
                              <td className="px-3 py-2 text-xs">{formatDate(inv.invoice_date)}</td>
                              <td className="px-3 py-2 text-xs">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                              <td className="px-3 py-2 text-xs text-right">{formatCurrency(inv.original_amount)}</td>
                              <td className="px-3 py-2 text-xs text-right text-green-600">{formatCurrency(inv.amount_paid)}</td>
                              <td className="px-3 py-2 text-xs text-right font-medium text-red-600">{formatCurrency(inv.balance_due)}</td>
                              <td className="px-3 py-2">
                                <input type="number" step="0.01" min="0" max={inv.balance_due}
                                  value={inv.payment_amount || ''} onChange={(e) => updatePaymentAmount(i, e.target.value)}
                                  disabled={!inv.selected}
                                  className="w-full px-2 py-1 border rounded text-xs text-right focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 disabled:text-gray-400" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {!loading && supplierInvoices.length === 0 && (
                    <div className="px-4 py-6 text-center text-gray-500 text-sm">
                      No outstanding purchase invoices for this supplier.
                    </div>
                  )}
                </div>
              )}

              {/* Totals & Submit */}
              {supplierInvoices.length > 0 && (
                <div className="flex items-center justify-between bg-gray-50 rounded-lg p-4 mb-4">
                  <div className="text-sm">
                    <span className="text-gray-500">{selectedCount} invoice(s) selected</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm text-gray-500 mr-2">Total Payment:</span>
                    <span className="text-xl font-bold text-blue-700">{formatCurrency(totalSelected)}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button onClick={createPayment} disabled={selectedCount === 0 || totalSelected <= 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">Record Payment</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
