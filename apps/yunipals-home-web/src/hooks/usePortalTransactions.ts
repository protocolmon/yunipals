import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { environment } from "@/environment";
import { portalRequest } from "@/lib/portals";
import {
  PortalTransactionTracker,
  type PortalTransaction
} from "@/lib/portalTransactions";

const trackers = new Map<string, PortalTransactionTracker>();
const empty: PortalTransaction[] = [];
const subscribeEmpty = () => () => {};
const snapshotEmpty = () => empty;

export function usePortalTransactions() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: environment.portalChainId });
  const queries = useQueryClient();
  const tracker = useMemo(() => {
    if (!address || !client || !environment.portalGrading) return null;
    const scope = {
      chainId: environment.portalChainId,
      wallet: address,
      grading: environment.portalGrading
    };
    const key = `${scope.chainId}:${scope.grading.toLowerCase()}:${address.toLowerCase()}`;
    let value = trackers.get(key);
    if (!value) {
      let storage: Storage | undefined;
      try {
        storage = window.localStorage;
      } catch {
        /* Private browsing can disable persistence. */
      }
      value = new PortalTransactionTracker(scope, {
        client,
        request: portalRequest,
        storage,
        changed: () => {
          for (const queryKey of [
            ["portals"],
            ["collector"],
            ["balance"],
            ["readContract"],
            ["boosters"]
          ])
            void queries.invalidateQueries({ queryKey });
        }
      });
      trackers.set(key, value);
    }
    return value;
  }, [address, client, queries]);
  const transactions = useSyncExternalStore(
    tracker?.subscribe ?? subscribeEmpty,
    tracker?.getSnapshot ?? snapshotEmpty,
    snapshotEmpty
  );
  useEffect(() => {
    if (!tracker) return;
    const changed = (event: StorageEvent) => {
      if (event.key === tracker.key) tracker.reload();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [tracker]);
  return { tracker, transactions };
}
