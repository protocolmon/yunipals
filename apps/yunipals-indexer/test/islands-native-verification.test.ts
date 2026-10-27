import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const source = vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_SCHEMA: "native_islands",
    READ_DATABASE_SCHEMA: "native_islands_read",
    OWNERSHIP_READ_SCHEMA: "native_islands_read",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_RELEASE_ID: `0x${"11".repeat(32)}`,
    YUNIPALS_PROJECTION_MODE: "generation"
  });
  return { ready: true, physicalSchema: "native_islands", block: "26091228" };
});
vi.mock("../lib/ownership/readiness.js", async (original) => ({
  ...(await original<typeof import("../lib/ownership/readiness.js")>()),
  unifiedOwnershipStatus: async () => ({
    ready: source.ready,
    identity: { physical_schema: source.physicalSchema },
    collections: [{ available: source.ready, block_number: source.block }]
  })
}));

import { islandCollection, ZERO_ADDRESS } from "../lib/constants.js";
import { verifyIslandsOwnership } from "../lib/islands/verify.js";
import { publishIslandMetadata } from "../lib/islands/publication.js";

const db = new PGlite();
const statements: string[] = [];
let invalidateMintAfterPublication = false;
const query = async (sql: string, params?: unknown[]) => {
  statements.push(sql);
  const result = await db.query(sql, params);
  if (
    invalidateMintAfterPublication &&
    sql.includes("INSERT INTO metadata.island_publication")
  ) {
    invalidateMintAfterPublication = false;
    // Inject a source change before the final canonical read.
    await db.query(
      "UPDATE native_islands.transfer_event SET transaction_hash=$1",
      [`0x${"44".repeat(32)}`]
    );
  }
  return result;
};
const pool = {
  query,
  connect: async () => ({ query, release: () => undefined })
} as unknown as Pool;
const hash = `0x${"22".repeat(32)}`;
const owner = "0x0000000000000000000000000000000000000001";
const block = 26_091_208n;
const job = {
  tokenId: "1",
  lifecycle: 1,
  mintTransactionHash: hash,
  mintLogIndex: 0,
  attempts: 0
};
const observation = {
  uri: "https://meta.polychainmonsters.com/v1/island-meta/grassland/10000000",
  blockNumber: block,
  blockHash: hash,
  metadataStorage: owner,
  genesisLimit: 1000n
};
const document = { name: "Grassland Genesis Island", image: "ipfs://example" };
const chain = () => ({
  finalizedBlock: async () => ({ number: block, hash }),
  blockHash: async () => hash,
  totalSupply: async () => 1n,
  tokenIds: async () => [1n],
  owners: async () => [owner]
});

