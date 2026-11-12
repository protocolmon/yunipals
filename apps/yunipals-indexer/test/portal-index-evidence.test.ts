import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  TransactionReceiptNotFoundError,
  type PublicClient,
  type TransactionReceipt
} from "viem";
import {
  portalCollectionAbi,
  portalGradingAbi
} from "@protopals/yunipals-market-core/portalAbi";
import {
  portalEvidenceMatches,
  portalIndexExpectationHash,
  portalIndexSourceId,
  portalReceiptEvents,
  type PortalIndexRequest,
  type PortalIndexEvidence
} from "@protopals/yunipals-market-core/portalIndex";
import {
  PortalLedgerStore,
  type PortalLedgerEvent
} from "../lib/portals/ledger-store.js";
import { PortalChain } from "../lib/portals/chain.js";
import {
  portalEvidenceRequestSchema,
  portalIndexSelection,
  readPortalActionEvidence
} from "../lib/portals/action-evidence.js";
import type { PortalRuntime } from "../lib/portals/runtime.js";
import { PortalTransactionTracker } from "../../yunipals-home-web/src/lib/portalTransactions.js";

const addr = (n: number) => `0x${String(n).repeat(40)}` as const;
const hash = (n: number) => `0x${String(n).repeat(64)}` as const;
const alice = addr(1),
  deployment = {
    chainId: 8453,
    grading: addr(2),
    collection: addr(3),
    registry: addr(4),
    competition: addr(5),
    cards: addr(6),
    usdc: addr(7)
  };
const blockHash = hash(1),
  txHash = hash(2);
const db = new PGlite();
const ledger = new PortalLedgerStore(db as never, "evidence-test");
const sourceId = portalIndexSourceId(deployment);
const kindLog = {
  address: deployment.collection,
  logIndex: 0,
  transactionIndex: 0,
  transactionHash: txHash,
  blockNumber: 10n,
  blockHash,
  removed: false,
  topics: encodeEventTopics({
    abi: portalCollectionAbi,
    eventName: "KindConfigured",
    args: { kindId: 1n }
  }),
  data: encodeAbiParameters(parseAbiParameters("string,bytes32"), [
    "Rainbow",
    hash(3)
  ])
};
const event: PortalLedgerEvent = {
  type: "KindConfigured",
  tokenId: "0",
  block: "10",
  blockHash,
  transactionHash: txHash,
  transactionIndex: 0,
  logIndex: 0,
  source: deployment.collection,
  args: { kindId: "1", name: "Rainbow", configurationHash: hash(3) }
};
let receipt: TransactionReceipt;
let client: ReturnType<typeof clientFixture>;
let runtime: PortalRuntime;
function clientFixture() {
  return {
    getChainId: vi.fn(async () => 8453),
    getTransactionReceipt: vi.fn(async () => receipt),
    waitForTransactionReceipt: vi.fn(async () => receipt),
    getTransaction: vi.fn(async () => ({
      from: alice,
      to: deployment.collection,
      input: "0x12345678",
      value: 0n
    })),
    getBlock: vi.fn(async () => ({ hash: blockHash, number: 10n })),
    readContract: vi.fn(async () => deployment.competition)
  };
}
beforeAll(() => ledger.migrate());
beforeEach(async () => {
  await db.exec(
    "TRUNCATE portal_v2_ledger_event,portal_v2_ledger_cursor,portal_v2_token,portal_v3_competition_entry,portal_v3_competition_batch,portal_v3_competition_prize,portal_v5_request,portal_v5_mint,portal_v5_state"
  );
  receipt = {
    transactionHash: txHash,
    blockNumber: 10n,
    blockHash,
    from: alice,
    to: deployment.collection,
    status: "success",
    logs: [kindLog]
  } as unknown as TransactionReceipt;
  client = clientFixture();
  runtime = {
    chain: new PortalChain(client as unknown as PublicClient, deployment),
    ledger,
    store: {
      publicHistory: vi.fn(async () => []),
      isPublishedArtifact: vi.fn(async () => false)
    },
    assets: { read: vi.fn() }
  } as unknown as PortalRuntime;
});
afterAll(() => db.close());
async function expectation(): Promise<PortalIndexRequest> {
  const selection = await portalIndexSelection(runtime);
  return {
    version: 1,
    sourceId,
    generation: selection.generation,
    chainId: 8453,
    transactionHash: txHash,
    blockNumber: "10",
    blockHash,
    sender: alice,
    events: portalReceiptEvents(deployment, receipt)
  };
}

