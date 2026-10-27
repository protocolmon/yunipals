// Real pinned Ponder config/schema/handlers; explicit offline RPC fixtures only.
import {createRequire,registerHooks} from 'node:module';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import net from 'node:net';
import path from 'node:path';
const project=process.cwd(),require=createRequire(realpathSync('./node_modules/ponder/package.json'));
if(require('./package.json').version!=='0.17.5')throw Error('exact_Ponder_0_17_5_required');
const entry=pathToFileURL(require.resolve('./dist/esm/index.js')),internal=p=>import(new URL(p,entry));
const sourceRoot=path.resolve(project,'../..'),viemRequire=createRequire(path.join(project,'package.json')),viemEntry=viemRequire.resolve('viem').replace('/_cjs/','/_esm/'),viemUrl=pathToFileURL(viemEntry).href;
const viemSha=createHash('sha256').update(readFileSync(viemEntry)).digest('hex');if(viemSha!=='ea32975364e9f2d599b10639d81985ec6a3ed87f6942fe0cb73b1bf738959057')throw Error('exact_retained_viem_required');
registerHooks({resolve(specifier,context,next){if(specifier==='viem'&&context.parentURL?.startsWith(pathToFileURL(path.join(sourceRoot,'packages')+path.sep).href))return next(viemUrl,context);return next(specifier,context)}});
let sockets=0,fixtures=0;net.Socket.prototype.connect=function(){sockets++;throw Error('offline_socket_forbidden')};
const policy=await import(pathToFileURL(path.resolve(project,'../../packages/yunipals-indexer-server/src/rpc-policy.ts'))),profile=JSON.parse(readFileSync(process.env.UNIFIED_RPC_PROFILE_FILE,'utf8'));
if(policy.unifiedRpcProfileId(profile)!=='0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff')throw Error('exact_combined_profile_required');
const calls=[];globalThis.fetch=async(input,options={})=>{
 const u=new URL(input),chain=({19221:1,19222:8453,19223:137,19224:56})[u.port];if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!chain)throw Error('unexpected_offline_endpoint');
 fixtures++;const headers=new Headers(options.headers);calls.push({chain,workload:headers.get('x-yunipals-rpc-workload'),path:u.pathname});
 if(u.pathname==='/unified/preflight'&&!options.method)return new Response(JSON.stringify({profileId:policy.unifiedRpcProfileId(profile),manifestHash:policy.unifiedRpcManifestId(profile),chainId:chain,coordinatorId:profile.coordinatorId,scope:profile.scope,workload:headers.get('x-yunipals-rpc-workload'),paid:'explicit_bounded_permit_only',budget:{offlineFixture:true},replay:{mode:'free_only'}}));
 if(u.pathname==='/unified'&&options.method==='POST'&&JSON.parse(options.body).method==='eth_chainId')return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x'+chain.toString(16)}));throw Error('unexpected_offline_RPC');
};
const{createBuild}=await internal('./build/index.js'),{createLogger}=await internal('./internal/logger.js'),{MetricsService}=await internal('./internal/metrics.js'),{buildOptions}=await internal('./internal/options.js'),{createShutdown}=await internal('./internal/shutdown.js');
const cliOptions={root:project,config:'ponder.config.ts',command:'start',version:'0.17.5',schema:'unified_ypal_20261023_v1',logLevel:'silent',logFormat:'json'},options=buildOptions({cliOptions}),shutdown=createShutdown();
const common={options,logger:createLogger({level:'silent',mode:'json'}),metrics:new MetricsService(),shutdown,buildShutdown:shutdown,apiShutdown:shutdown},hashes=[],started=performance.now();let config;
try{const build=await createBuild({common,cliOptions});for(const method of['executeConfig','executeSchema','executeIndexingFunctions']){const result=await build[method]();if(result.status!=='success'){console.error(result.error?.message??'public_offline_build_error');throw Error('offline_'+method+'_failed');}hashes.push(result.result.contentHash);if(method==='executeConfig')config=result.result.config;}}finally{await shutdown.kill();}
if(fixtures!==12||sockets!==0||config.database.poolConfig.max!==5)throw Error('exact_offline_build_boundary_required');
console.log(JSON.stringify({format:'yunipals-combined-YPAL-inactive-Ponder-build-v1',buildId:createHash('sha256').update('2'+hashes.join('')).digest('hex').slice(0,10),configHash:hashes[0],schemaHash:hashes[1],indexingHash:hashes[2],poolMax:5,effectivePoolMax:5,namespace:'unified_ypal_20261023_v1',contracts:Object.fromEntries(Object.entries(config.contracts).map(([name,c])=>[name,{address:c.address,startBlock:c.startBlock}])),interceptedFixtureRequests:fixtures,realProviderRequests:0,socketAttempts:sockets,viemSha256:viemSha,databaseCalls:0,elapsedMilliseconds:Math.round(performance.now()-started),uid:process.getuid(),gid:process.getgid(),calls}));
