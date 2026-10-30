-- 012_returns.sql — item returns with an internal return adjustment document (approved 31 Oct 2026).
-- A return records which sold items came back (saleable or damaged), what they were worth, and any
-- refund. It never edits the order's items or any invoice snapshot. Instead the order's total is
-- reduced by orders.returned_paise, so its balance, payment status and reports follow automatically.
-- This is an internal document, not a GST credit note.
-- Additive: every existing order has returned_paise = 0, so its total is unchanged.

ALTER TABLE orders ADD COLUMN returned_paise BIGINT NOT NULL DEFAULT 0 CHECK (returned_paise >= 0);
ALTER TABLE orders DROP CONSTRAINT orders_total_ck;
ALTER TABLE orders ADD CONSTRAINT orders_total_ck CHECK (total_paise = subtotal_paise - discount_paise - returned_paise);

ALTER TABLE shop_counters ADD COLUMN next_return_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_return_seq > 0);

CREATE TABLE order_returns (
  id              BIGSERIAL   PRIMARY KEY,
  shop_id         BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- RESTRICT: an order with returns can't be deleted (its money and stock history depend on it).
  order_id        BIGINT      NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  return_number   TEXT        NOT NULL,
  return_date     DATE        NOT NULL,
  reason          TEXT,
  -- What the order's total went down by (items' value after their share of the order discount).
  value_paise     BIGINT      NOT NULL CHECK (value_paise >= 0),
  -- Money handed back because more had been paid than the order now costs.
  refund_paise    BIGINT      NOT NULL DEFAULT 0 CHECK (refund_paise >= 0),
  idempotency_key UUID,
  created_by      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX order_returns_shop_number_uq ON order_returns (shop_id, return_number);
CREATE UNIQUE INDEX order_returns_shop_idem_uq   ON order_returns (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX order_returns_order_idx ON order_returns (order_id, id);
CREATE INDEX order_returns_shop_date_idx ON order_returns (shop_id, return_date DESC);

CREATE TABLE order_return_items (
  id               BIGSERIAL     PRIMARY KEY,
  return_id        BIGINT        NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  -- The sold line (position on the order); name, price and product are copied for the document.
  position         INTEGER       NOT NULL CHECK (position > 0),
  item_name        TEXT          NOT NULL,
  product_id       BIGINT        REFERENCES products(id) ON DELETE SET NULL,
  quantity         NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit_price_paise BIGINT        NOT NULL CHECK (unit_price_paise >= 0),
  -- quantity × unit price (before the discount share), and the value after it.
  gross_paise      BIGINT        NOT NULL CHECK (gross_paise >= 0),
  value_paise      BIGINT        NOT NULL CHECK (value_paise >= 0),
  -- saleable: back on the shelf (stock goes up). damaged: kept out of sellable stock.
  condition        TEXT          NOT NULL CHECK (condition IN ('saleable', 'damaged'))
);
CREATE INDEX order_return_items_return_idx ON order_return_items (return_id);

-- Saleable returned items go back into stock as a 'return' movement linked to the order.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('opening', 'receipt', 'adjustment', 'stocktake', 'write_off', 'sale', 'sale_reversal', 'return'));

-- Refunds made because of a return point at it.
ALTER TABLE payments ADD COLUMN return_id BIGINT REFERENCES order_returns(id) ON DELETE RESTRICT;
