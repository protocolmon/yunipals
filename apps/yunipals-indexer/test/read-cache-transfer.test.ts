import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const release = `0x${"22".repeat(32)}`;
vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_SCHEMA: "transfer_source",
    READ_DATABASE_SCHEMA: "transfer_read",
    OWNERSHIP_READ_SCHEMA: "transfer_read",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_RELEASE_ID: `0x${"22".repeat(32)}`,
    METADATA_SOURCE_MODE: "archive",
    YUNIPALS_PROJECTION_MODE: "generation"
  });
});

import { readCacheFreshSql } from "../lib/metadata/read-cache.js";

const db = new PGlite();
const hash = (block: number) => `0x${block.toString(16).padStart(64, "0")}`;
const zero = `0x${"00".repeat(20)}`;
const alice = `0x${"aa".repeat(20)}`;
const bob = `0x${"bb".repeat(20)}`;
const boundary = 5000;

const fresh = async () =>
  (
    await db.query<{ fresh: boolean }>(
      `SELECT ${readCacheFreshSql("134", ["bnb"])} AS fresh`
    )
  ).rows[0]!.fresh;
/** Valid apart from changed data, so only waiting for its rebuild. */
const usable = async () =>
  (
    await db.query<{ usable: boolean }>(
      `SELECT ${readCacheFreshSql("134", ["bnb"], { allowChanged: true })} AS usable`
    )
  ).rows[0]!.usable;
const transfer = (block: number, from: string, to: string) =>
  db.query(
    `INSERT INTO transfer_source.transfer_event VALUES('bnb',$1,$2,$3)`,
    [block, from, to]
  );
/** Move the source's confirmation boundary to a block Ponder has indexed. */
const sourceAt = async (block: number) => {
  await db.query(`INSERT INTO transfer_source.chain_block VALUES(56,$1,$2)`, [
    block,
    hash(block)
  ]);
  await db.query(
    `UPDATE yunipals_indexer_control.chain_status SET witness_number=$1,witness_hash=$2`,
    [block, hash(block)]
  );
};

beforeAll(async () => {
  await db.exec(`
    CREATE SCHEMA transfer_source;
    CREATE SCHEMA transfer_read;
    CREATE SCHEMA metadata_projection;
    CREATE SCHEMA yunipals_indexer_control;
    CREATE TABLE transfer_source.chain_block(chain_id int,block_number numeric,block_hash text);
    CREATE TABLE transfer_source.transfer_event(collection text,block_number numeric,"from" text,"to" text);
    CREATE TABLE transfer_read._unified_read_release(singleton boolean,release_id text,identity text);
    CREATE TABLE yunipals_indexer_control.chain_status(release_id text,chain_id int,
      witness_number bigint,witness_hash text,halted boolean,error_code text);
    CREATE FUNCTION transfer_read.source_boundary(selected text)
      RETURNS TABLE(release_id text,chain_id int,policy text,block_number bigint,block_hash text)
      LANGUAGE sql STABLE AS $$
        SELECT '${release}'::text,56,'latest'::text,witness_number,witness_hash
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
      guard_count int,source_mode text,completed_at timestamptz NOT NULL DEFAULT now(),
      ownership_release_id text,ownership_read_identity text,
      ownership_boundary bigint,ownership_boundary_hash text,ownership_policy text,
      member_count bigint,burned_count bigint,PRIMARY KEY(generation_id,collection));
    INSERT INTO transfer_read._unified_read_release VALUES(true,'${release}','identity');
    INSERT INTO metadata_projection.active VALUES(134,130);
    INSERT INTO metadata_projection.generation VALUES(134,'ready','archive','${release}','identity');
    INSERT INTO metadata_projection.read_epoch VALUES('bnb',3);
    INSERT INTO yunipals_indexer_control.chain_status VALUES('${release}',56,NULL,NULL,false,NULL);
  `);
});
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec(`
    DELETE FROM transfer_source.chain_block;
    DELETE FROM transfer_source.transfer_event;
    DELETE FROM metadata_projection.read_set;
    UPDATE metadata_projection.read_epoch SET revision=3;
    INSERT INTO metadata_projection.read_set VALUES(134,'bnb',3,0,'archive','2026-11-11 15:23:13+00',
      '${release}','identity',${boundary},'${hash(boundary)}','latest',580093,61545);
  `);
  await sourceAt(boundary);
});

it("stays fresh when the boundary crosses a transfer between owners", async () => {
  await transfer(boundary + 10, alice, bob);
  await sourceAt(boundary + 20);
  expect(await fresh()).toBe(true);
});

it("goes stale when the boundary crosses a mint", async () => {
  await transfer(boundary + 10, zero, alice);
  await sourceAt(boundary + 20);
  expect(await fresh()).toBe(false);
});

it("goes stale when the boundary crosses a burn", async () => {
  await transfer(boundary + 10, alice, zero);
  await sourceAt(boundary + 20);
  expect(await fresh()).toBe(false);
});

it("ignores a mint the boundary has not reached", async () => {
  await transfer(boundary + 30, zero, alice);
  await sourceAt(boundary + 20);
  expect(await fresh()).toBe(true);
  await sourceAt(boundary + 30);
  expect(await fresh()).toBe(false);
});

it("stays usable while a mint or a metadata change waits for its rebuild", async () => {
  await transfer(boundary + 10, zero, alice);
  await sourceAt(boundary + 20);
  expect(await fresh()).toBe(false);
  expect(await usable()).toBe(true);
  await db.exec("DELETE FROM transfer_source.transfer_event");
  await db.exec("UPDATE metadata_projection.read_epoch SET revision=4");
  expect(await fresh()).toBe(false);
  expect(await usable()).toBe(true);
});

it("is not usable when it belongs to another release or its block is gone", async () => {
  await db.exec(
    "UPDATE metadata_projection.read_set SET ownership_read_identity='other'"
  );
  expect(await usable()).toBe(false);
  await db.exec(
    "UPDATE metadata_projection.read_set SET ownership_read_identity='identity'"
  );
  expect(await usable()).toBe(true);
  await db.exec("DELETE FROM transfer_source.chain_block");
  expect(await usable()).toBe(false);
});
