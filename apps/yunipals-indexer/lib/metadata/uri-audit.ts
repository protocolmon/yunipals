import type { Pool } from "pg";
import { sqlIdentifier } from "../offchain/sql.js";
import { ArchiveReader } from "./source/read.js";
import { metadataLookupId } from "./source/bindings.js";
import { selectedRelease } from "./resolve.js";
import type { UriResolver } from "./publish.js";
import { metadataError } from "./publication.js";
import { chainReadiness } from "./chain-readiness.js";

/** URI observations are evidence, never instructions to fetch metadata over HTTP. */
export async function auditArchiveUris(pool: Pool, readSchema: string, resolveUri: UriResolver, limit = 128) {
  if(!Number.isInteger(limit)||limit<1||limit>512)throw new Error('Invalid URI audit limit');
  const release=await selectedRelease(pool),schema=sqlIdentifier(readSchema);
  const rows=(await pool.query(`SELECT m.collection,m.token_id::text,m.lifecycle,p.asset_key,m.token_uri
    FROM metadata.token_metadata m JOIN metadata.token_publication p USING(collection,token_id,lifecycle)
    JOIN ${schema}.token t ON t.collection=m.collection AND t.token_id=m.token_id::text AND t.lifecycle=m.lifecycle
    WHERE p.release_id=$1 AND p.asset_key IS NOT NULL AND NOT t.burned
      AND NOT EXISTS(SELECT 1 FROM metadata.chain_readiness recovery WHERE recovery.collection=m.collection AND recovery.state<>'ready')
      AND (m.uri_checked_at IS NULL OR m.uri_checked_at<now()-interval '7 days')
    ORDER BY m.uri_checked_at NULLS FIRST,m.collection,m.token_id LIMIT $2`,[release,limit])).rows;
  async function audit(row: typeof rows[number]){
    let uri:string;
    try{uri=await resolveUri(row.collection,row.token_id);}catch{return;}
    let verified=false;
    let lookupId:string|undefined;
    try{lookupId=metadataLookupId(uri);}catch{/* An unsupported URI requires reconciliation, never HTTP retrieval. */}
    if(lookupId)try{verified=(await new ArchiveReader(pool,release).lookup(lookupId)).assetKey===row.asset_key;}
    catch(error){if(metadataError(error).status==='retry')throw error;}
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtext('metadata:chain-recovery'))");
      if(!(await chainReadiness(client,[row.collection])).ready){await client.query('ROLLBACK');return;}
      if(!(await client.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1 AND state='active' FOR SHARE",[release])).rowCount){await client.query('ROLLBACK');return;}
      if(verified){
        await client.query(`UPDATE metadata.publication_job SET status='pending',reason=NULL,next_attempt_at=now(),updated_at=now()
          WHERE collection=$1 AND token_id=$2 AND lifecycle=$3 AND release_id=$4 AND reason='token_uri_changed'`,[row.collection,row.token_id,row.lifecycle,release]);
        await client.query(`UPDATE metadata.token_metadata SET token_uri=$4,uri_provenance='current_token_uri_call',uri_checked_at=now(),audit_status='onchain_resolved'
          WHERE collection=$1 AND token_id=$2 AND lifecycle=$3`,[row.collection,row.token_id,row.lifecycle,uri]);
      }else{
        // Fence already claimed jobs before invalidating the visible projection.
        await client.query(`UPDATE metadata.publication_job SET status='reconciliation_required',reason='token_uri_changed',lease_token=NULL,lease_until=NULL,updated_at=now()
          WHERE collection=$1 AND token_id=$2 AND lifecycle=$3 AND release_id=$4`,[row.collection,row.token_id,row.lifecycle,release]);
        await client.query(`UPDATE metadata.token_publication SET publication_status='reconciliation_required',publication_error='token_uri_changed'
          WHERE collection=$1 AND token_id=$2 AND lifecycle=$3 AND release_id=$4`,[row.collection,row.token_id,row.lifecycle,release]);
        await client.query(`UPDATE metadata.token_metadata SET attributes='[]',document=NULL,name=NULL,description=NULL,image=NULL,animation_url=NULL,
          content_hash=NULL,uri_checked_at=now(),audit_status='uri_reconciliation_required' WHERE collection=$1 AND token_id=$2 AND lifecycle=$3`,[row.collection,row.token_id,row.lifecycle]);
      }
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  for(let offset=0;offset<rows.length;offset+=8){
    const results=await Promise.allSettled(rows.slice(offset,offset+8).map(audit));
    const failed=results.find(result=>result.status==='rejected');
    if(failed?.status==='rejected')throw failed.reason;
  }
  return rows.length;
}
