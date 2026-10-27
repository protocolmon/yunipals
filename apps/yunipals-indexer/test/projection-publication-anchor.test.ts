import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_SCHEMA: "anchor_source",
    OWNERSHIP_READ_MODE: "unified",
    OWNERSHIP_READ_SCHEMA: "anchor_read",
    READ_DATABASE_SCHEMA: "anchor_read",
    OWNERSHIP_RELEASE_ID: `0x${"11".repeat(32)}`,
    YUNIPALS_PROJECTION_MODE: "generation",
    METADATA_SOURCE_MODE: "archive",
    BASE_METADATA_INGESTION: "native"
  });
});
import {
  projectionPublicationSourcePredicate,
  projectionSourceSnapshot
} from "../lib/metadata/projection-snapshot.js";

const db = new PGlite();
const hash = (value: string) => `0x${value.repeat(64)}`;
const release = hash("1");
const manifest = hash("2");
const identity = hash("3");
const chains = [
  ["ethereum", 1],
  ["base", 8453],
  ["polygon", 137],
  ["bnb", 56]
] as const;
const proof = projectionSourceSnapshot({
  version: 1,
  capturedAt: "2026-10-27T00:00:00.000Z",
  releaseId: release,
  manifestHash: manifest,
  readIdentity: identity,
  physicalSchema: "anchor_source",
  metadataReleaseId: "source-release",
  predecessor: "103",
  baseMetadataFrontier: "frontier",
  anchors: chains.map(([collection, chain_id]) => ({
    collection, chain_id, block_number: "100", block_hash: hash("a")
  }))
});
const accepted = async () => (await db.query<{ accepted: boolean }>(
  `SELECT (${projectionPublicationSourcePredicate("$1")}) AS accepted`,
  [JSON.stringify(proof)]
)).rows[0]!.accepted;

async function retained() {
  await db.exec("DELETE FROM anchor_source.chain_block WHERE chain_id=56 AND block_number=100");
  await db.query("INSERT INTO anchor_source.chain_block VALUES(56,200,$1)", [hash("b")]);
  await db.query("INSERT INTO yunipals_indexer_control.chain_anchor VALUES($1,56,100,$2,200,$3)",
    [release, hash("a"), hash("b")]);
}

beforeAll(async () => {
  // The boundary/frame outputs are explicit input fixtures. The complete real
  // publication SQL predicate and all its table joins execute in PostgreSQL.
  await db.exec(`CREATE SCHEMA anchor_source; CREATE SCHEMA anchor_read;
    CREATE SCHEMA metadata; CREATE SCHEMA yunipals_indexer_control;
    CREATE TABLE anchor_source.chain_block(chain_id integer,block_number bigint,block_hash text);
    CREATE TABLE yunipals_indexer_control.release(id text,manifest_hash text,physical_schema text);
    CREATE TABLE yunipals_indexer_control.chain_anchor(
      release_id text,chain_id integer,block_number bigint,block_hash text,
      witness_number bigint,witness_hash text,PRIMARY KEY(release_id,chain_id,block_number));
    CREATE TABLE anchor_read._unified_read_release(singleton boolean,release_id text,identity text,manifest_hash text);
    CREATE TABLE anchor_read.boundaries(collection text,ready boolean,chain_id integer,
      release_id text,manifest_hash text,block_number bigint);
    CREATE FUNCTION anchor_read.source_boundary(text) RETURNS SETOF anchor_read.boundaries
      LANGUAGE sql STABLE AS 'SELECT * FROM anchor_read.boundaries WHERE collection=$1';
    CREATE TABLE anchor_read.frame(block_number bigint,frontier text);
    CREATE FUNCTION anchor_read.base_metadata_frame(boolean) RETURNS SETOF anchor_read.frame
      LANGUAGE sql STABLE AS 'SELECT * FROM anchor_read.frame';
    CREATE TABLE metadata.chain_readiness(collection text,state text,checkpoint_block bigint,verified_at timestamptz);`);
  await db.query("INSERT INTO yunipals_indexer_control.release VALUES($1,$2,'anchor_source')", [release, manifest]);
  await db.query("INSERT INTO anchor_read._unified_read_release VALUES(true,$1,$2,$3)", [release, identity, manifest]);
});

