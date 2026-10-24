-- 004_last_branch_set_null.sql
-- users.shop_id only means "last opened branch" since 003. It must never take the user
-- down with it: deleting a branch now clears the pointer instead of deleting the user.
-- (Access is in shop_members; login falls back to the user's first remaining branch.)

ALTER TABLE users ALTER COLUMN shop_id DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_shop_id_fkey;
ALTER TABLE users ADD CONSTRAINT users_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL;
