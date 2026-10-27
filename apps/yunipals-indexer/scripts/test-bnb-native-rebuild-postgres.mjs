import assert from "node:assert/strict";
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
 const cliOptions={root:resolve(repository,"apps/yunipals-indexer"),config:"ponder.config.ts",command:"start",version:"0.17.5",schema:"native_rebuild_fixture",logLevel:"error",logFormat:"json"};
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
  const indexingBuild={buildId:"native-bnb-rebuild-v1",chains,rpcs,eventCallbacks:callbacks,
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
  // Exact reset scope: native tables only; static sources/cache and all other
  // chains preserved. Operational stale guards/backups are tested separately.
  for(const name of nativeTables){const count=(await pool.query(`SELECT count(*)::int n FROM ${ns}."_reorg__${name}"`)).rows[0].n;assert.equal(count,0,`reorg must be empty: ${name}`);}
  const restoreState=await app();assert.equal(restoreState.is_locked,0);
  await pool.query('BEGIN');
  for(const name of resetNames)await pool.query(`DELETE FROM ${ns}."${name}" WHERE ${name==='token_lifecycle'?"collection='bnb'":"chain_id=56"}`);
  await pool.query(`UPDATE ${ns}._ponder_checkpoint SET latest_checkpoint=$1,safe_checkpoint=$1,finalized_checkpoint=$1 WHERE chain_id=56`,[zero56]);
  await pool.query(`UPDATE ponder_sync.intervals SET blocks=numrange(7579197,$1,'[]')::nummultirange WHERE fragment_id LIKE 'log_56_%'`,[gap]);
  await pool.query('COMMIT');
  const resetRows=await allRows(),resetPoints=await points();
  for(const name of nativeTables)assert.deepEqual(resetRows[name],resetNames.includes(name)?beforeRows[name].filter(r=>r.chain_id!==56&&r.collection!=='bnb'):beforeRows[name],`scope ${name}`);
  assert.deepEqual(resetPoints.filter(r=>Number(r.chain_id)!==56),beforePoints.filter(r=>Number(r.chain_id)!==56));
  assert.deepEqual(await rawCache(),beforeCache);assert.deepEqual(await app(),restoreState);
  checks.push('Eight-table BNB-only reset retains all other native rows, static sources, app metadata, three checkpoints and every raw cache row');
  mode='complete';indexingBuild=await open();const migrated=await db.migrate(indexingBuild);
  assert.equal(migrated.length,4);assert.equal(migrated.find(c=>c.chainId===56).checkpoint,zero56);
  assert.deepEqual(await allRows(),resetRows);checks.push('Actual createDatabase.migrate accepts the chain56-encoded zero checkpoint and leaves native reset/other-chain data unchanged');
  const filters=indexingBuild.eventCallbacks[3].map(c=>c.filter),store=createSyncStore({common:phaseCommon,qb:db.syncQB});
  assert.deepEqual(getRequiredIntervals({filters,interval:[bnbStart,end],cachedIntervals:await store.getIntervals({filters})}),[[gap,end]]);
  // Official historical engine fetches only the invalidated suffix, then the
  // ordinary runtime replays BNB from deployment entirely through its own stores.
  const sync=createHistoricalSync({common:phaseCommon,chain:indexingBuild.chains[3],rpc:indexingBuild.rpcs[3],childAddresses:new Map()});
  const required=getRequiredIntervalsWithFilters({filters,interval:[gap,end],cachedIntervals:await store.getIntervals({filters})});
  const args={interval:[gap,end],requiredIntervals:required.intervals,requiredFactoryIntervals:required.factoryIntervals,syncStore:store};
  const repairCallStart=calls.length;const logs=await sync.syncBlockRangeData(args);await sync.syncBlockData({...args,logs});
  await store.insertIntervals({intervals:required.intervals,factoryIntervals:required.factoryIntervals,chainId:56});
  assert.ok(calls.slice(repairCallStart).filter(c=>c.method==='eth_getLogs').every(c=>Number(BigInt(c.params[0].fromBlock))>=gap));
  const replayCallStart=calls.length;
  await runMultichain({common:phaseCommon,preBuild,namespaceBuild:namespace,schemaBuild,indexingBuild,crashRecoveryCheckpoint:migrated,database:db});
  const after=await allRows(),afterPoints=await points();
  for(const name of nativeTables)assert.deepEqual(after[name].filter(r=>r.chain_id!==56&&r.collection!=='bnb'),beforeRows[name].filter(r=>r.chain_id!==56&&r.collection!=='bnb'),`other chains ${name}`);
  assert.deepEqual(afterPoints.filter(r=>Number(r.chain_id)!==56),beforePoints.filter(r=>Number(r.chain_id)!==56));
  assert.equal(after.token.filter(r=>r.collection==='bnb').length,2);assert.ok(after.token.filter(r=>r.collection==='bnb').every(r=>r.owner===bob&&r.lifecycle===1));
  assert.equal(after.token_lifecycle.filter(r=>r.collection==='bnb').length,2);
  assert.equal(after.transfer_event.filter(r=>r.chain_id===56).length,4);
  assert.equal(after.canonical_event.filter(r=>r.chain_id===56).length,5);assert.equal(after.admin_role_event.filter(r=>r.chain_id===56).length,1);assert.equal(after.chain_checkpoint.filter(r=>r.chain_id===56).length,0);assert.equal(after.chain_block.filter(r=>r.chain_id===56).length,0);
  assert.equal(after.transaction_candidate.filter(r=>r.chain_id===56).length,4);
  assert.deepEqual(after.indexer_source,beforeRows.indexer_source);
  assert.equal(calls.slice(replayCallStart).filter(c=>c.method==='eth_getLogs').length,0);
  const repairedCache=await rawCache();for(const name of Object.keys(beforeCache))for(const row of beforeCache[name])assert.ok(repairedCache[name].some(r=>json(r)===json(row)));
  checks.push('Actual runMultichain replays BNB from deployment, adds both prefix/suffix omissions, preserves lifecycle/owner/canonical/candidate semantics, skips setup and does not replay other chains');
  checks.push('Verified raw-cache prefix survives; only gap onward is refetched, and native replay makes no eth_getLogs calls');
  await close();indexingBuild=await open();const again=await db.migrate(indexingBuild);
  await runMultichain({common:phaseCommon,preBuild,namespaceBuild:namespace,schemaBuild,indexingBuild,crashRecoveryCheckpoint:again,database:db});
  assert.deepEqual(await allRows(),after);assert.deepEqual(await points(),afterPoints);checks.push('Fresh database pools plus ordinary second crash recovery are idempotent');
  return {status:'passed',checks,postgres:(await pool.query('SHOW server_version')).rows[0].server_version,zeroCheckpoint56:zero56,tables:nativeTables,resetTables:resetNames,rpcCalls:calls.length,fixture:{start:bnbStart,gap,committed,mint,end},limits:['Synthetic short historical range with actual deployment starts; not a live CLI/provider run','Operator backup/stale-input guards separate; production reorg journals must be confirmed empty','Original source cutoff and production process authority are outside this local fixture'],nativeResultSha256:digest(json(after)),cacheResultSha256:digest(json(repairedCache))};
 }finally{await close();await buildCommon.shutdown.kill();await pool.end();}
}
async function main(){
  const temporary = await mkdtemp("/tmp/yunipals-native-rebuild-postgres-");
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
    const result=await exercise(socket),output="/tmp/yunipals-bnb-native-rebuild-postgres-20261022.json";
    await writeFile(output,JSON.stringify({...result,node:process.version,docker:daemon,image,testSha256:digest(await readFile(script)),network:"none; Unix socket only",completedAt:new Date().toISOString()},null,2)+"\n");
    console.log(JSON.stringify({status:result.status,checks:result.checks.length,postgres:result.postgres,output}));
  }finally{if(container)docker("rm","--force","--volumes",container);await rm(temporary,{recursive:true,force:true});}
}
await main();
