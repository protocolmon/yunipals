import { tmpdir } from "node:os";
import { join } from "node:path";
import { arenaConfig } from "./config";
import { createArenaApp } from "./http";
import type { ArenaIntake } from "./intake";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import type { PublicClient, Address } from "viem";
import {
  ANIME_BASE_COLLECTION,
  canonicalAnimeJson,
  parseAnimeManifest,
  arenaEconomics,
  type AnimeManifest
} from "@protopals/yunipals-market-core/anime";
import { AnimeFighters, animeDigest, boundedAnimeFetch } from "./animeFighters";
import { loadAnimeArenaCatalog, loadLiveArenaCatalog } from "./catalog";
import { exportAnimeTournament } from "./animeMedia";
import type { LiveFrozenInput } from "./input";
import type { AnimeMatch } from "../../../../yunipals-anime-engine/src/director";
const registry = `0x${"1".repeat(40)}` as Address;
const origin = "https://assets-anime.yunipals.com";
const bytes = Buffer.from("sprite-fixture");
const hash = createHash("sha256").update(bytes).digest("hex");
function manifest(): AnimeManifest {
  const traits = {
    monsterType: 7,
    color: 3,
    horn: 2,
    background: 1,
    glitter: 0
  };
  return {
    version: "anime-fighter/v1",
    chainId: 8453,
    collection: ANIME_BASE_COLLECTION,
    tokenId: "1234",
    traits,
    traitsHash: animeDigest(traits),
    artwork: {
      url: "https://drive.polychainmonsters.com/ipfs/QmExampleArtwork",
      sha256: "a".repeat(64)
    },
    identity: {
      species: "Unibranch",
      color: "Purple",
      horn: "Candy Cane",
      text: "Four hoof legs; no wings. Ground movement.",
      locomotion: "ground",
      identityVersion: "anime-fighter-v1"
    },
    recipe: { id: "anime-fighter-v1", sha256: "b".repeat(64) },
    look: {
      attackKind: "vine",
      face: 1,
      palette: { color: "#112233", light: "#aabbcc", dark: "#000000" },
      stageHeight: Object.fromEntries(
        [
          "idle",
          "attack",
          "guard",
          "hurt",
          "down",
          "victory",
          "dodge",
          "dash"
        ].map((p) => [p, 260])
      ),
      origin: [0.35, 0.5],
      torso: [0.05, 0.5]
    },
    sprites: Object.fromEntries(
      [
        "idle",
        "attack",
        "guard",
        "hurt",
        "down",
        "victory",
        "dodge",
        "dash",
        "cutin"
      ].map((p) => [
        p,
        { file: `${p}.${hash.slice(0, 8)}.webp`, sha256: hash, w: 64, h: 64 }
      ])
    ),
    generatedWith: "codex-subscription",
    reviewedAt: "2026-10-28T00:00:00Z"
  };
}
function setup(
  options: {
    status?: number;
    currentTraits?: unknown;
    manifest?: AnimeManifest;
    chainHash?: string;
    corruptSprite?: boolean;
  } = {}
) {
  const m = options.manifest ?? manifest();
  const reads: Array<{ functionName: string; blockNumber?: bigint }> = [];
  const urls: string[] = [];
  const client = {
    readContract: async (args: {
      functionName: string;
      blockNumber?: bigint;
    }) => {
      reads.push(args);
      return args.functionName === "fighters"
        ? [options.status ?? 2, 1, 1, options.chainHash ?? animeDigest(m)]
        : (options.currentTraits ?? { ...m.traits, rarityScore: 10n });
    }
  } as unknown as PublicClient;
  const fetcher = (async (url: string) => {
    urls.push(url);
    return new Response(
      url.endsWith(".webp")
        ? options.corruptSprite
          ? Buffer.from("tampered")
          : bytes
        : JSON.stringify(m)
    );
  }) as typeof fetch;
  return {
    fighters: new AnimeFighters(client, registry, origin, fetcher),
    m,
    reads,
    urls
  };
}
const nft = {
  nftChainId: 8453,
  collection: ANIME_BASE_COLLECTION,
  tokenId: "1234"
};
test("anime admission reads approval and traits at the ownership block", async () => {
  const { fighters, m, reads } = setup();
  assert.deepEqual(await fighters.eligible(nft, 90n), m);
  assert.deepEqual(
    reads.map((r) => [r.functionName, r.blockNumber]),
    [
      ["fighters", 90n],
      ["yunipal", 90n]
    ]
  );
  const snapshot = fighters.snapshot(nft, m);
  assert.equal(snapshot.identityVersion, "anime-fighter-v1");
  assert.equal(snapshot.animeManifestHash, animeDigest(m));
  assert.equal(snapshot.locomotion, "ground");
});
test("foreign collections are refused without RPC or asset reads", async () => {
  const { fighters, reads, urls } = setup();
  await assert.rejects(
    fighters.eligible({ ...nft, nftChainId: 1 }, 90n),
    /Base OG/
  );
  await assert.rejects(
    fighters.eligible({ ...nft, collection: registry }, 90n),
    /Base OG/
  );
  assert.equal(reads.length + urls.length, 0);
});
test("unapproved fighters cannot receive a paid entry permit", async () => {
  for (const status of [0, 1, 3, 4]) {
    const { fighters, urls } = setup({ status });
    await assert.rejects(fighters.eligible(nft, 90n), /curator approval/);
    assert.equal(urls.length, 0);
  }
});
test("artwork changes after approval fail closed", async () => {
  const { fighters } = setup({
    currentTraits: { ...manifest().traits, color: 4 }
  });
  await assert.rejects(fighters.eligible(nft, 90n), /traits changed/);
});
test("manifest and sprite changes fail their commitments", async () => {
  const one = setup({ chainHash: `0x${"f".repeat(64)}` });
  await assert.rejects(
    one.fighters.eligible(nft, 90n),
    /differs from its approval/
  );
  const two = setup({ corruptSprite: true });
  await assert.rejects(
    two.fighters.manifest("1234", animeDigest(two.m), true),
    /checksum/
  );
});
test("untrusted file paths and unrelated tokens are rejected", () => {
  const m = manifest();
  m.sprites.idle!.file = "../../secret.webp";
  assert.throws(() => parseAnimeManifest(m, "1234"), /Invalid/);
  assert.throws(() => parseAnimeManifest(manifest(), "1235"), /Invalid/);
  assert.throws(() => parseAnimeManifest(manifest(), "01"), /Invalid/);
});
test("canonical hashes do not depend on key order", () => {
  assert.equal(
    canonicalAnimeJson({ z: 1, a: { c: "é", b: 2 } }),
    '{"a":{"b":2,"c":"é"},"z":1}'
  );
  assert.equal(animeDigest({ b: 2, a: 1 }), animeDigest({ a: 1, b: 2 }));
  assert.throws(() => canonicalAnimeJson({ value: Infinity }));
});
test("streamed asset bodies are bounded even without Content-Length", async () => {
  const fetcher = (async () =>
    new Response(new Uint8Array(65))) as typeof fetch;
  await assert.rejects(boundedAnimeFetch(origin, 64, fetcher), /size limit/);
});
test("approved economics and referee settings are isolated from the video arena", () => {
  const root = resolve("../..");
  const video = loadLiveArenaCatalog(root),
    anime = loadAnimeArenaCatalog(root, registry);
  assert.deepEqual(anime.manifest.referee, video.manifest.referee);
  assert.deepEqual(anime.rules, video.rules);
  assert.notEqual(anime.rulesHash, video.rulesHash);
  assert.equal(anime.manifest.economics.entryMicrousd, 1000000);
  assert.equal(video.manifest.economics.entryMicrousd, 2000000);
  assert.deepEqual(Object.keys(anime.manifest.supportedNftCollections), [
    "8453"
  ]);
  assert.equal(arenaEconomics("anime").winner, 3200000n);
  assert.equal(arenaEconomics().winner, 6000000n);
});
test("tournament export retains the referee's exact combat events and winners", () => {
  const root = resolve("../..");
  const fixture = JSON.parse(
    readFileSync(
      resolve(root, "apps/yunipals-anime-engine/fixtures/tournament.json"),
      "utf8"
    )
  ) as { matches: AnimeMatch[]; championId: string };
  const input = {
    tournamentId: "1",
    island: { name: "Fixture Island" },
    rules: {
      combat: {
        initialHealth: 60,
        heavy: { damage: 30 },
        light: { damage: 15 }
      }
    },
    roster: [],
    semifinals: []
  } as unknown as LiveFrozenInput;
  const before = JSON.stringify(fixture);
  const exported = exportAnimeTournament(input, fixture);
  assert.deepEqual(exported.matches, fixture.matches);
  assert.equal(exported.championId, fixture.championId);
  assert.equal(JSON.stringify(fixture), before);
});

