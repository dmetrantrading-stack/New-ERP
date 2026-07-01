import React, { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import IncomeStatementReport, { IncomeStatementToolbar } from '../../components/accounting/IncomeStatementReport';

export type IncomeStatementSummary = {
  net_income: number;
  gross_profit: number;
  total_income: number;
  from: string;
  to: string;
};

type Props = {
  businessName?: string;
  onAccountClick?: (account: { id: number; account_code: string; account_name: string }) => void;
  onSummaryChange?: (summary: IncomeStatementSummary | null) => void;
};

export default function IncomeStatementTab({
  businessName,
  onAccountClick,
  onSummaryChange,
}: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [datesReady, setDatesReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get('/accounting/report-context')
      .then((res) => {
        const serverToday = res.data?.server_today || new Date().toISOString().slice(0, 10);
        const yearStart = res.data?.fiscal_year_start || `${serverToday.slice(0, 4)}-01-01`;
        setFrom(yearStart);
        setTo(serverToday);
        setDatesReady(true);
      })
      .catch(() => {
        const today = new Date().toISOString().slice(0, 10);
        setFrom(`${today.slice(0, 4)}-01-01`);
        setTo(today);
        setDatesReady(true);
      });
  }, []);

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    try {
      const res = await api.get('/accounting/income-statement', { params: { from, to } });
      setData(res.data);
      onSummaryChange?.({
        net_income: res.data.net_income,
        gross_profit: res.data.gross_profit,
        total_income: res.data.total_income,
        from: res.data.from,
        to: res.data.to,
      });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load profit and loss');
      setData(null);
      onSummaryChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, onSummaryChange]);

  useEffect(() => {
    if (datesReady) load();
  }, [datesReady, load]);

  return (
    <div className="space-y-4 max-w-full">
      <IncomeStatementToolbar
        from={from}
        to={to}
        loading={loading}
        serverToday={data?.server_today}
        onFromChange={setFrom}
        onToChange={setTo}
        onRefresh={load}
      />
      {loading && !data && (
        <p className="text-gray-400 text-center py-12">Loading profit and loss…</p>
      )}
      {data && (
        <IncomeStatementReport
          data={data}
          businessName={businessName}
          onAccountClick={onAccountClick}
        />
      )}
    </div>
  );
}
