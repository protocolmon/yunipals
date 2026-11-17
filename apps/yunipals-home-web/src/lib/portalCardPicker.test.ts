import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicClient } from "viem";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";
import { eligiblePortalCards } from "./portalCardPicker";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const cards = "0x3333333333333333333333333333333333333333";
const grading = "0x4444444444444444444444444444444444444444";
const context = { owner, cards, grading, portalId: "160" } as const;
const card = (
  tokenId: string,
  fields: Partial<BoosterMonster> = {}
): BoosterMonster => ({
  id: `8453:${cards}:${tokenId}`,
  tokenId,
  owner,
  collection: cards,
  originalKey: "original",
  requestKey: "request",
  typeKey: "type",
  mintedTo: owner,
  variantId: "0",
  monsterType: "1",
  color: "1",
  horn: "1",
  glitter: "0",
  isOriginal: false,
  burned: false,
  mintBlock: "1",
  metadataUri: "fixture:card",
  ...fields
});
const success = (result: unknown) => ({ status: "success", result });
function client(
  results: unknown[],
  inspect?: (input: {
    blockNumber: bigint;
    contracts: { address: string; functionName: string; args: bigint[] }[];
  }) => void
) {
  return {
    getBlockNumber: async () => 100n,
    multicall: async (input: Parameters<NonNullable<typeof inspect>>[0]) => {
      inspect?.(input);
      return results;
    }
  } as unknown as Pick<PublicClient, "getBlockNumber" | "multicall">;
}

test("only matching, currently owned cards without a pending spell are offered", async () => {
  const results = [
    true,
    0n,
    owner,
    false,
    0n,
    owner,
    true,
    42n,
    owner,
    true,
    0n,
    other
  ].map(success);
  const eligible = await eligiblePortalCards(
    client(results, (input) => {
      assert.equal(input.blockNumber, 100n);
      assert.equal(input.contracts.length, 12);
      assert.deepEqual(input.contracts[0].args, [160n, 1n]);
      assert.equal(input.contracts[0].address, grading);
      assert.equal(input.contracts[0].functionName, "matches");
      assert.equal(input.contracts[1].functionName, "pendingRequest");
      assert.equal(input.contracts[2].address, cards);
      assert.equal(input.contracts[2].functionName, "ownerOf");
    }),
    context,
    [card("1"), card("2"), card("3"), card("4")]
  );
  assert.deepEqual(
    eligible.map((c) => c.tokenId),
    ["1"]
  );
});

test("foreign collections, burned cards and another wallet's cards are excluded before RPC", async () => {
  let calls = 0;
  const eligible = await eligiblePortalCards(
    client([], () => calls++),
    context,
    [
      card("1", { collection: other }),
      card("2", { burned: true }),
      card("3", { owner: other })
    ]
  );
  assert.deepEqual(eligible, []);
  assert.equal(calls, 0);
});

test("a failed eligibility read raises an error instead of showing an empty wallet", async () => {
  await assert.rejects(
    eligiblePortalCards(
      client([{ status: "failure" }, success(0n), success(owner)]),
      context,
      [card("1")]
    ),
    /Could not check/
  );
});

test("incomplete results fail closed", async () => {
  await assert.rejects(
    eligiblePortalCards(client([success(true)]), context, [card("1")]),
    /Could not check/
  );
});

test("a confirmed nonmatch yields an empty eligible list", async () => {
  const result = await eligiblePortalCards(
    client([false, 0n, owner].map(success)),
    context,
    [card("1")]
  );
  assert.deepEqual(result, []);
});
