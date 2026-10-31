import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useAccount } from "wagmi";
import type { Hex } from "viem";

import { BoosterRequestOpening } from "@/pages/boosters/BoosterRequestOpening";
import { BoosterTransactions } from "@/pages/boosters/BoosterTransactions";

type Opening =
  | { kind: "transaction"; hash: Hex }
  | { kind: "request"; requestId: string };
type OpeningActions = {
  openTransaction: (hash: Hex, replacedHash?: Hex) => void;
  openRequest: (requestId: string) => void;
};
type Session = { wallet: string | undefined; opening: Opening | null };

const OpeningContext = createContext<OpeningActions | null>(null);

// A wallet change resets the session, including any dismissed or pending reveal.
export function BoosterOpeningProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const wallet = address?.toLowerCase();
  const [session, setSession] = useState<Session>({ wallet, opening: null });
  if (session.wallet !== wallet) setSession({ wallet, opening: null });
  const opening = session.wallet === wallet ? session.opening : null;
  const openTransaction = useCallback(
    (hash: Hex, replacedHash?: Hex) => {
      setSession((previous) =>
        !wallet ||
        previous.wallet !== wallet ||
        (replacedHash &&
          (previous.opening?.kind !== "transaction" ||
            previous.opening.hash.toLowerCase() !== replacedHash.toLowerCase()))
          ? previous
          : { wallet, opening: { kind: "transaction", hash } }
      );
    },
    [wallet]
  );
  const openRequest = useCallback(
    (requestId: string) => {
      setSession((previous) =>
        !wallet || previous.wallet !== wallet
          ? previous
          : { wallet, opening: { kind: "request", requestId } }
      );
    },
    [wallet]
  );
  const close = () => setSession({ wallet, opening: null });
  const actions = useMemo(
    () => ({ openTransaction, openRequest }),
    [openTransaction, openRequest]
  );
  return (
    <OpeningContext.Provider value={actions}>
      {children}
      {opening?.kind === "transaction" && (
        <BoosterTransactions
          autoOpenHash={opening.hash}
          showHistory={false}
          onOpeningClosed={close}
        />
      )}
      {opening?.kind === "request" && (
        <BoosterRequestOpening
          key={opening.requestId}
          requestId={opening.requestId}
          onClose={close}
        />
      )}
    </OpeningContext.Provider>
  );
}

export function useBoosterOpening() {
  const actions = useContext(OpeningContext);
  if (!actions)
    throw new Error("Daily card controls require BoosterOpeningProvider.");
  return actions;
}
