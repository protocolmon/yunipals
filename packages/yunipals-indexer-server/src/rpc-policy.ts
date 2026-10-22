import { manifestDigest, sourceManifestHash } from "./identity.js";
import { seaportDeployment } from "../../yunipals-market-core/src/registry.js";
import {
  validateSourceManifest,
  type SourceManifest
} from "../../yunipals-indexer-client/src/sources.js";

export const unifiedRpcProfileHeader = "x-yunipals-unified-rpc-profile";
export const unifiedRpcPath = "/unified";
export const unifiedRpcPermitHeader = "x-yunipals-unified-rpc-permit";
export const unifiedRpcWorkloads = [
  "unified_source",
  "unified_evidence"
] as const;
export type UnifiedRpcWorkload = (typeof unifiedRpcWorkloads)[number];
export type UnifiedRpcProfile = {
  version: 1;
  model: "alchemy-2026-09-08";
  scope: string;
  coordinatorId: string;
  reviewId?: string;
  manifest: SourceManifest;
  limits: {
    batchCalls: number;
    logRange: number;
    addresses: number;
    topicValues: number;
  };
};
export type UnifiedRpcCall = { method: string; params?: unknown };
export type UnifiedRpcPaidRange = { fromBlock: string; toBlock: string };
export class UnifiedRpcRangeError extends Error {
  constructor(readonly maximum: number) {
    super(`eth_getLogs is limited to ${maximum} blocks`);
  }
}
const hash = /^0x[0-9a-f]{64}$/;
const address = /^0x[0-9a-f]{40}$/i;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const readMethods = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionByBlockNumberAndIndex",
  "eth_getTransactionReceipt",
  "eth_getCode"
]);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid unified RPC policy.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join() !== [...keys].sort().join())
    throw new Error("Invalid unified RPC policy fields.");
}
function integer(value: unknown, maximum: number) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > maximum
  )
    throw new Error("Invalid unified RPC policy limit.");
}
export function validateUnifiedRpcProfile(value: unknown): UnifiedRpcProfile {
  const profile = object(value);
  exact(profile, [
    "version",
    "model",
    "scope",
    "coordinatorId",
    "manifest",
    "limits",
    ...(profile.reviewId !== undefined ? ["reviewId"] : [])
  ]);
  if (
    profile.version !== 1 ||
    profile.model !== "alchemy-2026-09-08" ||
    typeof profile.scope !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.scope) ||
    typeof profile.coordinatorId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      profile.coordinatorId
    )
  )
    throw new Error("Invalid unified RPC policy identity.");
  if (
    profile.reviewId !== undefined &&
    (typeof profile.reviewId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        profile.reviewId
      ))
  )
    throw new Error("Invalid unified RPC review identity.");
  validateSourceManifest(profile.manifest as SourceManifest);
  const limits = object(profile.limits);
  exact(limits, ["batchCalls", "logRange", "addresses", "topicValues"]);
  integer(limits.batchCalls, 100);
  integer(limits.logRange, 10000);
  integer(limits.addresses, 50);
  integer(limits.topicValues, 128);
  return profile as unknown as UnifiedRpcProfile;
}
export function unifiedRpcProfileId(profile: UnifiedRpcProfile) {
  validateUnifiedRpcProfile(profile);
  return manifestDigest(profile);
}
export function unifiedRpcManifestId(profile: UnifiedRpcProfile) {
  return sourceManifestHash(profile.manifest);
}
export function isUnifiedRpcWorkload(
  value: unknown
): value is UnifiedRpcWorkload {
  return unifiedRpcWorkloads.includes(value as UnifiedRpcWorkload);
}
export function validateUnifiedRpcCalls(
  profile: UnifiedRpcProfile,
  chainId: number,
  calls: UnifiedRpcCall[]
): void {
  const sources = profile.manifest.sources.filter(
    (source) => source.enabled && source.chainId === chainId
  );
  if (
    !sources.length ||
    !calls.length ||
    calls.length > profile.limits.batchCalls
  )
    throw new Error("Unified RPC source/batch policy refused.");
  const addresses = new Map<string, bigint>();
  for (const source of sources) {
    const address = source.address!,
      start = BigInt(source.startBlock!);
    if (!addresses.has(address) || start < addresses.get(address)!)
      addresses.set(address, start);
  }
  const minimum = sources.reduce(
    (value, source) =>
      BigInt(source.startBlock!) < value ? BigInt(source.startBlock!) : value,
    BigInt(sources[0]!.startBlock!)
  );
  // Full receipts may include a companion Seaport log on every supported
  // chain. This is only an exact protocol-code proof, never a log source.
  const codeAddresses = new Map(addresses);
  const fullReceipts = sources.filter(
    (source) => source.receiptRequirement === "full"
  );
  if (fullReceipts.length) {
    const earliest = fullReceipts.reduce(
      (start, source) =>
        BigInt(source.startBlock!) < start ? BigInt(source.startBlock!) : start,
      BigInt(fullReceipts[0]!.startBlock!)
    );
    const protocol = seaportDeployment.address.toLowerCase();
    const previous = codeAddresses.get(protocol);
    codeAddresses.set(
      protocol,
      previous !== undefined && previous < earliest ? previous : earliest
    );
  }
  const number = (value: unknown) => {
    if (typeof value !== "string" || !quantity.test(value))
      throw new Error("Invalid RPC block quantity.");
    return BigInt(value);
  };
  for (const call of calls) {
    if (
      !readMethods.has(call.method) ||
      (call.params !== undefined && !Array.isArray(call.params))
    )
      throw new Error("Unified RPC method policy refused.");
    const params = (call.params ?? []) as unknown[];
    if (call.method === "eth_chainId" || call.method === "eth_blockNumber") {
      if (params.length) throw new Error("Invalid RPC arguments.");
    } else if (call.method === "eth_getBlockByHash") {
      if (
        params.length !== 2 ||
        typeof params[0] !== "string" ||
        !hash.test(params[0]) ||
        typeof params[1] !== "boolean"
      )
        throw new Error("Invalid block-hash read.");
    } else if (call.method === "eth_getBlockByNumber") {
      if (params.length !== 2 || typeof params[1] !== "boolean")
        throw new Error("Invalid block read.");
      if (!["latest", "safe", "finalized"].includes(String(params[0])))
        number(params[0]);
    } else if (call.method === "eth_getTransactionByBlockNumberAndIndex") {
      if (params.length !== 2)
        throw new Error("Invalid block transaction read.");
      number(params[0]);
      if (number(params[1]) > 2147483647n)
        throw new Error("Invalid block transaction index.");
    } else if (
      call.method === "eth_getTransactionReceipt" ||
      call.method === "eth_getTransactionByHash"
    ) {
      if (
        params.length !== 1 ||
        typeof params[0] !== "string" ||
        !hash.test(params[0])
      )
        throw new Error(
          call.method === "eth_getTransactionReceipt"
            ? "Invalid receipt read."
            : "Invalid transaction hash read."
        );
    } else if (call.method === "eth_getCode") {
      if (
        params.length !== 2 ||
        typeof params[0] !== "string" ||
        !codeAddresses.has(params[0].toLowerCase())
      )
        throw new Error("Code read outside reviewed sources.");
      if (number(params[1]) < codeAddresses.get(params[0].toLowerCase())!)
        throw new Error("Code read before deployment.");
    } else {
      if (params.length !== 1) throw new Error("Invalid log read.");
      const filter = object(params[0]);
      if (
        Object.keys(filter).some(
          (key) =>
            ![
              "address",
              "topics",
              "fromBlock",
              "toBlock",
              "blockHash"
            ].includes(key)
        )
      )
        throw new Error("Unknown log filter.");
      if (filter.blockHash !== undefined) {
        if (
          typeof filter.blockHash !== "string" ||
          !hash.test(filter.blockHash) ||
          filter.fromBlock !== undefined ||
          filter.toBlock !== undefined
        )
          throw new Error("Invalid block-hash logs.");
        // Native Ponder deliberately fetches all logs from a single exact block.
      } else {
        const from = number(filter.fromBlock),
          to = number(filter.toBlock);
        if (from < minimum || to < from)
          throw new Error("Unified RPC log range policy refused.");
        if (to - from + 1n > BigInt(profile.limits.logRange))
          throw new UnifiedRpcRangeError(profile.limits.logRange);
        if (filter.address === undefined)
          throw new Error("Historical logs require reviewed addresses.");
      }
      if (filter.address !== undefined) {
        const requested = Array.isArray(filter.address)
          ? filter.address
          : [filter.address];
        if (
          !requested.length ||
          requested.length > profile.limits.addresses ||
          requested.some(
            (value) =>
              typeof value !== "string" ||
              !address.test(value) ||
              !addresses.has(value.toLowerCase())
          )
        )
          throw new Error("Logs outside reviewed sources.");
        if (filter.fromBlock !== undefined) {
          const earliest = requested.reduce<bigint>(
            (start, value) => {
              const deployment = addresses.get(String(value).toLowerCase())!;
              return deployment < start ? deployment : start;
            },
            addresses.get(String(requested[0]).toLowerCase())!
          );
          if (number(filter.fromBlock) < earliest)
            throw new Error(
              "Historical logs precede reviewed address deployment."
            );
        }
      }
      if (filter.topics !== undefined) {
        if (!Array.isArray(filter.topics) || filter.topics.length > 4)
          throw new Error("Invalid log topics.");
        let count = 0;
        for (const topic of filter.topics) {
          const values = Array.isArray(topic) ? topic : [topic];
          count += values.length;
          if (
            values.some(
              (value) =>
                value !== null &&
                (typeof value !== "string" || !hash.test(value))
            )
          )
            throw new Error("Invalid log topic.");
        }
        if (count > profile.limits.topicValues)
          throw new Error("Too many log topics.");
      }
    }
  }
}
// Hash/receipt reads and selective block-position transactions remain free-only.
// Adding a read method must not implicitly grant paid dispatch permission.
export function unifiedRpcPaidRange(call: UnifiedRpcCall): UnifiedRpcPaidRange {
  const params = call.params as unknown[];
  let from: unknown, to: unknown;
  if (call.method === "eth_getLogs") {
    const filter = object(params[0]);
    from = filter.fromBlock;
    to = filter.toBlock;
  } else if (call.method === "eth_getCode") from = to = params[1];
  else if (call.method === "eth_getBlockByNumber") from = to = params[0];
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !quantity.test(from) ||
    !quantity.test(to)
  )
    throw new Error("Unified RPC paid read cannot be height bounded.");
  return { fromBlock: String(BigInt(from)), toBlock: String(BigInt(to)) };
}
