import type { PoolClient } from "pg";

import { collections, collectionSlugs } from "../constants.js";
import {
  ownershipReadConfig,
  physicalPonderSchema,
  physicalPonderSchemaName,
  ponderSchema,
  sqlIdentifier
} from "../offchain/sql.js";
import { nativeBaseMetadataReads } from "./base-mode.js";
import { metadataScanReadRelation } from "./read-source.js";

const metadataName = "yunipals_projection_metadata_input";
const tokensName = "yunipals_projection_token_input";
const anchorsName = "yunipals_projection_anchor_input";
const temporary = (name: string) => `pg_temp.${sqlIdentifier(name)}`;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const hash = /^0x[0-9a-f]{64}$/;
const decimal = (value: unknown): value is string =>
  typeof value === "string" &&
  /^(0|[1-9][0-9]{0,18})$/.test(value) &&
  BigInt(value) <= 9223372036854775807n;

export type ProjectionAnchor = {
  collection: string;
  chain_id: number;
  block_number: string;
  block_hash: string;
};

/** Persisted with the candidate, so recovery cannot publish without its capture. */
export type ProjectionSourceSnapshot = {
  version: 1;
  capturedAt: string;
  releaseId: string;
  manifestHash: string;
  readIdentity: string;
  physicalSchema: string;
  metadataReleaseId: string;
  predecessor: string | null;
  baseMetadataFrontier: string;
  anchors: ProjectionAnchor[];
};

export type ProjectionInputSnapshot = {
  metadataRelation: string;
  tokenRelation: string;
  proof: ProjectionSourceSnapshot;
};

export function nativeProjectionSnapshotEnabled() {
  return ownershipReadConfig.mode === "unified" && nativeBaseMetadataReads();
}

export function projectionSourceSnapshot(
  value: unknown
): ProjectionSourceSnapshot {
  if (!value || typeof value !== "object")
    throw new Error("projection_source_snapshot_missing");
  const proof = value as Partial<ProjectionSourceSnapshot>;
  if (
    proof.version !== 1 ||
    typeof proof.capturedAt !== "string" ||
    !Number.isFinite(Date.parse(proof.capturedAt)) ||
    !hash.test(proof.releaseId ?? "") ||
    !hash.test(proof.manifestHash ?? "") ||
    !hash.test(proof.readIdentity ?? "") ||
    proof.releaseId !== ownershipReadConfig.releaseId ||
    proof.physicalSchema !== physicalPonderSchemaName ||
    typeof proof.metadataReleaseId !== "string" ||
    proof.metadataReleaseId.length === 0 ||
    (proof.predecessor !== null &&
      (!decimal(proof.predecessor) || proof.predecessor === "0")) ||
    typeof proof.baseMetadataFrontier !== "string" ||
    !proof.baseMetadataFrontier ||
    !Array.isArray(proof.anchors) ||
    proof.anchors.length !== collectionSlugs.length ||
    new Set(proof.anchors.map((anchor) => anchor.collection)).size !==
      collectionSlugs.length ||
    proof.anchors.some(
      (anchor) =>
        !collectionSlugs.includes(
          anchor.collection as (typeof collectionSlugs)[number]
        ) ||
        anchor.chain_id !==
          collections[anchor.collection as keyof typeof collections]?.chainId ||
        !decimal(anchor.block_number) ||
        !hash.test(anchor.block_hash)
    )
  )
    throw new Error("projection_source_snapshot_invalid");
  return proof as ProjectionSourceSnapshot;
}

/** The first data statement in the build RR transaction. All guarded reads in
 * this DO see the same statement timestamp and MVCC snapshot. Later build
 * statements use these private inputs without extending any public TTL. */
