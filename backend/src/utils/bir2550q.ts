import { query } from '../config/database';
import { COA_PERIOD_BALANCE_SUBQUERY } from './chartOfAccountsBalance';

type DbClient = { query: typeof query };

export interface Bir2550qLine {
  line: string;
  description: string;
  amount: number;
  source?: string;
}

export interface Bir2550qWorksheet {
  period: { from: string; to: string };
  lines: Bir2550qLine[];
  summary: {
    vatable_sales: number;
    output_vat: number;
    vat_exempt_sales: number;
    zero_rated_sales: number;
    vatable_purchases: number;
    input_vat: number;
    vat_payable: number;
    gl_vat_payable_balance: number;
    variance: number;
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Build a simplified BIR Form 2550Q worksheet from ERP VAT data + GL 2100 reconciliation. */
export async function buildBir2550qWorksheet(
  from: string,
  to: string,
  db: DbClient = { query },
): Promise<Bir2550qWorksheet> {
  const pos = await db.query(
    `SELECT COALESCE(SUM(tax_total), 0) AS output_vat,
            COALESCE(SUM(total - tax_total), 0) AS vatable_sales,
            COUNT(*)::int AS doc_count
     FROM pos_transactions
     WHERE created_at::date >= $1 AND created_at::date <= $2 AND status = 'Completed'`,
    [from, to],
  );

  const credit = await db.query(
    `SELECT COALESCE(SUM(vat_amount), 0) AS output_vat,
            COALESCE(SUM(vatable_sales), 0) AS vatable_sales,
            COALESCE(SUM(vat_exempt_sales), 0) AS exempt_sales,
            COALESCE(SUM(zero_rated_sales), 0) AS zero_rated_sales,
            COUNT(*)::int AS doc_count
     FROM sales_invoices
     WHERE invoice_date >= $1 AND invoice_date <= $2
       AND status NOT IN ('Void', 'Cancelled', 'Draft')`,
    [from, to],
  );

  const apv = await db.query(
    `SELECT COALESCE(SUM(vat_amount), 0) AS input_vat,
            COALESCE(SUM(vatable_amount), 0) AS vatable_purchases,
            COUNT(*)::int AS doc_count
     FROM ap_vouchers
     WHERE apv_date >= $1 AND apv_date <= $2
       AND status NOT IN ('Draft', 'Cancelled')`,
    [from, to],
  );

  const glVat = await db.query(
    `SELECT ${COA_PERIOD_BALANCE_SUBQUERY('$1', '$2')} AS balance
     FROM chart_of_accounts coa WHERE coa.account_code = '2100' LIMIT 1`,
    [from, to],
  );

  const posRow = pos.rows[0];
  const creditRow = credit.rows[0];
  const apvRow = apv.rows[0];

  const vatableSales = round2(parseFloat(posRow.vatable_sales) + parseFloat(creditRow.vatable_sales));
  const vatExempt = round2(parseFloat(creditRow.exempt_sales));
  const zeroRated = round2(parseFloat(creditRow.zero_rated_sales));
  const outputVat = round2(parseFloat(posRow.output_vat) + parseFloat(creditRow.output_vat));
  const vatablePurchases = round2(parseFloat(apvRow.vatable_purchases));
  const inputVat = round2(parseFloat(apvRow.input_vat));
  const vatPayable = round2(outputVat - inputVat);
  const glVatBalance = round2(parseFloat(glVat.rows[0]?.balance || 0));

  const lines: Bir2550qLine[] = [
    { line: '21A', description: 'VATable Sales (net of VAT)', amount: vatableSales, source: `POS ${posRow.doc_count} + SI ${creditRow.doc_count}` },
    { line: '22', description: 'VAT Exempt Sales', amount: vatExempt, source: 'Credit invoices' },
    { line: '23', description: 'Zero Rated Sales', amount: zeroRated, source: 'Credit invoices' },
    { line: '26', description: 'Output VAT (12%)', amount: outputVat, source: 'POS + credit invoices' },
    { line: '41', description: 'VATable Purchases (net of VAT)', amount: vatablePurchases, source: `APV ${apvRow.doc_count}` },
    { line: '42', description: 'Input VAT', amount: inputVat, source: 'Posted AP vouchers' },
    { line: '55', description: 'Total Output Tax Due', amount: outputVat },
    { line: '56', description: 'Total Input Tax', amount: inputVat },
    { line: '57', description: 'VAT Payable (Output − Input)', amount: vatPayable },
    { line: 'GL', description: 'GL Account 2100 VAT Payable (period movement)', amount: glVatBalance, source: 'Chart of Accounts' },
    { line: 'VAR', description: 'Variance (Line 57 vs GL 2100)', amount: round2(vatPayable - glVatBalance) },
  ];

  return {
    period: { from, to },
    lines,
    summary: {
      vatable_sales: vatableSales,
      output_vat: outputVat,
      vat_exempt_sales: vatExempt,
      zero_rated_sales: zeroRated,
      vatable_purchases: vatablePurchases,
      input_vat: inputVat,
      vat_payable: vatPayable,
      gl_vat_payable_balance: glVatBalance,
      variance: round2(vatPayable - glVatBalance),
    },
  };
}
