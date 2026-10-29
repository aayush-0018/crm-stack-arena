-- 006_complete_settled_orders.sql — data fix, no schema change.
-- Orders that are fully paid and already invoiced were left "open". From now on the app
-- completes them automatically; this moves the existing ones across once.
UPDATE orders o
SET status = 'completed', updated_at = now()
WHERE o.status = 'open'
  AND o.payment_status = 'paid'
  AND EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.status = 'issued');
