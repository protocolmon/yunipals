// Exact node-postgres PGAPPNAME behavior and same-role backend termination on
// the existing isolated PostgreSQL16 fixture. No providers/production involved.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const root='/root/yunipals',require=createRequire(root+'/apps/yunipals-indexer/package.json');
const {Pool,Client}=require('pg'),suffix=randomBytes(5).toString('hex');
const database='gen_capacity_'+suffix,actor='gen_actor_'+suffix,password=randomBytes(20).toString('hex');
const admin=new Pool({connectionString:'postgresql://unified_test:unified_disposable_test@127.0.0.1:56967/postgres',max:1});
let created=false,role=false,pool,client,other;
try{
 await admin.query(`CREATE ROLE ${actor} LOGIN PASSWORD '${password}'`);role=true;
 await admin.query(`CREATE DATABASE ${database} OWNER unified_test`);created=true;
 const url=`postgresql://${actor}:${password}@127.0.0.1:56967/${database}`;
 const app='yunipals_generation_v4_20261022';process.env.PGAPPNAME=app;
 // Same shape as the unchanged official offchain worker pool: no explicit
 // application_name option. pg must obtain the unique value from PGAPPNAME.
 pool=new Pool({connectionString:url,max:1});client=await pool.connect();client.on('error',()=>{});
 const context=(await client.query("SELECT current_user AS role,current_setting('application_name')AS app,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user)AS super,(SELECT pg_has_role(current_user,'pg_signal_backend','MEMBER'))AS signal")).rows[0];
 assert.deepEqual(context,{role:actor,app,super:false,signal:false});
 other=new Client({connectionString:url,application_name:app+'_other'});await other.connect();
 const otherPid=(await other.query('SELECT pg_backend_pid()AS pid')).rows[0].pid;
 const pending=client.query('SELECT pg_sleep(30)').then(()=>({ok:true}),error=>({ok:false,code:error.code}));
 const raw=execFileSync('/usr/bin/python3',['-I','-B','-c',`import importlib.util
s=importlib.util.spec_from_file_location('w','${root}/ops/unified-indexer-transition/consumer-generation-v4-capacity-watch.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.CANCEL_JS)`],{encoding:'utf8',timeout:5000});
 const code=raw.replaceAll('/opt/yunipals-unified/releases/41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b/apps/yunipals-indexer/package.json',root+'/apps/yunipals-indexer/package.json')
  .replaceAll("context.role!=='yunipals'",`context.role!=='${actor}'`).replaceAll("context.database!=='yunipals_backfill'",`context.database!=='${database}'`);
 async function cancel(since){
  const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',PGAPPNAME:app+'_guard',DATABASE_URL:url}});
  let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.stdin.end(JSON.stringify({app,since,terminate:true}));
  const exit=await new Promise(resolve=>child.on('exit',resolve));assert.equal(exit,0,err);assert.equal(err,'');return JSON.parse(out);
 }
 const protectedFuture=await cancel(Date.now()/1000+3600);assert.deepEqual(protectedFuture.rows,[]);
 assert((await admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND datname=$2',[app,database])).rowCount===1);
 const killed=await cancel(Date.now()/1000-60);assert.equal(killed.rows.length,1);assert.equal(killed.rows[0].terminated,true);
 const result=await pending;assert.equal(result.ok,false);assert.equal(result.code,'57P01');
 assert.equal((await other.query('SELECT pg_backend_pid()AS pid')).rows[0].pid,otherPid);
 console.log(JSON.stringify({passed:true,checks:['official_pool_uses_PGAPPNAME','worker_is_nonsuperuser_without_signal_grant','exact_same_role_backend_termination_works','backend_start_window_protects_old_sessions','foreign_application_backend_untouched'],productionCalls:0,providerCalls:0}));
}finally{
 client?.release(true);await pool?.end();await other?.end().catch(()=>{});
 if(created)await admin.query(`DROP DATABASE ${database} WITH(FORCE)`);
 if(role)await admin.query(`DROP ROLE ${actor}`);await admin.end();
}
