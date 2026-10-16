import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import type { Hono } from "hono";

import { ArenaError, type ArenaLabService } from "./service";

const artifacts: Record<string, string> = {
  "input.json": "application/json",
  "outcome.json": "application/json",
  "validation.json": "application/json",
  "prompts.json": "application/json",
  "receipts.json": "application/json",
  "film.json": "application/json",
  "film.mp4": "video/mp4",
  "native-sfx.mp4": "video/mp4",
  "credits.txt": "text/plain; charset=utf-8",
  "SF1.png": "image/png",
  "SF2.png": "image/png",
  "FINAL.png": "image/png"
};

export function addArenaProductionRoutes(
  app: Hono,
  service: ArenaLabService,
  directory: string
) {
  function publicPath(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new ArenaError(404, "Tournament not found.");
    // This check also prevents exposing a job before all strategies reveal.
    service.export(id);
    return join(directory, "jobs", id, "public");
  }
  app.get("/api/arena/tournaments/:id/production", (context) => {
    const path = join(publicPath(context.req.param("id")), "status.json");
    if (!existsSync(path))
      return context.json({
        phase: "not-started",
        message: "No production job has been authorized for this tournament."
      });
    return context.json({
      ...JSON.parse(readFileSync(path, "utf8")),
      availableOpeningFrames: ["SF1", "SF2", "FINAL"].filter((match) =>
        existsSync(join(publicPath(context.req.param("id")), `${match}.png`))
      )
    });
  });
  app.get("/api/arena/tournaments/:id/artifacts/:name", (context) => {
    const name = context.req.param("name");
    const mime = Object.hasOwn(artifacts, name) ? artifacts[name] : undefined;
    if (!mime) throw new ArenaError(404, "Artifact not available.");
    const path = join(publicPath(context.req.param("id")), name);
    if (!existsSync(path)) throw new ArenaError(404, "Artifact not ready yet.");
    const size = statSync(path).size;
    const range = context.req.header("range");
    let start = 0;
    let end = size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` }
        });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      )
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` }
        });
    }
    const headers: Record<string, string> = {
      "Content-Type": mime,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    return new Response(
      Readable.toWeb(
        createReadStream(path, { start, end })
      ) as ReadableStream<Uint8Array>,
      { status: range ? 206 : 200, headers }
    );
  });
}
