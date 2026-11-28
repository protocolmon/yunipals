import { cn } from "@/lib/utils";

import type { MarketOrder } from "@/lib/marketplace/marketApi";

export function OpenSeaAttribution({
  order,
  compact = false
}: {
  order: Pick<MarketOrder, "source" | "asset">;
  compact?: boolean;
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
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2",
        compact ? "h-6 w-5" : "h-8 w-8"
      )}
    >
      <img
        src="/images/opensea/logomark-blue.svg"
        alt=""
        width={20}
        height={20}
        className={cn(
          compact ? "h-3.5 w-3.5 rounded-full bg-white" : "h-5 w-5"
        )}
      />
    </a>
  );
}