export function projectionInputCaptureSql() {
  if (ownershipReadConfig.mode !== "unified")
    throw new Error("Unified projection capture requires a registered release");
  const names = [metadataName, tokensName, anchorsName];
  const collisions = names
    .map((name) => `to_regclass(${literal(`pg_temp.${name}`)}) IS NOT NULL`)
    .join(" OR ");
  const chains = collectionSlugs.map(literal).join(",");
  return `DO $yunipals_projection_inputs$
  DECLARE selected record; boundary record; candidate record; frame record; grant_row record;
    archive_id text; predecessor_id bigint;
  BEGIN
    IF ${collisions} THEN RAISE EXCEPTION 'projection_input_namespace_in_use'; END IF;
    SELECT v.identity,v.release_id,v.manifest_hash,r.physical_schema INTO selected
      FROM ${ponderSchema}._unified_read_release v JOIN yunipals_indexer_control.release r ON r.id=v.release_id
      WHERE v.singleton AND v.manifest_hash=r.manifest_hash;
    IF NOT FOUND OR selected.release_id IS DISTINCT FROM ${literal(ownershipReadConfig.releaseId)}
      OR selected.physical_schema IS DISTINCT FROM ${literal(physicalPonderSchemaName)}
      OR selected.identity!~'^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'projection_input_identity_unavailable'; END IF;
    SELECT release_id INTO STRICT archive_id FROM metadata_source.archive_release WHERE state='active';
    SELECT current_id INTO STRICT predecessor_id FROM metadata_projection.active WHERE singleton;
    CREATE TEMP TABLE ${anchorsName}(collection text PRIMARY KEY,chain_id integer,block_number bigint,
      block_hash text,release_id text,manifest_hash text,read_identity text,captured_at timestamptz,
      metadata_release_id text,predecessor bigint,metadata_frontier text) ON COMMIT DROP;
    FOR candidate IN SELECT unnest(ARRAY[${chains}]::text[])AS collection LOOP
      SELECT * INTO boundary FROM ${ponderSchema}.source_boundary(candidate.collection);
      IF NOT FOUND OR NOT boundary.ready OR boundary.release_id IS DISTINCT FROM selected.release_id
        OR boundary.manifest_hash IS DISTINCT FROM selected.manifest_hash THEN RAISE EXCEPTION 'projection_input_source_unavailable'; END IF;
      IF NOT EXISTS(SELECT 1 FROM metadata.chain_readiness c WHERE c.collection=candidate.collection
        AND c.state='ready' AND c.checkpoint_block IS NOT NULL AND c.verified_at IS NOT NULL)
        THEN RAISE EXCEPTION 'projection_input_chain_unavailable'; END IF;
      IF NOT EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block b WHERE b.chain_id=boundary.chain_id
        AND b.block_number=boundary.block_number AND b.block_hash=boundary.block_hash)
        THEN RAISE EXCEPTION 'projection_input_anchor_unavailable'; END IF;
      INSERT INTO ${temporary(anchorsName)} VALUES(candidate.collection,boundary.chain_id,boundary.block_number,
        boundary.block_hash,selected.release_id,selected.manifest_hash,selected.identity,statement_timestamp(),archive_id,predecessor_id,NULL);
    END LOOP;
    SELECT * INTO STRICT frame FROM ${ponderSchema}.base_metadata_frame(true);
    IF NOT EXISTS(SELECT 1 FROM ${temporary(anchorsName)} a WHERE a.collection='base'
      AND a.block_number=frame.block_number AND a.block_hash=frame.block_hash)
      THEN RAISE EXCEPTION 'projection_input_metadata_boundary_changed'; END IF;
    UPDATE ${temporary(anchorsName)} SET metadata_frontier=frame.frontier WHERE collection='base';
    CREATE TEMP TABLE ${metadataName} ON COMMIT DROP AS SELECT
      m.collection,m.token_id,m.lifecycle,m.document,m.attributes,m.content_hash FROM ${metadataScanReadRelation} m;
    CREATE TEMP TABLE ${tokensName} ON COMMIT DROP AS
      SELECT collection,token_id,lifecycle,burned,owner FROM ${ponderSchema}.token WHERE collection=ANY(ARRAY[${chains}]::text[]);
    FOR grant_row IN SELECT c.oid::regclass AS relation,a.grantee FROM pg_class c
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner)))a
      WHERE c.oid=ANY(ARRAY[${names.map((name) => `${literal(`pg_temp.${name}`)}::regclass`).join(",")}])
        AND a.grantee<>c.relowner LOOP
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM %s',grant_row.relation,
        CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END);
    END LOOP;
    CREATE INDEX ON ${temporary(metadataName)}(collection,token_id,lifecycle);
    CREATE INDEX ON ${temporary(tokensName)}(collection,token_id,lifecycle);
    ANALYZE ${temporary(metadataName)};
    ANALYZE ${temporary(tokensName)};
  END $yunipals_projection_inputs$`;
}

