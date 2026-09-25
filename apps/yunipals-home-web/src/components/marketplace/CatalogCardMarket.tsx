import { Link } from "react-router-dom";
import { getAddress, type Address } from "viem";

import type { CatalogMarket } from "@/lib/marketplace/catalog";
import { OpenSeaAttribution } from "@/components/marketplace/OpenSeaAttribution";
import {
  formatMarketAmount,
  formatMarketCardAmount
} from "@/lib/marketplace/format";
import type { MarketOrder } from "@/lib/marketplace/marketApi";

export function CatalogCardMarket({
  market,
  account,
  canBuy,
  onBuy
}: {
  market: CatalogMarket;
  account?: Address;
  canBuy: boolean;
  onBuy: (order: MarketOrder, trigger: HTMLElement) => void;
}) {
  if (market.status !== "listed")
    return (
      <p className="text-xs font-semibold text-muted">
        {market.status === "purchased"
          ? "Purchased"
          : market.status === "unlisted"
            ? "Not listed"
            : market.status === "updating"
              ? "Updating listing…"
              : "Prices temporarily unavailable"}
      </p>
    );
  return (
    <div className="space-y-3">
      {market.listings.map((order) => {
        const own = account && getAddress(account) === getAddress(order.maker);
        return (
          <div key={order.currency.address}>
            <div className="flex min-h-8 items-center justify-between gap-2">
              <p
                className="min-w-0 break-words text-sm font-extrabold"
                title={`Exact price: ${formatMarketAmount(order.grossAmount, order)}`}
              >
                {formatMarketCardAmount(order.grossAmount, order)}
              </p>
              <OpenSeaAttribution order={order} />
            </div>
            {canBuy && !own ? (
              <button
                type="button"
                onClick={(event) => onBuy(order, event.currentTarget)}
                className="mt-2 w-full rounded-full bg-ink px-3 py-2 text-xs font-bold text-white focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                Buy
              </button>
            ) : (
              <Link
                className="mt-2 inline-block rounded-full text-xs font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
                to={
                  own
                    ? `/orders?chain=${order.asset.chain}`
                    : `/collection/${order.asset.chain}/${order.asset.tokenId}`
                }
              >
                {own ? "Manage listing" : "View listing"}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
