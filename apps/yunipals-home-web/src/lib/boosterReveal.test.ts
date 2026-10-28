import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  type Hex,
  type TransactionReceipt
} from "viem";
import { boosterPacksAbi } from "@protopals/yunipals-market-core/boosterAbi";
import { boosterPermitAbi } from "./boosterPermit";
import {
  boosterTransactionExpectation,
  boosterTransactionHistory,
  combinedBoosterPulls,
  confirmedBoosterPulls,
  confirmedBoosterRequests,
  confirmedBoosterRequestState,
  type BoosterCreatedRequest
} from "./boosterReveal";

const collection = "0x1111111111111111111111111111111111111111";
const engine = "0x2222222222222222222222222222222222222222";
const request = {
  collection,
  engine,
  requestId: "9",
  originalId: "7",
  quantity: 3,
  opening: false
};
const cards: BoosterMonster[] = ["12", "19", "100"].map((tokenId) => ({
  collection,
  tokenId,
  metadataUri: `https://example.test/${tokenId}.json`,
  requestKey: `8453:${engine}:9`,
  originalKey: `8453:${collection}:7`,
  isOriginal: false,
  owner: "0x3333333333333333333333333333333333333333",
  burned: false,
  id: `8453:${collection}:${tokenId}`,
  typeKey: "type-2",
  mintedTo: collection,
  variantId: tokenId,
  monsterType: "3",
  color: "2",
  horn: "0",
  glitter: "0",
  mintBlock: "1234"
}));

test("one request maps to its exact pulls even when IDs have gaps and cards changed owners", () => {
  const transferred = cards.map((card, i) => ({ ...card, burned: i === 1 }));
  assert.deepEqual(
    confirmedBoosterPulls(transferred, request).map((card) => card.tokenId),
    ["12", "19", "100"]
  );
});

test("incomplete, duplicate, mixed-request, mixed-original and mixed-collection batches cannot open", () => {
  const invalid: BoosterMonster[][] = [
    cards.slice(0, 2),
    [...cards, cards[0]],
    [cards[0], cards[0], cards[2]],
    cards.map((card, i) =>
      i ? card : { ...card, requestKey: `8453:${engine}:10` }
    ),
    cards.map((card, i) =>
      i ? card : { ...card, originalKey: `8453:${collection}:8` }
    ),
    cards.map((card, i) => (i ? card : { ...card, collection: engine })),
    cards.map((card, i) => (i ? card : { ...card, isOriginal: true }))
  ];
  for (const rows of invalid)
    assert.throws(() => confirmedBoosterPulls(rows, request));
  for (const quantity of [0, 1.5, 8])
    assert.throws(() => confirmedBoosterPulls(cards, { ...request, quantity }));
});

test("a purchased pack contains only its revealed original", () => {
  const original = {
    ...cards[0],
    id: `8453:${collection}:7`,
    tokenId: "7",
    isOriginal: true
  };
  assert.equal(
    confirmedBoosterPulls([original], {
      ...request,
      quantity: 1,
      opening: true
    })[0].tokenId,
    "7"
  );
  assert.throws(() =>
    confirmedBoosterPulls([{ ...original, tokenId: "8" }], {
      ...request,
      quantity: 1,
      opening: true
    })
  );
});

const transactionHash = `0x${"ab".repeat(32)}` as Hex;
const blockHash = `0x${"cd".repeat(32)}` as Hex;
const payer = "0x3333333333333333333333333333333333333333";
const ruleHash = `0x${"ef".repeat(32)}` as Hex;
const expected = {
  hash: transactionHash,
  engine,
  kind: "open" as const,
  expectedRequestCount: 3,
  packTypeId: "2",
  quantity: 1
};
type Receipt = Pick<
  TransactionReceipt,
  "status" | "transactionHash" | "blockHash" | "blockNumber" | "logs"
