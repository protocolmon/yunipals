import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

import type { PreviewConfigOptions } from "../../server/social/config";
import { createSocialHandler } from "../../server/social/handler";
import { buildImages, buildPages, buildSettings } from "./build";
// @ts-expect-error The packaging helper is also called by the existing JS release assembler.
import { packageSocial } from "./package.mjs";

export async function socialPlugin(
  app: string,
  env: Record<string, string | undefined>,
  options: PreviewConfigOptions = {}
): Promise<Plugin> {
  const config = await buildSettings(app, env, options);
  let output = "";
  let build = false;
  return {
    name: "yunipals-social-previews",
    config: () => ({
      define: {
        "import.meta.env.VITE_SOCIAL_REVISION": JSON.stringify(
          config.staticRevision
        ),
        "import.meta.env.VITE_SITE_ORIGIN": JSON.stringify(config.siteOrigin)
      }
    }),
    configResolved(resolved) {
      output = resolve(resolved.root, resolved.build.outDir);
      build = resolved.command === "build";
    },
    async configureServer(server) {
      const temporary = await mkdtemp(join(tmpdir(), "yunipals-social-"));
      const directory = await buildImages(app, temporary, config);
      server.httpServer?.once("close", () => {
        void rm(temporary, { recursive: true, force: true });
      });
      const template = await readFile(join(app, "index.html"), "utf8");
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", config.siteOrigin);
        if (url.pathname.startsWith("/images/og/")) {
          if (!/^\/images\/og\/[a-z-]+\.[a-f0-9]+\.png$/.test(url.pathname)) {
            res.statusCode = 404;
            res.end();
            return;
          }
          try {
            res.setHeader("Content-Type", "image/png");
            res.end(await readFile(join(temporary, url.pathname.slice(1))));
          } catch {
            res.statusCode = 404;
            res.end();
          }
          return;
        }
        const isImage = url.pathname.startsWith("/api/og/");
        if (
          !isImage &&
          (["/@", "/__", "/src/", "/node_modules/", "/assets/", "/api/"].some(
            (prefix) => url.pathname.startsWith(prefix)
          ) ||
            /\.[a-z0-9]+$/.test(url.pathname))
        )
          return next();
        try {
          const html = await server.transformIndexHtml(url.pathname, template);
          const handler = createSocialHandler({ config, directory, html });
          const response = await handler(
            new Request(url, { method: req.method })
          );
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          next(error as Error);
        }
      });
    },
    async writeBundle() {
      if (!build) return;
      const template = await readFile(join(output, "index.html"), "utf8");
      await buildImages(app, output, config);
      await buildPages(output, config, template);
      await packageSocial(app, output);
    }
  };
}
