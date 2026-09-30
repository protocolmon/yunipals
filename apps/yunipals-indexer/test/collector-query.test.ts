import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

vi.hoisted(() => {
  process.env.DATABASE_SCHEMA = "collector_test";
  process.env.READ_DATABASE_SCHEMA = "collector_read";
  process.env.BNB_DATABASE_SCHEMA = "collector_bnb";
});

import {
  collectorQuery,
  parseCollectorRequest,
  type CollectorRow,
} from "../lib/api/collector-query.js";
import { collectionSlugs } from "../lib/constants.js";
import type { ResolvedOwner } from "../lib/ens/resolver.js";

const address = "0x0000000000000000000000000000000000000001";
const owner: ResolvedOwner = {
  input: address,
  normalizedName: null,
  addresses: Object.fromEntries(
    collectionSlugs.map((chain) => [chain, address]),
  ),
};
const request = (params = "") =>
  parseCollectorRequest(new URLSearchParams(params));

describe("collector query contract", () => {
  it("rejects unsupported filters and unbounded requests", () => {
    for (const params of [
      "limit=0",
      "limit=49",
      "limit=2.5",
      "limit=2&limit=3",
      "q=x",
      "q=a&q=b",
      "q=%23abc",
      "chain=unknown",
      "sort=price-asc",
      "visibility=all",
      "sale=listed",
      "rarityMin=-1",
      "rarityMax=1e3",
      "rarityMin=20&rarityMax=10",
      "rarityMin=1&rarityMin=2",
      `q=${"a".repeat(81)}`,
      `q=${2n ** 256n}`,
      Array.from({ length: 21 }, (_, i) => `t.Type=${i}`).join("&"),
    ])
      expect(() => request(params)).toThrow();
    expect(request("q=%230000123").filters.search).toBe("123");
    expect(request("rarityMin=001.5000&rarityMax=020.00").filters).toMatchObject(
      { rarityMin: "1.5", rarityMax: "20" },
    );
  });
  it("binds cursors to owners, filters, visibility and page size; expires them", () => {
    const page = collectorQuery(request("limit=1"), owner, 1000).page([
      {
        chain: "base",
        tokenId: "1",
        rarityPoints: "1",
        rarityPointsCapped: null,
      },
      {
        chain: "base",
        tokenId: "2",
        rarityPoints: null,
        rarityPointsCapped: null,
      },
    ]);
    const cursor = encodeURIComponent(page.nextCursor!);
    expect(() =>
      collectorQuery(request(`limit=1&cursor=${cursor}`), owner, 1001),
    ).not.toThrow();
    for (const change of [
      "limit=2",
      "limit=1&t.Color=Blue",
      "limit=1&visibility=hidden",
      "limit=1&sort=rarity-capped-asc",
      "limit=1&rarityMin=10",
    ])
      expect(() =>
        collectorQuery(request(`${change}&cursor=${cursor}`), owner, 1001),
      ).toThrow();
    expect(() =>
      collectorQuery(
        request(`limit=1&cursor=${cursor}`),
        {
          ...owner,
          addresses: { base: "0x0000000000000000000000000000000000000002" },
        },
        1001,
      ),
    ).toThrow();
    expect(() =>
      collectorQuery(request(`limit=1&cursor=${cursor}`), owner, 901001),
    ).toThrow();
  });
});

