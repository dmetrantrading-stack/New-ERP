import { PRIMARY, FINANCE_FONT, financeTabClass } from './financeUtils';

export { PRIMARY, FINANCE_FONT, financeTabClass };

export const SETTINGS_TABS = [
  { key: 'business', label: 'Business', permAny: ['system.settings.view'] as string[] },
  { key: 'printer', label: 'Printer', permAny: ['system.settings.view'] as string[] },
  { key: 'workflow', label: 'Sales Workflow', permAny: ['system.settings.view'] as string[] },
  { key: 'permissions', label: 'Permissions', permAny: ['system.users.view', 'system.users.edit'] as string[] },
  { key: 'data', label: 'Data Tools', permAny: ['system.settings.edit'] as string[] },
] as const;

export type SettingsTabKey = (typeof SETTINGS_TABS)[number]['key'];

export function canAccessSettingsTab(
  hasAnyPerm: (keys: string[]) => boolean,
  tabKey: SettingsTabKey,
): boolean {
  const tab = SETTINGS_TABS.find((t) => t.key === tabKey);
  if (!tab) return false;
  return hasAnyPerm([...tab.permAny]);
}

export function parseSettingsTab(value: string | null): SettingsTabKey | null {
  if (value && SETTINGS_TABS.some((t) => t.key === value)) return value as SettingsTabKey;
  return null;
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
