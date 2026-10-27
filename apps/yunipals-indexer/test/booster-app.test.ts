import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBoosterApi } from "../lib/api/booster-app.js";
import dictionary from "../../../contracts/boosters/config/base-standard-v1.traits.json";

const owner = "0x1111111111111111111111111111111111111111";
const registry = "0x2222222222222222222222222222222222222222";
const engine = "0x3333333333333333333333333333333333333333";
const monsters = "0x4444444444444444444444444444444444444444";
const wrapper = "0x5555555555555555555555555555555555555555";
const schemaName = "shared_source";
const folders: string[] = [];
beforeEach(() => {
  vi.stubEnv("BOOSTER_REGISTRY", registry);
  vi.stubEnv("BOOSTER_ENGINE", engine);
  vi.stubEnv("BOOSTER_MONSTERS", monsters);
  vi.stubEnv("BOOSTER_WRAPPER", wrapper);
  vi.stubEnv("BOOSTER_DEPLOYMENT_BLOCK", "123");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
function fixture(checkpoint = true) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("_ponder_meta"))
      return { rows: [{ runtime: { version: "6", is_dev: 0, is_locked: 1, is_ready: 1, build_id: "base-only", heartbeat_at: 1800000000000 },
        checkpoint: checkpoint ? "1800000000" + "8453".padStart(16, "0") + "140".padStart(16, "0") + "9".repeat(33) : null,
        observedAtMs: "1800000000000", requestsPaused: false, lastBoosterEvent: null }] };
    if (sql.includes("booster_checkpoint"))
      return { rows: checkpoint ? [{ indexedBlock: "140", indexedBlockHash: `0x${"ab".repeat(32)}`, indexedTimestamp: "1800000000" }] : [] };
    if (sql.includes("booster_engine_state")) return { rows: [{ paused: false }] };
    if (sql.includes("booster_monster"))
      return { rows: [{ id: `${monsters}:1`, collection: monsters, tokenId: "1", owner, isOriginal: true, metadataUri: "https://example.test/v1/boosters/art/demo/149.json" }] };
    if (sql.includes("booster_type")) return { rows: [{ id: "pack", packTypeId: "1", registry, engine }] };
    return { rows: [] };
  });
  const app = createBoosterApi({ pool: { query } as never, schemaName });
  return { app, query };
}
describe("feature-only booster API", () => {
  it("serves wallet monsters and pack types using only shared booster tables", async () => {
    const { app, query } = fixture();
    const response = await app.request(`/v1/owners/${owner}/booster-monsters`);
    expect(response.status).toBe(200);
    expect((await response.json()).items[0]).toMatchObject({ owner, collection: monsters, tokenId: "1" });
    expect((await (await app.request("/v1/boosters/types")).json()).items[0].packTypeId).toBe("1");
    expect(query.mock.calls.every(([sql]) => sql.includes('"shared_source".booster_'))).toBe(true);
    expect(query.mock.calls.every(([sql]) => !/metadata_projection|leaderboard|bnb_indexer|read_cache/.test(sql))).toBe(true);
  });
  it("reports feature checkpoint readiness and refuses absent data without a global gate", async () => {
    const ready = fixture();
    expect(await (await ready.app.request("/readyz")).json()).toMatchObject({ ready: true, indexedBlock: "140", chainId: 8453 });
    const catchingUp = fixture(false);
    expect((await catchingUp.app.request("/readyz")).status).toBe(503);
    expect((await (await catchingUp.app.request("/readyz")).json()).reason).toBe("booster_index_catching_up");
    expect((await ready.app.request("/healthz")).status).toBe(200);
  });
  it("keeps OG, marketplace and write routes outside its surface", async () => {
    const { app } = fixture();
    expect((await app.request("/v1/tokens")).status).toBe(404);
    expect((await app.request("/v1/marketplace/orders")).status).toBe(404);
    expect((await app.request("/v1/boosters/types", { method: "POST" })).status).toBe(404);
    expect((await app.request("/v1/boosters/types", { headers: { Origin: "https://yunipals.com" } })).headers.get("access-control-allow-origin")).toBe("*");
  });
  it("returns a bounded unavailable response for database failure", async () => {
    const app = createBoosterApi({ schemaName, pool: { query: async () => { throw new Error("private database details"); } } as never });
    const response = await app.request("/v1/boosters/types");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private");
  });
  it("serves the existing approved-artwork protocol independently of SQL", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "booster-api-art-"));
    folders.push(directory);
    await mkdir(path.join(directory, "catalogs/demo/variants"), { recursive: true });
    await writeFile(path.join(directory, "catalogs/demo/manifest.json"), JSON.stringify({ slug: "demo", catalogHash: "0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733", artworkHash: `0x${"a".repeat(64)}`, dictionary }));
    const query = vi.fn(async () => { throw new Error("SQL must not be needed for approved artwork"); });
    const app = createBoosterApi({ schemaName, artworkDirectory: directory, pool: { query } as never });
    const pending = await app.request("/v1/boosters/art/demo/149.json");
    expect(pending.status).toBe(202);
    expect((await pending.json()).name).toBe("Yuniturtle");
    expect(pending.headers.get("retry-after")).toBe("5");
    expect(query).not.toHaveBeenCalled();
  });
});
