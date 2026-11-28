import { ArrowRight, Check, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { getAddress, type Address } from "viem";

import type { CatalogMarket } from "@/lib/marketplace/catalog";
import { OpenSeaAttribution } from "@/components/marketplace/OpenSeaAttribution";
import {
  formatMarketAmount,
  formatMarketCardAmount
} from "@/lib/marketplace/format";
import type { MarketOrder } from "@/lib/marketplace/marketApi";
import { cn } from "@/lib/utils";

const TAG =
  "flex min-h-7 min-w-0 items-center gap-1 rounded-l-full bg-ink pl-2.5 pr-2 text-xs font-extrabold tabular-nums text-white";
const ACTION =
  "min-w-0 flex-1 rounded-l-full py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge";

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
  if (market.status === "unlisted") return null;
  if (market.status !== "listed" || market.listings.length === 0) {
    const Icon =
      market.status === "purchased"
        ? Check
        : market.status === "updating"
          ? Loader2
          : null;
    return (
      <p className="flex items-center gap-1.5" role="status">
        {Icon && (
          <Icon
            size={12}
            aria-hidden="true"
            className={cn(
              "shrink-0",
              market.status === "updating" && "motion-safe:animate-spin"
            )}
          />
        )}
        <span
          className="truncate"
          title={market.status === "updating" ? "Updating listing…" : undefined}
        >
          {market.status === "purchased"
            ? "Purchased"
            : market.status === "updating"
              ? "Updating listing…"
              : "Prices temporarily unavailable"}
        </span>
      </p>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1 bg-transparent">
      {market.listings.map((order) => {
        const own = account && getAddress(account) === getAddress(order.maker);
        const exactPrice = formatMarketAmount(order.grossAmount, order);
        const price = (
          <span className="block truncate" title={`Exact price: ${exactPrice}`}>
            {formatMarketCardAmount(order.grossAmount, order)}
          </span>
        );
        return (
          <div key={order.orderHash} className={cn(TAG, "max-w-full")}>
            {canBuy && !own ? (
              <button
                type="button"
                aria-label="Buy"
                title={`Buy for ${exactPrice}`}
                onClick={(event) => onBuy(order, event.currentTarget)}
                className={cn(
                  ACTION,
                  "flex items-center gap-1.5 hover:text-lavender"
                )}
              >
                {price}
                <span className="flex shrink-0 items-center gap-1 border-l border-white/25 pl-1.5">
                  <span className="[@container_(max-width:249px)]:sr-only">
                    Buy
                  </span>
                  <ArrowRight aria-hidden="true" size={12} />
                </span>
              </button>
            ) : (
              <Link
                aria-label={own ? "Manage listing" : "View listing"}
                title={`${own ? "Your listing" : "View listing"}: ${exactPrice}`}
                className={cn(ACTION, "hover:text-lavender")}
                to={
                  own
                    ? `/orders?chain=${order.asset.chain}`
                    : `/collection/${order.asset.chain}/${order.asset.tokenId}`
                }
              >
                {price}
              </Link>
            )}
            <OpenSeaAttribution order={order} compact />
          </div>
        );
      })}
    </div>
  );
}