export async function captureProjectionInputs(
  client: PoolClient
): Promise<ProjectionInputSnapshot | null> {
  if (!nativeProjectionSnapshotEnabled()) return null;
  await client.query(projectionInputCaptureSql());
  const row = (
    await client.query<{ proof: unknown }>(`SELECT jsonb_build_object(
    'version',1,'capturedAt',min(captured_at),'releaseId',min(release_id),'manifestHash',min(manifest_hash),
    'readIdentity',min(read_identity),'physicalSchema',${literal(physicalPonderSchemaName)},
    'metadataReleaseId',min(metadata_release_id),'predecessor',min(predecessor)::text,
    'baseMetadataFrontier',max(metadata_frontier),
    'anchors',jsonb_agg(jsonb_build_object('collection',collection,'chain_id',chain_id,
      'block_number',block_number::text,'block_hash',block_hash) ORDER BY collection))AS proof
    FROM ${temporary(anchorsName)}`)
  ).rows[0]!;
  return {
    metadataRelation: temporary(metadataName),
    tokenRelation: temporary(tokensName),
    proof: projectionSourceSnapshot(row.proof)
  };
}

/** Part of the pointer UPDATE itself: every observation is from that one fresh
 * statement snapshot. No native lock or write privilege is needed. A later
 * reorg remains subject to the ordinary public read/cache canonical guards. */
export function projectionPublicationSourcePredicate(parameter: string) {
  if (!/^\$[1-9][0-9]*$/.test(parameter))
    throw new Error("Invalid snapshot parameter");
  const proof = `${parameter}::jsonb`;
  return `EXISTS(SELECT 1 FROM ${ponderSchema}._unified_read_release v
    JOIN yunipals_indexer_control.release r ON r.id=v.release_id
    WHERE v.singleton AND v.release_id=${proof}->>'releaseId' AND v.identity=${proof}->>'readIdentity'
      AND v.manifest_hash=${proof}->>'manifestHash' AND r.manifest_hash=v.manifest_hash
      AND r.physical_schema=${proof}->>'physicalSchema')
    AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(${proof}->'anchors')
      AS a(collection text,chain_id integer,block_number bigint,block_hash text)
      LEFT JOIN LATERAL ${ponderSchema}.source_boundary(a.collection) b ON true
      WHERE b.ready IS DISTINCT FROM true OR b.chain_id IS DISTINCT FROM a.chain_id
        OR b.release_id IS DISTINCT FROM (${proof}->>'releaseId')
        OR b.manifest_hash IS DISTINCT FROM (${proof}->>'manifestHash')
        OR b.block_number<a.block_number OR NOT EXISTS(SELECT 1 FROM ${physicalPonderSchema}.chain_block canonical
          WHERE canonical.chain_id=a.chain_id AND canonical.block_number=a.block_number AND canonical.block_hash=a.block_hash)
        OR NOT EXISTS(SELECT 1 FROM metadata.chain_readiness c WHERE c.collection=a.collection
          AND c.state='ready' AND c.checkpoint_block IS NOT NULL AND c.verified_at IS NOT NULL))
    AND EXISTS(SELECT 1 FROM ${ponderSchema}.base_metadata_frame(true) f
      JOIN jsonb_to_recordset(${proof}->'anchors')AS a(collection text,block_number bigint,block_hash text)
        ON a.collection='base' AND f.block_number>=a.block_number
      WHERE f.frontier=${proof}->>'baseMetadataFrontier')`;
}

/** Retain rollback predecessors explicitly; this option never changes identity
 * or publication. Without it ordinary cleanup keeps its prior behavior. */
export function preservedProjectionGenerations(
  value = process.env.PROJECTION_PRESERVE_GENERATION_IDS
): string[] {
  if (value === undefined || value === "") return [];
  const ids = value.split(",");
  if (
    ids.length > 8 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !decimal(id) || id === "0")
  )
    throw new Error("Invalid retained projection generation IDs");
  return ids;
}
