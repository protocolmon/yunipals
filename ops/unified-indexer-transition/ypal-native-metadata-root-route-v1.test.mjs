import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
const raw=fs.readFileSync(process.argv[2]);
assert.equal(createHash('sha256').update(raw).digest('hex'),'8afd0184d8e51d920a303ecfa729354189f240b0164d5d62655fb172818cc69c');
const text=raw.toString();const start=text.indexOf('var maximumRequestBytes ='),end=text.indexOf('async function main() {',start);assert(start>=0&&end>start);
const profile='0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff';
let unifiedGateCalls=0,validatedSeed=0,freeAuthorizations=0,paidReservations=0,dispatches=[];
const context={Buffer,URL,Response,AbortController,AbortSignal,setTimeout,clearTimeout,console,
  createHash2:createHash,createServer:handler=>({handler}),unifiedRpcPath:'/unified',
  unifiedRpcProfileHeader:'x-yunipals-unified-rpc-profile',unifiedRpcPermitHeader:'x-yunipals-unified-rpc-permit',rpcBudgetWorkloadHeader:'x-yunipals-rpc-workload',
  isUnifiedRpcWorkload:value=>['unified_source','unified_evidence'].includes(value),unifiedRpcProfileId:()=>profile,
  validateUnifiedRpcCalls:(_profile,_chain,calls)=>{assert.equal(calls.length,1);assert.equal(calls[0].method,'eth_getBlockByNumber');assert.equal(calls[0].params[0],'latest');assert.equal(calls[0].params[1],true);validatedSeed++;},
  isDelegatedRpcComputeWorkload:()=>false,rpcComputeBudgetError:()=>undefined};
const create=vm.runInNewContext(text.slice(start,end)+'\ncreateRpcBudgetProxy;',context);
const head=53005121n,boundary=head-20n,slot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const budget={authorizeFreeDispatch:async()=>{freeAuthorizations++;},reserve:async()=>{paidReservations++;throw Error('paid_forbidden');},snapshot:()=>({})};
const proxy=create({upstream:new URL('https://paid.invalid'),freeUpstreams:[new URL('https://free.invalid')],freeMinimumIntervalMs:0,freeSourceMinimumIntervalMs:0,
  budget,workloadBudgets:{unified_source:budget,unified_evidence:budget},
  paidFallbackOnFreeFailure:false,foregroundPaidFallbackOnFreeFailure:false,orderPaidFallbackOnFreeFailure:false,sourcePaidFallbackOnFreeFailure:false,salePaidFallbackOnFreeFailure:false,unifiedSourcePaidPrimary:false,unifiedSourcePaidLogs:false,
  unifiedPolicy:{profile:{},chainId:8453,ready:async()=>{unifiedGateCalls++;},reservePaid:async()=>{throw Error('unexpected_unified_paid');}},
  fetch:async(url,options)=>{assert.equal(url.href,'https://free.invalid/');const call=JSON.parse(options.body.toString());dispatches.push({method:call.method,params:call.params});let result;
    if(call.method==='eth_chainId')result='0x2105';
    else if(call.method==='eth_getBlockByNumber')result={number:'0x'+(call.params[0]==='latest'?head:BigInt(call.params[0])).toString(16),hash:'0x'+'ab'.repeat(32)};
    else if(call.method==='eth_getStorageAt'){assert.equal(call.params[0],'0x98433df878e8c898cb907345c3a7756e5f72240f');assert.equal(call.params[1],slot);result='0x'+'0'.repeat(24)+'4ad380760abb9fad95cd48ef2d7c46ed5a072fca';}
    else throw Error('unexpected_method');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:call.id,result}),{status:200,headers:{'content-type':'application/json'}});}});
async function send(path,call,headers={}){const req=Readable.from([Buffer.from(JSON.stringify({jsonrpc:'2.0',id:1,...call}))]);req.method='POST';req.url=path;req.headers={'content-type':'application/json',...headers};const out={status:0,body:null,headers:{},writeHead(status,headers){this.status=status;this.headers=headers;},end(payload){this.body=JSON.parse(Buffer.from(payload).toString());},setHeader(k,v){this.headers[k]=v;}};await proxy.handler(req,out);return out;}
// The one existing source poller learns the head on /unified. Policy itself is
// separately accepted; this fixture admits only the one exact latest-header seed.
assert.equal((await send('/unified',{method:'eth_getBlockByNumber',params:['latest',true]},{'x-yunipals-unified-rpc-profile':profile,'x-yunipals-rpc-workload':'unified_source'})).status,200);
for(const call of [{method:'eth_chainId',params:[]},{method:'eth_getBlockByNumber',params:['0x'+boundary.toString(16),false]},{method:'eth_getStorageAt',params:['0x98433df878e8c898cb907345c3a7756e5f72240f',slot,'0x'+boundary.toString(16)]},{method:'eth_getBlockByNumber',params:['0x'+boundary.toString(16),false]}])assert.equal((await send('/',call)).status,200);
assert.equal(unifiedGateCalls,1);assert.equal(validatedSeed,1);assert.equal(freeAuthorizations,5);assert.equal(paidReservations,0);assert.equal(dispatches.length,5);
assert.deepEqual(dispatches.slice(1).map(x=>x.method),['eth_chainId','eth_getBlockByNumber','eth_getStorageAt','eth_getBlockByNumber']);
// A root request with unified headers is refused rather than treated as legacy.
assert.equal((await send('/',{method:'eth_chainId',params:[]},{'x-yunipals-unified-rpc-profile':profile,'x-yunipals-rpc-workload':'unified_source'})).status,403);assert.equal(dispatches.length,5);
console.log(JSON.stringify({format:'yunipals-native-metadata-root-route-offline-factory-proof-v1',passed:true,compiledArtifactSha256:createHash('sha256').update(raw).digest('hex'),seed:'one exact synthetic existing-source latest header on /unified',metadataPath:'/',nativePointCalls:4,unifiedPolicyCallsOnlyForSeed:true,rootMetadataProfileGateCalls:0,freeDispatches:5,paidReservations:0,providerCalls:0,databaseCalls:0,realSockets:0}));
