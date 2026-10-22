-- Apply on the candidate source DB as its owner. Variables: physical_schema,
-- read_schema, market_source_role. Use a dedicated read-only LOGIN without
-- owner memberships; credentials stay in the service's existing secret files.
BEGIN;
GRANT USAGE ON SCHEMA :"physical_schema",:"read_schema",yunipals_indexer_control
  TO :"market_source_role";
GRANT SELECT ON :"physical_schema"._ponder_meta,:"physical_schema"._ponder_checkpoint,
  :"physical_schema".indexer_source,:"physical_schema".chain_checkpoint,
  :"physical_schema".chain_block,:"physical_schema".canonical_event,
  :"physical_schema".transaction_candidate,:"physical_schema".token,
  :"physical_schema".token_lifecycle,:"physical_schema".transfer_event
  TO :"market_source_role";
GRANT SELECT ON yunipals_indexer_control.release,
  yunipals_indexer_control.chain_status,yunipals_indexer_control.chain_anchor,
  yunipals_indexer_control.transaction_evidence TO :"market_source_role";
GRANT SELECT ON :"read_schema"._unified_read_release,:"read_schema".source_status,
  :"read_schema".token,:"read_schema".token_lifecycle,:"read_schema".transfer_event
  TO :"market_source_role";
GRANT EXECUTE ON FUNCTION :"read_schema".source_boundary(text),
  :"read_schema".source_probe(text) TO :"market_source_role";
COMMIT;
