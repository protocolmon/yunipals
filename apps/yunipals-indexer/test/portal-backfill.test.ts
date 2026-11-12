import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import { portalGradingAbi } from "@protopals/yunipals-market-core/portalAbi";
import {
  deriveHistoricalCardFacts,
  readHistoricalCardFacts,
  type HistoricalPortalMint
} from "../lib/portals/backfill.js";
import { preparePortalSetup } from "../lib/portals/prepare.js";

const address = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"a".repeat(64)}` as Hex;
function mint(tokenId: bigint, original = false): HistoricalPortalMint {
  return {
    tokenId,
    originalId: 10n,
    packTypeId: 1n,
    variantId: 0,
    original,
    monsterType: 1,
    color: 1,
    horn: 1,
    glitter: 0
  };
}

describe("direct canonical card-facts derivation", () => {
  it("rejects a mint that is missing from engine history before imports can be sealed", async () => {
    const client = {
      getContractEvents: async ({ eventName }: { eventName: string }) =>
        eventName === "MonsterMinted"
          ? [{ args: { packTypeId: 1n, tokenId: 99n } }]
          : []
    } as unknown as PublicClient;
    const collect = async () => {
      for await (const _fact of readHistoricalCardFacts(client, {
        cards: address,
        engine: address,
        packTypeId: 1n,
        fromBlock: 1n,
        toBlock: 2n
      })) {
        /* consume the verification pass */
      }
    };
    await expect(collect()).rejects.toThrow("incomplete");
  });
  it("uses cumulative mint order rather than variant ID or elapsed days", () => {
    expect(
      deriveHistoricalCardFacts(
        {
          originalId: 10n,
          quantity: 1,
          minted: 1,
          timestamp: 100n,
          mints: [mint(10n, true)]
        },
        0
      )
    ).toEqual([{ tokenId: 10n, sequence: 0, mintedAt: 100n }]);
    expect(
      deriveHistoricalCardFacts(
        {
          originalId: 10n,
          quantity: 2,
          minted: 3,
          timestamp: 900000n,
          mints: [mint(50n), mint(90n)]
        },
        1
      )
    ).toEqual([
      { tokenId: 50n, sequence: 1, mintedAt: 900000n },
      { tokenId: 90n, sequence: 2, mintedAt: 900000n }
    ]);
  });
  it("rejects missing batches, another family, excess counts and false originals", () => {
    const batch = {
      originalId: 10n,
      quantity: 1,
      minted: 2,
      timestamp: 100n,
      mints: [mint(50n)]
    };
    expect(() => deriveHistoricalCardFacts(batch, 0)).toThrow("counts");
    expect(() =>
      deriveHistoricalCardFacts(
        { ...batch, mints: [{ ...mint(50n), originalId: 99n }] },
        1
      )
    ).toThrow("family");
    expect(() =>
      deriveHistoricalCardFacts({ ...batch, minted: 265 }, 264)
    ).toThrow("counts");
    expect(() =>
      deriveHistoricalCardFacts({ ...batch, mints: [mint(50n, true)] }, 1)
    ).toThrow("family");
  });
});
describe("reviewable portal launch calls", () => {
  const input = {
    collection: address,
    grading: address,
    cards: address,
    grader: address,
    aiRecipient: "0x2222222222222222222222222222222222222222" as const,
    rainbowURI: "ipfs://rainbow/image.png",
    rainbowHash: hash,
    rubricURI: "ipfs://rubric/v1.json",
    baseArt: Array.from({ length: 264 }, (_, variantId) => ({
      variantId,
      uri: `ipfs://cards/${variantId}.png`,
      hash
    }))
  };
  it("prepares exact fees and all 264 immutable base artworks without sending", () => {
    const setup = preparePortalSetup(input);
    const fee = decodeFunctionData({
      abi: portalGradingAbi,
      data: setup.transactions[2].data
    });
    expect(fee.functionName).toBe("setPaymentPolicy");
    expect(fee.args).toEqual([1n, 245000n, 245000n, input.aiRecipient]);
    const art = setup.transactions.filter((tx) =>
      tx.purpose.startsWith("Register original artworks")
    );
    expect(art).toHaveLength(5);
    expect(
      art.reduce((count, tx) => {
        const call = decodeFunctionData({
          abi: portalGradingAbi,
          data: tx.data
        });
        return (
          count +
          (call.functionName === "registerBaseArt" ? call.args[0].length : 0)
        );
      }, 0)
    ).toBe(264);
  });
  it("rejects duplicate or incomplete artwork dictionaries before encoding", () => {
    expect(() =>
      preparePortalSetup({ ...input, baseArt: input.baseArt.slice(1) })
    ).toThrow();
    expect(() =>
      preparePortalSetup({
        ...input,
        baseArt: input.baseArt.map((entry) => ({ ...entry, variantId: 0 }))
      })
    ).toThrow();
  });
});
