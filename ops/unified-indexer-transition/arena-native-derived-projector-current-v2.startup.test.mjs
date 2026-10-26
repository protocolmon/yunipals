// Real startup bytes/hashes; only host/FD authorization and post-auth SQL clients are fixtures.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import * as original from './arena-native-derived-projector-v1.mjs';
import * as realObserver from './arena-native-derived-boundary-diagnostic-v1.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
if(typeof vm.SourceTextModule!=='function'){
 const child=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(import.meta.url)],{stdio:'inherit'});
 process.exit(child.status??1);
}
const sha=(raw)=>createHash('sha256').update(raw).digest('hex');
const ops='/opt/yunipals-unified/operations/free-replay-20261020/';
const target='/opt/yunipals-unified/arena-recovery-support/8b94c5c50da8adc1673e7d3971a374e8fef54c7c4f98323b8bd49ce72b542a99/dist/';
const paths=new Map([
 [ops+'arena-native-derived-boundary-diagnostic-v1.mjs',path.join(here,'arena-native-derived-boundary-diagnostic-v1.mjs')],
 [target+'arena-native-derived-projector-v1.mjs','/tmp/arena-native-derived-support-credentials-v2-20261025/dist/arena-native-derived-projector-v1.mjs'],
 [target+'arena-inverse-support.mjs','/tmp/arena-native-derived-support-credentials-v2-20261025/dist/arena-inverse-support.mjs']]);
const expected=['6a97f5c6cc37bd4790ef0f9b15438652fc7ba3580de5aad0af4faa16fcadbed7',
 '37c17e1bdaf22bfecd930ff97da8e6eb7b8337f57469cb16d487e0f6c77be319','08905983dc0f5556190d311fd648eecc9ebfea4c958e607902a93ac7a2ad24ba'];
for(const [index,local]of[...paths.values()].entries()){
 const bytes=readFileSync(local);assert.equal(Buffer.isBuffer(bytes),true);assert.equal(sha(bytes),expected[index]);
 assert.notEqual(sha(Buffer.from(JSON.stringify(bytes))),expected[index]);
}
const H=(char)=>'0x'+char.repeat(64),contract='0x'+'a'.repeat(40);
const config={format:original.FORMAT+'-config',native:{contract,startBlock:'1',releaseId:H('1'),abiHash:H('2'),manifestHash:H('3'),
 sourceId:'arena:8453:'+contract,schema:'unified_ypal_20261023_v1',schemaOid:'75963410',buildId:'71e2a7f3b7'},
 sourceRole:{name:'arena_native_reader',oid:700},maximumBlocks:100,maximumEvents:100,pollMilliseconds:10000,provision:{},nativeReadPoolFd:4,publicReadPoolFd:5};
async function startup(version,mutated=null){
 const events=[],output=[],context=vm.createContext({Buffer,console:{log:(line)=>output.push(line)},process:{argv:['node','/fixture/no-auto-entry.mjs']}});
 async function synthetic(values){
  const module=new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value]of Object.entries(values))this.setExport(key,value);},{context});
  await module.link(()=>{});await module.evaluate();return module;
 }
 const observer={...realObserver,guardedConfig:(fd)=>{events.push(['guard',fd]);assert.equal(fd,3);return structuredClone(config);}};
 const projector={...original,inspectCurrent:async()=>{events.push(['inspection']);
  for(const key of paths.keys())assert.ok(events.some((row)=>row[0]==='read'&&row[1]===key),'all actual byte guards precede SQL fixture');
  return{validated:true,databaseWrites:0,providerCalls:0};}};
 const support={nativeReadPoolClient:()=>({end:async()=>events.push(['native-end'])}),publicReadPoolClient:()=>({end:async()=>events.push(['target-end'])})};
 const source=readFileSync(path.join(here,`arena-native-derived-projector-current-v${version}.mjs`),'utf8');
 const identifier=pathToFileURL(path.join(here,`arena-native-derived-projector-current-v${version}.mjs`)).href;
 const module=new vm.SourceTextModule(source,{context,identifier,
  initializeImportMeta(meta){meta.url=identifier;},
  importModuleDynamically:async(url)=>{
   events.push(['import',url]);const name=fileURLToPath(url);
   if(name===ops+'arena-native-derived-boundary-diagnostic-v1.mjs')return synthetic(observer);
   if(name===target+'arena-native-derived-projector-v1.mjs')return synthetic(projector);
   if(name===target+'arena-inverse-support.mjs')return synthetic(support);
   throw Error('unknown actual runtime import');
  }});
 await module.link(async(name)=>{
  const values={...await import(name)};
  if(name==='node:fs')values.readFileSync=(filename,...args)=>{
   assert.ok(paths.has(String(filename)),'only exact real byte input may be relocated');events.push(['read',String(filename)]);
   const raw=readFileSync(paths.get(String(filename)),...args);
   if(String(filename)===mutated){const changed=Buffer.from(raw);changed[0]^=1;return changed;}
   return raw;
  };
  return synthetic(values);
 });
 await module.evaluate();let error=null;
 try{await module.namespace.main(['--current','--config-fd','3']);}catch(failure){error=failure;}
 return{events,output,error};
}
let checks=0;
{
 const failed=await startup(1);assert.equal(failed.error.message,'actual_frozen_observational_wrapper_required');
 assert.equal(failed.events.some((row)=>row[0]==='inspection'),false);checks++;
}
{
 const success=await startup(2);assert.equal(success.error,null);assert.equal(success.output.length,1);
 const result=JSON.parse(success.output[0]);assert.equal(result.format,'yunipals-arena-native-derived-projector-current-v2');
 assert.equal(result.validated,true);assert.equal(result.originalOwner3CapturePassed,false);
 assert.equal(success.events.filter((row)=>row[0]==='inspection').length,1);
 assert.equal(success.events.filter((row)=>row[0]==='guard').length,1);checks++;
}
for(const input of paths.keys()){
 const failed=await startup(2,input);assert.ok(failed.error);assert.equal(failed.events.some((row)=>row[0]==='inspection'),false);checks++;
}
console.log(JSON.stringify({startupControls:checks,realBufferInputs:3,hostFDAndSQLAreExplicitFixtureSeams:true,actualRuntimeQualification:false}));
