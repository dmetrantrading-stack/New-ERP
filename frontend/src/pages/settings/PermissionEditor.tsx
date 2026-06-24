import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PRIMARY, FINANCE_FONT } from '../../lib/financeUtils';
import {
  Save, ArrowLeft, Copy, Shield, Search, ChevronDown, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';

const MODULE_TREE = [
  { module: 'Dashboard', submodules: [
    { name: 'Dashboard', key: 'dashboard', actions: ['view'] },
  ]},
  { module: 'Sales', submodules: [
    { name: 'Sales Invoice', key: 'sales.sales-invoice', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Sales Quotation', key: 'sales.sales-quotation', actions: ['view','create','edit','delete','print','approve'] },
    { name: 'Sales Order', key: 'sales.sales-order', actions: ['view','create','edit','delete','print','approve'] },
    { name: 'Delivery Receipt', key: 'sales.delivery-receipt', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Collection Receipt', key: 'sales.collection-receipt', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Collections', key: 'sales.collections', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Customers', key: 'sales.customers', actions: ['view','create','edit','delete'] },
  ]},
  { module: 'Purchases', submodules: [
    { name: 'Purchase Order', key: 'purchases.purchase-order', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Receiving Report', key: 'purchases.receiving-report', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'AP Voucher', key: 'purchases.apv', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Payment Voucher', key: 'purchases.payment-voucher', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Suppliers', key: 'purchases.suppliers', actions: ['view','create','edit','delete'] },
  ]},
  { module: 'Inventory', submodules: [
    { name: 'Inventory', key: 'inventory.inventory', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Production', key: 'inventory.production', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Inventory Counts', key: 'inventory.counts', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Stock Transfers', key: 'inventory.stock-transfer', actions: ['view','create','edit','delete','print','approve','export'] },
  ]},
  { module: 'Finance', submodules: [
    { name: 'Accounting', key: 'finance.accounting', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Bank & Cash', key: 'finance.bank-cash', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Expenses', key: 'finance.expenses', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Petty Cash', key: 'finance.petty-cash', actions: ['view','create','edit','delete','print','approve','export','replenish'] },
    { name: 'Loans Payable', key: 'finance.loans', actions: ['view','create','edit','delete','print','approve','export'] },
  ]},
  { module: 'HR & Payroll', submodules: [
    { name: 'Employees', key: 'hr.employees', actions: ['view','create','edit','delete','print','approve','export','import'] },
    { name: 'Attendance', key: 'hr.attendance', actions: ['view','create','edit','delete','print','approve','export'] },
    { name: 'Payroll & Payslip', key: 'hr.payroll', actions: ['view','create','edit','delete','print','approve','export'], note: 'Covers payroll, payslips, and SSS. Legacy hr.payslip.* keys are treated as hr.payroll.*.' },
    { name: 'Cash Advances', key: 'hr.cash-advances', actions: ['view','create','edit','delete','print','approve','export'] },
  ]},
  { module: 'POS', submodules: [
    { name: 'POS', key: 'pos', actions: ['view','write'], note: 'view = read shifts and transactions; write = cashier operations (includes view).' },
  ]},
  { module: 'Reports', submodules: [
    { name: 'Reports', key: 'reports', actions: ['view', 'daily-payables', 'daily-receivables'] },
  ]},
  { module: 'System', submodules: [
    { name: 'Users', key: 'system.users', actions: ['view','create','edit','delete'] },
    { name: 'Business Details', key: 'system.settings', actions: ['view','edit'] },
    { name: 'Audit Trail', key: 'system.audit', actions: ['view'] },
  ]},
];

function moduleKeys(mod: (typeof MODULE_TREE)[number]) {
  return mod.submodules.flatMap((sm) => sm.actions.map((a) => `${sm.key}.${a}`));
}

export default function PermissionEditor() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { refreshUser, hasPerm, user: currentUser } = useAuth();
  const canEdit = hasPerm('system.users.edit');

  const [user, setUser] = useState<any>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [copyFromId, setCopyFromId] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const totalKeys = useMemo(
    () => MODULE_TREE.flatMap((m) => moduleKeys(m)),
    [],
  );

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setLoadError('');

    Promise.all([
      api.get('/users'),
      api.get(`/users/${userId}/permissions`),
    ])
      .then(([usersRes, permsRes]) => {
        const list = usersRes.data?.value || usersRes.data || [];
        setUsers(list);
        const u = list.find((x: any) => String(x.id) === String(userId));
        setUser(u || null);
        setPermissions(permsRes.data?.permissions || []);
        if (!u) setLoadError('User not found');
      })
      .catch((err) => {
        setLoadError(err.response?.data?.error || 'Failed to load permissions');
      })
      .finally(() => setLoading(false));
  }, [userId]);

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MODULE_TREE;
    return MODULE_TREE.map((mod) => ({
      ...mod,
      submodules: mod.submodules.filter(
        (sm) => sm.name.toLowerCase().includes(q)
          || sm.key.toLowerCase().includes(q)
          || mod.module.toLowerCase().includes(q),
      ),
    })).filter((mod) => mod.submodules.length > 0);
  }, [search]);

  const togglePerm = (key: string) => {
    if (!canEdit) return;
    setPermissions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const toggleModule = (mod: (typeof MODULE_TREE)[number]) => {
    if (!canEdit) return;
    const allKeys = moduleKeys(mod);
    const allChecked = allKeys.every((k) => permissions.includes(k));
    if (allChecked) {
      setPermissions((prev) => prev.filter((k) => !allKeys.includes(k)));
    } else {
      setPermissions((prev) => [...new Set([...prev, ...allKeys])]);
    }
  };

  const toggleSubmodule = (sm: { key: string; actions: string[] }) => {
    if (!canEdit) return;
    const keys = sm.actions.map((a) => `${sm.key}.${a}`);
    const allChecked = keys.every((k) => permissions.includes(k));
    if (allChecked) {
      setPermissions((prev) => prev.filter((k) => !keys.includes(k)));
    } else {
      setPermissions((prev) => [...new Set([...prev, ...keys])]);
    }
  };

  const toggleCollapse = (moduleName: string) => {
    setCollapsed((prev) => ({ ...prev, [moduleName]: !prev[moduleName] }));
  };

  const expandAll = () => setCollapsed({});
  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    MODULE_TREE.forEach((m) => { next[m.module] = true; });
    setCollapsed(next);
  };

  const selectAll = () => {
    if (!canEdit) return;
    setPermissions(totalKeys);
  };

  const clearAll = () => {
    if (!canEdit) return;
    setPermissions([]);
  };

  const copyFromUser = async () => {
    if (!canEdit || !copyFromId) return;
    try {
      const r = await api.post(`/users/${userId}/copy-permissions/${copyFromId}`);
      toast.success(`${r.data.copied} permissions copied`);
      const r2 = await api.get(`/users/${userId}/permissions`);
      setPermissions(r2.data?.permissions || []);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put(`/users/${userId}/permissions`, { permissions });
      toast.success('Permissions saved');
      if (String(currentUser?.id) === String(userId)) {
        await refreshUser();
      }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error saving permissions'); }
    finally { setSaving(false); }
  };

  const grantedCount = permissions.length;
  const totalCount = totalKeys.length;

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      {/* Header */}
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between gap-3" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/settings?tab=permissions')}
            className="p-1.5 rounded-md text-white/90 hover:bg-white/10 flex-shrink-0"
            title="Back to permissions list"
          >
            <ArrowLeft size={18} />
          </button>
          <Shield size={18} className="text-white/90 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {canEdit ? 'Edit Permissions' : 'View Permissions'}
            </p>
            <p className="text-[11px] text-white/70 truncate">
              {user?.full_name || (loading ? 'Loading...' : 'Unknown user')} · @{user?.username || '—'}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
          {user?.role_name && (
            <span className="px-2.5 py-1 rounded-md bg-white/10 text-white text-xs">
              Role: <span className="font-semibold">{user.role_name}</span>
            </span>
          )}
          <span className="px-2.5 py-1 rounded-md bg-white/10 text-white text-xs">
            Granted: <span className="font-semibold">{loading ? '—' : `${grantedCount} / ${totalCount}`}</span>
          </span>
          {user && (
            <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${user.is_active ? 'bg-green-500/20 text-green-100' : 'bg-red-500/20 text-red-100'}`}>
              {user.is_active ? 'Active' : 'Inactive'}
            </span>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-2.5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter modules (e.g. Sales, POS, payroll)..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={expandAll} className="px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">Expand all</button>
            <button type="button" onClick={collapseAll} className="px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">Collapse all</button>
            {canEdit && (
              <>
                <button type="button" onClick={selectAll} className="px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">Select all</button>
                <button type="button" onClick={clearAll} className="px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">Clear all</button>
                <div className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-2 py-1 bg-gray-50">
                  <Copy size={13} className="text-gray-400 flex-shrink-0" />
                  <select
                    value={copyFromId}
                    onChange={(e) => setCopyFromId(e.target.value)}
                    className="text-xs bg-transparent outline-none max-w-[160px] text-gray-700"
                  >
                    <option value="">Copy from user...</option>
                    {users.filter((u) => String(u.id) !== String(userId)).map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={copyFromUser}
                    disabled={!copyFromId}
                    className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-40"
                  >
                    Copy
                  </button>
                </div>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || loading}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  <Save size={14} /> {saving ? 'Saving...' : 'Save changes'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs">
          Read-only — you need <strong>Users → Edit</strong> permission to change access.
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {loadError && (
          <div className="max-w-4xl mx-auto mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{loadError}</div>
        )}
        {loading ? (
          <div className="text-center py-16 text-sm text-gray-400">Loading permissions...</div>
        ) : filteredModules.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-400">No modules match &quot;{search}&quot;</div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-3">
            {filteredModules.map((mod) => {
              const keys = moduleKeys(mod);
              const granted = keys.filter((k) => permissions.includes(k)).length;
              const modChecked = granted === keys.length && keys.length > 0;
              const modPartial = granted > 0 && !modChecked;
              const isCollapsed = collapsed[mod.module];

              return (
                <div key={mod.module} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
                    <button
                      type="button"
                      onClick={() => toggleCollapse(mod.module)}
                      className="p-0.5 text-gray-500 hover:text-gray-800 flex-shrink-0"
                      aria-label={isCollapsed ? 'Expand module' : 'Collapse module'}
                    >
                      {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </button>
                    <label className={`flex items-center gap-2 flex-1 min-w-0 ${canEdit ? 'cursor-pointer' : ''}`}>
                      <input
                        type="checkbox"
                        checked={modChecked}
                        ref={(el) => { if (el) el.indeterminate = modPartial; }}
                        onChange={() => toggleModule(mod)}
                        disabled={!canEdit}
                        className="w-4 h-4 rounded accent-blue-700 flex-shrink-0"
                      />
                      <span className="font-semibold text-sm text-gray-900">{mod.module}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                        modChecked ? 'bg-green-100 text-green-700'
                          : modPartial ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-500'
                      }`}>
                        {granted}/{keys.length}
                      </span>
                    </label>
                  </div>

                  {!isCollapsed && (
                    <div className="divide-y divide-gray-100">
                      {mod.submodules.map((sm) => {
                        const smKeys = sm.actions.map((a) => `${sm.key}.${a}`);
                        const smGranted = smKeys.filter((k) => permissions.includes(k)).length;
                        const allChecked = smGranted === smKeys.length;
                        const partial = smGranted > 0 && !allChecked;

                        return (
                          <div key={sm.key} className="px-4 py-3">
                            <label className={`flex items-center gap-2 mb-2 ${canEdit ? 'cursor-pointer' : ''}`}>
                              <input
                                type="checkbox"
                                checked={allChecked}
                                ref={(el) => { if (el) el.indeterminate = partial; }}
                                onChange={() => toggleSubmodule(sm)}
                                disabled={!canEdit}
                                className="w-4 h-4 rounded accent-blue-700"
                              />
                              <span className="text-sm font-medium text-gray-800">{sm.name}</span>
                              <span className="text-xs text-gray-400">{smGranted}/{smKeys.length}</span>
                            </label>
                            {'note' in sm && sm.note && (
                              <p className="text-[11px] text-gray-500 ml-6 mb-2 leading-relaxed">{sm.note}</p>
                            )}
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 ml-6">
                              {sm.actions.map((action) => {
                                const key = `${sm.key}.${action}`;
                                const checked = permissions.includes(key);
                                return (
                                  <label
                                    key={key}
                                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors ${
                                      checked
                                        ? 'bg-blue-50 border-blue-300 text-blue-900'
                                        : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                                    } ${canEdit ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => togglePerm(key)}
                                      disabled={!canEdit}
                                      className="w-3.5 h-3.5 rounded accent-blue-700 flex-shrink-0"
                                    />
                                    <span className="capitalize">{action}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mobile sticky save bar */}
      {canEdit && !loading && (
        <div className="flex-shrink-0 sm:hidden border-t border-gray-200 bg-white px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-500">{grantedCount} permissions selected</span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-blue-700 text-white disabled:opacity-50"
          >
            <Save size={15} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
