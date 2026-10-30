import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  compileAnimeBackgroundCatalog,
  frozenAnimeBackground,
  loadAnimeBackgroundCatalog,
  parseAnimeBackground
} from "./animeBackgrounds";
import { loadAnimeArenaCatalog, loadLiveArenaCatalog } from "./catalog";
import { animeMediaBuilder } from "./animeMedia";
import type { LiveFrozenInput } from "./input";
const root = resolve("../..");
const definition = () =>
  JSON.parse(
    readFileSync(join(root, "docs/arena/anime-backgrounds-v1.json"), "utf8")
  );
const base = loadLiveArenaCatalog(root);
const bytes = readFileSync(
  join(root, "apps/yunipals-anime-engine/static/assets/bg-arena.webp")
);
const hash = createHash("sha256").update(bytes).digest("hex");

test("one shared backdrop preserves all 898 selected island profiles, weights and rewards", async () => {
  const anime = loadAnimeArenaCatalog(root, `0x${"1".repeat(40)}`);
  assert.equal(anime.islands.length, 898);
  assert.deepEqual(anime.pool, base.pool);
  assert.deepEqual(
    anime.islands.map(({ animeBackground, ...island }) => island),
    base.islands
  );
  assert.ok(
    anime.islands.every(
      (i) =>
        i.animeBackground.mode === "shared-preview" &&
        i.animeBackground.sha256 === hash
    )
  );
  let fetches = 0;
  const staged = await frozenAnimeBackground(
    root,
    anime.islands[0]!,
    async () => {
      fetches++;
      throw new Error("No network for the shared asset");
    }
  );
  assert.deepEqual(staged.bytes, bytes);
  assert.equal(fetches, 0);
});

test("reviewed island overrides replace only their own artwork; frozen jobs keep their old asset", async () => {
  const value = definition(),
    old = loadAnimeBackgroundCatalog(root, base.islands),
    selected = base.islands[0]!;
  value.islands[selected.tokenId] = {
    ...value.fallback,
    mode: "island",
    sourceIslandTokenId: selected.tokenId,
    sourceProfileSha256: selected.profileSha256,
    file: `islands/v1/${selected.tokenId}/arena.${hash.slice(0, 8)}.webp`
  };
  const updated = compileAnimeBackgroundCatalog(value, base.islands);
  assert.equal(updated[0]!.animeBackground.mode, "island");
  assert.equal(updated[1]!.animeBackground.mode, "shared-preview");
  assert.equal(old[0]!.animeBackground.mode, "shared-preview");
  const exact = await frozenAnimeBackground(root, updated[0]!, async (url) => {
    assert.equal(
      String(url),
      `https://assets-anime.yunipals.com/${value.islands[selected.tokenId].file}`
    );
    return new Response(bytes);
  });
  assert.equal(exact.background.sha256, hash);
  await assert.rejects(
    frozenAnimeBackground(
      root,
      updated[0]!,
      async () => new Response("changed")
    ),
    /checksum/
  );
  const wrong = { ...updated[0]!, profileSha256: "0".repeat(64) };
  await assert.rejects(frozenAnimeBackground(root, wrong), /selected island/);
});

test("unreviewed paths, foreign islands and missing metadata fail before any paid director call", async () => {
  const value = definition();
  assert.throws(
    () =>
      parseAnimeBackground({
        ...value.fallback,
        file: "https://example.com/bg.webp"
      }),
    /path/
  );
  assert.throws(
    () => parseAnimeBackground({ ...value.fallback, file: "../bg.webp" }),
    /path/
  );
  value.islands["999999"] = {
    ...value.fallback,
    mode: "island",
    sourceIslandTokenId: "999999",
    file: `islands/v1/999999/arena.${hash.slice(0, 8)}.webp`
  };
  assert.throws(
    () => compileAnimeBackgroundCatalog(value, base.islands),
    /terrain profile/
  );
  let calls = 0;
  const builder = animeMediaBuilder(
    root,
    {} as never,
    "not-used",
    "not-used",
    async () => {
      calls++;
      throw new Error("must not call");
    }
  );
  await assert.rejects(
    builder(
      "/tmp/unused-background-test",
      { island: base.islands[0] } as unknown as LiveFrozenInput,
      {}
    ),
    /background/
  );
  assert.equal(calls, 0);
});
