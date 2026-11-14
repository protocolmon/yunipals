/** Typed grouping keys are exposed before JSON expansion so SQL predicates can
 * reach the matching history index rather than sorting an entire domain. */
export const portalProjectionKeys = {
  token: { token_id: "numeric" },
  request: { request_id: "numeric" },
  mint: { source: "text", request_id: "numeric" },
  state: { source: "text", component: "text", entity_id: "text" },
  entry: { entry_id: "numeric" },
  batch: { batch_id: "numeric" },
  prize: { batch_id: "numeric", rank: "integer" }
} as const;
