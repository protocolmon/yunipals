import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import {
  indexedCollections,
  islandCollection,
  baseIslandCollection,
  ZERO_ADDRESS,
  type CollectionId,
  type CollectionSlug
} from "../lib/constants.js";
import {
  transferEventId as eventId,
  transferState
} from "../lib/ownership/transfer.js";
import {
  recordCanonicalEvent,
  seedChainSources
} from "../lib/unified/handlers.js";

type MonsterContract =
  | "YunipalsEthereum"
  | "YunipalsBase"
  | "YunipalsPolygon"
  | "YunipalsBnb";

function registerTransfers(
  contract: MonsterContract | "YunipalsIslands" | "YunipalsBaseIslandsV2",
  collection: CollectionId
) {
  const definition = indexedCollections[collection];

  ponder.on(`${contract}:Transfer`, async ({ event, context }) => {
    if (process.env.PONDER_ISLANDS_ONLY !== "true") {
      await recordCanonicalEvent(
        collection === "ethereum-islands"
          ? "islands:ethereum"
          : collection === "base-islands-v2"
            ? "islands:base:v2"
            : `ownership:${collection}`,
        "Transfer",
        event,
        context
      );
    }
    const transactionHash = event.transaction.hash;
    const transactionIndex = event.transaction.transactionIndex;
    const tokenId = event.args.tokenId.toString();
    const from = event.args.from.toLowerCase() as `0x${string}`;
    const to = event.args.to.toLowerCase() as `0x${string}`;
    const existing = await context.db.find(schema.token, {
      collection,
      tokenId
    });
    if (collection === "base-islands-v2") {
      if (
        from !== ZERO_ADDRESS &&
        (!existing || existing.burned || existing.owner !== from)
      )
        throw new Error("Base Islands transfer owner mismatch.");
      if (from === ZERO_ADDRESS && existing && !existing.burned)
        throw new Error("Base Islands duplicate mint.");
    }
    const state = transferState(existing, from, to, event.block);
    const { isMint, isBurn, lifecycle } = state;

    if (isMint) {
      await context.db.insert(schema.tokenLifecycle).values({
        collection,
        tokenId,
        lifecycle,
        mintedTo: to,
        mintBlock: event.block.number,
        mintTimestamp: event.block.timestamp,
        mintTransactionHash: transactionHash
      });
    }

    if (isBurn) {
      await context.db
        .update(schema.tokenLifecycle, { collection, tokenId, lifecycle })
        .set({
          burnedAtBlock: event.block.number,
          burnedAtTimestamp: event.block.timestamp,
          burnTransactionHash: transactionHash
        });
    }

    const values = {
      chainId: definition.chainId,
      contractAddress: definition.address,
      owner: state.owner,
      burned: state.burned,
      lifecycle,
      mintBlock: state.mintBlock,
      mintTimestamp: state.mintTimestamp,
      lastTransferBlock: event.block.number,
      lastTransferTimestamp: event.block.timestamp,
      lastTransactionHash: transactionHash
    };

    await context.db
      .insert(schema.token)
      .values({ collection, tokenId, ...values })
      .onConflictDoUpdate(values);
    await context.db.insert(schema.transferEvent).values({
      id: eventId(collection, transactionHash, event.log.logIndex),
      collection,
      chainId: definition.chainId,
      contractAddress: definition.address,
      tokenId,
      lifecycle,
      from,
      to,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash,
      transactionIndex,
      logIndex: event.log.logIndex
    });
  });
}

function registerCollection(
  contract: MonsterContract,
  collection: CollectionSlug
) {
  registerTransfers(contract, collection);
  ponder.on(`${contract}:setup`, async ({ context }) =>
    seedChainSources(context)
  );
  const definition = indexedCollections[collection];
  for (const [name, granted] of [
    ["RoleGranted", true],
    ["RoleRevoked", false]
  ] as const) {
    ponder.on(`${contract}:${name}`, async ({ event, context }) => {
      await recordCanonicalEvent(
        `ownership:${collection}`,
        name,
        event,
        context
      );
      const transactionHash = event.transaction.hash;
      await context.db.insert(schema.adminRoleEvent).values({
        id: eventId(collection, transactionHash, event.log.logIndex),
        collection,
        chainId: definition.chainId,
        contractAddress: definition.address,
        role: event.args.role,
        account: event.args.account.toLowerCase() as `0x${string}`,
        sender: event.args.sender.toLowerCase() as `0x${string}`,
        granted,
        blockNumber: event.block.number,
        transactionHash,
        logIndex: event.log.logIndex
      });
    });
  }
}

if (
  process.env.PONDER_ISLANDS_ONLY !== "true" &&
  process.env.PONDER_BOOSTERS_ONLY !== "true"
) {
  registerCollection("YunipalsEthereum", "ethereum");
  registerCollection("YunipalsBase", "base");
  registerCollection("YunipalsPolygon", "polygon");
  registerCollection("YunipalsBnb", "bnb");
}
if (process.env.PONDER_BOOSTERS_ONLY !== "true") {
  registerTransfers("YunipalsIslands", islandCollection.slug);

  ponder.on(
    "YunipalsIslands:OwnershipTransferred",
    async ({ event, context }) => {
      if (process.env.PONDER_ISLANDS_ONLY !== "true") {
        await recordCanonicalEvent(
          "islands:ethereum",
          "OwnershipTransferred",
          event,
          context
        );
      }
      await context.db.insert(schema.contractOwnerEvent).values({
        id: eventId(
          islandCollection.slug,
          event.transaction.hash,
          event.log.logIndex
        ),
        collection: islandCollection.slug,
        chainId: islandCollection.chainId,
        contractAddress: islandCollection.address,
        previousOwner: event.args.previousOwner.toLowerCase() as `0x${string}`,
        newOwner: event.args.newOwner.toLowerCase() as `0x${string}`,
        blockNumber: event.block.number,
        transactionHash: event.transaction.hash,
        logIndex: event.log.logIndex
      });
    }
  );
}

if (
  process.env.PONDER_ISLANDS_ONLY !== "true" &&
  process.env.PONDER_BOOSTERS_ONLY !== "true"
) {
  registerTransfers("YunipalsBaseIslandsV2", baseIslandCollection.slug);
  ponder.on(
    "YunipalsBaseIslandsV2:OwnershipTransferred",
    async ({ event, context }) => {
      await recordCanonicalEvent(
        "islands:base:v2",
        "OwnershipTransferred",
        event,
        context
      );
      await context.db.insert(schema.contractOwnerEvent).values({
        id: eventId(
          baseIslandCollection.slug,
          event.transaction.hash,
          event.log.logIndex
        ),
        collection: baseIslandCollection.slug,
        chainId: baseIslandCollection.chainId,
        contractAddress: baseIslandCollection.address,
        previousOwner: event.args.previousOwner.toLowerCase() as `0x${string}`,
        newOwner: event.args.newOwner.toLowerCase() as `0x${string}`,
        blockNumber: event.block.number,
        transactionHash: event.transaction.hash,
        logIndex: event.log.logIndex
      });
    }
  );
  ponder.on(
    "YunipalsBaseIslandsV2:AirdropFinalized",
    async ({ event, context }) => {
      await recordCanonicalEvent(
        "islands:base:v2",
        "AirdropFinalized",
        event,
        context
      );
    }
  );
}
