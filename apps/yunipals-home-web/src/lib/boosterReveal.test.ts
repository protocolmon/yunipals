import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";
import { confirmedBoosterPulls } from "./boosterReveal";

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
  const original = { ...cards[0], tokenId: "7", isOriginal: true };
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
