import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Pool } from "pg";
import { isAddress } from "viem";
import { islandCollection } from "../constants.js";
import { canonicalTokenId } from "../islands/metadata.js";
import { islandsReadiness } from "../islands/readiness.js";
import {
  islandIdentityPredicate,
  islandTokenColumns,
  islandTokenRelation
} from "../islands/queries.js";
import { sqlIdentifier } from "../offchain/sql.js";

export type IslandsRouteDependencies = {
  pool: Pick<Pool, "query">;
  schemaName: string;
  enabled?: () => boolean;
  checkReadiness?: () => Promise<{ ready: boolean }>;
};

type Cursor = { v: 1; scope: string; tokenId: string };
const encodeCursor = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function decodeCursor(raw: string): Cursor | undefined {
  if (raw.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(raw)) return;
  try {
    const value = JSON.parse(
      Buffer.from(raw, "base64url").toString()
    ) as Partial<Cursor>;
    if (
      value.v === 1 &&
      typeof value.scope === "string" &&
      typeof value.tokenId === "string" &&
      canonicalTokenId(value.tokenId)
    )
      return value as Cursor;
  } catch {
    /* Invalid cursors are reported before querying the database. */
  }
}

const descriptor = {
  collectionId: islandCollection.slug,
  chain: islandCollection.chain,
  chainId: islandCollection.chainId,
  contractAddress: islandCollection.address,
  name: islandCollection.name,
  openseaSlug: islandCollection.openseaSlug,
  deploymentBlock: String(islandCollection.deploymentBlock)
};

