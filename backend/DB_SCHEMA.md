# Database Schema Plan

Derived from [../plan.md](../plan.md). Companion docs: [TECH_PLAN.md](TECH_PLAN.md) (backend), [../frontend/TECH_PLAN.md](../frontend/TECH_PLAN.md).

## Engine & Ground Rules

- **PostgreSQL 16, running locally only** (`localhost:5432`). No hosted/remote databases.
- **No ORM.** Schema lives in plain `.sql` migration files under `backend/db/migrations/`, applied by a small script (see backend plan).
- **Money is stored as integer paise** (`BIGINT`). ₹125.50 → `12550`. Never floats.
- **Quantity is `NUMERIC(10,3)`** so loose goods (1.250 kg) work. Totals are computed on the server.
- **Every business table carries `shop_id`.** Every query filters by the `shop_id` taken from the JWT — never from the request body.
- **Timestamps are `TIMESTAMPTZ`**, stored in UTC, displayed in `Asia/Kolkata`. Kept reliable for future V2 analytics.
- Primary keys: `BIGSERIAL` internal ids. Human-facing numbers (order/invoice numbers) are separate columns.

## Entity Overview

```
shops 1 ──< users
shops 1 ──< customers 1 ──< orders 1 ──< order_items
shops 1 ──< orders    1 ──< invoices (revisions; one 'issued' at a time)
shops 1 ──1 shop_counters   (per-shop order/invoice numbering)
```

## Enums

```sql
CREATE TYPE order_status   AS ENUM ('open', 'completed', 'cancelled');
CREATE TYPE payment_status AS ENUM ('unpaid', 'partial', 'paid');
CREATE TYPE invoice_status AS ENUM ('issued', 'superseded', 'void');
```

Order status and payment status are independent columns, as the plan requires.

## Tables

### `shops`

Shop details printed on every invoice.

```sql
CREATE TABLE shops (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  phone         TEXT,
  email         TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city          TEXT,
  state         TEXT,
  pincode       TEXT,
  gstin         TEXT,                 -- optional, printed if present (no tax calc in V1)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `users`

Login accounts. A user belongs to exactly one shop.

```sql
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  shop_id       BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,   -- bcrypt, cost 12
  role          TEXT        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
```

### `shop_counters`

Gap-free, per-shop sequential numbers. Row is locked with `SELECT … FOR UPDATE` inside the same transaction that creates the order/invoice.

```sql
CREATE TABLE shop_counters (
  shop_id             BIGINT  PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  next_order_seq      INTEGER NOT NULL DEFAULT 1,
  next_invoice_seq    INTEGER NOT NULL DEFAULT 1
);
```

Formats: order `ORD-000123`, invoice `INV-2026-000045` (year = issue year).

### `customers`

```sql
CREATE TABLE customers (
  id          BIGSERIAL PRIMARY KEY,
  shop_id     BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL CHECK (length(trim(name)) > 0),
  phone       TEXT        NOT NULL,     -- normalised to 10 digits by the API
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  deleted_at  TIMESTAMPTZ,              -- soft delete
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one active customer per phone per shop
CREATE UNIQUE INDEX customers_shop_phone_uq
  ON customers (shop_id, phone) WHERE deleted_at IS NULL;

-- search by name / phone
CREATE INDEX customers_shop_name_idx ON customers (shop_id, lower(name));
CREATE INDEX customers_shop_created_idx ON customers (shop_id, created_at DESC);
```

**Delete rule:** customers with no orders are hard-deleted. Customers with orders are soft-deleted (`deleted_at` set) so order history and invoices stay intact; the UI warns before this. Soft-deleted customers are hidden from lists and the order customer picker.

### `orders`

```sql
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
  order_date        DATE           NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  idempotency_key   UUID,          -- sent by the client on create; blocks duplicate submits
  version           INTEGER        NOT NULL DEFAULT 1,   -- bumped on every edit
  created_by        BIGINT         REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT orders_total_ck   CHECK (total_paise = subtotal_paise - discount_paise),
  CONSTRAINT orders_paid_ck    CHECK (amount_paid_paise <= total_paise),
  CONSTRAINT orders_payment_ck CHECK (
       (payment_status = 'unpaid'  AND amount_paid_paise = 0)
    OR (payment_status = 'partial' AND amount_paid_paise > 0 AND amount_paid_paise < total_paise)
    OR (payment_status = 'paid'    AND amount_paid_paise = total_paise)
  )
);

