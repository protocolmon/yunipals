import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { argumentsOf,postgresFrom,writeReport,safeFailure } from './metadata/support.js';
import { assertRecoveryDatabase } from './metadata/recovery.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { collectionSlugs,collections,ZERO_ADDRESS } from '../lib/constants.js';
import { ArchiveReader } from '../lib/metadata/source/read.js';
import { immutableMetadata,validateMetadata,metadataError } from '../lib/metadata/publication.js';
import { contentHash } from '../lib/metadata/source/canonical.js';
import { rendererVersion } from '../lib/metadata/render/snapshot.js';
import { storePublicationValues,type PublicationValue } from '../lib/metadata/publication-store.js';
import { assertChainReady } from '../lib/metadata/chain-readiness.js';

const args=argumentsOf({release:{type:'string'},resume:{type:'boolean',default:false},limit:{type:'string',default:'0'},'batch-size':{type:'string',default:'1000'},
  report:{type:'string',default:'docs/metadata-migration/step-4-publication.json'}});
const {pool,env}=await postgresFrom(String(args['env-file'])),client=await pool.connect();
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
const fetchOriginal=globalThis.fetch;let forbiddenRequests=0;globalThis.fetch=async()=>{forbiddenRequests++;throw new Error('Recovery metadata HTTP forbidden');};
try{
  const database=await assertRecoveryDatabase(pool),release=String(args.release??''),batchSize=Number(args['batch-size']);
  assert.ok(Number.isInteger(batchSize)&&batchSize>0&&batchSize<=5000);await assertChainReady(pool,collectionSlugs);
  await client.query("SELECT pg_advisory_lock_shared(hashtext('metadata:chain-recovery'))");await client.query('SET statement_timeout=0');
  const reader=new ArchiveReader(pool,release),start=performance.now();
  let report:any={format:'metadata-recovery-publication-v1',database,release,rendererVersion,collections:{},elapsedSeconds:0,complete:false,forbiddenRequests:0};
  if(args.resume){report=JSON.parse(await readFile(String(args.report),'utf8'));assert.equal(report.database,database);assert.equal(report.release,release);assert.equal(report.rendererVersion,rendererVersion);}
  else{
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA recovery_http_evidence');
    for(const table of ['token_publication','publication_job','publication_cursor']){
      await client.query(`CREATE TABLE recovery_http_evidence.${table} AS SELECT * FROM metadata.${table}`);
      await client.query(`TRUNCATE metadata.${table}`);
    }
    await client.query('CREATE INDEX recovery_previous_job_anchor_idx ON recovery_http_evidence.publication_job(release_id,collection,token_id,mint_transaction_hash,mint_log_index)');
    await client.query('CREATE INDEX recovery_previous_publication_anchor_idx ON recovery_http_evidence.token_publication(release_id,collection,token_id,mint_transaction_hash,mint_log_index)');
    await client.query('ALTER TABLE metadata.token_metadata SET SCHEMA recovery_http_evidence');
    await client.query('CREATE TABLE metadata.token_metadata(LIKE recovery_http_evidence.token_metadata INCLUDING ALL)');
    await client.query(await readFile(new URL('../test/fixtures/metadata/market-catalog-triggers.sql',import.meta.url),'utf8'));
    // In bulk recovery the real trigger queues changed identities; the catalog is built before serving.
    await client.query("UPDATE metadata_source.archive_release SET state='active',activated_at=now() WHERE release_id=$1 AND state IN ('candidate','validated')",[release]);
    await client.query('COMMIT');await writeReport(String(args.report),report);
  }
  const elapsed=report.elapsedSeconds;let invocation=0;
  for(const collection of collectionSlugs){
    const progress=report.collections[collection]??={cursor:'',scanned:0,counts:{},complete:false};if(progress.complete)continue;
    const schema=sqlIdentifier(collection==='bnb'?(env.BNB_DATABASE_SCHEMA??'recovery_bnb'):env.DATABASE_SCHEMA);
    while(!stopping){
      await client.query('BEGIN');
      assert.equal((await client.query("SELECT 1 FROM metadata_source.archive_release WHERE release_id=$1 AND state='active' FOR SHARE",[release])).rowCount,1);
      await client.query(`LOCK TABLE ${schema}.token,${schema}.token_lifecycle,${schema}.transfer_event IN SHARE MODE`);
      const rows=(await client.query(`WITH batch AS MATERIALIZED(SELECT token_id,lifecycle FROM ${schema}.token WHERE collection=$2 AND token_id>$3 ORDER BY token_id LIMIT $7)
        SELECT t.token_id,t.lifecycle,mint.transaction_hash AS mint_transaction,mint.log_index AS mint_log,b.asset_key AS bound_asset,b.input_hash AS binding_hash,
          ab.evidence->>'uri' AS uri,(previous.reason='token_uri_changed' OR previous_publication.publication_error='token_uri_changed') AS uri_quarantined,
          s.asset_key AS "assetKey",s.content_hash AS hash,s.source_burned AS burned,s.imported_at AS "importedAt",s.issue,blob.payload,
          base_mint.traits AS mint_traits,base_latest.traits AS latest_traits,base_latest.transaction_hash AS latest_transaction,base_latest.log_index AS latest_log
        FROM batch t JOIN ${schema}.token_lifecycle l ON l.collection=$2 AND l.token_id=t.token_id AND l.lifecycle=t.lifecycle
        JOIN ${schema}.transfer_event mint ON mint.collection=$2 AND mint.token_id=t.token_id AND mint.lifecycle=t.lifecycle
          AND mint.transaction_hash=l.mint_transaction_hash AND mint.block_number=l.mint_block AND mint."from"=$4
        LEFT JOIN metadata_source.lifecycle_binding b ON b.release_id=$1 AND b.chain_id=$5 AND b.contract_address=$6 AND b.token_id=t.token_id
          AND b.mint_transaction_hash=mint.transaction_hash AND b.mint_log_index=mint.log_index
        LEFT JOIN metadata_source.asset_binding ab ON ab.release_id=b.release_id AND ab.network='eip155' AND ab.chain_id=b.chain_id AND ab.contract_address=b.contract_address AND ab.token_id=b.token_id
        LEFT JOIN recovery_http_evidence.publication_job previous ON previous.release_id=$1 AND previous.collection=$2 AND previous.token_id=t.token_id::numeric
          AND previous.mint_transaction_hash=mint.transaction_hash AND previous.mint_log_index=mint.log_index
        LEFT JOIN recovery_http_evidence.token_publication previous_publication ON previous_publication.release_id=$1 AND previous_publication.collection=$2
          AND previous_publication.token_id=t.token_id::numeric AND previous_publication.mint_transaction_hash=mint.transaction_hash AND previous_publication.mint_log_index=mint.log_index
        LEFT JOIN LATERAL(SELECT * FROM metadata_source.source_record WHERE release_id=$1 AND asset_key=b.asset_key ORDER BY source_burned,source_key LIMIT 1) s ON true
        LEFT JOIN metadata_source.source_blob blob ON blob.content_hash=s.content_hash
        LEFT JOIN metadata_source.chain_metadata_scan scan ON $2='base' AND scan.name='base_metadata_v1'
        LEFT JOIN LATERAL(SELECT block_number,transaction_index,log_index,traits FROM metadata_source.chain_metadata_event WHERE $2='base'
          AND chain_id=8453 AND contract_address=$6 AND token_id=t.token_id AND event_name='Mint' AND transaction_hash=mint.transaction_hash
          AND block_number<scan.next_block ORDER BY log_index DESC LIMIT 1) base_mint ON true
        LEFT JOIN LATERAL(SELECT transaction_hash,log_index,traits FROM metadata_source.chain_metadata_event WHERE $2='base'
          AND chain_id=8453 AND contract_address=$6 AND token_id=t.token_id AND block_number<scan.next_block
          AND (block_number,transaction_index,log_index)>=(base_mint.block_number,base_mint.transaction_index,base_mint.log_index)
          ORDER BY block_number DESC,transaction_index DESC,log_index DESC LIMIT 1) base_latest ON true
        ORDER BY t.token_id`,[release,collection,progress.cursor,ZERO_ADDRESS,String(collections[collection].chainId),collections[collection].address,batchSize])).rows;
      if(!rows.length){await client.query('COMMIT');progress.complete=true;break;}
      assert.equal(new Set(rows.map(row=>row.token_id)).size,rows.length,'Ambiguous canonical mint');
      const values:PublicationValue[]=[],jobs:any[]=[];
      for(const row of rows){
        let snapshot:any=null,status:PublicationValue['status']='published',reason:string|null=null;
        if(row.uri_quarantined){status='reconciliation_required';reason='token_uri_changed';}
        else if(!row.bound_asset){status='unavailable';reason='binding_unavailable';}
        else if(collection==='base'&&(!row.mint_traits||!row.latest_traits))throw new Error('Base metadata events incomplete');
        else if(collection==='base'&&contentHash(row.mint_traits)!==contentHash(row.latest_traits)){status='reconciliation_required';reason='base_tuple_requires_mapping';}
        else try{snapshot=await reader.renderSource(row,true);validateMetadata(snapshot.document);}catch(error){const unavailable=metadataError(error);if(unavailable.status==='retry')throw error;status=unavailable.status;reason=unavailable.reason;}
        const document=snapshot?immutableMetadata(snapshot.document):null;
        values.push({release,collection,tokenId:row.token_id,lifecycle:row.lifecycle,assetKey:row.bound_asset??null,rendererVersion,inputHash:snapshot?.inputHash??null,
          contentHash:document?contentHash(document):null,variant:'public',document,status,reason,uri:row.uri??null,mintTransactionHash:row.mint_transaction,mintLogIndex:row.mint_log,
          chainEventKey:row.latest_transaction?`${row.latest_transaction}:${row.latest_log}`:null});
        jobs.push({tokenId:row.token_id,lifecycle:row.lifecycle,mintTransactionHash:row.mint_transaction,mintLogIndex:row.mint_log,status,reason,
          requestKey:contentHash([rendererVersion,row.bound_asset??null,row.binding_hash??null,row.latest_transaction??null,row.latest_log??null])});
      }
      await storePublicationValues(client,values);
      await client.query(`INSERT INTO metadata.publication_job(release_id,collection,token_id,lifecycle,mint_transaction_hash,mint_log_index,request_key,status,reason,attempts)
        SELECT $1,$2,"tokenId"::numeric,lifecycle,"mintTransactionHash","mintLogIndex","requestKey",status,reason,1 FROM jsonb_to_recordset($3::jsonb)
          AS x("tokenId" text,lifecycle integer,"mintTransactionHash" text,"mintLogIndex" integer,"requestKey" text,status text,reason text)
        ON CONFLICT(release_id,collection,token_id,mint_transaction_hash,mint_log_index) DO UPDATE SET request_key=EXCLUDED.request_key,status=EXCLUDED.status,
          reason=EXCLUDED.reason,lifecycle=EXCLUDED.lifecycle,lease_token=NULL,lease_until=NULL,updated_at=now()`,[release,collection,JSON.stringify(jobs)]);
      await client.query('COMMIT');
      for(const value of values){const key=value.reason??value.status;progress.counts[key]=(progress.counts[key]??0)+1;}
      progress.cursor=rows.at(-1).token_id;progress.scanned+=rows.length;invocation+=rows.length;
      report.elapsedSeconds=elapsed+(performance.now()-start)/1000;report.forbiddenRequests+=forbiddenRequests;forbiddenRequests=0;report.updatedAt=new Date().toISOString();
      report.peakRss=Math.max(report.peakRss??0,process.memoryUsage().rss);await writeReport(String(args.report),report);
      if(invocation%10000===0)console.log(JSON.stringify({collection,scanned:progress.scanned,counts:progress.counts,tokensPerSecond:Math.round(invocation/((performance.now()-start)/1000))}));
      if(Number(args.limit)>0&&invocation>=Number(args.limit)){stopping=true;break;}
    }
    if(stopping)break;
  }
  report.complete=collectionSlugs.every(collection=>report.collections[collection]?.complete);await writeReport(String(args.report),report);console.log(JSON.stringify({complete:report.complete}));
}catch(error){await client.query('ROLLBACK');console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}
finally{globalThis.fetch=fetchOriginal;await client.query("SELECT pg_advisory_unlock_shared(hashtext('metadata:chain-recovery'))").catch(()=>{});client.release();await pool.end();}
