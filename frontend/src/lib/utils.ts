import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(amount);
}

/** Parse amount/qty fields on submit; empty input becomes 0. */
export function parseNumericField(value: string | number | null | undefined): number {
  if (value === '' || value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value).trim());
  return Number.isFinite(n) ? n : 0;
}

export function parseIntegerField(value: string | number | null | undefined): number {
  if (value === '' || value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? Math.trunc(value) : parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

export function formatQuantity(qty: number | string | null | undefined): string {
  const n = parseFloat(String(qty ?? 0));
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n)) return String(n);
  return n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateBarcode(sku: string): string {
  // Generate a simple EAN-13 compatible barcode from SKU
  const clean = sku.replace(/[^0-9]/g, '');
  if (clean.length >= 12) return clean.substring(0, 12);
  const padded = clean.padEnd(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(padded[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return padded + checkDigit;
}

export const API_URL = '/api';

export const PAYMENT_METHODS = ['Cash', 'Check'];
export const CUSTOMER_TYPES = ['Retail', 'Wholesale', 'LGU', 'Corporate', 'Mining', 'Resort', 'Distributor'];
export const TAX_TYPES = ['VAT', 'VAT Exempt', 'Zero Rated', 'LGU 5% Final VAT'];
export const PRICE_MODES = ['Retail', 'Wholesale', 'Distributor'];

export function computeVAT(gross: number): { netOfVat: number; vat: number } {
  const netOfVat = gross / 1.12;
  return { netOfVat, vat: gross - netOfVat };
}
