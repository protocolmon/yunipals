import { createContext, ReactNode, useContext, useRef, useState } from "react";

import { TradingInformationDialog } from "@/components/marketplace/TradingInformationDialog";
import {
  acceptTradingTerms,
  dismissTradingInformation,
  hasAcceptedTradingTerms
} from "@/lib/marketplace/tradingInformation";

type TradingConsent = {
  accepted: boolean;
  openInformation: () => void;
  requestTradingConsent: (action: () => void) => void;
};

const TradingConsentContext = createContext<TradingConsent | null>(null);

export function TradingConsentProvider({ children }: { children: ReactNode }) {
  const [accepted, setAccepted] = useState(hasAcceptedTradingTerms);
  const [open, setOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);

  function close() {
    dismissTradingInformation();
    pendingAction.current = null;
    setOpen(false);
  }

  function accept() {
    acceptTradingTerms();
    setAccepted(true);
    setOpen(false);
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) window.setTimeout(action, 0);
  }

  const value: TradingConsent = {
    accepted,
    openInformation: () => {
      pendingAction.current = null;
      setOpen(true);
    },
    requestTradingConsent: (action) => {
      if (accepted) {
        action();
        return;
      }
      pendingAction.current = action;
      setOpen(true);
    }
  };

  return (
    <TradingConsentContext.Provider value={value}>
      {children}
      {open && (
        <TradingInformationDialog
          accepted={accepted}
          onAccept={accept}
          onClose={close}
        />
      )}
    </TradingConsentContext.Provider>
  );
}

export function useTradingConsent() {
  const consent = useContext(TradingConsentContext);
  if (!consent)
    throw new Error("Trading consent must be used inside its provider.");
  return consent;
}
