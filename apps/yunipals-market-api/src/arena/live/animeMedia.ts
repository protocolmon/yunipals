import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir
} from "node:fs/promises";
import { join } from "node:path";
import {
  ANIME_BASE_COLLECTION,
  type AnimeManifest
} from "@protopals/yunipals-market-core/anime";
import {
  directTournament,
  type AnimeTournament,
  type AnimeMatch
} from "../../../../yunipals-anime-engine/src/director";
import { animeFighterName } from "../../../../yunipals-anime-engine/src/fighterNames.js";
import { AnimeFighters } from "./animeFighters";
import type { LiveFrozenInput } from "./input";
import {
  ANIME_DIRECTOR_POLICY,
  type AnimeDirectionInput,
  type AnimeDirectorReceipt
} from "./animeDirection";
import { canonicalJson, sha256 } from "../draw";
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const json = async (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });

export function exportAnimeTournament(
  input: LiveFrozenInput,
  outcome: { matches: AnimeMatch[]; championId: string }
): AnimeTournament {
  const combat = input.rules.combat as unknown as {
    initialHealth: number;
    heavy: { damage: number };
    light: { damage: number };
  };
  if (
    ![combat.initialHealth, combat.heavy?.damage, combat.light?.damage].every(
      Number.isFinite
    )
  )
    throw new Error("Invalid combat numbers.");
  return {
    source: {
      tournamentId: input.tournamentId,
      inputSha256: sha256(canonicalJson(input)),
      outcomeSha256: sha256(canonicalJson(outcome))
    },
    islandName: input.island.name,
    initialHealth: Number(combat.initialHealth),
    damage: {
      heavy: Number(combat.heavy.damage),
      light: Number(combat.light.damage)
    },
    fighters: Object.fromEntries(
      input.roster.map((f) => [
        f.id,
        {
          name: animeFighterName(f.name),
          species: animeFighterName(f.species),
          locomotion: f.locomotion
        }
      ])
    ),
    semifinals: input.semifinals,
    matches: outcome.matches.map((m) => ({
      id: m.id,
      fighterIds: m.fighterIds,
      winnerId: m.winnerId,
      loserId: m.loserId,
      verdict: m.verdict,
      verdictSeconds: m.verdictSeconds,
      settledSeconds: m.settledSeconds,
      whyWinner: m.whyWinner,
      events: m.events
    })),
    championId: outcome.championId
  };
}
/** Render children receive only paths and locale; no provider or signing credentials. */
export function offlineAnimeTool(
  command: string,
  args: string[],
  chrome?: string
): Promise<void> {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      timeout: 15 * 60 * 1000,
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
        PYTHONDONTWRITEBYTECODE: "1",
        ...(chrome ? { ANIME_CHROME: chrome } : {})
      }
    });
    // Children receive no secrets. Retain a bounded diagnostic for offline
    // recovery rather than losing the cause behind a generic render failure.
    let diagnostic = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      diagnostic = (diagnostic + chunk.toString("utf8")).slice(-4096);
    });
    child.on("error", () =>
      reject(new Error("Anime render tool could not start."))
    );
    child.on("close", (code) =>
      code === 0
        ? accept()
        : reject(
            new Error(
              `Anime render failed (${code}); job retained for recovery. ${diagnostic.trim()}`
            )
          )
    );
  });
}
export function animeMediaBuilder(
  repository: string,
  fighters: AnimeFighters,
  chrome: string,
  node: string,
  director?: (
    job: string,
    input: AnimeDirectionInput
  ) => Promise<{
    choreography: ReturnType<typeof directTournament>;
    receipt: AnimeDirectorReceipt;
  }>
) {
  return async (job: string, input: LiveFrozenInput, candidate: unknown) => {
    const renderStarted = Date.now();
    const engine = join(repository, "apps/yunipals-anime-engine");
    const assets = join(job, "assets");
    await mkdir(assets, { recursive: true });
    const manifests: Record<
      string,
      { manifest: AnimeManifest; manifestHash: string }
    > = {};
    const sprites: Record<string, { file: string; sha256: string }> = {};
    for (const fighter of input.roster) {
      if (
        fighter.chainId !== 8453 ||
        fighter.collection !== ANIME_BASE_COLLECTION ||
        fighter.identityVersion !== "anime-fighter-v1" ||
        !fighter.animeManifestHash
      )
        throw new Error(
          "Anime media requires approved Base fighter snapshots."
        );
      if (!/^[a-zA-Z0-9-]+$/.test(fighter.id))
        throw new Error("Invalid fighter ID.");
      const m = await fighters.manifest(
        fighter.tokenId,
        fighter.animeManifestHash
      );
      if (m.recipe.sha256 !== fighter.animeRecipeHash)
        throw new Error("Fighter recipe changed.");
      manifests[fighter.id] = {
        manifest: m,
        manifestHash: fighter.animeManifestHash
      };
      for (const [pose, sprite] of Object.entries(m.sprites)) {
        const bytes = await fighters.spriteBytes(fighter.tokenId, sprite);
        const file = `${fighter.id}-${sprite.file}`;
        await writeFile(join(assets, file), bytes, { mode: 0o600 });
        sprites[`${fighter.id}-${pose}`] = { file, sha256: sprite.sha256 };
      }
    }
    for (const file of await readdir(join(engine, "static/assets")))
      await copyFile(join(engine, "static/assets", file), join(assets, file));
    sprites["bg-arena"] = {
      file: "bg-arena.webp",
      sha256: digest(await readFile(join(assets, "bg-arena.webp")))
    };
    const tournament = exportAnimeTournament(
      input,
      candidate as { matches: AnimeMatch[]; championId: string }
    );
    const baseChoreography = directTournament(
      tournament,
      Object.fromEntries(
        Object.entries(manifests).map(([id, m]) => [id, m.manifest.look])
      ),
      Object.fromEntries(input.strategies.map((s) => [s.fighterId, s.text]))
    );
    const direction = director
      ? await director(job, {
          tournament,
          strategies: Object.fromEntries(
            input.strategies.map((s) => [s.fighterId, s.text])
          ),
          choreography: baseChoreography
        })
      : null;
    const choreography = direction?.choreography ?? baseChoreography;
    await json(join(assets, "tournament.json"), tournament);
    await json(join(assets, "choreography.json"), choreography);
    await json(join(assets, "fighters.json"), manifests);
    await json(join(assets, "sprites.json"), sprites);
    await json(join(job, "public/prompts.json"), {
      version: "anime-director/v2",
      inputSha256: tournament.source.inputSha256,
      outcomeSha256: tournament.source.outcomeSha256,
      shots: [],
      tournament,
      choreography,
      director: direction
        ? { policy: ANIME_DIRECTOR_POLICY, ...direction.receipt }
        : "rules-only; no model or outcome edits"
    });
    await offlineAnimeTool(node, [join(engine, "render.mjs"), job], chrome);
    const cues = join(job, "film.cues.json");
    const music = join(
      repository,
      "docs/islands/race-film-v4/audio/split-in-synapse-original.mp3"
    );
    await offlineAnimeTool("python3", [
      join(engine, "mix.py"),
      cues,
      "-",
      join(job, "sfx.wav")
    ]);
    await offlineAnimeTool("python3", [
      join(engine, "mix.py"),
      cues,
      music,
      join(job, "mix.wav")
    ]);
    for (const [audio, file] of [
      ["sfx.wav", "native-sfx.mp4"],
      ["mix.wav", "film.mp4"]
    ])
      await offlineAnimeTool("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        join(job, "silent.mp4"),
        "-i",
        join(job, audio!),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        join(job, "public", file!)
      ]);
    const receipt = JSON.parse(
      await readFile(join(job, "render-receipt.json"), "utf8")
    ) as {
      duration: number;
      chapters: Array<{ id: string; t: number }>;
      engineVersion: string;
      engineSha256: string;
      chromium: string;
    };
    const probe = await probeAnimeFilm(join(job, "public/film.mp4"));
    if (Math.abs(probe.duration - receipt.duration) > 0.1)
      throw new Error(
        "Anime film duration differs from its deterministic render."
      );
    const nativeProbe = await probeAnimeFilm(
      join(job, "public/native-sfx.mp4")
    );
    if (Math.abs(nativeProbe.duration - probe.duration) > 0.05)
      throw new Error("Anime audio variants differ in duration.");
    const film = await readFile(join(job, "public/film.mp4"));
    await json(join(job, "public/film.json"), {
      sha256: digest(film),
      outcomeSha256: tournament.source.outcomeSha256,
      inputSha256: tournament.source.inputSha256,
      ...receipt,
      probe,
      musicSha256: digest(await readFile(music)),
      matches: receipt.chapters.map((c, i) => ({
        id: c.id,
        start: c.t,
        end: receipt.chapters[i + 1]?.t ?? receipt.duration
      })),
      fighterManifests: Object.fromEntries(
        input.roster.map((f) => [
          f.id,
          { manifestHash: f.animeManifestHash, recipeHash: f.animeRecipeHash }
        ])
      )
    });
    await json(join(job, "public/receipts.json"), {
      kind: "anime-render/v1",
      ...receipt,
      renderWallMs: Date.now() - renderStarted,
      mediaCostMicrousd: direction?.receipt.actualMicrousd ?? 0,
      director: direction?.receipt ?? null
    });
    await json(join(job, "public/media-policy.json"), {
      version: "anime-engine/v1",
      authoritative: "published film and frozen referee outcome",
      engineVersion: receipt.engineVersion,
      engineSha256: receipt.engineSha256,
      generatedWith: "codex-subscription",
      director: direction
        ? {
            policy: ANIME_DIRECTOR_POLICY,
            model: direction.receipt.model,
            provider: direction.receipt.provider
          }
        : "rules-only"
    });
    await writeFile(
      join(job, "public/credits.txt"),
      'Yunipals Anime Arena. NFT and fighter artwork: Yunipals; token links in input.json.\nMusic: "Split In Synapse" by Kevin MacLeod (incompetech.com).\nSource: https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100703\nCreative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/\nChanges: excerpted, looped, level, fades and synthesised SFX mix. Keep credit when sharing.\nFonts: Bangers by Vernon Adams and Russo One by Jovanny Lemonad, SIL Open Font License 1.1.\n'
    );
  };
}

