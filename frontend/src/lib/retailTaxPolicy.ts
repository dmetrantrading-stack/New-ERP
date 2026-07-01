/**
 * Retail tax policy — LOCKED until explicitly changed by business order.
 * Mirror of backend/src/utils/retailTaxPolicy.ts
 */

export const POS_SALES_NO_VAT = true;
export const EMPLOYEE_SALARY_DEDUCTION_NO_VAT = true;
export const NO_VAT_TAX_TYPE = 'VAT Exempt';

export function isEmployeeSalaryDeductionSale(opts: {
  customer_type?: string | null;
  payment_method?: string | null;
}): boolean {
  if (!EMPLOYEE_SALARY_DEDUCTION_NO_VAT) return false;
  if (opts.customer_type === 'Employee') return true;
  if (opts.payment_method === 'Salary Deduction') return true;
  return false;
}

export function effectiveInvoiceTaxType(
  invoiceTaxType: string,
  customerType: string,
  paymentMethod?: string,
): string {
  if (isEmployeeSalaryDeductionSale({ customer_type: customerType, payment_method: paymentMethod })) {
    return NO_VAT_TAX_TYPE;
  }
  return invoiceTaxType;
}

/** POS display / receipt — no VAT breakdown when policy is active. */
export function posDisplayTax(netTotal: number): { netOfVat: number; vat: number; showVatBreakdown: boolean } {
  if (POS_SALES_NO_VAT) {
    return { netOfVat: netTotal, vat: 0, showVatBreakdown: false };
  }
  const netOfVat = netTotal / 1.12;
  return { netOfVat, vat: netTotal - netOfVat, showVatBreakdown: true };
}
