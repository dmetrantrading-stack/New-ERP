import React, { useState, useEffect, useMemo } from 'react';
import ModalOverlay from '../../components/ModalOverlay';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { Plus, Edit2, Trash2, Search, Users, Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';
import { PRIMARY, FINANCE_FONT } from '../../lib/financeUtils';

const LOCATIONS = [
  { id: null, label: 'All Locations' },
  { id: 1, label: 'Main Office' },
  { id: 2, label: 'Store' },
  { id: 3, label: 'Warehouse' },
];

export default function UserList() {
  const { hasPerm } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [form, setForm] = useState<any>({
    username: '', password: '', full_name: '', email: '', role_id: '', phone: '', location_id: '',
  });

  const loadUsers = () => {
    api.get('/users').then((res) => setUsers(res.data || [])).catch(() => toast.error('Failed to load users'));
  };

  useEffect(() => {
    loadUsers();
    api.get('/users/roles').then((res) => setRoles(res.data)).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.username || '').toLowerCase().includes(q)
      || (u.full_name || '').toLowerCase().includes(q)
      || (u.email || '').toLowerCase().includes(q)
      || (u.role_name || '').toLowerCase().includes(q),
    );
  }, [users, search]);

  const activeCount = users.filter((u) => u.is_active !== false).length;
  const inactiveCount = users.length - activeCount;
  const roleCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const u of users) {
      const role = u.role_name || 'Unassigned';
      map[role] = (map[role] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [users]);

  const openCreate = () => {
    setEditUser(null);
    setForm({ username: '', password: '', full_name: '', email: '', role_id: '', phone: '', location_id: '' });
    setShowModal(true);
  };

  const openEdit = (u: any) => {
    setEditUser(u);
    setForm({ ...u, password: '' });
    setShowModal(true);
  };

  const handleActivate = async (u: any) => {
    try {
      await api.put(`/users/${u.id}`, { ...u, is_active: true });
      toast.success(`${u.username} activated`);
      loadUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to activate user');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this user?')) return;
    try {
      await api.delete(`/users/${id}`);
      toast.success('User deactivated');
      loadUsers();
    } catch {
      toast.error('Cannot deactivate user');
    }
  };

  const handleSave = async () => {
    try {
      if (editUser) {
        await api.put(`/users/${editUser.id}`, form);
        toast.success('User updated');
      } else {
        await api.post('/users', form);
        toast.success('User created');
      }
      setShowModal(false);
      loadUsers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Error saving user');
    }
  };

  const canEditUsers = hasPerm('system.users.edit');
  const canViewPerms = hasPerm('system.users.view') || canEditUsers;

  return (
    <div className="h-[calc(100vh-4rem)] -m-6 flex flex-col bg-gray-50" style={{ fontFamily: FINANCE_FONT }}>
      <div className="flex-shrink-0 px-4 h-12 flex items-center justify-between" style={{ backgroundColor: PRIMARY }}>
        <div className="flex items-center gap-3">
          <Users size={18} className="text-white/90" />
          <h1 className="text-white font-semibold text-sm tracking-wide">Users</h1>
          <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">
            {activeCount} active
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canViewPerms && (
            <Link
              to="/settings?tab=users&section=permissions"
              className="flex items-center gap-1 px-3 py-1.5 bg-white/10 text-white rounded text-xs font-bold hover:bg-white/20"
            >
              <Shield size={14} /> Permissions
            </Link>
          )}
          {canEditUsers && (
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-1 px-3 py-1.5 bg-white text-blue-900 rounded text-xs font-bold hover:bg-blue-50"
            >
              <Plus size={14} /> Add User
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">1 · Search</div>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Username, name, email, role…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs"
              />
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              2 · User Accounts
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-[9px] font-semibold text-gray-500 uppercase">
                    <th className="px-3 py-2 text-left">Username</th>
                    <th className="px-3 py-2 text-left">Full Name</th>
                    <th className="px-3 py-2 text-left">Role</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-center">Status</th>
                    <th className="px-3 py-2 text-right w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-700">{u.username}</td>
                      <td className="px-3 py-2 font-medium">{u.full_name}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 text-[10px] rounded-full bg-blue-100 text-blue-700 font-semibold">
                          {u.role_name || '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{u.email || '—'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${u.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
                          {u.is_active !== false ? 'Active' : 'Pending'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {canViewPerms && (
                            <button
                              type="button"
                              onClick={() => navigate(`/settings/permissions/${u.id}`)}
                              className="p-1 hover:bg-purple-50 rounded text-purple-600"
                              title="Permissions"
                            >
                              <Shield size={14} />
                            </button>
                          )}
                          {canEditUsers && (
                            <>
                              {u.is_active === false && (
                                <button
                                  type="button"
                                  onClick={() => handleActivate(u)}
                                  className="px-2 py-0.5 hover:bg-green-50 rounded text-green-700 text-[10px] font-semibold"
                                  title="Activate account"
                                >
                                  Activate
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEdit(u)}
                                className="p-1 hover:bg-blue-50 rounded text-blue-600"
                                title="Edit"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(u.id)}
                                className="p-1 hover:bg-red-50 rounded text-red-500"
                                title="Deactivate"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                        No users found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white p-4 space-y-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Overview</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-green-50 border border-green-100 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 uppercase">Active</p>
                <p className="text-xl font-bold text-green-800">{activeCount}</p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 uppercase">Inactive</p>
                <p className="text-xl font-bold text-gray-700">{inactiveCount}</p>
              </div>
            </div>
          </div>

          {roleCounts.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">By Role</div>
              <div className="space-y-1.5">
                {roleCounts.map(([role, count]) => (
                  <div key={role} className="flex items-center justify-between px-2 py-1.5 rounded bg-gray-50 text-xs">
                    <span className="truncate text-gray-700">{role}</span>
                    <span className="font-mono text-gray-500 ml-2 shrink-0">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-[10px] text-blue-800 leading-relaxed space-y-2">
            <p>Manage login accounts, roles, and locations.</p>
            <Link to="/settings?tab=users&section=permissions" className="block text-blue-700 hover:underline">User permissions →</Link>
            <Link to="/settings" className="block text-blue-700 hover:underline">System settings →</Link>
            <Link to="/audit" className="block text-blue-700 hover:underline">Audit trail →</Link>
          </div>
        </div>
      </div>

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div className="modal-content max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editUser ? 'Edit User' : 'Add User'}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Username *</label>
                  <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" disabled={!!editUser} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{editUser ? 'New Password' : 'Password *'}</label>
                  <input type="password" value={form.password || ''} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Full Name *</label>
                  <input type="text" value={form.full_name || ''} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <input type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Role</label>
                    <select value={form.role_id || ''} onChange={(e) => setForm({ ...form, role_id: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                      <option value="">Select</option>
                      {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Location</label>
                    <select value={form.location_id || ''} onChange={(e) => setForm({ ...form, location_id: e.target.value || null })} className="w-full px-3 py-2 border rounded-lg text-sm">
                      {LOCATIONS.map((l) => <option key={String(l.id)} value={l.id ?? ''}>{l.label}</option>)}
                    </select>
                  </div>
                </div>
                {editUser && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.is_active !== false}
                      onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                      className="rounded"
                    />
                    Account active (can sign in)
                  </label>
                )}
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button type="button" onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
