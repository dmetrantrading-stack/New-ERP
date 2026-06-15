import React, { useState, useEffect } from 'react';
import api from '../../lib/api';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function UserList() {
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const [form, setForm] = useState<any>({ username: '', password: '', full_name: '', email: '', role_id: '', phone: '' });

  useEffect(() => {
    api.get('/users').then((res) => setUsers(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
    api.get('/users/roles').then((res) => setRoles(res.data)).catch((err) => toast.error(err.response?.data?.error || 'Failed to load data'));
  }, []);

  const openCreate = () => { setEditUser(null); setForm({ username: '', password: '', full_name: '', email: '', role_id: '', phone: '' }); setShowModal(true); };
  const openEdit = (u: any) => { setEditUser(u); setForm({ ...u, password: '' }); setShowModal(true); };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try { await api.delete(`/users/${id}`); toast.success('Deleted'); const res = await api.get('/users'); setUsers(res.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const handleSave = async () => {
    try {
      if (editUser) { await api.put(`/users/${editUser.id}`, form); toast.success('Updated'); }
      else { await api.post('/users', form); toast.success('Created'); }
      setShowModal(false);
      const res = await api.get('/users'); setUsers(res.data);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><Plus size={16} /> Add User</button>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="data-table">
          <thead><tr><th>Username</th><th>Full Name</th><th>Role</th><th>Email</th><th>Last Login</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-mono text-xs">{u.username}</td>
                <td className="font-medium">{u.full_name}</td>
                <td><span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-700">{u.role_name}</span></td>
                <td>{u.email || '-'}</td>
                <td className="text-xs">{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</td>
                <td><span className={`px-2 py-1 text-xs rounded-full ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(u)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600"><Edit2 size={15} /></button>
                    <button onClick={() => handleDelete(u.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500"><Trash2 size={15} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold mb-4">{editUser ? 'Edit User' : 'Add User'}</h2>
              <div className="space-y-3">
                <div><label className="block text-sm font-medium mb-1">Username *</label>
                  <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" disabled={!!editUser} /></div>
                <div><label className="block text-sm font-medium mb-1">{editUser ? 'New Password (leave empty to keep)' : 'Password *'}</label>
                  <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Full Name *</label>
                  <input type="text" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                <div><label className="block text-sm font-medium mb-1">Role</label>
                  <select value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select Role</option>
                    {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select></div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
                <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
