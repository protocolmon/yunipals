import { ponderSchema } from "../offchain/sql.js";

export const activeVisibilityRowPredicate = (
  tokenAlias = "t",
  visibilityAlias = "visibility",
) => `(
  ${visibilityAlias}.owner=lower(${tokenAlias}.owner)
  AND ${visibilityAlias}.lifecycle=${tokenAlias}.lifecycle
  AND EXISTS (
    SELECT 1 FROM ${ponderSchema}.transfer_event visibility_anchor
    WHERE visibility_anchor.id=${visibilityAlias}.anchor_event_id
      AND visibility_anchor.collection=${tokenAlias}.collection
      AND visibility_anchor.token_id=${tokenAlias}.token_id
      AND visibility_anchor.lifecycle=${tokenAlias}.lifecycle
  )
  AND NOT EXISTS (
    SELECT 1 FROM ${ponderSchema}.transfer_event visibility_change
    WHERE visibility_change.collection=${tokenAlias}.collection
      AND visibility_change.token_id=${tokenAlias}.token_id
      AND visibility_change.lifecycle=${tokenAlias}.lifecycle
      AND visibility_change.from<>visibility_change.to
      AND (visibility_change.block_number, visibility_change.transaction_index, visibility_change.log_index)
        > (${visibilityAlias}.anchor_block, ${visibilityAlias}.anchor_transaction_index, ${visibilityAlias}.anchor_log_index)
  )
)`;
export const activeVisibilityPredicate = (
  tokenAlias = "t",
  bounded = false,
) => `EXISTS (
  SELECT 1 FROM metadata.token_visibility visibility
  WHERE visibility.collection=${tokenAlias}.collection
  AND visibility.token_id=${tokenAlias}.token_id::numeric
  AND ${activeVisibilityRowPredicate(tokenAlias)}
  ${bounded ? "OFFSET 0" : ""}
)`;
