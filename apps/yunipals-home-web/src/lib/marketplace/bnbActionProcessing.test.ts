import assert from "node:assert/strict";
import { test } from "node:test";
import type { BnbOrderProcessing } from "@protopals/yunipals-market-core/bnbProcessing";
import type {
  IndexedActionEvidence,
  IndexedActionSelection
} from "@protopals/yunipals-market-core/indexedAction";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt
} from "viem";

import {
  bnbActionProgressRefetchInterval,
  bnbMarketplaceUpdateVerified,
  createBnbActionProgressClient,
  parseBnbOrderProcessing
} from "./bnbActionProcessing";
import {
  bnbActionExpectation,
  indexedActionExpectationHash
} from "./indexedBnbAction";
import { MarketApiError } from "./marketApiError";
import {
  marketFixture,
  receiptFixture,
  testHash,
  testSeller
} from "./marketplace.testFixtures";
import { pendingTransaction } from "./pendingTransactions";
import { seaportDeployment } from "./registry";
import {
  buildBnbValidation,
  buildSeaportCancellation,
  seaportEventAbi
} from "./transactionIntent";

const hash = (character: string) => `0x${character.repeat(64)}` as const;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const selected: IndexedActionSelection = {
  version: 1,
  identity: {
    releaseId: hash("1"),
    readIdentity: hash("2"),
    manifestHash: hash("3"),
    buildId: "bf4939b3ff"
  },
  supportedActions: ["bnb-validate", "bnb-cancel"]
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
  const saved = pendingTransaction(testHash, intent);
  const eventName = kind === "validate" ? "OrderValidated" : "OrderCancelled";
  const event = seaportEventAbi.find((event) => event.name === eventName)!;
  const { counter: _counter, ...parameters } = order;
  const receipt = {
    ...receiptFixture(),
    blockNumber: 100n,
    blockHash: hash("b"),
    transactionIndex: 2,
    logs: [
      {
        ...receiptFixture().logs[0],
        blockNumber: 100n,
        blockHash: hash("b"),
        transactionIndex: 2,
        logIndex: 4,
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
  const request = bnbActionExpectation(saved, receipt, selected);
  const source: IndexedActionEvidence = {
    version: 1,
    expectationHash: indexedActionExpectationHash(request),
    state: "indexed",
    reason: "action_indexed",
    identity: clone(selected.identity),
    transaction: {
      chainId: 56,
      hash: request.transactionHash,
      blockNumber: "100",
      blockHash: hash("b")
    },
    coverage: {
      sourceId: "marketplace:bnb:seaport",
      policy: "latest",
      completeThroughBlock: "110",
      availableThroughBlock: "110",
      finalizedThroughBlock: "100",
      anchor: { number: "110", hash: hash("d") },
      observationRevision: "1"
    },
    proof: {
      kind: "canonical_event_and_full_receipt",
      receiptRequirement: "full",
      receiptPayloadHash: hash("4"),
      events: [
        {
          name: eventName,
          logIndex: 4,
          id: `56:${seaportDeployment.address.toLowerCase()}:${request.transactionHash}:4`
        }
      ]
    },
    application: { state: "not_evaluated", component: "marketplace" }
  };
  const processing: BnbOrderProcessing = {
    version: 1,
    state: "qualified",
    reason: "publication_processed",
    source: clone(selected.identity),
    sourceAvailableThroughBlock: "110",
    consumer: {
      id: "bnb-discovery",
      sourceId: "marketplace:bnb:seaport",
      policy: "finalized",
      configurationHash: hash("5"),
      policyFingerprint: hash("6"),
      epoch: "2026-10-21T00:00:00.000Z",
      generation: "1",
      mode: "live",
      readerMode: "unified"
    },
    completed: { number: "100", hash: hash("b") },
    publication: {
      blockNumber: "90",
      blockHash: hash("c"),
      transactionHash: hash("e"),
      transactionIndex: 0,
      logIndex: 1
    },
    order: {
      orderHash: summary.orderHash,
      maker: summary.maker.toLowerCase(),
      lifecycle: summary.lifecycle,
      bindingCurrent: kind === "validate" ? true : false,
      status: kind === "cancel" ? "cancelled" : "active"
    },
    observation:
      kind === "cancel"
        ? {
            blockNumber: "100",
            blockHash: hash("b"),
            observedAt: "2026-10-21T00:10:00.000Z"
          }
        : null,
    observationReason: kind === "cancel" ? null : "not_observed"
  };
  const envelope = {
    schemaVersion: 1,
    persisted: true,
    order: { ...summary, status: processing.order!.status },
    processing
  };
  return { saved, receipt, source, envelope, processing };
}
const verify = (f: ReturnType<typeof fixture>) =>
  bnbMarketplaceUpdateVerified(f.envelope, f.saved, f.receipt, f.source);

test("current consumer processing requires the exact new indexed action, not a published row", () => {
  const f = fixture();
  assert.equal(verify(f), true);
  assert.equal(
    bnbMarketplaceUpdateVerified(
      { ...f.envelope, processing: undefined },
      f.saved,
      f.receipt,
      f.source
    ),
    false
  );
  for (const state of [
    "awaiting_indexing",
    "awaiting_receipt",
    "inclusion_changed",
    "action_not_observed",
    "source_unavailable",
    "unsupported"
  ] as const) {
    const source = { ...f.source, state, proof: null };
    assert.equal(
      bnbMarketplaceUpdateVerified(f.envelope, f.saved, f.receipt, source),
      false,
      state
    );
  }
  for (const field of ["hash", "blockNumber", "blockHash"] as const) {
    const source = clone(f.source);
    source.transaction[field] = field === "blockNumber" ? "99" : hash("f");
    assert.equal(
      bnbMarketplaceUpdateVerified(f.envelope, f.saved, f.receipt, source),
      false,
      field
    );
  }
});

test("all source identities and finalized consumer bounds must match", () => {
  for (const finalized of [null, "99"]) {
    const f = fixture();
    f.source.coverage!.finalizedThroughBlock = finalized;
    assert.equal(
      verify(f),
      false,
      `exact source inclusion not final: ${finalized}`
    );
  }
  for (const field of [
    "releaseId",
    "readIdentity",
    "manifestHash",
    "buildId"
  ] as const) {
    const f = fixture();
    f.processing.source![field] = field === "buildId" ? "changed" : hash("f");
    assert.equal(verify(f), false, field);
  }
  for (const change of [
    (p: BnbOrderProcessing) => {
      p.completed!.number = "99";
    },
    (p: BnbOrderProcessing) => {
      p.completed!.hash = hash("f");
    },
    (p: BnbOrderProcessing) => {
      p.sourceAvailableThroughBlock = "99";
    },
    (p: BnbOrderProcessing) => {
      p.sourceAvailableThroughBlock = null;
    },
    (p: BnbOrderProcessing) => {
      p.state = "pending";
    },
    (p: BnbOrderProcessing) => {
      p.reason = "state_changed";
    },
    (p: BnbOrderProcessing) => {
      p.consumer = null;
    }
  ]) {
    const f = fixture();
    change(f.processing);
    assert.equal(verify(f), false);
  }
});

test("publication cannot supersede the action or disagree with its same-block inclusion", () => {
  const f = fixture();
  Object.assign(f.processing.publication!, {
    blockNumber: "100",
    blockHash: hash("b"),
    transactionIndex: 1
  });
  assert.equal(verify(f), true);
  f.processing.publication!.transactionIndex = 3;
  assert.equal(verify(f), false);
  f.processing.publication!.transactionIndex = 1;
  f.processing.publication!.blockHash = hash("f");
  assert.equal(verify(f), false);
  f.processing.publication!.blockNumber = "101";
  assert.equal(verify(f), false);
  Object.assign(f.processing.publication!, {
    blockNumber: "100",
    blockHash: hash("b"),
    transactionHash: f.saved.hash,
    transactionIndex: 2,
    logIndex: 4
  });
  assert.equal(verify(f), true);
  f.processing.publication!.logIndex = 5;
  assert.equal(verify(f), false);
});

test("row, maker, lifecycle, active status and asset remain independently bound", () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.processing.order!.orderHash = hash("f");
    },
    (f: ReturnType<typeof fixture>) => {
      f.processing.order!.maker = `0x${"f".repeat(40)}`;
    },
    (f: ReturnType<typeof fixture>) => {
      f.processing.order!.lifecycle++;
    },
    (f: ReturnType<typeof fixture>) => {
      f.envelope.order.asset = { ...f.envelope.order.asset, tokenId: "999" };
    },
    (f: ReturnType<typeof fixture>) => {
      f.processing.order!.status = "cancelled";
      f.envelope.order.status = "cancelled";
    },
    (f: ReturnType<typeof fixture>) => {
      f.envelope.persisted = false;
    }
  ]) {
    const f = fixture();
    change(f);
    assert.equal(verify(f), false);
  }
});