test("battle export normalizes Yuni labels without changing frozen identities, manifests or hashes", () => {
  const { fighters, m } = setup();
  const snapshot = fighters.snapshot(nft, m);
  const input = {
    tournamentId: "1",
    island: { name: "Fixture Island" },
    rules: {
      combat: {
        initialHealth: 60,
        heavy: { damage: 30 },
        light: { damage: 15 }
      }
    },
    roster: [snapshot],
    semifinals: []
  } as unknown as LiveFrozenInput;
  const outcome = { matches: [], championId: snapshot.id };
  const inputHash = animeDigest(input);
  const manifestHash = animeDigest(m);
  const exported = exportAnimeTournament(input, outcome);
  assert.equal(exported.fighters[snapshot.id]!.name, "Yunibranch #1234");
  assert.equal(exported.fighters[snapshot.id]!.species, "Yunibranch");
  assert.equal(input.roster[0]!.species, "Unibranch");
  assert.equal(m.identity.species, "Unibranch");
  assert.equal(animeDigest(m), manifestHash);
  assert.equal(animeDigest(input), inputHash);
  assert.equal(exported.source.inputSha256, inputHash.slice(2));
  assert.equal(exported.source.outcomeSha256, animeDigest(outcome).slice(2));
  assert.equal(exported.championId, outcome.championId);
});

