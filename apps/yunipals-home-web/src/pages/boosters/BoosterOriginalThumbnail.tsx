import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BoosterOriginal } from "@protopals/yunipals-market-core/boosters";

import {
  boosterQueryKey,
  fetchBoosterMonster,
  fetchMonsterArtwork
} from "@/lib/boosters";

export function BoosterOriginalThumbnail({
  original
}: {
  original: BoosterOriginal;
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
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
  return (
    <span
      aria-hidden="true"
      className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-lavender/20"
    >
      {image && image !== failedImage ? (
        <img
          src={image}
          alt=""
          width={40}
          height={56}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-contain"
          onError={() => setFailedImage(image)}
        />
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
