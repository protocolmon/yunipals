import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { evolutionAbi } from "@protopals/yunipals-market-core/evolutionAbi";
import { environment } from "@/environment";
import {
  validateEvolutionQuote,
  type AdventureCard,
  type EvolutionQuote
} from "./evolution";

const owner = "0x1111111111111111111111111111111111111111";
const controller = "0x2222222222222222222222222222222222222222";
const hash = `0x${"0".repeat(64)}` as const;
const dose = { catalogueVersion: 1, serumId: 121, presenceId: 1 } as const;
const expected = { artVersion: 0n, historyHash: hash };
const card: AdventureCard = {
  tokenId: "1",
  owner,
  level: 0,
  sources: [
    {
      tokenId: "1",
      originalTokenId: "1",
      sequence: 0,
      mintedAt: 86401,
      isOriginal: true,
      packTypeId: "1",
      variantId: 0,
      monsterType: 1,
      color: 1,
      horn: 1,
      glitter: 0
    }
  ],
  effectiveSequence: 0,
  artVersion: "0",
  historyHash: hash,
  localDoses: 0,
  presence: 0,
  finish: 0,
  history: {
    tokenId: "1",
    level: 0,
    presence: 0,
    finish: 0,
    doses: [],
    parents: []
  },
  nextAdventureAt: 0,
  unused: dose,
  pendingAdventure: null,
  pendingEvolution: null,
  pendingGrade: null,
  graded: false,
  reservedBy: null,
  transferLocked: false,
  artwork: { uri: "ipfs://input", hash },
  metadataURI: "ipfs://metadata"
};
function quote(fee: bigint): EvolutionQuote {
  return {
    kind: "serum",
    cards: [card],
    to: controller,
    data: encodeFunctionData({
      abi: evolutionAbi,
      functionName: "consumeSerum",
      args: [1n, expected, dose, fee, 100n, 9999999999n]
    }),
    value: "100",
    fee: String(fee),
    fees: { maxFeePerGas: "1", maxPriorityFeePerGas: "1" },
    deadline: "9999999999",
    chainId: 8453,
    usdc: owner
  };
}
test("serum review accepts only the displayed fee bound into the transaction", () => {
  const previous = { ...environment };
  Object.assign(environment, {
    evolutionEnabled: true,
    evolutionAddress: controller,
    portalChainId: 8453
  });
  try {
    for (const fee of [0n, 100000n])
      assert.doesNotThrow(() =>
        validateEvolutionQuote(quote(fee), owner, "serum", "1")
      );
    assert.throws(() =>
      validateEvolutionQuote(
        { ...quote(100000n), fee: "0" },
        owner,
        "serum",
        "1"
      )
    );
    assert.throws(() => validateEvolutionQuote(quote(1n), owner, "serum", "1"));
    const legacy = encodeFunctionData({
      abi: parseAbi([
        "function consumeSerum(uint256,(uint64 artVersion,bytes32 historyHash),(uint32 catalogueVersion,uint8 serumId,uint8 presenceId),uint256,uint64) payable returns (uint256)"
      ]),
      functionName: "consumeSerum",
      args: [1n, expected, dose, 100n, 9999999999n]
    });
    assert.throws(() =>
      validateEvolutionQuote(
        { ...quote(0n), data: legacy },
        owner,
        "serum",
        "1"
      )
    );
    assert.throws(() =>
      validateEvolutionQuote(
        { ...quote(0n), kind: "fusion" },
        owner,
        "fusion",
        "1"
      )
    );
  } finally {
    Object.assign(environment, previous);
  }
});

test("fusion review requires its displayed fee cap even for sponsored quotes", () => {
  const previous = { ...environment };
  Object.assign(environment, {
    evolutionEnabled: true,
    evolutionAddress: controller,
    portalChainId: 8453
  });
  const fusion = (fee: bigint): EvolutionQuote => ({
    ...quote(fee),
    kind: "fusion",
    cards: [
      card,
      {
        ...card,
        tokenId: "2",
        sources: [
          { ...card.sources[0], tokenId: "2", sequence: 1, isOriginal: false }
        ]
      }
    ],
    data: encodeFunctionData({
      abi: evolutionAbi,
      functionName: "fuse",
      args: [1n, 2n, expected, expected, fee, 100n, 9999999999n]
    })
  });
  try {
    for (const fee of [0n, 100000n])
      assert.doesNotThrow(() =>
        validateEvolutionQuote(fusion(fee), owner, "fusion", "1", "2")
      );
    const twin: AdventureCard = {
      ...card,
      tokenId: "2",
      sources: [
        {
          ...card.sources[0],
          tokenId: "2",
          originalTokenId: "2",
          mintedAt: 172799
        }
      ]
    };
    assert.doesNotThrow(() =>
      validateEvolutionQuote(
        { ...fusion(0n), cards: [card, twin] },
        owner,
        "fusion",
        "1",
        "2"
      )
    );
    for (const patch of [
      { mintedAt: 172800 },
      { glitter: 1 },
      { mintedAt: undefined }
    ])
      assert.throws(() =>
        validateEvolutionQuote(
          {
            ...fusion(0n),
            cards: [
              card,
              { ...twin, sources: [{ ...twin.sources[0], ...patch }] }
            ]
          },
          owner,
          "fusion",
          "1",
          "2"
        )
      );
    assert.throws(() =>
      validateEvolutionQuote(
        { ...fusion(100000n), fee: "0" },
        owner,
        "fusion",
        "1",
        "2"
      )
    );
    assert.throws(() =>
      validateEvolutionQuote(fusion(1n), owner, "fusion", "1", "2")
    );
    const legacy = encodeFunctionData({
      abi: parseAbi([
        "function fuse(uint256,uint256,(uint64 artVersion,bytes32 historyHash),(uint64 artVersion,bytes32 historyHash),uint256,uint64) payable returns(uint256)"
      ]),
      functionName: "fuse",
      args: [1n, 2n, expected, expected, 100n, 9999999999n]
    });
    assert.throws(() =>
      validateEvolutionQuote(
        { ...fusion(0n), data: legacy },
        owner,
        "fusion",
        "1",
        "2"
      )
    );
  } finally {
    Object.assign(environment, previous);
  }
});
