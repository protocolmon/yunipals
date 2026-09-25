import { useEffect, useId, useState, type FormEvent } from "react";

import {
  clearMarketFilters,
  priceCurrencyForFilters,
  updateCollectionCurrency,
  type CollectionFilters
} from "@/lib/collectionFilters";
import { validateCatalogFilters } from "@/lib/marketplace/catalog";
import { catalogCurrencies } from "@/lib/marketplace/catalogCurrency";

export function CatalogFilters({
  filters,
  onChange,
  priceMode = "apply"
}: {
  filters: CollectionFilters;
  onChange: (filters: CollectionFilters) => void;
  priceMode?: "apply" | "draft";
}) {
  const id = useId();
  const single = filters.chains.length === 1;
  const currencies = single ? catalogCurrencies(filters.chains[0]) : [];
  const priceCurrency = priceCurrencyForFilters(filters);
  const currency =
    currencies.find((currency) => currency.key === priceCurrency)?.symbol ??
    "the selected currency";
  const [min, setMin] = useState(filters.priceMin);
  const [max, setMax] = useState(filters.priceMax);
  const [error, setError] = useState("");
  function priceFilters(minimum: string, maximum: string) {
    return {
      ...filters,
      priceMin: minimum.trim(),
      priceMax: maximum.trim(),
      ...(minimum.trim() || maximum.trim()
        ? { sale: "listed" as const, currency: priceCurrency }
        : {})
    };
  }
  useEffect(() => {
    setMin(filters.priceMin);
    setMax(filters.priceMax);
    setError("");
  }, [
    filters.priceMin,
    filters.priceMax,
    filters.currency,
    filters.chains.join(",")
  ]);
  function apply(event: FormEvent) {
    event.preventDefault();
    const next = priceFilters(min, max);
    try {
      validateCatalogFilters(next);
      setError("");
      onChange(next);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Check the price range."
      );
    }
  }
  return (
    <section
      className="space-y-3 border-b border-line p-4"
      aria-label="Sale and price filters"
    >
      <h3 className="text-sm font-extrabold">Sale availability</h3>
      <label htmlFor={`${id}-sale`} className="sr-only">
        Sale availability
      </label>
      <select
        id={`${id}-sale`}
        value={filters.sale}
        onChange={(event) => {
          const sale = event.target.value as CollectionFilters["sale"];
          onChange(
            sale === "listed"
              ? { ...filters, sale }
              : { ...clearMarketFilters(filters), sale }
          );
        }}
        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ethereum"
      >
        <option value="all">All NFTs</option>
        <option value="listed">For sale</option>
        <option value="unlisted">Not listed</option>
      </select>
      <label htmlFor={`${id}-currency`} className="block text-xs font-bold">
        Listing currency
      </label>
      <select
        id={`${id}-currency`}
        disabled={!single}
        value={filters.currency}
        onChange={(event) => {
          onChange(
            updateCollectionCurrency(
              filters,
              event.target.value as CollectionFilters["currency"]
            )
          );
        }}
        className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold focus-visible:ring-2 focus-visible:ring-ethereum disabled:opacity-50"
      >
        <option value="all">Any currency</option>
        {currencies.map((currency) => (
          <option key={currency.key} value={currency.key}>
            {currency.symbol}
          </option>
        ))}
        {filters.currency !== "all" &&
          !currencies.some((currency) => currency.key === filters.currency) && (
            <option value={filters.currency} disabled>
              Unsupported currency
            </option>
          )}
      </select>
      {!single && (
        <p className="text-xs leading-relaxed text-muted">
          Choose exactly one chain to compare prices.
        </p>
      )}
      <form onSubmit={apply} className="space-y-3">
        <p className="text-xs font-bold">Price in {currency}</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0">
            <span className="sr-only">Minimum listing price</span>
            <input
              type="text"
              inputMode="decimal"
              maxLength={80}
              disabled={!single}
              value={min}
              onChange={(event) => {
                setMin(event.target.value);
                if (priceMode === "draft")
                  onChange(priceFilters(event.target.value, max));
              }}
              placeholder="Min"
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ethereum disabled:opacity-50"
            />
          </label>
          <label className="min-w-0">
            <span className="sr-only">Maximum listing price</span>
            <input
              type="text"
              inputMode="decimal"
              maxLength={80}
              disabled={!single}
              value={max}
              onChange={(event) => {
                setMax(event.target.value);
                if (priceMode === "draft")
                  onChange(priceFilters(min, event.target.value));
              }}
              placeholder="Max"
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ethereum disabled:opacity-50"
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
        {priceMode === "apply" && (
          <button
            type="submit"
            disabled={!single}
            className="w-full rounded-full border border-line px-3 py-2 text-xs font-bold focus-visible:ring-2 focus-visible:ring-ethereum disabled:opacity-50"
          >
            Apply price range
          </button>
        )}
      </form>
    </section>
  );
}
