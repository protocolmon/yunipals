import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { CollectionSlug } from "../lib/constants.js";

const state = vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_SCHEMA: "count_ethereum",
    READ_DATABASE_SCHEMA: "count_source",
    BNB_DATABASE_SCHEMA: "count_bnb",
    OWNERSHIP_READ_MODE: "legacy"
  });
  return { fresh: true };
});
vi.mock("../lib/metadata/read-cache.js", () => ({
  readCacheFreshSql: () => (state.fresh ? "true" : "false")
}));

import { cachedExactCountSql } from "../lib/api/cached-exact-count.js";
import { activeVisibilityPredicate } from "../lib/api/visibility-query.js";

const db = new PGlite();

beforeAll(async () => {
  await db.exec(`
    CREATE SCHEMA count_ethereum;
    CREATE SCHEMA count_bnb;
    CREATE SCHEMA count_source;
    CREATE SCHEMA metadata_projection;
    CREATE SCHEMA metadata;
    CREATE TABLE count_ethereum.token(collection text,token_id text,lifecycle int,owner text,burned boolean);
    CREATE TABLE count_bnb.token(LIKE count_ethereum.token);
    CREATE VIEW count_source.token AS SELECT * FROM count_ethereum.token UNION ALL SELECT * FROM count_bnb.token;
    CREATE TABLE count_source.transfer_event(id text,collection text,token_id text,lifecycle int,
      "from" text,"to" text,block_number bigint,transaction_index int,log_index int);
    CREATE TABLE metadata_projection.read_member(generation_id bigint,collection text,token_id numeric,
      lifecycle int,metadata_available boolean,rarity_points_capped numeric);
    CREATE TABLE metadata.token_visibility(collection text,token_id numeric,owner text,lifecycle int,
      anchor_event_id text,anchor_block bigint,anchor_transaction_index int,anchor_log_index int);
    INSERT INTO count_ethereum.token VALUES
      ('ethereum','1',1,'owner',false),('ethereum','2',1,'zero',true),
      ('ethereum','3',1,'owner',false),('ethereum','4',1,'zero',true);
    INSERT INTO count_bnb.token VALUES
      ('bnb','5',1,'owner',false),('bnb','6',1,'owner',true),('bnb','7',1,'owner',false);
    INSERT INTO metadata_projection.read_member VALUES
      (1,'ethereum',1,1,true,5),(1,'ethereum',2,1,true,2),
      (1,'ethereum',3,1,true,9),(1,'ethereum',4,1,false,null),
      (1,'bnb',5,1,false,null),(1,'bnb',6,1,true,8),(1,'bnb',7,1,true,7),
      (2,'bnb',99,1,true,100);
    INSERT INTO count_source.transfer_event
      SELECT collection||token_id,collection,token_id,lifecycle,'zero',owner,1,0,0 FROM count_source.token;
    INSERT INTO metadata.token_visibility VALUES
      ('ethereum',3,'owner',1,'ethereum3',1,0,0),
      ('ethereum',4,'old-owner',1,'ethereum4',1,0,0),
      ('bnb',6,'owner',1,'bnb6',1,0,0),
      ('bnb',7,'owner',1,'bnb7',1,0,0);
    INSERT INTO count_source.transfer_event VALUES('later','bnb','7',1,'another','owner',2,0,0);
  `);
});
afterAll(() => db.close());

it("matches live-token joins for burn, metadata, rarity and visibility filters", async () => {
  for (const relations of [
    ["count_source.token"],
    ["count_ethereum.token", "count_bnb.token"]
  ]) {
    for (const chains of [
      ["ethereum"],
      ["ethereum", "bnb"]
    ] as CollectionSlug[][]) {
      for (const burned of [undefined, false, true]) {
        for (const available of [undefined, false, true]) {
          for (const minimum of [false, true]) {
            const values: unknown[] = [chains];
            const filters = ["t.collection=ANY($1::text[])"];
            if (burned !== undefined) {
              values.push(burned);
              filters.push(`t.burned = $${values.length}`);
            }
            if (available !== undefined) {
              values.push(available);
              filters.push(
                `COALESCE(s.metadata_available,false)=$${values.length}`
              );
            }
            if (minimum) filters.push("s.rarity_points_capped>=4");
            const baseline = `SELECT count(*)::int AS total FROM count_source.token t
              LEFT JOIN metadata_projection.read_member s ON s.generation_id=1
                AND s.collection=t.collection AND s.token_id=t.token_id::numeric AND s.lifecycle=t.lifecycle
              WHERE ${filters.join(" AND ")} AND NOT ${activeVisibilityPredicate()}`;
            const optimized = cachedExactCountSql({
              chains,
              generation: "1",
              relations,
              filters,
              burned,
              fallback: baseline
            });
            expect((await db.query(optimized, values)).rows).toEqual(
              (await db.query(baseline, values)).rows
            );
          }
        }
      }
    }
  }
});

it("uses the canonical fallback when cache provenance is stale", async () => {
  state.fresh = false;
  try {
    const sql = cachedExactCountSql({
      chains: ["ethereum"],
      generation: "1",
      relations: ["count_source.token"],
      filters: ["t.collection=ANY($1::text[])", "t.burned = $2"],
      burned: false,
      fallback: "SELECT 77::int AS total"
    });
    expect((await db.query(sql, [["ethereum"], false])).rows).toEqual([
      { total: 77 }
    ]);
  } finally {
    state.fresh = true;
  }
});

it("rejects inconsistent burn-filter inputs", () => {
  const input = {
    chains: ["ethereum"] as CollectionSlug[],
    generation: "1",
    relations: ["count_source.token"],
    filters: ["t.collection=ANY($1::text[])"],
    fallback: "SELECT 1 AS total"
  };
  expect(() => cachedExactCountSql({ ...input, burned: false })).toThrow(
    "matching token filter"
  );
  expect(() =>
    cachedExactCountSql({
      ...input,
      filters: [...input.filters, "t.burned = $2"]
    })
  ).toThrow("matching token filter");
});
