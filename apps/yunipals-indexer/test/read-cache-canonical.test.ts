import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_SCHEMA: "cache_source",
    READ_DATABASE_SCHEMA: "cache_source_read",
    OWNERSHIP_READ_SCHEMA: "cache_source_read",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_RELEASE_ID: `0x${"11".repeat(32)}`,
    METADATA_SOURCE_MODE: "archive",
    YUNIPALS_PROJECTION_MODE: "generation"
  });
});

import { stageReadCacheOwnership } from "../lib/metadata/read-cache.js";
import { metadataSearchReadRelationFor } from "../lib/metadata/read-source.js";

const db = new PGlite();
const client = db as unknown as Pick<PoolClient, "query">;
const schema = '"cache_source_read"';

beforeAll(async () => {
  await db.exec(`
    CREATE SCHEMA cache_source;
    CREATE SCHEMA cache_source_read;
    CREATE SCHEMA metadata;
    CREATE SCHEMA metadata_source;
    CREATE SCHEMA metadata_projection;
    CREATE TABLE cache_source.token_lifecycle(collection text,token_id text,lifecycle int,
      mint_transaction_hash text,mint_block numeric);
    CREATE TABLE cache_source.transfer_event(collection text,token_id text,lifecycle int,
      transaction_hash text,block_number numeric,log_index int,"from" text);
    CREATE VIEW cache_source_read.token_lifecycle WITH(security_barrier=true)
      AS SELECT * FROM cache_source.token_lifecycle;
    CREATE VIEW cache_source_read.transfer_event WITH(security_barrier=true)
      AS SELECT * FROM cache_source.transfer_event;
    CREATE TABLE metadata.token_metadata(collection text,token_id numeric,lifecycle int,
      document jsonb,content_hash text);
    CREATE TABLE metadata.token_publication(collection text,token_id numeric,lifecycle int,
      source_kind text,release_id text,asset_key text,renderer_version text,input_hash text,
      publication_content_hash text,publication_status text,publication_error text,published_at timestamptz,
      mint_transaction_hash text,mint_log_index int,chain_event_key text,chain_event_block_hash text);
    CREATE TABLE metadata_source.archive_release(release_id text,state text);
    CREATE TABLE metadata_projection.search(generation_id bigint,collection text,token_id numeric,lifecycle int);
    CREATE TABLE metadata_projection.revision(generation_id bigint,collection text,token_id numeric,
      lifecycle int,metadata_content_hash text);
    INSERT INTO metadata_source.archive_release VALUES('release','active');
    INSERT INTO cache_source.token_lifecycle
      SELECT 'ethereum',id::text,CASE WHEN id=5 THEN 2 ELSE 1 END,'mint',100 FROM generate_series(1,5) id;
    INSERT INTO cache_source.transfer_event
      SELECT 'ethereum',id::text,CASE WHEN id=5 THEN 2 ELSE 1 END,'mint',100,0,
        '0x0000000000000000000000000000000000000000' FROM generate_series(1,5) id;
    INSERT INTO cache_source.token_lifecycle VALUES('base','99',1,'other',100);
    INSERT INTO cache_source.transfer_event VALUES('ethereum','1',1,'transfer',101,1,'owner');
    INSERT INTO metadata.token_metadata
      SELECT 'ethereum',id,1,'{"id":"example","name":"Yunipal","attributes":[]}'::jsonb,'hash'
      FROM generate_series(1,5) id;
    INSERT INTO metadata.token_publication(collection,token_id,lifecycle,source_kind,release_id,
      publication_content_hash,publication_status,mint_transaction_hash,mint_log_index)
      SELECT 'ethereum',id,1,'archive','release','hash','published',
        CASE WHEN id=2 THEN 'wrong' ELSE 'mint' END,CASE WHEN id=3 THEN 9 ELSE 0 END
      FROM generate_series(1,5) id;
    INSERT INTO metadata_projection.search SELECT 1,'ethereum',id,1 FROM generate_series(1,5) id;
    INSERT INTO metadata_projection.revision
      SELECT 1,'ethereum',id,1,CASE WHEN id=4 THEN 'wrong' ELSE 'hash' END FROM generate_series(1,5) id;
  `);
});

afterAll(() => db.close());

it("preserves mint, lifecycle and metadata hash checks while staging only selected mint evidence", async () => {
  await db.exec("BEGIN ISOLATION LEVEL REPEATABLE READ");
  try {
    await stageReadCacheOwnership(client, schema, "ethereum");
    const query = (staged: boolean) =>
      `SELECT token_id::text FROM ${metadataSearchReadRelationFor(schema, false, ["ethereum"], "1", staged)} proof ORDER BY token_id`;
    expect((await db.query(query(false))).rows).toEqual([{ token_id: "1" }]);
    expect((await db.query(query(true))).rows).toEqual([{ token_id: "1" }]);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM pg_temp.transfer_event"
        )
      ).rows
    ).toEqual([{ count: 5 }]);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM pg_temp.token_lifecycle"
        )
      ).rows
    ).toEqual([{ count: 5 }]);
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
  expect(
    (
      await db.query(
        "SELECT to_regclass('pg_temp.token_lifecycle') AS relation"
      )
    ).rows
  ).toEqual([{ relation: null }]);
});

it("drops staging on failure and rejects unregistered ownership schemas", async () => {
  await db.exec("BEGIN");
  await stageReadCacheOwnership(client, schema, "ethereum");
  await db.exec("ROLLBACK");
  expect(
    (await db.query("SELECT to_regclass('pg_temp.transfer_event') AS relation"))
      .rows
  ).toEqual([{ relation: null }]);
  await expect(
    stageReadCacheOwnership(client, '"cache_source"', "ethereum")
  ).rejects.toThrow("selected logical schema");
});
