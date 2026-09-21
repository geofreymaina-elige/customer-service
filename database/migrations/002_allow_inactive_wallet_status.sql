-- Allow CDC to mark wallets inactive when ASTPP deletes or soft-deletes accounts.

ALTER TABLE customer_wallets
DROP CONSTRAINT IF EXISTS customer_wallets_status_check;

ALTER TABLE customer_wallets
ADD CONSTRAINT customer_wallets_status_check
CHECK (status IN ('active', 'inactive', 'frozen', 'locked', 'closed'));
