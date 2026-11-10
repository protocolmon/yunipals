import { useState } from "react";

import { cn } from "@/lib/utils";
import { PageLoading, PageMessage } from "./PageStates";
import { YUNIPALS } from "./sample";
import {
  applyContentCase,
  CONTENT_CASES,
  MARKET_STATES,
  PAGE_STATES,
  type ContentCase,
  type MarketState,
  type PageState
} from "./states";
import { YunipalPage } from "./YunipalPage";

const WIDTHS = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" }
] as const;

type Width = (typeof WIDTHS)[number]["id"];

const PILL =
  "inline-flex h-8 items-center rounded-full px-4 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-badge";

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
  const [exampleId, setExampleId] = useState(YUNIPALS[0].id);
  const [page, setPage] = useState<PageState>("ready");
  const [market, setMarket] = useState<MarketState>("listed");
  const [contentCase, setContentCase] = useState<ContentCase>("as-is");
  const [width, setWidth] = useState<Width>("desktop");
  const example = YUNIPALS.find((item) => item.id === exampleId) ?? YUNIPALS[0];
  const yunipal = applyContentCase(example, contentCase);

  return (
    <>
      <section className="max-w-3xl space-y-2 text-muted">
        <p className="text-lg leading-relaxed">
          One page, three tabs: the Yunipal&rsquo;s story, its market and its
          journey.
        </p>
        <p className="text-sm">
          Real tokens; prices, offers and sales are made up, and buttons do
          nothing here.
        </p>
      </section>

      <div className="mt-6 space-y-1.5 rounded-card border border-line bg-white p-3">
        <Picker
          label="Example"
          options={YUNIPALS.map((item) => ({ id: item.id, label: item.name }))}
          value={exampleId}
          onChange={setExampleId}
        />
        <Picker
          label="Page"
          options={PAGE_STATES}
          value={page}
          onChange={setPage}
        />
        <Picker
          label="Market"
          options={MARKET_STATES}
          value={market}
          onChange={setMarket}
        />
        <Picker
          label="Content"
          options={CONTENT_CASES}
          value={contentCase}
          onChange={setContentCase}
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
        aria-label="Yunipal page example"
        className={cn(
          // The page lays itself out by this box's width, not the screen's,
          // so the Phone preview is the real phone layout.
          "mt-4 overflow-hidden rounded-[28px] border border-line bg-white shadow-card [container-type:inline-size]",
          width === "phone" && "mx-auto max-w-[430px]"
        )}
      >
        {page === "loading" && <PageLoading />}
        {page === "not-found" && (
          <PageMessage
            title="This Yunipal could not be found"
            body="It may not exist on this chain, or the collection could not be reached just now."
            actions={
              <>
                <span className={cn(PILL, "bg-ink text-white")}>Try again</span>
                <span className={cn(PILL, "border border-ink/15 bg-white")}>
                  Back to the collection
                </span>
              </>
            }
          />
        )}
        {page === "invalid-id" && (
          <PageMessage
            title="That token ID is not valid"
            body="A token ID is made of digits only. Check the address and try again."
            actions={
              <span className={cn(PILL, "bg-ink text-white")}>
                Back to the collection
              </span>
            }
          />
        )}
        {(page === "ready" ||
          page === "no-metadata" ||
          page === "no-artwork" ||
          page === "burned") && (
          <YunipalPage
            key={`${yunipal.id}-${contentCase}`}
            yunipal={yunipal}
            page={page}
            market={market}
          />
        )}
      </section>
    </>
  );
}
