import { useState } from "react";

import { cn } from "@/lib/utils";
import { CardSkeleton, SpecCard } from "./cards";
import {
  applyContentCase,
  COLLECTOR_STATES,
  CONTENT_CASES,
  EXAMPLES,
  marketFor,
  MARKET_STATES,
  PAGE_STATES,
  type CollectorState,
  type ContentCase,
  type MarketState,
  type PageState
} from "./states";

const WIDTHS = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" }
] as const;

type Width = (typeof WIDTHS)[number]["id"];

/** One labelled row of the showcase controls. */
function Picker<Id extends string>({
  label,
  options,
  value,
  onChange,
  className
}: {
  label: string;
  options: readonly { id: Id; label: string }[];
  value: Id;
  onChange: (id: Id) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex items-start gap-1", className)}
    >
      <p className="flex h-8 w-20 shrink-0 items-center text-[11px] font-bold uppercase tracking-wider text-muted">
        {label}
      </p>
      <div className="flex min-w-0 flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
            onClick={() => onChange(option.id)}
            className={cn(
              "h-8 rounded-full px-3 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge",
              option.id === value
                ? "bg-ink text-white"
                : "text-muted hover:bg-line/60"
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Landing() {
  const [page, setPage] = useState<PageState>("ready");
  const [contentCase, setContentCase] = useState<ContentCase>("as-is");
  const [market, setMarket] = useState<MarketState>("buy");
  const [collector, setCollector] = useState<CollectorState>("off");
  const [width, setWidth] = useState<Width>("desktop");

  return (
    <>
      <section className="max-w-3xl space-y-2 text-muted">
        <p className="text-lg leading-relaxed">
          One card for every Yunipal: rarity points with a line that grows with
          the level, traits as labelled facts, the chain and Glitter on the
          artwork.
        </p>
        <p className="text-sm">
          Real artwork and traits; chains, rarity, prices and the content cases
          are made up, and buttons do nothing here. A card opens the Yunipal
          page proposal.
        </p>
      </section>

      <div className="mt-6 space-y-1.5 rounded-card border border-line bg-white p-3">
        <Picker
          label="Page"
          options={PAGE_STATES}
          value={page}
          onChange={setPage}
        />
        <Picker
          label="Content"
          options={CONTENT_CASES}
          value={contentCase}
          onChange={setContentCase}
        />
        <Picker
          label="Market"
          options={MARKET_STATES}
          value={market}
          onChange={setMarket}
        />
        <Picker
          label="Collector"
          options={COLLECTOR_STATES}
          value={collector}
          onChange={setCollector}
        />
        <Picker
          label="Width"
          options={WIDTHS}
          value={width}
          onChange={setWidth}
          className="hidden md:flex"
        />
      </div>

      <section
        aria-label="Collection card examples"
        className={cn(
          "mt-4 grid grid-cols-2 items-start",
          width === "phone"
            ? "mx-auto max-w-[390px] gap-4"
            : "gap-4 sm:grid-cols-3 lg:gap-5 xl:grid-cols-4"
        )}
      >
        {EXAMPLES.map((example, index) => {
          if (page === "loading") return <CardSkeleton key={example.tokenId} />;
          const token = applyContentCase(example, contentCase);
          return (
            <SpecCard
              key={example.tokenId}
              token={token}
              market={marketFor(token, market, index)}
              visibility={collector === "off" ? undefined : collector}
            />
          );
        })}
      </section>
    </>
  );
}
