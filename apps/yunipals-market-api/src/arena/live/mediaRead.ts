import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { join } from "node:path";
import type { Pool } from "pg";
import { mediaFolder } from "./mediaPaths";
import { ArenaIntake, ArenaRequestError } from "./intake";
import { assertProviderMode } from "./nativeProvider";
import {
  nativeMediaPublication,
  requireNativePublication,
  verifyPublicationFile,
  publishedMediaTypes as files
} from "./mediaPublication";

export type MediaSelector = { incarnation?: string; publication?: string };
export function arenaMediaRead(
  pool: Pool,
  deployment: string,
  storage: string,
  native?: ArenaIntake
) {
  if (native && (!native.nativeSource || native.deployment !== deployment))
    throw new Error("Native media reader requires matching native state.");
  const selected = () => assertProviderMode(pool, deployment, !!native);
  const status = async (id: string) => {
    await selected();
    if (native) {
      const context = await native.tournamentContext(id);
      const current = await nativeMediaPublication(native, storage, id);
      if (current) {
        for (const [name, proof] of Object.entries(current.manifest.files))
          await verifyPublicationFile(current.folder, name, proof);
        await requireNativePublication(native, storage, id, {
          incarnation: current.context.incarnation,
          publication: current.publicationHash
        });
        return {
          state: "ready",
          incarnation: current.context.incarnation,
          publication: current.publicationHash,
          filmSha256: current.manifest.filmSha256,
          payoutsReleased: !!current.context.state.videoHash
        };
      }
      const row = (
        await pool.query<{ state: string }>(
          `SELECT state FROM yunipals_arena.media_job WHERE deployment=$1 AND tournament_id=$2 AND incarnation=$3
            AND input_hash=$4 AND outcome_hash=$5`,
          [
            deployment,
            id,
            context.incarnation,
            context.state.inputHash,
            context.state.resultHash
          ]
        )
      ).rows[0];
      await native.ready();
      const fresh = await native.tournamentContext(id);
      if (
        fresh.incarnation !== context.incarnation ||
        fresh.state.inputHash !== context.state.inputHash ||
        fresh.state.resultHash !== context.state.resultHash
      )
        throw new ArenaRequestError(503, "Arena video state is updating.");
      return {
        state: row?.state === "ready" ? "waiting" : (row?.state ?? "waiting"),
        incarnation: context.incarnation,
        publication: null,
        filmSha256: null,
        payoutsReleased: !!fresh.state.videoHash
      };
    }
    const row = (
      await pool.query<{
        state: string;
        film_sha256: string | null;
        video_hash: string | null;
      }>(
        `SELECT m.state,m.film_sha256,t.state->>'videoHash' AS video_hash FROM yunipals_arena.media_job m
       JOIN yunipals_arena.tournament t ON t.deployment=m.deployment AND t.id=m.tournament_id
       WHERE m.deployment=$1 AND m.tournament_id=$2 AND m.incarnation='legacy' AND t.state->>'phase'='settled'`,
        [deployment, id]
      )
    ).rows[0];
    return {
      state: row?.state ?? "waiting",
      filmSha256: row?.film_sha256 ?? null,
      payoutsReleased: !!row?.video_hash
    };
  };
  const artifact = async (
    id: string,
    name: string,
    range?: string,
    selector: MediaSelector = {}
  ) => {
    await selected();
    if (!Object.hasOwn(files, name))
      throw new ArenaRequestError(404, "Published video artifact not found.");
    let path: string;
    if (native) {
      if (!selector.incarnation || !selector.publication)
        throw new ArenaRequestError(
          400,
          "Select a published Arena video first."
        );
      const current = await requireNativePublication(
        native,
        storage,
        id,
        selector
      );
      path = await verifyPublicationFile(
        current.folder,
        name,
        current.manifest.files[name]!
      );
      await requireNativePublication(native, storage, id, selector);
    } else {
      if ((await status(id)).state !== "ready")
        throw new ArenaRequestError(404, "Published video artifact not found.");
      path = join(
        mediaFolder(join(storage, "published"), deployment, id),
        name
      );
    }
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
      "Cache-Control": native ? "no-store" : "public, max-age=3600",
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
