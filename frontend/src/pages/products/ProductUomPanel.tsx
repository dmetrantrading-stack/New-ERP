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

/** Derive base-unit cost from pack/box purchase cost and conversion (e.g. box ÷ 12 → PC). */
export function baseCostFromPackCost(packCost: number, conversionToBase: number): number {
  const conv = parseFloat(String(conversionToBase)) || 1;
  if (conv <= 0 || !Number.isFinite(packCost)) return 0;
  return roundMoney(packCost / conv);
}

const PACK_UOM_PATTERN = /^(box|bx|case|cs|pack|ctn|sack|bag)$/i;

function findPackCostRow(conversions: any[], baseRowIdx: number) {
  const alternates = conversions
    .map((r, i) => ({ row: r, idx: i }))
    .filter(({ idx }) => idx !== baseRowIdx);
  if (alternates.length === 0) return null;
  const purchaseDefault = alternates.find(({ row }) => row.is_default_purchase);
  if (purchaseDefault) return purchaseDefault;
  const boxLike = alternates.find(({ row }) => PACK_UOM_PATTERN.test(normalizeUomCode(row.uom_code || '')));
  if (boxLike) return boxLike;
  return alternates[0];
}

export function ProductFormSection({
  step,
  title,
  children,
  className = '',
}: {
  step: number;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white overflow-hidden ${className}`}>
      <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{step} · {title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
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
  /** When set, user entered pack/box cost — base cost is derived from this ÷ conversion. */
  const [packCostDraft, setPackCostDraft] = useState<string | null>(null);

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

    if (field === 'conversion_to_base' && !isBase && packCostDraft != null && packCostDraft.trim() !== '') {
      const packRow = findPackCostRow(conversions, baseRowIdx);
      if (packRow && packRow.idx === idx) {
        const packCost = parseFloat(packCostDraft);
        const conv = parseFloat(String(rows[idx].conversion_to_base)) || 1;
        if (!Number.isNaN(packCost) && packCost > 0 && conv > 0) {
          onPricingChange({
            cost: baseCostFromPackCost(packCost, conv),
            _manualRetail: false,
            _manualWholesale: false,
            _manualDistributor: false,
          });
        }
      }
    }
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
    setPackCostDraft(null);
    onPricingChange({
      cost: value,
      _manualRetail: false,
      _manualWholesale: false,
      _manualDistributor: false,
    });
  };

  const handlePackCostChange = (value: string, conversionToBase: number) => {
    setPackCostDraft(value);
    const packCost = parseFloat(value);
    const conv = parseFloat(String(conversionToBase)) || 1;
    if (value.trim() === '' || Number.isNaN(packCost)) return;
    if (packCost < 0) return;
    if (conv <= 1) {
      toast.error('Set = Base conversion above 1 before entering pack cost');
      return;
    }
    onPricingChange({
      cost: baseCostFromPackCost(packCost, conv),
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
  const packCostRow = findPackCostRow(conversions, baseRowIdx);
  const packUomCode = packCostRow
    ? (packCostRow.row.uom_code || catalog.find((c) => Number(c.id) === Number(packCostRow.row.uom_id))?.code || 'BOX').toUpperCase()
    : 'BOX';
  const packConversion = packCostRow ? parseFloat(String(packCostRow.row.conversion_to_base)) || 1 : 1;
  const derivedPackCost = cost > 0 && packConversion > 1 ? roundMoney(cost * packConversion) : '';
  const packCostDisplay = packCostDraft !== null ? packCostDraft : derivedPackCost;
  const canAddUom = !catalogLoading && !catalogError && catalog.length > 0
    && catalog.some((c) => !usedUomIds().has(Number(c.id)));

  return (
    <>
      <ProductFormSection step={2} title="Cost">
        <div className={`grid gap-4 ${packCostRow ? 'grid-cols-1 sm:grid-cols-2' : ''}`}>
          <div>
            <label className="block text-sm font-medium mb-1">Cost (per {baseUomCode})</label>
            <input type="number" step="0.01" min={0} value={pricing.cost}
              onChange={(e) => handleCostChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white" />
            <p className="text-[10px] text-gray-400 mt-1">Inventory and COGS use this base unit cost.</p>
          </div>
          {packCostRow ? (
            <div>
              <label className="block text-sm font-medium mb-1">Cost (per {packUomCode})</label>
              <input type="number" step="0.01" min={0} value={packCostDisplay}
                onChange={(e) => handlePackCostChange(e.target.value, packConversion)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                placeholder={`Supplier price per ${packUomCode}`} />
              <p className="text-[10px] text-gray-400 mt-1">
                1 {packUomCode} = {packConversion} {baseUomCode} · base = pack ÷ {packConversion}
              </p>
            </div>
          ) : (
            <p className="text-xs text-gray-500 self-end pb-2">
              Add a Box/Case UOM in section 4 to enter cost per pack.
            </p>
          )}
        </div>
      </ProductFormSection>

      <ProductFormSection step={3} title={`Selling prices (per ${baseUomCode})`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {([
            { tier: 'retail' as const, label: 'Retail', markup: pricing.retail_markup, price: pricing.retail_price, color: 'text-blue-700' },
            { tier: 'wholesale' as const, label: 'Wholesale', markup: pricing.wholesale_markup, price: pricing.wholesale_price, color: 'text-green-700' },
            { tier: 'distributor' as const, label: 'Distributor', markup: pricing.distributor_markup, price: pricing.distributor_price, color: 'text-purple-700' },
          ]).map(({ tier, label, markup, price, color }) => (
            <div key={tier} className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 space-y-2">
              <p className="text-xs font-semibold text-gray-600">{label}</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">Markup %</label>
                  <input type="number" step="0.01" value={markup}
                    onChange={(e) => handleMarkupChange(tier, e.target.value)}
                    className="w-full px-2 py-1.5 border rounded text-sm text-right bg-white" />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-400 mb-0.5">Price</label>
                  <input type="number" step="0.01" value={price}
                    onChange={(e) => handlePriceChange(tier, e.target.value)}
                    className={`w-full px-2 py-1.5 border rounded text-sm text-right font-medium bg-white ${color}`} />
                </div>
              </div>
            </div>
          ))}
        </div>
        {cost > 0 && (
          <p className="text-[10px] text-gray-400 mt-3">
            Markup vs cost: retail +{markupFromPrice(cost, parseFloat(String(pricing.retail_price)) || 0)}%
            {' · '}wholesale +{markupFromPrice(cost, parseFloat(String(pricing.wholesale_price)) || 0)}%
            {' · '}distributor +{markupFromPrice(cost, parseFloat(String(pricing.distributor_price)) || 0)}%
          </p>
        )}
      </ProductFormSection>

      <ProductFormSection step={4} title="Units of measure">
        <div className="flex flex-wrap items-center gap-4 mb-4">
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

        {catalogLoading && <p className="text-xs text-amber-700 mb-3">Loading UOM catalog…</p>}
        {!catalogLoading && catalogError && <p className="text-xs text-red-600 mb-3">{catalogError}</p>}

        <p className="text-xs text-gray-500 mb-3">
          Base UOM drives stock ({baseUomCode}). Alternate UOMs (Box, Case) use conversion and can auto-price from section 3.
        </p>

        <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-gray-50 text-gray-500 uppercase">
              <tr>
                <th className="px-2 py-2 text-left">UOM</th>
                <th className="px-2 py-2 text-right">= Base</th>
                <th className="px-2 py-2 text-left">Barcode</th>
                <th className="px-2 py-2 text-right border-l border-gray-200">Retail</th>
                <th className="px-2 py-2 text-right">Wholesale</th>
                <th className="px-2 py-2 text-right">Distributor</th>
                <th className="px-2 py-2 text-center border-l border-gray-200">Auto</th>
                <th className="px-2 py-2 text-center" title="Default for sales">Sales</th>
                <th className="px-2 py-2 text-center" title="Default for purchase">Purchase</th>
                <th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {conversions.map((row, idx) => {
                const isBase = idx === baseRowIdx;
                const retailPrice = isBase ? pricing.retail_price : row.retail_price ?? 0;
                const wholesalePrice = isBase ? pricing.wholesale_price : row.wholesale_price ?? 0;
                const distributorPrice = isBase ? pricing.distributor_price : row.distributor_price ?? 0;

                return (
                  <tr key={`${row.uom_id}-${idx}`} className={isBase ? 'bg-blue-50/30' : ''}>
                    <td className="px-2 py-1.5 font-medium uppercase">
                      {isBase ? (
                        <select value={row.uom_id || ''} onChange={(e) => changeBaseUom(idx, parseInt(e.target.value, 10))}
                          className="w-full min-w-[72px] px-1 py-1 border rounded text-xs uppercase bg-white">
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
                      {isBase ? (
                        <span className="text-[10px] text-gray-400 px-1">Main barcode in section 1</span>
                      ) : (
                        <input type="text" value={row.barcode || ''}
                          onChange={(e) => updateRow(idx, 'barcode', e.target.value)}
                          className="w-full min-w-[90px] px-2 py-1 border rounded"
                          placeholder="UOM barcode" />
                      )}
                    </td>
                    <td className="px-2 py-1.5 border-l border-gray-100 text-right text-[10px] text-gray-400">
                      {isBase ? 'See §3' : (
                        <input type="number" step="0.01" value={retailPrice}
                          disabled={Boolean(row.auto_from_pc)}
                          onChange={(e) => updateRow(idx, 'retail_price', parseFloat(e.target.value) || 0)}
                          className="w-20 px-2 py-1 border rounded text-right text-blue-700 font-medium disabled:bg-gray-50" />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {isBase ? '—' : (
                        <input type="number" step="0.01" value={wholesalePrice}
                          disabled={Boolean(row.auto_from_pc)}
                          onChange={(e) => updateRow(idx, 'wholesale_price', parseFloat(e.target.value) || 0)}
                          className="w-20 px-2 py-1 border rounded text-right text-green-700 font-medium disabled:bg-gray-50" />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {isBase ? '—' : (
                        <input type="number" step="0.01" value={distributorPrice}
                          disabled={Boolean(row.auto_from_pc)}
                          onChange={(e) => updateRow(idx, 'distributor_price', parseFloat(e.target.value) || 0)}
                          className="w-20 px-2 py-1 border rounded text-right text-purple-700 font-medium disabled:bg-gray-50" />
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center border-l border-gray-100">
                      {!isBase ? (
                        <input type="checkbox" checked={Boolean(row.auto_from_pc)}
                          onChange={(e) => updateRow(idx, 'auto_from_pc', e.target.checked)}
                          title={`Auto-calc from ${baseUomCode} price × conversion`} />
                      ) : (
                        <span className="text-[10px] text-gray-400">—</span>
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

        <div className="flex flex-wrap items-center gap-3 mt-3">
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
              ? `${alternateCount} alternate UOM${alternateCount === 1 ? '' : 's'} · set = Base and purchase/sales defaults`
              : 'Add Box, Case, Sack, etc. for PO, GR, and POS multi-UOM'}
          </span>
        </div>
      </ProductFormSection>
    </>
  );
}

export { findBaseUomFromCatalog };
