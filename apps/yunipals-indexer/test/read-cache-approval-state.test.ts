import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.OWNERSHIP_READ_MODE = "legacy";
  process.env.METADATA_SOURCE_MODE = "legacy-http";
  process.env.BASE_METADATA_INGESTION = "rpc";
});
import { readCacheSchemaStatements } from "../lib/metadata/read-cache-schema.js";

const db = new PGlite();
const state = "metadata_source.native_base_metadata_state";
const revision = async () =>
  (
    await db.query<{ revision: number }>(
      "SELECT revision::int FROM metadata_projection.read_epoch WHERE collection='base'"
    )
  ).rows[0]!.revision;

beforeAll(async () => {
  const dirty = readCacheSchemaStatements.find((statement) =>
    statement.includes("FUNCTION metadata_projection.read_cache_dirty()")
  );
  await db.exec(`CREATE SCHEMA metadata_projection;
    CREATE SCHEMA metadata_source;
    CREATE TABLE metadata_projection.read_epoch(collection text PRIMARY KEY,revision bigint NOT NULL);
    INSERT INTO metadata_projection.read_epoch VALUES('base',1),('ethereum',1);
    CREATE TABLE ${state}(release_id text PRIMARY KEY,read_identity text,state text,
      frontier text,implementation text,checked_block bigint,checked_hash text,
      checked_at timestamptz,error_code text);
    ${dirty};
    CREATE TRIGGER read_cache_dirty AFTER INSERT OR DELETE OR UPDATE ON ${state} FOR EACH ROW
      EXECUTE FUNCTION metadata_projection.read_cache_dirty('native_base_approval');`);
});
beforeEach(async () => {
  await db.exec(`ALTER TABLE ${state} DISABLE TRIGGER read_cache_dirty;
    DELETE FROM ${state};
    INSERT INTO ${state} VALUES('release','identity','ready','frontier','implementation',
      1,'hash',now(),NULL);
    ALTER TABLE ${state} ENABLE TRIGGER read_cache_dirty;
    UPDATE metadata_projection.read_epoch SET revision=1;`);
});
afterAll(() => db.close());

it("keeps the read set when a failed check blocks and a later one restores", async () => {
  await db.exec(
    `UPDATE ${state} SET state='blocked',error_code='native_base_check_failed'`
  );
  expect(await revision()).toBe(1);
  await db.exec(
    `UPDATE ${state} SET state='ready',error_code=NULL,checked_block=2,checked_hash='next',checked_at=now()`
  );
  expect(await revision()).toBe(1);
});

it.each(["read_identity", "frontier", "implementation"])(
  "invalidates the read set when %s changes",
  async (field) => {
    await db.exec(`UPDATE ${state} SET ${field}='changed'`);
    expect(await revision()).toBe(2);
  }
);

it("only invalidates Base", async () => {
  await db.exec(`UPDATE ${state} SET frontier='changed'`);
  expect(
    (
      await db.query<{ revision: number }>(
        "SELECT revision::int FROM metadata_projection.read_epoch WHERE collection='ethereum'"
      )
    ).rows[0]!.revision
  ).toBe(1);
});