type Database = {
  exec: (sql: string) => Promise<unknown>;
  query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>;
  close: () => Promise<void>;
};
// The in-process PGlite fixture never connects to a live database.
describe(
  "collector SQL on PostgreSQL",
  () => {
    let db: Database;
    beforeAll(async () => {
      db = new PGlite();
      await db.exec(`
      CREATE SCHEMA collector_test; CREATE SCHEMA collector_bnb; CREATE SCHEMA collector_read; CREATE SCHEMA metadata;
      CREATE TABLE collector_test.token(collection text,chain_id int,contract_address text,token_id text,owner text,burned boolean,lifecycle int,mint_block bigint,last_transfer_block bigint,PRIMARY KEY(collection,token_id));
      CREATE INDEX owner_idx ON collector_test.token(collection,owner);
      CREATE TABLE collector_bnb.token(LIKE collector_test.token INCLUDING ALL);
      CREATE VIEW collector_read.token AS SELECT * FROM collector_test.token UNION ALL SELECT * FROM collector_bnb.token;
      CREATE TABLE collector_read.transfer_event(id text PRIMARY KEY,collection text,token_id text,lifecycle int,"from" text,"to" text,block_number bigint,transaction_index int,log_index int);
      CREATE INDEX transfer_token_idx ON collector_read.transfer_event(collection,token_id,lifecycle);
      CREATE TABLE metadata.token_visibility(collection text,token_id numeric,owner text,lifecycle int,anchor_event_id text,anchor_block bigint,anchor_transaction_index int,anchor_log_index int,PRIMARY KEY(collection,token_id));
      CREATE TABLE metadata.token_search(collection text,token_id numeric,lifecycle int,metadata_available boolean,rarity_points numeric,rarity_points_capped numeric,PRIMARY KEY(collection,token_id,lifecycle));
      CREATE TABLE metadata.token_metadata(collection text,token_id numeric,lifecycle int,name text,image text,attributes jsonb,token_uri text,fetch_status text DEFAULT 'success',document jsonb DEFAULT '{"id":"fixture","name":"fixture","attributes":[]}',PRIMARY KEY(collection,token_id,lifecycle));
      CREATE TABLE metadata.token_trait(collection text,token_id numeric,lifecycle int,trait_type text,value text,PRIMARY KEY(collection,token_id,lifecycle,trait_type,value));
      CREATE INDEX trait_filter_idx ON metadata.token_trait(collection,trait_type,value,token_id,lifecycle);
      INSERT INTO collector_test.token SELECT chain,1,'0xcontract',id::text,'${address}',false,1,1,1 FROM unnest(ARRAY['ethereum','base','polygon']) chain CROSS JOIN generate_series(1,35) id;
      INSERT INTO collector_bnb.token SELECT 'bnb',56,'0xcontract',id::text,'${address}',false,1,1,1 FROM generate_series(1,35) id;
      INSERT INTO metadata.token_search SELECT collection,token_id::numeric,1,true,CASE WHEN token_id::int<=32 THEN (token_id::int/3)::numeric END,CASE WHEN token_id::int<=29 THEN (token_id::int/4)::numeric END FROM collector_read.token;
      INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,name,image,attributes,token_uri) SELECT collection,token_id::numeric,1,CASE WHEN token_id='2' THEN '100% Real' ELSE 'Water '||token_id END,NULL,'[]',NULL FROM collector_read.token;
      INSERT INTO metadata.token_trait SELECT collection,token_id::numeric,1,'Type',CASE WHEN token_id::int%2=0 THEN 'Water' ELSE 'Fire' END FROM collector_read.token;
      INSERT INTO metadata.token_trait SELECT collection,token_id::numeric,1,'Color',CASE WHEN token_id::int%3=0 THEN 'Blue' ELSE 'Red' END FROM collector_read.token;
      INSERT INTO collector_read.transfer_event VALUES('anchor','base','1',1,'0xold','${address}',1,0,0);
      INSERT INTO metadata.token_visibility VALUES('base',1,'${address}',1,'anchor',1,0,0);
      ANALYZE;
    `);
    }, 30_000);
    afterAll(async () => {
      await db?.close();
    });
    async function page(params = "") {
      const statement = collectorQuery(request(params), owner);
      const result = await db.query<
        CollectorRow & { hidden: boolean; name: string }
      >(statement.text, statement.values);
      return statement.page(result.rows);
    }
    const keys = (items: CollectorRow[]) =>
      items.map((row) => `${row.chain}:${row.tokenId}`);
    it.each(["rarity-capped-asc", "rarity-capped-desc"])(
      "traverses all pages both ways with equal scores and nulls: %s",
      async (sort) => {
        const pages = [await page(`sort=${sort}`)];
        while (pages.at(-1)!.nextCursor) {
          expect(pages.length).toBeLessThan(20);
          pages.push(
            await page(`sort=${sort}&cursor=${pages.at(-1)!.nextCursor}`),
          );
        }
        const items = pages.flatMap((page) => page.items);
        expect(items.length).toBe(139);
        expect(new Set(keys(items)).size).toBe(139);
        expect(
          items
            .slice(-12)
            .every(
              (row) =>
                row.rarityPoints === null && row.rarityPointsCapped === null,
            ),
        ).toBe(true);
        const values = items
          .slice(0, -12)
          .map((row) => Number(row.rarityPointsCapped ?? row.rarityPoints));
        expect(values).toEqual(
          [...values].sort((a, b) => (sort.endsWith("asc") ? a - b : b - a)),
        );
        let current = pages.at(-1)!;
        for (let index = pages.length - 2; index >= 0; index--) {
          expect(current.previousCursor).toBeTruthy();
          current = await page(`sort=${sort}&cursor=${current.previousCursor}`);
          expect(keys(current.items)).toEqual(keys(pages[index]!.items));
        }
        expect(current.previousCursor).toBeNull();
      },
    );
    it("combines traits across the full wallet and supports exact ID and escaped name-prefix search", async () => {
      const result = await page("t.Type=Water&t.Color=Blue&chain=bnb");
      expect(result.items.map((row) => row.tokenId).sort()).toEqual(
        ["6", "12", "18", "24", "30"].sort(),
      );
      expect((await page("q=35")).items).toHaveLength(4);
      expect((await page("q=100%25")).items).toHaveLength(4);
      expect((await page("q=Water%2035")).items).toHaveLength(4);
      expect((await page("q=no%20match")).items).toHaveLength(0);
    });
    it("filters the effective rarity score inclusively and excludes missing scores", async () => {
      const bounded = await page("rarityMin=4&rarityMax=5");
      expect(bounded.items).toHaveLength(24);
      expect(
        bounded.items.every((row) => {
          const score = Number(row.rarityPointsCapped ?? row.rarityPoints);
          return score >= 4 && score <= 5;
        }),
      ).toBe(true);
      expect((await page("rarityMin=1000")).items).toHaveLength(0);
      expect((await page("rarityMax=0")).items).toHaveLength(11);
    });
    it("only honors current ownership-anchored visibility", async () => {
      const hidden = await page("visibility=hidden");
      expect(keys(hidden.items)).toEqual(["base:1"]);
      expect(hidden.items[0]!.hidden).toBe(true);
      await db.exec(
        "INSERT INTO collector_read.transfer_event VALUES('later','base','1',1,'0xold','0xnew',2,0,0)",
      );
      expect((await page("visibility=hidden")).items).toHaveLength(0);
      await db.exec(
        "DELETE FROM collector_read.transfer_event WHERE id='later'",
      );
    });
    it("fills pages and traverses both ways when hidden rows exceed the page size", async () => {
      await db.exec(`
        INSERT INTO collector_read.transfer_event
          SELECT 'bulk-'||collection||'-'||token_id,collection,token_id,1,'0xold','${address}',1,0,0
          FROM collector_read.token WHERE token_id::int<=15 AND NOT(collection='base' AND token_id='1');
        INSERT INTO metadata.token_visibility
          SELECT collection,token_id::numeric,'${address}',1,id,1,0,0 FROM collector_read.transfer_event WHERE id LIKE 'bulk-%';
      `);
      try {
        const pages = [await page("sort=rarity-capped-asc")];
        expect(pages[0]!.items).toHaveLength(24);
        while(pages.at(-1)!.nextCursor) pages.push(await page(`sort=rarity-capped-asc&cursor=${pages.at(-1)!.nextCursor}`));
        const items = pages.flatMap(p => p.items);
        expect(items).toHaveLength(80);
        expect(new Set(keys(items)).size).toBe(80);
        expect(items.every(item=>Number(item.tokenId)>15)).toBe(true);
        let current = pages.at(-1)!;
        for(let i=pages.length-2;i>=0;i--){
          current=await page(`sort=rarity-capped-asc&cursor=${current.previousCursor}`);
          expect(keys(current.items)).toEqual(keys(pages[i]!.items));
        }
      } finally {
        await db.exec("DELETE FROM metadata.token_visibility WHERE anchor_event_id LIKE 'bulk-%'; DELETE FROM collector_read.transfer_event WHERE id LIKE 'bulk-%'");
      }
    });
    it("does not join metadata from an older lifecycle", async () => {
      await db.exec(
        "UPDATE collector_bnb.token SET lifecycle=2 WHERE token_id='35'",
      );
      expect((await page("chain=bnb&q=35")).items[0]!.name).toBeNull();
      expect((await page("chain=bnb&q=Water%2035")).items).toHaveLength(0);
      await db.exec(
        "UPDATE collector_bnb.token SET lifecycle=1 WHERE token_id='35'",
      );
    });
    it.skipIf(!process.env.COLLECTOR_BENCHMARK)(
      "measures a 10,000-holding wallet among 100,000 other candidate rows",
      async () => {
        await db.exec(`
      INSERT INTO collector_test.token SELECT chain,1,'0xcontract',id::text,CASE WHEN id%10=0 THEN '${address}' ELSE '0x0000000000000000000000000000000000000002' END,false,1,1,1 FROM unnest(ARRAY['ethereum','base','polygon']) chain CROSS JOIN generate_series(1000,25999) id;
      INSERT INTO collector_bnb.token SELECT 'bnb',56,'0xcontract',id::text,CASE WHEN id%10=0 THEN '${address}' ELSE '0x0000000000000000000000000000000000000002' END,false,1,1,1 FROM generate_series(1000,25999) id;
      INSERT INTO metadata.token_search SELECT collection,token_id::numeric,1,true,token_id::int%997,token_id::int%991 FROM collector_read.token WHERE token_id::numeric>=1000;
      INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,name,image,attributes,token_uri) SELECT collection,token_id::numeric,1,'Water '||token_id,NULL,'[]',NULL FROM collector_read.token WHERE token_id::numeric>=1000;
      INSERT INTO metadata.token_trait SELECT collection,token_id::numeric,1,'Type',CASE WHEN token_id::int%3=0 THEN 'Water' ELSE 'Fire' END FROM collector_read.token WHERE token_id::numeric>=1000;
      INSERT INTO metadata.token_trait SELECT collection,token_id::numeric,1,'Color',CASE WHEN token_id::int%7=0 THEN 'Blue' ELSE 'Red' END FROM collector_read.token WHERE token_id::numeric>=1000;
      CREATE INDEX name_prefix_idx ON metadata.token_metadata(collection,lower(name) text_pattern_ops,token_id,lifecycle);
      ANALYZE;
    `);
        const measurements: Record<string, unknown> = {};
        const first = await page();
        let deep = first;
        let pageCount = 1;
        const seen = new Set(keys(first.items));
        while (deep.nextCursor) {
          deep = await page(`cursor=${deep.nextCursor}`);
          for (const key of keys(deep.items)) {
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }
          pageCount++;
        }
        expect(seen.size).toBe(10139);
        const scenarios = {
          deepPrevious: `cursor=${deep.previousCursor}`,
          first: "",
          ascending: "sort=rarity-capped-asc",
          traits: "t.Type=Water&t.Color=Blue",
          rarityWide: "rarityMin=1&rarityMax=990",
          rarityNarrow: "rarityMin=300&rarityMax=310",
          noMatches: "t.Color=missing",
          exactId: "q=25990",
          broadPrefix: "q=water",
          selectivePrefix: "q=water%2025990",
          next: `cursor=${first.nextCursor}`,
        };
        for (const [name, params] of Object.entries(scenarios)) {
          const statement = collectorQuery(request(params), owner);
          const timings: number[] = [];
          for (let i = 0; i < 12; i++) {
            const started = performance.now();
            await db.query(statement.text, statement.values);
            timings.push(performance.now() - started);
          }
          timings.sort((a, b) => a - b);
          const plan = await db.query(
            "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + statement.text,
            statement.values,
          );
          measurements[name] = {
            medianMs: timings[6],
            p95Ms: timings[11],
            plan: plan.rows,
          };
        }
        const { writeFile } = await import("node:fs/promises");
        const output =
          process.env.COLLECTOR_BENCHMARK_OUTPUT ??
          "/tmp/yunipals-collector-sql-benchmark.json";
        await writeFile(
          output,
          JSON.stringify(
            {
              engine:
                "PGlite isolated PostgreSQL, sequential warm reads; not a production concurrency benchmark",
              tokenRows: 100140,
              ownerRows: 10140,
              traversedPages: pageCount,
              measurements,
            },
            null,
            2,
          ),
        );
        console.log(
          "Collector benchmark:",
          Object.fromEntries(
            Object.entries(measurements).map(([name, value]) => [
              name,
              (value as { p95Ms: number }).p95Ms,
            ]),
          ),
          output,
        );
      },
      120_000,
    );
  },
);
