export type PriceMode = 'Retail' | 'Wholesale' | 'Distributor';

const B2B_TYPES = new Set(['LGU', 'Corporate', 'Mining', 'Resort']);

export function resolveCustomerPriceMode(customer?: {
  customer_type?: string;
  default_price_mode?: string;
} | null): PriceMode {
  const explicit = customer?.default_price_mode;
  if (explicit === 'Retail' || explicit === 'Wholesale' || explicit === 'Distributor') {
    return explicit;
  }
  const segment = customer?.customer_type || 'Retail';
  if (segment === 'Wholesale') return 'Wholesale';
  if (segment === 'Distributor') return 'Distributor';
  if (B2B_TYPES.has(segment)) return 'Wholesale';
  return 'Retail';
}

export function getProductPriceForCustomer(
  customer: { customer_type?: string; default_price_mode?: string } | null | undefined,
  product: { id?: string; retail_price?: number | string; wholesale_price?: number | string; distributor_price?: number | string; price?: number | string },
  customerPriceMap?: Record<string, number>,
): number {
  if (product?.id && customerPriceMap?.[product.id] != null) {
    return parseFloat(String(customerPriceMap[product.id]));
  }
  const mode = resolveCustomerPriceMode(customer);
  if (mode === 'Wholesale') return parseFloat(String(product.wholesale_price || 0));
  if (mode === 'Distributor') return parseFloat(String(product.distributor_price || 0));
  return parseFloat(String(product.retail_price || product.price || 0));
}
