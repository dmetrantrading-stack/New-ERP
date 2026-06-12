import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { X, Search, Download, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';

interface DrillDownProps {
  account: any;
  onClose: () => void;
  dateRange?: { from: string; to: string };
}

export default function DrillDownModal({ account, onClose, dateRange }: DrillDownProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [totals, setTotals] = useState({ debit: 0, credit: 0, net: 0 });
  const [sourceDoc, setSourceDoc] = useState<any>(null);
  const [sourceItems, setSourceItems] = useState<any[]>([]);
  const [viewLevel, setViewLevel] = useState<1 | 2 | 3>(1);

  const limit = 50;

  useEffect(() => {
    loadDetails(page, search);
  }, [page, search]);

  const loadDetails = (pg: number, srch: string) => {
    setLoading(true);
    let url = `/accounting/account-details/${account.account_code}?page=${pg}&limit=${limit}`;
    if (dateRange?.from) url += `&from=${dateRange.from}`;
    if (dateRange?.to) url += `&to=${dateRange.to}`;
    if (srch) url += `&search=${encodeURIComponent(srch)}`;

    api.get(url)
      .then(res => {
        setData(res.data.data || []);
        setTotal(res.data.total);
        setTotals({ debit: res.data.total_debit, credit: res.data.total_credit, net: res.data.net_total });
      })
      .catch(() => toast.error('Failed to load details'))
      .finally(() => setLoading(false));
  };

  const openSourceDoc = async (refType: string, refId: string) => {
    try {
      const res = await api.get(`/accounting/source-document/${encodeURIComponent(refType)}/${refId}`);
      setSourceDoc(res.data.document);
      setViewLevel(3);

      // Load items if it's a sales invoice or POS
      if (refType === 'Sales Invoice') {
        const items = await api.get(`/sales/invoices/${refId}`);
        setSourceItems(items.data?.items || []);
      } else if (refType === 'POS Sale') {
        const items = await api.get(`/pos/transactions/${refId}`);
        setSourceItems(items.data?.items || []);
      }
    } catch { toast.error('Could not load source document'); }
  };

  const exportCSV = () => {
    const rows = data.map((d: any) => [
      formatDate(d.entry_date), d.entry_number, d.reference_type,
      d.document_number || '-', d.party_name || '-',
      d.je_description || d.line_description || '-',
      d.debit || 0, d.credit || 0, d.created_by_name || '-'
    ]);
    const header = ['Date','Entry#','Type','Doc#','Party','Description','Debit','Credit','Created By'];
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `account_${account.account_code}_details.csv`; a.click();
  };

  const totalPages = Math.ceil(total / limit);
  const isCredit = account.account_type === 'Liability' || account.account_type === 'Equity' || account.account_type === 'Income';

  // Level 3: Source Document View
  if (viewLevel === 3 && sourceDoc) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => setViewLevel(2)} className="p-1.5 hover:bg-gray-100 rounded"><ArrowLeft size={18} /></button>
              <h2 className="text-lg font-semibold">Source Document</h2>
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{sourceDoc.reference_type || 'Document'}</span>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-4 grid grid-cols-3 gap-3 text-sm">
              {Object.entries(sourceDoc).filter(([k]) => !k.startsWith('items') && k !== 'id' && sourceDoc[k] != null).slice(0, 12).map(([k, v]) => (
                <div key={k}>
                  <span className="text-xs text-gray-500 uppercase">{k.replace(/_/g, ' ')}</span>
                  <p className="font-medium">{typeof v === 'number' ? formatCurrency(v) : String(v)}</p>
                </div>
              ))}
            </div>

            {sourceItems.length > 0 && (
              <div className="overflow-hidden rounded-lg border">
                <table className="data-table">
                  <thead><tr>{Object.keys(sourceItems[0]).filter(k => k !== 'id').slice(0, 8).map(k => <th key={k}>{k.replace(/_/g, ' ')}</th>)}</tr></thead>
                  <tbody>
                    {sourceItems.map((item: any, i: number) => (
                      <tr key={i}>{Object.entries(item).filter(([k]) => k !== 'id').slice(0, 8).map(([k, v]) => <td key={k}>{typeof v === 'number' ? formatCurrency(v) : String(v ?? '-')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end mt-4">
              <button onClick={() => setViewLevel(2)} className="px-4 py-2 border rounded-lg text-sm">Back to Transactions</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Level 2: Transaction List
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{account.account_name} <span className="text-xs text-gray-400 font-mono ml-1">({account.account_code})</span></h2>
            <p className="text-xs text-gray-500">{account.account_type}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded"><X size={18} /></button>
        </div>

        {/* Totals Bar */}
        <div className="flex-shrink-0 px-4 py-2 bg-gray-50 border-b flex items-center justify-between text-sm">
          <div className="flex gap-4">
            <span><span className="text-gray-500">Debit:</span> <span className="font-semibold">{formatCurrency(totals.debit)}</span></span>
            <span><span className="text-gray-500">Credit:</span> <span className="font-semibold">{formatCurrency(totals.credit)}</span></span>
            <span className={totals.net >= 0 ? 'text-green-700' : 'text-red-700'}>
              <span className="text-gray-500">Net:</span> <span className="font-bold">{formatCurrency(totals.net)}</span>
            </span>
          </div>
          <button onClick={exportCSV} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"><Download size={12} /> Export CSV</button>
        </div>

        {/* Search */}
        <div className="flex-shrink-0 px-4 py-2 border-b">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search transactions..." value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="data-table text-xs">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th>Date</th><th>Entry #</th><th>Type</th><th>Doc #</th><th>Party</th>
                <th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th>
                <th>Created By</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-400">No transactions found</td></tr>
              ) : data.map((d: any) => (
                <tr key={d.line_id} className="hover:bg-blue-50/30 cursor-pointer"
                  onClick={() => d.reference_type && d.reference_id ? openSourceDoc(d.reference_type, d.reference_id) : null}>
                  <td className="text-[11px]">{formatDate(d.entry_date)}</td>
                  <td className="font-mono text-[11px]">{d.entry_number}</td>
                  <td><span className="px-1.5 py-0.5 text-[10px] bg-gray-100 rounded">{d.reference_type || '—'}</span></td>
                  <td className="font-mono text-[11px] text-blue-600 hover:underline">{d.document_number || '—'}</td>
                  <td className="text-[11px]">{d.party_name || '—'}</td>
                  <td className="max-w-[200px] truncate text-[11px]">{d.line_description || d.je_description || '—'}</td>
                  <td className="text-right font-medium text-[11px]">{parseFloat(d.debit) > 0 ? formatCurrency(d.debit) : '—'}</td>
                  <td className="text-right font-medium text-[11px]">{parseFloat(d.credit) > 0 ? formatCurrency(d.credit) : '—'}</td>
                  <td className="text-[11px] text-gray-500">{d.created_by_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex-shrink-0 px-4 py-2 border-t flex items-center justify-between text-sm">
            <span className="text-gray-500">{total} transactions</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-1 border rounded text-xs disabled:opacity-30">Prev</button>
              <span className="px-2 py-1 text-xs">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-3 py-1 border rounded text-xs disabled:opacity-30">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
