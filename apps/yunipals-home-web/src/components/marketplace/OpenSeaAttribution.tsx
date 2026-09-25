import type { MarketOrder } from "@/lib/marketplace/marketApi";

export function OpenSeaAttribution({
  order
}: {
  order: Pick<MarketOrder, "source" | "asset">;
}) {
  if (order.source !== "opensea") return null;
  const { chain, contractAddress, tokenId } = order.asset;
  return (
    <a
      href={`https://opensea.io/assets/${chain}/${contractAddress}/${tokenId}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View listing for #${tokenId} on OpenSea (opens in a new tab)`}
      title="Listing from OpenSea · opens in a new tab"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2"
    >
      <img
        src="/images/opensea/logomark-blue.svg"
        alt=""
        width={20}
        height={20}
        className="h-5 w-5"
      />
    </a>
  );
}
