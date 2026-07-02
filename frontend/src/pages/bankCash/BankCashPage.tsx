import React, { useState, useEffect } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, formatDate, formatDateTime, parseNumericField } from '../../lib/utils';
import NumericInput from '../../components/NumericInput';
import { Plus, ArrowRightLeft, Search, Edit2, FileText, X, Landmark } from 'lucide-react';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import {
  FinancePageShell,
  FinanceModuleHeader,
  FinanceHeaderBadge,
  FinanceTabBar,
  FinanceKpiCard,
  FinanceSearchToolbar,
  FinanceDataCard,
  FinanceTableWrap,
  financeTableHeadClass,
  FinanceStatusBadge,
  FinanceSidebar,
  FinanceSidebarStat,
  FinanceQuickLinks,
  FinancePrimaryButton,
} from '../../components/finance/FinanceModuleLayout';

const CASH_VOID_BLOCKED_REF_TYPES = new Set([
  'Expense',
  'Sales Invoice',
  'Collection',
  'Petty Cash Replenish',
  'POS Shift',
]);

const canVoidCashTxn = (t: { reference_type?: string | null }) =>
  !t.reference_type || !CASH_VOID_BLOCKED_REF_TYPES.has(t.reference_type);

const voidCashConfirmMessage = (t: { reference_type?: string | null; transaction_type?: string }) => {
  if (t.reference_type === 'Bank Deposit' || t.reference_type === 'Bank Withdrawal') {
    return 'Reverse this deposit/withdrawal? The linked bank entry will also be reversed.';
  }
  if (t.reference_type === 'Bank Transfer') return 'Reverse this transfer? All linked entries will be reversed.';
  if (t.transaction_type === 'Opening') return 'Void this opening balance? The account starting balance will be cleared.';
  return 'Void this cash transaction?';
};

const voidCashButtonTitle = (t: { reference_type?: string | null; transaction_type?: string }) => {
  if (t.reference_type === 'Bank Deposit' || t.reference_type === 'Bank Withdrawal') return 'Reverse deposit/withdrawal';
  if (t.reference_type === 'Bank Transfer') return 'Reverse transfer';
  if (t.transaction_type === 'Opening') return 'Void opening balance';
  return 'Void';
};

const cashTxnSourceLabel = (t: { reference_type?: string | null; transaction_type?: string }) => {
  if (t.reference_type) return t.reference_type;
  if (t.transaction_type === 'Opening') return 'Opening balance';
  return 'Manual';
};

