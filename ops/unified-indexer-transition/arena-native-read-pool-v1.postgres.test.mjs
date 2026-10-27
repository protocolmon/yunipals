// Actual PG sessions/transactions over root-only local IPC; no production use.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createConnection} from "node:net";
import {once} from "node:events";
import {setTimeout} from "node:timers/promises";
import {dirname,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {serveNativeReadPool,nativeReadPoolSession,sharedReadPool,serviceRuntimeEpoch} from "./arena-native-read-pool-v1.mjs";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const require=createRequire(join(root,"apps/yunipals-market-api/package.json")),{Pool}=require("pg");
assert.equal(process.env.ARENA_DERIVED_FIXTURE_URL,"postgresql://postgres@127.0.0.1:56983/fixture");
const fd=Number(process.env.NATIVE_POOL_FIXTURE_FD),path=process.env.NATIVE_POOL_FIXTURE_PATH;
assert(Number.isInteger(fd)&&fd>=3&&path.startsWith('/tmp/arena-native-pool-fixture-'));
const admin=new Pool({connectionString:process.env.ARENA_DERIVED_FIXTURE_URL,max:1});
const database="ypal_native_read_pool_fixture",role="arena_native_reader",checks=[];
let db,source,target,server,created=false,ownedRole=false,ownedTargetRole=false;
const targetRole='ypal_public_read_pool_fixture';
const clients=[];
try{
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_database WHERE datname=$1",[database])).rows[0].n,0);
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_roles WHERE rolname=$1",[role])).rows[0].n,0);
  await admin.query(`CREATE DATABASE ${database}`);created=true;
  await admin.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32`);ownedRole=true;
  assert.equal((await admin.query("SELECT count(*)::int n FROM pg_roles WHERE rolname=$1",[targetRole])).rows[0].n,0);
  await admin.query(`CREATE ROLE ${targetRole} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32`);ownedTargetRole=true;
  db=new Pool({host:"127.0.0.1",port:56983,database,user:"postgres",max:1});
  await db.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC;GRANT CONNECT ON DATABASE ${database} TO ${role};REVOKE ALL ON SCHEMA public FROM PUBLIC;
    CREATE TABLE public.native_fixture(id int PRIMARY KEY,n int,json_value jsonb,stamp timestamptz,bytes bytea);INSERT INTO public.native_fixture VALUES(1,1,'{"$nativeDate":"literal-user-JSON"}',now(),'\\x010203');
    GRANT USAGE ON SCHEMA public TO ${role};GRANT SELECT ON public.native_fixture TO ${role}`);
  await db.query(`GRANT CONNECT ON DATABASE ${database} TO ${targetRole};GRANT USAGE ON SCHEMA public TO ${targetRole};GRANT SELECT ON public.native_fixture TO ${targetRole}`);
  source=sharedReadPool(new Pool({host:"127.0.0.1",port:56983,database,user:role,max:1,statement_timeout:2000,query_timeout:3000,connectionTimeoutMillis:3000,
    application_name:"ypal_native_pool_fixture_shared",options:"-c default_transaction_read_only=on"}));
  target=sharedReadPool(new Pool({host:'127.0.0.1',port:56983,database,user:targetRole,max:1,statement_timeout:2000,query_timeout:3000,connectionTimeoutMillis:3000,
    application_name:'ypal_public_pool_fixture_shared',options:'-c default_transaction_read_only=on'}));
  const databaseOid=(await admin.query('SELECT oid::int FROM pg_database WHERE datname=$1',[database])).rows[0].oid;
  const identity={sourceRole:{name:role,oid:(await admin.query('SELECT oid::int FROM pg_roles WHERE rolname=$1',[role])).rows[0].oid},
    publicReaderRole:{name:targetRole,oid:(await admin.query('SELECT oid::int FROM pg_roles WHERE rolname=$1',[targetRole])).rows[0].oid},nativeDatabaseOid:databaseOid,publicDatabaseOid:databaseOid,fixtureOnly:true,runtimeEpoch:serviceRuntimeEpoch()};
  let sourceSQL=0;const connectSource=source.connect;
  source.connect=async()=>{const client=await connectSource();return{release:(...args)=>client.release(...args),query:(...args)=>{sourceSQL++;return client.query(...args);}};};
  server=await serveNativeReadPool(source,{fd,path,identity,targetPool:target});
  const client=async(expected=identity,kind='native')=>{const socket=createConnection({path});await once(socket,"connect");const value=nativeReadPoolSession(socket,expected,kind);clients.push(value);return value;};
  const first=await client(),second=await client();
  const row=await first.query("SELECT pg_backend_pid() AS pid,current_user AS name,json_value,stamp,bytes FROM public.native_fixture");
  assert.equal(row.rows[0].name,role);assert.deepEqual(row.rows[0].json_value,{$nativeDate:"literal-user-JSON"});
  assert(row.rows[0].stamp instanceof Date);assert(Buffer.isBuffer(row.rows[0].bytes));assert.deepEqual([...row.rows[0].bytes],[1,2,3]);
  assert.equal((await source.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,row.rows[0].pid);checks.push('service_and_IPC_share_one_actual_native_backend_and_lossless_row_types');
  const transaction=await first.connect();await transaction.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal((await transaction.query('SELECT n FROM public.native_fixture')).rows[0].n,1);
  await db.query('UPDATE public.native_fixture SET n=2');
  assert.equal((await transaction.query('SELECT n FROM public.native_fixture')).rows[0].n,1);
  let done=false;const waiting=second.query('SELECT n FROM public.native_fixture').then((r)=>{done=true;return r;});
  await setTimeout(30);assert.equal(done,false);await transaction.query('ROLLBACK');transaction.release();
  assert.equal((await waiting).rows[0].n,2);checks.push('same_session_repeatable_read_snapshot_and_serialized_second_client');
  const slow=await first.connect();let serviceDone=false;
  const serviceWaiting=source.query('SELECT n FROM public.native_fixture').then((value)=>{serviceDone=true;return value;});
  await setTimeout(3100);assert.equal(serviceDone,false);slow.release();assert.equal((await serviceWaiting).rows[0].n,2);
  checks.push('service_waits_outside_TCP_connect_timeout_without_extra_backend_or_restart');
  const results=await Promise.all([first.query('SELECT 1 AS n'),first.query('SELECT 2 AS n'),first.query('SELECT 3 AS n')]);
  assert.deepEqual(results.map((r)=>r.rows[0].n),[1,2,3]);checks.push('pg_pool_concurrent_query_semantics_serialize_at_max1');
  const broken=await first.connect();await broken.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await assert.rejects(broken.query('SELECT missing_column FROM public.native_fixture'),(e)=>e.code==='42703');
  await assert.rejects(broken.query('SELECT n FROM public.native_fixture'),(e)=>e.code==='25P02');
  await broken.query('ROLLBACK');broken.release();assert.equal((await first.query('SELECT n FROM public.native_fixture')).rows[0].n,2);checks.push('SQLSTATE_failed_transaction_and_genuine_rollback_preserved');
  const dying=await second.connect();await dying.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await second.end();assert.equal((await first.query('SELECT n FROM public.native_fixture')).rows[0].n,2);checks.push('disconnect_rolls_back_and_releases_exact_borrowed_native_backend');
  await assert.rejects(first.query('UPDATE public.native_fixture SET n=3'),/native_read_or_exact_snapshot/);
  await assert.rejects(first.query('WITH changed AS(DELETE FROM public.native_fixture RETURNING *)SELECT * FROM changed'),(e)=>['25006','42501'].includes(e.code));
  assert.equal((await db.query('SELECT n FROM public.native_fixture')).rows[0].n,2);checks.push('unknown_mutator_and_readonly_native_role_prevent_database_writes');
  const foreign=await client({...identity,fixtureOnly:false});await assert.rejects(foreign.query('SELECT 1'),/native_pool_query_refused/);checks.push('foreign_projector_pool_identity_refused');
  const beforeEpochSQL=sourceSQL;
  for(const change of [{invocation:'b'.repeat(32)},{pid:process.pid+1},{startTicks:identity.runtimeEpoch.startTicks+1},{bootId:'b'.repeat(36)}]){
    const stale=await client({...identity,runtimeEpoch:{...identity.runtimeEpoch,...change}});
    await assert.rejects(stale.query('SELECT n FROM public.native_fixture'),/native_pool_query_refused/);
  }
  assert.equal(sourceSQL,beforeEpochSQL);checks.push('same_config_foreign_service_epoch_refused_before_any_PG_or_delegated_SQL');
  const count=(await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE usename=$1",[role])).rows[0].n;
  assert.equal(count,1);checks.push('one_native_role_connection_despite_service_and_multiple_probes');
  const publicOne=await client(identity,'target'),publicTwo=await client(identity,'target');
  const publicPid=(await publicOne.query('SELECT pg_backend_pid() AS pid,current_user AS name')).rows[0];
  assert.equal(publicPid.name,targetRole);
  const held=await publicOne.connect();await held.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const independent=(await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;assert.notEqual(independent,publicPid.pid);
  let released=false;const queued=publicTwo.query('SELECT pg_backend_pid() AS pid').then((value)=>{released=true;return value;});
  await setTimeout(30);assert.equal(released,false);held.release();
  assert.equal((await queued).rows[0].pid,publicPid.pid);checks.push('independent_native_and_public_max1_pools_avoid_parent_callback_deadlock');
  for(const sql of ['SELECT 1;SET default_transaction_read_only=off','SELECT set_config(\'default_transaction_read_only\',\'off\',false)','SELECT pg_advisory_lock(1)'])
    await assert.rejects(publicOne.query(sql),/native_read_or_exact_snapshot/);
  assert.deepEqual((await publicOne.query("SELECT current_setting('default_transaction_read_only') AS d,current_setting('transaction_read_only') AS t")).rows,[{d:'on',t:'on'}]);
  checks.push('multi_statement_session_mutators_refused_and_DISCARD_preserves_readonly_startup');
  const roleCounts=(await admin.query('SELECT usename,count(*)::int n FROM pg_stat_activity WHERE usename=ANY($1) GROUP BY usename',[[role,targetRole]])).rows;
  assert(roleCounts.length===2&&roleCounts.every((row)=>row.n===1));checks.push('dual_owner_slots_are_one_per_role_for_all_read_probes');
}finally{
  await Promise.all(clients.map((c)=>c.end().catch(()=>{})));if(server)await server.close();if(source)await source.end();if(target)await target.end();if(db)await db.end();
  if(created)await admin.query(`DROP DATABASE ${database}`);if(ownedRole)await admin.query(`DROP ROLE ${role}`);if(ownedTargetRole)await admin.query(`DROP ROLE ${targetRole}`);await admin.end();
}
console.log(JSON.stringify({checksPassed:checks.length,checks,providerCalls:0,productionAccess:0,fixtureRemoved:true}));
