import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Wallet } from 'lucide-react';
import ApVouchersPanel from './ApVouchersPanel';
import PaymentVouchersPanel from './PaymentVouchersPanel';
import Bir2307Panel from './Bir2307Panel';
import { PRIMARY, AGING_LABELS } from '../../lib/payablesUtils';
import { useAuth } from '../../store/auth';

export default function PayablesPage() {
  const { hasPerm } = useAuth();
  const canApv = hasPerm('purchases.apv.view');
  const canPay = hasPerm('purchases.payment-voucher.view');
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: 'apv' | 'payments' | 'bir2307' =
    tabParam === 'payments' ? 'payments' :
    tabParam === 'bir2307' ? 'bir2307' : 'apv';
  const resolvedTab =
    tab === 'apv' && !canApv && canPay ? 'payments' :
    tab === 'payments' && !canPay && canApv ? 'apv' :
    tab === 'bir2307' && !canPay ? (canApv ? 'apv' : 'payments') :
    tab;

  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [aging, setAging] = useState<any>(null);

  const loadAging = useCallback(() => {
    api.get('/payables/ap-aging').then((r) => setAging(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/suppliers').then((r) => setSuppliers(r.data.data || [])).catch(() => {});
    api.get('/products?limit=500').then((r) => setProducts(r.data.data || [])).catch(() => {});
    api.get('/bank-cash/accounts').then((r) => setBankAccounts(r.data || [])).catch(() => {});
    loadAging();
  }, [loadAging]);

  const setTab = (t: 'apv' | 'payments' | 'bir2307') => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', t);
    next.delete('pay_apv');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <Wallet size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Accounts Payable</h1>
        </div>
        <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5">
          {canApv && (
            <button
              onClick={() => setTab('apv')}
              className={`px-3 py-1 text-xs font-semibold rounded-md ${resolvedTab === 'apv' ? 'bg-white text-blue-900' : 'text-white/80 hover:text-white'}`}
            >
              AP Vouchers
            </button>
          )}
          {canPay && (
            <button
              onClick={() => setTab('payments')}
              className={`px-3 py-1 text-xs font-semibold rounded-md ${resolvedTab === 'payments' ? 'bg-white text-blue-900' : 'text-white/80 hover:text-white'}`}
            >
              Payment Vouchers
            </button>
          )}
          {canPay && (
            <button
              onClick={() => setTab('bir2307')}
              className={`px-3 py-1 text-xs font-semibold rounded-md ${resolvedTab === 'bir2307' ? 'bg-white text-blue-900' : 'text-white/80 hover:text-white'}`}
            >
              BIR 2307
            </button>
          )}
        </div>
      </div>

      {aging && resolvedTab === 'apv' && (
        <div className="flex-shrink-0 px-4 py-3 bg-white border-b border-gray-200 max-h-48 overflow-y-auto">
          <div className="flex flex-wrap items-stretch gap-3 mb-3">
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 min-w-[140px]">
              <div className="text-[10px] font-semibold text-blue-600 uppercase tracking-wider">Total Outstanding</div>
              <div className="text-lg font-bold text-blue-900">{formatCurrency(aging.total_outstanding || 0)}</div>
              <div className="text-[10px] text-blue-700">{aging.count || 0} open APV(s)</div>
            </div>
            {(['current', '1_30', '31_60', '61_90', 'over_90'] as const).map((key) => (
              <div key={key} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 min-w-[100px]">
                <div className="text-[10px] font-semibold text-gray-500 uppercase">{AGING_LABELS[key]}</div>
                <div className="text-sm font-bold text-gray-800">{formatCurrency(aging.buckets?.[key] || 0)}</div>
              </div>
            ))}
          </div>
          {(aging.rows || []).length > 0 && (
            <table className="w-full text-[10px]">
              <thead><tr className="text-gray-500 uppercase">
                <th className="text-left py-1">APV</th>
                <th className="text-left py-1">Supplier</th>
                <th className="text-left py-1">Due</th>
                <th className="text-left py-1">Aging</th>
                <th className="text-right py-1">Balance</th>
              </tr></thead>
              <tbody>
                {(aging.rows as any[]).slice(0, 8).map((row) => (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="py-1 font-mono text-blue-700">{row.apv_number}</td>
                    <td className="py-1">{row.supplier_name}</td>
                    <td className="py-1">{row.due_date ? formatDate(row.due_date) : '—'}</td>
                    <td className="py-1">{AGING_LABELS[row.aging_bucket] || row.aging_bucket}</td>
                    <td className="py-1 text-right font-medium">{formatCurrency(row.balance_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-gray-500 mt-2">
            Workflow: PO → Goods Receipt → APV (post) → Pay Supplier. Payments apply to posted APVs only.
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {resolvedTab === 'bir2307' && canPay ? (
          <Bir2307Panel />
        ) : resolvedTab === 'apv' && canApv ? (
          <ApVouchersPanel suppliers={suppliers} products={products} onRefresh={loadAging} />
        ) : canPay ? (
          <PaymentVouchersPanel suppliers={suppliers} bankAccounts={bankAccounts} onRefresh={loadAging} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">No payables permission</div>
        )}
      </div>
    </div>
  );
}
