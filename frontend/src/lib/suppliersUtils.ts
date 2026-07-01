import { PRIMARY, FINANCE_FONT } from './financeUtils';

export { PRIMARY, FINANCE_FONT };

export const SUPPLIER_ENTITY_TYPES = ['Corporation', 'Sole Proprietorship'] as const;
export type SupplierEntityType = (typeof SUPPLIER_ENTITY_TYPES)[number];

export const SUPPLIER_TABS = [
  {
    key: 'corporation',
    label: 'Corporation',
    entityType: 'Corporation' as SupplierEntityType,
    description: 'Registered companies and corporations (Inc., Corp., Co.)',
  },
  {
    key: 'sole-prop',
    label: 'Sole Proprietorship',
    entityType: 'Sole Proprietorship' as SupplierEntityType,
    description: 'Proprietor-registered suppliers for BIR payee name and TIN',
  },
] as const;

export type SupplierTabKey = (typeof SUPPLIER_TABS)[number]['key'];

export function parseSupplierTab(value: string | null): SupplierTabKey | null {
  if (value && SUPPLIER_TABS.some((t) => t.key === value)) return value as SupplierTabKey;
  return null;
}

export function tabToEntityType(tab: SupplierTabKey): SupplierEntityType {
  return SUPPLIER_TABS.find((t) => t.key === tab)!.entityType;
}

export function entityTypeToTabKey(type: SupplierEntityType): SupplierTabKey {
  return type === 'Sole Proprietorship' ? 'sole-prop' : 'corporation';
}

export function normalizeSupplierEntityType(
  value: unknown,
  fallback: SupplierEntityType = 'Corporation',
): SupplierEntityType {
  if (value === 'Corporation' || value === 'Sole Proprietorship') return value;
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'sole prop' || v === 'sole proprietorship' || v === 'sole proprietor' || v === 'proprietorship') {
    return 'Sole Proprietorship';
  }
  if (v === 'corporation' || v === 'corp' || v === 'company') return 'Corporation';
  return fallback;
}

export function entityTypeLabels(entityType: SupplierEntityType) {
  if (entityType === 'Sole Proprietorship') {
    return {
      nameLabel: 'Registered Proprietor Name *',
      namePlaceholder: 'As registered with BIR',
      contactLabel: 'Owner / Contact',
      contactPlaceholder: 'Optional if same as proprietor',
    };
  }
  return {
    nameLabel: 'Registered Company Name *',
    namePlaceholder: 'Legal company name',
    contactLabel: 'Contact Person',
    contactPlaceholder: 'Purchasing or AP contact',
  };
}
