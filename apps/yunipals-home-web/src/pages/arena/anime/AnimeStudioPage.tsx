import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ANIME_REASONS,
  type AnimeFighter,
  type AnimeStatus
} from "@protopals/yunipals-market-core/anime";
import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import { ArenaNavigation } from "../live/ArenaNavigation";
import { cn } from "@/lib/utils";
type Queue = {
  items: AnimeFighter[];
  counts: Record<AnimeStatus, number>;
  nextCursor: string | null;
};
export function AnimeStudioPage() {
  const [status, setStatus] = useState<AnimeStatus>("Applied");
  const deployment = useArenaDeployment(),
    request = useArenaRequest();
  const query = useInfiniteQuery({
    queryKey: ["anime-studio", status],
    initialPageParam: undefined as string | undefined,
    enabled: !!deployment.apiUrl,
    queryFn: ({ pageParam, signal }) =>
      request<Queue>(
        `/fighters?status=${status}&limit=24${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`,
        undefined,
        signal
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 30000
  });
  const counts = query.data?.pages[0]?.counts;
  return (
    <main className="mx-auto max-w-5xl px-5 pb-20 pt-12 text-ink">
      <p className="text-sm font-bold uppercase tracking-widest text-grape">
        Anime Arena
      </p>
      <h1 className="mt-3 font-display text-4xl">Public fighter queue</h1>
      <p className="mt-4 max-w-2xl text-muted">
        Every application is visible. The curator reviews fighters in
        application order. Rejection reasons and notes are public; holders can
        reapply.
      </p>
      <ArenaNavigation />
      <div
        className="my-6 flex flex-wrap gap-3"
        aria-label="Filter fighter queue"
      >
        {(["Applied", "Approved", "Rejected", "Revoked"] as const).map((s) => (
          <button
            type="button"
            key={s}
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full border px-4 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape",
              status === s
                ? "border-ink bg-ink text-white"
                : "border-line bg-white"
            )}
          >
            {s}
            {counts ? ` · ${counts[s]}` : ""}
          </button>
        ))}
      </div>
      {!deployment.apiUrl ? (
        <p>The public queue will open with applications.</p>
      ) : query.isPending ? (
        <div
          className="h-24 animate-pulse rounded-card bg-lavender/30"
          aria-label="Loading queue"
        />
      ) : query.error ? (
        <p role="alert">
          The queue is temporarily unavailable.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <>
          <ol className="space-y-3">
            {query.data?.pages
              .flatMap((p) => p.items)
              .map((f) => (
                <li
                  key={f.tokenId}
                  className="rounded-card border border-line p-4"
                >
                  <Link
                    className="font-bold underline"
                    to={`/collection/base/${f.tokenId}`}
                  >
                    Base Yunipal #{f.tokenId}
                  </Link>
                  <p className="mt-2 text-sm">
                    {f.status} · Application #{f.applications}
                  </p>
                  {f.reviewRequired && (
                    <p className="mt-2 text-sm text-destructive">
                      Art or traits need curator review before entry.
                    </p>
                  )}
                  {f.reasonCode !== null && (
                    <p className="mt-2 text-sm">
                      {ANIME_REASONS[f.reasonCode]}
                    </p>
                  )}
                  {f.note && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                      Curator note: {f.note}
                    </p>
                  )}
                </li>
              ))}
          </ol>
          {!query.data?.pages[0]?.items.length && (
            <p>No {status.toLowerCase()} fighters.</p>
          )}
          {query.hasNextPage && (
            <button
              className="mt-6 rounded-full border border-line px-5 py-3"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more fighters"}
            </button>
          )}
        </>
      )}
    </main>
  );
}
