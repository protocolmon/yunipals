-- Optional OpenSea admission reads, run as the inspected relation owner.
-- Apply only where the real inspected Ponder schema or isolated equivalents exist.
-- The regular BNB/read-only staging deployment does not need these grants.
BEGIN;
GRANT USAGE ON SCHEMA yunipals_indexer_v3,yunipals_read_v4 TO :"market_runtime_role";
GRANT SELECT ON yunipals_indexer_v3._ponder_checkpoint,yunipals_indexer_v3._ponder_meta,
  yunipals_read_v4.token_lifecycle TO :"market_runtime_role";
COMMIT;