beforeAll(async () => {
  await db.exec(`CREATE SCHEMA native_islands; CREATE SCHEMA native_islands_read; CREATE SCHEMA metadata;
    CREATE SCHEMA metadata_source; CREATE SCHEMA yunipals_indexer_control;
    CREATE TABLE yunipals_indexer_control.release(id text PRIMARY KEY,physical_schema text,build_id text);
    CREATE TABLE native_islands.chain_block(chain_id int,block_number bigint,block_hash text);
    CREATE TABLE native_islands.token(collection text,chain_id int,contract_address text,token_id text,
      owner text,burned boolean,lifecycle int,mint_block bigint,mint_timestamp bigint,last_transfer_block bigint,
      last_transfer_timestamp bigint,last_transaction_hash text);
    CREATE TABLE native_islands.token_lifecycle(collection text,token_id text,lifecycle int,minted_to text,
      mint_block bigint,mint_timestamp bigint,mint_transaction_hash text,burned_at_block bigint,
      burned_at_timestamp bigint,burn_transaction_hash text);
    CREATE TABLE native_islands.transfer_event(id text,collection text,chain_id int,contract_address text,
      token_id text,lifecycle int,"from" text,"to" text,block_number bigint,block_timestamp bigint,
      transaction_hash text,transaction_index int,log_index int);
    CREATE VIEW native_islands_read.token AS SELECT * FROM native_islands.token;
    CREATE VIEW native_islands_read.token_lifecycle AS SELECT * FROM native_islands.token_lifecycle;
    CREATE VIEW native_islands_read.transfer_event AS SELECT * FROM native_islands.transfer_event;
    CREATE TABLE metadata.island_publication(collection text,token_id numeric,lifecycle int,
      mint_transaction_hash text,mint_log_index int,status text,revision_hash text,attempts int DEFAULT 0,
      last_error text,uri_checked_at timestamptz,uri_checked_block bigint,next_attempt_at timestamptz,
      updated_at timestamptz,PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE metadata_source.source_blob(content_hash text PRIMARY KEY,payload jsonb);
    CREATE TABLE metadata_source.island_revision(revision_hash text PRIMARY KEY,collection text,token_id numeric,
      lifecycle int,mint_transaction_hash text,mint_log_index int,token_uri text,source_hash text,
      renderer_version text,document_hash text,document jsonb,uri_block bigint,uri_block_hash text,
      metadata_storage text,genesis_limit bigint);
    CREATE TABLE metadata.island_verification(collection text,schema_name text,build_id text,
      checkpoint_block bigint,block_hash text,active_supply int,verified_at timestamptz DEFAULT now(),
      PRIMARY KEY(collection,schema_name,build_id));
    CREATE TABLE metadata.chain_readiness(collection text PRIMARY KEY,state text,checkpoint_block bigint,
      reason text,updated_at timestamptz DEFAULT now(),verified_at timestamptz);
    CREATE ROLE island_metadata_test;
    GRANT USAGE ON SCHEMA native_islands_read,metadata,metadata_source TO island_metadata_test;
    GRANT SELECT ON ALL TABLES IN SCHEMA native_islands_read,metadata,metadata_source TO island_metadata_test;
    GRANT INSERT ON metadata_source.source_blob,metadata_source.island_revision TO island_metadata_test;
    GRANT INSERT,UPDATE ON metadata.island_publication TO island_metadata_test;`);
}, 30_000);

beforeEach(async () => {
  source.ready = true;
  source.physicalSchema = "native_islands";
  source.block = "26091228";
  invalidateMintAfterPublication = false;
  await db.exec(`TRUNCATE native_islands.token,native_islands.token_lifecycle,
    native_islands.transfer_event,native_islands.chain_block,metadata.island_publication,
    metadata_source.island_revision,metadata.island_verification,metadata.chain_readiness,
    metadata_source.source_blob,yunipals_indexer_control.release;`);
  await query(
    "INSERT INTO yunipals_indexer_control.release VALUES($1,'native_islands','native-build')",
    [process.env.OWNERSHIP_RELEASE_ID]
  );
  await query("INSERT INTO native_islands.chain_block VALUES(1,$1,$2)", [
    block.toString(),
    hash
  ]);
  await query(
    "INSERT INTO native_islands.token VALUES($1,1,$2,'1',$3,false,1,14570452,1,14570452,1,$4)",
    [islandCollection.slug, islandCollection.address, owner, hash]
  );
  await query(
    "INSERT INTO native_islands.token_lifecycle VALUES($1,'1',1,$2,14570452,1,$3,NULL,NULL,NULL)",
    [islandCollection.slug, owner, hash]
  );
  await query(
    "INSERT INTO native_islands.transfer_event VALUES('mint',$1,1,$2,'1',1,$3,$4,14570452,1,$5,0,0)",
    [islandCollection.slug, islandCollection.address, ZERO_ADDRESS, owner, hash]
  );
  await query(
    "INSERT INTO metadata.island_publication(collection,token_id,lifecycle,mint_transaction_hash,mint_log_index,status,revision_hash) VALUES($1,1,1,$2,0,'published','revision')",
    [islandCollection.slug, hash]
  );
  await query(
    "INSERT INTO metadata_source.island_revision(revision_hash,collection,token_id,lifecycle,mint_transaction_hash,mint_log_index) VALUES('revision',$1,1,1,$2,0)",
    [islandCollection.slug, hash]
  );
  statements.length = 0;
});
afterAll(async () => db.close());

