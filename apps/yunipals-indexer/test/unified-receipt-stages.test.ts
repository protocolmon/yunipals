import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { seaportDeployment } from "../../../packages/yunipals-market-core/src/registry.js";
import { receiptLogsBloom } from "../lib/unified/receipt-validation.js";
import { enrichReceiptJob } from "../lib/unified/receipt-worker.js";
import type { RegisteredRelease } from "../lib/unified/releases.js";
import type { EvidenceRpc } from "../lib/unified/rpc.js";

const blockHash = `0x${"ab".repeat(32)}`;
const transactionHash = `0x${"cd".repeat(32)}`;
const address = `0x${"12".repeat(20)}`;
const topics = [`0x${"34".repeat(32)}`];
const block = {
  number: 100n,
  hash: blockHash,
  parentHash: `0x${"ef".repeat(32)}`,
  timestamp: 1000n
};

async function failureStage(kind: "receipt" | "runtimeRpc" | "runtimeHash") {
  const logs = [address, seaportDeployment.address.toLowerCase()].map(
    (logAddress, index) => ({
      address: logAddress,
      topics,
      data: "0x",
      blockNumber: "0x64",
      blockHash,
      transactionHash,
      transactionIndex: "0x0",
      logIndex: `0x${index.toString(16)}`,
      removed: false
    })
  );
  const receipt = {
    blockNumber: "0x64",
    blockHash,
    transactionHash,
    transactionIndex: "0x0",
    status: kind === "receipt" ? "0x0" : "0x1",
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
  const updates: unknown[][] = [];
  let runtimeCalls = 0;
  const pool = {
    async query(sql: string, parameters: unknown[]) {
      if (sql.startsWith("SELECT address,log_index")) {
        return {
          rows: [{
            address,
            log_index: 0,
            transaction_index: 0,
            data: "0x",
            topics: JSON.stringify(topics)
          }]
        };
      }
      if (sql.includes("UPDATE yunipals_indexer_control.receipt_job")) {
        updates.push(parameters);
        return { rowCount: 1 };
      }
      throw new Error("Unexpected evidence write or source transaction.");
    }
  } as unknown as Pool;
  const rpc: EvidenceRpc = {
    providerId: "fixture",
    chainId: async () => 1,
    block: async () => block,
    receipt: async () => receipt,
    code: async () => {
      runtimeCalls++;
      if (kind === "runtimeRpc") {
        throw new Error("https://private.example/credential-sentinel");
      }
      return "0x6000";
    }
  };
  const result = await enrichReceiptJob(
    pool,
    { schema: "fixture" } as RegisteredRelease,
    {
      chain_id: 1,
      block_number: "100",
      block_hash: blockHash,
      transaction_hash: transactionHash,
      lease_id: "fixture-lease",
      attempts: 3
    },
    rpc
  );
  expect(result).toBe("retry");
  expect(updates).toHaveLength(1);
  expect(updates[0]?.[5]).toBe(8);
  expect(JSON.stringify(updates)).not.toContain("credential-sentinel");
  return { code: updates[0]?.[4], runtimeCalls };
}

describe("receipt retry stages", () => {
  it("keeps malformed receipts rejected before fetching runtime code", async () => {
    expect(await failureStage("receipt")).toEqual({
      code: "receipt_validation_failed",
      runtimeCalls: 0
    });
  });

  it("distinguishes a historical bytecode RPC failure after a valid receipt", async () => {
    expect(await failureStage("runtimeRpc")).toEqual({
      code: "receipt_runtime_rpc_unavailable",
      runtimeCalls: 1
    });
  });

  it("keeps a wrong Seaport runtime rejected with a distinct safe code", async () => {
    expect(await failureStage("runtimeHash")).toEqual({
      code: "receipt_runtime_validation_failed",
      runtimeCalls: 1
    });
  });
});
