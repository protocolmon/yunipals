#!/usr/bin/env python3
"""Resume retained combined replay with Base concurrency one and its original deadline."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import time
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-source6-base-priority-resume-20261022')
AREA=OPS/'source6-base-priority'
PAUSED=Path('/var/backups/yunipals-source6-booster-priority-pause-20261022/paused.json')
PAUSE_SHA='fb8e02600eec6167dd1dad7354aba65878f247a594b931fc0b6cea99bf653e2e'
HELPER_SHA='5b4cf30f042ccdd436407c5bdabbe82d90d1b8cdaa626af4ec0de76d88da314d'
RPC_SHA='1b9ff9fc67138d008bab65626228cef3b3c6e664e74a32d23ec36c82077c9ba8'
FORMAT='yunipals-source6-base-priority-resume'


def fail(code):raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encode(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()


def module():
    p=OPS/'source6-heap-resume.py';raw=p.read_bytes()
    if sha(raw)!=HELPER_SHA:fail('frozen_source_primitives_required')
    s=types.ModuleType('source_heap_primitives');s.__file__=str(p);exec(compile(raw,str(p),'exec'),s.__dict__)
    if sha(s.protected(p))!=HELPER_SHA:fail('protected_source_primitives_required')
    return s


def paused(s):
    raw=s.protected(PAUSED);saved=json.loads(raw);p=s.unit();command=s.argv();command.insert(3,'--max-old-space-size=4096')
    if sha(raw)!=PAUSE_SHA or saved.get('paused')is not True or not saved.get('originalDeadlineRetained'):fail('exact_actual_pause_acknowledgement_required')
    if p['MainPID']!='0'or p['ActiveState']!='inactive'or p['SubState']!='dead'or p['InvocationID']or s.job()!=0 or p['command']!=' '.join(command)or p['DropInPaths']!=str(s.DROP):fail('retained_source_must_remain_stopped')
    if sha(s.protected(s.ORIGINAL))!=saved['originalUnitSha256']or sha(s.protected(s.DROP))!=saved['sourceDropSha256']:fail('retained_original_and_heap_drop_required')
    if Path('/proc/547450').exists():fail('original_source_process_must_be_absent')
    if time.monotonic_ns()//1000+300_000_000>=saved['expiresMonotonicMicroseconds']:fail('original_source_window_has_insufficient_time')
    return saved


def bindings(s):
    old=(str(OPS/'source6-rpc-file-v3/rpc-preflight.ts')+':'+str(s.WORK/'apps/yunipals-indexer/lib/unified/rpc-preflight.ts'))
    rows=[line for line in s.protected(s.ORIGINAL).decode().splitlines()if line.startswith('BindReadOnlyPaths=')and line!='BindReadOnlyPaths=']
    if not rows or sum(line.count(old)for line in rows)!=1:fail('exact_retained_source_rpc_bind_required')
    new=str(AREA/'rpc-preflight.ts')+':'+str(s.WORK/'apps/yunipals-indexer/lib/unified/rpc-preflight.ts')
    return [line.replace(old,new)for line in rows]


PROBE="""import{readFileSync,realpathSync}from'node:fs';import{createHash}from'node:crypto';import{createRequire}from'node:module';import path from'node:path';import{pathToFileURL}from'node:url';
const project=process.cwd(),require=createRequire(realpathSync('./node_modules/ponder/package.json')),entry=pathToFileURL(require.resolve('./dist/esm/index.js')),internal=p=>import(new URL(p,entry));const policy=await import(pathToFileURL(path.resolve(project,'../../packages/yunipals-indexer-server/src/rpc-policy.ts'))),profile=JSON.parse(readFileSync(process.env.UNIFIED_RPC_PROFILE_FILE,'utf8'));let calls=0;
globalThis.fetch=async(input,options={})=>{const u=new URL(input),chain=({19201:1,19202:8453,19203:137,19204:56})[u.port];if(u.hostname!=='127.0.0.1'||!chain)throw Error('offline_only');calls++;
if(u.pathname==='/unified/preflight')return new Response(JSON.stringify({profileId:policy.unifiedRpcProfileId(profile),manifestHash:policy.unifiedRpcManifestId(profile),chainId:chain,coordinatorId:profile.coordinatorId,scope:profile.scope,workload:options.headers['x-yunipals-rpc-workload'],paid:'explicit_bounded_permit_only',budget:{},replay:{mode:'free_only'}}));
if(u.pathname==='/unified'&&JSON.parse(options.body).method==='eth_chainId')return new Response(JSON.stringify({result:'0x'+chain.toString(16)}));throw Error('offline_only');};
const{createBuild}=await internal('./build/index.js'),{createLogger}=await internal('./internal/logger.js'),{MetricsService}=await internal('./internal/metrics.js'),{buildOptions}=await internal('./internal/options.js'),{createShutdown}=await internal('./internal/shutdown.js');
const shutdown=createShutdown(),cliOptions={root:project,config:'ponder.config.ts',command:'start',version:'0.17.5',schema:'unified_shadow_20261020_7e7375b0',logLevel:'silent',logFormat:'json'},options=buildOptions({cliOptions});options.ponderDir=path.join(project,'.ponder','base-priority-build-proof');
const common={options,logger:createLogger({level:'silent',mode:'json'}),metrics:new MetricsService(),shutdown,buildShutdown:shutdown,apiShutdown:shutdown};let configHash;
try{const b=await createBuild({common,cliOptions}),r=await b.executeConfig();if(r.status!=='success')throw Error('offline_config_failed');configHash=r.result.contentHash;}finally{await shutdown.kill();}
if(calls!==12)throw Error('offline_call_count');const hash=v=>createHash('sha256').update(v).digest('hex'),{globSync}=require('glob'),schemaHash=hash(readFileSync('ponder.schema.ts','utf8')),files=globSync(path.join(project,'src/**/*.{js,mjs,ts,mts}'),{ignore:[path.join(project,'src/api/**/*.{js,mjs,ts,mts}'),path.join(project,'src/**/*.{test,spec}.{js,mjs,ts,mts}')]});const h=createHash('sha256');for(const file of files)h.update(readFileSync(file,'utf8'));const indexingHash=h.digest('hex');
console.log(JSON.stringify({buildId:hash('2'+configHash+schemaHash+indexingHash).slice(0,10),configHash,schemaHash,indexingHash,indexingFiles:files.length,offlineInterceptedFetches:calls,realRpcRequests:0,databaseCalls:0,uid:process.getuid(),gid:process.getgid(),baseSourceConcurrency:1}));
"""


def proof(s):
    project=s.WORK/'apps/yunipals-indexer'
    bound=' '.join(line.split('=',1)[1]for line in bindings(s))
    props=['User=yunipals_unified_shadow','Group=yunipals_unified_shadow','WorkingDirectory='+str(project),'NoNewPrivileges=yes','ProtectSystem=strict','ProtectHome=yes','PrivateTmp=yes','PrivateNetwork=yes','IPAddressDeny=any','RuntimeMaxSec=60','MemoryMax=2147483648','MemorySwapMax=0','ReadWritePaths='+str(project/'.ponder'),'BindReadOnlyPaths='+bound,'InaccessiblePaths=/run/postgresql /var/run/postgresql /var/lib/postgresql /var/backups']
    args=['/usr/bin/systemd-run','--quiet','--collect','--wait','--pipe','--unit=yunipals-source6-base-priority-build-proof-20261022',*['--property='+x for x in props],'/usr/bin/env','-i',s.NODE,'--env-file='+str(s.WORK/'launch.env'),'--env-file='+str(OPS/'source6-free-runtime-v2.env'),'--import','tsx','--input-type=module','-e',PROBE]
    result=json.loads(s.run(args,timeout=75))
    if result.get('buildId')!=s.BUILD or result.get('realRpcRequests')!=0 or result.get('databaseCalls')!=0 or result.get('offlineInterceptedFetches')!=12 or result.get('uid')!=970 or result.get('gid')!=964:fail('actual_same_build_offline_base_gate_proof_required')
    return result


def prepare(s):
    saved=paused(s);s.inputs();s.resources();s.financial()
    if BASE.exists()or AREA.exists():fail('fresh_base_priority_preparation_required')
    raw=s.protected(OPS/'source6-base-priority-rpc.ts')
    if sha(raw)!=RPC_SHA:fail('reviewed_base_only_transport_required')
    BASE.mkdir(mode=0o700);s.save(BASE/'prepare-intent.json',{'pauseReceiptSha256':PAUSE_SHA,'rpcSha256':RPC_SHA,'expiresMonotonicMicroseconds':saved['expiresMonotonicMicroseconds'],'at':s.now()})
    AREA.mkdir(mode=0o755);p=AREA/'rpc-preflight.ts';fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
    with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
    result=proof(s);paused(s)
    value={'format':FORMAT,'prepared':True,'pauseReceiptSha256':PAUSE_SHA,'rpcSha256':RPC_SHA,'sameBuildProof':result,'originalDeadlineMonotonicMicroseconds':saved['expiresMonotonicMicroseconds'],'sourceStarted':False,'providerCalls':0,'databaseWrites':0,'at':s.now()};pin=s.save(BASE/'prepared.json',value)
    return {**value,'preparedReceiptSha256':pin}


def review(s):
    saved=paused(s);raw=s.protected(BASE/'prepared.json');prepared=json.loads(raw)
    if prepared.get('prepared')is not True or prepared.get('rpcSha256')!=RPC_SHA or sha(s.protected(AREA/'rpc-preflight.ts'))!=RPC_SHA:fail('acknowledged_same_build_base_gate_required')
    if(BASE/'resume-intent.json').exists():fail('one_resume_requires_manual_reconcile')
    s.resources();s.inputs();db=s.database(True)
    if db['sourceSessions']>24:fail('retained_database_connection_headroom_required')
    value={'format':FORMAT,'operatorSha256':sha(s.protected(Path(__file__).absolute())),'pauseReceiptSha256':PAUSE_SHA,'preparedReceiptSha256':sha(raw),'rpcSha256':RPC_SHA,'buildId':s.BUILD,'schema':s.SCHEMA,'originalDeadlineMonotonicMicroseconds':saved['expiresMonotonicMicroseconds'],'baseSourceConcurrency':1,'otherChainsAndEvidenceUnchanged':True,'financial':s.financial(),'proxies':s.proxies(),'paidAuthority':False,'freeOnly':True,'windowExtension':False}
    return {**value,'reviewHash':sha(encode(value))}


def drop_path(s):return s.DROP.parent/'95-base-priority-window.conf'


def remaining_runtime(deadline,clock=None):
    current=time.monotonic_ns()//1000 if clock is None else clock
    remaining=(deadline-current)//1_000_000-15
    if remaining<300:fail('original_window_has_expired')
    return remaining


def parse_runtime_limit(value):
    if value=='0':return 0
    parts=re.findall(r'([0-9]+)(h|min|s)',value)
    if not parts or ' '.join(n+unit for n,unit in parts)!=value:fail('loaded_finite_source_runtime_required')
    factors={'h':3600,'min':60,'s':1}
    return sum(int(n)*factors[unit]for n,unit in parts)*1_000_000


def runtime_limit(s):
    # systemctl loads an inactive unit before reading its properties. Separate
    # GetUnit/get-property bus calls race systemd's ordinary unit collection.
    raw=s.run(['/usr/bin/systemctl','show',s.UNIT,'--value','--property=RuntimeMaxUSec']).decode().strip()
    return parse_runtime_limit(raw)


def resume(s,pin):
    with s.lease(s.SOURCE_LEASE):
        checked=review(s)
        if checked['reviewHash']!=pin or drop_path(s).exists():fail('fresh_exact_original_window_resume_required')
        remaining=remaining_runtime(checked['originalDeadlineMonotonicMicroseconds'])
        text='[Service]\nRuntimeMaxSec='+str(remaining)+'\nBindReadOnlyPaths=\n'+'\n'.join(bindings(s))+'\n'
        s.save(BASE/'resume-intent.json',{**checked,'remainingRuntimeSeconds':remaining,'dropSha256':sha(text.encode()),'at':s.now()})
        fd=os.open(drop_path(s),os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
        with os.fdopen(fd,'wb')as f:f.write(text.encode());f.flush();os.fsync(f.fileno())
        s.run(['/usr/bin/systemctl','daemon-reload'])
        if runtime_limit(s)!=remaining*1_000_000 or s.unit()['MainPID']!='0'or s.job()!=0:fail('loaded_exact_remaining_window_before_start_required')
        s.run(['/usr/bin/systemctl','start',s.UNIT],timeout=40);p=s.unit();identity=s.process_identity(p)
        expiry=identity['startMonotonicMicroseconds']+remaining*1_000_000
        if expiry>checked['originalDeadlineMonotonicMicroseconds']:
            if s.unit()['InvocationID']==p['InvocationID']and s.unit()['MainPID']==p['MainPID']:
                s.run(['/usr/bin/systemctl','stop',s.UNIT],timeout=50)
                s.save(BASE/'late_start_stopped.json',{'invocation':p['InvocationID'],'originalDeadlineMonotonicMicroseconds':checked['originalDeadlineMonotonicMicroseconds'],'attemptedExpiryMonotonicMicroseconds':expiry,'at':s.now()})
            fail('late_owned_start_stopped_to_preserve_original_deadline')
        if p['ActiveState']!='active'or p['SubState']!='running'or p['MemoryMax']!='6442450944'or p['Restart']!='no'or p['DropInPaths'].split()!=[str(s.DROP),str(drop_path(s))]or runtime_limit(s)!=remaining*1_000_000:fail('exact_bounded_new_source_runtime_required')
        value={'format':FORMAT,'started':True,'readyClaimed':False,'runtime':identity,'runtimeMaxSeconds':remaining,'expiresMonotonicMicroseconds':expiry,'originalDeadlineMonotonicMicroseconds':checked['originalDeadlineMonotonicMicroseconds'],'windowExtension':False,'dropSha256':sha(text.encode()),'rpcSha256':RPC_SHA,'schema':s.SCHEMA,'buildId':s.BUILD,'baseSourceConcurrency':1,'otherChainsAndEvidenceUnchanged':True,'databaseWrites':0,'schemaAndCachePreserved':True,'boosterSourceChanged':False,'freeOnly':True,'paidAuthority':False,'at':s.now()};receipt=s.save(BASE/'runtime.json',value)
        return {**value,'runtimeReceiptSha256':receipt}


def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--prepare',action='store_true');g.add_argument('--resume');args=p.parse_args();signal.signal(signal.SIGALRM,lambda *_:fail('bounded_original_window_resume_expired'));signal.alarm(240)
    if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('fixed_root_host_required')
    s=module()
    if Path('/proc/sys/kernel/random/boot_id').read_text().strip()!=s.BOOT:fail('same_boot_required_for_original_monotonic_deadline')
    value=prepare(s)if args.prepare else resume(s,args.resume)if args.resume else review(s);print(json.dumps(value,sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(e).__name__,'fixedCode':str(e)if type(e)is RuntimeError and re.fullmatch('[a-z_]+',str(e))else'private_diagnostics_withheld'}));raise SystemExit(1)
