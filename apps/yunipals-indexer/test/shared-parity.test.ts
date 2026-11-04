import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import {
  hashCanonicalHistory,
  proveSharedParityBoundary
} from "../lib/unified/shared-parity.js";

type Row = {
  id: string;
  block_number: string;
  transaction_index: number;
  log_index: number;
  [key: string]: unknown;
};
function database(events: Row[]) {
  const cursors: Array<unknown> = [];
  return {
    cursors,
    db: {
      query: async (_sql: string, values: unknown[]) => {
        cursors.push(values.slice(2));
        expect(values.slice(0, 2)).toEqual(["ownership:base", "100"]);
        return {
          rows: events
            .filter(
              (row) =>
                BigInt(row.block_number) > BigInt(String(values[2])) ||
                (row.block_number === values[2] &&
                  (row.transaction_index > Number(values[3]) ||
                    (row.transaction_index === values[3] &&
                      (row.log_index > Number(values[4]) ||
                        (row.log_index === values[4] &&
                          row.id > String(values[5]))))))
            )
            .slice(0, 2000)
        };
      }
    } as unknown as Pick<PoolClient, "query">
  };
}

describe("shared canonical history evidence", () => {
  it("requires a matching physical boundary and never hides a native mismatch with RPC", async () => {
    const hash = `0x${"12".repeat(32)}`;
    const source = {
      chainId: 8453,
      block: 100n,
      baselineHash: hash,
      targetHash: hash,
      archived: false
    };
    expect((await proveSharedParityBoundary(source)).verification).toBe(
      "native"
    );
    await expect(
      proveSharedParityBoundary({ ...source, targetHash: undefined })
    ).rejects.toThrow("native boundary");
    await expect(
      proveSharedParityBoundary({
        ...source,
        archived: true,
        targetHash: `0x${"34".repeat(32)}`,
        canonicalHash: async () => hash
      })
    ).rejects.toThrow("different branch");
  });

  it("checks archived quiet-block history and the target witness before and after comparison", async () => {
    const oldHash = `0x${"12".repeat(32)}`,
      witnessHash = `0x${"34".repeat(32)}`;
    let changed = false;
    const calls: bigint[] = [];
    const proof = await proveSharedParityBoundary({
      chainId: 8453,
      block: 100n,
      baselineHash: oldHash,
      archived: true,
      witness: { blockNumber: 200n, blockHash: witnessHash },
      canonicalHash: async (_chain, block) => {
        calls.push(block);
        return changed
          ? `0x${"56".repeat(32)}`
          : block === 100n
            ? oldHash
            : witnessHash;
      }
    });
    expect(proof.verification).toBe("canonical_point_checks");
    await proof.recheck();
    expect(calls).toEqual([200n, 100n, 200n, 100n]);
    changed = true;
    await expect(proof.recheck()).rejects.toThrow("changed");
  });
  it("includes every page, including an altered event after the first page", async () => {
    const events = Array.from({ length: 2001 }, (_, index) => ({
      id: String(index).padStart(6, "0"),
      block_number: "50",
      transaction_index: Math.floor(index / 32),
      log_index: index % 32,
      source_id: "ownership:base",
      topics: "[]",
      args: { to: "wallet", tokenId: String(index) }
    }));
    const previous = database(events);
    const first = await hashCanonicalHistory(
      previous.db,
      "source_before",
      "ownership:base",
      100n
    );
    const next = database(
      events.map((row) => ({
        ...row,
        args: row.args,
        source_id: row.source_id,
        id: row.id
      }))
    );
    expect(
      await hashCanonicalHistory(
        next.db,
        "source_after",
        "ownership:base",
        100n
      )
    ).toEqual(first);
    expect(first.events).toBe(2001);
    expect(previous.cursors).toEqual([
      ["-1", -1, -1, ""],
      ["50", 62, 15, "001999"]
    ]);
    events[2000]!.args = { to: "different-wallet", tokenId: "2000" };
    const changed = database(events);
    expect(
      (
        await hashCanonicalHistory(
          changed.db,
          "source_after",
          "ownership:base",
          100n
        )
      ).sha256
    ).not.toBe(first.sha256);
  });

  it("refuses an unsafe SQL schema name before issuing a query", async () => {
    const source = database([]);
    await expect(
      hashCanonicalHistory(
        source.db,
        "source;DROP TABLE private",
        "ownership:base",
        100n
      )
    ).rejects.toThrow();
    expect(source.cursors).toEqual([]);
  });

  it("compares historical topic padding with realtime topics and rejects changed or malformed evidence", async () => {
    const topic = `0x${"ab".repeat(32)}`;
    const row = {
      id: "event",
      block_number: "50",
      transaction_index: 0,
      log_index: 0,
      topics: JSON.stringify([topic])
    };
    const hash = async (topics: unknown[]) =>
      hashCanonicalHistory(
        database([{ ...row, topics: JSON.stringify(topics) }]).db,
        "source",
        "ownership:base",
        100n
      );
    expect(await hash([topic, null, null, null])).toEqual(await hash([topic]));
    expect((await hash([`0x${"cd".repeat(32)}`])).sha256).not.toBe(
      (await hash([topic])).sha256
    );
    await expect(hash([topic, null, topic])).rejects.toThrow(
      "Invalid indexed event topics"
    );
    await expect(hash(["invalid"])).rejects.toThrow(
      "Invalid indexed event topics"
    );
  });
});
