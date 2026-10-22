import { index, onchainTable, sql } from "ponder";

export const chainCheckpoint = onchainTable("chain_checkpoint", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer("chain_id").notNull(),
  blockNumber: t.bigint("block_number").notNull(),
  blockHash: t.hex("block_hash").notNull(),
  parentHash: t.hex("parent_hash").notNull(),
  timestamp: t.bigint().notNull()
}));

export const chainBlock = onchainTable(
  "chain_block",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer("chain_id").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockHash: t.hex("block_hash").notNull(),
    parentHash: t.hex("parent_hash").notNull(),
    timestamp: t.bigint().notNull()
  }),
  (table) => ({ chainHeight: index().on(table.chainId, table.blockNumber) })
);

export const indexerSource = onchainTable("indexer_source", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer("chain_id").notNull(),
  manifestHash: t.hex("manifest_hash").notNull(),
  definition: t.text().notNull()
}));

export const canonicalEvent = onchainTable(
  "canonical_event",
  (t) => ({
    id: t.text().primaryKey(),
    sourceId: t.text("source_id").notNull(),
    chainId: t.integer("chain_id").notNull(),
    address: t.hex().notNull(),
    name: t.text().notNull(),
    args: t.text().notNull(),
    abiHash: t.hex("abi_hash").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockHash: t.hex("block_hash").notNull(),
    timestamp: t.bigint().notNull(),
    transactionHash: t.hex("transaction_hash").notNull(),
    transactionIndex: t.integer("transaction_index").notNull(),
    logIndex: t.integer("log_index").notNull(),
    topics: t.text().notNull(),
    data: t.hex().notNull()
  }),
  (table) => ({
    sourceOrder: index().on(
      table.sourceId,
      table.blockNumber,
      table.transactionIndex,
      table.logIndex
    ),
    transaction: index().on(table.chainId, table.transactionHash),
    baseMetadataToken: index()
      .on(
        sql`((${table.args}::jsonb)->>'tokenId')`,
        table.blockNumber,
        table.transactionIndex,
        table.logIndex
      )
      .where(sql`${table.sourceId}='metadata:base'`)
  })
);

export const transactionCandidate = onchainTable(
  "transaction_candidate",
  (t) => ({
    id: t.text().primaryKey(),
    chainId: t.integer("chain_id").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockHash: t.hex("block_hash").notNull(),
    transactionHash: t.hex("transaction_hash").notNull()
  }),
  (table) => ({
    chainOrder: index().on(
      table.chainId,
      table.blockNumber,
      table.transactionHash
    )
  })
);
