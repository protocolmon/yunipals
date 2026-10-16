import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import type { Pool } from "pg";
import { mediaFolder } from "./media";
import { ArenaRequestError } from "./intake";

const files: Record<string, string> = {
  "film.mp4": "video/mp4",
  "native-sfx.mp4": "video/mp4",
  "SF1.png": "image/png",
  "SF2.png": "image/png",
  "FINAL.png": "image/png",
  "input.json": "application/json",
  "outcome.json": "application/json",
  "prompts.json": "application/json",
  "film.json": "application/json",
  "receipts.json": "application/json",
  "media-policy.json": "application/json",
  "credits.txt": "text/plain; charset=utf-8"
};
export function arenaMediaRead(
  pool: Pool,
  deployment: string,
  storage: string
) {
  const status = async (id: string) => {
    const row = (
      await pool.query<{
        state: string;
        film_sha256: string | null;
        video_hash: string | null;
      }>(
        `SELECT m.state,m.film_sha256,t.state->>'videoHash' AS video_hash FROM yunipals_arena.media_job m
       JOIN yunipals_arena.tournament t ON t.deployment=m.deployment AND t.id=m.tournament_id
       WHERE m.deployment=$1 AND m.tournament_id=$2 AND t.state->>'phase'='settled'`,
        [deployment, id]
      )
    ).rows[0];
    return {
      state: row?.state ?? "waiting",
      filmSha256: row?.film_sha256 ?? null,
      payoutsReleased: !!row?.video_hash
    };
  };
  const artifact = async (id: string, name: string, range?: string) => {
    if (!Object.hasOwn(files, name) || (await status(id)).state !== "ready")
      throw new ArenaRequestError(404, "Published video artifact not found.");
    const path = join(
      mediaFolder(join(storage, "published"), deployment, id),
      name
    );
    const { size } = await stat(path);
    let start = 0,
      end = size - 1;
    if (range) {
      const matched = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!matched || (!matched[1] && !matched[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` }
        });
      start = matched[1]
        ? Number(matched[1])
        : Math.max(0, size - Number(matched[2]));
      end =
        matched[1] && matched[2]
          ? Math.min(size - 1, Number(matched[2]))
          : size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start > end ||
        start >= size
      )
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` }
        });
    }
    const headers: Record<string, string> = {
      "Content-Type": files[name]!,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff"
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new Response(
      Readable.toWeb(
        createReadStream(path, { start, end })
      ) as ReadableStream<Uint8Array>,
      { status: range ? 206 : 200, headers }
    );
  };
  return { status, artifact };
}
