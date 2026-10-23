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
const registry = "0x2222222222222222222222222222222222222222",
  engine = "0x3333333333333333333333333333333333333333",
  collection = "0x4444444444444444444444444444444444444444",
  wrapper = "0x5555555555555555555555555555555555555555",
  alice = "0x1111111111111111111111111111111111111111",
  bob = "0x6666666666666666666666666666666666666666",
  foreign = "0x7777777777777777777777777777777777777777",
  rule = `0x${"ab".repeat(32)}`;
const db = new PGlite(),
  query = vi.fn((sql: string, values?: unknown[]) => db.query(sql, values));
let ready = true,
  indexedBlock: string | null = "500",
  indexedTimestamp: string | null = "1800000500";
const app = new Hono();
registerBoosterRoutes(app, {
  schemaName: "recent_source",
  pool: { query } as never,
  readSnapshot: async () =>
    ready
      ? {
          ready: true,
          indexedBlock: indexedBlock!,
          indexedTimestamp: indexedTimestamp!,
          indexedBlockHash: null,
          requestsPaused: false,
          buildId: "recent-fixture",
          lastBoosterEvent: null
        }
      : { ready: false, reason: "booster_index_catching_up" }
});
const url = "/v1/boosters/recent-openings",
  key = (id: string) => boosterIdentity(engine, id),
  tokenKey = (id: string) => boosterIdentity(collection, id),
  pack = boosterIdentity(registry, "2");
const blockHash = (block: number) =>
    `0x${block.toString(16).padStart(64, "0")}`,
  txHash = (id: string) => `0x${BigInt(id).toString(16).padStart(64, "0")}`;
