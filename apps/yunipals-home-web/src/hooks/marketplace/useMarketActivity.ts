import { useInfiniteQuery } from "@tanstack/react-query";

import { environment } from "@/environment";
import {
  activityScopeKey,
  ActivitySnapshotError,
  createActivityClient,
  nextActivityPage,
  type ActivityContinuation,
  type ActivityScope
} from "@/lib/marketplace/activity";
import { MarketApiError } from "@/lib/marketplace/marketApiError";

const client = (() => {
  try {
    return environment.yunipalsMarketplaceUrl
      ? createActivityClient(environment.yunipalsMarketplaceUrl)
      : null;
  } catch {
    return null;
  }
})();

export function useMarketActivity(scope: ActivityScope) {
  const queryKey = [
    "marketplace",
    "activity",
    activityScopeKey(scope)
  ] as const;
  const query = useInfiniteQuery({
    queryKey,
    enabled: Boolean(client),
    initialPageParam: undefined as ActivityContinuation | undefined,
    queryFn: ({ pageParam, signal }) =>
      client!.activity(scope, pageParam, signal),
    getNextPageParam: nextActivityPage,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    retry: (count, error) =>
      count < 1 &&
      !(error instanceof ActivitySnapshotError) &&
      !(error instanceof MarketApiError && error.status === 409)
  });
  // An invalidated or inconsistent snapshot can contain orphaned sales. Do not
  // retain its rows under a confirmed label while waiting for a fresh snapshot.
  const invalidated =
    query.error instanceof ActivitySnapshotError ||
    (query.error instanceof MarketApiError && query.error.status === 409);
  return { configured: Boolean(client), queryKey, query, invalidated };
}
