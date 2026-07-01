import api from './api';
import type { NavigateFunction } from 'react-router-dom';

export type InvoiceCopyMode = 'ordered' | 'delivered';

export const salesCopyRoutes = {
  orderFromSq: (sqId: string) => `/sales-orders?copy_from_sq=${sqId}`,
  deliveryFromSo: (soId: string) => `/delivery-notes?so_id=${soId}`,
  invoiceFromSo: (soId: string) => `/sales?copy_from_so=${soId}`,
  invoiceFromDr: (drId: string) => `/sales?copy_from_dr=${drId}`,
  invoiceDuplicate: (invoiceId: string) => `/sales?copy_from_invoice=${invoiceId}`,
  returnFromInvoice: (invoiceId: string) => `/sales-returns?copy_from_invoice=${invoiceId}`,
};

export async function fetchSqCopyToOrder(sqId: string) {
  const r = await api.get(`/sales-quotations/${sqId}/copy-to-order`);
  return r.data;
}

export async function fetchSoCopyToDelivery(soId: string) {
  const r = await api.get(`/delivery-notes/from-so/${soId}`);
  return r.data;
}

export async function fetchSoCopyToInvoice(soId: string) {
  const r = await api.get(`/sales-orders/${soId}/copy-to-invoice`);
  return r.data;
}

export async function fetchDrCopyToInvoice(drId: string) {
  const r = await api.get(`/delivery-notes/${drId}/copy-to-invoice`);
  return r.data;
}

export async function fetchInvoiceCopyToInvoice(invoiceId: string) {
  const r = await api.get(`/sales/invoices/${invoiceId}/copy-to-invoice`);
  return r.data;
}

export async function fetchSalesWorkflowSettings(): Promise<{ invoice_copy_mode: InvoiceCopyMode }> {
  const r = await api.get('/settings/sales-workflow');
  return r.data;
}

export function mapTaxTypeForInvoice(taxType?: string) {
  if (!taxType || taxType === 'VAT') return 'VATable';
  return taxType;
}

export function mapSqCopyToOrderItems(items: any[] = []) {
  return items.map((i: any) => ({
    product_id: i.product_id,
    product_name: i.product_name || '',
    sku: i.sku || '',
    description: i.description || '',
    quantity: i.quantity,
    unit_price: i.unit_price,
    discount: i.discount || 0,
    tax_type: i.tax_type || 'VAT',
    vat_amount: i.vat_amount || 0,
    uom: i.uom || i.unit_of_measure || '',
    uom_id: i.uom_id ?? null,
    conversion_to_base: i.conversion_to_base ?? 1,
    entered_qty: i.entered_qty ?? i.quantity,
    base_qty: i.base_qty ?? i.quantity,
  }));
}

export function buildSelectedCustomerFromSqCopy(payload: any, customers: any[] = []) {
  const fromList = customers.find((x: any) => String(x.id) === String(payload.customer_id));
  if (fromList) return fromList;
  return {
    id: payload.customer_id,
    customer_name: payload.customer_name || '',
    customer_code: payload.customer_code || '',
    tin: payload.customer_tin || '',
    address: payload.customer_address || payload.delivery_address || '',
    phone: payload.customer_phone || '',
    customer_type: payload.customer_type || 'Retail',
    payment_terms: payload.payment_terms || '',
  };
}

export function buildSelectedCustomerFromSoCopy(payload: any, customers: any[] = []) {
  const customerId = payload.customer_id || payload.order?.customer_id;
  const fromList = customers.find((x: any) => String(x.id) === String(customerId));
  if (fromList) return fromList;
  return {
    id: customerId,
    customer_name: payload.customer_name || payload.order?.customer_name || '',
    customer_code: payload.customer_code || '',
    tin: payload.customer_tin || '',
    address: payload.customer_address || payload.delivery_address || '',
    phone: payload.customer_phone || '',
    customer_type: payload.customer_type || 'Retail',
    payment_terms: payload.payment_terms || '',
  };
}

export function buildSelectedCustomerFromInvoiceCopy(payload: any, customers: any[] = []) {
  if (payload.customer_type === 'Employee') return null;
  return buildSelectedCustomerFromSoCopy(payload, customers);
}

