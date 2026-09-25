import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getAddress } from "viem";

import { chainDetails } from "@/data/chains";
import { useMarketActivity } from "@/hooks/marketplace/useMarketActivity";
import { shortAddress } from "@/lib/format";
import {
  activityScopeKey,
  type ActivityScope
} from "@/lib/marketplace/activity";
import { formatMarketAmount } from "@/lib/marketplace/format";
import type { MarketplaceChain } from "@/lib/marketplace/registry";
import { cn } from "@/lib/utils";

const button =
  "rounded-full border border-line bg-white px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50";

export function MarketActivity({ scope }: { scope: ActivityScope }) {
  let key: string;
  try {
    key = activityScopeKey(scope);
  } catch {
    return (
      <p role="alert" className="mt-8 text-sm text-muted">
        Sale history is unavailable because the NFT or wallet identity could
        not be verified.
      </p>
    );
  }
  return <ActivityForScope key={key} scope={scope} />;
}

function ActivityForScope({ scope }: { scope: ActivityScope }) {
  const { configured, queryKey, query, invalidated } = useMarketActivity(scope);
  const queries = useQueryClient();
  const first = invalidated ? undefined : query.data?.pages[0];
  const items = invalidated
    ? []
    : (query.data?.pages.flatMap((page) => page.items) ?? []);
  const affected = Object.entries(first?.chains ?? {}).filter(
    ([, checkpoint]) => checkpoint.status !== "available"
  );
  const refresh = () => {
    void queries.resetQueries({ queryKey, exact: true });
  };
  return (
    <section aria-label="Sale history" className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="display text-2xl text-ink">Confirmed sales</h2>
        {configured && (
          <button
            type="button"
            className={button}
            onClick={refresh}
            disabled={query.isFetching}
          >
            Refresh activity
          </button>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        {scope.kind === "asset"
          ? "Recorded sales for this token ID, including earlier lifecycles. "
          : "Confirmed sales involving this wallet. Received NFTs may include gifts. "}
        Sale prices exclude gas.
      </p>
      {!configured ? (
        <p className="mt-5 text-sm text-muted">
          Sale history is not available yet.
        </p>
      ) : query.isLoading ? (
        <div className="mt-5 space-y-3" aria-label="Loading sale history">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-card bg-line" />
          ))}
        </div>
      ) : (
        <>
          {first && (
            <p className="mt-4 text-xs text-muted">
              Recorded{" "}
              <time dateTime={first.snapshot.observedAt}>
                {new Date(first.snapshot.observedAt).toLocaleString()}
              </time>
              {first.total !== null
                ? ` · ${first.total} ${first.total === 1 ? "sale" : "sales"} in this view`
                : " · Partial history"}
              . Refresh for newer sales.
            </p>
          )}
          {affected.length > 0 && (
            <p
              role="status"
              className="mt-4 rounded-2xl border border-line p-4 text-sm"
            >
              Some activity may be missing:{" "}
              {affected
                .map(
                  ([chain, checkpoint]) =>
                    `${chainDetails[chain as MarketplaceChain].label} (${checkpoint.status === "syncing" ? "syncing" : "unavailable"})`
                )
                .join(", ")}
              . Previously confirmed records may still be shown.
            </p>
          )}
          {first &&
            Object.entries(first.chains).some(
              ([, chain]) => chain.coverage
            ) && (
              <ul
                className="mt-3 space-y-1 text-xs text-muted"
                aria-label="Sale history coverage"
              >
                {Object.entries(first.chains).map(
                  ([chain, checkpoint]) =>
                    checkpoint.coverage && (
                      <li key={chain}>
                        {chainDetails[chain as MarketplaceChain].label}:{" "}
                        {checkpoint.coverage.source === "seaport"
                          ? "Seaport settlements"
                          : "Orders recorded by Yunipals"}
                        {" since "}
                        {new Date(
                          Number(checkpoint.coverage.fromTimestamp) * 1000
                        ).toLocaleString()}
                        .
                        {checkpoint.coverage.excludedEvents > 0 &&
                          ` ${checkpoint.coverage.excludedEvents} events could not be classified as individual sales.`}
                      </li>
                    )
                )}
              </ul>
            )}
          {query.isError && (
            <div
              role="alert"
              className="mt-4 rounded-2xl border border-line p-4 text-sm"
            >
              <p>
                {invalidated
                  ? "This activity view changed or could not be verified. Refresh before viewing these sales."
                  : items.length
                    ? "More activity could not be loaded. Previously recorded sales are still shown."
                    : "Sale history could not be loaded. Transfer history does not establish a sale price."}
              </p>
              <button
                type="button"
                className={cn(button, "mt-3")}
                onClick={refresh}
                disabled={query.isFetching}
              >
                Retry activity
              </button>
            </div>
          )}
          {!query.isError && first && !items.length && (
            <p className="mt-5 text-sm text-muted">
              {affected.length
                ? "No confirmed records are available while activity is recovering."
                : "No confirmed sales in this view."}
            </p>
          )}
          {items.length > 0 && (
            <ul className="mt-5 space-y-4" aria-label="Confirmed sale records">
              {items.map(({ sale, currentVisibility }) => {
                const chain = chainDetails[sale.asset.chain];
                const sold =
                  scope.kind === "wallet" &&
                  getAddress(scope.wallet) === sale.seller;
                const received =
                  scope.kind === "wallet" &&
                  getAddress(scope.wallet) === sale.nftRecipient;
                const label =
                  sold && received
                    ? "Sold to yourself"
                    : sold
                      ? "Sold"
                      : received
                        ? "Received from sale"
                        : sale.kind === "offer-accepted"
                          ? "Offer accepted"
                          : "Sale";
                const date = new Date(Number(sale.blockTimestamp) * 1000);
                return (
                  <li
                    key={sale.eventId}
                    className="rounded-card border border-line bg-white p-5 shadow-card"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-muted">
                          {chain.label} · Seaport
                        </p>
                        <p className="mt-1 break-words font-extrabold">
                          {label} · Token #{sale.asset.tokenId}
                        </p>
                        <p className="mt-2 break-all text-lg font-black">
                          {formatMarketAmount(sale.grossAmount, sale)}
                        </p>
                      </div>
                      <span className="rounded-full bg-line/60 px-3 py-1 text-xs font-bold">
                        Confirmed
                      </span>
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      <time dateTime={date.toISOString()}>
                        {date.toLocaleString()}
                      </time>
                    </p>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-xs font-bold text-muted">Seller</dt>
                        <dd className="mt-1">
                          <Link
                            to={`/collector/${sale.seller}`}
                            title={sale.seller}
                            className="font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ink"
                          >
                            {shortAddress(sale.seller)}
                          </Link>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-bold text-muted">
                          NFT recipient
                        </dt>
                        <dd className="mt-1">
                          <Link
                            to={`/collector/${sale.nftRecipient}`}
                            title={sale.nftRecipient}
                            className="font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ink"
                          >
                            {shortAddress(sale.nftRecipient)}
                          </Link>
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <a
                        href={`${chain.explorerUrl}/tx/${sale.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className={button}
                      >
                        View transaction
                      </a>
                      {scope.kind === "wallet" &&
                        currentVisibility === "public" && (
                          <Link
                            to={`/collection/${sale.asset.chain}/${sale.asset.tokenId}`}
                            className={button}
                          >
                            View Yunipal
                          </Link>
                        )}
                      {currentVisibility === "hidden" && (
                        <span className="self-center text-xs text-muted">
                          Hidden NFT
                        </span>
                      )}
                      {currentVisibility === "burned" && (
                        <span className="self-center text-xs text-muted">
                          Burned NFT
                        </span>
                      )}
                    </div>
                    <details className="mt-4 text-sm">
                      <summary className="cursor-pointer font-bold focus-visible:ring-2 focus-visible:ring-ink">
                        Payment details
                      </summary>
                      <p className="mt-2 break-all">
                        Seller proceeds:{" "}
                        {formatMarketAmount(sale.sellerProceeds, sale)}
                      </p>
                      {sale.fees.length > 0 ? (
                        <ul className="mt-2 space-y-1" aria-label="Sale fees">
                          {sale.fees.map((fee, index) => (
                            <li
                              key={`${fee.recipient}:${index}`}
                              className="break-all"
                            >
                              {formatMarketAmount(fee.amount, sale)} to{" "}
                              <span title={fee.recipient}>
                                {shortAddress(fee.recipient)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2">No separate fees.</p>
                      )}
                      {sale.fees.some(
                        (fee) => fee.recipient === sale.seller
                      ) && (
                        <p className="mt-2 text-xs text-muted">
                          Fees paid to the seller are shown separately above.
                        </p>
                      )}
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
          {!query.isError && query.hasNextPage && (
            <button
              type="button"
              className={cn(button, "mt-6")}
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage
                ? "Loading more activity…"
                : "Load more activity"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
