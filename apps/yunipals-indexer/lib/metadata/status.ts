import type { Pool } from "pg";
import { metadataSourceMode } from "./publication.js";
import { rendererVersion } from "./render/snapshot.js";
import { chainReadiness } from "./chain-readiness.js";
export async function metadataReadiness(pool: Pool) {
  if (metadataSourceMode() !== "archive") return { ready:true, mode:"legacy-http" };
  if (!(await pool.query(`SELECT bool_and(to_regclass(name) IS NOT NULL) AS installed FROM unnest(ARRAY[
    'metadata.publication_job','metadata.token_publication','metadata.publication_runtime','metadata.projection_revision',
    'metadata.derived_snapshot','metadata.chain_readiness','metadata_source.render_revision','metadata_source.lifecycle_binding','metadata_source.chain_metadata_scan']) name`)).rows[0].installed) return {ready:false,mode:"archive",reason:"publication_schema_pending"};
  const release=(await pool.query("SELECT release_id FROM metadata_source.archive_release WHERE state='active'")).rows[0];
  if(!release)return {ready:false,mode:"archive",reason:"archive_unavailable"};
  const ownership=await chainReadiness(pool);
  if(!ownership.ready)return {ready:false,mode:'archive',reason:'ownership_rebuilding',ownership};
  return {ready:true,mode:"archive",releaseId:release.release_id};
}
let cached: {at:number;value:unknown}|undefined;
export async function publicationStatus(pool: Pool) {
  if(metadataSourceMode()!=="archive")return {mode:"legacy-http"};
  if(cached&&Date.now()-cached.at<15000)return cached.value;
  const [readiness,queue,runtime,base]=await Promise.all([
    metadataReadiness(pool),
    pool.query(`SELECT j.release_id,j.collection,j.status,j.reason,count(*)::text AS count,min(j.updated_at) AS oldest
      FROM metadata.publication_job j JOIN metadata_source.archive_release r USING(release_id)
      WHERE r.state='active' GROUP BY j.release_id,j.collection,j.status,j.reason`),
    pool.query("SELECT last_worker_at,base_error,base_checked_at FROM metadata.publication_runtime WHERE singleton"),
    pool.query("SELECT next_block::text,target_block::text,updated_at FROM metadata_source.chain_metadata_scan WHERE name='base_metadata_v1'")
  ]);
  const value={...readiness,rendererVersion,queue:queue.rows,runtime:runtime.rows[0]??null,base:base.rows[0]??null};cached={at:Date.now(),value};return value;
}