>;
function receipt(
  ids = ["90", "2", "77"],
  originals = ["7", "100", "19"],
  opening = true,
  quantity = 1
): Receipt {
  return {
    status: "success",
    transactionHash,
    blockHash,
    blockNumber: 1234n,
    logs: ids.map((id, index) => ({
      address: engine,
      blockHash,
      blockNumber: 1234n,
      transactionHash,
      transactionIndex: 0,
      logIndex: 20 + index,
      removed: false,
      topics: encodeEventTopics({
        abi: boosterPacksAbi,
        eventName: "RequestCreated",
        args: {
          requestId: BigInt(id),
          originalId: BigInt(originals[index]),
          packTypeId: 2n
        }
      }) as [Hex, ...Hex[]],
      data: encodeAbiParameters(
        parseAbiParameters("address,uint32,bool,uint256,bytes32,uint32"),
        [payer, quantity, opening, 10n, ruleHash, 900000]
      )
    }))
  };
}
const requestState = (created: BoosterCreatedRequest, status = 3) => ({
  originalId: BigInt(created.originalId),
  quantity: created.quantity,
  opening: created.opening,
  payer: created.payer,
  paid: BigInt(created.paid),
  ruleHash: created.ruleHash,
  status
});

test("one exact receipt groups every nonadjacent request in log order", () => {
  const value = receipt();
  value.logs.reverse();
  const requests = confirmedBoosterRequests(value, expected);
  assert.deepEqual(
    requests.map((row) => row.requestId),
    ["90", "2", "77"]
  );
  assert.deepEqual(
    requests.map((row) => row.originalId),
    ["7", "100", "19"]
  );
  assert(requests.every((row) => row.transactionHash === transactionHash));
  assert(requests.every((row) => row.blockHash === blockHash));
});

test("request recovery transactions cannot hide the original purchase group", () => {
  const purchase = { hash: "purchase", kind: "open" };
  const recovery = Array.from({ length: 10 }, (_, index) => ({
    hash: `recover-${index}`,
    kind: "recover"
  }));
  const rows = boosterTransactionHistory([purchase, ...recovery]);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].hash, "recover-9");
  assert.equal(rows.at(-1), purchase);
  const purchases = Array.from({ length: 20 }, (_, index) => ({
    hash: `purchase-${index}`,
    kind: "open"
  }));
  assert.deepEqual(
    boosterTransactionHistory(purchases).map((row) => row.hash),
    ["purchase-19", "purchase-18", "purchase-17", "purchase-16", "purchase-15"]
  );
});

test("missing, duplicate, foreign-engine, removed, cross-tx and cross-block logs never create a group", () => {
  for (const mutate of [
    (r: Receipt) => {
      r.logs.pop();
    },
    (r: Receipt) => {
      r.logs.push(r.logs[0]);
    },
    (r: Receipt) => {
      r.logs[0] = { ...r.logs[0], address: collection };
    },
    (r: Receipt) => {
      r.logs[0] = { ...r.logs[0], removed: true };
    },
    (r: Receipt) => {
      r.logs[0] = { ...r.logs[0], transactionHash: blockHash };
    },
    (r: Receipt) => {
      r.logs[0] = { ...r.logs[0], blockHash: transactionHash };
    },
    (r: Receipt) => {
      r.logs[0] = { ...r.logs[0], blockNumber: 1235n };
    },
    (r: Receipt) => {
      r.logs[0] = { ...r.logs[0], data: "0x" };
    },
    (r: Receipt) => {
      r.status = "reverted";
    },
    (r: Receipt) => {
      r.transactionHash = blockHash;
    }
  ]) {
    const value = receipt();
    mutate(value);
    assert.throws(() => confirmedBoosterRequests(value, expected));
  }
  for (const expectedRequestCount of [0, 2, 4, 11, 1.5])
    assert.throws(() =>
      confirmedBoosterRequests(receipt(), { ...expected, expectedRequestCount })
    );
  assert.throws(() =>
    confirmedBoosterRequests(receipt(["9", "9", "7"]), expected)
  );
  assert.throws(() =>
    confirmedBoosterRequests(receipt(undefined, ["7", "7", "19"]), expected)
  );
});

