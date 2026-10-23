// Disposable local PG16 only; actual generated ACL/CAS SQL, no host services.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const root='/root/yunipals',require=createRequire(root+'/apps/yunipals-indexer/package.json'),{Pool}=require('pg');
const info=JSON.parse(execFileSync('/usr/bin/docker',['inspect','yunipals-unified-indexer-test-20261020'],{encoding:'utf8'}))[0];
assert.equal(info.Config.Image,'postgres:16.15');assert.deepEqual(info.NetworkSettings.Ports['5432/tcp'],[{HostIp:'127.0.0.1',HostPort:'56967'}]);
const suffix=randomBytes(5).toString('hex'),database='ypal_reader_'+suffix,reader='ypal_reader_'+suffix,writer='ypal_writer_'+suffix;
const connection=name=>'postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/'+name;
const admin=new Pool({connectionString:connection('postgres'),max:1});let client,fixturePool,created=false,roles=false;let config;
function python(method,args=[]){return JSON.parse(execFileSync('/usr/bin/python3',['-I','-B','-c',`import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('reader',${JSON.stringify(root+'/ops/booster-launch/ypal-reader-cutover-v1.py')});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nv=json.loads(sys.stdin.read());[setattr(m,k,val)for k,val in v['config'].items()]\nprint(json.dumps(getattr(m,v['method'])(*v['args'])))`],{input:JSON.stringify({config:config||{},method,args}),encoding:'utf8',stdio:['pipe','pipe','pipe']}));}
const firstCatalog=results=>{const rows=(Array.isArray(results)?results:[results]).flatMap(r=>r.rows);return rows.find(r=>r.jsonb_build_object)?.jsonb_build_object;};
let groups=0;
try{
 await admin.query(`CREATE DATABASE ${database} OWNER unified_test TEMPLATE template0`);created=true;
 fixturePool=new Pool({connectionString:connection(database),max:1,statement_timeout:10000});client=await fixturePool.connect();
 await client.query(`CREATE ROLE ${reader} LOGIN NOINHERIT CONNECTION LIMIT 6;CREATE ROLE ${writer} NOLOGIN`);roles=true;
 const oid=await client.query(`SELECT (SELECT oid::text FROM pg_database WHERE datname=current_database())db,(SELECT oid::text FROM pg_roles WHERE rolname=$1)reader,(SELECT oid::text FROM pg_roles WHERE rolname=$2)writer`,[reader,writer]);
 config={ROLE:reader,ROLE_OID:oid.rows[0].reader,WRITER_OID:oid.rows[0].writer,DATABASE_OID:oid.rows[0].db};
 const tables=JSON.parse(execFileSync('/usr/bin/python3',['-c',`import importlib.util,json;s=importlib.util.spec_from_file_location('r',${JSON.stringify(root+'/ops/booster-launch/ypal-reader-cutover-v1.py')});m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.TABLES))`],{encoding:'utf8'}));
 const fresh='yunipals_boosters_ypal_v1',old='yunipals_boosters_launch_v1';
 for(const schema of[old,fresh]){await client.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${writer};SET ROLE ${writer};`+tables.map(t=>`CREATE TABLE ${schema}.${t}(id text)`).join(';')+';RESET ROLE;');}
 await client.query(`GRANT USAGE ON SCHEMA ${old} TO ${reader};`+tables.map(t=>`GRANT SELECT ON ${old}.${t} TO ${reader}`).join(';'));
 const query=python('catalog_sql'),capture=async()=>firstCatalog(await client.query(query));const before=await capture();assert(python('validate_catalog',[before,false]));groups++;
 const rehearsal=firstCatalog(await client.query(python('grant_sql',[before])));assert(python('validate_delta',[before,rehearsal]));assert.deepEqual(await capture(),before);groups++;
 await client.query(`GRANT UPDATE ON ${fresh}.booster_monster TO ${reader}`);
 await assert.rejects(client.query(python('grant_sql',[before,rehearsal,true])),/exact_reader_catalog_CAS_required/);await client.query('ROLLBACK');
 await client.query(`REVOKE UPDATE ON ${fresh}.booster_monster FROM ${reader}`);assert.deepEqual(await capture(),before);groups++;
 const admitted=firstCatalog(await client.query(python('grant_sql',[before,rehearsal,true])));assert.deepEqual(admitted,rehearsal);assert.deepEqual(await capture(),rehearsal);groups++;
 await client.query(`SET ROLE ${reader};BEGIN READ ONLY;`+[old,fresh].flatMap(s=>tables.map(t=>`SELECT count(*) FROM ${s}.${t}`)).join(';')+';ROLLBACK;RESET ROLE');
 await client.query(`SET ROLE ${reader}`);await assert.rejects(client.query(`INSERT INTO ${fresh}.booster_monster VALUES('forbidden')`),e=>e.code==='42501');await client.query('RESET ROLE');groups++;
 await client.query(`ALTER ROLE ${reader} CONNECTION LIMIT -1`);assert.throws(()=>python('validate_catalog',[awaitableGuard(),true]));
 function awaitableGuard(){const c=structuredClone(admitted);c.role.limit=-1;return c;}
 await client.query(`ALTER ROLE ${reader} CONNECTION LIMIT 6`);assert.deepEqual(await capture(),admitted);groups++;
 const restored=firstCatalog(await client.query(python('grant_sql',[admitted,before,true,true])));assert.deepEqual(restored,before);assert.deepEqual(await capture(),before);
 await client.query(`SET ROLE ${reader}`);await assert.rejects(client.query(`SELECT * FROM ${fresh}.booster_monster`),e=>e.code==='42501');await client.query(`SELECT count(*) FROM ${old}.booster_monster;RESET ROLE`);groups++;
 console.log(JSON.stringify({passed:true,groups,relations:20,grantedSelects:10,oldTenPreserved:true,onlyDisposablePostgres:true,services:0,providers:0}));
}finally{
 if(client)client.release();if(fixturePool)await fixturePool.end();
 if(created)await admin.query(`DROP DATABASE ${database} WITH(FORCE)`);
 if(roles)await admin.query(`DROP ROLE ${reader};DROP ROLE ${writer}`);
 await admin.end();
}