export function mergeProductsFromCopyItems(
  items: any[],
  mergeProducts: (updater: (prev: any[]) => any[]) => void
) {
  mergeProducts((prev: any[]) => {
    const byId = new Map(prev.map((p: any) => [String(p.id), p]));
    let changed = false;
    for (const item of items) {
      if (!item.product_id) continue;
      const id = String(item.product_id);
      if (byId.has(id)) continue;
      byId.set(id, {
        id: item.product_id,
        name: item.product_name || 'Product',
        sku: item.sku || '',
        unit_of_measure: item.uom || item.unit_of_measure || '',
      });
      changed = true;
    }
    return changed ? Array.from(byId.values()) : prev;
  });
}

export function buildOrderFormFromSqCopy(payload: any) {
  return {
    customer_id: payload.customer_id || '',
    sq_id: payload.source_sq_id || '',
    sq_number: payload.source_sq_number || '',
    order_date: payload.order_date || new Date().toISOString().split('T')[0],
    delivery_address: payload.delivery_address || '',
    payment_terms: payload.payment_terms || '',
    notes: payload.notes || '',
    terms_conditions: payload.terms_conditions || '',
    items: mapSqCopyToOrderItems(payload.items),
  };
}

export function mapSoItemsForDrGrid(items: any[] = []) {
  return items.map((i: any) => ({
    ...i,
    id: i.order_item_id || i.id,
    deliver_qty: parseFloat(i.remaining_qty || 0),
    unit_of_measure: i.unit_of_measure || i.uom || '',
    uom_id: i.uom_id ?? null,
    conversion_to_base: i.conversion_to_base ?? 1,
  }));
}

export function buildDrFormFromSoCopy(payload: any, autoSelectAll = true) {
  const lines = (payload.items || []).map((i: any) => ({
    order_item_id: i.order_item_id || i.id,
    product_name: i.product_name || i.description || '',
    remaining: parseFloat(i.remaining_qty || 0),
    quantity: parseFloat(i.remaining_qty || 0),
    uom_id: i.uom_id ?? null,
    conversion_to_base: i.conversion_to_base ?? 1,
    unit_of_measure: i.unit_of_measure || i.uom || '',
  }));
  return {
    so_id: payload.source_so_id || payload.order?.id || '',
    sq_number: payload.source_sq_number || '',
    delivery_date: new Date().toISOString().split('T')[0],
    delivery_address: payload.delivery_address || '',
    notes: payload.notes || '',
    terms_conditions: payload.terms_conditions || '',
    items: autoSelectAll ? lines.filter((i: any) => i.quantity > 0) : [],
  };
}

export function buildInvoiceFormFromCopyPayload(
  payload: any,
  invoiceDate: string,
  computeDueDate: (date: string, terms: string) => string,
  options: { linkSo?: boolean; linkDn?: boolean } = {}
) {
  const paymentTerms = payload.payment_terms || '';
  const isCharge = !!paymentTerms && paymentTerms !== 'Salary Deduction';
  const linkSo = options.linkSo ?? !payload.duplicate;
  const linkDn = options.linkDn ?? !payload.duplicate;

  return {
    customer_id: payload.customer_id,
    employee_id: payload.employee_id || '',
    customer_name: payload.customer_name,
    so_id: linkSo ? (payload.source_so_id || payload.so_id || '') : '',
    so_number: payload.source_so_number || payload.so_number || '',
    sq_number: payload.source_sq_number || payload.sq_number || '',
    dn_id: linkDn ? (payload.source_dr_id || payload.dn_id || '') : '',
    dr_number: payload.source_dr_number || payload.dr_number || '',
    skip_inventory: payload.skip_inventory ?? false,
    payment_method: payload.payment_method || (isCharge ? 'Charge' : 'Cash'),
    amount_tendered: 0,
    due_date: payload.due_date || (paymentTerms ? computeDueDate(invoiceDate, paymentTerms) : ''),
    notes: payload.notes || '',
    terms_conditions: payload.terms_conditions || '',
    payment_terms: paymentTerms,
    items: (payload.items || []).map((i: any) => ({
      product_id: i.product_id,
      description: i.description || i.product_name || '',
      quantity: parseFloat(i.quantity),
      unit_price: parseFloat(i.unit_price),
      discount: parseFloat(i.discount || 0),
      tax_type: mapTaxTypeForInvoice(i.tax_type),
      vat_amount: parseFloat(i.vat_amount || 0),
      location_id: i.location_id || 1,
      available_qty: 0,
      unit_cost: parseFloat(i.unit_cost || 0),
      unit_of_measure: i.unit_of_measure || i.uom || '',
      uom_id: i.uom_id ?? null,
      conversion_to_base: i.conversion_to_base ?? 1,
      entered_qty: i.entered_qty ?? i.quantity,
      base_qty: i.base_qty ?? i.quantity,
    })),
    invoiceTaxType: mapTaxTypeForInvoice(payload.invoice_tax_type || payload.tax_type),
    ewtRate: payload.ewt_rate || '0',
    customerType: payload.customer_type === 'Employee' ? 'Employee' : 'Customer',
  };
}

