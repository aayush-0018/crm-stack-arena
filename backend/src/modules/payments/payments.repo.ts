import { Db } from '../../db/pool';
import { PaymentKind, PaymentMethod } from './payments.schemas';

export interface Payment {
  id: number;
  kind: PaymentKind;
  amountPaise: number;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  paidOn: string;
  createdAt: string;
  createdByName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  receiptId: number | null;
  receiptNumber: string | null;
}

const COLS = `p.id, p.kind, p.amount_paise AS "amountPaise", p.method, p.reference, p.note,
  p.paid_on AS "paidOn", p.created_at AS "createdAt", u.name AS "createdByName",
  p.voided_at AS "voidedAt", p.void_reason AS "voidReason",
  p.receipt_id AS "receiptId", r.receipt_number AS "receiptNumber"`;

/** Every entry for an order, oldest first, including voided ones (shown struck out). */
export async function listPayments(db: Db, orderId: number): Promise<Payment[]> {
  const { rows } = await db.query(
    `SELECT ${COLS} FROM payments p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN receipts r ON r.id = p.receipt_id
     WHERE p.order_id = $1 ORDER BY p.paid_on, p.id`,
    [orderId],
  );
  return rows;
}

export async function findPayment(db: Db, shopId: number, orderId: number, id: number) {
  const { rows } = await db.query(
    `SELECT p.id, p.kind, p.amount_paise AS "amountPaise", p.voided_at AS "voidedAt"
     FROM payments p WHERE p.shop_id = $1 AND p.order_id = $2 AND p.id = $3`,
    [shopId, orderId, id],
  );
  return (rows[0] as { id: number; kind: PaymentKind; amountPaise: number; voidedAt: string | null } | undefined) ?? null;
}

export async function findPaymentIdByIdempotencyKey(db: Db, shopId: number, key: string) {
  const { rows } = await db.query(`SELECT id, order_id AS "orderId" FROM payments WHERE shop_id = $1 AND idempotency_key = $2`, [
    shopId,
    key,
  ]);
  return (rows[0] as { id: number; orderId: number } | undefined) ?? null;
}

export async function insertPayment(
  db: Db,
  p: {
    shopId: number;
    orderId: number;
    kind: PaymentKind;
    amountPaise: number;
    method: PaymentMethod;
    paidOn: string;
    reference?: string | null;
    note?: string | null;
    idempotencyKey?: string;
    userId: number | null;
    receiptId: number;
    returnId?: number;
  },
): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO payments (shop_id, order_id, kind, amount_paise, method, paid_on, reference, note, idempotency_key, created_by, receipt_id, return_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [p.shopId, p.orderId, p.kind, p.amountPaise, p.method, p.paidOn, p.reference ?? null, p.note ?? null, p.idempotencyKey ?? null, p.userId, p.receiptId, p.returnId ?? null],
  );
  return rows[0].id;
}

export async function voidPayment(db: Db, id: number, userId: number, reason: string | null) {
  await db.query(`UPDATE payments SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1 AND voided_at IS NULL`, [
    id,
    userId,
    reason,
  ]);
}

/** How many of these orders still have payment or refund entries (not removed). Deleting them would erase money history. */
export async function countOrdersWithEntries(db: Db, shopId: number, orderIds: number[]): Promise<number> {
  if (!orderIds.length) return 0;
  const { rows } = await db.query(
    `SELECT count(DISTINCT order_id)::int AS n FROM payments
     WHERE shop_id = $1 AND order_id = ANY($2::bigint[]) AND voided_at IS NULL`,
    [shopId, orderIds],
  );
  return rows[0].n;
}

/** Payments minus refunds, ignoring voided entries. */
export async function netPaid(db: Db, orderId: number): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(sum(CASE WHEN kind = 'payment' THEN amount_paise ELSE -amount_paise END), 0)::bigint AS net
     FROM payments WHERE order_id = $1 AND voided_at IS NULL`,
    [orderId],
  );
  return rows[0].net;
}
