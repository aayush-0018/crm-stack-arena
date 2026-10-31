import { env } from '../../config/env';
import { pool } from '../../db/pool';
import { sendMail } from '../../lib/mailer';
import { formatRupees as formatPaise } from '../../lib/money';
import { logShare } from '../invoices/invoices.repo';
import { generateInvoice, getInvoice, getShareToken } from '../invoices/invoices.service';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The address customers open: the app's /bill/<token> page, which shows the invoice PDF. */
export const billUrl = (shareToken: string) => `${env.APP_URL.replace(/\/+$/, '')}/bill/${shareToken}`;

/**
 * Issues the invoice for a finished table order and emails the guest a link to it. Runs once per
 * order: bill_sent_at is claimed first, and cleared again if anything fails so it can be retried.
 */
export async function sendBill(shopId: number, orderId: number) {
  const { rows } = await pool.query(
    `UPDATE orders o SET bill_sent_at = now()
     FROM customers c
     WHERE o.shop_id = $1 AND o.id = $2 AND o.source = 'table' AND o.bill_sent_at IS NULL AND c.id = o.customer_id
       AND COALESCE(c.email, (SELECT gs.email FROM guest_sessions gs WHERE gs.id = o.guest_session_id)) IS NOT NULL
     RETURNING COALESCE((SELECT gs.email FROM guest_sessions gs WHERE gs.id = o.guest_session_id), c.email) AS email, c.name`,
    [shopId, orderId],
  );
  if (!rows[0]) return; // not a table order, no email, or already sent
  const { email, name } = rows[0] as { email: string; name: string };
  try {
    const { id } = await generateInvoice(shopId, null, orderId, false);
    const inv = await getInvoice(shopId, id);
    const link = billUrl(await getShareToken(shopId, id));
    const shop = inv.shopSnapshot.name ?? 'the shop';
    const lines = inv.itemsSnapshot.map((it) => `${Number(it.quantity)} × ${it.itemName} — ${formatPaise(it.lineTotalPaise)}`);
    const discount = inv.discountPaise > 0 ? `Discount: −${formatPaise(inv.discountPaise)}` : null;
    await sendMail({
      to: email,
      subject: `Your bill from ${shop} — ${inv.invoiceNumber}`,
      text: [
        `Hi ${name.split(' ')[0]},`,
        '',
        `Thank you for visiting ${shop}. Here is your bill ${inv.invoiceNumber}:`,
        '',
        ...lines,
        ...(discount ? [discount] : []),
        `Total: ${formatPaise(inv.totalPaise)} (paid)`,
        '',
        `Download the bill (PDF): ${link}`,
      ].join('\n'),
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#171717;line-height:1.5;max-width:480px">
  <p>Hi ${escape(name.split(' ')[0])},</p>
  <p>Thank you for visiting <strong>${escape(shop)}</strong>. Here is your bill <strong>${escape(inv.invoiceNumber)}</strong>.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${inv.itemsSnapshot
      .map(
        (it) =>
          `<tr><td style="padding:4px 0">${Number(it.quantity)} × ${escape(it.itemName)}</td><td style="padding:4px 0;text-align:right">${formatPaise(it.lineTotalPaise)}</td></tr>`,
      )
      .join('')}
    ${discount ? `<tr><td style="padding:4px 0;color:#2e7031">Discount</td><td style="padding:4px 0;text-align:right;color:#2e7031">−${formatPaise(inv.discountPaise)}</td></tr>` : ''}
    <tr><td style="padding:8px 0;border-top:1px solid #e5e5e2;font-weight:600">Total (paid)</td><td style="padding:8px 0;border-top:1px solid #e5e5e2;text-align:right;font-weight:600">${formatPaise(inv.totalPaise)}</td></tr>
  </table>
  <p style="margin:24px 0"><a href="${escape(link)}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;display:inline-block">Download bill (PDF)</a></p>
  <p style="color:#8f8f8a;font-size:12px">Sent by ${escape(shop)} using CartWell.</p>
</div>`,
    });
    await logShare(pool, { shopId, invoiceId: id, channel: 'email', recipient: email, userId: null });
  } catch (err) {
    await pool.query(`UPDATE orders SET bill_sent_at = NULL WHERE id = $1`, [orderId]).catch(() => undefined);
    console.error(`Could not send the bill for order ${orderId}:`, err instanceof Error ? err.message : err);
  }
}

const inFlight = new Set<Promise<void>>();

/** Sends the bill in the background, so the kitchen's tap never waits for the email provider. */
export function queueBill(shopId: number, orderId: number) {
  const p = sendBill(shopId, orderId).finally(() => inFlight.delete(p));
  inFlight.add(p);
}

/** Tests wait for background bills before checking results or closing the database. */
export const billsSettled = () => Promise.all([...inFlight]);
