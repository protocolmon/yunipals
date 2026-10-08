import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { environment } from "@/environment";

import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import { ChainBadge } from "@/components/ui/ChainBadge";
import { usePageMetadata } from "@/hooks/usePageMetadata";
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

const filterButton =
  "rounded-full px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2";

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
  const [lookup, setLookup] = useState(filters.owner || "");
  const [lookupError, setLookupError] = useState("");
  useEffect(() => {
    setLookup(filters.owner || "");
    setLookupError("");
  }, [filters.owner]);

  usePageMetadata(
    "Yunipals Islands — Explore the Collection",
    "Explore Genesis and Personal islands on Ethereum. Browse island artwork, wallet holdings, and transfer histories."
  );
  const stats = useQuery({
    queryKey: [islandsCollectionId, "stats"],
    queryFn: ({ signal }) => fetchIslandsStats(signal),
    staleTime: 60_000
  });
  const tokens = useInfiniteQuery({
    queryKey: [islandsCollectionId, "tokens", filters],
    queryFn: ({ pageParam, signal }) =>
      fetchIslands(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: !filterError,
    staleTime: 30_000
  });
  const items = tokens.data?.pages.flatMap((page) => page.items) || [];

  function updateFilters(changes: Partial<IslandsFilters>) {
    const next = { ...filters, ...changes };
    const search = new URLSearchParams({ collection: "islands" });
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
      updateFilters({ owner: undefined });
      return;
    }
    const tokenId = normalizeIslandTokenId(input);
    if (tokenId !== null) {
      navigate(islandDetailHref(tokenId));
      return;
    }
    if (isIslandOwner(input)) {
      updateFilters({ owner: input.toLowerCase() as `0x${string}` });
      setLookupError("");
      return;
    }
    setLookupError("Enter an island token ID or an Ethereum wallet address.");
  }

  return (
    <main className="min-h-[70vh]">
      <section className="bg-gradient-to-br from-mint/35 via-sky/30 to-lavender/25 px-4 py-14 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <ChainBadge chainId="ethereum" variant="soft" />
          <div className="mt-4 grid gap-7 lg:grid-cols-[1fr_380px] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-ethereum">
                Grassland Archipelago
              </p>
              <h1 className="display mt-3 text-5xl text-ink sm:text-7xl">
                Yunipals Islands
              </h1>
              <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-ink/70 sm:text-lg">
                Explore Genesis and Personal islands on Ethereum. Find your
                island, discover its artwork, and follow its ownership history.
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
                ["Islands", stats.data.activeSupply],
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
            <label className="flex items-center gap-3 text-sm font-bold text-muted">
              Sort by
              <select
                value={filters.sort}
                onChange={(event) =>
                  updateFilters({
                    sort: event.target.value as IslandsFilters["sort"]
                  })
                }
                className="rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                <option value="token-id-asc">Token ID: low to high</option>
                <option value="token-id-desc">Token ID: high to low</option>
              </select>
            </label>
          </div>

          <div
            className="mt-6 flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Island editions"
          >
            {([undefined, "Genesis", "Personal"] as const).map((edition) => (
              <button
                key={edition || "all"}
                type="button"
                aria-pressed={filters.edition === edition}
                onClick={() => updateFilters({ edition })}
                className={cn(
                  filterButton,
                  filters.edition === edition
                    ? "bg-ink text-white"
                    : "bg-line/40 text-ink hover:bg-mint/40"
                )}
              >
                {edition || "All islands"}
              </button>
            ))}
            {address && (
              <button
                type="button"
                onClick={() =>
                  updateFilters({
                    owner: address.toLowerCase() as `0x${string}`
                  })
                }
                className={cn(
                  filterButton,
                  "border border-line bg-white text-ink hover:bg-mint/40"
                )}
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
          {environment.islandStakingEnabled && (
            <div
              role="group"
              aria-label="Island holdings"
              className="mt-4 flex flex-wrap gap-2"
            >
              {(
                [
                  ["all", "All holdings"],
                  ["wallet", "In wallet"],
                  ["staked", "Staked"]
                ] as const
              )
                .filter(([holding]) => holding !== "wallet" || filters.owner)
                .map(([holding, label]) => (
                  <button
                    key={holding}
                    type="button"
                    aria-pressed={(filters.holding ?? "all") === holding}
                    className={cn(
                      filterButton,
                      (filters.holding ?? "all") === holding
                        ? "bg-ink text-white"
                        : "bg-line/40 text-ink"
                    )}
                    onClick={() => updateFilters({ holding })}
                  >
                    {label}
                  </button>
                ))}
            </div>
          )}
          {tokens.data?.pages[0]?.complete === false && (
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
                    key={token.tokenId}
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
