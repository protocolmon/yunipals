import {
  hashKey,
  type QueryClient,
  type QueryKey
} from "@tanstack/react-query";

import { solanaCacheVersion } from "@/lib/solanaIndexer";

/** Keep only five paginated Solana response payloads across all filters and routes. */
export function pruneSolanaPages(client: QueryClient, activeKey: QueryKey) {
  const activeHash = hashKey(activeKey);
  const oldPages = client
    .getQueryCache()
    .findAll({ queryKey: [solanaCacheVersion] })
    .filter(
      (candidate) =>
        typeof candidate.queryKey[1] === "string" &&
        /^(collection:|owner:|leaderboard:)/.test(candidate.queryKey[1]) &&
        candidate.state.data !== undefined &&
        candidate.queryHash !== activeHash
    )
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const candidate of oldPages.slice(4))
    client.removeQueries({ queryKey: candidate.queryKey, exact: true });
}
