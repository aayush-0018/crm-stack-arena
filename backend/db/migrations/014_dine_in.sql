-- 014_dine_in.sql — café / restaurant tables, QR ordering and the kitchen screen.
-- A branch draws its floor plan (tables plus walls, counters and other blocks) and locks it. Every
-- table has a QR code; guests scan it, order from the product list and the order goes to the
-- kitchen screen. Table orders are ordinary walk-in orders, so stock, payments, receipts, invoices
-- and reports all work as before.
-- Additive only: existing orders get source 'staff' and no table or kitchen status.

-- One per branch. Decorative blocks (walls, counter, kitchen, door, plants, text) have no identity
-- of their own, so they are kept as JSON. Tables are rows: orders and QR codes point at them.
CREATE TABLE floor_plans (
  shop_id    BIGINT      PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  width      INTEGER     NOT NULL DEFAULT 1200 CHECK (width BETWEEN 400 AND 4000),
  height     INTEGER     NOT NULL DEFAULT 800 CHECK (height BETWEEN 300 AND 4000),
  decor      JSONB       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(decor) = 'array'),
  locked     BOOLEAN     NOT NULL DEFAULT false,
  updated_by BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dining_tables (
  id         BIGSERIAL   PRIMARY KEY,
  shop_id    BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  label      TEXT        NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 20),
  seats      INTEGER     NOT NULL DEFAULT 4 CHECK (seats BETWEEN 1 AND 30),
  shape      TEXT        NOT NULL DEFAULT 'square' CHECK (shape IN ('square', 'round', 'rect')),
  x          INTEGER     NOT NULL CHECK (x >= 0),
  y          INTEGER     NOT NULL CHECK (y >= 0),
  w          INTEGER     NOT NULL CHECK (w BETWEEN 20 AND 1000),
  h          INTEGER     NOT NULL CHECK (h BETWEEN 20 AND 1000),
  rotation   INTEGER     NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
  -- Printed on the table's QR code. Stays the same when the table is moved or renamed;
  -- a new one is issued only when asked (e.g. a printed code was copied).
  qr_token   TEXT        NOT NULL UNIQUE CHECK (qr_token ~ '^[A-Za-z0-9_-]{20,64}$'),
  -- Removed tables are kept (their orders point at them) but their QR stops working.
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dining_tables_label_uq ON dining_tables (shop_id, lower(label)) WHERE active;
CREATE INDEX dining_tables_shop_idx ON dining_tables (shop_id, active);

-- staff = entered in the app; table = placed by a guest from a table's QR code.
ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff', 'table'));
ALTER TABLE orders ADD COLUMN table_id BIGINT REFERENCES dining_tables(id) ON DELETE SET NULL;
-- Copied when the order is placed, so renaming or removing a table never changes past orders.
ALTER TABLE orders ADD COLUMN table_label TEXT;
ALTER TABLE orders ADD COLUMN guest_name TEXT CHECK (length(guest_name) <= 60);
-- NULL = not a kitchen order. new -> preparing -> ready -> served.
ALTER TABLE orders ADD COLUMN kitchen_status TEXT CHECK (kitchen_status IN ('new', 'preparing', 'ready', 'served'));
ALTER TABLE orders ADD COLUMN kitchen_updated_at TIMESTAMPTZ;
-- Lets the guest who placed the order follow its progress, and nothing else.
ALTER TABLE orders ADD COLUMN guest_token TEXT UNIQUE CHECK (guest_token ~ '^[A-Za-z0-9_-]{20,64}$');

CREATE INDEX orders_kitchen_idx ON orders (shop_id, created_at) WHERE kitchen_status IS NOT NULL;
CREATE INDEX orders_table_idx ON orders (table_id, created_at DESC) WHERE table_id IS NOT NULL;
