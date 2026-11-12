import { decodeEventLog, type Address, type PublicClient } from "viem";
import {
  boosterPacksAbi,
  yunipalMonstersAbi
} from "@protopals/yunipals-market-core/boosterAbi";
import { portalCardAbi } from "./chain.js";

export interface HistoricalPortalMint {
  tokenId: bigint;
  originalId: bigint;
  packTypeId: bigint;
  variantId: number;
  original: boolean;
  monsterType: number;
  color: number;
  horn: number;
  glitter: number;
}
export interface HistoricalCardFacts {
  tokenId: bigint;
  sequence: number;
  mintedAt: bigint;
}

export function deriveHistoricalCardFacts(
  batch: {
    originalId: bigint;
    quantity: number;
    minted: number;
    timestamp: bigint;
    mints: HistoricalPortalMint[];
  },
  previousMinted: number
): HistoricalCardFacts[] {
  if (
    !Number.isInteger(batch.quantity) ||
    batch.quantity < 1 ||
    batch.quantity !== batch.mints.length ||
    batch.minted > 264 ||
    batch.minted - batch.quantity !== previousMinted ||
    batch.timestamp <= 0n
  )
    throw new Error(
      "Historical mint counts do not match canonical completion."
    );
  return batch.mints.map((mint, index) => {
    const sequence = batch.minted - batch.quantity + index;
    if (
      mint.originalId !== batch.originalId ||
      mint.original !== (sequence === 0) ||
      (mint.original && mint.tokenId !== batch.originalId)
    )
      throw new Error(
        "Historical original family does not match its mint sequence."
      );
    return { tokenId: mint.tokenId, sequence, mintedAt: batch.timestamp };
  });
}

export async function* readHistoricalCardFacts(
  client: PublicClient,
  config: {
    cards: Address;
    engine: Address;
    packTypeId: bigint;
    fromBlock: bigint;
    toBlock: bigint;
  }
) {
  const minted = new Map<string, number>();
  const seen = new Set<string>();
  for (let from = config.fromBlock; from <= config.toBlock; from += 2000n) {
    const to = from + 1999n < config.toBlock ? from + 1999n : config.toBlock;
    const completed = await client.getContractEvents({
      address: config.engine,
      abi: boosterPacksAbi,
      eventName: "RequestCompleted",
      fromBlock: from,
      toBlock: to
    });
    completed.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1
    );
    for (const event of completed) {
      const { originalId, quantity, minted: total } = event.args;
      if (
        originalId === undefined ||
        quantity === undefined ||
        total === undefined
      )
        throw new Error("Incomplete historical completion event.");
      const receipt = await client.getTransactionReceipt({
        hash: event.transactionHash
      });
      const block = await client.getBlock({ blockNumber: event.blockNumber });
      if (
        block.hash !== event.blockHash ||
        receipt.blockHash !== block.hash ||
        receipt.status !== "success"
      )
        throw new Error("Historical mint is not canonical.");
      const mints: HistoricalPortalMint[] = [];
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== config.cards.toLowerCase()) continue;
        let decoded;
        try {
          decoded = decodeEventLog({
            abi: yunipalMonstersAbi,
            eventName: "MonsterMinted",
            data: log.data,
            topics: log.topics
          });
        } catch {
          continue;
        }
        const args = decoded.args;
        if (
          args.originalTokenId !== originalId ||
          args.packTypeId !== config.packTypeId
        )
          continue;
        mints.push({
          tokenId: args.tokenId,
          originalId: args.originalTokenId,
          packTypeId: args.packTypeId,
          variantId: args.variantId,
          original: args.isOriginal,
          monsterType: args.monsterType,
          color: args.color,
          horn: args.horn,
          glitter: args.glitter
        });
      }
      if (mints.length === 0) continue;
      const facts = deriveHistoricalCardFacts(
        {
          originalId,
          quantity,
          minted: total,
          timestamp: block.timestamp,
          mints
        },
        minted.get(originalId.toString()) ?? 0
      );
      minted.set(originalId.toString(), total);
      for (let index = 0; index < facts.length; ++index) {
        const fact = facts[index],
          mint = mints[index];
        if (seen.has(fact.tokenId.toString()))
          throw new Error("Repeated historical card mint.");
        seen.add(fact.tokenId.toString());
        const provenance = await client.readContract({
          address: config.cards,
          abi: portalCardAbi,
          functionName: "provenance",
          args: [fact.tokenId]
        });
        const traits = provenance[3];
        if (
          provenance[0] !== config.packTypeId ||
          provenance[1] !== originalId ||
          provenance[2] !== mint.variantId ||
          provenance[4] !== mint.original ||
          traits.monsterType !== mint.monsterType ||
          traits.color !== mint.color ||
          traits.horn !== mint.horn ||
          traits.glitter !== mint.glitter
        )
          throw new Error(
            "Canonical mint differs from onchain card provenance."
          );
        yield fact;
      }
    }
    const cardLogs = await client.getContractEvents({
      address: config.cards,
      abi: yunipalMonstersAbi,
      eventName: "MonsterMinted",
      fromBlock: from,
      toBlock: to
    });
    for (const log of cardLogs) {
      if (
        log.args.packTypeId === config.packTypeId &&
        (log.args.tokenId === undefined ||
          !seen.has(log.args.tokenId.toString()))
      )
        throw new Error(
          "Card mint has no matching canonical engine completion; historical import is incomplete."
        );
    }
  }
}
