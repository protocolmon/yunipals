import {
  useInfiniteQuery,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  Crown,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Trophy,
  Users
} from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { QueryError } from "@/components/QueryState";
import {
  formatDecimal,
  formatInteger,
  formatUpdatedAt,
  shortAddress
} from "@/lib/format";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { environment } from "@/environment";
import {
  fetchLeaderboard,
  fetchLeaderboardDefinitions,
  indexedCollectionCacheVersion,
  leaderboardMetrics,
  type LeaderboardEntry,
  type LeaderboardMetric
} from "@/lib/yunipalsIndexer";

const FALLBACK_LABELS: Record<LeaderboardMetric, string> = {
  "collector-score": "Collector score",
  "total-rarity": "Total rarity",
  "monster-count": "Monster count",
  "unique-types": "Unique types",
  "special-count": "Special count",
  "glitter-count": "Glitter count"
};

const METRIC_BLURBS: Record<LeaderboardMetric, string> = {
  "collector-score":
    "A balanced score for rarity, collection size, variety, specials, and glitter.",
  "total-rarity": "The combined rarity points of every active Yunipal held.",
  "monster-count":
    "Every active Yunipal held, including NFTs whose metadata is still unavailable.",
  "unique-types":
    "The number of different Yunipal types represented in a wallet.",
  "special-count": "Active Yunipals whose Special metadata trait is Yes.",
  "glitter-count": "Active Yunipals carrying a glitter trait."
};

function isLeaderboardMetric(value: string | null): value is LeaderboardMetric {
  return leaderboardMetrics.some((metric) => metric === value);
}

function scoreFor(metric: LeaderboardMetric, entry: LeaderboardEntry) {
  if (metric === "total-rarity") return formatDecimal(entry.score, 1);
  if (metric === "collector-score") return formatDecimal(entry.score, 0);
  return formatInteger(entry.score);
}

function supportingMetrics(metric: LeaderboardMetric, entry: LeaderboardEntry) {
  if (metric === "collector-score") {
    return `${formatInteger(entry.monsterCount)} Yunipals · ${entry.uniqueTypes} types`;
  }
  if (metric === "total-rarity") {
    return `${formatInteger(entry.monsterCount)} Yunipals · ${entry.specialCount} special`;
  }
  if (metric === "monster-count") {
    return `${entry.uniqueTypes} types · ${entry.glitterCount} glitter`;
  }
  if (metric === "unique-types") {
    return `${formatInteger(entry.monsterCount)} Yunipals · ${formatDecimal(entry.totalRarity, 0)} rarity`;
  }
  if (metric === "special-count") {
    return `${entry.glitterCount} glitter · ${entry.uniqueTypes} types`;
  }
  return `${entry.specialCount} special · ${formatInteger(entry.monsterCount)} Yunipals`;
}

