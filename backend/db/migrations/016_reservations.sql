-- 016_reservations.sql — table bookings, taken by staff or online through the branch's booking link.
-- Additive: nothing existing changes.

-- ---------------------------------------------------------------------------
-- One row per branch: opening hours and booking rules. booking_token NULL = online booking off.
-- ---------------------------------------------------------------------------
CREATE TABLE reservation_settings (
  shop_id            BIGINT      PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  booking_token      TEXT        UNIQUE,
  opens_at           TIME        NOT NULL DEFAULT '11:00',
  closes_at          TIME        NOT NULL DEFAULT '23:00',
  -- Days with no bookings: 0 = Sunday … 6 = Saturday.
  closed_days        SMALLINT[]  NOT NULL DEFAULT '{}',
  slot_minutes       INTEGER     NOT NULL DEFAULT 30 CHECK (slot_minutes IN (15, 30, 60)),
  -- How long a table is held for one booking.
  duration_minutes   INTEGER     NOT NULL DEFAULT 90 CHECK (duration_minutes BETWEEN 30 AND 360),
  -- Largest party that can book online (bigger groups are asked to call).
  max_party          INTEGER     NOT NULL DEFAULT 8 CHECK (max_party BETWEEN 1 AND 50),
  days_ahead         INTEGER     NOT NULL DEFAULT 30 CHECK (days_ahead BETWEEN 1 AND 180),
  min_notice_minutes INTEGER     NOT NULL DEFAULT 60 CHECK (min_notice_minutes BETWEEN 0 AND 2880),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);

-- ---------------------------------------------------------------------------
-- Bookings. A table is held from starts_at to ends_at while the booking is 'booked' or 'seated';
-- the server never lets two such bookings share a table at the same time.
-- ---------------------------------------------------------------------------
CREATE TABLE reservations (
  id           BIGSERIAL   PRIMARY KEY,
  shop_id      BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id  BIGINT      REFERENCES customers(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  phone        TEXT        NOT NULL CHECK (phone ~ '^[6-9][0-9]{9}$'),
  email        TEXT,
  party_size   INTEGER     NOT NULL CHECK (party_size BETWEEN 1 AND 100),
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  -- Empty = no table chosen yet.
  table_ids    BIGINT[]    NOT NULL DEFAULT '{}',
  status       TEXT        NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'seated', 'finished', 'cancelled', 'no_show')),
  source       TEXT        NOT NULL CHECK (source IN ('staff', 'online')),
  notes        TEXT,
  -- The guest's link to see or cancel their booking.
  manage_token TEXT        NOT NULL UNIQUE,
  created_by   BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  seated_at    TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX reservations_shop_time_idx ON reservations (shop_id, starts_at);
CREATE INDEX reservations_customer_idx ON reservations (customer_id) WHERE customer_id IS NOT NULL;
