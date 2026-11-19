// Self-hosted adapter: run after `pnpm build` from the web app directory.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.env.SOCIAL_DIST || "dist");
const { socialNodeHandler } = await import(
  pathToFileURL(resolve(root, ".social/index.mjs"))
);
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".mp4": "video/mp4"
};
createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (path.split("/").some((part) => part.startsWith("."))) {
    res.writeHead(404).end();
    return;
  }
  if (path.startsWith("/api/og/")) return socialNodeHandler(req, res);
  const file = resolve(root, `.${path}`);
  if (
    file.startsWith(root + sep) &&
    extname(path) &&
    extname(path) !== ".html"
  ) {
    try {
      const bytes = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[extname(path)] || "application/octet-stream",
        "Cache-Control":
          path.startsWith("/images/og/") || path.startsWith("/assets/")
            ? "public, max-age=31536000, immutable"
            : "public, max-age=0, must-revalidate"
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }
  if (path.startsWith("/api/")) {
    res.writeHead(404).end();
    return;
  }
  return socialNodeHandler(req, res);
}).listen(
  Number(process.env.PORT || "5180"),
  process.env.HOST || "127.0.0.1",
  () => console.log("Yunipals preview server is listening.")
);
