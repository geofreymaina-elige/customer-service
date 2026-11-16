-- ASTPP may issue a new account ID for a phone number after deleting the old account.
-- Retain both customer records in PostgreSQL; the previous record is soft-deleted
-- when the active ASTPP record is synchronized.
ALTER TABLE customers
  DROP CONSTRAINT IF EXISTS customers_phone_number_key;