describe("portal canonical action and application evidence", () => {
  it("requires exact indexed event plus applied data, not just an advanced cursor", async () => {
    await ledger.apply([], "20", blockHash, null);
    const input = await expectation();
    expect((await readPortalActionEvidence(runtime, input)).state).toBe(
      "awaiting_indexing"
    );
    await ledger.apply([event], "20", blockHash, await ledger.cursor());
    expect(
      portalEvidenceMatches(
        input,
        await readPortalActionEvidence(runtime, input)
      )
    ).toBe(true);
    await db.exec("DELETE FROM portal_v5_state");
    expect((await readPortalActionEvidence(runtime, input)).reason).toBe(
      "projection_inconsistent"
    );
  });
  it("does not use an event from another transaction, wallet, contract or block", async () => {
    await ledger.apply([event], "20", blockHash, null);
    const input = await expectation();
    expect(
      (await readPortalActionEvidence(runtime, { ...input, sender: addr(8) }))
        .reason
    ).toBe("receipt_invalid");
    expect(
      (
        await readPortalActionEvidence(runtime, {
          ...input,
          events: [{ ...input.events[0], source: addr(9) }]
        })
      ).reason
    ).toBe("action_not_observed");
    await db.query("UPDATE portal_v2_ledger_event SET transaction_hash=$1", [
      hash(9)
    ]);
    expect((await readPortalActionEvidence(runtime, input)).state).toBe(
      "awaiting_indexing"
    );
    receipt = { ...receipt, blockHash: hash(4) };
    expect((await readPortalActionEvidence(runtime, input)).state).toBe(
      "inclusion_changed"
    );
  });
  it("distinguishes a missing receipt from provider denial", async () => {
    await ledger.apply([event], "20", blockHash, null);
    const input = await expectation();
    client.getTransactionReceipt.mockRejectedValueOnce(
      new Error("403 invalid parameters")
    );
    expect((await readPortalActionEvidence(runtime, input)).state).toBe(
      "source_unavailable"
    );
    client.getTransactionReceipt.mockRejectedValueOnce(
      new TransactionReceiptNotFoundError({ hash: txHash })
    );
    expect((await readPortalActionEvidence(runtime, input)).state).toBe(
      "awaiting_receipt"
    );
  });
  it("rejects old-generation evidence after replay and malformed event identities", async () => {
    await ledger.apply([event], "20", blockHash, null);
    const input = await expectation();
    await ledger.apply([], "9", blockHash, await ledger.cursor(), true);
    expect((await readPortalActionEvidence(runtime, input)).state).toBe(
      "inclusion_changed"
    );
    expect(
      portalEvidenceRequestSchema.safeParse({
        ...input,
        events: [input.events[0], input.events[0]]
      }).success
    ).toBe(false);
    expect(
      portalEvidenceRequestSchema.safeParse({ ...input, blockNumber: "-1" })
        .success
    ).toBe(false);
    expect(
      (await readPortalActionEvidence(runtime, { ...input, sourceId: hash(9) }))
        .state
    ).toBe("unsupported");
  });
  it("withholds evidence if the cursor changes during a read", async () => {
    await ledger.apply([event], "20", blockHash, null);
    const input = await expectation();
    const original = client.getTransactionReceipt.getMockImplementation()!;
    client.getTransactionReceipt.mockImplementationOnce(async () => {
      await ledger.apply([], "21", blockHash, await ledger.cursor());
      return original();
    });
    expect((await readPortalActionEvidence(runtime, input)).state).toBe(
      "awaiting_indexing"
    );
  });
  it("indexes acceptance separately from grading, publication and competition completion", async () => {
    const requested: PortalLedgerEvent = {
      ...event,
      source: deployment.grading,
      type: "GradingRequested",
      args: {
        requestId: "1",
        tokenId: "88",
        portalId: "1",
        submitter: alice,
        roundId: "3",
        inputVersion: "0",
        spellCommitment: hash(3),
        rubricId: hash(4)
      }
    };
    await ledger.apply([requested], "10", blockHash, null);
    const row = (
      await db.query(
        "SELECT token_id::text,completed_version FROM portal_v5_request"
      )
    ).rows[0];
    expect(row).toEqual({ token_id: "88", completed_version: null });
    const completion: PortalLedgerEvent = {
      ...event,
      source: deployment.grading,
      logIndex: 1,
      type: "GradingCompleted",
      args: {
        requestId: "1",
        tokenId: "88",
        grader: alice,
        version: "1",
        artworkHash: hash(5),
        scores: "80,85,90,95",
        copied: "false",
        reportHash: hash(6)
      }
    };
    await ledger.apply([completion], "11", blockHash, await ledger.cursor());
    receipt = {
      ...receipt,
      logs: [
        {
          ...kindLog,
          address: deployment.grading,
          logIndex: 1,
          topics: encodeEventTopics({
            abi: portalGradingAbi,
            eventName: "GradingCompleted",
            args: { requestId: 1n, tokenId: 88n, grader: alice }
          }),
          data: encodeAbiParameters(
            parseAbiParameters("uint64,bytes32,uint8[4],bool,bytes32"),
            [1n, hash(5), [80, 85, 90, 95], false, hash(6)]
          )
        }
      ]
    } as TransactionReceipt;
    await db.exec(
      "DELETE FROM portal_v2_ledger_event WHERE event_type='GradingRequested'"
    );
    expect(
      (await readPortalActionEvidence(runtime, await expectation())).reason
    ).toBe("projection_inconsistent");
    expect(
      (await db.query("SELECT completed_version::text FROM portal_v5_request"))
        .rows[0]
    ).toEqual({ completed_version: "1" });
  });
  it("replays a legacy projection version before using its head", async () => {
    await ledger.apply([], "10", blockHash, null);
    expect(await ledger.requiresReplay()).toBe(false);
    await db.exec("UPDATE portal_v2_ledger_cursor SET projection_version=2");
    expect(await ledger.requiresReplay()).toBe(true);
  });
});

