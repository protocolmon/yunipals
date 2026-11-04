import type { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import {
  parseMonsterAsset,
  monsterAssetKey
} from "@protopals/yunipals-market-core/monsterVersions";
import {
  apiReadTransaction,
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
class VersionQueryError extends Error {
  readonly status = 400;
}

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
          throw new VersionQueryError("Solana relationships are unavailable.");
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
}
