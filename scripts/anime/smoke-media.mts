/** Entire offline media callback with synthetic Base commitments and historical fixture pixels. No network or provider calls. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import {
  ANIME_BASE_COLLECTION,
  type AnimeManifest,
  type AnimeSprite
} from "../../packages/yunipals-market-core/src/anime";
import {
  AnimeFighters,
  animeDigest
} from "../../apps/yunipals-market-api/src/arena/live/animeFighters";
import { animeMediaBuilder } from "../../apps/yunipals-market-api/src/arena/live/animeMedia";
import {
  buildMediaPublication,
  verifyPublicationFile,
  publishedMediaTypes
} from "../../apps/yunipals-market-api/src/arena/live/mediaPublication";
import type { LiveFrozenInput } from "../../apps/yunipals-market-api/src/arena/live/input";
import { manualAnimeDirection } from "../../apps/yunipals-market-api/src/arena/live/animeDirectionFixture";
import { animeRepository } from "../../apps/yunipals-market-api/src/arena/live/animeRepository";
import {
  ANIME_DIRECTOR_MODEL,
  applyAnimeDirection,
  type AnimeDirectionInput
} from "../../apps/yunipals-market-api/src/arena/live/animeDirection";
const root = animeRepository(),
  engine = join(root, "apps/yunipals-anime-engine");
const job = resolve(process.argv[2] ?? "/tmp/yunipals-anime-media-smoke");
if (!job.startsWith("/tmp/"))
  throw new Error("Use a temporary synthetic job folder.");
const chrome = process.env.ANIME_CHROME;
if (!chrome) throw new Error("ANIME_CHROME required.");
const publicationIndex = process.argv.indexOf("--fighter-publication");
const fighterPublication =
  publicationIndex >= 0
    ? resolve(process.argv[publicationIndex + 1]!)
    : undefined;
const publicationToken = process.argv[publicationIndex + 2];
if (fighterPublication && !/^[1-9][0-9]*$/.test(publicationToken ?? ""))
  throw new Error("Use --fighter-publication DIRECTORY TOKEN_ID");
const publishedFighter = fighterPublication
  ? ((await readFile(
      join(
        fighterPublication,
        "fighters/v1",
        publicationToken!,
        "manifest.json"
      ),
      "utf8"
    ).then(JSON.parse)) as AnimeManifest)
  : undefined;
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const fixture = await json(join(engine, "fixtures/tournament.json"));
const index = await json(join(engine, "fixtures/sprites.json"));
const recipe = await json(
  join(root, "docs/arena/anime-recipe-v1/recipe-lock.json")
);
const profiles = (
  await json(join(root, "docs/arena/identity-registry-v1/profiles.json"))
).profiles;
const kinds: Record<string, AnimeManifest["look"]["attackKind"]> = {
  cedar: "vine",
  zephyr: "star",
  bastion: "jet",
  elrond: "orb"
};
const sheets = new Map<string, Buffer>();
const assets = new Map<string, Buffer>(),
  manifests = new Map<string, AnimeManifest>();
const mapping: Record<string, string> = {};
let i = 0;
const roster = [];
const fighters = new AnimeFighters(
  {} as never,
  `0x${"1".repeat(40)}`,
  "https://assets-anime.yunipals.com",
  (async (url: string) => {
    const pathname = new URL(url).pathname;
    if (pathname.startsWith("/recipes/")) {
      const bytes = sheets.get(pathname.slice(1));
      if (!bytes) throw new Error("Unexpected shared sheet request.");
      return new Response(bytes);
    }
    const parts = pathname.split("/");
    const tokenId = parts[3]!,
      name = parts[4]!;
    if (name.endsWith(".json"))
      return new Response(JSON.stringify(manifests.get(tokenId)));
    const bytes = assets.get(tokenId + "/" + name);
    if (!bytes) throw new Error("Unexpected fixture asset request.");
    return new Response(bytes);
  }) as typeof fetch,
  recipe.sha256
);
for (const [alias, data] of Object.entries(fixture.fighters) as Array<
  [string, { name: string; species: string; locomotion: "ground" | "flight" }]
>) {
  const tokenId =
      alias === "cedar" && publishedFighter
        ? publishedFighter.tokenId
        : String(++i),
    sprites: Record<string, AnimeSprite> = {};
  for (const pose of [
    "idle",
    "attack",
    "dodge",
    "dash",
    "guard",
    "hurt",
    "down",
    "victory",
    "cutin"
  ]) {
    const ref = index[alias + "-" + pose] ?? index[alias + "-idle"];
    const bytes = await readFile(join(engine, "fixtures/assets", ref.file));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const file = `${pose}.${sha256.slice(0, 8)}.webp`;
    sprites[pose] = { file, sha256, w: ref.w, h: ref.h };
    assets.set(tokenId + "/" + file, bytes);
  }
  const profile = profiles.find(
    (p: { species: string }) => p.species === data.species
  )!;
  const traits = {
    monsterType: i,
    color: 3,
    horn: 2,
    background: 1,
    glitter: 0
  };
  let manifest: AnimeManifest = {
    version: "anime-fighter/v1",
    chainId: 8453,
    collection: ANIME_BASE_COLLECTION,
    tokenId,
    traits,
    traitsHash: animeDigest(traits),
    artwork: { url: profile.image, sha256: profile.imageSha256 },
    identity: {
      species: data.species,
      color: profile.color,
      horn: profile.horn,
      text: profile.identity,
      locomotion: data.locomotion,
      identityVersion: "anime-fighter-v1"
    },
    recipe: { id: "anime-fighter-v1", sha256: recipe.sha256 },
    look: {
      attackKind: kinds[alias]!,
      face: 1,
      palette: { color: "#b875e3", light: "#f2d7ff", dark: "#482461" },
      stageHeight: Object.fromEntries(
        Object.keys(sprites)
          .filter((p) => p !== "cutin")
          .map((p) => [p, p === "down" ? 150 : 260])
      ),
      origin: [0.35, 0.5],
      torso: [0.05, 0.5]
    },
    sprites,
    generatedWith: "codex-subscription",
    reviewedAt: "2026-10-28T00:00:00Z"
  };
  if (alias === "cedar" && publishedFighter && fighterPublication) {
    manifest = publishedFighter;
    for (const sprite of [
      ...Object.values(manifest.sprites),
      ...manifest.kits!.map((k) => k.windup)
    ])
      assets.set(
        tokenId + "/" + sprite.file,
        await readFile(
          join(fighterPublication, "fighters/v1", tokenId, sprite.file)
        )
      );
    for (const sheet of manifest
      .kits!.flatMap((k) => [k.projectile, k.strike, k.impact])
      .filter((s) => !!s))
      sheets.set(
        sheet.sheet,
        await readFile(join(fighterPublication, sheet.sheet))
      );
  }
  manifests.set(tokenId, manifest);
  const snapshot = fighters.snapshot(
    { nftChainId: 8453, collection: ANIME_BASE_COLLECTION, tokenId },
    manifest
  );
  mapping[alias] = snapshot.id;
  roster.push(snapshot);
}
const map = (id: string) => mapping[id]!;
const input = {
  version: "arena-mainnet-input-v1",
  mode: "base-mainnet",
  tournamentId: "1",
  roster,
  semifinals: fixture.semifinals.map((pair: string[]) => pair.map(map)),
  island: { name: fixture.islandName },
  rules: {
    combat: {
      initialHealth: fixture.initialHealth,
      heavy: { damage: fixture.damage.heavy },
      light: { damage: fixture.damage.light }
    }
  },
  strategies: roster.map((f) => ({
    fighterId: f.id,
    text: "Move carefully. Strike when the opponent recovers.",
    source: "player"
  }))
} as unknown as LiveFrozenInput;
const outcome = {
  status: "resolved",
  championId: map(fixture.championId),
  matches: fixture.matches.map((m: Record<string, unknown>) => ({
    ...m,
    fighterIds: (m.fighterIds as string[]).map(map),
    winnerId: map(m.winnerId as string),
    loserId: map(m.loserId as string),
    events: (m.events as Array<Record<string, unknown>>).map((e) => ({
      ...e,
      actorId: map(e.actorId as string),
      targetId: map(e.targetId as string)
    }))
  }))
};
await mkdir(join(job, "public"), { recursive: true });
await writeFile(
  join(job, "public/input.json"),
  JSON.stringify({ inputSha256: animeDigest(input).slice(2), input })
);
await writeFile(
  join(job, "public/outcome.json"),
  JSON.stringify({
    inputSha256: animeDigest(input).slice(2),
    outcomeSha256: animeDigest(outcome).slice(2),
    outcome
  })
);
if (!process.argv.includes("--verify-existing"))
  await animeMediaBuilder(
    root,
    fighters,
    chrome,
    process.execPath,
    process.argv.includes("--mock-director")
      ? async (_job: string, input: AnimeDirectionInput) => ({
          choreography: applyAnimeDirection(input, manualAnimeDirection(input)),
          receipt: {
            provider: "openrouter",
            model: ANIME_DIRECTOR_MODEL,
            requestId: "offline-fixture",
            generationId: "gen-offline-fixture",
            actualCostUsd: 0,
            actualMicrousd: 0,
            usage: { syntheticFixture: true }
          }
        })
      : undefined
  )(job, input, outcome);
const publication = await buildMediaPublication(join(job, "public"), {
  deployment: `8453:${"0x" + "1".repeat(40)}`,
  tournamentId: "1",
  incarnation: `0x${"e".repeat(64)}`,
  inputHash: animeDigest(input),
  outcomeHash: animeDigest(outcome)
});
assert.deepEqual(
  Object.keys(publication.manifest.files).sort(),
  Object.keys(publishedMediaTypes).sort()
);
for (const [name, proof] of Object.entries(publication.manifest.files))
  await verifyPublicationFile(join(job, "public"), name, proof);
const film = await json(join(job, "public/film.json"));
if (publishedFighter) {
  const rendered = await json(join(job, "assets/fighters.json"));
  const actor = rendered[mapping.cedar!];
  assert.equal(actor.manifestHash, animeDigest(publishedFighter));
  assert.deepEqual(actor.loadout, publishedFighter.defaultLoadout);
  const staged = await json(join(job, "assets/sprites.json"));
  for (const kit of publishedFighter.kits!) {
    assert.equal(
      staged[`${mapping.cedar}-windup-${kit.id}`].sha256,
      kit.windup.sha256
    );
    for (const role of ["projectile", "strike", "impact"] as const)
      if (kit[role])
        assert.equal(
          staged[`${mapping.cedar}-kit-${kit.id}-${role}`].sha256,
          kit[role]!.sha256
        );
  }
  const prompts = await json(join(job, "public/prompts.json"));
  assert.ok(
    Object.values(prompts.choreography.SF1.kits).includes(
      publishedFighter.defaultLoadout![0]
    )
  );
}
assert.equal(film.chromium, "151.0.7922.34");
assert.equal(
  film.probe.streams.find((s: { codecType: string }) => s.codecType === "video")
    .frameRate,
  "30/1"
);
const receipt = await json(join(job, "public/receipts.json"));
assert.equal(receipt.mediaCostMicrousd, 0);
if (process.argv.includes("--mock-director")) {
  assert.equal(receipt.director.generationId, "gen-offline-fixture");
  const prompts = await json(join(job, "public/prompts.json"));
  assert.equal(prompts.director.policy, "claude-choreography/v5");
  assert.equal(prompts.choreography.SF2.kinds["SF2-3"], "dash");
  assert.equal(prompts.choreography.SF2.kinds["SF2-5"], "dash");
  assert.ok(prompts.choreography.SF2.pos[mapping.elrond!].y.length > 1);
  assert.ok(prompts.choreography.SF1.pos[mapping.cedar!].depth.length > 1);
  assert.deepEqual(
    prompts.tournament.matches.map(
      (m: { events: unknown[] }) => m.events.length
    ),
    [5, 5, 6]
  );
}
console.log(
  JSON.stringify(
    {
      syntheticFixture: true,
      mockedDirector: process.argv.includes("--mock-director"),
      ...(publishedFighter
        ? {
            studioTokenId: publishedFighter.tokenId,
            studioManifestHash: animeDigest(publishedFighter)
          }
        : {}),
      publicationHash: publication.publicationHash,
      files: Object.keys(publication.manifest.files),
      duration: film.duration,
      renderWallMs: receipt.renderWallMs,
      providerCalls: 0
    },
    null,
    2
  )
);
