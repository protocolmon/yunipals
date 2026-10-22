import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import {
  InvalidIndexedActionRequest,
  UnsupportedIndexedAction,
  parseIndexedActionRequest
} from "../../../../packages/yunipals-market-core/src/indexedAction.js";
import {
  readIndexedActionEvidence,
  readIndexedActionSelection,
  type IndexedActionBinding
} from "../../../../packages/yunipals-indexer-server/src/action-evidence.js";

export function registerActionEvidenceRoutes(
  app: Hono,
  dependencies: {
    pool: Pick<Pool, "connect">;
    selection: () => IndexedActionBinding | null;
    readEvidence?: typeof readIndexedActionEvidence;
    readSelection?: typeof readIndexedActionSelection;
  }
) {
  const route = new Hono();
  const unavailable = {
    version: 1,
    state: "source_unavailable",
    reason: "source_read_unavailable"
  } as const;
  route.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  route.use(
    "*",
    bodyLimit({
      maxSize: 8192,
      onError: (c) =>
        c.json({ error: "action_evidence_request_too_large" }, 413)
    })
  );
  route.onError((_error, c) => c.json(unavailable, 503));
  route.get("/", async (c) => {
    const binding = dependencies.selection();
    if (!binding) return c.json(unavailable, 503);
    const value = await (
      dependencies.readSelection ?? readIndexedActionSelection
    )(dependencies.pool, binding);
    c.header("X-Indexer-Release", value.identity.releaseId);
    return c.json(value);
  });
  route.post("/", async (c) => {
    let input;
    try {
      input = parseIndexedActionRequest(await c.req.json());
    } catch (error) {
      if (error instanceof UnsupportedIndexedAction)
        return c.json(
          { version: 1, state: "unsupported", reason: "action_not_supported" },
          422
        );
      if (
        error instanceof InvalidIndexedActionRequest ||
        error instanceof SyntaxError
      )
        return c.json({ error: "invalid_action_evidence_request" }, 400);
      throw error;
    }
    const binding = dependencies.selection();
    if (!binding) return c.json(unavailable, 503);
    const value = await (
      dependencies.readEvidence ?? readIndexedActionEvidence
    )(dependencies.pool, binding, input);
    if (value.identity) c.header("X-Indexer-Release", value.identity.releaseId);
    return c.json(
      value,
      value.reason === "source_selection_changed"
        ? 409
        : value.state === "source_unavailable"
          ? 503
          : value.state === "unsupported"
            ? 422
            : 200
    );
  });
  app.route("/v1/indexer/action-evidence", route);
}
