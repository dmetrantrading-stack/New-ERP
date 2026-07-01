import { query } from '../config/database';

export type RegistrationSettings = {
  enabled: boolean;
  require_approval: boolean;
  default_role: string;
};

const KEYS = {
  enabled: 'allow_self_registration',
  requireApproval: 'registration_require_approval',
  defaultRole: 'registration_default_role',
} as const;

const DEFAULTS: RegistrationSettings = {
  enabled: true,
  require_approval: true,
  default_role: 'Cashier',
};

function parseBool(value: string | null | undefined, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  return value === 'true' || value === '1';
}

export async function getRegistrationSettings(): Promise<RegistrationSettings> {
  const r = await query(
    `SELECT setting_key, setting_value FROM system_settings
     WHERE setting_key IN ($1, $2, $3)`,
    [KEYS.enabled, KEYS.requireApproval, KEYS.defaultRole],
  );
  const map = new Map(r.rows.map((row: { setting_key: string; setting_value: string }) => [row.setting_key, row.setting_value]));
  return {
    enabled: parseBool(map.get(KEYS.enabled), DEFAULTS.enabled),
    require_approval: parseBool(map.get(KEYS.requireApproval), DEFAULTS.require_approval),
    default_role: String(map.get(KEYS.defaultRole) || DEFAULTS.default_role).trim() || DEFAULTS.default_role,
  };
}

export async function setRegistrationSettings(input: Partial<RegistrationSettings>): Promise<RegistrationSettings> {
  const current = await getRegistrationSettings();
  const next: RegistrationSettings = {
    enabled: input.enabled ?? current.enabled,
    require_approval: input.require_approval ?? current.require_approval,
    default_role: input.default_role?.trim() || current.default_role,
  };

  const rows: [string, string][] = [
    [KEYS.enabled, next.enabled ? 'true' : 'false'],
    [KEYS.requireApproval, next.require_approval ? 'true' : 'false'],
    [KEYS.defaultRole, next.default_role],
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

export async function resolveDefaultRegistrationRoleId(roleName: string): Promise<number | null> {
  const named = await query('SELECT id FROM roles WHERE name = $1 LIMIT 1', [roleName]);
  if (named.rows.length > 0) return named.rows[0].id as number;

  const fallback = await query(
    `SELECT id FROM roles WHERE name NOT IN ('Admin', 'Owner') ORDER BY id LIMIT 1`,
  );
  if (fallback.rows.length > 0) return fallback.rows[0].id as number;

  const any = await query('SELECT id FROM roles ORDER BY id LIMIT 1');
  return any.rows[0]?.id ?? null;
}
