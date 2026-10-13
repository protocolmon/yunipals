import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Pool } from "pg";
import { isAddress } from "viem";
import {
  islandCollections,
  baseIslandCollection,
  type IslandCollectionId
} from "../islands/collections.js";
import { islandReadModel } from "../islands/read-model.js";
import { islandIdentity } from "../islands/queries.js";
import { canonicalTokenId } from "../islands/metadata.js";
import { baseIslandsReadiness } from "../islands/base-sync.js";
import { islandsReadiness } from "../islands/readiness.js";
import { stakingReadiness } from "../islands/staking.js";

type Ready = { ready: boolean; [key: string]: unknown };
export type CombinedIslandsDependencies = {
  pool: Pick<Pool, "query">;
  ethereumSchema: string;
  baseEnabled?: () => boolean;
  stakingEnabled?: () => boolean;
  ethereumReady?: () => Promise<Ready>;
  baseReady?: () => Promise<Ready>;
};

export function registerCombinedIslandsRoutes(
  app: Hono,
  dependencies: CombinedIslandsDependencies
) {
  const { pool, ethereumSchema } = dependencies;
  const baseEnabled =
    dependencies.baseEnabled ??
    (() => process.env.API_BASE_ISLANDS_ENABLED === "true");
  const stakingEnabled =
    dependencies.stakingEnabled ??
    (() => process.env.API_ISLAND_STAKING_ENABLED === "true");
  const router = new Hono();
  router.onError((_error, c) =>
    c.json({ error: "islands_database_unavailable" }, 503)
  );
  const readiness = async () => {
    const read = async (task: () => Promise<Ready>) =>
      task().catch(() => ({ ready: false, reason: "temporarily_unavailable" }));
    const [ethereum, base] = await Promise.all([
      read(
        dependencies.ethereumReady ??
          (() => islandsReadiness(pool, ethereumSchema))
      ),
      baseEnabled()
        ? read(dependencies.baseReady ?? (() => baseIslandsReadiness(pool)))
        : Promise.resolve({ ready: false, reason: "disabled" })
    ]);
    return { "ethereum-islands": ethereum, "base-islands": base };
  };
  router.get("/indexing-status", async (c) =>
    c.json({ collections: await readiness() })
  );

  async function selection(origin: string, holding = "all") {
    const states = await readiness();
    const ids: IslandCollectionId[] =
      origin === "original"
        ? ["ethereum-islands"]
        : origin === "airdrop"
          ? ["base-islands"]
          : holding === "staked"
            ? ["ethereum-islands"]
            : ["ethereum-islands", "base-islands"];
    const available = ids.filter((id) => states[id].ready);
    const unavailable = ids.filter((id) => !states[id].ready);
    const union = available
      .map((id) => {
        const definition = islandCollections[id];
        const model = islandReadModel(
          id === "ethereum-islands"
            ? ethereumSchema
            : baseIslandCollection.schemaName,
          definition,
          stakingEnabled(),
          baseEnabled()
        );
        return `SELECT ${model.columns} FROM ${model.relation} WHERE ${islandIdentity(definition)}`;
      })
      .join(" UNION ALL ");
    return { states, available, unavailable, union };
  }

  router.get("/stats", async (c) => {
    const url = new URL(c.req.url);
    const origin = url.searchParams.get("origin") ?? "all";
    if (
      !["all", "original", "airdrop"].includes(origin) ||
      [...url.searchParams.keys()].some((k) => k !== "origin") ||
      url.searchParams.getAll("origin").length > 1
    )
      return c.json({ error: "invalid_query" }, 400);
    const selected = await selection(origin);
    if (!selected.available.length)
      return c.json(
        { error: "ownership_rebuilding", collections: selected.states },
        503
      );
    const totals =
      await pool.query(`SELECT count(*)::int AS "knownTokens",count(*) FILTER(WHERE NOT burned)::int AS "activeSupply",
      count(*) FILTER(WHERE burned)::int AS "burnedTokens",count(DISTINCT owner) FILTER(WHERE NOT burned)::int AS holders,
      count(*) FILTER(WHERE NOT burned AND edition='Genesis')::int AS genesis,
      count(*) FILTER(WHERE NOT burned AND edition='Personal')::int AS personal,
      count(*) FILTER(WHERE NOT burned AND metadata IS NOT NULL)::int AS "metadataAvailable",
      count(*) FILTER(WHERE NOT burned AND origin='original')::int AS originals,
      count(*) FILTER(WHERE NOT burned AND origin='airdrop')::int AS airdropped
      FROM (${selected.union}) q`);
    return c.json({
      ...totals.rows[0],
      complete: !selected.unavailable.length,
      unavailableCollections: selected.unavailable
    });
  });

  router.get("/tokens", async (c) => {
    const url = new URL(c.req.url),
      params = url.searchParams;
    const allowed = new Set([
      "limit",
      "cursor",
      "sort",
      "origin",
      "edition",
      "owner",
      "holding",
      "tokenId"
    ]);
    if (
      [...params.keys()].some(
        (k) => !allowed.has(k) || params.getAll(k).length > 1
      )
    )
      return c.json({ error: "invalid_query" }, 400);
    const rawLimit = params.get("limit") ?? "24",
      sort = params.get("sort") ?? "token-id-asc";
    const origin = params.get("origin") ?? "all",
      edition = params.get("edition"),
      holding = params.get("holding") ?? "all";
    const owner = params.get("owner")?.toLowerCase(),
      tokenId = params.get("tokenId");
    if (tokenId !== null && !canonicalTokenId(tokenId))
      return c.json({ error: "invalid_token_id" }, 400);
    if (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100)
      return c.json({ error: "invalid_limit" }, 400);
    if (
      !["token-id-asc", "token-id-desc"].includes(sort) ||
      !["all", "original", "airdrop"].includes(origin) ||
      (edition !== null && !["Genesis", "Personal"].includes(edition)) ||
      !["all", "wallet", "staked"].includes(holding)
    )
      return c.json({ error: "invalid_query" }, 400);
    if (
      params.has("owner") &&
      (!owner || !isAddress(owner) || /^0x0{40}$/.test(owner))
    )
      return c.json({ error: "invalid_owner" }, 400);
    const selected = await selection(origin, holding);
    if (!selected.available.length)
      return c.json(
        { error: "ownership_rebuilding", collections: selected.states },
        503
      );
    const scope = createHash("sha256")
      .update(
        JSON.stringify({
          sort,
          origin,
          edition,
          tokenId,
          owner: owner ?? null,
          holding,
          available: selected.available
        })
      )
      .digest("hex");
    const values: unknown[] = [],
      where = ["NOT q.burned"];
    if (tokenId !== null) {
      values.push(tokenId);
      where.push(`q."tokenId"=$${values.length}`);
    }
    if (edition) {
      values.push(edition);
      where.push(`q.edition=$${values.length}`);
    }
    const stakeMatch = "q.staking->>'status'='staked'";
    if (owner) {
      values.push(owner);
      const wallet = `q.owner=$${values.length}`,
        stake = `(${stakeMatch} AND q.staking->>'staker'=$${values.length})`;
      where.push(
        `(${holding === "wallet" ? wallet : holding === "staked" ? stake : `${wallet} OR ${stake}`})`
      );
    } else if (holding === "staked") where.push(stakeMatch);
    const countValues = [...values],
      countWhere = [...where];
    const ascending = sort === "token-id-asc",
      operator = ascending ? ">" : "<",
      direction = ascending ? "ASC" : "DESC";
    if (params.has("cursor")) {
      try {
        const raw = params.get("cursor")!;
        if (raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw))
          throw new Error();
        const value = JSON.parse(
          Buffer.from(raw, "base64url").toString()
        ) as Record<string, unknown>;
        if (
          value.scope !== scope ||
          value.v !== 1 ||
          typeof value.tokenId !== "string" ||
          !canonicalTokenId(value.tokenId) ||
          !selected.available.includes(value.collectionId as IslandCollectionId)
        )
          throw new Error();
        values.push(value.tokenId, value.collectionId);
        where.push(
          `(q."tokenId"::numeric,q."collectionId")${operator}($${values.length - 1}::numeric,$${values.length}::text)`
        );
      } catch {
        return c.json({ error: "invalid_cursor" }, 409);
      }
    }
    values.push(Number(rawLimit) + 1);
    const result = await pool.query<
      Record<string, unknown> & { tokenId: string; collectionId: string }
    >(
      `SELECT * FROM (${selected.union}) q
      WHERE ${where.join(" AND ")} ORDER BY q."tokenId"::numeric ${direction},q."collectionId" ${direction} LIMIT $${values.length}`,
      values
    );
    const items = result.rows.slice(0, Number(rawLimit)),
      last = items.at(-1);
    const count = await pool.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM (${selected.union}) q WHERE ${countWhere.join(" AND ")}`,
      countValues
    );
    const staking = await stakingReadiness(
      pool,
      ethereumSchema,
      stakingEnabled()
    );
    const stakingNeeded =
      stakingEnabled() &&
      selected.available.includes("ethereum-islands") &&
      (holding === "staked" || Boolean(owner && holding === "all"));
    return c.json({
      items,
      total: count.rows[0]!.total,
      complete:
        !selected.unavailable.length && (!stakingNeeded || staking.ready),
      unavailableCollections: selected.unavailable,
      collections: selected.states,
      stakingStatus: staking,
      nextCursor:
        result.rows.length > Number(rawLimit) && last
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                scope,
                tokenId: last.tokenId,
                collectionId: last.collectionId
              })
            ).toString("base64url")
          : null
    });
  });
  app.route("/v2/islands", router);
}
