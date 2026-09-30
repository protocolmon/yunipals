import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { migrations } from "../lib/offchain/migrations.js";
import { ensureCandidate, beginSource, commitSourceBatch } from "../lib/metadata/source/archive.js";
import { sourceIdentity } from "../lib/metadata/source/identity.js";
import { contentHash } from "../lib/metadata/source/canonical.js";
import { storeBindings } from "../lib/metadata/source/bindings.js";
import { storeRuntimeBindings } from "../lib/metadata/source/bindings.js";
import { commitBaseMetadataRange, type BaseMetadataEvent } from "../lib/metadata/source/base-events.js";
import { LocalMetadataReader } from "../lib/metadata/resolve.js";
import { enqueuePublications, claimPublications, publishJob } from "../lib/metadata/publish.js";
import { canonicalPublicationSql, metadataReadRelation, metadataScanReadRelation } from "../lib/metadata/read-source.js";
import { publicationAvailableSql } from "../lib/metadata/publication.js";
import { legacyMetadataRouter } from "../lib/api/legacy-metadata.js";
import { auditArchiveUris } from "../lib/metadata/uri-audit.js";
import { collections, ZERO_ADDRESS } from "../lib/constants.js";
import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";
import { assertRecoveryRuntimeEnvironment } from "./metadata/recovery.js";

