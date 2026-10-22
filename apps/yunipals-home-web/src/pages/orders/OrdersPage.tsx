import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { useAnalyticsConnectModal } from "@/hooks/useAnalyticsConnectModal";
import { OrderCreationDialog } from "@/components/marketplace/OrderCreationDialog";
import { TradeReviewDialog } from "@/components/marketplace/TradeReviewDialog";
import { OrderCancellationDialog } from "@/components/marketplace/OrderCancellationDialog";
import { useTradingConsent } from "@/components/marketplace/TradingConsentProvider";
import { chainDetails } from "@/data/chains";
import { useMarketplace } from "@/hooks/marketplace/useMarketplace";
import { useWalletOrders } from "@/hooks/marketplace/useWalletOrders";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { shortAddress } from "@/lib/format";
import { formatMarketAmount } from "@/lib/marketplace/format";
import {
  marketOrderKey,
  walletOrderViews,
  type MarketOrder,
  type WalletOrderItem,
  type WalletOrderView
} from "@/lib/marketplace/marketApi";
import {
  marketplaceChains,
  type MarketplaceChain
} from "@/lib/marketplace/registry";
import { cn } from "@/lib/utils";

const button =
  "rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50";
const views: Record<WalletOrderView, string> = {
  listings: "Listings",
  "offers-made": "Offers made",
  "offers-received": "Offers received",
  history: "Past orders"
};
const statuses: Record<MarketOrder["status"], string> = {
  active: "Open",
  unavailable: "Unavailable",
  filled: "Filled",
  cancelled: "Cancelled",
  expired: "Expired",
  "counter-changed": "Counter changed"
};
type Selection = {
  kind: "cancel" | "reprice" | "accept";
  item: WalletOrderItem;
  trigger: HTMLElement;
};

