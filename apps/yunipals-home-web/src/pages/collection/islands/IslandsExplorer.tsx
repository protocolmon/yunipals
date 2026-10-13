import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { Select, SelectItem } from "@/components/ui/select";
import { environment } from "@/environment";

import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import { ChainBadge } from "@/components/ui/ChainBadge";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { trackAnalyticsEvent } from "@/lib/analytics/index";
import { formatInteger, shortAddress } from "@/lib/format";
import {
  fetchIslands,
  fetchIslandsStats,
  islandDetailHref,
  isIslandOwner,
  islandsCollectionHref,
  islandsCollectionId,
  normalizeIslandTokenId,
  parseIslandsFilters,
  type IslandsFilters
} from "@/lib/islandsIndexer";
import { cn } from "@/lib/utils";

import { IslandCard } from "./IslandCard";

const filterSelect =
  "w-full gap-2 sm:gap-3 rounded-full border border-line bg-white px-3 py-2.5 text-xs font-bold text-ink transition hover:border-ethereum/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2 sm:w-auto sm:px-4 sm:text-sm";

export function IslandsExplorer() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { address } = useAccount();
  let filters: IslandsFilters = { sort: "token-id-asc" };
  let filterError = "";
  try {
    filters = parseIslandsFilters(params);
  } catch (error) {
    filterError =
      error instanceof Error ? error.message : "Invalid island filters.";
  }
  const [lookup, setLookup] = useState(filters.owner || filters.tokenId || "");
  const [lookupError, setLookupError] = useState("");
  useEffect(() => {
    setLookup(filters.owner || filters.tokenId || "");
    setLookupError("");
  }, [filters.owner, filters.tokenId]);

  usePageMetadata(
    "Yunipals Islands — Explore the Collection",
    "Explore original Ethereum islands and airdropped Base islands. Browse artwork, wallet holdings, and transfer histories."
  );
  const stats = useQuery({
    queryKey: ["islands", "stats", filters.origin ?? "all"],
    queryFn: ({ signal }) => fetchIslandsStats(signal, filters.origin ?? "all"),
    staleTime: 60_000
  });
  const tokens = useInfiniteQuery({
    queryKey: ["islands", "tokens", filters],
    queryFn: ({ pageParam, signal }) =>
      fetchIslands(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: !filterError,
    staleTime: 30_000
  });
  const items = tokens.data?.pages.flatMap((page) => page.items) || [];

  function updateFilters(changes: Partial<IslandsFilters>) {
    trackAnalyticsEvent("Collection Filter Applied", {
      collection: "islands",
      filter:
        changes.sort !== undefined
          ? "sort"
          : changes.owner !== undefined
            ? "owner"
            : changes.edition !== undefined
              ? "edition"
              : "filters"
    });
    const next = { ...filters, ...changes };
    if (next.origin === "airdrop") next.holding = "all";
    const search = new URLSearchParams({ collection: "islands" });
    if (next.origin && next.origin !== "all") search.set("origin", next.origin);
    if (next.tokenId) search.set("tokenId", next.tokenId);
    if (next.edition) search.set("edition", next.edition);
    if (next.owner) search.set("owner", next.owner);
    if (next.holding && (next.owner || next.holding === "staked"))
      search.set("holding", next.holding);
    if (next.sort !== "token-id-asc") search.set("sort", next.sort);
    setParams(search);
  }

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = lookup.trim();
    if (!input) {
      updateFilters({ owner: undefined, tokenId: undefined });
      return;
    }
    const tokenId = normalizeIslandTokenId(input);
    if (tokenId !== null) {
      trackAnalyticsEvent("Collection Search Submitted", {
        collection: "islands",
        search_type: "token",
        outcome: "valid"
      });
      if (!filters.origin || filters.origin === "all")
        updateFilters({ tokenId, owner: undefined });
      else
        navigate(
          islandDetailHref(
            tokenId,
            filters.origin === "airdrop" ? "base-islands" : "ethereum-islands"
          )
        );
      return;
    }
    if (isIslandOwner(input)) {
      trackAnalyticsEvent("Collection Search Submitted", {
        collection: "islands",
        search_type: "collector",
        outcome: "valid"
      });
      updateFilters({
        owner: input.toLowerCase() as `0x${string}`,
        tokenId: undefined
      });
      setLookupError("");
      return;
    }
    trackAnalyticsEvent("Collection Search Submitted", {
      collection: "islands",
      search_type: "invalid",
      outcome: "invalid"
    });
    setLookupError("Enter an island token ID or a wallet address.");
  }

  return (
    <main className="min-h-[70vh]">
      <section className="bg-gradient-to-br from-mint/35 via-sky/30 to-lavender/25 px-4 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <div className="flex gap-2">
            <ChainBadge chainId="ethereum" variant="soft" />
            <ChainBadge chainId="base" variant="soft" />
          </div>
          <div className="mt-4 grid gap-7 lg:grid-cols-[1fr_380px] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-ethereum">
                Grassland Archipelago
              </p>
              <h1 className="display mt-3 text-5xl text-ink sm:text-7xl">
                Yunipals Islands
              </h1>
              <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-ink/70 sm:text-lg">
                Explore original Ethereum islands and their airdropped Base
                copies. Find your island, discover its artwork, and follow each
                NFT’s ownership history.
              </p>
            </div>
            <form onSubmit={submitLookup}>
              <label
                htmlFor="island-lookup"
                className="text-xs font-bold uppercase tracking-wide text-muted"
              >
                Island token ID or wallet address
              </label>
              <div className="mt-2 flex rounded-full border border-ethereum/20 bg-white p-1.5 shadow-card">
                <Search
                  aria-hidden="true"
                  className="ml-2 self-center text-muted"
                  size={17}
                />
                <input
                  id="island-lookup"
                  value={lookup}
                  onChange={(event) => {
                    setLookup(event.target.value);
                    setLookupError("");
                  }}
                  placeholder="1, 1001, or 0x…"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(lookupError)}
                  aria-describedby={
                    lookupError ? "island-lookup-error" : undefined
                  }
                  className="min-w-0 flex-1 rounded-full bg-transparent px-3 py-2 text-sm font-semibold placeholder:text-muted/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                />
                <button className="rounded-full bg-ink px-5 py-2 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2">
                  Find
                </button>
              </div>
              {lookupError && (
                <p
                  id="island-lookup-error"
                  role="alert"
                  className="mt-2 text-xs font-semibold text-red-600"
                >
                  {lookupError}
                </p>
              )}
            </form>
          </div>
          {stats.data && (
            <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-4">
              {[
                ["NFTs", stats.data.activeSupply],
                ["Original · Ethereum", stats.data.originals ?? 0],
                ["Airdropped · Base", stats.data.airdropped ?? 0],
                ["Collectors", stats.data.holders],
                ["Genesis", stats.data.genesis],
                ["Personal", stats.data.personal]
              ].map(([label, count]) => (
                <div key={label}>
                  <dt className="text-xs font-bold text-muted">{label}</dt>
                  <dd className="mt-1 text-xl font-extrabold text-ink">
                    {formatInteger(count)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <section id="collection" className="scroll-mt-24 px-4 py-12 sm:py-16">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-ethereum">
                Collection shelf
              </p>
              <h2 className="display mt-2 text-3xl text-ink sm:text-4xl">
                {filters.owner
                  ? "Wallet islands"
                  : filters.holding === "staked" &&
                      environment.islandStakingEnabled
                    ? "Staked islands"
                    : filters.edition
                      ? `${filters.edition} islands`
                      : "All islands"}
              </h2>
              <p
                className="mt-2 text-sm font-medium text-muted"
                aria-live="polite"
              >
                {tokens.isLoading
                  ? "Loading islands…"
                  : `${formatInteger(items.length)} islands loaded`}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-card border border-line bg-mint/15 p-4 text-sm leading-relaxed text-ink/70">
            Ethereum islands are the original collection. Base islands were
            airdropped from an Ethereum ownership snapshot, including eligible
            staked islands. Each original and its Base copy are separate NFTs
            and can belong to different wallets. Transferring one does not
            transfer the other.
          </div>
          <div
            className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3"
            role="group"
            aria-label="Island filters"
          >
            <Select
              aria-label="Island origin"
              value={filters.origin ?? "all"}
              onValueChange={(value) =>
                updateFilters({
                  origin: value as IslandsFilters["origin"]
                })
              }
              className={filterSelect}
            >
              <SelectItem value="all">All islands</SelectItem>
              <SelectItem value="original">Original · Ethereum</SelectItem>
              <SelectItem value="airdrop">Airdropped · Base</SelectItem>
            </Select>
            <Select
              aria-label="Island edition"
              value={filters.edition ?? "all"}
              onValueChange={(value) =>
                updateFilters({
                  edition:
                    value === "all"
                      ? undefined
                      : (value as IslandsFilters["edition"])
                })
              }
              className={filterSelect}
            >
              <SelectItem value="all">All editions</SelectItem>
              <SelectItem value="Genesis">Genesis</SelectItem>
              <SelectItem value="Personal">Personal</SelectItem>
            </Select>
            {environment.islandStakingEnabled &&
              filters.origin !== "airdrop" && (
                <Select
                  aria-label="Island holdings"
                  value={filters.holding ?? "all"}
                  onValueChange={(value) =>
                    updateFilters({
                      holding: value as IslandsFilters["holding"]
                    })
                  }
                  className={filterSelect}
                >
                  <SelectItem value="all">All holdings</SelectItem>
                  {filters.owner && (
                    <SelectItem value="wallet">In wallet</SelectItem>
                  )}
                  <SelectItem value="staked">Staked</SelectItem>
                </Select>
              )}
            <Select
              aria-label="Sort by"
              value={filters.sort}
              onValueChange={(value) =>
                updateFilters({
                  sort: value as IslandsFilters["sort"]
                })
              }
              className={cn(filterSelect, "sm:ml-auto")}
            >
              <SelectItem value="token-id-asc">
                ID: low to high
              </SelectItem>
              <SelectItem value="token-id-desc">
                ID: high to low
              </SelectItem>
            </Select>
            {address && (
              <button
                type="button"
                onClick={() =>
                  updateFilters({
                    owner: address.toLowerCase() as `0x${string}`
                  })
                }
                className="col-span-2 rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:bg-mint/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2"
              >
                My islands
              </button>
            )}
          </div>

          {filters.owner && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm font-bold text-muted">
              <span>Wallet {shortAddress(filters.owner)}</span>
              <button
                type="button"
                onClick={() => updateFilters({ owner: undefined })}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-ethereum hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                <X aria-hidden="true" size={14} /> Clear wallet
              </button>
            </div>
          )}
          {filters.tokenId && (
            <div className="mt-4 flex items-center gap-3 text-sm font-bold text-muted">
              <span>Island #{filters.tokenId}</span>
              <button
                type="button"
                onClick={() => updateFilters({ tokenId: undefined })}
                className="rounded-full px-2 py-1 text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                Clear token
              </button>
            </div>
          )}
          {Boolean(tokens.data?.pages[0]?.unavailableCollections?.length) && (
            <p role="status" className="mt-5 text-sm text-muted">
              {tokens
                .data!.pages[0]!.unavailableCollections!.map((id) =>
                  id === "base-islands" ? "Base airdrops" : "Ethereum originals"
                )
                .join(" and ")}{" "}
              are updating. Showing the available collection.{" "}
              <button
                type="button"
                className="font-bold underline"
                onClick={() => void tokens.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          {tokens.data?.pages[0]?.complete === false &&
            !tokens.data.pages[0].unavailableCollections?.length && (
              <p role="status" className="mt-5 text-sm text-muted">
                Staking verification is updating. Some staked islands may be
                missing temporarily.{" "}
                <button
                  type="button"
                  className="font-bold underline"
                  onClick={() => void tokens.refetch()}
                >
                  Retry
                </button>
              </p>
            )}

          <div className="mt-7">
            {filterError ? (
              <div>
                <QueryError message={filterError} />
                <Link
                  to={islandsCollectionHref}
                  className="mt-4 inline-flex rounded-full px-4 py-2 font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
                >
                  Reset filters
                </Link>
              </div>
            ) : tokens.isLoading ? (
              <TokenGridSkeleton count={24} />
            ) : tokens.isError && !tokens.data ? (
              <QueryError
                message="The islands collection is temporarily unavailable."
                onRetry={() => void tokens.refetch()}
              />
            ) : !items.length ? (
              <div className="rounded-card border border-line bg-surface px-6 py-12 text-center">
                <p className="text-lg font-extrabold text-ink">
                  {tokens.data?.pages[0]?.complete === false
                    ? "Waiting for staking verification"
                    : "No islands found"}
                </p>
                <p className="mt-2 text-sm font-medium text-muted">
                  Try another wallet, island edition, or holding filter.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {items.map((token, index) => (
                  <IslandCard
                    key={`${token.collectionId}:${token.tokenId}`}
                    token={token}
                    eager={index < 4}
                  />
                ))}
              </div>
            )}
          </div>
          {tokens.isError && tokens.data && (
            <div className="mt-6">
              <QueryError
                message="More islands could not be loaded."
                onRetry={() =>
                  void (tokens.isFetchNextPageError
                    ? tokens.fetchNextPage()
                    : tokens.refetch())
                }
              />
            </div>
          )}
          {tokens.hasNextPage && (
            <div className="mt-8 text-center">
              <button
                type="button"
                disabled={tokens.isFetchingNextPage}
                onClick={() => void tokens.fetchNextPage()}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-7 py-3 text-sm font-extrabold text-ink transition hover:bg-mint/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2 disabled:opacity-60"
              >
                {tokens.isFetchingNextPage && (
                  <Loader2
                    aria-hidden="true"
                    className="animate-spin"
                    size={16}
                  />
                )}
                {tokens.isFetchingNextPage
                  ? "Loading islands…"
                  : "Load more islands"}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
