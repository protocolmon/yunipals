import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { ArenaError, type ArenaLabService } from "./service";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ArenaError(400, "Submit a JSON object.");
  return value as Record<string, unknown>;
}
function field(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string")
    throw new ArenaError(400, `Missing ${key}.`);
  return value[key];
}

export function createArenaLabApp(service: ArenaLabService) {
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    const url = new URL(context.req.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      return context.json(
        { error: "Arena Lab is available locally only." },
        403
      );
    if (context.req.method !== "GET") {
      const origin = context.req.header("origin");
      // The dev proxy preserves the frontend Host. Reject cross-origin writes,
      // including DNS rebinding / third-party forms targeting localhost.
      if (origin && origin !== url.origin)
        return context.json(
          { error: "Use the same-origin Arena Lab page." },
          403
        );
      if (!context.req.header("content-type")?.startsWith("application/json"))
        return context.json({ error: "Submit JSON." }, 415);
    }
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 16000,
      onError: (context) => context.json({ error: "Request too large." }, 413)
    })
  );
  app.onError((error, context) => {
    // Never log request bodies, credentials, private prompts or exception data.
    if (error instanceof ArenaError)
      return context.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError)
      return context.json({ error: "Invalid JSON." }, 400);
    return context.json(
      {
        error:
          "Arena request failed. Retry the same request; no replacement result was created."
      },
      500
    );
  });
  app.get("/api/arena/catalog", (context) => context.json(service.catalog()));
  app.get("/api/arena/tournaments", (context) => context.json(service.list()));
  app.post("/api/arena/tournaments", (context) =>
    context.json(service.create(), 201)
  );
  app.get("/api/arena/tournaments/:id", (context) =>
    context.json(service.get(context.req.param("id")))
  );
  app.get("/api/arena/tournaments/:id/input", (context) =>
    context.json(service.export(context.req.param("id")))
  );
  app.post("/api/arena/tournaments/:id/join", async (context) => {
    const input = object(await context.req.json());
    return context.json(
      service.join(
        context.req.param("id"),
        field(input, "fighterId"),
        field(input, "credential")
      )
    );
  });
  app.post("/api/arena/tournaments/:id/strategies", async (context) => {
    const input = object(await context.req.json());
    return context.json(
      service.submit(
        context.req.param("id"),
        field(input, "fighterId"),
        field(input, "credential"),
        field(input, "strategy")
      )
    );
  });
  return app;
}
