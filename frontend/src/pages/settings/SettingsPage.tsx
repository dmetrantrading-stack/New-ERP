import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import {
  PRIMARY, FINANCE_FONT, financeTabClass, SETTINGS_TABS, SettingsTabKey,
  canAccessSettingsTab, parseSettingsTab, DEFAULT_BIZ,
} from '../../lib/settingsUtils';
import { THERMAL_PRINT_SERVER } from '../../lib/posUtils';
import SettingsPermissionsTab from './SettingsPermissionsTab';
import {
  Settings, Building2, Printer, GitBranch, Shield, Database, Save, Upload,
  Search, Wifi, Trash2, AlertTriangle, RefreshCw,
} from 'lucide-react';
import NumericInput from '../../components/NumericInput';
import { parseNumericField } from '../../lib/utils';
import toast from 'react-hot-toast';

const TAB_ICONS: Record<SettingsTabKey, React.ElementType> = {
  business: Building2,
  printer: Printer,
  workflow: GitBranch,
  permissions: Shield,
  data: Database,
};

const inputClass = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

export default function SettingsPage() {
  const { hasPerm, hasAnyPerm } = useAuth();
  const canEdit = hasPerm('system.settings.edit');
  const [searchParams, setSearchParams] = useSearchParams();

  const tabs = useMemo(
    () => SETTINGS_TABS.filter((t) => canAccessSettingsTab(hasAnyPerm, t.key)),
    [hasAnyPerm],
  );

  const initialTab = parseSettingsTab(searchParams.get('tab')) || tabs[0]?.key || 'business';
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab);

  const [biz, setBiz] = useState<any>({ ...DEFAULT_BIZ });
  const [salesWorkflow, setSalesWorkflow] = useState<{ invoice_copy_mode: 'ordered' | 'delivered' }>({ invoice_copy_mode: 'delivered' });
  const [purchaseWorkflow, setPurchaseWorkflow] = useState({ enforce_approval_limits: true });
  const [roles, setRoles] = useState<any[]>([]);
  const [savingRoles, setSavingRoles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [scanningPorts, setScanningPorts] = useState(false);
  const [comPorts, setComPorts] = useState<any[]>([]);
  const [printerStatus, setPrinterStatus] = useState('');
  const [printServerUp, setPrintServerUp] = useState<boolean | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmingProduct, setConfirmingProduct] = useState(false);
  const [resettingProduct, setResettingProduct] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accountingLockDate, setAccountingLockDate] = useState('');
  const [savingLock, setSavingLock] = useState(false);
  const [importType, setImportType] = useState<'customers' | 'suppliers' | 'inventory' | 'gl'>('customers');
  const [importCsv, setImportCsv] = useState('');
  const [importEntryDate, setImportEntryDate] = useState('');
  const [importing, setImporting] = useState(false);
  const [sigUploading, setSigUploading] = useState<'prepared' | 'approved' | null>(null);

  const setTab = useCallback((key: SettingsTabKey) => {
    setActiveTab(key);
    setSearchParams({ tab: key }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === activeTab)) {
      setTab(tabs[0].key);
    }
  }, [tabs, activeTab, setTab]);

  useEffect(() => {
    const fromUrl = parseSettingsTab(searchParams.get('tab'));
    if (fromUrl && fromUrl !== activeTab && tabs.some((t) => t.key === fromUrl)) {
      setActiveTab(fromUrl);
    }
  }, [searchParams, tabs, activeTab]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [bizRes, wfRes, lockRes, pwRes, rolesRes] = await Promise.all([
        api.get('/settings/business-details'),
        api.get('/settings/sales-workflow'),
        api.get('/settings/accounting-lock'),
        api.get('/settings/purchase-workflow'),
        api.get('/users/roles'),
      ]);
      if (bizRes.data) setBiz({ ...DEFAULT_BIZ, ...bizRes.data });
      setSalesWorkflow({ invoice_copy_mode: wfRes.data?.invoice_copy_mode || 'delivered' });
      setPurchaseWorkflow({ enforce_approval_limits: pwRes.data?.enforce_approval_limits !== false });
      setRoles(rolesRes.data || []);
      setAccountingLockDate(lockRes.data?.accounting_lock_date || '');
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  const checkPrintServer = useCallback(async () => {
    try {
      const st = await fetch(`${THERMAL_PRINT_SERVER}/status`).then((r) => r.json());
      setPrintServerUp(true);
      setPrinterStatus(st.connected ? 'connected' : st.port ? 'saved' : 'idle');
    } catch {
      setPrintServerUp(false);
      setPrinterStatus('');
    }
  }, []);

  useEffect(() => {
    loadAll().then(() => checkPrintServer());
  }, [loadAll, checkPrintServer]);

  const update = (field: string, value: any) => setBiz((prev: any) => ({ ...prev, [field]: value }));

  const scanPorts = async () => {
    setScanningPorts(true);
    try {
      const ports = await fetch(`${THERMAL_PRINT_SERVER}/scan`).then((r) => r.json());
      setComPorts(ports || []);
      setPrintServerUp(true);
      if (ports.length === 0) toast('No COM ports found. Pair the printer via Windows Bluetooth first.');
    } catch {
      setPrintServerUp(false);
      toast.error('Print server not running. Double-click start-print-server.bat in the project folder.');
    }
    setScanningPorts(false);
  };

  const connectPrinter = async (portPath: string) => {
    try {
      const r = await fetch(`${THERMAL_PRINT_SERVER}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portPath }),
      }).then((res) => res.json());
      if (r.connected) {
        update('printer_port', portPath);
        setPrinterStatus('connected');
        toast.success(`Connected to ${portPath}`);
      } else toast.error(r.error || 'Connection failed');
    } catch { toast.error('Print server not running'); }
  };

  const testPrint = async () => {
    try {
      if (printerStatus !== 'connected') {
        await fetch(`${THERMAL_PRINT_SERVER}/auto-connect`, { method: 'POST' });
      }
      const r = await fetch(`${THERMAL_PRINT_SERVER}/test-print`, { method: 'POST' }).then((res) => res.json());
      if (r.success) toast.success('Test print sent!');
      else toast.error(r.error || 'Print failed');
    } catch { toast.error('Print server not running'); }
  };

  const handleSaveBusiness = async () => {
    if (!canEdit) return;
    if (!biz.business_name || !biz.address || !biz.tin_number) {
      toast.error('Business Name, Address, and TIN are required');
      return;
    }
    setSaving(true);
    try {
      await api.put('/settings/business-details', { ...biz, vat_rate: parseNumericField(biz.vat_rate) || 12 });
      toast.success('Business details saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error saving'); }
    finally { setSaving(false); }
  };

  const savePrinterSettings = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put('/settings/business-details', biz);
      toast.success('Printer settings saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error saving'); }
    finally { setSaving(false); }
  };

  const saveSalesWorkflow = async () => {
    if (!canEdit) return;
    setSavingWorkflow(true);
    try {
      await api.put('/settings/sales-workflow', salesWorkflow);
      toast.success('Sales workflow saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSavingWorkflow(false); }
  };

  const savePurchaseWorkflow = async () => {
    if (!canEdit) return;
    setSavingWorkflow(true);
    try {
      await api.put('/settings/purchase-workflow', purchaseWorkflow);
      toast.success('Purchase approval settings saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSavingWorkflow(false); }
  };

  const saveRoleApprovalLimits = async () => {
    if (!canEdit) return;
    setSavingRoles(true);
    try {
      await Promise.all(
        roles.map((r) => api.put(`/users/roles/${r.id}`, {
          approval_limit: parseFloat(r.approval_limit) || 0,
        })),
      );
      toast.success('Role approval limits saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save limits'); }
    finally { setSavingRoles(false); }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await api.post('/settings/upload-logo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setBiz((prev: any) => ({ ...prev, logo_url: res.data.logo_url }));
      toast.success('Logo uploaded');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setLogoUploading(false); }
  };

  const handleSignatureUpload = async (role: 'prepared' | 'approved', e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setSigUploading(role);
    try {
      const formData = new FormData();
      formData.append('signature', file);
      const res = await api.post(`/settings/upload-signature/${role}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const field = role === 'prepared' ? 'prepared_by_signature_url' : 'approved_by_signature_url';
      setBiz((prev: any) => ({ ...prev, [field]: res.data.signature_url }));
      toast.success(`${role === 'prepared' ? 'Prepared by' : 'Approved by'} signature uploaded`);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setSigUploading(null); }
  };

  const saveAccountingLock = async () => {
    if (!canEdit) return;
    setSavingLock(true);
    try {
      await api.put('/settings/accounting-lock', { accounting_lock_date: accountingLockDate || null });
      toast.success(accountingLockDate ? `Period locked through ${accountingLockDate}` : 'Period lock cleared');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save lock'); }
    finally { setSavingLock(false); }
  };

  const handleOpeningImport = async () => {
    if (!canEdit || !importCsv.trim()) { toast.error('Paste CSV data first'); return; }
    setImporting(true);
    try {
      const res = await api.post('/settings/import/opening-balances', {
        type: importType,
        csv: importCsv,
        entry_date: importEntryDate || undefined,
      });
      toast.success(`Imported ${res.data.imported} ${importType} record(s)${res.data.entry_number ? ` · JE ${res.data.entry_number}` : ''}`);
      setImportCsv('');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Import failed'); }
    finally { setImporting(false); }
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportCsv(String(reader.result || ''));
    reader.readAsText(file);
  };

  const handleReset = async () => {
    if (!canEdit) return;
    setResetting(true);
    try {
      await api.post('/settings/reset-transactions');
      toast.success('All transactions reset');
      setConfirming(false);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Reset failed'); }
    finally { setResetting(false); }
  };

  const handleResetProducts = async () => {
    if (!canEdit) return;
    setResettingProduct(true);
    try {
      await api.post('/settings/reset-products');
      toast.success('Products and inventory reset');
      setConfirmingProduct(false);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Reset failed'); }
    finally { setResettingProduct(false); }
  };

  if (tabs.length === 0) {
    return (
      <div className="h-[calc(100vh-4rem)] -m-6 flex items-center justify-center bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
        <p className="text-sm text-gray-600">You do not have permission to view Settings.</p>
      </div>
    );
  }

  const printerKpi = printServerUp === false
    ? 'Server offline'
    : printerStatus === 'connected'
      ? `Connected (${biz.printer_port || 'auto'})`
      : biz.printer_port || 'Not set';

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Settings size={18} className="text-white/90 flex-shrink-0" />
          <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5 overflow-x-auto max-w-full">
            {tabs.map((t) => {
              const Icon = TAB_ICONS[t.key];
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={financeTabClass(activeTab === t.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    <Icon size={13} />
                    {t.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
          {[
            { label: 'Business', value: biz.business_name || '—' },
            { label: 'TIN', value: biz.tin_number || '—' },
            { label: 'VAT', value: biz.vat_type || '—' },
            { label: 'Printer', value: printerKpi },
          ].map((kpi) => (
            <div key={kpi.label} className="px-2.5 py-1 rounded-md bg-white/10 text-white text-xs">
              <span className="text-white/70">{kpi.label}: </span>
              <span className="font-semibold">{kpi.value}</span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => { loadAll(); checkPrintServer(); if (activeTab === 'printer') scanPorts(); }}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/10 text-white hover:bg-white/20 flex-shrink-0"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {!canEdit && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs">
          Read-only mode — you have view access only. Contact an administrator to change settings.
        </div>
      )}

      <div className="flex-1 min-h-0 p-4 overflow-hidden">
        {loading && activeTab !== 'permissions' ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading settings...</div>
        ) : (
          <>
            {activeTab === 'business' && (
              <div className="h-full overflow-y-auto">
                <div className="max-w-4xl mx-auto bg-white rounded-xl border border-gray-200 p-6 space-y-6">
                  <div>
                    <h2 className="text-sm font-semibold text-gray-800">Company Profile</h2>
                    <p className="text-xs text-gray-500 mt-0.5">Used on login, receipts, invoices, and printed documents.</p>
                  </div>

                  <div className="flex items-start gap-6 pb-6 border-b border-gray-100">
                    <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50 flex-shrink-0">
                      {biz.logo_url ? (
                        <img src={biz.logo_url} alt="Logo" className="w-full h-full object-contain" />
                      ) : (
                        <div className="flex flex-col items-center text-gray-400">
                          <Upload size={20} />
                          <span className="text-[9px] mt-1">No logo</span>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700 mb-1">Company Logo</p>
                      <p className="text-xs text-gray-500 mb-3">PNG, JPG, or GIF (max 5MB)</p>
                      {canEdit && (
                        <label className={`inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50 ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                          <Upload size={14} />
                          {logoUploading ? 'Uploading...' : biz.logo_url ? 'Change Logo' : 'Upload Logo'}
                          <input type="file" accept="image/png,image/jpeg,image/gif" onChange={handleLogoUpload} className="hidden" />
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Business Name <span className="text-red-500">*</span></label>
                      <input type="text" value={biz.business_name} onChange={(e) => update('business_name', e.target.value)} disabled={!canEdit} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Trade Name</label>
                      <input type="text" value={biz.trade_name || ''} onChange={(e) => update('trade_name', e.target.value)} disabled={!canEdit} className={inputClass} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Address <span className="text-red-500">*</span></label>
                      <input type="text" value={biz.address} onChange={(e) => update('address', e.target.value)} disabled={!canEdit} className={inputClass} />
                    </div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">Barangay</label><input type="text" value={biz.barangay || ''} onChange={(e) => update('barangay', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">City</label><input type="text" value={biz.city || ''} onChange={(e) => update('city', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">Province</label><input type="text" value={biz.province || ''} onChange={(e) => update('province', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">ZIP Code</label><input type="text" value={biz.zip_code || ''} onChange={(e) => update('zip_code', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">Mobile</label><input type="text" value={biz.mobile_number || ''} onChange={(e) => update('mobile_number', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">Telephone</label><input type="text" value={biz.telephone_number || ''} onChange={(e) => update('telephone_number', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">Email</label><input type="text" value={biz.email_address || ''} onChange={(e) => update('email_address', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">TIN <span className="text-red-500">*</span></label>
                      <input type="text" value={biz.tin_number} onChange={(e) => update('tin_number', e.target.value)} disabled={!canEdit} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">VAT Type</label>
                      <select value={biz.vat_type} onChange={(e) => update('vat_type', e.target.value)} disabled={!canEdit} className={inputClass}>
                        <option>VAT Registered</option><option>Non-VAT</option><option>Zero Rated</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">VAT Rate (%)</label>
                      <NumericInput value={biz.vat_rate ?? ''} onValueChange={(vat_rate) => update('vat_rate', vat_rate)} disabled={!canEdit} className={inputClass} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div><label className="block text-xs font-medium text-gray-600 mb-1">Website</label><input type="text" value={biz.website || ''} onChange={(e) => update('website', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Date Format</label>
                      <select value={biz.date_format} onChange={(e) => update('date_format', e.target.value)} disabled={!canEdit} className={inputClass}>
                        <option>MM/DD/YYYY</option><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option>
                      </select>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-4">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Document Signatories</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div><label className="block text-xs font-medium text-gray-600 mb-1">Prepared By</label><input type="text" value={biz.prepared_by || ''} onChange={(e) => update('prepared_by', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                      <div><label className="block text-xs font-medium text-gray-600 mb-1">Position</label><input type="text" value={biz.prepared_by_position || ''} onChange={(e) => update('prepared_by_position', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                      <div><label className="block text-xs font-medium text-gray-600 mb-1">Approved By</label><input type="text" value={biz.approved_by || ''} onChange={(e) => update('approved_by', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                      <div><label className="block text-xs font-medium text-gray-600 mb-1">Position</label><input type="text" value={biz.approved_by_position || ''} onChange={(e) => update('approved_by_position', e.target.value)} disabled={!canEdit} className={inputClass} /></div>
                    </div>
                    {canEdit && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Prepared By Signature</label>
                          <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-xs text-gray-600">
                            <Upload size={14} /> {sigUploading === 'prepared' ? 'Uploading...' : 'Upload PNG/JPG'}
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => handleSignatureUpload('prepared', e)} className="hidden" />
                          </label>
                          {biz.prepared_by_signature_url && <img src={`${biz.prepared_by_signature_url}?t=${Date.now()}`} alt="Prepared signature" className="mt-2 h-10 object-contain" />}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Approved By Signature</label>
                          <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-xs text-gray-600">
                            <Upload size={14} /> {sigUploading === 'approved' ? 'Uploading...' : 'Upload PNG/JPG'}
                            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => handleSignatureUpload('approved', e)} className="hidden" />
                          </label>
                          {biz.approved_by_signature_url && <img src={`${biz.approved_by_signature_url}?t=${Date.now()}`} alt="Approved signature" className="mt-2 h-10 object-contain" />}
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-gray-400 mt-2">Signatures appear on Sales Invoice, Delivery Receipt, Petty Cash, and Sales Return prints.</p>
                  </div>

                  {canEdit && (
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                      <button type="button" onClick={loadAll} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Discard Changes</button>
                      <button type="button" onClick={handleSaveBusiness} disabled={saving} className="flex items-center gap-2 px-6 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                        <Save size={14} /> {saving ? 'Saving...' : 'Save Business Details'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'printer' && (
              <div className="h-full overflow-y-auto">
                <div className="max-w-3xl mx-auto space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
                    <p className="font-semibold mb-1">Hybrid cloud — local print bridge</p>
                    <p className="text-blue-800 text-xs">
                      ERP runs in the browser (office or cloud). Thermal receipts still print from <strong>this cashier PC</strong>.
                      Double-click <code className="bg-white/80 px-1 rounded font-semibold">start-print-server.bat</code> here and keep that window open.
                      POS connects to <code className="bg-white/80 px-1 rounded">localhost:9999</code> on this machine only.
                    </p>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-gray-800">POS Printer</h2>
                        <p className="text-xs text-gray-500">Bluetooth thermal printer (ESC/POS via COM port)</p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        printServerUp === false ? 'bg-red-100 text-red-700'
                          : printerStatus === 'connected' ? 'bg-green-100 text-green-700'
                            : printServerUp ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {printServerUp === false ? 'Server offline' : printerStatus === 'connected' ? 'Connected' : printServerUp ? 'Server online' : 'Checking...'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Printer Name</label>
                        <input type="text" value={biz.printer_name || 'PT-210'} onChange={(e) => update('printer_name', e.target.value)} disabled={!canEdit} className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Connection</label>
                        <select value={biz.printer_type || 'Bluetooth'} onChange={(e) => update('printer_type', e.target.value)} disabled={!canEdit} className={inputClass}>
                          <option>USB</option><option>Bluetooth</option><option>Network</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Paper Size</label>
                        <select value={biz.paper_size || 58} onChange={(e) => update('paper_size', parseInt(e.target.value, 10))} disabled={!canEdit} className={inputClass}>
                          <option value={58}>58mm</option><option value={80}>80mm</option>
                        </select>
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                          <input type="checkbox" checked={!!biz.auto_print} onChange={(e) => update('auto_print', e.target.checked)} disabled={!canEdit} className="w-4 h-4 rounded" />
                          Auto print after sale
                        </label>
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-800">COM Port</h3>
                          <p className="text-xs text-gray-500">Pair printer in Windows Bluetooth, then scan</p>
                        </div>
                        <button type="button" onClick={scanPorts} disabled={scanningPorts} className="flex items-center gap-1 px-3 py-1.5 bg-blue-700 text-white rounded-lg text-xs font-semibold hover:bg-blue-800 disabled:opacity-50">
                          <Search size={12} /> {scanningPorts ? 'Scanning...' : 'Scan Ports'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Saved Port</label>
                          <div className="flex gap-2">
                            <select value={biz.printer_port || ''} onChange={(e) => update('printer_port', e.target.value)} disabled={!canEdit} className={`flex-1 ${inputClass}`}>
                              <option value="">Not Set</option>
                              {biz.printer_port && !comPorts.find((p) => p.path === biz.printer_port) && (
                                <option value={biz.printer_port}>{biz.printer_port} (saved)</option>
                              )}
                              {comPorts.map((p: any) => (
                                <option key={p.path} value={p.path}>{p.path} — {p.friendlyName || p.manufacturer}</option>
                              ))}
                            </select>
                            <button type="button" onClick={() => { const port = biz.printer_port; if (port) connectPrinter(port); }} disabled={!biz.printer_port} className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50 whitespace-nowrap">Connect</button>
                          </div>
                        </div>
                        <div className="flex items-end gap-2 flex-wrap">
                          <button type="button" onClick={testPrint} className="px-4 py-2 bg-gray-700 text-white rounded-lg text-xs font-semibold hover:bg-gray-800">Test Print</button>
                          {printerStatus === 'connected' && (
                            <span className="flex items-center gap-1 text-xs text-green-600"><Wifi size={12} /> Connected</span>
                          )}
                          {comPorts.length > 0 && <span className="text-xs text-gray-500">{comPorts.length} port(s) found</span>}
                        </div>
                      </div>

                      {comPorts.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 text-xs">
                          <span className="text-gray-500 font-medium">Detected:</span>
                          {comPorts.map((p: any) => (
                            <span key={p.path} className={`px-1.5 py-0.5 rounded ${p.path === biz.printer_port ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                              {p.path}{p.friendlyName?.toLowerCase().includes('bluetooth') ? ' (BT)' : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {canEdit && (
                      <div className="flex justify-end pt-2">
                        <button type="button" onClick={savePrinterSettings} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                          <Save size={14} /> {saving ? 'Saving...' : 'Save Printer Settings'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'workflow' && (
              <div className="h-full overflow-y-auto">
                <div className="max-w-2xl mx-auto space-y-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-800">Sales Workflow</h2>
                      <p className="text-xs text-gray-500 mt-0.5">Controls how Sales Order lines copy into a new Sales Invoice.</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Copy to Sales Invoice</label>
                      <select
                        value={salesWorkflow.invoice_copy_mode}
                        onChange={(e) => setSalesWorkflow({ invoice_copy_mode: e.target.value as 'ordered' | 'delivered' })}
                        disabled={!canEdit}
                        className={inputClass}
                      >
                        <option value="delivered">Delivered quantities only</option>
                        <option value="ordered">All ordered quantities</option>
                      </select>
                    </div>
                    {canEdit && (
                      <button type="button" onClick={saveSalesWorkflow} disabled={savingWorkflow} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                        <Save size={14} /> {savingWorkflow ? 'Saving...' : 'Save Sales Workflow'}
                      </button>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-800">Purchase Approval Limits</h2>
                      <p className="text-xs text-gray-500 mt-0.5">Block PR approval, PO send, and APV post when amount exceeds a role&apos;s limit. Admin/Owner bypass. 0 = unlimited.</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={purchaseWorkflow.enforce_approval_limits}
                        onChange={(e) => setPurchaseWorkflow({ enforce_approval_limits: e.target.checked })}
                        disabled={!canEdit}
                        className="rounded"
                      />
                      Enforce approval limits
                    </label>
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-600">Role</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-600">Max Amount (₱)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {roles.map((r) => (
                            <tr key={r.id} className="border-t border-gray-100">
                              <td className="px-3 py-2 font-medium">{r.name}</td>
                              <td className="px-3 py-2 text-right">
                                <NumericInput
                                  value={r.approval_limit || ''}
                                  onValueChange={(v) => setRoles((prev) => prev.map((x) => x.id === r.id ? { ...x, approval_limit: v } : x))}
                                  disabled={!canEdit}
                                  className="w-32 ml-auto px-2 py-1 border border-gray-200 rounded text-right"
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={savePurchaseWorkflow} disabled={savingWorkflow} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                          <Save size={14} /> {savingWorkflow ? 'Saving...' : 'Save Approval Toggle'}
                        </button>
                        <button type="button" onClick={saveRoleApprovalLimits} disabled={savingRoles} className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                          <Save size={14} /> {savingRoles ? 'Saving...' : 'Save Role Limits'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'permissions' && (
              <SettingsPermissionsTab />
            )}

            {activeTab === 'data' && (
              <div className="h-full overflow-y-auto">
                <div className="max-w-2xl mx-auto space-y-4">
                  <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Accounting Period Lock</h2>
                      <p className="text-xs text-gray-500 mt-1">Block new transactions on or before this date. Leave empty to unlock.</p>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="flex-1 min-w-[160px]">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Lock through date</label>
                        <input type="date" value={accountingLockDate} onChange={(e) => setAccountingLockDate(e.target.value)} disabled={!canEdit} className={inputClass} />
                      </div>
                      {canEdit && (
                        <button type="button" onClick={saveAccountingLock} disabled={savingLock} className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                          {savingLock ? 'Saving...' : 'Save Lock'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Opening Balance Import</h2>
                      <p className="text-xs text-gray-500 mt-1">Paste CSV or upload a file for go-live cutover.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Import type</label>
                        <select value={importType} onChange={(e) => setImportType(e.target.value as any)} disabled={!canEdit} className={inputClass}>
                          <option value="customers">Customers (customer_code, customer_name, balance)</option>
                          <option value="suppliers">Suppliers (supplier_code, supplier_name, balance)</option>
                          <option value="inventory">Inventory (sku, quantity, unit_cost)</option>
                          <option value="gl">GL Opening (account_code, debit, credit)</option>
                        </select>
                      </div>
                      {importType === 'gl' && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Journal entry date</label>
                          <input type="date" value={importEntryDate} onChange={(e) => setImportEntryDate(e.target.value)} disabled={!canEdit} className={inputClass} />
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">CSV data</label>
                      <textarea value={importCsv} onChange={(e) => setImportCsv(e.target.value)} disabled={!canEdit} rows={6} placeholder="Paste CSV with header row..." className={`${inputClass} font-mono text-xs`} />
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        <label className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-xs cursor-pointer hover:bg-gray-50">
                          <Upload size={14} /> Upload CSV
                          <input type="file" accept=".csv,text/csv" onChange={handleImportFile} className="hidden" />
                        </label>
                        <button type="button" onClick={handleOpeningImport} disabled={importing} className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                          {importing ? 'Importing...' : 'Run Import'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
                    <AlertTriangle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-800">Danger zone</p>
                      <p className="text-xs text-red-700 mt-1">These actions permanently delete data and cannot be undone. Master records like chart of accounts and user accounts are preserved where noted.</p>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Reset All Transactions</h2>
                      <p className="text-xs text-gray-500 mt-1">Clears sales, purchases, POS, payroll, petty cash vouchers, journal entries, and related transactional data. Keeps products, customers, suppliers, COA, and settings.</p>
                    </div>
                    {!confirming ? (
                      <button type="button" onClick={() => setConfirming(true)} disabled={!canEdit} className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                        <Trash2 size={14} /> Reset All Transactions
                      </button>
                    ) : (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
                        <p className="text-sm font-semibold text-red-800">Confirm transaction reset</p>
                        <p className="text-xs text-red-600">All invoices, POs, journal entries, POS shifts, collections, payroll, petty cash vouchers, and audit logs will be deleted.</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setConfirming(false)} className="px-4 py-2 border border-red-300 rounded-lg text-sm text-red-700">Cancel</button>
                          <button type="button" onClick={handleReset} disabled={resetting} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">{resetting ? 'Resetting...' : 'Confirm Reset'}</button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-xl border border-orange-200 p-6 space-y-4">
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">Reset Products & Inventory</h2>
                      <p className="text-xs text-gray-500 mt-1">Deletes all products, inventory quantities, batches, price history, and inventory ledger.</p>
                    </div>
                    {!confirmingProduct ? (
                      <button type="button" onClick={() => setConfirmingProduct(true)} disabled={!canEdit} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 disabled:opacity-50">
                        <Trash2 size={14} /> Reset Products
                      </button>
                    ) : (
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-3">
                        <p className="text-sm font-semibold text-orange-800">Confirm product reset</p>
                        <p className="text-xs text-orange-600">All product master records and stock data will be permanently deleted.</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => setConfirmingProduct(false)} className="px-4 py-2 border border-orange-300 rounded-lg text-sm text-orange-700">Cancel</button>
                          <button type="button" onClick={handleResetProducts} disabled={resettingProduct} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">{resettingProduct ? 'Resetting...' : 'Confirm Reset'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
