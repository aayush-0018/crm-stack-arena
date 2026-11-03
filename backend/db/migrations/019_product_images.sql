-- 019_product_images.sql — a photo for each product, shown in the catalogue and the table menu.
-- Additive: products without one look as before.

-- ---------------------------------------------------------------------------
-- Stored like shop logos: a random key per upload, so the public image URL can be cached forever.
-- Old images stay when a new one is uploaded (cheap, and nothing points at them any more).
-- ---------------------------------------------------------------------------
CREATE TABLE product_images (
  key         TEXT        PRIMARY KEY,
  shop_id     BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id  BIGINT      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  mime        TEXT        NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  data        BYTEA       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_images_product_idx ON product_images (product_id);

-- The image currently shown. NULL = none.
ALTER TABLE products ADD COLUMN image_key TEXT;
