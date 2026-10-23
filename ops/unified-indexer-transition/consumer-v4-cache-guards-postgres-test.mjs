// Actual local PostgreSQL16 DDL, copied read ACLs, stale-review refusal and rollback.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {capture,catalog,digest,rehearse,apply,inverse} from './consumer-v4-cache-guard-transition.mjs';
import {migrateIndexerControl} from '../../apps/yunipals-indexer/lib/unified/control-schema.ts';
const root='/root/yunipals', require=createRequire(root+'/apps/yunipals-indexer/package.json');
const {Pool}=require('pg'),env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8'};
const container='yunipals-unified-indexer-test-20261020';
const docker=args=>execFileSync('/usr/bin/docker',['--host=unix:///var/run/docker.sock',...args],{env,timeout:15000,encoding:'utf8',maxBuffer:4e6});
const info=JSON.parse(docker(['inspect',container]))[0];assert.equal(info.Config.Image,'postgres:16.15');assert.deepEqual(info.NetworkSettings.Ports['5432/tcp'],[{HostIp:'127.0.0.1',HostPort:'56967'}]);
const suffix=randomBytes(5).toString('hex'),database='consumer_v4_guards_'+suffix;
const connection=name=>'postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/'+name;
const admin=new Pool({connectionString:connection('postgres'),max:1});let pool,created=false,readerCreated=false;const reader='cache_guard_reader_'+suffix;
const plan=JSON.parse(readFileSync(root+'/ops/unified-indexer-transition/metadata-readview-v4-plan.review.json'));
const prior=JSON.parse(readFileSync(root+'/ops/unified-indexer-transition/ownership-readview-plan.review.json'));
const profile=JSON.parse(readFileSync(root+'/docs/unified-indexer/production-rpc-profile-2026-10-20.draft.json'));
try {
 await admin.query(`CREATE DATABASE "${database}" OWNER unified_test TEMPLATE template0`);created=true;
 pool=new Pool({connectionString:connection(database),max:1,statement_timeout:10000});
 const dump=docker(['exec',container,'pg_dump','-U','unified_test','-d','yunipals_ponder_dependency_test','--schema-only','--no-owner','--no-privileges','--schema','dependency_check']);
 await pool.query(dump.replace(/^\\(?:un)?restrict.*$/mg,'').replaceAll('dependency_check',plan.physicalSchema));
 await pool.query(`SET search_path="${plan.physicalSchema}",public`);
 await pool.query("CREATE TEMP TABLE live_query_tables(table_name text PRIMARY KEY)");
 await migrateIndexerControl(pool);
 await pool.query(`INSERT INTO ${plan.physicalSchema}._ponder_meta(key,value) VALUES('app',$1)`,[JSON.stringify({version:'6',build_id:plan.buildId,is_dev:0,heartbeat_at:Date.now(),is_locked:0,is_ready:0})]);
 for(const source of profile.manifest.sources)await pool.query(`INSERT INTO ${plan.physicalSchema}.indexer_source VALUES($1,$2,$3,$4)`,[source.id,source.chainId,prior.readView.manifestHash,JSON.stringify(source)]);
 await pool.query('INSERT INTO yunipals_indexer_control.release(id,physical_schema,build_id,manifest_hash,manifest) VALUES($1,$2,$3,$4,$5)',[plan.sourceRelease,plan.physicalSchema,plan.buildId,prior.readView.manifestHash,profile.manifest]);


 Object.assign(process.env,{DATABASE_URL:connection(database),DATABASE_SCHEMA:plan.physicalSchema,
   READ_DATABASE_SCHEMA:plan.readSchema,OWNERSHIP_READ_MODE:'unified',OWNERSHIP_READ_SCHEMA:plan.readSchema,
   OWNERSHIP_RELEASE_ID:plan.sourceRelease,YUNIPALS_PROJECTION_MODE:'generation',METADATA_SOURCE_MODE:'archive',BASE_METADATA_INGESTION:'native'});
 globalThis.fetch=async()=>{throw Error('No providers permitted');};
 const {migrations}=await import('../../apps/yunipals-indexer/lib/offchain/migrations.ts');
 const {projectionSchemaStatements}=await import('../../apps/yunipals-indexer/lib/metadata/projection-schema.ts');
 const {installReadCache}=await import('../../apps/yunipals-indexer/lib/metadata/read-cache-schema.ts');
 const {cachedSearchReadRelationFor,cachedTraitReadRelationFor}=await import('../../apps/yunipals-indexer/lib/metadata/read-cache.ts');
 for(const sql of migrations)await pool.query(sql);
 for(const sql of projectionSchemaStatements)await pool.query(sql);
 for(const schema of ['yunipals_indexer_v3','bnb_indexer']){
  await pool.query(`CREATE SCHEMA ${schema}`);
  for(const name of ['token','token_lifecycle','transfer_event'])await pool.query(`CREATE TABLE ${schema}.${name}(LIKE ${plan.physicalSchema}.${name} INCLUDING ALL)`);
 }
 await admin.query(`CREATE ROLE ${reader} NOLOGIN`);readerCreated=true;

 const query=execFileSync('/usr/bin/python3',['-I','-B','-c',`import importlib.util
s=importlib.util.spec_from_file_location('v4',${JSON.stringify(root+'/ops/unified-indexer-transition/consumer-generation-v4-proof-v2.py')});m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.guard_sql())`],{encoding:'utf8',env,timeout:5000});
 const guard=async()=> (await pool.query(query)).rows[0].jsonb_build_object;
 // Construct the real legacy35 graph using the unchanged official installer
 // in a fresh module process, so cached native selector imports cannot leak.
 const legacyCode=`import pg from 'pg';import {installReadCache} from ${JSON.stringify(root+'/apps/yunipals-indexer/lib/metadata/read-cache-schema.ts')};
 const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{await c.query('BEGIN');await installReadCache(c);await c.query('COMMIT')}finally{await c.end()}`;
 execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',legacyCode],{
  cwd:root+'/apps/yunipals-indexer',encoding:'utf8',timeout:15000,
  env:{...env,DATABASE_URL:connection(database),DATABASE_SCHEMA:'yunipals_indexer_v3',BNB_DATABASE_SCHEMA:'bnb_indexer',
   OWNERSHIP_READ_MODE:'legacy',METADATA_SOURCE_MODE:'archive',BASE_METADATA_INGESTION:'rpc'}});
 assert.deepEqual(await guard(),{valid:false});
 await pool.query(`GRANT SELECT ON metadata_projection.search TO ${reader}`);
 // A pre-existing non-SELECT right must survive the finite grant inverse.
 await pool.query(`GRANT UPDATE ON metadata_projection.read_epoch TO ${reader}`);
 await pool.query("INSERT INTO metadata_projection.generation(source_mode,state)VALUES('archive','ready')");
 await pool.query("INSERT INTO metadata_projection.read_set(generation_id,collection,revision,guard_count,source_mode)SELECT 1,'bnb',revision,8,'archive' FROM metadata_projection.read_epoch WHERE collection='bnb'");
 await pool.query("INSERT INTO metadata_projection.read_member(generation_id,collection,token_id,lifecycle,has_search,metadata_available)VALUES(1,'bnb',1,1,false,false)");
 const cacheRows=async()=> (await pool.query("SELECT jsonb_build_object('sets',(SELECT jsonb_agg(s ORDER BY generation_id,collection)FROM metadata_projection.read_set s),'members',(SELECT jsonb_agg(m ORDER BY generation_id,collection,token_id)FROM metadata_projection.read_member m))AS value")).rows[0].value;
 const original=await capture(pool),data=await cacheRows();
 const review=await rehearse(pool,installReadCache,query);
 assert.equal(review.committed,false);assert.deepEqual(await capture(pool),original);assert.deepEqual(await cacheRows(),data);
 assert.equal(review.before.guards.length,35);assert.equal(review.after.guards.length,35);
 assert.equal(review.addedSelects.length,4);assert(review.addedSelects.every(a=>a.role===reader&&a.privilege==='SELECT'));
 const stale=structuredClone(review);stale.before.guards[0].oid='1';stale.beforeCatalogSha256=digest(catalog(stale.before));
 await assert.rejects(apply(pool,stale,installReadCache,query),/reviewed_legacy_catalog_changed/);
 assert.deepEqual(await capture(pool),original);
 const receipt=await apply(pool,review,installReadCache,query);
 assert(receipt.committed);assert.deepEqual(await guard(),{valid:true});assert.deepEqual(await cacheRows(),data);
 // Writes after commit must never allow the inverse to reset epoch revisions.
 await pool.query("UPDATE metadata_projection.read_epoch SET revision=revision+7");
 const epochs=(await capture(pool)).epochs;
 const restored=await inverse(pool,receipt);assert(restored.restored);
 assert.deepEqual(catalog(await capture(pool)),catalog(original));assert.deepEqual(await cacheRows(),data);
 assert.deepEqual((await capture(pool)).epochs.map(e=>({...e,revision:String(BigInt(e.revision)-1n)})),epochs);
 await assert.rejects(inverse(pool,receipt),/owned_native_catalog_changed/);
 // The official guard admission remains strict after the concrete transition.
 const again=await rehearse(pool,installReadCache,query);await apply(pool,again,installReadCache,query);
 await pool.query('BEGIN');await pool.query("DELETE FROM metadata_projection.read_guard WHERE collection='base' AND relation LIKE '%canonical_event'");assert.deepEqual(await guard(),{valid:false});await pool.query('ROLLBACK');
 await pool.query(`ALTER TABLE ${plan.physicalSchema}.token DISABLE TRIGGER read_cache_dirty`);assert.deepEqual(await guard(),{valid:false});await pool.query(`ALTER TABLE ${plan.physicalSchema}.token ENABLE ALWAYS TRIGGER read_cache_dirty`);
 await pool.query("UPDATE metadata_projection.read_guard SET relation_oid='metadata.token_metadata'::regclass WHERE collection='bnb' AND relation LIKE '%.token'");assert.deepEqual(await guard(),{valid:false});
 for(const sql of [cachedSearchReadRelationFor('"'+plan.readSchema+'"',['base'],'104'),cachedTraitReadRelationFor('"'+plan.readSchema+'"',['base'],'104')]){
   assert.match(sql,/UNION ALL SELECT original\./);assert.match(sql,/WHERE NOT \(SELECT/);assert.ok(sql.includes(plan.readSchema));
 }
 console.log(JSON.stringify({passed:true,checks:['official_native_install_matches_guard_query','real_legacy35_to_native35_rehearsal_restores_exact_catalog_and_epochs','stale_review_refused','finite_four_SELECT_delta','committed_inverse_restores_catalog_and_preserves_existing_UPDATE','inverse_monotonic_epoch_after_intervening_writes','cache_rows_untouched','second_inverse_refused','exact_35_native_rows','missing_native_guard_rejected','disabled_trigger_rejected','wrong_relation_oid_rejected','actual_search_and_trait_direct_fallback_when_cache_not_fresh'],productionCalls:0,providerCalls:0}));
}finally{await pool?.end();if(created)await admin.query(`DROP DATABASE "${database}" WITH(FORCE)`);if(readerCreated)await admin.query(`DROP ROLE ${reader}`);await admin.end();}
