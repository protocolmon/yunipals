import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import {
  parseExomonFilters,
  serializeExomonFilters
} from "@/lib/exomonFilters";
import { formatInteger, formatUpdatedAt } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  fetchExomonCollection,
  fetchExomonStatus,
  fetchExomonTokens,
  fetchExomonTraits,
  isSolanaAddress,
  retrySolanaQuery,
  solanaCacheVersion,
  type ExomonFilters
} from "@/lib/solanaIndexer";
import { ExomonCard } from "@/pages/exomon/ExomonCard";
import { useExomonPagination } from "@/pages/exomon/useExomonPagination";

const sortOptions: { value: ExomonFilters["sort"]; label: string }[] = [
  { value: "rarity-capped-desc", label: "Rarest first" },
  { value: "rarity-capped-asc", label: "Least rare first" },
  { value: "rarity-desc", label: "Raw rarity: high to low" },
  { value: "rarity-asc", label: "Raw rarity: low to high" },
  { value: "token-id-asc", label: "Mint address: A to Z" },
  { value: "token-id-desc", label: "Mint address: Z to A" }
];

function CollectionResults({
  filters,
  filterKey
}: {
  filters: ExomonFilters;
  filterKey: string;
}) {
  const { query, next, previous, canPrevious, pageNumber } =
    useExomonPagination(`collection:${filterKey}`, (cursor, signal) =>
      fetchExomonTokens(filters, cursor, signal)
    );
  return (
    <section aria-label="Exomon results" className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted">
          {query.data
            ? `${formatInteger(query.data.total)} matching Exomon`
            : "Loading Exomon…"}
        </p>
        <span className="text-xs font-semibold text-muted">
          Page {pageNumber}
        </span>
      </div>
      {query.isPending ? (
        <TokenGridSkeleton />
      ) : query.isError ? (
        <QueryError
          message="Exomon data is temporarily unavailable. Please try again."
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {query.data.items.map((token) => (
            <ExomonCard key={token.tokenId} token={token} />
          ))}
        </div>
      ) : (
        <div className="rounded-card border border-line bg-white p-8 text-center text-muted">
          No Exomon match these filters.
        </div>
      )}
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={previous}
          disabled={!canPrevious || query.isFetching}
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-bold text-ink disabled:opacity-40"
        >
          <ArrowLeft size={16} /> Previous
        </button>
        <button
          type="button"
          onClick={next}
          disabled={!query.data?.nextCursor || query.isFetching}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          Next <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

export function ExomonCollectionPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [mintInput, setMintInput] = useState("");
  const [mintError, setMintError] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filters = useMemo(() => parseExomonFilters(params), [params]);
  const filterKey = serializeExomonFilters(filters).toString();
  const collection = useQuery({
    queryKey: [solanaCacheVersion, "collection-summary"],
    queryFn: ({ signal }) => fetchExomonCollection(signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: retrySolanaQuery
  });
  const status = useQuery({
    queryKey: [solanaCacheVersion, "status"],
    queryFn: ({ signal }) => fetchExomonStatus(signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: retrySolanaQuery
  });
  const facets = useQuery({
    queryKey: [solanaCacheVersion, "traits"],
    queryFn: ({ signal }) => fetchExomonTraits(signal),
    staleTime: 300_000,
    retry: retrySolanaQuery
  });
  const visibleFacets = facets.data?.items
    .filter((facet) =>
      [
        "Type",
        "Color",
        "Horn",
        "Glitter",
        "Celestial",
        "Background",
        "Origin Chain",
        "Opening Network"
      ].includes(facet.traitType)
    )
    .sort((a, b) =>
      a.traitType === "Type"
        ? -1
        : b.traitType === "Type"
          ? 1
          : a.traitType === "Color"
            ? -1
            : b.traitType === "Color"
              ? 1
              : a.traitType.localeCompare(b.traitType)
    );

  usePageMetadata(
    "Exomon on Solana — Yunipals",
    "Explore Exomon on Solana by rarity and traits, and view current indexed ownership."
  );

  function updateFilters(next: ExomonFilters) {
    setParams(serializeExomonFilters(next));
  }
  function findMint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const mint = mintInput.trim();
    if (!isSolanaAddress(mint)) {
      setMintError(true);
      return;
    }
    navigate(`/collection/solana/${mint}`);
  }

  return (
    <main className="min-h-[65vh] bg-gradient-to-b from-sky/20 to-white px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="rounded-full bg-sky/50 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-ink">
              Solana · Mainnet
            </span>
            <h1 className="display mt-4 text-4xl text-ink sm:text-5xl">
              Exomon
            </h1>
            <p className="mt-3 max-w-xl text-sm text-muted sm:text-base">
              Explore the collection, traits, and current owners. Ownership
              reflects the latest completed index scan.
            </p>
          </div>
          <Link
            to="/leaderboard?chain=solana"
            className="rounded-full border border-line bg-white px-5 py-3 text-sm font-bold text-ink hover:bg-sky/20"
          >
            Collector leaderboard →
          </Link>
        </div>
        <div className="mb-8 grid gap-3 sm:grid-cols-3">
          <div className="rounded-card border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase text-muted">
              Active supply
            </p>
            <p className="mt-1 text-3xl font-black text-ink">
              {collection.data
                ? formatInteger(collection.data.activeSupply)
                : "—"}
            </p>
          </div>
          <div className="rounded-card border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase text-muted">
              Indexed / known
            </p>
            <p className="mt-1 text-3xl font-black text-ink">
              {collection.data
                ? `${formatInteger(collection.data.indexedTokens)} / ${formatInteger(collection.data.knownTokens)}`
                : "—"}
            </p>
          </div>
          <div className="rounded-card border border-line bg-white p-5">
            <p className="text-xs font-bold uppercase text-muted">
              Ownership observed
            </p>
            <p className="mt-2 text-sm font-bold text-ink">
              {formatUpdatedAt(
                collection.data?.ownershipObservedAt ?? status.data?.publishedAt
              )}
            </p>
            <p className="mt-1 text-xs text-muted">
              {status.data?.freshness === "stale"
                ? "A new scan is pending"
                : status.data?.ready
                  ? "Latest completed scan"
                  : "Status unavailable"}
            </p>
          </div>
        </div>
        {collection.isError && (
          <div className="mb-6">
            <QueryError
              message="Collection statistics are temporarily unavailable."
              onRetry={() => void collection.refetch()}
            />
          </div>
        )}
        <form onSubmit={findMint} className="mb-8 max-w-xl">
          <label
            htmlFor="exomon-mint"
            className="mb-2 block text-sm font-bold text-ink"
          >
            Find an Exomon by mint address
          </label>
          <div className="flex gap-2">
            <input
              id="exomon-mint"
              value={mintInput}
              onChange={(event) => {
                setMintInput(event.target.value);
                setMintError(false);
              }}
              placeholder="Solana mint address"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={mintError}
              className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-badge"
            />
            <button
              type="submit"
              className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-white"
            >
              <Search size={16} aria-label="Search mint" />
            </button>
          </div>
          {mintError && (
            <p role="alert" className="mt-1 text-xs font-semibold text-red-600">
              Enter a valid Solana mint address.
            </p>
          )}
        </form>
        <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="exomon-filters"
            className="rounded-full border border-line bg-white px-5 py-3 text-left text-sm font-bold text-ink lg:hidden"
          >
            {filtersOpen ? "Hide filters" : "Show filters"}
          </button>
          <aside
            id="exomon-filters"
            className={cn(
              "min-w-0 rounded-card border border-line bg-white p-5 lg:block lg:self-start",
              filtersOpen ? "block" : "hidden"
            )}
            aria-label="Exomon filters"
          >
            <h2 className="text-lg font-extrabold text-ink">Filters</h2>
            <label
              htmlFor="exomon-sort"
              className="mt-5 block text-xs font-bold uppercase text-muted"
            >
              Sort
            </label>
            <select
              id="exomon-sort"
              value={filters.sort}
              onChange={(event) =>
                updateFilters({
                  ...filters,
                  sort: event.target.value as ExomonFilters["sort"]
                })
              }
              className="mt-2 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-5 text-xs font-bold uppercase text-muted">
              Capped rarity points
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                Min
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={filters.rarityMin}
                  onChange={(event) =>
                    updateFilters({ ...filters, rarityMin: event.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="text-xs text-muted">
                Max
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={filters.rarityMax}
                  onChange={(event) =>
                    updateFilters({ ...filters, rarityMax: event.target.value })
                  }
                  className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm text-ink"
                />
              </label>
            </div>
            {visibleFacets?.map((facet) => (
              <details
                key={facet.traitType}
                className="mt-4 border-t border-line pt-4"
              >
                <summary className="cursor-pointer text-sm font-bold text-ink">
                  {facet.traitType}
                  {filters.traits[facet.traitType]?.length
                    ? ` (${filters.traits[facet.traitType].length})`
                    : ""}
                </summary>
                <div className="mt-3 max-h-48 space-y-2 overflow-y-auto">
                  {facet.values.map((value) => (
                    <label
                      key={value.value}
                      className="flex cursor-pointer items-start gap-2 text-xs text-ink"
                    >
                      <input
                        type="checkbox"
                        checked={
                          filters.traits[facet.traitType]?.includes(
                            value.value
                          ) ?? false
                        }
                        onChange={(event) => {
                          const current = filters.traits[facet.traitType] ?? [];
                          const values = event.target.checked
                            ? [...current, value.value]
                            : current.filter((item) => item !== value.value);
                          const traits = { ...filters.traits };
                          if (values.length) traits[facet.traitType] = values;
                          else delete traits[facet.traitType];
                          updateFilters({ ...filters, traits });
                        }}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1 break-words">
                        {value.value}
                      </span>
                      <span className="text-muted">
                        {formatInteger(value.count)}
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            ))}
            {facets.isError && (
              <p className="mt-4 text-xs text-red-600">
                Trait filters are unavailable.
              </p>
            )}
            <button
              type="button"
              onClick={() => setParams(new URLSearchParams())}
              className="mt-6 text-sm font-bold text-badge underline"
            >
              Clear filters
            </button>
          </aside>
          <CollectionResults
            key={filterKey}
            filters={filters}
            filterKey={filterKey}
          />
        </div>
      </div>
    </main>
  );
}
