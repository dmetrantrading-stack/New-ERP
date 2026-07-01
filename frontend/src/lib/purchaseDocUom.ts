import api from './api';
import {
  convertToBaseQty,
  resolvePurchaseUom,
  resolvePurchaseUomFromLine,
} from './uomUtils';

export async function loadProductUoms(productId: string | number) {
  try {
    const res = await api.get(`/products/${productId}/uoms`);
    return res.data || [];
  } catch {
    return [];
  }
}

export function blankPurchaseDocLine() {
  return {
    product_id: '',
    product_name: '',
    quantity: 1,
    estimated_cost: 0,
    unit_cost: 0,
    tax_type: 'VAT',
    uoms: [] as any[],
    uom_id: null as number | null,
    unit_of_measure: '',
    conversion_to_base: 1,
  };
}

export function pickPurchaseLineUom(
  uoms: any[],
  line: Record<string, any>,
  product?: any,
) {
  return resolvePurchaseUomFromLine(
    uoms,
    {
      uom_id: line.uom_id,
      conversion_to_base: line.conversion_to_base,
      uom: line.uom || line.uom_code || line.unit_of_measure,
      unit_of_measure: line.unit_of_measure,
      unit_cost: line.unit_cost ?? line.estimated_cost,
      net_unit_cost: line.net_unit_cost,
    },
    product?.default_purchase_uom_id ?? null,
  );
}

export function applyPurchaseUomToLine(
  line: any,
  uoms: any[],
  uomId?: number | null,
  product?: any,
  fallbackCost?: number,
) {
  const uom = pickPurchaseLineUom(uoms, { ...line, uom_id: uomId ?? line.uom_id }, product)
    || resolvePurchaseUom(uoms, uomId ?? line.uom_id, product?.default_purchase_uom_id ?? null);
  if (!uom) return { ...line, uoms };
  let unitCost = parseFloat(String(uom.purchase_price)) || 0;
  if (!unitCost && fallbackCost != null) unitCost = fallbackCost;
  if (!unitCost && product) {
    unitCost = parseFloat(String(product.cost)) || 0;
  }
  const conversion = parseFloat(String(uom.conversion_to_base)) || 1;
  return {
    ...line,
    uoms,
    uom_id: uom.uom_id,
    unit_of_measure: uom.uom_code || line.unit_of_measure || 'pc',
    conversion_to_base: conversion,
    estimated_cost: unitCost,
    unit_cost: unitCost,
  };
}

export function lineBaseQty(item: any) {
  if (item.base_qty != null && item.base_qty !== '') {
    return parseFloat(String(item.base_qty)) || 0;
  }
  const uom = pickPurchaseLineUom(item.uoms || [], item);
  const conv = parseFloat(String(item.conversion_to_base ?? uom?.conversion_to_base ?? 1)) || 1;
  const entered = parseFloat(String(item.entered_qty ?? item.quantity ?? 0)) || 0;
  return convertToBaseQty(entered, conv);
}

export function buildPurchaseDocItemPayload(item: any) {
  const uom = pickPurchaseLineUom(item.uoms || [], item);
  const enteredQty = parseFloat(String(item.quantity));
  const conversion = parseFloat(String(item.conversion_to_base ?? uom?.conversion_to_base ?? 1)) || 1;
  const cost = parseFloat(String(item.estimated_cost ?? item.unit_cost ?? 0));
  return {
    product_id: item.product_id,
    quantity: enteredQty,
    entered_qty: enteredQty,
    uom_id: item.uom_id || uom?.uom_id || null,
    conversion_to_base: conversion,
    base_qty: convertToBaseQty(enteredQty, conversion),
    estimated_cost: cost,
    unit_cost: cost,
    tax_type: item.tax_type || 'VAT',
  };
}

export async function hydratePurchaseDocLineFromApi(item: any, fallbackCost?: number) {
  const uoms = item.product_id ? await loadProductUoms(item.product_id) : [];
  const line = applyPurchaseUomToLine(
    {
      product_id: item.product_id,
      product_name: item.product_name || '',
      quantity: parseFloat(String(item.quantity ?? item.entered_qty ?? 1)),
      estimated_cost: parseFloat(String(item.estimated_cost ?? item.unit_cost ?? 0)),
      unit_cost: parseFloat(String(item.unit_cost ?? item.estimated_cost ?? 0)),
      tax_type: item.tax_type || 'VAT',
      uom_id: item.uom_id ?? null,
      conversion_to_base: item.conversion_to_base,
      unit_of_measure: item.uom_code || item.uom || item.unit_of_measure,
      base_qty: item.base_qty,
    },
    uoms,
    item.uom_id ?? null,
    { default_purchase_uom_id: item.default_purchase_uom_id },
    fallbackCost,
  );
  if (item.base_qty != null) {
    line.base_qty = parseFloat(String(item.base_qty));
  }
  return line;
}

export async function hydratePurchaseDocLinesFromApi(items: any[]) {
  return Promise.all(items.map((i) => hydratePurchaseDocLineFromApi(i)));
}
