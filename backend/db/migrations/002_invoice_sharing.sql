-- 002_invoice_sharing.sql — send invoices to customers.
-- Each invoice can get a random share token; anyone holding the link can download that
-- one invoice's PDF without logging in. Every send is logged.

ALTER TABLE invoices ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX invoices_share_token_uq ON invoices (share_token) WHERE share_token IS NOT NULL;

CREATE TABLE invoice_shares (
  id         BIGSERIAL PRIMARY KEY,
  shop_id    BIGINT      NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  invoice_id BIGINT      NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  channel    TEXT        NOT NULL CHECK (channel IN ('whatsapp', 'email', 'share', 'link', 'download')),
  recipient  TEXT,
  shared_by  BIGINT      REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX invoice_shares_invoice_idx ON invoice_shares (invoice_id, created_at DESC);
