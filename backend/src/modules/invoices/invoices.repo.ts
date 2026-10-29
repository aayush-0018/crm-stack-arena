import { Db } from '../../db/pool';
import { escapeLike } from '../../lib/validation';
import { OrderStatus, PaymentStatus } from '../orders/orders.schemas';
import { ComputedLine } from '../orders/totals';

export type InvoiceStatus = 'issued' | 'superseded' | 'void';

export interface InvoiceSummary {
  id: number;
  orderId: number;
  invoiceNumber: string;
  revision: number;
  status: InvoiceStatus;
  orderVersion: number;
  issuedAt: string;
  invoiceDate: string;
  totalPaise: number;
}

export interface Invoice extends InvoiceSummary {
  shopSnapshot: Record<string, string | null>;
  customerSnapshot: { name: string; phone: string; email: string | null; address: string | null };
  orderSnapshot: { orderNumber: string; orderDate: string; status: OrderStatus; notes: string | null };
  itemsSnapshot: ComputedLine[];
  subtotalPaise: number;
  discountPaise: number;
  amountPaidPaise: number;
  paymentStatus: PaymentStatus;
  shareToken: string | null;
}

export type ShareChannel = 'whatsapp' | 'email' | 'share' | 'link' | 'download';

export interface InvoiceShare {
  channel: ShareChannel;
  recipient: string | null;
  createdAt: string;
}

const SUMMARY_COLS = `i.id, i.order_id AS "orderId", i.invoice_number AS "invoiceNumber", i.revision, i.status,
  i.order_version AS "orderVersion", i.issued_at AS "issuedAt", i.invoice_date AS "invoiceDate",
  i.total_paise AS "totalPaise"`;

const FULL_COLS = `${SUMMARY_COLS}, i.shop_snapshot AS "shopSnapshot", i.customer_snapshot AS "customerSnapshot",
  i.order_snapshot AS "orderSnapshot", i.items_snapshot AS "itemsSnapshot", i.subtotal_paise AS "subtotalPaise",
  i.discount_paise AS "discountPaise", i.amount_paid_paise AS "amountPaidPaise", i.payment_status AS "paymentStatus",
  i.share_token AS "shareToken"`;

