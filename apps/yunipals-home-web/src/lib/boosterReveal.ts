import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";

// A batch is defined by the request, never by adjacent NFT token IDs or owner.
export function confirmedBoosterPulls(
  items: BoosterMonster[],
  request: {
    engine: string;
    collection: string;
    requestId: string;
    originalId: string;
    quantity: number;
    opening: boolean;
  }
) {
  const { engine, collection, requestId, originalId, quantity, opening } =
    request;
  const requestKey = `8453:${engine.toLowerCase()}:${requestId}`;
  const originalKey = `8453:${collection.toLowerCase()}:${originalId}`;
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 7 ||
    (opening && quantity !== 1) ||
    items.length !== quantity ||
    new Set(items.map((item) => item.tokenId)).size !== quantity ||
    items.some(
      (item) =>
        !/^(0|[1-9][0-9]{0,77})$/.test(item.tokenId) ||
        item.collection.toLowerCase() !== collection.toLowerCase() ||
        item.requestKey.toLowerCase() !== requestKey ||
        item.originalKey.toLowerCase() !== originalKey ||
        item.isOriginal !== opening ||
        (opening && item.tokenId !== originalId)
    )
  )
    throw new Error(
      "Your pack’s revealed cards are still being indexed. Try again shortly."
    );
  return items.map(({ collection, tokenId, metadataUri }) => ({
    collection,
    tokenId,
    metadataUri
  }));
}
