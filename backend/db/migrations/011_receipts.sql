-- 011_receipts.sql — numbered payment and refund receipts (approved 31 Oct 2026).
-- A receipt is one money movement as the customer sees it: one collection (which may be split across
-- several orders when settling dues) or one refund. Its payments rows point at it.
-- Numbers are per branch and never reused: RCPT-[code-]YYYY-NNNNNN for payments, RFND-… for refunds.
-- Shop, customer and the allocation lines are copied when it's issued, so a reprint never changes.
-- Additive only: existing payments keep working and simply have no receipt until one is issued for them.

ALTER TABLE shop_counters
  ADD COLUMN next_receipt_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_receipt_seq > 0),
  ADD COLUMN next_refund_seq  INTEGER NOT NULL DEFAULT 1 CHECK (next_refund_seq > 0);

CREATE TABLE receipts (
  id                BIGSERIAL   PRIMARY KEY,
  shop_id           BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  kind              TEXT        NOT NULL CHECK (kind IN ('payment', 'refund')),
  receipt_number    TEXT        NOT NULL,
  receipt_date      DATE        NOT NULL,
  -- NULL for walk-in sales (or once the customer is deleted; the snapshot keeps the name).
  customer_id       BIGINT      REFERENCES customers(id) ON DELETE SET NULL,
  method            TEXT        NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'bank', 'other', 'unrecorded')),
  reference         TEXT,
  note              TEXT,
  amount_paise      BIGINT      NOT NULL CHECK (amount_paise > 0),
  shop_snapshot     JSONB       NOT NULL,
  customer_snapshot JSONB       NOT NULL,
  -- [{ orderId, orderNumber, amountPaise }]: how the money was split across orders.
  allocations       JSONB       NOT NULL,
  idempotency_key   UUID,
  created_by        BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX receipts_shop_number_uq ON receipts (shop_id, receipt_number);
CREATE UNIQUE INDEX receipts_shop_idem_uq   ON receipts (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX receipts_shop_date_idx ON receipts (shop_id, receipt_date DESC, id DESC);
CREATE INDEX receipts_customer_idx  ON receipts (customer_id) WHERE customer_id IS NOT NULL;

-- RESTRICT: a receipt can't disappear while ledger entries point at it.
ALTER TABLE payments ADD COLUMN receipt_id BIGINT REFERENCES receipts(id) ON DELETE RESTRICT;
CREATE INDEX payments_receipt_idx ON payments (receipt_id) WHERE receipt_id IS NOT NULL;
