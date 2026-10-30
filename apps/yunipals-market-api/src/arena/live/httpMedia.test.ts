import assert from "node:assert/strict";
import { test } from "node:test";
import { createArenaApp } from "./http";
import type { ArenaIntake } from "./intake";

test("streamed film artifacts retain browser CORS and byte-range headers", async () => {
  const origin = "https://www.yunipals.com";
  let reads = 0;
  const service = {
    origin,
    contractVersion: 2,
    contract: "0xf34fb0a9ecf31bf7516098105036aba7ed4adda9",
    mediaKind: "anime"
  } as unknown as ArenaIntake;
  const app = createArenaApp(service, {
    entriesEnabled: false,
    mediaKind: "anime",
    media: {
      status: async () => ({ state: "ready" }),
      artifact: async () => {
        reads++;
        return new Response("abc", {
          status: 206,
          headers: {
            "Content-Type": "video/mp4",
            "Content-Range": "bytes 0-2/100",
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store"
          }
        });
      }
    }
  });
  const path = "/tournaments/2/artifacts/film.mp4";
  const response = await app.request(path, { headers: { Origin: origin } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(
    response.headers.get("Access-Control-Allow-Credentials"),
    "true"
  );
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(response.headers.get("Content-Range"), "bytes 0-2/100");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(await response.text(), "abc");

  const rejected = await app.request(path, {
    headers: { Origin: "https://untrusted.example" }
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(reads, 1);

  const direct = await app.request(path);
  assert.equal(direct.status, 206);
  assert.equal(direct.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(direct.headers.get("Vary"), "Origin");
});
