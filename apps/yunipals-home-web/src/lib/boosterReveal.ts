import {
  decodeFunctionData,
  encodeEventTopics,
  parseEventLogs,
  type Hex,
  type TransactionReceipt
} from "viem";
import { boosterPacksAbi } from "@protopals/yunipals-market-core/boosterAbi";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";
import { boosterPurchaseAbi } from "@/lib/boosterPurchase";

export type BoosterCreatedRequest = {
  requestId: string;
  originalId: string;
  packTypeId: string;
  payer: string;
  quantity: number;
  opening: boolean;
  paid: string;
  ruleHash: string;
  logIndex: number;
  transactionHash: string;
  blockHash: string;
};
export type BoosterRequestState = {
  originalId: bigint;
  payer: string;
  paid: bigint;
  ruleHash: string;
  quantity: number;
  opening: boolean;
  status: number;
};
export type BoosterRevealExpectation = {
  hash: Hex;
  engine: string;
  kind: "open" | "claim";
  expectedRequestCount?: number;
  packTypeId?: string;
  quantity?: number;
  originalId?: string;
};
type SubmittedTransaction = { hash: Hex; to: string | null; input: Hex };
type Receipt = Pick<
  TransactionReceipt,
  "status" | "transactionHash" | "blockHash" | "blockNumber" | "logs"
>;

export function boosterTransactionHistory<
  T extends { hash: string; kind: string }
>(rows: readonly T[]): T[] {
  const groups = rows
    .filter((row) => row.kind === "open" || row.kind === "claim")
    .slice(-5);
  const retained = new Set(
    [...groups, ...rows.slice(-5)].map((row) => row.hash.toLowerCase())
  );
  return rows
    .filter((row) => retained.has(row.hash.toLowerCase()))
    .slice()
    .reverse();
}
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]{0,77})$/.test(value) &&
  BigInt(value) < 2n ** 256n;
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
function requireReceipt(value: unknown): asserts value {
  if (!value)
    throw new Error(
      "This transaction’s complete pack requests could not be verified. Try again shortly."
    );
}
function count(value: unknown, maximum: number) {
  const number = typeof value === "bigint" ? Number(value) : value;
  requireReceipt(
    typeof number === "number" &&
      Number.isSafeInteger(number) &&
      number >= 1 &&
      number <= maximum
  );
  return number;
}

// A replacement transaction's actual input is authoritative. Local intent hints
// survive reloads, but cannot invent requests or hide a legitimately changed count.
export function boosterTransactionExpectation(
  transaction: SubmittedTransaction,
  expected: BoosterRevealExpectation
): BoosterRevealExpectation {
  requireReceipt(
    transaction.hash.toLowerCase() === expected.hash.toLowerCase() &&
      transaction.to?.toLowerCase() === expected.engine.toLowerCase()
  );
  const decoded = decodeFunctionData({
    abi: [...boosterPacksAbi, ...boosterPurchaseAbi],
    data: transaction.input
  });
  const args = decoded.args as readonly unknown[];
  requireReceipt(Array.isArray(args));
  const method = String(decoded.functionName);
  if (method === "openPack" || method === "openPacks") {
    requireReceipt(expected.kind === "open" && typeof args[0] === "bigint");
    return {
      ...expected,
      expectedRequestCount: method === "openPacks" ? count(args[1], 10) : 1,
      packTypeId: args[0].toString(),
      quantity: 1,
      originalId: undefined
    };
  }
  requireReceipt(
    method === "claim" &&
      expected.kind === "claim" &&
      typeof args[0] === "bigint"
  );
  return {
    ...expected,
    expectedRequestCount: 1,
    packTypeId: undefined,
    quantity: count(args[1], 32),
    originalId: args[0].toString()
  };
}

