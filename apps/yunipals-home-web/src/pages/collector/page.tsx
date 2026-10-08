import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  EyeOff,
  ExternalLink,
  Gem,
  Layers3,
  Loader2,
  Sparkles,
  Star,
  Trophy,
  WalletCards
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { environment } from "@/environment";
import { CollectorIslands } from "./components/CollectorIslands";

import { trackAnalyticsEvent } from "@/lib/analytics/index";

import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import { TokenCard } from "@/components/TokenCard";
import { ChainLogo } from "@/components/ui/ChainLogo";
import { chainDetails } from "@/data/chains";
import { useConfirmedSettlements } from "@/hooks/marketplace/useConfirmedSettlements";
import {
  formatDecimal,
  formatInteger,
  formatUpdatedAt,
  shortAddress
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import {
  optimisticSettlementLifetimeMs,
  syncSettlementsFromOwnerTokens
} from "@/lib/marketplace/confirmedSettlements";
import { VisibilityActionDialog } from "@/pages/collector/components/VisibilityActionDialog";
import { useTokenVisibility } from "@/pages/collector/hooks/useTokenVisibility";
import {
  fetchOwnerLeaderboard,
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
  defaultCollectorFilters,
  hasCollectorFilters,
  parseCollectorFilters,
  serializeCollectorFilters,
  type CollectorFilters
} from "@/lib/collector";

type MetricCardProps = {
  label: string;
  value: string;
  rank: number;
  icon: typeof Trophy;
};

type VisibilityView = Extract<TokenVisibility, "visible" | "hidden">;

type VisibilityAction = {
  token: YunipalToken;
  hidden: boolean;
};

function MetricCard({ label, value, rank, icon: Icon }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-ethereum/10 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Icon aria-hidden="true" className="text-ethereum" size={17} />
        <span className="whitespace-nowrap rounded-full bg-ethereum/10 px-2.5 py-1 text-xs font-black text-ethereum">
          Rank #{formatInteger(rank)}
        </span>
      </div>
      <p className="mt-6 text-2xl font-black text-ink">{value}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">
        {label}
      </p>
    </div>
  );
}

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
  const islands =
    environment.islandStakingEnabled && params.get("collection") === "islands";
  return (
    <>
      {environment.islandStakingEnabled && (
        <nav
          aria-label="Collector collections"
          className="mx-auto flex max-w-6xl gap-3 px-4 pt-6"
        >
          <Link
            to={`/collector/${encodeURIComponent(address)}`}
            aria-current={!islands ? "page" : undefined}
            className="rounded-full border border-line px-5 py-2 font-bold text-ink aria-[current=page]:bg-mint/40"
          >
            Yunipals
          </Link>
          <Link
            to={`/collector/${encodeURIComponent(address)}?collection=islands`}
            aria-current={islands ? "page" : undefined}
            className="rounded-full border border-line px-5 py-2 font-bold text-ink aria-[current=page]:bg-mint/40"
          >
            Islands
          </Link>
        </nav>
      )}
      {islands ? (
        <CollectorIslands ownerInput={address.trim()} />
      ) : (
        <YunipalsCollectorPage />
      )}
    </>
  );
}

