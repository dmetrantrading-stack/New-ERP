import { v4 as uuidv4 } from 'uuid';

type DbClient = {
  query: (text: string, params?: any[]) => Promise<any>;
};

export const DEFAULT_REVENUE_ACCOUNT = '4000';
export const DEFAULT_COGS_ACCOUNT = '5000';
export const DEFAULT_INVENTORY_ACCOUNT = '1200';

export interface ProductCategoryGl {
  revenue_account_code: string;
  cogs_account_code: string;
  category_name: string | null;
}

export interface CategoryGlLineInput {
  product_id: string;
  revenueAmount?: number;
  cogsGrossAmount?: number;
  tax_type?: string;
}

export async function loadCategoryAccountsForProducts(
  db: DbClient,
  productIds: string[],
): Promise<Map<string, ProductCategoryGl>> {
  const map = new Map<string, ProductCategoryGl>();
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  if (uniqueIds.length === 0) return map;

  const result = await db.query(
    `SELECT p.id AS product_id,
            COALESCE(c.revenue_account_code, $2) AS revenue_account_code,
            COALESCE(c.cogs_account_code, $3) AS cogs_account_code,
            c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.id = ANY($1::uuid[])`,
    [uniqueIds, DEFAULT_REVENUE_ACCOUNT, DEFAULT_COGS_ACCOUNT],
  );

  for (const row of result.rows) {
    map.set(row.product_id, {
      revenue_account_code: row.revenue_account_code || DEFAULT_REVENUE_ACCOUNT,
      cogs_account_code: row.cogs_account_code || DEFAULT_COGS_ACCOUNT,
      category_name: row.category_name || null,
    });
  }
  return map;
}

export function aggregateByAccountCode(
  lines: CategoryGlLineInput[],
  accountMap: Map<string, ProductCategoryGl>,
  field: 'revenue_account_code' | 'cogs_account_code',
  amountKey: 'revenueAmount' | 'cogsGrossAmount',
): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const line of lines) {
    const amount = line[amountKey];
    if (!amount || amount <= 0) continue;
    const gl = accountMap.get(line.product_id);
    const accountCode = gl?.[field] || (field === 'revenue_account_code' ? DEFAULT_REVENUE_ACCOUNT : DEFAULT_COGS_ACCOUNT);
    buckets.set(accountCode, (buckets.get(accountCode) || 0) + amount);
  }
  return buckets;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Inventory cost is VAT-inclusive for VATable items; exempt/zero-rated costs have no VAT to strip. */
export function lineGlCogsAmount(grossCost: number, taxType?: string): number {
  if (!grossCost || grossCost <= 0) return 0;
  if (taxType === 'VAT Exempt' || taxType === 'Zero Rated') return round2(grossCost);
  return round2(grossCost / 1.12);
}

export function aggregateGlCogsByAccountCode(
  lines: CategoryGlLineInput[],
  accountMap: Map<string, ProductCategoryGl>,
): Map<string, number> {
  const buckets = new Map<string, number>();
  for (const line of lines) {
    if (!line.cogsGrossAmount || line.cogsGrossAmount <= 0) continue;
    const gl = accountMap.get(line.product_id);
    const accountCode = gl?.cogs_account_code || DEFAULT_COGS_ACCOUNT;
    const glAmount = lineGlCogsAmount(line.cogsGrossAmount, line.tax_type);
    buckets.set(accountCode, (buckets.get(accountCode) || 0) + glAmount);
  }
  for (const [code, amount] of buckets) {
    buckets.set(code, round2(amount));
  }
  return buckets;
}

export function sumLineGlCogs(
  lines: Array<{ cogsGrossAmount?: number; tax_type?: string }>,
): number {
  return round2(
    lines.reduce((sum, line) => sum + lineGlCogsAmount(line.cogsGrossAmount || 0, line.tax_type), 0),
  );
}

