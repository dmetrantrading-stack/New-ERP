import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import {
  OPENING_IMPORT_TYPES,
  RESET_TOOLS,
  BACKUP_SCRIPT_HINT,
  type OpeningImportType,
} from '../../lib/dataToolsConfig';
import { SETTINGS_SECTIONS } from '../../lib/settingsUtils';
import SettingsSubNav from './SettingsSubNav';
import {
  AlertTriangle, CalendarClock, Database, HardDrive, Lock, Trash2, Upload, Users, Package, BookOpen,
} from 'lucide-react';
import toast from 'react-hot-toast';

const inputClass = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

const IMPORT_ICONS: Record<OpeningImportType, React.ElementType> = {
  customers: Users,
  suppliers: Users,
  inventory: Package,
  gl: BookOpen,
};

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      <p className="text-xs text-gray-500 mt-0.5">{description}</p>
    </div>
  );
}

export default function SettingsDataToolsTab({
  section,
  onSectionChange,
}: {
  section: string;
  onSectionChange: (key: string) => void;
}) {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('system.settings.edit');

  const [loading, setLoading] = useState(true);
  const [accountingLockDate, setAccountingLockDate] = useState('');
  const [savingLock, setSavingLock] = useState(false);

  const [importType, setImportType] = useState<OpeningImportType>('customers');
  const [importCsv, setImportCsv] = useState('');
  const [importEntryDate, setImportEntryDate] = useState('');
  const [importing, setImporting] = useState(false);

  const [confirmReset, setConfirmReset] = useState<'transactions' | 'products' | null>(null);
  const [resetting, setResetting] = useState(false);

  const activeImport = useMemo(
    () => OPENING_IMPORT_TYPES.find((t) => t.id === importType) || OPENING_IMPORT_TYPES[0],
    [importType],
  );

  const loadLock = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/settings/accounting-lock');
      setAccountingLockDate(res.data?.accounting_lock_date || '');
    } catch {
      /* optional */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadLock(); }, [loadLock]);

  const saveAccountingLock = async () => {
    if (!canEdit) return;
    setSavingLock(true);
    try {
      await api.put('/settings/accounting-lock', { accounting_lock_date: accountingLockDate || null });
      toast.success(accountingLockDate ? `Period locked through ${accountingLockDate}` : 'Period lock cleared');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save lock');
    } finally {
      setSavingLock(false);
    }
  };

  const handleOpeningImport = async () => {
    if (!canEdit || !importCsv.trim()) {
      toast.error('Paste CSV data first');
      return;
    }
    setImporting(true);
    try {
      const res = await api.post('/settings/import/opening-balances', {
        type: importType,
        csv: importCsv,
        entry_date: importEntryDate || undefined,
      });
      toast.success(
        `Imported ${res.data.imported} ${importType} record(s)${res.data.entry_number ? ` · JE ${res.data.entry_number}` : ''}`,
      );
      setImportCsv('');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportCsv(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = '';
  };

  const useSampleHeader = () => {
    setImportCsv(`${activeImport.sampleHeader}\n`);
  };

  const handleReset = async (kind: 'transactions' | 'products') => {
    if (!canEdit) return;
    setResetting(true);
    try {
      const path = kind === 'transactions' ? '/settings/reset-transactions' : '/settings/reset-products';
      await api.post(path);
      toast.success(kind === 'transactions' ? 'All transactions reset' : 'Products and inventory reset');
      setConfirmReset(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        Loading data tools...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6 pb-8">
        <SettingsSubNav sections={SETTINGS_SECTIONS.system} active={section} onChange={onSectionChange} />

        {section === 'accounting' && (
        <section>
          <SectionHeader
            title="Accounting controls"
            description="Block new transactions on or before the lock date. Leave empty to unlock."
          />
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-50 text-blue-700">
                <CalendarClock size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">Accounting period lock</h3>
                <p className="text-xs text-gray-500 mt-0.5">Applies to sales, purchases, POS, payroll, and journal posting.</p>
                <div className="flex flex-wrap items-end gap-3 mt-4">
                  <div className="flex-1 min-w-[180px] max-w-xs">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Lock through date</label>
                    <input
                      type="date"
                      value={accountingLockDate}
                      onChange={(e) => setAccountingLockDate(e.target.value)}
                      disabled={!canEdit}
                      className={inputClass}
                    />
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={saveAccountingLock}
                      disabled={savingLock}
                      className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50"
                    >
                      {savingLock ? 'Saving...' : accountingLockDate ? 'Save lock' : 'Clear lock'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
        )}

        {section === 'imports' && (
        <section>
          <SectionHeader
            title="Opening balances"
            description="Paste CSV or upload a file. Header row is required."
          />
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex flex-wrap gap-1 p-2 bg-gray-50 border-b border-gray-200">
              {OPENING_IMPORT_TYPES.map((t) => {
                const Icon = IMPORT_ICONS[t.id];
                const active = importType === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setImportType(t.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      active ? 'bg-white text-blue-800 shadow-sm border border-gray-200' : 'text-gray-600 hover:bg-white/60'
                    }`}
                  >
                    <Icon size={13} />
                    {t.shortLabel}
                  </button>
                );
              })}
            </div>

            <div className="p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{activeImport.label}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{activeImport.description}</p>
              </div>

              <div className="bg-gray-50 rounded-lg border border-gray-100 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Required columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {activeImport.columns.map((col) => (
                    <code key={col} className="text-[10px] px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-700">
                      {col}
                    </code>
                  ))}
                </div>
              </div>

              {importType === 'gl' && (
                <div className="max-w-xs">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Journal entry date</label>
                  <input
                    type="date"
                    value={importEntryDate}
                    onChange={(e) => setImportEntryDate(e.target.value)}
                    disabled={!canEdit}
                    className={inputClass}
                  />
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-xs font-medium text-gray-600">CSV data</label>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={useSampleHeader}
                      className="text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Insert header row
                    </button>
                  )}
                </div>
                <textarea
                  value={importCsv}
                  onChange={(e) => setImportCsv(e.target.value)}
                  disabled={!canEdit}
                  rows={7}
                  placeholder={`${activeImport.sampleHeader}\n...`}
                  className={`${inputClass} font-mono text-xs`}
                />
              </div>

              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <label className="inline-flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-xs cursor-pointer hover:bg-gray-50">
                    <Upload size={14} />
                    Upload CSV
                    <input type="file" accept=".csv,text/csv" onChange={handleImportFile} className="hidden" />
                  </label>
                  <button
                    type="button"
                    onClick={handleOpeningImport}
                    disabled={importing || !importCsv.trim()}
                    className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50"
                  >
                    {importing ? 'Importing...' : `Run ${activeImport.shortLabel} import`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
        )}

        {section === 'maintenance' && (
        <>
        <section>
          <SectionHeader
            title="Database backup"
            description="Back up PostgreSQL before imports or resets. Run on the server where the database lives."
          />
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
                <HardDrive size={18} />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <h3 className="text-sm font-semibold text-gray-900">Manual backup script</h3>
                <p className="text-xs text-gray-500">
                  Creates a timestamped SQL dump in the <code className="text-[10px] bg-gray-100 px-1 rounded">backups/</code> folder and keeps the last 30 files.
                </p>
                <pre className="text-[11px] bg-gray-900 text-gray-100 rounded-lg px-3 py-2 overflow-x-auto">
                  {`powershell -ExecutionPolicy Bypass -File .\\${BACKUP_SCRIPT_HINT}`}
                </pre>
                <p className="text-[10px] text-gray-400">Reads connection settings from backend\.env</p>
              </div>
            </div>
          </div>
        </section>

        {/* Danger zone */}
        <section>
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3 mb-4">
            <AlertTriangle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">Danger zone</p>
              <p className="text-xs text-red-700 mt-1">
                These actions permanently delete data and cannot be undone. Take a backup first.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {RESET_TOOLS.map((tool) => {
              const isRed = tool.tone === 'red';
              const confirming = confirmReset === tool.id;
              const btnClass = isRed
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-orange-600 hover:bg-orange-700';
              const panelClass = isRed
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-orange-50 border-orange-200 text-orange-800';
              const cancelClass = isRed
                ? 'border-red-300 text-red-700'
                : 'border-orange-300 text-orange-700';

              return (
                <div key={tool.id} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{tool.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{tool.description}</p>
                  </div>
                  {!confirming ? (
                    <button
                      type="button"
                      onClick={() => setConfirmReset(tool.id)}
                      disabled={!canEdit}
                      className={`inline-flex items-center gap-2 px-4 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-50 ${btnClass}`}
                    >
                      <Trash2 size={14} />
                      {tool.buttonLabel}
                    </button>
                  ) : (
                    <div className={`border rounded-lg p-4 space-y-3 ${panelClass}`}>
                      <p className="text-sm font-semibold">Confirm this action</p>
                      <p className="text-xs opacity-90">{tool.confirmDetail}</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmReset(null)}
                          className={`px-4 py-2 border rounded-lg text-sm bg-white ${cancelClass}`}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReset(tool.id)}
                          disabled={resetting}
                          className={`px-4 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-50 ${btnClass}`}
                        >
                          {resetting ? 'Working...' : 'Confirm'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        </>
        )}
      </div>
    </div>
  );
}
