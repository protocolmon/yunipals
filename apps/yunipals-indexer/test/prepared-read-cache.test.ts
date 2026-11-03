import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.OWNERSHIP_READ_MODE = "legacy";
  process.env.METADATA_SOURCE_MODE = "legacy-http";
  process.env.BASE_METADATA_INGESTION = "rpc";
});
import {
  readCacheFreshSql,
  preparedReadCacheFreshSql
} from "../lib/metadata/read-cache.js";
const db = new PGlite();
const proof = async (prepared: boolean) =>
  (
    await db.query<{ fresh: boolean }>(
      `SELECT ${prepared ? preparedReadCacheFreshSql("115", ["ethereum"]) : readCacheFreshSql("115", ["ethereum"])} AS fresh`
    )
  ).rows[0]!.fresh;
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA metadata_projection;
    CREATE TABLE metadata_projection.active(current_id bigint,previous_id bigint);
    CREATE TABLE metadata_projection.generation(id bigint,state text,source_mode text,published_at timestamptz);
    CREATE TABLE metadata_projection.read_epoch(collection text,revision bigint);
    CREATE TABLE metadata_projection.read_set(generation_id bigint,collection text,revision bigint,guard_count integer,source_mode text);
    CREATE TABLE metadata_projection.read_guard(collection text,relation text,relation_oid oid);
    CREATE TABLE metadata_projection.source(id integer);
    CREATE FUNCTION metadata_projection.dirty() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$;
    CREATE TRIGGER read_cache_dirty AFTER INSERT ON metadata_projection.source FOR EACH ROW EXECUTE FUNCTION metadata_projection.dirty();
    CREATE TRIGGER read_cache_truncate AFTER TRUNCATE ON metadata_projection.source FOR EACH STATEMENT EXECUTE FUNCTION metadata_projection.dirty();
    ALTER TABLE metadata_projection.source ENABLE ALWAYS TRIGGER read_cache_dirty;
    ALTER TABLE metadata_projection.source ENABLE ALWAYS TRIGGER read_cache_truncate;
    INSERT INTO metadata_projection.active VALUES(114,113);
    INSERT INTO metadata_projection.generation VALUES(115,'ready','legacy',NULL);
    INSERT INTO metadata_projection.read_epoch VALUES('ethereum',1);
    INSERT INTO metadata_projection.read_set VALUES(115,'ethereum',1,1,'legacy-http');
    INSERT INTO metadata_projection.read_guard VALUES('ethereum','metadata_projection.source','metadata_projection.source'::regclass);`);
});
afterAll(() => db.close());
it("keeps unpublished candidates unavailable to runtime readers while checking their full cache proof", async () => {
  expect(await proof(true)).toBe(true);
  expect(await proof(false)).toBe(false);
  await db.exec("UPDATE metadata_projection.read_epoch SET revision=2");
  expect(await proof(true)).toBe(false);
  await db.exec(
    "UPDATE metadata_projection.read_epoch SET revision=1; ALTER TABLE metadata_projection.source DISABLE TRIGGER read_cache_dirty"
  );
  expect(await proof(true)).toBe(false);
  await db.exec(
    "ALTER TABLE metadata_projection.source ENABLE ALWAYS TRIGGER read_cache_dirty; UPDATE metadata_projection.active SET current_id=115,previous_id=114"
  );
  expect(await proof(true)).toBe(false);
  expect(await proof(false)).toBe(true);
  await db.exec(
    "UPDATE metadata_projection.active SET current_id=116,previous_id=114; UPDATE metadata_projection.generation SET published_at=now()"
  );
  expect(await proof(true)).toBe(false);
  expect(await proof(false)).toBe(false);
});
