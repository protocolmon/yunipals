import { zeroAddress, type Address } from "viem";
import type { OpenSeaChain } from "@protopals/yunipals-market-core/openseaRegistry";

import { createBnbTestDatabase } from "@/bnb/fixtures/database";
import {
  admissionFixture,
  fixtureNow,
  fixtureTimestamp
} from "@/opensea/fixtures/admission";

export function createOpenSeaTestDatabase() {
  const database = createBnbTestDatabase();
  const tokens: string[] = [];
  let sequence = BigInt(Date.now()) * 1000000n;
  async function initialize() {
    await database.initialize();
    await database.owner
      .query(`GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.opensea_discovered_order,
      yunipals_market.opensea_discovery_scan,yunipals_market.opensea_discovery_page TO market_test_runtime;
      GRANT SELECT,INSERT,UPDATE,DELETE ON yunipals_market.opensea_discovered_state,
      yunipals_market.opensea_maker_signature TO market_test_runtime`);
    await database.owner.query(`CREATE SCHEMA IF NOT EXISTS yunipals_indexer_v3;
    CREATE TABLE IF NOT EXISTS yunipals_indexer_v3._ponder_checkpoint(chain_id integer PRIMARY KEY,latest_checkpoint text);
    CREATE TABLE IF NOT EXISTS yunipals_indexer_v3._ponder_meta(key text PRIMARY KEY,value jsonb);
    CREATE TABLE IF NOT EXISTS yunipals_read_v4.token_lifecycle(collection text,token_id text,lifecycle integer,mint_block bigint,mint_transaction_hash text,minted_to text,PRIMARY KEY(collection,token_id,lifecycle));
    ALTER TABLE yunipals_read_v4.token ADD COLUMN IF NOT EXISTS last_transaction_hash text;
    ALTER TABLE yunipals_read_v4.transfer_event ADD COLUMN IF NOT EXISTS transaction_hash text;
    GRANT USAGE ON SCHEMA yunipals_indexer_v3 TO market_test_runtime;
    GRANT SELECT ON yunipals_indexer_v3._ponder_checkpoint,yunipals_indexer_v3._ponder_meta,yunipals_read_v4.token_lifecycle TO market_test_runtime;`);
    await database.owner.query(
      `INSERT INTO yunipals_indexer_v3._ponder_meta VALUES('app',$1) ON CONFLICT(key) DO UPDATE SET value=$1`,
      [JSON.stringify({ version: 6, is_ready: 1, heartbeat_at: fixtureNow })]
    );
  }
  async function close() {
    try {
      await database.owner.query(
        `DELETE FROM yunipals_market.job WHERE kind IN ('opensea_submission','opensea_order_reconcile') AND lower(payload->>'orderHash') IN
      (SELECT order_hash FROM yunipals_market.orders WHERE source='opensea' AND token_id=ANY($1::numeric[]))`,
        [tokens]
      );
      for (const table of ["submission_attempt", "orders", "preparation"]) {
        await database.owner.query(
          table === "submission_attempt"
            ? `DELETE FROM yunipals_market.submission_attempt WHERE order_hash IN (SELECT order_hash FROM yunipals_market.orders WHERE source='opensea' AND token_id=ANY($1::numeric[]))`
            : `DELETE FROM yunipals_market.${table} WHERE chain_id IN (1,8453,137) AND token_id=ANY($1::numeric[])`,
          [tokens]
        );
      }
      await database.owner.query(
        "DELETE FROM metadata.token_visibility WHERE collection IN ('ethereum','base','polygon') AND token_id=ANY($1::numeric[])",
        [tokens]
      );
      for (const table of ["transfer_event", "token_lifecycle", "token"])
        await database.owner.query(
          `DELETE FROM yunipals_read_v4.${table} WHERE collection IN ('ethereum','base','polygon') AND token_id=ANY($1::text[])`,
          [tokens]
        );
    } finally {
      await database.close();
    }
  }
  async function setup(
    chain: OpenSeaChain = "ethereum",
    side: "listing" | "offer" = "listing",
    listingCurrency: Address = zeroAddress
  ) {
    const tokenId = ++sequence;
    const salt = 7n;
    const item = await admissionFixture(
      chain,
      side,
      tokenId,
      salt,
      listingCurrency
    );
    const { asset } = item.input;
    if (!tokens.includes(String(tokenId))) {
      tokens.push(String(tokenId));
      await database.owner.query(
        `INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned,mint_block,last_transfer_block,last_transaction_hash)
      VALUES($1,$2,$3,$4,$5,1,false,50,80,$6)`,
        [
          chain,
          asset.chainId,
          asset.contractAddress.toLowerCase(),
          String(tokenId),
          item.indexed.owner.toLowerCase(),
          item.indexed.lastTransfer.transactionHash
        ]
      );
      await database.owner.query(
        `INSERT INTO yunipals_read_v4.token_lifecycle VALUES($1,$2,1,50,$3,$4)`,
        [
          chain,
          String(tokenId),
          item.indexed.mint.transactionHash,
          item.indexed.mint.recipient.toLowerCase()
        ]
      );
      await database.owner.query(
        `INSERT INTO yunipals_read_v4.transfer_event(id,collection,token_id,lifecycle,"from","to",block_number,transaction_index,log_index,transaction_hash)
      VALUES($1,$2,$3,1,$4,$5,80,2,3,$6)`,
        [
          `${chain}:${tokenId}`,
          chain,
          String(tokenId),
          item.indexed.lastTransfer.from.toLowerCase(),
          item.indexed.owner.toLowerCase(),
          item.indexed.lastTransfer.transactionHash
        ]
      );
    }
    const checkpoint = `${String(fixtureTimestamp - 30n).padStart(10, "0")}${String(asset.chainId).padStart(16, "0")}${"100".padStart(16, "0")}${"0".repeat(33)}`;
    await database.owner.query(
      `INSERT INTO yunipals_indexer_v3._ponder_checkpoint VALUES($1,$2) ON CONFLICT(chain_id) DO UPDATE SET latest_checkpoint=$2`,
      [asset.chainId, checkpoint]
    );
    return item;
  }
  return {
    owner: database.owner,
    runtime: database.runtime,
    initialize,
    close,
    setup
  };
}
