import React from 'react';
import { useSearchParams } from 'react-router-dom';
import AccountingPage from '../accounting/AccountingPage';
import PayablesPage from '../payables/PayablesPage';
import CollectionsPage from '../sales/CollectionsPage';
import BankCashPage from '../bankCash/BankCashPage';
import ExpenseList from '../expenses/ExpenseList';

const TABS = [
  { label: 'Accounting', key: 'accounting' },
  { label: 'Accounts Payable', key: 'payables' },
  { label: 'Collections & AR', key: 'collections' },
  { label: 'Bank & Cash', key: 'bank-cash' },
  { label: 'Expenses', key: 'expenses' },
];

export default function FinancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'accounting';

  const setTab = (key: string) => {
    setSearchParams(key === 'accounting' ? {} : { tab: key });
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'payables': return <PayablesPage />;
      case 'collections': return <CollectionsPage />;
      case 'bank-cash': return <BankCashPage />;
      case 'expenses': return <ExpenseList />;
      default: return <AccountingPage />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="border-b border-gray-200">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-gray-900">Finance</h1>
          <div className="flex gap-1 -mb-px">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {renderTab()}
    </div>
  );
}