test("receipt kind/type/quantity and original are checked, while a legacy single purchase stays compatible", () => {
  const value = receipt(["9"], ["7"]);
  assert.equal(
    confirmedBoosterRequests(value, {
      hash: transactionHash,
      engine,
      kind: "open"
    }).length,
    1
  );
  for (const change of [
    { kind: "claim" as const },
    { packTypeId: "3" },
    { quantity: 2 },
    { originalId: "8" }
  ])
    assert.throws(() =>
      confirmedBoosterRequests(value, {
        ...expected,
        expectedRequestCount: 1,
        ...change
      })
    );
  assert.equal(
    confirmedBoosterRequests(receipt(["9"], ["7"], false, 3), {
      ...expected,
      kind: "claim",
      expectedRequestCount: 1,
      quantity: 3,
      originalId: "7"
    })[0].quantity,
    3
  );
});

test("all direct request states must match their receipt, including pending/recovery/forfeited", () => {
  const created = confirmedBoosterRequests(receipt(), expected)[0];
  for (const status of [1, 2, 3, 4])
    assert.equal(
      confirmedBoosterRequestState(requestState(created, status), created)
        .status,
      status
    );
  for (const change of [
    { originalId: 8n },
    { quantity: 2 },
    { opening: false },
    { payer: collection },
    { paid: 11n },
    { ruleHash: blockHash },
    { status: 0 },
    { status: 5 }
  ])
    assert.throws(() =>
      confirmedBoosterRequestState(
        { ...requestState(created), ...change },
        created
      )
    );
});

test("actual multi-purchase calldata recovers legacy counts and validates wallet replacements", () => {
  const input = encodeFunctionData({
    abi: parseAbi([
      "function openPacks(uint256 packTypeId,uint32 count,uint256 maxTotalVrfPrice,uint256 deadline) payable"
    ]),
    functionName: "openPacks",
    args: [2n, 3, 100n, 999999n]
  });
  const intent = boosterTransactionExpectation(
    { hash: transactionHash, to: engine, input },
    {
      ...expected,
      expectedRequestCount: 9,
      packTypeId: "99"
    }
  );
  assert.equal(intent.expectedRequestCount, 3);
  assert.equal(intent.packTypeId, "2");
  assert.equal(confirmedBoosterRequests(receipt(), intent).length, 3);
  assert.throws(() =>
    boosterTransactionExpectation(
      { hash: blockHash, to: engine, input },
      expected
    )
  );
  assert.throws(() =>
    boosterTransactionExpectation(
      { hash: transactionHash, to: collection, input },
      expected
    )
  );
  assert.throws(() =>
    boosterTransactionExpectation(
      { hash: transactionHash, to: engine, input },
      { ...expected, kind: "claim" }
    )
  );
});

test("permit purchases recover their actual count while retaining engine, hash and complete receipt guards", () => {
  for (const quantity of [1, 3]) {
    const input = encodeFunctionData({
      abi: boosterPermitAbi,
      functionName: "openPacksWithPermit",
      args: [2n, quantity, 100n, 999999n, 27, ruleHash, blockHash]
    });
    const transaction = { hash: transactionHash, to: engine, input };
    const intent = boosterTransactionExpectation(transaction, {
      ...expected,
      expectedRequestCount: 9,
      packTypeId: "99"
    });
    assert.equal(intent.expectedRequestCount, quantity);
    assert.equal(intent.packTypeId, "2");
    const value = quantity === 1 ? receipt(["90"], ["7"]) : receipt();
    assert.equal(confirmedBoosterRequests(value, intent).length, quantity);
    assert.throws(() =>
      confirmedBoosterRequests(receipt(["90", "2"], ["7", "100"]), intent)
    );
    assert.throws(() =>
      boosterTransactionExpectation(
        { ...transaction, to: collection },
        expected
      )
    );
    assert.throws(() =>
      boosterTransactionExpectation(
        { ...transaction, hash: blockHash },
        expected
      )
    );
    assert.throws(() =>
      boosterTransactionExpectation(transaction, { ...expected, kind: "claim" })
    );
  }
});

