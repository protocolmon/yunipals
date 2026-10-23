#!/usr/bin/env python3
"""Own only the fresh three-contract free Base profile and its separate proxy.

Review / SQL ROLLBACK / acknowledged SQL COMMIT / proxy start are separate.
The original four proxies, source, budgets, expired permits and private env files
are retained. Unknown effects require inspect/reconcile or the owned stop inverse.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import signal
import socket
import stat
import subprocess
import time
import types
import urllib.request

FORMAT = 'yunipals-ypal-rpc-admission-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
PUBLIC = OPS / 'ypal-rpc-19212'
BASE = Path('/var/backups/yunipals-ypal-rpc-admission-v1-20261023')
PROFILE = PUBLIC / 'profile.json'
APPROVAL = PUBLIC / 'approval.json'
RUNNER = PUBLIC / 'official.mjs'
UNIT = 'yunipals-ypal-base-rpc.service'
OLD = 'yunipals-market-production-rpc@base.service'
SOURCE = 'yunipals-booster-ypal-source.service'
UNIT_FILE = Path('/etc/systemd/system') / UNIT
BOOT_LINK = Path('/etc/systemd/system/multi-user.target.wants') / UNIT
ENV_FILE = PUBLIC / 'launch.env'
RELEASE = Path('/opt/yunipals-unified/releases/6e112a0cebc3f1717001a971bef608724fa66bda7803f843992833d1a703b2c6')
NODE = '/opt/node-v24.18.1/bin/node'
ARTIFACT = OPS / 'source6-selective-source-proxy-v6/rpc-budget-proxy.mjs'
ARTIFACT_SHA = 'd8e58d18f7f88bb8b13d4f2d85d562ddd71f7ffc2c96b913410d5a656202f5c8'
QUALIFIER = OPS / 'source6-normal-proxy-requalification-v1.py'
QUALIFIER_SHA = '8f95600ddb4bc788be223e35559dba147bf9b219e5243698da84dd95cdc04658'
QUALIFIED_SHA = 'add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d'
PROFILE_SHA = '0e19f87a728a0150fae82e6125436739864edd86a6b5b1ecdfcd3503e70e0e05'
APPROVAL_SHA = 'f19bce3cedd60f0bb5b8ae4cfbd3fd9ca1f642f3a73d799f4f4df889028b77c5'
RUNNER_SHA = '7f0e32c019c396dbd956f12253413bcce287403076755fcabc5371ffa2d50304'
PROFILE_ID = '0x25308afec8bf9d4992afb5dbf52675d958ee1c619533e7917ae3fe08dbd29c86'
MANIFEST_HASH = '0x83262c45a53f94ed561c6116fc9efeccf69bd55839e7296f7f5276bc7c89e9ac'
EXPIRY = '2026-11-19T18:00:00.000Z'
ENV = {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
SECURITY = ['User','Group','NoNewPrivileges','ProtectSystem','ProtectHome','PrivateTmp','PrivateDevices','ProtectKernelTunables','ProtectKernelModules','ProtectControlGroups','ProtectKernelLogs','ProtectClock','ProtectHostname','ProtectProc','ProcSubset','RestrictSUIDSGID','RestrictRealtime','RestrictNamespaces','LockPersonality','CapabilityBoundingSet','AmbientCapabilities','RestrictAddressFamilies','SystemCallArchitectures','MemoryMax','TasksMax','UMask']
FIELDS = ['Id','LoadState','ActiveState','SubState','MainPID','InvocationID','Job','FragmentPath','DropInPaths','NRestarts','WorkingDirectory','ExecMainStartTimestampMonotonic',*SECURITY]
DEPENDENCIES = {
 'apps/yunipals-market-api/scripts/review-unified-rpc-policy.ts':'f7dc476dc2ac20ee6d05b94dee73126c2221f26f2ac9dbef1524e50d22e30669',
 'apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs':'17e2a92c5f1f70065b01c65d5ee9ac260839d4fc0ea78fdbb4db7b1155ccd32f',
 'apps/yunipals-market-api/node_modules/pg/lib/index.js':'3fad6e6d3d976edbabe0cbc9e1d39f4340bcb719bbbb186a0d3a24f3dbd4a94c',
 'packages/yunipals-indexer-server/src/rpc-policy.ts':'f1a9061e07b83b310281add38597df5a47692be18eb64288feb12cf3ddf3fd75',
 'packages/yunipals-indexer-server/src/identity.ts':'1ec0dab250ec8b93e93dd1f864bc6257dfada2520d3fcac94e7c8697703224ae',
 'packages/yunipals-indexer-client/src/sources.ts':'05e1ad7cdf5da6fbf7615294bf94552ac291032aadb911be65ea5d6506544b1c',
 'packages/yunipals-market-core/src/registry.ts':'abd125f3b26653691bc149a9b77af7e34a569bb1476318cb17a0babc4291d4c9'}


def need(v, code):
    if not v: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(v): return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def boot(): return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
def identity(s): return {k:getattr(s,k) for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_size']}


def protected(path, maximum=12_000_000):
    path=Path(path);need(path.is_absolute(),'absolute_protected_path_required')
    for p in [*path.parents,path]:
        s=p.lstat();need(not stat.S_ISLNK(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'root_protected_input_required')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        a=os.fstat(fd);need(stat.S_ISREG(a.st_mode) and a.st_size<=maximum,'bounded_regular_file_required')
        raw=b''
        while chunk:=os.read(fd,min(65536,maximum+1-len(raw))): raw+=chunk
        b=os.fstat(fd);need(identity(a)==identity(b)==identity(path.lstat()) and a.st_mtime_ns==b.st_mtime_ns and a.st_ctime_ns==b.st_ctime_ns and len(raw)<=maximum,'stable_input_required')
        return raw
    finally: os.close(fd)


def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def write(path,raw,mode=0o600):
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'wb') as f:
        os.fchmod(f.fileno(),mode);f.write(raw);f.flush();os.fsync(f.fileno())
    sync(Path(path).parent);return {'sha256':sha(raw),'identity':identity(Path(path).lstat())}

def save(name,value): return write(BASE/name,encoded(value))
def load(name): return json.loads(protected(BASE/name))
def pinned(path,pin):
    need(isinstance(pin,str) and re.fullmatch('[0-9a-f]{64}',pin),'actual_frozen_pin_required')
    raw=protected(path);need(sha(raw)==pin,'exact_frozen_input_required');return raw


def run(args,data=None,timeout=30,env=ENV):
    r=subprocess.run(args,input=data,capture_output=True,timeout=timeout,env=env,cwd='/')
    need(r.returncode==0 and not r.stderr and len(r.stdout)<=2_000_000,'bounded_command_ack_required');return r.stdout


def peer():return ['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs']

def query(sql):
    opts='-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=12000'
    return json.loads(run([*peer(),'/usr/bin/env','-i','PATH=/usr/bin:/bin','LANG=C.UTF-8','TZ=UTC','PGPASSFILE=/dev/null','PGOPTIONS='+opts,'/usr/bin/psql','-XwAtq','-h','/var/run/postgresql','-p','15438','-U','postgres','-d','yunipals_market_production','-v','ON_ERROR_STOP=1'],('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;'+sql+';ROLLBACK;').encode()))


def catalog():
    return query("SELECT jsonb_build_object('budget',(SELECT jsonb_build_object('coordinator',c.coordinator_id,'enabled',b.enabled,'dailyCu',b.daily_cu::text,'reserveCu',b.foreground_reserve_cu::text,'allocations',(SELECT jsonb_agg(to_jsonb(a) ORDER BY workload) FROM yunipals_market.rpc_compute_allocation a WHERE a.scope=c.scope)) FROM yunipals_market.opensea_request_budget c JOIN yunipals_market.rpc_compute_budget b USING(scope) WHERE c.scope='yunipals-opensea' AND c.enabled),'profile',(SELECT to_jsonb(p) FROM yunipals_market.unified_rpc_profile p WHERE profile_id='"+PROFILE_ID+"'),'newPermits',(SELECT count(*) FROM yunipals_market.unified_rpc_replay_permit WHERE profile_id='"+PROFILE_ID+"'),'activePermits',(SELECT count(*) FROM yunipals_market.unified_rpc_replay_permit WHERE enabled AND expires_at>clock_timestamp()))")


def exact_catalog(value,before,admitted):
    need(value['budget']==before['budget'] and value['activePermits']==before['activePermits']==0 and value['newPermits']==0,'unchanged_budget_and_no_paid_permits_required')
    p=value['profile']
    if admitted:
        expected=json.loads(pinned(PROFILE,PROFILE_SHA))
        need(p and p['profile_id']==PROFILE_ID and p['scope']==expected['scope'] and p['manifest_hash']==MANIFEST_HASH and p['policy']==expected and p['enabled'] is True and p['expires_at'].replace('+00:00','Z') in [EXPIRY,EXPIRY.replace('.000Z','Z')],'exact_acknowledged_insert_only_profile_required')
    else:need(p is None,'new_profile_must_be_absent')


def source_guard():
    raw=pinned(QUALIFIER,QUALIFIER_SHA);m=types.ModuleType('qualified_original_source');m.__file__=str(QUALIFIER);exec(compile(raw,str(QUALIFIER),'exec'),m.__dict__)
    v=m.validate_current(QUALIFIED_SHA)
    need(v['validated'] is True and v['runtime']['pid']==716994 and v['runtime']['invocation']=='c3463c9a2e1240e8890e318ba1360cf4' and v['originalWholeValidationPassed'] is False and v['freeOnly'] is True and v['paidAuthority'] is False,'unchanged_qualified_original_source_required')
    return {'proxies':v['proxies'],'runtime':v['runtime'],'financialExpiresAt':v['financialExpiresAt']}


def state(unit,absent=False):
    need(unit in [OLD,UNIT,SOURCE],'fixed_units_only')
    raw=run(['/usr/bin/systemctl','show','--all',unit,*['--property='+k for k in FIELDS]])
    v={}
    for line in raw.decode().splitlines():
        k,sep,val=line.partition('=');need(sep and k in FIELDS and k not in v,'exact_manager_properties_required');v[k]=val
    need(set(v)==set(FIELDS) and v['Id']==unit,'complete_manager_properties_required')
    if absent:need(v['LoadState']=='not-found' and v['ActiveState']=='inactive' and v['SubState']=='dead' and v['MainPID']=='0' and not any(v[k] for k in ['Job','FragmentPath','DropInPaths']),'fresh_absent_unit_required')
    return v


def definitions(s):return {p:sha(protected(p)) for p in [s['FragmentPath'],*shlex.split(s['DropInPaths'])]}


def inherited(s):
    need(s['User']==s['Group']=='yunipals-market-prod-rpc' and s['NoNewPrivileges']=='yes' and s['ProtectSystem']=='strict' and s['ProtectHome']=='yes' and s['CapabilityBoundingSet']==s['AmbientCapabilities']=='','retained_hardened_proxy_actor_required')
    paths=[s['FragmentPath'],*shlex.split(s['DropInPaths'])];parts=[];refs=[]
    for path in paths:
        text=protected(path).decode();need(set(re.findall('%[a-zA-Z%]',text))<={'%i'},'only_known_base_specifier_required');text=text.replace('%i','base');parts.append(text)
        for line in text.splitlines():
            if line.startswith('EnvironmentFile='):
                x=line.split('=',1)[1];need(x.startswith('/') and re.fullmatch('/[A-Za-z0-9_./@-]+',x),'existing_fixed_environment_reference_required');refs.append(x)
    return '\n'.join(parts),{p:sha(protected(p)) for p in refs}


def env_bytes():
    values={'MARKET_RPC_PROXY_HOST':'127.0.0.1','MARKET_RPC_PROXY_PORT':'19212','MARKET_RPC_PROXY_CHAIN_ID':'8453','MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE':str(PROFILE),'MARKET_RPC_PROXY_UNIFIED_PROFILE_ID':PROFILE_ID,'MARKET_RPC_PROXY_MAX_IN_FLIGHT':'2'}
    for k in ['PAID_FALLBACK_ON_FREE_FAILURE','FOREGROUND_PAID_FALLBACK_ON_FREE_FAILURE','ORDER_PAID_FALLBACK_ON_FREE_FAILURE','SOURCE_PAID_FALLBACK_ON_FREE_FAILURE','SALE_PAID_FALLBACK_ON_FREE_FAILURE','UNIFIED_SOURCE_PAID_PRIMARY','UNIFIED_SOURCE_PAID_LOGS']:values['MARKET_RPC_PROXY_'+k]='false'
    return ''.join(k+'='+v+'\n' for k,v in values.items()).encode()


def unit_bytes(original):
    return (original+'\n[Unit]\nDescription=Yunipals fresh YPAL Base free RPC\n[Service]\nEnvironmentFile='+str(ENV_FILE)+'\nExecStart=\nExecStart='+NODE+' '+str(ARTIFACT)+'\nRestart=on-failure\nRestartSec=5\nRuntimeMaxSec=infinity\n').encode()


def official(phase,review_hash=None):
    for path,pin in DEPENDENCIES.items():
        # Existing installed dependency paths contain reviewed package symlinks.
        p=RELEASE/path;need(sha(p.read_bytes())==pin,'exact_retained_official_dependency_required')
    pinned(RUNNER,RUNNER_SHA)
    env={**ENV,'NODE_NO_WARNINGS':'1','TSX_DISABLE_CACHE':'1','UNIFIED_RPC_REVIEW_DATABASE_URL':'postgresql://postgres@localhost:15438/yunipals_market_production?host=/var/run/postgresql'}
    if phase=='review':env['PGOPTIONS']='-c default_transaction_read_only=on'
    args=[*peer(),NODE,'--import',str(RELEASE/'apps/yunipals-market-api/node_modules/tsx/dist/loader.mjs'),str(RUNNER),phase,*([review_hash] if review_hash else [])]
    rows=[json.loads(x) for x in run(args,timeout=40,env=env).splitlines()]
    need(len(rows)==(1 if phase=='review' else 2) and rows[0]['event']=='unified_rpc_policy_review' and rows[0]['profileId']==PROFILE_ID and rows[0]['manifestHash']==MANIFEST_HASH and rows[0]['permits']==[] and rows[0]['applied'] is False,'actual_official_review_required')
    if phase!='review':need(rows[1]=={'event':'unified_rpc_policy_'+('rehearsed' if phase=='rehearse' else 'approved'),'reviewHash':review_hash,'profileId':PROFILE_ID} and rows[0]['reviewHash']==review_hash,'exact_official_boundary_ack_required')
    return rows


def static():
    pinned(PROFILE,PROFILE_SHA);pinned(APPROVAL,APPROVAL_SHA);pinned(RUNNER,RUNNER_SHA);pinned(ARTIFACT,ARTIFACT_SHA)
    guard=source_guard();s=state(OLD);need(definitions(s)==guard['proxies']['base']['definitionHashes'],'same_existing_base_definitions_required');text,refs=inherited(s)
    return {'format':FORMAT,'operatorSha256':sha(protected(Path(__file__).absolute())),'bootId':boot(),'source':guard,'definitions':definitions(s),'environmentFileHashes':refs,'security':{k:s[k] for k in SECURITY},'unitSha256':sha(unit_bytes(text)),'envSha256':sha(env_bytes()),'profileSha256':PROFILE_SHA,'approvalSha256':APPROVAL_SHA,'runnerSha256':RUNNER_SHA}


def free_port():
    with socket.socket() as s:need(s.connect_ex(('127.0.0.1',19212))!=0,'fresh_loopback_port_required')


def review():
    need(not BASE.exists(),'existing_operation_requires_explicit_phase_or_inspect')
    state(UNIT,True);need(not os.path.lexists(UNIT_FILE) and not os.path.lexists(BOOT_LINK) and not os.path.lexists(ENV_FILE),'fresh_unit_env_and_boot_paths_required');free_port()
    binding=static();c=catalog();exact_catalog(c,c,False);r=official('review')[0];need(static()==binding,'static_inputs_changed_during_review')
    return {'format':FORMAT,'reviewHash':sha(encoded({'binding':binding,'catalog':c,'official':r})),'binding':binding,'catalog':c,'official':r,'databaseWrites':0,'serviceChanges':0,'providerRpcRequests':0}


def baseline():
    before=load('before.json');need(before['binding']==static(),'original_source_proxy_or_inputs_changed');return before


def rehearse(pin):
    before=review();need(before['reviewHash']==pin,'fresh_review_hash_required');BASE.mkdir(mode=0o700);sync(BASE.parent);save('before.json',before);save('rehearse-intent.json',{'reviewHash':pin,'bootId':boot()})
    rows=official('rehearse',before['official']['reviewHash']);after=catalog();exact_catalog(after,before['catalog'],False);baseline()
    value={'format':FORMAT,'rehearsed':True,'reviewHash':pin,'official':rows,'catalogUnchanged':after==before['catalog'],'databaseCommitted':False,'serviceChanges':0};save('rehearsed.json',value);return value


def admission_result(before,ack):
    after=catalog();exact_catalog(after,before['catalog'],True);baseline()
    value={'format':FORMAT,'admitted':True,'reviewHash':before['reviewHash'],'officialAcknowledgement':ack,'catalog':after,'unchangedBudgetSha256':sha(encoded(after['budget'])),'newPermits':0,'paidAuthority':False,'oldSourcesAndProxiesUnchanged':True};save('admitted.json',value);return value


def commit(pin):
    before=baseline();need(load('rehearsed.json')['reviewHash']==pin==before['reviewHash'],'actual_rollback_rehearsal_required');need(not (BASE/'commit-intent.json').exists(),'existing_commit_requires_reconcile_not_retry');exact_catalog(catalog(),before['catalog'],False)
    save('commit-intent.json',{'format':FORMAT,'reviewHash':pin,'bootId':boot(),'officialReviewHash':before['official']['reviewHash'],'beforeCatalogSha256':sha(encoded(before['catalog']))})
    return admission_result(before,official('commit',before['official']['reviewHash']))


def reconcile(pin):
    need(sha(protected(BASE/'commit-intent.json'))==pin and not (BASE/'admitted.json').exists(),'exact_unacknowledged_commit_intent_required');before=baseline();intent=load('commit-intent.json');need(intent['bootId']==boot() and intent['reviewHash']==before['reviewHash'],'same_owned_commit_required')
    # Observe only: never issue COMMIT again and never infer a missing profile.
    return admission_result(before,{'commitAckLost':True,'exactPresentProfileObserved':True,'commitRetried':False})


def publish(path,raw,tag,symlink=False):
    prepared=path.parent/('.'+path.name+'.ypal-prepared');need(not os.path.lexists(path) and not os.path.lexists(prepared),'fresh_publish_paths_required')
    if symlink:os.symlink(raw,prepared);sync(prepared.parent);receipt={'identity':identity(prepared.lstat()),'target':raw}
    else:receipt=write(prepared,raw,0o644)
    save(tag+'-prepared.json',{'path':str(path),'prepared':str(prepared),**receipt})
    os.link(prepared,path,follow_symlinks=False);sync(path.parent);prepared.unlink();sync(path.parent);save(tag+'-published.json',{'path':str(path),**receipt});return receipt


def check_published(tag):
    r=load(tag+'-prepared.json');p=Path(r['path']);need(identity(p.lstat())==r['identity'],'owned_published_inode_required')
    need(os.readlink(p)==r['target'] if 'target' in r else sha(protected(p))==r['sha256'],'owned_published_bytes_required');return r


def manager(verb):
    need(verb in ['start','stop','daemon-reload'],'fixed_new_proxy_manager_actions_only');return run(['/usr/bin/systemctl',verb,*([] if verb=='daemon-reload' else [UNIT])],timeout=40)


def actor(s,start_mono,require_pristine=True):
    need(s['ActiveState']=='active' and s['SubState']=='running' and s['Job']=='' and re.fullmatch('[0-9]+',s['NRestarts']) and (not require_pristine or s['NRestarts']=='0') and int(s['MainPID'])>1 and re.fullmatch('[0-9a-f]{32}',s['InvocationID']) and int(s['ExecMainStartTimestampMonotonic'])>=start_mono,'exact_owned_new_proxy_running_required')
    need(int(s['ExecMainStartTimestampMonotonic'])<=time.monotonic_ns()//1000 and (int(s['NRestarts'])>0 or int(s['ExecMainStartTimestampMonotonic'])<=start_mono+40_000_000),'owned_initial_start_window_or_manager_restart_required')
    p=Path('/proc')/s['MainPID'];before=(p/'stat').read_text();ticks=int(before[before.rfind(')')+2:].split()[19]);v=dict(x.split(':',1) for x in (p/'status').read_text().splitlines() if ':' in x);account=pwd.getpwnam('yunipals-market-prod-rpc')
    need(set(v['Uid'].split())=={str(account.pw_uid)} and set(v['Gid'].split())=={str(account.pw_gid)} and set(v['Groups'].split())<={str(account.pw_gid)} and v['NoNewPrivs'].strip()=='1' and all(int(v[k].strip(),16)==0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']),'same_unprivileged_proxy_actor_required')
    need((p/'cmdline').read_bytes()==(NODE+'\0'+str(ARTIFACT)+'\0').encode() and (p/'cgroup').read_text().splitlines()==['0::/system.slice/'+UNIT],'exact_new_proxy_argv_and_cgroup_required')
    env=dict(x.split(b'=',1) for x in (p/'environ').read_bytes().split(b'\0') if b'=' in x)
    need(all(env.get(k.encode())==val.encode() for k,val in (line.split('=',1) for line in env_bytes().decode().splitlines())),'exact_free_only_effective_environment_required')
    after=(p/'stat').read_text();need(ticks==int(after[after.rfind(')')+2:].split()[19]),'same_process_read_fence_required');return {'pid':int(s['MainPID']),'invocation':s['InvocationID'],'startTicks':ticks,'startMonotonicMicroseconds':int(s['ExecMainStartTimestampMonotonic'])}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*_):return None


def gate():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect());out={}
    for workload in ['unified_source','unified_evidence']:
        req=urllib.request.Request('http://127.0.0.1:19212/unified/preflight',headers={'x-yunipals-unified-rpc-profile':PROFILE_ID,'x-yunipals-rpc-workload':workload})
        with opener.open(req,timeout=5) as r:
            raw=r.read(200001);need(r.status==200 and len(raw)<=200000,'bounded_cached_preflight_required');v=json.loads(raw)
        need(v.get('profileId')==PROFILE_ID and v.get('manifestHash')==MANIFEST_HASH and v.get('chainId')==8453 and v.get('replay',{}).get('mode')=='free_only','actual_new_free_only_gate_required');out[workload]=v
    return out


def inspect():
    before=baseline();exact_catalog(catalog(),before['catalog'],True);s=state(UNIT)
    check_published('unit');check_published('env');need(not s['DropInPaths'] and s['FragmentPath']==str(UNIT_FILE) and {k:s[k] for k in SECURITY}==before['binding']['security'],'exact_new_definition_and_inherited_hardening_required')
    intent=load('start-intent.json');need(intent['bootId']==boot() and intent['unitSha256']==before['binding']['unitSha256'],'owned_same_boot_start_intent_required')
    a=actor(s,intent['monotonicMicroseconds']);return {'runtime':a,'definitionHashes':{str(UNIT_FILE):before['binding']['unitSha256']},'unit':UNIT,'gate':gate()}


def start(pin):
    need(sha(protected(BASE/'admitted.json'))==pin,'actual_profile_admission_receipt_required');before=baseline();exact_catalog(catalog(),before['catalog'],True);state(UNIT,True);free_port();need(not (BASE/'install-intent.json').exists(),'existing_install_requires_inspect_or_inverse')
    original,_=inherited(state(OLD));save('install-intent.json',{'bootId':boot(),'admissionSha256':pin,'unitSha256':sha(unit_bytes(original)),'envSha256':sha(env_bytes())})
    publish(ENV_FILE,env_bytes(),'env');publish(UNIT_FILE,unit_bytes(original),'unit');manager('daemon-reload');s=state(UNIT);need(s['LoadState']=='loaded' and not s['DropInPaths'] and {k:s[k] for k in SECURITY}==before['binding']['security'],'loaded_exact_hardening_required_before_start')
    need(s['MainPID']=='0' and not s['Job'],'stopped_loaded_new_unit_required');baseline();save('start-intent.json',{'bootId':boot(),'unitSha256':before['binding']['unitSha256'],'monotonicMicroseconds':time.monotonic_ns()//1000})
    manager('start')
    deadline=time.monotonic()+35
    while True:
        try:v=inspect();break
        except Exception:
            need(time.monotonic()<deadline,'new_proxy_not_yet_accepted');time.sleep(1)
    save('started.json',v);publish(BOOT_LINK,str(UNIT_FILE),'boot',True);baseline();v=inspect();check_published('boot')
    result={'format':FORMAT,'completed':True,'operatorSha256':sha(protected(Path(__file__).absolute())),'bootId':boot(),'admissionReceiptSha256':pin,'profileId':PROFILE_ID,'manifestHash':MANIFEST_HASH,'profileFile':str(PROFILE),'profileFileSha256':PROFILE_SHA,'sourceManifest':json.loads(pinned(PROFILE,PROFILE_SHA))['manifest'],'endpoint':'http://127.0.0.1:19212/unified','proxy':{k:v[k] for k in ['unit','definitionHashes']}|v['runtime'],'runtime':v['runtime'],'expiresAt':EXPIRY,'freeOnly':True,'paidAuthority':False,'emptyPermits':True,'oldProxiesUnchanged':True,'budgetUnchanged':True,'newProxyBootEnabled':True,'sourceRestarted':False,'databaseCountersReset':False,'providerRpcRequests':0};save('result.json',result);return result


def validate_current(pin):
    raw=pinned(BASE/'result.json',pin);r=json.loads(raw);need(r['format']==FORMAT and r['completed'] is True and r['operatorSha256']==sha(protected(Path(__file__).absolute())) and r['bootId']==boot(),'actual_new_proxy_result_required')
    v=inspect();need(v['runtime']==r['runtime'],'same_acknowledged_new_proxy_required');check_published('boot');return {**r,'validated':True,'receiptSha256':pin}


def remove_published(tag):
    r=load(tag+'-prepared.json');p=Path(r['path']);prepared=Path(r['prepared'])
    if os.path.lexists(p):check_published(tag);p.unlink();sync(p.parent)
    if os.path.lexists(prepared):
        need(identity(prepared.lstat())==r['identity'],'owned_prepared_inode_required');prepared.unlink();sync(prepared.parent)


def restore(pin):
    need(pin==sha(protected(BASE/'install-intent.json')),'exact_owned_install_intent_required');before=load('before.json');need(load('install-intent.json')['bootId']==boot(),'same_boot_owned_inverse_required')
    s=state(SOURCE);need(s['MainPID']=='0' and not s['Job'] and s['ActiveState'] in ['inactive','failed'],'fresh_source_must_stop_before_proxy_inverse')
    if (BASE/'start-intent.json').exists():
        p=state(UNIT)
        if p['MainPID']!='0':
            check_published('unit');check_published('env');need(not p['DropInPaths'] and p['FragmentPath']==str(UNIT_FILE) and {k:p[k] for k in SECURITY}==before['binding']['security'],'exact_owned_inverse_configuration_required');actor(p,load('start-intent.json')['monotonicMicroseconds'],False)
            need(not (BASE/'stop-intent.json').exists(),'existing_stop_requires_terminal_finish_only');save('stop-intent.json',{'runtime':actor(p,load('start-intent.json')['monotonicMicroseconds'],False),'bootId':boot()});manager('stop')
        p=state(UNIT);need(p['MainPID']=='0' and not p['Job'] and p['ActiveState'] in ['inactive','failed'],'owned_proxy_not_yet_terminal');g=Path('/sys/fs/cgroup/system.slice')/UNIT/'cgroup.procs';need(not g.exists() or not g.read_text().split(),'owned_proxy_cgroup_must_be_empty')
    terminal=state(UNIT)
    need(terminal['MainPID']=='0' and not terminal['Job'] and terminal['ActiveState'] in ['inactive','failed'],'never_remove_definition_of_unowned_running_proxy')
    for tag in ['boot','unit','env']:
        if (BASE/(tag+'-prepared.json')).exists():remove_published(tag)
    manager('daemon-reload');need(source_guard()==before['binding']['source'],'original_sources_and_proxies_must_remain_unchanged');exact_catalog(catalog(),before['catalog'],True)
    v={'format':FORMAT,'restored':True,'newProxyStoppedAndBootDisabled':True,'profileAdmissionRetained':True,'profileCountersReset':False,'oldProxiesUnchanged':True,'sourceRestarted':False,'paidAuthority':False};save('restored.json',v);return v


def main():
    p=argparse.ArgumentParser(description=__doc__);m=p.add_mutually_exclusive_group()
    for flag in ['rehearse','commit','reconcile','start','validate','restore']:m.add_argument('--'+flag)
    m.add_argument('--inspect',action='store_true');a=p.parse_args()
    need(os.geteuid()==os.getegid()==0 and os.uname().nodename=='yunipals-main','fixed_root_host_required');os.umask(0o077)
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_operation_expired'));signal.alarm(240)
    lock=os.open('/run/lock/yunipals-ypal-rpc-admission-v1.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        result=next((f(getattr(a,k)) for k,f in [('rehearse',rehearse),('commit',commit),('reconcile',reconcile),('start',start),('validate',validate_current),('restore',restore)] if getattr(a,k)),None)
        if result is None:result=inspect() if a.inspect else review()
        print(json.dumps(result,sort_keys=True))
    finally:os.close(lock)


if __name__=='__main__':
    try:main()
    except Exception as e:
        print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(e).__name__,'fixedCode':str(e) if type(e) is RuntimeError and re.fullmatch('[a-z_]+',str(e)) else 'private_diagnostics_withheld'}));raise SystemExit(1)
