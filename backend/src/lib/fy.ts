import { Db } from '../db/pool';

/**
 * Financial years. A shop picks the month its year starts in (1 = January = calendar year,
 * 4 = April for India's April–March year). A year is named by the calendar year it starts in.
 */

/** The calendar year the financial year containing `iso` (YYYY-MM-DD) started in. */
export function fyStartYear(iso: string, startMonth: number) {
  const [y, m] = iso.split('-').map(Number);
  return m >= startMonth ? y : y - 1;
}

/** "2026" for a calendar year, "2026-27" for one that runs across two. */
export function fyName(startYear: number, startMonth: number) {
  return startMonth === 1 ? String(startYear) : `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** The year part of invoice, receipt, refund and return numbers, e.g. INV-2026-27-000124. */
export const fyLabel = (iso: string, startMonth: number) => fyName(fyStartYear(iso, startMonth), startMonth);

export async function fyStartMonth(db: Db, shopId: number): Promise<number> {
  const { rows } = await db.query(`SELECT fy_start_month AS m FROM shops WHERE id = $1`, [shopId]);
  return rows[0]?.m ?? 1;
}

/** The year part for a document dated `iso` at this shop. */
export const docYear = async (db: Db, shopId: number, iso: string) => fyLabel(iso, await fyStartMonth(db, shopId));
