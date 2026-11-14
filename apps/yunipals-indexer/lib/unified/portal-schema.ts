import { portalProjectionKeys } from "./portal-keys.js";
import { index, onchainTable, sql } from "ponder";

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
    ...Object.fromEntries(
      Object.entries(portalProjectionKeys).map(([domain, keys]) => [
        domain,
        index(`portal_${domain}_point_idx`)
          .on(
            t.deployment,
            ...Object.entries(keys).map(
              ([key, type]) =>
                sql`((${t.value}::jsonb->>${sql.raw("'" + key + "'")})::${sql.raw(type)})`
            ),
            t.blockNumber,
            t.transactionIndex,
            t.logIndex
          )
          .where(sql`${t.domain}=${sql.raw("'" + domain + "'")}`)
      ])
    ),
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

// Rules are cached in rollback-managed state, scoped to a competition proxy's
// upgrade history. A reorg restores the previous incarnation automatically.
export const portalCompetitionRules = onchainTable(
  "portal_competition_rules",
  (t) => ({
    id: t.text().primaryKey(),
    batchSize: t.bigint("batch_size").notNull(),
    contribution: t.bigint().notNull()
  })
);
