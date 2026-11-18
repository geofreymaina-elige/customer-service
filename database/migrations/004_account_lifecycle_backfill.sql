-- Reconcile customer and wallet lifecycle for accounts already soft-deleted in
-- PostgreSQL when the ASTPP account lifecycle was synchronized.
UPDATE customers
SET status = 'suspended',
    updated_at = NOW()
WHERE deleted_at IS NOT NULL
  AND status <> 'suspended';

UPDATE customer_wallets w
SET status = 'inactive',
    is_locked = false,
    lock_reason = COALESCE(w.lock_reason, 'Customer deleted or replaced in ASTPP'),
    locked_by = 'SYSTEM_MIGRATION',
    locked_at = NULL,
    freeze_type = NULL,
    updated_at = NOW()
FROM customers c
WHERE w.customer_id = c.id
  AND c.deleted_at IS NOT NULL
  AND w.status <> 'closed';
