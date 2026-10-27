import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";

import { boosterQueryKey } from "@/lib/boosters";

export function useBoosterClock(enabled = true) {
  const client = usePublicClient({ chainId: 8453 });
  return useQuery({
    queryKey: [...boosterQueryKey, "base-clock"],
    enabled: Boolean(enabled && client),
    queryFn: async () =>
      (await client!.getBlock({ blockTag: "latest" })).timestamp,
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false
  });
}
