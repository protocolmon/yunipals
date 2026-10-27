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
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { registerBoosterNftMetadataRoutes } from "../lib/api/booster-nft-metadata.js";
import { createBoosterApi } from "../lib/api/booster-app.js";
import { BoosterArtworkStore } from "../lib/boosters/artwork.js";
import { boosterIdentity } from "../../../packages/yunipals-market-core/src/boosters.js";
import dictionary from "../../../contracts/boosters/config/base-standard-v1.traits.json";

const registry = "0x2222222222222222222222222222222222222222";
const engine = "0x3333333333333333333333333333333333333333";
const collection = "0x4444444444444444444444444444444444444444";
const wrapper = "0x5555555555555555555555555555555555555555";
const alice = "0x1111111111111111111111111111111111111111";
const bob = "0x6666666666666666666666666666666666666666";
const catalogHash =
  "0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733";
const artworkHash = `0x${"a".repeat(64)}`;
const typeKey = boosterIdentity(registry, "2");
const base = 1700000000;
const db = new PGlite();
let directory: string;
let store: BoosterArtworkStore;
let ready = true;
let released = false;
let active = false;
let eventCounter = 0;
let indexedBlock = "1000";
const query = vi.fn(async (sql: string, values?: unknown[]) => {
  if (sql.startsWith("BEGIN")) active = true;
  const result = await db.query(sql, values);
  if (sql === "COMMIT" || sql === "ROLLBACK") active = false;
  return result;
});
const release = vi.fn(() => {
  released = true;
});
const pool = { connect: vi.fn(async () => ({ query, release })) };
let app: Hono;
const url = (id: string) => `/v1/boosters/metadata/${collection}/${id}.json`;
const artPath = (rank: number) =>
  path.join(directory, `catalogs/demo/variants/${rank}.json`);

function application(catalogs = ["demo"]) {
  const result = new Hono();
  registerBoosterNftMetadataRoutes(result, {
    pool: pool as never,
    schemaName: "birth_source",
    store,
    catalogs,
    readSnapshot: async (client) => {
      expect(client.query).toBe(query);
      expect(active).toBe(true);
      return ready
        ? {
            ready: true,
            indexedBlock,
            indexedBlockHash: null,
            indexedTimestamp: "1800000000",
            buildId: "birth-test",
            requestsPaused: false,
            lastBoosterEvent: null
          }
        : { ready: false, reason: "booster_index_catching_up" };
    }
  });
  return result;
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "booster-birth-"));
  await mkdir(path.join(directory, "catalogs/demo/variants"), {
    recursive: true
  });
  await writeFile(
    path.join(directory, "catalogs/demo/manifest.json"),
    JSON.stringify({
      slug: "demo",
      catalogHash,
      artworkHash,
      metadataBaseURI: "https://example.test/v1/boosters/art/demo/",
      dictionary
    })
  );
  store = new BoosterArtworkStore(directory);
  for (let rank = 72; rank <= 80; rank++) {
    const decoded = store.decode(await store.catalog("demo"), rank);
    await writeFile(
      artPath(rank),
      JSON.stringify({
        name: decoded.traits.type,
        description: "Approved shared artwork",
        image: `https://example.test/assets/${rank}.png`,
        attributes: Object.entries(decoded.traits).map(([key, value]) => ({
          trait_type: key[0].toUpperCase() + key.slice(1),
          value
        })),
        yunipals: {
          variantId: rank,
          status: "ready",
          catalogCommitment: artworkHash,
          holo: {
            foilMask: "https://example.test/assets/foil.svg",
            monsterMask: "https://example.test/assets/body.svg"
          }
        }
      })
    );
  }
  await db.exec(`CREATE SCHEMA birth_source;
    CREATE TABLE birth_source.booster_type(id text PRIMARY KEY,pack_type_id text,registry text,engine text,catalog_hash text,metadata_base_uri text);
    CREATE TABLE birth_source.booster_monster(id text PRIMARY KEY,collection text,token_id text,original_key text,type_key text,
      variant_id bigint,monster_type bigint,color bigint,horn bigint,glitter bigint,is_original boolean,minted_to text,mint_block bigint,owner text,burned boolean);
    CREATE TABLE birth_source.booster_event(id text PRIMARY KEY,address text,name text,args text,block_number bigint,
      block_hash text,timestamp bigint,transaction_hash text,log_index integer);
    CREATE TABLE birth_source._ponder_meta(key text PRIMARY KEY,value jsonb);
    CREATE TABLE birth_source._ponder_checkpoint(chain_id integer PRIMARY KEY,latest_checkpoint text);
    CREATE TABLE birth_source.booster_engine_state(id text PRIMARY KEY,paused boolean);
    CREATE TABLE birth_source.booster_checkpoint(id text PRIMARY KEY,block_number bigint,block_hash text,timestamp bigint);`);
});
beforeEach(async () => {
  vi.stubEnv("BOOSTER_REGISTRY", registry);
  vi.stubEnv("BOOSTER_ENGINE", engine);
  vi.stubEnv("BOOSTER_MONSTERS", collection);
  vi.stubEnv("BOOSTER_WRAPPER", wrapper);
  vi.stubEnv("BOOSTER_DEPLOYMENT_BLOCK", "50");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Metadata must never fetch a URI");
    })
  );
  await db.exec(
    "TRUNCATE birth_source.booster_event,birth_source.booster_monster,birth_source.booster_type,birth_source._ponder_meta,birth_source._ponder_checkpoint,birth_source.booster_engine_state,birth_source.booster_checkpoint"
  );
  await db.query(
    "INSERT INTO birth_source.booster_type VALUES($1,'2',$2,$3,$4,$5)",
    [
      typeKey,
      registry,
      engine,
      catalogHash,
      "https://example.test/v1/boosters/art/demo/"
    ]
  );
  ready = true;
  released = false;
  active = false;
  eventCounter = 0;
  indexedBlock = "1000";
  query.mockClear();
  release.mockClear();
  pool.connect.mockClear();
  app = application();
  await mint("1", "1", base, 100, 72);
  await mint("10", "10", base, 110, 72);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await db.close();
  await rm(directory, { recursive: true, force: true });
});

