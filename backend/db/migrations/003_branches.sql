-- 003_branches.sql — one owner, many branches.
-- Each branch is a row in `shops` with its own customers, orders, invoices and numbering.
-- shop_members says which branches a user may open; users.shop_id becomes "last opened branch".

CREATE TABLE shop_members (
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id    BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, shop_id)
);
CREATE INDEX shop_members_shop_idx ON shop_members (shop_id);

-- Every existing user keeps access to the shop they already had.
INSERT INTO shop_members (user_id, shop_id, role, created_at)
SELECT id, shop_id, role, created_at FROM users
ON CONFLICT DO NOTHING;

-- Optional short code printed in new order/invoice numbers, e.g. INV-JPR-2026-000001,
-- so two branches never issue identical numbers. Existing numbers are unchanged.
ALTER TABLE shops ADD COLUMN code TEXT CHECK (code ~ '^[A-Z0-9]{2,6}$');

COMMENT ON COLUMN users.shop_id IS 'Last opened branch. Access is defined by shop_members.';
