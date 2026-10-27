/** Actual PostgreSQL16 catalog SQL; isolated random database/role only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const req=createRequire(root+'/apps/yunipals-indexer/package.json'),{Pool}=req('pg');
const base='postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/postgres';
const db='arena_ypal_catalog_'+randomBytes(6).toString('hex'),role=db+'_owner';
const admin=new Pool({connectionString:base,max:1});let created=false,ownedRole=false,pool;
const helper=fileURLToPath(new URL('./arena-ypal-native-v1.catalog.py',import.meta.url));
const query=execFileSync('/usr/bin/python3',['-I','-B','-c','import runpy,sys;print(runpy.run_path(sys.argv[1])["sql"](),end="")',helper],{encoding:'utf8'});
try{
  assert.match((await admin.query('SHOW server_version')).rows[0].server_version,/^16\.15/);
  await admin.query('CREATE ROLE '+role+' NOLOGIN');ownedRole=true;
  await admin.query('CREATE DATABASE '+db);created=true;
  pool=new Pool({connectionString:base.replace('/postgres','/'+db),max:1});
  await pool.query('CREATE SCHEMA unified_ypal_20261023_v1;CREATE SCHEMA yunipals_indexer_control');
  for(const name of ['_ponder_meta','_ponder_checkpoint','arena_tournament','arena_credit','canonical_event','chain_block','chain_checkpoint','indexer_source','transaction_candidate'])await pool.query('CREATE TABLE unified_ypal_20261023_v1.'+name+(name==='_ponder_meta'?'(key text,value jsonb)':'(id text)'));
  await pool.query('CREATE TABLE yunipals_indexer_control.release(id text,manifest_hash text,physical_schema text,build_id text)');
  for(const name of ['chain_status','chain_anchor','transaction_evidence'])await pool.query('CREATE TABLE yunipals_indexer_control.'+name+'(id text)');
  await pool.query("CREATE FUNCTION unified_ypal_20261023_v1.public_fixture(v text)RETURNS text LANGUAGE sql AS 'SELECT v'");
  await pool.query("CREATE FUNCTION yunipals_indexer_control.public_fixture()RETURNS int LANGUAGE sql AS 'SELECT 1'");
  await pool.query('ALTER DEFAULT PRIVILEGES IN SCHEMA unified_ypal_20261023_v1 GRANT SELECT ON TABLES TO PUBLIC');
  await pool.query('ALTER DEFAULT PRIVILEGES FOR ROLE '+role+' REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
  await assert.rejects(pool.query(query),/fixed_4e_71e_source_identity_changed/);await pool.query('ROLLBACK');
  // Only target identity/OID scope is adapted for this fresh local database.
  // The full production SELECT/body-hash/default-ACL aggregation is unchanged.
  const adapted=query.replace(/DO \$identity\$ BEGIN[\s\S]*?END \$identity\$;/,'')
    .replace('oid IN(75963410,73011094)',"nspname IN('unified_ypal_20261023_v1','yunipals_indexer_control')")
    .replace('defaclnamespace IN(0,75963410,73011094)',"(defaclnamespace=0 OR defaclnamespace IN(SELECT oid FROM pg_namespace WHERE nspname IN('unified_ypal_20261023_v1','yunipals_indexer_control')))");
  const result=await pool.query(adapted);const doc=result.find(r=>r.rows.length)?.rows[0].jsonb_build_object;
  assert.equal(doc.readOnly,true);assert.equal(doc.isolation,'repeatable read');
  assert.equal(doc.relationIdentities.length,13);assert.equal(doc.functions.length,2);assert.equal(doc.defaultAcl.length,2);
  assert.equal(new Set(doc.defaultAcl.map(r=>r.ownerOid)).size,2,'Other owner global default ACL must be captured.');
  for(const f of doc.functions){assert.match(f.bodySha256,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(f,'body'),false);assert.equal(f.securityDefiner,false);assert.ok(Array.isArray(f.acl));}
  assert.equal(JSON.stringify(doc).includes('SELECT v'),false,'Raw function body must not be exported.');
  console.log(JSON.stringify({passed:true,groups:5,postgres:'16.15',productionIdentityRefused:true,fullSelectRoundTrip:true,relations:13,functions:2,defaultAclOwners:2,bodyHashOnly:true}));
}finally{
  if(pool)await pool.end();
  if(created)await admin.query('DROP DATABASE '+db);
  if(ownedRole)await admin.query('DROP ROLE '+role);
  await admin.end();
}
