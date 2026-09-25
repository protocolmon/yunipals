// Internal SQL fragment: the caller must bind the indexed token as t.
// This matches the deployed indexer's owner/lifecycle/anchor visibility rule.
// Explicit immutable input/output functions preserve PostgreSQL's numeric cast
// semantics while allowing postgres_fdw to push the expression to the indexer.
// Its generic CoerceViaIO cast node otherwise forces these joins to run locally.
export const indexedTokenNumberSql =
  "pg_catalog.numeric_in(pg_catalog.textout(t.token_id),0,-1)";
export const indexedTokenHiddenSql = `EXISTS(SELECT 1 FROM metadata.token_visibility v
      WHERE v.collection=t.collection AND v.token_id=${indexedTokenNumberSql}
        AND v.owner=lower(t.owner) AND v.lifecycle=t.lifecycle
        AND EXISTS(SELECT 1 FROM yunipals_read_v4.transfer_event anchor
          WHERE anchor.id=v.anchor_event_id AND anchor.collection=t.collection
            AND anchor.token_id=t.token_id AND anchor.lifecycle=t.lifecycle)
        AND NOT EXISTS(SELECT 1 FROM yunipals_read_v4.transfer_event change
          WHERE change.collection=t.collection AND change.token_id=t.token_id AND change.lifecycle=t.lifecycle
            AND change."from"<>change."to"
            AND (change.block_number,change.transaction_index,change.log_index)
              > (v.anchor_block,v.anchor_transaction_index,v.anchor_log_index)))`;
