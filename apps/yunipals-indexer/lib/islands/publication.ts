import type { Pool } from "pg";
import { islandCollection, ZERO_ADDRESS } from "../constants.js";
import { sqlIdentifier } from "../offchain/sql.js";
import { canonicalJson } from "../metadata/source/canonical.js";
import { metadataRetry } from "../metadata/retry.js";
import {
  islandRevision,
  islandsRendererVersion,
  type IslandJob,
  type IslandObservation
} from "./metadata.js";

export function islandMintQuery(schemaName: string) {
  const schema = sqlIdentifier(schemaName);
  return `SELECT t.token_id FROM ${schema}.token t
    JOIN ${schema}.token_lifecycle l ON l.collection=t.collection
      AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
      AND l.mint_block=t.mint_block AND l.mint_timestamp=t.mint_timestamp
    JOIN ${schema}.transfer_event e ON e.collection=l.collection AND e.token_id=l.token_id
      AND e.lifecycle=l.lifecycle AND e.transaction_hash=l.mint_transaction_hash
      AND e.block_number=l.mint_block AND e."from"='${ZERO_ADDRESS}'
      AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address AND e."to"=l.minted_to
    WHERE t.collection=$1 AND t.token_id=$2 AND t.lifecycle=$3
      AND l.mint_transaction_hash=$4 AND e.log_index=$5
      AND t.chain_id=${islandCollection.chainId} AND t.contract_address='${islandCollection.address}'
      AND NOT t.burned AND t.mint_block<=$6::numeric
    FOR SHARE OF t,l,e`;
}

export async function publishIslandMetadata(
  pool: Pick<Pool, "connect">,
  schemaName: string,
  job: IslandJob,
  observation: IslandObservation,
  raw: unknown,
  auditSeconds = 3_600
) {
  if (!Number.isInteger(auditSeconds) || auditSeconds < 60)
    throw new Error("invalid_island_audit_interval");
  const revision = islandRevision(job, observation, raw);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const canonical = await client.query(islandMintQuery(schemaName), [
      islandCollection.slug,
      job.tokenId,
      job.lifecycle,
      job.mintTransactionHash,
      job.mintLogIndex,
      observation.blockNumber.toString()
    ]);
    if (canonical.rows.length !== 1) {
      await client.query("ROLLBACK");
      return "obsolete";
    }
    await client.query(
      `INSERT INTO metadata_source.source_blob(content_hash,payload)
      VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING`,
      [revision.sourceHash, canonicalJson(raw)]
    );
    await client.query(
      `INSERT INTO metadata_source.island_revision
      (revision_hash,collection,token_id,lifecycle,mint_transaction_hash,mint_log_index,
       token_uri,source_hash,renderer_version,document_hash,document,uri_block,uri_block_hash,
       metadata_storage,genesis_limit)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
      ON CONFLICT DO NOTHING`,
      [
        revision.revisionHash,
        islandCollection.slug,
        job.tokenId,
        job.lifecycle,
        job.mintTransactionHash,
        job.mintLogIndex,
        revision.uri,
        revision.sourceHash,
        islandsRendererVersion,
        revision.documentHash,
        canonicalJson(revision.document),
        observation.blockNumber.toString(),
        observation.blockHash,
        observation.metadataStorage,
        observation.genesisLimit.toString()
      ]
    );
    await client.query(
      `INSERT INTO metadata.island_publication
      (collection,token_id,lifecycle,mint_transaction_hash,mint_log_index,revision_hash,status,
       uri_checked_at,uri_checked_block,next_attempt_at)
      VALUES($1,$2,$3,$4,$5,$6,'published',now(),$7,now()+$8*interval '1 second')
      ON CONFLICT(collection,token_id,lifecycle) DO UPDATE SET
        mint_transaction_hash=EXCLUDED.mint_transaction_hash,mint_log_index=EXCLUDED.mint_log_index,
        revision_hash=EXCLUDED.revision_hash,status='published',attempts=0,last_error=NULL,
        uri_checked_at=now(),uri_checked_block=EXCLUDED.uri_checked_block,
        next_attempt_at=EXCLUDED.next_attempt_at,updated_at=now()
      WHERE metadata.island_publication.uri_checked_block IS NULL
        OR metadata.island_publication.uri_checked_block<=EXCLUDED.uri_checked_block
        OR metadata.island_publication.mint_transaction_hash<>EXCLUDED.mint_transaction_hash
        OR metadata.island_publication.mint_log_index<>EXCLUDED.mint_log_index`,
      [
        islandCollection.slug,
        job.tokenId,
        job.lifecycle,
        job.mintTransactionHash,
        job.mintLogIndex,
        revision.revisionHash,
        observation.blockNumber.toString(),
        auditSeconds
      ]
    );
    await client.query("COMMIT");
    return "published";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function retryIslandMetadata(
  pool: Pick<Pool, "connect">,
  schemaName: string,
  job: IslandJob,
  block: bigint,
  error: unknown
) {
  const retry = metadataRetry(error, job.attempts + 1, null);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const canonical = await client.query(islandMintQuery(schemaName), [
      islandCollection.slug,
      job.tokenId,
      job.lifecycle,
      job.mintTransactionHash,
      job.mintLogIndex,
      block.toString()
    ]);
    if (canonical.rows.length !== 1) {
      await client.query("ROLLBACK");
      return "obsolete";
    }
    await client.query(
      `INSERT INTO metadata.island_publication
    (collection,token_id,lifecycle,mint_transaction_hash,mint_log_index,status,attempts,last_error,next_attempt_at)
    VALUES($1,$2,$3,$4,$5,'retry',1,$6,now()+$7*interval '1 second')
    ON CONFLICT(collection,token_id,lifecycle) DO UPDATE SET status='retry',
      revision_hash=CASE WHEN metadata.island_publication.mint_transaction_hash=EXCLUDED.mint_transaction_hash
        AND metadata.island_publication.mint_log_index=EXCLUDED.mint_log_index THEN metadata.island_publication.revision_hash END,
      uri_checked_block=CASE WHEN metadata.island_publication.mint_transaction_hash=EXCLUDED.mint_transaction_hash
        AND metadata.island_publication.mint_log_index=EXCLUDED.mint_log_index THEN metadata.island_publication.uri_checked_block END,
      attempts=CASE WHEN metadata.island_publication.mint_transaction_hash=EXCLUDED.mint_transaction_hash
        AND metadata.island_publication.mint_log_index=EXCLUDED.mint_log_index THEN metadata.island_publication.attempts+1 ELSE 1 END,
      mint_transaction_hash=EXCLUDED.mint_transaction_hash,mint_log_index=EXCLUDED.mint_log_index,
      last_error=EXCLUDED.last_error,next_attempt_at=EXCLUDED.next_attempt_at,updated_at=now()`,
      [
        islandCollection.slug,
        job.tokenId,
        job.lifecycle,
        job.mintTransactionHash,
        job.mintLogIndex,
        retry.lastError,
        retry.delaySeconds
      ]
    );
    await client.query("COMMIT");
    return "retry";
  } catch (failure) {
    await client.query("ROLLBACK");
    throw failure;
  } finally {
    client.release();
  }
}

