import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { Shield, Search } from 'lucide-react';

export default function SettingsPermissionsTab() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('system.users.edit');
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    api.get('/users')
      .then((r) => setUsers(r.data?.value || r.data || []))
      .catch((err) => {
        setLoadError(err.response?.data?.error || 'Failed to load users');
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (u.full_name || '').toLowerCase().includes(q)
      || (u.username || '').toLowerCase().includes(q)
      || (u.role_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="h-full flex flex-col min-h-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">User Permissions</h2>
          <p className="text-xs text-gray-500">
            {canEdit
              ? 'Assign module access per user. Use role presets in the editor, then save. View is auto-added when Create/Edit is checked.'
              : 'View-only — you need Users → Edit permission to change access.'}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
          />
        </div>
      </div>

      {loadError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loadError}</div>
      )}

      <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden min-h-0">
        <div className="overflow-auto h-full">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">User</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Username</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Role</th>
                <th className="px-4 py-2 text-center text-xs font-semibold text-gray-600 uppercase">Status</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="text-center py-12 text-gray-400">Loading users...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-12 text-gray-400">No users found</td></tr>
              )}
              {filtered.map((u) => (
                <tr key={u.id} className="border-t border-gray-100 hover:bg-blue-50/50">
                  <td className="px-4 py-2 font-medium text-gray-900">{u.full_name}</td>
                  <td className="px-4 py-2 text-gray-500">{u.username}</td>
                  <td className="px-4 py-2">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs">{u.role_name}</span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => navigate(`/settings/permissions/${u.id}`)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-700 text-white rounded-lg text-xs font-semibold hover:bg-blue-800"
                    >
                      <Shield size={13} /> {canEdit ? 'Edit Permissions' : 'View Permissions'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
