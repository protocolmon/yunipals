import { ArenaDeploymentProvider } from "@/lib/arenaDeployment";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { environment } from "@/environment";
import { exomonCollectionRedirect } from "@/lib/collectionBrowserFilters";
import { PendingMarketTransactions } from "@/components/marketplace/PendingMarketTransactions";
import { TradingConsentProvider } from "@/components/marketplace/TradingConsentProvider";
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
const PortalTransactionStatus = lazy(() =>
  import("@/pages/portals/PortalTransactionStatus").then((module) => ({
    default: module.PortalTransactionStatus
  }))
);
const PortalPage = lazy(() =>
  import("@/pages/portals/PortalPage").then((module) => ({
    default: module.PortalPage
  }))
);
const PortalAdminPage = lazy(() =>
  import("@/pages/portals/PortalAdminPage").then((module) => ({
    default: module.PortalAdminPage
  }))
);
const PortalAirdropPage = lazy(() =>
  import("@/pages/portals/PortalAirdropPage").then((module) => ({
    default: module.PortalAirdropPage
  }))
);
const PortalOwnerPage = lazy(() =>
  import("@/pages/portals/PortalOwnerPage").then((module) => ({
    default: module.PortalOwnerPage
  }))
);
const PortalTokenPage = lazy(() =>
  import("@/pages/portals/PortalTokenPage").then((module) => ({
    default: module.PortalTokenPage
  }))
);
const PortalCardHistory = lazy(() =>
  import("@/pages/portals/PortalCardHistory").then((module) => ({
    default: module.PortalCardHistory
  }))
);
const ContractsPage = lazy(() =>
  import("@/pages/contracts/page").then((module) => ({
    default: module.ContractsPage
  }))
);
const ProposalsPage = lazy(() =>
  import("@/pages/proposals/page").then((module) => ({
    default: module.ProposalsPage
  }))
);
const ProposalPage = lazy(() =>
  import("@/pages/proposals/ProposalPage").then((module) => ({
    default: module.ProposalPage
  }))
);
const BoosterPhilosophyPage = lazy(() =>
  import("@/pages/boosters/BoosterPhilosophyPage").then((module) => ({
    default: module.BoosterPhilosophyPage
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
const ArenaHub = lazy(() =>
  import("@/pages/arena/ArenaHub").then((module) => ({
    default: module.ArenaHub
  }))
);
const SharedArenaSetupPage = lazy(() =>
  import("@/pages/arena/SharedArenaSetupPage").then((module) => ({
    default: module.SharedArenaSetupPage
  }))
);
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
const ArenaQueuePage = lazy(() =>
  import("@/pages/arena/live/ArenaQueuePage").then((m) => ({
    default: m.ArenaQueuePage
  }))
);
const ArenaRewardsPage = lazy(() =>
  import("@/pages/arena/live/ArenaRewardsPage").then((m) => ({
    default: m.ArenaRewardsPage
  }))
);
const ArenaWatchPage = lazy(() =>
  import("@/pages/arena/live/ArenaWatchPage").then((m) => ({
    default: m.ArenaWatchPage
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
        {pathname.startsWith("/portals") && <PortalTransactionStatus />}
        <Routes>
          <Route path="/" element={<CollectionPage />} />
          <Route path="/boosters" element={<BoosterPage />} />
          <Route
            path="/boosters/why-packs"
            element={<BoosterPhilosophyPage />}
          />
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
                <ArenaQueuePage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/anime/rewards"
            element={
              <ArenaDeploymentProvider kind="anime">
                <ArenaRewardsPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/anime/watch"
            element={
              <ArenaDeploymentProvider kind="anime">
                <ArenaWatchPage />
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
            path="/arena/anime/setup"
            element={<Navigate to="/arena/setup" replace />}
          />
          <Route
            path="/arena/anime/pilot"
            element={<Navigate to="/arena/anime" replace />}
          />
          <Route
            path="/arena/anime/:id"
            element={
              <ArenaDeploymentProvider kind="anime">
                <LiveArenaPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route path="/arena" element={<ArenaHub />} />
          <Route path="/arena/setup" element={<SharedArenaSetupPage />} />
          <Route
            path="/arena/history"
            element={<Navigate to="/arena/video/watch" replace />}
          />
          <Route
            path="/arena/watch"
            element={<Navigate to="/arena/video/watch" replace />}
          />
          <Route
            path="/arena/rewards"
            element={<Navigate to="/arena/video/rewards" replace />}
          />
          <Route
            path="/arena/video"
            element={
              <ArenaDeploymentProvider kind="video">
                <ArenaQueuePage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/video/:id"
            element={
              <ArenaDeploymentProvider kind="video">
                <LiveArenaPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/video/rewards"
            element={
              <ArenaDeploymentProvider kind="video">
                <ArenaRewardsPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/video/watch"
            element={
              <ArenaDeploymentProvider kind="video">
                <ArenaWatchPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/video/me"
            element={
              <ArenaDeploymentProvider kind="video">
                <ArenaDashboard role="entrant" />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/video/hosting"
            element={
              <ArenaDeploymentProvider kind="video">
                <ArenaDashboard role="host" />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/video/rules"
            element={
              <ArenaDeploymentProvider kind="video">
                <ArenaRulesPage />
              </ArenaDeploymentProvider>
            }
          />
          <Route
            path="/arena/me"
            element={<Navigate to="/arena/video/me" replace />}
          />
          <Route
            path="/arena/hosting"
            element={<Navigate to="/arena/video/hosting" replace />}
          />
          <Route
            path="/arena/rules"
            element={<Navigate to="/arena/video/rules" replace />}
          />
          <Route path="/arena/:id" element={<Navigate to="/arena" replace />} />
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
          <Route path="/proposals" element={<ProposalsPage />} />
          <Route path="/proposals/:slug" element={<ProposalPage />} />
          <Route path="/brandkit" element={<BrandkitPage />} />
          <Route path="/portals" element={<PortalPage />} />
          <Route path="/portals/mine" element={<PortalOwnerPage />} />
          <Route
            path="/portals/tokens/:portalId"
            element={<PortalTokenPage />}
          />
          <Route path="/portals/admin" element={<PortalAdminPage />} />
          <Route path="/portals/airdrop" element={<PortalAirdropPage />} />
          <Route
            path="/portals/cards/:tokenId"
            element={<PortalCardHistory />}
          />
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
      <Footer exomonView={exomonView} />
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