function RankBadge({ rank }: { rank: number }) {
  const podium = rank <= 3;
  const colors = [
    "text-amber-700 bg-amber-100",
    "text-slate-600 bg-slate-100",
    "text-orange-700 bg-orange-100"
  ];

  return (
    <span
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-black ${
        podium ? colors[rank - 1] : "bg-line/55 text-muted"
      }`}
      aria-label={`Rank ${rank}`}
    >
      {podium ? <Trophy aria-hidden="true" size={15} /> : rank}
    </span>
  );
}

function LeaderRow({
  entry,
  metric
}: {
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
}) {
  return (
    <Link
      to={`/collector/${entry.owner}`}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-4 py-4 transition last:border-0 hover:bg-lavender/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ethereum sm:px-6"
    >
      <RankBadge rank={entry.rank} />
      <div className="min-w-0">
        <p
          className="truncate text-sm font-extrabold text-ink"
          title={entry.owner}
        >
          {entry.ensName ?? shortAddress(entry.owner)}
        </p>
        <p className="mt-1 truncate text-xs font-medium text-muted">
          {entry.ensName && (
            <span title={entry.owner}>{shortAddress(entry.owner)} · </span>
          )}
          {supportingMetrics(metric, entry)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-base font-black text-ink sm:text-lg">
          {scoreFor(metric, entry)}
        </p>
        <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
          {FALLBACK_LABELS[metric]}
        </p>
      </div>
    </Link>
  );
}

export function LeaderboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMetric = searchParams.get("metric");
  const metric: LeaderboardMetric = isLeaderboardMetric(requestedMetric)
    ? requestedMetric
    : "collector-score";
  const queryClient = useQueryClient();

  usePageMetadata(
    "Collector Leaderboard — Yunipals",
    "See how Yunipals collectors across Ethereum, Base, Polygon, and BNB Chain rank by collector score, rarity, collection size, unique types, specials, and glitter."
  );

  const definitionsQuery = useQuery({
    queryKey: ["leaderboard", indexedCollectionCacheVersion, "definitions"],
    queryFn: ({ signal }) => fetchLeaderboardDefinitions(undefined, signal),
    refetchInterval: 60_000
  });
  const boardQuery = useInfiniteQuery({
    queryKey: ["leaderboard", indexedCollectionCacheVersion, metric],
    queryFn: ({ pageParam, signal }) =>
      fetchLeaderboard(
        metric,
        { limit: 50, cursor: pageParam || undefined },
        signal
      ),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    refetchInterval: 60_000
  });

  const entries = useMemo(() => {
    const seen = new Set<string>();
    return (boardQuery.data?.pages.flatMap((page) => page.items) ?? []).filter(
      (entry) => {
        const key = entry.owner.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }
    );
  }, [boardQuery.data]);

  const snapshotTimestamps = new Set(
    boardQuery.data?.pages.map((page) => page.updatedAt).filter(Boolean) ?? []
  );
  const snapshotChanged = snapshotTimestamps.size > 1;
  const updatedAt =
    boardQuery.data?.pages[0]?.updatedAt ?? definitionsQuery.data?.updatedAt;
  const definitions =
    definitionsQuery.data?.items ??
    leaderboardMetrics.map((slug) => ({ slug, label: FALLBACK_LABELS[slug] }));

  function refreshBoard() {
    void queryClient.resetQueries({
      queryKey: ["leaderboard", indexedCollectionCacheVersion, metric],
      exact: true
    });
    void definitionsQuery.refetch();
  }

  return (
    <main className="min-h-[70vh] bg-gradient-to-b from-lavender/30 via-white to-white">
      <section className="px-4 py-14 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-ethereum">
                Ethereum + Base + Polygon + BNB Chain collectors
              </p>
              <h1 className="display mt-3 text-5xl text-ink sm:text-7xl">
                Leaderboard
              </h1>
              <p className="mt-4 max-w-2xl text-base font-medium leading-relaxed text-ink/65">
                {METRIC_BLURBS[metric]} Equal values share the same rank.
              </p>
            </div>
            <button
              type="button"
              onClick={refreshBoard}
              disabled={boardQuery.isFetching}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink shadow-sm transition hover:bg-line/30 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum"
            >
              <RefreshCw
                aria-hidden="true"
                size={15}
                className={boardQuery.isFetching ? "animate-spin" : undefined}
              />
              Refresh
            </button>
          </div>

          {environment.exomonEnabled && (
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="rounded-full border border-ethereum bg-lavender/40 px-4 py-2 text-sm font-bold text-ink">
                Yunipals · EVM
              </span>
              <Link
                to="/leaderboard?chain=solana"
                className="rounded-full border border-line bg-white px-4 py-2 text-sm font-bold text-ink hover:bg-sky/20"
              >
                Exomon · Solana
              </Link>
            </div>
          )}

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-ethereum/10 bg-white/80 p-4 shadow-sm">
              <Users aria-hidden="true" className="text-ethereum" size={17} />
              <p className="mt-4 text-2xl font-black text-ink">
                {definitionsQuery.data
                  ? formatInteger(definitionsQuery.data.wallets)
                  : "—"}
              </p>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">
                Ranked wallets
              </p>
            </div>
            <div className="rounded-2xl border border-ethereum/10 bg-white/80 p-4 shadow-sm">
              <Crown aria-hidden="true" className="text-ethereum" size={17} />
              <p className="mt-4 text-base font-black text-ink sm:text-lg">
                {definitionsQuery.data?.collectorScore.version ??
                  "collector-score-v1"}
              </p>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">
                Score version
              </p>
            </div>
            <div className="col-span-2 rounded-2xl border border-ethereum/10 bg-white/80 p-4 shadow-sm sm:col-span-1">
              <Sparkles
                aria-hidden="true"
                className="text-ethereum"
                size={17}
              />
              <p className="mt-4 text-sm font-black text-ink">60 seconds</p>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">
                Snapshot refresh
              </p>
            </div>
          </div>

          <div className="mt-7">
            <label htmlFor="leaderboard-metric" className="sr-only">
              Leaderboard metric
            </label>
            <select
              id="leaderboard-metric"
              value={metric}
              onChange={(event) =>
                setSearchParams({ metric: event.target.value })
              }
              className="w-full rounded-full border border-line bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus-visible:ring-2 focus-visible:ring-ethereum sm:hidden"
            >
              {definitions.map((definition) => (
                <option key={definition.slug} value={definition.slug}>
                  {definition.label}
                </option>
              ))}
            </select>
            <div
              className="hidden flex-wrap gap-2 sm:flex"
              role="group"
              aria-label="Leaderboard metric"
            >
              {definitions.map((definition) => {
                const active = definition.slug === metric;
                return (
                  <button
                    key={definition.slug}
                    type="button"
                    onClick={() => setSearchParams({ metric: definition.slug })}
                    aria-pressed={active}
                    className={`rounded-full border px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ethereum focus-visible:ring-offset-2 ${active ? "border-ethereum/40 bg-ethereum/10 text-ethereum" : "border-line bg-white text-ink hover:bg-line/35"}`}
                  >
                    {definition.label}
                  </button>
                );
              })}
            </div>
          </div>

          {metric === "collector-score" && definitionsQuery.data && (
            <div className="mt-5 rounded-2xl border border-ethereum/15 bg-ethereum/5 px-5 py-4">
              <div className="flex items-start gap-3">
                <Star
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-ethereum"
                  size={17}
                />
                <div>
                  <p className="text-sm font-extrabold text-ink">
                    How collector score works
                  </p>
                  <p className="mt-1 break-words font-mono text-xs leading-relaxed text-ink/65">
                    {definitionsQuery.data.collectorScore.formula}
                  </p>
                  <p className="mt-2 text-xs font-medium text-muted">
                    The indexer’s score is authoritative; the formula is shown
                    for transparency.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 overflow-hidden rounded-[28px] border border-line bg-white shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-line/20 px-5 py-4">
              <div>
                <h2 className="text-sm font-extrabold text-ink">
                  {FALLBACK_LABELS[metric]}
                </h2>
                <p className="mt-0.5 text-xs font-medium text-muted">
                  {formatUpdatedAt(updatedAt)}
                </p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-muted shadow-sm">
                {formatInteger(entries.length)} loaded
              </span>
            </div>

            {boardQuery.isLoading ? (
              <div className="space-y-1 p-4" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => (
                  <div
                    key={index}
                    className="h-16 animate-pulse rounded-xl bg-line/60"
                  />
                ))}
              </div>
            ) : boardQuery.isError && entries.length === 0 ? (
              <div className="p-5">
                <QueryError onRetry={() => void boardQuery.refetch()} />
              </div>
            ) : (
              entries.map((entry) => (
                <LeaderRow key={entry.owner} entry={entry} metric={metric} />
              ))
            )}
          </div>

          {snapshotChanged && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-900">
              A new snapshot arrived while this page was open. Refresh the board
              before loading more ranks.
            </div>
          )}

          {boardQuery.hasNextPage && !snapshotChanged && (
            <div className="mt-7 text-center">
              <button
                type="button"
                onClick={() => void boardQuery.fetchNextPage()}
                disabled={boardQuery.isFetchingNextPage}
                className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white shadow-cta transition hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4"
              >
                {boardQuery.isFetchingNextPage && (
                  <Loader2
                    aria-hidden="true"
                    className="animate-spin"
                    size={16}
                  />
                )}
                {boardQuery.isFetchingNextPage ? "Loading…" : "Load 50 more"}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
