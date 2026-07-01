import api from './api';
import {
  convertToBaseQty,
  getUomPrice,
  resolveSalesUom,
  resolveSalesUomFromLine,
  type PriceTier,
} from './uomUtils';

export async function loadProductUoms(productId: string | number) {
  try {
    const res = await api.get(`/products/${productId}/uoms`);
    return res.data || [];
  } catch {
    return [];
  }
}

export function blankSalesDocLine() {
  return {
    product_id: '',
    product_name: '',
    description: '',
    quantity: 1,
    unit_price: 0,
    discount: 0,
    tax_type: 'VAT',
    vat_amount: 0,
    uoms: [] as any[],
    uom_id: null as number | null,
    uom: '',
    conversion_to_base: 1,
  };
}

export function pickSalesLineUom(
  uoms: any[],
  line: Record<string, any>,
  product?: any,
) {
  return resolveSalesUomFromLine(
    uoms,
    {
      uom_id: line.uom_id,
      conversion_to_base: line.conversion_to_base,
      uom: line.uom || line.uom_code,
      unit_of_measure: line.unit_of_measure,
      unit_price: line.unit_price,
    },
    product?.default_sales_uom_id ?? null,
  );
}

export function applySalesUomToLine(
  line: any,
  uoms: any[],
  uomId?: number | null,
  product?: any,
  priceTier: PriceTier | string = 'Retail',
  fallbackPrice?: number,
) {
  const uom = pickSalesLineUom(uoms, { ...line, uom_id: uomId ?? line.uom_id }, product)
    || resolveSalesUom(uoms, uomId ?? line.uom_id, product?.default_sales_uom_id ?? null);
  if (!uom) return { ...line, uoms };
  let unitPrice = getUomPrice(uom, priceTier);
  if (!unitPrice && fallbackPrice != null) unitPrice = fallbackPrice;
  if (!unitPrice && product) {
    unitPrice = parseFloat(String(product.retail_price)) || 0;
  }
  const conversion = parseFloat(String(uom.conversion_to_base)) || 1;
  return {
    ...line,
    uoms,
    uom_id: uom.uom_id,
    uom: uom.uom_code || line.uom || 'pc',
    conversion_to_base: conversion,
    unit_price: unitPrice,
  };
}

/** Qty entered in line UOM (e.g. BOX) → stock pieces (pc). */
export function lineBaseQty(item: any) {
  if (item.base_qty != null && item.base_qty !== '') {
    return parseFloat(String(item.base_qty)) || 0;
  }
  const uom = pickSalesLineUom(item.uoms || [], item);
  const conv = parseFloat(String(item.conversion_to_base ?? uom?.conversion_to_base ?? 1)) || 1;
  const entered = parseFloat(String(item.entered_qty ?? item.quantity ?? 0)) || 0;
  return convertToBaseQty(entered, conv);
}

export function buildSalesDocItemPayload(item: any) {
  const uom = pickSalesLineUom(item.uoms || [], item);
  const enteredQty = parseFloat(String(item.quantity));
  const conversion = parseFloat(String(item.conversion_to_base ?? uom?.conversion_to_base ?? 1)) || 1;
  return {
    product_id: item.product_id,
    variant_id: item.variant_id,
    description: item.description || '',
    quantity: enteredQty,
    entered_qty: enteredQty,
    uom_id: item.uom_id || uom?.uom_id || null,
    conversion_to_base: conversion,
    base_qty: convertToBaseQty(enteredQty, conversion),
    unit_price: parseFloat(String(item.unit_price)),
    discount: parseFloat(String(item.discount || 0)),
    tax_type: item.tax_type || 'VAT',
    vat_amount: parseFloat(String(item.vat_amount || 0)),
  };
}

export async function hydrateSalesDocLineFromApi(
  item: any,
  priceTier: PriceTier | string = 'Retail',
  fallbackPrice?: number,
) {
  const uoms = item.product_id ? await loadProductUoms(item.product_id) : [];
  const line = applySalesUomToLine(
    {
      product_id: item.product_id,
      product_name: item.product_name || '',
      description: item.description || '',
      quantity: parseFloat(String(item.quantity ?? item.ordered_qty ?? 1)),
      unit_price: parseFloat(String(item.unit_price || 0)),
      discount: parseFloat(String(item.discount || 0)),
      tax_type: item.tax_type || 'VAT',
      vat_amount: parseFloat(String(item.vat_amount || 0)),
      uom_id: item.uom_id ?? null,
      conversion_to_base: item.conversion_to_base,
      uom: item.uom_code || item.uom || item.unit_of_measure,
      unit_of_measure: item.uom_code || item.unit_of_measure,
      base_qty: item.base_qty,
    },
    uoms,
    item.uom_id ?? null,
    { default_sales_uom_id: item.default_sales_uom_id },
    priceTier,
    fallbackPrice,
  );
  if (item.base_qty != null) {
    line.base_qty = parseFloat(String(item.base_qty));
  }
  return line;
}

export async function hydrateSalesDocLinesFromApi(
  items: any[],
  priceTier: PriceTier | string = 'Retail',
) {
  return Promise.all(items.map((i) => hydrateSalesDocLineFromApi(i, priceTier)));
}
