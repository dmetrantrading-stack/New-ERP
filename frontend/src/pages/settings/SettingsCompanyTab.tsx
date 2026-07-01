import React, { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { useAuth } from '../../store/auth';
import { DEFAULT_BIZ, SETTINGS_INPUT_CLASS } from '../../lib/settingsUtils';
import NumericInput from '../../components/NumericInput';
import { parseNumericField } from '../../lib/utils';
import { Save, Upload } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsCompanyTab() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('system.settings.edit');
  const [biz, setBiz] = useState<any>({ ...DEFAULT_BIZ });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logoUploading, setLogoUploading] = useState(false);
  const [sigUploading, setSigUploading] = useState<'prepared' | 'approved' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/settings/business-details');
      if (res.data) setBiz({ ...DEFAULT_BIZ, ...res.data });
    } catch { /* */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (field: string, value: any) => setBiz((prev: any) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!canEdit) return;
    if (!biz.business_name || !biz.address || !biz.tin_number) {
      toast.error('Business Name, Address, and TIN are required');
      return;
    }
    setSaving(true);
    try {
      await api.put('/settings/business-details', { ...biz, vat_rate: parseNumericField(biz.vat_rate) || 12 });
      toast.success('Company profile saved');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Error saving'); }
    finally { setSaving(false); }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await api.post('/settings/upload-logo', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setBiz((prev: any) => ({ ...prev, logo_url: res.data.logo_url }));
      toast.success('Logo uploaded');
    } catch (err: any) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setLogoUploading(false); }
  };

  const handleSignatureUpload = async (role: 'prepared' | 'approved', e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const file = e.target.files?.[0];
    if (!file) return;
    setSigUploading(role);
    try {
      const formData = new FormData();
      formData.append('signature', file);
      const res = await api.post(`/settings/upload-signature/${role}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const field = role === 'prepared' ? 'prepared_by_signature_url' : 'approved_by_signature_url';
      setBiz((prev: any) => ({ ...prev, [field]: res.data.signature_url }));
      toast.success(`${role === 'prepared' ? 'Prepared by' : 'Approved by'} signature uploaded`);
    } catch (err: any) { toast.error(err.response?.data?.error || 'Upload failed'); }
    finally { setSigUploading(null); }
  };

  if (loading) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading company profile...</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Company Profile</h2>
          <p className="text-xs text-gray-500 mt-0.5">Logo, legal details, and signatories for receipts, invoices, and prints.</p>
        </div>

        <div className="flex items-start gap-6 pb-6 border-b border-gray-100">
          <div className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50 flex-shrink-0">
            {biz.logo_url ? (
              <img src={biz.logo_url} alt="Logo" className="w-full h-full object-contain" />
            ) : (
              <div className="flex flex-col items-center text-gray-400">
                <Upload size={20} />
                <span className="text-[9px] mt-1">No logo</span>
              </div>
            )}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-700 mb-1">Company Logo</p>
            <p className="text-xs text-gray-500 mb-3">PNG, JPG, or GIF (max 5MB)</p>
            {canEdit && (
              <label className={`inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50 ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                <Upload size={14} />
                {logoUploading ? 'Uploading...' : biz.logo_url ? 'Change Logo' : 'Upload Logo'}
                <input type="file" accept="image/png,image/jpeg,image/gif" onChange={handleLogoUpload} className="hidden" />
              </label>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Business Name <span className="text-red-500">*</span></label>
            <input type="text" value={biz.business_name} onChange={(e) => update('business_name', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Trade Name</label>
            <input type="text" value={biz.trade_name || ''} onChange={(e) => update('trade_name', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Address <span className="text-red-500">*</span></label>
            <input type="text" value={biz.address} onChange={(e) => update('address', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} />
          </div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1">Barangay</label><input type="text" value={biz.barangay || ''} onChange={(e) => update('barangay', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1">City</label><input type="text" value={biz.city || ''} onChange={(e) => update('city', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1">Province</label><input type="text" value={biz.province || ''} onChange={(e) => update('province', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1">ZIP Code</label><input type="text" value={biz.zip_code || ''} onChange={(e) => update('zip_code', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div><label className="block text-xs font-medium text-gray-600 mb-1">Mobile</label><input type="text" value={biz.mobile_number || ''} onChange={(e) => update('mobile_number', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1">Telephone</label><input type="text" value={biz.telephone_number || ''} onChange={(e) => update('telephone_number', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
          <div><label className="block text-xs font-medium text-gray-600 mb-1">Email</label><input type="text" value={biz.email_address || ''} onChange={(e) => update('email_address', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">TIN <span className="text-red-500">*</span></label>
            <input type="text" value={biz.tin_number} onChange={(e) => update('tin_number', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">VAT Type</label>
            <select value={biz.vat_type} onChange={(e) => update('vat_type', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS}>
              <option>VAT Registered</option><option>Non-VAT</option><option>Zero Rated</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">VAT Rate (%)</label>
            <NumericInput value={biz.vat_rate ?? ''} onValueChange={(vat_rate) => update('vat_rate', vat_rate)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="block text-xs font-medium text-gray-600 mb-1">Website</label><input type="text" value={biz.website || ''} onChange={(e) => update('website', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date Format</label>
            <select value={biz.date_format} onChange={(e) => update('date_format', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS}>
              <option>MM/DD/YYYY</option><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option>
            </select>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Document Signatories</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Prepared By</label><input type="text" value={biz.prepared_by || ''} onChange={(e) => update('prepared_by', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Position</label><input type="text" value={biz.prepared_by_position || ''} onChange={(e) => update('prepared_by_position', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Approved By</label><input type="text" value={biz.approved_by || ''} onChange={(e) => update('approved_by', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Position</label><input type="text" value={biz.approved_by_position || ''} onChange={(e) => update('approved_by_position', e.target.value)} disabled={!canEdit} className={SETTINGS_INPUT_CLASS} /></div>
          </div>
          {canEdit && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Prepared By Signature</label>
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-xs text-gray-600">
                  <Upload size={14} /> {sigUploading === 'prepared' ? 'Uploading...' : 'Upload PNG/JPG'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => handleSignatureUpload('prepared', e)} className="hidden" />
                </label>
                {biz.prepared_by_signature_url && <img src={`${biz.prepared_by_signature_url}?t=${Date.now()}`} alt="Prepared signature" className="mt-2 h-10 object-contain" />}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Approved By Signature</label>
                <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 text-xs text-gray-600">
                  <Upload size={14} /> {sigUploading === 'approved' ? 'Uploading...' : 'Upload PNG/JPG'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => handleSignatureUpload('approved', e)} className="hidden" />
                </label>
                {biz.approved_by_signature_url && <img src={`${biz.approved_by_signature_url}?t=${Date.now()}`} alt="Approved signature" className="mt-2 h-10 object-contain" />}
              </div>
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Signatures appear on Sales Invoice, Delivery Receipt, Petty Cash, and Sales Return prints.</p>
        </div>

        {canEdit && (
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <button type="button" onClick={load} className="px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50">Discard Changes</button>
            <button type="button" onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-6 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
              <Save size={14} /> {saving ? 'Saving...' : 'Save Company Profile'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
