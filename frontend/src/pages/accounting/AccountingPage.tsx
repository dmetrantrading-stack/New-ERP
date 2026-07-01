import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ModalOverlay from '../../components/ModalOverlay';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  BookOpen, ListTree, BookText, PieChart, Wallet, ShieldCheck,
} from 'lucide-react';
import {
  PRIMARY, FINANCE_FONT, financeTabClass,
  ACCOUNTING_SECTIONS, parseAccountingTab, sectionForTab, tabsForSection, tabDef,
  type AccountingSectionKey, type AccountingTabKey,
} from '../../lib/financeUtils';
import toast from 'react-hot-toast';
import DrillDownModal from '../../components/reports/DrillDownModal';
import JournalEntryModal from '../../components/accounting/JournalEntryModal';
import IncomeStatementTab, { type IncomeStatementSummary } from './IncomeStatementTab';
import TransactionAuditTab from './TransactionAuditTab';
import GlIntegrityTab from './GlIntegrityTab';
import ChartOfAccountsReport from '../../components/accounting/ChartOfAccountsReport';
import TrialBalanceReport from '../../components/accounting/TrialBalanceReport';
import BalanceSheetReport from '../../components/accounting/BalanceSheetReport';
import GeneralLedgerReport from '../../components/accounting/GeneralLedgerReport';
import JournalEntriesReport from '../../components/accounting/JournalEntriesReport';
import CashFlowReport from '../../components/accounting/CashFlowReport';
import FinanceAgingReport from '../../components/accounting/FinanceAgingReport';
import { useAuth } from '../../store/auth';

const SECTION_ICONS: Record<AccountingSectionKey, React.ElementType> = {
  setup: ListTree,
  ledger: BookText,
  statements: PieChart,
  receivables: Wallet,
  audit: ShieldCheck,
};

