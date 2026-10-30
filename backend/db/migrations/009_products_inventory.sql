-- 009_products_inventory.sql — product catalogue and stock ledger (approved 30 Oct 2026).
-- Each branch (shop) has its own products and stock. Stock is never a single editable number:
-- every change is a stock_movements row, and the level is their sum. Quantities are integer
-- milli-units (1.5 kg = 1500), like money in paise, so sums are exact.
-- Additive only: free-text order lines keep working (order_items.product_id is optional).

CREATE TABLE products (
  id              BIGSERIAL   PRIMARY KEY,
  shop_id         BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  sku             TEXT,
  category        TEXT,
  unit            TEXT        NOT NULL DEFAULT 'pcs' CHECK (unit IN ('pcs', 'kg', 'g', 'l', 'ml', 'm', 'box', 'pack', 'dozen', 'pair', 'set')),
  price_paise     BIGINT      NOT NULL CHECK (price_paise >= 0),
  -- For reference only. No profit is calculated from it.
  cost_paise      BIGINT      CHECK (cost_paise >= 0),
  track_stock     BOOLEAN     NOT NULL DEFAULT true,
  low_stock_milli BIGINT      CHECK (low_stock_milli >= 0),
  active          BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Names and SKUs are unique among a branch's active products (archived ones don't block reuse).
CREATE UNIQUE INDEX products_shop_name_uq ON products (shop_id, lower(name)) WHERE active;
CREATE UNIQUE INDEX products_shop_sku_uq  ON products (shop_id, lower(sku)) WHERE active AND sku IS NOT NULL;
CREATE INDEX products_shop_idx ON products (shop_id, active, lower(name));

CREATE TABLE stock_movements (
  id              BIGSERIAL   PRIMARY KEY,
  shop_id         BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id      BIGINT      NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  -- opening / receipt / adjustment / stocktake / write_off: entered on the product.
  -- sale / sale_reversal: posted by orders (create, edit, cancel, reopen, delete).
  kind            TEXT        NOT NULL CHECK (kind IN ('opening', 'receipt', 'adjustment', 'stocktake', 'write_off', 'sale', 'sale_reversal')),
  qty_milli       BIGINT      NOT NULL CHECK (qty_milli <> 0),
  -- Kept when an order is deleted (then NULL); the note still names the order.
  order_id        BIGINT      REFERENCES orders(id) ON DELETE SET NULL,
  note            TEXT,
  idempotency_key UUID,
  created_by      BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stock_movements_idem_uq ON stock_movements (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX stock_movements_product_idx ON stock_movements (product_id, created_at DESC);
CREATE INDEX stock_movements_order_idx ON stock_movements (order_id) WHERE order_id IS NOT NULL;

-- Order lines can point at a product. Name and price stay copied on the line, so editing or
-- archiving a product never changes past orders or invoices.
ALTER TABLE order_items ADD COLUMN product_id BIGINT REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX order_items_product_idx ON order_items (product_id) WHERE product_id IS NOT NULL;

-- Off by default: an order that would take stock below zero is refused with a clear message.
ALTER TABLE shops ADD COLUMN allow_negative_stock BOOLEAN NOT NULL DEFAULT false;
