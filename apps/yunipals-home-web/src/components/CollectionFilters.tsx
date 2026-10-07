import {
  AlertCircle,
  Check,
  ChevronDown,
  Filter,
  RefreshCw,
  RotateCcw,
  Search,
  X
} from "lucide-react";
import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import { ChainLogo } from "@/components/ui/ChainLogo";
import { CatalogFilters } from "@/components/marketplace/CatalogFilters";
import { collectionChainDetails as chainDetails } from "@/data/chains";
import {
  collectionChains,
  includesSolana,
  toEvmCollectionFilters,
  type CollectionChain
} from "@/lib/collectionBrowserFilters";
import type { CollectionFacets } from "@/lib/collectionBrowser";
import { formatDecimal, formatInteger } from "@/lib/format";
import {
  clearCollectionFilters,
  cloneCollectionFilters,
  countCollectionFilters,
  type CollectionFilters
} from "@/lib/collectionBrowserFilters";
import {
  type CategoricalTraitFacet,
  type NumericTraitFacet,
  type TokenMetadataFilter
} from "@/lib/yunipalsIndexer";
import { cn } from "@/lib/utils";

const TRAIT_PRIORITY = [
  "Type",
  "Color",
  "Background",
  "Glitter",
  "Horn",
  "Special",
  "Sound",
  "Variant",
  "Airdrop",
  "First Edition",
  "Origin Chain",
  "Opening Network"
];

type FilterPanelProps = {
  filters: CollectionFilters;
  facets?: CollectionFacets;
  facetsLoading?: boolean;
  facetsError?: boolean;
  onChange: (filters: CollectionFilters) => void;
  onRetryFacets?: () => void;
  showChainFilter?: boolean;
  className?: string;
  marketEnabled?: boolean;
  priceMode?: "apply" | "draft";
};

const CHAIN_OPTIONS: Array<{
  value: CollectionChain | "all";
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "ethereum", label: chainDetails.ethereum.label },
  { value: "base", label: chainDetails.base.label },
  { value: "polygon", label: chainDetails.polygon.label },
  { value: "bnb", label: chainDetails.bnb.label },
  ...(collectionChains.includes("solana")
    ? [{ value: "solana" as const, label: chainDetails.solana.label }]
    : [])
];

const selectedChainClasses: Record<CollectionChain | "all", string> = {
  all: "border-ink bg-ink text-white",
  ethereum: "border-ethereum bg-ethereum text-white",
  base: "border-basechain bg-basechain text-white",
  polygon: "border-polygon bg-polygon text-white",
  bnb: "border-bnbchain bg-bnbchain text-white",
  solana: "border-grape bg-grape text-white"
};

const chainIconClasses: Record<CollectionChain, string> = {
  ethereum: "text-ethereum",
  base: "text-basechain",
  polygon: "text-polygon",
  bnb: "text-bnbchain",
  solana: "text-grape"
};

