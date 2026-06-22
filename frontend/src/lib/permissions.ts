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

export function checkPermission(userPerms: string[] | undefined, required: string): boolean {
  const perms = userPerms || [];
  if (perms.includes(required)) return true;
  const aliases = PERM_EQUIVALENTS[required];
  if (aliases?.some((a) => perms.includes(a))) return true;
  for (const [canonical, legacy] of Object.entries(PERM_EQUIVALENTS)) {
    if (legacy.includes(required) && perms.includes(canonical)) return true;
  }
  return false;
}

export function checkAnyPermission(userPerms: string[] | undefined, required: string[]): boolean {
  return required.some((p) => checkPermission(userPerms, p));
}
