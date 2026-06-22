import React, { useState } from 'react';
import AttachmentPanel from './AttachmentPanel';
import type { AttachmentReferenceType } from '../lib/documentAttachments';

type Tab = 'notes' | 'terms' | 'attachments';

type Props = {
  notes: string;
  termsConditions: string;
  onNotesChange: (value: string) => void;
  onTermsChange: (value: string) => void;
  referenceType: AttachmentReferenceType;
  referenceId: string;
  sectionLabel?: string;
  notesPlaceholder?: string;
  termsPlaceholder?: string;
  defaultTab?: Tab;
};

export default function DocumentNotesTermsPanel({
  notes,
  termsConditions,
  onNotesChange,
  onTermsChange,
  referenceType,
  referenceId,
  sectionLabel = 'Notes & Terms',
  notesPlaceholder = 'Notes, remarks, or special instructions...',
  termsPlaceholder = 'Terms and conditions...',
  defaultTab = 'notes',
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{sectionLabel}</div>
      <div className="flex gap-4 border-b border-gray-200 pb-2 mb-3">
        {(['notes', 'terms', 'attachments'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`pb-2 -mb-2 text-xs font-semibold capitalize ${
              activeTab === tab ? 'text-blue-700 border-b-2 border-blue-700' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab === 'terms' ? 'Terms & Conditions' : tab}
          </button>
        ))}
      </div>
      {activeTab === 'notes' && (
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={4}
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs resize-none"
          placeholder={notesPlaceholder}
        />
      )}
      {activeTab === 'terms' && (
        <textarea
          value={termsConditions}
          onChange={(e) => onTermsChange(e.target.value)}
          rows={4}
          className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-xs resize-none"
          placeholder={termsPlaceholder}
        />
      )}
      {activeTab === 'attachments' && (
        <AttachmentPanel referenceType={referenceType} referenceId={referenceId} />
      )}
    </div>
  );
}
