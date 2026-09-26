-- The transactions table is an audit ledger: rows may be inserted, never changed or removed.
CREATE OR REPLACE FUNCTION transactions_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER transactions_append_only
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_block_mutation();
--> statement-breakpoint
CREATE TRIGGER transactions_no_truncate
  BEFORE TRUNCATE ON transactions
  FOR EACH STATEMENT EXECUTE FUNCTION transactions_block_mutation();
