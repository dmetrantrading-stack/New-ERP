import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';

type Props = {
  canEdit?: boolean;
};

export default function GlIntegrityTab({ canEdit = false }: Props) {
  const [glIntegrity, setGlIntegrity] = useState<any>(null);
  const [glIntegrityLoading, setGlIntegrityLoading] = useState(false);
  const [glRepairingId, setGlRepairingId] = useState<string | null>(null);

  const [categoryGl, setCategoryGl] = useState<any>(null);
  const [categoryGlLoading, setCategoryGlLoading] = useState(false);

  const [posCategoryGl, setPosCategoryGl] = useState<any>(null);
  const [posCategoryGlLoading, setPosCategoryGlLoading] = useState(false);
  const [posRepairingId, setPosRepairingId] = useState<string | null>(null);
  const [repairingAllPos, setRepairingAllPos] = useState(false);

  const fetchGlIntegrity = useCallback(async () => {
    setGlIntegrityLoading(true);
    try {
      const res = await api.get('/accounting/gl-integrity/duplicate-cogs');
      setGlIntegrity(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load GL integrity check');
    } finally {
      setGlIntegrityLoading(false);
    }
  }, []);

  const fetchCategoryGl = useCallback(async () => {
    setCategoryGlLoading(true);
    try {
      const ping = await api.get('/accounting/gl-integrity/ping');
      if (!ping.data?.ok) {
        toast.error('GL Integrity API is unavailable — restart the backend after npm run build');
        return;
      }
      const res = await api.get('/accounting/gl-integrity/category-gl-mapping');
      setCategoryGl(res.data);
    } catch (err: any) {
      const msg = err.response?.status === 404
        ? 'GL Integrity routes not loaded — stop the backend, run npm run build, then npm start (or npm run dev)'
        : (err.response?.data?.error || 'Failed to load category GL check');
      toast.error(msg);
    } finally {
      setCategoryGlLoading(false);
    }
  }, []);

  const fetchPosCategoryGl = useCallback(async () => {
    setPosCategoryGlLoading(true);
    try {
      const res = await api.get('/accounting/gl-integrity/pos-category-gl');
      setPosCategoryGl(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to load POS category GL check');
    } finally {
      setPosCategoryGlLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchGlIntegrity(), fetchCategoryGl(), fetchPosCategoryGl()]);
  }, [fetchGlIntegrity, fetchCategoryGl, fetchPosCategoryGl]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const repairPosCategoryGl = async (transactionId: string, transactionNumber: string) => {
    if (!window.confirm(`Reclassify POS ${transactionNumber} to category Sales/COGS accounts?`)) return;
    setPosRepairingId(transactionId);
    try {
      const res = await api.post(`/accounting/gl-integrity/repair-pos-category-gl/${transactionId}`);
      toast.success(`Reclassified ${transactionNumber} → ${res.data.expected_revenue}`);
      fetchPosCategoryGl();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Reclassify failed');
    } finally {
      setPosRepairingId(null);
    }
  };

  const repairAllPosCategoryGl = async () => {
    const count = posCategoryGl?.issue_count || 0;
    if (!count) return;
    if (!window.confirm(`Reclassify ${count} POS sale(s) to their category GL accounts?`)) return;
    setRepairingAllPos(true);
    try {
      const res = await api.post('/accounting/gl-integrity/repair-all-pos-category-gl');
      toast.success(res.data.message || 'Reclassified POS sales');
      fetchPosCategoryGl();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Bulk reclassify failed');
    } finally {
      setRepairingAllPos(false);
    }
  };

  const repairDuplicateCogs = async (invoiceId: string, invoiceNumber: string) => {
    if (!window.confirm(`Remove duplicate Sales Invoice COGS for ${invoiceNumber}? DR COGS will be kept.`)) return;
    setGlRepairingId(invoiceId);
    try {
      const res = await api.post(`/accounting/gl-integrity/repair-duplicate-cogs/${invoiceId}`);
      toast.success(`Repaired ${invoiceNumber}: ${res.data.removed_lines} JE lines removed`);
      fetchGlIntegrity();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Repair failed');
    } finally {
      setGlRepairingId(null);
    }
  };

  const accountLabel = (code: string | null, name: string | null) => {
    if (!code) return '—';
    return name ? `${code} — ${name}` : code;
  };

  const loading = glIntegrityLoading || categoryGlLoading || posCategoryGlLoading;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-800">GL Integrity Checks</div>
          <p className="text-xs text-gray-500 mt-0.5">
            Duplicate COGS and product category → Chart of Accounts mapping health.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Refresh All'}
        </button>
      </div>

      {/* Category GL mapping */}
      {categoryGl && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-sm font-semibold text-gray-800">Category → Chart of Accounts</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Each product category must map to an active Sales (Income) and Cost (COGS) account.
              Fix mappings in{' '}
              <Link to="/products?tab=categories" className="text-blue-700 hover:underline font-medium">
                Product Master → Categories
              </Link>
              .
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={`rounded-lg border p-3 ${categoryGl.issue_count > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
              <div className="text-[10px] font-semibold text-gray-500 uppercase">Categories With Issues</div>
              <div className={`text-xl font-bold ${categoryGl.issue_count > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                {categoryGl.issue_count}
              </div>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-3">
              <div className="text-[10px] font-semibold text-gray-500 uppercase">Healthy Categories</div>
              <div className="text-xl font-bold text-green-700">{categoryGl.healthy_count ?? 0}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-[10px] font-semibold text-gray-500 uppercase">Categories Checked</div>
              <div className="text-xl font-bold text-gray-800">{categoryGl.categories_checked ?? 0}</div>
            </div>
            <div className={`rounded-lg border p-3 ${categoryGl.products_without_category > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
              <div className="text-[10px] font-semibold text-gray-500 uppercase">Products Without Category</div>
              <div className={`text-xl font-bold ${categoryGl.products_without_category > 0 ? 'text-amber-700' : 'text-gray-800'}`}>
                {categoryGl.products_without_category ?? 0}
              </div>
              {categoryGl.products_without_category > 0 && (
                <p className="text-[10px] text-amber-800 mt-1">Post to default 4000 / 5000</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b text-[10px] font-semibold text-gray-400 uppercase">
              Category GL Issues
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Products</th>
                  <th>Sales Account</th>
                  <th>Cost Account</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {(categoryGl.rows || []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-400 py-8">
                      All categories have valid GL mappings
                    </td>
                  </tr>
                )}
                {(categoryGl.rows || []).map((row: any) => (
                  <tr key={row.category_id} className="bg-amber-50/40">
                    <td className="font-medium">{row.category_name}</td>
                    <td>{row.product_count ?? 0}</td>
                    <td className="text-xs text-gray-600">
                      {accountLabel(row.revenue_account_code, row.revenue_account_name)}
                    </td>
                    <td className="text-xs text-gray-600">
                      {accountLabel(row.cogs_account_code, row.cogs_account_name)}
                    </td>
                    <td className="text-xs text-amber-800">
                      <ul className="list-disc list-inside space-y-0.5">
                        {(row.issues || []).map((issue: string, i: number) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* POS category GL misclassification */}
      {posCategoryGl && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">POS → Category GL</div>
              <p className="text-xs text-gray-500 mt-0.5">
                POS sales posted to the wrong Sales/COGS account (e.g. 4000 instead of 4015 Rice). Reclassify so the income statement shows the correct category.
              </p>
            </div>
            {canEdit && posCategoryGl.issue_count > 0 && (
              <button
                type="button"
                onClick={repairAllPosCategoryGl}
                disabled={repairingAllPos}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 disabled:opacity-50"
              >
                {repairingAllPos ? 'Reclassifying…' : `Reclassify all (${posCategoryGl.issue_count})`}
              </button>
            )}
          </div>

          <div className={`rounded-lg border p-3 ${posCategoryGl.issue_count > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
            <div className="text-[10px] font-semibold text-gray-500 uppercase">Misclassified POS Sales</div>
            <div className={`text-xl font-bold ${posCategoryGl.issue_count > 0 ? 'text-amber-700' : 'text-green-700'}`}>
              {posCategoryGl.issue_count}
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Receipt #</th>
                  <th>Date</th>
                  <th className="text-right">Total</th>
                  <th>Posted (wrong)</th>
                  <th>Should be</th>
                  {canEdit && <th className="text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {(posCategoryGl.rows || []).length === 0 && (
                  <tr><td colSpan={canEdit ? 6 : 5} className="text-center text-gray-400 py-8">All POS sales use correct category GL accounts</td></tr>
                )}
                {(posCategoryGl.rows || []).map((row: any) => (
                  <tr key={row.transaction_id} className="bg-amber-50/40">
                    <td className="font-mono text-xs">{row.transaction_number}</td>
                    <td className="text-xs">{String(row.transaction_date).slice(0, 10)}</td>
                    <td className="text-right">{formatCurrency(row.total)}</td>
                    <td className="text-xs text-red-700">{row.actual_revenue_accounts}</td>
                    <td className="text-xs text-green-700">{row.expected_revenue_accounts}</td>
                    {canEdit && (
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => repairPosCategoryGl(row.transaction_id, row.transaction_number)}
                          disabled={posRepairingId === row.transaction_id}
                          className="text-xs text-blue-700 hover:text-blue-900 font-medium disabled:opacity-50"
                        >
                          {posRepairingId === row.transaction_id ? 'Fixing…' : 'Reclassify'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Duplicate COGS */}
      {glIntegrity && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3">
            <div className="text-sm font-semibold text-gray-800">Duplicate COGS Check</div>
            <p className="text-xs text-gray-500 mt-0.5">
              Finds invoices where Delivery Receipt and Sales Invoice both posted COGS (double-counted).
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className={`rounded-lg border p-3 ${glIntegrity.issue_count > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`}>
              <div className="text-[10px] font-semibold text-gray-500 uppercase">Issues Found</div>
              <div className={`text-xl font-bold ${glIntegrity.issue_count > 0 ? 'text-amber-700' : 'text-green-700'}`}>{glIntegrity.issue_count}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-[10px] font-semibold text-gray-500 uppercase">Est. Duplicate COGS</div>
              <div className="text-xl font-bold text-gray-800">{formatCurrency(glIntegrity.total_duplicate_cogs || 0)}</div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-3 py-2 border-b text-[10px] font-semibold text-gray-400 uppercase">Duplicate COGS Invoices</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>DR #</th>
                  <th className="text-right">DR COGS</th>
                  <th className="text-right">SI COGS</th>
                  <th className="text-right">Duplicate</th>
                  {canEdit && <th className="text-right">Action</th>}
                </tr>
              </thead>
              <tbody>
                {(glIntegrity.rows || []).length === 0 && (
                  <tr><td colSpan={canEdit ? 6 : 5} className="text-center text-gray-400 py-8">No duplicate COGS detected</td></tr>
                )}
                {(glIntegrity.rows || []).map((row: any) => (
                  <tr key={row.invoice_id} className="bg-amber-50/40">
                    <td className="font-mono text-xs">{row.invoice_number}</td>
                    <td className="font-mono text-xs">{row.dr_number || '—'}</td>
                    <td className="text-right">{formatCurrency(row.dr_cogs)}</td>
                    <td className="text-right">{formatCurrency(row.si_cogs)}</td>
                    <td className="text-right font-semibold text-amber-700">{formatCurrency(row.duplicate_amount)}</td>
                    {canEdit && (
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => repairDuplicateCogs(row.invoice_id, row.invoice_number)}
                          disabled={glRepairingId === row.invoice_id}
                          className="text-xs text-blue-700 hover:text-blue-900 font-medium disabled:opacity-50"
                        >
                          {glRepairingId === row.invoice_id ? 'Repairing…' : 'Repair'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
