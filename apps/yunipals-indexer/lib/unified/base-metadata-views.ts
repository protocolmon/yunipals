import type { PoolClient } from "pg";
import type { SourceDefinition } from "../../../../packages/yunipals-indexer-client/src/sources.js";
import type { RegisteredRelease } from "./releases.js";
import { sqlIdentifier } from "../../../../packages/yunipals-indexer-server/src/database.js";
import { manifestDigest } from "./sources.js";
import { baseMetadataAbi } from "../metadata/base-abi.js";
import { approvedBaseMetadataImplementation } from "../metadata/base-implementation.js";
import { collections } from "../constants.js";
import { nativeBaseTraitsSql } from "../metadata/native-base-traits.js";

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
export function nativeBaseMetadataDefinition(
  release: RegisteredRelease,
  includeBase: boolean
) {
  const source = release.manifest.sources.find(
    (source) => source.id === "metadata:base"
  );
  if (
    !includeBase ||
    !source?.enabled ||
    !source.policies.some((policy) => policy.kind === "latest")
  )
    return null;
  if (
    source.feature !== "base-metadata" ||
    source.chainId !== 8453 ||
    source.address !== collections.base.address ||
    source.startBlock !== String(collections.base.deploymentBlock) ||
    source.endBlock !== null ||
    !source.events.includes("Mint") ||
    !source.events.includes("Update") ||
    source.abiHash !== manifestDigest(baseMetadataAbi)
  )
    throw new Error(
      "Native Base metadata source requires ABI/deployment review."
    );
  return source;
}

/** Compatibility relations over Ponder's canonical journal. The operational
 * approval stores code checks, rather than a second copy of chain events.
 */
export async function createNativeBaseMetadataViews(
  db: PoolClient,
  release: RegisteredRelease,
  readSchema: string,
  identity: string,
  source: SourceDefinition
) {
  const target = sqlIdentifier(readSchema),
    physical = sqlIdentifier(release.schema);
  await db.query(`CREATE FUNCTION ${target}.base_metadata_frame(require_approval boolean DEFAULT true)
    RETURNS TABLE(block_number bigint,block_hash text,frontier text,frontier_event_id text,frontier_event_hash text)
    LANGUAGE plpgsql STABLE SECURITY INVOKER ROWS 1 SET search_path=pg_catalog AS $yunipals_native_base$
    DECLARE boundary record; latest record; approval record;
    BEGIN
      SELECT * INTO boundary FROM ${target}.source_boundary('base');
      IF NOT FOUND OR boundary.policy<>'latest' THEN RAISE EXCEPTION 'base_policy_unavailable'; END IF;
      IF NOT EXISTS(SELECT 1 FROM ${physical}.indexer_source s WHERE s.id='metadata:base' AND s.chain_id=8453
        AND s.manifest_hash=${literal(release.manifestHash)} AND s.definition::jsonb=${literal(JSON.stringify(source))}::jsonb)
        THEN RAISE EXCEPTION 'base_metadata_source_mismatch'; END IF;
      SELECT e.id,e.block_hash INTO latest FROM ${physical}.canonical_event e
        WHERE e.source_id='metadata:base' AND e.chain_id=8453 AND e.address=${literal(collections.base.address)}
          AND e.abi_hash=${literal(source.abiHash)} AND e.block_number>=${source.startBlock!}::bigint
          AND e.block_number<=boundary.block_number
        ORDER BY e.block_number DESC,e.transaction_index DESC,e.log_index DESC LIMIT 1;
      block_number:=boundary.block_number;block_hash:=boundary.block_hash;
      frontier_event_id:=latest.id;frontier_event_hash:=latest.block_hash;
      frontier:=COALESCE(latest.id||':'||latest.block_hash,'none');
      IF require_approval THEN
        SELECT a.* INTO approval FROM metadata_source.native_base_metadata_state a
          JOIN metadata_source.chain_metadata_scan s ON s.name='base_metadata_v1' AND s.ingestion_mode='native'
          WHERE a.release_id=${literal(release.id)};
        IF NOT FOUND OR approval.read_identity IS DISTINCT FROM ${literal(identity)} OR approval.state<>'ready'
          OR approval.frontier IS DISTINCT FROM frontier OR approval.implementation IS DISTINCT FROM ${literal(approvedBaseMetadataImplementation)}
          OR approval.checked_at<statement_timestamp()-interval '90 seconds' OR approval.checked_at>statement_timestamp()
          OR approval.checked_block>boundary.block_number OR NOT EXISTS(SELECT 1 FROM ${physical}.chain_block b
            WHERE b.chain_id=8453 AND b.block_number=approval.checked_block AND b.block_hash=approval.checked_hash)
          THEN RAISE EXCEPTION 'base_metadata_approval_pending'; END IF;
      END IF;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING ERRCODE='YI001',MESSAGE='Native Base metadata unavailable',DETAIL=SQLERRM;
    END $yunipals_native_base$`);
  await db.query(
    `REVOKE ALL ON FUNCTION ${target}.base_metadata_frame(boolean) FROM PUBLIC`
  );
  await db.query(`CREATE FUNCTION ${target}.base_metadata_probe() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $probe$
    BEGIN PERFORM 1 FROM ${target}.base_metadata_frame(true); RETURN FOUND;
    EXCEPTION WHEN OTHERS THEN RETURN false; END $probe$`);
  await db.query(
    `REVOKE ALL ON FUNCTION ${target}.base_metadata_probe() FROM PUBLIC`
  );
  await db.query(`CREATE VIEW ${target}.base_metadata_scan AS
    SELECT 'base_metadata_v1'::text AS name,8453::integer AS chain_id,${literal(collections.base.address)}::text AS contract_address,
      ${source.startBlock!}::bigint AS deployment_block,f.block_number+1 AS next_block,f.block_number AS target_block,
      f.block_hash AS target_hash,f.block_hash AS last_scanned_hash,statement_timestamp() AS updated_at
    FROM ${target}.base_metadata_frame(true) f`);
  await db.query(`CREATE VIEW ${target}.base_metadata_event AS
    SELECT e.chain_id,e.address AS contract_address,e.transaction_hash,e.log_index,e.transaction_index,e.block_number,e.block_hash,
      e.name AS event_name,e.args::jsonb->>'tokenId' AS token_id,lower(e.args::jsonb->>'to') AS recipient,
      ${nativeBaseTraitsSql} AS traits
    FROM ${physical}.canonical_event e CROSS JOIN ${target}.base_metadata_frame(true) f
    WHERE e.source_id='metadata:base' AND e.chain_id=8453 AND e.address=${literal(collections.base.address)}
      AND e.abi_hash=${literal(source.abiHash)} AND e.name IN('Mint','Update')
      AND e.block_number>=${source.startBlock!}::bigint AND e.block_number<=f.block_number`);
}
