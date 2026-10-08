import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { environment } from "@/environment";
import { exomonCollectionRedirect } from "@/lib/collectionBrowserFilters";
import { PendingMarketTransactions } from "@/components/marketplace/PendingMarketTransactions";
import {
  TradingConsentProvider,
  useTradingConsent
} from "@/components/marketplace/TradingConsentProvider";
import { CollectionPage } from "@/pages/collection/page";
import { CollectorPage } from "@/pages/collector/page";
import { LeaderboardPage } from "@/pages/leaderboard/page";
import { PrivacyPage } from "@/pages/legal/PrivacyPage";
import { TermsPage } from "@/pages/legal/TermsPage";
import { OrderRecoveryPage } from "@/pages/orders/RecoveryPage";
import { OrdersPage } from "@/pages/orders/OrdersPage";
import { ActivityPage } from "@/pages/orders/ActivityPage";
import { AnalyticsConsentProvider } from "@/providers/AnalyticsConsentProvider";

const ExomonCollectorPage = lazy(() =>
  import("@/pages/exomon/ExomonCollectorPage").then((module) => ({
    default: module.ExomonCollectorPage
  }))
);
const ExomonDetailPage = lazy(() =>
  import("@/pages/exomon/ExomonDetailPage").then((module) => ({
    default: module.ExomonDetailPage
  }))
);
const ExomonLeaderboardPage = lazy(() =>
  import("@/pages/exomon/ExomonLeaderboardPage").then((module) => ({
    default: module.ExomonLeaderboardPage
  }))
);

function ScrollManager() {
  const { hash, pathname } = useLocation();

  useEffect(() => {
    if (hash) {
      window.requestAnimationFrame(() => {
        const target =
          pathname === "/" &&
          ["#marketplaces", "#ethereum-collection"].includes(hash)
            ? "collection"
            : hash.slice(1);
        document.getElementById(target)?.scrollIntoView();
      });
      return;
    }

    window.scrollTo({ top: 0 });
  }, [hash, pathname]);

  return null;
}

function CollectionRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/${search}${hash}`} replace />;
}

function ExomonCollectionRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`${exomonCollectionRedirect(search)}${hash}`} replace />;
}

function LeaderboardRoute() {
  const { search } = useLocation();
  return environment.exomonEnabled &&
    new URLSearchParams(search).get("chain") === "solana" ? (
    <ExomonLeaderboardPage />
  ) : (
    <LeaderboardPage />
  );
}

function AppContent() {
  const { openInformation } = useTradingConsent();
  const { pathname, search } = useLocation();
  const exomonView =
    environment.exomonEnabled &&
    (pathname === "/exomon" ||
      (pathname === "/" &&
        new URLSearchParams(search).getAll("chain").join(",") === "solana") ||
      pathname.startsWith("/collection/solana/") ||
      pathname.startsWith("/collector/solana/") ||
      (pathname === "/leaderboard" &&
        new URLSearchParams(search).get("chain") === "solana"));
  return (
    <div className="min-h-screen bg-white">
      <ScrollManager />
      <Nav />
      {environment.fixtures && (
        <p
          role="status"
          className="bg-amber-100 px-4 py-3 text-center text-sm text-amber-900"
        >
          Sample collection — fictional ownership and rankings. Wallet
          connections and trading are disabled.
        </p>
      )}
      <Suspense
        fallback={
          <main className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12 text-sm font-semibold text-muted">
            Loading Exomon…
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<CollectionPage />} />
          {environment.exomonEnabled && (
            <Route path="/exomon" element={<ExomonCollectionRedirect />} />
          )}
          <Route path="/collection" element={<CollectionRedirect />} />
          {environment.exomonEnabled && (
            <Route
              path="/collection/solana/:tokenId"
              element={<ExomonDetailPage />}
            />
          )}
          <Route
            path="/collection/:chain/:tokenId"
            element={<CollectionPage />}
          />
          <Route path="/collection/:tokenId" element={<CollectionPage />} />
          <Route path="/leaderboard" element={<LeaderboardRoute />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/collector/:address" element={<CollectorPage />} />
          {environment.exomonEnabled && (
            <Route
              path="/collector/solana/:address"
              element={<ExomonCollectorPage />}
            />
          )}
          <Route path="/orders/recovery" element={<OrderRecoveryPage />} />
          <Route path="/orders/activity" element={<ActivityPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Footer onTradingInformation={openInformation} exomonView={exomonView} />
      {!exomonView && <PendingMarketTransactions />}
    </div>
  );
}

export function App() {
  return (
    <AnalyticsConsentProvider>
      <TradingConsentProvider>
        <AppContent />
      </TradingConsentProvider>
    </AnalyticsConsentProvider>
  );
}
