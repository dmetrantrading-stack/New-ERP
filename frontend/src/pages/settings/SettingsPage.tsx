import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Trash2, AlertTriangle, Save, Search, Wifi, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmingProduct, setConfirmingProduct] = useState(false);
  const [resettingProduct, setResettingProduct] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanningPorts, setScanningPorts] = useState(false);
  const [comPorts, setComPorts] = useState<any[]>([]);
  const [printerStatus, setPrinterStatus] = useState<string>('');

  const [biz, setBiz] = useState<any>({
    business_name: '', trade_name: '', address: '', barangay: '', city: '', province: '', zip_code: '',
    mobile_number: '', telephone_number: '', email_address: '', website: '',
    tin_number: '', vat_type: 'VAT Registered', vat_rate: 12,
    prepared_by: '', prepared_by_position: '', approved_by: '', approved_by_position: '',
    currency: 'PHP', date_format: 'MM/DD/YYYY', logo_url: '',
  });

  useEffect(() => {
    api.get('/settings/business-details').then(r => { if (r.data) { setBiz(r.data); if (r.data.printer_port) scanPorts(); } }).catch(() => {});
  }, []);

  const scanPorts = async () => {
    setScanningPorts(true);
    try {
      const ports = await fetch('http://localhost:9999/scan').then(r => r.json());
      setComPorts(ports || []);
      if (ports.length === 0) toast('No COM ports found. Is the printer paired via Windows Bluetooth?');
    } catch { toast.error('Print server not running. Start: cd thermal-print-server && npm start'); }
    setScanningPorts(false);
  };

  const connectPrinter = async (portPath: string) => {
    try {
      const r = await fetch('http://localhost:9999/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portPath }),
      }).then(r => r.json());
      if (r.connected) { update('printer_port', portPath); setPrinterStatus('connected'); toast.success(`Connected to ${portPath}`); }
      else toast.error(r.error || 'Connection failed');
    } catch { toast.error('Print server not running'); }
  };

  const testPrint = async () => {
    try {
      // Auto-connect first if port not connected
      if (printerStatus !== 'connected') {
        await fetch('http://localhost:9999/auto-connect', { method: 'POST' });
      }
      const r = await fetch('http://localhost:9999/test-print', { method: 'POST' }).then(r => r.json());
      if (r.success) toast.success('Test print sent! Check the printer.');
      else toast.error(r.error || 'Print failed');
    } catch { toast.error('Print server not running'); }
  };

  const handleSave = async () => {
    if (!biz.business_name || !biz.address || !biz.tin_number) { toast.error('Business Name, Address, and TIN are required'); return; }
    setSaving(true);
    try { await api.put('/settings/business-details', biz); toast.success('Business details saved'); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
    finally { setSaving(false); }
  };

  const update = (field: string, value: any) => setBiz({ ...biz, [field]: value });

  const handleReset = async () => {
    setResetting(true);
    try { await api.post('/settings/reset-transactions'); toast.success('All transactions reset'); setConfirming(false); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Reset failed'); }
    finally { setResetting(false); }
  };

  const handleResetProducts = async () => {
    setResettingProduct(true);
    try { await api.post('/settings/reset-products'); toast.success('Products, inventory, and price history reset'); setConfirmingProduct(false); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Reset failed'); }
    finally { setResettingProduct(false); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Business Details */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Basic Business Details</h2>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Business Name <span className="text-red-500">*</span></label>
              <input type="text" value={biz.business_name} onChange={e => update('business_name', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Trade Name (Optional)</label>
              <input type="text" value={biz.trade_name || ''} onChange={e => update('trade_name', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Address <span className="text-red-500">*</span></label>
              <input type="text" value={biz.address} onChange={e => update('address', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div><label className="block text-sm font-medium mb-1">Barangay</label><input type="text" value={biz.barangay || ''} onChange={e => update('barangay', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">City</label><input type="text" value={biz.city || ''} onChange={e => update('city', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">Province</label><input type="text" value={biz.province || ''} onChange={e => update('province', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">ZIP Code</label><input type="text" value={biz.zip_code || ''} onChange={e => update('zip_code', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium mb-1">Mobile Number</label><input type="text" value={biz.mobile_number || ''} onChange={e => update('mobile_number', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">Telephone</label><input type="text" value={biz.telephone_number || ''} onChange={e => update('telephone_number', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div><label className="block text-sm font-medium mb-1">Email Address</label><input type="text" value={biz.email_address || ''} onChange={e => update('email_address', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">TIN Number <span className="text-red-500">*</span></label>
              <input type="text" value={biz.tin_number} onChange={e => update('tin_number', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT Type</label>
              <select value={biz.vat_type} onChange={e => update('vat_type', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option>VAT Registered</option><option>Non-VAT</option><option>Zero Rated</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">VAT Rate (%)</label>
              <input type="number" value={biz.vat_rate || 12} onChange={e => update('vat_rate', parseFloat(e.target.value))} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Website</label><input type="text" value={biz.website || ''} onChange={e => update('website', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div>
              <label className="block text-sm font-medium mb-1">Date Format</label>
              <select value={biz.date_format} onChange={e => update('date_format', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option>MM/DD/YYYY</option><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Prepared By</label>
              <input type="text" value={biz.prepared_by || ''} onChange={e => update('prepared_by', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div><label className="block text-sm font-medium mb-1">Position</label><input type="text" value={biz.prepared_by_position || ''} onChange={e => update('prepared_by_position', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
            <div>
              <label className="block text-sm font-medium mb-1">Approved By</label>
              <input type="text" value={biz.approved_by || ''} onChange={e => update('approved_by', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div><label className="block text-sm font-medium mb-1">Position</label><input type="text" value={biz.approved_by_position || ''} onChange={e => update('approved_by_position', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" /></div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button onClick={() => { api.get('/settings/business-details').then(r => { if (r.data) setBiz(r.data); }).catch(() => {}); }} className="px-4 py-2 border rounded-lg text-sm">Reset</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              <Save size={14} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Printer Configuration */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">POS Printer Configuration</h2>
        
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-1">Printer Name</label>
            <input type="text" value={biz.printer_name || 'PT-210'} onChange={e => update('printer_name', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="PT-210" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Printer Type</label>
            <select value={biz.printer_type || 'Bluetooth'} onChange={e => update('printer_type', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option>USB</option><option>Bluetooth</option><option>Network</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Paper Size</label>
            <select value={biz.paper_size || 58} onChange={e => update('paper_size', parseInt(e.target.value))} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value={58}>58mm</option><option value={80}>80mm</option>
            </select>
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={biz.auto_print || false} onChange={e => update('auto_print', e.target.checked)} className="w-4 h-4 rounded" />
              <span className="text-sm font-medium">Auto Print After Sale</span>
            </label>
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Bluetooth COM Port</h3>
              <p className="text-xs text-gray-500">Select the COM port for your Bluetooth printer</p>
            </div>
            <button onClick={scanPorts} disabled={scanningPorts} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50">
              <Search size={12} /> {scanningPorts ? 'Scanning...' : 'Scan Ports'}
            </button>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Saved Port</label>
              <div className="flex gap-2">
                <select value={biz.printer_port || ''} onChange={e => update('printer_port', e.target.value)} className="flex-1 px-3 py-2 border rounded-lg text-sm">
                  <option value="">Not Set</option>
                  {biz.printer_port && !comPorts.find(p => p.path === biz.printer_port) && (
                    <option value={biz.printer_port}>{biz.printer_port} (saved)</option>
                  )}
                  {comPorts.map((p: any) => (
                    <option key={p.path} value={p.path}>{p.path} — {p.friendlyName || p.manufacturer}</option>
                  ))}
                </select>
                <button onClick={() => { const port = biz.printer_port; if (port) connectPrinter(port); }} className="px-3 py-2 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 whitespace-nowrap">Connect</button>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <button onClick={testPrint} className="px-4 py-2 bg-gray-600 text-white rounded-lg text-xs hover:bg-gray-700">Test Print</button>
              {comPorts.length > 0 && <span className="text-xs text-gray-500">{comPorts.length} port(s)</span>}
              {printerStatus === 'connected' && <span className="flex items-center gap-1 text-xs text-green-600"><Wifi size={12} /> Connected</span>}
            </div>
          </div>

          {comPorts.length > 0 && (
            <div className="mt-3 text-xs text-gray-500">
              <strong>Detected:</strong>
              {comPorts.map((p: any) => (
                <span key={p.path} className={`ml-2 px-1.5 py-0.5 rounded ${p.path === biz.printer_port ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}>
                  {p.path}{p.friendlyName?.toLowerCase().includes('bluetooth') ? ' BT' : ''}
                </span>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-400">
          Pair printer via Windows Bluetooth, then <strong>Scan Ports</strong> to detect. Select port → <strong>Connect</strong> → <strong>Test Print</strong>. 
          Keep print server running: <code className="bg-gray-100 px-1 rounded">cd thermal-print-server && npm start</code>
        </p>
      </div>

      {/* Reset Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Reset Transactions</h2>
          <p className="text-sm text-gray-500 mt-1">Clear all transactional data while preserving master data (products, categories, customers, suppliers, chart of accounts, and settings).</p>
          {!confirming ? (
            <button onClick={() => setConfirming(true)} className="mt-4 flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
              <Trash2 size={14} /> Reset All Transactions
            </button>
          ) : (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-red-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Warning: This cannot be undone</p>
                  <p className="text-xs text-red-600 mt-1">All invoices, POs, journal entries, payments, POS shifts, collections, stock transfers, expenses, attendance, payroll, cash advances, grocery credits, SSS contributions, and employee balances will be permanently deleted.</p>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setConfirming(false)} className="px-4 py-2 border border-red-300 rounded-lg text-sm text-red-700 hover:bg-red-50">Cancel</button>
                    <button onClick={handleReset} disabled={resetting} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">{resetting ? 'Resetting...' : 'Confirm Reset'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <hr className="border-gray-200" />

        <div>
          <h2 className="text-lg font-semibold text-gray-900">Reset Products</h2>
          <p className="text-sm text-gray-500 mt-1">Delete all products, inventory, batches, price history, and inventory ledger. This also removes product master records.</p>
          {!confirmingProduct ? (
            <button onClick={() => setConfirmingProduct(true)} className="mt-4 flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700">
              <Trash2 size={14} /> Reset Products
            </button>
          ) : (
            <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-orange-600 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-orange-800">Warning: This cannot be undone</p>
                  <p className="text-xs text-orange-600 mt-1">All products, inventory quantities, batch records, supplier price history, and inventory ledger will be permanently deleted.</p>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => setConfirmingProduct(false)} className="px-4 py-2 border border-orange-300 rounded-lg text-sm text-orange-700 hover:bg-orange-50">Cancel</button>
                    <button onClick={handleResetProducts} disabled={resettingProduct} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50">{resettingProduct ? 'Resetting...' : 'Confirm Reset'}</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
