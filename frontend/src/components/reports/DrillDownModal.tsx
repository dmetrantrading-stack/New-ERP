import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import toast from 'react-hot-toast';
import AccountingDocModalShell from '../accounting/AccountingDocModalShell';
import AccountLedgerView from '../accounting/AccountLedgerView';
import JournalEntryView from '../accounting/JournalEntryView';
import SourceDocumentView, { sourceDocSubtitle, refTypeBadge } from '../accounting/SourceDocumentView';
import { ITEM_LOADERS, getDocTitle } from '../../lib/accountingDocumentUtils';

interface DrillDownProps {
  account: any;
  onClose: () => void;
  dateRange?: { from: string; to: string };
}

type View = 'ledger' | 'journal' | 'source';

export default function DrillDownModal({ account, onClose, dateRange }: DrillDownProps) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [refTypeFilter, setRefTypeFilter] = useState('');
  const [refTypes, setRefTypes] = useState<string[]>([]);
  const [totals, setTotals] = useState({ debit: 0, credit: 0, net: 0 });
  const [view, setView] = useState<View>('ledger');
  const [sourceDoc, setSourceDoc] = useState<any>(null);
  const [sourceRefType, setSourceRefType] = useState('');
  const [sourceItems, setSourceItems] = useState<any[]>([]);
  const [sourceItemCols, setSourceItemCols] = useState<string[]>([]);
  const [journalEntry, setJournalEntry] = useState<any>(null);

  const limit = 50;
  const totalPages = Math.ceil(total / limit);

  const loadDetails = useCallback(async (pg: number, srch: string, refType: string) => {
    setLoading(true);
    try {
      let url = `/accounting/account-details/${account.account_code}?page=${pg}&limit=${limit}`;
      if (dateRange?.from) url += `&from=${dateRange.from}`;
      if (dateRange?.to) url += `&to=${dateRange.to}`;
      if (srch) url += `&search=${encodeURIComponent(srch)}`;
      if (refType) url += `&ref_type=${encodeURIComponent(refType)}`;

      const res = await api.get(url);
      setData(res.data.data || []);
      setTotal(res.data.total);
      setRefTypes(res.data.reference_types || []);
      setTotals({ debit: res.data.total_debit, credit: res.data.total_credit, net: res.data.net_total });
    } catch {
      toast.error('Failed to load account details');
    } finally {
      setLoading(false);
    }
  }, [account.account_code, dateRange?.from, dateRange?.to]);

  useEffect(() => {
    if (view === 'ledger') loadDetails(page, search, refTypeFilter);
  }, [page, search, refTypeFilter, loadDetails, view]);

  const goLedger = () => {
    setView('ledger');
    setJournalEntry(null);
    setSourceDoc(null);
  };

  const openSourceDoc = async (refType: string, refId: string) => {
    if (!refType || !refId) return;
    try {
      const res = await api.get(`/accounting/source-document/${encodeURIComponent(refType)}/${refId}`);
      setSourceDoc(res.data.document);
      setSourceRefType(refType);
      setSourceItems([]);
      setSourceItemCols([]);
      const loader = ITEM_LOADERS[refType];
      if (loader) {
        const { items, columns } = await loader(refId);
        setSourceItems(items);
        setSourceItemCols(columns);
      }
      setView('source');
    } catch {
      toast.error('Could not load source document');
    }
  };

  const openJournalEntry = async (entryId: string) => {
    try {
      const res = await api.get(`/accounting/journal-entries/${entryId}`);
      setJournalEntry(res.data);
      setView('journal');
    } catch {
      toast.error('Could not load journal entry');
    }
  };

  const exportCSV = () => {
    const rows = data.map((d: any) => [
      formatDate(d.entry_date), d.entry_number, d.reference_type,
      d.document_number || '-', d.party_name || '-',
      d.line_description || d.je_description || '-',
      d.debit || 0, d.credit || 0, d.running_balance ?? '', d.created_by_name || '-',
    ]);
    const header = ['Date', 'Entry#', 'Source Type', 'Doc#', 'Party', 'Description', 'Debit', 'Credit', 'Balance', 'Created By'];
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger_${account.account_code}.csv`;
    a.click();
  };

  const breadcrumbs = view === 'ledger'
    ? [{ label: `${account.account_code} — ${account.account_name}` }]
    : view === 'journal'
      ? [
          { label: account.account_name, onClick: goLedger },
          { label: journalEntry?.entry_number || 'Journal Entry' },
        ]
      : [
          { label: account.account_name, onClick: goLedger },
          ...(journalEntry ? [{ label: journalEntry.entry_number, onClick: () => setView('journal') }] : []),
          { label: 'Source Document' },
        ];

  const shellTitle = view === 'ledger'
    ? account.account_name
    : view === 'journal'
      ? journalEntry?.entry_number || 'Journal Entry'
      : getDocTitle(sourceRefType, sourceDoc);

  const shellSubtitle = view === 'ledger'
    ? `${account.account_code} · ${account.account_type} · Click entry # or document to drill deeper`
    : view === 'journal'
      ? journalEntry?.description
      : sourceDoc ? sourceDocSubtitle(sourceRefType, sourceDoc) : undefined;

  const shellBadge = view === 'journal' && journalEntry?.reference_type
    ? { label: journalEntry.reference_type, className: refTypeBadge(journalEntry.reference_type) }
    : view === 'source'
      ? { label: sourceRefType, className: refTypeBadge(sourceRefType) }
      : { label: account.account_code, className: 'bg-white/20 border-white/30 text-white' };

  const shellStatus = view === 'journal' ? journalEntry?.status : view === 'source' ? sourceDoc?.status : undefined;

  return (
    <AccountingDocModalShell
      onClose={onClose}
      title={shellTitle}
      subtitle={shellSubtitle}
      badge={shellBadge}
      statusBadge={shellStatus}
      breadcrumbs={breadcrumbs}
      maxWidth={view === 'ledger' ? '6xl' : '5xl'}
      footer={
        view === 'ledger' ? (
          <button type="button" onClick={onClose} className="ml-auto px-4 py-2 bg-blue-700 text-white rounded-lg text-sm hover:bg-blue-800">
            Close
          </button>
        ) : view === 'journal' ? (
          <>
            <button type="button" onClick={goLedger} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
              Back to Ledger
            </button>
            <div className="flex gap-2 ml-auto">
              {journalEntry?.reference_type && journalEntry?.reference_id && (
                <button type="button" onClick={() => openSourceDoc(journalEntry.reference_type, journalEntry.reference_id)}
                  className="px-4 py-2 border border-blue-200 text-blue-700 rounded-lg text-sm hover:bg-blue-50">
                  View Document
                </button>
              )}
              <button type="button" onClick={onClose} className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm hover:bg-blue-800">
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={() => (journalEntry ? setView('journal') : goLedger())}
              className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
              {journalEntry ? 'Back to Journal Entry' : 'Back to Ledger'}
            </button>
            <button type="button" onClick={onClose} className="ml-auto px-4 py-2 bg-blue-700 text-white rounded-lg text-sm hover:bg-blue-800">
              Close
            </button>
          </>
        )
      }
    >
      {view === 'ledger' && (
        <AccountLedgerView
          account={account}
          data={data}
          loading={loading}
          totals={totals}
          search={search}
          refTypeFilter={refTypeFilter}
          refTypes={refTypes}
          page={page}
          totalPages={totalPages}
          total={total}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          onRefTypeChange={(v) => { setRefTypeFilter(v); setPage(1); }}
          onPageChange={setPage}
          onExport={exportCSV}
          onOpenJournal={openJournalEntry}
          onOpenSource={openSourceDoc}
        />
      )}
      {view === 'journal' && journalEntry && (
        <JournalEntryView entry={journalEntry} highlightAccountCode={account.account_code} />
      )}
      {view === 'source' && sourceDoc && (
        <SourceDocumentView refType={sourceRefType} document={sourceDoc} items={sourceItems} itemColumns={sourceItemCols} />
      )}
    </AccountingDocModalShell>
  );
}
