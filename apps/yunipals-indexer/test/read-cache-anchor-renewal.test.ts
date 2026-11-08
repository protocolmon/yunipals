import { PGlite } from "@electric-sql/pglite";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const release = `0x${"11".repeat(32)}`;
vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_SCHEMA: "renewal_source",
    READ_DATABASE_SCHEMA: "renewal_read",
    OWNERSHIP_READ_SCHEMA: "renewal_read",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_RELEASE_ID: `0x${"11".repeat(32)}`,
    METADATA_SOURCE_MODE: "archive",
    YUNIPALS_PROJECTION_MODE: "generation"
  });
});

import {
  readCacheFreshSql,
  renewReadCacheAnchor,
  tryRenewReadCacheAnchor
} from "../lib/metadata/read-cache.js";

const db = new PGlite();
const client = db as unknown as Pick<PoolClient, "query">;
const hash = (block: number) => `0x${block.toString(16).padStart(64, "0")}`;
const boundary = 5000;

const fresh = async () =>
  (
    await db.query<{ fresh: boolean }>(
      `SELECT ${readCacheFreshSql("130", ["ethereum"])} AS fresh`
    )
  ).rows[0]!.fresh;
const renew = () => renewReadCacheAnchor(client, "130", "ethereum");
const anchor = async () =>
  (
    await db.query<{ witness_number: string }>(
      `SELECT witness_number::text FROM yunipals_indexer_control.chain_anchor
       WHERE block_number=${boundary}`
    )
  ).rows[0]?.witness_number;
const addBlock = (block: number) =>
  db.exec(
    `INSERT INTO renewal_source.chain_block VALUES(1,${block},'${hash(block)}')`
  );
const pruneBlock = (block: number) =>
  db.exec(`DELETE FROM renewal_source.chain_block WHERE block_number=${block}`);
/** Move the observer's witness to a block Ponder has indexed. */
const witnessAt = async (block: number) => {
  await addBlock(block);
  await db.exec(
    `UPDATE yunipals_indexer_control.chain_status
     SET witness_number=${block},witness_hash='${hash(block)}'`
  );
};

beforeAll(async () => {
  await db.exec(`
    CREATE SCHEMA renewal_source;
    CREATE SCHEMA renewal_read;
    CREATE SCHEMA metadata_projection;
    CREATE SCHEMA yunipals_indexer_control;
    CREATE TABLE renewal_source.chain_block(chain_id int,block_number numeric,block_hash text);
    CREATE TABLE renewal_source.transfer_event(collection text,block_number numeric);
    CREATE TABLE renewal_read._unified_read_release(singleton boolean,release_id text,identity text);
    CREATE TABLE yunipals_indexer_control.chain_status(release_id text,chain_id int,
      witness_number bigint,witness_hash text,halted boolean,error_code text);
    CREATE FUNCTION renewal_read.source_boundary(selected text)
      RETURNS TABLE(release_id text,chain_id int,policy text,block_number bigint)
      LANGUAGE sql STABLE AS $$
        SELECT '${release}'::text,1,'latest'::text,witness_number
        FROM yunipals_indexer_control.chain_status $$;
    CREATE TABLE yunipals_indexer_control.chain_anchor(release_id text,chain_id int,block_number bigint,
      block_hash text,witness_number bigint,witness_hash text,
      PRIMARY KEY(release_id,chain_id,block_number));
    CREATE TABLE metadata_projection.active(current_id bigint,previous_id bigint);
    CREATE TABLE metadata_projection.generation(id bigint,state text,source_mode text,
      ownership_release_id text,ownership_read_identity text);
    CREATE TABLE metadata_projection.read_epoch(collection text,revision bigint);
    CREATE TABLE metadata_projection.read_guard(collection text,relation text,relation_oid oid);
    CREATE TABLE metadata_projection.read_set(generation_id bigint,collection text,revision bigint,
      guard_count int,source_mode text,ownership_release_id text,ownership_read_identity text,
      ownership_boundary bigint,ownership_boundary_hash text,ownership_policy text,
      member_count bigint,burned_count bigint);
    INSERT INTO renewal_read._unified_read_release VALUES(true,'${release}','identity');
    INSERT INTO metadata_projection.active VALUES(130,129);
    INSERT INTO metadata_projection.generation VALUES(130,'ready','archive','${release}','identity');
    INSERT INTO metadata_projection.read_epoch VALUES('ethereum',1);
    INSERT INTO metadata_projection.read_set VALUES(130,'ethereum',1,0,'archive','${release}','identity',
      ${boundary},'${hash(boundary)}','latest',10,1);
    INSERT INTO yunipals_indexer_control.chain_status VALUES('${release}',1,NULL,NULL,false,NULL);
  `);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec(`
    DELETE FROM renewal_source.chain_block;
    DELETE FROM yunipals_indexer_control.chain_anchor;
    UPDATE yunipals_indexer_control.chain_status SET halted=false,error_code=NULL;
  `);
  await addBlock(boundary);
});

