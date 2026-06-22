/** Prevents duplicate URL-driven loads/toasts (React StrictMode runs effects twice). */
const inFlight = new Set<string>();

export function beginCopyNavigation(key: string): boolean {
  if (!key || inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function endCopyNavigation(key: string) {
  if (key) inFlight.delete(key);
}
