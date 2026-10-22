import type { Pool, PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getAbiItem } from "viem";
import type { ReadinessReason } from "../../../packages/yunipals-indexer-client/src/readiness.js";
import {
  decodeIndexedActionLog,
  parseIndexedActionRequest,
  type IndexedActionRequest
} from "../../../packages/yunipals-market-core/src/indexedAction.js";
import { boosterPacksAbi } from "../../../packages/yunipals-market-core/src/boosterAbi.js";
import { seaportEventAbi } from "../../../packages/yunipals-market-core/src/seaportEvents.js";
import { seaportRuntimeHashes } from "../../../packages/yunipals-market-core/src/seaportRuntime.js";
import { receiptLogsBloom } from "../../../packages/yunipals-market-core/src/receiptEvidence.js";
import {
  manifestDigest,
  transactionEvidenceHash
} from "../../../packages/yunipals-indexer-server/src/identity.js";
import {
  readIndexedActionEvidence,
  readIndexedActionSelection
} from "../../../packages/yunipals-indexer-server/src/action-evidence.js";
import {
  loadIndexerRelease,
  readBoundRuntime
} from "../../../packages/yunipals-indexer-server/src/releases.js";
import { readIndexerSourceStatus } from "../../../packages/yunipals-indexer-server/src/status.js";
import { buildSourceManifest } from "../lib/unified/sources.js";

