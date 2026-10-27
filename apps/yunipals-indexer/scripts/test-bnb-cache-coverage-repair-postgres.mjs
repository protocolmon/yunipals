import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { encodeEventTopics, http, toHex, zeroAddress } from "viem";
import { bsc } from "viem/chains";
import { collectionAbi } from "../lib/abi.ts";
import { transferState } from "../lib/ownership/transfer.ts";

// Local-only SQL integration test. A uniquely created PostgreSQL container has
// no network, no published ports, and a Unix socket under this test's temp dir.
// Existing containers, dependencies, lockfiles and operational helpers are untouched.
assert.equal(process.versions.node.split(".")[0], "24", "Use the pinned Node 24 runtime");
const script = fileURLToPath(import.meta.url);
const repository = resolve(dirname(script), "../../..");
const ponderEntry = import.meta.resolve("ponder");
const internal = (path) => import(new URL(path, ponderEntry));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
const start=7579197, committed=20527932, mint=20542319, transfer=20609563, rawUpper=20646033, end=rawUpper-1;
const address="0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d", alice=`0x${"22".repeat(20)}`, bob=`0x${"51".repeat(20)}`;
const tokenId=10002523084n, hash=(n)=>toHex(BigInt(n),{size:32});
const {defaultLogFilterInclude}=await internal("./runtime/filter.js");
const {getFragments}=await internal("./runtime/fragments.js");
const {encodeCheckpoint,blockToCheckpoint}=await internal("./utils/checkpoint.js");
const names=["Transfer","RoleGranted","RoleRevoked"];
const filters=names.map((name)=>({type:"log",chainId:56,sourceId:"YunipalsBnb",address,
 topic0:encodeEventTopics({abi:collectionAbi,eventName:name})[0],topic1:null,topic2:null,topic3:null,
 fromBlock:start,toBlock:undefined,hasTransactionReceipt:false,include:defaultLogFilterInclude}));
const eventCallbacks=filters.map((filter,i)=>({filter,name:`YunipalsBnb:${names[i]}`,type:"contract",
 abiItem:collectionAbi.find((item)=>item.type==="event"&&item.name===names[i]),metadata:{safeName:names[i],abi:collectionAbi}}));
const expectedIds=filters.map((f)=>`log_56_${address}_${f.topic0}_null_null_null_0`).sort();
const adjacentIds=[...new Set(filters.flatMap((f)=>getFragments(f).flatMap((p)=>p.adjacentIds)))];
const checkpoint=encodeCheckpoint(blockToCheckpoint({number:toHex(committed),timestamp:toHex(committed+1600000000)},56,"up"));
const tables=["blocks","transactions","logs","transaction_receipts","traces","factories","factory_addresses","rpc_request_results"];
// These are synthetic RPC rows at the observed heights, not exported chain data.
function fixture(n){
 const tx={hash:hash(n*100),transactionIndex:"0x0",blockNumber:toHex(n),blockHash:hash(n),from:alice,to:address,input:"0x",value:"0x0",nonce:"0x1",gas:"0x30d40",gasPrice:"0x12",type:"0x0",r:hash(2),s:hash(3),v:"0x1b"};
 const block={hash:hash(n),parentHash:hash(n-1),number:toHex(n),timestamp:toHex(1600000000+n),logsBloom:`0x${"00".repeat(256)}`,receiptsRoot:hash(300),transactions:[tx]};
 const log={address,topics:encodeEventTopics({abi:collectionAbi,eventName:"Transfer",args:{from:n===mint?zeroAddress:alice,to:n===mint?alice:bob,tokenId}}),data:"0x",blockNumber:block.number,blockHash:block.hash,transactionHash:tx.hash,transactionIndex:"0x0",logIndex:"0x0",removed:false};
 return {block,logs:[log]};
}

