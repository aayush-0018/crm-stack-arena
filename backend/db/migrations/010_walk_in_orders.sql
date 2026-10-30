-- 010_walk_in_orders.sql — counter sales without a customer (approved 30 Oct 2026).
-- An order with no customer is a walk-in sale. It counts in sales, payments and stock like any
-- order, but never as a customer (active customers, top customers, visit gaps).
-- Additive: every existing order keeps its customer.

ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;
