import { Filter, RotateCcw, Search, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";

import { chainDetails } from "@/data/chains";
import {
  defaultCollectorFilters,
  hasCollectorFilters,
  normalizeCollectorRarityRange,
  normalizeCollectorSearch,
  type CollectorFilters,
  type CollectorSort
} from "@/lib/collector";
import { cn } from "@/lib/utils";
import {
  indexedChains,
  type CategoricalTraitFacet,
  type TraitFacets
} from "@/lib/yunipalsIndexer";

type CollectorControlsProps = {
  filters: CollectorFilters;
  facets?: TraitFacets;
  facetsLoading: boolean;
  facetsError: boolean;
  nameSearch: boolean;
  rarityRange: boolean;
  onChange: (filters: CollectorFilters) => void;
  onRetryFacets: () => void;
};

type TraitField = "types" | "colors";

const controlClass =
  "rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum";

function getRarityError(filters: CollectorFilters) {
  try {
    normalizeCollectorRarityRange(filters.rarityMin, filters.rarityMax);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Check the rarity range.";
  }
}

export function CollectorControls({
  filters,
  facets,
  facetsLoading,
  facetsError,
  nameSearch,
  rarityRange,
  onChange,
  onRetryFacets
}: CollectorControlsProps) {
  const [search, setSearch] = useState(filters.search);
  const [searchError, setSearchError] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(filters);
  const [activeTrait, setActiveTrait] = useState<TraitField>("types");
  const dialog = useRef<HTMLDialogElement>(null);
  const traitPane = useRef<HTMLDivElement>(null);
  const typeTab = useRef<HTMLButtonElement>(null);
  const colorTab = useRef<HTMLButtonElement>(null);
  const traitScroll = useRef<Record<TraitField, number>>({
    types: 0,
    colors: 0
  });
  const id = useId();
  const rarityError = getRarityError(draft);

  useEffect(() => {
    setSearch(filters.search);
    setSearchError("");
  }, [filters.search]);
  useEffect(() => {
    if (search === filters.search) return;
    const timer = window.setTimeout(() => {
      try {
        const normalized = normalizeCollectorSearch(search);
        if (normalized && !/^\d+$/.test(normalized) && !nameSearch)
          throw new Error("Enter a token ID to search this collection.");
        setSearchError("");
        if (normalized !== filters.search)
          onChange({ ...filters, search: normalized });
      } catch (error) {
        setSearchError(
          error instanceof Error ? error.message : "Check your search."
        );
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, filters, nameSearch, onChange]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    try {
      const normalized = normalizeCollectorSearch(search);
      if (normalized && !/^\d+$/.test(normalized) && !nameSearch)
        throw new Error("Enter a token ID to search this collection.");
      setSearchError("");
      onChange({ ...filters, search: normalized });
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : "Check your search."
      );
    }
  }

  function toggleTrait(field: TraitField, value: string) {
    setDraft((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((item) => item !== value)
        : [...current[field], value].sort()
    }));
  }

  function selectTrait(field: TraitField, focus = false) {
    if (field === activeTrait) return;
    traitScroll.current[activeTrait] = traitPane.current?.scrollTop ?? 0;
    setActiveTrait(field);
    window.requestAnimationFrame(() => {
      if (traitPane.current)
        traitPane.current.scrollTop = traitScroll.current[field];
      if (focus)
        (field === "types" ? typeTab : colorTab).current?.focus({
          preventScroll: true
        });
    });
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    selectTrait(activeTrait === "types" ? "colors" : "types", true);
  }

  const activeCount =
    filters.types.length +
    filters.colors.length +
    filters.chains.length +
    (filters.rarityMin || filters.rarityMax ? 1 : 0);
  const activeChips = [
    ...filters.chains.map((value) => ({
      label: chainDetails[value].label,
      clear: () =>
        onChange({
          ...filters,
          chains: filters.chains.filter((item) => item !== value)
        })
    })),
    ...(filters.rarityMin || filters.rarityMax
      ? [
          {
            label: `Rarity: ${filters.rarityMin || "0"}–${filters.rarityMax || "any"} RP`,
            clear: () =>
              onChange({ ...filters, rarityMin: "", rarityMax: "" })
          }
        ]
      : []),
    ...filters.types.map((value) => ({
      label: `Type: ${value}`,
      clear: () =>
        onChange({
          ...filters,
          types: filters.types.filter((item) => item !== value)
        })
    })),
    ...filters.colors.map((value) => ({
      label: `Color: ${value}`,
      clear: () =>
        onChange({
          ...filters,
          colors: filters.colors.filter((item) => item !== value)
        })
    }))
  ];
  const traitName = activeTrait === "types" ? "Type" : "Color";
  const traitFacet = facets?.items.find(
    (item): item is CategoricalTraitFacet =>
      item.kind === "categorical" && item.traitType === traitName
  );
  const traitValues = [
    ...new Set([
      ...(traitFacet?.values.map((item) => item.value) ?? []),
      ...draft[activeTrait]
    ])
  ].sort();

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <form onSubmit={submitSearch} className="min-w-0 flex-1 basis-60">
          <label htmlFor={`${id}-search`} className="sr-only">
            Search your collection
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              size={17}
              className="pointer-events-none absolute left-4 top-3 text-muted"
            />
            <input
              id={`${id}-search`}
              type="search"
              value={search}
              maxLength={80}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={
                nameSearch ? "Token ID or name prefix…" : "Search token ID…"
              }
              aria-invalid={Boolean(searchError)}
              aria-describedby={searchError ? `${id}-search-error` : undefined}
              className={cn(controlClass, "w-full pl-11 font-medium")}
            />
          </div>
          {searchError && (
            <p
              id={`${id}-search-error`}
              role="status"
              className="mt-2 text-sm text-red-700"
            >
              {searchError}
            </p>
          )}
        </form>
        <label className="sr-only" htmlFor={`${id}-sort`}>
          Sort collection
        </label>
        <select
          id={`${id}-sort`}
          value={filters.sort}
          onChange={(event) =>
            onChange({ ...filters, sort: event.target.value as CollectorSort })
          }
          className={cn(controlClass, "max-w-full")}
        >
          <option value="rarity-capped-desc">Rarity: highest first</option>
          <option value="rarity-capped-asc">Rarity: lowest first</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setDraft(filters);
            setOpen(true);
          }}
          className={cn(controlClass, "inline-flex items-center gap-2")}
        >
          <Filter aria-hidden="true" size={16} /> Filters
          {activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
        {(hasCollectorFilters(filters) ||
          filters.sort !== defaultCollectorFilters.sort ||
          search) && (
          <button
            type="button"
            className={cn(
              controlClass,
              "inline-flex items-center gap-2 text-muted"
            )}
            onClick={() => {
              setSearch("");
              setSearchError("");
              onChange(defaultCollectorFilters);
            }}
          >
            <RotateCcw aria-hidden="true" size={15} /> Clear filters
          </button>
        )}
      </div>
      {activeChips.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Active filters">
          {activeChips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={chip.clear}
              aria-label={`Remove ${chip.label} filter`}
              className="inline-flex items-center gap-1.5 rounded-full bg-ethereum/10 px-3 py-1.5 text-xs font-bold text-ethereum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
            >
              {chip.label}
              <X aria-hidden="true" size={13} />
            </button>
          ))}
        </div>
      )}

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby={`${id}-title`}
        className="m-auto max-h-[85dvh] w-full max-w-lg overflow-hidden rounded-3xl border border-line bg-white p-0 text-ink shadow-cardHover backdrop:bg-ink/45 backdrop:backdrop-blur-sm"
      >
        {open && (
          <form
            className="flex max-h-[85dvh] min-h-0 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (rarityError) return;
              const normalizedRange = normalizeCollectorRarityRange(
                draft.rarityMin,
                draft.rarityMax
              );
              onChange({ ...draft, ...normalizedRange });
              setOpen(false);
            }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-line bg-white px-5 py-4">
              <h3 id={`${id}-title`} className="text-lg font-black">
                Filter collection
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close filters"
                className={cn(controlClass, "p-2")}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="shrink-0 space-y-4 border-b border-line p-5">
              <fieldset>
                <legend className="mb-2 font-extrabold">Chain</legend>
                <div className="grid grid-cols-2 gap-2">
                  {indexedChains.map((chain) => (
                    <label
                      key={chain}
                      className="flex items-center gap-2 text-sm font-semibold"
                    >
                      <input
                        type="checkbox"
                        checked={draft.chains.includes(chain)}
                        onChange={() =>
                          setDraft((current) => ({
                            ...current,
                            chains: current.chains.includes(chain)
                              ? current.chains.filter(
                                  (value) => value !== chain
                                )
                              : indexedChains.filter(
                                  (value) =>
                                    value === chain ||
                                    current.chains.includes(value)
                                )
                          }))
                        }
                        className="h-4 w-4 accent-ethereum"
                      />
                      {chainDetails[chain].label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {rarityRange && (
                <fieldset>
                  <legend className="mb-2 font-extrabold">
                    Rarity score
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-bold text-muted">
                      Minimum RP
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.rarityMin}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            rarityMin: event.target.value
                          }))
                        }
                        aria-invalid={Boolean(rarityError)}
                        aria-describedby={
                          rarityError ? `${id}-rarity-error` : undefined
                        }
                        placeholder="No minimum"
                        className={cn(controlClass, "mt-1 w-full font-medium")}
                      />
                    </label>
                    <label className="text-xs font-bold text-muted">
                      Maximum RP
                      <input
                        type="text"
                        inputMode="decimal"
                        value={draft.rarityMax}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            rarityMax: event.target.value
                          }))
                        }
                        aria-invalid={Boolean(rarityError)}
                        aria-describedby={
                          rarityError ? `${id}-rarity-error` : undefined
                        }
                        placeholder="No maximum"
                        className={cn(controlClass, "mt-1 w-full font-medium")}
                      />
                    </label>
                  </div>
                  {rarityError && (
                    <p
                      id={`${id}-rarity-error`}
                      role="alert"
                      className="mt-2 text-sm text-red-700"
                    >
                      {rarityError}
                    </p>
                  )}
                </fieldset>
              )}
            </div>

            <div
              className="grid shrink-0 grid-cols-2 border-b border-line bg-base-light px-5 pt-2"
              role="tablist"
              aria-label="Trait filters"
            >
              {(["types", "colors"] as const).map((field) => {
                const name = field === "types" ? "Type" : "Color";
                return (
                  <button
                    key={field}
                    ref={field === "types" ? typeTab : colorTab}
                    id={`${id}-${field}-tab`}
                    type="button"
                    role="tab"
                    aria-selected={activeTrait === field}
                    aria-controls={`${id}-traits-panel`}
                    tabIndex={activeTrait === field ? 0 : -1}
                    onClick={() => selectTrait(field)}
                    onKeyDown={handleTabKey}
                    className={cn(
                      "border-b-2 px-3 py-2 text-sm font-extrabold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum",
                      activeTrait === field
                        ? "border-ethereum text-ethereum"
                        : "border-transparent text-muted"
                    )}
                  >
                    {name}
                    {draft[field].length ? ` (${draft[field].length})` : ""}
                  </button>
                );
              })}
            </div>

            <div
              ref={traitPane}
              id={`${id}-traits-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-${activeTrait}-tab`}
              className="min-h-24 flex-1 overflow-y-auto overscroll-contain p-5"
            >
              {facetsLoading && (
                <p role="status" className="animate-pulse text-sm text-muted">
                  Loading trait options…
                </p>
              )}
              {facetsError && (
                <p role="alert" className="text-sm text-red-700">
                  Trait options could not be loaded.{" "}
                  <button
                    type="button"
                    onClick={onRetryFacets}
                    className="font-bold underline"
                  >
                    Retry
                  </button>
                </p>
              )}
              <fieldset>
                <legend className="sr-only">{traitName}</legend>
                <div className="grid grid-cols-2 gap-3">
                  {traitValues.map((value) => (
                    <label
                      key={value}
                      className="flex items-start gap-2 break-words text-sm font-semibold"
                    >
                      <input
                        type="checkbox"
                        checked={draft[activeTrait].includes(value)}
                        disabled={
                          !draft[activeTrait].includes(value) &&
                          draft[activeTrait].length >= 20
                        }
                        onChange={() => toggleTrait(activeTrait, value)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-ethereum"
                      />
                      {value}
                    </label>
                  ))}
                </div>
                {!traitValues.length && !facetsLoading && !facetsError && (
                  <p className="text-sm text-muted">
                    No {traitName.toLowerCase()} options available.
                  </p>
                )}
              </fieldset>
            </div>

            <div className="flex shrink-0 gap-3 border-t border-line bg-white p-5">
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    chains: [],
                    types: [],
                    colors: [],
                    rarityMin: "",
                    rarityMax: ""
                  })
                }
                className={controlClass}
              >
                Reset
              </button>
              <button
                type="submit"
                disabled={Boolean(rarityError)}
                className={cn(
                  controlClass,
                  "flex-1 border-ink bg-ink text-white disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                Apply filters
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
