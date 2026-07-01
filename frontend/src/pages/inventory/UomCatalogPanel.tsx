import React, { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import { isBaseUomCode } from '../../lib/uomUtils';
import { Plus, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../store/auth';

const PRIMARY = '#1E40AF';

type UomRow = { id: number; code: string; name: string };

const QUICK_ADD: { code: string; name: string }[] = [
  { code: '500g', name: '500 Gram' },
  { code: 'kg', name: 'Kilogram' },
  { code: '250g', name: '250 Gram' },
  { code: 'g', name: 'Gram' },
];

export default function UomCatalogPanel() {
  const { hasPerm } = useAuth();
  const canEdit = hasPerm('inventory.inventory.edit');
  const [catalog, setCatalog] = useState<UomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/uoms/catalog');
      setCatalog(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load UOM catalog');
      setCatalog([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const catalogCodes = new Set(catalog.map((c) => String(c.code || '').toLowerCase()));

  const addUom = async (nextCode: string, nextName?: string) => {
    const trimmed = nextCode.trim();
    if (!trimmed) {
      toast.error('Enter a UOM code');
      return;
    }
    setSaving(true);
    try {
      await api.post('/uoms/catalog', {
        code: trimmed,
        name: nextName?.trim() || undefined,
      });
      toast.success(`UOM ${trimmed.toUpperCase()} added`);
      setCode('');
      setName('');
      await loadCatalog();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add UOM');
    } finally {
      setSaving(false);
    }
  };

  const removeUom = async (u: UomRow) => {
    const label = (u.code || '').toUpperCase();
    if (isBaseUomCode(u.code)) {
      toast.error('Cannot remove the base unit (PC)');
      return;
    }
    if (!window.confirm(`Remove ${label} from the UOM catalog? It will no longer appear when adding units on products.`)) {
      return;
    }
    setRemovingId(u.id);
    try {
      await api.delete(`/uoms/catalog/${u.id}`);
      toast.success(`${label} removed`);
      await loadCatalog();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to remove UOM');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">UOM Catalog</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Global units available when adding UOM on products (Box, 500G, KG, etc.)
          </p>
        </div>
        <button
          type="button"
          onClick={loadCatalog}
          disabled={loading}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-2">Loading catalog…</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {catalog.map((u) => {
            const isBase = isBaseUomCode(u.code);
            const canRemove = canEdit && !isBase;
            return (
              <span
                key={u.id}
                className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-md text-xs font-semibold uppercase ${
                  isBase ? 'bg-blue-50 text-blue-800 border border-blue-100' : 'bg-slate-100 text-slate-700'
                }`}
                title={u.name}
              >
                {(u.code || '').toUpperCase()}
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => removeUom(u)}
                    disabled={removingId === u.id || saving}
                    className="p-0.5 rounded hover:bg-red-100 text-red-600 disabled:opacity-40"
                    title={`Remove ${(u.code || '').toUpperCase()}`}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {canEdit && (
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <p className="text-xs font-medium text-gray-600">Add UOM</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {QUICK_ADD.filter((q) => !catalogCodes.has(q.code.toLowerCase())).map((q) => (
              <button
                key={q.code}
                type="button"
                disabled={saving}
                onClick={() => addUom(q.code, q.name)}
                className="px-2.5 py-1 text-xs font-semibold rounded-md border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                + {q.code.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wide">Code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="500g"
                className="w-28 px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm uppercase"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wide">Name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="500 Gram"
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm"
              />
            </div>
            <button
              type="button"
              disabled={saving || !code.trim()}
              onClick={() => addUom(code, name)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg text-white disabled:opacity-50"
              style={{ backgroundColor: PRIMARY }}
            >
              <Plus size={14} />
              Add UOM
            </button>
          </div>
          <p className="text-[10px] text-gray-400">
            Click × on a unit to remove it from the catalog. PC cannot be removed. Units still used on products must be removed from those products first.
          </p>
        </div>
      )}
    </div>
  );
}
