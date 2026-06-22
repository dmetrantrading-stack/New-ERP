import { query } from '../config/database';

export type InvoiceCopyMode = 'ordered' | 'delivered';

export async function getInvoiceCopyMode(): Promise<InvoiceCopyMode> {
  const r = await query("SELECT setting_value FROM system_settings WHERE setting_key = 'invoice_copy_mode'");
  return r.rows[0]?.setting_value === 'ordered' ? 'ordered' : 'delivered';
}

export async function setInvoiceCopyMode(mode: InvoiceCopyMode): Promise<void> {
  await query(
    `INSERT INTO system_settings (setting_key, setting_value) VALUES ('invoice_copy_mode', $1)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = $1`,
    [mode]
  );
}
