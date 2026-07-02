import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { PRIMARY, FINANCE_FONT } from '../../lib/financeUtils';
import {
  PERMISSION_MODULE_TREE,
  ACTION_GROUP_ORDER,
  ACTION_GROUP_LABELS,
  ROLE_PRESETS,
  catalogPermissionKeys,
  normalizePermissionKeys,
  actionGroupFor,
  type ActionGroupId,
  type CatalogModule,
  type CatalogSubmodule,
} from '../../lib/permissionCatalog';
import {
  Save, ArrowLeft, Copy, Shield, Search, ChevronDown, ChevronRight, Layers,
} from 'lucide-react';
import toast from 'react-hot-toast';

const GROUP_ACCENT: Partial<Record<ActionGroupId, string>> = {
  access: 'border-l-blue-400',
  entry: 'border-l-emerald-400',
  change: 'border-l-amber-500',
  approve: 'border-l-violet-400',
  output: 'border-l-slate-400',
  admin: 'border-l-red-400',
  special: 'border-l-indigo-400',
};

function submoduleKeys(sm: CatalogSubmodule): string[] {
  return sm.actions.map((a) => `${sm.key}.${a.action}`);
}

function moduleKeys(mod: CatalogModule): string[] {
  return mod.submodules.flatMap((sm) => submoduleKeys(sm));
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

  const totalKeys = useMemo(() => catalogPermissionKeys(), []);

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
    if (!q) return PERMISSION_MODULE_TREE;
    return PERMISSION_MODULE_TREE.map((mod) => ({
      ...mod,
      submodules: mod.submodules.filter(
        (sm) => sm.name.toLowerCase().includes(q)
          || sm.key.toLowerCase().includes(q)
          || mod.module.toLowerCase().includes(q),
      ),
    })).filter((mod) => mod.submodules.length > 0);
  }, [search]);

  const legacyPermissions = useMemo(() => {
    const known = new Set(totalKeys);
    return permissions.filter((k) => !known.has(k));
  }, [permissions, totalKeys]);

  const editGrantedCount = useMemo(
    () => permissions.filter((k) => k.endsWith('.edit') || k.endsWith('.write')).length,
    [permissions],
  );

  const setPermissionsNormalized = (next: string[]) => {
    setPermissions(normalizePermissionKeys(next));
  };

  const togglePerm = (key: string) => {
    if (!canEdit) return;
    setPermissionsNormalized(
      permissions.includes(key)
        ? permissions.filter((k) => k !== key)
        : [...permissions, key],
    );
  };

  const toggleModule = (mod: CatalogModule) => {
    if (!canEdit) return;
    const allKeys = moduleKeys(mod);
    const allChecked = allKeys.every((k) => permissions.includes(k));
    if (allChecked) {
      setPermissionsNormalized(permissions.filter((k) => !allKeys.includes(k)));
    } else {
      setPermissionsNormalized([...permissions, ...allKeys]);
    }
  };

  const toggleSubmodule = (sm: CatalogSubmodule) => {
    if (!canEdit) return;
    const keys = submoduleKeys(sm);
    const allChecked = keys.every((k) => permissions.includes(k));
    if (allChecked) {
      setPermissionsNormalized(permissions.filter((k) => !keys.includes(k)));
    } else {
      setPermissionsNormalized([...permissions, ...keys]);
    }
  };

  const toggleCollapse = (moduleName: string) => {
    setCollapsed((prev) => ({ ...prev, [moduleName]: !prev[moduleName] }));
  };

  const expandAll = () => setCollapsed({});
  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    PERMISSION_MODULE_TREE.forEach((m) => { next[m.module] = true; });
    setCollapsed(next);
  };

  const selectAll = () => {
    if (!canEdit) return;
    setPermissionsNormalized([...totalKeys, ...legacyPermissions]);
  };

  const clearAll = () => {
    if (!canEdit) return;
    setPermissions([]);
  };

  const applyPresetById = (id: string, skipConfirm = false) => {
    if (!canEdit) return;
    const preset = ROLE_PRESETS.find((p) => p.id === id);
    if (!preset) return;
    if (!skipConfirm && !window.confirm(`Replace ${user?.full_name || 'this user'}'s permissions with "${preset.label}"?\n\n${preset.description}`)) return;
    setPermissionsNormalized(preset.permissions);
    toast.success(`Applied preset: ${preset.label}`);
  };

  const copyFromUser = async () => {
    if (!canEdit || !copyFromId) return;
    try {
      const r = await api.post(`/users/${userId}/copy-permissions/${copyFromId}`);
      toast.success(`${r.data.copied} permissions copied`);
      const r2 = await api.get(`/users/${userId}/permissions`);
      setPermissionsNormalized(r2.data?.permissions || []);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    const normalized = normalizePermissionKeys(permissions);
    try {
      await api.put(`/users/${userId}/permissions`, { permissions: normalized });
      setPermissions(normalized);
      toast.success('Permissions saved');
      if (String(currentUser?.id) === String(userId)) {
        await refreshUser();
      }
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error saving permissions'); }
    finally { setSaving(false); }
  };

  const grantedCount = permissions.filter((k) => totalKeys.includes(k)).length;
  const totalCount = totalKeys.length;

  const renderActionGroups = (sm: CatalogSubmodule) => {
    const grouped = new Map<string, typeof sm.actions>();
    for (const act of sm.actions) {
      const gid = actionGroupFor(act.action, act.group);
      if (!grouped.has(gid)) grouped.set(gid, []);
      grouped.get(gid)!.push(act);
    }

    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 ml-0 sm:ml-6">
        {ACTION_GROUP_ORDER.filter((gid) => grouped.has(gid)).map((gid) => (
          <div
            key={gid}
            className={`rounded-lg border border-gray-100 bg-gray-50/80 p-2.5 border-l-4 ${GROUP_ACCENT[gid] || 'border-l-gray-300'}`}
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-2">{ACTION_GROUP_LABELS[gid]}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {grouped.get(gid)!.map((act) => {
                const key = `${sm.key}.${act.action}`;
                const checked = permissions.includes(key);
                const isEditGroup = gid === 'change';
                return (
                  <label
                    key={key}
                    className={`flex flex-col gap-0.5 px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                      checked
                        ? isEditGroup
                          ? 'bg-amber-50 border-amber-300 text-amber-950'
                          : 'bg-blue-50 border-blue-300 text-blue-900'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    } ${canEdit ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePerm(key)}
                        disabled={!canEdit}
                        className="w-3.5 h-3.5 rounded accent-blue-700 flex-shrink-0"
                      />
                      <span className="capitalize">{act.label || act.action.replace(/-/g, ' ')}</span>
                    </span>
                    {act.hint && (
                      <span className="text-[10px] text-gray-500 leading-snug pl-5">{act.hint}</span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50 min-h-0" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 sm:px-6 h-12 flex items-center justify-between gap-3" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/settings?tab=users&section=permissions')}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white border border-white/30 rounded-lg hover:bg-white/10 flex-shrink-0"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <Shield size={18} className="text-white/90 flex-shrink-0 hidden sm:block" />
          <div className="min-w-0 border-l border-white/20 pl-3">
            <p className="text-sm font-semibold text-white truncate">
              {canEdit ? 'Edit Permissions' : 'View Permissions'}
            </p>
            <p className="text-[11px] text-white/70 truncate">
              {user?.full_name || (loading ? 'Loading...' : 'Unknown user')} · @{user?.username || '—'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {user?.role_name && (
            <span className="hidden md:inline px-2.5 py-1 rounded-md bg-white/10 text-white text-xs">
              {user.role_name}
            </span>
          )}
          <span className="px-2.5 py-1 rounded-md bg-white/10 text-white text-xs">
            <span className="font-semibold">{loading ? '—' : `${grantedCount}/${totalCount}`}</span>
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white text-blue-800 rounded-lg text-sm font-semibold hover:bg-blue-50 disabled:opacity-50"
            >
              <Save size={14} /> {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter modules (Sales, Expenses, POS, HR…)"
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
                    className="text-xs bg-transparent outline-none max-w-[140px] text-gray-700"
                  >
                    <option value="">Copy from user…</option>
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
              </>
            )}
          </div>
        </div>
        {canEdit && (
          <p className="text-[11px] text-gray-500 mt-2">
            <strong className="text-amber-700">Change / void / pay</strong> (amber) controls edit buttons in each module. Create/Edit/Approve auto-includes View on save.
          </p>
        )}
      </div>

      {!canEdit && (
        <div className="flex-shrink-0 px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-900 text-xs">
          Read-only — you need <strong>Users → Edit</strong> permission to change access.
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4">
          {loadError && (
            <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{loadError}</div>
          )}
          {loading ? (
            <div className="text-center py-16 text-sm text-gray-400">Loading permissions...</div>
          ) : filteredModules.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-400">No modules match &quot;{search}&quot;</div>
          ) : (
            <div className="space-y-4">
              {legacyPermissions.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-900">
                  <p className="font-semibold mb-1">Legacy permissions ({legacyPermissions.length})</p>
                  <p className="mb-2 text-amber-800">Still active but not in the catalog.</p>
                  <div className="flex flex-wrap gap-1">
                    {legacyPermissions.map((k) => (
                      <span key={k} className="px-2 py-0.5 rounded bg-white border border-amber-200 font-mono text-[10px]">{k}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                {filteredModules.map((mod) => {
                  const keys = moduleKeys(mod);
                  const granted = keys.filter((k) => permissions.includes(k)).length;
                  const modChecked = granted === keys.length && keys.length > 0;
                  const modPartial = granted > 0 && !modChecked;
                  const isCollapsed = collapsed[mod.module];

                  return (
                    <div key={mod.module} className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
                      <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
                        <button
                          type="button"
                          onClick={() => toggleCollapse(mod.module)}
                          className="p-0.5 text-gray-500 hover:text-gray-800 flex-shrink-0"
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
                        <div className="divide-y divide-gray-100 flex-1">
                          {mod.submodules.map((sm) => {
                            const smKeys = submoduleKeys(sm);
                            const smGranted = smKeys.filter((k) => permissions.includes(k)).length;
                            const allChecked = smGranted === smKeys.length;
                            const partial = smGranted > 0 && !allChecked;
                            const hasEdit = sm.actions.some((a) => a.action === 'edit' || a.action === 'write');
                            const editKey = sm.actions.find((a) => a.action === 'edit') ? `${sm.key}.edit` : hasEdit ? `${sm.key}.write` : null;
                            const editOn = editKey ? permissions.includes(editKey) : false;

                            return (
                              <div key={sm.key} className="px-4 py-4">
                                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                                  <label className={`flex items-center gap-2 ${canEdit ? 'cursor-pointer' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={allChecked}
                                      ref={(el) => { if (el) el.indeterminate = partial; }}
                                      onChange={() => toggleSubmodule(sm)}
                                      disabled={!canEdit}
                                      className="w-4 h-4 rounded accent-blue-700"
                                    />
                                    <span className="text-sm font-semibold text-gray-800">{sm.name}</span>
                                    <span className="text-xs text-gray-400">{smGranted}/{smKeys.length}</span>
                                  </label>
                                  {hasEdit && (
                                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${editOn ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}>
                                      Edit {editOn ? 'ON' : 'off'}
                                    </span>
                                  )}
                                </div>
                                {sm.note && (
                                  <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">{sm.note}</p>
                                )}
                                {renderActionGroups(sm)}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <aside className="hidden lg:flex w-72 xl:w-80 flex-shrink-0 flex-col border-l border-gray-200 bg-white overflow-y-auto">
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
              <Layers size={14} className="text-indigo-600" />
              Role presets
            </div>
            <p className="text-[11px] text-gray-500 mb-3 leading-relaxed">
              Click a preset to replace this user&apos;s permissions. Fine-tune in the main panel, then Save.
            </p>
            <div className="space-y-2 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
              {ROLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => applyPresetById(preset.id)}
                  className="w-full text-left px-3 py-2.5 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <p className="text-xs font-semibold text-gray-900">{preset.label}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5 leading-snug">{preset.description}</p>
                  <p className="text-[10px] text-indigo-600 mt-1">{preset.permissions.length} permissions</p>
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Summary</p>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-600">Granted</span>
                  <span className="font-semibold">{grantedCount} / {totalCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Edit / write</span>
                  <span className="font-semibold text-amber-700">{editGrantedCount}</span>
                </div>
                {user && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Status</span>
                    <span className={user.is_active ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-[10px] text-gray-600 leading-relaxed space-y-2">
              <p className="font-semibold text-gray-700">Permission groups</p>
              {ACTION_GROUP_ORDER.map((gid) => (
                <div key={gid} className="flex items-center gap-2">
                  <span className={`w-1 h-4 rounded-full ${GROUP_ACCENT[gid]?.replace('border-l-', 'bg-') || 'bg-gray-300'}`} />
                  <span>{ACTION_GROUP_LABELS[gid]}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
