-- 024_privacy.sql — consent and erasure (India's DPDP Act 2023).

-- When the account holder accepted the Terms and Privacy Policy at sign-up. NULL = signed up before
-- this was asked.
ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMPTZ;

-- A deleted customer's personal details are erased. Their past orders stay (tax law requires the
-- shop to keep sales records), shown as "Deleted customer". Invoices already issued keep the copy
-- printed on them.
ALTER TABLE customers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE customers DROP CONSTRAINT customers_phone_check;
ALTER TABLE customers ADD CONSTRAINT customers_phone_check
  CHECK ((phone IS NOT NULL AND phone ~ '^[6-9][0-9]{9}$') OR (phone IS NULL AND deleted_at IS NOT NULL));

-- Customers deleted before this change are erased too.
UPDATE customers SET name = 'Deleted customer', phone = NULL, email = NULL, address = NULL, notes = NULL, updated_at = now()
WHERE deleted_at IS NOT NULL;
