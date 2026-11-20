import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  injectMetadata,
  resolvePageMetadata,
  staticImagePath,
  type PageMetadata
} from "../../src/lib/social/metadata";
import type { PreviewConfig } from "./config";
import { createReader, PreviewError, type PreviewReader } from "./fetch";
import { renderPreview } from "./render";
import { resolvePreview } from "./resolve";

export type SocialHandlerOptions = {
  config: PreviewConfig;
  directory: string;
  html: string;
  read?: PreviewReader;
};

export function createSocialHandler(options: SocialHandlerOptions) {
  const { config, directory, html } = options;
  const read = options.read ?? createReader(config);
  const pending = new Map<string, Promise<Response>>();
  let rendering = 0;
  const respond = (
    body: string | Buffer | null,
    status = 200,
    type = "text/html; charset=utf-8",
    seconds = 60
  ) =>
    new Response(body as BodyInit | null, {
      status,
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=0, must-revalidate",
        "CDN-Cache-Control": `public, max-age=${seconds}`,
        "X-Content-Type-Options": "nosniff"
      }
    });

  async function handle(url: URL, image: boolean): Promise<Response> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    let meta: PageMetadata = resolvePageMetadata(url, config);
    try {
      if (meta.redirect)
        return new Response(null, {
          status: 308,
          headers: {
            Location: meta.redirect,
            "Cache-Control": "public, max-age=60"
          }
        });
      if (meta.status !== 200)
        return respond(
          image ? "Collectible not found." : injectMetadata(html, meta),
          meta.status,
          image ? "text/plain" : undefined,
          15
        );
      let seconds = 60;
      if (meta.asset) {
        const preview = await resolvePreview(
          meta,
          config,
          read,
          controller.signal
        );
        seconds = preview.state === "ready" ? (image ? 300 : 60) : 15;
        meta = {
          ...meta,
          title: `${preview.name} — Yunipals`,
          description: `${preview.subtitle}. ${preview.traits.join(" · ")}`,
          imageAlt: `${preview.name}. ${preview.subtitle}`,
          image: `${meta.image}&revision=${preview.revision}`
        };
        if (image) {
          if (rendering >= 2)
            throw new PreviewError(
              503,
              "Previews are busy. Try again shortly."
            );
          rendering++;
          try {
            const bytes = preview.image
              ? await read(preview.image, controller.signal, true)
              : await readFile(join(directory, "fallback.png"));
            const png = await renderPreview(preview, bytes, {
              directory,
              collectible: true
            });
            return respond(png, 200, "image/png", seconds);
          } finally {
            rendering--;
          }
        }
      } else if (image) throw new PreviewError(404, "Collectible not found.");
      return respond(injectMetadata(html, meta), 200, undefined, seconds);
    } catch (error) {
      const status = error instanceof PreviewError ? error.status : 503;
      console.warn(
        JSON.stringify({
          event: "social_preview_fallback",
          reason: status === 404 ? "not_found" : "unavailable",
          image,
          durationMs: Date.now() - started
        })
      );
      if (image) {
        if (status === 404)
          return respond("Collectible not found.", 404, "text/plain", 15);
        return respond(
          await readFile(join(directory, "unavailable.png")),
          200,
          "image/png",
          0
        );
      }
      meta = {
        ...meta,
        image: new URL(staticImagePath("utility", config), config.siteOrigin)
          .href,
        imageAlt: "Yunipals artwork · Details temporarily unavailable"
      };
      if (status === 404)
        meta = {
          ...meta,
          title: "Collectible not found — Yunipals",
          robots: "noindex, follow"
        };
      return respond(
        injectMetadata(html, meta),
        status === 404 ? 404 : 200,
        undefined,
        status === 404 ? 15 : 0
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return async function socialHandler(request: Request): Promise<Response> {
    if (!["GET", "HEAD"].includes(request.method))
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" }
      });
    const requested = new URL(request.url, config.siteOrigin);
    if (requested.href.length > 4096)
      return new Response(null, { status: 414 });
    const routePath = requested.searchParams.get("__socialPath");
    if (routePath !== null) {
      if (!routePath.startsWith("/") || routePath.startsWith("//"))
        return new Response(null, { status: 400 });
      requested.pathname = routePath;
      requested.searchParams.delete("__socialPath");
    }
    const image = requested.pathname.startsWith("/api/og/");
    let url = requested;
    if (image) {
      const match =
        /^\/api\/og\/(monster|token|portal-card|portal-token)\/([^/]+)\/([^/]+)\.png$/.exec(
          requested.pathname
        );
      if (!match) return new Response(null, { status: 404 });
      const path =
        match[1] === "monster"
          ? `/monsters/${match[2]}/${match[3]}`
          : match[1].startsWith("portal-") && match[2] === "grading"
            ? `/grading/${match[1] === "portal-card" ? "cards" : "tokens"}/${match[3]}`
            : match[1] === "token"
              ? `/collection/${match[2]}/${match[3]}`
              : "/invalid";
      url = new URL(path, config.siteOrigin);
    }
    // Only canonical render inputs enter the in-process work queue.
    const key = `${image}:${url.pathname}:${image ? "" : url.search}`;
    let work = pending.get(key);
    if (!work) {
      if (pending.size >= 32)
        return new Response(null, {
          status: 503,
          headers: { "Retry-After": "5", "Cache-Control": "no-store" }
        });
      work = handle(url, image);
      pending.set(key, work);
    }
    let response: Response;
    try {
      response = (await work).clone();
    } finally {
      if (pending.get(key) === work) pending.delete(key);
    }
    const body = Buffer.from(await response.arrayBuffer());
    const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
    response.headers.set("ETag", etag);
    if (
      request.headers.get("If-None-Match") === etag &&
      response.status === 200
    )
      return new Response(null, { status: 304, headers: response.headers });
    return new Response(request.method === "HEAD" ? null : body, {
      status: response.status,
      headers: response.headers
    });
  };
}
