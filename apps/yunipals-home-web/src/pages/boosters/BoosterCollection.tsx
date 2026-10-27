import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { isAddress } from "viem";
import { Sparkles } from "lucide-react";
import type { BoosterMonster } from "@protopals/yunipals-market-core/boosters";
import {
  boosterAddresses,
  boosterQueryKey,
  fetchBoosterOwner,
  fetchMonsterArtwork
} from "@/lib/boosters";
import { BoosterCardViewer } from "@/components/BoosterCardViewer";
import { BoosterCardLightbox } from "./BoosterCardLightbox";

export function BoosterArtwork({
  uri,
  label,
  interactive = false
}: {
  uri: string;
  label: string;
  interactive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    queryKey: [...boosterQueryKey, "artwork", uri],
    queryFn: ({ signal }) => fetchMonsterArtwork(uri, signal),
    staleTime: Infinity,
    retry: 1,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== "ready" ? 5000 : false
  });
  if (query.data?.image)
    return (
      <>
        <BoosterCardViewer
          artwork={query.data}
          interactive={interactive}
          onExpand={interactive ? () => setExpanded(true) : undefined}
        />
        {expanded && (
          <BoosterCardLightbox
            artwork={query.data}
            label={label}
            onClose={() => setExpanded(false)}
          />
        )}
      </>
    );
  return (
    <div
      className="flex aspect-[2/3] items-center justify-center rounded-card bg-lavender/20 p-6 text-center text-muted"
      role="status"
      aria-label={label}
    >
      <div>
        <Sparkles className="mx-auto mb-2 h-10 w-10" aria-hidden="true" />
        <span className="text-sm">
          {query.isPending
            ? "Loading artwork…"
            : query.error
              ? "Artwork could not be loaded."
              : "Your Yunipal is revealed. Its artwork is being prepared."}
        </span>
        {query.error && interactive && (
          <button
            type="button"
            className="mt-3 block w-full underline"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function BoosterCollection({ owner }: { owner: string }) {
  const deployment = boosterAddresses();
  const enabled = deployment !== null && isAddress(owner);
  const monsters = useInfiniteQuery({
    queryKey: [...boosterQueryKey, "monsters", owner.toLowerCase()],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      fetchBoosterOwner<BoosterMonster>(owner, "monsters", pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 15_000
  });
  if (!enabled) return null;
  const items = monsters.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section
      className="mx-auto max-w-7xl px-4 py-10"
      aria-labelledby="booster-collection-title"
    >
      <h2 id="booster-collection-title" className="font-display text-2xl">
        Booster Yunipals
      </h2>
      <p className="mt-2 text-muted">
        Your Yunipals from booster packs on Base. Open daily packs from the
        Packs page.
      </p>
      {monsters.isPending && (
        <p role="status" className="mt-4 animate-pulse">
          Loading booster collection…
        </p>
      )}
      {monsters.error && (
        <p role="alert" className="mt-4">
          {monsters.error.message}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              void monsters.refetch();
            }}
          >
            Try again
          </button>
        </p>
      )}
      <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
        {items.map((monster) => (
          <Link
            key={monster.id}
            to={`/monsters/${monster.collection}/${monster.tokenId}`}
            className="rounded-card border border-line p-3 focus-visible:ring-2 focus-visible:ring-ink"
          >
            <BoosterArtwork
              uri={monster.metadataUri}
              label={`Yunipal #${monster.tokenId}`}
            />
            <p className="mt-3 font-bold">Yunipal #{monster.tokenId}</p>
            <p className="text-xs text-muted">
              {monster.isOriginal ? "Original · earns mints" : "Offspring"} ·
              Variant {monster.variantId}
            </p>
          </Link>
        ))}
      </div>
      {monsters.hasNextPage && (
        <button
          type="button"
          className="mt-4 rounded-full border border-line px-5 py-3 font-bold"
          disabled={monsters.isFetchingNextPage}
          onClick={() => void monsters.fetchNextPage()}
        >
          Load more Yunipals
        </button>
      )}
      {!monsters.isPending && !monsters.error && !items.length && (
        <p className="mt-5 text-muted">
          This wallet has no revealed booster Yunipals yet.
        </p>
      )}
    </section>
  );
}
