/** Any of these grants access to the HR & Payroll page and sidebar link. */
export const HR_PAGE_ACCESS_PERMS = [
  'hr.employees.view',
  'hr.attendance.view',
  'hr.payroll.view',
  'hr.payslip.view',
  'hr.cash-advances.view',
] as const;

export const HR_TAB_PERMS: Record<string, string[]> = {
  employees: ['hr.employees.view'],
  'cash-advances': ['hr.cash-advances.view'],
  grocery: ['hr.employees.view', 'hr.payroll.view', 'hr.payslip.view'],
  'attendance-sheet': ['hr.attendance.view'],
  payroll: ['hr.payroll.view', 'hr.payslip.view'],
  sss: ['hr.payroll.view', 'hr.payslip.view'],
};

export function canAccessHrTab(hasAnyPerm: (p: string[]) => boolean, tabKey: string): boolean {
  const perms = HR_TAB_PERMS[tabKey];
  if (!perms) return false;
  return hasAnyPerm(perms);
}
