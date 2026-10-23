import { Hono } from "hono";
import type { Pool } from "pg";
import { isAddress } from "viem";
import {
  boosterDeployment,
  type BoosterDeployment
} from "../boosters/config.js";
import type { boosterReadiness } from "../boosters/readiness.js";
import { sqlIdentifier } from "../offchain/sql.js";
import {
  boosterIdentity,
  type BoosterMonster,
  type BoosterRequest
} from "../../../../packages/yunipals-market-core/src/boosters.js";

const typeColumns = `id, pack_type_id AS "packTypeId", registry, engine,
  payment_token AS "paymentToken", price, interval_seconds::text AS "intervalSeconds",
  mints_per_interval::float8 AS "mintsPerInterval", total_variants::text AS "totalVariants",
  max_batch AS "maxBatch", catalog_hash AS "catalogHash", rule_hash AS "ruleHash",
  manifest_uri AS "manifestUri", metadata_base_uri AS "metadataBaseUri",
  sales_paused AS "salesPaused", openings::text`;
const originalColumns = `id, collection, token_id AS "tokenId", type_key AS "typeKey", engine, owner,
  revealed_at::text AS "revealedAt", daily_committed::text AS "dailyCommitted", minted::text,
  remaining::text, pending_request AS "pendingRequest", burned`;
const requestColumns = `id, engine, wrapper, request_id AS "requestId", original_key AS "originalKey",
  payer, quantity, opening, paid, rule_hash AS "ruleHash", callback_gas AS "callbackGas", status,
  seed, requested_at::text AS "requestedAt", received_at::text AS "receivedAt",
  transaction_hash AS "transactionHash", recipient`;
const monsterColumns = `m.id, m.collection, m.token_id AS "tokenId", m.original_key AS "originalKey",
  m.request_key AS "requestKey", m.type_key AS "typeKey", m.owner, m.minted_to AS "mintedTo", m.variant_id::text AS "variantId",
  m.monster_type::text AS "monsterType", m.color::text, m.horn::text, m.glitter::text,
  m.is_original AS "isOriginal", m.burned, m.mint_block::text AS "mintBlock",
  p.metadata_base_uri || m.variant_id::text || '.json' AS "metadataUri"`;
const validId = (id: string) =>
  /^(0|[1-9][0-9]{0,77})$/.test(id) && BigInt(id) < 2n ** 256n;

