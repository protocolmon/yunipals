import { index, onchainTable } from "ponder";
export const evolutionProjection = onchainTable(
  "evolution_projection",
  (t) => ({
    id: t.text().primaryKey(),
    value: t.json().$type<Record<string, unknown>>().notNull()
  })
);
export const evolutionProjectionVersion = onchainTable(
  "evolution_projection_version",
  (t) => ({
    id: t.text().primaryKey(),
    entity: t.text().notNull(),
    domain: t.text().notNull(),
    deployment: t.text().notNull(),
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
