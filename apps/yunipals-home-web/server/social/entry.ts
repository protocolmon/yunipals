import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import type { PreviewConfig } from "./config";
import { createSocialHandler } from "./handler";

const directory = fileURLToPath(new URL("./social-assets/", import.meta.url));
const config: PreviewConfig = JSON.parse(
  await readFile(new URL("./social-config.json", import.meta.url), "utf8")
);
const handler = createSocialHandler({
  config,
  directory,
  html: await readFile(
    new URL("./social-template.html", import.meta.url),
    "utf8"
  )
});

export async function socialNodeHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  try {
    const response = await handler(
      new Request(new URL(req.url ?? "/", config.siteOrigin), {
        method: req.method,
        headers: {
          "If-None-Match":
            typeof req.headers["if-none-match"] === "string"
              ? req.headers["if-none-match"]
              : ""
        }
      })
    );
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    console.error("Social preview request failed.");
    res.writeHead(503, { "Cache-Control": "no-store" });
    res.end("Preview temporarily unavailable.");
  }
}

// Required by the Build Output API Node.js launcher.
export default socialNodeHandler;