function OrdersForWallet({ wallet }: { wallet: Address }) {
  const { requestTradingConsent } = useTradingConsent();
  const networkId = useId();
  const [params, setParams] = useSearchParams();
  const requestedView = params.get("view");
  const view: WalletOrderView =
    walletOrderViews.find((view) => view === requestedView) ?? "listings";
  const requestedChain = params.get("chain");
  const chain =
    (Object.keys(marketplaceChains) as MarketplaceChain[]).find(
      (chain) => chain === requestedChain
    ) ?? "all";
  const { configured, query, items } = useWalletOrders(wallet, view, chain);
  const { capabilities } = useMarketplace(null);
  const queries = useQueryClient();
  const [selected, setSelected] = useState<Selection | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => setSelected(null), [wallet, view, chain]);
  const first = query.data?.pages[0];
  const affectedSources = Object.entries(first?.sources ?? {}).filter(
    ([, status]) => status !== "available"
  );
  const partial = affectedSources.length > 0;
  const filters = (change: { view?: string; chain?: string }) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(change)) next.set(key, value);
    setSelected(null);
    setParams(next);
  };
  function refresh() {
    setSelected(null);
    void queries.resetQueries({
      queryKey: [
        "marketplace",
        "wallet-orders",
        getAddress(wallet),
        view,
        chain
      ],
      exact: true
    });
    void capabilities.refetch();
  }
  return (
    <section aria-label="Wallet orders">
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link to={`/collector/${wallet}`} className={button}>
          My collection
        </Link>
        <Link to="/orders/recovery" className={button}>
          Order recovery
        </Link>
        <Link to="/orders/activity" className={button}>
          Sale history
        </Link>
        {configured && (
          <button
            type="button"
            className={button}
            disabled={query.isFetching}
            onClick={refresh}
          >
            Refresh orders
          </button>
        )}
      </div>
      <p className="mt-5 text-sm leading-relaxed text-muted">
        Orders remain accessible after transfer, hiding or burning. Unavailable
        orders may fill again until cancelled.
      </p>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <nav aria-label="Order views" className="flex flex-wrap gap-2">
          {walletOrderViews.map((name) => (
            <button
              key={name}
              type="button"
              aria-current={view === name ? "page" : undefined}
              onClick={() => filters({ view: name })}
              className={cn(
                button,
                view === name && "border-ink bg-ink text-white"
              )}
            >
              {views[name]}
            </button>
          ))}
        </nav>
        <div className="flex flex-col gap-1 text-sm font-bold">
          <label htmlFor={networkId}>Network</label>
          <select
            id={networkId}
            value={chain}
            onChange={(event) => filters({ chain: event.target.value })}
            className="rounded-full border border-line bg-white px-4 py-2 focus-visible:ring-2 focus-visible:ring-ink"
          >
            <option value="all">All networks</option>
            {(Object.keys(marketplaceChains) as MarketplaceChain[]).map(
              (name) => (
                <option key={name} value={name}>
                  {chainDetails[name].label}
                </option>
              )
            )}
          </select>
        </div>
      </div>
      <h2
        ref={heading}
        tabIndex={-1}
        className="display mt-7 text-2xl text-ink"
      >
        {views[view]}
      </h2>
      {view === "history" && (
        <p className="mt-2 text-sm text-muted">
          Past orders you made, including filled, cancelled and expired orders.
        </p>
      )}
      {view === "offers-made" && (
        <p className="mt-2 text-sm text-muted">
          Offers do not reserve your balance. Spending or approving funds can
          change which offers can fill.
        </p>
      )}
      {!configured ? (
        <p className="mt-4 text-sm text-muted">
          Order history is not available yet. Your saved cancellation records
          remain in Order recovery.
        </p>
      ) : query.isLoading ? (
        <div className="mt-5 space-y-3" aria-label="Loading wallet orders">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-card bg-line" />
          ))}
        </div>
      ) : (
        <>
          {first && (
            <p className="mt-2 text-xs text-muted">
              Status recorded{" "}
              <time dateTime={first.snapshot.observedAt}>
                {new Date(first.snapshot.observedAt).toLocaleString()}
              </time>
              . Refresh for newer orders.
            </p>
          )}
          {partial && (
            <p
              className="mt-4 rounded-2xl border border-line p-4 text-sm"
              role="status"
            >
              Some orders may be missing or out of date:{" "}
              {affectedSources
                .map(
                  ([name, state]) =>
                    `${chainDetails[name as MarketplaceChain].label} (${state === "syncing" ? "syncing" : "unavailable"})`
                )
                .join(", ")}
              .
            </p>
          )}
          {query.isError && (
            <div
              className="mt-4 rounded-2xl border border-line p-4 text-sm"
              role="alert"
            >
              <p>
                {query.isFetchNextPageError
                  ? "More orders could not be loaded. Refresh to start a new history view."
                  : "Order history could not be updated. Saved cancellation records are still available in Order recovery."}
              </p>
              <button
                type="button"
                className={cn(button, "mt-3")}
                onClick={refresh}
              >
                Retry order history
              </button>
            </div>
          )}
          {!query.isError && first && items.length === 0 && (
            <p className="mt-5 text-sm text-muted">
              {partial
                ? "No orders are available to show while these sources are recovering."
                : "No orders in this view."}
            </p>
          )}
          {items.length > 0 && (
            <ul className="mt-5 space-y-4" aria-label={`${views[view]} orders`}>
              {items.map((item) => {
                const { order, currentAsset } = item;
                const own = getAddress(order.maker) === getAddress(wallet);
                const open =
                  order.status === "active" || order.status === "unavailable";
                const ownsNft =
                  getAddress(currentAsset.owner) === getAddress(wallet);
                const flags = capabilities.data?.[order.asset.chain];
                const validAsset =
                  !currentAsset.hidden &&
                  !currentAsset.burned &&
                  currentAsset.lifecycle === order.lifecycle;
                const actionable =
                  validAsset &&
                  first?.sources[order.asset.chain] === "available" &&
                  !query.isError &&
                  !capabilities.isError;
                const reprice =
                  own &&
                  open &&
                  actionable &&
                  (order.side === "listing"
                    ? ownsNft && flags?.createListing
                    : !ownsNft && flags?.createOffer);
                const accept =
                  !own &&
                  order.side === "offer" &&
                  order.status === "active" &&
                  actionable &&
                  ownsNft &&
                  flags?.acceptOffer;
                const expiry = new Date(Number(order.endTime) * 1000);
                return (
                  <li
                    key={marketOrderKey(order)}
                    className="rounded-card border border-line bg-white p-5 shadow-card"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-muted">
                          {chainDetails[order.asset.chain].label} ·{" "}
                          {order.source === "yunipals" ? "Yunipals" : "OpenSea"}
                        </p>
                        <p className="mt-1 font-extrabold">
                          {order.side === "listing" ? "Listing" : "Offer"} ·
                          Token #{order.asset.tokenId}
                        </p>
                        <p className="mt-2 break-all text-lg font-black">
                          {formatMarketAmount(order.grossAmount, order)}
                        </p>
                      </div>
                      <span className="rounded-full bg-line/60 px-3 py-1 text-xs font-bold">
                        {statuses[order.status]}
                      </span>
                    </div>
                    {!own && (
                      <p
                        className="mt-2 text-sm text-muted"
                        title={order.maker}
                      >
                        Offer from {shortAddress(order.maker)}
                      </p>
                    )}
                    <p className="mt-2 text-xs text-muted">
                      Expires{" "}
                      {Number.isFinite(expiry.getTime()) ? (
                        <time dateTime={expiry.toISOString()}>
                          {expiry.toLocaleString()}
                        </time>
                      ) : (
                        "in the far future"
                      )}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-muted">
                      {currentAsset.hidden && <span>Hidden NFT</span>}
                      {currentAsset.burned && <span>Burned NFT</span>}
                      {currentAsset.lifecycle !== order.lifecycle && (
                        <span>NFT lifecycle changed</span>
                      )}
                      {own && order.side === "listing" && !ownsNft && (
                        <span>No longer in your wallet</span>
                      )}
                    </div>
                    <p
                      className="mt-3 break-all font-mono text-xs text-muted"
                      aria-label="Order hash"
                    >
                      {order.orderHash}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!currentAsset.hidden && !currentAsset.burned && (
                        <Link
                          className={button}
                          to={`/collection/${order.asset.chain}/${order.asset.tokenId}`}
                        >
                          View Yunipal
                        </Link>
                      )}
                      {own && open && (
                        <button
                          type="button"
                          className={button}
                          onClick={(event) =>
                            setSelected({
                              kind: "cancel",
                              item,
                              trigger: event.currentTarget
                            })
                          }
                        >
                          Cancel {order.side}
                        </button>
                      )}
                      {reprice && (
                        <button
                          type="button"
                          className={button}
                          onClick={(event) => {
                            const trigger = event.currentTarget;
                            requestTradingConsent(() =>
                              setSelected({
                                kind: "reprice",
                                item,
                                trigger
                              })
                            );
                          }}
                        >
                          Change price
                        </button>
                      )}
                      {accept && (
                        <button
                          type="button"
                          className={button}
                          onClick={(event) => {
                            const trigger = event.currentTarget;
                            requestTradingConsent(() =>
                              setSelected({
                                kind: "accept",
                                item,
                                trigger
                              })
                            );
                          }}
                        >
                          Accept offer
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {query.hasNextPage && !query.isFetchNextPageError && (
            <button
              type="button"
              className={cn(button, "mt-6")}
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? "Loading more orders…"
                : "Load more orders"}
            </button>
          )}
        </>
      )}
      {selected?.kind === "cancel" && (
        <OrderCancellationDialog
          order={selected.item.order}
          returnFocus={selected.trigger}
          fallbackFocus={heading}
          onClose={() => setSelected(null)}
        />
      )}
      {selected?.kind === "reprice" && (
        <OrderCreationDialog
          asset={selected.item.order.asset}
          lifecycle={selected.item.currentAsset.lifecycle}
          side={selected.item.order.side}
          replacing={selected.item.order}
          name="Yunipal"
          returnFocus={selected.trigger}
          fallbackFocus={heading}
          onClose={() => setSelected(null)}
        />
      )}
      {selected?.kind === "accept" && (
        <TradeReviewDialog
          order={selected.item.order}
          name="Yunipal"
          returnFocus={selected.trigger}
          fallbackFocus={heading}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

export function OrdersPage() {
  const { address } = useAccount();
  const { openConnectModal } = useAnalyticsConnectModal("orders");
  usePageMetadata(
    "My orders | Yunipals",
    "Manage Yunipals listings, offers and past orders across networks."
  );
  return (
    <main className="mx-auto min-h-[65vh] max-w-5xl px-5 py-12 sm:px-8">
      <Link to="/" className="text-sm font-bold text-ethereum">
        Back to collection
      </Link>
      <h1 className="display mt-6 text-4xl text-ink">My orders</h1>
      {address ? (
        <>
          <p
            className="mt-3 break-all font-mono text-sm text-muted"
            title={address}
          >
            <span className="sm:hidden">{shortAddress(address)}</span>
            <span className="hidden sm:inline">{address}</span>
          </p>
          <OrdersForWallet key={getAddress(address)} wallet={address} />
        </>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted">
            Connect your wallet to review your listings and offers.
          </p>
          <button
            type="button"
            className={cn(button, "mt-5")}
            onClick={openConnectModal}
          >
            Connect wallet
          </button>
          <Link
            to="/orders/recovery"
            className="ml-4 text-sm font-bold text-ethereum"
          >
            Order recovery
          </Link>
        </>
      )}
    </main>
  );
}
