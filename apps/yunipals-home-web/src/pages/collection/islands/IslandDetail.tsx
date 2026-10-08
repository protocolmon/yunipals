import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

import { QueryError } from "@/components/QueryState";
import { TokenArtwork } from "@/components/TokenArtwork";
import { ChainBadge } from "@/components/ui/ChainBadge";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { useCollectibleAnalytics } from "@/hooks/useCollectibleAnalytics";
import { formatInteger, shortAddress } from "@/lib/format";
import {
  fetchIsland,
  fetchIslandTransfers,
  islandOwnerHref,
  islandsCollectionHref,
  islandsCollectionId,
  normalizeIslandTokenId
} from "@/lib/islandsIndexer";
import { IndexerError } from "@/lib/yunipalsIndexer";
import { IslandUnstake } from "./IslandUnstake";

const zeroAddress = "0x0000000000000000000000000000000000000000";

function transferDate(timestamp: string) {
  return new Date(Number(timestamp) * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

export function IslandDetail({ tokenId }: { tokenId: string }) {
  const id = normalizeIslandTokenId(tokenId);
  const detail = useQuery({
    queryKey: [islandsCollectionId, "token", id],
    queryFn: ({ signal }) => fetchIsland(id!, signal),
    enabled: id !== null,
    retry: (count, error) =>
      !(error instanceof IndexerError && error.status === 404) && count < 2,
    staleTime: 30_000,
    refetchInterval: 15_000
  });
  const transfers = useInfiniteQuery({
    queryKey: [islandsCollectionId, "transfers", id],
    queryFn: ({ pageParam, signal }) =>
      fetchIslandTransfers(id!, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: id !== null,
    staleTime: 30_000
  });
  const token = detail.data?.token;
  useCollectibleAnalytics(Boolean(token), tokenId, "islands", "ethereum");
  const collector = token?.staking?.staker ?? token?.owner;
  const name =
    token?.metadata?.name || `${token?.edition || "Yunipals"} Island`;
  usePageMetadata(
    `${name} #${id || tokenId} — Yunipals`,
    "Explore this Ethereum island, its artwork, current owner, and transfer history."
  );

  return (
    <main className="min-h-[65vh] bg-gradient-to-b from-mint/25 to-white px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <Link
          to={islandsCollectionHref}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-line/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          <ArrowLeft aria-hidden="true" size={15} /> Back to islands
        </Link>
        {id === null ? (
          <div className="mt-6">
            <QueryError message="That island token ID is not valid." />
          </div>
        ) : detail.isLoading ? (
          <div
            className="mt-6 grid gap-8 lg:grid-cols-2"
            aria-label="Loading island"
          >
            <div className="aspect-square animate-pulse rounded-card bg-line/65" />
            <div className="space-y-4 py-6" aria-hidden="true">
              <div className="h-14 animate-pulse rounded bg-line" />
              <div className="h-28 animate-pulse rounded bg-line/65" />
            </div>
          </div>
        ) : detail.isError || !token ? (
          <div className="mt-6">
            <QueryError
              message={
                detail.error instanceof IndexerError &&
                detail.error.status === 404
                  ? "This island could not be found."
                  : "This island is temporarily unavailable."
              }
              onRetry={() => void detail.refetch()}
            />
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:items-start">
              <div className="overflow-hidden rounded-card border-8 border-white bg-white shadow-cardHover">
                <div className="aspect-square">
                  <TokenArtwork
                    src={token.metadata?.image || null}
                    alt={`${name} #${token.tokenId}`}
                    eager
                  />
                </div>
              </div>
              <div className="py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ChainBadge chainId="ethereum" variant="soft" />
                  <span className="rounded-full bg-mint/40 px-3 py-1.5 text-xs font-bold text-ink">
                    {token.edition}
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wide text-muted">
                    #{token.tokenId}
                  </span>
                  {token.burned && (
                    <span className="rounded-full bg-line px-3 py-1.5 text-xs font-bold text-muted">
                      Burned
                    </span>
                  )}
                  {token.staking?.status === "staked" && (
                    <span className="rounded-full bg-lavender/40 px-3 py-1.5 text-xs font-bold text-ink">
                      Staked
                    </span>
                  )}
                </div>
                <h1 className="display mt-3 text-4xl text-ink sm:text-6xl">
                  {name}
                </h1>
                {token.metadata?.description && (
                  <p className="mt-5 whitespace-pre-line text-base font-medium leading-relaxed text-ink/65">
                    {token.metadata.description}
                  </p>
                )}
                {!token.metadata && (
                  <p
                    role="status"
                    className="mt-5 text-sm font-semibold text-muted"
                  >
                    Artwork and description are currently unavailable. Ownership
                    and transfer history are shown below.
                  </p>
                )}
                <div className="mt-7 rounded-card border border-line bg-white p-5 shadow-card">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted">
                    {token.staking?.status === "unverified"
                      ? "Custody address"
                      : "Current collector"}
                  </p>
                  {token.owner && !token.burned ? (
                    <Link
                      to={islandOwnerHref(collector!)}
                      className="mt-2 flex items-center justify-between gap-4 rounded-xl bg-line/30 px-4 py-3 font-bold text-ink transition hover:bg-mint/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                    >
                      <span className="truncate sm:hidden">
                        {shortAddress(collector!)}
                      </span>
                      <span className="hidden truncate sm:block">
                        {collector}
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="shrink-0"
                        size={16}
                      />
                    </Link>
                  ) : (
                    <p className="mt-2 text-sm font-semibold text-muted">
                      This island has been burned and has no current owner.
                    </p>
                  )}
                </div>
                {token.staking?.status === "staked" && (
                  <p className="mt-3 text-sm text-muted">
                    Held in the legacy staking contract. The collector shown
                    above is the verified staking wallet.
                  </p>
                )}
                {token.staking?.status === "unverified" && (
                  <p role="status" className="mt-3 text-sm text-muted">
                    This island is held in the staking contract. Its staking
                    wallet has not been verified yet.
                  </p>
                )}
                <IslandUnstake key={token.tokenId} token={token} />
                <dl className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-line bg-white p-4">
                    <dt className="text-xs font-bold text-muted">Minted</dt>
                    <dd className="mt-2 text-sm font-extrabold text-ink">
                      {transferDate(token.mintTimestamp)}
                    </dd>
                  </div>
                  <div className="rounded-2xl border border-line bg-white p-4">
                    <dt className="text-xs font-bold text-muted">Mint block</dt>
                    <dd className="mt-2 text-sm font-extrabold text-ink">
                      {formatInteger(token.mintBlock)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    href={`https://opensea.io/assets/ethereum/${token.contractAddress}/${token.tokenId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2"
                  >
                    View on OpenSea{" "}
                    <ExternalLink aria-hidden="true" size={14} />
                  </a>
                  <a
                    href={`https://etherscan.io/token/${token.contractAddress}?a=${token.tokenId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-5 py-3 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                  >
                    View on Etherscan{" "}
                    <ExternalLink aria-hidden="true" size={14} />
                  </a>
                </div>
              </div>
            </div>

            <section className="mt-12" aria-labelledby="island-history">
              <h2
                id="island-history"
                className="display text-2xl text-ink sm:text-3xl"
              >
                Transfer history
              </h2>
              <p className="mt-2 text-sm font-medium text-muted">
                From the first mint to the latest transfer.
              </p>
              {transfers.isLoading ? (
                <p role="status" className="mt-5 text-sm text-muted">
                  Loading transfers…
                </p>
              ) : transfers.isError && !transfers.data ? (
                <div className="mt-5">
                  <QueryError
                    message="Transfer history could not be loaded."
                    onRetry={() => void transfers.refetch()}
                  />
                </div>
              ) : (
                <ol className="mt-5 divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
                  {transfers.data?.pages
                    .flatMap((page) => page.items)
                    .map((transfer) => (
                      <li
                        key={transfer.id}
                        className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                      >
                        <div>
                          <p className="text-sm font-extrabold text-ink">
                            {transfer.from === zeroAddress
                              ? "Minted"
                              : transfer.to === zeroAddress
                                ? "Burned"
                                : "Transferred"}
                          </p>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
                            {transfer.from === zeroAddress ? (
                              <span>Mint</span>
                            ) : (
                              <Link
                                to={islandOwnerHref(transfer.from)}
                                className="rounded text-ethereum hover:underline focus-visible:ring-2 focus-visible:ring-ethereum"
                              >
                                {shortAddress(transfer.from)}
                              </Link>
                            )}
                            <ArrowRight aria-hidden="true" size={12} />
                            {transfer.to === zeroAddress ? (
                              <span>Burn</span>
                            ) : (
                              <Link
                                to={islandOwnerHref(transfer.to)}
                                className="rounded text-ethereum hover:underline focus-visible:ring-2 focus-visible:ring-ethereum"
                              >
                                {shortAddress(transfer.to)}
                              </Link>
                            )}
                          </p>
                        </div>
                        <a
                          href={`https://etherscan.io/tx/${transfer.transactionHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded text-xs font-bold text-muted hover:text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
                        >
                          {transferDate(transfer.blockTimestamp)}{" "}
                          <ExternalLink aria-hidden="true" size={12} />
                        </a>
                      </li>
                    ))}
                </ol>
              )}
              {transfers.isError && transfers.data && (
                <div className="mt-5">
                  <QueryError
                    message="More transfers could not be loaded."
                    onRetry={() =>
                      void (transfers.isFetchNextPageError
                        ? transfers.fetchNextPage()
                        : transfers.refetch())
                    }
                  />
                </div>
              )}
              {transfers.hasNextPage && (
                <button
                  type="button"
                  disabled={transfers.isFetchingNextPage}
                  onClick={() => void transfers.fetchNextPage()}
                  className="mt-5 inline-flex items-center gap-2 rounded-full border border-line bg-white px-5 py-3 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum disabled:opacity-60"
                >
                  {transfers.isFetchingNextPage && (
                    <Loader2
                      aria-hidden="true"
                      className="animate-spin"
                      size={14}
                    />
                  )}{" "}
                  Load more transfers
                </button>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