it("keeps a read set fresh after its block ages out of Ponder's window", async () => {
  await witnessAt(boundary + 2000);
  expect(await fresh()).toBe(true);
  expect(await renew()).toBe(1);
  expect(await anchor()).toBe(String(boundary + 2000));
  await pruneBlock(boundary);
  expect(await fresh()).toBe(true);
});

it("goes stale without a renewal once its block ages out", async () => {
  await witnessAt(boundary + 4097);
  await pruneBlock(boundary);
  expect(await fresh()).toBe(false);
});

it("renews from the previous anchor after the block has left the window", async () => {
  await witnessAt(boundary + 2000);
  await renew();
  await pruneBlock(boundary);
  await witnessAt(boundary + 3500);
  expect(await renew()).toBe(1);
  expect(await anchor()).toBe(String(boundary + 3500));
  // The first witness can now age out, too.
  await pruneBlock(boundary + 2000);
  expect(await fresh()).toBe(true);
});

it("renews only when the proof is old enough", async () => {
  await witnessAt(boundary + 1000);
  expect(await renew()).toBe(0);
  expect(await anchor()).toBeUndefined();
  await witnessAt(boundary + 1025);
  expect(await renew()).toBe(1);
  await witnessAt(boundary + 2000);
  expect(await renew()).toBe(0);
  expect(await anchor()).toBe(String(boundary + 1025));
  await witnessAt(boundary + 2050);
  expect(await renew()).toBe(1);
  expect(await anchor()).toBe(String(boundary + 2050));
});

it("does not prove a block that is no longer provable", async () => {
  await witnessAt(boundary + 2000);
  await pruneBlock(boundary);
  expect(await renew()).toBe(0);
  expect(await anchor()).toBeUndefined();
});

it("does not renew through a reverted boundary or witness", async () => {
  // The boundary block now has another hash, so the read set's branch was reorged.
  await witnessAt(boundary + 2000);
  await db.exec(
    `UPDATE renewal_source.chain_block SET block_hash='${hash(1)}' WHERE block_number=${boundary}`
  );
  expect(await renew()).toBe(0);
  expect(await anchor()).toBeUndefined();
  await db.exec(
    `UPDATE renewal_source.chain_block SET block_hash='${hash(boundary)}' WHERE block_number=${boundary}`
  );

  // The anchor's witness was reverted after the boundary left the window.
  await renew();
  await pruneBlock(boundary);
  await pruneBlock(boundary + 2000);
  await witnessAt(boundary + 3500);
  expect(await renew()).toBe(0);
  expect(await anchor()).toBe(String(boundary + 2000));
  expect(await fresh()).toBe(false);
});

it("does not renew with a witness Ponder does not hold", async () => {
  await db.exec(
    `UPDATE yunipals_indexer_control.chain_status
     SET witness_number=${boundary + 2000},witness_hash='${hash(boundary + 2000)}'`
  );
  expect(await renew()).toBe(0);
  await addBlock(boundary + 2000);
  await db.exec(
    `UPDATE renewal_source.chain_block SET block_hash='${hash(1)}' WHERE block_number=${boundary + 2000}`
  );
  expect(await renew()).toBe(0);
  expect(await anchor()).toBeUndefined();
});

it("does not renew while the observer reports a problem", async () => {
  await witnessAt(boundary + 2000);
  await db.exec("UPDATE yunipals_indexer_control.chain_status SET halted=true");
  expect(await renew()).toBe(0);
  await db.exec(
    "UPDATE yunipals_indexer_control.chain_status SET halted=false,error_code='provider_lag'"
  );
  expect(await renew()).toBe(0);
  expect(await anchor()).toBeUndefined();
});

it("never stops the worker when a renewal fails", async () => {
  const failing = (code?: string) =>
    ({
      query: async () => {
        throw Object.assign(new Error("failed"), code ? { code } : {});
      }
    }) as unknown as Pick<PoolClient, "query">;
  expect(
    await tryRenewReadCacheAnchor(failing("42501"), "130", "ethereum")
  ).toEqual({ renewed: false, failure: "42501" });
  expect(await tryRenewReadCacheAnchor(failing(), "130", "ethereum")).toEqual({
    renewed: false,
    failure: "renewal_failed"
  });
  // The freshness check reports an unavailable source.
  expect(
    await tryRenewReadCacheAnchor(failing("YI001"), "130", "ethereum")
  ).toEqual({ renewed: false, failure: null });
  await witnessAt(boundary + 2000);
  expect(await tryRenewReadCacheAnchor(client, "130", "ethereum")).toEqual({
    renewed: true,
    failure: null
  });
});