test("old or unknown asset lifecycle cannot complete validation even when row and cursor agree", () => {
  for (const bindingCurrent of [false, null]) {
    const f = fixture();
    f.processing.order!.bindingCurrent = bindingCurrent;
    assert.equal(verify(f), false);
    // A row and its processing proof may consistently describe an old lifecycle.
    f.processing.order!.lifecycle = 1;
    f.envelope.order.lifecycle = 1;
    assert.equal(verify(f), false);
  }
  for (const bindingCurrent of [false, null]) {
    const f = fixture("cancel");
    f.processing.order!.bindingCurrent = bindingCurrent;
    assert.equal(
      verify(f),
      true,
      "canonical cancellation remains valid after lifecycle changes"
    );
  }
});

test("cancellation needs a canonical post-cancel observation, including newer than discovery cursor", () => {
  const f = fixture("cancel");
  assert.equal(verify(f), true);
  f.processing.observation!.blockNumber = "109";
  f.processing.observation!.blockHash = hash("d");
  assert.equal(verify(f), true);
  f.processing.observation!.blockNumber = "111";
  assert.equal(verify(f), false);
  for (const change of [
    (p: BnbOrderProcessing) => {
      p.observation = null;
    },
    (p: BnbOrderProcessing) => {
      p.observation!.blockNumber = "99";
    },
    (p: BnbOrderProcessing) => {
      p.observation!.blockHash = hash("f");
    },
    (p: BnbOrderProcessing) => {
      p.order!.status = "active";
    }
  ]) {
    const f = fixture("cancel");
    change(f.processing);
    assert.equal(verify(f), false);
  }
  for (const reason of [
    "not_observed",
    "stale",
    "outside_coverage",
    "history_unavailable",
    "canonical_mismatch"
  ] as const) {
    const f = fixture("cancel");
    f.processing.observationReason = reason;
    assert.equal(verify(f), false, reason);
  }
});

