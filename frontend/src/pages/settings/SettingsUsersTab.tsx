import React, { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { SETTINGS_INPUT_CLASS, SETTINGS_SECTIONS } from '../../lib/settingsUtils';
import SettingsSubNav from './SettingsSubNav';
import SettingsPermissionsTab from './SettingsPermissionsTab';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsUsersTab({
  section,
  onSectionChange,
}: {
  section: string;
  onSectionChange: (key: string) => void;
}) {
  const { hasPerm } = useAuth();
  const canEditSettings = hasPerm('system.settings.edit');
  const canViewUsers = hasPerm('system.users.view') || hasPerm('system.users.edit');
  const [registration, setRegistration] = useState({ enabled: true, require_approval: true, default_role: 'Cashier' });
  const [roles, setRoles] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [regRes, rolesRes] = await Promise.all([
        api.get('/settings/registration'),
        api.get('/users/roles'),
      ]);
      setRegistration({
        enabled: regRes.data?.enabled !== false,
        require_approval: regRes.data?.require_approval !== false,
        default_role: regRes.data?.default_role || 'Cashier',
      });
      setRoles(rolesRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveRegistration = async () => {
    if (!canEditSettings) return;
    setSaving(true);
    try {
      const res = await api.put('/settings/registration', registration);
      setRegistration({
        enabled: res.data?.enabled !== false,
        require_approval: res.data?.require_approval !== false,
        default_role: res.data?.default_role || 'Cashier',
      });
      toast.success('Registration settings saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const visibleSections = SETTINGS_SECTIONS.users.filter((s) => {
    if (s.key === 'permissions') return canViewUsers;
    if (s.key === 'registration') return canEditSettings;
    return true;
  });

  const activeSection = visibleSections.some((s) => s.key === section)
    ? section
    : (visibleSections[0]?.key || 'permissions');

  if (loading && activeSection === 'registration') {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading user settings...</div>;
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-shrink-0 max-w-4xl mx-auto w-full px-0">
        <SettingsSubNav sections={visibleSections} active={activeSection} onChange={onSectionChange} />
      </div>

      {activeSection === 'permissions' && canViewUsers && (
        <div className="flex-1 min-h-0">
          <SettingsPermissionsTab />
        </div>
      )}

      {activeSection === 'registration' && canEditSettings && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Self-Registration</h2>
              <p className="text-xs text-gray-500 mt-0.5">Allow new users to register from the login page. Pending accounts must be activated under Users.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={registration.enabled} onChange={(e) => setRegistration((prev) => ({ ...prev, enabled: e.target.checked }))} disabled={!canEditSettings} className="rounded" />
              Allow self-registration on login page
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={registration.require_approval} onChange={(e) => setRegistration((prev) => ({ ...prev, require_approval: e.target.checked }))} disabled={!canEditSettings || !registration.enabled} className="rounded" />
              Require administrator approval before first login
            </label>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Default role for new registrations</label>
              <select value={registration.default_role} onChange={(e) => setRegistration((prev) => ({ ...prev, default_role: e.target.value }))} disabled={!canEditSettings || !registration.enabled} className={SETTINGS_INPUT_CLASS}>
                {roles.map((r) => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            </div>
            {canEditSettings && (
              <button type="button" onClick={saveRegistration} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                <Save size={14} /> {saving ? 'Saving...' : 'Save Registration Settings'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
