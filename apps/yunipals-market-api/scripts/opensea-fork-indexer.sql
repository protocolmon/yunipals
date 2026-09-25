-- Additional isolated test relations. Only the loopback fork harness runs this.
DO $$ BEGIN
  IF current_database()<>'yunipals_market_test' OR current_user<>'market_test_owner' THEN
    RAISE EXCEPTION 'This fixture requires the disposable marketplace test database and owner';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS yunipals_indexer_v3;
CREATE TABLE IF NOT EXISTS yunipals_indexer_v3._ponder_checkpoint(chain_id integer PRIMARY KEY,latest_checkpoint text);
CREATE TABLE IF NOT EXISTS yunipals_indexer_v3._ponder_meta(key text PRIMARY KEY,value jsonb);
CREATE TABLE IF NOT EXISTS yunipals_read_v4.token_lifecycle(collection text,token_id text,lifecycle integer,mint_block bigint,mint_transaction_hash text,minted_to text,PRIMARY KEY(collection,token_id,lifecycle));
ALTER TABLE yunipals_read_v4.token ADD COLUMN IF NOT EXISTS last_transaction_hash text;
ALTER TABLE yunipals_read_v4.transfer_event ADD COLUMN IF NOT EXISTS transaction_hash text;
GRANT USAGE ON SCHEMA yunipals_indexer_v3 TO market_test_runtime;
GRANT SELECT ON yunipals_indexer_v3._ponder_checkpoint,yunipals_indexer_v3._ponder_meta,yunipals_read_v4.token_lifecycle TO market_test_runtime;
