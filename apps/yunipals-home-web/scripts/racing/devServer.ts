import type { IncomingMessage, ServerResponse } from "node:http";

import type { Plugin } from "vite";

export function llmRacePlugin(options: {
  apiKey: string;
  model: string;
}): Plugin {
  let busy = false;
  return {
    name: "yunipals-local-llm-races",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next) => {
          const path = req.url?.split("?")[0];
          if (!path?.startsWith("/api/racing/")) return next();
          function send(status: number, data: unknown) {
            res.writeHead(status, {
              "Content-Type": "application/json",
              "Cache-Control": "no-store"
            });
            res.end(JSON.stringify(data));
          }
          if (path === "/api/racing/status" && req.method === "GET") {
            send(200, {
              configured: !!options.apiKey && !!options.model,
              provider: "OpenAI",
              model: options.model || null
            });
            return;
          }
          if (path !== "/api/racing/generate" || req.method !== "POST") {
            send(404, { error: "Unknown race endpoint." });
            return;
          }
          if (!options.apiKey || !options.model) {
            send(503, {
              error:
                "Live generation is not configured. Export the prompt or load the stored LLM example."
            });
            return;
          }
          if (busy) {
            send(429, {
              error:
                "A race is already being generated. Please wait for it to finish."
            });
            return;
          }
          if (!req.headers["content-type"]?.includes("application/json")) {
            send(415, { error: "Submit a JSON race request." });
            return;
          }
          // Reject cross-origin browser submissions to this local paid endpoint.
          if (req.headers.origin) {
            try {
              if (new URL(req.headers.origin).host !== req.headers.host) {
                send(403, {
                  error: "Race generation must be requested from this app."
                });
                return;
              }
            } catch {
              send(403, { error: "Invalid request origin." });
              return;
            }
          }
          busy = true;
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of req) {
              const bytes = Buffer.from(chunk);
              size += bytes.length;
              if (size > 20000) {
                send(413, { error: "Race strategies are too large." });
                return;
              }
              chunks.push(bytes);
            }
            const input: unknown = JSON.parse(
              Buffer.concat(chunks).toString("utf8")
            );
            const core = (await server.ssrLoadModule(
              "/src/lib/racing/llmRace.ts"
            )) as typeof import("../../src/lib/racing/llmRace");
            const parsed = core.requestSchema.safeParse(input);
            if (!parsed.success) {
              send(400, {
                error:
                  "Provide one nonempty strategy for Mint, Nova and Pip, up to 2400 characters each."
              });
              return;
            }
            const generator = (await server.ssrLoadModule(
              "/src/lib/racing/llmGenerator.ts"
            )) as typeof import("../../src/lib/racing/llmGenerator");
            const result = await generator.generateLLMRace(parsed.data, {
              ...options,
              signal: AbortSignal.timeout(180000)
            });
            send(200, result);
          } catch (error) {
            // No provider response body, API key or player input is logged.
            send(502, {
              error:
                error instanceof Error
                  ? error.message
                  : "Race generation failed. No result has been substituted."
            });
          } finally {
            busy = false;
          }
        }
      );
    }
  };
}
