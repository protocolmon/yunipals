import { useQuery } from "@tanstack/react-query";

import {
  matchesPortalDeployment,
  selectMonsterArtwork
} from "@/lib/social/artwork";
import { environment } from "@/environment";
import { boosterQueryKey, fetchMonsterArtwork } from "@/lib/boosters";
import { fetchPortalStatus, portalApiUrl } from "@/lib/portals";

export type ArtworkCard = { collection: string; tokenId: string };

/** Variant artwork is immutable; an individual graded card's display is not.
 * Load original art independently; validate the deployment before graded art. */
export function useBoosterArtwork(uri: string | undefined, card?: ArtworkCard) {
  const inspect = Boolean(environment.portalsEnabled && card && uri);
  const status = useQuery({
    queryKey: ["portals", "active"],
    queryFn: ({ signal }) => fetchPortalStatus(signal),
    enabled: inspect,
    staleTime: 15000,
    refetchInterval: inspect ? 15000 : false,
    retry: 1
  });
  const deployment = status.data?.enabled ? status.data.deployment : null;
  const portalCard =
    inspect &&
    matchesPortalDeployment(deployment, {
      chainId: environment.portalChainId,
      grading: environment.portalGrading,
      cards: card?.collection ?? ""
    });
  const original = useQuery({
    queryKey: [...boosterQueryKey, "artwork", uri],
    queryFn: ({ signal }) => fetchMonsterArtwork(uri!, signal),
    enabled: Boolean(uri),
    staleTime: Infinity,
    retry: 1,
    refetchInterval: (value) =>
      value.state.data && value.state.data.status !== "ready" ? 5000 : false
  });
  const source = `${portalApiUrl()}/v1/portals/cards/${encodeURIComponent(card?.tokenId ?? "")}.json`;
  const query = useQuery({
    queryKey: [...boosterQueryKey, "artwork", source],
    queryFn: async ({ signal }) => {
      const artwork = await fetchMonsterArtwork(source, signal);
      // Preserve original foil layers before the first grade.
      return artwork.portalVersion === "0"
        ? fetchMonsterArtwork(uri!, signal)
        : artwork;
    },
    enabled: Boolean(portalCard),
    staleTime: 5000,
    retry: 1,
    refetchInterval: portalCard ? 15000 : false
  });
  // Keep successful artwork visible while a background refresh is unavailable.
  const graded = portalCard ? query.data : undefined;
  const data = selectMonsterArtwork(original.data, graded);
  const error = data?.image
    ? null
    : original.error || (portalCard ? query.error : null);
  return {
    data,
    error,
    isPending: !data && !error && original.isPending,
    isOriginalFallback: Boolean(
      inspect &&
        data?.image &&
        !graded?.image &&
        (!status.data || status.error || portalCard)
    ),
    portalCard,
    canGrade: Boolean(
      portalCard &&
        query.data &&
        (query.data.completedGrade !== undefined
          ? !query.data.completedGrade
          : !query.data.portalVersion || query.data.portalVersion === "0")
    ),
    refetch: () =>
      Promise.all([
        original.refetch(),
        ...(inspect ? [status.refetch()] : []),
        ...(portalCard ? [query.refetch()] : [])
      ])
  };
}