async function resolveActiveAccountId(db: DbClient, accountCode: string): Promise<number> {
  const result = await db.query(
    'SELECT id FROM chart_of_accounts WHERE account_code = $1 AND is_active = true',
    [accountCode],
  );
  if (!result.rows?.length) {
    throw new Error(`GL account ${accountCode} not found or inactive in Chart of Accounts`);
  }
  return result.rows[0].id;
}

export async function insertRevenueCreditLines(
  db: DbClient,
  entryId: string,
  buckets: Map<string, number>,
  referenceType: string,
  referenceId: string,
  descriptionPrefix: string,
): Promise<number> {
  let total = 0;
  for (const [accountCode, grossAmount] of buckets) {
    const amount = round2(grossAmount);
    if (amount <= 0) continue;
    total += amount;
    const accountId = await resolveActiveAccountId(db, accountCode);
    await db.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7)`,
      [uuidv4(), entryId, accountId, `${descriptionPrefix} (${accountCode})`, amount, referenceType, referenceId],
    );
  }
  return total;
}

export async function insertRevenueDebitLines(
  db: DbClient,
  entryId: string,
  buckets: Map<string, number>,
  referenceType: string,
  referenceId: string,
  descriptionPrefix: string,
): Promise<number> {
  let total = 0;
  for (const [accountCode, grossAmount] of buckets) {
    const amount = round2(grossAmount);
    if (amount <= 0) continue;
    total += amount;
    const accountId = await resolveActiveAccountId(db, accountCode);
    await db.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
      [uuidv4(), entryId, accountId, `${descriptionPrefix} (${accountCode})`, amount, referenceType, referenceId],
    );
  }
  return total;
}

export async function insertCogsInventoryLines(
  db: DbClient,
  entryId: string,
  cogsBuckets: Map<string, number>,
  referenceType: string,
  referenceId: string,
  descriptionPrefix: string,
  inventoryAccountCode = DEFAULT_INVENTORY_ACCOUNT,
): Promise<number> {
  let totalGlCogs = 0;
  const inventoryAccountId = await resolveActiveAccountId(db, inventoryAccountCode);
  for (const [accountCode, glCogs] of cogsBuckets) {
    const amount = round2(glCogs);
    if (amount <= 0) continue;
    totalGlCogs += amount;
    const cogsAccountId = await resolveActiveAccountId(db, accountCode);
    await db.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7),
              ($8, $2, $9, $10, 0, $5, $6, $7)`,
      [
        uuidv4(), entryId, cogsAccountId, `${descriptionPrefix} COGS (${accountCode})`, glCogs, referenceType, referenceId,
        uuidv4(), inventoryAccountId, `${descriptionPrefix} Inventory`,
      ],
    );
  }
  return round2(totalGlCogs);
}

export async function insertCogsInventoryReversalLines(
  db: DbClient,
  entryId: string,
  cogsBuckets: Map<string, number>,
  referenceType: string,
  referenceId: string,
  descriptionPrefix: string,
  inventoryAccountCode = DEFAULT_INVENTORY_ACCOUNT,
): Promise<number> {
  let totalGlCogs = 0;
  const inventoryAccountId = await resolveActiveAccountId(db, inventoryAccountCode);
  for (const [accountCode, glCogs] of cogsBuckets) {
    const amount = round2(glCogs);
    if (amount <= 0) continue;
    totalGlCogs += amount;
    const cogsAccountId = await resolveActiveAccountId(db, accountCode);
    await db.query(
      `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7),
              ($8, $2, $9, $10, 0, $5, $6, $7)`,
      [
        uuidv4(), entryId, inventoryAccountId, `${descriptionPrefix} Inventory (${accountCode})`, glCogs, referenceType, referenceId,
        uuidv4(), cogsAccountId, `${descriptionPrefix} COGS`,
      ],
    );
  }
  return round2(totalGlCogs);
}

export function invoiceLineNetRevenue(line: {
  vatable?: number;
  vatExempt?: number;
  zeroRated?: number;
}): number {
  return (line.vatable || 0) + (line.vatExempt || 0) + (line.zeroRated || 0);
}

