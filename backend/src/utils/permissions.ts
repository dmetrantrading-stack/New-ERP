/** Legacy permission keys mapped to current canonical keys (either direction grants access). */
const PERM_EQUIVALENTS: Record<string, string[]> = {
  'purchases.payment-voucher.view': ['purchases.dv.view'],
  'purchases.payment-voucher.create': ['purchases.dv.create'],
  'purchases.payment-voucher.edit': ['purchases.dv.edit'],
  'purchases.payment-voucher.delete': ['purchases.dv.delete'],
  'purchases.payment-voucher.print': ['purchases.dv.print'],
  'purchases.payment-voucher.approve': ['purchases.dv.approve'],
  'purchases.payment-voucher.export': ['purchases.dv.export'],
  'hr.payslip.view': ['hr.payroll.view'],
  'hr.payslip.print': ['hr.payroll.print'],
  'hr.payslip.create': ['hr.payroll.create'],
  'hr.payslip.edit': ['hr.payroll.edit'],
  'hr.payslip.approve': ['hr.payroll.approve'],
  'hr.payslip.export': ['hr.payroll.export'],
  'pos.view': ['pos.write'],
};

/** Actions that imply view access on the same module prefix. */
const IMPLIES_VIEW = new Set(['create', 'edit', 'approve', 'write', 'replenish', 'import', 'delete', 'print', 'export']);

export function normalizePermissionKeys(permissions: string[]): string[] {
  const set = new Set((permissions || []).filter(Boolean).map(String));
  for (const key of [...set]) {
    const dot = key.lastIndexOf('.');
    if (dot <= 0) continue;
    const prefix = key.slice(0, dot);
    const action = key.slice(dot + 1);
    if (IMPLIES_VIEW.has(action)) {
      set.add(`${prefix}.view`);
    }
    if (action === 'write' && prefix === 'pos') {
      set.add('pos.view');
    }
    if (action === 'edit' && prefix === 'system.settings') {
      set.add('system.settings.view');
    }
  }
  return [...set].sort();
}

export function userHasPermission(userPerms: string[] | undefined, required: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  const perms = userPerms || [];
  if (perms.includes(required)) return true;
  const aliases = PERM_EQUIVALENTS[required];
  if (aliases?.some((a) => perms.includes(a))) return true;
  for (const [canonical, legacy] of Object.entries(PERM_EQUIVALENTS)) {
    if (legacy.includes(required) && perms.includes(canonical)) return true;
  }
  return false;
}

export function userHasAnyPermission(userPerms: string[] | undefined, required: string[], isAdmin: boolean): boolean {
  if (isAdmin) return true;
  return required.some((p) => userHasPermission(userPerms, p, false));
}
