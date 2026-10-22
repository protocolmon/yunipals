import { Hono } from "hono";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type {
  IndexedActionEvidence,
  IndexedActionRequest,
  IndexedActionSelection
} from "../../../packages/yunipals-market-core/src/indexedAction.js";
import { registerActionEvidenceRoutes } from "../lib/api/action-evidence-routes.js";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const path = "/v1/indexer/action-evidence";
const request: IndexedActionRequest = {
  version: 1,
  releaseId: hash(1),
  readIdentity: hash(2),
  chainId: 56,
  transactionHash: hash(3),
  blockNumber: "200",
  blockHash: hash(4),
  action: {
    kind: "bnb-validate",
    orderHash: hash(5),
    offerer: `0x${"12".repeat(20)}`
  }
};
function fixture(enabled = true) {
  const connect = vi.fn();
  const pool = { connect } as unknown as Pick<Pool, "connect">;
  const binding = {
    releaseId: hash(1),
    physicalSchema: "physical_source",
    readSchema: "read_source"
  };
  const identity = {
    releaseId: hash(1),
    readIdentity: hash(2),
    manifestHash: hash(6),
    buildId: "native-build"
  };
  const evidence: IndexedActionEvidence = {
    version: 1,
    expectationHash: hash(7),
    state: "awaiting_receipt",
    reason: "receipt_not_enriched",
    transaction: {
      chainId: 56,
      hash: hash(3),
      blockNumber: "200",
      blockHash: hash(4)
    },
    identity,
    coverage: null,
    proof: null,
    application: { state: "not_evaluated", component: "marketplace" }
  };
  const selection: IndexedActionSelection = {
    version: 1,
    identity,
    supportedActions: ["bnb-validate", "bnb-cancel", "booster-request-created"]
  };
  const readEvidence = vi.fn(async () => evidence),
    readSelection = vi.fn(async () => selection);
  const app = new Hono();
  registerActionEvidenceRoutes(app, {
    pool,
    selection: () => (enabled ? binding : null),
    readEvidence,
    readSelection
  });
  const post = (body: unknown = request) =>
    app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  return {
    app,
    pool,
    connect,
    binding,
    identity,
    evidence,
    selection,
    readEvidence,
    readSelection,
    post
  };
}

describe("read-only action evidence route", () => {
  it("discovers the selected public read identity without claiming readiness or performing an action", async () => {
    const f = fixture(),
      response = await f.app.request(path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(f.selection);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Indexer-Release")).toBe(
      f.identity.releaseId
    );
    expect(f.readSelection).toHaveBeenCalledExactlyOnceWith(f.pool, f.binding);
    expect(f.readEvidence).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("passes one parsed typed request to the fixed selected reader and keeps pending distinct", async () => {
    const f = fixture(),
      response = await f.post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(f.evidence);
    expect(f.readEvidence).toHaveBeenCalledExactlyOnceWith(
      f.pool,
      f.binding,
      request
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(f.connect).not.toHaveBeenCalled();
  });
  it.each(["bnb-validate", "bnb-cancel"] as const)(
    "accepts only the captured exact BNB %s identity",
    async (kind) => {
      const f = fixture();
      const body = { ...request, action: { ...request.action, kind } };
      expect((await f.post(body)).status).toBe(200);
      expect(f.readEvidence).toHaveBeenCalledExactlyOnceWith(
        f.pool,
        f.binding,
        body
      );
    }
  );
  it("accepts booster request acceptance without offering terminal discovery", async () => {
    const f = fixture();
    const body: IndexedActionRequest = {
      ...request,
      chainId: 8453,
      action: {
        kind: "booster-request-created",
        requestId: "1",
        originalId: "2",
        packTypeId: "3",
        payer: `0x${"12".repeat(20)}`,
        quantity: 1,
        opening: true,
        paid: "99",
        ruleHash: hash(8),
        callbackGas: 500000
      }
    };
    expect((await f.post(body)).status).toBe(200);
    expect(f.readEvidence).toHaveBeenCalledExactlyOnceWith(
      f.pool,
      f.binding,
      body
    );
    expect(
      (await f.post({ ...request, action: { kind: "booster-completion" } }))
        .status
    ).toBe(422);
    expect(f.readEvidence).toHaveBeenCalledOnce();
  });
  it("maps source identity change, unavailable source and unsupported history to separate HTTP outcomes", async () => {
    for (const [state, reason, status] of [
      ["source_unavailable", "source_selection_changed", 409],
      ["source_unavailable", "receipt_invalid", 503],
      ["unsupported", "history_unsupported", 422],
      ["inclusion_changed", "inclusion_changed", 200],
      ["action_not_observed", "action_not_observed", 200],
      ["indexed", "action_indexed", 200]
    ] as const) {
      const f = fixture();
      Object.assign(f.evidence, { state, reason });
      const response = await f.post();
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ state, reason });
    }
  });
  it("rejects caller source/contract/policy/receipt selectors, malformed tuples and wrong-chain requests before reading", async () => {
    const f = fixture();
    for (const body of [
      { ...request, sourceId: "arbitrary" },
      { ...request, policy: "finalized" },
      { ...request, receipt: {} },
      { ...request, blockNumber: "0200" },
      { ...request, transactionHash: "0x00" },
      { ...request, chainId: 8453 },
      { ...request, action: { ...request.action, contract: "arbitrary" } }
    ])
      expect((await f.post(body)).status).toBe(400);
    expect(f.readEvidence).not.toHaveBeenCalled();
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("enforces actual body size, malformed JSON and unsupported action bounds", async () => {
    const f = fixture();
    expect(
      (await f.post({ ...request, padding: "x".repeat(8192) })).status
    ).toBe(413);
    expect(
      (
        await f.app.request(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{"
        })
      ).status
    ).toBe(400);
    for (const kind of ["buy", "approve-nft", "wrap", "booster-reveal"])
      expect((await f.post({ ...request, action: { kind } })).status).toBe(422);
    expect(f.readEvidence).not.toHaveBeenCalled();
  });
  it("fails closed in legacy mode or when a DB/ACL/runtime read fails, without leaking exception text", async () => {
    const disabled = fixture(false);
    expect((await disabled.post()).status).toBe(503);
    expect((await disabled.app.request(path)).status).toBe(503);
    expect(disabled.readEvidence).not.toHaveBeenCalled();
    expect(disabled.readSelection).not.toHaveBeenCalled();
    const f = fixture();
    f.readEvidence.mockRejectedValue(
      new Error("private database URL and provider error")
    );
    const response = await f.post();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      version: 1,
      state: "source_unavailable",
      reason: "source_read_unavailable"
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
