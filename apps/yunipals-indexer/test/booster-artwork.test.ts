import { afterEach, expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import {
  BoosterArtworkStore,
  registerBoosterArtworkRoutes
} from "../lib/boosters/artwork.js";
import dictionary from "../../../contracts/boosters/config/base-standard-v1.traits.json";
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true }))
  );
});
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "booster-art-"));
  folders.push(directory);
  await mkdir(path.join(directory, "catalogs/demo/variants"), {
    recursive: true
  });
  await writeFile(
    path.join(directory, "catalogs/demo/manifest.json"),
    JSON.stringify({
      slug: "demo",
      catalogHash:
        "0x63813f1a231eca352a31d873ebb987ab2dc6a0625ece3fcf8cfc706fd6aa8733",
      artworkHash: "0x" + "a".repeat(64),
      metadataBaseURI: "https://example.test/v1/boosters/art/demo/",
      dictionary
    })
  );
  const store = new BoosterArtworkStore(directory),
    app = new Hono();
  registerBoosterArtworkRoutes(app, store);
  return { directory, store, app };
}
test("read-only metadata reports pending without causing generation; queue deduplicates concurrent reveals", async () => {
  const { directory, store, app } = await fixture();
  const response = await app.request("/v1/boosters/art/demo/149.json");
  expect(response.status).toBe(202);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect((await response.json()).yunipals.status).toBe("missing");
  expect(
    await Promise.all(
      Array.from({ length: 20 }, () => store.enqueue("demo", 149))
    ).then((r) => r.filter(Boolean).length)
  ).toBe(1);
  const files = await readdir(path.join(directory, "jobs/demo"));
  expect(files).toEqual(["149.json"]);
  const job = JSON.parse(
    await readFile(path.join(directory, "jobs/demo/149.json"), "utf8")
  );
  expect(job.traits).toEqual({
    type: "Yuniturtle",
    color: "Green",
    horn: "Spiral",
    glitter: "Yes"
  });
  expect(
    (await (await app.request("/v1/boosters/art/demo/149.json")).json())
      .yunipals.status
  ).toBe("queued");
  expect(
    (await app.request("/v1/boosters/art/demo/149.json", { method: "POST" }))
      .status
  ).toBe(404);
});
test("published variants and hashed masks are served immutably; corrupted assets fail", async () => {
  const { directory, store, app } = await fixture();
  await writeFile(
    path.join(directory, "catalogs/demo/variants/149.json"),
    JSON.stringify({
      name: "Yuniturtle",
      image: "https://example.test/card.png",
      yunipals: {
        variantId: 149,
        status: "ready",
        catalogCommitment: "0x" + "a".repeat(64)
      }
    })
  );
  const response = await app.request("/v1/boosters/art/demo/149.json");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("immutable");
  expect(await store.enqueue("demo", 149)).toBe(false);
  const bytes = Buffer.from("mask"),
    sha = createHash("sha256").update(bytes).digest("hex");
  await mkdir(path.join(directory, "assets"));
  await writeFile(path.join(directory, "assets", sha + ".svg"), bytes);
  expect(
    (await app.request("/v1/boosters/art-assets/" + sha + ".svg")).status
  ).toBe(200);
  await writeFile(path.join(directory, "assets", sha + ".svg"), "corrupted");
  expect(
    (await app.request("/v1/boosters/art-assets/" + sha + ".svg")).status
  ).toBe(503);
  expect((await app.request("/v1/boosters/art/demo/01.json")).status).toBe(400);
});
test("worker only queues configured indexed variants and rejects trait mismatches", async () => {
  const { store } = await fixture();
  const pool = {
    query: async () => ({
      rows: [{ variant: "149", type: "7", color: "2", horn: "1", glitter: "1" }]
    })
  };
  expect(await store.sync(pool as never, "public", ["demo"])).toBe(1);
  expect(await store.sync(pool as never, "public", ["demo"])).toBe(0);
  const bad = {
    query: async () => ({
      rows: [{ variant: "149", type: "7", color: "3", horn: "1", glitter: "1" }]
    })
  };
  await expect(store.sync(bad as never, "public", ["demo"])).rejects.toThrow(
    "does not match"
  );
});