export function probeAnimeFilm(file: string): Promise<{
  duration: number;
  streams: Array<{
    codecType: string;
    codecName: string;
    width?: number;
    height?: number;
    frameRate?: string;
  }>;
}> {
  return new Promise((accept, reject) => {
    const child = spawn(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 30000,
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" }
      }
    );
    let bytes = 0;
    const parts: Buffer[] = [];
    child.stdout.on("data", (part: Buffer) => {
      bytes += part.length;
      if (bytes > 1000000) child.kill();
      else parts.push(part);
    });
    child.on("error", () =>
      reject(new Error("Anime film probe could not start."))
    );
    child.on("close", (code) => {
      try {
        if (code !== 0 || bytes > 1000000) throw new Error();
        const probe = JSON.parse(Buffer.concat(parts).toString("utf8")) as {
          format: { duration: string };
          streams: Array<{
            codec_type: string;
            codec_name: string;
            width?: number;
            height?: number;
            avg_frame_rate?: string;
          }>;
        };
        const duration = Number(probe.format.duration),
          video = probe.streams.find((s) => s.codec_type === "video");
        if (
          !Number.isFinite(duration) ||
          duration <= 0 ||
          video?.width !== 1280 ||
          video.height !== 720 ||
          video.avg_frame_rate !== "30/1" ||
          !probe.streams.some((s) => s.codec_type === "audio")
        )
          throw new Error();
        accept({
          duration,
          streams: probe.streams.map((s) => ({
            codecType: s.codec_type,
            codecName: s.codec_name,
            ...(s.width
              ? {
                  width: s.width,
                  height: s.height,
                  frameRate: s.avg_frame_rate
                }
              : {})
          }))
        });
      } catch {
        reject(new Error("Anime film must be 1280×720 at 30 fps with audio."));
      }
    });
  });
}
