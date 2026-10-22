import { index, onchainTable } from "ponder";
import type { ArenaTournament } from "../../../../packages/yunipals-market-core/src/arena.js";

export const arenaTournament = onchainTable(
  "arena_tournament",
  (t) => ({
    id: t.text().primaryKey(),
    deployment: t.text().notNull(),
    tournamentId: t.text("tournament_id").notNull(),
    state: t.jsonb().$type<ArenaTournament>().notNull(),
    openedEventId: t.text("opened_event_id").notNull(),
    openedBlockHash: t.hex("opened_block_hash").notNull(),
    lastEventId: t.text("last_event_id").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockHash: t.hex("block_hash").notNull()
  }),
  (table) => ({ deployment: index().on(table.deployment, table.blockNumber) })
);

export const arenaSeat = onchainTable(
  "arena_seat",
  (t) => ({
    id: t.text().primaryKey(),
    tournamentKey: t.text("tournament_key").notNull(),
    seat: t.integer().notNull(),
    player: t.hex().notNull(),
    nftChainId: t.integer("nft_chain_id").notNull(),
    collection: t.hex().notNull(),
    tokenId: t.text("token_id").notNull()
  }),
  (table) => ({ player: index().on(table.player, table.tournamentKey) })
);

export const arenaCredit = onchainTable(
  "arena_credit",
  (t) => ({
    id: t.text().primaryKey(),
    deployment: t.text().notNull(),
    wallet: t.hex().notNull(),
    amount: t.bigint().notNull(),
    lastEventId: t.text("last_event_id").notNull(),
    blockNumber: t.bigint("block_number").notNull(),
    blockHash: t.hex("block_hash").notNull()
  }),
  (table) => ({ wallet: index().on(table.deployment, table.wallet) })
);
