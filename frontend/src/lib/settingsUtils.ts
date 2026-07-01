import { PRIMARY, FINANCE_FONT, financeTabClass } from './financeUtils';

export { PRIMARY, FINANCE_FONT, financeTabClass };

export const SETTINGS_INPUT_CLASS =
  'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

export const SETTINGS_TABS = [
  { key: 'company', label: 'Company', permAny: ['system.settings.view'] as string[] },
  { key: 'pos', label: 'POS', permAny: ['system.settings.view'] as string[] },
  { key: 'sales', label: 'Sales & Purchasing', permAny: ['system.settings.view'] as string[] },
  { key: 'users', label: 'Users & Access', permAny: ['system.settings.view', 'system.users.view', 'system.users.edit'] as string[] },
  { key: 'system', label: 'System', permAny: ['system.settings.edit'] as string[] },
] as const;

export type SettingsTabKey = (typeof SETTINGS_TABS)[number]['key'];

export const SETTINGS_SECTIONS: Record<SettingsTabKey, readonly { key: string; label: string }[]> = {
  company: [],
  pos: [
    { key: 'printer', label: 'Thermal Printer' },
    { key: 'loyalty', label: 'Loyalty Program' },
  ],
  sales: [
    { key: 'invoicing', label: 'Sales Invoices' },
    { key: 'purchasing', label: 'Purchase Approval' },
    { key: 'inventory', label: 'Inventory Costing' },
  ],
  users: [
    { key: 'permissions', label: 'User Permissions' },
    { key: 'registration', label: 'Self-Registration' },
  ],
  system: [
    { key: 'accounting', label: 'Period Lock' },
    { key: 'imports', label: 'Opening Balances' },
    { key: 'maintenance', label: 'Backup & Reset' },
  ],
};

const LEGACY_TAB_MAP: Record<string, SettingsTabKey> = {
  business: 'company',
  printer: 'pos',
  workflow: 'sales',
  permissions: 'users',
  data: 'system',
};

const LEGACY_DEFAULT_SECTION: Partial<Record<string, string>> = {
  printer: 'printer',
  permissions: 'permissions',
};

export function canAccessSettingsTab(
  hasAnyPerm: (keys: string[]) => boolean,
  tabKey: SettingsTabKey,
): boolean {
  const tab = SETTINGS_TABS.find((t) => t.key === tabKey);
  if (!tab) return false;
  return hasAnyPerm([...tab.permAny]);
}

export function parseSettingsTab(value: string | null): SettingsTabKey | null {
  if (!value) return null;
  const mapped = (LEGACY_TAB_MAP[value] || value) as SettingsTabKey;
  if (SETTINGS_TABS.some((t) => t.key === mapped)) return mapped;
  return null;
}

export function parseSettingsSection(tab: SettingsTabKey, section: string | null, tabParam?: string | null): string {
  const sections = SETTINGS_SECTIONS[tab];
  if (!sections.length) return '';
  if (section && sections.some((s) => s.key === section)) return section;
  if (tabParam && LEGACY_DEFAULT_SECTION[tabParam]) return LEGACY_DEFAULT_SECTION[tabParam];
  return sections[0].key;
}

export function settingsTabHasSections(tab: SettingsTabKey): boolean {
  return SETTINGS_SECTIONS[tab].length > 0;
}

export const DEFAULT_BIZ = {
  business_name: '',
  trade_name: '',
  address: '',
  barangay: '',
  city: '',
  province: '',
  zip_code: '',
  mobile_number: '',
  telephone_number: '',
  email_address: '',
  website: '',
  tin_number: '',
  vat_type: 'VAT Registered',
  vat_rate: 12,
  prepared_by: '',
  prepared_by_position: '',
  approved_by: '',
  approved_by_position: '',
  currency: 'PHP',
  date_format: 'MM/DD/YYYY',
  logo_url: '',
  printer_name: 'PT-210',
  printer_type: 'Bluetooth',
  paper_size: 58,
  auto_print: false,
  printer_port: '',
};
