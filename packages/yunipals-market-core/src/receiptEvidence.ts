import {
  formatTransactionReceipt,
  hexToBytes,
  keccak256,
  toHex,
  type Hex,
  type RpcTransactionReceipt
} from "viem";
import { seaportDeployment } from "./registry.js";
import { seaportRuntimeHashes } from "./seaportRuntime.js";
export type EvidenceBlock = {
  number: bigint;
  hash: string;
  parentHash: string;
  timestamp: bigint;
};

export type ReceiptCandidate = {
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
};
export type ExpectedReceiptLog = {
  address: string;
  logIndex: number;
  transactionIndex: number;
  data: string;
  topics: readonly string[];
};

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_receipt");
  return value as Record<string, unknown>;
}
function quantity(value: unknown): bigint {
  if (
    typeof value !== "string" ||
    value.length > 66 ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)
  )
    throw new Error("invalid_receipt_quantity");
  return BigInt(value);
}
function safeInteger(value: unknown): number {
  const number = Number(quantity(value));
  if (!Number.isSafeInteger(number)) throw new Error("invalid_receipt_index");
  return number;
}
function hex(value: unknown, bytes?: number): string {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-f]{2})*$/i.test(value) ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)
  )
    throw new Error("invalid_receipt_hex");
  return value.toLowerCase();
}

export function receiptLogsBloom(
  logs: readonly { address: string; topics: readonly string[] }[]
): string {
  const bloom = new Uint8Array(256);
  for (const log of logs) {
    for (const value of [log.address, ...log.topics]) {
      const digest = hexToBytes(keccak256(value as Hex));
      for (let offset = 0; offset < 6; offset += 2) {
        const bit = ((digest[offset]! << 8) | digest[offset + 1]!) & 2047;
        bloom[255 - (bit >> 3)]! |= 1 << (bit & 7);
      }
    }
  }
  return toHex(bloom);
}

export function validateTransactionReceipt(
  candidate: ReceiptCandidate,
  input: unknown,
  block: EvidenceBlock,
  expectedLogs: readonly ExpectedReceiptLog[],
  options: { maxBytes?: number; maxLogs?: number } = {}
) {
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxLogs = options.maxLogs ?? 10_000;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(maxLogs) ||
    maxLogs < 1
  )
    throw new Error("invalid_receipt_limits");
  const encoded = JSON.stringify(input);
  if (!encoded || Buffer.byteLength(encoded) > maxBytes)
    throw new Error("receipt_too_large");
  const raw = object(input);
  if (
    raw.status !== "0x1" ||
    hex(raw.blockHash, 32) !== candidate.blockHash ||
    hex(raw.transactionHash, 32) !== candidate.transactionHash ||
    quantity(raw.blockNumber) !== candidate.blockNumber ||
    block.number !== candidate.blockNumber ||
    block.hash !== candidate.blockHash ||
    block.timestamp < 0n
  ) {
    throw new Error("receipt_identity_mismatch");
  }
  const transactionIndex = safeInteger(raw.transactionIndex);
  hex(raw.from, 20);
  if (raw.to !== null) hex(raw.to, 20);
  if (raw.contractAddress !== null) hex(raw.contractAddress, 20);
  for (const field of [
    "gasUsed",
    "cumulativeGasUsed",
    "effectiveGasPrice",
    "type"
  ])
    quantity(raw[field]);
  if (
    !Array.isArray(raw.logs) ||
    !raw.logs.length ||
    raw.logs.length > maxLogs ||
    expectedLogs.length > maxLogs
  )
    throw new Error("invalid_receipt_logs");
  let previous = -1;
  const logs = raw.logs.map((value: unknown) => {
    const log = object(value);
    const logIndex = safeInteger(log.logIndex);
    if (
      logIndex <= previous ||
      (previous >= 0 && logIndex !== previous + 1) ||
      log.removed !== false ||
      hex(log.blockHash, 32) !== candidate.blockHash ||
      quantity(log.blockNumber) !== candidate.blockNumber ||
      hex(log.transactionHash, 32) !== candidate.transactionHash ||
      safeInteger(log.transactionIndex) !== transactionIndex ||
      !Array.isArray(log.topics) ||
      log.topics.length > 4
    )
      throw new Error("incomplete_receipt_logs");
    previous = logIndex;
    return {
      address: hex(log.address, 20),
      logIndex,
      transactionIndex,
      data: hex(log.data),
      topics: log.topics.map((topic) => hex(topic, 32))
    };
  });
  for (const expected of expectedLogs) {
    const log = logs.find((log) => log.logIndex === expected.logIndex);
    if (
      !log ||
      log.address !== expected.address ||
      log.transactionIndex !== expected.transactionIndex ||
      log.data !== expected.data ||
      JSON.stringify(log.topics) !== JSON.stringify(expected.topics)
    )
      throw new Error("indexed_log_missing_from_receipt");
  }
  if (receiptLogsBloom(logs) !== hex(raw.logsBloom, 256))
    throw new Error("receipt_bloom_mismatch");
  const hasSeaport = logs.some(
    (log) => log.address === seaportDeployment.address.toLowerCase()
  );
  return {
    raw,
    receipt: formatTransactionReceipt(raw as unknown as RpcTransactionReceipt),
    hasSeaport
  };
}

export function verifyReceiptRuntime(chainId: number, code: string): string {
  const expected =
    seaportRuntimeHashes[chainId as keyof typeof seaportRuntimeHashes];
  if (
    !expected ||
    !/^0x(?:[0-9a-f]{2})+$/i.test(code) ||
    keccak256(code as Hex) !== expected
  )
    throw new Error("protocol_runtime_mismatch");
  return expected;
}
