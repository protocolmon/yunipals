import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { QueryError } from "@/components/QueryState";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { formatDecimal, formatInteger, shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  fetchExomonLeaderboard,
  solanaMetrics,
  type SolanaMetric
} from "@/lib/solanaIndexer";
import { useExomonPagination } from "@/pages/exomon/useExomonPagination";

const labels: Record<SolanaMetric, string> = {
  "collector-score": "Collector score",
  "total-rarity": "Total rarity",
  "monster-count": "Exomon count",
  "unique-types": "Unique types",
  "special-count": "Special count",
  "glitter-count": "Glitter count"
};

function Ranking({ metric }: { metric: SolanaMetric }) {
  const { query, next, previous, canPrevious, pageNumber } =
    useExomonPagination(`leaderboard:${metric}`, (cursor, signal) =>
      fetchExomonLeaderboard(metric, cursor, signal)
    );
  return (
    <section aria-label={`${labels[metric]} ranking`}>
      {query.isPending ? (
        <div className="h-96 animate-pulse rounded-card bg-line" />
      ) : query.isError ? (
        <QueryError
          message="Exomon rankings are temporarily unavailable."
          onRetry={() => void query.refetch()}
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white">
          {query.data.items.map((entry) => (
            <Link
              key={entry.owner}
              to={`/collector/solana/${entry.owner}`}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-line px-4 py-4 last:border-b-0 hover:bg-sky/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-badge sm:px-6"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full bg-sky/50 text-sm font-black text-ink">
                {entry.rank}
              </span>
              <span className="min-w-0">
                <span
                  className="block truncate text-sm font-extrabold text-ink"
                  title={entry.owner}
                >
                  {shortAddress(entry.owner)}
                </span>
                <span className="mt-1 block text-xs text-muted">
                  {formatInteger(entry.monsterCount)} Exomon ·{" "}
                  {entry.uniqueTypes} types
                </span>
              </span>
              <span className="text-right">
                <span className="block text-base font-black text-ink">
                  {metric === "collector-score" || metric === "total-rarity"
                    ? formatDecimal(
                        entry.score,
                        metric === "total-rarity" ? 1 : 0
                      )
                    : formatInteger(entry.score)}
                </span>
                <span className="block text-[10px] font-bold uppercase text-muted">
                  {labels[metric]}
                </span>
              </span>
            </Link>
          ))}
          {!query.data.items.length && (
            <p className="p-8 text-center text-sm text-muted">
              No ranked collectors yet.
            </p>
          )}
        </div>
      )}
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={previous}
          disabled={!canPrevious || query.isFetching}
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm font-bold text-ink disabled:opacity-40"
        >
          <ArrowLeft size={16} /> Previous
        </button>
        <span className="text-xs font-bold text-muted">Page {pageNumber}</span>
        <button
          type="button"
          onClick={next}
          disabled={!query.data?.nextCursor || query.isFetching}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
        >
          Next <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

export function ExomonLeaderboardPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("metric") as SolanaMetric;
  const metric = solanaMetrics.includes(requested)
    ? requested
    : "collector-score";
  usePageMetadata(
    "Exomon collector leaderboard — Yunipals",
    "Rank Solana Exomon collectors by rarity, collection size, types, specials, glitter, and collector score."
  );
  return (
    <main className="min-h-[65vh] bg-gradient-to-b from-sky/20 to-white px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <Link
          to="/?chain=solana"
          className="text-sm font-bold text-badge hover:underline"
        >
          ← Exomon collection
        </Link>
        <h1 className="display mt-4 text-4xl text-ink sm:text-5xl">
          Exomon leaderboard
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Rankings use active Exomon in the latest completed Solana scan.
          Collector score combines rarity, count, variety, specials, and
          glitter.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            to="/leaderboard"
            className="rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink"
          >
            Yunipals · EVM
          </Link>
          <span className="rounded-full border border-badge bg-sky/40 px-4 py-2 text-sm font-bold text-ink">
            Exomon · Solana
          </span>
        </div>
        <div
          className="my-6 flex flex-wrap gap-2"
          role="group"
          aria-label="Ranking metric"
        >
          {solanaMetrics.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={item === metric}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("chain", "solana");
                next.set("metric", item);
                setParams(next);
              }}
              className={cn(
                "rounded-full border px-4 py-2 text-sm font-bold",
                item === metric
                  ? "border-badge bg-badge/10 text-badge"
                  : "border-line bg-white text-ink hover:bg-line/40"
              )}
            >
              {labels[item]}
            </button>
          ))}
        </div>
        <Ranking key={metric} metric={metric} />
      </div>
    </main>
  );
}
