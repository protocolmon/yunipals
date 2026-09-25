import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useMemo, useRef, useState, useEffect } from "react";
import { getAddress, isAddress } from "viem";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";

import { chainDetails } from "@/data/chains";
import { OrderCreationDialog } from "@/components/marketplace/OrderCreationDialog";
import { OrderCancellationDialog } from "@/components/marketplace/OrderCancellationDialog";
import { TradeReviewDialog } from "@/components/marketplace/TradeReviewDialog";
import { useTradingConsent } from "@/components/marketplace/TradingConsentProvider";
import { useMarketplace } from "@/hooks/marketplace/useMarketplace";
import { shortAddress } from "@/lib/format";
import { formatMarketAmount as amount } from "@/lib/marketplace/format";
import {
  parseMarketAssetId,
  type MarketOrder
} from "@/lib/marketplace/marketApi";
import { cn } from "@/lib/utils";
import type { YunipalToken } from "@/lib/yunipalsIndexer";

const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2";

export function TokenMarketPanel({ token }: { token: YunipalToken }) {
  const panel = useRef<HTMLElement>(null);
  const asset = useMemo(() => {
    try {
      return parseMarketAssetId(token);
    } catch {
      return null;
    }
  }, [token.chain, token.chainId, token.contractAddress, token.tokenId]);
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { requestTradingConsent } = useTradingConsent();
  const { configured, capabilities, market } = useMarketplace(
    asset,
    token.lastTransferBlock
  );
  const [selected, setSelected] = useState<{
    order: MarketOrder;
    returnFocus: HTMLElement;
  } | null>(null);
  const [creating, setCreating] = useState<{
    side: "listing" | "offer";
    replacing?: MarketOrder;
    returnFocus: HTMLElement;
  } | null>(null);
  const [cancelling, setCancelling] = useState<{
    order: MarketOrder;
    returnFocus: HTMLElement;
  } | null>(null);
  useEffect(() => {
    setSelected(null);
    setCreating(null);
    setCancelling(null);
  }, [token.chain, token.contractAddress, token.tokenId, token.lifecycle]);
  if (!configured) return null;
  const flags = capabilities.data?.[token.chain];
  const data = market.data;
  const owns = Boolean(
    address &&
      isAddress(token.owner) &&
      getAddress(address) === getAddress(token.owner)
  );
  const valid = Boolean(
    data &&
      !data.hidden &&
      !data.burned &&
      !token.hidden &&
      !token.burned &&
      data.lifecycle === token.lifecycle &&
      data.availability.evidence === "current"
  );
  const actionable = valid;
  const orders = data
    ? [...data.listings, ...data.offers].filter(
        (order) =>
          order.status === "active" && order.lifecycle === token.lifecycle
      )
    : [];
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="mt-6 rounded-card border border-line bg-white p-5 shadow-card"
      aria-label="Listings and offers"
    >
      <h2 className="display text-xl text-ink">Listings and offers</h2>
      {asset &&
        address &&
        actionable &&
        (owns ? flags?.createListing : flags?.createOffer) &&
        !orders.some(
          (order) =>
            getAddress(order.maker) === getAddress(address) &&
            order.side === (owns ? "listing" : "offer")
        ) && (
          <button
            type="button"
            className={cn(buttonClass, "mt-4")}
            onClick={(event) => {
              const returnFocus = event.currentTarget;
              requestTradingConsent(() =>
                setCreating({
                  side: owns ? "listing" : "offer",
                  returnFocus
                })
              );
            }}
          >
            {owns ? "List for sale" : "Make an offer"}
          </button>
        )}
      {capabilities.isLoading || market.isLoading ? (
        <div
          className="mt-4 h-20 animate-pulse rounded-2xl bg-line"
          aria-label="Loading listings and offers"
        />
      ) : capabilities.isError || market.isError || !asset ? (
        <div className="mt-3 text-sm text-muted">
          <p>Listings and offers are temporarily unavailable.</p>
          <button
            className="mt-2 rounded-full px-3 py-1 font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
            onClick={() => {
              void capabilities.refetch();
              void market.refetch();
            }}
          >
            Retry
          </button>
        </div>
      ) : !flags?.read ? (
        <p className="mt-3 text-sm text-muted">
          Buying and selling are not available on this chain yet.
        </p>
      ) : !valid ? (
        <div className="mt-3 text-sm text-muted">
          <p>
            Current ownership and market availability need to be checked before
            continuing.
          </p>
          <button
            type="button"
            disabled={capabilities.isFetching || market.isFetching}
            className="mt-2 rounded-full px-3 py-1 font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum disabled:opacity-50"
            onClick={() => {
              void capabilities.refetch();
              void market.refetch();
            }}
          >
            Refresh listings and offers
          </button>
        </div>
      ) : orders.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          {data!.listingState === "updating" ||
          data!.offerAvailability === "partial"
            ? "Listings or offers are updating."
            : data!.listingState === "unavailable" ||
                data!.offerAvailability === "unavailable"
              ? "Prices are temporarily unavailable."
              : "No active listings or offers."}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {orders.map((order) => {
            const ownOrder = Boolean(
              address && getAddress(address) === getAddress(order.maker)
            );
            const canTrade =
              Boolean(address) &&
              actionable &&
              !ownOrder &&
              (order.side === "listing"
                ? flags.buy && !owns
                : flags.acceptOffer && owns);
            return (
              <div
                key={`${order.source}:${order.orderHash}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line p-4"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">
                    {order.side === "listing" ? "Listing" : "Offer"} ·{" "}
                    {order.source === "opensea" ? "OpenSea" : "Yunipals"}
                  </p>
                  <p className="mt-1 break-all font-extrabold text-ink">
                    {amount(order.grossAmount, order)}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {ownOrder ? "Your order" : shortAddress(order.maker)}
                  </p>
                </div>
                {canTrade ? (
                  <button
                    type="button"
                    className={cn(buttonClass, "px-4 py-2")}
                    onClick={(event) => {
                      const returnFocus = event.currentTarget;
                      requestTradingConsent(() =>
                        setSelected({ order, returnFocus })
                      );
                    }}
                  >
                    {order.side === "listing" ? "Buy" : "Accept offer"}
                  </button>
                ) : !address &&
                  actionable &&
                  flags.buy &&
                  order.side === "listing" ? (
                  <button
                    type="button"
                    className={cn(buttonClass, "px-4 py-2")}
                    onClick={openConnectModal}
                  >
                    Connect to buy
                  </button>
                ) : null}
                {ownOrder && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink"
                      onClick={(event) =>
                        setCancelling({
                          order,
                          returnFocus: event.currentTarget
                        })
                      }
                    >
                      Cancel {order.side}
                    </button>
                    {actionable &&
                      (order.side === "listing"
                        ? flags.createListing && owns
                        : flags.createOffer && !owns) && (
                        <button
                          type="button"
                          className="rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink"
                          onClick={(event) => {
                            const returnFocus = event.currentTarget;
                            requestTradingConsent(() =>
                              setCreating({
                                side: order.side,
                                replacing: order,
                                returnFocus
                              })
                            );
                          }}
                        >
                          Change price
                        </button>
                      )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {address && (
        <Link
          to="/orders"
          className="mr-5 mt-4 inline-block rounded-full text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          My orders
        </Link>
      )}
      {address && (
        <Link
          to="/orders/recovery"
          className="mt-4 inline-block rounded-full text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          Review saved orders and cancellations
        </Link>
      )}
      {selected && (
        <TradeReviewDialog
          key={selected.order.orderHash}
          order={selected.order}
          returnFocus={selected.returnFocus}
          fallbackFocus={panel}
          name={token.name || "Yunipal"}
          onClose={() => setSelected(null)}
        />
      )}
      {creating && asset && (
        <OrderCreationDialog
          key={`${asset.chainId}:${asset.contractAddress}:${asset.tokenId}:${creating.side}:${creating.replacing?.orderHash ?? "new"}`}
          asset={asset}
          lifecycle={token.lifecycle}
          side={creating.side}
          replacing={creating.replacing}
          name={token.name || "Yunipal"}
          returnFocus={creating.returnFocus}
          fallbackFocus={panel}
          onClose={() => setCreating(null)}
        />
      )}
      {cancelling && (
        <OrderCancellationDialog
          key={cancelling.order.orderHash}
          order={cancelling.order}
          returnFocus={cancelling.returnFocus}
          fallbackFocus={panel}
          onClose={() => setCancelling(null)}
        />
      )}
    </section>
  );
}
