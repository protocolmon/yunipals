import { skipToken, useQuery } from "@tanstack/react-query";
import {
  emptySettlements,
  settlementsKey
} from "@/lib/marketplace/confirmedSettlements";

export function useConfirmedSettlements() {
  return (
    useQuery({
      queryKey: settlementsKey,
      queryFn: skipToken,
      initialData: emptySettlements,
      enabled: false,
      gcTime: Infinity
    }).data ?? emptySettlements
  );
}
