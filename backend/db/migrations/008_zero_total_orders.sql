-- 008_zero_total_orders.sql — an order with a ₹0 total (free items, 100% discount) is paid.
-- Before this, such orders could only be "unpaid", stayed in "payment pending" for ever and never
-- auto-completed. Approved by the owner on 30 Oct 2026.
--
-- Data repair (reported in CRM_IMPLEMENTATION_LOG.md): ₹0 orders marked unpaid become paid, and the
-- ones that already have an issued invoice are completed, the same rule as 006. Issued invoice
-- snapshots are history and are not changed. The migration runner wraps this file in one
-- transaction, so the old rule is never missing for other sessions.

-- The old rule forbids "paid" with ₹0 paid, so it goes first.
ALTER TABLE orders DROP CONSTRAINT orders_payment_ck;

UPDATE orders SET payment_status = 'paid', updated_at = now()
WHERE total_paise = 0 AND payment_status <> 'paid';

UPDATE orders o SET status = 'completed', updated_at = now()
WHERE o.status = 'open' AND o.total_paise = 0
  AND EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'issued');

-- Same rule as before, except "paid" now means paid = total (which allows ₹0 of ₹0),
-- and "unpaid" needs something to be owed.
ALTER TABLE orders ADD CONSTRAINT orders_payment_ck CHECK (
     (payment_status = 'unpaid'  AND amount_paid_paise = 0 AND total_paise > 0)
  OR (payment_status = 'partial' AND amount_paid_paise > 0 AND amount_paid_paise < total_paise)
  OR (payment_status = 'paid'    AND amount_paid_paise = total_paise)
);
