import React, { useState } from 'react';
import api from '../../lib/api';
import toast from 'react-hot-toast';
import AccountingDocModalShell from './AccountingDocModalShell';
import JournalEntryView from './JournalEntryView';
import SourceDocumentView, { sourceDocSubtitle, refTypeBadge } from './SourceDocumentView';
import { ITEM_LOADERS, getDocTitle } from '../../lib/accountingDocumentUtils';

interface Props {
  entry: any;
  onClose: () => void;
  highlightAccountCode?: string;
}

type View = 'journal' | 'source';

export default function JournalEntryModal({ entry, onClose, highlightAccountCode }: Props) {
  const [view, setView] = useState<View>('journal');
  const [sourceDoc, setSourceDoc] = useState<any>(null);
  const [sourceRefType, setSourceRefType] = useState('');
  const [sourceItems, setSourceItems] = useState<any[]>([]);
  const [sourceItemCols, setSourceItemCols] = useState<string[]>([]);

  const openSource = async () => {
    if (!entry.reference_type || !entry.reference_id) return;
    try {
      const res = await api.get(`/accounting/source-document/${encodeURIComponent(entry.reference_type)}/${entry.reference_id}`);
      setSourceDoc(res.data.document);
      setSourceRefType(entry.reference_type);
      setSourceItems([]);
      setSourceItemCols([]);
      const loader = ITEM_LOADERS[entry.reference_type];
      if (loader) {
        const { items, columns } = await loader(entry.reference_id);
        setSourceItems(items);
        setSourceItemCols(columns);
      }
      setView('source');
    } catch {
      toast.error('Could not load source document');
    }
  };

  if (view === 'source' && sourceDoc) {
    return (
      <AccountingDocModalShell
        onClose={onClose}
        title={getDocTitle(sourceRefType, sourceDoc)}
        subtitle={sourceDocSubtitle(sourceRefType, sourceDoc)}
        badge={{ label: sourceRefType, className: refTypeBadge(sourceRefType) }}
        statusBadge={sourceDoc.status}
        maxWidth="5xl"
        breadcrumbs={[
          { label: 'Journal Entry', onClick: () => setView('journal') },
          { label: 'Source Document' },
        ]}
        footer={
          <>
            <button type="button" onClick={() => setView('journal')} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">
              Back to Journal Entry
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm hover:bg-blue-800">
              Close
            </button>
          </>
        }
      >
        <SourceDocumentView refType={sourceRefType} document={sourceDoc} items={sourceItems} itemColumns={sourceItemCols} />
      </AccountingDocModalShell>
    );
  }

  return (
    <AccountingDocModalShell
      onClose={onClose}
      title={entry.entry_number}
      subtitle={entry.description}
      badge={entry.reference_type ? { label: entry.reference_type, className: refTypeBadge(entry.reference_type) } : undefined}
      statusBadge={entry.status}
      maxWidth="4xl"
      breadcrumbs={[{ label: 'Journal Entry' }]}
      footer={
        <>
          <div>
            {entry.reference_type && entry.reference_id && (
              <button type="button" onClick={openSource} className="text-sm text-blue-700 hover:underline">
                View source document →
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm hover:bg-blue-800">
            Close
          </button>
        </>
      }
    >
      <JournalEntryView entry={entry} highlightAccountCode={highlightAccountCode} />
    </AccountingDocModalShell>
  );
}
