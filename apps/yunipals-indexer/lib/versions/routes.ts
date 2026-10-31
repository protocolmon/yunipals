import type { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import {
  parseMonsterAsset,
  monsterAssetKey
} from "@protopals/yunipals-market-core/monsterVersions";
import { isSolanaAddress } from "@protopals/yunipals-market-core/monsterVersions";
import type { ResolvedOwner } from "../ens/resolver.js";
import type { CollectionSlug } from "../constants.js";
import {
  apiReadTransaction,
  ownershipRequestFingerprint,
  withOwnershipRequest
} from "../ownership/request-snapshot.js";
import { assertOwnershipAvailable } from "../ownership/readiness.js";
import {
  versionRevision,
  versionSummaries,
  versionSolanaSnapshot,
  solanaVersionReadsEnabled,
  SolanaVersionUnavailableError
} from "./read.js";
import {
  buildVersionQuery,
  parseVersionQuery,
  VersionQueryError
} from "./query.js";

async function versionRead<T>(
  pool: Pick<Pool, "connect">,
  task: (db: PoolClient) => Promise<T>
) {
  return withOwnershipRequest(
    pool as Pool,
    (db) =>
      assertOwnershipAvailable(db, ["ethereum", "base", "polygon", "bnb"]),
    () => apiReadTransaction(pool, task)
  );
}

export function registerMonsterVersionRoutes(
  app: Hono,
  dependencies: {
    pool: Pick<Pool, "connect">;
    resolveOwner: (
      input: string,
      chains: readonly CollectionSlug[]
    ) => Promise<ResolvedOwner>;
  }
) {
  app.get("/v1/monster-version-capabilities", async (c) => {
    if (process.env.API_MONSTER_VERSIONS_ENABLED !== "true")
      return c.json({ version: 1, enabled: false, revision: null });
    const db = await dependencies.pool.connect();
    try {
      const revision = await versionRevision(db);
      c.header("Cache-Control", "no-store");
      return c.json({
        version: 1,
        enabled: Boolean(revision),
        groupingEnabled:
          Boolean(revision) &&
          process.env.API_MONSTER_GROUPING_ENABLED === "true",
        solanaGroupingEnabled: Boolean(revision) && solanaVersionReadsEnabled(),
        revision
      });
    } finally {
      db.release();
    }
  });
  app.get("/v1/monster-versions", async (c) => {
    if (process.env.API_MONSTER_VERSIONS_ENABLED !== "true")
      return c.json({ revision: null, items: {} });
    try {
      const params = new URL(c.req.url).searchParams;
      if (
        [...params.keys()].some((k) => k !== "asset") ||
        params.getAll("asset").length > 48 ||
        !params.has("asset")
      )
        throw new VersionQueryError("Request up to 48 NFT versions.");
      const assets = params.getAll("asset").map((raw) => {
        const parts = raw.split(":");
        const [chain, contractAddress, tokenId, lifecycle, extra] =
          parts[0] === "solana"
            ? [parts[0], null, parts[1], parts[2], parts[3]]
            : parts;
        if (extra !== undefined)
          throw new VersionQueryError("Invalid NFT identity.");
        try {
          return parseMonsterAsset({
            chain,
            contractAddress,
            tokenId,
            lifecycle: Number(lifecycle)
          });
        } catch {
          throw new VersionQueryError("Invalid NFT identity.");
        }
      });
      if (new Set(assets.map(monsterAssetKey)).size !== assets.length)
        throw new VersionQueryError("Repeated NFT identity.");
      const result = await versionRead(dependencies.pool, async (db) => {
        const revision = await versionRevision(db);
        if (!revision) return { revision: null, items: {} };
        if (
          assets.some((a) => a.chain === "solana") &&
          !solanaVersionReadsEnabled()
        )
          throw new VersionQueryError("Solana grouping is unavailable.");
        await versionSolanaSnapshot(db);
        // Peers may live on any supported EVM chain, even for a one-chain request.
        await assertOwnershipAvailable(db, [
          "ethereum",
          "base",
          "polygon",
          "bnb"
        ]);
        return {
          revision,
          items: await versionSummaries(db, revision, assets)
        };
      });
      c.header("Cache-Control", "no-store");
      return c.json(result);
    } catch (error) {
      if (error instanceof SolanaVersionUnavailableError)
        return c.json({ error: "solana_ownership_unavailable" }, 503);
      if (error instanceof VersionQueryError)
        return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  app.get("/v1/monster-groups", async (c) => {
    if (
      process.env.API_MONSTER_VERSIONS_ENABLED !== "true" ||
      process.env.API_MONSTER_GROUPING_ENABLED !== "true"
    )
      return c.json({ error: "monster_versions_unavailable" }, 503);
    try {
      const queryParams = new URL(c.req.url).searchParams;
      const request = parseVersionQuery(queryParams);
      if (request.chains.includes("solana") && !solanaVersionReadsEnabled())
        throw new VersionQueryError("Solana grouping is unavailable.");
      queryParams.delete("cursor");
      queryParams.sort();
      if (
        request.owner &&
        request.search &&
        !/^\d+$/.test(request.search) &&
        !isSolanaAddress(request.search) &&
        process.env.API_COLLECTOR_NAME_SEARCH_ENABLED !== "true"
      )
        throw new VersionQueryError(
          "Name search is unavailable. Search by token ID."
        );
      const owner = request.owner
        ? isSolanaAddress(request.owner)
          ? { input: request.owner, addresses: { solana: request.owner } }
          : await dependencies.resolveOwner(
              request.owner,
              request.chains.filter((c): c is CollectionSlug => c !== "solana")
            )
        : null;
      const result = await versionRead(dependencies.pool, async (db) => {
        await db.query("SET LOCAL statement_timeout='1000ms'");
        await db.query("SET LOCAL jit=off");
        await assertOwnershipAvailable(
          db,
          request.chains.filter((c): c is CollectionSlug => c !== "solana")
        );
        const solanaSnapshot = await versionSolanaSnapshot(db);
        const revision = await versionRevision(db);
        if (!revision) return null;
        const statement = buildVersionQuery(
          request,
          revision,
          owner?.addresses ?? {},
          `${ownershipRequestFingerprint() ?? "legacy"}:${solanaSnapshot?.fingerprint ?? "evm"}`
        );
        type Row = {
          id: string;
          members: ReturnType<typeof parseMonsterAsset>[];
          position: { score: string | null; tokenId: string; chain: string };
        };
        const data = (
          await db.query<{
            groupTotal: number;
            nftTotal: number;
            groups: Row[];
          }>(statement.text, statement.values)
        ).rows[0]!;
        const page = statement.page(data.groups);
        const assets = page.groups.flatMap((g) => g.members);
        const summaries = assets.length
          ? await versionSummaries(db, revision, assets)
          : {};
        return {
          version: 1,
          revision,
          query: queryParams.toString(),
          coverage: "verified-relationships" as const,
          groupTotal: data.groupTotal,
          nftTotal: data.nftTotal,
          unavailableNfts:
            request.chains.includes("solana") &&
            (!owner || "solana" in owner.addresses)
              ? (solanaSnapshot?.unavailableNfts ?? 0)
              : 0,
          ...page,
          groups: page.groups.map((g) => ({
            ...g,
            members: g.members.map((m) => ({
              ...m,
              versionInfo: summaries[monsterAssetKey(m)]
            }))
          })),
          resolvedAddresses: owner?.addresses ?? {},
          ownerInput: owner?.input ?? null
        };
      });
      c.header("Cache-Control", "no-store");
      return result
        ? c.json(result)
        : c.json({ error: "monster_versions_unavailable" }, 503);
    } catch (error) {
      if (error instanceof SolanaVersionUnavailableError)
        return c.json({ error: "solana_ownership_unavailable" }, 503);
      if (error instanceof VersionQueryError)
        return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
}
