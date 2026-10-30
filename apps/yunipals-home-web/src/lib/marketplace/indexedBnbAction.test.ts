import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt
} from "viem";
import type {
  IndexedActionEvidence,
  IndexedActionSelection
} from "@protopals/yunipals-market-core/indexedAction";

import {
  bnbActionExpectation,
  bnbIndexRefetchInterval,
  createIndexedBnbActionClient,
  indexedActionExpectationHash,
  parseBnbActionEvidence,
  pendingBnbIndexLabel,
  requiresBnbActionIndex
} from "./indexedBnbAction";
import {
  marketFixture,
  receiptFixture,
  testBuyer,
  testHash,
  testSeller
} from "./marketplace.testFixtures";
import {
  decodePendingTransactions,
  pendingTransaction
} from "./pendingTransactions";
import { seaportDeployment } from "./registry";
import {
  buildBnbValidation,
  buildSeaportCancellation,
  seaportEventAbi
} from "./transactionIntent";
import { MarketApiError } from "./marketApiError";

const selection: IndexedActionSelection = {
  version: 1,
  identity: {
    releaseId: `0x${"1".repeat(64)}`,
    readIdentity: `0x${"2".repeat(64)}`,
    manifestHash: `0x${"3".repeat(64)}`,
    buildId: "bf4939b3ff"
  },
  supportedActions: ["bnb-validate", "bnb-cancel", "booster-request-created"]
};
function fixture(kind: "validate" | "cancel" = "validate") {
  const { order, summary } = marketFixture();
  const intent =
    kind === "validate"
      ? buildBnbValidation(
          order,
          summary.asset,
          summary.orderHash,
          order.offerer
        )
      : buildSeaportCancellation("bnb", order, summary.orderHash, testSeller);
  const saved = decodePendingTransactions(
    JSON.stringify([pendingTransaction(testHash, intent)])
  )[0]!;
  const eventName = kind === "validate" ? "OrderValidated" : "OrderCancelled";
  const event = seaportEventAbi.find((item) => item.name === eventName)!;
  const { counter: _counter, ...parameters } = order;
  const receipt = {
    ...receiptFixture(),
    logs: [
      {
        ...receiptFixture().logs[0],
        address: seaportDeployment.address,
        topics: encodeEventTopics({
          abi: seaportEventAbi,
          eventName,
          ...(kind === "cancel"
            ? { args: { offerer: testSeller, zone: order.zone } }
            : {})
        }),
        data: encodeAbiParameters(
          event.inputs.filter(
            (input) => !("indexed" in input && input.indexed)
          ),
          kind === "validate"
            ? [
                summary.orderHash,
                {
                  ...parameters,
                  totalOriginalConsiderationItems: BigInt(
                    order.consideration.length
                  )
                }
              ]
            : [summary.orderHash]
        )
      }
    ]
  } as TransactionReceipt;
  const request = bnbActionExpectation(saved, receipt, selection);
  const evidence: IndexedActionEvidence = {
    version: 1,
    expectationHash: indexedActionExpectationHash(request),
    state: "indexed",
    reason: "action_indexed",
    transaction: {
      chainId: 56,
      hash: request.transactionHash,
      blockNumber: request.blockNumber,
      blockHash: request.blockHash
    },
    identity: selection.identity,
    coverage: {
      sourceId: "marketplace:bnb:seaport",
      policy: "latest",
      completeThroughBlock: request.blockNumber,
      availableThroughBlock: request.blockNumber,
      finalizedThroughBlock: null,
      anchor: { number: request.blockNumber, hash: request.blockHash },
      observationRevision: "1"
    },
    proof: {
      kind: "canonical_event_and_full_receipt",
      receiptRequirement: "full",
      receiptPayloadHash: `0x${"4".repeat(64)}`,
      events: [
        {
          id: `56:${seaportDeployment.address.toLowerCase()}:${request.transactionHash}:0`,
          name: eventName,
          logIndex: 0
        }
      ]
    },
    application: { state: "not_evaluated", component: "marketplace" }
  };
  return { saved, receipt, request, evidence, summary };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

test("saved validation and cancellation bind exact fresh receipts", () => {
  for (const kind of ["validate", "cancel"] as const) {
    const f = fixture(kind);
    assert.equal(f.request.transactionHash, f.saved.hash.toLowerCase());
    assert.equal(f.request.blockHash, f.receipt.blockHash);
    assert.equal(f.request.blockNumber, f.receipt.blockNumber.toString());
    assert.equal(
      f.request.action.kind,
      kind === "validate" ? "bnb-validate" : "bnb-cancel"
    );
    assert.equal(
      parseBnbActionEvidence(f.evidence, f.request, selection).state,
      "indexed"
    );
  }
});

test("digest matches independently sorted SHA256 server representation", () => {
  const { request } = fixture();
  if (request.action.kind === "booster-request-created")
    throw new Error("Wrong fixture");
  const canonical = JSON.stringify({
    action: {
      kind: request.action.kind,
      offerer: request.action.offerer,
      orderHash: request.action.orderHash
    },
    blockHash: request.blockHash,
    blockNumber: request.blockNumber,
    chainId: 56,
    readIdentity: request.readIdentity,
    releaseId: request.releaseId,
    transactionHash: request.transactionHash,
    version: 1
  });
  assert.equal(
    indexedActionExpectationHash(request),
    `0x${createHash("sha256").update(canonical).digest("hex")}`
  );
});

test("old published order and a different tuple/order cannot become indexed", () => {
  const f = fixture();
  assert.throws(() =>
    parseBnbActionEvidence(
      { orderHash: f.summary.orderHash, published: true },
      f.request,
      selection
    )
  );
  for (const key of ["hash", "blockNumber", "blockHash"] as const) {
    const evidence = clone(f.evidence);
    evidence.transaction[key] =
      key === "blockNumber" ? "999" : `0x${"5".repeat(64)}`;
    assert.throws(
      () => parseBnbActionEvidence(evidence, f.request, selection),
      key
    );
  }
  const wrong = {
    ...f.request,
    action: {
      kind: "bnb-validate" as const,
      orderHash: `0x${"5".repeat(64)}`,
      offerer: testSeller.toLowerCase()
    }
  };
  assert.throws(() => parseBnbActionEvidence(f.evidence, wrong, selection));
});

test("release/read identity/manifest/build all match discovery", () => {
  const f = fixture();
  for (const key of [
    "releaseId",
    "readIdentity",
    "manifestHash",
    "buildId"
  ] as const) {
    const evidence = clone(f.evidence);
    evidence.identity![key] =
      key === "buildId" ? "changed" : `0x${"6".repeat(64)}`;
    assert.throws(
      () => parseBnbActionEvidence(evidence, f.request, selection),
      key
    );
  }
});

test("indexed requires full receipt, coverage and exact event proof", () => {
  const f = fixture();
  const mutations = [
    (e: IndexedActionEvidence) => {
      e.proof = null;
    },
    (e: IndexedActionEvidence) => {
      e.identity = null;
    },
    (e: IndexedActionEvidence) => {
      e.coverage = null;
    },
    (e: IndexedActionEvidence) => {
      e.proof!.receiptRequirement = "none";
    },
    (e: IndexedActionEvidence) => {
      e.proof!.receiptPayloadHash = null;
    },
    (e: IndexedActionEvidence) => {
      e.proof!.events = [];
    },
    (e: IndexedActionEvidence) => {
      e.proof!.events[0].name = "OrderCancelled";
    },
    (e: IndexedActionEvidence) => {
      e.proof!.events[0].id = "unrelated";
    },
    (e: IndexedActionEvidence) => {
      e.coverage!.availableThroughBlock = "0";
    },
    (e: IndexedActionEvidence) => {
      e.application = { state: "applied", component: "booster_request" };
    }
  ];
  for (const mutate of mutations) {
    const e = clone(f.evidence);
    mutate(e);
    assert.throws(() => parseBnbActionEvidence(e, f.request, selection));
  }
});

test("pending/changed/missing/unsupported/error responses never say Action indexed", () => {
  const f = fixture();
  for (const state of [
    "awaiting_indexing",
    "awaiting_receipt",
    "inclusion_changed",
    "action_not_observed",
    "source_unavailable",
    "unsupported"
  ] as const) {
    const parsed = parseBnbActionEvidence(
      { ...f.evidence, state, proof: null },
      f.request,
      selection
    );
    assert.notEqual(pendingBnbIndexLabel(parsed, null), "Action indexed");
  }
  assert.equal(pendingBnbIndexLabel(undefined, null), "Confirmed · indexing");
  assert.equal(
    pendingBnbIndexLabel(undefined, new Error("offline")),
    "Confirmed · index unavailable"
  );
  assert.equal(
    pendingBnbIndexLabel(undefined, new MarketApiError(422)),
    "Confirmed · index tracking unavailable"
  );
  assert.equal(
    pendingBnbIndexLabel(undefined, null, false),
    "Confirmed · index tracking unavailable"
  );
});

test("bad receipt and prerequisite actions never qualify", () => {
  const f = fixture();
  for (const receipt of [
    { ...f.receipt, transactionHash: `0x${"7".repeat(64)}` },
    { ...f.receipt, status: "reverted" },
    { ...f.receipt, logs: [] }
  ] as TransactionReceipt[])
    assert.throws(() => bnbActionExpectation(f.saved, receipt, selection));
  for (const kind of [
    "approve-nft",
    "approve-currency",
    "wrap",
    "buy",
    "accept-offer"
  ] as const) {
    const saved = {
      ...f.saved,
      expectation: { ...f.saved.expectation, kind }
    } as typeof f.saved;
    assert.equal(requiresBnbActionIndex(saved), false);
    assert.throws(() => bnbActionExpectation(saved, f.receipt, selection));
  }
});

test("client discovers identity then sends only finite action and receipt", async () => {
  const f = fixture(),
    calls: { url: string; init?: RequestInit }[] = [];
  const client = createIndexedBnbActionClient(
    "https://index.example",
    async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json(calls.length === 1 ? selection : f.evidence);
    }
  );
  assert.equal((await client.evidence(f.saved, f.receipt)).state, "indexed");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].url,
    "https://index.example/v1/indexer/action-evidence"
  );
  assert.equal(calls[1].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), f.request);
  assert.equal(calls[1].init?.cache, "no-store");
  assert.equal(calls[1].init?.credentials, "omit");
  assert.ok(!String(calls[1].init?.body).includes('"signature"'));
  assert.ok(!String(calls[1].init?.body).includes('"data"'));
});

