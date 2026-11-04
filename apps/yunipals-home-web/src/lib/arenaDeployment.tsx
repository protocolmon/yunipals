import { createContext, useContext, useMemo, type ReactNode } from "react";
import { environment } from "@/environment";
import { arenaRequestAt } from "@/lib/arenaLive";
export type ArenaKind = "video" | "anime";
const ArenaDeploymentContext = createContext<ArenaKind>("video");
export function ArenaDeploymentProvider({
  kind,
  children
}: {
  kind: ArenaKind;
  children: ReactNode;
}) {
  return (
    <ArenaDeploymentContext.Provider value={kind}>
      {children}
    </ArenaDeploymentContext.Provider>
  );
}
export function useArenaDeployment() {
  const kind = useContext(ArenaDeploymentContext);
  return useMemo(
    () => ({
      kind,
      shared: true,
      scope: `${kind}:shared`,
      apiUrl: environment.sharedArenaApiUrl
        ? `${environment.sharedArenaApiUrl}/${kind}`
        : null,
      basePath: `/arena/${kind}`,
      entry: kind === "anime" ? "1" : "2",
      champion: kind === "anime" ? "3.20" : "6",
      label: kind === "anime" ? "Anime Arena" : "Video Arena"
    }),
    [kind]
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
