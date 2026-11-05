-- 023_expenses.sql — money the branch spends: rent, salaries, bills, stock purchases and so on.
-- Additive: nothing existing reads this table.
CREATE TABLE expenses (
  id           BIGSERIAL   PRIMARY KEY,
  shop_id      BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  spent_on     DATE        NOT NULL,
  -- Free text so each shop can use its own words; the app suggests common ones.
  category     TEXT        NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 40),
  amount_paise BIGINT      NOT NULL CHECK (amount_paise > 0),
  method       TEXT        NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'upi', 'card', 'bank', 'other')),
  -- Who was paid, or what it was for.
  note         TEXT        CHECK (length(note) <= 200),
  created_by   BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX expenses_shop_date_idx ON expenses (shop_id, spent_on DESC, id DESC);