async function exercise(socket) {
  const { createHistoricalSync } = await internal("./sync-historical/index.js");
  const { createSyncStore } = await internal("./sync-store/index.js");
  const { createQB } = await internal("./database/queryBuilder.js");
  const { createRpc } = await internal("./rpc/index.js");
  const { createLogger } = await internal("./internal/logger.js");
  const { MetricsService } = await internal("./internal/metrics.js");
  const { createShutdown } = await internal("./internal/shutdown.js");
  const { getRequiredIntervals, getRequiredIntervalsWithFilters } = await internal("./runtime/index.js");
  const { buildEvents, decodeEvents } = await internal("./runtime/events.js");
  const schema = await internal("./sync-store/schema.js");
  const common = {
    logger: createLogger({ level: "silent", mode: "json" }), metrics: new MetricsService(),
    shutdown: createShutdown(),
    options: { factoryAddressCountThreshold: 1000, databaseMaxQueryParameters: 16_000 }
  };
  const connection = { host: socket, user: "postgres", database: "yunipals_backfill", max: 3,
    connectionTimeoutMillis: 5000, statement_timeout: 10_000 };
  let migrationCount;
  {
    const require = createRequire(ponderEntry);
    const { Kysely, Migrator, PostgresDialect, WithSchemaPlugin } = require("kysely");
    const { buildMigrationProvider } = await internal("./sync-store/migrations.js");
    const db = new Kysely({ dialect: new PostgresDialect({ pool: new pg.Pool(connection) }),
      plugins: [new WithSchemaPlugin("ponder_sync")] });
    try {
      const result = await new Migrator({ db, provider: buildMigrationProvider(common.logger),
        migrationTableSchema: "ponder_sync" }).migrateToLatest();
      if (result.error) throw result.error;
      migrationCount = result.results.length;
      assert.ok(migrationCount > 20);
    } finally { await db.destroy(); }
  }
  const pool = new pg.Pool(connection);
  const qb = createQB(drizzle(pool, { casing: "snake_case", schema }), { common });
  const syncStore = createSyncStore({ common, qb });
  const calls=[];let omitMint=true;
  const chain={id:56,name:"bnb",viemChain:bsc,finalityBlockCount:20,rpc:http("http://local-fixture.invalid",{retryCount:0,fetchFn:async(input,init)=>{
    const request=input instanceof Request?input:new Request(input,init),call=await request.json();calls.push(call);let result;
    if(call.method==="eth_getLogs") {
      const query=call.params[0],lo=Number(BigInt(query.fromBlock)),hi=Number(BigInt(query.toBlock));
      assert.ok(lo>=start&&hi<=end&&lo<=hi);
      result=[mint,transfer].filter((n)=>n>=lo&&n<=hi&&!(omitMint&&n===mint)).flatMap((n)=>fixture(n).logs);
    }else if(call.method==="eth_getBlockByNumber"){
      const n=Number(BigInt(call.params[0]));assert.ok([mint,transfer].includes(n));result=fixture(n).block;
      if(!call.params[1])result.transactions=result.transactions.map((tx)=>tx.hash);
    }else throw new Error(`Unexpected RPC ${call.method}`);
    return new Response(JSON.stringify({jsonrpc:"2.0",id:call.id,result}),{headers:{"content-type":"application/json"}});
  }})};
  const rpc=createRpc({common,chain,concurrency:2}),sync=createHistoricalSync({common,chain,rpc,childAddresses:new Map()});
  const native=async()=>(await pool.query("SELECT checkpoint,prefix FROM fixture_native WHERE chain_id=56")).rows[0];
  const snapshot=async()=>Object.fromEntries(await Promise.all(tables.map(async(table)=>[table,(await pool.query(`SELECT to_jsonb(t) AS row FROM ponder_sync.${table} t ORDER BY to_jsonb(t)::text`)).rows.map(({row})=>row)])));
  async function syncRange(tx,interval){
    const store=createSyncStore({common,qb:tx}),cachedIntervals=await store.getIntervals({filters});
    const required=getRequiredIntervalsWithFilters({filters,interval,cachedIntervals});
    const args={interval,requiredIntervals:required.intervals,requiredFactoryIntervals:required.factoryIntervals,syncStore:store};
    const logs=await sync.syncBlockRangeData(args);await sync.syncBlockData({...args,logs});
    await store.insertIntervals({intervals:required.intervals,factoryIntervals:required.factoryIntervals,chainId:56});
  }
  async function events(){
    const data=await syncStore.getEventData({filters,fromBlock:committed+1,toBlock:end,chainId:56,limit:100});
    return decodeEvents(common,chain,eventCallbacks,buildEvents({...data,eventCallbacks,childAddresses:new Map(),chainId:56})).filter((event)=>event.checkpoint>checkpoint);
  }
  const operatorPath=resolve(repository,"ops/unified-indexer-transition/source6-bnb-cache-recovery-v1.py");
  const operator=(action,value)=>execFileSync("python3",["-B","-c",
    "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('recovery',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); v=json.load(sys.stdin); print(m.snapshot_sql() if v['action']=='snapshot' else m.guarded_sql(v['before'],v['commit']))",operatorPath],
    {input:JSON.stringify({action,...value}),encoding:"utf8",timeout:5000,stdio:["pipe","pipe","pipe"],env:{PATH:"/usr/bin:/bin",LANG:"C.UTF-8"}}).trim();
  const snapshotSql=operator("snapshot",{});
  async function clip(rollback=false){
    const client=await pool.connect();
    try{
      const before=(await client.query(snapshotSql)).rows[0].jsonb_build_object;
      const sql=operator("guard",{before,commit:!rollback});
      await client.query(sql);
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  }

  try{
    await pool.query("CREATE TABLE fixture_native(chain_id integer PRIMARY KEY,checkpoint text NOT NULL,prefix jsonb NOT NULL)");
    await pool.query("INSERT INTO fixture_native VALUES(56,$1,$2)",[checkpoint,JSON.stringify({collection:"bnb",retainedTokens:17,description:"synthetic committed prefix"})]);
    await pool.query("CREATE SCHEMA unified_shadow_20261020_7e7375b0; CREATE TABLE unified_shadow_20261020_7e7375b0._ponder_meta(key text PRIMARY KEY,value jsonb); CREATE TABLE unified_shadow_20261020_7e7375b0._ponder_checkpoint(chain_id integer PRIMARY KEY,latest_checkpoint text,safe_checkpoint text,finalized_checkpoint text)");
    await pool.query("INSERT INTO unified_shadow_20261020_7e7375b0._ponder_meta VALUES('app',$1)",[JSON.stringify({build_id:"bf4939b3ff",is_locked:0,is_ready:0,fixture:true})]);
    const observed=JSON.parse(await readFile("/tmp/yunipals-bnb-mint-cache-coverage-20261022.json","utf8"));
    for(const point of observed.inventory.checkpoints)await pool.query("INSERT INTO unified_shadow_20261020_7e7375b0._ponder_checkpoint VALUES($1,$2,$2,$2)",[point.chainId,point.checkpoint]);
    const nativeTables=async()=>({prefix:await native(),checkpoints:(await pool.query("SELECT * FROM unified_shadow_20261020_7e7375b0._ponder_checkpoint ORDER BY chain_id")).rows,app:(await pool.query("SELECT * FROM unified_shadow_20261020_7e7375b0._ponder_meta")).rows});
    const beforeNative=await nativeTables();
    await qb.transaction((tx)=>syncRange(tx,[transfer,transfer]));
    await syncStore.insertIntervals({intervals:filters.map((filter)=>({filter,interval:[start,end]})),factoryIntervals:[],chainId:56});
    assert.deepEqual(getRequiredIntervals({filters,interval:[committed+1,end],cachedIntervals:await syncStore.getIntervals({filters})}),[]);
    const stale=await events();assert.equal(stale.length,1);assert.equal(stale[0].event.block.number,BigInt(transfer));
    assert.throws(()=>transferState(null,stale[0].event.args.from,stale[0].event.args.to,stale[0].event.block),/Transfer before mint/);
    const beforeCache=await snapshot(),beforeIntervals=await syncStore.getIntervals({filters});
    await clip(true);assert.deepEqual(await syncStore.getIntervals({filters}),beforeIntervals);assert.deepEqual(await snapshot(),beforeCache);
    const beforeSql=(await pool.query(snapshotSql)).rows[0].jsonb_build_object;
    const staleSql=operator("guard",{before:beforeSql,commit:true});
    await pool.query("UPDATE unified_shadow_20261020_7e7375b0._ponder_meta SET value=value||'{\"staleFixture\":true}'::jsonb WHERE key='app'");
    const staleClient=await pool.connect();
    try{await assert.rejects(staleClient.query(staleSql),/cache_repair_stale_snapshot/);await staleClient.query("ROLLBACK");}finally{staleClient.release();}
    await pool.query("UPDATE unified_shadow_20261020_7e7375b0._ponder_meta SET value=$1::jsonb WHERE key='app'",[JSON.stringify(beforeSql.app)]);
    assert.deepEqual(await nativeTables(),beforeNative);assert.deepEqual(await syncStore.getIntervals({filters}),beforeIntervals);

    await syncStore.insertIntervals({intervals:[{filter:{...filters[0],address:undefined},interval:[start,end]}],factoryIntervals:[],chainId:56});
    await assert.rejects(clip(),/exact_three_BNB_intervals_required/);
    await pool.query("DELETE FROM ponder_sync.intervals WHERE fragment_id<>ALL($1::text[])",[expectedIds]);
    await clip();assert.deepEqual(await nativeTables(),beforeNative);assert.deepEqual(await snapshot(),beforeCache);
    for(const parts of(await syncStore.getIntervals({filters})).values())assert.deepEqual(parts[0].intervals,[[start,committed]]);
    assert.deepEqual(getRequiredIntervals({filters,interval:[committed+1,end],cachedIntervals:await syncStore.getIntervals({filters})}),[[committed+1,end]]);
    await assert.rejects(clip());
    omitMint=false;const callStart=calls.length;
    await qb.transaction((tx)=>syncRange(tx,[committed+1,end]));
    assert.deepEqual(await nativeTables(),beforeNative);
    const afterCache=await snapshot();for(const table of tables)for(const row of beforeCache[table])assert.ok(afterCache[table].some((other)=>json(other)===json(row)),`retained ${table} row changed`);
    assert.equal(afterCache.logs.length,2);assert.equal(afterCache.blocks.length,2);assert.equal(afterCache.transactions.length,2);
    const repaired=await events();assert.deepEqual(repaired.map((event)=>Number(event.event.block.number)),[mint,transfer]);
    let state=null;for(const {event}of repaired)state=transferState(state,event.args.from,event.args.to,event.block);
    assert.equal(state.lifecycle,1);assert.equal(state.owner,bob);assert.equal(state.mintBlock,BigInt(mint));
    const refetch=calls.slice(callStart).filter((call)=>call.method==="eth_getLogs");assert.ok(refetch.length>0);assert.ok(refetch.every((call)=>BigInt(call.params[0].fromBlock)>BigInt(committed)));
    assert.deepEqual(getRequiredIntervals({filters,interval:[committed+1,end],cachedIntervals:await syncStore.getIntervals({filters})}),[]);
    const freshPool=new pg.Pool(connection),freshStore=createSyncStore({common,qb:createQB(drizzle(freshPool,{casing:"snake_case",schema}),{common})});
    try{assert.equal((await freshStore.getEventData({filters,fromBlock:committed+1,toBlock:end,chainId:56,limit:100})).logs.length,2);}finally{await freshPool.end();}
    return {status:"passed",migrations:migrationCount,postgres:(await pool.query("SHOW server_version")).rows[0].server_version,
      checks:["False complete coverage reproduces Transfer before mint","Exact operator SQL and guards reject broader adjacent coverage","Generated SQL refuses an app mutation after review and before commit","ROLLBACK preserves interval/data/checkpoint snapshots","Coverage-only clip exposes full uncommitted suffix via actual Ponder decoder","Repeat clip refuses stale input","All four native checkpoints, app metadata and committed prefix unchanged","Actual historical refetch adds mint and retains existing cache rows","Actual event decoder plus strict transferState processes mint before transfer","Fresh SQL connection sees persisted repaired cache"],
      boundaries:{start,committed,mint,transfer,rawUpper,decodedUpper:end},rpcCalls:calls.length,refetchCalls:refetch.length,
      actualComponents:["Ponder sync migrations","createQB","createSyncStore/getIntervals/getEventData","getFragments adjacency","getRequiredIntervals","createHistoricalSync local fixture transport","buildEvents/decodeEvents","application transferState"],
      limits:["Synthetic committed-prefix table; not full Ponder CLI or crash-recovery invocation","No live provider qualification","Only omission repair; retained cached rows assumed canonical"],operatorSha256:digest(await readFile(operatorPath)),beforeCacheSha256:digest(json(beforeCache)),afterCacheSha256:digest(json(afterCache)),checkpointSha256:digest(json(beforeNative))};
  }finally{await common.shutdown.kill();await pool.end();}
}
async function main(){
  const temporary = await mkdtemp("/tmp/yunipals-cache-repair-postgres-");
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
      "--label", "yunipals.test=cache-coverage-repair-postgres",
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
    const result=await exercise(socket),output="/tmp/yunipals-bnb-cache-coverage-repair-postgres-20261022.json";
    await writeFile(output,JSON.stringify({...result,node:process.version,docker:daemon,image,testSha256:digest(await readFile(script)),network:"none; Unix socket only",completedAt:new Date().toISOString()},null,2)+"\n");
    console.log(JSON.stringify({status:result.status,checks:result.checks.length,postgres:result.postgres,output}));
  }finally{if(container)docker("rm","--force","--volumes",container);await rm(temporary,{recursive:true,force:true});}
}
await main();
