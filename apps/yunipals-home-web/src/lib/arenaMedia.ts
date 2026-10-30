export type ArenaMediaStatus = {
  state: string;
  payoutsReleased: boolean;
  incarnation?: string;
  publication?: string | null;
};

export function arenaArtifactPath(
  id: string,
  name: string,
  media?: ArenaMediaStatus
): string | null {
  if (media?.state !== "ready") return null;
  const path = `/tournaments/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(name)}`;
  if (!media.incarnation && !media.publication) return path;
  if (
    !/^0x[0-9a-f]{64}$/.test(media.incarnation ?? "") ||
    !/^0x[0-9a-f]{64}$/.test(media.publication ?? "")
  )
    return null;
  return `${path}?${new URLSearchParams({
    origin: media.incarnation!,
    publication: media.publication!
  })}`;
}
