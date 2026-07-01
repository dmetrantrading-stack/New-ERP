import React, { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { DEFAULT_BIZ, SETTINGS_INPUT_CLASS, SETTINGS_SECTIONS } from '../../lib/settingsUtils';
import { THERMAL_PRINT_SERVER } from '../../lib/posUtils';
import SettingsSubNav from './SettingsSubNav';
import NumericInput from '../../components/NumericInput';
import { Save, Search, Wifi } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPosTab({
  section,
  onSectionChange,
}: {
  section: string;
  onSectionChange: (key: string) => void;
}) {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('system.settings.edit');
  const [biz, setBiz] = useState<any>({ ...DEFAULT_BIZ });
  const [loyalty, setLoyalty] = useState({ enabled: true, earn_peso_per_point: '1', redeem_peso_per_point: '1' });
  const [saving, setSaving] = useState(false);
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanningPorts, setScanningPorts] = useState(false);
  const [comPorts, setComPorts] = useState<any[]>([]);
  const [printerStatus, setPrinterStatus] = useState('');
  const [printServerUp, setPrintServerUp] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bizRes, loyaltyRes] = await Promise.all([
        api.get('/settings/business-details'),
        api.get('/settings/loyalty'),
      ]);
      if (bizRes.data) setBiz({ ...DEFAULT_BIZ, ...bizRes.data });
      setLoyalty({
        enabled: loyaltyRes.data?.enabled !== false,
        earn_peso_per_point: String(loyaltyRes.data?.earn_peso_per_point ?? 1),
        redeem_peso_per_point: String(loyaltyRes.data?.redeem_peso_per_point ?? 1),
      });
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

  useEffect(() => { load().then(() => checkPrintServer()); }, [load, checkPrintServer]);

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
      toast.error('Print server not running. Run start-print-server.bat on this PC.');
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

  const savePrinter = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put('/settings/business-details', biz);
      toast.success('Printer settings saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error saving'); }
    finally { setSaving(false); }
  };

  const saveLoyalty = async () => {
    if (!canEdit) return;
    const earn = parseFloat(loyalty.earn_peso_per_point);
    const redeem = parseFloat(loyalty.redeem_peso_per_point);
    if (!Number.isFinite(earn) || earn <= 0 || !Number.isFinite(redeem) || redeem <= 0) {
      toast.error('Loyalty rates must be positive numbers');
      return;
    }
    setSavingLoyalty(true);
    try {
      const res = await api.put('/settings/loyalty', {
        enabled: loyalty.enabled,
        earn_peso_per_point: earn,
        redeem_peso_per_point: redeem,
      });
      setLoyalty({
        enabled: res.data?.enabled !== false,
        earn_peso_per_point: String(res.data?.earn_peso_per_point ?? earn),
        redeem_peso_per_point: String(res.data?.redeem_peso_per_point ?? redeem),
      });
      toast.success('Loyalty settings saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSavingLoyalty(false); }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading POS settings...</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <SettingsSubNav sections={SETTINGS_SECTIONS.pos} active={section} onChange={onSectionChange} />

        {section === 'printer' && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
              <p className="font-semibold mb-1">Hybrid cloud — local print bridge</p>
              <p className="text-blue-800 text-xs">
                Thermal receipts print from <strong>this cashier PC</strong>. Run <code className="bg-white/80 px-1 rounded font-semibold">start-print-server.bat</code> and keep it open. POS uses <code className="bg-white/80 px-1 rounded">localhost:9999</code>.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-800">Thermal Printer</h2>
                  <p className="text-xs text-gray-500">Bluetooth ESC/POS via COM port</p>
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
                  <input type="text" value={biz.printer_name || 'PT-210'} onChange={(e) => update('printer_name', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Connection</label>
                  <select value={biz.printer_type || 'Bluetooth'} onChange={(e) => update('printer_type', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS}>
                    <option>USB</option><option>Bluetooth</option><option>Network</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Paper Size</label>
                  <select value={biz.paper_size || 58} onChange={(e) => update('paper_size', parseInt(e.target.value, 10))} disabled={!canEdit} className={SETTINGS_INPUT_CLASS}>
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
                      <select value={biz.printer_port || ''} onChange={(e) => update('printer_port', e.target.value)} disabled={!canEdit} className={`flex-1 ${SETTINGS_INPUT_CLASS}`}>
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
                  </div>
                </div>
              </div>

              {canEdit && (
                <div className="flex justify-end pt-2">
                  <button type="button" onClick={savePrinter} disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                    <Save size={14} /> {saving ? 'Saving...' : 'Save Printer Settings'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {section === 'loyalty' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Loyalty Program</h2>
              <p className="text-xs text-gray-500 mt-0.5">How customers earn and redeem points at the register.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={loyalty.enabled} onChange={(e) => setLoyalty((prev) => ({ ...prev, enabled: e.target.checked }))} disabled={!canEdit} className="rounded" />
              Enable loyalty program at POS
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Earn — peso spend per 1 point</label>
                <NumericInput value={loyalty.earn_peso_per_point} onValueChange={(earn_peso_per_point) => setLoyalty((prev) => ({ ...prev, earn_peso_per_point }))} disabled={!canEdit || !loyalty.enabled} className={SETTINGS_INPUT_CLASS} />
                <p className="text-[10px] text-gray-400 mt-1">Example: 100 = 1 point per ₱100 net sale.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Redeem — peso value per 1 point</label>
                <NumericInput value={loyalty.redeem_peso_per_point} onValueChange={(redeem_peso_per_point) => setLoyalty((prev) => ({ ...prev, redeem_peso_per_point }))} disabled={!canEdit || !loyalty.enabled} className={SETTINGS_INPUT_CLASS} />
                <p className="text-[10px] text-gray-400 mt-1">Example: 1 = each point gives ₱1 off.</p>
              </div>
            </div>
            {loyalty.enabled && (
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Preview: earn 1 point per ₱{loyalty.earn_peso_per_point || '—'} spent · redeem 1 point = ₱{loyalty.redeem_peso_per_point || '—'} off
              </p>
            )}
            {canEdit && (
              <button type="button" onClick={saveLoyalty} disabled={savingLoyalty} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                <Save size={14} /> {savingLoyalty ? 'Saving...' : 'Save Loyalty Settings'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
