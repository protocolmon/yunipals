import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import type {
  ArenaHistoryPage,
  ArenaHistoryRole,
  ArenaListStatus
} from "@protopals/yunipals-market-core/arenaViews";
import { useArenaDeployment, useArenaRequest } from "@/lib/arenaDeployment";

import {
  matchesArenaBattleView,
  type ArenaBattleView
} from "@/lib/arenaBattleViews";
export type { ArenaBattleView } from "@/lib/arenaBattleViews";

export function useArenaTournaments({
  view,
  wallet,
  role = "any",
  enabled = true
}: {
  view: ArenaBattleView;
  wallet?: Address;
  role?: ArenaHistoryRole;
  enabled?: boolean;
}) {
  const deployment = useArenaDeployment(),
    request = useArenaRequest();
  const status: ArenaListStatus =
    view === "queues" ? "active" : view === "ongoing" ? "all" : view;
  const query = useInfiniteQuery({
    queryKey: ["arena-live", deployment.scope, "battles", wallet, role, view],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ status, role, limit: "12" });
      if (wallet) params.set("wallet", wallet);
      if (pageParam) params.set("cursor", pageParam);
      return request<ArenaHistoryPage>(
        `/tournaments?${params}`,
        undefined,
        signal
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && !!deployment.apiUrl,
    refetchInterval: view === "completed" ? 30000 : 10000
  });
  const items =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter((t) => matchesArenaBattleView(t, view)) ?? [];
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  // Walk past nonmatching pages before showing an empty state. A settled film
  // still rendering remains ongoing, even though its combat result is fixed.
  useEffect(() => {
    if (enabled && !items.length && hasNextPage && !isFetching && !isError)
      void fetchNextPage();
  }, [enabled, items.length, hasNextPage, isFetching, isError, fetchNextPage]);
  return { query, items };
}
