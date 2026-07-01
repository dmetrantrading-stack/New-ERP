import React, { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { SETTINGS_INPUT_CLASS, SETTINGS_SECTIONS } from '../../lib/settingsUtils';
import SettingsSubNav from './SettingsSubNav';
import NumericInput from '../../components/NumericInput';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsSalesTab({
  section,
  onSectionChange,
}: {
  section: string;
  onSectionChange: (key: string) => void;
}) {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('system.settings.edit');
  const [salesWorkflow, setSalesWorkflow] = useState<{ invoice_copy_mode: 'ordered' | 'delivered' }>({ invoice_copy_mode: 'delivered' });
  const [purchaseWorkflow, setPurchaseWorkflow] = useState({ enforce_approval_limits: true });
  const [inventoryCost, setInventoryCost] = useState({ auto_update_cost_from_rr: false, auto_reprice_on_gr: false });
  const [roles, setRoles] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wfRes, pwRes, invCostRes, rolesRes] = await Promise.all([
        api.get('/settings/sales-workflow'),
        api.get('/settings/purchase-workflow'),
        api.get('/settings/inventory-cost'),
        api.get('/users/roles'),
      ]);
      setSalesWorkflow({ invoice_copy_mode: wfRes.data?.invoice_copy_mode || 'delivered' });
      setPurchaseWorkflow({ enforce_approval_limits: pwRes.data?.enforce_approval_limits !== false });
      setInventoryCost({
        auto_update_cost_from_rr: invCostRes.data?.auto_update_cost_from_rr === true,
        auto_reprice_on_gr: invCostRes.data?.auto_reprice_on_gr === true,
      });
      setRoles(rolesRes.data || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSalesWorkflow = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put('/settings/sales-workflow', salesWorkflow);
      toast.success('Sales invoice settings saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const savePurchaseWorkflow = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put('/settings/purchase-workflow', purchaseWorkflow);
      toast.success('Purchase approval settings saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const saveRoleApprovalLimits = async () => {
    if (!canEdit) return;
    setSavingRoles(true);
    try {
      await Promise.all(roles.map((r) => api.put(`/users/roles/${r.id}`, { approval_limit: parseFloat(r.approval_limit) || 0 })));
      toast.success('Role approval limits saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save limits'); }
    finally { setSavingRoles(false); }
  };

  const saveInventoryCost = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await api.put('/settings/inventory-cost', inventoryCost);
      toast.success('Inventory cost settings saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading sales settings...</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto space-y-4">
        <SettingsSubNav sections={SETTINGS_SECTIONS.sales} active={section} onChange={onSectionChange} />

        {section === 'invoicing' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Sales Invoice from Order</h2>
              <p className="text-xs text-gray-500 mt-0.5">Controls how Sales Order lines copy into a new Sales Invoice.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Copy to Sales Invoice</label>
              <select
                value={salesWorkflow.invoice_copy_mode}
                onChange={(e) => setSalesWorkflow({ invoice_copy_mode: e.target.value as 'ordered' | 'delivered' })}
                disabled={!canEdit}
                className={SETTINGS_INPUT_CLASS}
              >
                <option value="delivered">Delivered quantities only</option>
                <option value="ordered">All ordered quantities</option>
              </select>
            </div>
            {canEdit && (
              <button type="button" onClick={saveSalesWorkflow} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                <Save size={14} /> {saving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        )}

        {section === 'purchasing' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Purchase Approval Limits</h2>
              <p className="text-xs text-gray-500 mt-0.5">Block PR approval, PO send, and APV post when amount exceeds a role&apos;s limit. Admin/Owner bypass. 0 = unlimited.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={purchaseWorkflow.enforce_approval_limits} onChange={(e) => setPurchaseWorkflow({ enforce_approval_limits: e.target.checked })} disabled={!canEdit} className="rounded" />
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
                        <NumericInput value={r.approval_limit || ''} onValueChange={(v) => setRoles((prev) => prev.map((x) => x.id === r.id ? { ...x, approval_limit: v } : x))} disabled={!canEdit} className="w-32 ml-auto px-2 py-1 border border-gray-200 rounded text-right" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={savePurchaseWorkflow} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                  <Save size={14} /> {saving ? 'Saving...' : 'Save Approval Toggle'}
                </button>
                <button type="button" onClick={saveRoleApprovalLimits} disabled={savingRoles} className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                  <Save size={14} /> {savingRoles ? 'Saving...' : 'Save Role Limits'}
                </button>
              </div>
            )}
          </div>
        )}

        {section === 'inventory' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Inventory Cost on Goods Receipt</h2>
              <p className="text-xs text-gray-500 mt-0.5">Update product cost from weighted average on GR and optionally reprice from markup ratios.</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={inventoryCost.auto_update_cost_from_rr} onChange={(e) => setInventoryCost((prev) => ({ ...prev, auto_update_cost_from_rr: e.target.checked, auto_reprice_on_gr: e.target.checked ? prev.auto_reprice_on_gr : false }))} disabled={!canEdit} className="rounded" />
              Auto-update product cost from receiving
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={inventoryCost.auto_reprice_on_gr} onChange={(e) => setInventoryCost((prev) => ({ ...prev, auto_reprice_on_gr: e.target.checked }))} disabled={!canEdit || !inventoryCost.auto_update_cost_from_rr} className="rounded" />
              Auto-reprice retail / wholesale / distributor from implied markup
            </label>
            {canEdit && (
              <button type="button" onClick={saveInventoryCost} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
                <Save size={14} /> {saving ? 'Saving...' : 'Save Inventory Cost Settings'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
