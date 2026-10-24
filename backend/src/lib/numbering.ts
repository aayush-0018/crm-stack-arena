import { Db } from '../db/pool';

/** Takes the next per-shop sequence number. The UPDATE row-locks the counter until commit. */
export async function nextSeq(db: Db, shopId: number, kind: 'order' | 'invoice'): Promise<number> {
  const col = kind === 'order' ? 'next_order_seq' : 'next_invoice_seq';
  const { rows } = await db.query(
    `UPDATE shop_counters SET ${col} = ${col} + 1 WHERE shop_id = $1 RETURNING ${col} - 1 AS seq`,
    [shopId],
  );
  if (!rows[0]) throw new Error(`shop_counters row missing for shop ${shopId}`);
  return rows[0].seq;
}

const withCode = (code?: string | null) => (code ? `${code}-` : '');

export const formatOrderNumber = (seq: number, code?: string | null) =>
  `ORD-${withCode(code)}${String(seq).padStart(6, '0')}`;
export const formatInvoiceNumber = (year: string, seq: number, code?: string | null) =>
  `INV-${withCode(code)}${year}-${String(seq).padStart(6, '0')}`;

/** The branch's short code (e.g. "JPR"), printed in new order and invoice numbers. */
export async function branchCode(db: Db, shopId: number): Promise<string | null> {
  const { rows } = await db.query(`SELECT code FROM shops WHERE id = $1`, [shopId]);
  return rows[0]?.code ?? null;
}

/** Today's date in India as 'YYYY-MM-DD'. */
export async function todayIST(db: Db): Promise<string> {
  const { rows } = await db.query(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today`);
  return rows[0].today;
}
