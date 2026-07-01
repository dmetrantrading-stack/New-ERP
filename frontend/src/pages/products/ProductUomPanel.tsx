import React, { useCallback, useEffect, useState } from 'react';
import api from '../../lib/api';
import {
  findBaseUomFromCatalog,
  findProductBaseRowIndex,
  isProductBaseRow,
  normalizeUomCode,
} from '../../lib/uomUtils';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';

export interface ProductPricingState {
  cost: string | number;
  retail_markup: string | number;
  wholesale_markup: string | number;
  distributor_markup: string | number;
  retail_price: string | number;
  wholesale_price: string | number;
  distributor_price: string | number;
  _manualRetail?: boolean;
  _manualWholesale?: boolean;
  _manualDistributor?: boolean;
}

export interface ProductUomPanelProps {
  allowMultiple: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  conversions: any[];
  pricing: ProductPricingState;
  onAllowMultipleChange: (v: boolean) => void;
  onTrackBatchChange: (v: boolean) => void;
  onTrackExpiryChange: (v: boolean) => void;
  onConversionsChange: (rows: any[]) => void;
  onPricingChange: (updates: Partial<ProductPricingState>) => void;
  productBarcode?: string;
  baseUomId?: number | null;
  onBaseUomIdChange?: (uomId: number, uomCode: string) => void;
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function markupFromPrice(cost: number, price: number) {
  if (cost <= 0 || price <= 0) return 0;
  return roundMoney((price / cost - 1) * 100);
}

export function pricesFromBasePc(
  pricing: ProductPricingState,
  conversionToBase: number,
) {
  const conv = parseFloat(String(conversionToBase)) || 1;
  const cost = parseFloat(String(pricing.cost)) || 0;
  return {
    purchase_price: roundMoney(cost * conv),
    retail_price: roundMoney((parseFloat(String(pricing.retail_price)) || 0) * conv),
    wholesale_price: roundMoney((parseFloat(String(pricing.wholesale_price)) || 0) * conv),
    distributor_price: roundMoney((parseFloat(String(pricing.distributor_price)) || 0) * conv),
  };
}

export default function ProductUomPanel({
  allowMultiple,
  trackBatch,
  trackExpiry,
  conversions,
  pricing,
  onAllowMultipleChange,
  onTrackBatchChange,
  onTrackExpiryChange,
  onConversionsChange,
  onPricingChange,
  productBarcode,
  baseUomId,
  onBaseUomIdChange,
}: ProductUomPanelProps) {
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError(null);
    return api.get('/uoms/catalog')
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : [];
        setCatalog(rows);
        if (!rows.length) setCatalogError('UOM catalog is empty — run migrate and restart backend.');
      })
      .catch((err) => {
        setCatalog([]);
        const msg = err.response?.status === 404
          ? 'UOM API not found — rebuild and restart backend.'
          : (err.response?.data?.error || 'Failed to load UOM catalog');
        setCatalogError(msg);
        toast.error(msg);
      })
      .finally(() => setCatalogLoading(false));
  }, []);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const baseRowIdx = findProductBaseRowIndex(conversions, baseUomId);
  const baseRow = baseRowIdx >= 0 ? conversions[baseRowIdx] : conversions[0];
  const baseUomCode = (baseRow?.uom_code || catalog.find((c) => Number(c.id) === Number(baseRow?.uom_id))?.code || 'pc').toUpperCase();

  const usedUomIds = () => new Set(
    conversions.map((c) => Number(c.uom_id)).filter((id) => Number.isFinite(id) && id > 0),
  );

  const applyAutoToRow = (row: any, idx: number) => {
    if (isProductBaseRow(row, conversions, baseUomId) || !row.auto_from_pc) return row;
    return { ...row, ...pricesFromBasePc(pricing, row.conversion_to_base) };
  };

  const changeBaseUom = (idx: number, uomId: number) => {
    const u = catalog.find((c) => Number(c.id) === Number(uomId));
    const code = normalizeUomCode(u?.code) || 'pc';
    const baseRowNext = {
      ...conversions[idx],
      uom_id: Number(uomId),
      uom_code: code,
      conversion_to_base: 1,
    };
    const alternates = conversions
      .filter((_, i) => i !== idx)
      .filter((r) => Number(r.uom_id) !== Number(uomId))
      .filter((r) => parseFloat(String(r.conversion_to_base)) > 1);
    onConversionsChange([baseRowNext, ...alternates]);
    onBaseUomIdChange?.(Number(uomId), code);
  };

  const updateRow = (idx: number, field: string, value: any) => {
    const rows = [...conversions];
    const isBase = idx === baseRowIdx;
    rows[idx] = { ...rows[idx], [field]: value };
    if (field === 'uom_id' && !isBase) {
      const u = catalog.find((c) => Number(c.id) === parseInt(String(value), 10));
      rows[idx].uom_code = normalizeUomCode(u?.code) || rows[idx].uom_code;
    }
    if (field === 'conversion_to_base' && !isBase) {
      const conv = parseFloat(String(value)) || 1;
      if (conv <= 1) {
        toast.error('Alternate UOM must convert to more than 1 base unit');
        rows[idx].conversion_to_base = 2;
      }
    }
    if (field === 'conversion_to_base' || field === 'auto_from_pc') {
      rows[idx] = applyAutoToRow(rows[idx], idx);
    }
    onConversionsChange(rows);
  };

  const addRow = () => {
    if (catalogLoading) { toast.error('UOM catalog is still loading…'); return; }
    if (catalogError || !catalog.length) { toast.error(catalogError || 'UOM catalog unavailable'); loadCatalog(); return; }
    const used = usedUomIds();
    const next = catalog.find((c) => {
      const id = Number(c.id);
      return id > 0 && !used.has(id);
    });
    if (!next) { toast.error('All available UOMs are already added'); return; }
    if (!allowMultiple) onAllowMultipleChange(true);
    const conversion = 12;
    const autoPrices = pricesFromBasePc(pricing, conversion);
    onConversionsChange([...conversions, {
      uom_id: Number(next.id),
      uom_code: normalizeUomCode(next.code),
      conversion_to_base: conversion,
      barcode: '',
      auto_from_pc: true,
      ...autoPrices,
      is_default_purchase: false,
      is_default_sales: false,
    }]);
  };

  const removeRow = (idx: number) => {
    if (idx === baseRowIdx) return;
    onConversionsChange(conversions.filter((_, i) => i !== idx));
  };

  const handleCostChange = (value: string) => {
    onPricingChange({
      cost: value,
      _manualRetail: false,
      _manualWholesale: false,
      _manualDistributor: false,
    });
  };

  const handleMarkupChange = (tier: 'retail' | 'wholesale' | 'distributor', value: string) => {
    if (tier === 'retail') onPricingChange({ retail_markup: value, _manualRetail: false });
    if (tier === 'wholesale') onPricingChange({ wholesale_markup: value, _manualWholesale: false });
    if (tier === 'distributor') onPricingChange({ distributor_markup: value, _manualDistributor: false });
  };

  const handlePriceChange = (tier: 'retail' | 'wholesale' | 'distributor', value: string) => {
    const cost = parseFloat(String(pricing.cost)) || 0;
    const price = parseFloat(value) || 0;
    if (tier === 'retail') {
      onPricingChange({
        retail_price: value,
        _manualRetail: true,
        retail_markup: markupFromPrice(cost, price),
      });
    }
    if (tier === 'wholesale') {
      onPricingChange({
        wholesale_price: value,
        _manualWholesale: true,
        wholesale_markup: markupFromPrice(cost, price),
      });
    }
    if (tier === 'distributor') {
      onPricingChange({
        distributor_price: value,
        _manualDistributor: true,
        distributor_markup: markupFromPrice(cost, price),
      });
    }
  };

  const alternateCatalog = catalog.filter((c) => {
    const id = Number(c.id);
    return id > 0 && id !== Number(baseRow?.uom_id);
  });
  const cost = parseFloat(String(pricing.cost)) || 0;
  const alternateCount = conversions.filter((r, i) => i !== baseRowIdx).length;
  const canAddUom = !catalogLoading && !catalogError && catalog.length > 0
    && catalog.some((c) => !usedUomIds().has(Number(c.id)));

  return (
    <div className="col-span-2 border rounded-lg p-4 bg-slate-50/80 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-gray-800">Pricing &amp; Units</p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm cursor-pointer" title="Enable box/case/pack pricing rows">
            <input type="checkbox" checked={allowMultiple || alternateCount > 0} onChange={(e) => onAllowMultipleChange(e.target.checked)} className="rounded" />
            Multiple UOM
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={trackBatch} onChange={(e) => onTrackBatchChange(e.target.checked)} className="rounded" />
            Track batch
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={trackExpiry} onChange={(e) => onTrackExpiryChange(e.target.checked)} className="rounded" />
            Track expiry
          </label>
        </div>
      </div>

      <div className="max-w-xs">
        <label className="block text-sm font-medium mb-1">Cost (per {baseUomCode})</label>
        <input type="number" step="0.01" value={pricing.cost}
          onChange={(e) => handleCostChange(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
      </div>

      {catalogLoading && <p className="text-xs text-amber-700">Loading UOM catalog…</p>}
      {!catalogLoading && catalogError && <p className="text-xs text-red-600">{catalogError}</p>}

      <p className="text-xs text-gray-500">
        Choose base UOM (KG, PC, etc.) for cost and stock. Alternate UOMs (e.g. SACK) use = Base conversion and can auto-price from base × conversion.
      </p>

      <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <table className="w-full text-xs min-w-[900px]">
          <thead className="bg-gray-50 text-gray-500 uppercase">
            <tr>
              <th className="px-2 py-2 text-left" rowSpan={2}>UOM</th>
              <th className="px-2 py-2 text-right" rowSpan={2}>= Base</th>
              <th className="px-2 py-2 text-left" rowSpan={2}>Barcode</th>
              <th className="px-2 py-2 text-center border-l border-gray-200" colSpan={2}>Retail</th>
              <th className="px-2 py-2 text-center border-l border-gray-200" colSpan={2}>Wholesale</th>
              <th className="px-2 py-2 text-center border-l border-gray-200" colSpan={2}>Distributor</th>
              <th className="px-2 py-2 text-center border-l border-gray-200" rowSpan={2}>Auto</th>
              <th className="px-2 py-2 text-center" rowSpan={2} title="Default for sales">Sales</th>
              <th className="px-2 py-2 text-center" rowSpan={2} title="Default for purchase">Purchase</th>
              <th className="px-2 py-2 w-8" rowSpan={2} />
            </tr>
            <tr>
              <th className="px-2 py-1 text-right border-l border-gray-200">Markup %</th>
              <th className="px-2 py-1 text-right">Price</th>
              <th className="px-2 py-1 text-right border-l border-gray-200">Markup %</th>
              <th className="px-2 py-1 text-right">Price</th>
              <th className="px-2 py-1 text-right border-l border-gray-200">Markup %</th>
              <th className="px-2 py-1 text-right">Price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {conversions.map((row, idx) => {
              const isBase = idx === baseRowIdx;
              const retailPrice = isBase ? pricing.retail_price : row.retail_price ?? 0;
              const wholesalePrice = isBase ? pricing.wholesale_price : row.wholesale_price ?? 0;
              const distributorPrice = isBase ? pricing.distributor_price : row.distributor_price ?? 0;

              return (
                <tr key={`${row.uom_id}-${idx}`}>
                  <td className="px-2 py-1.5 font-medium uppercase">
                    {isBase ? (
                      <select value={row.uom_id || ''} onChange={(e) => changeBaseUom(idx, parseInt(e.target.value, 10))}
                        className="w-full min-w-[72px] px-1 py-1 border rounded text-xs uppercase bg-blue-50/50">
                        {catalog.map((c) => {
                          const taken = conversions.some((r, i) => i !== idx && Number(r.uom_id) === Number(c.id));
                          return <option key={c.id} value={c.id} disabled={taken}>{(c.code || c.name || '').toUpperCase()}</option>;
                        })}
                      </select>
                    ) : (
                      <select value={row.uom_id || ''} onChange={(e) => updateRow(idx, 'uom_id', parseInt(e.target.value, 10))}
                        className="w-full min-w-[72px] px-1 py-1 border rounded text-xs uppercase">
                        {alternateCatalog.map((c) => {
                          const taken = conversions.some((r, i) => i !== idx && Number(r.uom_id) === Number(c.id));
                          return <option key={c.id} value={c.id} disabled={taken}>{(c.code || c.name || '').toUpperCase()}</option>;
                        })}
                      </select>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" min={isBase ? 1 : 2} step="0.0001" value={row.conversion_to_base} disabled={isBase}
                      onChange={(e) => updateRow(idx, 'conversion_to_base', parseFloat(e.target.value) || (isBase ? 1 : 2))}
                      className="w-16 px-2 py-1 border rounded text-right disabled:bg-gray-100" />
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="text" value={isBase ? (productBarcode ?? row.barcode ?? '') : (row.barcode || '')}
                      onChange={(e) => !isBase && updateRow(idx, 'barcode', e.target.value)}
                      disabled={isBase}
                      className="w-full min-w-[90px] px-2 py-1 border rounded disabled:bg-gray-50"
                      placeholder={isBase ? 'Main barcode above' : 'UOM barcode'} />
                  </td>
                  <td className="px-2 py-1.5 border-l border-gray-100">
                    {isBase ? (
                      <input type="number" step="0.01" value={pricing.retail_markup}
                        onChange={(e) => handleMarkupChange('retail', e.target.value)}
                        className="w-16 px-2 py-1 border rounded text-right" />
                    ) : <span className="text-gray-300 block text-center">—</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" step="0.01" value={retailPrice}
                      disabled={!isBase && Boolean(row.auto_from_pc)}
                      onChange={(e) => isBase
                        ? handlePriceChange('retail', e.target.value)
                        : updateRow(idx, 'retail_price', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 border rounded text-right text-blue-700 font-medium disabled:bg-gray-50" />
                  </td>
                  <td className="px-2 py-1.5 border-l border-gray-100">
                    {isBase ? (
                      <input type="number" step="0.01" value={pricing.wholesale_markup}
                        onChange={(e) => handleMarkupChange('wholesale', e.target.value)}
                        className="w-16 px-2 py-1 border rounded text-right" />
                    ) : <span className="text-gray-300 block text-center">—</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" step="0.01" value={wholesalePrice}
                      disabled={!isBase && Boolean(row.auto_from_pc)}
                      onChange={(e) => isBase
                        ? handlePriceChange('wholesale', e.target.value)
                        : updateRow(idx, 'wholesale_price', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 border rounded text-right text-green-700 font-medium disabled:bg-gray-50" />
                  </td>
                  <td className="px-2 py-1.5 border-l border-gray-100">
                    {isBase ? (
                      <input type="number" step="0.01" value={pricing.distributor_markup}
                        onChange={(e) => handleMarkupChange('distributor', e.target.value)}
                        className="w-16 px-2 py-1 border rounded text-right" />
                    ) : <span className="text-gray-300 block text-center">—</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <input type="number" step="0.01" value={distributorPrice}
                      disabled={!isBase && Boolean(row.auto_from_pc)}
                      onChange={(e) => isBase
                        ? handlePriceChange('distributor', e.target.value)
                        : updateRow(idx, 'distributor_price', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1 border rounded text-right text-purple-700 font-medium disabled:bg-gray-50" />
                  </td>
                  <td className="px-2 py-1.5 text-center border-l border-gray-100">
                    {!isBase ? (
                      <input type="checkbox" checked={Boolean(row.auto_from_pc)}
                        onChange={(e) => updateRow(idx, 'auto_from_pc', e.target.checked)}
                        title={`Auto-calc from ${baseUomCode} price × conversion`} />
                    ) : (
                      <span className="text-[10px] text-gray-400">cost</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="radio" name="default_sales_uom" checked={Boolean(row.is_default_sales)}
                      onChange={() => onConversionsChange(conversions.map((r, i) => ({ ...r, is_default_sales: i === idx })))} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="radio" name="default_purchase_uom" checked={Boolean(row.is_default_purchase)}
                      onChange={() => onConversionsChange(conversions.map((r, i) => ({ ...r, is_default_purchase: i === idx })))} />
                  </td>
                  <td className="px-2 py-1.5">
                    {!isBase && (
                      <button type="button" onClick={() => removeRow(idx)} className="p-1 text-red-500 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addRow}
          disabled={!canAddUom}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={14} />
          Add UOM
        </button>
        <span className="text-[11px] text-gray-500">
          {alternateCount > 0
            ? `${alternateCount} alternate UOM${alternateCount === 1 ? '' : 's'} · set conversion (= base ${baseUomCode}) and purchase/sales defaults`
            : 'Add SACK, Box, Case, etc. — enables multi-UOM on PO, GR, and POS'}
        </span>
      </div>

      {cost > 0 && (
        <p className="text-[10px] text-gray-400">
          {baseUomCode} markup: retail +{markupFromPrice(cost, parseFloat(String(pricing.retail_price)) || 0)}%
          {' · '}wholesale +{markupFromPrice(cost, parseFloat(String(pricing.wholesale_price)) || 0)}%
          {' · '}distributor +{markupFromPrice(cost, parseFloat(String(pricing.distributor_price)) || 0)}%
        </p>
      )}
    </div>
  );
}

export { findBaseUomFromCatalog };