test("processing parser rejects unsupported policy/configuration/date and malformed bounds", () => {
  for (const [field, value] of [
    ["policy", "latest"],
    ["mode", "legacy"],
    ["readerMode", "legacy"],
    ["configurationHash", "invalid"],
    ["generation", "-1"],
    ["epoch", "not-a-date"]
  ]) {
    const raw = clone(fixture().processing) as unknown as {
      consumer: Record<string, unknown>;
    };
    raw.consumer[field] = value;
    assert.throws(() => parseBnbOrderProcessing(raw), String(field));
  }
  assert.throws(() =>
    parseBnbOrderProcessing({ ...fixture().processing, version: 2 })
  );
});

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
test("client requests separate source and order proofs without wallet payloads", async () => {
  const f = fixture();
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return url.startsWith("https://market.test")
      ? response(f.envelope)
      : init?.method === "POST"
        ? response(f.source)
        : response(selected);
  };
  const progress = await createBnbActionProgressClient(
    "https://index.test",
    "https://market.test",
    fetcher
  ).evidence(f.saved, f.receipt);
  assert.equal(progress.marketplace, "verified");
  assert.equal(calls.length, 3);
  assert.equal(
    calls[2].url,
    `https://market.test/v1/market/orders/bnb/${seaportDeployment.address}/${f.envelope.order.orderHash}`
  );
  assert.equal(calls[2].init?.body, undefined);
  for (const call of calls) {
    assert.equal(call.init?.credentials, "omit");
    assert.equal(call.init?.cache, "no-store");
    assert.equal(call.init?.redirect, "error");
  }
  assert.doesNotMatch(JSON.stringify(calls), /signature|privateKey|calldata/);
});

