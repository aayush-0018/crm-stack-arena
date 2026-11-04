import { todayIST } from './date';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Same rule as the server: "2026" for a calendar year, "2026-27" for a year that starts in another month. */
export function fyLabel(iso: string, startMonth = 1) {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= startMonth ? y : y - 1;
  return startMonth === 1 ? String(start) : `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** e.g. "INV-JPR-2026-27-000001", for hints next to the branch code. */
export const sampleInvoiceNumber = (code: string, startMonth = 1) => `INV-${code ? `${code}-` : ''}${fyLabel(todayIST(), startMonth)}-000001`;