export function ChainFilter({
  filters,
  onChange,
  className
}: Pick<FilterPanelProps, "filters" | "onChange" | "className">) {
  function selectChain(chain: CollectionChain | "all") {
    if (chain === "all") {
      onChange({ ...filters, chains: [] });
      return;
    }

    const nextSelection =
      filters.chains.length === 0
        ? [chain]
        : filters.chains.includes(chain)
          ? filters.chains.filter((selectedChain) => selectedChain !== chain)
          : collectionChains.filter(
              (indexedChain) =>
                filters.chains.includes(indexedChain) || indexedChain === chain
            );
    onChange({
      ...filters,
      chains:
        nextSelection.length === collectionChains.length ? [] : nextSelection
    });
  }

  return (
    <fieldset
      className={cn(
        "rounded-card border border-line bg-white p-4 shadow-card",
        className
      )}
    >
      <legend className="sr-only">Filter by chain</legend>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-base font-black text-ink">Chains</p>
          <p className="mt-0.5 text-xs font-medium text-muted">
            Combine one or more networks.
          </p>
        </div>
        {filters.chains.length > 0 && (
          <span className="rounded-full bg-line/60 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-muted">
            {filters.chains.length} selected
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {CHAIN_OPTIONS.map((option) => {
          const selected =
            option.value === "all"
              ? filters.chains.length === 0
              : filters.chains.includes(option.value);
          const indexedChain = option.value === "all" ? null : option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => selectChain(option.value)}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2",
                selected
                  ? selectedChainClasses[option.value]
                  : "border-line bg-white text-ink hover:border-ink/25 hover:bg-line/25"
              )}
              aria-pressed={selected}
            >
              {indexedChain && (
                <span
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-full bg-white shadow-sm",
                    chainIconClasses[indexedChain]
                  )}
                >
                  <ChainLogo chainId={indexedChain} className="h-3.5 w-3.5" />
                </span>
              )}
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function updateTrait(
  filters: CollectionFilters,
  traitType: string,
  traitValue: string,
  checked: boolean
) {
  const next = cloneCollectionFilters(filters);
  const values = next.traits[traitType] ?? [];
  next.traits[traitType] = checked
    ? Array.from(new Set([...values, traitValue]))
    : values.filter((value) => value !== traitValue);

  if (next.traits[traitType].length === 0) delete next.traits[traitType];
  return next;
}

function RarityFilter({
  filters,
  min,
  max,
  onChange
}: {
  filters: CollectionFilters;
  min?: string;
  max?: string;
  onChange: (filters: CollectionFilters) => void;
}) {
  const [rarityMin, setRarityMin] = useState(filters.rarityMin);
  const [rarityMax, setRarityMax] = useState(filters.rarityMax);
  const [open, setOpen] = useState(
    filters.rarityMode === "raw" ||
      Boolean(filters.rarityMin || filters.rarityMax)
  );

  useEffect(() => setRarityMin(filters.rarityMin), [filters.rarityMin]);
  useEffect(() => setRarityMax(filters.rarityMax), [filters.rarityMax]);
  useEffect(() => {
    if (
      filters.rarityMode === "raw" ||
      filters.rarityMin ||
      filters.rarityMax
    ) {
      setOpen(true);
    }
  }, [filters.rarityMax, filters.rarityMin, filters.rarityMode]);

  function apply(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    let normalizedMin = rarityMin.trim();
    let normalizedMax = rarityMax.trim();
    if (
      normalizedMin &&
      normalizedMax &&
      Number(normalizedMin) > Number(normalizedMax)
    ) {
      [normalizedMin, normalizedMax] = [normalizedMax, normalizedMin];
      setRarityMin(normalizedMin);
      setRarityMax(normalizedMax);
    }
    onChange({
      ...filters,
      rarityMin: normalizedMin,
      rarityMax: normalizedMax
    });
  }

  function changeRarityMode(rarityMode: CollectionFilters["rarityMode"]) {
    setRarityMin("");
    setRarityMax("");
    onChange({
      ...filters,
      rarityMode,
      rarityMin: "",
      rarityMax: ""
    });
  }

  return (
    <details
      className="group border-b border-line"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ethereum [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          Rarity points
          {(filters.rarityMin || filters.rarityMax) && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ethereum px-1.5 text-[10px] text-white">
              1
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted transition group-open:rotate-180"
          size={16}
        />
      </summary>
      <form onSubmit={apply} className="px-4 pb-4">
        <fieldset>
          <legend className="sr-only">Rarity score type</legend>
          <div className="grid grid-cols-2 rounded-xl bg-line/50 p-1">
            {(["capped", "raw"] as const).map((rarityMode) => {
              const selected = filters.rarityMode === rarityMode;
              return (
                <button
                  key={rarityMode}
                  type="button"
                  onClick={() => changeRarityMode(rarityMode)}
                  aria-pressed={selected}
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum",
                    selected
                      ? "bg-white text-ink shadow-sm"
                      : "text-muted hover:text-ink"
                  )}
                >
                  {rarityMode === "capped" ? "Capped" : "Raw"}
                </button>
              );
            })}
          </div>
        </fieldset>
        <p className="mt-2 text-xs font-medium leading-relaxed text-muted">
          {filters.rarityMode === "capped"
            ? "Capped rarity matches leaderboard scoring."
            : "Raw rarity uses the uncapped metadata score."}
        </p>
        {filters.rarityMode === "raw" && min && max && (
          <p className="mb-3 mt-2 text-xs font-medium text-muted">
            Collection range: {formatDecimal(min, 1)}–{formatDecimal(max, 1)}
          </p>
        )}
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <label>
            <span className="sr-only">
              Minimum {filters.rarityMode} rarity points
            </span>
            <input
              type="number"
              min={filters.rarityMode === "raw" ? min : undefined}
              max={filters.rarityMode === "raw" ? max : undefined}
              step="any"
              value={rarityMin}
              onChange={(event) => setRarityMin(event.target.value)}
              onBlur={() => apply()}
              placeholder="Min"
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-ink outline-none placeholder:text-muted/60 focus:border-ethereum focus:ring-2 focus:ring-ethereum/20"
            />
          </label>
          <span className="text-sm font-bold text-muted">to</span>
          <label>
            <span className="sr-only">
              Maximum {filters.rarityMode} rarity points
            </span>
            <input
              type="number"
              min={filters.rarityMode === "raw" ? min : undefined}
              max={filters.rarityMode === "raw" ? max : undefined}
              step="any"
              value={rarityMax}
              onChange={(event) => setRarityMax(event.target.value)}
              onBlur={() => apply()}
              placeholder="Max"
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-ink outline-none placeholder:text-muted/60 focus:border-ethereum focus:ring-2 focus:ring-ethereum/20"
            />
          </label>
        </div>
        <button type="submit" className="sr-only">
          Apply rarity range
        </button>
      </form>
    </details>
  );
}

function MetadataFilter({
  filters,
  facets,
  onChange
}: {
  filters: CollectionFilters;
  facets?: CollectionFacets;
  onChange: (filters: CollectionFilters) => void;
}) {
  const [open, setOpen] = useState(filters.metadata !== "all");
  const radioName = useId();
  useEffect(() => {
    if (filters.metadata !== "all") setOpen(true);
  }, [filters.metadata]);

  const options: Array<{
    value: TokenMetadataFilter;
    label: string;
    count?: number;
  }> = [
    {
      value: "all",
      label: "All metadata",
      count: facets
        ? facets.metadata.available + facets.metadata.missing
        : undefined
    },
    {
      value: "available",
      label: "Available",
      count: facets?.metadata.available
    },
    { value: "missing", label: "Missing", count: facets?.metadata.missing }
  ];

  return (
    <details
      className="group border-b border-line"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ethereum [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          Metadata
          {filters.metadata !== "all" && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ethereum px-1.5 text-[10px] text-white">
              1
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted transition group-open:rotate-180"
          size={16}
        />
      </summary>
      <div className="space-y-1 px-3 pb-4">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm transition hover:bg-line/35"
          >
            <input
              type="radio"
              name={radioName}
              value={option.value}
              checked={filters.metadata === option.value}
              onChange={() => onChange({ ...filters, metadata: option.value })}
              className="h-4 w-4 accent-ethereum"
            />
            <span className="min-w-0 flex-1 font-semibold text-ink">
              {option.label}
            </span>
            {option.count !== undefined && (
              <span className="text-xs font-semibold tabular-nums text-muted">
                {formatInteger(option.count)}
              </span>
            )}
          </label>
        ))}
      </div>
    </details>
  );
}

function TraitSection({
  facet,
  filters,
  defaultOpen,
  onChange
}: {
  facet: CategoricalTraitFacet;
  filters: CollectionFilters;
  defaultOpen: boolean;
  onChange: (filters: CollectionFilters) => void;
}) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const selected = filters.traits[facet.traitType] ?? [];
  const [open, setOpen] = useState(defaultOpen || selected.length > 0);
  useEffect(() => {
    if (selected.length > 0) setOpen(true);
  }, [selected.length]);
  const matchingValues = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return facet.values;
    return facet.values.filter(({ value }) =>
      value.toLowerCase().includes(normalizedSearch)
    );
  }, [facet.values, search]);
  const displayedValues =
    search || showAll ? matchingValues : matchingValues.slice(0, 8);
  const canExpand = !search && matchingValues.length > 8;

  return (
    <details
      className="group border-b border-line"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ethereum [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{facet.traitType}</span>
          {selected.length > 0 && (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-ethereum px-1.5 text-[10px] text-white">
              {selected.length}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="shrink-0 text-muted transition group-open:rotate-180"
          size={16}
        />
      </summary>
      <div className="px-3 pb-4">
        {facet.values.length > 8 && (
          <label className="relative mb-2 block">
            <span className="sr-only">Search {facet.traitType}</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              size={14}
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${facet.traitType.toLowerCase()}`}
              className="w-full rounded-xl border border-line py-2 pl-9 pr-3 text-sm font-medium text-ink outline-none placeholder:text-muted/60 focus:border-ethereum focus:ring-2 focus:ring-ethereum/20"
            />
          </label>
        )}

        <div className="space-y-0.5">
          {displayedValues.map(({ value, count }) => {
            const checked = selected.includes(value);
            return (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm transition",
                  checked ? "bg-ethereum/8" : "hover:bg-line/35"
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    onChange(
                      updateTrait(
                        filters,
                        facet.traitType,
                        value,
                        event.target.checked
                      )
                    )
                  }
                  className="h-4 w-4 shrink-0 rounded accent-ethereum"
                />
                <span
                  className="min-w-0 flex-1 truncate font-semibold text-ink"
                  title={value}
                >
                  {value}
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-muted">
                  {formatInteger(count)}
                </span>
              </label>
            );
          })}
          {displayedValues.length === 0 && (
            <p className="px-2 py-3 text-sm font-medium text-muted">
              No values match “{search}”.
            </p>
          )}
        </div>

        {canExpand && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            className="mt-2 w-full rounded-xl px-2 py-2 text-left text-xs font-bold text-ethereum transition hover:bg-ethereum/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
          >
            {showAll
              ? "Show fewer"
              : `Show all ${formatInteger(facet.values.length)} values`}
          </button>
        )}
      </div>
    </details>
  );
}

export function CollectionFilterPanel({
  filters,
  facets,
  facetsLoading,
  facetsError,
  onChange,
  onRetryFacets,
  showChainFilter = true,
  marketEnabled = false,
  priceMode,
  className
}: FilterPanelProps) {
  const activeCount = countCollectionFilters(filters);
  const rarityFacet = facets?.items.find(
    (facet): facet is NumericTraitFacet =>
      facet.kind === "numeric" && facet.traitType === "Rarity Points"
  );
  const categoricalFacets = useMemo(
    () =>
      (
        facets?.items.filter(
          (facet): facet is CategoricalTraitFacet =>
            facet.kind === "categorical"
        ) ?? []
      ).sort((left, right) => {
        const leftPriority = TRAIT_PRIORITY.indexOf(left.traitType);
        const rightPriority = TRAIT_PRIORITY.indexOf(right.traitType);
        if (leftPriority === -1 && rightPriority === -1)
          return left.traitType.localeCompare(right.traitType);
        if (leftPriority === -1) return 1;
        if (rightPriority === -1) return -1;
        return leftPriority - rightPriority;
      }),
    [facets]
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-line bg-white",
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4">
        <div className="flex items-center gap-2">
          <Filter aria-hidden="true" className="text-ethereum" size={17} />
          <h2 className="text-sm font-black text-ink">Filters</h2>
          {activeCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-ethereum px-1.5 text-[10px] font-black text-white">
              {activeCount}
            </span>
          )}
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onChange(clearCollectionFilters(filters))}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-muted transition hover:bg-line/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
          >
            <RotateCcw aria-hidden="true" size={12} /> Clear
          </button>
        )}
      </div>

      {showChainFilter && (
        <ChainFilter
          filters={filters}
          onChange={onChange}
          className="rounded-none border-x-0 border-t-0 shadow-none"
        />
      )}

      {marketEnabled && (
        <CatalogFilters
          filters={toEvmCollectionFilters(filters)}
          onChange={onChange}
          priceMode={priceMode}
        />
      )}
      <RarityFilter
        filters={filters}
        min={rarityFacet?.min}
        max={rarityFacet?.max}
        onChange={onChange}
      />
      {/* Solana metadata totals include burned assets; omit misleading counts. */}
      <MetadataFilter
        filters={filters}
        facets={includesSolana(filters) ? undefined : facets}
        onChange={onChange}
      />

      {facetsLoading && (
        <div className="space-y-2 p-4" aria-label="Loading trait filters">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="h-12 animate-pulse rounded-xl bg-line/60"
            />
          ))}
        </div>
      )}

      {facetsError && (
        <div className="m-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          <div className="flex items-start gap-2">
            <AlertCircle
              aria-hidden="true"
              className="mt-0.5 shrink-0"
              size={16}
            />
            <p className="text-xs font-semibold">
              Trait options could not be loaded.
            </p>
          </div>
          {onRetryFacets && (
            <button
              type="button"
              onClick={onRetryFacets}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <RefreshCw aria-hidden="true" size={12} /> Retry
            </button>
          )}
        </div>
      )}

      {categoricalFacets.map((facet, index) => (
        <TraitSection
          key={facet.traitType}
          facet={facet}
          filters={filters}
          defaultOpen={index < 2}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

type MobileFilterDrawerProps = Omit<
  FilterPanelProps,
  "filters" | "onChange"
> & {
  open: boolean;
  filters: CollectionFilters;
  onClose: () => void;
  onApply: (filters: CollectionFilters) => void;
};

export function MobileFilterDrawer({
  open,
  filters,
  facets,
  facetsLoading,
  facetsError,
  onClose,
  onApply,
  onRetryFacets,
  marketEnabled
}: MobileFilterDrawerProps) {
  const [draft, setDraft] = useState(() => cloneCollectionFilters(filters));
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setDraft(cloneCollectionFilters(filters));
  }, [filters, open]);

  useEffect(() => {
    if (!open) return;
    const previousActiveElement = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-ink/45 backdrop-blur-sm lg:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-filter-title"
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-[28px] bg-white shadow-cardHover"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4">
          <div>
            <h2
              id="mobile-filter-title"
              className="text-lg font-black text-ink"
            >
              Filter collection
            </h2>
            <p className="mt-0.5 text-xs font-medium text-muted">
              {countCollectionFilters(draft)} active filters
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink transition hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
            aria-label="Close filters"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          <CollectionFilterPanel
            filters={draft}
            facets={facets}
            facetsLoading={facetsLoading}
            facetsError={facetsError}
            onChange={setDraft}
            onRetryFacets={onRetryFacets}
            showChainFilter={false}
            marketEnabled={marketEnabled}
            priceMode="draft"
          />
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-3 border-t border-line bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <button
            type="button"
            onClick={() =>
              setDraft(cloneCollectionFilters(clearCollectionFilters(draft)))
            }
            className="rounded-full border border-line px-5 py-3 text-sm font-bold text-ink transition hover:bg-line/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-bold text-white shadow-cta transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
          >
            <Check aria-hidden="true" size={16} /> Apply filters
          </button>
        </div>
      </div>
    </div>
  );
}
