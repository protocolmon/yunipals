import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { isTable, getTableName } from "drizzle-orm";
import { encodeEventTopics, http, toHex, zeroAddress } from "viem";
import { bsc, mainnet, base, polygon } from "viem/chains";
import { collectionAbi } from "../lib/abi.ts";
import { collections } from "../lib/constants.ts";

// Entirely disposable local PostgreSQL16. No provider, production DB or service
// calls. Actual Ponder schema compiler, migrations, multichain startup, cache,
// indexing store and application handlers run against an in-memory RPC fixture.
assert.equal(process.versions.node.split(".")[0], "24");
const script=fileURLToPath(import.meta.url),repository=resolve(dirname(script),"../../..");
const ponderEntry=import.meta.resolve("ponder"),internal=(p)=>import(new URL(p,ponderEntry));
const digest=(s)=>createHash("sha256").update(s).digest("hex");
const json=(s)=>JSON.stringify(s,(_,v)=>typeof v==="bigint"?v.toString():v);
const hash=(n)=>toHex(BigInt(n),{size:32}),alice=`0x${"22".repeat(20)}`,bob=`0x${"51".repeat(20)}`;
const bnbStart=collections.bnb.deploymentBlock,gap=bnbStart+2,committed=bnbStart+4,mint=bnbStart+5,end=bnbStart+6;
const resetNames=["token","token_lifecycle","transfer_event","admin_role_event","canonical_event","transaction_candidate","chain_checkpoint","chain_block"];
const {createBuild}=await internal("./build/index.js"),{createDatabase}=await internal("./database/index.js");
const {createLogger}=await internal("./internal/logger.js"),{MetricsService}=await internal("./internal/metrics.js");
const {buildOptions}=await internal("./internal/options.js"),{createShutdown}=await internal("./internal/shutdown.js");
const {encodeCheckpoint,ZERO_CHECKPOINT}=await internal("./utils/checkpoint.js");
const {defaultLogFilterInclude}=await internal("./runtime/filter.js");
const {createSyncStore}=await internal("./sync-store/index.js"),{createRpc}=await internal("./rpc/index.js");
const {createHistoricalSync}=await internal("./sync-historical/index.js");
const {getRequiredIntervalsWithFilters,getRequiredIntervals}=await internal("./runtime/index.js");
const {runMultichain}=await internal("./runtime/multichain.js");
const zero56=encodeCheckpoint({...ZERO_CHECKPOINT,chainId:56n});
const unwrap=(r)=>{if(r.status==="error")throw r.error;return r.result;};