test("anime configuration refuses missing registry, other asset origins and legacy mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "anime-config-"));
  const key = join(dir, "synthetic.key");
  writeFileSync(key, "00".repeat(32), { mode: 0o600 });
  const common = {
    ARENA_CONTRACT: registry,
    ARENA_DEPLOYMENT_BLOCK: "1",
    ARENA_RULES_HASH: `0x${"a".repeat(64)}`,
    ARENA_ENCRYPTION_KEY_FILE: key,
    ARENA_DATABASE_URL: "postgres://synthetic@127.0.0.1/arena",
    ARENA_MEDIA_KIND: "anime",
    ARENA_INDEXER_MODE: "unified",
    ARENA_ELIGIBILITY_REGISTRY: registry
  };
  try {
    assert.equal(arenaConfig(common).port, 53912);
    for (const change of [
      { ARENA_ELIGIBILITY_REGISTRY: "" },
      { ARENA_INDEXER_MODE: "legacy" },
      { ARENA_INDEXER_SOURCE_KIND: "legacy_rollback" },
      { ARENA_FIGHTER_ASSETS_ORIGIN: "https://untrusted.example" }
    ])
      assert.throws(() => arenaConfig({ ...common, ...change }));
    const video = {
      ...common,
      ARENA_MEDIA_KIND: "video",
      ARENA_ELIGIBILITY_REGISTRY: undefined,
      ARENA_INDEXER_MODE: undefined
    };
    assert.equal(arenaConfig(video).port, 53911);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("anime HTTP config and auth use a separate deployment fee and session cookie", async () => {
  const service = {
    origin: "https://www.yunipals.com",
    contract: registry,
    deployment: `8453:${registry}`,
    indexerMode: "unified",
    authenticate: async () => ({ token: "synthetic-session", wallet: registry })
  } as unknown as ArenaIntake;
  const app = createArenaApp(service, {
    entriesEnabled: false,
    mediaKind: "anime",
    eligibilityRegistry: registry,
    fighter: async () => ({
      fighter: { status: "Rejected", note: "Public note" }
    })
  });
  const config = await (await app.request("/config")).json();
  assert.equal(config.entryFee, "1000000");
  assert.equal(config.eligibilityRegistry, registry);
  assert.equal(
    (await (await app.request("/fighters/1")).json()).fighter.note,
    "Public note"
  );
  const response = await app.request("/auth/verify", {
    method: "POST",
    headers: { Origin: service.origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: "00000000-0000-0000-0000-000000000001",
      signature: "0x1234"
    })
  });
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("Set-Cookie")!,
    /^__Host-yunipals-anime-arena=/
  );
  assert.equal((await response.json()).token, undefined);
});
