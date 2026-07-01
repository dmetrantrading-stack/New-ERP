import { describe, expect, it } from 'vitest';
import {
  computePosTaxTotals,
  isEmployeeSalaryDeductionSale,
  normalizeRetailInvoiceItems,
  posLineRevenueAmount,
  resolveRetailInvoiceTaxType,
} from '../retailTaxPolicy';

describe('retailTaxPolicy', () => {
  it('treats employee and salary deduction as no-VAT sales', () => {
    expect(isEmployeeSalaryDeductionSale({ customer_type: 'Employee' })).toBe(true);
    expect(isEmployeeSalaryDeductionSale({ payment_method: 'Salary Deduction' })).toBe(true);
    expect(isEmployeeSalaryDeductionSale({ customer_type: 'Customer', payment_method: 'Cash' })).toBe(false);
  });

  it('forces VAT Exempt invoice tax type for employee sales', () => {
    expect(resolveRetailInvoiceTaxType('VATable', { customer_type: 'Employee' })).toBe('VAT Exempt');
    expect(resolveRetailInvoiceTaxType('VATable', { payment_method: 'Salary Deduction' })).toBe('VAT Exempt');
    expect(resolveRetailInvoiceTaxType('VATable', { customer_type: 'Customer', payment_method: 'Cash' })).toBe('VATable');
  });

  it('normalizes line items to VAT Exempt', () => {
    const items = normalizeRetailInvoiceItems(
      [{ tax_type: 'VATable' }, { tax_type: 'VAT' }],
      'VAT Exempt',
    );
    expect(items.every((i) => i.tax_type === 'VAT Exempt')).toBe(true);
  });

  it('computes POS totals with zero VAT', () => {
    const totals = computePosTaxTotals([100, 50]);
    expect(totals.totalVat).toBe(0);
    expect(totals.totalVatExempt).toBe(150);
    expect(totals.totalVatable).toBe(0);
  });

  it('uses gross line amount as POS revenue', () => {
    expect(posLineRevenueAmount(984)).toBe(984);
  });
});
