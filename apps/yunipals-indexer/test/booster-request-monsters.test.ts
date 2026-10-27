import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import { registerBoosterRoutes } from "../lib/api/booster-routes.js";
import { boosterIdentity } from "../../../packages/yunipals-market-core/src/boosters.js";

const registry = "0x2222222222222222222222222222222222222222";
const engine = "0x3333333333333333333333333333333333333333";
const collection = "0x4444444444444444444444444444444444444444";
const wrapper = "0x5555555555555555555555555555555555555555";
const alice = "0x1111111111111111111111111111111111111111";
const bob = "0x6666666666666666666666666666666666666666";
const originalKey = boosterIdentity(collection, "10");
const typeKey = boosterIdentity(registry, "2");
const requestKey = boosterIdentity(engine, "7");
const ruleHash = `0x${"ab".repeat(32)}`;
const url = `/v1/boosters/requests/${engine}/7/monsters`;
const db = new PGlite();
let ready = true;
const query = vi.fn((sql: string, values?: unknown[]) => db.query(sql, values));
const app = new Hono();
registerBoosterRoutes(app, {
  schemaName: "request_source",
  pool: { query } as never,
  readSnapshot: async () =>
    ready
      ? {
          ready: true,
          indexedBlock: "500",
          indexedBlockHash: null,
          indexedTimestamp: "1800000000",
          buildId: "booster-test",
          requestsPaused: false,
          lastBoosterEvent: null
        }
      : { ready: false, reason: "booster_index_catching_up" }
});

beforeAll(async () => {
  await db.exec(`CREATE SCHEMA request_source;
    CREATE TABLE request_source.booster_type (
      id text PRIMARY KEY,registry text,engine text,rule_hash text,metadata_base_uri text);
    CREATE TABLE request_source.booster_original (
      id text PRIMARY KEY,collection text,engine text,type_key text);
    CREATE TABLE request_source.booster_request (
      id text PRIMARY KEY,engine text,request_id text,original_key text,
      quantity integer,status text,rule_hash text);
    CREATE TABLE request_source.booster_monster (
      id text PRIMARY KEY,collection text,token_id text,original_key text,request_key text,
      type_key text,owner text,minted_to text,variant_id bigint,monster_type bigint,
      color bigint,horn bigint,glitter bigint,is_original boolean,burned boolean,mint_block bigint);`);
});

