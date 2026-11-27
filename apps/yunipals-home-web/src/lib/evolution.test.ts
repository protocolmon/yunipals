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

test("crew review binds all three roles, chosen survivor, UTC date and rules", async () => {
  const { adventureAbi } = await import(
    "@protopals/yunipals-market-core/evolutionAbi"
  );
  const { crewRulesHash, crewEligibility, crewAdventureOdds } = await import(
    "@protopals/yunipals-market-core/serums"
  );
  const previous = { ...environment };
  Object.assign(environment, {
    evolutionEnabled: true,
    adventuresAddress: controller,
    portalChainId: 8453
  });
  try {
    const crew = {
      tokenIds: ["1", "2", "3"] as [string, string, string],
      day: 1
    };
    const cards = crew.tokenIds.map((id, index) => ({
      ...card,
      tokenId: id,
      sources: [{ ...card.sources[0], tokenId: id, horn: index === 1 ? 2 : 1 }]
    }));
    const q: EvolutionQuote = {
      ...quote(0n),
      kind: "adventure",
      cards,
      crew: { day: 1, color: 1, monsterType: 1 },
      deadline: "100000",
      data: encodeFunctionData({
        abi: adventureAbi,
        functionName: "crewAdventure",
        args: [[1n, 2n, 3n], 2n, 1n, crewRulesHash, 100n, 100000n]
      })
    };
    validateEvolutionQuote(q, owner, "adventure", "2", undefined, crew);
    assert.throws(
      () => validateEvolutionQuote(q, owner, "adventure", "1", undefined, crew),
      /reviewed action/
    );
    assert.throws(
      () =>
        validateEvolutionQuote(q, owner, "adventure", "2", undefined, {
          ...crew,
          day: 2
        }),
      /crew quote/
    );
    const wrongRoles = {
      ...q,
      data: encodeFunctionData({
        abi: adventureAbi,
        functionName: "crewAdventure",
        args: [[2n, 1n, 3n], 2n, 1n, crewRulesHash, 100n, 100000n]
      })
    };
    assert.throws(
      () =>
        validateEvolutionQuote(
          wrongRoles,
          owner,
          "adventure",
          "2",
          undefined,
          crew
        ),
      /reviewed action/
    );
    assert.match(
      crewEligibility([cards[0], cards[0], cards[2]], q.crew!)!,
      /different/
    );
    assert.match(
      crewEligibility(
        cards.map((c) => ({
          ...c,
          sources: c.sources.map((s) => ({ ...s, mintedAt: 86399 }))
        })),
        q.crew!
      )!,
      /born today/
    );
    assert.equal(crewAdventureOdds(263).weights[0], 0);
    assert.ok(
      Math.abs(
        crewAdventureOdds(263).weights.reduce((a, b) => a + b, 0) - 1_000_000
      ) < 0.000001
    );
  } finally {
    Object.assign(environment, previous);
  }
});
