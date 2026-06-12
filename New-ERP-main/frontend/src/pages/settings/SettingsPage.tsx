import React, { useState } from 'react';
import api from '../../lib/api';
import { Trash2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    setResetting(true);
    try {
      await api.post('/settings/reset-transactions');
      toast.success('All transactions reset. Products & master data preserved.');
      setConfirming(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Reset Transactions</h2>
          <p className="text-sm text-gray-500 mt-1">
            This will clear all transactions, inventory quantities, bank balances, customer/supplier balances,
            and chart of accounts balances. Products, employees, users, roles, categories, brands, and locations will be preserved.
          </p>

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
            >
              <Trash2 size={16} /> Reset All Transactions
            </button>
          ) : (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-red-500 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800">Are you absolutely sure?</p>
                  <p className="text-sm text-red-600 mt-1">
                    This action cannot be undone. All sales, purchases, payroll, inventory movements,
                    accounting entries, and bank transactions will be permanently deleted.
                  </p>
                  <div className="flex gap-3 mt-3">
                    <button
                      onClick={() => setConfirming(false)}
                      className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReset}
                      disabled={resetting}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
                    >
                      {resetting ? 'Resetting...' : 'Yes, Reset Everything'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
