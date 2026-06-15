import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import Pagination from '../../components/Pagination';
import toast from 'react-hot-toast';
import DrillDownModal from '../../components/reports/DrillDownModal';

export default function AccountingPage() {
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
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [drillDownAccount, setDrillDownAccount] = useState<any>(null);
  const [newAccount, setNewAccount] = useState({ account_code: '', account_name: '', account_type: 'Asset', parent_id: '' });
  const [jePage, setJePage] = useState(1);
  const [jeTotal, setJeTotal] = useState(0);

  useEffect(() => {
    if (activeTab === 'chart-of-accounts') api.get('/accounting/chart-of-accounts').then((r) => setAccounts(r.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    if (activeTab === 'trial-balance') api.get('/accounting/trial-balance').then((r) => setTrialBalance(r.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    if (activeTab === 'balance-sheet') api.get('/accounting/balance-sheet').then((r) => setBalanceSheet(r.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    if (activeTab === 'income-statement') api.get('/accounting/income-statement').then((r) => setIncomeStatement(r.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    if (activeTab === 'general-ledger') fetchGeneralLedger();
    if (activeTab === 'cash-flow') fetchCashFlow();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'journal-entries') api.get(`/accounting/journal-entries?page=${jePage}&limit=20`).then((r) => { setJournalEntries(r.data.data); setJeTotal(r.data.total); }).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  }, [activeTab, jePage]);

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
    try {
      const params: any = {};
      if (cfDateFrom) params.from = cfDateFrom;
      if (cfDateTo) params.to = cfDateTo;
      const res = await api.get('/accounting/cash-flow', { params });
      setCashFlow(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load cash flow');
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

  const viewEntry = async (id: string) => {
    try { const res = await api.get(`/accounting/journal-entries/${id}`); setSelectedEntry(res.data); } catch (err) { toast.error(err.response?.data?.error || 'Failed to load data'); }
  };

  useEffect(() => { setJePage(1); }, [activeTab]);
  const tabs = ['chart-of-accounts', 'journal-entries', 'general-ledger', 'trial-balance', 'balance-sheet', 'income-statement', 'cash-flow'];

  return (
    <>
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Accounting</h1>

      <div className="flex gap-2 overflow-x-auto pb-2">
        {tabs.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 hover:bg-gray-50'}`}>
            {tab.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
          </button>
        ))}
      </div>

      {/* Chart of Accounts */}
      {activeTab === 'chart-of-accounts' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowCreateAccount(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Create Account</button>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="data-table">
              <thead><tr><th>Code</th><th>Account Name</th><th>Type</th><th>Balance</th></tr></thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="font-mono text-xs">{a.account_code}</td>
                    <td className="font-medium">{a.account_name}</td>
                    <td><span className="px-2 py-0.5 text-xs rounded bg-gray-100">{a.account_type}</span></td>
                    <td className={a.balance < 0 ? 'text-red-600' : ''}>{formatCurrency(a.balance || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {showCreateAccount && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowCreateAccount(false)}>
              <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
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
            </div>
          )}
        </div>
      )}

      {/* Trial Balance */}
      {activeTab === 'trial-balance' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Debit</th><th>Credit</th></tr></thead>
            <tbody>
              {trialBalance.map((item: any) => (
                <tr key={item.id} onClick={() => setDrillDownAccount(item)} className="cursor-pointer hover:bg-blue-50 transition-colors">
                  <td className="font-mono text-xs">{item.account_code}</td>
                  <td>{item.account_name}</td>
                  <td><span className="px-2 py-0.5 text-xs rounded bg-gray-100">{item.account_type}</span></td>
                  <td>{formatCurrency(item.total_debit)}</td>
                  <td>{formatCurrency(item.total_credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td colSpan={3} className="text-right px-4 py-3">Total</td>
                <td className="px-4 py-3">{formatCurrency(trialBalance.reduce((s: number, i: any) => s + parseFloat(i.total_debit), 0))}</td>
                <td className="px-4 py-3">{formatCurrency(trialBalance.reduce((s: number, i: any) => s + parseFloat(i.total_credit), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Balance Sheet */}
      {activeTab === 'balance-sheet' && balanceSheet && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-green-700 mb-3">Assets</h3>
            {balanceSheet.assets?.map((a: any) => (
              <div key={a.id} onClick={() => setDrillDownAccount(a)} className="flex justify-between py-1.5 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 transition-colors"><span>{a.account_name}</span><span className="font-medium">{formatCurrency(a.balance)}</span></div>
            ))}
            <div className="border-t mt-2 pt-2 flex justify-between font-bold"><span>Total Assets</span><span>{formatCurrency(balanceSheet.total_assets)}</span></div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-blue-700 mb-3">Liabilities</h3>
            {balanceSheet.liabilities?.map((a: any) => (
              <div key={a.id} onClick={() => setDrillDownAccount(a)} className="flex justify-between py-1.5 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 transition-colors"><span>{a.account_name}</span><span className="font-medium">{formatCurrency(a.balance)}</span></div>
            ))}
            <div className="border-t mt-2 pt-2 flex justify-between font-bold"><span>Total Liabilities</span><span>{formatCurrency(balanceSheet.total_liabilities)}</span></div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-purple-700 mb-3">Equity</h3>
            {balanceSheet.equity?.map((a: any) => (
              <div key={a.id} onClick={() => setDrillDownAccount(a)} className="flex justify-between py-1.5 text-sm cursor-pointer hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 transition-colors"><span>{a.account_name}</span><span className="font-medium">{formatCurrency(a.balance)}</span></div>
            ))}
            <div className="border-t mt-2 pt-2 flex justify-between font-bold"><span>Total Equity</span><span>{formatCurrency(balanceSheet.total_equity)}</span></div>
          </div>
        </div>
      )}

      {/* Income Statement */}
      {activeTab === 'income-statement' && incomeStatement && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="font-semibold text-lg mb-4">Income Statement</h3>
            <div className="space-y-3">
              <div><h4 className="font-medium text-green-600 mb-2">Income</h4>
                {incomeStatement.income?.map((i: any) => (
                  <div key={i.id} onClick={() => setDrillDownAccount(i)} className="flex justify-between text-sm py-1 cursor-pointer hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 transition-colors"><span>{i.account_name}</span><span className="font-medium">{formatCurrency(i.balance)}</span></div>
                ))}
                <div className="flex justify-between font-bold border-t pt-2"><span>Total Income</span><span>{formatCurrency(incomeStatement.total_income)}</span></div>
              </div>
              <div><h4 className="font-medium text-orange-600 mb-2">Cost of Goods Sold</h4>
                {incomeStatement.cost_of_goods_sold?.map((c: any) => (
                  <div key={c.id} onClick={() => setDrillDownAccount(c)} className="flex justify-between text-sm py-1 cursor-pointer hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 transition-colors"><span>{c.account_name}</span><span className="font-medium">{formatCurrency(c.balance)}</span></div>
                ))}
                <div className="flex justify-between font-bold border-t pt-2"><span>Total COGS</span><span>{formatCurrency(incomeStatement.total_cogs)}</span></div>
              </div>
              <div className="flex justify-between font-bold text-lg border-t-2 pt-2"><span>Gross Profit</span><span>{formatCurrency(incomeStatement.gross_profit)}</span></div>
              <div><h4 className="font-medium text-red-600 mb-2">Expenses</h4>
                {incomeStatement.expenses?.map((e: any) => (
                  <div key={e.id} onClick={() => setDrillDownAccount(e)} className="flex justify-between text-sm py-1 cursor-pointer hover:bg-blue-50 hover:text-blue-700 rounded px-1 -mx-1 transition-colors"><span>{e.account_name}</span><span className="font-medium">{formatCurrency(e.balance)}</span></div>
                ))}
                <div className="flex justify-between font-bold border-t pt-2"><span>Total Expenses</span><span>{formatCurrency(incomeStatement.total_expenses)}</span></div>
              </div>
              <div className="flex justify-between font-bold text-xl border-t-2 pt-3"><span>Net Income</span><span className={incomeStatement.net_income >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(incomeStatement.net_income)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Journal Entries */}
      {activeTab === 'journal-entries' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="data-table">
              <thead><tr><th>Entry #</th><th>Date</th><th>Description</th><th>Debit</th><th>Credit</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {journalEntries.map((je: any) => (
                  <tr key={je.id}>
                    <td className="font-mono text-xs">{je.entry_number}</td>
                    <td className="text-xs">{new Date(je.entry_date).toLocaleDateString()}</td>
                    <td>{je.description}</td>
                    <td>{formatCurrency(je.total_debit)}</td>
                    <td>{formatCurrency(je.total_credit)}</td>
                    <td><span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-700">{je.status}</span></td>
                    <td><button onClick={() => viewEntry(je.id)} className="text-blue-600 text-sm hover:underline">View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={jePage} totalPages={Math.ceil(jeTotal / 20)} total={jeTotal} onPageChange={setJePage} />
          </div>
          {selectedEntry && (
            <div className="modal-overlay" onClick={() => setSelectedEntry(null)}>
              <div className="modal-content max-w-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="p-6">
                  <h2 className="text-lg font-semibold mb-4">Journal Entry: {selectedEntry.entry_number}</h2>
                  <p className="text-sm text-gray-500 mb-4">{selectedEntry.description}</p>
                  <table className="data-table">
                    <thead><tr><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead>
                    <tbody>
                      {selectedEntry.lines?.map((l: any) => (
                        <tr key={l.id}>
                          <td><span className="font-mono text-xs">{l.account_code}</span> {l.account_name}</td>
                          <td className="text-sm text-gray-500">{l.description}</td>
                          <td>{l.debit > 0 ? formatCurrency(l.debit) : '-'}</td>
                          <td>{l.credit > 0 ? formatCurrency(l.credit) : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="font-bold">
                        <td colSpan={2} className="text-right px-4 py-3">Total</td>
                        <td className="px-4 py-3">{formatCurrency(selectedEntry.lines?.reduce((s: number, l: any) => s + parseFloat(l.debit), 0) || 0)}</td>
                        <td className="px-4 py-3">{formatCurrency(selectedEntry.lines?.reduce((s: number, l: any) => s + parseFloat(l.credit), 0) || 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="flex justify-end mt-4">
                    <button onClick={() => setSelectedEntry(null)} className="px-4 py-2 border rounded-lg text-sm">Close</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* General Ledger */}
      {activeTab === 'general-ledger' && (
        <div className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Account</label>
              <select value={glAccountFilter} onChange={(e) => setGlAccountFilter(e.target.value)} className="input-field text-sm">
                <option value="">All Accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.account_code} - {a.account_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={glDateFrom} onChange={(e) => setGlDateFrom(e.target.value)} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={glDateTo} onChange={(e) => setGlDateTo(e.target.value)} className="input-field text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={fetchGeneralLedger} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Filter</button>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Entry #</th><th>Account Code</th><th>Account Name</th><th>Debit</th><th>Credit</th></tr></thead>
              <tbody>
                {generalLedger.map((item: any, i: number) => (
                  <tr key={i}>
                    <td className="text-xs">{new Date(item.entry_date).toLocaleDateString()}</td>
                    <td className="font-mono text-xs">{item.entry_number}</td>
                    <td className="font-mono text-xs">{item.account_code}</td>
                    <td>{item.account_name}</td>
                    <td>{item.debit > 0 ? formatCurrency(item.debit) : '-'}</td>
                    <td>{item.credit > 0 ? formatCurrency(item.credit) : '-'}</td>
                  </tr>
                ))}
                {generalLedger.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-6">No ledger entries found</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={4} className="text-right px-4 py-3">Total</td>
                  <td className="px-4 py-3">{formatCurrency(generalLedger.reduce((s: number, i: any) => s + parseFloat(i.debit || 0), 0))}</td>
                  <td className="px-4 py-3">{formatCurrency(generalLedger.reduce((s: number, i: any) => s + parseFloat(i.credit || 0), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Cash Flow */}
      {activeTab === 'cash-flow' && (
        <div className="space-y-4">
          <div className="flex gap-4 flex-wrap">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input type="date" value={cfDateFrom} onChange={(e) => setCfDateFrom(e.target.value)} className="input-field text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input type="date" value={cfDateTo} onChange={(e) => setCfDateTo(e.target.value)} className="input-field text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={fetchCashFlow} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Filter</button>
            </div>
          </div>
          {cashFlow && (
            <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-lg">
              <h3 className="font-semibold text-lg mb-4">Cash Flow Statement</h3>
              <div className="space-y-3">
                <div className="flex justify-between py-2 border-b"><span className="font-medium text-green-600">Cash Inflows</span><span>{formatCurrency(cashFlow.cash_inflows)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="font-medium text-red-600">Cash Outflows</span><span>{formatCurrency(cashFlow.cash_outflows)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="font-medium text-blue-600">Bank Inflows</span><span>{formatCurrency(cashFlow.bank_inflows)}</span></div>
                <div className="flex justify-between py-2 border-b"><span className="font-medium text-orange-600">Bank Outflows</span><span>{formatCurrency(cashFlow.bank_outflows)}</span></div>
                <div className="flex justify-between py-3 text-lg font-bold">
                  <span>Net Cash Flow</span>
                  <span className={cashFlow.net_cash_flow >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(cashFlow.net_cash_flow)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="font-medium">Net Bank Flow</span>
                  <span className={cashFlow.net_bank_flow >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(cashFlow.net_bank_flow)}</span>
                </div>
                <div className="flex justify-between py-3 text-lg font-bold border-t-2">
                  <span>Total Net Flow</span>
                  <span className={cashFlow.total_net_flow >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(cashFlow.total_net_flow)}</span>
                </div>
              </div>
            </div>
          )}
          {!cashFlow && <p className="text-gray-400 text-center py-8">Apply a filter to load cash flow data</p>}
        </div>
      )}
    </div>
    {drillDownAccount && <DrillDownModal account={drillDownAccount} onClose={() => setDrillDownAccount(null)} />}
    </>
  );
}