async function exercise(socket){
 const cliOptions={root:resolve(repository,"apps/yunipals-indexer"),config:"ponder.config.ts",command:"start",version:"0.17.5",schema:"unified_shadow_20261020_7e7375b0",logLevel:"error",logFormat:"json"};
 const makeCommon=()=>{const shutdown=createShutdown();return {options:{...buildOptions({cliOptions}),syncEventsQuerySize:1000},logger:createLogger({level:"silent",mode:"json"}),metrics:new MetricsService(),shutdown,buildShutdown:shutdown,apiShutdown:shutdown};};
 const buildCommon=makeCommon();
 for(const key of Object.keys(process.env))if(key.startsWith("UNIFIED_")||key.startsWith("PONDER_")||key.startsWith("BOOSTER_")||key.startsWith("ARENA_")||key.startsWith("MARKET_BNB_DISCOVERY"))delete process.env[key];
 const build=await createBuild({common:buildCommon,cliOptions}),namespace=unwrap(build.namespaceCompile());
 const schema=unwrap(await build.executeSchema()).schema;
 const handlers=unwrap(await build.executeIndexingFunctions()).indexingFunctions;
 const preBuild={ordering:"multichain",databaseConfig:{kind:"postgres",poolConfig:{host:socket,user:"postgres",database:"yunipals_backfill",max:8,connectionTimeoutMillis:5000}}};
 const schemaBuild=unwrap(build.compileSchema({schema,preBuild}));
 const nativeTables=Object.values(schema).filter(isTable).map(getTableName).sort();
 const pool=new pg.Pool({...preBuild.databaseConfig.poolConfig,max:2});
 const checks=[],calls=[];let phaseCommon,db,mode="omitted",limit=committed;
 const definitions=[['ethereum',mainnet],['base',base],['polygon',polygon],['bnb',bsc]];
 const ns=namespace.schema;
 const fixture=(slug,n)=>{
  const d=collections[slug],offset=n-d.deploymentBlock,isBnb=slug==='bnb';
  const tx={hash:hash(d.chainId*100000000000+n),transactionIndex:"0x0",blockNumber:toHex(n),blockHash:hash(d.chainId*100000000+n),from:alice,to:d.address,input:"0x",value:"0x0",nonce:"0x1",gas:"0x30d40",gasPrice:"0x12",type:"0x0",r:hash(2),s:hash(3),v:"0x1b"};
  const block={hash:tx.blockHash,parentHash:hash(d.chainId*100000000+n-1),number:toHex(n),timestamp:toHex(1600000000+n),logsBloom:`0x${"00".repeat(256)}`,receiptsRoot:hash(300),transactions:[tx]};
  let logs=[];
  if(offset===0||(isBnb&&[2,5,6].includes(offset))){
   const tokenId=offset>=5?2n:1n,isMint=offset===0||offset===5;
   logs=[{address:d.address,topics:encodeEventTopics({abi:collectionAbi,eventName:"Transfer",args:{from:isMint?zeroAddress:alice,to:isMint?alice:bob,tokenId}}),data:"0x",blockNumber:block.number,blockHash:block.hash,transactionHash:tx.hash,transactionIndex:"0x0",logIndex:"0x0",removed:false}];
  }
  if(isBnb&&offset===1)logs=[{address:d.address,topics:encodeEventTopics({abi:collectionAbi,eventName:"RoleGranted",args:{role:hash(0),account:alice,sender:bob}}),data:"0x",blockNumber:block.number,blockHash:block.hash,transactionHash:tx.hash,transactionIndex:"0x0",logIndex:"0x0",removed:false}];
  return {block,logs};
 };
 const allRows=async()=>{
  const result={};for(const name of nativeTables)result[name]=(await pool.query(`SELECT to_jsonb(t) row FROM ${ns}."${name}" t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);return result;
 };
 const points=async()=>(await pool.query(`SELECT * FROM ${ns}._ponder_checkpoint ORDER BY chain_id`)).rows;
 const app=async()=>(await pool.query(`SELECT value FROM ${ns}._ponder_meta WHERE key='app'`)).rows[0].value;
 const rawCache=async()=>{
  const result={};for(const name of ["blocks","transactions","logs","transaction_receipts","traces","factory_addresses","rpc_request_results"])
   result[name]=(await pool.query(`SELECT to_jsonb(t) row FROM ponder_sync.${name} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.row);return result;
 };
 async function open(){
  phaseCommon=makeCommon();db=createDatabase({common:phaseCommon,namespace,preBuild,schemaBuild});
  const chains=definitions.map(([slug,viemChain])=>{
   const d=collections[slug];return {id:d.chainId,name:slug,viemChain,finalityBlockCount:20,pollingInterval:1000,disableCache:false,rpc:http("http://local-fixture.invalid",{retryCount:0,fetchFn:async(input,init)=>{
    const call=await(input instanceof Request?input:new Request(input,init)).json();calls.push({chainId:d.chainId,method:call.method,params:call.params});let result;
    if(call.method==="eth_getBlockByNumber"){
     assert.match(call.params[0],/^0x[0-9a-f]+$/);const n=Number(BigInt(call.params[0]));result=fixture(slug,n).block;
     if(!call.params[1])result.transactions=result.transactions.map(t=>t.hash);
    }else if(call.method==="eth_getLogs"){
     const q=call.params[0],lo=Number(BigInt(q.fromBlock)),hi=Number(BigInt(q.toBlock));
     assert.ok(lo>=d.deploymentBlock&&hi<d.deploymentBlock+10);
     result=Array.from({length:hi-lo+1},(_,i)=>lo+i).filter(n=>!(slug==='bnb'&&mode==='omitted'&&[gap,mint].includes(n))).flatMap(n=>fixture(slug,n).logs);
    }else throw Error(`Unexpected fixture RPC ${call.method}`);
    return new Response(JSON.stringify({jsonrpc:"2.0",id:call.id,result}),{headers:{"content-type":"application/json"}});
   }})};
  });
  const rpcs=chains.map(chain=>createRpc({common:phaseCommon,chain,concurrency:2}));
  const callbacks=chains.map((chain,i)=>{
   const slug=definitions[i][0],d=collections[slug],contract=`Yunipals${slug==='bnb'?'Bnb':slug[0].toUpperCase()+slug.slice(1)}`;
   return ["Transfer","RoleGranted","RoleRevoked"].map(name=>({
    type:"contract",name:`${contract}:${name}`,fn:handlers.find(h=>h.name===`${contract}:${name}`).fn,
    filter:{type:"log",chainId:chain.id,sourceId:contract,address:d.address,topic0:encodeEventTopics({abi:collectionAbi,eventName:name})[0],topic1:null,topic2:null,topic3:null,fromBlock:d.deploymentBlock,toBlock:slug==='bnb'?limit:d.deploymentBlock+1,hasTransactionReceipt:false,include:defaultLogFilterInclude},
    abiItem:collectionAbi.find(item=>item.type==='event'&&item.name===name),metadata:{safeName:name,abi:collectionAbi}
   }));
  });
  const indexingBuild={buildId:"bf4939b3ff",chains,rpcs,eventCallbacks:callbacks,
   setupCallbacks:chains.map((chain,i)=>[{name:`Fixture${chain.id}:setup`,fn:async()=>{throw Error('Setup unexpectedly repeated');},filter:{chainId:chain.id},chain}]),
   contracts:chains.map(()=>({})),indexingFunctions:handlers,
   finalizedBlocks:chains.map((c,i)=>fixture(definitions[i][0],i===3?limit:collections[definitions[i][0]].deploymentBlock+1).block)};
  return indexingBuild;
 }
 async function close(){if(phaseCommon){await phaseCommon.shutdown.kill();phaseCommon.metrics.registry.clear();phaseCommon=undefined;}}
 async function seed(indexingBuild){
  const store=createSyncStore({common:phaseCommon,qb:db.syncQB});
  for(let i=0;i<indexingBuild.chains.length;i++){
   const chain=indexingBuild.chains[i],filters=indexingBuild.eventCallbacks[i].map(c=>({...c.filter,toBlock:definitions[i][0]==='bnb'?end:c.filter.toBlock})),slug=definitions[i][0],start=collections[slug].deploymentBlock;
   const sync=createHistoricalSync({common:phaseCommon,chain,rpc:indexingBuild.rpcs[i],childAddresses:new Map()});
   // Fetch real fixture rows in small ranges, then create the observed false
   // complete-coverage state. Existing cache row retention is tested below.
   const blockList=slug==='bnb'?[start,start+1,end]:[start];
   for(const n of blockList){
    const args={interval:[n,n],requiredIntervals:filters.map(filter=>({filter,interval:[n,n]})),requiredFactoryIntervals:[],syncStore:store};
    const logs=await sync.syncBlockRangeData(args);await sync.syncBlockData({...args,logs});
   }
   await store.insertIntervals({intervals:filters.map(filter=>({filter,interval:[start,slug==='bnb'?end:start+1]})),factoryIntervals:[],chainId:chain.id});
  }
 }
 try{
  let indexingBuild=await open();await db.migrateSync();
  assert.equal(await db.migrate(indexingBuild),undefined);
  // Seed the actual static source rows through the compiled application setup.
  for(const [slug]of definitions){const contract=`Yunipals${slug==='bnb'?'Bnb':slug[0].toUpperCase()+slug.slice(1)}`;
   await handlers.find(h=>h.name===`${contract}:setup`).fn({context:{chain:{id:collections[slug].chainId},db:{insert:table=>({values:row=>db.userQB.wrap(d=>d.insert(table).values(row))})}}});
  }
  // Synthetic witness rows use the actual compiled column types and exercise
  // both BNB witness-table deletions; other-chain witnesses must survive.
  for(const [slug]of definitions){const d=collections[slug],block=fixture(slug,d.deploymentBlock).block;
   const values={id:String(d.chainId),chainId:d.chainId,blockNumber:BigInt(d.deploymentBlock),blockHash:block.hash,parentHash:block.parentHash,timestamp:BigInt(block.timestamp)};
   await db.userQB.wrap(q=>q.insert(schema.chainCheckpoint).values(values));
   await db.userQB.wrap(q=>q.insert(schema.chainBlock).values({...values,id:`${d.chainId}:${d.deploymentBlock}`}));
  }
  await seed(indexingBuild);
  // Nonempty checkpoint array suppresses whole-app setup, matching recovery.
  // At this phase every chain deliberately starts from its chain-specific zero.
  const initial=indexingBuild.chains.map(c=>({chainId:c.id,checkpoint:encodeCheckpoint({...ZERO_CHECKPOINT,chainId:BigInt(c.id)})}));
  await runMultichain({common:phaseCommon,preBuild,namespaceBuild:namespace,schemaBuild,indexingBuild,crashRecoveryCheckpoint:initial,database:db});
  const beforeRows=await allRows(),beforePoints=await points(),beforeCache=await rawCache();
  assert.equal(beforeRows.token.find(r=>r.collection==='bnb').owner,alice);
  assert.equal(beforeRows.transfer_event.filter(r=>r.collection==='bnb').length,1);
  assert.equal(beforePoints.length,4);for(const name of resetNames)assert.ok(beforeRows[name].some(r=>r.chain_id===56||r.collection==='bnb'),`nonempty reset table ${name}`);checks.push('Actual multichain runtime and application handlers persist a synthetic stale BNB prefix alongside three intact chains');
  await close();limit=end;indexingBuild=await open();
  const recovery=await db.migrate(indexingBuild);assert.equal(recovery.length,4);
  await assert.rejects(runMultichain({common:phaseCommon,preBuild,namespaceBuild:namespace,schemaBuild,indexingBuild,crashRecoveryCheckpoint:recovery,database:db}),/Transfer before mint/);
  assert.deepEqual(await allRows(),beforeRows);assert.deepEqual(await points(),beforePoints);
  checks.push('Ordinary startup reproduces Transfer before mint and rolls back native changes/checkpoint atomically');
  await close();
  const operatorPath=resolve(repository,"ops/unified-indexer-transition/source6-bnb-native-recovery-v1.py");
  const operatorSha=digest(await readFile(operatorPath));
  const operator=(action,value={})=>{assert.equal(digest(readFileSync(operatorPath)),operatorSha,'Operator must remain frozen during fixture');return execFileSync('python3',['-B','-c',
   "import importlib.util,json,sys;s=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);v=json.load(sys.stdin);a=v['action'];print(m.snapshot_sql() if a=='snapshot' else m.backup_query(v['before']) if a=='backup' else m.guarded_sql(v['before'],v.get('commit',False)) if a=='guard' else json.dumps(m.validate_snapshot(v['before'],v.get('repaired',False))))",operatorPath],
   {input:JSON.stringify({action,...value}),encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']}).trim();};
  const originalCheckpoint='166076236700000000000000560000000020527932999999999999999999999999999999999';
  await pool.query(`UPDATE ${ns}._ponder_checkpoint SET latest_checkpoint=$1,safe_checkpoint=$1,finalized_checkpoint=$1 WHERE chain_id=56`,[originalCheckpoint]);
  await pool.query("UPDATE ponder_sync.intervals SET blocks=nummultirange(numrange(7579197,20646033,'[]')) WHERE chain_id=56");
  const snapSql=operator('snapshot'),snapshot=async()=>(await pool.query(snapSql)).rows[0].jsonb_build_object;
  const before=await snapshot();operator('validate',{before});
  const exactRows=await allRows(),exactCache=await rawCache(),exactPoints=await points();
  checks.push('Generated native operator snapshot accepts real Ponder21-table schema, empty journals/triggers and exact production boundary shape');
  const client=await pool.connect();
  try{
   await client.query(operator('guard',{before,commit:false}));
   assert.deepEqual(await snapshot(),before);assert.deepEqual(await allRows(),exactRows);assert.deepEqual(await rawCache(),exactCache);
   checks.push('Exact generated operator ROLLBACK preserves every native row/checkpoint/cache row');
   await pool.query(`UPDATE ${ns}.token SET owner=$1 WHERE collection='bnb' AND token_id='1'`,[bob]);
   await assert.rejects(client.query(operator('guard',{before,commit:true})),/native_repair_stale_snapshot/);await client.query('ROLLBACK');
   await pool.query(`UPDATE ${ns}.token SET owner=$1 WHERE collection='bnb' AND token_id='1'`,[alice]);
   assert.deepEqual(await snapshot(),before);checks.push('Equal-count BNB row change is refused by generated SQL inside the locked transaction');
   await pool.query(`INSERT INTO ${ns}._reorg__token SELECT (jsonb_populate_record(NULL::${ns}._reorg__token,to_jsonb(t)||$1::jsonb)).* FROM ${ns}.token t WHERE collection='ethereum' LIMIT 1`,[JSON.stringify({checkpoint:originalCheckpoint,operation:1,operation_id:999999})]);
   const withJournal=await snapshot();assert.equal(withJournal.reorgJournalCounts.token,1);
   assert.throws(()=>operator('validate',{before:withJournal}),/historical_no_journals_triggers_or_cross_chain_dependencies_required/);
   await assert.rejects(client.query(operator('guard',{before,commit:true})),/native_repair_stale_snapshot/);await client.query('ROLLBACK');
   await pool.query(`DELETE FROM ${ns}._reorg__token WHERE operation_id=999999`);assert.deepEqual(await snapshot(),before);
   checks.push('Unexpected other-chain reorg journal refuses both reviewed eligibility and stale generated mutation');

   // Exercise the exact consistent-backup SQL with native COPY framing. No raw
   // ownership rows are printed or exported beyond this disposable container.
   const copy=execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',process.env.BNB_FIXTURE_CONTAINER,'psql','-U','postgres','-d','yunipals_backfill','-X','-qAt','-v','ON_ERROR_STOP=1'],
    {input:operator('backup',{before}),encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
   const archived=copy.trim().split('\n').map(line=>{const at=line.indexOf('\t');assert.ok(at>0);return {table:line.slice(0,at),text:line.slice(at+1)};});
   assert.equal(archived.length,Object.values(before.nativeTables).reduce((n,r)=>n+r.selected,0)+1);
   assert.deepEqual(new Set(archived.map(r=>r.table)),new Set([...resetNames,'_ponder_checkpoint']));
   assert.deepEqual(await snapshot(),before);checks.push('Exact operator backup COPY works read-only against native schema and returns all selected rows/checkpoint with no mutation');
   await client.query(operator('guard',{before,commit:true}));
   const after=await snapshot();operator('validate',{before:after,repaired:true});
   assert.deepEqual(await rawCache(),exactCache);
   const afterRows=await allRows();for(const name of nativeTables)assert.deepEqual(afterRows[name],resetNames.includes(name)?exactRows[name].filter(r=>r.chain_id!==56&&r.collection!=='bnb'):exactRows[name]);
   assert.deepEqual((await points()).filter(r=>Number(r.chain_id)!==56),exactPoints.filter(r=>Number(r.chain_id)!==56));
   assert.equal(after.checkpoints.find(r=>Number(r.chain_id)===56).safe_checkpoint,zero56);
   assert.ok(after.intervals.filter(r=>r.chain_id===56).every(r=>r.ranges==='{[7579197,19496903]}'));
   checks.push('Exact generated COMMIT changes only8 BNB subsets, one chain-specific checkpoint and three coverage rows');
   await assert.rejects(client.query(operator('guard',{before,commit:true})),/native_repair_stale_snapshot/);await client.query('ROLLBACK');
   checks.push('Repeated stale mutation is refused after commit');
   const restore='BEGIN; CREATE TEMP TABLE fixture_restore(table_name text,row_data jsonb) ON COMMIT DROP;\nCOPY fixture_restore FROM STDIN;\n'+copy+'\\.\n'+
    resetNames.map(name=>`INSERT INTO ${ns}."${name}" SELECT (jsonb_populate_record(NULL::${ns}."${name}",row_data)).* FROM fixture_restore WHERE table_name='${name}';`).join('\n')+
    `\nUPDATE ${ns}._ponder_checkpoint c SET latest_checkpoint=r.row_data->>'latest_checkpoint',safe_checkpoint=r.row_data->>'safe_checkpoint',finalized_checkpoint=r.row_data->>'finalized_checkpoint' FROM fixture_restore r WHERE r.table_name='_ponder_checkpoint' AND c.chain_id=56;`+
    `\nUPDATE ponder_sync.intervals SET blocks=nummultirange(numrange(7579197,20646033,'[]')) WHERE chain_id=56;\n`+snapSql+';\nROLLBACK;';
   const restored=execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',process.env.BNB_FIXTURE_CONTAINER,'psql','-U','postgres','-d','yunipals_backfill','-X','-qAt','-v','ON_ERROR_STOP=1'],
    {input:restore,encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
   assert.deepEqual(JSON.parse(restored),before);assert.deepEqual(await snapshot(),after);
   checks.push('Actual COPY archive round-trips all8 typed native tables/checkpoint and review ranges exactly inside a rollback-only restore rehearsal');
   assert.equal(digest(await readFile(operatorPath)),operatorSha);
   return {status:'passed',checks,postgres:(await pool.query('SHOW server_version')).rows[0].server_version,operatorSha256:operatorSha,zeroCheckpoint56:zero56,resetTables:resetNames,archivedRows:archived.length,limits:['Synthetic native row contents with actual schema and production checkpoint/coverage shape','Tests generated SQL and COPY only; process identity/financial authority/systemd/backup filesystem operations not invoked']};
  }finally{client.release();}
 }finally{await close();await buildCommon.shutdown.kill();await pool.end();}
}
async function main(){
  const temporary = await mkdtemp("/tmp/yunipals-native-operator-postgres-");
  const dockerEnv = { ...process.env };
  for (const name of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete dockerEnv[name];
  const docker = (...args) => execFileSync("docker", ["--host=unix:///var/run/docker.sock", ...args],
    { env: dockerEnv, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  let container;
  try {
    const daemon = docker("info", "--format", "{{.ServerVersion}}");
    const image = docker("image", "inspect", "postgres:16.15", "--format", "{{.Id}}");
    const socket = join(temporary, "socket");
    await chmod(temporary, 0o755);
    await mkdir(socket, { mode: 0o777 });
    await chmod(socket, 0o777);
    container = docker("run", "--detach", "--pull=never", "--network=none", "--memory=512m", "--cpus=1", "--pids-limit=128",
      "--label", "yunipals.test=native-rebuild-postgres",
      "--mount", `type=bind,src=${socket},dst=/var/run/postgresql`,
      "-e", "POSTGRES_USER=postgres", "-e", "POSTGRES_DB=postgres",
      "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16.15", "postgres", "-c", "listen_addresses=");
    assert.match(container, /^[a-f0-9]{64}$/);
    // The image starts a temporary socket-only server for initdb and then
    // restarts it. Do not connect until that temporary server has stopped.
    let initialized = false;
    for (let i = 0; i < 80; i++) {
      if (docker("logs", container).includes("PostgreSQL init process complete; ready for start up.")) {
        initialized = true;
        break;
      }
      await new Promise((done) => setTimeout(done, 250));
    }
    assert.ok(initialized, "Isolated PostgreSQL initialization timed out");
    let ready = false;
    for (let i = 0; i < 80; i++) {
      const client = new pg.Client({ host: socket, user: "postgres", database: "postgres", connectionTimeoutMillis: 500 });
      client.on("error", () => {});
      try {
        await client.connect();
        await client.query("CREATE DATABASE yunipals_backfill");
        ready = true;
        break;
      } catch { await new Promise((done) => setTimeout(done, 250)); }
      finally { await client.end(); }
    }
    assert.ok(ready, "Isolated PostgreSQL did not become ready");
    process.env.BNB_FIXTURE_CONTAINER=container;
    const result=await exercise(socket),output="/tmp/yunipals-bnb-native-operator-postgres-20261022.json";
    await writeFile(output,JSON.stringify({...result,node:process.version,docker:daemon,image,testSha256:digest(await readFile(script)),network:"none; Unix socket only",completedAt:new Date().toISOString()},null,2)+"\n");
    console.log(JSON.stringify({status:result.status,checks:result.checks.length,postgres:result.postgres,output}));
  }finally{if(container)docker("rm","--force","--volumes",container);await rm(temporary,{recursive:true,force:true});}
}
await main();
