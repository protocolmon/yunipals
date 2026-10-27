import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { BoosterArtworkStore } from "../lib/boosters/artwork.js";
import { syncBoosterArtworkQueue } from "../lib/boosters/artwork-sync.js";
import dictionary from "../../../contracts/boosters/config/base-standard-v1.traits.json";
const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });
async function fixture(ready = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "booster-sync-")); folders.push(directory);
  await mkdir(path.join(directory, "catalogs/demo"), { recursive: true });
  await writeFile(path.join(directory, "catalogs/demo/manifest.json"), JSON.stringify({ slug: "demo", catalogHash: "0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733", artworkHash: `0x${"a".repeat(64)}`, metadataBaseURI: "https://example.test/art/demo/", dictionary }));
  const query = vi.fn(async (sql: string) => sql.includes("_ponder_meta") ? { rows: [{ runtime: { version: "6", is_dev: 0, is_locked: ready ? 1 : 0, is_ready: 1, build_id: "base-only", heartbeat_at: 1800000000000 }, checkpoint: "1800000000" + "8453".padStart(16, "0") + "140".padStart(16, "0") + "9".repeat(33), observedAtMs: "1800000000000", requestsPaused: false, lastBoosterEvent: null }] } : { rows: [{ variant: "149", type: "7", color: "2", horn: "1", glitter: "1" }] });
  return { directory, query, dependencies: { pool: { query } as never, schemaName: "launch", engine: "engine", store: new BoosterArtworkStore(directory), catalogs: ["demo"] } };
}
test("a current indexed reveal queues exactly one shared variant job", async () => {
  const { directory, dependencies, query } = await fixture();
  expect(await syncBoosterArtworkQueue(dependencies)).toMatchObject({ queued: 1, skipped: false });
  expect(await syncBoosterArtworkQueue(dependencies)).toMatchObject({ queued: 0, skipped: false });
  expect(await readdir(path.join(directory, "jobs/demo"))).toEqual(["149.json"]);
  expect(JSON.parse(await readFile(path.join(directory, "jobs/demo/149.json"), "utf8")).traits).toEqual({ type: "Yuniturtle", color: "Green", horn: "Spiral", glitter: "Yes" });
  expect(query.mock.calls.some(([sql]) => sql.includes("WHERE NOT m.burned AND p.catalog_hash=$1 AND p.metadata_base_uri=$2"))).toBe(true);
});
test("stopped or incomplete indexing cannot create artwork jobs", async () => {
  const { directory, dependencies, query } = await fixture(false);
  expect(await syncBoosterArtworkQueue(dependencies)).toMatchObject({ queued: 0, skipped: true });
  expect(query).toHaveBeenCalledTimes(1);
  await expect(readdir(path.join(directory, "jobs"))).rejects.toMatchObject({ code: "ENOENT" });
});