export async function dueIslandJobs(
  pool: Pick<Pool, "query">,
  schemaName: string,
  block: bigint,
  limit = 100
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000)
    throw new Error("invalid_island_batch_size");
  const schema = sqlIdentifier(schemaName);
  const rows = await pool.query<IslandJob>(
    `SELECT t.token_id AS "tokenId",t.lifecycle,
    l.mint_transaction_hash AS "mintTransactionHash",e.log_index AS "mintLogIndex",
    CASE WHEN p.mint_transaction_hash=l.mint_transaction_hash AND p.mint_log_index=e.log_index
      THEN COALESCE(p.attempts,0) ELSE 0 END AS attempts
    FROM ${schema}.token t JOIN ${schema}.token_lifecycle l
      ON l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
      AND l.mint_block=t.mint_block AND l.mint_timestamp=t.mint_timestamp
    JOIN ${schema}.transfer_event e ON e.collection=l.collection AND e.token_id=l.token_id
      AND e.lifecycle=l.lifecycle AND e.transaction_hash=l.mint_transaction_hash
      AND e.block_number=l.mint_block AND e."from"=$2
      AND e.chain_id=t.chain_id AND e.contract_address=t.contract_address AND e."to"=l.minted_to
    LEFT JOIN metadata.island_publication p ON p.collection=t.collection
      AND p.token_id=t.token_id::numeric AND p.lifecycle=t.lifecycle
    WHERE t.collection=$1 AND NOT t.burned AND t.mint_block<=$3::numeric
      AND (p.token_id IS NULL OR p.next_attempt_at<=now()
        OR p.mint_transaction_hash<>l.mint_transaction_hash OR p.mint_log_index<>e.log_index)
    ORDER BY COALESCE(p.next_attempt_at,'epoch'::timestamptz),t.token_id::numeric LIMIT $4`,
    [islandCollection.slug, ZERO_ADDRESS, block.toString(), limit]
  );
  return rows.rows;
}