test("HTTP refusals/outages are errors, never missing or indexed", async () => {
  const f = fixture();
  for (const status of [409, 422, 503]) {
    const client = createIndexedBnbActionClient(
      "https://index.example",
      async () => new Response(null, { status })
    );
    await assert.rejects(
      client.evidence(f.saved, f.receipt),
      (error: unknown) =>
        error instanceof MarketApiError && error.status === status
    );
  }
});

test("POST outage after successful identity discovery cannot return evidence", async () => {
  const f = fixture();
  let calls = 0;
  const client = createIndexedBnbActionClient(
    "https://index.example",
    async () =>
      ++calls === 1
        ? Response.json(selection)
        : new Response(null, { status: 503 })
  );
  await assert.rejects(client.evidence(f.saved, f.receipt), MarketApiError);
  assert.equal(calls, 2);
});

test("unsupported tracking stops polling but never upgrades to Action indexed", () => {
  assert.equal(
    bnbIndexRefetchInterval(undefined, new MarketApiError(422)),
    false
  );
  const indexed = fixture().evidence;
  assert.equal(pendingBnbIndexLabel(indexed, null), "Action indexed");
  assert.equal(bnbIndexRefetchInterval(indexed, null), 30_000);
  indexed.coverage!.finalizedThroughBlock = "0";
  assert.equal(bnbIndexRefetchInterval(indexed, null), 30_000);
  indexed.coverage!.finalizedThroughBlock = indexed.transaction.blockNumber;
  assert.equal(bnbIndexRefetchInterval(indexed, null), false);
  assert.equal(
    bnbIndexRefetchInterval(undefined, new MarketApiError(503)),
    30_000
  );
  assert.equal(bnbIndexRefetchInterval(undefined, null), 2_000);
  for (const state of [
    "awaiting_indexing",
    "action_not_observed",
    "inclusion_changed"
  ] as const) {
    const pending = { ...indexed, state };
    assert.equal(bnbIndexRefetchInterval(pending, null), 2_000);
    assert.notEqual(pendingBnbIndexLabel(pending, null), "Action indexed");
  }
  assert.equal(
    bnbIndexRefetchInterval({ ...indexed, state: "source_unavailable" }, null),
    30_000
  );
});