test("legacy/missing/failed marketplace proof preserves source proof without false completion", async () => {
  const f = fixture();
  for (const [market, expected] of [
    [
      () =>
        response({
          schemaVersion: 1,
          persisted: true,
          order: f.envelope.order
        }),
      "unverified"
    ],
    [() => response({}, 404), "unverified"],
    [() => response({}, 503), "unavailable"],
    [
      () => {
        throw new Error("offline");
      },
      "unavailable"
    ],
    [() => response({ ...f.envelope, processing: { bad: true } }), "unverified"]
  ] as const) {
    const client = createBnbActionProgressClient(
      "https://index.test",
      "https://market.test",
      async (url, init) =>
        String(url).startsWith("https://market.test")
          ? market()
          : init?.method === "POST"
            ? response(f.source)
            : response(selected)
    );
    const progress = await client.evidence(f.saved, f.receipt);
    assert.equal(progress.source.state, "indexed");
    assert.equal(progress.marketplace, expected);
  }
  const noMarket = createBnbActionProgressClient(
    "https://index.test",
    null,
    async (_url, init) =>
      init?.method === "POST" ? response(f.source) : response(selected)
  );
  assert.equal(
    (await noMarket.evidence(f.saved, f.receipt)).marketplace,
    "unavailable"
  );
});

test("source outage never falls back to an old order and pending source never requests market", async () => {
  const f = fixture();
  let calls = 0;
  const failed = createBnbActionProgressClient(
    "https://index.test",
    "https://market.test",
    async () => {
      calls++;
      return response({}, 503);
    }
  );
  await assert.rejects(
    failed.evidence(f.saved, f.receipt),
    (error: unknown) => error instanceof MarketApiError && error.status === 503
  );
  assert.equal(calls, 1);
  f.source = {
    ...f.source,
    state: "awaiting_indexing",
    reason: "block_not_indexed",
    proof: null
  };
  calls = 0;
  const pending = createBnbActionProgressClient(
    "https://index.test",
    "https://market.test",
    async (_url, init) => {
      calls++;
      return init?.method === "POST" ? response(f.source) : response(selected);
    }
  );
  assert.equal(
    (await pending.evidence(f.saved, f.receipt)).marketplace,
    "unverified"
  );
  assert.equal(calls, 2);
});

test("an aborted marketplace lookup does not resolve to cached completion", async () => {
  const f = fixture();
  const controller = new AbortController();
  const client = createBnbActionProgressClient(
    "https://index.test",
    "https://market.test",
    async (url, init) => {
      if (String(url).startsWith("https://market.test")) {
        controller.abort();
        throw new Error("aborted");
      }
      return init?.method === "POST" ? response(f.source) : response(selected);
    }
  );
  await assert.rejects(client.evidence(f.saved, f.receipt, controller.signal));
});

test("polling stops only after application verification and source finality, never from an old row", () => {
  const f = fixture();
  assert.equal(
    bnbActionProgressRefetchInterval(
      { source: f.source, marketplace: "unverified" },
      null
    ),
    30_000
  );
  assert.equal(
    bnbActionProgressRefetchInterval(
      { source: f.source, marketplace: "unavailable" },
      null
    ),
    30_000
  );
  assert.equal(
    bnbActionProgressRefetchInterval(
      { source: f.source, marketplace: "verified" },
      null
    ),
    false
  );
  assert.equal(
    bnbActionProgressRefetchInterval(
      { source: f.source, marketplace: "verified" },
      new MarketApiError(503)
    ),
    30_000
  );
  f.source.coverage!.finalizedThroughBlock = "99";
  assert.equal(
    bnbActionProgressRefetchInterval(
      { source: f.source, marketplace: "verified" },
      null
    ),
    30_000
  );
  assert.equal(
    bnbActionProgressRefetchInterval(undefined, new MarketApiError(422)),
    false
  );
  assert.equal(
    bnbActionProgressRefetchInterval(
      { source: f.source, marketplace: "unverified" },
      new MarketApiError(422)
    ),
    false
  );
  assert.equal(
    bnbActionProgressRefetchInterval(
      {
        source: { ...f.source, state: "unsupported", proof: null },
        marketplace: "unverified"
      },
      null
    ),
    false
  );
});