export function registerBoosterRoutes(
  app: Hono,
  dependencies: {
    pool: Pick<Pool, "query">;
    schemaName: string;
    readSnapshot?: (
      deployment: BoosterDeployment
    ) => ReturnType<typeof boosterReadiness>;
  }
) {
  const { pool } = dependencies;
  const schema = sqlIdentifier(dependencies.schemaName);
  const router = new Hono();
  router.onError(
    () =>
      new Response(JSON.stringify({ error: "booster_index_unavailable" }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      })
  );
  const snapshot = async () => {
    const deployment = boosterDeployment();
    const base = {
      chainId: 8453 as const,
      collection: deployment?.monsters ?? null,
      engine: deployment?.engine ?? null,
      enabled: deployment !== null,
      requestsPaused: false,
      indexedBlock: null as string | null,
      indexedBlockHash: null as string | null,
      indexedTimestamp: null as string | null
    };
    if (!deployment) return base;
    if (dependencies.readSnapshot) {
      const source = await dependencies.readSnapshot(deployment);
      if (!source.ready) throw new Error(source.reason);
      return { ...base, ...source };
    }
    const [checkpoint, state] = await Promise.all([
      pool.query(`SELECT block_number::text AS "indexedBlock", block_hash AS "indexedBlockHash",
        timestamp::text AS "indexedTimestamp" FROM ${schema}.booster_checkpoint WHERE id='8453'`),
      pool.query(
        `SELECT paused FROM ${schema}.booster_engine_state WHERE id=$1`,
        [deployment.engine]
      )
    ]);
    return {
      ...base,
      ...checkpoint.rows[0],
      requestsPaused: state.rows[0]?.paused ?? false
    };
  };
  router.get("/boosters/types", async (c) => {
    const state = await snapshot();
    const result = state.enabled
      ? await pool.query(
          `SELECT ${typeColumns} FROM ${schema}.booster_type ORDER BY pack_type_id::numeric`
        )
      : { rows: [] };
    return c.json({ ...state, items: result.rows });
  });

  router.get("/boosters/originals/:collection/:tokenId", async (c) => {
    const { collection, tokenId } = c.req.param();
    if (!isAddress(collection) || !validId(tokenId))
      return c.json({ error: "invalid_monster_identity" }, 400);
    const state = await snapshot();
    if (!state.enabled)
      return c.json({ error: "boosters_not_configured" }, 503);
    const result = await pool.query(
      `SELECT ${originalColumns} FROM ${schema}.booster_original WHERE id=$1`,
      [boosterIdentity(collection, tokenId)]
    );
    const original = result.rows[0];
    if (!original) return c.json({ error: "original_not_found" }, 404);
    const pack = await pool.query(
      `SELECT ${typeColumns} FROM ${schema}.booster_type WHERE id=$1`,
      [original.typeKey]
    );
    return c.json({ ...state, item: { ...original, pack: pack.rows[0] } });
  });

  router.get("/boosters/requests/:engine/:requestId", async (c) => {
    const { engine, requestId } = c.req.param();
    if (!isAddress(engine) || !validId(requestId))
      return c.json({ error: "invalid_request_identity" }, 400);
    const state = await snapshot();
    if (!state.enabled)
      return c.json({ error: "boosters_not_configured" }, 503);
    const result = await pool.query(
      `SELECT ${requestColumns} FROM ${schema}.booster_request WHERE id=$1`,
      [boosterIdentity(engine, requestId)]
    );
    return result.rows[0]
      ? c.json({ ...state, item: result.rows[0] })
      : c.json({ error: "request_not_indexed" }, 404);
  });

  router.get("/boosters/requests/:engine/:requestId/monsters", async (c) => {
    c.header("Cache-Control", "no-store");
    const { engine, requestId } = c.req.param();
    if (!isAddress(engine) || !validId(requestId))
      return c.json({ error: "invalid_request_identity" }, 400);
    const deployment = boosterDeployment();
    if (!deployment) return c.json({ error: "boosters_not_configured" }, 503);
    if (engine.toLowerCase() !== deployment.engine)
      return c.json({ error: "invalid_request_identity" }, 400);
    const state = await snapshot();
    if (!state.enabled)
      return c.json({ error: "boosters_not_configured" }, 503);
    if (state.indexedBlock === null || state.indexedBlock === undefined)
      return c.json({ error: "booster_index_unavailable" }, 503);
    const requestKey = boosterIdentity(engine, requestId);
    const result = await pool.query<{
      id: string;
      status: BoosterRequest["status"];
      quantity: number;
      originalKey: string;
      typeKey: string;
      items: BoosterMonster[];
    }>(
      `SELECT r.id,r.status,r.quantity,r.original_key AS "originalKey",o.type_key AS "typeKey",
        (SELECT coalesce(jsonb_agg(items ORDER BY items."tokenId"::numeric),'[]'::jsonb)
         FROM (SELECT ${monsterColumns}
           FROM ${schema}.booster_monster m
           JOIN ${schema}.booster_type p ON p.id=m.type_key AND p.id=o.type_key
             AND p.engine=r.engine AND p.registry=$5 AND p.rule_hash=r.rule_hash
           WHERE r.status='completed' AND r.quantity BETWEEN 1 AND 7
             AND m.request_key=r.id AND m.original_key=r.original_key
             AND m.collection=$4 AND m.mint_block<=$6::bigint
           ORDER BY m.token_id::numeric LIMIT 8) items) AS items
       FROM ${schema}.booster_request r
       JOIN ${schema}.booster_original o ON o.id=r.original_key
         AND o.collection=$4 AND o.engine=r.engine
       WHERE r.id=$1 AND r.engine=$2 AND r.request_id=$3`,
      [
        requestKey,
        deployment.engine,
        requestId,
        deployment.monsters,
        deployment.registry,
        state.indexedBlock
      ]
    );
    const request = result.rows[0];
    if (!request) return c.json({ error: "request_not_indexed" }, 404);
    if (
      !Number.isInteger(request.quantity) ||
      request.quantity < 1 ||
      request.quantity > 7
    )
      return c.json({ error: "booster_index_unavailable" }, 503);
    if (request.status === "forfeited")
      return c.json(
        {
          ...state,
          error: "request_forfeited",
          status: request.status,
          requestId,
          quantity: request.quantity,
          items: [],
          nextCursor: null
        },
        409
      );
    if (request.status === "pending" || request.status === "seeded")
      return c.json(
        {
          ...state,
          error: "request_not_completed",
          status: request.status,
          requestId,
          quantity: request.quantity,
          items: [],
          nextCursor: null
        },
        409
      );
    const items = request.items;
    if (
      request.status !== "completed" ||
      !Array.isArray(items) ||
      items.length !== request.quantity ||
      new Set(items.map((item) => item.id)).size !== request.quantity ||
      items.some(
        (item) =>
          item.collection !== deployment.monsters ||
          item.requestKey !== requestKey ||
          item.originalKey !== request.originalKey ||
          item.typeKey !== request.typeKey ||
          !validId(item.tokenId) ||
          item.id !== boosterIdentity(deployment.monsters, item.tokenId)
      )
    )
      return c.json({ error: "booster_index_unavailable" }, 503);
    return c.json({
      ...state,
      requestId,
      status: request.status,
      quantity: request.quantity,
      items,
      nextCursor: null
    });
  });

  router.get("/boosters/monsters/:collection/:tokenId", async (c) => {
    const { collection, tokenId } = c.req.param();
    if (!isAddress(collection) || !validId(tokenId))
      return c.json({ error: "invalid_monster_identity" }, 400);
    const state = await snapshot();
    if (!state.enabled)
      return c.json({ error: "boosters_not_configured" }, 503);
    const result = await pool.query(
      `SELECT ${monsterColumns} FROM ${schema}.booster_monster m
      JOIN ${schema}.booster_type p ON p.id=m.type_key WHERE m.id=$1`,
      [boosterIdentity(collection, tokenId)]
    );
    return result.rows[0]
      ? c.json({ ...state, item: result.rows[0] })
      : c.json({ error: "monster_not_found" }, 404);
  });

  for (const resource of ["originals", "monsters", "requests"] as const) {
    router.get(`/owners/:address/booster-${resource}`, async (c) => {
      const address = c.req.param("address");
      if (!isAddress(address)) return c.json({ error: "invalid_owner" }, 400);
      const cursor = c.req.query("after") ?? "0";
      if (!validId(cursor)) return c.json({ error: "invalid_cursor" }, 400);
      const limit = Number(c.req.query("limit") ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return c.json({ error: "invalid_limit" }, 400);
      const state = await snapshot();
      if (!state.enabled)
        return c.json({ ...state, items: [], nextCursor: null });
      const args = [address.toLowerCase(), cursor, limit + 1];
      let items: Record<string, unknown>[];
      if (resource === "originals") {
        const [result, packs] = await Promise.all([
          pool.query(
            `SELECT ${originalColumns} FROM ${schema}.booster_original
            WHERE owner=$1 AND NOT burned AND token_id::numeric>$2::numeric ORDER BY token_id::numeric LIMIT $3`,
            args
          ),
          pool.query(`SELECT ${typeColumns} FROM ${schema}.booster_type`)
        ]);
        items = result.rows.map((row) => ({
          ...row,
          pack: packs.rows.find((pack) => pack.id === row.typeKey)
        }));
      } else if (resource === "monsters") {
        const result = await pool.query(
          `SELECT ${monsterColumns} FROM ${schema}.booster_monster m
          JOIN ${schema}.booster_type p ON p.id=m.type_key
          WHERE m.owner=$1 AND NOT m.burned AND m.token_id::numeric>$2::numeric ORDER BY m.token_id::numeric LIMIT $3`,
          args
        );
        items = result.rows;
      } else {
        const result = await pool.query(
          `SELECT ${requestColumns} FROM ${schema}.booster_request
          WHERE payer=$1 AND request_id::numeric>$2::numeric ORDER BY request_id::numeric LIMIT $3`,
          args
        );
        items = result.rows;
      }
      const more = items.length > limit;
      items = items.slice(0, limit);
      return c.json({
        ...state,
        items,
        nextCursor: more
          ? String(
              items.at(-1)![resource === "requests" ? "requestId" : "tokenId"]
            )
          : null
      });
    });
  }

  router.get("/owners/:address/booster-refunds", async (c) => {
    const address = c.req.param("address");
    if (!isAddress(address)) return c.json({ error: "invalid_owner" }, 400);
    const state = await snapshot();
    const result = state.enabled
      ? await pool.query(
          `SELECT engine, requester, credit::text,
      returned::text, withdrawn::text FROM ${schema}.booster_refund WHERE requester=$1`,
          [address.toLowerCase()]
        )
      : { rows: [] };
    return c.json({ ...state, items: result.rows });
  });
  app.route("/v1", router);
}
