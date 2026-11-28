import { describe, expect, it, vi } from "vitest";
import { decodeEventLog, encodeEventTopics, parseAbi } from "viem";
import { applyEvolutionEvent } from "../lib/evolution/projection.js";

vi.mock("ponder:schema", () => ({
  default: { canonicalEvent: "events", transactionCandidate: "receipts" }
}));
vi.mock("../lib/unified/sources.js", () => ({
  sourceManifestHash: () => `0x${"0".repeat(64)}`,
  buildSourceManifest: () => ({
    sources: [
      {
        id: "evolution:8453:adventures",
        enabled: true,
        chainId: 8453,
        address: `0x${"1".repeat(40)}`,
        startBlock: "1",
        events: ["CrewAdventuresEnabled", "DailyCrewRequested"],
        abiHash: `0x${"0".repeat(64)}`,
        feature: "evolution",
        receiptRequirement: "full"
      }
    ]
  })
}));
import {
  recordCanonicalEvent,
  type IndexedLog
} from "../lib/unified/handlers.js";

const abi = parseAbi(["event CrewAdventuresEnabled()"]);
const topics = [
  encodeEventTopics({ abi, eventName: "CrewAdventuresEnabled" })[0]
] as const;
const hash = `0x${"2".repeat(64)}` as const;
function event(args: unknown): IndexedLog {
  return {
    args,
    block: { number: 100n, hash, timestamp: 1000n },
    transaction: { hash, transactionIndex: 0 },
    log: {
      address: `0x${"1".repeat(40)}`,
      logIndex: 0,
      topics: [...topics],
      data: "0x"
    }
  };
}
function database() {
  const rows: Record<string, unknown>[] = [];
  const context = {
    chain: { id: 8453 },
    db: {
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          rows.push(row);
          return { onConflictDoNothing: async () => {} };
        }
      })
    }
  };
  return {
    rows,
    context: context as unknown as Parameters<typeof recordCanonicalEvent>[3]
  };
}
describe("canonical event arguments", () => {
  it("records a real no-argument log and passes it through the evolution projection", async () => {
    const decoded = decodeEventLog({ abi, topics: [...topics], data: "0x" });
    expect(decoded.args).toBeUndefined();
    const log = event(decoded.args),
      { rows, context } = database();
    await recordCanonicalEvent(
      "evolution:8453:adventures",
      decoded.eventName,
      log,
      context
    );
    expect(rows[0]?.args).toBe("{}");
    expect(rows[1]?.transactionHash).toBe(hash);
    const put = vi.fn();
    await applyEvolutionEvent(
      { get: async () => null, put },
      decoded.eventName,
      JSON.parse(JSON.stringify(log.args))
    );
    expect(put).not.toHaveBeenCalled();
  });
  it("preserves populated arguments and serializes bigint values without precision loss", async () => {
    const args = { day: 20_784n, requestId: 2n ** 200n };
    const log = event(args),
      { rows, context } = database();
    await recordCanonicalEvent(
      "evolution:8453:adventures",
      "DailyCrewRequested",
      log,
      context
    );
    expect(log.args).toBe(args);
    expect(JSON.parse(String(rows[0]?.args))).toEqual({
      day: "20784",
      requestId: (2n ** 200n).toString()
    });
  });
  it("still rejects events from a different emitter", async () => {
    const log = event(undefined),
      { context, rows } = database();
    log.log.address = `0x${"3".repeat(40)}`;
    await expect(
      recordCanonicalEvent(
        "evolution:8453:adventures",
        "CrewAdventuresEnabled",
        log,
        context
      )
    ).rejects.toThrow("configured source");
    expect(rows).toHaveLength(0);
  });
});
