import {
  useInfiniteQuery,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Filter,
  Loader2,
  Search,
  Users,
  X
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams
} from "react-router-dom";

import { useAccount } from "wagmi";

import {
  ChainFilter,
  CollectionFilterPanel,
  MobileFilterDrawer
} from "@/components/CollectionFilters";
import { QueryError, TokenGridSkeleton } from "@/components/QueryState";
import { TokenArtwork } from "@/components/TokenArtwork";
import { TokenCard } from "@/components/TokenCard";
import { TradeReviewDialog } from "@/components/marketplace/TradeReviewDialog";
import { useTradingConsent } from "@/components/marketplace/TradingConsentProvider";
import { CatalogCardMarket } from "@/components/marketplace/CatalogCardMarket";
import { TokenMarketPanel } from "@/components/marketplace/TokenMarketPanel";
import { ChainBadge } from "@/components/ui/ChainBadge";
import { ChainLogo } from "@/components/ui/ChainLogo";
import {
  chainDetails as evmChainDetails,
  collectionChainDetails as chainDetails
} from "@/data/chains";
import { environment } from "@/environment";
import { isSolanaAddress } from "@/lib/solanaIndexer";
import {
  collectionBrowserCacheVersion,
  collectionTokenKey,
  fetchCollectionFacets,
  fetchCollectionPage,
  type CollectionContinuation
} from "@/lib/collectionBrowser";
import { useMarketCatalog } from "@/hooks/marketplace/useMarketCatalog";
import { useMarketplace } from "@/hooks/marketplace/useMarketplace";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_TITLE,
  usePageMetadata
} from "@/hooks/usePageMetadata";
import {
  clearCollectionFilters,
  clearMarketFilters,
  cloneCollectionFilters,
  collectionFiltersKey,
  countCollectionFilters,
  hasMarketFilters,
  isPriceSort,
  parseCollectionFilters,
  priceCurrencyForFilters,
  serializeCollectionFilters,
  updateCollectionChains,
  includesSolana,
  toEvmCollectionFilters,
  type CollectionChain,
  type CollectionSort,
  type CollectionFilters
} from "@/lib/collectionBrowserFilters";
import type { MarketOrder } from "@/lib/marketplace/marketApi";
import { catalogCurrencies } from "@/lib/marketplace/catalogCurrency";
import { MarketActivity } from "@/components/marketplace/MarketActivity";
import { marketplaceAssetKey } from "@/lib/marketplace/registry";
import { formatDecimal, formatInteger, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  fetchToken,
  getDisplayedRarity,
  hasRarityCap,
  IndexerError,
  isIndexedChain,
  isOwnerInput,
  type IndexedChain,
  type TokenAttribute
} from "@/lib/yunipalsIndexer";

import { CollectionTabs } from "./CollectionTabs";
import { IslandDetail } from "./islands/IslandDetail";
import { IslandsExplorer } from "./islands/IslandsExplorer";

function attributeValue(attribute: TokenAttribute) {
  if (
    attribute.display_type === "date" &&
    typeof attribute.value === "number"
  ) {
    return new Date(attribute.value * 1000).toLocaleDateString();
  }
  if (attribute.value === null || attribute.value === undefined)
    return "Unknown";
  return String(attribute.value);
}

