import React from 'react';
import { formatCurrency, formatDate } from '../../lib/utils';
import {
  SOURCE_FIELDS,
  ITEM_COLUMN_LABELS,
  refTypeBadge,
  resolveFieldValue,
  type SourceFieldDef,
} from '../../lib/accountingDocumentUtils';

interface Props {
  refType: string;
  document: any;
  items: any[];
  itemColumns: string[];
}

function formatFieldValue(value: any, format?: 'currency' | 'date') {
  if (value == null || value === '') return '—';
  if (format === 'currency') return formatCurrency(value);
  if (format === 'date') return formatDate(value);
  return String(value);
}

function StatusPill({ status }: { status: string }) {
  const s = String(status).toLowerCase();
  const cls = s.includes('post') || s.includes('complet') || s.includes('paid') || s.includes('deliver')
    ? 'bg-green-100 text-green-800'
    : s.includes('draft') || s.includes('unreplen')
      ? 'bg-amber-100 text-amber-800'
      : s.includes('void') || s.includes('cancel')
        ? 'bg-red-100 text-red-800'
        : 'bg-gray-100 text-gray-700';
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls}`}>{status}</span>;
}

export default function SourceDocumentView({ refType, document, items, itemColumns }: Props) {
  const fields = SOURCE_FIELDS[refType] || [];
  const summaryFields = fields.filter((f) => f.summary);
  const detailFields = fields.filter((f) => !f.summary);
  const statusField = fields.find((f) => f.key === 'status');
  const statusValue = statusField ? resolveFieldValue(document, statusField.key) : null;

  const itemsTotal = items.reduce((sum, item) => {
    const t = parseFloat(item.total ?? item.total_cost ?? 0);
    return sum + (Number.isFinite(t) ? t : 0);
  }, 0);

  return (
    <div className="p-5 space-y-4">
      {summaryFields.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryFields.filter((f) => f.key !== 'status').map((field) => (
            <SummaryCard key={field.key} field={field} document={document} />
          ))}
          {statusValue && (
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Status</div>
              <div className="mt-1.5"><StatusPill status={String(statusValue)} /></div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section title="Document Details">
          {detailFields.length > 0 ? (
            <dl className="divide-y divide-gray-100">
              {detailFields.map((field) => (
                <DetailRow key={field.key} field={field} document={document} />
              ))}
            </dl>
          ) : fields.length === 0 ? (
            <p className="text-sm text-gray-500">{document.description || document.notes || 'No details available.'}</p>
          ) : (
            <dl className="divide-y divide-gray-100">
              {fields.filter((f) => f.key !== 'status').map((field) => (
                <DetailRow key={field.key} field={field} document={document} />
              ))}
            </dl>
          )}
        </Section>

        <Section title="Amount Summary">
          <dl className="divide-y divide-gray-100">
            {fields.filter((f) => f.format === 'currency').map((field) => (
              <DetailRow key={field.key} field={field} document={document} emphasize />
            ))}
            {items.length > 0 && (
              <div className="flex justify-between py-2.5 text-sm">
                <dt className="text-gray-500">Line Items Total</dt>
                <dd className="font-bold text-gray-900">{formatCurrency(itemsTotal)}</dd>
              </div>
            )}
          </dl>
          {document.notes && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</div>
              <p className="text-xs text-gray-600 whitespace-pre-wrap">{document.notes}</p>
            </div>
          )}
        </Section>
      </div>

      {items.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b flex items-center justify-between">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Line Items</span>
            <span className="text-xs text-gray-500">{items.length} item(s)</span>
          </div>
          <table className="data-table text-xs">
            <thead>
              <tr>
                {itemColumns.map((col) => (
                  <th key={col} className={['quantity'].includes(col) ? 'text-right' : ''}>
                    {ITEM_COLUMN_LABELS[col] || col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  {itemColumns.map((col) => {
                    const val = item[col];
                    const isMoney = ['unit_price', 'unit_cost', 'total', 'total_cost'].includes(col);
                    const isQty = col === 'quantity';
                    return (
                      <td key={col} className={isQty || isMoney ? 'text-right' : ''}>
                        {isMoney ? formatCurrency(val) : isQty ? val : String(val ?? '—')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold bg-gray-50">
                <td colSpan={Math.max(1, itemColumns.length - 1)} className="text-right px-4 py-2 text-gray-600">Subtotal</td>
                <td className="text-right px-4 py-2">{formatCurrency(itemsTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 border-b bg-gray-50/80">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{title}</span>
      </div>
      <div className="px-4 py-2">{children}</div>
    </div>
  );
}

function SummaryCard({ field, document }: { field: SourceFieldDef; document: any }) {
  const val = resolveFieldValue(document, field.key);
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{field.label}</div>
      <div className={`mt-0.5 truncate ${field.format === 'currency' ? 'text-base font-bold text-blue-900' : 'text-sm font-semibold text-gray-900'}`}>
        {formatFieldValue(val, field.format)}
      </div>
    </div>
  );
}

function DetailRow({ field, document, emphasize }: { field: SourceFieldDef; document: any; emphasize?: boolean }) {
  const val = resolveFieldValue(document, field.key);
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-gray-500 shrink-0">{field.label}</dt>
      <dd className={`text-right ${emphasize ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
        {formatFieldValue(val, field.format)}
      </dd>
    </div>
  );
}

export function sourceDocSubtitle(refType: string, document: any) {
  const partyKeys = ['customer_name', 'supplier_name', 'payee', 'last_name'];
  for (const k of partyKeys) {
    if (k === 'last_name' && document.last_name) return `${document.last_name}, ${document.first_name}`;
    if (document[k]) return String(document[k]);
  }
  return refType;
}

export { refTypeBadge };