async function mint(
  tokenId: string,
  original: string,
  timestamp: number,
  block: number,
  rank = 73
) {
  const ids = store.decode(await store.catalog("demo"), rank).ids;
  await db.query(
    "INSERT INTO birth_source.booster_monster VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12,false)",
    [
      boosterIdentity(collection, tokenId),
      collection,
      tokenId,
      boosterIdentity(collection, original),
      typeKey,
      rank,
      ...ids,
      tokenId === original,
      alice,
      block
    ]
  );
  const logIndex = eventCounter++;
  const blockHash = `0x${BigInt(block).toString(16).padStart(64, "0")}`;
  const tx = `0x${BigInt(logIndex + 1)
    .toString(16)
    .padStart(64, "0")}`;
  await db.query(
    "INSERT INTO birth_source.booster_event VALUES($1,$2,'MonsterMinted',$3,$4,$5,$6,$7,$8)",
    [
      `${blockHash}:${tx}:${logIndex}`,
      collection,
      JSON.stringify({
        tokenId,
        originalTokenId: original,
        packTypeId: "2",
        recipient: alice,
        variantId: rank,
        monsterType: Number(ids[0]),
        color: Number(ids[1]),
        horn: Number(ids[2]),
        glitter: Number(ids[3]),
        isOriginal: tokenId === original
      }),
      block,
      blockHash,
      timestamp,
      tx,
      logIndex
    ]
  );
}
const birthDay = (body: {
  attributes: { trait_type: string; value: unknown }[];
}) =>
  body.attributes.find((attribute) => attribute.trait_type === "Birth day")
    ?.value;

