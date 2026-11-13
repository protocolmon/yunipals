import { index, onchainTable } from "ponder";

export const portalProjection = onchainTable("portal_projection", (t) => ({
  id: t.text().primaryKey(),
  value: t.json().$type<Record<string, unknown>>().notNull()
}));
// Versions make confirmed reads possible even while Ponder processes newer blocks.
// Both versions and current rows are managed by Ponder's reorg transaction log.
export const portalProjectionVersion = onchainTable(
  "portal_projection_version",
  (t) => ({
    id: t.text().primaryKey(),
    entity: t.text().notNull(),
    deployment: t.text().notNull(),
    domain: t.text().notNull(),
    value: t.json().$type<Record<string, unknown>>().notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    transactionIndex: t.integer("transaction_index").notNull(),
    logIndex: t.integer("log_index").notNull()
  }),
  (t) => ({
    history: index().on(
      t.deployment,
      t.domain,
      t.entity,
      t.blockNumber,
      t.transactionIndex,
      t.logIndex
    )
  })
);