beforeEach(async () => {
  vi.stubEnv("BOOSTER_REGISTRY", registry);
  vi.stubEnv("BOOSTER_ENGINE", engine);
  vi.stubEnv("BOOSTER_MONSTERS", collection);
  vi.stubEnv("BOOSTER_WRAPPER", wrapper);
  vi.stubEnv("BOOSTER_DEPLOYMENT_BLOCK", "123");
  ready = true;
  await db.exec(`TRUNCATE request_source.booster_monster,request_source.booster_request,
    request_source.booster_original,request_source.booster_type;`);
  await db.query(
    "INSERT INTO request_source.booster_type VALUES($1,$2,$3,$4,$5)",
    [typeKey, registry, engine, ruleHash, "https://example.test/art/"]
  );
  await db.query(
    "INSERT INTO request_source.booster_original VALUES($1,$2,$3,$4)",
    [originalKey, collection, engine, typeKey]
  );
  await db.query(
    "INSERT INTO request_source.booster_request VALUES($1,$2,'7',$3,2,'completed',$4)",
    [requestKey, engine, originalKey, ruleHash]
  );
  query.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => db.close());

async function mint(
  tokenId: string,
  changes: {
    requestKey?: string;
    originalKey?: string;
    typeKey?: string;
    collection?: string;
    mintBlock?: number;
  } = {}
) {
  const target = changes.collection ?? collection;
  await db.query(
    `INSERT INTO request_source.booster_monster VALUES(
    $1,$2,$3,$4,$5,$6,$7,$7,73,3,0,0,1,false,false,$8)`,
    [
      boosterIdentity(target, tokenId),
      target,
      tokenId,
      changes.originalKey ?? originalKey,
      changes.requestKey ?? requestKey,
      changes.typeKey ?? typeKey,
      alice,
      changes.mintBlock ?? 499
    ]
  );
}

describe("request-scoped booster monster sets with real isolated PostgreSQL SQL", () => {
  it("returns only this request's exact set in numeric order, not adjacent global token IDs", async () => {
    await db.query(
      "UPDATE request_source.booster_request SET quantity=3 WHERE id=$1",
      [requestKey]
    );
    for (const id of ["100", "2", "7"]) await mint(id);
    for (const id of ["1", "3", "8", "99"])
      await mint(id, { requestKey: boosterIdentity(engine, "8") });
    const response = await app.request(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      requestId: "7",
      status: "completed",
      quantity: 3,
      collection,
      indexedBlock: "500",
      nextCursor: null
    });
    expect(body.items.map((item: { tokenId: string }) => item.tokenId)).toEqual(
      ["2", "7", "100"]
    );
    expect(
      body.items.every(
        (item: { requestKey: string; metadataUri: string }) =>
          item.requestKey === requestKey &&
          item.metadataUri === "https://example.test/art/73.json"
      )
    ).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.every(([sql]) => /^SELECT /.test(sql))).toBe(true);
  });

  it("preserves provenance after transfer and later burn without filtering by payer or owner", async () => {
    await mint("2");
    await mint("11");
    await db.query(
      "UPDATE request_source.booster_monster SET owner=$1,burned=true WHERE token_id='2'",
      [bob]
    );
    const response = await app.request(`${url}?owner=${alice}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      tokenId: "2",
      owner: bob,
      burned: true,
      mintedTo: alice
    });
  });

  it.each(["pending", "seeded"])(
    "does not expose a reveal while %s",
    async (status) => {
      await db.query("UPDATE request_source.booster_request SET status=$1", [
        status
      ]);
      await mint("2");
      await mint("11");
      const response = await app.request(url);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "request_not_completed",
        status,
        items: []
      });
    }
  );

  it("does not expose forfeited pending mints", async () => {
    await db.exec(
      "UPDATE request_source.booster_request SET status='forfeited'"
    );
    await mint("2");
    await mint("11");
    const response = await app.request(url);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "request_forfeited",
      status: "forfeited",
      items: []
    });
  });

  it("returns 404 for an unindexed request even if global monsters exist", async () => {
    await mint("2");
    await mint("11");
    await db.exec("DELETE FROM request_source.booster_request");
    const response = await app.request(url);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "request_not_indexed" });
  });

  it.each(["01", "-1", (2n ** 256n).toString()])(
    "rejects invalid request ID %s",
    async (id) => {
      expect(
        (await app.request(`/v1/boosters/requests/${engine}/${id}/monsters`))
          .status
      ).toBe(400);
      expect(query).not.toHaveBeenCalled();
    }
  );

  it("rejects a different deployment engine before any SQL read", async () => {
    expect(
      (await app.request(`/v1/boosters/requests/${bob}/7/monsters`)).status
    ).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([1, 3])(
    "refuses a completed set with %d rows instead of its recorded quantity",
    async (count) => {
      for (let i = 0; i < count; i++) await mint(String(i + 20));
      const response = await app.request(url);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "booster_index_unavailable"
      });
    }
  );

  it.each([0, 8])(
    "refuses quantity %d beyond the exact 1..7 request bound",
    async (quantity) => {
      await db.query("UPDATE request_source.booster_request SET quantity=$1", [
        quantity
      ]);
      for (let i = 0; i < 8; i++) await mint(String(i + 20));
      expect((await app.request(url)).status).toBe(503);
    }
  );

  it("returns the complete maximum seven-card set and rejects an eighth matching row", async () => {
    await db.exec("UPDATE request_source.booster_request SET quantity=7");
    for (let i = 0; i < 7; i++) await mint(String(i + 20));
    expect((await (await app.request(url)).json()).items).toHaveLength(7);
    await mint("27");
    expect((await app.request(url)).status).toBe(503);
  });

  it.each(["collection", "original", "type", "registry", "rule"])(
    "will not substitute another %s for a missing request member",
    async (kind) => {
      await mint("2");
      if (kind === "collection") await mint("11", { collection: bob });
      if (kind === "original")
        await mint("11", { originalKey: boosterIdentity(collection, "99") });
      if (kind === "type")
        await mint("11", { typeKey: boosterIdentity(registry, "99") });
      if (kind === "registry" || kind === "rule") {
        await mint("11");
        await db.query(
          `UPDATE request_source.booster_type SET ${kind === "registry" ? "registry" : "rule_hash"}=$1`,
          [bob]
        );
      }
      const response = await app.request(url);
      expect(response.status).toBe(503);
    }
  );

  it("will not reveal a monster beyond the ready snapshot's indexed prefix", async () => {
    await mint("2");
    await mint("11", { mintBlock: 501 });
    expect((await app.request(url)).status).toBe(503);
  });

  it("preserves source readiness and does not query monsters while unavailable", async () => {
    ready = false;
    const response = await app.request(url);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(query).not.toHaveBeenCalled();
  });
});