describe("per-NFT metadata from canonical mint journal", () => {
  it("registers in the real API factory using actual native readiness and preserves shared variant routes", async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.query("INSERT INTO birth_source._ponder_meta VALUES('app',$1)", [
      {
        version: "6",
        is_dev: 0,
        is_locked: 1,
        is_ready: 1,
        build_id: "birth-factory",
        heartbeat_at: Date.now()
      }
    ]);
    await db.query(
      "INSERT INTO birth_source._ponder_checkpoint VALUES(8453,$1)",
      [
        String(now) +
          "8453".padStart(16, "0") +
          "1000".padStart(16, "0") +
          "9".repeat(33)
      ]
    );
    const api = createBoosterApi({
      pool: { ...pool, query } as never,
      schemaName: "birth_source",
      artworkDirectory: directory,
      artworkCatalogs: ["demo"]
    });
    const response = await api.request(url("1"), {
      headers: { Origin: "https://www.yunipals.com" }
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(birthDay(await response.json())).toBe(0);
    const variant = await api.request("/v1/boosters/art/demo/72.json");
    expect(variant.status).toBe(200);
    const shared = await variant.json();
    expect(
      shared.attributes.some(
        (attribute: { trait_type: string }) =>
          attribute.trait_type === "Birth day"
      )
    ).toBe(false);
    expect(variant.headers.get("cache-control")).toContain("immutable");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("identical variants share artwork but have different actual birth days", async () => {
    await mint("2", "1", base + 86400, 200);
    await mint("3", "10", base + 3 * 86400, 300);
    const a = await (await app.request(url("2"))).json();
    const b = await (await app.request(url("3"))).json();
    expect([birthDay(a), birthDay(b)]).toEqual([1, 3]);
    expect(a.image).toBe(b.image);
    expect(a.yunipals.holo).toEqual(b.yunipals.holo);
    expect(a.yunipals).toMatchObject({
      tokenId: "2",
      originalTokenId: "1",
      birthDay: 1,
      bornAt: String(base + 86400),
      originalBornAt: String(base)
    });
    expect(
      a.attributes.find(
        (attribute: { trait_type: string }) => attribute.trait_type === "Born"
      )
    ).toEqual({
      trait_type: "Born",
      display_type: "date",
      value: base + 86400
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("saved three-pull batch records actual day3 for every NFT", async () => {
    for (let i = 0; i < 3; i++)
      await mint(String(4 + i), "1", base + 3 * 86400 + 123, 350, 74 + i);
    for (let i = 0; i < 3; i++) {
      const response = await app.request(url(String(4 + i)));
      expect(response.status).toBe(200);
      expect(birthDay(await response.json())).toBe(3);
    }
  });

  it("original is day0 and exact rolling boundaries use floor division", async () => {
    expect(birthDay(await (await app.request(url("1"))).json())).toBe(0);
    for (const [id, elapsed, day] of [
      ["2", 86399, 0],
      ["3", 86400, 1],
      ["4", 172799, 1],
      ["5", 172800, 2]
    ] as const) {
      await mint(id, "1", base + elapsed, 200 + Number(id), 72 + Number(id));
      expect(birthDay(await (await app.request(url(id))).json())).toBe(day);
    }
  });

  it("transfer and burn do not change birth history or shared metadata bytes", async () => {
    await mint("2", "1", base + 86400, 200);
    const bytes = await readFile(artPath(73), "utf8");
    const before = await (await app.request(url("2"))).json();
    await db.exec(
      `UPDATE birth_source.booster_monster SET owner='${bob}',burned=true`
    );
    expect(await (await app.request(url("2"))).json()).toEqual(before);
    expect(await readFile(artPath(73), "utf8")).toBe(bytes);
  });

  it("releases one repeatable-read/read-only snapshot before any catalog I/O", async () => {
    await mint("2", "1", base + 86400, 200);
    const original = store.catalog.bind(store);
    const spy = vi.spyOn(store, "catalog").mockImplementation(async (slug) => {
      expect(active).toBe(false);
      expect(released).toBe(true);
      return original(slug);
    });
    try {
      expect((await app.request(url("2"))).status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(query.mock.calls[0][0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(
      query.mock.calls.filter(([sql]) => sql.startsWith("SELECT "))
    ).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(
      query.mock.calls.every(([sql]) =>
        /^(BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|SELECT |COMMIT)/.test(
          sql
        )
      )
    ).toBe(true);
  });

  it("refuses unavailable readiness and preserves rollback/release", async () => {
    ready = false;
    expect((await app.request(url("1"))).status).toBe(503);
    expect(query.mock.calls.some(([sql]) => sql.startsWith("SELECT "))).toBe(
      false
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("missing NFT is404; malformed identity/collection does not query SQL", async () => {
    expect((await app.request(url("99"))).status).toBe(404);
    for (const value of ["01.json", "-1.json", "1", `${2n ** 256n}.json`])
      expect(
        (await app.request(`/v1/boosters/metadata/${collection}/${value}`))
          .status
      ).toBe(400);
    expect(
      (await app.request(`/v1/boosters/metadata/${bob}/1.json`)).status
    ).toBe(400);
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });

  it.each([
    "missing",
    "duplicate",
    "wrong-address",
    "wrong-name",
    "wrong-mint-block",
    "beyond-prefix"
  ])("refuses %s mint provenance", async (kind) => {
    await mint("2", "1", base + 86400, 200);
    if (kind === "missing")
      await db.exec(
        "DELETE FROM birth_source.booster_event WHERE block_number=200"
      );
    if (kind === "duplicate")
      await db.exec(
        "INSERT INTO birth_source.booster_event SELECT id||'x',address,name,args,block_number,block_hash,timestamp,transaction_hash,log_index+1 FROM birth_source.booster_event WHERE block_number=200"
      );
    if (kind === "wrong-address")
      await db.query(
        "UPDATE birth_source.booster_event SET address=$1 WHERE block_number=200",
        [bob]
      );
    if (kind === "wrong-name")
      await db.exec(
        "UPDATE birth_source.booster_event SET name='Transfer' WHERE block_number=200"
      );
    if (kind === "wrong-mint-block")
      await db.exec(
        "UPDATE birth_source.booster_monster SET mint_block=201 WHERE token_id='2'"
      );
    if (kind === "beyond-prefix") indexedBlock = "199";
    expect((await app.request(url("2"))).status).toBe(503);
  });

  it.each([
    "original-missing",
    "original-event-missing",
    "original-not-original",
    "future-original",
    "wrong-type"
  ])("refuses %s ancestry", async (kind) => {
    await mint("2", "1", base + 86400, 200);
    if (kind === "original-missing")
      await db.exec(
        "DELETE FROM birth_source.booster_monster WHERE token_id='1'"
      );
    if (kind === "original-event-missing")
      await db.exec(
        "DELETE FROM birth_source.booster_event WHERE block_number=100"
      );
    if (kind === "original-not-original")
      await db.exec(
        "UPDATE birth_source.booster_monster SET is_original=false WHERE token_id='1'"
      );
    if (kind === "future-original")
      await db.exec(
        `UPDATE birth_source.booster_event SET timestamp=${base + 86401} WHERE block_number=100`
      );
    if (kind === "wrong-type")
      await db.exec(
        "UPDATE birth_source.booster_monster SET type_key='unrelated' WHERE token_id='1'"
      );
    expect((await app.request(url("2"))).status).toBe(503);
  });

  it.each([
    "malformed",
    "duplicate-key",
    "array",
    "numeric-token",
    "wrong-original",
    "wrong-recipient",
    "wrong-traits",
    "wrong-id",
    "bad-hash",
    "future-timestamp"
  ])("refuses forged or ambiguous JSON/proof: %s", async (kind) => {
    await mint("2", "1", base + 86400, 200);
    const original = (
      await db.query<{ args: string }>(
        "SELECT args FROM birth_source.booster_event WHERE block_number=200"
      )
    ).rows[0].args;
    const args = JSON.parse(original);
    if (kind === "wrong-original") args.originalTokenId = "10";
    if (kind === "wrong-recipient") args.recipient = bob;
    if (kind === "wrong-traits") args.color = 3;
    if (kind === "numeric-token") args.tokenId = 2;
    let text = JSON.stringify(args);
    if (kind === "malformed") text = "{";
    if (kind === "duplicate-key") text = '{"tokenId":"99",' + original.slice(1);
    if (kind === "array") text = '[{"tokenId":"2"}]';
    await db.query(
      "UPDATE birth_source.booster_event SET args=$1 WHERE block_number=200",
      [text]
    );
    if (kind === "wrong-id")
      await db.exec(
        "UPDATE birth_source.booster_event SET id='forged' WHERE block_number=200"
      );
    if (kind === "bad-hash")
      await db.exec(
        "UPDATE birth_source.booster_event SET block_hash='invalid' WHERE block_number=200"
      );
    if (kind === "future-timestamp")
      await db.exec(
        "UPDATE birth_source.booster_event SET timestamp=1800000001 WHERE block_number=200"
      );
    const response = await app.request(url("2"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "booster_birth_metadata_unavailable"
    });
  });

  it.each(["uri", "commitment", "traits", "not-allowed"])(
    "refuses unbound local artwork: %s",
    async (kind) => {
      await mint("2", "1", base + 86400, 200);
      if (kind === "uri")
        await db.exec(
          "UPDATE birth_source.booster_type SET metadata_base_uri='https://evil.test/metadata/'"
        );
      if (kind === "commitment")
        await db.exec(
          `UPDATE birth_source.booster_type SET catalog_hash='0x${"b".repeat(64)}'`
        );
      if (kind === "traits")
        await db.exec(
          "UPDATE birth_source.booster_monster SET color=3 WHERE token_id='2'"
        );
      if (kind === "not-allowed") app = application(["other-catalog"]);
      expect((await app.request(url("2"))).status).toBe(503);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    }
  );

  it("pending artwork includes birth traits with202/no-store, without queueing", async () => {
    await mint("2", "1", base + 86400, 200, 81);
    const response = await app.request(url("2"));
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(birthDay(await response.json())).toBe(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects empty/duplicate/unsafe configured catalog slugs at registration", () => {
    for (const slugs of [[], ["demo", "demo"], ["../demo"]])
      expect(() => application(slugs)).toThrow();
  });
});
