import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { CheckSquare, Square, Save, ArrowLeft, Copy } from 'lucide-react';
import toast from 'react-hot-toast';

const MODULE_TREE = [
  { module: 'Dashboard', key: 'dashboard', icon: null, submodules: [
    { name: 'Dashboard', key: 'dashboard', actions: ['view'] },
  ]},
  { module: 'Sales', key: null, icon: null, submodules: [
    { name: 'Sales Invoice', key: 'sales.sales-invoice', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Delivery Receipt', key: 'sales.delivery-receipt', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Collection Receipt', key: 'sales.collection-receipt', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Collections', key: 'sales.collections', actions: ['view','create','edit','delete','print','approve','export'] },
  ]},
  { module: 'Purchases', key: null, icon: null, submodules: [
    { name: 'Purchase Order', key: 'purchases.purchase-order', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Receiving Report', key: 'purchases.receiving-report', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'AP Voucher', key: 'purchases.apv', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Disbursement Voucher', key: 'purchases.dv', actions: ['view','create','edit','delete','print','approve','export'] },
  ]},
  { module: 'Inventory', key: null, icon: null, submodules: [
    { name: 'Inventory', key: 'inventory.inventory', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Production', key: 'inventory.production', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Inventory Counts', key: 'inventory.counts', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Stock Transfers', key: 'inventory.stock-transfer', actions: ['view','create','edit','delete','print','approve','export'] },
  ]},
  { module: 'Finance', key: null, icon: null, submodules: [
    { name: 'Accounting', key: 'finance.accounting', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Bank & Cash', key: 'finance.bank-cash', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Expenses', key: 'finance.expenses', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Petty Cash', key: 'finance.petty-cash', actions: ['view','create','edit','delete','print','approve','export'] },
  ]},
  { module: 'HR & Payroll', key: null, icon: null, submodules: [
    { name: 'Employees', key: 'hr.employees', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Attendance', key: 'hr.attendance', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Payroll', key: 'hr.payroll', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Payslip', key: 'hr.payslip', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Cash Advances', key: 'hr.cash-advances', actions: ['view','create','edit','delete','print','approve','export'] },
  ]},
  { module: 'Reports', key: 'reports', icon: null, submodules: [
    { name: 'Reports', key: 'reports', actions: ['view'] },
  ]},
  { module: 'Settings', key: null, icon: null, submodules: [
    { name: 'Users', key: 'system.users', actions: ['view','create','edit','delete'] },
    { name: 'Business Details', key: 'system.settings', actions: ['view','edit'] },
  ]},
];

export default function PermissionEditor() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const [user, setUser] = useState<any>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [copyFromId, setCopyFromId] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.get('/users').then(r => {
      const list = r.data?.value || r.data || [];
      setUsers(list);
      if (userId) {
        const u = list.find((x: any) => x.id === userId);
        setUser(u || null);
      }
    }).catch(() => {});
    if (userId) {
      api.get(`/users/${userId}/permissions`).then(r => setPermissions(r.data.permissions || [])).catch(() => {});
    }
  }, [userId]);

  const togglePerm = (key: string) => {
    setPermissions(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const toggleModule = (mod: any) => {
    const allKeys = mod.submodules.flatMap((sm: any) => sm.actions.map((a: string) => sm.key + '.' + a));
    const allChecked = allKeys.every((k: string) => permissions.includes(k));
    if (allChecked) {
      setPermissions(prev => prev.filter(k => !allKeys.includes(k)));
    } else {
      setPermissions(prev => [...new Set([...prev, ...allKeys])]);
    }
  };

  const toggleSubmodule = (sm: any) => {
    const keys = sm.actions.map((a: string) => sm.key + '.' + a);
    const allChecked = keys.every((k: string) => permissions.includes(k));
    if (allChecked) {
      setPermissions(prev => prev.filter(k => !keys.includes(k)));
    } else {
      setPermissions(prev => [...new Set([...prev, ...keys])]);
    }
  };

  const selectAll = () => {
    const all = MODULE_TREE.flatMap(m => m.submodules.flatMap(sm => sm.actions.map(a => sm.key + '.' + a)));
    setPermissions(all);
  };

  const clearAll = () => setPermissions([]);

  const copyFromUser = async () => {
    if (!copyFromId) return;
    try {
      const r = await api.post(`/users/${userId}/copy-permissions/${copyFromId}`);
      toast.success(`${r.data.copied} permissions copied`);
      api.get(`/users/${userId}/permissions`).then(r2 => setPermissions(r2.data.permissions || [])).catch(() => {});
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/users/${userId}/permissions`, { permissions });
      toast.success('Permissions saved');
      await refreshUser();
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/settings')} className="p-2 hover:bg-gray-100 rounded"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">User Permissions</h1>
            <p className="text-sm text-gray-500">{user?.full_name || 'Loading...'} ({user?.username || ''})</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={selectAll} className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50">Select All</button>
          <button onClick={clearAll} className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50">Clear All</button>
          <div className="flex items-center gap-2 border rounded px-2">
            <Copy size={14} className="text-gray-400" />
            <select value={copyFromId} onChange={e => setCopyFromId(e.target.value)} className="text-xs py-1.5 bg-transparent outline-none">
              <option value="">Copy from...</option>
              {users.filter(u => u.id !== userId).map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.role_name})</option>)}
            </select>
            <button onClick={copyFromUser} disabled={!copyFromId} className="px-2 py-1 text-xs bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50">Copy</button>
          </div>
          <button onClick={save} disabled={saving} className="flex items-center gap-1 px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"><Save size={14} /> Save</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {MODULE_TREE.map(mod => {
          const modKeys = mod.submodules.flatMap(sm => sm.actions.map(a => sm.key + '.' + a));
          const modChecked = modKeys.every(k => permissions.includes(k));
          const modPartial = modKeys.some(k => permissions.includes(k)) && !modChecked;
          return (
            <div key={mod.module} className="bg-white border rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b cursor-pointer" onClick={() => toggleModule(mod)}>
                <input type="checkbox" checked={modChecked} readOnly className={`w-4 h-4 rounded ${modPartial ? 'accent-gray-400' : 'accent-blue-600'}`} />
                <span className="font-semibold text-sm text-gray-800">{mod.module}</span>
                {modPartial && <span className="text-xs text-gray-400">(partial)</span>}
              </div>
              <div className="divide-y">
                {mod.submodules.map(sm => {
                  const keys = sm.actions.map(a => sm.key + '.' + a);
                  const allChecked = keys.every(k => permissions.includes(k));
                  const partial = keys.some(k => permissions.includes(k)) && !allChecked;
                  return (
                    <div key={sm.key} className="px-4 py-2">
                      <div className="flex items-center gap-2 mb-1 cursor-pointer" onClick={() => toggleSubmodule(sm)}>
                        <input type="checkbox" checked={allChecked} readOnly className={`w-4 h-4 rounded ${partial ? 'accent-gray-400' : 'accent-blue-600'}`} />
                        <span className="text-sm font-medium text-gray-700">{sm.name}</span>
                        {partial && <span className="text-xs text-gray-400">partial</span>}
                      </div>
                      <div className="flex flex-wrap gap-2 ml-6">
                        {sm.actions.map(action => {
                          const key = sm.key + '.' + action;
                          return (
                            <label key={key} className="flex items-center gap-1 cursor-pointer text-xs">
                              <input type="checkbox" checked={permissions.includes(key)} onChange={() => togglePerm(key)} className="w-3 h-3 rounded" />
                              <span className="capitalize">{action}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
