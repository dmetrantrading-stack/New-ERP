export const PRIMARY = '#1E40AF';

export const FINANCE_FONT = 'Inter, system-ui, sans-serif';

export function financeTabClass(active: boolean) {
  return `px-3 py-1 text-xs font-semibold rounded-md whitespace-nowrap ${
    active ? 'bg-white text-blue-900' : 'text-white/80 hover:text-white'
  }`;
}

export {
  ACCOUNTING_SECTIONS,
  ACCOUNTING_TABS,
  parseAccountingTab,
  sectionForTab,
  tabsForSection,
  tabDef,
} from './accountingConfig';
export type { AccountingSectionKey, AccountingTabKey, AccountingTabDef } from './accountingConfig';

export { AGING_LABELS } from './payablesUtils';
