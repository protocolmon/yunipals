import { onchainTable, primaryKey, index } from "ponder";

export const token = onchainTable("token", (t) => ({
  collection: t.text().notNull(),
  chainId: t.integer("chain_id").notNull(),
  contractAddress: t.hex("contract_address").notNull(),
  tokenId: t.text("token_id").notNull(),
  owner: t.hex().notNull(),
  burned: t.boolean().notNull(),
  lifecycle: t.integer().notNull(),
  mintBlock: t.bigint("mint_block").notNull(),
  mintTimestamp: t.bigint("mint_timestamp").notNull(),
  lastTransferBlock: t.bigint("last_transfer_block").notNull(),
  lastTransferTimestamp: t.bigint("last_transfer_timestamp").notNull(),
  lastTransactionHash: t.hex("last_transaction_hash").notNull()
}), (table) => ({
  pk: primaryKey({ columns: [table.collection, table.tokenId] }),
  ownerIdx: index().on(table.owner),
  collectionOwnerIdx: index().on(table.collection, table.owner),
  burnedIdx: index().on(table.burned)
}));

export const tokenLifecycle = onchainTable("token_lifecycle", (t) => ({
  collection: t.text().notNull(),
  tokenId: t.text("token_id").notNull(),
  lifecycle: t.integer().notNull(),
  mintedTo: t.hex("minted_to").notNull(),
  mintBlock: t.bigint("mint_block").notNull(),
  mintTimestamp: t.bigint("mint_timestamp").notNull(),
  mintTransactionHash: t.hex("mint_transaction_hash").notNull(),
  burnedAtBlock: t.bigint("burned_at_block"),
  burnedAtTimestamp: t.bigint("burned_at_timestamp"),
  burnTransactionHash: t.hex("burn_transaction_hash")
}), (table) => ({ pk: primaryKey({ columns: [table.collection, table.tokenId, table.lifecycle] }) }));

export const transferEvent = onchainTable("transfer_event", (t) => ({
  id: t.text().primaryKey(),
  collection: t.text().notNull(),
  chainId: t.integer("chain_id").notNull(),
  contractAddress: t.hex("contract_address").notNull(),
  tokenId: t.text("token_id").notNull(),
  lifecycle: t.integer().notNull(),
  from: t.hex().notNull(),
  to: t.hex().notNull(),
  blockNumber: t.bigint("block_number").notNull(),
  blockTimestamp: t.bigint("block_timestamp").notNull(),
  transactionHash: t.hex("transaction_hash").notNull(),
  transactionIndex: t.integer("transaction_index").notNull(),
  logIndex: t.integer("log_index").notNull()
}), (table) => ({ tokenIdx: index().on(table.collection, table.tokenId), ownerFromIdx: index().on(table.from), ownerToIdx: index().on(table.to) }));

export const adminRoleEvent = onchainTable("admin_role_event", (t) => ({
  id: t.text().primaryKey(),
  collection: t.text().notNull(),
  chainId: t.integer("chain_id").notNull(),
  contractAddress: t.hex("contract_address").notNull(),
  role: t.hex().notNull(),
  account: t.hex().notNull(),
  sender: t.hex().notNull(),
  granted: t.boolean().notNull(),
  blockNumber: t.bigint("block_number").notNull(),
  transactionHash: t.hex("transaction_hash").notNull(),
  logIndex: t.integer("log_index").notNull()
}), (table) => ({ accountIdx: index().on(table.account), roleIdx: index().on(table.role) }));

export const contractOwnerEvent = onchainTable("contract_owner_event", (t) => ({
  id: t.text().primaryKey(),
  collection: t.text().notNull(),
  chainId: t.integer("chain_id").notNull(),
  contractAddress: t.hex("contract_address").notNull(),
  previousOwner: t.hex("previous_owner").notNull(),
  newOwner: t.hex("new_owner").notNull(),
  blockNumber: t.bigint("block_number").notNull(),
  transactionHash: t.hex("transaction_hash").notNull(),
  logIndex: t.integer("log_index").notNull()
}), (table) => ({ collectionIdx: index().on(table.collection, table.blockNumber, table.logIndex) }));
