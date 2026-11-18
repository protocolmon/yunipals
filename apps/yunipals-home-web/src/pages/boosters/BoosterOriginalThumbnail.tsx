import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BoosterOriginal } from "@protopals/yunipals-market-core/boosters";

import { BoosterCardThumbnail } from "@/components/BoosterCardThumbnail";
import { CardLightbox } from "@/components/CardLightbox";
import { CardArtworkLoader } from "@/components/CardArtworkLoader";
import {
  boosterQueryKey,
  fetchBoosterMonster,
  fetchMonsterArtwork
} from "@/lib/boosters";

export function BoosterOriginalThumbnail({
  original,
  variant = "compact"
}: {
  original: BoosterOriginal;
  variant?: "compact" | "preview";
}) {
  const [expanded, setExpanded] = useState(false);
  const monster = useQuery({
    queryKey: [
      ...boosterQueryKey,
      "monster",
      original.collection,
      original.tokenId
    ],
    queryFn: ({ signal }) =>
      fetchBoosterMonster(original.collection, original.tokenId, signal),
    staleTime: 60_000,
    retry: 1
  });
  const uri = monster.data?.item.metadataUri;
  const artwork = useQuery({
    queryKey: [...boosterQueryKey, "artwork", uri],
    enabled: Boolean(uri),
    queryFn: ({ signal }) => fetchMonsterArtwork(uri!, signal),
    staleTime: Infinity,
    retry: 1,
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== "ready" ? 10_000 : false
  });
  const image = artwork.data?.image;
  if (variant === "preview") {
    const label = `Yunipal #${original.tokenId}`;
    return (
      <>
        <button
          type="button"
          aria-label={`View ${label} larger`}
          disabled={!image}
          onClick={() => setExpanded(true)}
          className="mx-auto block aspect-[2/3] w-full max-w-20 overflow-hidden rounded-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grape focus-visible:ring-offset-2 disabled:cursor-wait motion-reduce:transform-none motion-reduce:transition-none"
        >
          {!image && (monster.isLoading || artwork.isFetching) ? (
            <CardArtworkLoader label={label} />
          ) : (
            <BoosterCardThumbnail image={image ?? null} alt={label} />
          )}
        </button>
        {expanded && artwork.data && (
          <CardLightbox
            artwork={artwork.data}
            label={label}
            onClose={() => setExpanded(false)}
          />
        )}
      </>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-lavender/20"
    >
      {image ? (
        <BoosterCardThumbnail image={image} alt="" />
      ) : (
        <img
          src="/images/yunipals-logo.webp"
          alt=""
          width={28}
          height={28}
          className="h-7 w-7"
        />
      )}
    </span>
  );
}
