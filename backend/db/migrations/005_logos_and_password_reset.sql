-- 005_logos_and_password_reset.sql

-- ---------------------------------------------------------------------------
-- Shop logos
-- Stored in Postgres, not on disk: Render's free disk is wiped on every deploy.
-- Each upload gets a new random key and old rows are kept, so an invoice issued
-- with an earlier logo keeps showing exactly that logo.
-- ---------------------------------------------------------------------------
CREATE TABLE shop_logos (
  key        TEXT        PRIMARY KEY,
  shop_id    BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  mime       TEXT        NOT NULL CHECK (mime = 'image/png'),
  data       BYTEA       NOT NULL CHECK (octet_length(data) <= 400000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shop_logos_shop_idx ON shop_logos (shop_id);

-- The logo currently in use. No FK on purpose: a branch can reuse another branch's logo key.
ALTER TABLE shops ADD COLUMN logo_key TEXT;

-- ---------------------------------------------------------------------------
-- Forgot password
-- Only a SHA-256 hash of the emailed token is stored, so a database leak can't be
-- used to reset anyone's password. Tokens are single-use and short-lived.
-- ---------------------------------------------------------------------------
CREATE TABLE password_resets (
  id           BIGSERIAL   PRIMARY KEY,
  user_id      BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  requested_ip TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

-- Sessions issued before this moment stop working: resetting a password signs out
-- every other device.
ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;
