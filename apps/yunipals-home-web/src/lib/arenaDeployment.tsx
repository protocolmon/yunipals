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
      apiUrl:
        kind === "anime"
          ? environment.animeArenaApiUrl
          : environment.arenaApiUrl,
      basePath: kind === "anime" ? "/arena/anime" : "/arena",
      entry: kind === "anime" ? "1" : "2",
      champion: kind === "anime" ? "3.20" : "6",
      label: kind === "anime" ? "Anime Arena" : "Yunipals Arena"
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
