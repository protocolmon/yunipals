import { storePublicationValues } from "./publication-store.js";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { collections, collectionSlugs, ZERO_ADDRESS, type CollectionSlug } from "../constants.js";
import { sqlIdentifier } from "../offchain/sql.js";
import { rendererVersion } from "./render/snapshot.js";
import { ArchiveReader } from "./source/read.js";
import { ArchiveOwnershipReader, metadataLookupId, storeRuntimeBindings } from "./source/bindings.js";
import { contentHash } from "./source/canonical.js";
import { MetadataUnavailable, metadataError } from "./publication.js";
import { LocalMetadataReader, selectedRelease } from "./resolve.js";
import { chainReadiness,assertChainReady } from "./chain-readiness.js";

export type PublicationJob = { id: string; releaseId: string; collection: CollectionSlug; tokenId: string; lifecycle: number;
  mintTransactionHash: string; mintLogIndex: number; requestKey: string; leaseToken: string; attempts: number };

export async function enqueuePublications(pool: Pool, readSchema: string, batchSize = 500) {
  const schema = sqlIdentifier(readSchema), release = await selectedRelease(pool);
  let enqueued = 0;
  for (const collection of collectionSlugs) {
    if(!(await chainReadiness(pool,[collection])).ready)continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO metadata.publication_cursor(release_id,collection) VALUES($1,$2) ON CONFLICT DO NOTHING", [release,collection]);
      const cursor = (await client.query("SELECT token_id FROM metadata.publication_cursor WHERE release_id=$1 AND collection=$2 AND next_scan_at<=now() FOR UPDATE SKIP LOCKED", [release,collection])).rows[0];
      if (!cursor) { await client.query("COMMIT"); continue; }
      const rows = (await client.query(`WITH batch AS MATERIALIZED(SELECT token_id,lifecycle FROM ${schema}.token
        WHERE collection=$2 AND token_id>$3 ORDER BY token_id LIMIT $4)
        SELECT t.token_id,t.lifecycle,mint.transaction_hash,mint.log_index,b.asset_key,b.input_hash,
          event.transaction_hash AS event_transaction,event.log_index AS event_log
        FROM batch t LEFT JOIN LATERAL(SELECT mint_transaction_hash,mint_block FROM ${schema}.token_lifecycle
          WHERE collection=$2 AND token_id=t.token_id AND lifecycle=t.lifecycle OFFSET 0) l ON true
        LEFT JOIN LATERAL(SELECT transaction_hash,log_index FROM ${schema}.transfer_event
          WHERE collection=$2 AND token_id=t.token_id AND lifecycle=t.lifecycle AND transaction_hash=l.mint_transaction_hash
          AND block_number=l.mint_block AND "from"=$5 ORDER BY log_index LIMIT 2) mint ON true
        LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id=$6
          AND b.contract_address=$7 AND b.token_id=t.token_id AND b.mint_transaction_hash=mint.transaction_hash AND b.mint_log_index=mint.log_index
        LEFT JOIN LATERAL(SELECT transaction_hash,log_index FROM metadata_source.chain_metadata_event
          WHERE $2='base' AND chain_id=8453 AND contract_address=$7 AND token_id=t.token_id
          ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1) event ON true
        ORDER BY t.token_id`, [release,collection,cursor.token_id,batchSize,ZERO_ADDRESS,String(collections[collection].chainId),collections[collection].address])).rows;
      const unique = new Set<string>();
      const jobs = rows.flatMap(row => {
        if (!row.transaction_hash) return [];
        if (unique.has(row.token_id)) throw new Error("ambiguous_mint_anchor");
        unique.add(row.token_id);
        return [{ tokenId:row.token_id,lifecycle:row.lifecycle,mintTransactionHash:row.transaction_hash,mintLogIndex:row.log_index,
          requestKey:contentHash([rendererVersion,row.asset_key??null,row.input_hash??null,row.event_transaction??null,row.event_log??null]) }];
      });
      const inserted = await client.query(`INSERT INTO metadata.publication_job(release_id,collection,token_id,lifecycle,mint_transaction_hash,mint_log_index,request_key)
        SELECT $1,$2,"tokenId"::numeric,lifecycle,"mintTransactionHash","mintLogIndex","requestKey"
        FROM jsonb_to_recordset($3::jsonb) AS x("tokenId" text,lifecycle integer,"mintTransactionHash" text,"mintLogIndex" integer,"requestKey" text)
        ON CONFLICT(release_id,collection,token_id,mint_transaction_hash,mint_log_index) DO UPDATE SET
          request_key=EXCLUDED.request_key,lifecycle=EXCLUDED.lifecycle,status='pending',lease_token=NULL,lease_until=NULL,next_attempt_at=now(),updated_at=now()
        WHERE metadata.publication_job.reason IS DISTINCT FROM 'token_uri_changed'
          AND (metadata.publication_job.request_key<>EXCLUDED.request_key OR metadata.publication_job.lifecycle<>EXCLUDED.lifecycle)`, [release,collection,JSON.stringify(jobs)]);
      enqueued += inserted.rowCount ?? 0;
      await client.query(`UPDATE metadata.publication_cursor SET token_id=$3,next_scan_at=CASE WHEN $3='' THEN now()+interval '60 seconds' ELSE now() END,updated_at=now()
        WHERE release_id=$1 AND collection=$2`, [release,collection,rows.at(-1)?.token_id ?? ""]);
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  return enqueued;
}

export async function claimPublications(pool: Pool, limit = 8, leaseSeconds = 120): Promise<PublicationJob[]> {
  if (!Number.isSafeInteger(limit) || limit<1 || limit>100 || !Number.isSafeInteger(leaseSeconds) || leaseSeconds<1) throw new Error("Invalid publication claim limits");
  const active=(await pool.query("SELECT release_id FROM metadata_source.archive_release WHERE state='active'")).rows[0]?.release_id;
  if (!active) return [];
  const lease = randomUUID();
  const claim=async (take:number,expired:boolean):Promise<PublicationJob[]> => (await pool.query(`WITH claimed AS(SELECT j.id FROM metadata.publication_job j
    WHERE j.release_id=$4 AND ${expired ? "j.status='publishing' AND j.lease_until<now()" : "j.status IN ('pending','retry') AND j.next_attempt_at<=now()"}
      AND EXISTS(SELECT 1 FROM metadata_source.archive_release r WHERE r.release_id=$4 AND r.state='active')
    ORDER BY ${expired ? 'j.lease_until' : 'j.next_attempt_at'},j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
    UPDATE metadata.publication_job j SET status='publishing',attempts=attempts+1,lease_token=$2,lease_until=now()+$3*interval '1 second',updated_at=now()
    FROM claimed c WHERE j.id=c.id RETURNING j.id::text,j.release_id AS "releaseId",j.collection,j.token_id::text AS "tokenId",j.lifecycle,
      j.mint_transaction_hash AS "mintTransactionHash",j.mint_log_index AS "mintLogIndex",j.request_key AS "requestKey",j.lease_token AS "leaseToken",j.attempts`, [take,lease,leaseSeconds,active])).rows;
  const pending=await claim(limit,false);
  return pending.length===limit?pending:[...pending,...await claim(limit-pending.length,true)];
}

export type UriResolver = (collection: CollectionSlug, tokenId: string) => Promise<string>;
export async function bindRuntimeToken(pool: Pool, schema: string, job: PublicationJob, uriResolver: UriResolver) {
  const owner = await new ArchiveOwnershipReader(pool,job.releaseId,schema).token(job.collection,job.tokenId);
  if (!owner || owner.mintTransactionHash!==job.mintTransactionHash || owner.mintLogIndex!==job.mintLogIndex) throw new MetadataUnavailable("obsolete_lifecycle");
  if (owner.assetKey) return;
  let uri: string, provenance = "current_token_uri_call";
  try { uri = await uriResolver(job.collection,job.tokenId); }
  catch {
    if (!owner.burned) throw new MetadataUnavailable("token_uri_pending","retry");
    uri=`https://meta.polkamon.com/meta?id=${job.tokenId}`; provenance="historical_formula_fallback";
  }
  let id: string;
  try { id=metadataLookupId(uri); } catch { throw new MetadataUnavailable("unsupported_token_uri","reconciliation_required"); }
  const source = await new ArchiveReader(pool,job.releaseId).lookup(id);
  const fields = (await pool.query(`SELECT legacy_id,family FROM metadata_source.source_record
    WHERE release_id=$1 AND asset_key=$2 AND content_hash=$3 LIMIT 1`,[job.releaseId,source.assetKey,source.hash])).rows[0];
  await storeRuntimeBindings(pool,job.releaseId,[{collection:job.collection,chainId:collections[job.collection].chainId,
    contractAddress:collections[job.collection].address,tokenId:job.tokenId,lifecycle:owner.lifecycle,burned:owner.burned,
    tokenUri:uri,uriProvenance:provenance,documentId:null,documentName:null,mintTransactionHash:job.mintTransactionHash,
    mintLogIndex:job.mintLogIndex,assetKey:source.assetKey,sourceHash:source.hash,sourceLegacyId:fields.legacy_id,family:fields.family}]);
}

export async function publishJob(pool: Pool, readSchema: string, job: PublicationJob, uriResolver?: UriResolver) {
  const reader = new LocalMetadataReader(pool,readSchema,{releaseId:job.releaseId});
  let result: Awaited<ReturnType<LocalMetadataReader["token"]>> = null;
  let failure: MetadataUnavailable | undefined;
  try {
    if (uriResolver) await bindRuntimeToken(pool,readSchema,job,uriResolver);
    result = await reader.token(job.collection,job.tokenId);
    if (!result?.metadata) failure = new MetadataUnavailable(result?.reason??"token_missing", result?.status === "retry" ? "retry" : result?.status === "reconciliation_required" ? "reconciliation_required" : "unavailable");
  } catch(error) { failure=metadataError(error); }
  const client=await pool.connect(), schema=sqlIdentifier(readSchema);
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('metadata:chain-recovery'))");
    await assertChainReady(client,[job.collection]);
    // Release changes and claim replacement are serialized with this commit.
    const active=await client.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1 AND state='active' FOR SHARE",[job.releaseId]);
    const claim=await client.query(`SELECT 1 FROM metadata.publication_job WHERE id=$1 AND lease_token=$2 AND request_key=$3
      AND status='publishing' AND lease_until>now() FOR UPDATE`,[job.id,job.leaseToken,job.requestKey]);
    if (!claim.rowCount) { await client.query("ROLLBACK"); return "claim_lost"; }
    const canonical=await client.query(`SELECT t.lifecycle FROM ${schema}.token t JOIN ${schema}.token_lifecycle l
      ON l.collection=t.collection AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
      JOIN ${schema}.transfer_event e ON e.collection=l.collection AND e.token_id=l.token_id AND e.lifecycle=l.lifecycle
        AND e.transaction_hash=l.mint_transaction_hash AND e.block_number=l.mint_block
      WHERE t.collection=$1 AND t.token_id=$2 AND e.transaction_hash=$3 AND e.log_index=$4 AND e."from"=$5 AND t.lifecycle=$6`,
      [job.collection,job.tokenId,job.mintTransactionHash,job.mintLogIndex,ZERO_ADDRESS,job.lifecycle]);
    if (!active.rowCount || canonical.rowCount!==1) {
      await client.query("UPDATE metadata.publication_job SET status='obsolete',reason='release_or_lifecycle_changed',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1",[job.id]);
      await client.query("COMMIT");return "obsolete";
    }
    if (failure?.status === "retry") {
      await client.query(`UPDATE metadata.publication_job SET status='retry',reason=$2,lease_token=NULL,lease_until=NULL,
        next_attempt_at=now()+$3*interval '1 second',updated_at=now() WHERE id=$1`,[job.id,failure.reason,Math.min(3600,5*2**Math.min(job.attempts,10))]);
      await client.query("COMMIT");return "retry";
    }
    const snapshot=result?.metadata, document=failure?null:snapshot!.document;
    const observedUri=(await client.query(`SELECT evidence->>'uri' AS uri FROM metadata_source.asset_binding WHERE release_id=$1 AND network='eip155'
      AND chain_id=$2 AND contract_address=$3 AND token_id=$4`,[job.releaseId,String(collections[job.collection].chainId),collections[job.collection].address,job.tokenId])).rows[0]?.uri;
    await storePublicationValues(client,[{release:job.releaseId,collection:job.collection,tokenId:job.tokenId,lifecycle:job.lifecycle,
      assetKey:result?.ownership.assetKey??null,rendererVersion:snapshot?.rendererVersion??rendererVersion,inputHash:snapshot?.inputHash??null,
      contentHash:document?snapshot!.contentHash:null,variant:snapshot?.variant??'public',document:document??null,status:failure?.status??'published',
      reason:failure?.reason??null,uri:observedUri??null,mintTransactionHash:job.mintTransactionHash,mintLogIndex:job.mintLogIndex,chainEventKey:result?.chain?.eventKey??null}]);
    await client.query(`UPDATE metadata.publication_job SET status=$2,reason=$3,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,
      [job.id,failure?.status??"published",failure?.reason??null]);
    await client.query("COMMIT");return failure?.status??"published";
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
}
