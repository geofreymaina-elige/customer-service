-- Append-only audit history for synchronous SasaPay balance lookups.
CREATE TABLE IF NOT EXISTS customer_balance_audit (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    account_number VARCHAR(64) NOT NULL,
    currency VARCHAR(16) NOT NULL,
    balance NUMERIC(20, 6),
    requested_at TIMESTAMPTZ NOT NULL,
    outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('success', 'failure')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_customer_balance_audit_customer_requested
    ON customer_balance_audit (customer_id, requested_at DESC);

CREATE OR REPLACE FUNCTION reject_customer_balance_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'customer_balance_audit is append-only; % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_balance_audit_no_row_mutation ON customer_balance_audit;
CREATE TRIGGER trg_customer_balance_audit_no_row_mutation
    BEFORE UPDATE OR DELETE ON customer_balance_audit
    FOR EACH ROW EXECUTE FUNCTION reject_customer_balance_audit_mutation();

DROP TRIGGER IF EXISTS trg_customer_balance_audit_no_truncate ON customer_balance_audit;
CREATE TRIGGER trg_customer_balance_audit_no_truncate
    BEFORE TRUNCATE ON customer_balance_audit
    FOR EACH STATEMENT EXECUTE FUNCTION reject_customer_balance_audit_mutation();

COMMENT ON TABLE customer_balance_audit IS
    'Append-only audit trail for customer balance lookup requests made to SasaPay.';
