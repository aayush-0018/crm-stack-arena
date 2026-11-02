-- 017_reviews_and_games.sql — after ordering from a table: rate us on Google, then the table game.
-- Additive: nothing existing changes.

-- ---------------------------------------------------------------------------
-- The branch's Google "write a review" link (opens the stars and the text box). NULL = no review step.
-- ---------------------------------------------------------------------------
ALTER TABLE shops ADD COLUMN google_review_url TEXT CHECK (google_review_url ~ '^https://');

-- When this guest was sent to the Google review page. Google can't tell us whether a review was
-- posted, so this is what "reviewed" means here; a customer is asked once.
ALTER TABLE guest_sessions ADD COLUMN review_opened_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Table challenge: one round at a time per branch. Guests join while the lobby is open, everyone
-- gets the same questions (from `seed`) between starts_at and ends_at, and the top score wins.
-- A round that fewer than two tables joined is called off when it would have started.
-- ---------------------------------------------------------------------------
CREATE TABLE game_rounds (
  id           BIGSERIAL   PRIMARY KEY,
  shop_id      BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  seed         INTEGER     NOT NULL,
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  -- Set once results are counted (and the prize given): after ends_at plus a short grace.
  finalized_at TIMESTAMPTZ,
  called_off   BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX game_rounds_shop_idx ON game_rounds (shop_id, ends_at DESC);

CREATE TABLE game_entries (
  id               BIGSERIAL   PRIMARY KEY,
  round_id         BIGINT      NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  guest_session_id BIGINT      NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
  customer_id      BIGINT      NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  table_id         BIGINT      REFERENCES dining_tables(id) ON DELETE SET NULL,
  -- Copied on joining, like orders.table_label.
  table_label      TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  -- NULL until the answers are in. Score = right answers minus wrong ones (never below 0).
  correct          INTEGER,
  wrong            INTEGER,
  score            INTEGER,
  submitted_at     TIMESTAMPTZ,
  -- The winner's prize (percentage off), and when it was first taken off an order.
  prize_pct        INTEGER     NOT NULL DEFAULT 0 CHECK (prize_pct BETWEEN 0 AND 100),
  prize_used_at    TIMESTAMPTZ,
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (round_id, customer_id)
);
CREATE INDEX game_entries_customer_idx ON game_entries (customer_id) WHERE prize_pct > 0;

-- What the prize took off each order (the rest of orders.discount_paise is the first-order discount).
CREATE TABLE game_prizes (
  entry_id     BIGINT      NOT NULL REFERENCES game_entries(id) ON DELETE CASCADE,
  order_id     BIGINT      NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount_paise BIGINT      NOT NULL CHECK (amount_paise >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, order_id)
);
CREATE INDEX game_prizes_order_idx ON game_prizes (order_id);
