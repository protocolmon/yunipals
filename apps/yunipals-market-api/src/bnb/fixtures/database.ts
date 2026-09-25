import { readFile } from "node:fs/promises";
import pg from "pg";
import { BnbAdmissionService } from "@/bnb/admission";
import {
  fixture,
  cursorHash,
  now,
  policy,
  seller
} from "@/bnb/fixtures/admission";
import { migrate } from "@/db/migrate";

export function testUrl(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Set ${name} to the isolated marketplace test database.`);
  const url = new URL(value);
  if (
    url.pathname !== "/yunipals_market_test" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Admission tests require the isolated loopback yunipals_market_test database."
    );
  return value;
}
export function createBnbTestDatabase() {
  const owner = new pg.Pool({
    connectionString: testUrl("MARKET_TEST_DATABASE_URL"),
    max: 4,
    statement_timeout: 5000
  });
  const runtime = new pg.Pool({
    connectionString: testUrl("MARKET_TEST_RUNTIME_DATABASE_URL"),
    max: 12,
    statement_timeout: 5000
  });
  const tokenIds: string[] = [];
  let sequence = BigInt(Date.now()) * 1000n;

  async function initialize() {
    await migrate(owner, "staging");
    // This database is test-only and stream wakeups are process-global rather
    // than tied to fixture token IDs. Reset them between isolated test files.
    await owner.query(`DELETE FROM yunipals_market.opensea_stream_notice;
      DELETE FROM yunipals_market.opensea_stream_wakeup;
      UPDATE yunipals_market.opensea_stream_state SET sequence=0,generation=0,
        lease_token=NULL,lease_until=NULL,connected=false,connected_at=NULL,
        heartbeat_at=NULL,last_gap_at=NULL,last_error_code=NULL WHERE singleton`);
    await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON
      yunipals_market.activity_block,yunipals_market.sale_receipt TO market_test_runtime;
      GRANT SELECT ON yunipals_market.sale_replay_config,yunipals_market.sale_exclusion TO market_test_runtime`);
    await owner.query(`GRANT SELECT ON yunipals_market.opensea_discovery_scan,yunipals_market.opensea_discovery_page,
      yunipals_market.opensea_discovered_order,yunipals_market.opensea_discovered_state,
      yunipals_market.opensea_stream_wakeup TO market_test_runtime`);
    // Local relations reproduce the deployed read columns. No production indexer is used.
    await owner.query(`CREATE SCHEMA IF NOT EXISTS yunipals_read_v4;
    CREATE SCHEMA IF NOT EXISTS bnb_indexer; CREATE SCHEMA IF NOT EXISTS metadata;
    CREATE TABLE IF NOT EXISTS yunipals_read_v4.token(collection text,chain_id integer,contract_address text,
      token_id text,owner text,lifecycle integer,burned boolean,PRIMARY KEY(collection,token_id));
    CREATE TABLE IF NOT EXISTS yunipals_read_v4.transfer_event(id text PRIMARY KEY,collection text,token_id text,
      lifecycle integer,"from" text,"to" text,block_number bigint,transaction_index integer,log_index integer);
    CREATE TABLE IF NOT EXISTS metadata.token_visibility(collection text,token_id numeric,owner text,lifecycle integer,
      anchor_event_id text,anchor_block bigint,anchor_transaction_index integer,anchor_log_index integer,
      PRIMARY KEY(collection,token_id));
    CREATE TABLE IF NOT EXISTS bnb_indexer.sync_state(singleton boolean PRIMARY KEY DEFAULT true,
      next_block bigint,last_scanned_block bigint,last_scanned_hash text,caught_up_at timestamptz,last_error text,updated_at timestamptz);
    ALTER TABLE yunipals_read_v4.token ADD COLUMN IF NOT EXISTS mint_block bigint NOT NULL DEFAULT 100;
    ALTER TABLE yunipals_read_v4.token ADD COLUMN IF NOT EXISTS last_transfer_block bigint NOT NULL DEFAULT 100;
    ALTER TABLE yunipals_read_v4.token ADD COLUMN IF NOT EXISTS last_transaction_hash text NOT NULL
      DEFAULT '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    CREATE TABLE IF NOT EXISTS metadata.token_metadata(collection text,token_id numeric,lifecycle integer,
      token_uri text,name text,image text,attributes jsonb,PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE IF NOT EXISTS metadata.token_search(collection text,token_id numeric,lifecycle integer,
      metadata_available boolean,rarity_points numeric,rarity_points_capped numeric,PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE IF NOT EXISTS metadata.token_trait(collection text,token_id numeric,lifecycle integer,
      trait_type text,value text,PRIMARY KEY(collection,token_id,lifecycle,trait_type,value));
    GRANT USAGE ON SCHEMA yunipals_read_v4,bnb_indexer,metadata TO market_test_runtime;
    GRANT SELECT ON yunipals_read_v4.token,yunipals_read_v4.transfer_event,metadata.token_visibility,bnb_indexer.sync_state TO market_test_runtime;`);
    await owner.query(
      await readFile(
        new URL(
          "../../../scripts/catalog-current-trait-view.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    await owner.query(
      "GRANT SELECT ON metadata.token_metadata,metadata.token_search,metadata.token_trait,metadata.market_catalog_trait TO market_test_runtime"
    );
    await owner.query(`CREATE SCHEMA IF NOT EXISTS yunipals_indexer_v3;
      CREATE OR REPLACE VIEW yunipals_indexer_v3.token AS
        SELECT * FROM yunipals_read_v4.token WHERE collection IN ('ethereum','base','polygon');
      CREATE OR REPLACE VIEW bnb_indexer.token AS
        SELECT * FROM yunipals_read_v4.token WHERE collection='bnb';
      GRANT USAGE ON SCHEMA yunipals_indexer_v3 TO market_test_runtime;
      GRANT SELECT ON yunipals_indexer_v3.token,bnb_indexer.token TO market_test_runtime;`);
    await owner.query(
      `INSERT INTO bnb_indexer.sync_state VALUES(true,101,100,$1,clock_timestamp(),NULL,clock_timestamp())
    ON CONFLICT(singleton) DO UPDATE SET last_scanned_block=100,last_scanned_hash=$1,caught_up_at=clock_timestamp(),last_error=NULL,updated_at=clock_timestamp()`,
      [cursorHash]
    );
  }

  async function clear() {
    await owner.query(
      `DELETE FROM yunipals_market.job WHERE kind='bnb_order_reconcile' AND lower(payload->>'orderHash') IN
      (SELECT order_hash FROM yunipals_market.orders WHERE chain_id=56 AND token_id=ANY($1::numeric[]))`,
      [tokenIds]
    );
    for (const table of ["orders", "preparation"])
      await owner.query(
        `DELETE FROM yunipals_market.${table} WHERE chain_id=56 AND token_id=ANY($1::numeric[])`,
        [tokenIds]
      );
    await owner.query(
      "DELETE FROM metadata.token_visibility WHERE collection='bnb' AND token_id=ANY($1::numeric[])",
      [tokenIds]
    );
    for (const table of ["transfer_event", "token"])
      await owner.query(
        `DELETE FROM yunipals_read_v4.${table} WHERE collection='bnb' AND token_id=ANY($1::text[])`,
        [tokenIds]
      );
  }
  async function close() {
    try {
      await clear();
    } finally {
      await runtime.end();
      await owner.end();
    }
  }

  async function setup(
    side: "listing" | "offer" = "listing",
    tokenId = ++sequence,
    salt = 77n
  ) {
    const item = await fixture(side, tokenId, salt);
    if (!tokenIds.includes(tokenId.toString())) {
      tokenIds.push(tokenId.toString());
      await owner.query(
        `INSERT INTO yunipals_read_v4.token(collection,chain_id,contract_address,token_id,owner,lifecycle,burned,last_transaction_hash)
        VALUES('bnb',56,$1,$2,$3,0,false,$4)`,
        [
          item.input.asset.contractAddress.toLowerCase(),
          tokenId.toString(),
          seller.address.toLowerCase(),
          cursorHash
        ]
      );
    }
    const service = new BnbAdmissionService(runtime, item.client, policy, {
      confirmations: 20n,
      indexerMaxAgeMs: 720000,
      now: () => now
    });
    const draft = {
      asset: item.request.asset,
      lifecycle: item.request.lifecycle,
      order: item.request.order
    };
    return { ...item, service, draft };
  }

  return {
    owner,
    runtime,
    initialize,
    clear,
    close,
    setup,
    nextTokenId: () => ++sequence
  };
}