export async function latestInvoiceForOrder(db: Db, orderId: number): Promise<InvoiceSummary | null> {
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLS} FROM invoices i WHERE i.order_id = $1 ORDER BY i.revision DESC LIMIT 1`,
    [orderId],
  );
  return rows[0] ?? null;
}

export async function listInvoicesForOrder(db: Db, shopId: number, orderId: number): Promise<InvoiceSummary[]> {
  const { rows } = await db.query(
    `SELECT ${SUMMARY_COLS} FROM invoices i WHERE i.shop_id = $1 AND i.order_id = $2 ORDER BY i.revision DESC`,
    [shopId, orderId],
  );
  return rows;
}

export async function findInvoice(db: Db, shopId: number, id: number): Promise<Invoice | null> {
  const { rows } = await db.query(`SELECT ${FULL_COLS} FROM invoices i WHERE i.shop_id = $1 AND i.id = $2`, [
    shopId,
    id,
  ]);
  return rows[0] ?? null;
}

export async function setInvoiceStatus(db: Db, id: number, status: InvoiceStatus) {
  await db.query(`UPDATE invoices SET status = $2 WHERE id = $1`, [id, status]);
}

export async function voidIssuedInvoice(db: Db, orderId: number) {
  await db.query(`UPDATE invoices SET status = 'void' WHERE order_id = $1 AND status = 'issued'`, [orderId]);
}

export async function insertInvoice(
  db: Db,
  inv: Omit<Invoice, 'id' | 'status' | 'issuedAt' | 'shareToken'> & { shopId: number; createdBy: number },
): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO invoices (shop_id, order_id, invoice_number, revision, order_version, invoice_date,
       shop_snapshot, customer_snapshot, order_snapshot, items_snapshot,
       subtotal_paise, discount_paise, total_paise, amount_paid_paise, payment_status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      inv.shopId, inv.orderId, inv.invoiceNumber, inv.revision, inv.orderVersion, inv.invoiceDate,
      JSON.stringify(inv.shopSnapshot), JSON.stringify(inv.customerSnapshot),
      JSON.stringify(inv.orderSnapshot), JSON.stringify(inv.itemsSnapshot),
      inv.subtotalPaise, inv.discountPaise, inv.totalPaise, inv.amountPaidPaise, inv.paymentStatus, inv.createdBy,
    ],
  );
  return rows[0].id;
}

const TODAY = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;

export async function listInvoices(
  db: Db,
  shopId: number,
  q: { search?: string; status?: InvoiceStatus | 'needs_reissue'; from?: string; to?: string; page: number; pageSize: number },
) {
  const params: unknown[] = [shopId];
  const where = ['i.shop_id = $1'];
  if (q.status === 'needs_reissue') {
    where.push(`i.status = 'issued' AND i.order_version <> o.version`);
  } else if (q.status) {
    params.push(q.status);
    where.push(`i.status = $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    where.push(`i.invoice_date >= $${params.length}`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`i.invoice_date <= $${params.length}`);
  }
  if (q.search) {
    params.push(`%${escapeLike(q.search)}%`);
    const n = params.length;
    where.push(`(i.invoice_number ILIKE $${n} OR i.order_snapshot->>'orderNumber' ILIKE $${n}
      OR i.customer_snapshot->>'name' ILIKE $${n} OR i.customer_snapshot->>'phone' LIKE $${n})`);
  }
  const from = `FROM invoices i JOIN orders o ON o.id = i.order_id WHERE ${where.join(' AND ')}`;
  const count = await db.query(`SELECT count(*)::int AS n ${from}`, params);
  params.push(q.pageSize, (q.page - 1) * q.pageSize);
  const { rows } = await db.query(
    `SELECT i.id, i.order_id AS "orderId", o.customer_id AS "customerId", i.invoice_number AS "invoiceNumber", i.revision, i.status,
       i.invoice_date AS "invoiceDate", i.issued_at AS "issuedAt", i.total_paise AS "totalPaise",
       o.total_paise - o.amount_paid_paise AS "orderDuePaise", o.payment_status AS "orderPaymentStatus",
       i.customer_snapshot->>'name' AS "customerName", i.customer_snapshot->>'phone' AS "customerPhone",
       i.order_snapshot->>'orderNumber' AS "orderNumber",
       (i.status = 'issued' AND i.order_version <> o.version) AS outdated
     ${from}
     ORDER BY i.issued_at DESC, i.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: count.rows[0].n as number };
}

/** Numbers for the invoices stat strip. Due amounts come from the live order, not the snapshot. */
export async function invoicesSummary(db: Db, shopId: number) {
  const [totals, daily] = await Promise.all([
    db.query(
      `SELECT
         count(*) FILTER (WHERE i.status = 'issued' AND i.invoice_date > ${TODAY} - 30)::int AS "issued30",
         COALESCE(sum(i.total_paise) FILTER (WHERE i.status = 'issued' AND i.invoice_date > ${TODAY} - 30), 0)::bigint AS "invoiced30Paise",
         COALESCE(sum(o.total_paise - o.amount_paid_paise) FILTER (WHERE i.status = 'issued'), 0)::bigint AS "duePaise",
         COALESCE(sum(o.total_paise) FILTER (WHERE i.status = 'issued'), 0)::bigint AS "issuedTotalPaise",
         count(*) FILTER (WHERE i.status = 'issued' AND i.order_version <> o.version)::int AS outdated,
         count(*) FILTER (WHERE i.status IN ('superseded', 'void'))::int AS replaced,
         count(*)::int AS total
       FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.shop_id = $1`,
      [shopId],
    ),
    db.query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS date,
         COALESCE((SELECT sum(total_paise) FROM invoices
           WHERE shop_id = $1 AND status = 'issued' AND invoice_date = d), 0)::bigint AS "amountPaise",
         (SELECT count(*) FROM invoices
           WHERE shop_id = $1 AND status = 'issued' AND invoice_date = d)::int AS count
       FROM generate_series(${TODAY} - 29, ${TODAY}, interval '1 day') AS d ORDER BY d`,
      [shopId],
    ),
  ]);
  return { ...totals.rows[0], daily: daily.rows };
}

/** Returns the invoice's share token, creating one on first use. */
export async function ensureShareToken(db: Db, shopId: number, id: number, fresh: string): Promise<string | null> {
  const { rows } = await db.query(
    `UPDATE invoices SET share_token = COALESCE(share_token, $3)
     WHERE shop_id = $1 AND id = $2 RETURNING share_token AS "shareToken"`,
    [shopId, id, fresh],
  );
  return rows[0]?.shareToken ?? null;
}

/** Public lookup: the token itself is the authorisation, so there is no shop scope. */
export async function findInvoiceByShareToken(db: Db, token: string): Promise<Invoice | null> {
  const { rows } = await db.query(`SELECT ${FULL_COLS} FROM invoices i WHERE i.share_token = $1`, [token]);
  return rows[0] ?? null;
}

export async function logShare(
  db: Db,
  s: { shopId: number; invoiceId: number; channel: ShareChannel; recipient: string | null; userId: number },
) {
  await db.query(
    `INSERT INTO invoice_shares (shop_id, invoice_id, channel, recipient, shared_by) VALUES ($1, $2, $3, $4, $5)`,
    [s.shopId, s.invoiceId, s.channel, s.recipient, s.userId],
  );
}

export async function listShares(db: Db, invoiceId: number): Promise<InvoiceShare[]> {
  const { rows } = await db.query(
    `SELECT channel, recipient, created_at AS "createdAt" FROM invoice_shares
     WHERE invoice_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [invoiceId],
  );
  return rows;
}
