import type { SocialConfig } from "../../src/lib/social/metadata";

export type PreviewConfig = SocialConfig & {
  indexerUrl: string;
  portalUrl: string;
  monsters: string;
  boostersEnabled: boolean;
  portalsEnabled: boolean;
  portalGrading: string;
  portalChainId: number;
  gateway: string;
  assetHosts: string[];
  developmentOrigins?: string[];
};

export type PreviewConfigOptions = { development?: boolean };

export function loopbackHost(host: string) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
}

export function socialConfig(
  env: Record<string, string | undefined>,
  options: PreviewConfigOptions = {}
): PreviewConfig {
  const site = new URL(
    env.VITE_SITE_ORIGIN ||
      (env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:5177")
  );
  if (
    !["https:", "http:"].includes(site.protocol) ||
    site.username ||
    site.password ||
    site.pathname !== "/" ||
    site.search ||
    site.hash
  )
    throw new Error(
      "VITE_SITE_ORIGIN must be a website origin without credentials, a path or query."
    );
  const siteOrigin = site.origin;
  if (
    env.VERCEL_ENV === "production" &&
    !env.VITE_SITE_ORIGIN &&
    !env.VERCEL_PROJECT_PRODUCTION_URL
  )
    throw new Error("Set VITE_SITE_ORIGIN for production previews.");
  const indexerUrl = (env.VITE_YUNIPALS_INDEXER_URL || "").replace(/\/$/, "");
  const portalUrl = (env.VITE_PORTALS_API_URL || indexerUrl).replace(/\/$/, "");
  const gateway = env.VITE_BOOSTER_IPFS_GATEWAY || "https://ipfs.io/ipfs/";
  const developmentOrigins =
    options.development && env.VERCEL_ENV !== "production"
      ? [siteOrigin, indexerUrl, portalUrl, gateway]
          .filter(Boolean)
          .map((value) => new URL(value))
          .filter(
            (url) => url.protocol === "http:" && loopbackHost(url.hostname)
          )
          .map((url) => url.origin)
      : [];
  const assetHosts = [siteOrigin, indexerUrl, portalUrl, gateway]
    .filter(Boolean)
    .map((s) => new URL(s).hostname);
  assetHosts.push(
    ...(env.OG_ASSET_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  if (
    assetHosts.some(
      (host) => !/^[a-z0-9.-]+$/.test(host) && !loopbackHost(host)
    )
  )
    throw new Error("OG_ASSET_HOSTS must contain exact hostnames.");
  for (const value of [indexerUrl, portalUrl, gateway].filter(Boolean)) {
    const url = new URL(value);
    const local = developmentOrigins.includes(url.origin);
    if (
      (!local && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (!local && url.port && url.port !== "443")
    )
      throw new Error(
        "Preview service URLs must use public HTTPS without credentials or query parameters."
      );
  }
  return {
    siteOrigin,
    indexerUrl,
    portalUrl,
    gateway,
    assetHosts,
    ...(developmentOrigins.length ? { developmentOrigins } : {}),
    staticRevision: env.VITE_SOCIAL_REVISION,
    boostersEnabled: env.VITE_BOOSTERS_ENABLED === "true",
    monsters: (env.VITE_BOOSTER_MONSTERS || "").toLowerCase(),
    exomonEnabled: env.VITE_EXOMON_ENABLED === "true",
    portalsEnabled: env.VITE_PORTALS_ENABLED === "true",
    portalGrading: env.VITE_PORTALS_GRADING_ADDRESS || "",
    portalChainId: Number(env.VITE_PORTALS_CHAIN_ID || "8453")
  };
}
