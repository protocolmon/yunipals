import type { PoolClient } from 'pg';
import { calculateRarity } from '../rarity/calculate.js';
import { storeRarityCalculations } from '../rarity/store.js';
import type { CollectionSlug } from '../constants.js';
import type { MetadataDocument,MetadataVariant } from './publication.js';

export type PublicationValue={release:string;collection:CollectionSlug;tokenId:string;lifecycle:number;assetKey:string|null;
  rendererVersion:string;inputHash:string|null;contentHash:string|null;variant:MetadataVariant;document:MetadataDocument|null;
  status:'published'|'unavailable'|'reconciliation_required';reason:string|null;uri:string|null;mintTransactionHash:string;mintLogIndex:number;chainEventKey:string|null};

/** Caller holds an active-release lock and canonical/recovery fence in this transaction. */
export async function storePublicationValues(client:PoolClient,values:PublicationValue[]){
  if(!values.length)return;
  const rows=JSON.stringify(values),record=`x(release text,collection text,"tokenId" text,lifecycle integer,"assetKey" text,
    "rendererVersion" text,"inputHash" text,"contentHash" text,variant text,document jsonb,status text,reason text,uri text,
    "mintTransactionHash" text,"mintLogIndex" integer,"chainEventKey" text)`;
  await client.query(`INSERT INTO metadata_source.render_revision(release_id,asset_key,variant,renderer_version,input_hash,content_hash,document)
    SELECT DISTINCT ON(release,"assetKey",variant,"rendererVersion","inputHash") release,"assetKey",variant,"rendererVersion","inputHash","contentHash",document
    FROM jsonb_to_recordset($1::jsonb) AS ${record} WHERE status='published' ON CONFLICT DO NOTHING`,[rows]);
  const conflict=await client.query(`SELECT 1 FROM jsonb_to_recordset($1::jsonb) AS ${record}
    JOIN metadata_source.render_revision r ON r.release_id=x.release AND r.asset_key=x."assetKey" AND r.variant=x.variant
      AND r.renderer_version=x."rendererVersion" AND r.input_hash=x."inputHash"
    WHERE x.status='published' AND r.content_hash<>x."contentHash" LIMIT 1`,[rows]);
  if(conflict.rowCount)throw new Error('render_revision_conflict');
  await client.query(`INSERT INTO metadata.token_metadata(collection,token_id,lifecycle,token_uri,uri_provenance,fetch_status,name,description,image,animation_url,attributes,document,content_hash)
    SELECT collection,"tokenId"::numeric,lifecycle,coalesce(uri,'archive:'||release||':unavailable'),'archived_binding','not_requested',
      document->>'name',document->>'description',document->>'image',document->>'animation_url',coalesce(document->'attributes','[]'::jsonb),document,"contentHash"
    FROM jsonb_to_recordset($1::jsonb) AS ${record}
    ON CONFLICT(collection,token_id,lifecycle) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,image=EXCLUDED.image,
      animation_url=EXCLUDED.animation_url,attributes=EXCLUDED.attributes,document=EXCLUDED.document,content_hash=EXCLUDED.content_hash,updated_at=now()`,[rows]);
  await client.query(`INSERT INTO metadata.token_publication(collection,token_id,lifecycle,release_id,asset_key,renderer_version,input_hash,publication_content_hash,
    publication_status,publication_error,mint_transaction_hash,mint_log_index,chain_event_key)
    SELECT collection,"tokenId"::numeric,lifecycle,release,"assetKey","rendererVersion","inputHash","contentHash",status,reason,"mintTransactionHash","mintLogIndex","chainEventKey"
    FROM jsonb_to_recordset($1::jsonb) AS ${record}
    ON CONFLICT(collection,token_id,lifecycle) DO UPDATE SET release_id=EXCLUDED.release_id,asset_key=EXCLUDED.asset_key,renderer_version=EXCLUDED.renderer_version,
      input_hash=EXCLUDED.input_hash,publication_content_hash=EXCLUDED.publication_content_hash,publication_status=EXCLUDED.publication_status,
      publication_error=EXCLUDED.publication_error,published_at=now(),mint_transaction_hash=EXCLUDED.mint_transaction_hash,mint_log_index=EXCLUDED.mint_log_index,chain_event_key=EXCLUDED.chain_event_key`,[rows]);
  await storeRarityCalculations(client,values.map(value=>({collection:value.collection,tokenId:value.tokenId,lifecycle:value.lifecycle,
    metadataContentHash:value.contentHash,...calculateRarity(value.tokenId,value.document??{})})));
}
