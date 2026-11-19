import { environment } from "@/environment";
import { CollectionFusions } from "@/pages/adventures/AdventureCards";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";

import { collectionViewQuery } from "@/lib/collectionEdition";
import { CollectionDailyPulls } from "@/components/CollectionDailyPulls";
import { CollectionEmptyState } from "@/components/CollectionEmptyState";
import { CollectionFilterPanel } from "@/components/CollectionFilters";
import { CollectionPackCard } from "@/components/CollectionPackCard";
import { CollectionPackPagination } from "@/components/CollectionPackPagination";
import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import { useBoosterCollectionCards } from "@/hooks/useBoosterCollectionCards";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import {
  packGridFilters,
  tcgCollectionFacets
} from "@/lib/boosterCollectionGrid";
import {
  serializeCollectionFilters,
  type CollectionFilters
} from "@/lib/collectionBrowserFilters";
import {
  readSavedCollectorFilters,
  resolveCollectorQuery,
  saveCollectorFilters
} from "@/lib/collectorPreferences";
import {
  confirmedBoosterCollectionKey,
  type ConfirmedBoosterCollection
} from "@/lib/confirmedBoosterCollection";
import { formatInteger, shortAddress } from "@/lib/format";
import { parseTcgCollectionFilters } from "@/lib/tcgCollectionFilters";
import {
  fetchOwnerResolution,
  IndexerError,
  isEthereumAddress,
  isOwnerInput
} from "@/lib/yunipalsIndexer";

