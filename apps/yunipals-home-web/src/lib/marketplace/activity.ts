import { getAddress } from "viem";
import {
  activityScopeKey,
  ActivitySnapshotError,
  parseActivityPage,
  type ActivityScope,
  type ActivityContinuation
} from "@protopals/yunipals-market-core/activity";
import { createMarketRequest } from "@/lib/marketplace/http";
import { pageToken } from "@/lib/marketplace/validation";
export * from "@protopals/yunipals-market-core/activity";

export function createActivityClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch
) {
  const request = createMarketRequest(baseUrl, fetcher);
  return {
    async activity(
      scope: ActivityScope,
      previous?: ActivityContinuation,
      signal?: AbortSignal
    ) {
      const query = activityScopeKey(scope);
      if (previous && previous.query !== query)
        throw new ActivitySnapshotError();
      const params = new URLSearchParams({ limit: "25" });
      const path =
        scope.kind === "asset"
          ? `/assets/${scope.asset.chain}/${getAddress(scope.asset.contractAddress)}/${scope.asset.tokenId}/activity`
          : `/wallets/${getAddress(scope.wallet)}/activity`;
      if (scope.kind === "wallet") {
        params.set("chain", scope.chain);
        params.set("view", scope.view);
      }
      if (previous) {
        params.set("cursor", pageToken(previous.cursor));
        params.set("snapshot", pageToken(previous.snapshot.id));
      }
      const response = await request(`/v1/market${path}?${params}`, { signal });
      try {
        return parseActivityPage(response, scope, previous);
      } catch {
        throw new ActivitySnapshotError();
      }
    }
  };
}
