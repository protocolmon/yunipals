import { zeroAddress, type Address, type PublicClient } from "viem";
import {
  adventureAbi,
  evolutionAbi,
  evolutionCardsAbi,
  evolutionGradingAbi
} from "@protopals/yunipals-market-core/evolutionAbi";
import {
  effectiveSequence,
  type EvolutionSource
} from "@protopals/yunipals-market-core/serums";
import type { EvolutionHistory } from "./art.js";
import { validateEvolutionHistory } from "./art.js";

export class EvolutionChain {
  constructor(
    readonly client: PublicClient,
    readonly cards: Address,
    readonly evolution: Address,
    readonly adventures: Address,
    readonly grading: Address
  ) {}
  request(id: bigint, blockNumber?: bigint) {
    return this.client.readContract({
      address: this.evolution,
      abi: evolutionAbi,
      functionName: "getRequest",
      args: [id],
      blockNumber
    });
  }
  binding(id: bigint, blockNumber?: bigint) {
    return this.client.readContract({
      address: this.evolution,
      abi: evolutionAbi,
      functionName: "requestBinding",
      args: [id],
      blockNumber
    });
  }
  async assertBindings(blockNumber: bigint) {
    const [cards, adventures, configured, registry, adventureCards] =
      await Promise.all([
        this.client.readContract({
          address: this.evolution,
          abi: evolutionAbi,
          functionName: "cards",
          blockNumber
        }),
        this.client.readContract({
          address: this.evolution,
          abi: evolutionAbi,
          functionName: "adventures",
          blockNumber
        }),
        this.client.readContract({
          address: this.cards,
          abi: evolutionCardsAbi,
          functionName: "evolutionController",
          blockNumber
        }),
        this.client.readContract({
          address: this.cards,
          abi: evolutionCardsAbi,
          functionName: "gradingRegistry",
          blockNumber
        }),
        this.client.readContract({
          address: this.adventures,
          abi: adventureAbi,
          functionName: "cards",
          blockNumber
        })
      ]);
    if (
      [cards, adventures, configured, registry, adventureCards]
        .map((v) => v.toLowerCase())
        .join() !==
      [this.cards, this.adventures, this.evolution, this.grading, this.cards]
        .map((v) => v.toLowerCase())
        .join()
    )
      throw new Error(
        "Evolution deployment bindings do not match the confirmed indexer."
      );
  }
  async history(
    tokenId: bigint,
    blockNumber: bigint
  ): Promise<EvolutionHistory> {
    const seen = new Set<string>();
    const visit = async (
      id: bigint,
      depth: number
    ): Promise<EvolutionHistory> => {
      if (depth > 2 || seen.has(id.toString()))
        throw new Error("Invalid fusion ancestry.");
      seen.add(id.toString());
      const [fusion, state, doses] = await Promise.all([
        this.client.readContract({
          address: this.cards,
          abi: evolutionCardsAbi,
          functionName: "fusion",
          args: [id],
          blockNumber
        }),
        this.client.readContract({
          address: this.evolution,
          abi: evolutionAbi,
          functionName: "state",
          args: [id],
          blockNumber
        }),
        this.client.readContract({
          address: this.evolution,
          abi: evolutionAbi,
          functionName: "doses",
          args: [id],
          blockNumber
        })
      ]);
      return {
        tokenId: id.toString(),
        level: fusion.level,
        presence: state[2],
        doses,
        parents: fusion.level
          ? await Promise.all([
              visit(fusion.parentA, depth + 1),
              visit(fusion.parentB, depth + 1)
            ])
          : []
      };
    };
    const result = await visit(tokenId, 0);
    validateEvolutionHistory(result);
    return result;
  }
  async sources(
    tokenId: bigint,
    blockNumber: bigint
  ): Promise<EvolutionSource[]> {
    const [ids, count] = await this.client.readContract({
      address: this.cards,
      abi: evolutionCardsAbi,
      functionName: "sourceCards",
      args: [tokenId],
      blockNumber
    });
    return Promise.all(
      ids.slice(0, count).map(async (id) => {
        const [p, facts] = await Promise.all([
          this.client.readContract({
            address: this.cards,
            abi: evolutionCardsAbi,
            functionName: "provenance",
            args: [id],
            blockNumber
          }),
          this.client.readContract({
            address: this.cards,
            abi: evolutionCardsAbi,
            functionName: "cardFacts",
            args: [id],
            blockNumber
          })
        ]);
        if (!facts[2]) throw new Error("Source card facts are unavailable.");
        return {
          tokenId: id.toString(),
          packTypeId: p[0].toString(),
          originalTokenId: p[1].toString(),
          variantId: p[2],
          ...p[3],
          isOriginal: p[4],
          sequence: facts[0]
        };
      })
    );
  }
  async card(tokenId: bigint, blockNumber: bigint) {
    const [
      owner,
      sources,
      history,
      state,
      next,
      unused,
      pendingAdventure,
      pendingEvolution,
      pendingGrade,
      graded,
      reservation,
      transferLocked,
      input,
      metadataURI
    ] = await Promise.all([
      this.client.readContract({
        address: this.cards,
        abi: evolutionCardsAbi,
        functionName: "ownerOf",
        args: [tokenId],
        blockNumber
      }),
      this.sources(tokenId, blockNumber),
      this.history(tokenId, blockNumber),
      this.client.readContract({
        address: this.evolution,
        abi: evolutionAbi,
        functionName: "state",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.adventures,
        abi: adventureAbi,
        functionName: "nextAdventureAt",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.adventures,
        abi: adventureAbi,
        functionName: "unusedSerum",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.adventures,
        abi: adventureAbi,
        functionName: "pendingRequest",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.evolution,
        abi: evolutionAbi,
        functionName: "pendingRequest",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.grading,
        abi: evolutionGradingAbi,
        functionName: "pendingRequest",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.cards,
        abi: evolutionCardsAbi,
        functionName: "hasCompletedGrade",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.cards,
        abi: evolutionCardsAbi,
        functionName: "cardReservation",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.cards,
        abi: evolutionCardsAbi,
        functionName: "transferLocked",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.grading,
        abi: evolutionGradingAbi,
        functionName: "inputArtwork",
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.cards,
        abi: evolutionCardsAbi,
        functionName: "tokenURI",
        args: [tokenId],
        blockNumber
      })
    ]);
    return {
      tokenId: tokenId.toString(),
      owner,
      sources,
      history,
      level: history.level as 0 | 1 | 2,
      effectiveSequence: effectiveSequence(sources),
      artVersion: state[0].toString(),
      localDoses: state[1],
      presence: state[2],
      historyHash: state[3],
      nextAdventureAt: Number(next),
      unused: unused.serumId ? unused : null,
      pendingAdventure: pendingAdventure ? pendingAdventure.toString() : null,
      pendingEvolution: pendingEvolution ? pendingEvolution.toString() : null,
      pendingGrade: pendingGrade ? pendingGrade.toString() : null,
      graded,
      reservedBy: reservation === zeroAddress ? null : reservation,
      transferLocked,
      artwork: input[0],
      metadataURI
    };
  }
}