CREATE UNIQUE INDEX orders_shop_number_uq ON orders (shop_id, order_number);
CREATE UNIQUE INDEX orders_shop_idem_uq   ON orders (shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX orders_shop_date_idx     ON orders (shop_id, order_date DESC, id DESC);
CREATE INDEX orders_shop_customer_idx ON orders (shop_id, customer_id, created_at DESC);
CREATE INDEX orders_shop_status_idx   ON orders (shop_id, status, payment_status);
```

`payment_status` is derived by the server from `amount_paid_paise` and `total_paise`; the CHECK is a safety net.

### `order_items`

```sql
CREATE TABLE order_items (
  id                BIGSERIAL PRIMARY KEY,
  order_id          BIGINT        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position          INTEGER       NOT NULL,              -- display order, 1..n
  item_name         TEXT          NOT NULL CHECK (length(trim(item_name)) > 0),
  quantity          NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
  unit              TEXT,                                 -- optional: 'pcs', 'kg', 'L'
  unit_price_paise  BIGINT        NOT NULL CHECK (unit_price_paise >= 0),
  line_total_paise  BIGINT        NOT NULL CHECK (line_total_paise >= 0),
  UNIQUE (order_id, position)
);
```

On order edit, items are replaced wholesale (delete + insert) inside one transaction, then totals recomputed.

### `invoices`

An invoice is an **immutable snapshot** of the order at the moment it was issued. Later order edits never change it.

```sql
CREATE TABLE invoices (
  id               BIGSERIAL PRIMARY KEY,
  shop_id          BIGINT         NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id         BIGINT         NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  invoice_number   TEXT           NOT NULL,       -- same number across revisions of one order
  revision         INTEGER        NOT NULL DEFAULT 1,
  status           invoice_status NOT NULL DEFAULT 'issued',
  order_version    INTEGER        NOT NULL,       -- orders.version this snapshot was taken from
  issued_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  invoice_date     DATE           NOT NULL,

  -- snapshot (frozen copies, not live joins)
  shop_snapshot     JSONB  NOT NULL,   -- name, address, phone, gstin
  customer_snapshot JSONB  NOT NULL,   -- name, phone, email, address
  order_snapshot    JSONB  NOT NULL,   -- orderNumber, orderDate, status, notes
  items_snapshot    JSONB  NOT NULL,   -- [{position,item_name,quantity,unit,unit_price_paise,line_total_paise}]
  subtotal_paise    BIGINT NOT NULL,
  discount_paise    BIGINT NOT NULL,
  total_paise       BIGINT NOT NULL,
  amount_paid_paise BIGINT NOT NULL,
  payment_status    payment_status NOT NULL,

  created_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (shop_id, invoice_number, revision)
);

-- at most one live invoice per order -> prevents duplicate invoices
CREATE UNIQUE INDEX invoices_one_issued_per_order
  ON invoices (order_id) WHERE status = 'issued';
CREATE INDEX invoices_shop_issued_idx ON invoices (shop_id, issued_at DESC);
```

### `schema_migrations`

Used by the migration runner.

```sql
CREATE TABLE schema_migrations (
  filename   TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Invoice Revision Rules

| Situation | Behaviour |
|---|---|
| No invoice yet for order | Create revision 1 with a new invoice number. |
| Issued invoice exists, `order_version` = current `orders.version` | Return the existing invoice (idempotent; no duplicate). |
| Issued invoice exists, order changed since | Frontend shows "Order changed since invoice was issued". User clicks **Reissue** → old row set to `superseded`, new row inserted with `revision + 1`, same invoice number. Done in one transaction. |
| Order cancelled | Issued invoice set to `void`. |

The partial unique index guarantees two concurrent "Generate" clicks can never both create an issued invoice.

## Money & Totals Calculation (server side)

```
qty_milli        = round(quantity * 1000)
line_total_paise = round(qty_milli * unit_price_paise / 1000)
subtotal_paise   = Σ line_total_paise
total_paise      = subtotal_paise - discount_paise         (discount ≤ subtotal)
payment_status   = 0 → unpaid | < total → partial | = total → paid
```

Client-sent totals are ignored.

## Migration Files

```
backend/db/migrations/
  001_init.sql                     -- all enums, tables, indexes (schema_migrations is created by the runner)
  002_invoice_sharing.sql          -- invoices.share_token, invoice_shares
  003_branches.sql                 -- shop_members, shops.code
  004_last_branch_set_null.sql     -- users.shop_id -> ON DELETE SET NULL
  005_logos_and_password_reset.sql -- shop_logos, shops.logo_key, password_resets, users.password_changed_at
  006_complete_settled_orders.sql  -- data: fully paid + invoiced open orders -> completed
  007_payments.sql                 -- payments ledger (+ opening entries for existing paid amounts)
  008_zero_total_orders.sql        -- ₹0 orders are 'paid'; orders_payment_ck updated
  009_products_inventory.sql       -- products, stock_movements, order_items.product_id, shops.allow_negative_stock
```

### Added after V1

- **`payments`**: one row per payment or refund (`kind`, `amount_paise` > 0, `method`, `paid_on`, `reference`, `note`, `created_by`, idempotency key). Wrong entries are voided (`voided_at`, `voided_by`, `void_reason`), never deleted. `orders.amount_paid_paise` = payments − refunds over non-voided rows. The API recalculates it in the same transaction as every change, so it's a cached total, not an input. Payments don't bump `orders.version`, so they never mark an invoice "needs reissue".
- **`products`**: per branch. `unit`, `price_paise`, optional `cost_paise` (reference only, no profit calculated), `track_stock`, `low_stock_milli`, `active`. Names and SKUs are unique among active products.
- **`stock_movements`**: the stock ledger. Signed `qty_milli` (1.5 kg = 1500). `kind` is opening / receipt / stocktake / write_off (entered by hand) or sale / sale_reversal (posted by orders). The stock level is the sum, never a stored number. Orders post the difference between what their tracked lines need and what they've already taken, on create, edit, cancel (needs 0), reopen and delete, inside the order's transaction with product rows locked.
- **`order_items.product_id`**: optional link. Name and price stay copied on the line, so product edits never change past orders or invoices.

New changes go in new numbered files (002_..., 003_...); never edit an applied file.

## Explicitly Not in Schema (V1)

Tax/GST calculation, suppliers/purchases, expenses/profit, campaigns, loyalty, analytics tables. (Payments ledger and products/inventory were added later; see above.)
