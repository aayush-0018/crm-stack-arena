-- 007_payments.sql — payment ledger.
-- Each payment or refund is its own row (amount, date, method, reference, who). A mistaken entry
-- is voided, never deleted, so the history stays complete.
-- orders.amount_paid_paise stays as the running net total (payments minus refunds, voided rows
-- ignored); the API recalculates it from this table in the same transaction as every change.
-- Additive only: no existing column or value changes.

CREATE TABLE payments (
  id              BIGSERIAL   PRIMARY KEY,
  shop_id         BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id        BIGINT      NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind            TEXT        NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'refund')),
  amount_paise    BIGINT      NOT NULL CHECK (amount_paise > 0),
  -- 'unrecorded' = entered before payment history existed, or the method wasn't given.
  method          TEXT        NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'bank', 'other', 'unrecorded')),
  reference       TEXT,
  note            TEXT,
  paid_on         DATE        NOT NULL,
  idempotency_key UUID,
  created_by      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at       TIMESTAMPTZ,
  voided_by       BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  void_reason     TEXT
);

CREATE UNIQUE INDEX payments_shop_idem_uq ON payments (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX payments_order_idx ON payments (order_id, created_at);
CREATE INDEX payments_shop_paid_on_idx ON payments (shop_id, paid_on) WHERE voided_at IS NULL;

-- Opening entries: every order that already has money recorded gets one payment for exactly that
-- amount, dated to the order date. Afterwards the ledger and amount_paid_paise agree for every order.
INSERT INTO payments (shop_id, order_id, kind, amount_paise, method, paid_on, note, created_by, created_at)
SELECT shop_id, id, 'payment', amount_paid_paise, 'unrecorded', order_date,
       'Recorded before payment history was kept', created_by, created_at
FROM orders
WHERE amount_paid_paise > 0;
