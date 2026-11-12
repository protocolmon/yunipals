import { useQuery } from "@tanstack/react-query";
import { environment } from "@/environment";
import { boosterQueryKey, fetchMonsterArtwork } from "@/lib/boosters";
import { fetchPortalStatus, portalApiUrl } from "@/lib/portals";

export type ArtworkCard = { collection: string; tokenId: string };

/** Variant artwork is immutable; an individual graded card's display is not.
 * Resolve the portal deployment before switching that card's metadata source. */
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
    !!deployment &&
    deployment.chainId === environment.portalChainId &&
    deployment.grading.toLowerCase() ===
      environment.portalGrading.toLowerCase() &&
    deployment.cards.toLowerCase() === card?.collection.toLowerCase();
  const resolving = inspect && (!status.data || !!status.error);
  const source = portalCard
    ? `${portalApiUrl()}/v1/portals/cards/${encodeURIComponent(card!.tokenId)}.json`
    : uri;
  const query = useQuery({
    queryKey: [...boosterQueryKey, "artwork", source],
    queryFn: async ({ signal }) => {
      const artwork = await fetchMonsterArtwork(source!, signal);
      // Preserve the existing original card and foil layers before its first grade.
      return portalCard && artwork.portalVersion === "0"
        ? fetchMonsterArtwork(uri!, signal)
        : artwork;
    },
    enabled: Boolean(source) && !resolving,
    staleTime: portalCard ? 5000 : Infinity,
    retry: 1,
    refetchInterval: (value) =>
      portalCard || (value.state.data && value.state.data.status !== "ready")
        ? 5000
        : false
  });
  return {
    data: resolving || query.error ? undefined : query.data,
    error: resolving ? status.error : query.error,
    isPending: resolving ? status.isPending : query.isPending,
    portalCard,
    refetch: () => (resolving ? status.refetch() : query.refetch())
  };
}
