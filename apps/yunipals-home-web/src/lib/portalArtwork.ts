export const rainbowPortalArtwork =
  "/images/portals/rainbow-portal-card-v3.webp";

type PortalArtwork = { imageURI: string; name: string; kindId?: string };

/** App presentation only; contract metadata and artwork hashes stay authoritative. */
export function portalArtworkUri(portal: PortalArtwork): string {
  // Upcoming-window summaries predate kindId, so use their exact kind name.
  const rainbow =
    portal.kindId === "1" ||
    (portal.kindId === undefined && portal.name === "Rainbow Portal");
  return rainbow ? rainbowPortalArtwork : portal.imageURI;
}
