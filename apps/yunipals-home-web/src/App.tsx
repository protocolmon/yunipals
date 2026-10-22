import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { environment } from "@/environment";
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
import { RacingPage } from "@/pages/racing/page";
import { ArenaPage } from "@/pages/arena/page";
import { LiveArenaPage } from "@/pages/arena/live/LiveArenaPage";
import { BoosterPage, BoosterMonsterPage } from "@/pages/boosters/page";
import { BoosterSetupPage } from "@/pages/boosters/BoosterSetupPage";
import { AnalyticsConsentProvider } from "@/providers/AnalyticsConsentProvider";

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

function AppContent() {
  const { openInformation } = useTradingConsent();
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
      <Routes>
        <Route path="/" element={<CollectionPage />} />
        <Route path="/collection" element={<CollectionRedirect />} />
        <Route
          path="/collection/:chain/:tokenId"
          element={<CollectionPage />}
        />
        <Route path="/collection/:tokenId" element={<CollectionPage />} />
        {!environment.collectionOnly && (
          <Route path="/leaderboard" element={<LeaderboardPage />} />
        )}
        <Route path="/boosters" element={<BoosterPage />} />
        <Route
          path="/boosters/setup"
          element={<BoosterSetupPage key="smoke" />}
        />
        <Route
          path="/boosters/setup/standard"
          element={<BoosterSetupPage key="standard" kind="standard" />}
        />
        <Route
          path="/monsters/:collection/:tokenId"
          element={<BoosterMonsterPage />}
        />
        {!environment.collectionOnly && (
          <>
            <Route path="/race-lab" element={<RacingPage />} />
            <Route path="/arena" element={<LiveArenaPage />} />
            <Route path="/arena/:id" element={<LiveArenaPage />} />
          </>
        )}
        {environment.arenaLab && (
          <Route path="/arena-lab" element={<ArenaPage />} />
        )}
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/collector/:address" element={<CollectorPage />} />
        {!environment.collectionOnly && (
          <>
            <Route path="/orders/recovery" element={<OrderRecoveryPage />} />
            <Route path="/orders/activity" element={<ActivityPage />} />
            <Route path="/orders" element={<OrdersPage />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Footer onTradingInformation={openInformation} />
      {environment.yunipalsMarketplaceUrl && <PendingMarketTransactions />}
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
