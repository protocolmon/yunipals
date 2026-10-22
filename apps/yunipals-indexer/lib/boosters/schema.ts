import { onchainTable, index } from "ponder";

export const boosterType = onchainTable("booster_type", (t) => ({
  id: t.text().primaryKey(),
  packTypeId: t.text("pack_type_id").notNull(),
  registry: t.hex().notNull(),
  engine: t.hex().notNull(),
  paymentToken: t.hex("payment_token").notNull(),
  price: t.text().notNull(),
  intervalSeconds: t.bigint("interval_seconds").notNull(),
  mintsPerInterval: t.bigint("mints_per_interval").notNull(),
  totalVariants: t.bigint("total_variants").notNull(),
  maxBatch: t.integer("max_batch").notNull(),
  catalogHash: t.hex("catalog_hash").notNull(),
  ruleHash: t.hex("rule_hash").notNull(),
  manifestUri: t.text("manifest_uri").notNull(),
  metadataBaseUri: t.text("metadata_base_uri").notNull(),
  salesPaused: t.boolean("sales_paused").notNull(),
  openings: t.bigint().notNull()
}));

export const boosterOriginal = onchainTable(
  "booster_original",
  (t) => ({
    id: t.text().primaryKey(),
    collection: t.hex().notNull(),
    tokenId: t.text("token_id").notNull(),
    typeKey: t.text("type_key").notNull(),
    engine: t.hex().notNull(),
    owner: t.hex().notNull(),
    revealedAt: t.bigint("revealed_at"),
    dailyCommitted: t.bigint("daily_committed").notNull(),
    minted: t.bigint().notNull(),
    remaining: t.bigint().notNull(),
    pendingRequest: t.text("pending_request"),
    burned: t.boolean().notNull()
  }),
  (table) => ({ ownerIdx: index().on(table.owner) })
);

export const boosterRequest = onchainTable(
  "booster_request",
  (t) => ({
    id: t.text().primaryKey(),
    engine: t.hex().notNull(),
    wrapper: t.hex().notNull(),
    requestId: t.text("request_id").notNull(),
    originalKey: t.text("original_key").notNull(),
    payer: t.hex().notNull(),
    quantity: t.integer().notNull(),
    opening: t.boolean().notNull(),
    paid: t.text().notNull(),
    ruleHash: t.hex("rule_hash").notNull(),
    callbackGas: t.integer("callback_gas").notNull(),
    status: t.text().notNull(),
    seed: t.text(),
    requestedAt: t.bigint("requested_at").notNull(),
    receivedAt: t.bigint("received_at"),
    transactionHash: t.hex("transaction_hash").notNull(),
    recipient: t.hex()
  }),
  (table) => ({
    payerIdx: index().on(table.payer),
    parentIdx: index().on(table.originalKey)
  })
);

export const boosterMonster = onchainTable(
  "booster_monster",
  (t) => ({
    id: t.text().primaryKey(),
    collection: t.hex().notNull(),
    tokenId: t.text("token_id").notNull(),
    originalKey: t.text("original_key").notNull(),
    requestKey: t.text("request_key").notNull(),
    typeKey: t.text("type_key").notNull(),
    owner: t.hex().notNull(),
    mintedTo: t.hex("minted_to").notNull(),
    variantId: t.bigint("variant_id").notNull(),
    monsterType: t.bigint("monster_type").notNull(),
    color: t.bigint().notNull(),
    horn: t.bigint().notNull(),
    glitter: t.bigint().notNull(),
    isOriginal: t.boolean("is_original").notNull(),
    burned: t.boolean().notNull(),
    mintBlock: t.bigint("mint_block").notNull()
  }),
  (table) => ({
    ownerIdx: index().on(table.owner),
    parentIdx: index().on(table.originalKey)
  })
);

export const boosterRefund = onchainTable("booster_refund", (t) => ({
  id: t.text().primaryKey(),
  engine: t.hex().notNull(),
  requester: t.hex().notNull(),
  credit: t.bigint().notNull(),
  returned: t.bigint().notNull(),
  withdrawn: t.bigint().notNull()
}));

export const boosterEngineState = onchainTable("booster_engine_state", (t) => ({
  id: t.text().primaryKey(),
  paused: t.boolean().notNull()
}));

export const boosterEvent = onchainTable("booster_event", (t) => ({
  id: t.text().primaryKey(),
  address: t.hex().notNull(),
  name: t.text().notNull(),
  args: t.text().notNull(),
  blockNumber: t.bigint("block_number").notNull(),
  blockHash: t.hex("block_hash").notNull(),
  timestamp: t.bigint().notNull(),
  transactionHash: t.hex("transaction_hash").notNull(),
  logIndex: t.integer("log_index").notNull()
}));

export const boosterCheckpoint = onchainTable("booster_checkpoint", (t) => ({
  id: t.text().primaryKey(),
  blockNumber: t.bigint("block_number").notNull(),
  blockHash: t.hex("block_hash").notNull(),
  timestamp: t.bigint().notNull()
}));
