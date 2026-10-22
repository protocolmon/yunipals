import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useLocation } from "react-router-dom";
import { useAccount } from "wagmi";

import { AnalyticsNotice } from "@/components/analytics/AnalyticsNotice";
import { environment } from "@/environment";
import { analytics, analyticsPrivacySignal } from "@/lib/analytics/index";
import {
  analyticsConsentKey,
  type AnalyticsChoice
} from "@/lib/analytics/consent";
import { analyticsPage } from "@/lib/analytics/events";
import { analyticsWalletConnected } from "@/lib/analytics/wallet";

type AnalyticsConsentContextValue = {
  choice: AnalyticsChoice;
  revision: string;
  openSettings: () => void;
};
const AnalyticsConsentContext =
  createContext<AnalyticsConsentContextValue | null>(null);

function AnalyticsObserver({
  choice,
  revision
}: {
  choice: AnalyticsChoice;
  revision: string;
}) {
  const { pathname, search } = useLocation();
  const { isConnected, chainId, connector } = useAccount();
  const previouslyConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !previouslyConnected.current)
      analyticsWalletConnected(chainId, connector?.id);
    previouslyConnected.current = isConnected;
  }, [chainId, connector?.id, isConnected]);
  useEffect(() => {
    let active = true;
    const page = analyticsPage(pathname, search);
    if (choice === "accepted" && page)
      void analytics.start().then(() => {
        // The real path is a local deduplication key and is never sent to Mixpanel.
        if (active)
          analytics.page(`${pathname}:${page.collection ?? ""}`, page);
      });
    return () => {
      active = false;
    };
  }, [choice, pathname, search, revision]);
  return null;
}

export function AnalyticsConsentProvider({
  children
}: {
  children: ReactNode;
}) {
  const [choice, setChoice] = useState<AnalyticsChoice>(() =>
    analytics.refresh()
  );
  const previousChoice = useRef(choice);
  const [settings, setSettings] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [revision, setRevision] = useState("");
  const [privacySignal, setPrivacySignal] = useState(analyticsPrivacySignal);
  const refresh = useCallback(() => {
    const next = analytics.refresh();
    if (next === "unknown" && previousChoice.current !== "unknown")
      setDismissed(false);
    previousChoice.current = next;
    setChoice(next);
    setPrivacySignal(analyticsPrivacySignal());
    setRevision(
      `${analytics.consent()?.updatedAt ?? "unknown"}:${analyticsPrivacySignal()}`
    );
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === analyticsConsentKey || event.key === null) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 30_000);
    refresh();
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.clearInterval(timer);
      analytics.stop();
    };
  }, [refresh]);
  function choose(next: "accepted" | "declined") {
    const saved = analytics.choose(next);
    setStorageError(!saved);
    refresh();
    if (saved || next === "declined") {
      setSettings(false);
      setDismissed(true);
    }
  }
  return (
    <AnalyticsConsentContext.Provider
      value={{
        choice,
        revision,
        openSettings: () => {
          setStorageError(false);
          setSettings(true);
        }
      }}
    >
      <AnalyticsObserver choice={choice} revision={revision} />
      {children}
      {(settings ||
        (environment.analytics.enabled &&
          !privacySignal &&
          choice === "unknown" &&
          !dismissed)) && (
        <AnalyticsNotice
          settings={settings}
          available={environment.analytics.enabled}
          privacySignal={privacySignal}
          accepted={choice === "accepted"}
          storageError={storageError}
          privacyId={analytics.visitor()}
          onAccept={() => choose("accepted")}
          onDecline={() => choose("declined")}
          onClose={() => {
            setSettings(false);
            setDismissed(true);
          }}
        />
      )}
    </AnalyticsConsentContext.Provider>
  );
}

export function useAnalyticsConsent() {
  const context = useContext(AnalyticsConsentContext);
  if (!context)
    throw new Error("Analytics consent must be used inside its provider.");
  return context;
}
