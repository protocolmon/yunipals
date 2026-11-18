import { useId, useLayoutEffect, useRef, useState } from "react";

import { CatalogFilters } from "@/components/marketplace/CatalogFilters";
import {
  DialogHeader,
  DialogSurface,
  dialogButtonVariants
} from "@/components/ui/dialog";
import { Select, SelectItem } from "@/components/ui/select";
import { chainDetails } from "@/data/chains";
import {
  applySupportedMarketFilters,
  effectiveCollectionChains,
  hasMarketFilters,
  includesSolana,
  isPriceSort,
  toEvmCollectionFilters,
  type CollectionFilters,
  type CollectionSort
} from "@/lib/collectionBrowserFilters";
import { collectionDefinitions } from "@/lib/collectionEdition";
import {
  priceCurrencyForFilters,
  updateCollectionChains,
  type CollectionFilters as MarketFilters
} from "@/lib/collectionFilters";
import { validateCatalogFilters } from "@/lib/marketplace/catalog";
import { isIndexedChain } from "@/lib/yunipalsIndexer";

const availabilityMessage =
  "Prices and listings are available for Ethereum, Polygon and BNB Chain. Solana prices are unavailable.";

export function CollectionMarketScopeDialog({
  filters,
  initialSort,
  onApply,
  onClose
}: {
  filters: CollectionFilters;
  initialSort?: CollectionSort;
  onApply: (filters: CollectionFilters) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const selected = effectiveCollectionChains(filters).filter(isIndexedChain);
  const supported = selected.length
    ? selected
    : collectionDefinitions.og.chains;
  const [draft, setDraft] = useState<MarketFilters>(() => {
    const next: MarketFilters = {
      ...toEvmCollectionFilters(filters),
      chains: supported,
      sale: "listed",
      sort: initialSort ?? filters.sort
    };
    return isPriceSort(next.sort) && supported.length === 1
      ? { ...next, currency: priceCurrencyForFilters(next) }
      : next;
  });
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const trigger = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);

  function apply() {
    try {
      validateCatalogFilters(draft);
      if (!hasMarketFilters({ ...draft, excludedChains: [] }))
        throw new Error(
          "Choose a sale or price filter, or cancel to keep browsing all selected chains."
        );
      onApply(applySupportedMarketFilters(filters, draft));
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Check the selected filters."
      );
    }
  }

  return (
    <DialogSurface
      ref={dialog}
      aria-labelledby={id}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <DialogHeader
        id={id}
        title="Filter supported chains"
        eyebrow="OG collection"
        onClose={onClose}
      />
      <p id={`${id}-description`} className="my-4 text-sm text-muted">
        {availabilityMessage} Applying these filters excludes Solana. Clearing
        them restores your previous chains unless you change the chain
        selection.
      </p>
      <label htmlFor={`${id}-chain`} className="mb-2 block text-sm font-bold">
        Chains to filter
      </label>
      <Select
        id={`${id}-chain`}
        value={draft.chains.length === 1 ? draft.chains[0] : "all"}
        onValueChange={(value) => {
          const chains =
            value === "all"
              ? supported
              : supported.filter((chain) => chain === value);
          const next = updateCollectionChains(draft, { ...draft, chains });
          if (initialSort && isPriceSort(initialSort)) {
            next.sort = initialSort;
            next.sale = "listed";
            next.currency =
              chains.length === 1 ? priceCurrencyForFilters(next) : "all";
          }
          setDraft(next);
          setError("");
        }}
        className="w-full rounded-full border border-line px-4 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-grape"
      >
        {supported.length > 1 && (
          <SelectItem value="all">All selected supported chains</SelectItem>
        )}
        {supported.map((chain) => (
          <SelectItem key={chain} value={chain}>
            {chainDetails[chain].label}
          </SelectItem>
        ))}
      </Select>
      <CatalogFilters
        filters={draft}
        onChange={(next) => {
          setDraft(next);
          setError("");
        }}
        priceMode="draft"
      />
      {initialSort && isPriceSort(initialSort) && (
        <p className="my-3 text-sm text-muted">
          Price sorting uses one chain and one currency. Choose a chain above.
        </p>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={apply}
          className={dialogButtonVariants()}
        >
          Apply to supported chains
        </button>
        <button
          type="button"
          onClick={onClose}
          className={dialogButtonVariants({ variant: "secondary" })}
        >
          Cancel
        </button>
      </div>
    </DialogSurface>
  );
}

export function CollectionMarketFilters({
  filters,
  onChange,
  priceMode
}: {
  filters: CollectionFilters;
  onChange: (filters: CollectionFilters) => void;
  priceMode?: "apply" | "draft";
}) {
  const [open, setOpen] = useState(false);
  if (!includesSolana(filters))
    return (
      <CatalogFilters
        filters={toEvmCollectionFilters(filters)}
        priceMode={priceMode}
        onChange={(next) =>
          onChange({
            ...next,
            chains: filters.chains,
            excludedChains: filters.excludedChains,
            marketReturnChains: filters.marketReturnChains
          })
        }
      />
    );
  return (
    <>
      <div className="border-b border-line p-4">
        <p className="text-xs leading-relaxed text-muted">
          {availabilityMessage}
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 rounded-full border border-line px-4 py-2 text-xs font-bold focus-visible:ring-2 focus-visible:ring-grape"
        >
          {effectiveCollectionChains(filters).length === 1
            ? "Switch to supported chains"
            : "Choose sale and price filters"}
        </button>
      </div>
      <fieldset
        disabled
        aria-label="Price filters unavailable with Solana"
        className="opacity-50"
      >
        <CatalogFilters
          filters={toEvmCollectionFilters(filters)}
          onChange={() => {}}
        />
      </fieldset>
      {open && (
        <CollectionMarketScopeDialog
          filters={filters}
          onApply={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
