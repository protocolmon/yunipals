import { createContext, useContext, useMemo, type ReactNode } from "react";
import { environment } from "@/environment";
import { arenaRequestAt } from "@/lib/arenaLive";
export type ArenaKind = "video" | "anime";
const ArenaDeploymentContext = createContext<{
  kind: ArenaKind;
  shared: boolean;
}>({ kind: "video", shared: false });
export function ArenaDeploymentProvider({
  kind,
  shared = false,
  children
}: {
  kind: ArenaKind;
  shared?: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ kind, shared }), [kind, shared]);
  return (
    <ArenaDeploymentContext.Provider value={value}>
      {children}
    </ArenaDeploymentContext.Provider>
  );
}
export function useArenaDeployment() {
  const { kind, shared } = useContext(ArenaDeploymentContext);
  return useMemo(
    () => ({
      kind,
      shared,
      scope: shared ? `${kind}:shared` : kind,
      apiUrl: shared
        ? environment.sharedArenaApiUrl
          ? `${environment.sharedArenaApiUrl}/${kind}`
          : null
        : kind === "anime"
          ? environment.animeArenaApiUrl
          : environment.arenaApiUrl,
      basePath:
        kind === "anime" ? "/arena/anime" : shared ? "/arena/video" : "/arena",
      entry: kind === "anime" ? "1" : "2",
      champion: kind === "anime" ? "3.20" : "6",
      label:
        kind === "anime"
          ? "Anime Arena"
          : shared
            ? "Video Arena"
            : "Previous Video Arena"
    }),
    [kind, shared]
  );
}
export function useArenaRequest() {
  const { apiUrl } = useArenaDeployment();
  return useMemo(
    () =>
      <T,>(path: string, body?: unknown, signal?: AbortSignal) =>
        arenaRequestAt<T>(apiUrl, path, body, signal),
    [apiUrl]
  );
}
