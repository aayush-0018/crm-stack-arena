-- 015_floors_and_guests.sql — several floors per café, verified guests, first-order discount, bills.
-- Additive. Every existing floor plan becomes its branch's "Ground floor" with the same tables.

-- ---------------------------------------------------------------------------
-- Floors: each has its own size and blocks; tables belong to one floor.
-- floor_plans keeps only the lock (its width, height and decor are no longer read).
-- ---------------------------------------------------------------------------
CREATE TABLE floors (
  id         BIGSERIAL   PRIMARY KEY,
  shop_id    BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  position   INTEGER     NOT NULL DEFAULT 0,
  width      INTEGER     NOT NULL DEFAULT 1200 CHECK (width BETWEEN 400 AND 4000),
  height     INTEGER     NOT NULL DEFAULT 800 CHECK (height BETWEEN 300 AND 4000),
  decor      JSONB       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(decor) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX floors_shop_name_uq ON floors (shop_id, lower(name));
CREATE INDEX floors_shop_idx ON floors (shop_id, position);

INSERT INTO floors (shop_id, name, position, width, height, decor)
SELECT shop_id, 'Ground floor', 0, width, height, decor FROM floor_plans;

ALTER TABLE dining_tables ADD COLUMN floor_id BIGINT REFERENCES floors(id) ON DELETE SET NULL;
UPDATE dining_tables t SET floor_id = f.id FROM floors f WHERE f.shop_id = t.shop_id;
CREATE INDEX dining_tables_floor_idx ON dining_tables (floor_id) WHERE floor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Guests verify their email with a one-time code before they see the menu.
-- Only SHA-256 hashes of codes and session tokens are stored.
-- ---------------------------------------------------------------------------
CREATE TABLE guest_otps (
  id         BIGSERIAL   PRIMARY KEY,
  shop_id    BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- Random id handed to the browser; the code is checked together with it.
  challenge  TEXT        NOT NULL UNIQUE,
  name       TEXT        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  phone      TEXT        NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),
  email      TEXT        NOT NULL,
  code_hash  TEXT        NOT NULL,
  attempts   INTEGER     NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guest_otps_email_idx ON guest_otps (shop_id, lower(email), created_at DESC);

CREATE TABLE guest_sessions (
  id                  BIGSERIAL   PRIMARY KEY,
  shop_id             BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  -- The shop's customer record for this guest (found by phone, or created on verification).
  customer_id         BIGINT      NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  token_hash          TEXT        NOT NULL UNIQUE,
  name                TEXT        NOT NULL,
  phone               TEXT        NOT NULL,
  email               TEXT        NOT NULL,
  -- Percentage off the first order, decided when the email was verified (0 = not eligible).
  first_order_pct     INTEGER     NOT NULL DEFAULT 0 CHECK (first_order_pct BETWEEN 0 AND 100),
  discount_claimed_at TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX guest_sessions_customer_idx ON guest_sessions (customer_id);

ALTER TABLE orders ADD COLUMN guest_session_id BIGINT REFERENCES guest_sessions(id) ON DELETE SET NULL;
-- When the bill was emailed (set once; a failed send clears it so it can be retried).
ALTER TABLE orders ADD COLUMN bill_sent_at TIMESTAMPTZ;
