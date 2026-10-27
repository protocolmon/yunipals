/** Invoked by the Anvil lifecycle after confirmed settlement. All provider traffic
 * is mocked. Synthetic color/motion/sine fixtures only test the media plumbing. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { StrategyCipher } from "./crypto";
import { ArenaMedia, mediaFolder, offlineMediaTool } from "./media";
import { ArenaMediaApi, within, type MediaRequest } from "./mediaApi";
import { arenaMediaRead } from "./mediaRead";
import { publishedPayoutFilm } from "./payout";
import type { NativeArenaProvider } from "./nativeProvider";
import { mediaIncarnation } from "./mediaPaths";
import { NativeArenaMedia } from "./nativeMedia";

export async function verifyMediaLifecycle(
  pool: Pool,
  cipher: StrategyCipher,
  root: string,
  deployment: string,
  afterPublication?: (storage: string) => Promise<void>,
  options: { guard?: NativeArenaProvider; storage?: string } = {}
) {
  const storage =
    options.storage ?? (await mkdtemp("/tmp/yunipals-media-test-"));
  const context = options.guard
    ? await options.guard.service.tournamentContext("1")
    : undefined;
  const incarnation = context?.incarnation;
  const suffix = context
    ? mediaIncarnation(deployment, "1", context)
    : undefined;
  const requests = new Map<string, { taskType: string; duration?: number }>();
  let creates = 0,
    polls = 0,
    downloads = 0,
    losePost = true,
    loseDownload = true;
  const imagePath = join(storage, "fixture.png");
  const videoPath = join(storage, "fixture.mp4");
  const ffmpeg = (args: string[]) =>
    execFileSync(
      "ffmpeg",
      ["-nostdin", "-y", "-hide_banner", "-loglevel", "error", ...args],
      { stdio: "pipe", timeout: 60000 }
    );
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=purple:s=1280x720",
    "-frames:v",
    "1",
    imagePath
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=1280x720:r=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "5",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    videoPath
  ]);
  const png = await readFile(imagePath),
    mp4 = await readFile(videoPath);
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === "https://api.runware.ai/v1") {
      const [body] = JSON.parse(String(init?.body));
      const uuid = body.taskUUID as string;
      if (body.taskType !== "getResponse") {
        assert.equal(
          requests.has(uuid),
          false,
          "An inference UUID must never be POSTed twice"
        );
        requests.set(uuid, body);
        creates++;
        if (losePost) {
          losePost = false;
          throw new Error("Simulated lost POST response");
        }
      } else {
        polls++;
        assert.ok(requests.has(uuid));
      }
      const original = requests.get(uuid)!;
      return Response.json({
        data: [
          {
            taskUUID: uuid,
            status: "success",
            cost:
              original.taskType === "imageInference"
                ? 0.04
                : original.duration === 3
                  ? 0.1
                  : 0.16,
            ...(original.taskType === "imageInference"
              ? { imageURL: `https://im.runware.ai/${uuid}.png` }
              : { videoURL: `https://vm.runware.ai/${uuid}.mp4` })
          }
        ]
      });
    }
    assert.ok(
      /^https:\/\/(im|vm)\.runware\.ai\//.test(String(url)),
      "Unexpected network destination"
    );
    downloads++;
    if (loseDownload) {
      loseDownload = false;
      throw new Error("Simulated interrupted download");
    }
    return new Response(String(url).endsWith(".png") ? png : mp4);
  }) as typeof fetch;
  const api = new ArenaMediaApi(
    pool,
    "fixture-no-live-key",
    fetcher,
    options.guard,
    storage
  );
  const media = () => new ArenaMedia(pool, cipher, api, root, storage);
  const worker = () => ({
    step: (dep: string, id: string) => media().step(dep, id, incarnation)
  });
  const artifact = async (name: string, range?: string) => {
    const status = await published.status("1");
    return published.artifact("1", name, range, {
      incarnation,
      publication:
        "publication" in status ? (status.publication ?? undefined) : undefined
    });
  };
  const reserve = (id: string, asset: string, request: MediaRequest) =>
    api.reserve(deployment, id, asset, request, incarnation);
  const published = arenaMediaRead(
    pool,
    deployment,
    storage,
    options.guard?.service
  );
  try {
    assert.equal((await published.status("1")).state, "waiting");
    await assert.rejects(
      published.artifact("1", "film.mp4"),
      /not found|Select a published/
    );
    const request: MediaRequest = {
      kind: "image",
      prompt: "fixture",
      references: Array.from({ length: 3 }, () => ({
        file: "fixture.png",
        sha256: "a".repeat(64)
      }))
    };
    await assert.rejects(
      reserve("999", "SF1/image", request),
      /settled result|origin|unavailable|disclosure|not found/
    );
    if (context)
      await pool.query(
        `INSERT INTO yunipals_arena.media_job(deployment,tournament_id,incarnation,input_hash,outcome_hash)
        VALUES($1,1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [
          deployment,
          incarnation,
          context.state.inputHash,
          context.state.resultHash
        ]
      );
    await pool.query(
      "INSERT INTO yunipals_arena.provider_task(deployment,tournament_id,incarnation,kind,asset,request_id,request,reserved_microusd) VALUES($1,1,$3,'test','budget',$2,'{}',900000)",
      [deployment, randomUUID(), incarnation ?? "legacy"]
    );
    try {
      await assert.rejects(
        reserve("1", "SF1/image", request),
        /budget exhausted/
      );
    } finally {
      await pool.query(
        "DELETE FROM yunipals_arena.provider_task WHERE deployment=$1 AND kind='test'",
        [deployment]
      );
    }
    await assert.rejects(worker().step(deployment, "1"), /unconfirmed/);
    assert.equal(creates, 1);
    const task = (
      await pool.query<{ request: MediaRequest; state: string }>(
        "SELECT request,state FROM yunipals_arena.provider_task WHERE deployment=$1 AND asset='SF1/image'",
        [deployment]
      )
    ).rows[0]!;
    assert.equal(task.state, "uncertain");
    await Promise.all([
      reserve("1", "SF1/image", task.request),
      reserve("1", "SF1/image", task.request)
    ]);
    await assert.rejects(
      reserve("1", "SF1/image", {
        ...task.request,
        prompt: "Changed after purchase"
      }),
      /already frozen/
    );
    await assert.rejects(
      worker().step(deployment, "1"),
      /interrupted download/
    );
    assert.equal(creates, 1);
    assert.equal(polls, 1);
    assert.equal((await worker().step(deployment, "1")).state, "ready");
    assert.equal(creates, 9);
    assert.equal(polls, 1);
    assert.equal(downloads, 10);
    const filmResponse = await artifact("film.mp4", "bytes=0-31");
    assert.equal(filmResponse.status, 206);
    assert.equal((await filmResponse.arrayBuffer()).byteLength, 32);
    assert.equal((await artifact("film.mp4", "bytes=-0")).status, 416);
    await assert.rejects(
      published.artifact("1", "../../reference-lock.json"),
      /not found/
    );
    await assert.rejects(
      published.artifact("1", "strategy-encryption.key"),
      /not found/
    );
    await assert.rejects(within(storage, "../outside"), /Invalid media path/);
    const folder = mediaFolder(storage, deployment, "1", suffix);
    // Recreate a missing policy sidecar after a crash without re-editing or buying footage.
    const receipt = JSON.parse(
      await readFile(join(folder, "public/film.json"), "utf8")
    );
    await rm(join(folder, "public/media-policy.json"));
    await offlineMediaTool(root)("assemble", folder);
    assert.ok(await readFile(join(folder, "public/media-policy.json")));
    assert.equal((await worker().step(deployment, "1")).state, "ready");
    assert.equal(creates, 9);
    assert.equal((await published.status("1")).filmSha256, receipt.sha256);
    const costs = (
      await pool.query<{ total: string; tasks: number }>(
        "SELECT sum(coalesce(actual_microusd,reserved_microusd))::text AS total,count(*)::int AS tasks FROM yunipals_arena.provider_task WHERE deployment=$1 AND tournament_id=1",
        [deployment]
      )
    ).rows[0]!;
    assert.equal(costs.total, "1600000");
    assert.equal(costs.tasks, 10);
    assert.equal(
      await publishedPayoutFilm(pool, deployment, "1", storage, context),
      `0x${receipt.sha256}`
    );
    if (!context) {
      await pool.query(
        "UPDATE yunipals_arena.media_job SET state='needs-attention' WHERE deployment=$1 AND tournament_id=1",
        [deployment]
      );
      await assert.rejects(
        publishedPayoutFilm(pool, deployment, "1", storage, context),
        /completed published film/
      );
      await pool.query(
        "UPDATE yunipals_arena.media_job SET state='ready' WHERE deployment=$1 AND tournament_id=1",
        [deployment]
      );
    }
    const film = join(
      mediaFolder(join(storage, "published"), deployment, "1", suffix),
      "film.mp4"
    );
    await rename(film, film + ".saved");
    try {
      await assert.rejects(
        publishedPayoutFilm(pool, deployment, "1", storage, context),
        /ENOENT/
      );
      await writeFile(film, "corrupted footage");
      await assert.rejects(
        publishedPayoutFilm(pool, deployment, "1", storage, context),
        /checksum differs|differs from its manifest/
      );
    } finally {
      await rename(film + ".saved", film);
    }
    if (context) {
      await rm(film);
      assert.equal((await worker().step(deployment, "1")).state, "ready");
      assert.equal(creates, 9);
      assert.equal(filmResponse.headers.get("Cache-Control"), "no-store");
      await assert.rejects(
        published.artifact("1", "film.mp4"),
        /Select a published/
      );
      const scheduler = new NativeArenaMedia(
        options.guard!.service,
        api,
        media()
      );
      assert.equal((await scheduler.tick()).state, "ready");
      assert.equal((await scheduler.tick()).state, "waiting");
      assert.equal(creates, 9);
      const status = await published.status("1");
      await assert.rejects(
        published.artifact("1", "film.mp4", undefined, {
          incarnation: "0x" + "f".repeat(64),
          publication:
            "publication" in status
              ? (status.publication ?? undefined)
              : undefined
        }),
        /not found/
      );
    }
    await afterPublication?.(storage);
    const report = {
      checkedAt: new Date().toISOString(),
      status: "passed",
      provider: "mock only",
      actualSpendUsd: 0,
      expectedProviderTasks: { referee: 1, image: 3, video: 6 },
      budgetLedgerMicrousd: costs.total,
      checks: [
        "fixed result required before spending; no payout credit at this step",
        "missing, failed or checksum-mismatched film cannot unlock payouts",
        "shared 1.60 USD reservation ceiling",
        "concurrent reservations reuse one UUID",
        "lost POST response retrieves original UUID only",
        "download interruption resumes original asset",
        "first successful images and clips retained",
        "real ffmpeg six-shot assembly at 720p/24fps/24 seconds with audio",
        "publication allowlist and HTTP byte ranges",
        "missing sidecar recovers without a new paid task",
        "restart creates no new inference"
      ],
      limitations: [
        "Synthetic motion/color/audio fixtures, not an AI quality assessment",
        "No live provider requests or production publication"
      ],
      film: {
        width: 1280,
        height: 720,
        frames: 576,
        seconds: 24,
        sha256: receipt.sha256
      }
    };
    await writeFile(
      join(
        root,
        context
          ? "docs/unified-indexer/native-arena-media-2026-10-20.json"
          : "docs/arena/media-worker-verification-v1.json"
      ),
      JSON.stringify(report, null, 2) + "\n"
    );
    return report;
  } finally {
    if (!options.storage) await rm(storage, { recursive: true, force: true });
  }
}
