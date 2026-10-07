const DEFAULT_INDEXER_URL = "https://api.yunipals.com/yunipals-indexer";

export const environment = {
  // Enable only against a deployed API implementing the marketplace contract.
  yunipalsMarketplaceUrl:
    import.meta.env?.VITE_YUNIPALS_MARKETPLACE_URL?.replace(/\/$/, "") || null,
  walletConnectProjectId:
    import.meta.env?.VITE_WALLETCONNECT_PROJECT_ID?.trim() || "",
  fixtures: import.meta.env?.MODE === "fixtures",
  production: import.meta.env?.PROD === true,
  islandStakingEnabled: import.meta.env?.VITE_ISLAND_STAKING_ENABLED === "true",
  islandUnstakeEnabled: import.meta.env?.VITE_ISLAND_UNSTAKE_ENABLED === "true",
  exomonEnabled:
    import.meta.env?.MODE === "fixtures" ||
    import.meta.env?.VITE_EXOMON_ENABLED === "true",
  yunipalsIndexerUrl: (
    import.meta.env?.VITE_YUNIPALS_INDEXER_URL || DEFAULT_INDEXER_URL
  ).replace(/\/$/, "")
};
