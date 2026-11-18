import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";

import type { CollectionFilters } from "@/lib/collectionBrowserFilters";
import { sequenceNumber } from "@/lib/tcgCollectionFilters";

export function TcgSequenceFilter({
  filters,
  onChange,
  mode = "apply"
}: {
  filters: CollectionFilters;
  onChange: (filters: CollectionFilters) => void;
  mode?: "apply" | "draft";
}) {
  const [min, setMin] = useState(filters.sequenceMin ?? "");
  const [max, setMax] = useState(filters.sequenceMax ?? "");
  useEffect(() => setMin(filters.sequenceMin ?? ""), [filters.sequenceMin]);
  useEffect(() => setMax(filters.sequenceMax ?? ""), [filters.sequenceMax]);
  const originalOnly = Boolean(filters.originalOnly);

  function apply(event: FormEvent) {
    event.preventDefault();
    const sequenceMin = sequenceNumber(min);
    const sequenceMax = sequenceNumber(max);
    const reversed =
      sequenceMin !== "" &&
      sequenceMax !== "" &&
      Number(sequenceMin) > Number(sequenceMax);
    onChange({
      ...filters,
      sequenceMin: reversed ? sequenceMax : sequenceMin,
      sequenceMax: reversed ? sequenceMin : sequenceMax
    });
  }

  return (
    <details className="group border-b border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-extrabold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ethereum [&::-webkit-details-marker]:hidden">
        Sequence number
        <ChevronDown
          aria-hidden="true"
          size={16}
          className="text-muted transition group-open:rotate-180"
        />
      </summary>
      <form onSubmit={apply} className="space-y-3 px-4 pb-4">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={originalOnly}
            onChange={(event) => {
              setMin("");
              setMax("");
              onChange({
                ...filters,
                originalOnly: event.target.checked,
                sequenceMin: "",
                sequenceMax: ""
              });
            }}
            className="h-4 w-4 rounded accent-ethereum"
          />
          Original only
        </label>
        <p className="text-xs leading-relaxed text-muted">
          Position in its mint family. Originals are sequence 0.
        </p>
        <fieldset
          disabled={originalOnly}
          className="grid grid-cols-2 gap-2 disabled:opacity-50"
        >
          <legend className="sr-only">Sequence range</legend>
          {(["From", "To"] as const).map((label) => (
            <label
              key={label}
              className="min-w-0 text-xs font-semibold text-muted"
            >
              {label}
              <input
                type="number"
                min={0}
                max={4294967295}
                step={1}
                inputMode="numeric"
                aria-label={`Sequence ${label.toLowerCase()}`}
                placeholder={label === "From" ? "0" : "Any"}
                value={label === "From" ? min : max}
                onChange={(event) => {
                  const value = event.target.value;
                  if (label === "From") setMin(value);
                  else setMax(value);
                  if (mode === "draft")
                    onChange({
                      ...filters,
                      [label === "From" ? "sequenceMin" : "sequenceMax"]:
                        sequenceNumber(value)
                    });
                }}
                className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-ethereum focus:ring-2 focus:ring-ethereum/20"
              />
            </label>
          ))}
        </fieldset>
        {!originalOnly && (
          <p className="text-xs text-muted">
            For one sequence, enter the same number in both fields.
          </p>
        )}
        {mode === "apply" && !originalOnly && (
          <button
            type="submit"
            className="w-full rounded-full border border-line px-3 py-2 text-xs font-bold text-ink hover:bg-line/35 focus-visible:ring-2 focus-visible:ring-ethereum"
          >
            Apply sequence
          </button>
        )}
      </form>
    </details>
  );
}
