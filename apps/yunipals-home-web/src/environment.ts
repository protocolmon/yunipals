import { analyticsConfigFromEnv } from "@/lib/analytics/config";

const DEFAULT_INDEXER_URL = "https://api.yunipals.com/yunipals-indexer";
const collectionOnly = import.meta.env?.VITE_COLLECTION_ONLY === "true";

export const environment = {
  collectionOnly,
  analytics: analyticsConfigFromEnv(import.meta.env ?? {}),
  // Enable only against a deployed API implementing the marketplace contract.
  yunipalsMarketplaceUrl: !collectionOnly
    ? import.meta.env?.VITE_YUNIPALS_MARKETPLACE_URL?.replace(/\/$/, "") || null
    : null,
  walletConnectProjectId:
    import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID?.trim() || "",
  fixtures: import.meta.env?.MODE === "fixtures",
  production: import.meta.env?.PROD === true,
  arenaLab: !collectionOnly && import.meta.env?.DEV === true,
  arenaApiUrl: !collectionOnly
    ? import.meta.env?.VITE_ARENA_API_URL?.replace(/\/$/, "") || null
    : null,
  boostersEnabled: import.meta.env?.VITE_BOOSTERS_ENABLED === "true",
  boosterRegistry: import.meta.env?.VITE_BOOSTER_REGISTRY?.trim() || "",
  boosterEngine: import.meta.env?.VITE_BOOSTER_ENGINE?.trim() || "",
  boosterMonsters: import.meta.env?.VITE_BOOSTER_MONSTERS?.trim() || "",
  boosterSetupSha256: import.meta.env?.VITE_BOOSTER_SETUP_SHA256?.trim() || "",
  boosterStandardSetupSha256:
    import.meta.env?.VITE_BOOSTER_STANDARD_SETUP_SHA256?.trim() || "",
  boosterIpfsGateway:
    import.meta.env?.VITE_BOOSTER_IPFS_GATEWAY || "https://ipfs.io/ipfs/",
  baseRpcUrl: import.meta.env?.VITE_BASE_RPC_URL?.trim() || null,
  yunipalsIndexerUrl: (
    import.meta.env?.VITE_YUNIPALS_INDEXER_URL || DEFAULT_INDEXER_URL
  ).replace(/\/$/, "")
};
