import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { argumentsOf,postgresFrom,writeReport,safeFailure } from './metadata/support.js';
import { assertRecoveryDatabase,assertRecoveryRuntimeEnvironment } from './metadata/recovery.js';
import { sqlIdentifier } from '../lib/offchain/sql.js';
import { collectionSlugs } from '../lib/constants.js';
import { performanceIndexes } from '../lib/offchain/api-indexes.js';

const args=argumentsOf({resume:{type:'boolean',default:false},report:{type:'string',default:'docs/metadata-migration/step-4-derived.json'}});
const {pool,env}=await postgresFrom(String(args['env-file']));
let forbiddenRequests=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{forbiddenRequests++;throw new Error('Recovery HTTP forbidden');};
let runtime:typeof import('../lib/offchain/db.js')|undefined;
try{
  const database=await assertRecoveryDatabase(pool);assert.equal(env.METADATA_SOURCE_MODE,'archive');assert.equal(env.RARITY_READ_SOURCE,'local');
  assertRecoveryRuntimeEnvironment(env);
  runtime=await import('../lib/offchain/db.js');
  const publication=JSON.parse(await readFile('docs/metadata-migration/step-4-publication.json','utf8'));assert.equal(publication.database,database);assert.equal(publication.complete,true);
  let report:any={format:'metadata-recovery-derived-v1',database,release:publication.release,phases:{},complete:false};
  if(args.resume){report=JSON.parse(await readFile(String(args.report),'utf8'));assert.equal(report.database,database);assert.equal(report.release,publication.release);}
  await writeReport(String(args.report),report);
  if(!report.phases.readIndexes){
    const client=await pool.connect(),start=performance.now();
    try{
      await client.query('SET statement_timeout=0');
      await client.query('VACUUM (ANALYZE, TRUNCATE FALSE, PARALLEL 0) metadata.token_metadata,metadata.token_publication');
      report.phases.readIndexes={elapsedSeconds:(performance.now()-start)/1000};await writeReport(String(args.report),report);
    }finally{client.release();}
  }
  const {refreshTraitIndex,refreshLeaderboard}=await import('../lib/leaderboard/refresh.js');
  for(const [name,operation] of [['traits',refreshTraitIndex],['leaderboard',refreshLeaderboard]] as const){
    if(report.phases[name])continue;
    console.log(JSON.stringify({phase:name}));const start=performance.now();const result=await operation();
    report.phases[name]={elapsedSeconds:(performance.now()-start)/1000,result};await writeReport(String(args.report),report);
  }
  const client=await pool.connect();
  try{
    await client.query('SET statement_timeout=0');await client.query("SET work_mem='128MB'");
    if(!report.phases.apiIndexes){
      console.log(JSON.stringify({phase:'apiIndexes'}));const start=performance.now();
      for(const sql of performanceIndexes){
        await client.query(sql.replace('CREATE INDEX CONCURRENTLY','CREATE INDEX'));
        const name=sql.match(/NOT EXISTS (\w+)/)![1];
        assert.equal((await client.query('SELECT indisvalid FROM pg_index WHERE indexrelid=to_regclass($1)',[`metadata.${name}`])).rows[0]?.indisvalid,true,name);
      }
      await client.query('ANALYZE metadata.token_search');
      report.phases.apiIndexes={elapsedSeconds:(performance.now()-start)/1000,indexes:performanceIndexes.length};await writeReport(String(args.report),report);
    }
    if(!report.phases.marketplace){
      console.log(JSON.stringify({phase:'marketplace'}));const start=performance.now();
      await client.query('BEGIN');
      await client.query('LOCK TABLE metadata.token_metadata IN SHARE MODE');
      await client.query('CREATE TABLE metadata.market_catalog_trait_build(LIKE metadata.market_catalog_trait INCLUDING DEFAULTS INCLUDING CONSTRAINTS)');
      await client.query(`INSERT INTO metadata.market_catalog_trait_build SELECT collection,token_id,lifecycle,trait_type,value FROM metadata.token_trait`);
      // The marketplace preserves JSON null as the text "null"; the native trait index omits it.
      await client.query(`INSERT INTO metadata.market_catalog_trait_build SELECT DISTINCT m.collection,m.token_id,m.lifecycle,a->>'trait_type','null'
        FROM metadata.token_metadata m CROSS JOIN LATERAL jsonb_array_elements(m.attributes) a WHERE a->>'trait_type' IS NOT NULL AND a->>'value' IS NULL`);
      await client.query('ALTER TABLE metadata.market_catalog_trait_build ADD PRIMARY KEY(collection,trait_type,value,token_id,lifecycle)');
      await client.query('CREATE INDEX market_catalog_trait_build_identity_idx ON metadata.market_catalog_trait_build(collection,token_id,lifecycle)');
      await client.query('ALTER TABLE metadata.market_catalog_trait RENAME TO market_catalog_trait_retired');
      await client.query('ALTER TABLE metadata.market_catalog_trait_build RENAME TO market_catalog_trait');
      await client.query('UPDATE metadata.market_catalog_trait_state SET ready=true,ready_at=now() WHERE singleton');
      await client.query('TRUNCATE metadata.market_catalog_trait_pending');
      await client.query('DROP TABLE metadata.market_catalog_trait_retired');
      await client.query('ANALYZE metadata.market_catalog_trait');await client.query('COMMIT');
      report.phases.marketplace={elapsedSeconds:(performance.now()-start)/1000};await writeReport(String(args.report),report);
    }
    const schema=sqlIdentifier(env.READ_DATABASE_SCHEMA??env.DATABASE_SCHEMA);
    const counts=(await client.query(`SELECT
      (SELECT count(*)::int FROM ${schema}.token) AS tokens,
      (SELECT count(*)::int FROM metadata.token_publication WHERE publication_status='published') AS published,
      (SELECT count(*)::int FROM metadata.token_search WHERE metadata_available) AS searchable,
      (SELECT count(*)::int FROM ${schema}.token WHERE NOT burned) AS active_tokens,
      (SELECT sum(monster_count)::int FROM leaderboard.wallet_stats WHERE scope='all') AS leaderboard_tokens,
      (SELECT count(DISTINCT lower(owner))::int FROM ${schema}.token WHERE NOT burned) AS owners,
      (SELECT count(*)::int FROM leaderboard.wallet_stats WHERE scope='all') AS leaderboard_owners,
      (SELECT count(*)::text FROM metadata.token_trait) AS native_traits,
      (SELECT count(*)::text FROM metadata.market_catalog_trait) AS marketplace_traits,
      (SELECT count(*)::int FROM metadata.market_catalog_trait_pending) AS marketplace_pending`)).rows[0];
    assert.equal(counts.published,counts.searchable);assert.equal(counts.active_tokens,counts.leaderboard_tokens);assert.equal(counts.owners,counts.leaderboard_owners);assert.equal(counts.marketplace_pending,0);
    report.counts=counts;
    report.rarity=(await client.query('SELECT status,count(*)::int AS count FROM metadata.token_rarity GROUP BY status ORDER BY status')).rows;
    report.publication=(await client.query('SELECT collection,publication_status,publication_error,count(*)::int AS count FROM metadata.token_publication GROUP BY 1,2,3 ORDER BY 1,2,3')).rows;
    report.collectionCounts=(await client.query(`SELECT collection,count(*)::int AS total,count(*) FILTER(WHERE NOT burned)::int AS active FROM ${schema}.token GROUP BY collection`)).rows;
    const visibilityRows=Number((await client.query('SELECT count(*) AS n FROM metadata.token_visibility')).rows[0].n);
    const {app}=await import('../lib/api/server.js');const apiResults=[];
    for(const collection of collectionSlugs){
      const token=(await client.query(`SELECT token_id,owner FROM ${schema}.token WHERE collection=$1 AND NOT burned ORDER BY token_id LIMIT 1`,[collection])).rows[0];
      for(const path of [`/v1/tokens?chain=${collection}&limit=2`,`/v1/tokens?chain=${collection}&metadata=available&sort=rarity-desc&limit=2`,
        `/v1/traits?chain=${collection}`,`/v1/leaderboards/collector-score?chain=${collection}&limit=2`,`/v1/tokens/${collection}/${token.token_id}`,
        `/v1/owners/${token.owner}/tokens?chain=${collection}&limit=2`]){
        const started=performance.now(),response=await app.request(path);assert.equal(response.status,200,`${collection}: ${path.split('?')[0]} status`);
        const body=await response.json() as any;
        const census=report.collectionCounts.find((row:any)=>row.collection===collection);
        if(path.startsWith('/v1/tokens?')){
          assert.ok(body.items.length>0&&body.items.length<=2);
          assert.ok(body.items.every((item:any)=>item.chain===collection));
          const available=path.includes('metadata=available');
          const expected=available?report.publication.find((row:any)=>row.collection===collection&&row.publication_status==='published').count:census.total;
          assert.ok(body.total<=expected&&body.total>=expected-visibilityRows,`${collection} API census`);
          if(available)assert.ok(body.items.every((item:any)=>item.metadataAvailable&&item.name));
        }else if(path.startsWith('/v1/traits?')){
          assert.ok(body.items.length>0);assert.equal(body.metadata.available+body.metadata.missing,census.active);
        }else if(path.startsWith('/v1/leaderboards/')){
          assert.ok(body.items.length>0&&body.items.length<=2);assert.equal(body.items[0].rank,1);
          assert.ok(body.items.every((item:any)=>Number(item.score)>0&&item.monsterCount>0));
        }else if(path.startsWith('/v1/tokens/')){
          assert.equal(body.token.token_id,token.token_id);assert.equal(body.token.owner,token.owner);
        }else if(path.startsWith('/v1/owners/')){
          assert.ok(body.items.length>0&&body.items.length<=2);
          const owned=Number((await client.query(`SELECT count(*) AS n FROM ${schema}.token WHERE collection=$1 AND owner=$2 AND NOT burned AND token_id=ANY($3::text[])`,[collection,token.owner,body.items.map((item:any)=>item.tokenId)])).rows[0].n);
          assert.equal(owned,body.items.length);
        }
        apiResults.push({collection,endpoint:path.replace(token.owner,'{owner}'),milliseconds:performance.now()-started,items:body.items?.length,total:body.total});
      }
    }
    for(const path of ['/ready','/v1/indexing-status','/v1/status'])assert.equal((await app.request(path)).status,200,path);
    report.api=apiResults;report.forbiddenRequests=forbiddenRequests;assert.equal(forbiddenRequests,0);
    report.complete=true;report.verifiedAt=new Date().toISOString();await writeReport(String(args.report),report);console.log(JSON.stringify({complete:true,counts}));
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}catch(error){console.error(error instanceof assert.AssertionError?error.message:safeFailure(error));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;if(runtime){await runtime.pool.end();await runtime.apiPool.end();}await pool.end();}