describe("saved frontend portal transaction lifecycle", () => {
  function trackerFixture() {
    const storage = new Map<string, string>();
    const changed = vi.fn();
    const request = vi.fn(
      async (path: string, init?: RequestInit): Promise<unknown> =>
        init?.method === "POST"
          ? readPortalActionEvidence(
              runtime,
              portalEvidenceRequestSchema.parse(JSON.parse(String(init.body)))
            )
          : portalIndexSelection(runtime)
    );
    const deps = {
      client: client as unknown as PublicClient,
      request,
      changed,
      storage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        }
      }
    };
    const scope = { chainId: 8453, wallet: alice, grading: deployment.grading };
    const tracker = new PortalTransactionTracker(scope, deps);
    const intent = {
      to: deployment.collection,
      data: "0x12345678",
      value: "0",
      actionKey: "configure:1",
      label: "Configure Rainbow"
    };
    tracker.add(txHash, intent);
    return { tracker, deps, scope, request, changed, intent };
  }
  it("persists confirmation/indexing across reload and completes only after projection", async () => {
    await ledger.apply([], "20", blockHash, null);
    const { tracker, scope, deps } = trackerFixture();
    expect(await tracker.check(txHash)).toBeUndefined();
    expect(tracker.getSnapshot()[0].state).toBe("indexing");
    expect(() => tracker.assertAvailable("configure:1")).toThrow("already");
    const restored = new PortalTransactionTracker(scope, deps);
    expect(restored.getSnapshot()[0].state).toBe("indexing");
    await ledger.apply([event], "20", blockHash, await ledger.cursor());
    expect(await restored.check(txHash)).toBe(receipt);
    expect(restored.getSnapshot()[0].state).toBe("indexed");
    expect(deps.changed).toHaveBeenCalled();
    expect(
      new PortalTransactionTracker(
        { ...scope, wallet: addr(8) },
        deps
      ).getSnapshot()
    ).toHaveLength(0);
  });
  it("keeps ambiguous RPC and indexing failures saved without allowing duplicate payment", async () => {
    const { tracker } = trackerFixture();
    client.waitForTransactionReceipt.mockRejectedValueOnce(
      new Error("403 invalid parameters")
    );
    await tracker.check(txHash);
    expect(tracker.getSnapshot()[0]).toMatchObject({
      state: "delayed",
      hash: txHash
    });
    expect(() => tracker.assertAvailable("configure:1")).toThrow();
  });
  it("rejects a successful replacement whose payload belongs to another action", async () => {
    const { tracker } = trackerFixture();
    client.getTransaction.mockResolvedValueOnce({
      from: alice,
      to: deployment.collection,
      input: "0x99999999",
      value: 0n
    });
    await tracker.check(txHash);
    expect(tracker.getSnapshot()[0].state).toBe("failed");
  });
  it("invalidates completion when the receipt or source generation changes", async () => {
    await ledger.apply([event], "20", blockHash, null);
    const { tracker, changed } = trackerFixture();
    await tracker.check(txHash);
    expect(tracker.getSnapshot()[0].state).toBe("indexed");
    await ledger.apply([], "9", blockHash, await ledger.cursor(), true);
    await tracker.check(txHash);
    expect(tracker.getSnapshot()[0].state).toBe("indexing");
    expect(changed).toHaveBeenCalledTimes(2);
    receipt = { ...receipt, blockHash: hash(9) };
    await tracker.check(txHash);
    expect(tracker.getSnapshot()[0].state).toBe("confirming");
  });
  it("rejects stale evidence even if it says indexed with an advanced head", async () => {
    await ledger.apply([event], "20", blockHash, null);
    const { tracker, request } = trackerFixture();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      const result = await original(path, init);
      return init?.method === "POST"
        ? { ...(result as PortalIndexEvidence), expectationHash: hash(9) }
        : result;
    });
    expect(await tracker.check(txHash)).toBeUndefined();
    expect(tracker.getSnapshot()[0].state).toBe("indexing");
  });
  it("does not apply an old response delivered after a new source generation", async () => {
    await ledger.apply([event], "20", blockHash, null);
    const { tracker, request } = trackerFixture();
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (path, init) => {
      const result = await original(path, init);
      if (init?.method === "POST")
        await ledger.apply([], "9", blockHash, await ledger.cursor(), true);
      return result;
    });
    await tracker.check(txHash);
    expect(tracker.getSnapshot()[0].state).toBe("delayed");
  });
  it("binds proof hash and every exact event rather than relying on API success", async () => {
    await ledger.apply([event], "20", blockHash, null);
    const input = await expectation();
    const evidence = await readPortalActionEvidence(runtime, input);
    expect(evidence.expectationHash).toBe(portalIndexExpectationHash(input));
    expect(
      portalEvidenceMatches(input, {
        ...evidence,
        proof: { ...evidence.proof!, events: [] }
      })
    ).toBe(false);
    expect(
      portalEvidenceMatches(input, {
        ...evidence,
        coverage: { ...evidence.coverage!, sourceId: hash(9) }
      })
    ).toBe(false);
  });
});
