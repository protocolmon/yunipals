import { ArenaDeploymentProvider } from "@/lib/arenaDeployment";
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
import { BoosterPage, BoosterMonsterPage } from "@/pages/boosters/page";
import { BoosterSetupPage } from "@/pages/boosters/BoosterSetupPage";
import { AnalyticsConsentProvider } from "@/providers/AnalyticsConsentProvider";
const BrandkitPage = lazy(() =>
  import("@/pages/brandkit/page").then((module) => ({
    default: module.BrandkitPage
  }))
);
const ContractsPage = lazy(() =>
  import("@/pages/contracts/page").then((module) => ({
    default: module.ContractsPage
  }))
);
const BoosterBatchSetupPage = lazy(() =>
  import("@/pages/boosters/BoosterBatchSetupPage").then((module) => ({
    default: module.BoosterBatchSetupPage
  }))
);
const BoosterPermitSetupPage = lazy(() =>
  import("@/pages/boosters/BoosterPermitSetupPage").then((module) => ({
    default: module.BoosterPermitSetupPage
  }))
);
const BoosterMetadataSetupPage = lazy(() =>
  import("@/pages/boosters/BoosterMetadataSetupPage").then((module) => ({
    default: module.BoosterMetadataSetupPage
  }))
);
const BoosterYpalSetupPage = lazy(() =>
  import("@/pages/boosters/BoosterYpalSetupPage").then((module) => ({
    default: module.BoosterYpalSetupPage
  }))
);
const YpalWrapPage = lazy(() =>
  import("@/pages/wrap/page").then((module) => ({
    default: module.YpalWrapPage
  }))
);
const freshYpalLaunch = environment.boosterLaunchId === "base-ypal-v1";
const AnimeStudioPage = lazy(() =>
  import("@/pages/arena/anime/AnimeStudioPage").then((module) => ({
    default: module.AnimeStudioPage
  }))
);
const LiveArenaPage = lazy(() =>
  import("@/pages/arena/live/LiveArenaPage").then((module) => ({
    default: module.LiveArenaPage
  }))
);
const ArenaDashboard = lazy(() =>
  import("@/pages/arena/live/ArenaDashboard").then((module) => ({
    default: module.ArenaDashboard
  }))
);
const ArenaRulesPage = lazy(() =>
  import("@/pages/arena/live/ArenaRulesPage").then((module) => ({
    default: module.ArenaRulesPage
  }))
);
const ArenaPage = lazy(() =>
  import("@/pages/arena/page").then((module) => ({ default: module.ArenaPage }))
);

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
          <main
            role="status"
            className="mx-auto min-h-[65vh] max-w-6xl px-4 py-12 text-sm font-semibold text-muted"
          >
            Loading page…
          </main>
        }
      >
        <Routes>
          <Route path="/" element={<CollectionPage />} />
          <Route path="/boosters" element={<BoosterPage />} />
          <Route path="/wrap" element={<YpalWrapPage />} />
          <Route
            path="/boosters/setup/ypal"
            element={<BoosterYpalSetupPage />}
          />
          <Route
            path="/boosters/setup"
            element={
              freshYpalLaunch ? (
                <Navigate to="/boosters/setup/ypal" replace />
              ) : (
                <BoosterSetupPage key="smoke" />
              )
            }
          />
          <Route
            path="/boosters/setup/standard"
            element={
              freshYpalLaunch ? (
                <Navigate to="/boosters/setup/ypal" replace />
              ) : (
                <BoosterSetupPage key="standard" kind="standard" />
              )
            }
          />
          <Route
            path="/boosters/setup/batch"
            element={
              freshYpalLaunch ? (
                <Navigate to="/boosters/setup/ypal" replace />
              ) : (
                <BoosterBatchSetupPage />
              )
            }
          />
          <Route
            path="/boosters/setup/permit"
            element={
              freshYpalLaunch ? (
                <Navigate to="/boosters/setup/ypal" replace />
              ) : (
                <BoosterPermitSetupPage />
              )
            }
          />
          <Route
            path="/boosters/setup/metadata"
            element={
              freshYpalLaunch ? (
                <Navigate to="/boosters/setup/ypal" replace />
              ) : (
                <BoosterMetadataSetupPage />
              )
            }
          />
          <Route
            path="/monsters/:collection/:tokenId"
            element={<BoosterMonsterPage />}
          />
          <Route
            path="/arena/anime"
            element={
              <ArenaDeploymentProvider kind="anime">
                <LiveArenaPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/anime/me"
            element={
              <ArenaDeploymentProvider kind="anime">
                <ArenaDashboard role="entrant" />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/anime/hosting"
            element={
              <ArenaDeploymentProvider kind="anime">
                <ArenaDashboard role="host" />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/anime/rules"
            element={
              <ArenaDeploymentProvider kind="anime">
                <ArenaRulesPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/anime/studio"
            element={
              <ArenaDeploymentProvider kind="anime">
                <AnimeStudioPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/anime/:id"
            element={
              <ArenaDeploymentProvider kind="anime">
                <LiveArenaPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route path="/arena" element={<LiveArenaPage />} />
          <Route path="/arena/me" element={<ArenaDashboard role="entrant" />} />
          <Route
            path="/arena/hosting"
            element={<ArenaDashboard role="host" />}
          />
          <Route path="/arena/rules" element={<ArenaRulesPage />} />
          <Route path="/arena/:id" element={<LiveArenaPage />} />
          {environment.arenaLab && (
            <Route path="/arena-lab" element={<ArenaPage />} />
          )}
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
          <Route path="/brandkit" element={<BrandkitPage />} />
          <Route path="/contracts" element={<ContractsPage />} />
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
