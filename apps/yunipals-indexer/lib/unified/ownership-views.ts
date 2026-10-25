import type { Pool } from "pg";
import { confirmationPolicyKey } from "../../../../packages/yunipals-indexer-client/src/sources.js";
import {
  ownershipHistorySql,
  ownershipLifecycleSql,
  ownershipReference,
  ownershipTokenSql,
  type OwnershipReadDefinition
} from "../../../../packages/yunipals-indexer-server/src/ownership.js";
import { sqlIdentifier } from "../../../../packages/yunipals-indexer-server/src/database.js";
import { readBoundRuntime, type RegisteredRelease } from "./releases.js";
import { manifestDigest } from "./sources.js";
import {
  createNativeBaseMetadataViews,
  nativeBaseMetadataDefinition
} from "./base-metadata-views.js";

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Create a release-bound candidate. This never replaces an existing dataset. */
export async function createOwnershipReadViews(
  pool: Pick<Pool, "connect">,
  release: RegisteredRelease,
  readSchema: string,
  definitions: readonly OwnershipReadDefinition[]
) {
  const target = sqlIdentifier(readSchema),
    sourceSchema = sqlIdentifier(release.schema);
  if (
    readSchema === release.schema ||
    !definitions.length ||
    definitions.length > 32 ||
    new Set(definitions.map((row) => row.collection)).size !==
      definitions.length ||
    new Set(definitions.map((row) => row.sourceId)).size !== definitions.length
  )
    throw new Error("Invalid candidate ownership read schema/configuration.");
  const configs = definitions
    .map((definition) => {
      const source = release.manifest.sources.find(
        (source) => source.id === definition.sourceId
      );
      if (
        !source ||
        !source.policies.some(
          (policy) =>
            confirmationPolicyKey(policy) ===
            confirmationPolicyKey(definition.policy)
        )
      )
        throw new Error("Unsupported ownership source confirmation policy.");
      const ref = ownershipReference(
        release.schema,
        source,
        definition.collection
      );
      return { ...definition, source: ref.source };
    })
    .sort((a, b) => a.collection.localeCompare(b.collection));
  const nativeBase = nativeBaseMetadataDefinition(
    release,
    definitions.some(
      (definition) =>
        definition.collection === "base" && definition.policy.kind === "latest"
    )
  );
  const identity = manifestDigest({
    // Latest reads serve the verified complete prefix after framework catch-up.
    // This semantic change requires a new identity; existing views are immutable.
    version: 5,
    releaseId: release.id,
    configs,
    nativeBase
  });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='3s'");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('unified-ownership-read-views'),hashtext($1))",
      [readSchema]
    );
    await readBoundRuntime(db, release);
    const exists =
      (
        await db.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [
          readSchema
        ])
      ).rowCount === 1;
    if (exists) {
      const marker = (
        await db.query("SELECT to_regclass($1) AS relation", [
          `${target}._unified_read_release`
        ])
      ).rows[0]?.relation;
      if (!marker)
        throw new Error(
          "Refusing to replace a schema without a unified read identity."
        );
      const previous = (
        await db.query(
          `SELECT identity FROM ${target}._unified_read_release WHERE singleton`
        )
      ).rows[0]?.identity;
      if (previous !== identity)
        throw new Error(
          "A candidate read schema cannot be reassigned to another release/configuration."
        );
      const complete = (
        await db.query(
          `SELECT count(*)=$5::integer AND
        to_regprocedure($2) IS NOT NULL AND to_regprocedure($4) IS NOT NULL
        AND ($6::text IS NULL OR (to_regprocedure($6) IS NOT NULL AND to_regprocedure($7) IS NOT NULL)) AS complete FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=$1 AND c.relkind='v' AND c.relname=ANY($3::text[])`,
          [
            readSchema,
            `${target}.source_boundary(text)`,
            [
              "token",
              "token_lifecycle",
              "transfer_event",
              "admin_role_event",
              "contract_owner_event",
              "source_status",
              ...(nativeBase
                ? ["base_metadata_event", "base_metadata_scan"]
                : [])
            ],
            `${target}.source_probe(text)`,
            nativeBase ? 8 : 6,
            nativeBase ? `${target}.base_metadata_frame(boolean)` : null,
            nativeBase ? `${target}.base_metadata_probe()` : null
          ]
        )
      ).rows[0]?.complete;
      if (!complete)
        throw new Error(
          "Candidate ownership read objects are incomplete; review the schema before reuse."
        );
      await db.query("COMMIT");
      return {
        schema: readSchema,
        releaseId: release.id,
        identity,
        created: false,
        activated: false
      };
    }
    await db.query(`CREATE SCHEMA ${target}`);
    await db.query(`CREATE TABLE ${target}._unified_read_release (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      identity text NOT NULL,release_id text NOT NULL,manifest_hash text NOT NULL,
      definitions jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
    await db.query(
      `INSERT INTO ${target}._unified_read_release(identity,release_id,manifest_hash,definitions)
      VALUES($1,$2,$3,$4)`,
      [identity, release.id, release.manifestHash, JSON.stringify(definitions)]
    );
    // STABLE functions observe the invoking statement's MVCC snapshot. The
    // checks deliberately mirror the pinned shared-reader coverage contract.
    // It raises a dedicated SQLSTATE instead of returning an empty collection.
    let delimiterIndex = 0;
    while (
      JSON.stringify(configs).includes(`$yunipals_ownership_${delimiterIndex}$`)
    )
      delimiterIndex++;
    const dollar = `$yunipals_ownership_${delimiterIndex}$`;
    await db.query(`CREATE FUNCTION ${target}.source_boundary(selected_collection text)
      RETURNS TABLE(source_id text,collection text,chain_id integer,contract_address text,
        block_number bigint,block_hash text,block_timestamp bigint,observed_at timestamptz,
        heartbeat_at bigint,ready boolean,release_id text,manifest_hash text,policy text)
      LANGUAGE plpgsql STABLE SECURITY INVOKER ROWS 1 SET search_path=pg_catalog AS ${dollar}
      DECLARE config jsonb; v_definition jsonb; observation record; runtime jsonb;
        checkpoint text; indexed bigint; verified bigint; required bigint; available bigint;
        boundary jsonb; clock_ms bigint; source_record record; stored_release record;
      BEGIN
        SELECT value INTO config FROM jsonb_array_elements(${literal(JSON.stringify(configs))}::jsonb)
          WHERE value->>'collection'=selected_collection;
        IF config IS NULL THEN RAISE EXCEPTION 'source_unknown'; END IF;
        v_definition:=config->'source';
        SELECT r.physical_schema,r.build_id,r.manifest_hash INTO stored_release
          FROM yunipals_indexer_control.release r WHERE r.id=${literal(release.id)};
        IF NOT FOUND OR stored_release.physical_schema<>${literal(release.schema)} OR
          stored_release.build_id<>${literal(release.buildId)} OR stored_release.manifest_hash<>${literal(release.manifestHash)}
          THEN RAISE EXCEPTION 'release_mismatch'; END IF;
        SELECT s.chain_id,s.manifest_hash,s.definition::jsonb AS definition INTO source_record
          FROM ${sourceSchema}.indexer_source s WHERE s.id=v_definition->>'id';
        IF NOT FOUND OR source_record.chain_id<>(v_definition->>'chainId')::integer
          OR source_record.manifest_hash<>${literal(release.manifestHash)} OR source_record.definition<>v_definition
          THEN RAISE EXCEPTION 'source_mismatch'; END IF;
        SELECT m.value INTO runtime FROM ${sourceSchema}._ponder_meta m WHERE m.key='app';
        IF runtime IS NULL OR runtime->>'version' IS DISTINCT FROM '6' OR runtime->>'build_id' IS DISTINCT FROM ${literal(release.buildId)}
          OR runtime->>'is_dev' IS DISTINCT FROM '0' OR runtime->>'is_locked' IS DISTINCT FROM '1'
          OR COALESCE(runtime->>'heartbeat_at','')!~'^[0-9]{1,16}$' THEN RAISE EXCEPTION 'runtime_unavailable'; END IF;
        clock_ms:=floor(extract(epoch FROM statement_timestamp())*1000)::bigint;
        IF (runtime->>'heartbeat_at')::bigint>clock_ms OR clock_ms-(runtime->>'heartbeat_at')::bigint>180000
          THEN RAISE EXCEPTION 'observation_stale'; END IF;
        SELECT s.* INTO observation FROM yunipals_indexer_control.chain_status s
          WHERE s.release_id=${literal(release.id)} AND s.chain_id=(v_definition->>'chainId')::integer;
        IF NOT FOUND OR observation.halted OR observation.error_code IS NOT NULL
          OR observation.head_number IS NULL OR observation.observed_at_ms IS NULL
          OR observation.head_hash IS NULL OR observation.head_hash!~'^0x[0-9a-f]{64}$'
          OR observation.observed_at_ms>clock_ms OR clock_ms-observation.observed_at_ms>180000
          THEN RAISE EXCEPTION 'source_unavailable'; END IF;
        IF NOT EXISTS(SELECT 1 FROM ${sourceSchema}.chain_block b WHERE b.chain_id=observation.chain_id
          AND b.block_number=observation.witness_number AND b.block_hash=observation.witness_hash)
          THEN RAISE EXCEPTION 'indexer_witness_unverified'; END IF;
        SELECT c.latest_checkpoint INTO checkpoint FROM ${sourceSchema}._ponder_checkpoint c
          WHERE c.chain_id=observation.chain_id;
        IF checkpoint IS NULL OR checkpoint!~'^[0-9]{75}$' OR checkpoint=repeat('0',75)
          OR substring(checkpoint FROM 11 FOR 16)::bigint<>observation.chain_id
          THEN RAISE EXCEPTION 'checkpoint_unavailable'; END IF;
        indexed:=substring(checkpoint FROM 27 FOR 16)::bigint
          -CASE WHEN substring(checkpoint FROM 43)=repeat('9',33) THEN 0 ELSE 1 END;
        IF EXISTS(SELECT 1 FROM jsonb_each(observation.anchors)
          WHERE COALESCE(value->>'number','')!~'^(0|[1-9][0-9]*)$'
            OR COALESCE(value->>'hash','')!~'^0x[0-9a-f]{64}$') THEN RAISE EXCEPTION 'anchor_invalid'; END IF;
        SELECT max((value->>'number')::bigint) INTO verified FROM jsonb_each(observation.anchors);
        indexed:=least(indexed,verified);
        IF verified IS NULL OR indexed>observation.head_number THEN RAISE EXCEPTION 'observation_inconsistent'; END IF;
        required:=observation.head_number;
        IF config->'policy'->>'kind'='depth' THEN
          required:=required-(config->'policy'->>'subsequentBlocks')::bigint;
        ELSIF config->'policy'->>'kind'='finalized' THEN
          IF observation.finality_error_code IS NOT NULL OR observation.finalized_number IS NULL
            THEN RAISE EXCEPTION 'finality_unavailable'; END IF;
          IF observation.finalized_number>observation.head_number OR observation.finalized_hash IS NULL
            OR (observation.finalized_number=observation.head_number AND observation.finalized_hash<>observation.head_hash)
            THEN RAISE EXCEPTION 'observation_inconsistent'; END IF;
          required:=observation.finalized_number;
        END IF;
        IF v_definition->>'endBlock' IS NOT NULL THEN required:=least(required,(v_definition->>'endBlock')::bigint); END IF;
        available:=least(indexed,verified,required);
        IF available<(v_definition->>'startBlock')::bigint THEN RAISE EXCEPTION 'not_indexed'; END IF;
        boundary:=observation.anchors->available::text;
        IF boundary IS NULL OR boundary->>'number' IS DISTINCT FROM available::text
          OR COALESCE(boundary->>'hash','')!~'^0x[0-9a-f]{64}$'
          OR COALESCE(boundary->>'timestamp','')!~'^(0|[1-9][0-9]*)$'
          THEN RAISE EXCEPTION 'anchor_unavailable'; END IF;
        RETURN QUERY SELECT v_definition->>'id',selected_collection,observation.chain_id,v_definition->>'address',
          available,boundary->>'hash',(boundary->>'timestamp')::bigint,
          to_timestamp(observation.observed_at_ms::numeric/1000),
          (runtime->>'heartbeat_at')::bigint,
          CASE WHEN config->'policy'->>'kind'='latest' THEN runtime->>'is_ready' IS NOT DISTINCT FROM '1'
            ELSE available>=required END,${literal(release.id)},${literal(release.manifestHash)},
          CASE WHEN config->'policy'->>'kind'='depth' THEN 'depth:'||(config->'policy'->>'subsequentBlocks')
            ELSE config->'policy'->>'kind' END;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION USING ERRCODE='YI001',MESSAGE='unified_ownership_source_unavailable',DETAIL=SQLERRM;
      END ${dollar}`);
    await db.query(
      `REVOKE ALL ON FUNCTION ${target}.source_boundary(text) FROM PUBLIC`
    );
    await db.query(`CREATE FUNCTION ${target}.source_probe(selected_collection text) RETURNS jsonb
      LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $probe$
      DECLARE boundary record; reason text;
      BEGIN
        SELECT * INTO boundary FROM ${target}.source_boundary(selected_collection);
        RETURN to_jsonb(boundary)||jsonb_build_object('block_number',boundary.block_number::text,
          'block_timestamp',boundary.block_timestamp::text,'heartbeat_at',boundary.heartbeat_at::text,
          'available',true,'reason',CASE WHEN boundary.ready THEN 'ready' ELSE 'catching_up' END);
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS reason=PG_EXCEPTION_DETAIL;
        RETURN jsonb_build_object('collection',selected_collection,'available',false,'ready',false,
          'reason',CASE WHEN reason~'^[a-z_]{1,80}$' THEN reason ELSE 'source_unavailable' END);
      END $probe$`);
    await db.query(
      `REVOKE ALL ON FUNCTION ${target}.source_probe(text) FROM PUBLIC`
    );
    if (nativeBase)
      await createNativeBaseMetadataViews(
        db,
        release,
        readSchema,
        identity,
        nativeBase
      );
    await db.query(
      `CREATE VIEW ${target}.source_status AS ${configs
        .map(
          (config) =>
            `SELECT s.source_id,${literal(config.collection)}::text AS collection,s.chain_id,s.contract_address,
      s.block_number,s.block_hash,s.block_timestamp,s.observed_at,s.heartbeat_at,s.ready,s.release_id,s.manifest_hash,s.policy
      FROM ${target}.source_boundary(${literal(config.collection)}) s`
        )
        .join(" UNION ALL ")}`
    );
    for (const relation of [
      "token",
      "token_lifecycle",
      "transfer_event",
      "admin_role_event",
      "contract_owner_event"
    ] as const) {
      const queries = configs.map((config) => {
        const ref = ownershipReference(
          release.schema,
          config.source,
          config.collection
        );
        const boundary = { readSchema, collection: config.collection };
        return relation === "token"
          ? ownershipTokenSql(ref, boundary)
          : relation === "token_lifecycle"
            ? ownershipLifecycleSql(ref, boundary)
            : ownershipHistorySql(ref, relation, boundary);
      });
      await db.query(
        `CREATE VIEW ${target}.${relation} AS ${queries.map((query) => `(${query})`).join(" UNION ALL ")}`
      );
    }
    await db.query("COMMIT");
    return {
      schema: readSchema,
      releaseId: release.id,
      identity,
      created: true,
      activated: false
    };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
