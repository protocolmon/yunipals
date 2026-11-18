import type { Hono } from "hono";
import type { Pool, PoolClient } from "pg";
import { isAddress, zeroAddress } from "viem";
import {
  boosterDeployment,
  type BoosterDeployment
} from "../boosters/config.js";
import { boosterReadiness } from "../boosters/readiness.js";
import { sqlIdentifier } from "../offchain/sql.js";

const validId = (value: string) =>
  /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 2n ** 256n;
export type PortalCardCountsInput = {
  owner: string;
  grading: string;
  collection: string;
  portalIds: string[];
};

/** One owner-index scan, at most eleven portals, point lookups for facts and
 * pending requests, excluding completed grades from the current projection.
 * No wallet pagination, version-history scan, metadata fetch or RPC. */
export async function readPortalCardCounts(
  db: Pick<PoolClient, "query">,
  schemaName: string,
  deployment: BoosterDeployment,
  input: PortalCardCountsInput
) {
  const schema = sqlIdentifier(schemaName);
  const result = await db.query<{
    portalId: string;
    count: number | null;
    retired: boolean | null;
  }>(
    `WITH config AS MATERIALIZED (
       SELECT * FROM ${schema}.portal_eligibility_config
       WHERE id=$2 AND collection=$3 AND cards=$4
     ), graded AS MATERIALIZED (
       SELECT DISTINCT value->>'token_id' AS token_id
       FROM ${schema}.portal_projection
       WHERE id LIKE '8453:' || $3 || ':' || $2 || ':request:%'
         AND value->>'completed_version' IS NOT NULL
     ), owned AS MATERIALIZED (
       SELECT m.color,m.monster_type,m.horn,m.glitter,m.is_original,f.sequence FROM ${schema}.booster_monster m
       JOIN config c ON c.cards=m.collection
       JOIN ${schema}.booster_type t ON t.id=m.type_key AND t.pack_type_id=c.pack_type_id
         AND t.registry=$5 AND t.engine=$6
       JOIN ${schema}.booster_card_facts f ON f.id=m.id
       WHERE m.owner=$1 AND NOT m.burned
         AND NOT EXISTS (SELECT 1 FROM graded g WHERE g.token_id=m.token_id)
         AND NOT EXISTS (SELECT 1 FROM ${schema}.portal_eligibility_pending p
           WHERE p.id='8453:' || $2 || ':' || m.token_id)
     )
     SELECT ids.id AS "portalId",p.retired,
       CASE WHEN p.id IS NULL OR NOT EXISTS (SELECT 1 FROM config) THEN NULL
       ELSE (SELECT count(*)::int FROM owned m WHERE NOT p.retired
         AND m.color=p.color_gate+1 AND m.monster_type=p.type_gate+1
         AND (NOT p.glitter_gate OR m.glitter=1)
         AND (NOT p.diamond_gate OR m.horn=2)
         AND CASE WHEN p.original_only THEN m.is_original
           ELSE m.sequence>=0 AND m.sequence<264
             AND (m.sequence+264-p.sequence_start)%264<p.sequence_length END) END AS count
     FROM unnest($7::text[]) WITH ORDINALITY AS ids(id,position)
     LEFT JOIN ${schema}.portal_eligibility_portal p ON p.id='8453:' || $3 || ':' || ids.id
     ORDER BY ids.position`,
    [
      input.owner,
      input.grading,
      input.collection,
      deployment.monsters,
      deployment.registry,
      deployment.engine,
      input.portalIds
    ]
  );
  if (
    result.rows.length !== input.portalIds.length ||
    result.rows.some((row) => row.count === null)
  )
    throw new Error("Portal eligibility data is not indexed yet.");
  return result.rows;
}

export function registerPortalCardCountRoutes(
  app: Hono,
  dependencies: {
    pool: Pick<Pool, "connect">;
    schemaName: string;
    readSnapshot?: (
      db: PoolClient,
      deployment: BoosterDeployment
    ) => ReturnType<typeof boosterReadiness>;
  }
) {
  const schema = sqlIdentifier(dependencies.schemaName);
  app.get("/v1/boosters/portal-card-counts", async (c) => {
    c.header("Cache-Control", "no-store");
    const owner = c.req.query("owner")?.toLowerCase() ?? "";
    const grading = c.req.query("grading")?.toLowerCase() ?? "";
    const collection = c.req.query("collection")?.toLowerCase() ?? "";
    const portalIds = (c.req.query("portalIds") ?? "").split(",");
    if (
      [owner, grading, collection].some(
        (value) => !isAddress(value) || value === zeroAddress
      ) ||
      portalIds.length > 11 ||
      new Set(portalIds).size !== portalIds.length ||
      !portalIds.every(validId)
    )
      return c.json({ error: "invalid_portal_card_count_request" }, 400);
    try {
      const deployment = boosterDeployment();
      if (!deployment) throw new Error("Boosters are not configured.");
      const client = await dependencies.pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.query("SET LOCAL statement_timeout='3000ms'");
        const snapshot = await (dependencies.readSnapshot
          ? dependencies.readSnapshot(client, deployment)
          : boosterReadiness(
              client,
              dependencies.schemaName,
              deployment.engine
            ));
        if (!snapshot.ready) throw new Error("Indexer is catching up.");
        // Require the upgraded source manifest, and reject a partially processed
        // block instead of mixing completed ownership with future portal state.
        const sources = await client.query<{
          id: string;
          address: string;
          events: string[];
          block: string | null;
        }>(
          `SELECT s.id,s.definition::jsonb->>'address' AS address,
             s.definition::jsonb->'events' AS events,e.block_number::text AS block
           FROM ${schema}.indexer_source s
           LEFT JOIN LATERAL (SELECT block_number FROM ${schema}.canonical_event e
             WHERE e.source_id=s.id ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1) e ON true
           WHERE s.id=ANY($1::text[]) AND (s.definition::jsonb->>'enabled')::boolean`,
          [
            [
              "boosters:boostermonsters",
              "boosters:boosterregistry",
              "boosters:boosterengine",
              "portals:8453:collection",
              "portals:8453:grading"
            ]
          ]
        );
        const expected = new Map([
          [
            "boosters:boostermonsters",
            [deployment.monsters, "CardFactsRecorded"]
          ],
          ["boosters:boosterregistry", [deployment.registry, "TypeActivated"]],
          ["boosters:boosterengine", [deployment.engine, "RequestCompleted"]],
          ["portals:8453:collection", [collection, "PortalMinted"]],
          ["portals:8453:grading", [grading, "Initialized"]]
        ]);
        if (
          sources.rows.length !== expected.size ||
          sources.rows.some((source) => {
            const binding = expected.get(source.id);
            return (
              !binding ||
              source.address !== binding[0] ||
              !source.events.includes(binding[1]) ||
              (source.block !== null &&
                BigInt(source.block) > BigInt(snapshot.indexedBlock))
            );
          })
        )
          throw new Error("Eligibility source is unavailable.");
        const items = await readPortalCardCounts(
          client,
          dependencies.schemaName,
          deployment,
          { owner, grading, collection, portalIds }
        );
        await client.query("COMMIT");
        return c.json({
          owner,
          grading,
          collection,
          cards: deployment.monsters,
          chainId: 8453,
          indexedBlock: snapshot.indexedBlock,
          items
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch {
      c.header("Retry-After", "15");
      return c.json(
        { error: "Portal card counts are temporarily unavailable." },
        503
      );
    }
  });
}
