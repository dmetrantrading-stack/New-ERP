import { PoolClient } from 'pg';
import { query } from '../config/database';
import { DEFAULT_LOYALTY_RATES, LoyaltyRates } from './loyaltyPolicy';

export type LoyaltySettings = LoyaltyRates;

const KEYS = {
  enabled: 'loyalty_enabled',
  earnPesoPerPoint: 'loyalty_earn_peso_per_point',
  redeemPesoPerPoint: 'loyalty_redeem_peso_per_point',
} as const;

function parseBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return value === 'true' || value === '1';
}

function parsePositiveNumber(value: string | null | undefined, fallback: number): number {
  const n = parseFloat(String(value ?? ''));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function mapRows(rows: Array<{ setting_key: string; setting_value: string }>): LoyaltySettings {
  const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  return {
    enabled: parseBool(map.get(KEYS.enabled), DEFAULT_LOYALTY_RATES.enabled),
    earnPesoPerPoint: parsePositiveNumber(map.get(KEYS.earnPesoPerPoint), DEFAULT_LOYALTY_RATES.earnPesoPerPoint),
    pesoPerPoint: parsePositiveNumber(map.get(KEYS.redeemPesoPerPoint), DEFAULT_LOYALTY_RATES.pesoPerPoint),
  };
}

async function loadRows(client?: PoolClient) {
  const sql = `SELECT setting_key, setting_value FROM system_settings
     WHERE setting_key IN ($1, $2, $3)`;
  const params = [KEYS.enabled, KEYS.earnPesoPerPoint, KEYS.redeemPesoPerPoint];
  if (client) {
    return client.query(sql, params);
  }
  return query(sql, params);
}

export async function getLoyaltySettings(client?: PoolClient): Promise<LoyaltySettings> {
  const r = await loadRows(client);
  return mapRows(r.rows);
}

export type LoyaltySettingsInput = Partial<{
  enabled: boolean;
  earn_peso_per_point: number;
  redeem_peso_per_point: number;
}>;

export async function setLoyaltySettings(input: LoyaltySettingsInput): Promise<LoyaltySettings> {
  const current = await getLoyaltySettings();
  const next: LoyaltySettings = {
    enabled: input.enabled ?? current.enabled,
    earnPesoPerPoint: input.earn_peso_per_point != null
      ? Math.max(0.01, input.earn_peso_per_point)
      : current.earnPesoPerPoint,
    pesoPerPoint: input.redeem_peso_per_point != null
      ? Math.max(0.01, input.redeem_peso_per_point)
      : current.pesoPerPoint,
  };

  const rows: [string, string][] = [
    [KEYS.enabled, next.enabled ? 'true' : 'false'],
    [KEYS.earnPesoPerPoint, String(next.earnPesoPerPoint)],
    [KEYS.redeemPesoPerPoint, String(next.pesoPerPoint)],
  ];

  for (const [key, value] of rows) {
    await query(
      `INSERT INTO system_settings (setting_key, setting_value) VALUES ($1, $2)
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
      [key, value],
    );
  }

  return next;
}

export function loyaltySettingsToApi(settings: LoyaltySettings) {
  return {
    enabled: settings.enabled,
    earn_peso_per_point: settings.earnPesoPerPoint,
    redeem_peso_per_point: settings.pesoPerPoint,
  };
}
