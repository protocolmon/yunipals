import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  ANIME_REASONS,
  type AnimeFighter,
  type AnimeStatus
} from "@protopals/yunipals-market-core/anime";
import { TokenArtwork } from "@/components/TokenArtwork";
import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";
import { fetchToken } from "@/lib/yunipalsIndexer";
import { cn } from "@/lib/utils";
import { AnimeEligibilityBadge } from "./AnimeEligibilityBadge";
import type { FighterResponse } from "./AnimeFighterCard";

type Queue = {
  items: AnimeFighter[];
  counts: Record<AnimeStatus, number>;
  nextCursor: string | null;
};
const statuses = ["Approved", "Applied", "Rejected", "Revoked"] as const;

function FighterGalleryCard({ fighter }: { fighter: AnimeFighter }) {
  const deployment = useArenaDeployment();
  const request = useArenaRequest();
  const art = useQuery({
    queryKey: ["anime-fighter", deployment.apiUrl, fighter.tokenId],
    queryFn: ({ signal }) =>
      request<FighterResponse>(
        `/fighters/${fighter.tokenId}`,
        undefined,
        signal
      ),
    enabled: !!deployment.apiUrl && fighter.status === "Approved",
    staleTime: 30000
  });
  const original = useQuery({
    queryKey: ["collection", "token", "base", fighter.tokenId],
    queryFn: ({ signal }) => fetchToken("base", fighter.tokenId, signal),
    staleTime: 60000
  });
  const manifest =
    art.data?.fighter.status === "Approved" &&
    art.data.fighter.manifestHash === fighter.manifestHash &&
    art.data.artworkState === "verified"
      ? art.data.manifest
      : null;
  const name =
    manifest?.identity.species || original.data?.token.name || "Base Yunipal";
  const image = manifest
    ? `${art.data?.assetsOrigin}/fighters/v1/${fighter.tokenId}/${manifest.sprites.idle.file}`
    : (original.data?.token.image ?? null);
  const loading =
    !image &&
    (original.isPending || (art.isPending && fighter.status === "Approved"));
  return (
    <li className="overflow-hidden rounded-card border border-line bg-white shadow-card">
      <Link
        to={`/collection/base/${fighter.tokenId}`}
        className="group block rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
      >
        <div className="relative aspect-square bg-gradient-to-br from-lavender/40 to-sky/30">
          {loading ? (
            <div
              className="h-full animate-pulse bg-lavender/30"
              aria-label="Loading monster artwork"
            />
          ) : (
            <TokenArtwork
              src={image}
              alt={`${name}${manifest ? " anime fighter" : " original monster"}`}
              className={manifest ? "object-contain p-6" : undefined}
            />
          )}
          <span className="absolute bottom-3 left-3 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-ink">
            {manifest ? "Anime fighter" : "Original monster"}
          </span>
        </div>
        <div className="space-y-2 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-lg text-ink group-hover:text-grape">
              {name}
            </h2>
            <ArrowUpRight
              size={18}
              className="mt-1 shrink-0 text-muted"
              aria-hidden="true"
            />
          </div>
          <p className="text-sm text-muted">#{fighter.tokenId}</p>
          <p className="text-xs font-semibold text-grape">
            {fighter.status === "Applied" ? "Awaiting review" : fighter.status}
          </p>
          {fighter.reviewRequired && (
            <p className="text-sm text-destructive">
              Artwork or traits need review before entry.
            </p>
          )}
          {fighter.reasonCode !== null && (
            <p className="text-sm text-muted">
              {ANIME_REASONS[fighter.reasonCode]}
            </p>
          )}
          {fighter.note && (
            <p className="whitespace-pre-wrap break-words text-sm text-muted">
              {fighter.note}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

export function AnimeStudioPage() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("status");
  const status = statuses.find((value) => value === selected) ?? "Approved";
  const deployment = useArenaDeployment();
  const request = useArenaRequest();
  const query = useInfiniteQuery({
    queryKey: ["anime-studio", deployment.scope, status],
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
    <main className="mx-auto max-w-6xl px-5 pb-20 pt-8 text-ink sm:pt-10">
      <Link
        to="/arena/anime"
        className="inline-flex items-center gap-2 rounded text-sm font-semibold text-muted hover:text-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-grape"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Anime Arena
      </Link>
      <header className="my-6 flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl sm:text-4xl">
            Meet the fighters
          </h1>
          <p className="mt-3 max-w-xl text-muted">
            Explore approved monsters and follow new applications from all
            players. Approval prepares your monster for battle; it does not
            enter a battle automatically.
          </p>
        </div>
        <AnimeEligibilityBadge />
      </header>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Link
          to="/arena/anime"
          className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-grape focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-grape"
        >
          Join a battle
        </Link>
        <p className="text-sm text-muted">
          Already approved? Choose one of your fighters in the arena to enter.
        </p>
      </div>
      <p className="mb-3 text-sm font-semibold text-muted">
        Across all players
      </p>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
        <div className="flex flex-wrap gap-2" aria-label="Filter fighters">
          {statuses.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() =>
                setParams((current) => {
                  const next = new URLSearchParams(current);
                  next.set("status", value);
                  return next;
                })
              }
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-grape",
                status === value
                  ? "bg-ink text-white"
                  : "bg-lavender/25 text-muted hover:bg-lavender/50"
              )}
            >
              {value === "Applied" ? "Applications" : value}
              {counts ? ` · ${counts[value]}` : ""}
            </button>
          ))}
        </div>
        <Link
          to="/?chain=base"
          className="text-sm font-semibold text-grape underline underline-offset-4"
        >
          Find a monster to apply
        </Link>
      </div>
      {!deployment.apiUrl ? (
        <p>Fighter approvals will open with applications.</p>
      ) : query.isPending ? (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3"
          aria-label="Loading fighters"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded-card bg-lavender/30"
            />
          ))}
        </div>
      ) : query.error ? (
        <p role="alert">
          Fighters are temporarily unavailable.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <>
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {query.data?.pages
              .flatMap((page) => page.items)
              .map((fighter) => (
                <FighterGalleryCard key={fighter.tokenId} fighter={fighter} />
              ))}
          </ol>
          {!query.data?.pages[0]?.items.length && (
            <div className="flex flex-col items-center rounded-card bg-lavender/20 px-6 py-10 text-center">
              <img
                src="/images/arena/anime-chick.webp"
                alt="Anime artwork preview"
                width={160}
                height={160}
                className="h-40 w-40 object-contain"
              />
              <p className="mt-4 font-display text-xl">
                {status === "Applied"
                  ? "All caught up"
                  : `No ${status.toLowerCase()} fighters yet`}
              </p>
              <p className="mt-2 text-sm text-muted">
                {status === "Applied"
                  ? "There are no applications waiting for review."
                  : "Fighters will appear here when their status changes."}
              </p>
              <span className="mt-4 text-xs text-muted">
                Anime artwork preview
              </span>
            </div>
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
