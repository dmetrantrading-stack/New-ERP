import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

const UNDO_KEY = 'last_customer_import_undo';
const FALLBACK_DAYS = 30;

export type CustomerImportUndoPayload = {
  created_ids: number[];
  updated: Array<{
    id: number;
    customer_name: string;
    contact_person: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    customer_type: string;
    credit_limit: number;
    payment_terms: string | null;
    tax_type: string;
    tin: string | null;
    is_active: boolean;
  }>;
  imported_at: string;
  user_id: string;
  file_name?: string;
};

export type CustomerImportUndoStatus = {
  available: boolean;
  mode: 'tracked' | 'fallback' | 'none';
  created_count: number;
  updated_count: number;
  imported_at?: string;
  file_name?: string | null;
  fallback_count?: number;
  message?: string;
};

async function listFallbackRemovalCandidates(): Promise<any[]> {
  const r = await query(
    `SELECT c.id, c.customer_code, c.customer_name, c.balance, c.created_at
     FROM customers c
     WHERE c.is_active = true
       AND c.customer_code ~ '^DMC-'
       AND COALESCE(c.balance, 0) <= 0.009
       AND c.created_at >= CURRENT_TIMESTAMP - ($1::text || ' days')::interval
       AND NOT EXISTS (
         SELECT 1 FROM sales_invoices si
         WHERE si.customer_id = c.id
           AND si.balance > 0
           AND si.status NOT IN ('Cancelled', 'Void')
       )
       AND NOT EXISTS (
         SELECT 1 FROM sales_orders so WHERE so.customer_id = c.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM sales_quotations sq WHERE sq.customer_id = c.id
       )
     ORDER BY c.created_at DESC, c.id DESC`,
    [String(FALLBACK_DAYS)],
  );
  return r.rows;
}

export async function saveCustomerImportUndo(payload: CustomerImportUndoPayload): Promise<void> {
  await query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES ($1, $2)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
    [UNDO_KEY, JSON.stringify(payload)],
  );
}

export async function getCustomerImportUndo(): Promise<CustomerImportUndoPayload | null> {
  const r = await query('SELECT setting_value FROM system_settings WHERE setting_key = $1', [UNDO_KEY]);
  if (!r.rows.length || !r.rows[0].setting_value) return null;
  try {
    return JSON.parse(r.rows[0].setting_value) as CustomerImportUndoPayload;
  } catch {
    return null;
  }
}

export async function getCustomerImportUndoStatus(): Promise<CustomerImportUndoStatus> {
  const payload = await getCustomerImportUndo();
  if (payload && (payload.created_ids.length > 0 || payload.updated.length > 0)) {
    return {
      available: true,
      mode: 'tracked',
      created_count: payload.created_ids.length,
      updated_count: payload.updated.length,
      imported_at: payload.imported_at,
      file_name: payload.file_name || null,
    };
  }

  const fallback = await listFallbackRemovalCandidates();
  if (fallback.length > 0) {
    return {
      available: true,
      mode: 'fallback',
      created_count: fallback.length,
      updated_count: 0,
      fallback_count: fallback.length,
      message: `Remove ${fallback.length} recently imported customer(s) (DMC- codes, no balance, last ${FALLBACK_DAYS} days)?`,
    };
  }

  return {
    available: false,
    mode: 'none',
    created_count: 0,
    updated_count: 0,
    message: 'No tracked import or removable imported customers found.',
  };
}

export async function clearCustomerImportUndo(): Promise<void> {
  await query('DELETE FROM system_settings WHERE setting_key = $1', [UNDO_KEY]);
}

export async function undoLastCustomerImport(useFallback = false): Promise<{
  removed: number;
  restored: number;
  blocked: { id: number; customer_name: string; reason: string }[];
  mode: 'tracked' | 'fallback';
}> {
  const payload = await getCustomerImportUndo();

  if (payload && (payload.created_ids.length > 0 || payload.updated.length > 0)) {
    let removed = 0;
    let restored = 0;
    const blocked: { id: number; customer_name: string; reason: string }[] = [];

    for (const id of payload.created_ids) {
      const check = await query(
        `SELECT c.id, c.customer_name, c.balance,
                (SELECT COUNT(*) FROM sales_invoices WHERE customer_id = c.id AND balance > 0 AND status != 'Cancelled') as open_invoices
         FROM customers c WHERE c.id = $1 AND c.is_active = true`,
        [id],
      );
      if (check.rows.length === 0) continue;
      const row = check.rows[0];
      if (parseFloat(row.balance) > 0 || parseInt(row.open_invoices, 10) > 0) {
        blocked.push({
          id,
          customer_name: row.customer_name,
          reason: 'Has balance or open invoices — deactivate manually if needed',
        });
        continue;
      }
      await query(
        'UPDATE customers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [id],
      );
      removed++;
    }

    for (const snap of payload.updated) {
      await query(
        `UPDATE customers SET
          customer_name = $1, contact_person = $2, address = $3, phone = $4, email = $5,
          customer_type = $6, credit_limit = $7, payment_terms = $8, tax_type = $9, tin = $10,
          is_active = $11, updated_at = CURRENT_TIMESTAMP
         WHERE id = $12`,
        [
          snap.customer_name,
          snap.contact_person,
          snap.address,
          snap.phone,
          snap.email,
          snap.customer_type,
          snap.credit_limit,
          snap.payment_terms,
          snap.tax_type,
          snap.tin,
          snap.is_active,
          snap.id,
        ],
      );
      restored++;
    }

    await clearCustomerImportUndo();
    return { removed, restored, blocked, mode: 'tracked' };
  }

  if (!useFallback) {
    throw new AppError('No tracked customer import to undo. Confirm to remove recently imported DMC- customers with no balance.');
  }

  const candidates = await listFallbackRemovalCandidates();
  if (candidates.length === 0) {
    throw new AppError('No removable imported customers found (DMC- codes, zero balance, last 30 days).');
  }

  let removed = 0;
  const blocked: { id: number; customer_name: string; reason: string }[] = [];
  for (const row of candidates) {
    await query(
      'UPDATE customers SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [row.id],
    );
    removed++;
  }

  return { removed, restored: 0, blocked, mode: 'fallback' };
}