it("publishes through native read views without source write privileges", async () => {
  const sourceOid = (
    (await query("SELECT 'native_islands.token'::regclass::oid AS oid"))
      .rows[0] as { oid: number }
  ).oid;
  const viewOid = (
    (await query("SELECT 'native_islands_read.token'::regclass::oid AS oid"))
      .rows[0] as { oid: number }
  ).oid;
  await db.exec("SET ROLE island_metadata_test");
  try {
    expect(
      await publishIslandMetadata(
        pool,
        "native_islands_read",
        job,
        observation,
        document
      )
    ).toBe("published");
    const rights = await query(
      "SELECT has_table_privilege(current_user,$1::oid,'UPDATE') AS physical_write,has_table_privilege(current_user,$2::oid,'UPDATE') AS view_write",
      [sourceOid, viewOid]
    );
    expect(rights.rows).toEqual([{ physical_write: false, view_write: false }]);
  } finally {
    await db.exec("RESET ROLE");
  }
});

it("discards staged metadata when the source mint changes before publication", async () => {
  invalidateMintAfterPublication = true;
  expect(
    await publishIslandMetadata(
      pool,
      "native_islands_read",
      job,
      observation,
      document
    )
  ).toBe("obsolete");
  expect(
    (await query("SELECT revision_hash FROM metadata.island_publication")).rows
  ).toEqual([{ revision_hash: "revision" }]);
  expect(
    (await query("SELECT * FROM metadata_source.source_blob")).rows
  ).toHaveLength(0);
});

it("activates only a complete finalized ownership comparison bound to the registered native build", async () => {
  const result = await verifyIslandsOwnership(
    pool,
    "native_islands",
    chain(),
    true
  );
  expect(result).toMatchObject({
    buildId: "native-build",
    activeSupply: 1,
    ownersMatched: 1,
    metadataAvailable: 1,
    activated: true
  });
  expect(
    statements.some((sql) => /_ponder_checkpoint|_ponder_meta/.test(sql))
  ).toBe(false);
  expect(
    (await query("SELECT build_id FROM metadata.island_verification")).rows
  ).toEqual([{ build_id: "native-build" }]);
});

it("refuses mismatched registration, unavailable source and insufficient indexed height", async () => {
  source.physicalSchema = "other";
  await expect(
    verifyIslandsOwnership(pool, "native_islands", chain(), true)
  ).rejects.toThrow("source_mismatch");
  source.physicalSchema = "native_islands";
  source.ready = false;
  await expect(
    verifyIslandsOwnership(pool, "native_islands", chain(), true)
  ).rejects.toThrow("backfill_pending");
  source.ready = true;
  source.block = "26091207";
  await expect(
    verifyIslandsOwnership(pool, "native_islands", chain(), true)
  ).rejects.toThrow("backfill_pending");
  expect(
    (await query("SELECT * FROM metadata.island_verification")).rows
  ).toHaveLength(0);
});

it("requires the exact finalized block hash in the native indexer", async () => {
  await query("UPDATE native_islands.chain_block SET block_hash=$1", [
    `0x${"33".repeat(32)}`
  ]);
  await expect(
    verifyIslandsOwnership(pool, "native_islands", chain(), true)
  ).rejects.toThrow("source_hash_mismatch");
  expect(
    (await query("SELECT * FROM metadata.island_verification")).rows
  ).toHaveLength(0);
});

it("does not activate on owner mismatch or missing metadata", async () => {
  await expect(
    verifyIslandsOwnership(
      pool,
      "native_islands",
      { ...chain(), owners: async () => [ZERO_ADDRESS] },
      true
    )
  ).rejects.toThrow("invalid_island_enumeration");
  await query("DELETE FROM metadata.island_publication");
  await expect(
    verifyIslandsOwnership(pool, "native_islands", chain(), true)
  ).rejects.toThrow("metadata_publication_pending");
  expect(
    (await query("SELECT * FROM metadata.island_verification")).rows
  ).toHaveLength(0);
});