beforeAll(async () => {
  await db.exec(`CREATE SCHEMA recent_source;
CREATE TABLE recent_source.booster_type(id text PRIMARY KEY,pack_type_id text,registry text,engine text,rule_hash text,metadata_base_uri text,max_batch integer DEFAULT 7);
CREATE TABLE recent_source.booster_original(id text PRIMARY KEY,token_id text,collection text,engine text,type_key text);
CREATE TABLE recent_source.booster_request(id text PRIMARY KEY,request_id text,engine text,wrapper text,original_key text,rule_hash text,status text,opening boolean,quantity integer,recipient text);
CREATE TABLE recent_source.booster_monster(id text PRIMARY KEY,collection text,token_id text,original_key text,request_key text,type_key text,owner text,minted_to text,variant_id bigint,monster_type bigint,color bigint,horn bigint,glitter bigint,is_original boolean,burned boolean,mint_block bigint);
CREATE TABLE recent_source.booster_event(id text PRIMARY KEY,address text,name text,args text,block_number bigint,block_hash text,timestamp bigint,transaction_hash text,log_index integer);`);
});
beforeEach(async () => {
  for (const [name, value] of Object.entries({
    BOOSTER_REGISTRY: registry,
    BOOSTER_ENGINE: engine,
    BOOSTER_MONSTERS: collection,
    BOOSTER_WRAPPER: wrapper,
    BOOSTER_DEPLOYMENT_BLOCK: "50"
  }))
    vi.stubEnv(name, value);
  await db.exec(
    "TRUNCATE recent_source.booster_type,recent_source.booster_original,recent_source.booster_request,recent_source.booster_monster,recent_source.booster_event"
  );
  await db.query(
    "INSERT INTO recent_source.booster_type(id,pack_type_id,registry,engine,rule_hash,metadata_base_uri) VALUES($1,'2',$2,$3,$4,'https://example.test/variants/')",
    [pack, registry, engine, rule]
  );
  ready = true;
  indexedBlock = "500";
  indexedTimestamp = "1800000500";
  query.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => db.close());
async function event(
  name: string,
  args: unknown,
  block: number,
  id: string,
  log: number,
  address = engine
) {
  const bh = blockHash(block),
    th = txHash(id);
  await db.query(
    "INSERT INTO recent_source.booster_event VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      `${bh}:${th}:${log}`,
      address,
      name,
      typeof args === "string" ? args : JSON.stringify(args),
      block,
      bh,
      1800000000 + block,
      th,
      log
    ]
  );
}
async function request(
  id: string,
  tokens: string[],
  options: {
    block?: number;
    opening?: boolean;
    original?: string;
    status?: string;
    quantity?: number;
    log?: number;
  } = {}
) {
  const block = options.block ?? 490,
    opening = options.opening ?? true,
    original = options.original ?? tokens[0],
    originalKey = tokenKey(original),
    quantity = options.quantity ?? tokens.length;
  await db.query(
    "INSERT INTO recent_source.booster_original VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    [originalKey, original, collection, engine, pack]
  );
  await db.query(
    "INSERT INTO recent_source.booster_request VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      key(id),
      id,
      engine,
      wrapper,
      originalKey,
      rule,
      options.status ?? "completed",
      opening,
      quantity,
      alice
    ]
  );
  for (const [index, token] of tokens.entries()) {
    await db.query(
      "INSERT INTO recent_source.booster_monster VALUES($1,$2,$3,$4,$5,$6,$7,$7,73,4,1,1,1,$8,false,$9)",
      [
        tokenKey(token),
        collection,
        token,
        originalKey,
        key(id),
        pack,
        alice,
        opening,
        block
      ]
    );
    await event(
      "MonsterMinted",
      {
        tokenId: token,
        originalTokenId: original,
        packTypeId: "2",
        recipient: alice,
        variantId: 73,
        monsterType: 4,
        color: 1,
        horn: 1,
        glitter: 1,
        isOriginal: opening
      },
      block,
      id,
      (options.log ?? 100) + index,
      collection
    );
  }
  await event(
    "RequestCompleted",
    {
      requestId: id,
      originalId: original,
      recipient: alice,
      quantity,
      minted: quantity,
      remaining: 264 - quantity
    },
    block,
    id,
    (options.log ?? 100) + tokens.length
  );
}
async function items() {
  const response = await app.request(url);
  expect(response.status).toBe(200);
  return (await response.json()).items;
}
async function mutateEvent(
  name: string,
  mutate: (args: Record<string, unknown>) => void
) {
  const rows = await db.query<{ id: string; args: string }>(
    "SELECT id,args FROM recent_source.booster_event WHERE name=$1",
    [name]
  );
  for (const row of rows.rows) {
    const args = JSON.parse(row.args);
    mutate(args);
    await db.query(
      "UPDATE recent_source.booster_event SET args=$1 WHERE id=$2",
      [JSON.stringify(args), row.id]
    );
  }
}
describe("recent completed packs use real SQL and exact journal provenance", () => {
  it("orders completion block/log descending instead of reserved token/request IDs", async () => {
    await request("999", ["99"], { block: 480 });
    await request("2", ["2"], { block: 490, log: 10 });
    await request("1", ["1"], { block: 490, log: 20 });
    expect(
      (await items()).map((item: { requestId: string }) => item.requestId)
    ).toEqual(["1", "2", "999"]);
    expect(
      query.mock.calls.every(([sql]) => sql.trimStart().startsWith("SELECT "))
    ).toBe(true);
    expect((await app.request(url)).headers.get("cache-control")).toBe(
      "no-store"
    );
  });
  it("groups daily saved credits and selects first mint log rather than smallest token ID", async () => {
    await request("1", ["1"], { block: 450 });
    await request("2", ["99", "2", "10"], { opening: false, original: "1" });
    const rows = await items();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      requestKey: key("2"),
      requestId: "2",
      engine,
      opening: false,
      quantity: 3,
      revealedAt: "1800000490",
      monster: {
        tokenId: "99",
        originalKey: tokenKey("1"),
        requestKey: key("2"),
        mintedTo: alice,
        isOriginal: false,
        metadataUri: "https://example.test/variants/73.json"
      }
    });
  });
  it("keeps historical burned/transferred covers with unchanged actual recipient", async () => {
    await request("1", ["1"]);
    await db.query(
      "UPDATE recent_source.booster_monster SET owner=$1,burned=true",
      [bob]
    );
    expect((await items())[0].monster).toMatchObject({
      owner: bob,
      burned: true,
      mintedTo: alice
    });
  });
  it("bounds default12/max24 with one row per request", async () => {
    for (let i = 1; i <= 26; i++)
      await request(String(i), [String(i)], { block: 450 + i });
    expect(await items()).toHaveLength(12);
    expect(
      (await (await app.request(`${url}?limit=24`)).json()).items
    ).toHaveLength(24);
    expect(
      (await (await app.request(`${url}?limit=1`)).json()).items[0].requestId
    ).toBe("26");
  });
  it.each(["0", "25", "-1", "1.5", "01", "1e1", "", "Infinity"])(
    "rejects invalid limit %s before SQL",
    async (limit) => {
      expect((await app.request(`${url}?limit=${limit}`)).status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    }
  );
  it("uses the registered maxBatch for future types instead of the current UI seven-card cap", async () => {
    await request("1", ["1"], { block: 450 });
    const tokens = Array.from({ length: 8 }, (_, i) => String(i + 2));
    await request("2", tokens, { opening: false, original: "1" });
    expect(
      (await items()).map((row: { requestId: string }) => row.requestId)
    ).toEqual(["1"]);
    await db.exec("UPDATE recent_source.booster_type SET max_batch=8");
    expect((await items())[0]).toMatchObject({
      requestId: "2",
      quantity: 8,
      monster: { tokenId: "2" }
    });
    await db.exec("UPDATE recent_source.booster_type SET max_batch=33");
    expect(await items()).toEqual([]);
  });
  it.each(["pending", "seeded", "forfeited"])(
    "omits %s despite stray mints",
    async (status) => {
      await request("1", ["1"], { status });
      expect(await items()).toEqual([]);
    }
  );
  it("omits partial/extra batches and future events before applying limit", async () => {
    await request("1", ["1"], { block: 450 });
    await request("2", ["2", "3"], {
      opening: false,
      original: "1",
      quantity: 3
    });
    await request("3", ["4", "5"], {
      opening: false,
      original: "1",
      quantity: 1
    });
    await request("4", ["6"], { block: 501 });
    await request("5", ["7"], { block: 499 });
    await db.exec(
      "UPDATE recent_source.booster_monster SET mint_block=501 WHERE token_id='7'"
    );
    expect(
      (await items()).map((item: { requestId: string }) => item.requestId)
    ).toEqual(["1"]);
  });
  it.each([
    "engine",
    "wrapper",
    "registry",
    "collection",
    "rule",
    "original",
    "opening",
    "originalIdentity",
    "recipient"
  ])("omits foreign/corrupt %s correlation", async (field) => {
    await request("1", ["1"]);
    const sql: Record<string, string> = {
      engine: "UPDATE recent_source.booster_request SET engine=$1",
      wrapper: "UPDATE recent_source.booster_request SET wrapper=$1",
      registry: "UPDATE recent_source.booster_type SET registry=$1",
      collection: "UPDATE recent_source.booster_monster SET collection=$1",
      rule: "UPDATE recent_source.booster_request SET rule_hash=$1",
      original: "UPDATE recent_source.booster_monster SET original_key=$1",
      opening: "UPDATE recent_source.booster_monster SET is_original=false",
      originalIdentity:
        "UPDATE recent_source.booster_original SET token_id='2'",
      recipient: "UPDATE recent_source.booster_monster SET minted_to=$1"
    };
    await db.query(sql[field], sql[field].includes("$1") ? [foreign] : []);
    expect(await items()).toEqual([]);
  });
  it("omits missing or ambiguous completion and mint witnesses", async () => {
    await request("1", ["1"]);
    await db.query(
      "UPDATE recent_source.booster_event SET address=$1 WHERE name='RequestCompleted'",
      [foreign]
    );
    expect(await items()).toEqual([]);
    await db.query(
      "UPDATE recent_source.booster_event SET address=$1 WHERE name='RequestCompleted'",
      [engine]
    );
    await event(
      "RequestCompleted",
      {
        requestId: "1",
        originalId: "1",
        recipient: alice,
        quantity: 1,
        minted: 1,
        remaining: 263
      },
      491,
      "1",
      101
    );
    expect(await items()).toEqual([]);
    await db.exec(
      "DELETE FROM recent_source.booster_event WHERE block_number=491"
    );
    await event("MonsterMinted", { tokenId: "1" }, 490, "1", 99, collection);
    expect(await items()).toEqual([]);
  });
  it.each([
    "timestamp",
    "blockHash",
    "transaction",
    "log",
    "mintArgs",
    "completionArgs",
    "duplicateJson"
  ])("fails closed on selected inconsistent %s", async (kind) => {
    await request("1", ["1"]);
    if (kind === "timestamp")
      await db.exec(
        "UPDATE recent_source.booster_event SET timestamp=timestamp-1 WHERE name='MonsterMinted'"
      );
    if (kind === "blockHash")
      await db.exec(
        "UPDATE recent_source.booster_event SET block_hash='0xwrong' WHERE name='MonsterMinted'"
      );
    if (kind === "transaction")
      await db.exec(
        "UPDATE recent_source.booster_event SET transaction_hash='0xwrong' WHERE name='MonsterMinted'"
      );
    if (kind === "log")
      await db.exec(
        "UPDATE recent_source.booster_event SET log_index=200 WHERE name='MonsterMinted'"
      );
    if (kind === "mintArgs")
      await mutateEvent("MonsterMinted", (args) => {
        args.variantId = 74;
      });
    if (kind === "completionArgs")
      await mutateEvent("RequestCompleted", (args) => {
        args.quantity = 2;
      });
    if (kind === "duplicateJson")
      await db.exec(
        `UPDATE recent_source.booster_event SET args=replace(args,'"quantity":1','"quantity":1,"quantity":1') WHERE name='RequestCompleted'`
      );
    expect((await app.request(url)).status).toBe(503);
  });
  it("never invents a timestamp for future journal or absent prefix", async () => {
    await request("1", ["1"]);
    indexedTimestamp = "1800000489";
    expect(await items()).toEqual([]);
    indexedTimestamp = null;
    expect((await app.request(url)).status).toBe(503);
    indexedTimestamp = "1800000500";
    indexedBlock = null;
    expect((await app.request(url)).status).toBe(503);
  });
  it("readiness and SQL errors return no-store503 without rows", async () => {
    ready = false;
    expect((await app.request(url)).status).toBe(503);
    expect(query).not.toHaveBeenCalled();
    ready = true;
    query.mockRejectedValueOnce(new Error("fixture unavailable"));
    const response = await app.request(url);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "booster_index_unavailable"
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns honest empty history using one bounded SQL statement", async () => {
    expect(await items()).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
