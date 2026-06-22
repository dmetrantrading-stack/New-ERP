import { v4 as uuidv4 } from 'uuid';
import { query, getClient } from '../config/database';
import { AppError } from '../middleware/errorHandler';

type QueryFn = (text: string, params?: any[]) => Promise<any>;

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => line.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
}

async function generateRefNumber(prefix: string, table: string, field: string): Promise<string> {
  const safeTable = table.replace(/[^a-z_]/g, '');
  const safeField = field.replace(/[^a-z_]/g, '');
  const safePrefix = prefix.replace(/[^A-Z0-9]/g, '');
  const startPos = safePrefix.length + 2;
  const result = await query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${safeField} FROM ${startPos}) AS INTEGER)), 0) + 1 as next
     FROM ${safeTable} WHERE ${safeField} ~ $1`,
    [`^${safePrefix}-`]
  );
  return `${safePrefix}-${String(result.rows[0]?.next || 1).padStart(5, '0')}`;
}

export async function importCustomerBalances(csv: string, userId: string) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new AppError('CSV must have a header row and at least one data row');
  const header = rows[0].map((h) => h.toLowerCase());
  const codeIdx = header.indexOf('customer_code');
  const nameIdx = header.indexOf('customer_name');
  const balIdx = header.indexOf('balance');
  if (codeIdx < 0 || nameIdx < 0 || balIdx < 0) {
    throw new AppError('Customers CSV requires columns: customer_code, customer_name, balance');
  }
  const termsIdx = header.indexOf('payment_terms');
  const tinIdx = header.indexOf('tin');
  let imported = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = row[codeIdx];
    const name = row[nameIdx];
    const balance = parseFloat(row[balIdx] || '0');
    if (!code || !name) continue;
    const existing = await query('SELECT id FROM customers WHERE customer_code = $1', [code]);
    if (existing.rows.length > 0) {
      await query('UPDATE customers SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [balance, existing.rows[0].id]);
    } else {
      await query(
        `INSERT INTO customers (customer_code, customer_name, balance, payment_terms, tin, customer_type, is_active)
         VALUES ($1, $2, $3, $4, $5, 'Retail', true)`,
        [code, name, balance, termsIdx >= 0 ? row[termsIdx] || null : null, tinIdx >= 0 ? row[tinIdx] || null : null]
      );
    }
    imported++;
  }
  return { imported, type: 'customers' };
}

export async function importSupplierBalances(csv: string, userId: string) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new AppError('CSV must have a header row and at least one data row');
  const header = rows[0].map((h) => h.toLowerCase());
  const codeIdx = header.indexOf('supplier_code');
  const nameIdx = header.indexOf('supplier_name');
  const balIdx = header.indexOf('balance');
  if (codeIdx < 0 || nameIdx < 0 || balIdx < 0) {
    throw new AppError('Suppliers CSV requires columns: supplier_code, supplier_name, balance');
  }
  let imported = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = row[codeIdx];
    const name = row[nameIdx];
    const balance = parseFloat(row[balIdx] || '0');
    if (!code || !name) continue;
    const existing = await query('SELECT id FROM suppliers WHERE supplier_code = $1', [code]);
    if (existing.rows.length > 0) {
      await query('UPDATE suppliers SET balance = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [balance, existing.rows[0].id]);
    } else {
      await query(
        `INSERT INTO suppliers (supplier_code, supplier_name, balance, is_active) VALUES ($1, $2, $3, true)`,
        [code, name, balance]
      );
    }
    imported++;
  }
  return { imported, type: 'suppliers' };
}

export async function importInventoryBalances(csv: string, userId: string) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new AppError('CSV must have a header row and at least one data row');
  const header = rows[0].map((h) => h.toLowerCase());
  const skuIdx = header.indexOf('sku');
  const qtyIdx = header.indexOf('quantity');
  const costIdx = header.indexOf('unit_cost');
  if (skuIdx < 0 || qtyIdx < 0 || costIdx < 0) {
    throw new AppError('Inventory CSV requires columns: sku, quantity, unit_cost');
  }
  const locIdx = header.indexOf('location_name');
  let imported = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const sku = row[skuIdx];
    const qty = parseFloat(row[qtyIdx] || '0');
    const cost = parseFloat(row[costIdx] || '0');
    if (!sku) continue;
    const prod = await query('SELECT id FROM products WHERE sku = $1', [sku]);
    if (prod.rows.length === 0) continue;
    const productId = prod.rows[0].id;
    let locationId = 1;
    if (locIdx >= 0 && row[locIdx]) {
      const loc = await query('SELECT id FROM locations WHERE LOWER(name) = LOWER($1) LIMIT 1', [row[locIdx]]);
      if (loc.rows.length > 0) locationId = loc.rows[0].id;
    }
    const inv = await query('SELECT id FROM inventory WHERE product_id = $1 AND location_id = $2', [productId, locationId]);
    if (inv.rows.length > 0) {
      await query('UPDATE inventory SET quantity = $1, unit_cost = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3', [qty, cost, inv.rows[0].id]);
    } else {
      await query(
        'INSERT INTO inventory (product_id, location_id, quantity, unit_cost) VALUES ($1, $2, $3, $4)',
        [productId, locationId, qty, cost]
      );
    }
    await query(
      `INSERT INTO inventory_ledger (id, product_id, location_id, reference_type, transaction_type, quantity, running_quantity, unit_cost, total_cost, notes, created_by)
       VALUES ($1, $2, $3, 'Opening Balance', 'ADJUSTMENT', $4, $4, $5, $6, 'Opening balance import', $7)`,
      [uuidv4(), productId, locationId, Math.abs(qty), cost, Math.abs(qty) * cost, userId]
    );
    imported++;
  }
  return { imported, type: 'inventory' };
}

export async function importGlOpeningBalances(csv: string, userId: string, entryDate?: string) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new AppError('CSV must have a header row and at least one data row');
  const header = rows[0].map((h) => h.toLowerCase());
  const codeIdx = header.indexOf('account_code');
  const debitIdx = header.indexOf('debit');
  const creditIdx = header.indexOf('credit');
  if (codeIdx < 0 || debitIdx < 0 || creditIdx < 0) {
    throw new AppError('GL CSV requires columns: account_code, debit, credit');
  }
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const lines: { code: string; debit: number; credit: number }[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const code = row[codeIdx];
      if (!code) continue;
      const debit = parseFloat(row[debitIdx] || '0') || 0;
      const credit = parseFloat(row[creditIdx] || '0') || 0;
      if (debit <= 0 && credit <= 0) continue;
      lines.push({ code, debit, credit });
    }
    if (lines.length === 0) throw new AppError('No valid GL lines found');
    const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > 0.02) {
      throw new AppError(`Opening entry out of balance: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}`);
    }
    const entryId = uuidv4();
    const entryNumber = await generateRefNumber('JE', 'journal_entries', 'entry_number');
    const date = entryDate || new Date().toISOString().slice(0, 10);
    await client.query(
      `INSERT INTO journal_entries (id, entry_number, entry_date, reference_type, reference_id, description, total_debit, total_credit, status, created_by)
       VALUES ($1, $2, $3, 'Opening Balance', $1, 'Opening balance import', $4, $4, 'Posted', $5)`,
      [entryId, entryNumber, date, totalDebit, userId]
    );
    for (const line of lines) {
      const acct = await client.query('SELECT id FROM chart_of_accounts WHERE account_code = $1', [line.code]);
      if (acct.rows.length === 0) throw new AppError(`Account code not found: ${line.code}`);
      await client.query(
        `INSERT INTO journal_entry_lines (id, entry_id, account_id, description, debit, credit, reference_type, reference_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'Opening Balance', $7)`,
        [uuidv4(), entryId, acct.rows[0].id, `Opening balance ${line.code}`, line.debit, line.credit, entryId]
      );
    }
    await client.query('COMMIT');
    return { imported: lines.length, type: 'gl', entry_number: entryNumber };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function runOpeningBalanceImport(type: string, csv: string, userId: string, entryDate?: string) {
  switch (type) {
    case 'customers': return importCustomerBalances(csv, userId);
    case 'suppliers': return importSupplierBalances(csv, userId);
    case 'inventory': return importInventoryBalances(csv, userId);
    case 'gl': return importGlOpeningBalances(csv, userId, entryDate);
    default: throw new AppError('Invalid import type. Use: customers, suppliers, inventory, gl');
  }
}
