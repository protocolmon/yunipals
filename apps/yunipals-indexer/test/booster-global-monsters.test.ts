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
const other = "0x7777777777777777777777777777777777777777";
const ruleHash = `0x${"ab".repeat(32)}`;
const db = new PGlite();
const query = vi.fn((sql: string, values?: unknown[]) => db.query(sql, values));
let ready = true;
let prefix: string | null = "500";
let sequence = 0;
const app = new Hono();
registerBoosterRoutes(app, {
  schemaName: "global_source",
  pool: { query } as never,
  readSnapshot: async () =>
    ready
      ? {
          ready: true,
          indexedBlock: prefix!,
          indexedBlockHash: null,
          indexedTimestamp: "1800000000",
          buildId: "global-test",
          requestsPaused: false,
          lastBoosterEvent: null
        }
      : { ready: false, reason: "booster_index_catching_up" }
});
const url = "/v1/boosters/monsters";

beforeAll(async () => {
  await db.exec(`CREATE SCHEMA global_source;
    CREATE TABLE global_source.booster_type(id text PRIMARY KEY,registry text,engine text,rule_hash text,metadata_base_uri text);
    CREATE TABLE global_source.booster_original(id text PRIMARY KEY,collection text,engine text,type_key text);
    CREATE TABLE global_source.booster_request(id text PRIMARY KEY,engine text,original_key text,rule_hash text,status text,opening boolean);
    CREATE TABLE global_source.booster_monster(id text PRIMARY KEY,collection text,token_id text,original_key text,request_key text,
      type_key text,owner text,minted_to text,variant_id bigint,monster_type bigint,color bigint,horn bigint,glitter bigint,
      is_original boolean,burned boolean,mint_block bigint);`);
});
beforeEach(async () => {
  vi.stubEnv("BOOSTER_REGISTRY", registry);
  vi.stubEnv("BOOSTER_ENGINE", engine);
  vi.stubEnv("BOOSTER_MONSTERS", collection);
  vi.stubEnv("BOOSTER_WRAPPER", wrapper);
  vi.stubEnv("BOOSTER_DEPLOYMENT_BLOCK", "50");
  await db.exec(
    "TRUNCATE global_source.booster_monster,global_source.booster_request,global_source.booster_original,global_source.booster_type"
  );
  ready = true;
  prefix = "500";
  sequence = 0;
  query.mockClear();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => db.close());

async function mint(
  tokenId: string,
  owner = alice,
  options: {
    collection?: string;
    engine?: string;
    registry?: string;
    type?: string;
    status?: string;
    burned?: boolean;
    block?: number;
    originalId?: string;
    id?: string;
    wrongRule?: boolean;
    opening?: boolean;
  } = {}
) {
  const target = options.collection ?? collection;
  const targetEngine = options.engine ?? engine;
  const targetRegistry = options.registry ?? registry;
  const typeKey = boosterIdentity(targetRegistry, options.type ?? "2");
  const originalId = options.originalId ?? tokenId;
  const originalKey = boosterIdentity(target, originalId);
  const requestKey = boosterIdentity(targetEngine, String(++sequence));
  const original = tokenId === originalId;
  await db.query(
    "INSERT INTO global_source.booster_type VALUES($1,$2,$3,$4,'https://example.test/art/')ON CONFLICT DO NOTHING",
    [typeKey, targetRegistry, targetEngine, ruleHash]
  );
  await db.query(
    "INSERT INTO global_source.booster_original VALUES($1,$2,$3,$4)ON CONFLICT DO NOTHING",
    [originalKey, target, targetEngine, typeKey]
  );
  await db.query(
    "INSERT INTO global_source.booster_request VALUES($1,$2,$3,$4,$5,$6)",
    [
      requestKey,
      targetEngine,
      originalKey,
      options.wrongRule ? `0x${"cd".repeat(32)}` : ruleHash,
      options.status ?? "completed",
      options.opening ?? original
    ]
  );
  await db.query(
    `INSERT INTO global_source.booster_monster VALUES($1,$2,$3,$4,$5,$6,$7,$7,73,4,1,1,1,$8,$9,$10)`,
    [
      options.id ?? boosterIdentity(target, tokenId),
      target,
      tokenId,
      originalKey,
      requestKey,
      typeKey,
      owner,
      original,
      options.burned ?? false,
      options.block ?? 499
    ]
  );
}

describe("global booster browse uses real isolated SQL and fixed deployment scope", () => {
  it("returns all wallets in numeric order and keeps the existing owner route owner-scoped", async () => {
    for (const [id, owner] of [
      ["10", alice],
      ["2", bob],
      ["1", alice]
    ] as const)
      await mint(id, owner);
    const response = await app.request(`${url}?owner=${alice}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.items.map((row: { tokenId: string }) => row.tokenId)).toEqual([
      "1",
      "2",
      "10"
    ]);
    expect(body.items.map((row: { owner: string }) => row.owner)).toEqual([
      alice,
      bob,
      alice
    ]);
    expect(body).toMatchObject({
      chainId: 8453,
      collection,
      engine,
      indexedBlock: "500",
      nextCursor: null
    });
    expect(
      body.items.every(
        (row: { metadataUri: string }) =>
          row.metadataUri === "https://example.test/art/73.json"
      )
    ).toBe(true);
    const owned = await (
      await app.request(`/v1/owners/${alice}/booster-monsters?limit=24`)
    ).json();
    expect(owned.items.map((row: { tokenId: string }) => row.tokenId)).toEqual([
      "1",
      "10"
    ]);
  });

  it("walks limit+1 pages without lexicographic gaps, repeated NFTs or a spurious terminal cursor", async () => {
    for (const id of ["99", "10", "1", "9", "2"]) await mint(id);
    const ids: string[] = [];
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    do {
      const response = await app.request(
        `${url}?limit=2${cursor ? `&after=${cursor}` : ""}`
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      ids.push(...body.items.map((row: { tokenId: string }) => row.tokenId));
      cursor = body.nextCursor;
      cursors.push(cursor);
    } while (cursor);
    expect(ids).toEqual(["1", "2", "9", "10", "99"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(cursors).toEqual(["2", "10", null]);
    expect(query.mock.calls.every(([sql]) => sql.startsWith("SELECT "))).toBe(
      true
    );
  });

  it("defaults to24 and supports the maximum100 without guessing total supply", async () => {
    for (let i = 1; i <= 26; i++) await mint(String(i));
    const first = await (await app.request(url)).json();
    expect(first.items).toHaveLength(24);
    expect(first.nextCursor).toBe("24");
    const maximum = await (await app.request(`${url}?limit=100`)).json();
    expect(maximum.items).toHaveLength(26);
    expect(maximum.nextCursor).toBeNull();
    const empty = await (await app.request(`${url}?after=26`)).json();
    expect(empty.items).toEqual([]);
    expect(empty.nextCursor).toBeNull();
  });

  it("preserves uint256 cursor precision beyond JavaScript integers", async () => {
    const ids = [
      "9007199254740993",
      "10000000000000000000",
      (2n ** 256n - 1n).toString()
    ];
    for (const id of ids) await mint(id);
    const a = await (await app.request(`${url}?limit=1`)).json();
    expect(a.items[0].tokenId).toBe(ids[0]);
    expect(a.nextCursor).toBe(ids[0]);
    const b = await (
      await app.request(`${url}?after=${a.nextCursor}&limit=100`)
    ).json();
    expect(b.items.map((row: { tokenId: string }) => row.tokenId)).toEqual(
      ids.slice(1)
    );
  });

  it("excludes burned, reserved/unrevealed, pending/seeded/forfeited and future-prefix rows", async () => {
    await mint("1");
    await mint("2", alice, { originalId: "1" });
    await mint("3", alice, { burned: true });
    await mint("4", alice, { status: "pending" });
    await mint("5", alice, { status: "seeded" });
    await mint("6", alice, { status: "forfeited" });
    await mint("7", alice, { block: 501 });
    await mint("8", alice, { block: 0 });
    await db.query(
      "INSERT INTO global_source.booster_original VALUES($1,$2,$3,$4)",
      [
        boosterIdentity(collection, "9"),
        collection,
        engine,
        boosterIdentity(registry, "2")
      ]
    );
    const body = await (await app.request(url)).json();
    expect(body.items.map((row: { tokenId: string }) => row.tokenId)).toEqual([
      "1",
      "2"
    ]);
    expect(
      body.items.map((row: { isOriginal: boolean }) => row.isOriginal)
    ).toEqual([true, false]);
  });

  it("same token IDs in another collection/engine/registry cannot collide with the configured page", async () => {
    await mint("1");
    await mint("1", bob, { collection: other });
    await mint("2", bob, { engine: other, type: "3" });
    await mint("3", bob, { registry: other });
    const body = await (
      await app.request(
        `${url}?collection=${other}&engine=${other}&registry=${other}`
      )
    ).json();
    expect(body.items.map((row: { tokenId: string }) => row.tokenId)).toEqual([
      "1"
    ]);
    expect(body.items[0].collection).toBe(collection);
  });

  it.each([
    "missing-original",
    "wrong-original-engine",
    "wrong-rule",
    "wrong-opening"
  ])("excludes incomplete request provenance: %s", async (kind) => {
    await mint("1");
    await mint("2", alice, {
      wrongRule: kind === "wrong-rule",
      opening: kind === "wrong-opening" ? false : true
    });
    if (kind === "missing-original")
      await db.query("DELETE FROM global_source.booster_original WHERE id=$1", [
        boosterIdentity(collection, "2")
      ]);
    if (kind === "wrong-original-engine")
      await db.query(
        "UPDATE global_source.booster_original SET engine=$1 WHERE id=$2",
        [other, boosterIdentity(collection, "2")]
      );
    const body = await (await app.request(url)).json();
    expect(body.items.map((row: { tokenId: string }) => row.tokenId)).toEqual([
      "1"
    ]);
  });

  it("refuses a same-collection numeric cursor collision or forged canonical identity", async () => {
    await mint("1");
    await mint("1", bob, { id: "corrupt-same-token", originalId: "2" });
    const response = await app.request(`${url}?limit=1`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "booster_index_unavailable"
    });
  });

  it.each(["original-points-to-other-original", "offspring-points-to-itself"])(
    "excludes corrupt original identity: %s",
    async (corruption) => {
      await mint("1");
      await mint("2");
      if (corruption === "original-points-to-other-original") {
        await db.query(
          "UPDATE global_source.booster_monster SET original_key=$1 WHERE token_id='2'",
          [boosterIdentity(collection, "1")]
        );
        await db.query(
          `UPDATE global_source.booster_request SET original_key=$1
         WHERE id=(SELECT request_key FROM global_source.booster_monster WHERE token_id='2')`,
          [boosterIdentity(collection, "1")]
        );
      } else {
        await db.query(
          "UPDATE global_source.booster_monster SET is_original=false WHERE token_id='1'"
        );
        await db.query(
          `UPDATE global_source.booster_request SET opening=false
         WHERE id=(SELECT request_key FROM global_source.booster_monster WHERE token_id='1')`
        );
      }
      const response = await app.request(url);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.items.map((row: { tokenId: string }) => row.tokenId)).toEqual(
        [corruption === "original-points-to-other-original" ? "1" : "2"]
      );
    }
  );

  it.each(["01", "-1", "1.5", (2n ** 256n).toString(), "1e2"])(
    "rejects invalid cursor%s before SQL",
    async (after) => {
      const response = await app.request(
        `${url}?after=${encodeURIComponent(after)}`
      );
      expect(response.status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    }
  );
  it.each(["0", "101", "-1", "1.5", "01", "1e2", ""])(
    "rejects invalid limit%s before SQL",
    async (limit) => {
      const response = await app.request(
        `${url}?limit=${encodeURIComponent(limit)}`
      );
      expect(response.status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    }
  );

  it("unready or missing prefix refuses before reading monsters", async () => {
    ready = false;
    expect((await app.request(url)).status).toBe(503);
    expect(query).not.toHaveBeenCalled();
    ready = true;
    prefix = null;
    expect((await app.request(url)).status).toBe(503);
    expect(query).not.toHaveBeenCalled();
  });

  it("unconfigured deployment refuses and POST stays unavailable", async () => {
    for (const key of [
      "BOOSTER_REGISTRY",
      "BOOSTER_ENGINE",
      "BOOSTER_MONSTERS",
      "BOOSTER_WRAPPER"
    ])
      vi.stubEnv(key, "");
    expect((await app.request(url)).status).toBe(503);
    expect(query).not.toHaveBeenCalled();
    expect((await app.request(url, { method: "POST" })).status).toBe(404);
  });
});
