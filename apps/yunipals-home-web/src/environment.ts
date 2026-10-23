import { analyticsConfigFromEnv } from "@/lib/analytics/config";

const DEFAULT_INDEXER_URL = "https://api.yunipals.com/yunipals-indexer";
const boosterLaunchId =
  import.meta.env?.VITE_BOOSTER_LAUNCH_ID?.trim() || "base-proto-v1";

export const environment = {
  collectionOnly: import.meta.env?.VITE_COLLECTION_ONLY === "true",
  analytics: analyticsConfigFromEnv(import.meta.env ?? {}),
  // Enable only against a deployed API implementing the marketplace contract.
  yunipalsMarketplaceUrl:
    import.meta.env?.VITE_YUNIPALS_MARKETPLACE_URL?.replace(/\/$/, "") || null,
  walletConnectProjectId:
    import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID?.trim() || "",
  fixtures: import.meta.env?.MODE === "fixtures",
  production: import.meta.env?.PROD === true,
  arenaLab: import.meta.env?.DEV === true,
  arenaApiUrl: import.meta.env?.VITE_ARENA_API_URL?.replace(/\/$/, "") || null,
  islandStakingEnabled: import.meta.env?.VITE_ISLAND_STAKING_ENABLED === "true",
  islandUnstakeEnabled: import.meta.env?.VITE_ISLAND_UNSTAKE_ENABLED === "true",
  exomonEnabled:
    import.meta.env?.MODE === "fixtures" ||
    import.meta.env?.VITE_EXOMON_ENABLED === "true",
  boostersEnabled: import.meta.env?.VITE_BOOSTERS_ENABLED === "true",
  boosterLaunchId,
  boosterPaymentSymbol:
    import.meta.env?.VITE_BOOSTER_PAYMENT_SYMBOL?.trim() || "PROTO",
  boosterPaymentToken:
    import.meta.env?.VITE_BOOSTER_PAYMENT_TOKEN?.trim() ||
    (boosterLaunchId === "base-ypal-v1"
      ? ""
      : "0xE5a54a517CDE8ED48A336B173044b1138Aa2c1a3"),
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
