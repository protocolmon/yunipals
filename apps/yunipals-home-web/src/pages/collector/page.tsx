import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  WalletCards
} from "lucide-react";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { environment } from "@/environment";
import { CollectionEditionNav } from "@/components/CollectionEditionNav";
import { CollectionEmptyState } from "@/components/CollectionEmptyState";
import {
  collectionDefinitions,
  collectionEdition,
  collectionMigrationNotice,
  matchesOriginalEdition,
  type CollectionEdition
} from "@/lib/collectionEdition";
import { TcgCollector } from "./components/TcgCollector";
import { CollectorIslands } from "./components/CollectorIslands";

import { trackAnalyticsEvent } from "@/lib/analytics/index";

import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import { TokenCard } from "@/components/TokenCard";
import { ChainLogo } from "@/components/ui/ChainLogo";
import { chainDetails } from "@/data/chains";
import { useConfirmedSettlements } from "@/hooks/marketplace/useConfirmedSettlements";
import { formatInteger, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import {
  optimisticSettlementLifetimeMs,
  syncSettlementsFromOwnerTokens
} from "@/lib/marketplace/confirmedSettlements";
import { VisibilityActionDialog } from "@/pages/collector/components/VisibilityActionDialog";
import { useTokenVisibility } from "@/pages/collector/hooks/useTokenVisibility";
import {
  fetchOwnerResolution,
  fetchTraitFacets,
  indexedChains,
  indexedCollectionCacheVersion,
  IndexerError,
  isEthereumAddress,
  isOwnerInput,
  tokenKey,
  type TokenVisibility,
  type YunipalToken
} from "@/lib/yunipalsIndexer";

import { CollectorControls } from "@/pages/collector/components/CollectorControls";
import { useCollectorTokens } from "@/pages/collector/hooks/useCollectorTokens";
import {
  readSavedCollectorFilters,
  resolveCollectorQuery,
  collectorViewQuery,
  saveCollectorFilters,
  personalCollectionHref
} from "@/lib/collectorPreferences";
import {
  defaultCollectorFilters,
  hasCollectorFilters,
  parseCollectorFilters,
  serializeCollectorFilters,
  type CollectorFilters
} from "@/lib/collector";

type VisibilityView = Extract<TokenVisibility, "visible" | "hidden">;

type VisibilityAction = {
  token: YunipalToken;
  hidden: boolean;
};

function collectorErrorMessage(error: unknown) {
  if (!(error instanceof IndexerError)) {
    return "The collector profile could not be loaded.";
  }

  switch (error.code) {
    case "invalid_owner":
      return "Enter a valid wallet address or ENS name.";
    case "owner_name_unresolved":
      return "That ENS name does not resolve to an address on a supported chain.";
    case "ens_resolution_unavailable":
      return "ENS resolution is temporarily unavailable. Please try again.";
    case "database_unavailable":
      return "The Yunipals indexer is temporarily unavailable. Please try again.";
    default:
      return "The collector profile could not be loaded. Please try again.";
  }
}

export function CollectorPage() {
  const { address = "" } = useParams();
  const [params] = useSearchParams();
  const resolvedQuery = resolveCollectorQuery(
    params,
    readSavedCollectorFilters()
  );
  const edition = collectionEdition(resolvedQuery);
  const [migrationNotice] = useState(() =>
    collectionMigrationNotice(params, "collector")
  );
  const islands = params.get("collection") === "islands";
  return (
    <>
      <div className="mx-auto max-w-6xl px-4 pt-6">
        {!islands && migrationNotice && (
          <p role="status" className="mb-4 text-sm text-muted">
            {migrationNotice}
          </p>
        )}
        <CollectionEditionNav
          edition={islands ? "islands" : edition}
          href={(next) => personalCollectionHref(address, next)}
          islandsHref={`/collector/${encodeURIComponent(address)}?collection=islands`}
        />
      </div>
      {islands ? (
        <CollectorIslands ownerInput={address.trim()} />
      ) : edition === "tcg" ? (
        <TcgCollector key={address} ownerInput={address.trim()} />
      ) : (
        <YunipalsCollectorPage key={address} edition={edition} />
      )}
    </>
  );
}

function YunipalsCollectorPage({
  edition
}: {
  edition: Exclude<CollectionEdition, "tcg">;
}) {
  const definition = collectionDefinitions[edition];
  const { address = "" } = useParams();
  const { address: connectedAddress, isConnected } = useAccount();
  const ownerInput = address.trim();
  const [searchParams, setSearchParams] = useSearchParams();
  const savedFilters = useMemo(
    () => (searchParams.size ? null : readSavedCollectorFilters()),
    [searchParams]
  );
  const filterState = useMemo(() => {
    try {
      return {
        filters: parseCollectorFilters(
          resolveCollectorQuery(searchParams, savedFilters)
        ),
        error: null
      };
    } catch (error) {
      return {
        filters: { ...defaultCollectorFilters, chains: definition.chains },
        error:
          error instanceof Error ? error.message : "Invalid collection filters."
      };
    }
  }, [searchParams, savedFilters, definition]);
  const { filters } = filterState;
  const setFilters = useCallback(
    (next: CollectorFilters) => {
      trackAnalyticsEvent("Collection Filter Applied", {
        collection: "yunipals",
        filter: "filters"
      });
      const query = serializeCollectorFilters(next);
      query.set("edition", edition);
      startTransition(() => setSearchParams(collectorViewQuery(query)));
    },
    [setSearchParams, edition]
  );
  const validOwner = isOwnerInput(ownerInput);
  const canonicalQuery = serializeCollectorFilters(filters);
  canonicalQuery.set("edition", edition);
  const canonicalSearch = collectorViewQuery(canonicalQuery).toString();
  const filtered = hasCollectorFilters({
    ...filters,
    chains:
      filters.chains.length === definition.chains.length ? [] : filters.chains
  });
  useEffect(() => {
    if (!validOwner || filterState.error) return;
    saveCollectorFilters(canonicalSearch);
    if (searchParams.toString() !== canonicalSearch)
      setSearchParams(canonicalSearch, { replace: true });
  }, [
    canonicalSearch,
    filterState.error,
    validOwner,
    searchParams,
    setSearchParams
  ]);
  const inputIsEns = validOwner && !isEthereumAddress(ownerInput);
  const connectedAddressNormalized = connectedAddress?.toLowerCase();
  const [copied, setCopied] = useState(false);
  const [visibilityViews, setVisibilityViews] = useState<
    Record<"og" | "airdrop", VisibilityView>
  >({ og: "visible", airdrop: "visible" });
  const visibilityView = visibilityViews[edition];
  const setVisibilityView = (view: VisibilityView) =>
    setVisibilityViews((current) => ({ ...current, [edition]: view }));
  const [visibilityAction, setVisibilityAction] =
    useState<VisibilityAction | null>(null);
  const visibilityMutation = useTokenVisibility(ownerInput);
  const confirmedSettlements = useConfirmedSettlements();
  const queries = useQueryClient();

  const identity = useQuery({
    queryKey: ["collector-identity", ownerInput, edition],
    queryFn: ({ signal }) =>
      fetchOwnerResolution(ownerInput, signal, definition.chains),
    enabled: inputIsEns,
    staleTime: 60_000,
    retry: 1
  });
  const profileOwner = isEthereumAddress(ownerInput) ? ownerInput : "";
  const profileResolvedAddresses = identity.data?.resolvedAddresses;
  const isOwnCollection = Boolean(
    validOwner &&
      isConnected &&
      connectedAddressNormalized &&
      ((profileOwner &&
        connectedAddressNormalized === profileOwner.toLowerCase()) ||
        indexedChains.some(
          (chain) =>
            profileResolvedAddresses?.[chain]?.toLowerCase() ===
            connectedAddressNormalized
        ))
  );
  const activeVisibility: VisibilityView = isOwnCollection
    ? visibilityView
    : "visible";
  const collection = useCollectorTokens(
    ownerInput,
    validOwner,
    activeVisibility,
    filters,
    filterState.error,
    edition
  );
  const { tokensQuery } = collection;
  const facetsQuery = useQuery({
    queryKey: [
      "collection",
      indexedCollectionCacheVersion,
      "trait-facets",
      filters.chains
    ],
    queryFn: ({ signal }) => fetchTraitFacets(filters.chains, signal),
    enabled: collection.supported,
    staleTime: 10 * 60_000
  });

  const ownerTokens = tokensQuery.data;
  const resolvedAddresses =
    identity.data?.resolvedAddresses ?? ownerTokens?.resolvedAddresses;
  const canonicalOwner =
    definition.chains
      .map((chain) => resolvedAddresses?.[chain])
      .find(Boolean) ??
    ownerTokens?.owner ??
    (isEthereumAddress(ownerInput) ? ownerInput : "");
  const ownerName =
    identity.data?.ownerName ??
    ownerTokens?.ownerName ??
    (inputIsEns ? ownerInput : null);
  const ownerExplorerChain =
    indexedChains.find(
      (chain) =>
        resolvedAddresses?.[chain]?.toLowerCase() ===
        canonicalOwner.toLowerCase()
    ) ?? "ethereum";
  const ownerExplorerUrl = chainDetails[ownerExplorerChain].explorerUrl;

  usePageMetadata(
    isOwnCollection
      ? `Your ${definition.label}`
      : validOwner
        ? `${ownerName ?? shortAddress(canonicalOwner || ownerInput)} — Yunipals Collector`
        : "Collector — Yunipals",
    isOwnCollection
      ? "View your Yunipals collection across Ethereum, Base, Polygon, and BNB Chain."
      : "View a wallet's Yunipals collection across Ethereum, Base, Polygon, and BNB Chain."
  );

  const indexedTokens = useMemo(
    () => tokensQuery.data?.items ?? [],
    [tokensQuery.data]
  );
  const tokens = indexedTokens.filter((token) =>
    matchesOriginalEdition(token, edition)
  );
  const pendingPurchases = useMemo(() => {
    if (activeVisibility !== "visible") return [];
    const owners = new Set(
      [canonicalOwner, ...Object.values(resolvedAddresses ?? {})]
        .filter(Boolean)
        .map((owner) => owner!.toLowerCase())
    );
    const seen = new Set<string>();
    return confirmedSettlements
      .filter((change) => {
        const key = `${change.asset.chain}:${change.asset.tokenId}`;
        if (
          change.synced ||
          !definition.chains.some((chain) => chain === change.asset.chain) ||
          !owners.has(change.to.toLowerCase()) ||
          seen.has(key) ||
          Date.now() - change.confirmedAt > optimisticSettlementLifetimeMs
        )
          return false;
        seen.add(key);
        return true;
      })
      .slice(-6);
  }, [
    confirmedSettlements,
    canonicalOwner,
    resolvedAddresses,
    activeVisibility,
    definition
  ]);
  useEffect(() => {
    syncSettlementsFromOwnerTokens(queries, indexedTokens);
  }, [queries, indexedTokens, confirmedSettlements]);

  async function copyAddress() {
    if (!canonicalOwner) return;
    await navigator.clipboard.writeText(canonicalOwner);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  function canManageToken(token: YunipalToken) {
    const tokenOwner = resolvedAddresses?.[token.chain] ?? canonicalOwner;
    return Boolean(
      isOwnCollection &&
        connectedAddressNormalized &&
        tokenOwner &&
        connectedAddressNormalized === tokenOwner.toLowerCase()
    );
  }

  function closeVisibilityDialog() {
    if (visibilityMutation.isPending) return;
    setVisibilityAction(null);
    visibilityMutation.clearFeedback();
  }

  async function confirmVisibilityAction() {
    if (!visibilityAction) return;

    try {
      await visibilityMutation.updateVisibility(visibilityAction);
      setVisibilityAction(null);
      await collection.restart();
    } catch {
      // Keep the dialog open so the mapped error and a fresh retry are visible.
    }
  }

  if (!validOwner) {
    return (
      <main className="mx-auto min-h-[65vh] max-w-4xl px-4 py-14">
        <QueryError message="Enter a valid wallet address or ENS name." />
        <Link
          to="/leaderboard"
          className="mt-5 inline-flex items-center gap-2 font-bold text-ethereum"
        >
          <ArrowLeft aria-hidden="true" size={15} /> Back to leaderboard
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-[70vh]">
      <section className="px-4 pb-3">
        <div className="mx-auto max-w-6xl">
          <h1 className="sr-only">
            {isOwnCollection ? `Your ${definition.label}` : definition.label}
          </h1>
          {!isOwnCollection && (
            <details className="group">
              <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-muted transition hover:bg-line/30 hover:text-ink [&::-webkit-details-marker]:hidden">
                <WalletCards aria-hidden="true" size={16} />
                Collector details
                <ChevronDown
                  aria-hidden="true"
                  size={15}
                  className="transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="pb-4 pt-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/leaderboard"
                    className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-line/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                  >
                    <ArrowLeft aria-hidden="true" size={15} /> Leaderboard
                  </Link>
                  {connectedAddressNormalized && (
                    <Link
                      to={personalCollectionHref(
                        connectedAddressNormalized,
                        edition
                      )}
                      className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                    >
                      <WalletCards aria-hidden="true" size={15} /> View my
                      collection
                    </Link>
                  )}
                </div>

                <div className="mt-4 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
                  <div className="min-w-0">
                    {ownerName && (
                      <p className="mt-5 truncate text-2xl font-black text-ink sm:text-3xl">
                        {ownerName}
                      </p>
                    )}
                    <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-ink break-all sm:hidden">
                        {shortAddress(canonicalOwner)}
                      </span>
                      <span className="hidden font-mono text-sm font-semibold text-ink break-all sm:block">
                        {canonicalOwner}
                      </span>
                      <button
                        type="button"
                        onClick={() => void copyAddress()}
                        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                        aria-label="Copy collector address"
                      >
                        {copied ? (
                          <Check aria-hidden="true" size={15} />
                        ) : (
                          <Copy aria-hidden="true" size={15} />
                        )}
                      </button>
                      <a
                        href={`${ownerExplorerUrl}/address/${canonicalOwner}`}
                        target="_blank"
                        rel="noreferrer"
                        className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                        aria-label={`View collector in the ${chainDetails[ownerExplorerChain].label} explorer`}
                      >
                        <ExternalLink aria-hidden="true" size={15} />
                      </a>
                    </div>
                    {resolvedAddresses &&
                      Object.entries(resolvedAddresses).length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {indexedChains.map((chain) => {
                            const resolvedAddress = resolvedAddresses[chain];
                            return (
                              resolvedAddress && (
                                <span
                                  key={chain}
                                  className="inline-flex items-center gap-2 rounded-full bg-line/40 px-3 py-1.5 text-xs font-bold text-muted"
                                  title={resolvedAddress}
                                >
                                  <ChainLogo
                                    chainId={chain}
                                    className={`h-3.5 w-3.5 ${chainDetails[chain].badgeClassName}`}
                                  />
                                  {chainDetails[chain].label} ·{" "}
                                  {shortAddress(resolvedAddress)}
                                </span>
                              )
                            );
                          })}
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </details>
          )}
        </div>
      </section>

      <section className="px-4 pb-16 pt-2 sm:pb-20">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <h2 className="sr-only">
                {activeVisibility === "hidden"
                  ? "Hidden NFTs"
                  : isOwnCollection
                    ? `Your ${definition.label}`
                    : definition.label}
              </h2>
              <p className="text-sm font-medium text-muted">
                Showing {formatInteger(tokens.length)} {activeVisibility}{" "}
                results on this page
                {isOwnCollection && activeVisibility === "visible" && (
                  <> · Hidden NFTs still count toward your score</>
                )}
              </p>
            </div>

            {isOwnCollection && (
              <div
                className="inline-flex self-start rounded-full border border-line bg-line/30 p-1 sm:self-auto"
                role="group"
                aria-label="NFT visibility"
              >
                <button
                  type="button"
                  onClick={() => {
                    visibilityMutation.clearFeedback();
                    setVisibilityView("visible");
                  }}
                  disabled={visibilityMutation.isPending}
                  aria-pressed={activeVisibility === "visible"}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition disabled:cursor-wait disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum",
                    activeVisibility === "visible"
                      ? "bg-white text-ink shadow-sm"
                      : "text-muted hover:text-ink"
                  )}
                >
                  <Eye aria-hidden="true" size={15} /> Visible NFTs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    visibilityMutation.clearFeedback();
                    setVisibilityView("hidden");
                  }}
                  disabled={visibilityMutation.isPending}
                  aria-pressed={activeVisibility === "hidden"}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition disabled:cursor-wait disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum",
                    activeVisibility === "hidden"
                      ? "bg-ink text-white shadow-sm"
                      : "text-muted hover:text-ink"
                  )}
                >
                  <EyeOff aria-hidden="true" size={15} /> Hidden NFTs
                </button>
              </div>
            )}
          </div>

          {collection.supported && (
            <CollectorControls
              key={`${ownerInput}:${edition}`}
              edition={edition}
              filters={filters}
              facets={facetsQuery.data}
              facetsLoading={facetsQuery.isLoading}
              facetsError={facetsQuery.isError}
              nameSearch={
                collection.capabilities.data?.namePrefixSearch === true
              }
              rarityRange={collection.capabilities.data?.rarityRange === true}
              onChange={setFilters}
              onRetryFacets={() => void facetsQuery.refetch()}
            />
          )}
          {collection.viewError && (
            <div
              className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4"
              role="alert"
            >
              <p className="text-sm text-red-800">{collection.viewError}</p>
              <button
                type="button"
                onClick={() => setFilters(defaultCollectorFilters)}
                className="mt-2 font-bold text-ethereum underline focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                Clear filters
              </button>
            </div>
          )}
          {collection.capabilities.isError && !collection.viewError && (
            <p className="mt-4 text-sm text-muted">
              Collection filters are temporarily unavailable.{" "}
              <button
                type="button"
                onClick={() => void collection.capabilities.refetch()}
                className="font-bold text-ethereum underline"
              >
                Retry
              </button>
            </p>
          )}
          {pendingPurchases.length > 0 && (
            <div
              className="mt-5 rounded-2xl border border-ethereum/15 bg-ethereum/5 p-4"
              role="status"
            >
              <p className="text-sm font-bold text-ink">
                Recently acquired — updating collection
              </p>
              <div className="mt-2 flex flex-wrap gap-3">
                {pendingPurchases.map((change) => (
                  <Link
                    key={change.id}
                    to={`/collection/${change.asset.chain}/${change.asset.tokenId}`}
                    className="text-sm font-semibold text-ethereum underline"
                  >
                    {change.token?.name || `Yunipal #${change.asset.tokenId}`} ·{" "}
                    {chainDetails[change.asset.chain].label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {visibilityMutation.notice && (
            <div
              className={cn(
                "mt-5 rounded-2xl border px-5 py-4 text-sm font-semibold",
                visibilityMutation.isError
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
              )}
              role={visibilityMutation.isError ? "alert" : "status"}
            >
              {visibilityMutation.notice}
            </div>
          )}

          {tokens.length > 0 &&
            (collection.viewError || tokensQuery.isError) && (
              <p role="alert" className="mt-4 text-sm text-muted">
                {collection.viewError ??
                  "Some original collection results could not be loaded."}
              </p>
            )}
          <div
            className="mt-7"
            aria-busy={collection.loading || tokensQuery.isFetching}
          >
            {collection.viewError &&
            tokens.length === 0 ? null : collection.loading &&
              tokens.length === 0 ? (
              <TokenGridSkeleton count={12} variant="token" />
            ) : tokensQuery.isError && tokens.length === 0 ? (
              <QueryError
                message={
                  collection.cursorError
                    ? "This page has expired. Refresh to start from the first page."
                    : collectorErrorMessage(tokensQuery.error)
                }
                onRetry={() =>
                  collection.cursorError
                    ? void collection.restart()
                    : void tokensQuery.refetch()
                }
              />
            ) : tokens.length === 0 ? (
              <CollectionEmptyState
                edition={edition}
                title={
                  filtered
                    ? "No matches"
                    : activeVisibility === "hidden"
                      ? "No hidden NFTs"
                      : `No ${definition.label} holdings`
                }
                description={
                  filtered
                    ? "Try another search or clear your filters."
                    : activeVisibility === "hidden"
                      ? "NFTs you hide will appear here so you can unhide them."
                      : "This wallet has no visible NFTs in this collection. Explore the collection or choose another view."
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {tokens.map((token, index) => (
                  <TokenCard
                    key={tokenKey(token)}
                    token={token}
                    eager={index < 6}
                    action={
                      canManageToken(token) ? (
                        <button
                          type="button"
                          onClick={() => {
                            visibilityMutation.clearFeedback();
                            setVisibilityAction({
                              token,
                              hidden: activeVisibility === "visible"
                            });
                          }}
                          disabled={
                            visibilityMutation.isPending ||
                            tokensQuery.isFetching
                          }
                          className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white/95 text-ink shadow-sm backdrop-blur transition hover:bg-white hover:text-ethereum disabled:cursor-wait disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2"
                          aria-label={`${
                            activeVisibility === "visible" ? "Hide" : "Unhide"
                          } ${token.name || `Yunipal #${token.tokenId}`}`}
                          title={
                            activeVisibility === "visible"
                              ? "Hide NFT"
                              : "Unhide NFT"
                          }
                        >
                          {visibilityMutation.isPending &&
                          visibilityMutation.pendingTokenKey ===
                            tokenKey(token) ? (
                            <Loader2
                              aria-hidden="true"
                              className="animate-spin"
                              size={15}
                            />
                          ) : activeVisibility === "visible" ? (
                            <EyeOff aria-hidden="true" size={15} />
                          ) : (
                            <Eye aria-hidden="true" size={15} />
                          )}
                        </button>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {!collection.viewError && !collection.loading && (
            <nav
              className="mt-7 flex flex-wrap items-center justify-center gap-3"
              aria-label="Original collection pages"
            >
              <button
                type="button"
                onClick={collection.previous}
                disabled={
                  !collection.hasPrevious ||
                  tokensQuery.isFetching ||
                  visibilityMutation.isPending
                }
                className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-5 py-3 text-sm font-bold text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                <ChevronLeft aria-hidden="true" size={16} /> Previous
              </button>
              <button
                type="button"
                onClick={() => void collection.restart()}
                disabled={
                  tokensQuery.isFetching || visibilityMutation.isPending
                }
                className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-3 text-sm font-bold text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                <RefreshCw
                  aria-hidden="true"
                  size={15}
                  className={cn(tokensQuery.isFetching && "animate-spin")}
                />{" "}
                Refresh
              </button>
              <button
                type="button"
                onClick={collection.next}
                disabled={
                  !collection.hasNext ||
                  tokensQuery.isFetching ||
                  visibilityMutation.isPending
                }
                className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                Next <ChevronRight aria-hidden="true" size={16} />
              </button>
              {tokensQuery.isError && tokens.length > 0 && (
                <p
                  role="alert"
                  className="w-full text-center text-sm text-red-700"
                >
                  Could not refresh this page. Your previous results are shown.
                </p>
              )}
            </nav>
          )}
        </div>
      </section>

      {visibilityAction && (
        <VisibilityActionDialog
          token={visibilityAction.token}
          hidden={visibilityAction.hidden}
          pending={visibilityMutation.isPending}
          stage={visibilityMutation.stage}
          errorMessage={visibilityMutation.errorMessage}
          onConfirm={() => void confirmVisibilityAction()}
          onClose={closeVisibilityDialog}
        />
      )}
    </main>
  );
}