function TokenDetail({
  chain,
  tokenId
}: {
  chain: IndexedChain;
  tokenId: string;
}) {
  const navigate = useNavigate();
  const validTokenId = /^\d+$/.test(tokenId);
  const chainConfig = evmChainDetails[chain];
  const chainLabel = chainConfig.label;
  const explorerUrl = chainConfig.explorerUrl;
  const detailQuery = useQuery({
    enabled: validTokenId,
    queryKey: ["collection", "token", chain, tokenId],
    queryFn: ({ signal }) => fetchToken(chain, tokenId, signal)
  });

  usePageMetadata(
    detailQuery.data?.token.name
      ? `${detailQuery.data.token.name} #${tokenId} on ${chainLabel} — Yunipals`
      : `Yunipal #${tokenId} on ${chainLabel}`
  );

  if (!validTokenId) {
    return (
      <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12">
        <QueryError message="That token ID is not valid." />
        <Link
          to={`/?chain=${chain}`}
          className="mt-5 inline-flex font-bold text-ethereum"
        >
          Back to the collection
        </Link>
      </main>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="aspect-square animate-pulse rounded-[32px] bg-line/65" />
          <div className="space-y-4 py-6" aria-hidden="true">
            <div className="h-5 w-1/4 animate-pulse rounded bg-line" />
            <div className="h-14 w-3/4 animate-pulse rounded bg-line" />
            <div className="h-28 animate-pulse rounded bg-line/65" />
          </div>
        </div>
      </main>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12">
        <QueryError
          message="This Yunipal could not be found."
          onRetry={() => void detailQuery.refetch()}
        />
      </main>
    );
  }

  const { token, transfers } = detailQuery.data;
  const description =
    typeof token.description === "string" ? token.description : null;
  const displayedRarity = getDisplayedRarity(token);
  const rarityIsCapped = hasRarityCap(token);
  const visibleAttributes = (token.attributes ?? []).filter(
    (attribute) =>
      !["rarity points", "rarity points capped", "rarity capped"].includes(
        attribute.trait_type.toLowerCase()
      )
  );
  return (
    <main className="min-h-[65vh] bg-gradient-to-b from-lavender/25 to-white px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <button
          type="button"
          onClick={() =>
            window.history.length > 1
              ? navigate(-1)
              : navigate(`/?chain=${chain}`)
          }
          className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-line/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
        >
          <ArrowLeft aria-hidden="true" size={15} /> Back
        </button>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] lg:items-start">
          <div className="overflow-hidden rounded-[32px] border-8 border-white bg-white shadow-cardHover">
            <div className="aspect-square">
              <TokenArtwork
                src={token.image}
                alt={token.name || `Yunipal #${token.tokenId}`}
                eager
              />
            </div>
          </div>

          <div className="py-2">
            <div className="flex flex-wrap items-center gap-2">
              <ChainBadge chainId={chain} variant="soft" />
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-muted">
                #{token.tokenId}
              </span>
            </div>
            <h1 className="display mt-3 text-4xl text-ink sm:text-6xl">
              {token.name || "Unknown Yunipal"}
            </h1>
            {description && (
              <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-ink/65">
                {description}
              </p>
            )}
            {token.metadataAvailable === false && (
              <p
                className="mt-5 max-w-2xl rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-relaxed text-amber-900"
                role="status"
              >
                Metadata is currently unavailable for this Yunipal. Its on-chain
                identity, owner, and transfer history are still shown below.
              </p>
            )}

            <div className="mt-7 rounded-card border border-line bg-white p-5 shadow-card">
              <p className="text-xs font-bold uppercase tracking-wide text-muted">
                Current collector
              </p>
              <Link
                to={`/collector/${token.owner}`}
                className="mt-2 flex items-center justify-between gap-4 rounded-xl bg-line/30 px-4 py-3 font-bold text-ink transition hover:bg-lavender/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                <span className="truncate sm:hidden">
                  {shortAddress(token.owner)}
                </span>
                <span className="hidden truncate sm:block">{token.owner}</span>
                <ArrowRight aria-hidden="true" className="shrink-0" size={16} />
              </Link>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {displayedRarity !== null && (
                <div className="rounded-2xl border border-ethereum/10 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    Rarity Points
                  </p>
                  <p className="mt-2 break-words text-sm font-extrabold text-ink">
                    {formatDecimal(displayedRarity, 4)}
                  </p>
                </div>
              )}
              {rarityIsCapped && token.rarityPoints !== null && (
                <div className="rounded-2xl border border-ethereum/10 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    Raw rarity
                  </p>
                  <p className="mt-2 break-words text-sm font-extrabold text-ink">
                    {formatDecimal(token.rarityPoints, 4)}
                  </p>
                </div>
              )}
              {visibleAttributes.map((attribute) => (
                <div
                  key={attribute.trait_type}
                  className="rounded-2xl border border-ethereum/10 bg-white p-4 shadow-sm"
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                    {attribute.trait_type}
                  </p>
                  <p className="mt-2 break-words text-sm font-extrabold text-ink">
                    {attributeValue(attribute)}
                  </p>
                </div>
              ))}
            </div>

            <TokenMarketPanel token={token} />

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={`${explorerUrl}/address/${token.contractAddress}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                Contract <ExternalLink aria-hidden="true" size={14} />
              </a>
              {token.tokenUri && (
                <a
                  href={token.tokenUri}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                >
                  Metadata <ExternalLink aria-hidden="true" size={14} />
                </a>
              )}
              {transfers.at(-1) && (
                <a
                  href={`${explorerUrl}/tx/${transfers.at(-1)?.transaction_hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                >
                  Latest transfer <ExternalLink aria-hidden="true" size={14} />
                </a>
              )}
            </div>
          </div>
        </div>

        <MarketActivity scope={{ kind: "asset", asset: token }} />

        <section className="mt-12">
          <h2 className="display text-3xl text-ink">Transfer history</h2>
          <div className="mt-5 overflow-hidden rounded-card border border-line bg-white shadow-card">
            {transfers.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm font-medium text-muted">
                No transfers have been indexed for this lifecycle.
              </p>
            ) : (
              transfers
                .slice()
                .reverse()
                .map((transfer) => (
                  <a
                    key={transfer.id}
                    href={`${explorerUrl}/tx/${transfer.transaction_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="grid gap-2 border-b border-line px-5 py-4 text-sm transition last:border-0 hover:bg-line/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ethereum sm:grid-cols-[1fr_auto]"
                  >
                    <span className="min-w-0 font-semibold text-ink">
                      {shortAddress(transfer.from)} →{" "}
                      {shortAddress(transfer.to)}
                    </span>
                    <span className="text-xs font-medium text-muted">
                      {new Date(
                        Number(transfer.block_timestamp) * 1000
                      ).toLocaleString()}{" "}
                      · Block {formatInteger(transfer.block_number)}
                    </span>
                  </a>
                ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

const SORT_OPTIONS: Array<{ value: CollectionSort; label: string }> = [
  { value: "rarity-capped-desc", label: "Rarity: high to low" },
  { value: "rarity-capped-asc", label: "Rarity: low to high" },
  { value: "rarity-desc", label: "Raw rarity: high to low" },
  { value: "rarity-asc", label: "Raw rarity: low to high" },
  { value: "token-id-asc", label: "Token ID: low to high" },
  { value: "token-id-desc", label: "Token ID: high to low" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" }
];

type CollectionPresentation = {
  eyebrow: string;
  title: string;
  description: string;
  pageTitle: string;
  pageDescription: string;
  backgroundClassName: string;
  accentClassName: string;
};

const COLLECTION_PRESENTATION: Record<
  CollectionChain | "all",
  CollectionPresentation
> = {
  all: {
    eyebrow: `Ethereum + Base + Polygon + BNB Chain${environment.exomonEnabled ? " + Solana" : ""}`,
    title: "Yunipals across chains.",
    description: `Explore active Yunipals${environment.exomonEnabled ? " and Exomon" : ""} across chains, combine traits to discover rare sets, or search a token and collector. Burned NFTs are excluded.`,
    pageTitle: DEFAULT_TITLE,
    pageDescription: DEFAULT_DESCRIPTION,
    backgroundClassName:
      "bg-gradient-to-br from-lavender/45 via-white to-sky/45",
    accentClassName: "text-grape"
  },
  solana: {
    eyebrow: "Solana · Exomon",
    title: "Exomon on Solana.",
    description:
      "Explore active Exomon, compare rarity and traits, and find their current collectors. Ownership reflects the latest completed index scan.",
    pageTitle: "Exomon on Solana — Yunipals",
    pageDescription:
      "Browse active Exomon on Solana alongside the Yunipals collection.",
    backgroundClassName:
      "bg-gradient-to-br from-sky/45 via-white to-lavender/45",
    accentClassName: "text-grape"
  },
  ethereum: {
    eyebrow: "Ethereum OG",
    title: "The original collection.",
    description:
      "Explore active Ethereum OG Yunipals, combine traits to discover rare sets, or search a token and collector. Burned NFTs are excluded.",
    pageTitle: "Ethereum OG Collection — Yunipals",
    pageDescription:
      "Browse active Yunipals OG NFTs on Ethereum, inspect traits, and find collections by wallet.",
    backgroundClassName: "bg-panel-ethereum",
    accentClassName: "text-ethereum"
  },
  base: {
    eyebrow: "Base collection",
    title: "Together on Base.",
    description:
      "Explore the Yunipals brought together on Base, combine traits to discover rare sets, or search a token and collector.",
    pageTitle: "Base Collection — Yunipals",
    pageDescription:
      "Browse active Yunipals on Base, inspect traits, and find collections by wallet.",
    backgroundClassName: "bg-panel-base",
    accentClassName: "text-basechain"
  },
  polygon: {
    eyebrow: "Polygon OG",
    title: "The multichain era.",
    description:
      "Explore active Polygon OG Yunipals, combine traits to discover rare sets, or search a token and collector. Burned NFTs are excluded.",
    pageTitle: "Polygon OG Collection — Yunipals",
    pageDescription:
      "Browse active Yunipals OG NFTs on Polygon, inspect traits, and find collections by wallet.",
    backgroundClassName: "bg-panel-polygon",
    accentClassName: "text-polygon"
  },
  bnb: {
    eyebrow: "BNB Chain OG",
    title: "A vast Yuni world.",
    description:
      "Explore active BNB Chain OG Yunipals, combine traits to discover rare sets, or search a token and collector. Burned NFTs are excluded.",
    pageTitle: "BNB Chain OG Collection — Yunipals",
    pageDescription:
      "Browse active Yunipals OG NFTs on BNB Chain, inspect traits, and find collections by wallet.",
    backgroundClassName: "bg-panel-bnb",
    accentClassName: "text-bnbchain"
  }
};

function CollectionExplorer() {
  const { requestTradingConsent } = useTradingConsent();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => parseCollectionFilters(searchParams),
    [searchParams]
  );
  const filtersKey = collectionFiltersKey(filters);
  const currencyLabel =
    filters.chains.length === 1 && isIndexedChain(filters.chains[0])
      ? catalogCurrencies(filters.chains[0]).find(
          (currency) => currency.key === filters.currency
        )?.symbol
      : undefined;
  const activeFilterCount = countCollectionFilters(filters);
  const selectedChain =
    filters.chains.length === 1 ? filters.chains[0] : undefined;
  const presentation = useMemo<CollectionPresentation>(() => {
    if (filters.chains.length <= 1) {
      return COLLECTION_PRESENTATION[filters.chains[0] ?? "all"];
    }

    const labels = filters.chains.map((chain) => chainDetails[chain].label);
    const labelList = labels.join(", ");
    return {
      ...COLLECTION_PRESENTATION.all,
      eyebrow: labels.join(" + "),
      title: "Yunipals across selected chains.",
      description: `Explore active Yunipals across ${labelList}, combine traits to discover rare sets, or search a collector. Burned NFTs are excluded.`,
      pageTitle: `${labels.join(", ")} Collection — Yunipals`,
      pageDescription: `Browse active Yunipals across ${labelList}, inspect traits, and find collections by wallet.`
    };
  }, [filters.chains]);
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const { address } = useAccount();
  const queries = useQueryClient();
  const { capabilities } = useMarketplace(null);
  const withSolana = includesSolana(filters);
  const catalog = useMarketCatalog(
    toEvmCollectionFilters(filters),
    !withSolana
  );
  const marketFiltered = hasMarketFilters(filters);
  const useLegacy =
    withSolana ||
    (!marketFiltered &&
      !catalog.validationError &&
      (!catalog.configured || (catalog.query.isError && !catalog.query.data)));
  const [selectedTrade, setSelectedTrade] = useState<{
    order: MarketOrder;
    name: string;
    trigger: HTMLElement;
  } | null>(null);
  useEffect(() => setSelectedTrade(null), [address, filtersKey]);

  const setFilters = useCallback(
    (nextFilters: CollectionFilters) => {
      setSelectedTrade(null);
      setSearchParams(
        serializeCollectionFilters(
          updateCollectionChains(filters, nextFilters)
        ),
        {
          replace: true
        }
      );
    },
    [setSearchParams, filters]
  );
  const closeMobileFilters = useCallback(() => setMobileFiltersOpen(false), []);

  usePageMetadata(presentation.pageTitle, presentation.pageDescription);

  const facetsQuery = useQuery({
    queryKey: [
      "collection",
      collectionBrowserCacheVersion,
      "trait-facets",
      filters.chains
    ],
    queryFn: ({ signal }) => fetchCollectionFacets(filters.chains, signal),
    staleTime: 60_000
  });
  const legacyTokensQuery = useInfiniteQuery({
    enabled: useLegacy && !marketFiltered,
    queryKey: [
      "collection",
      collectionBrowserCacheVersion,
      "tokens",
      filtersKey
    ],
    queryFn: ({ pageParam, signal }) =>
      fetchCollectionPage(filters, pageParam, signal),
    initialPageParam: undefined as CollectionContinuation | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 60_000,
    retry: (count, error) =>
      !(error instanceof IndexerError && error.status < 500) && count < 1
  });

  const catalogItems = useMemo(
    () => catalog.query.data?.pages.flatMap((page) => page.items) ?? [],
    [catalog.query.data]
  );
  const marketByAsset = useMemo(
    () =>
      new Map(
        catalogItems.map((item) => [
          marketplaceAssetKey(item.token),
          item.market
        ])
      ),
    [catalogItems]
  );
  const tokens = useMemo(() => {
    const seen = new Set<string>();
    const rows = useLegacy
      ? (legacyTokensQuery.data?.pages.flatMap((page) => page.items) ?? [])
      : catalogItems.map((item) => item.token);
    return rows.filter((token) => {
      const identity = collectionTokenKey(token);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }, [useLegacy, legacyTokensQuery.data, catalogItems]);
  const tokensQuery = useLegacy ? legacyTokensQuery : catalog.query;
  const totalMatches = tokensQuery.data?.pages[0]?.total;
  const catalogPage = !useLegacy ? catalog.query.data?.pages[0] : undefined;
  const incompleteEmptyResults =
    marketFiltered &&
    catalogPage !== undefined &&
    catalogPage.listingCompleteness !== "complete" &&
    tokens.length === 0;
  const catalogError =
    (withSolana && marketFiltered
      ? "Select an EVM chain to use sale and price filters. Exomon browsing is read-only."
      : null) ||
    catalog.validationError ||
    (marketFiltered && !catalog.configured
      ? "Sale and price filters are not available yet. Clear those filters to browse the collection."
      : null);
  function refreshCatalog() {
    setSelectedTrade(null);
    void queries.resetQueries({ queryKey: catalog.queryKey, exact: true });
    if (useLegacy)
      void queries.resetQueries({
        queryKey: [
          "collection",
          collectionBrowserCacheVersion,
          "tokens",
          filtersKey
        ],
        exact: true
      });
    void capabilities.refetch();
  }

  function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = lookup.trim();
    if (environment.exomonEnabled && isSolanaAddress(value)) {
      setLookupError("");
      navigate(`/collection/solana/${value}`);
      return;
    }
    if (/^\d+$/.test(value)) {
      if (selectedChain === "solana") {
        setLookupError(
          "Enter the Solana mint address. Use Find collector to search a wallet."
        );
        return;
      }
      if (!selectedChain) {
        setLookupError(
          "Choose exactly one chain before looking up a token ID."
        );
        return;
      }
      setLookupError("");
      navigate(`/collection/${selectedChain}/${value}`);
      return;
    }
    if (isOwnerInput(value)) {
      setLookupError("");
      navigate(`/collector/${encodeURIComponent(value)}`);
      return;
    }
    setLookupError(
      environment.exomonEnabled
        ? "Enter a token ID, Solana mint address, EVM wallet, or ENS name."
        : "Enter a numeric token ID, wallet address, or ENS name."
    );
  }

  function removeTrait(traitType: string, traitValue: string) {
    const next = cloneCollectionFilters(filters);
    next.traits[traitType] = (next.traits[traitType] ?? []).filter(
      (value) => value !== traitValue
    );
    if (next.traits[traitType].length === 0) delete next.traits[traitType];
    setFilters(next);
  }

  return (
    <main className="min-h-[70vh]">
      <section
        id="top"
        className={cn(
          presentation.backgroundClassName,
          "scroll-mt-24 px-4 py-14 sm:py-20"
        )}
      >
        <div className="mx-auto max-w-6xl">
          <p
            className={cn(
              "text-xs font-bold uppercase tracking-[0.18em]",
              presentation.accentClassName
            )}
          >
            {presentation.eyebrow}
          </p>
          <div className="mt-3 grid gap-7 lg:grid-cols-[1fr_380px] lg:items-end">
            <div>
              <h1 className="display max-w-3xl text-5xl text-ink sm:text-7xl">
                {presentation.title}
              </h1>
              <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-ink/70 sm:text-lg">
                {presentation.description}
              </p>
              {selectedChain === "solana" && (
                <Link
                  to="/leaderboard?chain=solana"
                  className="mt-4 inline-flex rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-grape focus-visible:ring-2 focus-visible:ring-grape"
                >
                  Exomon collector leaderboard →
                </Link>
              )}
            </div>
            <form onSubmit={submitLookup}>
              <label
                htmlFor="collection-lookup"
                className="text-xs font-bold uppercase tracking-wide text-muted"
              >
                {environment.exomonEnabled
                  ? "Token ID, Solana mint, wallet, or ENS name"
                  : "Token ID, wallet, or ENS name"}
              </label>
              <div className="mt-2 flex rounded-full border border-ethereum/20 bg-white p-1.5 shadow-card">
                <Search
                  aria-hidden="true"
                  className="ml-2 self-center text-muted"
                  size={17}
                />
                <input
                  id="collection-lookup"
                  value={lookup}
                  onChange={(event) => {
                    setLookup(event.target.value);
                    setLookupError("");
                  }}
                  placeholder={
                    environment.exomonEnabled
                      ? "Token ID, mint address, or name.eth"
                      : "2000, 0x…, or name.eth"
                  }
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm font-semibold outline-none placeholder:text-muted/65"
                  aria-invalid={Boolean(lookupError)}
                />
                <button className="rounded-full bg-ink px-5 py-2 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2">
                  Find
                </button>
              </div>
              {lookupError && (
                <p
                  className="mt-2 text-xs font-semibold text-red-600"
                  role="alert"
                >
                  {lookupError}
                </p>
              )}
            </form>
          </div>
        </div>
      </section>

      <section id="collection" className="scroll-mt-24 px-4 py-12 sm:py-16">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-ethereum">
                Collection shelf
              </p>
              <h2
                ref={heading}
                tabIndex={-1}
                className="display mt-2 text-3xl text-ink sm:text-4xl"
              >
                {selectedChain === "solana"
                  ? "Exomon collection"
                  : activeFilterCount > 0
                    ? "Filtered collection"
                    : "All active Yunipals"}
              </h2>
              <p
                className="mt-2 text-sm font-medium text-muted"
                aria-live="polite"
              >
                {incompleteEmptyResults
                  ? "Listings temporarily unavailable"
                  : totalMatches !== undefined
                    ? `${formatInteger(totalMatches)} ${selectedChain === "solana" ? "Exomon" : "Yunipals"}`
                    : "Loading collection…"}
                {catalogPage &&
                  !incompleteEmptyResults &&
                  filters.sale === "listed" &&
                  ` · ${formatInteger(catalogPage.verifiedListedTotal)} ${catalogPage.listingCompleteness === "complete" ? "for sale" : "verified listings"}`}
                {tokens.length > 0 &&
                  ` · ${formatInteger(tokens.length)} loaded`}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-ethereum/25 bg-ethereum/10 px-4 py-2.5 text-sm font-bold text-ethereum transition hover:bg-ethereum/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum lg:hidden"
              >
                <Filter aria-hidden="true" size={15} />
                Filters
                {activeFilterCount > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ethereum px-1.5 text-[10px] text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              <label htmlFor="collection-sort" className="sr-only">
                Sort collection
              </label>
              <select
                id="collection-sort"
                value={filters.sort}
                onChange={(event) => {
                  const sort = event.target.value as CollectionSort;
                  setFilters({
                    ...filters,
                    sort,
                    ...(isPriceSort(sort)
                      ? {
                          sale: "listed",
                          currency: priceCurrencyForFilters(filters)
                        }
                      : {})
                  });
                }}
                className="rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                {SORT_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={
                      isPriceSort(option.value) &&
                      (!catalog.configured || !selectedChain || withSolana)
                    }
                  >
                    {environment.exomonEnabled &&
                    option.value.startsWith("token-id-")
                      ? `Token ID / mint: ${option.value.endsWith("desc") ? "descending" : "ascending"}`
                      : option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-6 lg:hidden">
            <ChainFilter filters={filters} onChange={setFilters} />
          </div>

          {activeFilterCount > 0 && (
            <div
              className="mt-5 flex flex-wrap gap-2"
              aria-label="Active filters"
            >
              {filters.chains.map((chain) => (
                <button
                  key={chain}
                  type="button"
                  onClick={() =>
                    setFilters({
                      ...filters,
                      chains: filters.chains.filter(
                        (selectedChain) => selectedChain !== chain
                      )
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-line bg-line/35 px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-line/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  aria-label={`Remove ${chainDetails[chain].label} chain filter`}
                >
                  <ChainLogo
                    chainId={chain}
                    className={`h-3.5 w-3.5 ${chainDetails[chain].badgeClassName}`}
                  />
                  {chainDetails[chain].label}
                  <X aria-hidden="true" size={12} />
                </button>
              ))}
              {Object.entries(filters.traits).flatMap(([traitType, values]) =>
                values.map((value) => (
                  <button
                    key={`${traitType}:${value}`}
                    type="button"
                    onClick={() => removeTrait(traitType, value)}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-ethereum/20 bg-ethereum/8 px-3 py-1.5 text-xs font-bold text-ethereum transition hover:bg-ethereum/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                    aria-label={`Remove ${traitType}: ${value} filter`}
                  >
                    <span className="truncate">
                      {traitType}: {value}
                    </span>
                    <X aria-hidden="true" className="shrink-0" size={12} />
                  </button>
                ))
              )}
              {(filters.rarityMin || filters.rarityMax) && (
                <button
                  type="button"
                  onClick={() =>
                    setFilters({ ...filters, rarityMin: "", rarityMax: "" })
                  }
                  className="inline-flex items-center gap-2 rounded-full border border-ethereum/20 bg-ethereum/8 px-3 py-1.5 text-xs font-bold text-ethereum transition hover:bg-ethereum/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                  aria-label="Remove rarity range filter"
                >
                  {filters.rarityMode === "capped"
                    ? "Capped rarity"
                    : "Raw rarity"}
                  : {filters.rarityMin || "Any"}–{filters.rarityMax || "Any"}
                  <X aria-hidden="true" size={12} />
                </button>
              )}
              {filters.metadata !== "all" && (
                <button
                  type="button"
                  onClick={() => setFilters({ ...filters, metadata: "all" })}
                  className="inline-flex items-center gap-2 rounded-full border border-ethereum/20 bg-ethereum/8 px-3 py-1.5 text-xs font-bold capitalize text-ethereum transition hover:bg-ethereum/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
                  aria-label="Remove metadata filter"
                >
                  Metadata: {filters.metadata}
                  <X aria-hidden="true" size={12} />
                </button>
              )}
              {marketFiltered && (
                <button
                  type="button"
                  onClick={() => setFilters(clearMarketFilters(filters))}
                  aria-label="Remove sale and price filters"
                  className="inline-flex items-center gap-2 rounded-full border border-ethereum/20 bg-ethereum/8 px-3 py-1.5 text-xs font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
                >
                  {filters.sale === "unlisted"
                    ? "Not listed"
                    : filters.sale === "listed"
                      ? "For sale"
                      : "Sale filters"}
                  {filters.priceMin || filters.priceMax
                    ? ` · ${filters.priceMin || "0"}–${filters.priceMax || "Any"}${currencyLabel ? ` ${currencyLabel}` : ""}`
                    : currencyLabel && ` · ${currencyLabel}`}
                  <X aria-hidden="true" size={12} />
                </button>
              )}
              <button
                type="button"
                onClick={() => setFilters(clearCollectionFilters(filters))}
                className="rounded-full px-3 py-1.5 text-xs font-bold text-muted transition hover:bg-line/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
              >
                Clear all
              </button>
            </div>
          )}

          <div className="mt-7 grid items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="sticky top-24 hidden max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain rounded-card shadow-card lg:block">
              <CollectionFilterPanel
                marketEnabled={
                  !withSolana && (catalog.configured || marketFiltered)
                }
                filters={filters}
                facets={facetsQuery.data}
                facetsLoading={facetsQuery.isLoading}
                facetsError={facetsQuery.isError}
                onChange={setFilters}
                onRetryFacets={() => void facetsQuery.refetch()}
              />
            </aside>

            <div className="min-w-0">
              {catalog.configured &&
                !withSolana &&
                !incompleteEmptyResults &&
                (useLegacy ||
                  !catalogPage ||
                  catalogPage.listingCompleteness !== "complete") && (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                    <span>
                      {useLegacy
                        ? "Prices are unavailable. Showing collection details only."
                        : catalogPage?.listingCompleteness === "partial"
                          ? "Some listings are temporarily unavailable. Please try again shortly."
                          : catalogPage?.listingCompleteness === "unavailable"
                            ? "Prices are temporarily unavailable. Collection details remain available."
                            : "Checking purchase availability…"}
                    </span>
                    {(useLegacy || catalogPage) && (
                      <button
                        type="button"
                        onClick={refreshCatalog}
                        className="rounded-full border border-line px-3 py-2 font-bold text-ink focus-visible:ring-2 focus-visible:ring-ethereum"
                      >
                        Try again
                      </button>
                    )}
                  </div>
                )}
              {catalogError ? (
                <div
                  role="alert"
                  className="rounded-card border border-line bg-white p-6 text-sm"
                >
                  <p>{catalogError}</p>
                  <button
                    type="button"
                    onClick={() => setFilters(clearMarketFilters(filters))}
                    className="mt-4 rounded-full border border-line px-4 py-2 font-bold focus-visible:ring-2 focus-visible:ring-ethereum"
                  >
                    Clear sale and price filters
                  </button>
                </div>
              ) : tokensQuery.isLoading ? (
                <TokenGridSkeleton count={12} />
              ) : tokensQuery.isError && tokens.length === 0 ? (
                <div role="alert" className="space-y-3">
                  {marketFiltered && (
                    <p className="text-sm text-muted">
                      Sale and price results are unavailable. Your filters are
                      still applied.
                    </p>
                  )}
                  <QueryError onRetry={refreshCatalog} />
                </div>
              ) : tokens.length === 0 ? (
                <div className="rounded-card border border-dashed border-line px-6 py-14 text-center">
                  <Users
                    aria-hidden="true"
                    className="mx-auto text-muted"
                    size={28}
                  />
                  <p className="mt-3 font-bold text-ink">
                    {incompleteEmptyResults
                      ? "Listings are temporarily unavailable."
                      : "No Yunipals match this combination."}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {incompleteEmptyResults
                      ? "Please try again shortly. Your filters are still applied."
                      : "Try another chain, remove a trait, or widen the rarity range."}
                  </p>
                  <button
                    type="button"
                    onClick={
                      incompleteEmptyResults
                        ? refreshCatalog
                        : () => setFilters(clearCollectionFilters(filters))
                    }
                    className="mt-5 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    {incompleteEmptyResults ? "Try again" : "Clear all filters"}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                  {tokens.map((token, index) => (
                    <TokenCard
                      key={collectionTokenKey(token)}
                      token={token}
                      eager={index < 6}
                      market={
                        catalog.configured &&
                        !withSolana &&
                        token.chain !== "solana" && (
                          <CatalogCardMarket
                            market={
                              useLegacy
                                ? { status: "unknown", listings: [] }
                                : (marketByAsset.get(
                                    marketplaceAssetKey(token)
                                  ) ?? { status: "unknown", listings: [] })
                            }
                            account={address}
                            canBuy={
                              Boolean(
                                capabilities.data?.[token.chain]?.read &&
                                  capabilities.data?.[token.chain]?.buy
                              ) && !capabilities.isError
                            }
                            onBuy={(order, trigger) =>
                              requestTradingConsent(() =>
                                setSelectedTrade({
                                  order,
                                  trigger,
                                  name: token.name || "Yunipal"
                                })
                              )
                            }
                          />
                        )
                      }
                    />
                  ))}
                </div>
              )}

              {!useLegacy &&
                catalog.query.isRefetchError &&
                tokens.length > 0 && (
                  <p role="alert" className="mt-5 text-sm text-muted">
                    Prices could not be refreshed. The displayed results are
                    from the last successful check.
                  </p>
                )}
              {tokensQuery.isFetchNextPageError && (
                <div
                  role="alert"
                  className="mt-5 rounded-card border border-line p-4 text-sm"
                >
                  <p>
                    The next page could not be loaded. Existing results are
                    still shown.
                  </p>
                  <button
                    type="button"
                    onClick={refreshCatalog}
                    className="mt-3 rounded-full border border-line px-4 py-2 font-bold focus-visible:ring-2 focus-visible:ring-ethereum"
                  >
                    Refresh collection
                  </button>
                </div>
              )}
              {!catalogError && tokensQuery.hasNextPage && (
                <div className="mt-9 text-center">
                  <button
                    type="button"
                    disabled={tokensQuery.isFetchingNextPage}
                    onClick={() => void tokensQuery.fetchNextPage()}
                    className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white shadow-cta transition hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4"
                  >
                    {tokensQuery.isFetchingNextPage ? (
                      <Loader2
                        aria-hidden="true"
                        className="animate-spin"
                        size={16}
                      />
                    ) : (
                      <ArrowRight aria-hidden="true" size={16} />
                    )}
                    {tokensQuery.isFetchingNextPage
                      ? "Loading…"
                      : selectedChain === "solana"
                        ? "Load more Exomon"
                        : "Load more Yunipals"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {selectedTrade && (
        <TradeReviewDialog
          order={selectedTrade.order}
          name={selectedTrade.name}
          returnFocus={selectedTrade.trigger}
          fallbackFocus={heading}
          onClose={() => setSelectedTrade(null)}
        />
      )}
      <MobileFilterDrawer
        marketEnabled={!withSolana && (catalog.configured || marketFiltered)}
        open={mobileFiltersOpen}
        filters={filters}
        facets={facetsQuery.data}
        facetsLoading={facetsQuery.isLoading}
        facetsError={facetsQuery.isError}
        onClose={closeMobileFilters}
        onApply={(nextFilters) => {
          setFilters(nextFilters);
          closeMobileFilters();
        }}
        onRetryFacets={() => void facetsQuery.refetch()}
      />
    </main>
  );
}

export function CollectionPage() {
  const { chain, tokenId } = useParams();
  const { search, hash } = useLocation();

  const islandsSelected =
    chain === "ethereum-islands" ||
    (!tokenId && new URLSearchParams(search).get("collection") === "islands");

  if (islandsSelected) {
    return (
      <>
        <CollectionTabs selected="islands" />
        {tokenId ? <IslandDetail tokenId={tokenId} /> : <IslandsExplorer />}
      </>
    );
  }
  if (!tokenId) {
    return (
      <>
        <CollectionTabs selected="yunipals" />
        <CollectionExplorer />
      </>
    );
  }
  if (!chain) {
    return (
      <Navigate
        to={`/collection/ethereum/${tokenId}${search}${hash}`}
        replace
      />
    );
  }
  if (!isIndexedChain(chain)) return <Navigate to="/" replace />;

  return <TokenDetail chain={chain} tokenId={tokenId} />;
}
