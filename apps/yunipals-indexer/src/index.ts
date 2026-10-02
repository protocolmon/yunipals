import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { indexedCollections, islandCollection, type CollectionId, type CollectionSlug } from "../lib/constants.js";
import { transferEventId as eventId, transferState } from "../lib/ownership/transfer.js";

type MonsterContract = "YunipalsEthereum" | "YunipalsBase" | "YunipalsPolygon";

function registerTransfers(contract: MonsterContract | "YunipalsIslands", collection: CollectionId) {
  const definition = indexedCollections[collection];

  ponder.on(`${contract}:Transfer`, async ({ event, context }) => {
    const transactionHash = event.transaction.hash;
    const transactionIndex = event.transaction.transactionIndex;
    const tokenId = event.args.tokenId.toString();
    const from = event.args.from.toLowerCase() as `0x${string}`;
    const to = event.args.to.toLowerCase() as `0x${string}`;
    const existing = await context.db.find(schema.token, { collection, tokenId });
    const state = transferState(existing, from, to, event.block);
    const { isMint, isBurn, lifecycle } = state;

    if (isMint) {
      await context.db.insert(schema.tokenLifecycle).values({
        collection, tokenId, lifecycle, mintedTo: to, mintBlock: event.block.number,
        mintTimestamp: event.block.timestamp, mintTransactionHash: transactionHash
      });
    }

    if (isBurn) {
      await context.db.update(schema.tokenLifecycle, { collection, tokenId, lifecycle }).set({
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

    await context.db.insert(schema.token).values({ collection, tokenId, ...values }).onConflictDoUpdate(values);
    await context.db.insert(schema.transferEvent).values({
      id: eventId(collection, transactionHash, event.log.logIndex), collection,
      chainId: definition.chainId, contractAddress: definition.address, tokenId, lifecycle, from, to,
      blockNumber: event.block.number, blockTimestamp: event.block.timestamp, transactionHash,
      transactionIndex, logIndex: event.log.logIndex
    });
  });

}

function registerCollection(contract: MonsterContract, collection: CollectionSlug) {
  registerTransfers(contract, collection);
  const definition = indexedCollections[collection];
  for (const [name, granted] of [["RoleGranted", true], ["RoleRevoked", false]] as const) {
    ponder.on(`${contract}:${name}`, async ({ event, context }) => {
      const transactionHash = event.transaction.hash;
      await context.db.insert(schema.adminRoleEvent).values({
        id: eventId(collection, transactionHash, event.log.logIndex), collection,
        chainId: definition.chainId, contractAddress: definition.address,
        role: event.args.role, account: event.args.account.toLowerCase() as `0x${string}`,
        sender: event.args.sender.toLowerCase() as `0x${string}`, granted,
        blockNumber: event.block.number, transactionHash, logIndex: event.log.logIndex
      });
    });
  }
}

if (process.env.PONDER_ISLANDS_ONLY !== "true") {
  registerCollection("YunipalsEthereum", "ethereum");
  registerCollection("YunipalsBase", "base");
  registerCollection("YunipalsPolygon", "polygon");
}
registerTransfers("YunipalsIslands", islandCollection.slug);

ponder.on("YunipalsIslands:OwnershipTransferred", async ({ event, context }) => {
  await context.db.insert(schema.contractOwnerEvent).values({
    id: eventId(islandCollection.slug, event.transaction.hash, event.log.logIndex),
    collection: islandCollection.slug,
    chainId: islandCollection.chainId,
    contractAddress: islandCollection.address,
    previousOwner: event.args.previousOwner.toLowerCase() as `0x${string}`,
    newOwner: event.args.newOwner.toLowerCase() as `0x${string}`,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.log.logIndex
  });
});
