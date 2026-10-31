import { useQueries, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { environment } from "@/environment";
import { collectionChainDetails } from "@/data/chains";
import {
  fetchVersionCapabilities,
  fetchVersionSummaries,
  monsterAssetKey,
  monsterTokenAsset,
  type MonsterVersionInfo
} from "@/lib/monsterVersions";
import type { CollectionToken } from "@/lib/collectionBrowser";
import type { MonsterVersionReference } from "@protopals/yunipals-market-core/monsterVersions";

const VersionContext = createContext<Record<string, MonsterVersionInfo>>({});

export function useVersionCapabilities() {
  return useQuery({
    queryKey: ["monster-version-capabilities"],
    queryFn: ({ signal }) => fetchVersionCapabilities(signal),
    enabled: environment.monsterVersionsEnabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false
  });
}

/** One request per bounded batch, shared across all cards and lazy expansions. */
export function TokenVersionProvider({
  tokens,
  children
}: {
  tokens: CollectionToken[];
  children: ReactNode;
}) {
  const capabilities = useVersionCapabilities();
  const batches = useMemo(() => {
    const assets = tokens.map(monsterTokenAsset);
    return Array.from({ length: Math.ceil(assets.length / 48) }, (_, i) =>
      assets.slice(i * 48, i * 48 + 48)
    );
  }, [tokens]);
  const results = useQueries({
    queries: batches.map((assets) => ({
      queryKey: [
        "monster-version-summaries",
        capabilities.data?.revision ?? "unavailable",
        assets.map((a) => `${monsterAssetKey(a)}:${a.lifecycle}`)
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchVersionSummaries(assets, signal),
      enabled: Boolean(
        environment.monsterVersionsEnabled &&
          capabilities.data &&
          assets.length > 0
      ),
      staleTime: 30_000,
      gcTime: 60_000,
      retry: false
    }))
  });
  const value = Object.assign(
    {},
    ...(capabilities.data ? results.map((q) => q.data ?? {}) : [])
  ) as Record<string, MonsterVersionInfo>;
  return (
    <VersionContext.Provider value={value}>{children}</VersionContext.Provider>
  );
}

export function useTokenVersion(token: CollectionToken) {
  const versions = useContext(VersionContext);
  return token.versionInfo ?? versions[monsterAssetKey(token)];
}

export function versionReferenceLabel(version: MonsterVersionReference) {
  return version.role === "airdrop"
    ? "Base airdrop"
    : `${collectionChainDetails[version.chain].label} ${version.role === "original" ? "original" : "version"}`;
}

export function TokenOriginBadge({ info }: { info?: MonsterVersionInfo }) {
  return info ? (
    <span className="rounded-full bg-lavender/40 px-2 py-1 text-xs font-bold text-ink">
      {info.role === "original"
        ? "Original"
        : info.role === "airdrop"
          ? "Base airdrop"
          : "Version"}
    </span>
  ) : null;
}

export function TokenVersionInfo({ token }: { token: CollectionToken }) {
  const info = useTokenVersion(token);
  if (!info) return null;
  return (
    <section
      className="mt-5 rounded-card border border-line bg-white p-5"
      aria-label="Monster versions"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-ink">Original and Base airdrop</h2>
        <TokenOriginBadge info={info} />
      </div>
      <p className="mt-2 text-sm text-muted">
        {info.snapshotDate
          ? `The Base version was airdropped based on ownership at a snapshot on ${info.snapshotDate}.`
          : "The Base version was issued separately and shares its monster identity with the original."}{" "}
        Each NFT can now have a different owner. Buying or transferring one does
        not include the other.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {info.versions
          .filter((v) => monsterAssetKey(v) !== monsterAssetKey(token))
          .map((v) => (
            <Link
              key={monsterAssetKey(v)}
              to={`/collection/${v.chain}/${v.tokenId}`}
              className="rounded-full border border-line px-4 py-2 text-sm font-bold text-ethereum focus-visible:ring-2 focus-visible:ring-ethereum"
            >
              View {versionReferenceLabel(v)}
              {v.chain !== "solana" && ` #${v.tokenId}`}
              {v.unavailable
                ? " · Ownership unavailable"
                : v.burned
                  ? " · Burned"
                  : ""}
            </Link>
          ))}
      </div>
    </section>
  );
}
