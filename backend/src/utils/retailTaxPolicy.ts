/**
 * Retail tax policy — LOCKED until explicitly changed by business order.
 *
 * POS checkout and employee salary-deduction sales are VAT Exempt (no output VAT).
 * Do not re-enable VAT on these flows without explicit approval.
 */

export const POS_SALES_NO_VAT = true;
export const EMPLOYEE_SALARY_DEDUCTION_NO_VAT = true;

/** Canonical tax type stored on documents when no VAT applies. */
export const NO_VAT_TAX_TYPE = 'VAT Exempt';

export function isEmployeeSalaryDeductionSale(opts: {
  customer_type?: string | null;
  payment_method?: string | null;
  employee_id?: string | null;
}): boolean {
  if (!EMPLOYEE_SALARY_DEDUCTION_NO_VAT) return false;
  if (opts.customer_type === 'Employee') return true;
  if (opts.payment_method === 'Salary Deduction') return true;
  return false;
}

/** Server-side invoice tax type — overrides client for employee / salary deduction. */
export function resolveRetailInvoiceTaxType(
  requested: string | null | undefined,
  opts: {
    customer_type?: string | null;
    payment_method?: string | null;
    employee_id?: string | null;
  },
): string {
  if (isEmployeeSalaryDeductionSale(opts)) return NO_VAT_TAX_TYPE;
  return requested || 'VAT';
}

export function normalizeRetailInvoiceItems<T extends { tax_type?: string }>(
  items: T[],
  invoiceTaxType: string,
): T[] {
  if (invoiceTaxType !== NO_VAT_TAX_TYPE) return items;
  return items.map((item) => ({ ...item, tax_type: NO_VAT_TAX_TYPE }));
}

export type PosTaxTotals = {
  totalVatable: number;
  totalVat: number;
  totalVatExempt: number;
  totalZeroRated: number;
};

/** POS sales: full line amount is VAT-exempt revenue (no output VAT split). */
export function computePosTaxTotals(lineFinals: number[]): PosTaxTotals {
  if (!POS_SALES_NO_VAT) {
    throw new Error('POS per-product VAT is disabled; use retailTaxPolicy.computePosTaxTotals only.');
  }
  const totalVatExempt = lineFinals.reduce((sum, n) => sum + (parseFloat(String(n)) || 0), 0);
  return {
    totalVatable: 0,
    totalVat: 0,
    totalVatExempt,
    totalZeroRated: 0,
  };
}

/** POS revenue GL — gross line total when POS_SALES_NO_VAT is active. */
export function posLineRevenueAmount(lineFinal: number): number {
  return parseFloat(String(lineFinal)) || 0;
}
