import React, { useState, useEffect, useCallback } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PRIMARY, FINANCE_FONT, financeTabClass, ACCOUNTING_TABS } from '../../lib/financeUtils';
import toast from 'react-hot-toast';
import DrillDownModal from '../../components/reports/DrillDownModal';
import JournalEntryModal from '../../components/accounting/JournalEntryModal';
import IncomeStatementReport, { IncomeStatementToolbar } from '../../components/accounting/IncomeStatementReport';
import ChartOfAccountsReport from '../../components/accounting/ChartOfAccountsReport';
import TrialBalanceReport from '../../components/accounting/TrialBalanceReport';
import BalanceSheetReport from '../../components/accounting/BalanceSheetReport';
import GeneralLedgerReport from '../../components/accounting/GeneralLedgerReport';
import JournalEntriesReport from '../../components/accounting/JournalEntriesReport';
import CashFlowReport from '../../components/accounting/CashFlowReport';
import FinanceAgingReport from '../../components/accounting/FinanceAgingReport';
import { useAuth } from '../../store/auth';

export default function AccountingPage() {
  const { hasPerm } = useAuth();
  const [activeTab, setActiveTab] = useState('chart-of-accounts');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [trialBalance, setTrialBalance] = useState<any[]>([]);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [incomeStatement, setIncomeStatement] = useState<any>(null);
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<any>(null);
  const [generalLedger, setGeneralLedger] = useState<any[]>([]);
  const [glAccountFilter, setGlAccountFilter] = useState('');
  const [glDateFrom, setGlDateFrom] = useState('');
  const [glDateTo, setGlDateTo] = useState('');
  const [cashFlow, setCashFlow] = useState<any>(null);
  const [cfDateFrom, setCfDateFrom] = useState('');
  const [cfDateTo, setCfDateTo] = useState('');
  const [cfLoading, setCfLoading] = useState(false);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [showEditAccount, setShowEditAccount] = useState(false);
  const [editAccount, setEditAccount] = useState<any>(null);
  const [drillDownAccount, setDrillDownAccount] = useState<any>(null);
  const [newAccount, setNewAccount] = useState({ account_code: '', account_name: '', account_type: 'Asset', parent_id: '' });
  const [jePage, setJePage] = useState(1);
  const [jeTotal, setJeTotal] = useState(0);
  const [jeFrom, setJeFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [jeTo, setJeTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [jeLoading, setJeLoading] = useState(false);
  const [tbAsOf, setTbAsOf] = useState(() => new Date().toISOString().split('T')[0]);
  const [bsAsOf, setBsAsOf] = useState(() => new Date().toISOString().split('T')[0]);
  const [tbLoading, setTbLoading] = useState(false);
  const [bsLoading, setBsLoading] = useState(false);
  const [arAging, setArAging] = useState<any>(null);
  const [apAging, setApAging] = useState<any>(null);
  const [auditReport, setAuditReport] = useState<any>(null);
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const [glIntegrity, setGlIntegrity] = useState<any>(null);
  const [glIntegrityLoading, setGlIntegrityLoading] = useState(false);
  const [glRepairingId, setGlRepairingId] = useState<string | null>(null);
  const [isFrom, setIsFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [isTo, setIsTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [businessName, setBusinessName] = useState('');

  useEffect(() => {
    api.get('/settings/business-details').then((r) => {
      if (r.data?.business_name) setBusinessName(r.data.business_name);
    }).catch(() => {});
  }, []);

  const fetchTrialBalance = useCallback(async () => {
    setTbLoading(true);
    try {
      const res = await api.get('/accounting/trial-balance', { params: { as_of: tbAsOf } });
      setTrialBalance(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load trial balance');
    } finally {
      setTbLoading(false);
    }
  }, [tbAsOf]);

  const fetchBalanceSheet = useCallback(async () => {
    setBsLoading(true);
    try {
      const res = await api.get('/accounting/balance-sheet', { params: { as_of: bsAsOf } });
      setBalanceSheet(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load balance sheet');
    } finally {
      setBsLoading(false);
    }
  }, [bsAsOf]);

  const fetchJournalEntries = useCallback(async () => {
    setJeLoading(true);
    try {
      const params: Record<string, string | number> = { page: jePage, limit: 20 };
      if (jeFrom) params.from = jeFrom;
      if (jeTo) params.to = jeTo;
      const res = await api.get('/accounting/journal-entries', { params });
      setJournalEntries(res.data.data);
      setJeTotal(res.data.total);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load journal entries');
    } finally {
      setJeLoading(false);
    }
  }, [jePage, jeFrom, jeTo]);

  useEffect(() => {
    api.get('/accounting/chart-of-accounts')
      .then((r) => setAccounts(Array.isArray(r.data) ? r.data : []))
      .catch((err) => toast.error(err.response?.data?.error || 'Failed to load chart of accounts'));
  }, []);

  useEffect(() => {
    if (activeTab === 'chart-of-accounts' || activeTab === 'general-ledger') {
      api.get('/accounting/chart-of-accounts')
        .then((r) => setAccounts(Array.isArray(r.data) ? r.data : []))
        .catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    }
    if (activeTab === 'trial-balance') fetchTrialBalance();
    if (activeTab === 'balance-sheet') fetchBalanceSheet();
    if (activeTab === 'income-statement') fetchIncomeStatement();
    if (activeTab === 'general-ledger') fetchGeneralLedger();
    if (activeTab === 'cash-flow') fetchCashFlow();
    if (activeTab === 'ar-aging') api.get('/accounting/ar-aging').then((r) => setArAging(r.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load AR aging'));
    if (activeTab === 'ap-aging') api.get('/accounting/ap-aging').then((r) => setApAging(r.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load AP aging'));
  }, [activeTab, fetchTrialBalance, fetchBalanceSheet]);

  useEffect(() => {
    if (activeTab === 'journal-entries') fetchJournalEntries();
    if (activeTab === 'gl-integrity') fetchGlIntegrity();
  }, [activeTab, fetchJournalEntries]);

  const fetchIncomeStatement = async () => {
    setIsLoading(true);
    try {
      const [reportRes, bizRes] = await Promise.all([
        api.get('/accounting/income-statement', { params: { from: isFrom, to: isTo } }),
        businessName ? Promise.resolve({ data: { business_name: businessName } }) : api.get('/settings/business-details'),
      ]);
      setIncomeStatement(reportRes.data);
      if (bizRes.data?.business_name) setBusinessName(bizRes.data.business_name);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load income statement');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTransactionAudit = async () => {
    setAuditLoading(true);
    try {
      const params: any = {};
      if (auditFrom) params.from = auditFrom;
      if (auditTo) params.to = auditTo;
      const res = await api.get('/accounting/transaction-audit', { params });
      setAuditReport(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load transaction audit');
    } finally {
      setAuditLoading(false);
    }
  };

  const fetchGlIntegrity = async () => {
    setGlIntegrityLoading(true);
    try {
      const res = await api.get('/accounting/gl-integrity/duplicate-cogs');
      setGlIntegrity(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load GL integrity check');
    } finally {
      setGlIntegrityLoading(false);
    }
  };

  const repairDuplicateCogs = async (invoiceId: string, invoiceNumber: string) => {
    if (!window.confirm(`Remove duplicate Sales Invoice COGS for ${invoiceNumber}? DR COGS will be kept.`)) return;
    setGlRepairingId(invoiceId);
    try {
      const res = await api.post(`/accounting/gl-integrity/repair-duplicate-cogs/${invoiceId}`);
      toast.success(`Repaired ${invoiceNumber}: ${res.data.removed_lines} JE lines removed`);
      fetchGlIntegrity();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Repair failed');
    } finally {
      setGlRepairingId(null);
    }
  };

  useEffect(() => {
    if (activeTab === 'transaction-audit') fetchTransactionAudit();
  }, [activeTab]);

  const fetchGeneralLedger = async () => {
    try {
      const params: any = {};
      if (glAccountFilter) params.account_id = glAccountFilter;
      if (glDateFrom) params.from = glDateFrom;
      if (glDateTo) params.to = glDateTo;
      const res = await api.get('/accounting/general-ledger', { params });
      setGeneralLedger(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load general ledger');
    }
  };

  const fetchCashFlow = async () => {
    setCfLoading(true);
    try {
      const params: any = {};
      if (cfDateFrom) params.from = cfDateFrom;
      if (cfDateTo) params.to = cfDateTo;
      const res = await api.get('/accounting/cash-flow', { params });
      setCashFlow(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load cash flow');
    } finally {
      setCfLoading(false);
    }
  };

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/accounting/chart-of-accounts', newAccount);
      toast.success('Account created');
      setShowCreateAccount(false);
      setNewAccount({ account_code: '', account_name: '', account_type: 'Asset', parent_id: '' });
      api.get('/accounting/chart-of-accounts').then((r) => setAccounts(r.data));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create account');
    }
  };

  const openEditAccount = (account: any) => {
    setEditAccount({ ...account });
    setShowEditAccount(true);
  };

  const saveEditAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editAccount) return;
    try {
      await api.put(`/accounting/chart-of-accounts/${editAccount.id}`, editAccount);
      toast.success('Account updated');
      setShowEditAccount(false);
      setEditAccount(null);
      api.get('/accounting/chart-of-accounts').then((r) => setAccounts(r.data));
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update account');
    }
  };

  const viewEntry = async (id: string) => {
    try { const res = await api.get(`/accounting/journal-entries/${id}`); setSelectedEntry(res.data); } catch (err) { toast.error(err.response?.data?.error || 'Failed to load data'); }
  };

  useEffect(() => { setJePage(1); }, [activeTab, jeFrom, jeTo]);

  return (
    <>
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-4 print:hidden" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 shrink-0">
          <BookOpen size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Accounting</h1>
        </div>
        <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 overflow-x-auto max-w-[min(100%,720px)]">
          {ACCOUNTING_TABS.map(({ id, label }) => (
            <button key={id} onClick={() => setActiveTab(id)} className={financeTabClass(activeTab === id)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Chart of Accounts */}
      {activeTab === 'chart-of-accounts' && (
        <ChartOfAccountsReport
          accounts={accounts}
          businessName={businessName}
          onAccountClick={setDrillDownAccount}
          onEdit={openEditAccount}
          onCreate={() => setShowCreateAccount(true)}
          canEdit={hasPerm('finance.accounting.edit')}
        />
      )}

      {/* Trial Balance */}
      {activeTab === 'trial-balance' && (
        <TrialBalanceReport
          data={trialBalance}
          asOf={tbAsOf}
          businessName={businessName}
          loading={tbLoading}
          onAsOfChange={setTbAsOf}
          onRefresh={fetchTrialBalance}
          onAccountClick={setDrillDownAccount}
        />
      )}

      {/* Balance Sheet */}
      {activeTab === 'balance-sheet' && !balanceSheet && bsLoading && (
        <p className="text-gray-400 text-center py-12">Loading balance sheet…</p>
      )}
      {activeTab === 'balance-sheet' && balanceSheet && (
        <BalanceSheetReport
          data={balanceSheet}
          asOf={bsAsOf}
          businessName={businessName}
          loading={bsLoading}
          onAsOfChange={setBsAsOf}
          onRefresh={fetchBalanceSheet}
          onAccountClick={setDrillDownAccount}
        />
      )}
      {activeTab === 'income-statement' && (
        <div className="space-y-4 max-w-4xl">
          <IncomeStatementToolbar
            from={isFrom}
            to={isTo}
            loading={isLoading}
            onFromChange={setIsFrom}
            onToChange={setIsTo}
            onRefresh={fetchIncomeStatement}
          />
          {incomeStatement && !isLoading ? (
            <IncomeStatementReport
              data={incomeStatement}
              businessName={businessName}
              onAccountClick={setDrillDownAccount}
            />
          ) : (
            <p className="text-gray-400 text-center py-12">{isLoading ? 'Loading income statement…' : 'Apply a date range to load the report.'}</p>
          )}
        </div>
      )}

      {/* Journal Entries */}
      {activeTab === 'journal-entries' && (
        <>
          <JournalEntriesReport
            entries={journalEntries}
            from={jeFrom}
            to={jeTo}
            businessName={businessName}
            loading={jeLoading}
            page={jePage}
            total={jeTotal}
            onFromChange={setJeFrom}
            onToChange={setJeTo}
            onRefresh={fetchJournalEntries}
            onPageChange={setJePage}
            onView={viewEntry}
          />
          {selectedEntry && (
            <JournalEntryModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
          )}
        </>
      )}

      {activeTab === 'transaction-audit' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={auditFrom} onChange={(e) => setAuditFrom(e.target.value)} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={auditTo} onChange={(e) => setAuditTo(e.target.value)} className="input-field text-sm" />
            </div>
            <button onClick={fetchTransactionAudit} disabled={auditLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {auditLoading ? 'Checking…' : 'Run Audit'}
            </button>
          </div>

          {auditReport && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: 'Documents Checked', value: auditReport.summary?.total_documents || 0 },
                  { label: 'With Journal', value: auditReport.summary?.with_journal || 0, ok: true },
                  { label: 'Missing Journal', value: auditReport.summary?.missing_journal || 0, warn: (auditReport.summary?.missing_journal || 0) > 0 },
                  { label: 'Unbalanced JEs', value: auditReport.summary?.unbalanced_entries || 0, warn: (auditReport.summary?.unbalanced_entries || 0) > 0 },
                  { label: 'Orphaned JEs', value: auditReport.summary?.orphaned_journals || 0, warn: (auditReport.summary?.orphaned_journals || 0) > 0 },
                ].map((card) => (
                  <div key={card.label} className={`rounded-lg border p-3 ${card.warn ? 'border-amber-200 bg-amber-50' : card.ok ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="text-[10px] font-semibold text-gray-500 uppercase">{card.label}</div>
                    <div className={`text-xl font-bold ${card.warn ? 'text-amber-700' : card.ok ? 'text-green-700' : 'text-gray-800'}`}>{card.value}</div>
                  </div>
                ))}
              </div>

              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 border-b text-[10px] font-semibold text-gray-400 uppercase">By Transaction Type</div>
                <table className="data-table">
                  <thead><tr><th>Document Type</th><th>JE Reference</th><th className="text-right">Total</th><th className="text-right">With JE</th><th className="text-right">Missing</th></tr></thead>
                  <tbody>
                    {(auditReport.by_type || []).map((row: any) => (
                      <tr key={row.document_type} className={row.missing_journal > 0 ? 'bg-amber-50/50' : ''}>
                        <td className="font-medium">{row.document_type}</td>
                        <td className="text-xs text-gray-500">{row.journal_reference_type}</td>
                        <td className="text-right">{row.total}</td>
                        <td className="text-right text-green-700">{row.with_journal}</td>
                        <td className={`text-right font-semibold ${row.missing_journal > 0 ? 'text-amber-700' : 'text-gray-400'}`}>{row.missing_journal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(auditReport.by_type || []).some((r: any) => r.missing?.length > 0) && (
                <div className="bg-white rounded-lg border border-amber-200 overflow-hidden">
                  <div className="px-3 py-2 border-b border-amber-100 text-[10px] font-semibold text-amber-700 uppercase">Missing Journal Entries (sample)</div>
                  {(auditReport.by_type || []).filter((r: any) => r.missing?.length > 0).map((row: any) => (
                    <div key={row.document_type} className="border-b border-gray-100 last:border-0 p-3">
                      <div className="text-xs font-semibold text-gray-700 mb-2">{row.document_type}</div>
                      <div className="space-y-1">
                        {row.missing.map((m: any) => (
                          <div key={m.id} className="flex justify-between text-xs text-gray-600">
                            <span className="font-mono">{m.document_number || m.id?.substring(0, 8)}</span>
                            <span>{m.document_date ? formatDate(m.document_date) : '—'}</span>
                            <span>{formatCurrency(m.amount || 0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {auditReport.notes?.length > 0 && (
                <div className="text-xs text-gray-500 space-y-1 bg-blue-50 border border-blue-100 rounded-lg p-3">
                  {auditReport.notes.map((n: string) => <p key={n}>• {n}</p>)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'gl-integrity' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">Duplicate COGS Check</div>
              <p className="text-xs text-gray-500 mt-0.5">
                Finds invoices where Delivery Receipt and Sales Invoice both posted COGS (double-counted).
              </p>
            </div>
            <button onClick={fetchGlIntegrity} disabled={glIntegrityLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
              {glIntegrityLoading ? 'Checking…' : 'Refresh'}
            </button>
          </div>

          {glIntegrity && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className={`rounded-lg border p-3 ${glIntegrity.issue_count > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
                  <div className="text-[10px] font-semibold text-gray-500 uppercase">Issues Found</div>
                  <div className={`text-xl font-bold ${glIntegrity.issue_count > 0 ? 'text-amber-700' : 'text-green-700'}`}>{glIntegrity.issue_count}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="text-[10px] font-semibold text-gray-500 uppercase">Est. Duplicate COGS</div>
                  <div className="text-xl font-bold text-gray-800">{formatCurrency(glIntegrity.total_duplicate_cogs || 0)}</div>
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 border-b text-[10px] font-semibold text-gray-400 uppercase">Duplicate COGS Invoices</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>DR #</th>
                      <th className="text-right">DR COGS</th>
                      <th className="text-right">SI COGS</th>
                      <th className="text-right">Duplicate</th>
                      {hasPerm('finance.accounting.edit') && <th className="text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(glIntegrity.rows || []).length === 0 && (
                      <tr><td colSpan={hasPerm('finance.accounting.edit') ? 6 : 5} className="text-center text-gray-400 py-8">No duplicate COGS detected</td></tr>
                    )}
                    {(glIntegrity.rows || []).map((row: any) => (
                      <tr key={row.invoice_id} className="bg-amber-50/40">
                        <td className="font-mono text-xs">{row.invoice_number}</td>
                        <td className="font-mono text-xs">{row.dr_number || '—'}</td>
                        <td className="text-right">{formatCurrency(row.dr_cogs)}</td>
                        <td className="text-right">{formatCurrency(row.si_cogs)}</td>
                        <td className="text-right font-semibold text-amber-700">{formatCurrency(row.duplicate_amount)}</td>
                        {hasPerm('finance.accounting.edit') && (
                          <td className="text-right">
                            <button
                              type="button"
                              onClick={() => repairDuplicateCogs(row.invoice_id, row.invoice_number)}
                              disabled={glRepairingId === row.invoice_id}
                              className="text-xs text-blue-700 hover:text-blue-900 font-medium disabled:opacity-50"
                            >
                              {glRepairingId === row.invoice_id ? 'Repairing…' : 'Repair'}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* General Ledger */}
      {activeTab === 'general-ledger' && (
        <GeneralLedgerReport
          lines={generalLedger}
          accounts={accounts}
          from={glDateFrom}
          to={glDateTo}
          accountFilter={glAccountFilter}
          businessName={businessName}
          onFromChange={setGlDateFrom}
          onToChange={setGlDateTo}
          onAccountFilterChange={setGlAccountFilter}
          onRefresh={fetchGeneralLedger}
        />
      )}

      {/* Cash Flow */}
      {activeTab === 'cash-flow' && (
        <CashFlowReport
          data={cashFlow || { cash_inflows: 0, cash_outflows: 0, bank_inflows: 0, bank_outflows: 0, net_cash_flow: 0, net_bank_flow: 0, total_net_flow: 0 }}
          from={cfDateFrom}
          to={cfDateTo}
          businessName={businessName}
          loading={cfLoading}
          onFromChange={setCfDateFrom}
          onToChange={setCfDateTo}
          onRefresh={fetchCashFlow}
        />
      )}

      {activeTab === 'ar-aging' && (
        arAging ? (
          <FinanceAgingReport data={arAging} kind="ar" businessName={businessName} />
        ) : (
          <p className="text-slate-400 text-center py-12">Loading AR aging…</p>
        )
      )}

      {activeTab === 'ap-aging' && (
        apAging ? (
          <FinanceAgingReport data={apAging} kind="ap" businessName={businessName} />
        ) : (
          <p className="text-slate-400 text-center py-12">Loading AP aging…</p>
        )
      )}
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto print:hidden">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Accounts</div>
            <p className="text-2xl font-bold text-blue-900">{accounts.length}</p>
            <p className="text-xs text-gray-500 mt-1">Chart of accounts loaded</p>
          </div>
          {incomeStatement && activeTab === 'income-statement' && (
            <>
              <div>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Net Income</div>
                <p className={`text-xl font-bold ${incomeStatement.net_income >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(incomeStatement.net_income)}</p>
                <p className="text-[11px] text-gray-500 mt-1">Margin {(incomeStatement.net_margin_pct ?? 0).toFixed(1)}%</p>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Gross Profit</div>
                <p className="text-lg font-bold text-slate-800">{formatCurrency(incomeStatement.gross_profit)}</p>
                <p className="text-[11px] text-gray-500 mt-1">Margin {(incomeStatement.gross_margin_pct ?? 0).toFixed(1)}%</p>
              </div>
            </>
          )}
          {apAging && activeTab === 'ap-aging' && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">AP Outstanding</div>
              <p className="text-xl font-bold text-red-700">{formatCurrency(apAging.total_outstanding)}</p>
            </div>
          )}
          {arAging && activeTab === 'ar-aging' && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">AR Outstanding</div>
              <p className="text-xl font-bold text-green-700">{formatCurrency(arAging.total_outstanding)}</p>
            </div>
          )}
          {trialBalance.length > 0 && activeTab === 'trial-balance' && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Trial balance</div>
              <p className="text-lg font-bold text-slate-800">{trialBalance.length} accounts</p>
              <p className="text-[11px] text-gray-500 mt-1">As of {formatDate(tbAsOf)}</p>
            </div>
          )}
          {journalEntries.length > 0 && activeTab === 'journal-entries' && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Journal entries</div>
              <p className="text-lg font-bold text-slate-800">{jeTotal} total</p>
              <p className="text-[11px] text-gray-500 mt-1">{jeFrom && jeTo ? `${formatDate(jeFrom)} – ${formatDate(jeTo)}` : 'All dates'}</p>
            </div>
          )}
          {balanceSheet && activeTab === 'balance-sheet' && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Total Assets</div>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(balanceSheet.total_assets)}</p>
            </div>
          )}
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800 leading-relaxed space-y-2">
            <p>Journal entries are auto-posted from sales, purchases, expenses, and bank transactions.</p>
            <Link to="/payables" className="block text-blue-700 hover:underline">Accounts Payable →</Link>
            <Link to="/collections" className="block text-blue-700 hover:underline">Collections & AR →</Link>
          </div>
        </div>
      </div>
    </div>

          {showCreateAccount && (
            <ModalOverlay onClose={() => setShowCreateAccount(false)}>
              <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
                <h2 className="text-lg font-semibold mb-4">Create Account</h2>
                <form onSubmit={createAccount} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Code</label>
                    <input type="text" required value={newAccount.account_code} onChange={(e) => setNewAccount({ ...newAccount, account_code: e.target.value })}
                      className="input-field" placeholder="e.g. 1010" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                    <input type="text" required value={newAccount.account_name} onChange={(e) => setNewAccount({ ...newAccount, account_name: e.target.value })}
                      className="input-field" placeholder="e.g. Cash on Hand" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Type</label>
                    <select value={newAccount.account_type} onChange={(e) => setNewAccount({ ...newAccount, account_type: e.target.value })}
                      className="input-field">
                      <option value="Asset">Asset</option>
                      <option value="Liability">Liability</option>
                      <option value="Equity">Equity</option>
                      <option value="Income">Income</option>
                      <option value="Expense">Expense</option>
                      <option value="Cost of Goods Sold">Cost of Goods Sold</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Parent Account (optional)</label>
                    <select value={newAccount.parent_id} onChange={(e) => setNewAccount({ ...newAccount, parent_id: e.target.value })}
                      className="input-field">
                      <option value="">None</option>
                      {accounts.filter((a) => a.account_type === newAccount.account_type).map((a) => (
                        <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowCreateAccount(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Create</button>
                  </div>
                </form>
              </div>
            </ModalOverlay>
          )}
          {showEditAccount && editAccount && (
            <ModalOverlay onClose={() => setShowEditAccount(false)}>
              <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl">
                <h2 className="text-lg font-semibold mb-4">Edit Account</h2>
                <form onSubmit={saveEditAccount} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Code</label>
                    <input type="text" required value={editAccount.account_code} onChange={(e) => setEditAccount({ ...editAccount, account_code: e.target.value })}
                      className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Name</label>
                    <input type="text" required value={editAccount.account_name} onChange={(e) => setEditAccount({ ...editAccount, account_name: e.target.value })}
                      className="input-field" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Account Type</label>
                    <select value={editAccount.account_type} onChange={(e) => setEditAccount({ ...editAccount, account_type: e.target.value })}
                      className="input-field">
                      <option value="Asset">Asset</option><option value="Liability">Liability</option><option value="Equity">Equity</option><option value="Income">Income</option><option value="Expense">Expense</option><option value="Cost of Goods Sold">Cost of Goods Sold</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Parent Account</label>
                    <select value={editAccount.parent_id || ''} onChange={(e) => setEditAccount({ ...editAccount, parent_id: e.target.value || null })}
                      className="input-field">
                      <option value="">None</option>
                      {accounts.filter((a) => a.id !== editAccount.id && a.account_type === editAccount.account_type).map((a) => (
                        <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={editAccount.is_active} onChange={(e) => setEditAccount({ ...editAccount, is_active: e.target.checked })}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                    <label className="text-sm text-gray-700">Active</label>
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowEditAccount(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
                  </div>
                </form>
              </div>
            </ModalOverlay>
          )}
    {drillDownAccount && (
      <DrillDownModal
        account={drillDownAccount}
        onClose={() => setDrillDownAccount(null)}
        dateRange={activeTab === 'income-statement' ? { from: isFrom, to: isTo } : undefined}
      />
    )}
    </>
  );
}