/** @deprecated use buildInvoiceFormFromCopyPayload */
export function buildInvoiceFormFromSoCopy(
  payload: any,
  invoiceDate: string,
  computeDueDate: (date: string, terms: string) => string
) {
  const built = buildInvoiceFormFromCopyPayload(payload, invoiceDate, computeDueDate, { linkSo: true, linkDn: false });
  const { invoiceTaxType, ewtRate, customerType, ...form } = built;
  return form;
}

export function getInvoiceCopyMeta(payload: any) {
  const built = buildInvoiceFormFromCopyPayload(payload, '', () => '');
  return {
    invoiceTaxType: built.invoiceTaxType,
    ewtRate: built.ewtRate,
    customerType: built.customerType,
  };
}

export async function enrichInvoiceItemsWithProducts(items: any[], products: any[] = []) {
  const enriched = [];
  for (const item of items) {
    const product = products.find((p: any) => String(p.id) === String(item.product_id));
    let available_qty = item.available_qty || 0;
    if (item.product_id) {
      try {
        const res = await api.get(`/inventory/product/${item.product_id}`);
        const locInv = res.data.find((inv: any) => inv.location_id === (item.location_id || 1));
        available_qty = locInv ? parseFloat(locInv.quantity) : 0;
      } catch {
        // non-blocking
      }
    }
    enriched.push({
      ...item,
      available_qty,
      unit_cost: product?.cost ?? item.unit_cost ?? 0,
      unit_of_measure: item.unit_of_measure || item.uom || product?.unit_of_measure || 'pc',
      uom_id: item.uom_id ?? null,
      conversion_to_base: item.conversion_to_base ?? 1,
      entered_qty: item.entered_qty ?? item.quantity,
      base_qty: item.base_qty ?? item.quantity,
    });
  }
  return enriched;
}

export function navigateCopyToSalesOrder(navigate: NavigateFunction, sqId: string) {
  navigate(salesCopyRoutes.orderFromSq(sqId));
}

export function navigateCopyToDeliveryReceipt(navigate: NavigateFunction, soId: string) {
  navigate(salesCopyRoutes.deliveryFromSo(soId));
}

export function navigateCopyToSalesInvoice(navigate: NavigateFunction, soId: string) {
  navigate(salesCopyRoutes.invoiceFromSo(soId));
}

export function navigateCopyToSalesInvoiceFromDr(navigate: NavigateFunction, drId: string) {
  navigate(salesCopyRoutes.invoiceFromDr(drId));
}

export function navigateCopyToDuplicateInvoice(navigate: NavigateFunction, invoiceId: string) {
  navigate(salesCopyRoutes.invoiceDuplicate(invoiceId));
}

export async function fetchInvoiceCopyToReturn(invoiceId: string) {
  const r = await api.get(`/sales/returns/copy-from-invoice/${invoiceId}`);
  return r.data;
}