export default function AccountingPage() {
  const { hasPerm } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = parseAccountingTab(searchParams.get('tab')) || 'chart-of-accounts';
  const [activeTab, setActiveTab] = useState<AccountingTabKey>(initialTab);
  const [activeSection, setActiveSection] = useState<AccountingSectionKey>(() => sectionForTab(initialTab));

  const [accounts, setAccounts] = useState<any[]>([]);
  const [trialBalance, setTrialBalance] = useState<any[]>([]);
  const [balanceSheet, setBalanceSheet] = useState<any>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatementSummary | null>(null);
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
  const [businessName, setBusinessName] = useState('');
  const [highlightAccountCode, setHighlightAccountCode] = useState<string | null>(null);

  const loadChartOfAccounts = useCallback(async () => {
    const res = await api.get('/accounting/chart-of-accounts');
    setAccounts(Array.isArray(res.data) ? res.data : []);
  }, []);

  const clearHighlight = useCallback(() => setHighlightAccountCode(null), []);

  const sectionTabs = useMemo(() => tabsForSection(activeSection), [activeSection]);
  const activeDef = tabDef(activeTab);

  const setTab = useCallback((tab: AccountingTabKey) => {
    setActiveTab(tab);
    setActiveSection(sectionForTab(tab));
    setSearchParams({ tab }, { replace: true });
  }, [setSearchParams]);

  const setSection = useCallback((section: AccountingSectionKey) => {
    setActiveSection(section);
    const first = tabsForSection(section)[0];
    if (first) setTab(first.id);
  }, [setTab]);

  useEffect(() => {
    const fromUrl = parseAccountingTab(searchParams.get('tab'));
    if (fromUrl && fromUrl !== activeTab) {
      setActiveTab(fromUrl);
      setActiveSection(sectionForTab(fromUrl));
    }
  }, [searchParams, activeTab]);

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
    loadChartOfAccounts().catch((err) => toast.error(err.response?.data?.error || 'Failed to load chart of accounts'));
  }, [loadChartOfAccounts]);

  useEffect(() => {
    if (activeTab === 'chart-of-accounts' || activeTab === 'general-ledger') {
      loadChartOfAccounts().catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    }
    if (activeTab === 'trial-balance') fetchTrialBalance();
    if (activeTab === 'balance-sheet') fetchBalanceSheet();
    if (activeTab === 'general-ledger') fetchGeneralLedger();
    if (activeTab === 'cash-flow') fetchCashFlow();
    if (activeTab === 'ar-aging') api.get('/accounting/ar-aging').then((r) => setArAging(r.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load AR aging'));
    if (activeTab === 'ap-aging') api.get('/accounting/ap-aging').then((r) => setApAging(r.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load AP aging'));
  }, [activeTab, fetchTrialBalance, fetchBalanceSheet, loadChartOfAccounts]);

  useEffect(() => {
    if (activeTab === 'journal-entries') fetchJournalEntries();
  }, [activeTab, fetchJournalEntries]);

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
      const payload = {
        ...newAccount,
        parent_id: newAccount.parent_id ? parseInt(String(newAccount.parent_id), 10) : null,
      };
      const res = await api.post('/accounting/chart-of-accounts', payload);
      toast.success('Account created');
      setShowCreateAccount(false);
      setNewAccount({ account_code: '', account_name: '', account_type: 'Asset', parent_id: '' });
      setHighlightAccountCode(res.data?.account_code || payload.account_code);
      await loadChartOfAccounts();
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
      const res = await api.put(`/accounting/chart-of-accounts/${editAccount.id}`, editAccount);
      toast.success('Account updated');
      setShowEditAccount(false);
      setEditAccount(null);
      setHighlightAccountCode(res.data?.account_code || editAccount.account_code);
      await loadChartOfAccounts();
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
      <div className="flex-shrink-0 px-4 h-12 flex items-center gap-3 print:hidden" style={{ backgroundColor: PRIMARY }}>
        <BookOpen size={18} className="text-white/90 flex-shrink-0" />
        <h1 className="text-white font-semibold text-sm tracking-wide flex-shrink-0">Accounting</h1>
        <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 overflow-x-auto min-w-0 flex-1">
          {ACCOUNTING_SECTIONS.map((s) => {
            const Icon = SECTION_ICONS[s.key];
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                className={financeTabClass(activeSection === s.key)}
              >
                <span className="inline-flex items-center gap-1">
                  <Icon size={13} />
                  {s.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5 print:hidden">
        <div className="flex flex-wrap gap-1.5">
          {sectionTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                activeTab === t.id
                  ? 'bg-blue-700 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeDef && (
          <p className="text-[11px] text-gray-400 mt-2">
            {activeDef.label} · {ACCOUNTING_SECTIONS.find((s) => s.key === activeSection)?.label}
            {activeDef.description ? ` — ${activeDef.description}` : ''}
          </p>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {activeTab === 'chart-of-accounts' && (
        <ChartOfAccountsReport
          accounts={accounts}
          businessName={businessName}
          highlightAccountCode={highlightAccountCode}
          onHighlightCleared={clearHighlight}
          onAccountClick={setDrillDownAccount}
          onEdit={openEditAccount}
          onCreate={() => setShowCreateAccount(true)}
          canEdit={hasPerm('finance.accounting.edit')}
        />
      )}

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
        <IncomeStatementTab
          businessName={businessName}
          onSummaryChange={setIncomeStatement}
          onAccountClick={setDrillDownAccount}
        />
      )}

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

      {activeTab === 'transaction-audit' && <TransactionAuditTab />}

      {activeTab === 'gl-integrity' && (
        <GlIntegrityTab canEdit={hasPerm('finance.accounting.edit')} />
      )}

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
                <p className={`text-xl font-bold ${incomeStatement.net_income >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatCurrency(incomeStatement.net_income)}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {formatDate(incomeStatement.from)} – {formatDate(incomeStatement.to)}
                </p>
              </div>
              <div>
                <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Gross Profit</div>
                <p className="text-lg font-bold text-slate-800">{formatCurrency(incomeStatement.gross_profit)}</p>
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
        dateRange={
          activeTab === 'income-statement' && incomeStatement
            ? { from: incomeStatement.from, to: incomeStatement.to }
            : undefined
        }
      />
    )}
    </>
  );
}