vi.mock("../../../packages/yunipals-indexer-server/src/releases.js", () => ({
  loadIndexerRelease: vi.fn(),
  readBoundRuntime: vi.fn()
}));
vi.mock("../../../packages/yunipals-indexer-server/src/status.js", () => ({
  readIndexerSourceStatus: vi.fn()
}));

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) =>
  `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;
const binding = {
  releaseId: hash(1),
  physicalSchema: "action_source",
  readSchema: "action_read"
};
const identity = hash(2),
  blockHash = hash(3),
  transactionHash = hash(4),
  orderHash = hash(5);
const payer = addr(6),
  engine = addr(7),
  monsters = addr(8),
  registry = addr(9);
const manifest = buildSourceManifest({
  MARKET_BNB_DISCOVERY_START_BLOCK: "100",
  BOOSTER_REGISTRY: registry,
  BOOSTER_ENGINE: engine,
  BOOSTER_MONSTERS: monsters,
  BOOSTER_WRAPPER: addr(10),
  BOOSTER_DEPLOYMENT_BLOCK: "100"
});
const release = {
  id: binding.releaseId,
  schema: binding.physicalSchema,
  buildId: "fixed-build",
  manifestHash: manifestDigest(manifest),
  manifest
};
type Kind = IndexedActionRequest["action"]["kind"];
export function actionRequest(
  kind: Kind = "bnb-validate"
): IndexedActionRequest {
  return {
    version: 1,
    releaseId: release.id,
    readIdentity: identity,
    chainId: kind === "booster-request-created" ? 8453 : 56,
    transactionHash,
    blockNumber: "200",
    blockHash,
    action:
      kind === "booster-request-created"
        ? {
            kind,
            requestId: "1",
            originalId: "2",
            packTypeId: "3",
            payer,
            quantity: 1,
            opening: true,
            paid: "17",
            ruleHash: hash(11),
            callbackGas: 500000
          }
        : { kind, orderHash, offerer: payer }
  };
}
function encodedEvent(request: IndexedActionRequest) {
  const action = request.action;
  if (action.kind === "booster-request-created") {
    return {
      topics: encodeEventTopics({
        abi: boosterPacksAbi,
        eventName: "RequestCreated",
        args: { requestId: 1n, originalId: 2n, packTypeId: 3n }
      }),
      data: encodeAbiParameters(
        [
          { type: "address" },
          { type: "uint32" },
          { type: "bool" },
          { type: "uint256" },
          { type: "bytes32" },
          { type: "uint32" }
        ],
        [payer, 1, true, 17n, hash(11) as `0x${string}`, 500000]
      )
    };
  }
  if (action.kind === "bnb-cancel")
    return {
      topics: encodeEventTopics({
        abi: seaportEventAbi,
        eventName: "OrderCancelled",
        args: { offerer: payer, zone: addr(0) }
      }),
      data: encodeAbiParameters(
        [{ type: "bytes32" }],
        [orderHash as `0x${string}`]
      )
    };
  const event = getAbiItem({ abi: seaportEventAbi, name: "OrderValidated" });
  return {
    topics: encodeEventTopics({
      abi: seaportEventAbi,
      eventName: "OrderValidated"
    }),
    data: encodeAbiParameters(event.inputs, [
      orderHash as `0x${string}`,
      {
        offerer: payer,
        zone: addr(0),
        offer: [],
        consideration: [],
        orderType: 0,
        startTime: 1n,
        endTime: 10000n,
        zoneHash: hash(0) as `0x${string}`,
        salt: 1n,
        conduitKey: hash(0) as `0x${string}`,
        totalOriginalConsiderationItems: 0n
      }
    ])
  };
}

function fixture(kind: Kind = "bnb-validate") {
  const request = actionRequest(kind);
  const selectedRelease = structuredClone(release);
  const source = selectedRelease.manifest.sources.find(
    (s) =>
      s.id ===
      (kind === "booster-request-created"
        ? "boosters:boosterengine"
        : "marketplace:bnb:seaport")
  )!;
  const encoded = encodedEvent(request);
  const log = { topics: encoded.topics as string[], data: encoded.data };
  const args = decodeIndexedActionLog(request.action, log);
  const event = {
    id: `${request.chainId}:${source.address}:${transactionHash}:0`,
    source_id: source.id,
    chain_id: request.chainId,
    address: source.address!,
    abi_hash: source.abiHash,
    name:
      kind === "bnb-validate"
        ? "OrderValidated"
        : kind === "bnb-cancel"
          ? "OrderCancelled"
          : "RequestCreated",
    block_number: "200",
    block_hash: blockHash,
    transaction_hash: transactionHash,
    transaction_index: 0,
    log_index: 0,
    args: JSON.stringify(args, (_key, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v
    ),
    topics: JSON.stringify(log.topics),
    data: log.data,
    point_bytes: "4096"
  };
  const receiptLog = {
    ...log,
    address: source.address!,
    blockNumber: "0xc8",
    blockHash,
    transactionHash,
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false
  };
  const receipt = {
    blockNumber: "0xc8",
    blockHash,
    transactionHash,
    transactionIndex: "0x0",
    status: "0x1",
    from: payer,
    to: source.address,
    contractAddress: null,
    gasUsed: "0x5208",
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    type: "0x2",
    logs: [receiptLog],
    logsBloom: receiptLogsBloom([receiptLog])
  };
  const block = {
    number: "200",
    hash: blockHash,
    parentHash: hash(12),
    timestamp: "1000",
    seaportRuntimeHash: seaportRuntimeHashes[56]
  };
  const candidate = {
    chain_id: request.chainId,
    block_number: "200",
    block_hash: blockHash,
    transaction_hash: transactionHash,
    evidence_block_number: "200" as string | null,
    receipt: receipt as unknown,
    block: block as unknown,
    payload_hash: transactionEvidenceHash(receipt, block) as string | null,
    too_large: false as boolean | null
  };
  const projection = {
    engine,
    request_id: "1",
    original_key: `${monsters}:2`,
    payer,
    quantity: 1,
    opening: true,
    paid: "17",
    rule_hash: hash(11),
    callback_gas: 500000,
    transaction_hash: transactionHash
  };
  const state = {
    events: [event],
    candidates: [candidate],
    projections: [projection],
    witnesses: [{ block_hash: blockHash }],
    marker: {
      identity,
      release_id: release.id,
      manifest_hash: release.manifestHash
    },
    status: {
      source,
      snapshot: {
        sourceId: source.id,
        chainId: request.chainId,
        release: selectedRelease,
        coverageStartBlock: 100n,
        completeThroughBlock: 1000n,
        indexerObservedAtMs: Date.now(),
        halted: false,
        head: {
          chainId: request.chainId,
          blockNumber: 1000n,
          blockHash: hash(13),
          observedAtMs: Date.now()
        },
        finalized: {
          chainId: request.chainId,
          blockNumber: 900n,
          blockHash: hash(14),
          observedAtMs: Date.now()
        }
      },
      readiness: {
        reason: "catching_up" as ReadinessReason,
        ready: false,
        availableThroughBlock: 1000n,
        requiredThroughBlock: 1000n
      },
      anchor: { number: "1000", hash: hash(13), timestamp: "2000" },
      observationRevision: "7",
      errorCode: null
    }
  };
  vi.mocked(loadIndexerRelease).mockResolvedValue(selectedRelease);
  vi.mocked(readBoundRuntime).mockResolvedValue(
    {} as Awaited<ReturnType<typeof readBoundRuntime>>
  );
  vi.mocked(readIndexerSourceStatus).mockImplementation(
    async () =>
      state.status as Awaited<ReturnType<typeof readIndexerSourceStatus>>
  );
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("._unified_read_release")) return { rows: [state.marker] };
    if (sql.includes(".canonical_event"))
      return {
        rows: state.events.filter(
          (e) =>
            e.chain_id === params[0] &&
            e.transaction_hash === params[1] &&
            e.source_id === params[2]
        )
      };
    if (sql.includes(".chain_block")) return { rows: state.witnesses };
    if (sql.includes(".transaction_candidate"))
      return { rows: state.candidates };
    if (sql.includes(".booster_request")) return { rows: state.projections };
    if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
    throw new Error("Unexpected query");
  });
  const releaseConnection = vi.fn();
  const pool = {
    connect: vi.fn(
      async () =>
        ({ query, release: releaseConnection }) as unknown as PoolClient
    )
  } as unknown as Pick<Pool, "connect">;
  const read = () => readIndexedActionEvidence(pool, binding, request);
  return {
    request,
    selectedRelease,
    source,
    event,
    candidate,
    projection,
    state,
    query,
    pool,
    releaseConnection,
    read
  };
}

beforeEach(() => vi.resetAllMocks());
describe("exact indexed action evidence", () => {
  it.each(["bnb-validate", "bnb-cancel"] as const)(
    "proves %s with Ponder's trailing-null topic padding and an unpadded RPC receipt",
    async (kind) => {
      const f = fixture(kind);
      const topics = JSON.parse(f.event.topics) as string[];
      expect(topics.length).toBeLessThan(4);
      f.event.topics = JSON.stringify([...topics, ...Array(4 - topics.length).fill(null)]);
      expect(await f.read()).toMatchObject({ state: "indexed", reason: "action_indexed" });
    }
  );
  it("rejects an interior null instead of accepting a different log", async () => {
    const f = fixture("bnb-cancel");
    const topics = JSON.parse(f.event.topics) as string[];
    f.event.topics = JSON.stringify([topics[0], null, ...topics.slice(1)]);
    expect((await f.read()).reason).toBe("canonical_event_invalid");
  });
  it.each(["bnb-validate", "bnb-cancel"] as const)(
    "proves %s using raw journal + exact complete receipt in one readonly snapshot",
    async (kind) => {
      const f = fixture(kind),
        value = await f.read();
      expect(value).toMatchObject({
        state: "indexed",
        reason: "action_indexed",
        expectationHash: manifestDigest(f.request),
        proof: {
          kind: "canonical_event_and_full_receipt",
          receiptRequirement: "full",
          receiptPayloadHash: f.candidate.payload_hash,
          events: [{ id: f.event.id, logIndex: 0 }]
        },
        application: { state: "not_evaluated", component: "marketplace" }
      });
      expect(value.coverage).toMatchObject({
        policy: "latest",
        completeThroughBlock: "1000",
        finalizedThroughBlock: "900"
      });
      expect(f.query.mock.calls[0]![0]).toBe(
        "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
      );
      expect(f.query.mock.calls.at(-1)![0]).toBe("COMMIT");
      expect(f.releaseConnection).toHaveBeenCalledOnce();
      expect(
        f.query.mock.calls.every(
          ([sql]) => !/\b(INSERT|UPDATE|DELETE|GRANT|CREATE)\b/.test(sql)
        )
      ).toBe(true);
      expect(
        f.query.mock.calls.find(([sql]) => sql.includes("canonical_event"))?.[1]
      ).toEqual([56, transactionHash, f.source.id]);
    }
  );
  it("proves booster acceptance with canonical-event evidence and its exact request projection, without claiming VRF completion or full receipt", async () => {
    const f = fixture("booster-request-created"),
      value = await f.read();
    expect(value).toMatchObject({
      state: "indexed",
      proof: {
        kind: "canonical_event",
        receiptRequirement: "none",
        receiptPayloadHash: null
      },
      application: { state: "applied", component: "booster_request" }
    });
    expect(
      f.query.mock.calls.some(([sql]) => sql.includes("transaction_evidence"))
    ).toBe(false);
    expect(JSON.stringify(value)).not.toContain("seed");
  });
  it("does not accept a different transaction, order hash or offerer just because its receipt block is covered", async () => {
    for (const mutation of [
      (r: IndexedActionRequest) => {
        r.transactionHash = hash(99);
      },
      (r: IndexedActionRequest) => {
        if (r.action.kind !== "booster-request-created")
          r.action.orderHash = hash(99);
      },
      (r: IndexedActionRequest) => {
        if (r.action.kind !== "booster-request-created")
          r.action.offerer = addr(99);
      }
    ]) {
      const f = fixture();
      mutation(f.request);
      expect((await f.read()).state).toBe("action_not_observed");
    }
  });
  it("rejects wrong booster request, original, pack, payer, quantity and rule expectations", async () => {
    for (const [key, value] of [
      ["requestId", "99"],
      ["originalId", "99"],
      ["packTypeId", "99"],
      ["payer", addr(99)],
      ["quantity", 2],
      ["ruleHash", hash(99)]
    ] as const) {
      const f = fixture("booster-request-created");
      Object.assign(f.request.action, { [key]: value });
      expect((await f.read()).state).toBe("action_not_observed");
    }
  });
  it("reports changed inclusion for a different indexed block hash, number or recent canonical witness", async () => {
    for (const change of ["hash", "number", "witness"]) {
      const f = fixture();
      if (change === "hash") f.request.blockHash = hash(99);
      else if (change === "number") f.request.blockNumber = "201";
      else f.state.witnesses[0]!.block_hash = hash(99);
      expect((await f.read()).state).toBe("inclusion_changed");
    }
  });
  it("separates indexing lag, unavailable source, receipt enrichment and unsupported history", async () => {
    const lag = fixture();
    lag.state.status.readiness.availableThroughBlock = 199n;
    expect((await lag.read()).state).toBe("awaiting_indexing");
    expect(
      lag.query.mock.calls.some(([sql]) => sql.includes("canonical_event"))
    ).toBe(false);
    const dead = fixture();
    dead.state.status.readiness.reason = "halted";
    expect((await dead.read()).state).toBe("source_unavailable");
    const pending = fixture();
    pending.candidate.payload_hash = null;
    expect((await pending.read()).state).toBe("awaiting_receipt");
    const floor = fixture();
    floor.source.receiptStartBlock = "201";
    expect(await floor.read()).toMatchObject({
      state: "unsupported",
      reason: "history_unsupported"
    });
  });
  it("rejects configured/read-marker/release/runtime switches without using the active release or a new schema", async () => {
    for (const change of [
      "request",
      "marker",
      "release",
      "runtime",
      "source"
    ]) {
      const f = fixture();
      if (change === "request") f.request.releaseId = hash(99);
      else if (change === "marker") f.state.marker.identity = hash(99);
      else if (change === "release") f.selectedRelease.schema = "other_source";
      else if (change === "runtime")
        vi.mocked(readIndexerSourceStatus).mockRejectedValue(
          new Error("private runtime detail")
        );
      else f.source.abiHash = hash(99);
      const value = await f.read();
      expect(value.state).toBe("source_unavailable");
      expect(value.proof).toBeNull();
      expect(JSON.stringify(value)).not.toContain("private runtime");
      expect(f.query.mock.calls.at(-1)![0]).toBe("ROLLBACK");
    }
  });
  it("bounds both event count and aggregate raw bytes before decoding", async () => {
    const count = fixture();
    count.state.events = Array.from({ length: 257 }, () => count.event);
    expect(await count.read()).toMatchObject({
      state: "source_unavailable",
      reason: "event_limit_exceeded"
    });
    const bytes = fixture();
    bytes.event.point_bytes = "524289";
    expect((await bytes.read()).reason).toBe("event_limit_exceeded");
  });
  it("rejects raw/decoded journal disagreement, malformed topics and duplicate indices", async () => {
    for (const change of ["args", "topics", "duplicate"]) {
      const f = fixture();
      if (change === "args") f.event.args = "{}";
      else if (change === "topics")
        f.event.topics = '["private unknown value"]';
      else f.state.events.push({ ...f.event });
      expect((await f.read()).reason).toBe("canonical_event_invalid");
    }
  });
  it("does not accept an orphaned, corrupt, wrong-runtime, failed or oversized receipt", async () => {
    for (const change of [
      "candidate",
      "checksum",
      "runtime",
      "failed",
      "large",
      "rawIdentity"
    ]) {
      const f = fixture();
      if (change === "candidate") f.state.candidates = [];
      else if (change === "checksum") f.candidate.payload_hash = hash(99);
      else if (change === "large") f.candidate.too_large = true;
      else {
        if (change === "runtime")
          Object.assign(f.candidate.block as object, {
            seaportRuntimeHash: hash(99)
          });
        else
          Object.assign(
            f.candidate.receipt as object,
            change === "failed"
              ? { status: "0x0" }
              : { transactionHash: hash(99) }
          );
        f.candidate.payload_hash = transactionEvidenceHash(
          f.candidate.receipt,
          f.candidate.block
        );
      }
      const value = await f.read();
      expect(value.state).toBe("source_unavailable");
      expect(value.proof).toBeNull();
    }
  });
  it("cannot downgrade a full-receipt source to journal-only proof", async () => {
    const market = fixture();
    market.source.receiptRequirement = "none";
    expect((await market.read()).reason).toBe("source_definition_mismatch");
    const booster = fixture("booster-request-created");
    booster.source.receiptRequirement = "full";
    expect((await booster.read()).reason).toBe("source_definition_mismatch");
  });
  it("requires exact booster projection provenance without depending on current ownership/pending status", async () => {
    const f = fixture("booster-request-created");
    f.projection.transaction_hash = hash(99);
    expect((await f.read()).reason).toBe("projection_inconsistent");
    const empty = fixture("booster-request-created");
    empty.state.projections = [];
    expect((await empty.read()).reason).toBe("projection_inconsistent");
  });
  it("does not invent canonical inclusion when both the transaction and retained block witness are absent", async () => {
    const f = fixture();
    f.state.events = [];
    f.state.witnesses = [];
    expect((await f.read()).reason).toBe("inclusion_evidence_unavailable");
  });
  it("discovers only the configured read identity after verifying its bound native runtime", async () => {
    const f = fixture();
    const value = await readIndexedActionSelection(f.pool, binding);
    expect(value).toMatchObject({
      version: 1,
      identity: { releaseId: release.id, readIdentity: identity },
      supportedActions: [
        "bnb-validate",
        "bnb-cancel",
        "booster-request-created"
      ]
    });
    expect(readBoundRuntime).toHaveBeenCalledOnce();
    expect(f.query.mock.calls.at(-1)![0]).toBe("COMMIT");
    expect(
      f.query.mock.calls.some(([sql]) => sql.includes("canonical_event"))
    ).toBe(false);
  });
  it("normalizes case but rejects hidden selectors, unsupported terminals and noncanonical identities", () => {
    const value = actionRequest();
    value.transactionHash = value.transactionHash
      .toUpperCase()
      .replace("0X", "0x");
    expect(parseIndexedActionRequest(value).transactionHash).toBe(
      transactionHash
    );
    for (const bad of [
      { ...value, blockNumber: "0200" },
      { ...value, schema: "other" },
      { ...value, chainId: 8453 },
      { ...value, action: { kind: "booster-completion" } },
      { ...value, action: { ...value.action, contract: engine } }
    ])
      expect(() => parseIndexedActionRequest(bad)).toThrow();
  });
});