export function TcgCollector({ ownerInput }: { ownerInput: string }) {
  const [params, setParams] = useSearchParams();
  const { address } = useAccount();
  const valid = isOwnerInput(ownerInput);
  const resolution = useQuery({
    queryKey: ["collector-identity", ownerInput, "base"],
    queryFn: ({ signal }) => fetchOwnerResolution(ownerInput, signal),
    enabled: valid && !isEthereumAddress(ownerInput),
    staleTime: 60_000,
    retry: 1
  });
  const owner = isEthereumAddress(ownerInput)
    ? ownerInput
    : resolution.data?.resolvedAddresses?.base;
  const own = Boolean(owner && address?.toLowerCase() === owner.toLowerCase());
  const viewQuery = useMemo(
    () =>
      resolveCollectorQuery(
        params,
        params.size ? null : readSavedCollectorFilters("tcg")
      ),
    [params]
  );
  const filters = useMemo(
    () => parseTcgCollectionFilters(viewQuery),
    [viewQuery]
  );
  const search = viewQuery.get("q")?.trim().slice(0, 80) ?? "";
  const [input, setInput] = useState(search);
  useEffect(() => setInput(search), [search]);
  const packFilters = useMemo(
    () => ({ ...packGridFilters(filters), search }),
    [filters, search]
  );
  const cards = useBoosterCollectionCards(
    packFilters,
    owner ?? "",
    Boolean(owner)
  );
  const confirmed = useQuery<ConfirmedBoosterCollection | null>({
    queryKey: confirmedBoosterCollectionKey(owner ?? ""),
    queryFn: async () => null,
    enabled: false,
    gcTime: 5 * 60_000
  });
  const updating = Boolean(
    confirmed.data &&
      (!cards.query.data ||
        cards.query.data.pages.every(
          (page) =>
            BigInt(page.indexedBlock ?? "0") <
            BigInt(confirmed.data!.indexedBlock)
        ))
  );
  const canonical = serializeCollectionFilters(filters);
  canonical.set("edition", "tcg");
  if (search) canonical.set("q", search);
  const canonicalSearch = collectionViewQuery(canonical).toString();
  useEffect(() => {
    if (!valid) return;
    saveCollectorFilters(canonicalSearch);
    if (params.toString() !== canonicalSearch)
      setParams(canonicalSearch, { replace: true });
  }, [canonicalSearch, params, setParams, valid]);
  const changeFilters = (next: CollectionFilters) => {
    const query = serializeCollectionFilters(next);
    query.set("edition", "tcg");
    if (search) query.set("q", search);
    setParams(collectionViewQuery(query));
  };
  usePageMetadata(
    `${own ? "Your" : shortAddress(owner ?? ownerInput)} TCG Collection — Yunipals`,
    "Yunipals cards from booster packs and daily packs on Base."
  );
  const filtered = Boolean(
    search ||
      Object.keys(filters.traits).length ||
      filters.originalOnly ||
      filters.sequenceMin ||
      filters.sequenceMax
  );
  return (
    <main className="mx-auto min-h-[70vh] max-w-6xl px-4 pb-16">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">
          {own ? "Your TCG Collection" : "TCG Collection"}
        </h1>
        <p className="min-w-0 truncate text-sm text-muted" title={ownerInput}>
          {ownerInput.startsWith("0x") ? shortAddress(ownerInput) : ownerInput}
        </p>
        <Link
          to="/boosters"
          className="inline-flex min-h-11 items-center rounded-full border border-line px-4 py-2 text-sm font-bold text-grape focus-visible:ring-2 focus-visible:ring-grape"
        >
          Open packs
        </Link>
      </header>
      {owner && environment.evolutionEnabled && (
        <CollectionFusions owner={owner} />
      )}
      {!valid ? (
        <QueryError message="Enter a valid wallet address or ENS name." />
      ) : resolution.isError && !owner ? (
        <QueryError
          message={
            resolution.error instanceof IndexerError &&
            resolution.error.status === 404
              ? "This ENS name has no Base address record."
              : "Could not resolve this wallet’s Base address."
          }
          onRetry={() => void resolution.refetch()}
        />
      ) : (
        <>
          {updating && (
            <div
              role="status"
              className="my-4 rounded-2xl bg-lavender/30 p-4 text-sm text-grape"
            >
              <p className="font-semibold">
                Your revealed cards are confirmed. Updating your TCG collection…
              </p>
              {cards.collection && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {confirmed.data?.tokenIds.slice(0, 3).map((id) => (
                    <Link
                      key={id}
                      to={`/monsters/${cards.collection}/${id}`}
                      className="font-bold underline focus-visible:ring-2 focus-visible:ring-grape"
                    >
                      View revealed card #{id}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="my-3 flex flex-wrap items-center justify-between gap-3">
            <p aria-live="polite" className="text-sm text-muted">
              {cards.query.isLoading || (!owner && resolution.isPending)
                ? "Loading TCG cards…"
                : `${formatInteger(cards.items.length)} matching card${cards.items.length === 1 ? "" : "s"} loaded`}
            </p>
            <div className="flex flex-wrap gap-3">
              {own && <CollectionDailyPulls />}
              <button
                type="button"
                disabled={!cards.enabled || cards.query.isFetching}
                onClick={() => void cards.query.refetch()}
                className="min-h-11 rounded-full border border-line px-4 font-bold disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-grape"
              >
                Refresh
              </button>
            </div>
          </div>
          <form
            className="mb-4 flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const next = new URLSearchParams(canonicalSearch);
              if (input.trim()) next.set("q", input.trim());
              else next.delete("q");
              setParams(next);
            }}
          >
            <label className="sr-only" htmlFor="tcg-search">
              Search your TCG collection
            </label>
            <input
              id="tcg-search"
              type="search"
              maxLength={80}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Token ID or card name…"
              className="min-h-11 min-w-0 flex-1 rounded-full border border-line px-5 focus-visible:ring-2 focus-visible:ring-grape"
            />
            <button
              type="submit"
              className="rounded-full bg-ink px-5 py-2 font-bold text-white focus-visible:ring-2 focus-visible:ring-grape"
            >
              Search
            </button>
            {filtered && (
              <button
                type="button"
                onClick={() => setParams("edition=tcg")}
                className="rounded-full border border-line px-4 py-2 font-bold focus-visible:ring-2 focus-visible:ring-grape"
              >
                Clear filters
              </button>
            )}
          </form>
          <p className="mb-4 text-xs text-muted">
            Search and traits apply to loaded cards. Load more to explore the
            rest of this wallet. Cards are ordered by token ID.
          </p>
          <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <details className="rounded-card border border-line lg:hidden">
              <summary className="cursor-pointer px-4 py-3 font-bold focus-visible:ring-2 focus-visible:ring-grape">
                TCG filters
              </summary>
              <CollectionFilterPanel
                edition="tcg"
                filters={filters}
                facets={tcgCollectionFacets}
                facetsLoading={false}
                facetsError={false}
                onChange={changeFilters}
                onRetryFacets={() => {}}
              />
            </details>
            <aside className="hidden lg:block">
              <CollectionFilterPanel
                edition="tcg"
                filters={filters}
                facets={tcgCollectionFacets}
                facetsLoading={false}
                facetsError={false}
                onChange={changeFilters}
                onRetryFacets={() => {}}
              />
            </aside>
            <div aria-busy={cards.query.isFetching}>
              {!owner || (cards.enabled && cards.query.isPending) ? (
                <TokenGridSkeleton count={6} />
              ) : !cards.enabled ? (
                <CollectionEmptyState
                  edition="tcg"
                  title="TCG Collection unavailable"
                  description="TCG cards are not available here yet. Please try again later."
                />
              ) : cards.query.isError && !cards.query.data ? (
                <QueryError
                  message={cards.query.error.message}
                  onRetry={() => void cards.query.refetch()}
                />
              ) : cards.items.length ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {cards.items.map((monster, index) => (
                    <CollectionPackCard
                      key={monster.id}
                      monster={monster}
                      eager={index < 4}
                    />
                  ))}
                </div>
              ) : (
                <CollectionEmptyState
                  edition="tcg"
                  title={
                    cards.query.hasNextPage
                      ? "No matches in loaded cards"
                      : filtered
                        ? "No matching TCG cards"
                        : "No TCG cards yet"
                  }
                  description={
                    cards.query.hasNextPage
                      ? "Load more cards or clear your filters to continue."
                      : filtered
                        ? "Try another search or clear your filters."
                        : "This wallet has no TCG cards. Open packs to start your collection."
                  }
                />
              )}
              <CollectionPackPagination cards={cards} />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
