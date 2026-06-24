import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, formatDate, parseNumericField } from '../../lib/utils';
import NumericInput from '../../components/NumericInput';
import { Plus, Eye, X, Landmark } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import {
  FinancePageShell,
  FinanceModuleHeader,
  FinanceHeaderBadge,
  FinanceKpiCard,
  FinanceSearchToolbar,
  FinanceDataCard,
  FinanceTableWrap,
  financeTableHeadClass,
  FinanceStatusBadge,
  FinancePrimaryButton,
} from '../../components/finance/FinanceModuleLayout';

export default function LoansPayablePage() {
  const { hasPerm } = useAuth();
  const canCreate = hasPerm('finance.loans.create');
  const canEdit = hasPerm('finance.loans.edit');

  const [loans, setLoans] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<any>({
    lender_name: '',
    lender_type: 'Bank',
    loan_date: new Date().toISOString().split('T')[0],
    maturity_date: '',
    principal_amount: '',
    interest_rate_monthly: '',
    deposit_account_type: 'bank',
    deposit_bank_account_id: '',
    notes: '',
  });

  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showAccrue, setShowAccrue] = useState(false);
  const [accrueForm, setAccrueForm] = useState({ accrual_date: new Date().toISOString().split('T')[0], amount: '', notes: '' });
  const [interestPreview, setInterestPreview] = useState<any>(null);
  const [showPay, setShowPay] = useState(false);
  const [payForm, setPayForm] = useState({
    payment_date: new Date().toISOString().split('T')[0],
    total_amount: '',
    payment_account_type: 'bank',
    payment_bank_account_id: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  const loadLoans = () => {
    setLoading(true);
    api.get('/loans-payable')
      .then((r) => setLoans(r.data || []))
      .catch(() => toast.error('Failed to load loans'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadLoans();
    api.get('/bank-cash/accounts').then((r) => setBankAccounts(r.data || [])).catch(() => {});
  }, []);

  const filtered = loans.filter((l) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (l.lender_name || '').toLowerCase().includes(q)
      || (l.loan_number || '').toLowerCase().includes(q);
  });

  const totalOutstanding = loans
    .filter((l) => l.status === 'Active')
    .reduce((s, l) => s + parseFloat(l.total_outstanding || 0), 0);

  const activeCount = loans.filter((l) => l.status === 'Active').length;

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/loans-payable/${id}`);
      setDetail(res.data);
    } catch {
      toast.error('Failed to load loan details');
    } finally {
      setDetailLoading(false);
    }
  };

  const saveLoan = async () => {
    if (!createForm.lender_name.trim()) { toast.error('Lender name is required'); return; }
    const amount = parseNumericField(createForm.principal_amount);
    if (amount <= 0) { toast.error('Valid principal amount is required'); return; }
    if (createForm.deposit_account_type === 'bank' && !createForm.deposit_bank_account_id) {
      toast.error('Select bank account for loan deposit'); return;
    }
    setSaving(true);
    try {
      await api.post('/loans-payable', {
        ...createForm,
        principal_amount: amount,
        interest_rate_monthly: parseNumericField(createForm.interest_rate_monthly),
        deposit_bank_account_id: createForm.deposit_bank_account_id || null,
        maturity_date: createForm.maturity_date || null,
      });
      toast.success('Loan recorded');
      setShowCreate(false);
      setCreateForm({
        lender_name: '', lender_type: 'Bank',
        loan_date: new Date().toISOString().split('T')[0], maturity_date: '',
        principal_amount: '', interest_rate_monthly: '',
        deposit_account_type: 'bank', deposit_bank_account_id: '', notes: '',
      });
      loadLoans();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create loan');
    } finally {
      setSaving(false);
    }
  };

  const openAccrueModal = async () => {
    if (!detail) return;
    setAccrueForm({ accrual_date: new Date().toISOString().split('T')[0], amount: '', notes: '' });
    try {
      const res = await api.get(`/loans-payable/${detail.id}/interest-preview`);
      setInterestPreview(res.data);
      setAccrueForm((f) => ({ ...f, amount: String(res.data.suggested_interest || '') }));
    } catch {
      setInterestPreview(null);
    }
    setShowAccrue(true);
  };

  const submitAccrue = async () => {
    if (!detail) return;
    const amount = parseNumericField(accrueForm.amount);
    if (amount <= 0) { toast.error('Enter interest amount'); return; }
    setSaving(true);
    try {
      await api.post(`/loans-payable/${detail.id}/accrue-interest`, { ...accrueForm, amount });
      toast.success('Interest accrued');
      setShowAccrue(false);
      await openDetail(detail.id);
      loadLoans();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to accrue interest');
    } finally {
      setSaving(false);
    }
  };

  const openPayModal = () => {
    if (!detail) return;
    setPayForm({
      payment_date: new Date().toISOString().split('T')[0],
      total_amount: String(detail.total_outstanding || ''),
      payment_account_type: 'bank',
      payment_bank_account_id: bankAccounts[0]?.id || '',
      notes: '',
    });
    setShowPay(true);
  };

  const submitPayment = async () => {
    if (!detail) return;
    const amount = parseNumericField(payForm.total_amount);
    if (amount <= 0) { toast.error('Enter payment amount'); return; }
    if (payForm.payment_account_type === 'bank' && !payForm.payment_bank_account_id) {
      toast.error('Select bank account'); return;
    }
    setSaving(true);
    try {
      const res = await api.post(`/loans-payable/${detail.id}/payments`, {
        ...payForm,
        total_amount: amount,
        payment_bank_account_id: payForm.payment_bank_account_id || null,
      });
      toast.success(res.data.status === 'Paid Off' ? 'Loan paid off' : 'Payment recorded');
      setShowPay(false);
      await openDetail(detail.id);
      loadLoans();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Payment failed');
    } finally {
      setSaving(false);
    }
  };

  const cancelLoan = async () => {
    if (!detail || !window.confirm('Cancel this loan? This reverses the liability entry.')) return;
    setSaving(true);
    try {
      await api.put(`/loans-payable/${detail.id}/cancel`);
      toast.success('Loan cancelled');
      await openDetail(detail.id);
      loadLoans();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Cancel failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FinancePageShell>
      <FinanceModuleHeader
        icon={Landmark}
        title="Loans Payable"
        badges={
          <>
            <FinanceHeaderBadge>{activeCount} active</FinanceHeaderBadge>
            <FinanceHeaderBadge>Due: {formatCurrency(totalOutstanding)}</FinanceHeaderBadge>
          </>
        }
        actions={canCreate ? (
          <FinancePrimaryButton onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New Loan
          </FinancePrimaryButton>
        ) : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 px-4">
        <FinanceKpiCard label="Active Loans" value={activeCount} tone="blue" />
        <FinanceKpiCard label="Total Outstanding" value={formatCurrency(totalOutstanding)} tone="red" />
        <FinanceKpiCard label="All Loans" value={loans.length} />
      </div>

      <div className="px-4 mb-4">
        <FinanceSearchToolbar search={search} onSearchChange={setSearch} placeholder="Search lender or loan number…" />
      </div>

      <div className="px-4 pb-4">
      <FinanceDataCard title="All Loans">
        <FinanceTableWrap>
          <table className="w-full text-sm">
            <thead className={financeTableHeadClass}>
              <tr>
                <th className="text-left px-4 py-2">Loan #</th>
                <th className="text-left px-4 py-2">Lender</th>
                <th className="text-left px-4 py-2">Type</th>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-right px-4 py-2">Principal</th>
                <th className="text-right px-4 py-2">Interest/mo</th>
                <th className="text-right px-4 py-2">Outstanding</th>
                <th className="text-center px-4 py-2">Status</th>
                <th className="text-center px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-10 text-gray-400">No loans yet</td></tr>
              ) : filtered.map((l) => (
                <tr key={l.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{l.loan_number}</td>
                  <td className="px-4 py-2 font-medium">{l.lender_name}</td>
                  <td className="px-4 py-2 text-gray-600">{l.lender_type}</td>
                  <td className="px-4 py-2 text-gray-600">{formatDate(l.loan_date)}</td>
                  <td className="px-4 py-2 text-right">{formatCurrency(l.principal_amount)}</td>
                  <td className="px-4 py-2 text-right">{parseFloat(l.interest_rate_monthly || 0).toFixed(2)}%</td>
                  <td className="px-4 py-2 text-right font-medium text-red-700">{formatCurrency(l.total_outstanding)}</td>
                  <td className="px-4 py-2 text-center">
                    <FinanceStatusBadge status={l.status} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={() => openDetail(l.id)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600" title="View">
                      <Eye size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </FinanceTableWrap>
      </FinanceDataCard>
      </div>

      {showCreate && (
        <ModalOverlay onClose={() => setShowCreate(false)}>
          <div className="modal-content max-w-lg">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Record New Loan (Borrowed)</h2>
                <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <p className="text-xs text-gray-500 mb-4">Money you received from a bank or lender. Posts to Loans Payable (2200).</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">Lender Name *</label>
                    <input value={createForm.lender_name} onChange={(e) => setCreateForm({ ...createForm, lender_name: e.target.value })}
                      placeholder="e.g. BDO, Juan Dela Cruz" className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Lender Type</label>
                    <select value={createForm.lender_type} onChange={(e) => setCreateForm({ ...createForm, lender_type: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="Bank">Bank</option>
                      <option value="Individual">Individual</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Loan Date</label>
                    <input type="date" value={createForm.loan_date} onChange={(e) => setCreateForm({ ...createForm, loan_date: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Principal Amount *</label>
                    <NumericInput value={createForm.principal_amount} onValueChange={(v) => setCreateForm({ ...createForm, principal_amount: v })}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Interest % / Month</label>
                    <NumericInput value={createForm.interest_rate_monthly} onValueChange={(v) => setCreateForm({ ...createForm, interest_rate_monthly: v })}
                      className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="e.g. 2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Maturity Date</label>
                    <input type="date" value={createForm.maturity_date} onChange={(e) => setCreateForm({ ...createForm, maturity_date: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Deposit To</label>
                    <select value={createForm.deposit_account_type} onChange={(e) => setCreateForm({ ...createForm, deposit_account_type: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="bank">Bank Account</option>
                      <option value="cash">Cash on Hand</option>
                    </select>
                  </div>
                  {createForm.deposit_account_type === 'bank' && (
                    <div className="col-span-2">
                      <label className="block text-sm font-medium mb-1">Bank Account *</label>
                      <select value={createForm.deposit_bank_account_id} onChange={(e) => setCreateForm({ ...createForm, deposit_bank_account_id: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg text-sm">
                        <option value="">Select account</option>
                        {bankAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.account_name} ({a.bank_name || a.account_type})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">Notes</label>
                    <input value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveLoan} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Record Loan'}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {(detail || detailLoading) && (
        <ModalOverlay onClose={() => setDetail(null)}>
          <div className="modal-content max-w-2xl">
            <div className="p-6">
              {detailLoading || !detail ? (
                <p className="text-center py-8 text-gray-400">Loading…</p>
              ) : (
                <>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-lg font-semibold">{detail.loan_number} — {detail.lender_name}</h2>
                      <p className="text-sm text-gray-500">{detail.lender_type} · {formatDate(detail.loan_date)} · {parseFloat(detail.interest_rate_monthly).toFixed(2)}% / month</p>
                    </div>
                    <button onClick={() => setDetail(null)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-gray-500 uppercase">Principal Left</p>
                      <p className="font-semibold">{formatCurrency(detail.outstanding_principal)}</p>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-orange-600 uppercase">Accrued Interest</p>
                      <p className="font-semibold text-orange-700">{formatCurrency(detail.accrued_interest_balance)}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <p className="text-[10px] text-red-600 uppercase">Total Due</p>
                      <p className="font-semibold text-red-700">{formatCurrency(detail.total_outstanding)}</p>
                    </div>
                  </div>

                  {detail.status === 'Active' && canCreate && (
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button onClick={openAccrueModal} className="px-3 py-1.5 bg-orange-100 text-orange-800 rounded-lg text-sm hover:bg-orange-200">
                        Accrue Interest
                      </button>
                      <button onClick={openPayModal} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                        Record Payment
                      </button>
                      {canEdit && (detail.transactions?.length || 0) <= 1 && (
                        <button onClick={cancelLoan} disabled={saving} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">
                          Cancel Loan
                        </button>
                      )}
                    </div>
                  )}

                  <h3 className="text-sm font-semibold mb-2">Transaction History</h3>
                  <div className="max-h-56 overflow-auto border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-1.5">Date</th>
                          <th className="text-left px-3 py-1.5">Type</th>
                          <th className="text-right px-3 py-1.5">Amount</th>
                          <th className="text-left px-3 py-1.5">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.transactions || []).map((t: any) => (
                          <tr key={t.id} className="border-t">
                            <td className="px-3 py-1.5">{formatDate(t.txn_date)}</td>
                            <td className="px-3 py-1.5">{t.txn_type}</td>
                            <td className="px-3 py-1.5 text-right font-medium">{formatCurrency(t.amount)}</td>
                            <td className="px-3 py-1.5 text-gray-500">{t.notes || '—'}</td>
                          </tr>
                        ))}
                        {(detail.transactions || []).length === 0 && (
                          <tr><td colSpan={4} className="text-center py-4 text-gray-400">No transactions</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}

      {showAccrue && detail && (
        <ModalOverlay onClose={() => setShowAccrue(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-2">Accrue Monthly Interest</h2>
              {interestPreview && (
                <p className="text-xs text-gray-500 mb-3">
                  Principal {formatCurrency(interestPreview.outstanding_principal)} × {interestPreview.interest_rate_monthly}% =
                  {' '}<strong>{formatCurrency(interestPreview.suggested_interest)}</strong>
                </p>
              )}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Accrual Date</label>
                  <input type="date" value={accrueForm.accrual_date} onChange={(e) => setAccrueForm({ ...accrueForm, accrual_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Interest Amount</label>
                  <NumericInput value={accrueForm.amount} onValueChange={(v) => setAccrueForm({ ...accrueForm, amount: v })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <input value={accrueForm.notes} onChange={(e) => setAccrueForm({ ...accrueForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowAccrue(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={submitAccrue} disabled={saving} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm disabled:opacity-50">
                  {saving ? 'Saving…' : 'Accrue Interest'}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {showPay && detail && (
        <ModalOverlay onClose={() => setShowPay(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-2">Record Loan Payment</h2>
              <p className="text-xs text-gray-500 mb-3">Interest is applied first, then principal. Total due: {formatCurrency(detail.total_outstanding)}</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Payment Date</label>
                  <input type="date" value={payForm.payment_date} onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Amount</label>
                  <NumericInput value={payForm.total_amount} onValueChange={(v) => setPayForm({ ...payForm, total_amount: v })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Pay From</label>
                  <select value={payForm.payment_account_type} onChange={(e) => setPayForm({ ...payForm, payment_account_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="bank">Bank Account</option>
                    <option value="cash">Cash on Hand</option>
                  </select>
                </div>
                {payForm.payment_account_type === 'bank' && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Bank Account</label>
                    <select value={payForm.payment_bank_account_id} onChange={(e) => setPayForm({ ...payForm, payment_bank_account_id: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select account</option>
                      {bankAccounts.map((a) => (
                        <option key={a.id} value={a.id}>{a.account_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <input value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowPay(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={submitPayment} disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">
                  {saving ? 'Saving…' : 'Record Payment'}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </FinancePageShell>
  );
}