export function registerIslandsRoutes(
  app: Hono,
  dependencies: IslandsRouteDependencies
) {
  const { pool, schemaName } = dependencies;
  const schema = sqlIdentifier(schemaName);
  const enabled =
    dependencies.enabled ?? (() => process.env.API_ISLANDS_ENABLED === "true");
  const checkReadiness =
    dependencies.checkReadiness ?? (() => islandsReadiness(pool, schemaName));
  const root = `/v2/collections/${islandCollection.slug}`;
  const router = new Hono();

  router.onError((_error, c) =>
    c.json({ error: "islands_database_unavailable" }, 503)
  );
  router.get("/indexing-status", async (c) =>
    c.json({
      ...descriptor,
      enabled: enabled(),
      ...(enabled() ? await checkReadiness() : { ready: false })
    })
  );
  router.use("*", async (c, next) => {
    if (!enabled())
      return c.json(
        {
          error: "islands_reads_disabled",
          collectionId: islandCollection.slug
        },
        503
      );
    const readiness = await checkReadiness();
    if (!readiness.ready)
      return c.json(
        { error: "ownership_rebuilding", ...descriptor, readiness },
        503
      );
    await next();
  });
  router.get("/", (c) => c.json(descriptor));

  async function listTokens(url: URL, pathOwner?: string) {
    const allowed = new Set([
      "limit",
      "cursor",
      "sort",
      "owner",
      "burned",
      "edition"
    ]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1)
        return { error: "invalid_query", status: 400 as const };
    }
    const rawLimit = url.searchParams.get("limit") ?? "50";
    if (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100)
      return { error: "invalid_limit", status: 400 as const };
    const limit = Number(rawLimit);
    const sort = url.searchParams.get("sort") ?? "token-id-asc";
    if (!["token-id-asc", "token-id-desc"].includes(sort))
      return { error: "invalid_sort", status: 400 as const };
    const burned = url.searchParams.get("burned") ?? "false";
    if (!["false", "true", "all"].includes(burned))
      return { error: "invalid_burned", status: 400 as const };
    const edition = url.searchParams.get("edition");
    if (edition !== null && !["Genesis", "Personal"].includes(edition))
      return { error: "invalid_edition", status: 400 as const };
    const queryOwner = url.searchParams.get("owner");
    const owner = (pathOwner ?? queryOwner)?.toLowerCase();
    if (
      (pathOwner !== undefined || queryOwner !== null) &&
      (!owner || !isAddress(owner) || /^0x0{40}$/.test(owner))
    )
      return { error: "invalid_owner", status: 400 as const };
    if (pathOwner && queryOwner && queryOwner.toLowerCase() !== owner)
      return { error: "owner_scope_mismatch", status: 400 as const };
    if (pathOwner && burned !== "false")
      return { error: "owner_requires_active_tokens", status: 400 as const };
    const scope = createHash("sha256")
      .update(
        JSON.stringify({
          collectionId: islandCollection.slug,
          sort,
          burned,
          edition,
          owner: owner ?? null
        })
      )
      .digest("hex");
    const rawCursor = url.searchParams.get("cursor");
    const cursor = rawCursor ? decodeCursor(rawCursor) : undefined;
    if (rawCursor !== null && (!cursor || cursor.scope !== scope))
      return { error: "invalid_cursor", status: 409 as const };
    const params: unknown[] = [];
    const conditions = [islandIdentityPredicate];
    if (burned !== "all") {
      params.push(burned === "true");
      conditions.push(`t.burned=$${params.length}`);
    }
    if (owner) {
      params.push(owner);
      conditions.push(`t.owner=$${params.length} AND NOT t.burned`);
    }
    if (edition)
      conditions.push(
        `t.token_id::numeric${edition === "Genesis" ? "<=" : ">"}${islandCollection.genesisLimit}`
      );
    const ascending = sort === "token-id-asc";
    if (cursor) {
      params.push(cursor.tokenId);
      conditions.push(
        `t.token_id::numeric${ascending ? ">" : "<"}$${params.length}::numeric`
      );
    }
    params.push(limit + 1);
    const result = await pool.query<
      Record<string, unknown> & { tokenId: string }
    >(
      `SELECT ${islandTokenColumns} FROM ${islandTokenRelation(schemaName)}
        WHERE ${conditions.join(" AND ")} ORDER BY t.token_id::numeric ${ascending ? "ASC" : "DESC"} LIMIT $${params.length}`,
      params
    );
    const items = result.rows.slice(0, limit);
    return {
      body: {
        ...descriptor,
        items,
        limit,
        nextCursor:
          result.rows.length > limit && items.length
            ? encodeCursor({ v: 1, scope, tokenId: items.at(-1)!.tokenId })
            : null
      }
    };
  }

  router.get("/tokens", async (c) => {
    const result = await listTokens(new URL(c.req.url));
    return "error" in result
      ? c.json({ error: result.error }, result.status)
      : c.json(result.body);
  });
  router.get("/owners/:address/tokens", async (c) => {
    const address = c.req.param("address");
    if (!isAddress(address.toLowerCase()))
      return c.json({ error: "invalid_owner" }, 400);
    const result = await listTokens(new URL(c.req.url), address);
    return "error" in result
      ? c.json({ error: result.error }, result.status)
      : c.json(result.body);
  });
  router.get("/tokens/:tokenId", async (c) => {
    const tokenId = c.req.param("tokenId");
    if (!canonicalTokenId(tokenId))
      return c.json({ error: "invalid_token_id" }, 400);
    const result = await pool.query(
      `SELECT ${islandTokenColumns} FROM ${islandTokenRelation(schemaName)}
      WHERE ${islandIdentityPredicate} AND t.token_id=$1`,
      [tokenId]
    );
    if (!result.rows.length) return c.json({ error: "token_not_found" }, 404);
    const lifecycles = await pool.query(
      `SELECT lifecycle,minted_to AS "mintedTo",mint_block::text AS "mintBlock",
      mint_timestamp::text AS "mintTimestamp",mint_transaction_hash AS "mintTransactionHash",
      burned_at_block::text AS "burnedAtBlock",burned_at_timestamp::text AS "burnedAtTimestamp",
      burn_transaction_hash AS "burnTransactionHash" FROM ${schema}.token_lifecycle
      WHERE collection=$1 AND token_id=$2 ORDER BY lifecycle LIMIT 100`,
      [islandCollection.slug, tokenId]
    );
    return c.json({ token: result.rows[0], lifecycles: lifecycles.rows });
  });
  router.get("/tokens/:tokenId/transfers", async (c) => {
    const tokenId = c.req.param("tokenId");
    if (!canonicalTokenId(tokenId))
      return c.json({ error: "invalid_token_id" }, 400);
    const url = new URL(c.req.url);
    if (
      [...url.searchParams.keys()].some(
        (key) =>
          !["limit", "cursor"].includes(key) ||
          url.searchParams.getAll(key).length !== 1
      )
    ) {
      return c.json({ error: "invalid_query" }, 400);
    }
    const rawLimit = url.searchParams.get("limit") ?? "50";
    if (!/^[1-9]\d*$/.test(rawLimit) || Number(rawLimit) > 100)
      return c.json({ error: "invalid_limit" }, 400);
    const limit = Number(rawLimit);
    const params: unknown[] = [islandCollection.slug, tokenId];
    let after = "";
    const rawCursor = url.searchParams.get("cursor");
    if (rawCursor !== null) {
      try {
        if (rawCursor.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(rawCursor))
          throw new Error();
        const value = JSON.parse(
          Buffer.from(rawCursor, "base64url").toString()
        ) as {
          collectionId: string;
          tokenId: string;
          blockNumber: string;
          transactionIndex: number;
          logIndex: number;
        };
        if (
          value.collectionId !== islandCollection.slug ||
          value.tokenId !== tokenId ||
          !canonicalTokenId(value.blockNumber) ||
          !Number.isInteger(value.transactionIndex) ||
          value.transactionIndex < 0 ||
          value.transactionIndex > 2_147_483_647 ||
          !Number.isInteger(value.logIndex) ||
          value.logIndex < 0 ||
          value.logIndex > 2_147_483_647
        )
          throw new Error();
        params.push(value.blockNumber, value.transactionIndex, value.logIndex);
        after =
          "AND (block_number,transaction_index,log_index)>($3::numeric,$4::integer,$5::integer)";
      } catch {
        return c.json({ error: "invalid_cursor" }, 409);
      }
    }
    params.push(limit + 1);
    const result = await pool.query<{
      blockNumber: string;
      transactionIndex: number;
      logIndex: number;
    }>(
      `SELECT id,collection AS "collectionId",chain_id AS "chainId",contract_address AS "contractAddress",
        token_id AS "tokenId",lifecycle,"from","to",block_number::text AS "blockNumber",
        block_timestamp::text AS "blockTimestamp",transaction_hash AS "transactionHash",
        transaction_index AS "transactionIndex",log_index AS "logIndex"
        FROM ${schema}.transfer_event WHERE collection=$1 AND token_id=$2 ${after}
        ORDER BY block_number,transaction_index,log_index LIMIT $${params.length}`,
      params
    );
    const items = result.rows.slice(0, limit);
    const last = items.at(-1);
    return c.json({
      ...descriptor,
      items,
      nextCursor:
        result.rows.length > limit && last
          ? encodeCursor({
              collectionId: islandCollection.slug,
              tokenId,
              blockNumber: last.blockNumber,
              transactionIndex: last.transactionIndex,
              logIndex: last.logIndex
            })
          : null
    });
  });
  router.get("/stats", async (c) => {
    const result = await pool.query(`SELECT count(*)::int AS "knownTokens",
      count(*) FILTER(WHERE NOT t.burned)::int AS "activeSupply",
      count(*) FILTER(WHERE t.burned)::int AS "burnedTokens",
      count(DISTINCT t.owner) FILTER(WHERE NOT t.burned)::int AS holders,
      count(*) FILTER(WHERE NOT t.burned AND t.token_id::numeric<=${islandCollection.genesisLimit})::int AS genesis,
      count(*) FILTER(WHERE NOT t.burned AND t.token_id::numeric>${islandCollection.genesisLimit})::int AS personal,
      count(*) FILTER(WHERE NOT t.burned AND p.status='published' AND r.revision_hash IS NOT NULL)::int AS "metadataAvailable"
      FROM ${islandTokenRelation(schemaName)} WHERE ${islandIdentityPredicate}`);
    return c.json({ ...descriptor, ...result.rows[0] });
  });
  app.route(root, router);
}
