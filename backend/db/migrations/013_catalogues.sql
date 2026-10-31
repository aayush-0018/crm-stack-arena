-- 013_catalogues.sql — a shareable product catalogue per branch.
-- The catalogue is live: its link always shows the branch's current active products and prices.
-- Only the look and the options are stored here. Anyone holding the random token can view it
-- (no login), and it never shows cost prices or stock quantities.
-- Additive only.

CREATE TABLE catalogues (
  id                BIGSERIAL   PRIMARY KEY,
  shop_id           BIGINT      NOT NULL UNIQUE REFERENCES shops(id) ON DELETE CASCADE,
  -- NULL = link turned off. A new token is issued when it is turned on again or reset.
  token             TEXT        UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  -- More designs will be added; each is a key the public page knows how to draw.
  template          TEXT        NOT NULL DEFAULT 'classic' CHECK (template IN ('classic')),
  title             TEXT        CHECK (length(title) <= 80),
  tagline           TEXT        CHECK (length(tagline) <= 160),
  show_prices       BOOLEAN     NOT NULL DEFAULT true,
  hide_out_of_stock BOOLEAN     NOT NULL DEFAULT true,
  show_branches     BOOLEAN     NOT NULL DEFAULT true,
  created_by        BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