export function buildReturnFormFromInvoiceCopy(payload: any) {
  return {
    invoice_id: payload.invoice_id,
    invoice_number: payload.invoice_number,
    customer_id: payload.customer_id,
    customer_name: payload.customer_name,
    customer_type: payload.customer_type || 'Customer',
    employee_id: payload.employee_id || null,
    reason: payload.reason || '',
    notes: payload.notes || '',
    terms_conditions: payload.terms_conditions || '',
    items: (payload.items || []).map((i: any) => ({
      invoice_item_id: i.invoice_item_id,
      product_id: i.product_id,
      product_name: i.product_name,
      sku: i.sku,
      unit_of_measure: i.unit_of_measure || 'pc',
      invoiced_qty: i.invoiced_qty,
      quantity: i.quantity,
      unit_price: i.unit_price,
      line_total: i.line_total,
      location_id: i.location_id || 1,
    })),
  };
}

export function navigateReturnFromInvoice(navigate: NavigateFunction, invoiceId: string) {
  navigate(salesCopyRoutes.returnFromInvoice(invoiceId));
}

export async function ensureProductsLoaded(
  productIds: string[],
  mergeProducts: (updater: (prev: any[]) => any[]) => void
) {
  if (productIds.length === 0) return;
  try {
    const pr = await api.get('/products?limit=200');
    const all = pr.data?.data || pr.data || [];
    mergeProducts((prev: any[]) => {
      const ids = new Set(prev.map((p: any) => p.id));
      const missing = all.filter((p: any) => productIds.includes(p.id) && !ids.has(p.id));
      return missing.length ? [...prev, ...missing] : prev;
    });
  } catch {
    // non-blocking
  }
}

export type SalesCopySourceType = 'SQ' | 'SO' | 'DR' | 'SI';

export interface SalesCopyTarget {
  id: string;
  label: string;
  permission?: string;
  isAvailable?: (doc: any) => boolean;
  navigate: (navigate: NavigateFunction, docId: string) => void;
}

export const SALES_COPY_TARGETS: Record<SalesCopySourceType, SalesCopyTarget[]> = {
  SQ: [{
    id: 'SO',
    label: 'Sales Order',
    permission: 'sales.sales-order.create',
    isAvailable: (doc) => ['Sent', 'Approved'].includes(doc.status),
    navigate: navigateCopyToSalesOrder,
  }],
  SO: [
    {
      id: 'DR',
      label: 'Delivery Receipt',
      permission: 'sales.delivery-receipt.create',
      isAvailable: (doc) => ['Open', 'Partially Delivered'].includes(doc.status),
      navigate: navigateCopyToDeliveryReceipt,
    },
    {
      id: 'SI',
      label: 'Sales Invoice',
      permission: 'sales.sales-invoice.create',
      isAvailable: (doc) => ['Open', 'Partially Delivered', 'Fully Delivered'].includes(doc.status),
      navigate: navigateCopyToSalesInvoice,
    },
  ],
  DR: [{
    id: 'SI',
    label: 'Sales Invoice',
    permission: 'sales.sales-invoice.create',
    isAvailable: (doc) => doc.status === 'Posted',
    navigate: navigateCopyToSalesInvoiceFromDr,
  }],
  SI: [
    {
      id: 'SR',
      label: 'Sales Return',
      permission: 'sales.sales-invoice.create',
      isAvailable: (doc) => doc.status === 'Posted',
      navigate: (navigate, docId) => navigate(salesCopyRoutes.returnFromInvoice(docId)),
    },
    {
      id: 'SI_DUP',
      label: 'Duplicate Invoice',
      permission: 'sales.sales-invoice.create',
      isAvailable: (doc) => !['Void', 'Cancelled'].includes(doc.status),
      navigate: navigateCopyToDuplicateInvoice,
    },
  ],
};

export function getSalesCopyTargets(
  sourceType: SalesCopySourceType,
  doc: any,
  hasPerm: (perm: string) => boolean
): SalesCopyTarget[] {
  return SALES_COPY_TARGETS[sourceType].filter((target) => {
    if (target.permission && !hasPerm(target.permission)) return false;
    if (target.isAvailable && !target.isAvailable(doc)) return false;
    return true;
  });
}
