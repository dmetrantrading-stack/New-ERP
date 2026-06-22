import { query } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export async function getAccountingLockDate(): Promise<string | null> {
  const r = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'accounting_lock_date'");
  const v = (r.rows[0]?.setting_value || '').trim();
  return v || null;
}

export async function setAccountingLockDate(date: string | null): Promise<void> {
  const val = date?.trim() || '';
  await query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ('accounting_lock_date', $1)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1`,
    [val]
  );
}

/** Blocks posting on or before the lock date (inclusive). */
export async function assertPeriodNotLocked(entryDate: string | Date): Promise<void> {
  const lock = await getAccountingLockDate();
  if (!lock) return;
  const d = typeof entryDate === 'string' ? entryDate.slice(0, 10) : entryDate.toISOString().slice(0, 10);
  if (d <= lock) {
    throw new AppError(`Accounting period is locked through ${lock}. Cannot post on or before this date.`, 400);
  }
}
