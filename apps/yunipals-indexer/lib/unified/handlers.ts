import type { Context } from "ponder:registry";
import schema from "ponder:schema";
import type { Address, Hex } from "viem";
import { buildSourceManifest, sourceManifestHash } from "./sources.js";

export type IndexedLog = {
  args: unknown;
  block: { number: bigint; hash: Hex; timestamp: bigint };
  transaction: { hash: Hex; transactionIndex: number };
  log: {
    address: Address;
    logIndex: number;
    topics: readonly Hex[];
    data: Hex;
  };
};

const isolated =
  process.env.PONDER_ISLANDS_ONLY === "true" ||
  process.env.PONDER_BOOSTERS_ONLY === "true";
export const sourceManifest = buildSourceManifest(isolated ? {} : process.env);
export const manifestHash = sourceManifestHash(sourceManifest) as Hex;

export async function seedChainSources(context: Context) {
  for (const definition of sourceManifest.sources.filter(
    (source) => source.chainId === context.chain.id
  )) {
    await context.db.insert(schema.indexerSource).values({
      id: definition.id,
      chainId: definition.chainId,
      manifestHash,
      definition: JSON.stringify(definition)
    });
  }
}

export async function recordCanonicalEvent(
  sourceId: string,
  name: string,
  event: IndexedLog,
  context: Context
) {
  const source = sourceManifest.sources.find(
    (source) => source.id === sourceId
  );
  if (
    !source?.enabled ||
    source.address !== event.log.address.toLowerCase() ||
    source.chainId !== context.chain.id ||
    source.startBlock === null ||
    event.block.number < BigInt(source.startBlock) ||
    !source.events.includes(name)
  ) {
    throw new Error("Indexed event does not match its configured source.");
  }
  const id = `${source.chainId}:${source.address}:${event.transaction.hash}:${event.log.logIndex}`;
  await context.db.insert(schema.canonicalEvent).values({
    id,
    sourceId,
    chainId: source.chainId,
    address: source.address as Address,
    name,
    args: JSON.stringify(event.args, (_, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value
    ),
    abiHash: source.abiHash as Hex,
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    timestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.log.logIndex,
    topics: JSON.stringify(event.log.topics),
    data: event.log.data
  });
  if (
    source.receiptRequirement === "full" &&
    event.block.number >=
      BigInt(source.receiptStartBlock ?? source.startBlock) &&
    (name === "Transfer" || source.feature === "marketplace")
  ) {
    await context.db
      .insert(schema.transactionCandidate)
      .values({
        id: `${source.chainId}:${event.block.hash}:${event.transaction.hash}`,
        chainId: source.chainId,
        blockNumber: event.block.number,
        blockHash: event.block.hash,
        transactionHash: event.transaction.hash
      })
      .onConflictDoNothing();
  }
  return id;
}
