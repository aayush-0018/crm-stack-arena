import { Db, pool } from '../../db/pool';
import { withTransaction } from '../../db/tx';
import { AppError, notFound } from '../../lib/errors';
import { branchCode, formatDocNumber, nextSeq } from '../../lib/numbering';
import { findCustomer } from '../customers/customers.repo';
import { PaymentKind, PaymentMethod } from '../payments/payments.schemas';
import { findShop } from '../shop/shop.repo';

export interface ReceiptAllocation {
  orderId: number;
  orderNumber: string;
  amountPaise: number;
}

export interface Receipt {
  id: number;
  kind: PaymentKind;
  receiptNumber: string;
  receiptDate: string;
  customerId: number | null;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  amountPaise: number;
  shopSnapshot: Record<string, any>;
  customerSnapshot: { name: string; phone: string | null; email: string | null; address: string | null };
  allocations: ReceiptAllocation[];
  createdAt: string;
  createdByName: string | null;
  /** Ledger entries of this receipt that an owner has since removed (voided). */
  voidedPaise: number;
}

const COLS = `r.id, r.kind, r.receipt_number AS "receiptNumber", r.receipt_date AS "receiptDate",
  r.customer_id AS "customerId", r.method, r.reference, r.note, r.amount_paise AS "amountPaise",
  r.shop_snapshot AS "shopSnapshot", r.customer_snapshot AS "customerSnapshot", r.allocations,
  r.created_at AS "createdAt", u.name AS "createdByName",
  COALESCE((SELECT sum(p.amount_paise) FROM payments p WHERE p.receipt_id = r.id AND p.voided_at IS NOT NULL), 0)::bigint AS "voidedPaise"`;

/**
 * Numbers and stores a receipt (RCPT-… for money in, RFND-… for money out), copying the shop and
 * customer details so a reprint is always identical. Call inside the transaction that writes the
 * ledger entries, then point those entries at the returned id.
 */
export async function issueReceipt(
  c: Db,
  r: {
    shopId: number;
    kind: PaymentKind;
    date: string;
    customerId: number | null;
    method: PaymentMethod;
    reference?: string | null;
    note?: string | null;
    allocations: ReceiptAllocation[];
    userId: number | null;
    idempotencyKey?: string;
  },
): Promise<{ id: number; receiptNumber: string }> {
  const amountPaise = r.allocations.reduce((s, a) => s + a.amountPaise, 0);
  if (amountPaise <= 0) throw new Error('A receipt needs an amount above zero');
  const shop = await findShop(c, r.shopId);
  if (!shop) throw notFound('Shop');
  const customer = r.customerId ? await findCustomer(c, r.shopId, r.customerId, { includeDeleted: true }) : null;
  // Only what's printed; internal settings stay out of the snapshot (as on invoices).
  const { id: _id, allowNegativeStock: _setting, ...shopSnapshot } = shop;
  const seq = await nextSeq(c, r.shopId, r.kind === 'payment' ? 'receipt' : 'refund');
  const receiptNumber = formatDocNumber(r.kind === 'payment' ? 'RCPT' : 'RFND', r.date.slice(0, 4), seq, await branchCode(c, r.shopId));
  const { rows } = await c.query(
    `INSERT INTO receipts (shop_id, kind, receipt_number, receipt_date, customer_id, method, reference, note, amount_paise,
       shop_snapshot, customer_snapshot, allocations, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
    [
      r.shopId, r.kind, receiptNumber, r.date, customer?.id ?? null, r.method, r.reference ?? null, r.note ?? null, amountPaise,
      JSON.stringify(shopSnapshot),
      JSON.stringify(
        customer
          ? { name: customer.name, phone: customer.phone, email: customer.email, address: customer.address }
          : { name: 'Walk-in customer', phone: null, email: null, address: null },
      ),
      JSON.stringify(r.allocations),
      r.idempotencyKey ?? null,
      r.userId,
    ],
  );
  return { id: rows[0].id, receiptNumber };
}

export async function findReceipt(db: Db, shopId: number, id: number): Promise<Receipt | null> {
  const { rows } = await db.query(`SELECT ${COLS} FROM receipts r LEFT JOIN users u ON u.id = r.created_by WHERE r.shop_id = $1 AND r.id = $2`, [shopId, id]);
  return rows[0] ?? null;
}

export async function findReceiptIdByIdempotencyKey(db: Db, shopId: number, key: string): Promise<number | null> {
  const { rows } = await db.query(`SELECT id FROM receipts WHERE shop_id = $1 AND idempotency_key = $2`, [shopId, key]);
  return rows[0]?.id ?? null;
}

export async function getReceipt(shopId: number, id: number) {
  const receipt = await findReceipt(pool, shopId, id);
  if (!receipt) throw notFound('Receipt');
  return receipt;
}

/**
 * A receipt for a ledger entry recorded before receipts existed. Issuing twice returns the same one,
 * so a receipt number is never given out twice for one payment.
 */
export async function receiptForEntry(shopId: number, userId: number, orderId: number, paymentId: number) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT p.id, p.kind, p.amount_paise AS "amountPaise", p.method, p.reference, p.note, p.paid_on AS "paidOn",
         p.receipt_id AS "receiptId", o.order_number AS "orderNumber", o.customer_id AS "customerId"
       FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.shop_id = $1 AND p.order_id = $2 AND p.id = $3 FOR UPDATE OF p`,
      [shopId, orderId, paymentId],
    );
    const p = rows[0];
    if (!p) throw notFound('Payment');
    if (p.receiptId) return p.receiptId as number;
    const { id } = await issueReceipt(c, {
      shopId,
      kind: p.kind,
      date: p.paidOn,
      customerId: p.customerId,
      method: p.method,
      reference: p.reference,
      note: p.note,
      allocations: [{ orderId, orderNumber: p.orderNumber, amountPaise: p.amountPaise }],
      userId,
    });
    const upd = await c.query(`UPDATE payments SET receipt_id = $2 WHERE id = $1 AND receipt_id IS NULL`, [paymentId, id]);
    if (!upd.rowCount) throw new AppError(409, 'CONFLICT', 'This payment already has a receipt');
    return id;
  });
}
