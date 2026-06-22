import api from './api';
import type { NavigateFunction } from 'react-router-dom';

export const purchaseCopyRoutes = {
  receiveFromPo: (poId: string) => `/goods-receipts?receive_from_po=${poId}`,
  apvFromPo: (poId: string) => `/payables?tab=apv&copy_from_po=${poId}`,
  apvFromGr: (grId: string) => `/payables?tab=apv&copy_from_gr=${grId}`,
  poFromPr: (prId: string) => `/purchases?copy_from_pr=${prId}`,
};

export async function fetchPoForReceive(poId: string) {
  const res = await api.get(`/purchases/orders/${poId}`);
  return res.data;
}

export async function fetchPoCopyToApv(poId: string) {
  const res = await api.get(`/payables/copy-from-po/${poId}`);
  return res.data;
}

export async function fetchGrCopyToApv(grId: string) {
  const res = await api.get(`/payables/copy-from-gr/${grId}`);
  return res.data;
}

export function buildReceiveFormFromPo(po: any) {
  const items = (po.items || [])
    .map((i: any) => {
      const remaining = parseFloat(i.quantity) - parseFloat(i.received_quantity || 0);
      if (remaining <= 0) return null;
      return {
        po_item_id: i.id,
        product_id: i.product_id,
        product_name: i.product_name,
        sku: i.sku,
        unit_of_measure: i.unit_of_measure || 'pc',
        ordered_qty: parseFloat(i.quantity),
        already_received: parseFloat(i.received_quantity || 0),
        quantity: remaining,
        unit_cost: i.unit_cost,
        net_unit_cost: i.net_unit_cost || i.unit_cost,
        discount_amount: i.discount_amount || 0,
        batch_number: '',
        expiry_date: '',
      };
    })
    .filter(Boolean);

  return {
    po_id: po.id,
    po_number: po.po_number,
    supplier_id: po.supplier_id,
    supplier_name: po.supplier_name,
    location_id: 1,
    supplier_invoice_number: '',
    notes: '',
    terms_conditions: po.terms_conditions || '',
    items,
  };
}

export function buildApvFormFromCopy(payload: any) {
  const invoiceDate = payload.supplier_invoice_date
    ? String(payload.supplier_invoice_date).split('T')[0]
    : '';
  return {
    supplier_id: String(payload.supplier_id || ''),
    po_id: payload.po_id || '',
    gr_id: payload.gr_id || '',
    apv_date: new Date().toISOString().split('T')[0],
    due_date: '',
    payment_terms: payload.payment_terms || '',
    supplier_invoice_number: payload.supplier_invoice_number || '',
    supplier_invoice_date: invoiceDate,
    notes: payload.notes || '',
    vat_mode: payload.vat_mode || 'VAT Inclusive',
    terms_conditions: payload.terms_conditions || '',
    items: (payload.items || []).map((i: any) => ({
      product_id: i.product_id,
      description: i.description || i.product_name || '',
      qty: parseFloat(i.qty ?? i.quantity ?? 1),
      uom: i.uom || i.unit_of_measure || 'pc',
      unit_cost: parseFloat(i.unit_cost || 0),
      discount_amount: parseFloat(i.discount_amount || 0),
      tax_type: i.tax_type || 'VAT',
      gr_id: i.gr_id || undefined,
    })),
  };
}

export function navigateReceiveFromPo(navigate: NavigateFunction, poId: string) {
  navigate(purchaseCopyRoutes.receiveFromPo(poId));
}

export function navigateApvFromPo(navigate: NavigateFunction, poId: string) {
  navigate(purchaseCopyRoutes.apvFromPo(poId));
}

export function navigateApvFromGr(navigate: NavigateFunction, grId: string) {
  navigate(purchaseCopyRoutes.apvFromGr(grId));
}

export function navigatePayApv(apvId: string) {
  return `/payables?tab=payments&pay_apv=${apvId}`;
}

export async function fetchPrCopyToPo(prId: string) {
  const res = await api.get(`/purchases/requisitions/${prId}/copy-to-po`);
  return res.data;
}

export function buildPoFormFromPrCopy(payload: any) {
  return {
    pr_id: payload.pr_id,
    pr_number: payload.pr_number,
    supplier_id: '',
    expected_date: new Date().toISOString().split('T')[0],
    notes: payload.notes || '',
    items: (payload.items || []).map((i: any) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      sku: i.sku,
      quantity: i.quantity,
      unit_cost: i.unit_cost || 0,
      unit_of_measure: i.unit_of_measure || 'pc',
      discount_type: '%',
      discount_value: '0',
      tax_type: i.tax_type || 'VAT',
      location_id: 1,
    })),
    vat_mode: 'VAT Inclusive',
    payment_terms: '',
  };
}

export function navigatePoFromPr(navigate: NavigateFunction, prId: string) {
  navigate(purchaseCopyRoutes.poFromPr(prId));
}

export async function fetchSupplierCatalogCopyToPo(supplierId: string, productIds: string[]) {
  const res = await api.post(`/suppliers/${supplierId}/catalog/copy-to-po`, { product_ids: productIds });
  return res.data;
}

export function buildPoFormFromSupplierCatalog(payload: any) {
  return {
    supplier_id: payload.supplier_id,
    supplier_name: payload.supplier_name || '',
    expected_date: new Date().toISOString().split('T')[0],
    notes: payload.notes || 'Generated from supplier low stock catalog',
    items: (payload.items || []).map((i: any) => ({
      product_id: i.product_id,
      product_name: i.product_name,
      sku: i.sku,
      quantity: i.quantity,
      unit_cost: i.unit_cost || 0,
      unit_of_measure: i.unit_of_measure || 'pc',
      discount_type: '%',
      discount_value: '0',
      tax_type: i.tax_type || 'VAT',
      location_id: 1,
    })),
    vat_mode: 'VAT Inclusive',
    payment_terms: payload.payment_terms || '',
  };
}

export function navigatePoFromSupplierCatalog(
  navigate: NavigateFunction,
  supplierId: string | number,
  productIds: string[],
) {
  const ids = productIds.join(',');
  navigate(`/purchases?copy_from_supplier_catalog=${supplierId}&product_ids=${encodeURIComponent(ids)}`);
}