export default function BankCashPage() {
  const { hasPerm } = useAuth();
  const canCreate = hasPerm('finance.bank-cash.create');
  const canEdit = hasPerm('finance.bank-cash.edit');
  const readOnly = !canCreate && !canEdit;
  const [activeTab, setActiveTab] = useState('accounts');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [cashTxns, setCashTxns] = useState<any[]>([]);
  const [bankTxns, setBankTxns] = useState<any[]>([]);
  const [ctPage, setCtPage] = useState(1);
  const [ctTotal, setCtTotal] = useState(0);

  // Modals
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [showCashInModal, setShowCashInModal] = useState(false);
  const [showCashOutModal, setShowCashOutModal] = useState(false);
  const [showBankTxnModal, setShowBankTxnModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [checksOnHand, setChecksOnHand] = useState<any[]>([]);
  const [selectedChecks, setSelectedChecks] = useState<Record<string, boolean>>({});
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [showStartingBalanceModal, setShowStartingBalanceModal] = useState(false);
  const [startingBalanceForm, setStartingBalanceForm] = useState<any>({ id: '', label: '', amount: '', notes: '', entry_date: new Date().toISOString().split('T')[0] });
  const [search, setSearch] = useState('');

  // Forms
  const [accountForm, setAccountForm] = useState<any>({ account_code: '', bank_name: '', account_name: '', account_number: '', account_type: 'Savings', gl_account_code: '', pos_payment_method: '' });
  const [editForm, setEditForm] = useState<any>({});
  const [ledgerData, setLedgerData] = useState<any>(null);
  const [cashInForm, setCashInForm] = useState<any>({ amount: '', notes: '' });
  const [cashOutForm, setCashOutForm] = useState<any>({ amount: '', notes: '' });
  const [bankTxnForm, setBankTxnForm] = useState<any>({ bank_account_id: '', transaction_type: 'Deposit', amount: '', notes: '' });
  const [transferForm, setTransferForm] = useState<any>({ from_account_id: '', to_account_id: '', amount: '', notes: '', receipt_ids: [] });
  const [reconcileForm, setReconcileForm] = useState<any>({ bank_account_id: '', statement_balance: '' });
  const [reconcileResult, setReconcileResult] = useState<any>(null);
  const [reconData, setReconData] = useState<any>(null);
  const [reconLoading, setReconLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'accounts') api.get('/bank-cash/accounts').then(r => setAccounts(r.data)).catch(() => {});
    if (activeTab === 'transactions') {
      api.get(`/bank-cash/cash-transactions?page=${ctPage}&limit=20`).then(r => { setCashTxns(r.data.data || r.data || []); setCtTotal(r.data.total || 0); }).catch(() => {});
      api.get('/bank-cash/transactions').then(r => setBankTxns(r.data)).catch(() => {});
    }
  }, [activeTab, ctPage]);

  const refreshAccounts = () => api.get('/bank-cash/accounts').then(r => setAccounts(r.data));

  const refreshCashTxns = () => {
    api.get(`/bank-cash/cash-transactions?page=${ctPage}&limit=20`)
      .then(r => { setCashTxns(r.data.data || r.data || []); setCtTotal(r.data.total || 0); })
      .catch(() => {});
    api.get('/bank-cash/transactions').then(r => setBankTxns(r.data)).catch(() => {});
  };

  const saveAccount = async () => {
    try {
      await api.post('/bank-cash/accounts', accountForm);
      toast.success('Account created');
      setShowAccountModal(false);
      setAccountForm({ account_code: '', bank_name: '', account_name: '', account_number: '', account_type: 'Savings' });
      refreshAccounts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const openEdit = (a: any) => { setEditForm({ ...a }); setShowEditModal(true); };
  const saveEdit = async () => {
    try { await api.put(`/bank-cash/accounts/${editForm.id}`, editForm); toast.success('Updated'); setShowEditModal(false); refreshAccounts(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };
  const viewLedger = async (id: number) => {
    try { const r = await api.get(`/bank-cash/accounts/${id}/ledger`); setLedgerData(r.data); setShowLedgerModal(true); }
    catch { toast.error('Failed to load ledger'); }
  };

  const postCashIn = async () => {
    const amount = parseNumericField(cashInForm.amount);
    if (amount <= 0) { toast.error('Enter a valid amount'); return; }
    try { await api.post('/bank-cash/cash-in', { ...cashInForm, amount }); toast.success('Cash In recorded'); setShowCashInModal(false); refreshCashTxns(); refreshAccounts(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const postCashOut = async () => {
    const amount = parseNumericField(cashOutForm.amount);
    if (amount <= 0) { toast.error('Enter a valid amount'); return; }
    try { await api.post('/bank-cash/cash-out', { ...cashOutForm, amount }); toast.success('Cash Out recorded'); setShowCashOutModal(false); refreshCashTxns(); refreshAccounts(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const postBankTxn = async () => {
    const amount = parseNumericField(bankTxnForm.amount);
    if (amount <= 0) { toast.error('Enter a valid amount'); return; }
    try { await api.post('/bank-cash/transactions', { ...bankTxnForm, amount }); toast.success('Transaction recorded'); setShowBankTxnModal(false); refreshCashTxns(); refreshAccounts(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const loadChecks = async () => {
    try {
      const r = await api.get('/bank-cash/checks-on-hand');
      setChecksOnHand(r.data || []);
      setSelectedChecks({});
    } catch { toast.error('Failed to load checks'); }
  };

  const toggleCheck = (id: string) => {
    setSelectedChecks(prev => {
      const next = { ...prev, [id]: !prev[id] };
      const ids = Object.entries(next).filter(([_, v]) => v).map(([k]) => k);
      const total = checksOnHand.filter(ch => next[ch.id]).reduce((s, ch) => s + parseFloat(ch.amount), 0);
      setTransferForm(f => ({ ...f, receipt_ids: ids, amount: total }));
      return next;
    });
  };

  const voidCashTxn = async (t: any) => {
    if (!canVoidCashTxn(t)) return;
    if (!window.confirm(voidCashConfirmMessage(t))) return;
    try {
      const r = await api.delete(`/bank-cash/cash-transactions/${t.id}`);
      toast.success(r.data?.message || 'Cash transaction voided');
      refreshCashTxns();
      refreshAccounts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const voidBankTxn = async (t: any) => {
    const msg = t.reference_type === 'Opening Balance'
      ? 'Reverse this opening balance? The account starting balance will be cleared.'
      : 'Delete and reverse this bank transaction?';
    if (!window.confirm(msg)) return;
    try {
      await api.delete(`/bank-cash/transactions/${t.id}`);
      toast.success('Bank transaction reversed');
      refreshCashTxns();
      refreshAccounts();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const postTransfer = async () => {
    const amount = parseNumericField(transferForm.amount);
    if (amount <= 0) { toast.error('Enter a valid amount'); return; }
    try {
      const payload = { ...transferForm, amount };
      if (payload.receipt_ids && payload.receipt_ids.length === 0) delete payload.receipt_ids;
      await api.post('/bank-cash/transfers', payload);
      toast.success('Transfer complete'); setShowTransferModal(false); refreshAccounts();
      setSelectedChecks({});
    }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const doReconcile = async () => {
    const statement_balance = parseNumericField(reconcileForm.statement_balance);
    try {
      const res = await api.post('/bank-cash/reconcile', { ...reconcileForm, statement_balance });
      setReconcileResult(res.data);
      toast.success(res.data.is_reconciled ? 'Account reconciled!' : 'Difference found');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const loadReconciliation = async (accountId: string) => {
    if (!accountId) { setReconData(null); return; }
    setReconLoading(true);
    try {
      const res = await api.get(`/bank-cash/accounts/${accountId}/reconciliation`);
      setReconData(res.data);
    } catch { toast.error('Failed to load reconciliation'); }
    finally { setReconLoading(false); }
  };

  const toggleTxnCleared = async (txnId: string, cleared: boolean) => {
    try {
      await api.patch(`/bank-cash/transactions/${txnId}/clear`, { cleared });
      if (reconcileForm.bank_account_id) loadReconciliation(reconcileForm.bank_account_id);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const totalCash = accounts.reduce((s, a) => s + Number(a.computed_balance ?? a.balance ?? 0), 0);
  const activeAccountCount = accounts.filter((a) => a.is_active !== false).length;

  const filteredAccounts = accounts.filter((a) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return a.bank_name?.toLowerCase().includes(q) || a.account_name?.toLowerCase().includes(q) || a.account_code?.toLowerCase().includes(q);
  });
  const startingBalanceAccounts = accounts.filter((a) => a.starting_balance_eligible);

  const openStartingBalance = (a: any) => {
    setStartingBalanceForm({
      id: a.id,
      label: `${a.bank_name} — ${a.account_name}`,
      amount: parseFloat(a.starting_balance || 0) > 0 ? String(a.starting_balance) : '',
      notes: '',
      entry_date: new Date().toISOString().split('T')[0],
    });
    setShowStartingBalanceModal(true);
  };

  const saveStartingBalance = async () => {
    const amount = parseNumericField(startingBalanceForm.amount);
    if (amount < 0) { toast.error('Enter a valid amount'); return; }
    try {
      const res = await api.put(`/bank-cash/accounts/${startingBalanceForm.id}/starting-balance`, {
        amount,
        notes: startingBalanceForm.notes || undefined,
        entry_date: startingBalanceForm.entry_date || undefined,
      });
      toast.success(res.data.cleared ? 'Starting balance cleared' : `Starting balance saved${res.data.entry_number ? ` · ${res.data.entry_number}` : ''}`);
      setShowStartingBalanceModal(false);
      refreshAccounts();
      refreshCashTxns();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const BC_TABS = [
    { id: 'accounts', label: 'Accounts' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'reconcile', label: 'Reconcile' },
  ] as const;

  return (
    <FinancePageShell>
      <FinanceModuleHeader
        icon={Landmark}
        title="Bank & Cash"
        badges={<FinanceHeaderBadge>{formatCurrency(totalCash)}</FinanceHeaderBadge>}
        tabs={<FinanceTabBar tabs={BC_TABS} activeTab={activeTab} onTabChange={setActiveTab} />}
        actions={
          <>
            {activeTab === 'accounts' && canCreate && (
              <FinancePrimaryButton onClick={() => { setAccountForm({ account_code: '', bank_name: '', account_name: '', account_number: '', account_type: 'Savings', gl_account_code: '', pos_payment_method: '' }); setShowAccountModal(true); }}>
                <Plus size={14} /> Add Account
              </FinancePrimaryButton>
            )}
            {activeTab === 'transactions' && canCreate && (
              <div className="flex gap-1">
                <button onClick={() => { setCashInForm({ amount: '', notes: '' }); setShowCashInModal(true); }} className="px-2 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700">Cash In</button>
                <button onClick={() => { setCashOutForm({ amount: '', notes: '' }); setShowCashOutModal(true); }} className="px-2 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700">Cash Out</button>
                <button onClick={() => { setBankTxnForm({ bank_account_id: '', transaction_type: 'Deposit', amount: '', notes: '' }); setShowBankTxnModal(true); }} className="px-2 py-1.5 bg-white text-blue-900 rounded-lg text-xs font-bold hover:bg-blue-50">Deposit/WD</button>
                <button onClick={() => { setTransferForm({ from_account_id: '', to_account_id: '', amount: '', notes: '', receipt_ids: [] }); setSelectedChecks({}); setShowTransferModal(true); loadChecks(); }} className="flex items-center gap-1 px-2 py-1.5 bg-white/20 text-white rounded-lg text-xs font-bold hover:bg-white/30"><ArrowRightLeft size={12} /> Transfer</button>
              </div>
            )}
            {activeTab === 'reconcile' && canCreate && (
              <FinancePrimaryButton onClick={() => { setReconcileForm({ bank_account_id: '', statement_balance: '' }); setReconcileResult(null); setShowReconcileModal(true); }}>
                <Search size={14} /> Reconcile
              </FinancePrimaryButton>
            )}
          </>
        }
      />

      {readOnly && (
        <div className="mx-4 mt-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs">
          Read-only — you can view bank & cash but cannot create or edit transactions. Contact an administrator for edit access.
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'accounts' && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <FinanceKpiCard label="Total balance" value={formatCurrency(totalCash)} tone="blue" />
                <FinanceKpiCard label="Active accounts" value={activeAccountCount} tone="green" />
                <FinanceKpiCard label="All accounts" value={accounts.length} />
                <FinanceKpiCard label="Filtered" value={filteredAccounts.length} hint="Matching search" />
              </div>
              <FinanceSearchToolbar search={search} onSearchChange={setSearch} placeholder="Bank, account name, code…" />

              <FinanceDataCard
                title="Starting balance"
                subtitle="Set the business opening fund for Cash on Hand and bank accounts (posts Opening Balance journal entry)"
              >
                <FinanceTableWrap>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={financeTableHeadClass}>
                        <th className="py-2.5 px-4 text-left">Account</th>
                        <th className="py-2.5 px-4 text-left">Type</th>
                        <th className="py-2.5 px-4 text-right">Starting balance</th>
                        <th className="py-2.5 px-4 text-right">Current balance</th>
                        <th className="py-2.5 px-4 text-left">Set on</th>
                        <th className="py-2.5 px-4 text-right w-24">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {startingBalanceAccounts.length === 0 && (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400 italic">No eligible accounts</td></tr>
                      )}
                      {startingBalanceAccounts.map((a) => (
                        <tr key={`sb-${a.id}`} className="hover:bg-blue-50/40">
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-slate-800">{a.account_name}</div>
                            <div className="text-[11px] text-slate-500">{a.bank_name}</div>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-600">{a.account_type}</td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-blue-800">
                            {parseFloat(a.starting_balance || 0) > 0 ? formatCurrency(a.starting_balance) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                            {formatCurrency(Number(a.computed_balance ?? 0))}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                            {a.starting_balance_set_at ? formatDateTime(a.starting_balance_set_at) : 'Not set'}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => openStartingBalance(a)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-blue-800 hover:bg-blue-50"
                              >
                                <Edit2 size={12} /> Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </FinanceTableWrap>
                <div className="px-4 py-3 border-t border-slate-100 text-[11px] text-slate-500 leading-relaxed">
                  Bank starting balance credits Owner&apos;s Capital (3000) — not Cash on Hand. Edit is locked once other transactions exist on that account.
                </div>
              </FinanceDataCard>

              <FinanceDataCard title="Bank & cash accounts" subtitle="Cash on hand, bank accounts, and clearing accounts">
                <FinanceTableWrap>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className={financeTableHeadClass}>
                        <th className="py-2.5 px-4 text-left w-20">Actions</th>
                        <th className="py-2.5 px-4 text-left">Code</th>
                        <th className="py-2.5 px-4 text-left">Bank</th>
                        <th className="py-2.5 px-4 text-left">Account</th>
                        <th className="py-2.5 px-4 text-left">Number</th>
                        <th className="py-2.5 px-4 text-left">Type</th>
                        <th className="py-2.5 px-4 text-left">Control Account</th>
                        <th className="py-2.5 px-4 text-right">Balance</th>
                        <th className="py-2.5 px-4 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAccounts.map(a => (
                        <tr key={a.id} className="hover:bg-blue-50/40 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1">
                              {canEdit && (
                                <button onClick={() => openEdit(a)} className="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600" title="Edit"><Edit2 size={14} /></button>
                              )}
                              <button onClick={() => viewLedger(a.id)} className="p-1.5 hover:bg-purple-50 rounded-lg text-purple-600" title="Ledger"><FileText size={14} /></button>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-blue-700">{a.account_code || `ACC-${a.id}`}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800">{a.bank_name}</td>
                          <td className="px-4 py-2.5 text-slate-700">{a.account_name}</td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{a.account_number}</td>
                          <td className="px-4 py-2.5"><span className="px-2 py-0.5 text-[10px] rounded-full bg-slate-100 text-slate-700 ring-1 ring-slate-200">{a.account_type || 'Savings'}</span></td>
                          <td className="px-4 py-2.5 text-xs text-slate-500">Cash & Cash Equivalents</td>
                          <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">{formatCurrency(Number(a.computed_balance ?? a.balance ?? 0))}</td>
                          <td className="px-4 py-2.5 text-center"><FinanceStatusBadge status={a.is_active !== false ? 'Active' : 'Inactive'} /></td>
                        </tr>
                      ))}
                      {accounts.length > 0 && (
                        <tr className="bg-slate-50 font-bold border-t-2 border-slate-200">
                          <td colSpan={7} className="px-4 py-2.5 text-right text-slate-700">Total balance</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(totalCash)}</td>
                          <td></td>
                        </tr>
                      )}
                      {filteredAccounts.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400 italic">No accounts found</td></tr>}
                    </tbody>
                  </table>
                </FinanceTableWrap>
              </FinanceDataCard>
            </>
          )}

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <FinanceKpiCard label="Cash transactions" value={ctTotal || cashTxns.length} tone="green" hint="Current page / total" />
            <FinanceKpiCard label="Bank transactions" value={bankTxns.length} tone="blue" />
            <FinanceKpiCard label="Total balance" value={formatCurrency(totalCash)} />
            <FinanceKpiCard label="Active accounts" value={activeAccountCount} tone="green" />
          </div>
          <FinanceDataCard title="Cash transactions" subtitle="Manual cash in and cash out entries">
            <FinanceTableWrap>
              <table className="w-full text-sm">
                <thead><tr className={financeTableHeadClass}><th className="py-2.5 px-4 text-left">Ref #</th><th className="py-2.5 px-4 text-left">Type</th><th className="py-2.5 px-4 text-left">Source</th><th className="py-2.5 px-4 text-right">Amount</th><th className="py-2.5 px-4 text-left">Date</th><th className="py-2.5 px-4 text-left">Notes</th><th className="py-2.5 px-4 text-right w-16">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {cashTxns.map(t => (
                    <tr key={t.id} className="hover:bg-blue-50/40">
                      <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-blue-700">{t.transaction_number}</td>
                      <td className="px-4 py-2.5"><span className={`px-2 py-0.5 text-[10px] rounded-full ring-1 ring-inset ${t.transaction_type === 'Cash In' || t.transaction_type === 'Opening' ? 'bg-emerald-50 text-emerald-800 ring-emerald-100' : 'bg-red-50 text-red-700 ring-red-100'}`}>{t.transaction_type}</span></td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{cashTxnSourceLabel(t)}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${t.transaction_type === 'Cash In' || t.transaction_type === 'Opening' ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(t.amount)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{formatDate(t.created_at)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-500">{t.notes || '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        {canEdit && canVoidCashTxn(t) ? (
                          <button onClick={() => voidCashTxn(t)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-600" title={voidCashButtonTitle(t)}><X size={14} /></button>
                        ) : canVoidCashTxn(t) ? null : (
                          <span className="text-[10px] text-slate-400" title={`Void from ${t.reference_type}`}>Locked</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {cashTxns.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 italic">No cash transactions</td></tr>}
                </tbody>
              </table>
            </FinanceTableWrap>
            <div className="px-4 py-3 border-t border-slate-100">
              <Pagination page={ctPage} totalPages={Math.ceil(ctTotal / 20)} total={ctTotal} onPageChange={setCtPage} />
            </div>
          </FinanceDataCard>
          <FinanceDataCard title="Bank transactions" subtitle="Deposits and withdrawals by account">
            <FinanceTableWrap>
              <table className="w-full text-sm">
                <thead><tr className={financeTableHeadClass}><th className="py-2.5 px-4 text-left">Bank</th><th className="py-2.5 px-4 text-left">Account</th><th className="py-2.5 px-4 text-left">Type</th><th className="py-2.5 px-4 text-right">Amount</th><th className="py-2.5 px-4 text-left">Date</th><th className="py-2.5 px-4 text-right w-16">Actions</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {bankTxns.map(t => (
                    <tr key={t.id} className="hover:bg-blue-50/40">
                      <td className="px-4 py-2.5 text-slate-800">{t.bank_name}</td>
                      <td className="px-4 py-2.5 text-slate-700">{t.account_name}</td>
                      <td className="px-4 py-2.5"><span className={`px-2 py-0.5 text-[10px] rounded-full ring-1 ring-inset ${t.transaction_type === 'Deposit' ? 'bg-emerald-50 text-emerald-800 ring-emerald-100' : 'bg-red-50 text-red-700 ring-red-100'}`}>{t.transaction_type}</span></td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${t.transaction_type === 'Deposit' ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(t.amount)}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{formatDate(t.transaction_date)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {canEdit && (
                          <button onClick={() => voidBankTxn(t)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-600" title={t.reference_type === 'Opening Balance' ? 'Reverse opening balance' : 'Reverse'}><X size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {bankTxns.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 italic">No bank transactions</td></tr>}
                </tbody>
              </table>
            </FinanceTableWrap>
          </FinanceDataCard>
        </div>
      )}

      {/* Reconcile Tab */}
      {activeTab === 'reconcile' && (
        <div className="space-y-4">
          <FinanceDataCard title="Bank reconciliation" subtitle="Compare book balance to your bank statement">
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Bank account</label>
                <select
                  value={reconcileForm.bank_account_id}
                  onChange={(e) => {
                    const id = e.target.value;
                    setReconcileForm({ ...reconcileForm, bank_account_id: id });
                    setReconcileResult(null);
                    loadReconciliation(id);
                  }}
                  className="input-field text-sm w-full"
                >
                  <option value="">Select account...</option>
                  {accounts.filter((a) => a.account_type !== 'Cash on Hand' && a.account_type !== 'Petty Cash Fund').map((a) => (
                    <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Statement balance</label>
                <NumericInput value={reconcileForm.statement_balance} onValueChange={(statement_balance) => setReconcileForm({ ...reconcileForm, statement_balance })} step="0.01" className="input-field text-sm w-full" />
              </div>
              <div className="flex items-end">
                <button type="button" onClick={doReconcile} disabled={!reconcileForm.bank_account_id} className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">Compare</button>
              </div>
            </div>
          </FinanceDataCard>

          {reconcileResult && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FinanceKpiCard label="Book balance" value={formatCurrency(reconcileResult.book_balance)} />
              <FinanceKpiCard label="Cleared total" value={formatCurrency(reconcileResult.cleared_balance)} tone="blue" />
              <FinanceKpiCard label="Statement" value={formatCurrency(reconcileResult.statement_balance)} />
              <FinanceKpiCard label="Difference" value={formatCurrency(reconcileResult.difference)} tone={reconcileResult.is_reconciled ? 'green' : 'red'} hint={reconcileResult.is_reconciled ? 'Reconciled' : 'Out of balance'} />
            </div>
          )}

          {reconLoading ? (
            <p className="text-center text-slate-400 py-8">Loading transactions…</p>
          ) : reconData ? (
            <FinanceDataCard
              title="Uncleared transactions"
              subtitle={`${reconData.uncleared_count} uncleared · ${reconData.cleared_count} cleared · Uncleared net ${formatCurrency(reconData.uncleared_total)}`}
            >
              <FinanceTableWrap>
                <table className="w-full text-sm">
                  <thead className={financeTableHeadClass}>
                    <tr>
                      <th className="py-2.5 px-4 text-left w-10">Clr</th>
                      <th className="py-2.5 px-4 text-left">Date</th>
                      <th className="py-2.5 px-4 text-left">Type</th>
                      <th className="py-2.5 px-4 text-left">Notes</th>
                      <th className="py-2.5 px-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(reconData.transactions || []).map((t: any) => (
                      <tr key={t.id} className={`${t.is_cleared ? 'bg-emerald-50/50' : ''} hover:bg-blue-50/30`}>
                        <td className="px-4 py-2.5">
                          <input type="checkbox" checked={!!t.is_cleared} onChange={(e) => toggleTxnCleared(t.id, e.target.checked)} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">{formatDate(t.transaction_date)}</td>
                        <td className="px-4 py-2.5 text-slate-700">{t.transaction_type}</td>
                        <td className="px-4 py-2.5 text-slate-500 truncate max-w-[200px]">{t.notes || '—'}</td>
                        <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${t.transaction_type === 'Deposit' ? 'text-emerald-700' : 'text-red-700'}`}>
                          {t.transaction_type === 'Deposit' ? '+' : '-'}{formatCurrency(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </FinanceTableWrap>
            </FinanceDataCard>
          ) : (
            <p className="text-slate-400 text-center py-8">Select a bank account to mark cleared transactions.</p>
          )}
        </div>
      )}
        </div>

        <FinanceSidebar>
          <FinanceSidebarStat label="Total balance" value={formatCurrency(totalCash)} hint={`${activeAccountCount} active account(s)`} />
          <FinanceQuickLinks links={[
            { to: '/petty-cash', label: 'Petty Cash →' },
            { to: '/payables', label: 'Accounts Payable →' },
            { to: '/accounting', label: 'Accounting →' },
          ]} />
          <p className="text-[11px] text-slate-500 leading-relaxed">Use <strong>Starting balance</strong> on the Accounts tab to set opening funds for Cash on Hand and bank accounts (e.g. BOC checking).</p>
        </FinanceSidebar>
      </div>

      {/* Starting Balance Modal */}
      {showStartingBalanceModal && (
        <ModalOverlay onClose={() => setShowStartingBalanceModal(false)}>
          <div className="modal-content max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-1">Starting balance</h2>
              <p className="text-sm text-slate-500 mb-4">{startingBalanceForm.label}</p>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Opening fund amount *</label>
                  <NumericInput
                    value={startingBalanceForm.amount}
                    onValueChange={(amount) => setStartingBalanceForm({ ...startingBalanceForm, amount })}
                    step="0.01"
                    autoFocus
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Enter 0 to clear an existing starting balance (only if no other transactions).</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Effective date</label>
                  <input
                    type="date"
                    value={startingBalanceForm.entry_date}
                    onChange={(e) => setStartingBalanceForm({ ...startingBalanceForm, entry_date: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notes</label>
                  <input
                    type="text"
                    value={startingBalanceForm.notes}
                    onChange={(e) => setStartingBalanceForm({ ...startingBalanceForm, notes: e.target.value })}
                    placeholder="e.g. Business opening fund"
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowStartingBalanceModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveStartingBalance} className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm hover:bg-blue-800">Save starting balance</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Account Modal */}
      {showAccountModal && (
        <ModalOverlay onClose={() => setShowAccountModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Add Account</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account Code</label><input type="text" value={accountForm.account_code} onChange={e => setAccountForm({...accountForm, account_code: e.target.value})} placeholder="e.g. CASH-001" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Bank Name *</label><input type="text" value={accountForm.bank_name} onChange={e => setAccountForm({...accountForm, bank_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Name *</label><input type="text" value={accountForm.account_name} onChange={e => setAccountForm({...accountForm, account_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Number *</label><input type="text" value={accountForm.account_number} onChange={e => setAccountForm({...accountForm, account_number: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Type</label>
                  <select value={accountForm.account_type} onChange={e => setAccountForm({...accountForm, account_type: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Savings">Savings</option><option value="Checking">Checking</option><option value="E-Wallet">E-Wallet</option><option value="Cash on Hand">Cash on Hand</option><option value="Checks on Hand">Checks on Hand</option><option value="Petty Cash Fund">Petty Cash Fund</option><option value="Clearing">Clearing</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">GL Account Code</label><input type="text" value={accountForm.gl_account_code || ''} onChange={e => setAccountForm({...accountForm, gl_account_code: e.target.value})} placeholder="e.g. 1010" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">POS Payment Method</label>
                  <select value={accountForm.pos_payment_method || ''} onChange={e => {
                    const method = e.target.value || null;
                    const glMap: Record<string, string> = {};
                    setAccountForm({ ...accountForm, pos_payment_method: method, gl_account_code: method && glMap[method] ? glMap[method] : accountForm.gl_account_code });
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">None</option>
                    <option value="Cash">Cash</option>
                    <option value="Check">Check</option>
                  </select></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowAccountModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveAccount} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Cash In Modal */}
      {showCashInModal && (
        <ModalOverlay onClose={() => setShowCashInModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Cash In</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Amount *</label><NumericInput value={cashInForm.amount} onValueChange={(amount) => setCashInForm({ ...cashInForm, amount })} step="0.01" autoFocus className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={cashInForm.notes} onChange={e => setCashInForm({...cashInForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCashInModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={postCashIn} className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Post</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Cash Out Modal */}
      {showCashOutModal && (
        <ModalOverlay onClose={() => setShowCashOutModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Cash Out</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Amount *</label><NumericInput value={cashOutForm.amount} onValueChange={(amount) => setCashOutForm({ ...cashOutForm, amount })} step="0.01" autoFocus className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={cashOutForm.notes} onChange={e => setCashOutForm({...cashOutForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowCashOutModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={postCashOut} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Post</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Bank Transaction Modal */}
      {showBankTxnModal && (
        <ModalOverlay onClose={() => setShowBankTxnModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Deposit / Withdrawal</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account *</label>
                  <select value={bankTxnForm.bank_account_id} onChange={e => setBankTxnForm({...bankTxnForm, bank_account_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Type *</label>
                  <select value={bankTxnForm.transaction_type} onChange={e => setBankTxnForm({...bankTxnForm, transaction_type: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Deposit">Deposit</option><option value="Withdrawal">Withdrawal</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><NumericInput value={bankTxnForm.amount} onValueChange={(amount) => setBankTxnForm({ ...bankTxnForm, amount })} step="0.01" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={bankTxnForm.notes} onChange={e => setBankTxnForm({...bankTxnForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowBankTxnModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={postBankTxn} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Post</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Transfer Modal */}
      {showTransferModal && (
        <ModalOverlay onClose={() => setShowTransferModal(false)}>
          <div className={`modal-content ${transferForm.from_account_id && accounts.find(a => a.id === parseInt(transferForm.from_account_id))?.account_type === 'Checks on Hand' ? 'max-w-3xl' : 'max-w-sm'}`}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Transfer Funds</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">From Account *</label>
                  <select value={transferForm.from_account_id} onChange={e => {
                    const id = e.target.value;
                    setTransferForm({...transferForm, from_account_id: id, amount: '', receipt_ids: []});
                    setSelectedChecks({});
                    if (id && accounts.find(a => a.id === parseInt(id))?.account_type === 'Checks on Hand') loadChecks();
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">To Account *</label>
                  <select value={transferForm.to_account_id} onChange={e => setTransferForm({...transferForm, to_account_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Amount *</label><NumericInput value={transferForm.amount} onValueChange={(amount) => setTransferForm({ ...transferForm, amount })} step="0.01" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Notes</label><input type="text" value={transferForm.notes} onChange={e => setTransferForm({...transferForm, notes: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>

              {transferForm.from_account_id && accounts.find(a => a.id === parseInt(transferForm.from_account_id))?.account_type === 'Checks on Hand' && checksOnHand.length > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <h3 className="text-sm font-semibold mb-2">Select Checks to Deposit</h3>
                  <table className="data-table w-full text-xs">
                    <thead><tr><th style={{width:30}}></th><th>CR #</th><th>Customer</th><th>Check #</th><th className="text-right">Amount</th></tr></thead>
                    <tbody>
                      {checksOnHand.map((ch) => (
                        <tr key={ch.id} className="border-t">
                          <td><input type="checkbox" checked={selectedChecks[ch.id] || false} onChange={() => toggleCheck(ch.id)} /></td>
                          <td className="font-mono">{ch.receipt_number}</td>
                          <td>{ch.customer_name || '—'}</td>
                          <td>{ch.check_number || '—'}</td>
                          <td className="text-right font-bold">{formatCurrency(ch.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-500 mt-2">
                    {Object.values(selectedChecks).filter(Boolean).length} selected &middot;
                    Total: {formatCurrency(checksOnHand.filter(ch => selectedChecks[ch.id]).reduce((s, ch) => s + parseFloat(ch.amount), 0))}
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => { setShowTransferModal(false); setSelectedChecks({}); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={postTransfer} className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700">Transfer</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Reconcile Modal */}
      {showReconcileModal && (
        <ModalOverlay onClose={() => setShowReconcileModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Reconcile Account</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account *</label>
                  <select value={reconcileForm.bank_account_id} onChange={e => setReconcileForm({...reconcileForm, bank_account_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name} - {a.account_name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Statement Balance *</label><NumericInput value={reconcileForm.statement_balance} onValueChange={(statement_balance) => setReconcileForm({ ...reconcileForm, statement_balance })} step="0.01" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowReconcileModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={doReconcile} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Reconcile</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Edit Account Modal */}
      {showEditModal && (
        <ModalOverlay onClose={() => setShowEditModal(false)}>
          <div className="modal-content max-w-sm">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">Edit Account</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Account Code</label><input type="text" value={editForm.account_code || ''} onChange={e => setEditForm({...editForm, account_code: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Bank Name *</label><input type="text" value={editForm.bank_name} onChange={e => setEditForm({...editForm, bank_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Name *</label><input type="text" value={editForm.account_name} onChange={e => setEditForm({...editForm, account_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Account Number</label><input type="text" value={editForm.account_number} onChange={e => setEditForm({...editForm, account_number: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Type</label>
                  <select value={editForm.account_type} onChange={e => setEditForm({...editForm, account_type: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="Savings">Savings</option><option value="Checking">Checking</option><option value="E-Wallet">E-Wallet</option><option value="Clearing">Clearing</option><option value="Cash on Hand">Cash on Hand</option><option value="Checks on Hand">Checks on Hand</option><option value="Petty Cash Fund">Petty Cash Fund</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">GL Account Code</label><input type="text" value={editForm.gl_account_code || ''} onChange={e => setEditForm({...editForm, gl_account_code: e.target.value})} placeholder="e.g. 1000" className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">POS Payment Method</label>
                  <select value={editForm.pos_payment_method || ''} onChange={e => {
                    const method = e.target.value || null;
                    const glMap: Record<string, string> = {};
                    setEditForm({ ...editForm, pos_payment_method: method, gl_account_code: method && glMap[method] ? glMap[method] : editForm.gl_account_code });
                  }} className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">None</option>
                    <option value="Cash">Cash</option>
                    <option value="Check">Check</option>
                  </select></div>
                <div className="flex items-center gap-2"><input type="checkbox" checked={editForm.is_active !== false} onChange={e => setEditForm({...editForm, is_active: e.target.checked})} className="w-4 h-4" /><label className="text-sm">Active</label></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowEditModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={saveEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Account Ledger Modal */}
      {showLedgerModal && ledgerData && (
        <ModalOverlay onClose={() => setShowLedgerModal(false)}>
          <div className="modal-content max-w-4xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold">{ledgerData.account.bank_name} — {ledgerData.account.account_name}</h2>
                  <p className="text-xs text-gray-500">Balance: {formatCurrency(ledgerData.balance ?? ledgerData.account.balance ?? 0)}</p>
                </div>
                <button onClick={() => setShowLedgerModal(false)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table w-full">
                  <thead><tr><th>Date</th><th>Type</th><th>Source</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
                  <tbody>
                    {ledgerData.ledger.map((r: any, i: number) => (
                      <tr key={i} className="text-sm">
                        <td className="text-xs">{formatDate(r.date)}</td>
                        <td><span className={`px-1.5 py-0.5 text-xs rounded-full ${['Deposit','Cash In','Opening'].includes(r.type) ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{r.type}</span></td>
                        <td className="text-xs">{r.source_module}</td>
                        <td className="text-right text-green-600">{r.debit > 0 ? formatCurrency(r.debit) : '—'}</td>
                        <td className="text-right text-red-600">{r.credit > 0 ? formatCurrency(r.credit) : '—'}</td>
                        <td className="text-right font-mono text-xs">{formatCurrency(r.running_balance)}</td>
                      </tr>
                    ))}
                    {ledgerData.ledger.length === 0 && <tr><td colSpan={6} className="text-center py-4 text-gray-500">No transactions</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}

    </FinancePageShell>
  );
}