export function confirmedBoosterRequests(
  receipt: Receipt,
  expected: BoosterRevealExpectation
): BoosterCreatedRequest[] {
  requireReceipt(
    receipt.status === "success" &&
      hash(receipt.transactionHash) &&
      receipt.transactionHash.toLowerCase() === expected.hash.toLowerCase() &&
      hash(receipt.blockHash) &&
      receipt.blockNumber >= 0n
  );
  const topic = encodeEventTopics({
    abi: boosterPacksAbi,
    eventName: "RequestCreated"
  })[0];
  const logs = receipt.logs.filter(
    (log) =>
      log.address.toLowerCase() === expected.engine.toLowerCase() &&
      log.topics[0] === topic
  );
  const events = parseEventLogs({
    abi: boosterPacksAbi,
    eventName: "RequestCreated",
    logs,
    strict: true
  });
  const expectedCount = count(expected.expectedRequestCount ?? 1, 10);
  requireReceipt(
    events.length === logs.length && events.length === expectedCount
  );
  const requests = events.map((event) => {
    requireReceipt(
      event.removed !== true &&
        event.transactionHash?.toLowerCase() === expected.hash.toLowerCase() &&
        event.blockHash?.toLowerCase() === receipt.blockHash.toLowerCase() &&
        event.blockNumber === receipt.blockNumber &&
        typeof event.logIndex === "number" &&
        Number.isSafeInteger(event.logIndex) &&
        event.logIndex >= 0 &&
        event.args.opening === (expected.kind === "open") &&
        Number.isInteger(event.args.quantity) &&
        event.args.quantity >= 1 &&
        event.args.quantity <= 32 &&
        (!event.args.opening || event.args.quantity === 1) &&
        (expected.quantity === undefined ||
          expected.quantity === event.args.quantity) &&
        (expected.packTypeId === undefined ||
          expected.packTypeId === event.args.packTypeId.toString()) &&
        (expected.originalId === undefined ||
          expected.originalId === event.args.originalId.toString())
    );
    return {
      requestId: event.args.requestId.toString(),
      originalId: event.args.originalId.toString(),
      packTypeId: event.args.packTypeId.toString(),
      payer: event.args.payer.toLowerCase(),
      quantity: event.args.quantity,
      opening: event.args.opening,
      paid: event.args.paid.toString(),
      ruleHash: event.args.ruleHash.toLowerCase(),
      logIndex: event.logIndex,
      transactionHash: receipt.transactionHash.toLowerCase(),
      blockHash: receipt.blockHash.toLowerCase()
    };
  });
  requireReceipt(
    new Set(requests.map((request) => request.requestId)).size ===
      expectedCount &&
      new Set(requests.map((request) => request.logIndex)).size ===
        expectedCount &&
      new Set(requests.map((request) => request.packTypeId)).size === 1 &&
      (expected.kind !== "claim" || expectedCount === 1) &&
      (expected.kind !== "open" ||
        new Set(requests.map((request) => request.originalId)).size ===
          expectedCount)
  );
  return requests.sort((a, b) => a.logIndex - b.logIndex);
}

export function confirmedBoosterRequestState(
  state: BoosterRequestState,
  created: BoosterCreatedRequest
) {
  requireReceipt(
    state.status >= 1 &&
      state.status <= 4 &&
      state.originalId.toString() === created.originalId &&
      state.quantity === created.quantity &&
      state.opening === created.opening &&
      state.payer.toLowerCase() === created.payer &&
      state.paid.toString() === created.paid &&
      state.ruleHash.toLowerCase() === created.ruleHash
  );
  return state;
}

export type BoosterPullRequest = {
  engine: string;
  collection: string;
  requestId: string;
  originalId: string;
  quantity: number;
  opening: boolean;
  registry?: string;
  packTypeId?: string;
};

// A batch is defined by the request, never by adjacent NFT token IDs or owner.
export function confirmedBoosterPulls(
  items: BoosterMonster[],
  request: BoosterPullRequest
) {
  const { engine, collection, requestId, originalId, quantity, opening } =
    request;
  const requestKey = `8453:${engine.toLowerCase()}:${requestId}`;
  const originalKey = `8453:${collection.toLowerCase()}:${originalId}`;
  if (
    !validId(requestId) ||
    !validId(originalId) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 32 ||
    (opening && quantity !== 1) ||
    items.length !== quantity ||
    new Set(items.map((item) => item.tokenId)).size !== quantity ||
    items.some(
      (item) =>
        !validId(item.tokenId) ||
        item.id.toLowerCase() !==
          `8453:${collection.toLowerCase()}:${item.tokenId}` ||
        item.collection.toLowerCase() !== collection.toLowerCase() ||
        item.requestKey.toLowerCase() !== requestKey ||
        item.originalKey.toLowerCase() !== originalKey ||
        item.isOriginal !== opening ||
        (opening && item.tokenId !== originalId) ||
        (request.registry !== undefined &&
          request.packTypeId !== undefined &&
          item.typeKey.toLowerCase() !==
            `8453:${request.registry.toLowerCase()}:${request.packTypeId}`)
    )
  )
    throw new Error(
      "Your pack’s revealed cards are still being indexed. Try again shortly."
    );
  return items.map(({ collection, tokenId, metadataUri }) => ({
    collection,
    tokenId,
    metadataUri
  }));
}

export function combinedBoosterPulls(
  groups: readonly { request: BoosterPullRequest; items: BoosterMonster[] }[]
) {
  requireReceipt(groups.length >= 1 && groups.length <= 10);
  requireReceipt(
    new Set(groups.map(({ request }) => request.requestId)).size ===
      groups.length &&
      new Set(groups.map(({ request }) => request.engine.toLowerCase()))
        .size === 1 &&
      new Set(groups.map(({ request }) => request.collection.toLowerCase()))
        .size === 1
  );
  const pulls = groups.flatMap(({ request, items }) =>
    confirmedBoosterPulls(items, request)
  );
  requireReceipt(
    new Set(
      pulls.map((pull) => `${pull.collection.toLowerCase()}:${pull.tokenId}`)
    ).size === pulls.length
  );
  return pulls;
}
