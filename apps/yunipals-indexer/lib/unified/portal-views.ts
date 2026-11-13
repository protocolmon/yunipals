import type { PoolClient } from "pg";
import { sqlIdentifier } from "../../../../packages/yunipals-indexer-server/src/database.js";
import { manifestDigest } from "../../../../packages/yunipals-indexer-server/src/identity.js";
import type { RegisteredRelease } from "../../../../packages/yunipals-indexer-server/src/releases.js";

export const portalViewVersion = 1;
export function portalReadIdentity(
  release: RegisteredRelease,
  readSchema: string
) {
  return manifestDigest({
    releaseId: release.id,
    manifestHash: release.manifestHash,
    readSchema,
    portalViewVersion
  });
}
const fields = {
  portal_v2_token: [
    "token",
    "token_id numeric, owner text, kind_id numeric, retired boolean, earned numeric, claimed numeric, balance numeric, claimant text"
  ],
  portal_v5_request: [
    "request",
    "request_id numeric, token_id numeric, submitter text, portal_id numeric, input_version numeric, commitment text, requested_block numeric, completed_version numeric, artwork_hash text, report_hash text, scores jsonb"
  ],
  portal_v5_mint: [
    "mint",
    "source text, request_id numeric, kind_id numeric, quantity integer, delivered integer"
  ],
  portal_v5_state: [
    "state",
    "source text, component text, entity_id text, value jsonb, block_number numeric, log_index integer"
  ],
  portal_v3_competition_entry: [
    "entry",
    "entry_id numeric, batch_id numeric, request_id numeric, submitter text, amount numeric, score integer"
  ],
  portal_v3_competition_batch: [
    "batch",
    "batch_id numeric, funded integer, completed integer, pool numeric, ready boolean, winners jsonb"
  ],
  portal_v3_competition_prize: [
    "prize",
    "batch_id numeric, rank integer, winner text, amount numeric"
  ]
} as const;

/** Explicit release operation. A unique read schema is never repointed in place. */
export async function createPortalReadViews(
  db: PoolClient,
  release: RegisteredRelease,
  readSchema: string,
  roles: string[]
) {
  const physical = sqlIdentifier(release.schema),
    read = sqlIdentifier(readSchema);
  if (
    !/^0x[0-9a-f]{64}$/.test(release.id) ||
    !/^0x[0-9a-f]{64}$/.test(release.manifestHash)
  )
    throw new Error("Invalid portal view release identity.");
  if (readSchema === release.schema || !roles.length)
    throw new Error(
      "A separate portal read schema and reader roles are required."
    );
  const sources = release.manifest.sources.filter(
    (s) => s.feature === "portals" && s.enabled
  );
  if (sources.length !== 4) throw new Error("Four portal sources required.");
  const address = (kind: string) => {
    const value = sources.find((s) => s.id === `portals:8453:${kind}`)?.address;
    if (!value || !/^0x[0-9a-f]{40}$/.test(value))
      throw new Error("Invalid portal emitter.");
    return value;
  };
  const deployment = `8453:${address("collection")}:${address("grading")}`;
  const identity = portalReadIdentity(release, readSchema);
  await db.query(`CREATE SCHEMA ${read}`);
  await db.query(`REVOKE ALL ON SCHEMA ${read} FROM PUBLIC`);
  await db.query(
    `CREATE VIEW ${read}._portal_read_release AS SELECT $SQL$${identity}$SQL$::text AS identity, $SQL$${release.id}$SQL$::text AS release_id, $SQL$${release.manifestHash}$SQL$::text AS manifest_hash`
  );
  // No boundary means no rows. Only a validated reader sets this transaction-local value.
  const ceiling =
    "nullif(current_setting('yunipals.portal_boundary', true),'')::bigint";
  for (const [name, [domain, columns]] of Object.entries(fields)) {
    await db.query(`CREATE VIEW ${read}.${sqlIdentifier(name)} AS
      SELECT v.deployment, r.* FROM (
        SELECT DISTINCT ON (entity) deployment,value FROM ${physical}.portal_projection_version
        WHERE domain='${domain}' AND block_number<=${ceiling}
        ORDER BY entity,block_number DESC,transaction_index DESC,log_index DESC
      ) v CROSS JOIN LATERAL jsonb_to_record(v.value::jsonb) AS r(${columns})`);
  }
  await db.query(`CREATE VIEW ${read}.portal_v2_ledger_event AS
    SELECT '${deployment}'::text AS deployment, e.transaction_hash, e.log_index,
      e.block_number, e.block_hash, e.transaction_index, e.address AS source, e.name AS event_type,
      CASE WHEN e.name LIKE 'Competition%' THEN 0::numeric ELSE coalesce(e.args::jsonb->>'portalId',CASE WHEN e.source_id='portals:8453:collection' THEN e.args::jsonb->>'tokenId' END,'0')::numeric END AS token_id,
      (SELECT jsonb_object_agg(k, CASE WHEN jsonb_typeof(v)='array' THEN
        (SELECT string_agg(item,',' ORDER BY n) FROM jsonb_array_elements_text(v) WITH ORDINALITY a(item,n)) ELSE v #>> '{}' END)
        FROM jsonb_each(e.args::jsonb) a(k,v)) AS args
    FROM ${physical}.canonical_event e WHERE e.source_id IN ('portals:8453:collection','portals:8453:registry','portals:8453:grading','portals:8453:competition') AND e.block_number<=${ceiling}`);
  for (const role of roles) {
    await db.query(
      `GRANT USAGE ON SCHEMA ${physical},yunipals_indexer_control TO ${sqlIdentifier(role)}`
    );
    await db.query(
      `GRANT SELECT ON ${physical}._ponder_meta,${physical}._ponder_checkpoint,${physical}.chain_checkpoint,${physical}.chain_block,${physical}.indexer_source,yunipals_indexer_control.release,yunipals_indexer_control.chain_status TO ${sqlIdentifier(role)}`
    );
    await db.query(`GRANT USAGE ON SCHEMA ${read} TO ${sqlIdentifier(role)}`);
    await db.query(
      `GRANT SELECT ON ALL TABLES IN SCHEMA ${read} TO ${sqlIdentifier(role)}`
    );
  }
  return { identity, readSchema, releaseId: release.id };
}