export function storedInvoiceItemNetRevenue(item: {
  total?: number | string;
  vat_amount?: number | string;
  tax_type?: string;
}): number {
  const total = parseFloat(String(item.total ?? 0)) || 0;
  const vat = parseFloat(String(item.vat_amount ?? 0)) || 0;
  const taxType = item.tax_type || 'VAT';
  if (taxType === 'VAT Exempt' || taxType === 'Zero Rated') return total;
  if (vat > 0) return total - vat;
  if (taxType === 'VAT' || taxType === 'VATable' || taxType === 'LGU' || taxType === 'LGU 5% Final VAT') {
    return total / 1.12;
  }
  return total;
}

export function posLineNetRevenue(
  lineFinal: number,
  tax: { tax_type: string; price_type: string },
): number {
  if (tax.tax_type === 'VAT Exempt' || tax.tax_type === 'Zero Rated') return lineFinal;
  if (tax.tax_type === 'VAT' || tax.tax_type === 'VATable') {
    if (tax.price_type === 'VAT Inclusive') return lineFinal / 1.12;
    return lineFinal;
  }
  return lineFinal / 1.12;
}

/** Skip invoice inventory deduction + COGS when DR/SO workflow already expensed cost of goods. */
export async function shouldSkipInvoiceInventoryCogs(
  db: DbClient,
  opts: {
    skip_inventory?: boolean;
    dn_id?: string | null;
    so_id?: string | null;
    invoice_id?: string | null;
  },
): Promise<boolean> {
  if (opts.skip_inventory) return true;
  if (opts.dn_id) return true;

  if (opts.so_id) {
    const drCogs = await db.query(
      `SELECT 1 FROM journal_entries je
       JOIN delivery_notes dn ON dn.id = je.reference_id
       WHERE je.reference_type = 'Delivery Receipt'
         AND je.status = 'Posted'
         AND dn.so_id = $1
       LIMIT 1`,
      [opts.so_id],
    );
    if (drCogs.rows.length > 0) return true;
  }

  if (opts.invoice_id) {
    const ledger = await db.query(
      `SELECT 1 FROM inventory_ledger
       WHERE reference_type = 'Sales Invoice' AND reference_id = $1
       LIMIT 1`,
      [opts.invoice_id],
    );
    if (ledger.rows.length === 0) return true;
  }

  return false;
}

/** True when COGS was recognized on the original sale (invoice and/or delivery receipt). */
export async function invoiceHadCogsRecognized(
  db: DbClient,
  invoice: {
    id?: string;
    dn_id?: string | null;
    so_id?: string | null;
  },
): Promise<boolean> {
  const skipInv = await shouldSkipInvoiceInventoryCogs(db, {
    dn_id: invoice.dn_id,
    so_id: invoice.so_id,
    invoice_id: invoice.id,
  });
  if (!skipInv) return true;

  if (invoice.so_id) {
    const drCogs = await db.query(
      `SELECT COALESCE(SUM(jel.debit), 0) AS amount
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_type = 'Cost of Goods Sold'
       JOIN delivery_notes dn ON dn.id = je.reference_id
       WHERE je.reference_type = 'Delivery Receipt'
         AND je.status = 'Posted'
         AND dn.so_id = $1`,
      [invoice.so_id],
    );
    if (parseFloat(drCogs.rows[0]?.amount || 0) > 0.009) return true;
  }

  if (invoice.dn_id) {
    const drCogs = await db.query(
      `SELECT COALESCE(SUM(jel.debit), 0) AS amount
       FROM journal_entries je
       JOIN journal_entry_lines jel ON jel.entry_id = je.id
       JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.account_type = 'Cost of Goods Sold'
       WHERE je.reference_type = 'Delivery Receipt'
         AND je.status = 'Posted'
         AND je.reference_id = $1`,
      [invoice.dn_id],
    );
    if (parseFloat(drCogs.rows[0]?.amount || 0) > 0.009) return true;
  }

  return false;
}
