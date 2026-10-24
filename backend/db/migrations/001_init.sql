-- 001_init.sql — initial CRM schema (shops, users, customers, orders, invoices)
-- PostgreSQL 16, local only. Money is integer paise. See backend/DB_SCHEMA.md.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE order_status   AS ENUM ('open', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('unpaid', 'partial', 'paid');
CREATE TYPE invoice_status AS ENUM ('issued', 'superseded', 'void');

-- ---------------------------------------------------------------------------
-- Shops & users
-- ---------------------------------------------------------------------------
CREATE TABLE shops (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  phone         TEXT,
  email         TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  state         TEXT,
  pincode       TEXT,
  gstin         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  shop_id       BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  role          TEXT        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_shop_idx ON users (shop_id);

-- Per-shop sequential numbering for orders and invoices.
CREATE TABLE shop_counters (
  shop_id          BIGINT  PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  next_order_seq   INTEGER NOT NULL DEFAULT 1 CHECK (next_order_seq > 0),
  next_invoice_seq INTEGER NOT NULL DEFAULT 1 CHECK (next_invoice_seq > 0)
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id         BIGSERIAL PRIMARY KEY,
  shop_id    BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  phone      TEXT        NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),
  email      TEXT,
  address    TEXT,
  notes      TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active customer per phone per shop (soft-deleted rows don't block reuse).
CREATE UNIQUE INDEX customers_shop_phone_uq ON customers (shop_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX customers_shop_name_idx    ON customers (shop_id, lower(name));
CREATE INDEX customers_shop_created_idx ON customers (shop_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  id                BIGSERIAL PRIMARY KEY,
  shop_id           BIGINT         NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id       BIGINT         NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_number      TEXT           NOT NULL,
  status            order_status   NOT NULL DEFAULT 'open',
  payment_status    payment_status NOT NULL DEFAULT 'unpaid',
  subtotal_paise    BIGINT         NOT NULL CHECK (subtotal_paise >= 0),
  discount_paise    BIGINT         NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  total_paise       BIGINT         NOT NULL CHECK (total_paise >= 0),
  amount_paid_paise BIGINT         NOT NULL DEFAULT 0 CHECK (amount_paid_paise >= 0),
  notes             TEXT,
  order_date        DATE           NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date),
  idempotency_key   UUID,
  version           INTEGER        NOT NULL DEFAULT 1,
  created_by        BIGINT         REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT orders_total_ck   CHECK (total_paise = subtotal_paise - discount_paise),
  CONSTRAINT orders_paid_ck    CHECK (amount_paid_paise <= total_paise),
  CONSTRAINT orders_payment_ck CHECK (
       (payment_status = 'unpaid'  AND amount_paid_paise = 0)
    OR (payment_status = 'partial' AND amount_paid_paise > 0 AND amount_paid_paise < total_paise)
    OR (payment_status = 'paid'    AND amount_paid_paise > 0 AND amount_paid_paise = total_paise)
  )
);

CREATE UNIQUE INDEX orders_shop_number_uq ON orders (shop_id, order_number);
CREATE UNIQUE INDEX orders_shop_idem_uq   ON orders (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX orders_shop_date_idx     ON orders (shop_id, order_date DESC, id DESC);
CREATE INDEX orders_shop_customer_idx ON orders (shop_id, customer_id, created_at DESC);
CREATE INDEX orders_shop_status_idx   ON orders (shop_id, status, payment_status);

CREATE TABLE order_items (
  id               BIGSERIAL PRIMARY KEY,
  order_id         BIGINT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position         INTEGER       NOT NULL CHECK (position > 0),
  item_name        TEXT          NOT NULL CHECK (length(trim(item_name)) > 0),
  quantity         NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit             TEXT,
  unit_price_paise BIGINT        NOT NULL CHECK (unit_price_paise >= 0),
  line_total_paise BIGINT        NOT NULL CHECK (line_total_paise >= 0),
  UNIQUE (order_id, position)
);

-- ---------------------------------------------------------------------------
-- Invoices (immutable snapshots of an order at issue time)
-- ---------------------------------------------------------------------------
CREATE TABLE invoices (
  id                BIGSERIAL PRIMARY KEY,
  shop_id           BIGINT         NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id          BIGINT         NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  invoice_number    TEXT           NOT NULL,
  revision          INTEGER        NOT NULL DEFAULT 1 CHECK (revision > 0),
  status            invoice_status NOT NULL DEFAULT 'issued',
  order_version     INTEGER        NOT NULL,
  issued_at         TIMESTAMPTZ    NOT NULL DEFAULT now(),
  invoice_date      DATE           NOT NULL,

  shop_snapshot     JSONB          NOT NULL,
  customer_snapshot JSONB          NOT NULL,
  order_snapshot    JSONB          NOT NULL,
  items_snapshot    JSONB          NOT NULL,
  subtotal_paise    BIGINT         NOT NULL,
  discount_paise    BIGINT         NOT NULL,
  total_paise       BIGINT         NOT NULL,
  amount_paid_paise BIGINT         NOT NULL,
  payment_status    payment_status NOT NULL,

  created_by        BIGINT         REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),

  UNIQUE (shop_id, invoice_number, revision)
);

-- At most one live invoice per order: blocks duplicate invoices.
CREATE UNIQUE INDEX invoices_one_issued_per_order ON invoices (order_id) WHERE status = 'issued';
CREATE INDEX invoices_shop_issued_idx ON invoices (shop_id, issued_at DESC);
CREATE INDEX invoices_order_idx       ON invoices (order_id, revision DESC);