const args=argumentsOf({reset:{type:"boolean",default:false},output:{type:"string",default:"docs/metadata-migration/publisher-integration.json"}});
const {pool,env}=await postgresFrom(String(args['env-file']));
const passed:string[]=[];
let publicationBenchmark:Record<string,unknown>|undefined;
const hash=(c:string)=>`0x${c.repeat(64)}`,owner=`0x${'a'.repeat(40)}`,recipient=`0x${'b'.repeat(40)}`;
const release='publisher-test-v1';
try {
  assertRecoveryRuntimeEnvironment(env);
  assert.match((await pool.query("SELECT current_database() AS name")).rows[0].name,/^metadata_archive_test_[a-z0-9_]+$/);
  if(args.reset)await pool.query("DROP SCHEMA IF EXISTS metadata,metadata_source,leaderboard,binding_check,bnb_indexer CASCADE");
  for(const sql of migrations)await pool.query(sql);
  await pool.query(`CREATE SCHEMA binding_check;
    CREATE TABLE binding_check.token(collection text,chain_id integer,contract_address text,token_id text,owner text,burned boolean,lifecycle integer,last_transfer_block bigint,last_transfer_timestamp bigint,last_transaction_hash text,PRIMARY KEY(collection,token_id));
    CREATE TABLE binding_check.token_lifecycle(collection text,token_id text,lifecycle integer,mint_transaction_hash text,mint_block bigint,PRIMARY KEY(collection,token_id,lifecycle));
    CREATE TABLE binding_check.transfer_event(collection text,token_id text,lifecycle integer,transaction_hash text,block_number bigint,transaction_index integer,"from" text,"to" text,log_index integer,id text GENERATED ALWAYS AS (transaction_hash||':'||log_index::text) STORED,PRIMARY KEY(collection,transaction_hash,log_index));
    CREATE SCHEMA bnb_indexer;CREATE VIEW bnb_indexer.token AS SELECT * FROM binding_check.token WHERE collection='bnb';
    CREATE TABLE bnb_indexer.sync_state(singleton boolean,next_block bigint,last_scanned_block bigint,caught_up_at timestamptz,last_error text,updated_at timestamptz);`);
  await pool.query("ALTER TABLE binding_check.token ADD COLUMN mint_block bigint DEFAULT 100, ADD COLUMN mint_timestamp bigint DEFAULT 1700000000");
  await pool.query(await readFile(new URL('../test/fixtures/metadata/market-catalog-triggers.sql',import.meta.url),'utf8'));
  await pool.query("UPDATE metadata.market_catalog_trait_state SET ready=true,ready_at=now() WHERE singleton");
  const fixture=JSON.parse(await readFile(new URL('../test/fixtures/metadata/gen1_booster.json',import.meta.url),'utf8'));
  const identity=sourceIdentity(fixture.envelope),tokenId=identity.legacyId!;
  await ensureCandidate(pool,release,{});await beginSource(pool,release,'test.source',{},'one');
  await commitSourceBatch(pool,release,'test.source',null,'one',[{key:'one',payload:fixture.envelope,...identity,burned:false}],true);
  await pool.query(`INSERT INTO binding_check.token VALUES('ethereum',1,$1,$2,$3,false,1,100,1700000000,$4)`,[collections.ethereum.address,tokenId,owner,hash('1')]);
  await pool.query(`INSERT INTO binding_check.token_lifecycle VALUES('ethereum',$1,1,$2,100)`,[tokenId,hash('1')]);
  await pool.query(`INSERT INTO binding_check.transfer_event VALUES('ethereum',$1,1,$2,100,0,$3,$4,2)`,[tokenId,hash('1'),ZERO_ADDRESS,owner]);
  await storeBindings(pool,release,[{collection:'ethereum',chainId:1,contractAddress:collections.ethereum.address,tokenId,lifecycle:1,burned:false,
    tokenUri:`https://meta.polkamon.com/meta?id=${tokenId}`,uriProvenance:'current_token_uri_call',documentId:tokenId,documentName:fixture.envelope.nft.name,
    mintTransactionHash:hash('1'),mintLogIndex:2,assetKey:identity.assetKey!,sourceHash:contentHash(fixture.envelope),sourceLegacyId:tokenId,family:identity.family!}]);
  const reader=new LocalMetadataReader(pool,'binding_check'),api=legacyMetadataRouter(reader);
  assert.equal((await api.request(`/meta?id=${tokenId}`)).status,503);assert.equal((await claimPublications(pool)).length,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata.token_metadata")).rows[0].n,0);
  passed.push('candidate isolation');
  await pool.query("UPDATE metadata_source.archive_release SET state='active' WHERE release_id=$1",[release]);
  await pool.query(`INSERT INTO metadata.chain_readiness(collection,state,checkpoint_block,verified_at)
    SELECT unnest($1::text[]),'ready',100,now()`,[['ethereum','base','polygon','bnb']]);
  // All actual runtime reads below run with HTTP disabled; no fallback can hide a missing input.
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Forbidden runtime HTTP dependency');};
  try {
    assert.equal(await enqueuePublications(pool,'binding_check'),1);
    const [a,b]=await Promise.all([claimPublications(pool,1),claimPublications(pool,1)]);const job=a[0]??b[0];assert.ok(job);assert.equal(a.length+b.length,1);
    assert.equal(await publishJob(pool,'binding_check',job),'published');
    assert.equal(await publishJob(pool,'binding_check',job),'claim_lost');
    let metadata=(await pool.query("SELECT * FROM metadata.token_metadata JOIN metadata.token_publication USING(collection,token_id,lifecycle)")).rows[0];
    assert.equal(metadata.fetch_status,'not_requested');assert.equal(metadata.fetched_at,null);assert.equal(metadata.publication_status,'published');
    assert.equal(metadata.document.address,undefined);assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata.metadata_revision")).rows[0].n,0);
    const traitCount=(await pool.query("SELECT count(*)::int AS n FROM metadata.market_catalog_trait")).rows[0].n;assert.ok(traitCount>0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata_source.render_revision")).rows[0].n,1);
    assert.ok((await pool.query("SELECT 1 FROM metadata.token_rarity")).rowCount);
    const response=await api.request(`/meta?id=${tokenId}`);assert.equal(response.status,200);assert.equal((await response.json()).address,owner);
    passed.push('concurrent claims; atomic revision/rarity/catalog publication; no HTTP revisions or requests; idempotent completion');
    if(process.env.METADATA_SOURCE_MODE==='archive'){
      const {refreshTraitIndex,refreshLeaderboard}=await import('../lib/leaderboard/refresh.js');
      await refreshTraitIndex();await refreshLeaderboard();
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata.token_search WHERE metadata_available")).rows[0].n,1);
      assert.equal((await pool.query("SELECT metadata_release_id FROM metadata.derived_snapshot WHERE name='traits'")).rows[0].metadata_release_id,release);
      assert.equal((await pool.query("SELECT metadata_release_id FROM metadata.derived_snapshot WHERE name='leaderboard'")).rows[0].metadata_release_id,release);
      const rarity=(await pool.query('SELECT status,rarity_points_capped FROM metadata.token_rarity')).rows[0];assert.equal(rarity.status,'valid');
      const attributes=metadata.document.attributes as {trait_type:string;value:unknown}[];
      const uniqueTypes=Number(attributes.some(a=>a.trait_type==='Type'&&a.value!=null));
      const special=Number(attributes.some(a=>a.trait_type==='Special'&&a.value==='Yes'));
      const glitter=Number(attributes.some(a=>a.trait_type==='Glitter'&&a.value!=null&&a.value!=='None'));
      const stats=(await pool.query("SELECT * FROM leaderboard.wallet_stats WHERE scope='all' AND owner=$1",[owner])).rows[0];
      assert.equal(stats.monster_count,1);assert.equal(Number(stats.total_rarity),Number(rarity.rarity_points_capped));
      assert.equal(stats.unique_types,uniqueTypes);assert.equal(stats.special_count,special);assert.equal(stats.glitter_count,glitter);
      const expectedScore=1000*Math.log(1+Number(rarity.rarity_points_capped))+50+500*uniqueTypes+750*special+250*glitter;
      assert.ok(Math.abs(Number(stats.collector_score)-expectedScore)<=0.0001);
      const {app:nativeApi}=await import('../lib/api/server.js');
      const preflight=await nativeApi.request('/legacy-meta/meta?id=1',{method:'OPTIONS',headers:{Origin:'https://client.example','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'If-None-Match'}});
      assert.ok(preflight.headers.get('access-control-allow-headers')?.includes('If-None-Match'));
      for(const path of ['/ready','/v1/tokens?chain=ethereum&limit=2','/v1/tokens?chain=ethereum&metadata=available&sort=rarity-desc',
        `/v1/tokens/ethereum/${tokenId}`,'/v1/traits?chain=ethereum','/v1/status',`/legacy-meta/meta?id=${tokenId}`]){
        const response=await nativeApi.request(path);assert.equal(response.status,200,`${path}: ${await response.text()}`);
      }
      await pool.query("UPDATE metadata.chain_readiness SET state='rebuilding',reason='test' WHERE collection='ethereum'");
      for(const path of ['/ready','/v1/tokens?chain=ethereum',`/v1/tokens/ethereum/${tokenId}/visibility/signing-data?hidden=true`,`/legacy-meta/meta?id=${tokenId}`])
        assert.equal((await nativeApi.request(path)).status,503,path);
      assert.equal((await nativeApi.request('/v1/tokens?chain=base')).status,200);
      assert.equal((await nativeApi.request('/v1/indexing-status')).status,200);
      await assert.rejects(()=>reader.token('ethereum',tokenId),{reason:'ownership_rebuilding'});
      assert.ok((await reader.asset(release,identity.assetKey!)).document);
      await assert.rejects(()=>refreshTraitIndex(),{reason:'ownership_rebuilding'});
      await assert.rejects(()=>refreshLeaderboard(),{reason:'ownership_rebuilding'});
      await pool.query("UPDATE metadata.chain_readiness SET state='ready',reason=NULL,verified_at=now() WHERE collection='ethereum'");
      assert.equal((await nativeApi.request('/ready')).status,200);
      passed.push('rebuilding fences ownership and visibility, keeps other chains readable, blocks stale derived refresh, preserves immutable archive reads');
      const runtime=await import('../lib/offchain/db.js');await runtime.pool.end();await runtime.apiPool.end();
      passed.push('actual trait/facet/rarity/leaderboard refresh from a consistent archive snapshot');
    }
    await pool.query("UPDATE binding_check.token SET owner=$1,last_transfer_block=101,last_transfer_timestamp=1700000100",[recipient]);
    assert.equal((await(await api.request(`/meta?id=${tokenId}`)).json()).address,recipient);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata_source.render_revision")).rows[0].n,1);
    await pool.query("UPDATE binding_check.token SET burned=true,owner=$1",[ZERO_ADDRESS]);
    assert.deepEqual(await(await api.request(`/meta?id=${tokenId}`)).json(),{message:'NFT is burned'});
    assert.equal((await reader.token('ethereum',tokenId))!.ownership.owner,null);
    passed.push('transfer owner overlay; burn compatibility; immutable trait revision');
    await pool.query(`UPDATE binding_check.token SET burned=false,owner=$1,lifecycle=2,last_transfer_block=103`,[owner]);
    await pool.query(`
      INSERT INTO binding_check.token_lifecycle VALUES('ethereum','${tokenId}',2,'${hash('2')}',103);
      INSERT INTO binding_check.transfer_event VALUES('ethereum','${tokenId}',2,'${hash('2')}',103,0,'${ZERO_ADDRESS}','${owner}',7)`);
    await pool.query("UPDATE metadata.publication_cursor SET token_id='',next_scan_at=now()");
    await enqueuePublications(pool,'binding_check');const remint=(await claimPublications(pool,1))[0];assert.ok(remint);
    assert.equal(await publishJob(pool,'binding_check',remint,async()=>`https://meta.polkamon.com/meta?id=${tokenId}`),'published');
    assert.equal((await reader.token('ethereum',tokenId))!.ownership.lifecycle,2);
    passed.push('active-release verified runtime binding for remint');
    await auditArchiveUris(pool,'binding_check',async()=>`https://unexpected.example/meta?id=${tokenId}`);
    assert.equal((await reader.token('ethereum',tokenId))!.reason,'token_uri_changed');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata.market_catalog_trait WHERE lifecycle=2")).rows[0].n,0);
    await pool.query("UPDATE metadata.token_metadata SET uri_checked_at=NULL");
    await auditArchiveUris(pool,'binding_check',async()=>`https://meta.polkamon.com/meta?id=${tokenId}`);
    const recoveredUri=(await claimPublications(pool,1))[0];assert.ok(recoveredUri);
    assert.equal(await publishJob(pool,'binding_check',recoveredUri),'published');
    passed.push('URI changes fence jobs and public reads; verified URI recovery republishes locally');
    // Expired claim must not overwrite the replacement claim's result.
    await pool.query("UPDATE metadata.publication_job SET status='pending',next_attempt_at=now() WHERE id=$1",[remint.id]);
    const old=(await claimPublications(pool,1,1))[0];await pool.query("UPDATE metadata.publication_job SET lease_until=now()-interval '1 second' WHERE id=$1",[old.id]);
    const fresh=(await claimPublications(pool,1))[0];assert.notEqual(old.leaseToken,fresh.leaseToken);
    assert.equal(await publishJob(pool,'binding_check',old),'claim_lost');assert.equal(await publishJob(pool,'binding_check',fresh),'published');
    passed.push('expired lease recovery and stale-claim fencing');
    // Actual marketplace trigger failure rolls back both metadata and job completion.
    await pool.query("UPDATE metadata.publication_job SET status='pending',next_attempt_at=now() WHERE id=$1",[remint.id]);
    const failing=(await claimPublications(pool,1))[0];
    await pool.query(`CREATE FUNCTION metadata.reject_test_publication() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'test rollback';END$$;
      CREATE TRIGGER reject_test_publication BEFORE UPDATE ON metadata.token_metadata FOR EACH ROW EXECUTE FUNCTION metadata.reject_test_publication()`);
    await assert.rejects(publishJob(pool,'binding_check',failing),/test rollback/);
    assert.equal((await pool.query('SELECT status FROM metadata.publication_job WHERE id=$1',[failing.id])).rows[0].status,'publishing');
    await pool.query('DROP TRIGGER reject_test_publication ON metadata.token_metadata');
    assert.equal(await publishJob(pool,'binding_check',failing),'published');
    passed.push('projection trigger failure rolls back transaction and remains recoverable');
    // Full-count query optimizations must still hide stale or invalid documents.
    const readCheck=await pool.connect();
    try{
      const visibleCount=async()=>{
        const point=Number((await readCheck.query(`SELECT count(*) AS n FROM ${metadataReadRelation} m WHERE m.collection='ethereum' AND m.token_id=$1 AND m.lifecycle=2`,[tokenId])).rows[0].n);
        const scan=Number((await readCheck.query(`SELECT count(*) AS n FROM ${metadataScanReadRelation} m WHERE m.collection='ethereum' AND m.token_id=$1 AND m.lifecycle=2`,[tokenId])).rows[0].n);
        assert.equal(scan,point);return point;
      };
      assert.equal(await visibleCount(),1);
      for(const mutation of [
        "UPDATE metadata.token_publication SET mint_log_index=mint_log_index+1 WHERE lifecycle=2",
        "UPDATE binding_check.token_lifecycle SET mint_block=mint_block+1 WHERE lifecycle=2",
        "UPDATE metadata.token_publication SET publication_content_hash='wrong' WHERE lifecycle=2",
        "UPDATE metadata.token_metadata SET document=jsonb_build_object('message','not metadata') WHERE lifecycle=2"
      ]){
        await readCheck.query('BEGIN');
        try{await readCheck.query(mutation);assert.equal(await visibleCount(),0,mutation);}finally{await readCheck.query('ROLLBACK');}
      }
      assert.equal(await visibleCount(),1);
    }finally{readCheck.release();}
    passed.push('optimized shared reads reject wrong mint log/block, mismatched hashes and invalid document shapes');
    // Reorg replaces an anchor while retaining its numeric lifecycle: old cache must disappear.
    await pool.query("UPDATE binding_check.token_lifecycle SET mint_transaction_hash=$1 WHERE lifecycle=2",[hash('3')]);
    await pool.query("UPDATE binding_check.transfer_event SET transaction_hash=$1 WHERE lifecycle=2",[hash('3')]);
    const visible=await pool.query(`SELECT 1 FROM (SELECT document.*,provenance.source_kind,provenance.release_id,provenance.publication_content_hash,provenance.publication_status,provenance.mint_transaction_hash,provenance.mint_log_index,provenance.chain_event_key FROM metadata.token_metadata document JOIN metadata.token_publication provenance USING(collection,token_id,lifecycle)) m WHERE m.lifecycle=2 AND ${publicationAvailableSql('m','archive')} AND ${canonicalPublicationSql('m','"binding_check"')}`);
    assert.equal(visible.rowCount,0);assert.equal((await reader.token('ethereum',tokenId))!.metadata,null);
    await pool.query("UPDATE metadata.publication_job SET status='pending',next_attempt_at=now() WHERE id=$1",[remint.id]);
    assert.equal(await publishJob(pool,'binding_check',(await claimPublications(pool,1))[0]),'obsolete');
    passed.push('reorg isolation on both publication and reads');
    // An unavailable publication clears attributes so the real catalog trigger clears stale traits.
    await pool.query("UPDATE metadata.token_metadata SET attributes='[]',document=NULL; UPDATE metadata.token_publication SET publication_status='unavailable'");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata.market_catalog_trait")).rows[0].n,0);
    await pool.query(`INSERT INTO binding_check.token VALUES('base',8453,$1,'77',$2,false,1,100,1700000000,$3)`,[collections.base.address,owner,hash('4')]);
    await pool.query(`INSERT INTO binding_check.token_lifecycle VALUES('base','77',1,$1,100)`,[hash('4')]);
    await pool.query(`INSERT INTO binding_check.transfer_event VALUES('base','77',1,$1,100,0,$2,$3,1)`,[hash('4'),ZERO_ADDRESS,owner]);
    await storeRuntimeBindings(pool,release,[{collection:'base',chainId:8453,contractAddress:collections.base.address,tokenId:'77',lifecycle:1,burned:false,
      tokenUri:`https://meta.polkamon.com/meta?id=${tokenId}`,uriProvenance:'current_token_uri_call',documentId:tokenId,documentName:fixture.envelope.nft.name,
      mintTransactionHash:hash('4'),mintLogIndex:1,assetKey:identity.assetKey!,sourceHash:contentHash(fixture.envelope),sourceLegacyId:tokenId,family:identity.family!}]);
    await pool.query(`INSERT INTO metadata_source.chain_metadata_scan VALUES('base_metadata_v1',8453,$1,100,100,120,$2,NULL,now())`,[collections.base.address,hash('f')]);
    const mint:BaseMetadataEvent={transactionHash:hash('4'),logIndex:2,transactionIndex:0,blockNumber:'100',blockHash:hash('a'),eventName:'Mint',tokenId:'77',recipient:owner,
      traits:{monsterType:1,color:2,horn:3,background:4,glitter:0,rarityScore:'42'}};
    await commitBaseMetadataRange(pool,'base_metadata_v1',100n,100n,hash('a'),[mint]);
    async function publishBase(){
      await pool.query("UPDATE metadata.publication_cursor SET token_id='',next_scan_at=now() WHERE collection='base'");
      await enqueuePublications(pool,'binding_check');const job=(await claimPublications(pool,10)).find(job=>job.collection==='base');assert.ok(job);return publishJob(pool,'binding_check',job);
    }
    assert.equal(await publishBase(),'published');
    const before=(await pool.query("SELECT count(*)::int AS n FROM metadata_source.render_revision")).rows[0].n;
    await commitBaseMetadataRange(pool,'base_metadata_v1',101n,101n,hash('b'),[{...mint,eventName:'Update',transactionHash:hash('5'),blockHash:hash('b'),blockNumber:'101'}]);
    for(const relation of [metadataReadRelation,metadataScanReadRelation])assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${relation} m WHERE m.collection='base'`)).rows[0].n,0);
    assert.equal(await publishBase(),'published');assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata_source.render_revision")).rows[0].n,before);
    for(const relation of [metadataReadRelation,metadataScanReadRelation])assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${relation} m WHERE m.collection='base'`)).rows[0].n,1);
    await commitBaseMetadataRange(pool,'base_metadata_v1',102n,102n,hash('c'),[{...mint,eventName:'Update',transactionHash:hash('6'),blockHash:hash('c'),blockNumber:'102',traits:{...mint.traits,color:9}}]);
    assert.equal((await reader.token('base','77'))!.status,'reconciliation_required');
    assert.equal(await publishBase(),'reconciliation_required');
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM metadata.market_catalog_trait WHERE collection='base'")).rows[0].n,0);
    assert.equal((await reader.token('base','77'))!.ownership.owner,owner);
    passed.push('Base replay publication; safe no-op updates; unmapped tuple quarantine; stale trait removal; ownership continuity');
    // A bounded first-mint batch measures the actual queue/binding/publication path.
    const batchSize=100;
    await pool.query(`INSERT INTO binding_check.token(collection,chain_id,contract_address,token_id,owner,burned,lifecycle,last_transfer_block,last_transfer_timestamp,last_transaction_hash)
      SELECT 'ethereum',1,$1,(9000000000000000000::numeric+i)::text,$2,false,1,200,1700000200,'0x'||lpad(to_hex(i+1000),64,'0') FROM generate_series(1,$3) i`,[collections.ethereum.address,owner,batchSize]);
    await pool.query(`INSERT INTO binding_check.token_lifecycle SELECT collection,token_id,lifecycle,last_transaction_hash,200 FROM binding_check.token WHERE mint_block=100 AND last_transfer_block=200`);
    await pool.query(`INSERT INTO binding_check.transfer_event(collection,token_id,lifecycle,transaction_hash,block_number,transaction_index,"from","to",log_index)
      SELECT collection,token_id,lifecycle,last_transaction_hash,200,0,$1,owner,1 FROM binding_check.token WHERE last_transfer_block=200`,[ZERO_ADDRESS]);
    await pool.query("UPDATE metadata.publication_cursor SET token_id='',next_scan_at=now()");
    const started=performance.now();await enqueuePublications(pool,'binding_check');
    let published=0;
    while(published<batchSize){
      const jobs=(await claimPublications(pool,8)).filter(job=>BigInt(job.tokenId)>9000000000000000000n);
      assert.ok(jobs.length);
      const statuses=await Promise.all(jobs.map(job=>publishJob(pool,'binding_check',job,async()=>`https://meta.polkamon.com/meta?id=${tokenId}`)));
      assert.ok(statuses.every(status=>status==='published'));published+=jobs.length;
    }
    const seconds=(performance.now()-started)/1000;
    publicationBenchmark={tokens:published,concurrency:8,elapsedSeconds:seconds,tokensPerSecond:published/seconds,
      scope:'Synthetic first mints of a verified archived asset; real PostgreSQL bindings, revisions, rarity and marketplace triggers; mocked tokenURI RPC, no HTTP',
      relationBytes:(await pool.query(`SELECT sum(pg_total_relation_size(name::regclass))::text AS bytes FROM unnest(ARRAY['metadata.token_publication','metadata.publication_job','metadata_source.render_revision']) name`)).rows[0].bytes};
    passed.push('first mint of archived assets; bounded concurrent publisher throughput');
    await pool.query("UPDATE metadata_source.archive_release SET state='superseded' WHERE release_id=$1",[release]);
    assert.equal((await api.request(`/meta?id=${tokenId}`)).status,503);
    passed.push('unavailable catalog clearing; release deactivation isolates readers');
  } finally {globalThis.fetch=originalFetch;}
  await writeReport(String(args.output),{format:'metadata-publisher-integration-v1',checkedAt:new Date().toISOString(),passed,publicationBenchmark,complete:true,scope:'Disposable PostgreSQL; real marketplace trigger definitions; no production activation'});
  console.log(JSON.stringify({passed:passed.length,checks:passed}));
}catch(error){console.error(error instanceof Error ? {name:error.name,message:error.message,stack:error.stack?.split('\n').slice(0,5)} : safeFailure(error));process.exitCode=1;}finally{await pool.end();}
