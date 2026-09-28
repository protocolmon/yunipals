import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { collections, ZERO_ADDRESS, type CollectionSlug } from "../lib/constants.js";

const eventId = (collection: CollectionSlug, transactionHash: string, logIndex: number) =>
  `${collection}:${transactionHash}:${logIndex}`;

function registerCollection(contract: "YunipalsEthereum" | "YunipalsBase" | "YunipalsPolygon", collection: CollectionSlug) {
  const definition = collections[collection];

  ponder.on(`${contract}:Transfer`, async ({ event, context }) => {
    const transactionHash = event.transaction.hash;
    const transactionIndex = event.transaction.transactionIndex;
    const tokenId = event.args.tokenId.toString();
    const from = event.args.from.toLowerCase() as `0x${string}`;
    const to = event.args.to.toLowerCase() as `0x${string}`;
    const existing = await context.db.find(schema.token, { collection, tokenId });
    const isMint = from === ZERO_ADDRESS;
    const isBurn = to === ZERO_ADDRESS;
    const lifecycle = isMint ? (existing?.lifecycle ?? 0) + 1 : existing?.lifecycle;

    if (!lifecycle) throw new Error(`Transfer before mint for ${collection} token ${tokenId}`);

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
      owner: to,
      burned: isBurn,
      lifecycle,
      mintBlock: isMint ? event.block.number : existing!.mintBlock,
      mintTimestamp: isMint ? event.block.timestamp : existing!.mintTimestamp,
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

registerCollection("YunipalsEthereum", "ethereum");
registerCollection("YunipalsBase", "base");
registerCollection("YunipalsPolygon", "polygon");