function YunipalsCollectorPage() {
  const { address = "" } = useParams();
  const { address: connectedAddress, isConnected } = useAccount();
  const ownerInput = address.trim();
  const [searchParams, setSearchParams] = useSearchParams();
  const filterState = useMemo(() => {
    try {
      return { filters: parseCollectorFilters(searchParams), error: null };
    } catch (error) {
      return {
        filters: defaultCollectorFilters,
        error:
          error instanceof Error ? error.message : "Invalid collection filters."
      };
    }
  }, [searchParams]);
  const { filters } = filterState;
  const setFilters = useCallback(
    (next: CollectorFilters) => {
      trackAnalyticsEvent("Collection Filter Applied", {
        collection: "yunipals",
        filter: "filters"
      });
      setSearchParams(serializeCollectorFilters(next));
    },
    [setSearchParams]
  );
  const validOwner = isOwnerInput(ownerInput);
  const inputIsEns = validOwner && !isEthereumAddress(ownerInput);
  const connectedAddressNormalized = connectedAddress?.toLowerCase();
  const [copied, setCopied] = useState(false);
  const [visibilityView, setVisibilityView] =
    useState<VisibilityView>("visible");
  const [visibilityAction, setVisibilityAction] =
    useState<VisibilityAction | null>(null);
  const visibilityMutation = useTokenVisibility(ownerInput);
  const confirmedSettlements = useConfirmedSettlements();
  const queries = useQueryClient();

  const profileQuery = useQuery({
    enabled: validOwner,
    queryKey: [
      "collector",
      indexedCollectionCacheVersion,
      ownerInput,
      "leaderboard"
    ],
    queryFn: ({ signal }) => fetchOwnerLeaderboard(ownerInput, {}, signal),
    retry: (count, error) =>
      !(error instanceof IndexerError && error.status === 404) && count < 1,
    refetchInterval: 60_000
  });
  const profileOwner =
    profileQuery.data?.owner ??
    (isEthereumAddress(ownerInput) ? ownerInput : "");
  const profileResolvedAddresses = profileQuery.data?.resolvedAddresses;
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
    filterState.error
  );
  const { tokensQuery } = collection;
  const facetsQuery = useQuery({
    queryKey: ["collection", indexedCollectionCacheVersion, "trait-facets", []],
    queryFn: ({ signal }) => fetchTraitFacets([], signal),
    enabled: collection.supported,
    staleTime: 10 * 60_000
  });

  const ownerTokens = tokensQuery.data;
  const canonicalOwner =
    profileQuery.data?.owner ??
    ownerTokens?.owner ??
    (isEthereumAddress(ownerInput) ? ownerInput : "");
  const ownerName =
    profileQuery.data?.ensName ??
    profileQuery.data?.ownerName ??
    ownerTokens?.ownerName ??
    (inputIsEns ? ownerInput : null);
  const resolvedAddresses =
    profileQuery.data?.resolvedAddresses ?? ownerTokens?.resolvedAddresses;
  const ownerExplorerChain =
    indexedChains.find(
      (chain) =>
        resolvedAddresses?.[chain]?.toLowerCase() ===
        canonicalOwner.toLowerCase()
    ) ?? "ethereum";
  const ownerExplorerUrl = chainDetails[ownerExplorerChain].explorerUrl;

  usePageMetadata(
    isOwnCollection
      ? "Your Yunipals Collection"
      : validOwner
        ? `${ownerName ?? shortAddress(canonicalOwner || ownerInput)} — Yunipals Collector`
        : "Collector — Yunipals",
    isOwnCollection
      ? "View your Yunipals collection across Ethereum, Base, Polygon, and BNB Chain, collector score, and leaderboard ranks."
      : "View a wallet's Yunipals collection across Ethereum, Base, Polygon, and BNB Chain, collector score, and leaderboard ranks."
  );

  const indexedTokens = useMemo(
    () => tokensQuery.data?.items ?? [],
    [tokensQuery.data]
  );
  const tokens = indexedTokens;
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
    activeVisibility
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

  const profile = profileQuery.data;

  return (
    <main className="min-h-[70vh]">
      <section className="bg-gradient-to-b from-lavender/35 to-white px-4 py-12 sm:py-16">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-wrap items-center gap-2">
            {isOwnCollection && (
              <Link
                to="/orders"
                className="inline-flex items-center rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink focus-visible:ring-2 focus-visible:ring-ink"
              >
                Manage my orders
              </Link>
            )}
            <Link
              to="/leaderboard"
              className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-line/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
            >
              <ArrowLeft aria-hidden="true" size={15} /> Leaderboard
            </Link>
            {connectedAddressNormalized && !isOwnCollection && (
              <Link
                to={`/collector/${connectedAddressNormalized}`}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
              >
                <WalletCards aria-hidden="true" size={15} /> View my collection
              </Link>
            )}
          </div>

          <div className="mt-8 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-ethereum">
                {isOwnCollection
                  ? "Your multichain collection"
                  : "Multichain collector"}
              </p>
              <h1 className="display mt-3 text-5xl text-ink sm:text-7xl">
                {isOwnCollection ? "Your collection" : "Collector profile"}
              </h1>
              {ownerName && (
                <p className="mt-5 truncate text-2xl font-black text-ink sm:text-3xl">
                  {ownerName}
                </p>
              )}
              <div className="mt-5 flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded-full border border-line bg-white px-4 py-2 font-mono text-sm font-semibold text-ink shadow-sm sm:hidden">
                  {shortAddress(canonicalOwner)}
                </span>
                <span className="hidden rounded-full border border-line bg-white px-4 py-2 font-mono text-sm font-semibold text-ink shadow-sm sm:block">
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

            {profile && (
              <section
                aria-label="Collector score summary"
                className="rounded-[28px] bg-ink px-6 py-5 text-white shadow-cardHover sm:min-w-72"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wide text-white/55">
                      Collector score
                    </p>
                    <p className="mt-2 text-4xl font-black tabular-nums">
                      {formatDecimal(profile.collectorScore, 0)}
                    </p>
                  </div>
                  <div
                    className="grid min-h-14 min-w-14 shrink-0 place-items-center whitespace-nowrap rounded-full bg-white/10 px-4 text-xl font-black tabular-nums"
                    aria-label={`Collector rank ${formatInteger(profile.collectorScoreRank)}`}
                  >
                    #{formatInteger(profile.collectorScoreRank)}
                  </div>
                </div>
                <p className="mt-4 text-xs font-semibold text-white/55">
                  {formatUpdatedAt(profile.updatedAt)}
                </p>
              </section>
            )}
          </div>

          {profile ? (
            <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3">
              <MetricCard
                icon={Gem}
                label="Total rarity"
                value={formatDecimal(profile.totalRarity, 1)}
                rank={profile.totalRarityRank}
              />
              <MetricCard
                icon={Layers3}
                label="Monster count"
                value={formatInteger(profile.monsterCount)}
                rank={profile.monsterCountRank}
              />
              <MetricCard
                icon={Trophy}
                label="Unique types"
                value={formatInteger(profile.uniqueTypes)}
                rank={profile.uniqueTypesRank}
              />
              <MetricCard
                icon={Star}
                label="Special count"
                value={formatInteger(profile.specialCount)}
                rank={profile.specialCountRank}
              />
              <MetricCard
                icon={Sparkles}
                label="Glitter count"
                value={formatInteger(profile.glitterCount)}
                rank={profile.glitterCountRank}
              />
              <MetricCard
                icon={Trophy}
                label="Collector score"
                value={formatDecimal(profile.collectorScore, 0)}
                rank={profile.collectorScoreRank}
              />
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted" role="status">
              {profileQuery.isLoading
                ? "Loading rankings…"
                : profileQuery.error instanceof IndexerError &&
                    profileQuery.error.status === 404
                  ? "Rankings are updating."
                  : "Rankings are temporarily unavailable."}
              {profileQuery.isError && (
                <button
                  type="button"
                  className="ml-2 rounded-full font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
                  onClick={() => void profileQuery.refetch()}
                >
                  Try again
                </button>
              )}
            </p>
          )}
        </div>
      </section>

      <section className="px-4 pb-16 pt-6 sm:pb-20">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-ethereum">
                Holdings
              </p>
              <h2 className="display mt-2 text-3xl text-ink sm:text-4xl">
                {activeVisibility === "hidden"
                  ? "Hidden NFTs"
                  : isOwnCollection
                    ? "Your active Yunipals"
                    : "Active Yunipals"}
              </h2>
              <p className="mt-2 text-sm font-medium text-muted">
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
              key={ownerInput}
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

          <div
            className="mt-7"
            aria-busy={collection.loading || tokensQuery.isFetching}
          >
            {collection.viewError ? null : collection.loading &&
              tokens.length === 0 ? (
              <TokenGridSkeleton count={12} />
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
              <div className="rounded-card border border-dashed border-line px-6 py-14 text-center">
                {activeVisibility === "hidden" ? (
                  <EyeOff
                    aria-hidden="true"
                    className="mx-auto text-muted"
                    size={28}
                  />
                ) : (
                  <Eye
                    aria-hidden="true"
                    className="mx-auto text-muted"
                    size={28}
                  />
                )}
                <p className="mt-3 font-bold text-ink">
                  {hasCollectorFilters(filters)
                    ? "No matches"
                    : activeVisibility === "hidden"
                      ? "No hidden NFTs"
                      : "No visible Yunipals"}
                </p>
                <p className="mx-auto mt-1 max-w-lg text-sm text-muted">
                  {hasCollectorFilters(filters)
                    ? "Try a different search or clear your filters to see more Yunipals."
                    : activeVisibility === "hidden"
                      ? "NFTs you hide from public Yunipals views will appear here so you can unhide them."
                      : "This wallet does not currently have any publicly visible Yunipals."}
                </p>
              </div>
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
              aria-label="Collection pages"
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