test("a signed replacement claim uses its actual original/quantity instead of stale local hints", () => {
  const input = encodeFunctionData({
    abi: boosterPacksAbi,
    functionName: "claim",
    args: [8n, 2, 100n, 999999n]
  });
  const intent = boosterTransactionExpectation(
    { hash: transactionHash, to: engine, input },
    {
      ...expected,
      kind: "claim",
      expectedRequestCount: 1,
      quantity: 7,
      originalId: "7",
      packTypeId: "99"
    }
  );
  assert.equal(intent.originalId, "8");
  assert.equal(intent.quantity, 2);
  assert.equal(intent.packTypeId, undefined);
  assert.equal(
    confirmedBoosterRequests(receipt(["2"], ["8"], false, 2), intent).length,
    1
  );
});

test("one wrapper combines only the complete verified groups, retaining gaps/transfers/burns", () => {
  const requests = confirmedBoosterRequests(receipt(), expected);
  const groups: Parameters<typeof combinedBoosterPulls>[0] = requests.map(
    (created, index) => ({
      request: { ...created, engine, collection },
      items: [
        {
          ...cards[0],
          tokenId: created.originalId,
          id: `8453:${collection}:${created.originalId}`,
          requestKey: `8453:${engine}:${created.requestId}`,
          originalKey: `8453:${collection}:${created.originalId}`,
          isOriginal: true,
          burned: index === 1,
          owner: index === 2 ? engine : payer
        }
      ]
    })
  );
  assert.deepEqual(
    combinedBoosterPulls(groups).map((card) => card.tokenId),
    ["7", "100", "19"]
  );
  assert.throws(() => combinedBoosterPulls([...groups, groups[0]]));
  assert.throws(() =>
    combinedBoosterPulls(
      groups.map((group, index) => (index ? group : { ...group, items: [] }))
    )
  );
  assert.throws(() =>
    combinedBoosterPulls(
      groups.map((group, index) =>
        index
          ? group
          : {
              ...group,
              items: [{ ...group.items[0], requestKey: `8453:${engine}:500` }]
            }
      )
    )
  );
});

test("ETH purchases retain hash, destination, count and buyer guards", async () => {
  const { ethPackPurchaseData, capEthPackQuote } = await import("./boosterEth");
  const adapter = "0x5555555555555555555555555555555555555555";
  const from = "0x3333333333333333333333333333333333333333";
  const transaction = {
    hash: transactionHash,
    to: adapter,
    from,
    input: ethPackPurchaseData(2n, 3, capEthPackQuote(0, 100n), 200n, 999999n)
  };
  const intent = boosterTransactionExpectation(transaction, {
    ...expected,
    paymentAdapter: adapter
  });
  assert.equal(intent.expectedRequestCount, 3);
  assert.equal(intent.payer, from);
  assert.equal(confirmedBoosterRequests(receipt(), intent).length, 3);
  assert.throws(() => boosterTransactionExpectation(transaction, expected));
  assert.throws(() =>
    boosterTransactionExpectation(
      { ...transaction, hash: blockHash },
      { ...expected, paymentAdapter: adapter }
    )
  );
  assert.throws(() =>
    boosterTransactionExpectation(
      { ...transaction, from: undefined },
      { ...expected, paymentAdapter: adapter }
    )
  );
  assert.throws(() =>
    confirmedBoosterRequests(receipt(), { ...intent, payer: adapter })
  );
});
