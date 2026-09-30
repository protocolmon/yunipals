import type { Pool } from 'pg';
import { collectionSlugs,type CollectionSlug } from '../constants.js';
import { MetadataUnavailable } from './publication.js';

/** Explicit recovery fence. Ordinary indexing continues to expose its existing checkpoint/status. */
export async function chainReadiness(pool:Pick<Pool,'query'>,chains:readonly CollectionSlug[]=collectionSlugs){
  const rows=(await pool.query(`SELECT collection,state,checkpoint_block::text,reason,updated_at,verified_at
    FROM metadata.chain_readiness WHERE collection=ANY($1::text[])`,[chains])).rows;
  const byCollection=new Map(rows.map(row=>[row.collection,row]));
  const blocked=chains.filter(collection=>{
    const row=byCollection.get(collection);
    return !row||row.state!=='ready'||row.checkpoint_block===null||row.verified_at===null;
  });
  return {ready:blocked.length===0,blocked,collections:rows};
}
export async function assertChainReady(pool:Pick<Pool,'query'>,chains:readonly CollectionSlug[]){
  if(!(await chainReadiness(pool,chains)).ready)throw new MetadataUnavailable('ownership_rebuilding','retry');
}
