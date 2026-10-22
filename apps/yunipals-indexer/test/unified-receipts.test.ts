import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { padHex, toEventSelector, toHex } from "viem";
import {
  receiptLogsBloom,
  validateTransactionReceipt,
  verifyReceiptRuntime
} from "../lib/unified/receipt-validation.js";

const hash = `0x${"ab".repeat(32)}`;
const transaction = `0x${"cd".repeat(32)}`;
const address = `0x${"12".repeat(20)}` as const;
const block = {
  number: 100n,
  hash,
  parentHash: `0x${"ef".repeat(32)}`,
  timestamp: 1000n
};
const candidate = {
  chainId: 8453,
  blockNumber: 100n,
  blockHash: hash,
  transactionHash: transaction
};
function fixture() {
  const topics = [
    toEventSelector("Transfer(address,address,uint256)"),
    padHex("0x00", { size: 32 }),
    padHex(address, { size: 32 }),
    toHex(1n, { size: 32 })
  ];
  const logs = [0, 1].map((index) => ({
    address,
    topics,
    data: "0x",
    blockNumber: "0x64",
    blockHash: hash,
    transactionHash: transaction,
    transactionIndex: "0x0",
    logIndex: toHex(index),
    removed: false
  }));
  const expected = logs.map((log, index) => ({
    address,
    topics,
    data: "0x",
    logIndex: index,
    transactionIndex: 0
  }));
  const receipt = {
    blockNumber: "0x64",
    blockHash: hash,
    transactionHash: transaction,
    transactionIndex: "0x0",
    status: "0x1",
    from: address,
    to: address,
    contractAddress: null,
    gasUsed: "0x5208",
    cumulativeGasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    type: "0x2",
    logs,
    logsBloom: receiptLogsBloom(logs)
  };
  return { receipt, expected };
}

describe("full receipt evidence", () => {
  it("retains multiple indexed logs and yields the viem receipt used by existing sale parsers", () => {
    const { receipt, expected } = fixture();
    const parsed = validateTransactionReceipt(
      candidate,
      receipt,
      block,
      expected
    );
    expect(parsed.receipt.logs).toHaveLength(2);
    expect(parsed.receipt.blockNumber).toBe(100n);
    expect(parsed.receipt.status).toBe("success");
    expect(parsed.hasSeaport).toBe(false);
  });
  it("rejects a failed transaction, wrong identity, removed/duplicated logs, or missing indexed evidence", () => {
    for (const mutation of [
      (r: ReturnType<typeof fixture>["receipt"]) => ({ ...r, status: "0x0" }),
      (r: ReturnType<typeof fixture>["receipt"]) => ({
        ...r,
        blockHash: `0x${"11".repeat(32)}`
      }),
      (r: ReturnType<typeof fixture>["receipt"]) => ({
        ...r,
        logs: [{ ...r.logs[0]!, removed: true }, r.logs[1]]
      }),
      (r: ReturnType<typeof fixture>["receipt"]) => ({
        ...r,
        logs: [r.logs[0], r.logs[0]]
      }),
      (r: ReturnType<typeof fixture>["receipt"]) => ({
        ...r,
        logs: r.logs.slice(0, 1)
      })
    ]) {
      const { receipt, expected } = fixture();
      expect(() =>
        validateTransactionReceipt(
          candidate,
          mutation(receipt),
          block,
          expected
        )
      ).toThrow();
    }
  });
  it("detects receipt truncation using indexed evidence and the complete receipt bloom", () => {
    const { receipt, expected } = fixture();
    const unrelated = {
      ...receipt.logs[1]!,
      address: `0x${"34".repeat(20)}`,
      topics: []
    };
    receipt.logsBloom = receiptLogsBloom([receipt.logs[0]!, unrelated]);
    expect(() =>
      validateTransactionReceipt(
        candidate,
        { ...receipt, logs: [receipt.logs[0]] },
        block,
        [expected[0]!]
      )
    ).toThrow(/bloom/);
  });
  it("bounds payload/log work and rejects malformed quantities", () => {
    const { receipt, expected } = fixture();
    expect(() =>
      validateTransactionReceipt(candidate, receipt, block, expected, {
        maxBytes: 1
      })
    ).toThrow(/large/);
    expect(() =>
      validateTransactionReceipt(candidate, receipt, block, expected, {
        maxLogs: 1
      })
    ).toThrow(/logs/);
    expect(() =>
      validateTransactionReceipt(
        candidate,
        { ...receipt, gasUsed: "0x00" },
        block,
        expected
      )
    ).toThrow(/quantity/);
  });
  it("rejects null padding in provider receipt topics", () => {
    const { receipt, expected } = fixture();
    // Only indexed Ponder storage has fixed-width null slots. Provider logs
    // remain raw receipt evidence and must contain valid topic hashes only.
    const logs = receipt.logs.map((log) => ({
      ...log,
      topics: [...log.topics.slice(0, 3), null]
    }));
    expect(() =>
      validateTransactionReceipt(candidate, { ...receipt, logs }, block, expected)
    ).toThrow(/hex/i);
  });
  it("checks protocol runtime against the existing captured chain-specific bytecode", () => {
    for (const chain of ["ethereum", "base", "polygon"]) {
      const fixture = JSON.parse(
        readFileSync(
          new URL(
            `../../yunipals-market-api/src/opensea/fixtures/seaport-${chain}-bytecode.json`,
            import.meta.url
          ),
          "utf8"
        )
      ) as { chainId: number; code: string };
      expect(verifyReceiptRuntime(fixture.chainId, fixture.code)).toMatch(
        /^0x[0-9a-f]{64}$/
      );
      expect(() => verifyReceiptRuntime(56, fixture.code)).toThrow(/runtime/);
    }
    expect(() => verifyReceiptRuntime(8453, "0x6000")).toThrow(/runtime/);
  });
});