beforeEach(async () => {
  await db.exec(`TRUNCATE anchor_source.chain_block,yunipals_indexer_control.chain_anchor,
    anchor_read.boundaries,anchor_read.frame,metadata.chain_readiness;
    INSERT INTO anchor_read.frame VALUES(200,'frontier');`);
  for (const [collection, chain] of chains) {
    await db.query("INSERT INTO anchor_source.chain_block VALUES($1,100,$2)", [chain, hash("a")]);
    await db.query("INSERT INTO anchor_read.boundaries VALUES($1,true,$2,$3,$4,200)",
      [collection, chain, release, manifest]);
    await db.query("INSERT INTO metadata.chain_readiness VALUES($1,'ready',200,now())", [collection]);
  }
});
afterAll(async () => { await db.close(); });

describe("publication canonical and retained anchors", () => {
  it("accepts exact physical headers for all four immutable anchors", async () => {
    expect(await accepted()).toBe(true);
  });

  it("refuses a missing physical header without retained evidence", async () => {
    await db.exec("DELETE FROM anchor_source.chain_block WHERE chain_id=56");
    expect(await accepted()).toBe(false);
  });

  it("accepts only matching retained evidence with its canonical physical witness", async () => {
    const saved = JSON.stringify(proof);
    await retained();
    expect(await accepted()).toBe(true);
    expect(JSON.stringify(proof)).toBe(saved);
  });

  it("never lets retained evidence override a changed physical header", async () => {
    await retained();
    await db.query("INSERT INTO anchor_source.chain_block VALUES(56,100,$1)", [hash("c")]);
    expect(await accepted()).toBe(false);
    // Deliberately omit a fixture PK so any conflicting physical row is tested.
    await db.query("INSERT INTO anchor_source.chain_block VALUES(56,100,$1)", [hash("a")]);
    expect(await accepted()).toBe(false);
  });

  it.each([
    ["missing witness", "DELETE FROM anchor_source.chain_block WHERE chain_id=56"],
    ["reorged witness", `UPDATE anchor_source.chain_block SET block_hash='${hash("c")}' WHERE chain_id=56`],
    ["wrong release", `UPDATE yunipals_indexer_control.chain_anchor SET release_id='${hash("4")}'`],
    ["wrong chain", "UPDATE yunipals_indexer_control.chain_anchor SET chain_id=1"],
    ["wrong old height", "UPDATE yunipals_indexer_control.chain_anchor SET block_number=99"],
    ["wrong old hash", `UPDATE yunipals_indexer_control.chain_anchor SET block_hash='${hash("c")}'`],
    ["wrong witness height", "UPDATE yunipals_indexer_control.chain_anchor SET witness_number=201"],
    ["wrong witness hash", `UPDATE yunipals_indexer_control.chain_anchor SET witness_hash='${hash("c")}'`]
  ])("refuses retained evidence with %s", async (_, mutation) => {
    await retained();
    await db.exec(mutation);
    expect(await accepted()).toBe(false);
  });

  it.each([
    "UPDATE anchor_read.boundaries SET ready=false WHERE collection='bnb'",
    "UPDATE anchor_read.boundaries SET block_number=99 WHERE collection='bnb'",
    "UPDATE anchor_read.boundaries SET manifest_hash='different' WHERE collection='bnb'",
    "UPDATE metadata.chain_readiness SET state='pending' WHERE collection='bnb'",
    "UPDATE anchor_read.frame SET frontier='different'",
    "UPDATE anchor_read.frame SET block_number=99"
  ])("retains other publication gates: %s", async (mutation) => {
    await retained();
    await db.exec(mutation);
    expect(await accepted()).toBe(false);
  });

  it("still rejects SQL parameter injection", () => {
    expect(() => projectionPublicationSourcePredicate("$1 OR true")).toThrow();
  });
});
