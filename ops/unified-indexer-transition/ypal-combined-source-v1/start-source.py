#!/usr/bin/env python3
"""Review-first owned replacement of old008; live YPAL/readers and all routes stay selected.

This starts ingestion into a NEW namespace. It never copies checkpoints, selects
readers, admits RPC/ACL changes, drops native/cache data or renews paid authority.
Unknown manager ACKs are inspected/reconciled or explicitly inversed, never retried.
"""
import argparse, contextlib, fcntl, hashlib, json, os, pwd, re, shlex, socket, stat, subprocess, time, types
from pathlib import Path
FORMAT='yunipals-ypal-combined-source-start-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
STAGE=OPS/'ypal-combined-source-v1-stage'
BASE=Path('/var/backups/yunipals-ypal-combined-source-start-v1-20261023')
TRANSITION_LOCK=Path('/run/lock/yunipals-ypal-combined-transition.lock')
AREA=Path('/var/lib/yunipals-unified-ypal/combined-v1-source008')
RPC_OWNER=OPS/'ypal-combined-rpc-routes-v1.py'
OBSERVER=OPS/'ypal-old-runtime-inventory-v1.py'
OBSERVER_SHA='7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b'
QUALIFIER=OPS/'source6-normal-proxy-requalification-v1.py'
QUALIFIER_SHA='8f95600ddb4bc788be223e35559dba147bf9b219e5243698da84dd95cdc04658'
OLD_ACK='add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d'
BUILD_RESULT=Path('/var/backups/yunipals-combined-source-inactive-build-v1-20261023/result.json')
OLD='yunipals-unified-source6-free-v2.service';NEW='yunipals-ypal-combined-source.service'
UNIT=Path('/etc/systemd/system')/NEW
OLD_LINK=UNIT.parent/'multi-user.target.wants'/OLD;NEW_LINK=OLD_LINK.with_name(NEW)
SCHEMA='unified_ypal_20261023_v1';OLD_SCHEMA='unified_shadow_20261020_7e7375b0';BUILD='71e2a7f3b7'
SOURCE_DIGEST='02e217b73809bf22aed75a35407a2c175c16f49a7eab91c674be86de28507984'
PINS={'ponder.config.ts':'c4ff1ec83c766aa90286b5d73fd22b457135baa6e5880b4b52c4f8d06eca53a4','booster-config.ts':'01180f821236a693ecda5d7e697adefce59d42a50faf5837b8cddbf44bd4a13d','rpc-preflight.ts':'15d2157d5fd126d1d63383186b037d14b767314c2bf9552ee379cfffa869ca91','combined.public.env':'2c90fd857ad082e960d26672043db11be1ee4326e83076cabdf4373b90a07411','CANDIDATE-SOURCE-MANIFEST.json':'ce44cfb9eca0f25e6b0c309d638c1ebb33db8b0ee3f0b5c19cef1c4ef9cde390','render.json':'38a55a8de300c1ea5ea56d81c8b7aae4724d4c0ef60b7f04501086b12be4ccf0'}
TEMPLATE=STAGE/'yunipals-ypal-combined-source.service.example';TEMPLATE_SHA='4ddfaa8bf5d50be23e5caf920b8b9bf982c82d1c36b0d6977855a0e117d4f7fb'
ENV={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','TZ':'UTC'}
OLD_CAPABILITY_SHA256={'CapInh':'f2da78b49f1566ebca881c763328012aee1f1e48070862ed835ab22d8aa1ff3e','CapBnd':'d984c7de822c5fcb3a5b069faac937cf92a47564dfb77c5b528dd70cd9e98cf9'}
PUBLIC_ENV_PEER=r"""import hashlib,json,os,pathlib,re,sys
pid=int(sys.argv[1]);expected=json.loads(sys.argv[2]);assert 1<pid<2147483648 and len(expected)<=40 and all(re.fullmatch('[A-Z0-9_]+',k)and isinstance(v,str)and len(v)<2000 for k,v in expected.items())
me=dict(x.split(':',1)for x in pathlib.Path('/proc/self/status').read_text().splitlines()if ':'in x);assert os.getuid()==os.geteuid()==970 and os.getgid()==os.getegid()==964 and os.getgroups()==[] and me['NoNewPrivs'].strip()=='1'and all(int(me[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapAmb'])
p=pathlib.Path('/proc')/str(pid)
def ticks():
 s=(p/'stat').read_text();return int(s[s.rfind(')')+2:].split()[19])
start=ticks();assert(p/'cgroup').read_text().splitlines()==['0::/system.slice/yunipals-ypal-combined-source.service'];raw=(p/'environ').read_bytes();assert len(raw)<=1000000;e=dict(x.split(b'=',1)for x in raw.split(b'\0')if b'='in x)
# Node loads --env-file after exec; Linux may retain the initial empty env-i
# region. Present conflicting keys always fail. Exact argv/files are separate.
def matches_public_environment(environment,expected):return all(k.encode()not in environment or environment[k.encode()]==v.encode()for k,v in expected.items())
assert matches_public_environment(e,expected)and ticks()==start
print(json.dumps({'pid':pid,'startTicks':start,'environmentSha256':hashlib.sha256(raw).hexdigest(),'publicKeys':len(expected),'missingKernelKeys':sum(k.encode()not in e for k in expected),'presentKeysMatch':True},sort_keys=True))
"""
def need(ok,code):
    if not ok: raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def sync(p):
    fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def save(path,value,mode=0o600):
    raw=value if isinstance(value,bytes)else encoded(value);fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,mode)
    with os.fdopen(fd,'wb')as f:os.fchmod(f.fileno(),mode);f.write(raw);f.flush();os.fsync(f.fileno())
    sync(path.parent);return sha(raw)
def protected(p):
    p=Path(p)
    for x in [*p.parents,p]:
        st=x.lstat();need(st.st_uid==0 and not stat.S_ISLNK(st.st_mode)and not st.st_mode&0o022,'protected_fixed_input_required')
    a=p.stat();need(stat.S_ISREG(a.st_mode)and a.st_nlink==1 and a.st_size<=2000000,'bounded_regular_fixed_input_required');raw=p.read_bytes();need((a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(p.stat().st_ino,p.stat().st_size,p.stat().st_mtime_ns,p.stat().st_ctime_ns),'input_changed_while_reading');return raw
def document(p,pin=None):
    raw=protected(p);need(pin is None or sha(raw)==pin,'exact_protected_receipt_required');return json.loads(raw)
def module(path,pin):
    raw=protected(path);need(sha(raw)==pin,'exact_reviewed_producer_required');m=types.ModuleType(path.stem);m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);need(sha(protected(path))==pin,'producer_changed_during_load');return m
def boot():return Path('/proc/sys/kernel/random/boot_id').read_text().strip()
@contextlib.contextmanager
def transition_lock():
    parent=TRANSITION_LOCK.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==parent.st_gid==0 and (not parent.st_mode&0o022 or stat.S_IMODE(parent.st_mode)==0o1777),'protected_shared_transition_lock_parent_required');fd=os.open(TRANSITION_LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'protected_shared_transition_lock_required')
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('combined_source_or_routes_transition_in_progress')from None
        current=TRANSITION_LOCK.lstat();need((current.st_dev,current.st_ino,current.st_mode,current.st_uid,current.st_gid,current.st_nlink)==(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink),'shared_transition_lock_replaced_during_acquire')
        yield
    finally:os.close(fd)
def identity(p):
    s=p.lstat();return {k:getattr(s,k)for k in ('st_dev','st_ino','st_mode','st_uid','st_gid')}
def link_record(p):
    s=p.lstat();need(stat.S_ISLNK(s.st_mode)and s.st_uid==s.st_gid==0,'root_owned_symlink_required');return{'path':str(p),'target':os.readlink(p),'identity':identity(p)}
def exact_link(p,r):need(link_record(p)=={**r,'path':str(p)},'exact_owned_boot_link_required')
def manager(action,unit=None):
    need((action=='daemon-reload'and unit is None)or(action in{'start','stop'}and unit in{OLD,NEW}),'source_only_manager_command_required')
    result=subprocess.run(['/usr/bin/systemctl',action,*([unit]if unit else[])],capture_output=True,env=ENV,cwd='/',timeout=90)
    need(result.returncode==0 and not result.stdout and not result.stderr,'manager_ACK_unknown_inspect_never_repeat')
def step(name,action):
    save(BASE/(name+'-intent.json'),{'bootId':boot(),'monotonicUs':time.monotonic_ns()//1000,'automaticRetryAllowed':False});value=action();save(BASE/(name+'-result.json'),{'completed':True,'value':value});return value
def source_privileges(name,priv):
    need(name in{OLD,NEW}and set(priv['Uid'].split())=={'970'}and set(priv['Gid'].split())=={'964'}and set(priv['Groups'].split())<={'964'}and priv['NoNewPrivs']=='1'and all(int(priv[k],16)==0 for k in ['CapPrm','CapEff','CapAmb']),'bounded_unprivileged_source_process_required')
    need(all(sha(priv[k].strip().encode())==v for k,v in OLD_CAPABILITY_SHA256.items())if name==OLD else all(int(priv[k],16)==0 for k in ['CapInh','CapBnd']),'exact_legacy_or_zero_new_capability_policy_required')
class Host:
    def __init__(self,rpc_sha,rpc_result,build_result):
        self.rpc=module(RPC_OWNER,rpc_sha);self.m,_=self.rpc.core();self.rpc_sha=rpc_sha;self.rpc_result=rpc_result;self.build_result=build_result;self.observer=module(OBSERVER,OBSERVER_SHA)
    def policy(self):
        v=self.rpc.validate_current(self.rpc_result);need(v['validated']is True and v['freeOnly']is True and v['paidAuthority']is False and v['emptyPermits']is True and v['oldCombinedSourceLivenessRequired']is False,'actual_independent_combined_routes_required');return v
    def preserved(self):return self.rpc.retained(self.m)
    def query(self,sql):return self.rpc.source_query(self.m,sql)
    def state(self,name):
        need(name in{OLD,NEW},'two_source_units_only');keys=['Id','LoadState','ActiveState','SubState','MainPID','ControlPID','InvocationID','ExecMainStartTimestampMonotonic','NRestarts','FragmentPath','DropInPaths','Job','User','Group','ControlGroup','ExecStart','UnitFileState','WantedBy','RequiredBy','TriggeredBy','Triggers','PartOf','UpheldBy','MemoryMax','RuntimeMaxUSec']
        raw=self.m.run(['/usr/bin/systemctl','show','--all',name,*['--property='+k for k in keys]],timeout=8);s=dict(x.split('=',1)for x in raw.decode().splitlines())
        if set(keys)-set(s)=={'ExecStart'}and all(s.get(k)==v for k,v in {'Id':name,'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0','ControlPID':'0','Job':'','FragmentPath':'','DropInPaths':''}.items()):s['ExecStart']=''
        need(set(s)==set(keys)and s['Id']==name,'complete_two_source_properties_required');return s
    def files(self,s):return {p:sha(protected(p))for p in [s['FragmentPath'],*s['DropInPaths'].split()]if p}
    def actor(self,name,expected=None):
        s=self.state(name);need(s['ControlGroup']=='/system.slice/'+name and s['User']==s['Group']=='yunipals_unified_shadow','fixed_source_cgroup_account_required');v=self.rpc.live_actor(self.m,s,expected);need(1<=len(v['processes'])<=2,'only_Node_and_optional_esbuild_required')
        main=next(p for p in v['processes']if p['pid']==v['pid']);runtime=self.m.route_owner;need(main['executableSha256']==sha(runtime.NODE.encode()),'actual_Node_required')
        for p in v['processes']:
            source_privileges(name,p['privileges'])
            if p['pid']!=v['pid']:need(p['parentPid']==v['pid']and p['executableSha256']==sha(runtime.ESBUILD.encode())and p['commandSha256']==sha((runtime.ESBUILD+'\0--service=0.25.12\0--ping\0').encode()),'only_pinned_owned_esbuild_child_required')
        need(self.state(name)==s,'source_actor_changed_during_read');return v
    def public_environment(self,actor):
        value=json.loads(self.m.run(['/usr/bin/setpriv','--reuid=970','--regid=964','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--no-new-privs','/usr/bin/env','-i','/usr/bin/python3','-I','-B','-c',PUBLIC_ENV_PEER,str(actor['pid']),json.dumps(expected_env())],timeout=8));main=next(p for p in actor['processes']if p['pid']==actor['pid']);need(value['pid']==actor['pid']and value['startTicks']==main['startTicks']and value['environmentSha256']==main['environmentSha256']and value['presentKeysMatch']is True,'same_new_source_public_environment_required');return value
    def role(self):
        return self.query("SELECT jsonb_build_object('oid',oid::text,'name',rolname,'login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication,'bypassRls',rolbypassrls,'limit',rolconnlimit)FROM pg_roles WHERE oid=73004621")
    def old_native(self):
        return self.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='"+OLD_SCHEMA+"'),'app',(SELECT value FROM "+OLD_SCHEMA+"._ponder_meta WHERE key='app'),'checkpoints',(SELECT jsonb_object_agg(chain_id::text,latest_checkpoint)FROM "+OLD_SCHEMA+"._ponder_checkpoint))")
    def old_terminal(self,op):
        s=self.state(OLD);need(s['MainPID']==s['ControlPID']=='0'and s['ActiveState']in{'inactive','failed'}and s['Job']in{'','0'}and self.files(s)==op['oldFiles'],'owned_old_source_terminal_required');need(not Path('/proc/'+str(op['oldActor']['pid'])).exists(),'old_source_PID_must_be_gone');p=Path('/sys/fs/cgroup/system.slice')/OLD/'cgroup.procs';need(not p.exists()or not p.read_text().split(),'old_source_cgroup_must_be_empty');need(not os.path.lexists(OLD_LINK),'old_source_boot_must_remain_removed');return s
    def sessions(self,actors):
        rows=self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=73004621 AND datid=17584");need(len(rows)<=32,'retained_writer_connection_limit_required');fds=self.observer.peer_fds([r['pid']for r in rows],111,113);peers=self.observer.unix_peers(self.observer.run(['/usr/bin/ss','-xHn']));tcp={**self.observer.tcp_clients(Path('/proc/net/tcp').read_bytes()),**self.observer.tcp_clients(Path('/proc/net/tcp6').read_bytes(),True)};out={}
        for name,actor in actors.items():out[name]=self.observer.map_owned_backends(self.observer.peer_fds([p['pid']for p in actor['processes']],970,964),fds,rows,peers,tcp)
        pids=[r['pid']for values in out.values()for r in values];need(len(pids)==len(set(pids))and set(pids)=={r['pid']for r in rows},'all_writer_backends_need_positive_kernel_ownership');again=self.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',client_addr::text,'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=73004621 AND datid=17584");need(rows==again,'backend_churn_retry_observation_only');return out
    def fresh_actor(self):return self.preserved()['yunipals-booster-ypal-source.service']['actor']
    def native(self):
        return self.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='"+SCHEMA+"'),'app',(SELECT value FROM "+SCHEMA+"._ponder_meta WHERE key='app'),'clock',floor(extract(epoch FROM statement_timestamp())*1000)::bigint,'tables',(SELECT jsonb_object_agg(c.relname,jsonb_build_object('oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind))FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+SCHEMA+"'AND c.relkind='r'),'checkpoints',(SELECT jsonb_object_agg(chain_id::text,latest_checkpoint)FROM "+SCHEMA+"._ponder_checkpoint))")
    def preserved_old_native(self,op):
        n=self.old_native();need(n['schemaOid']==op['oldNative']['schemaOid']and n['app']['build_id']=='bf4939b3ff'and all(n['checkpoints'].get(k,'')>=v for k,v in op['oldNative']['checkpoints'].items()),'original_native_schema_checkpoints_preserved');return n

def base_code():
    root=Path('/var/lib/yunipals-booster-launch/20261022-source008');raw=protected(root/'BASE-SOURCE-MANIFEST.json');need(sha(raw)=='55017c503920ddf2d4083bee2425d4daed656cafd0d36e4f88a6352d5903d15d','exact_retained_source008_manifest_required');value=json.loads(raw);rows=value['files'];need(sha((json.dumps(rows,indent=2,ensure_ascii=False)+'\n').encode())=='008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78','retained_source008_identity_required');pins={}
    for row in rows:
        name=row['path'];need(not Path(name).is_absolute()and '..'not in Path(name).parts,'bounded_public_source_path_required')
        if not(re.fullmatch(r'apps/yunipals-indexer/(?:lib|src)/.+\.(?:ts|js|json)',name)or re.fullmatch(r'apps/yunipals-indexer/(?:ponder\.[A-Za-z.]+\.ts|tsconfig[^/]*\.json|package\.json)',name)or re.fullmatch(r'packages/[a-z0-9-]+/(?:src/.+\.(?:ts|js|json)|package\.json|tsconfig[^/]*\.json)',name)or name in{'package.json','tsconfig.json'}):continue
        pin='68a0d4fd0442ecb464574434e1e349f1e4caf1c4ab2f0a70352f8b5f26afe833'if name=='apps/yunipals-indexer/lib/unified/rpc-preflight.ts'else row['sha256'];need(sha(protected(root/name))==pin,'retained_original_source_code_changed');pins[name]=pin
    return {'baseManifestSha256':sha(raw),'sourceFiles':len(pins),'sourceCodePinsSha256':sha(encoded(pins))}

def static_inputs(h):
    for name,pin in PINS.items():need(sha(protected(STAGE/name))==pin,'exact_frozen_combined_payload_required')
    need(sha(protected(TEMPLATE))==TEMPLATE_SHA,'exact_reviewed_source_unit_required');build=document(BUILD_RESULT,h.build_result);need(build['completed']is True and build['planSha256']=='ad60dfc787f29facb485cea4ac2d4a4f65058867415241e796816d620a393bd0'and build['originalActorsAndFilesUnchanged']is True and build['runtimeAreaAbsent']is True and build['actual']['uid']==970 and build['actual']['gid']==964 and build['actual']['buildId']==BUILD and build['actual']['poolMax']==5 and build['actual']['databaseCalls']==build['actual']['realProviderRequests']==build['actual']['socketAttempts']==0 and build['newNativeNamespaceAbsent']is True,'actual_inactive_host_build_required');return document(STAGE/'render.json')
def expected_env():return dict(x.split('=',1)for x in protected(STAGE/'combined.public.env').decode().splitlines()if x)
def resources():
    disk=os.statvfs('/');available=disk.f_bavail*disk.f_frsize;mem=re.search(r'^MemAvailable:\s+(\d+) kB$',Path('/proc/meminfo').read_text(),re.M);need(mem is not None,'actual_host_memory_required');memory=int(mem[1])*1024;need(available>=25*1024**3 and memory>=6*1024**3,'existing_disk_reserve_and_source_memory_required');return {'rootAvailableBytes':available,'memoryAvailableBytes':memory,'rootReserveBytes':25*1024**3,'newSourceMemoryMaxBytes':6*1024**3}
def old_private_inputs(op):
    main=next(p for p in op['oldActor']['processes']if p['pid']==op['oldActor']['pid']);pins=main['environmentFileHashes'];need(1<=len(pins)<=8 and all(re.fullmatch('/[A-Za-z0-9_./@-]+',p)and re.fullmatch('[0-9a-f]{64}',v)for p,v in pins.items()),'bounded_retained_private_inputs_required');need(all(sha(protected(p))==v for p,v in pins.items()),'original_private_inputs_changed_before_source_start')
def new_owned(h,op,pristine=False):
    s=h.state(NEW);need(s['FragmentPath']==str(UNIT)and not s['DropInPaths']and h.files(s)=={str(UNIT):TEMPLATE_SHA}and s['MemoryMax']=='6442450944'and s['RuntimeMaxUSec']=='infinity','exact_loaded_new_source_definition_required');need(not pristine or s['NRestarts']=='0','first_source_start_must_be_pristine');actor=h.actor(NEW);intent=document(BASE/'start-new-intent.json');need(actor['startMonotonicMicroseconds']>=intent['monotonicUs'],'new_source_must_follow_owned_start_intent');args=shlex.split(next(x.split('=',1)[1]for x in protected(TEMPLATE).decode().splitlines()if x.startswith('ExecStart=')));need(args[:2]==['/usr/bin/env','-i'],'fixed_clean_source_exec_required');node=next(p for p in actor['processes']if p['pid']==actor['pid']);need(node['commandSha256']==sha(('\0'.join(args[2:])+'\0').encode()),'actual_new_source_argv_required');h.public_environment(actor);need(h.actor(NEW)==actor,'new_source_changed_after_public_env_read');return actor

def review(h):
    need(not os.path.lexists(BASE)and not os.path.lexists(AREA)and not os.path.lexists(UNIT)and not os.path.lexists(NEW_LINK),'fresh_source_owner_paths_required');capacity=resources();static_inputs(h);code=base_code();policy=h.policy();q=module(QUALIFIER,QUALIFIER_SHA);qualified=q.validate_current(OLD_ACK);old=h.actor(OLD);need(old['pid']==716994 and old['invocation']=='c3463c9a2e1240e8890e318ba1360cf4','acknowledged_original_source_required');s=h.state(OLD);need(s['WantedBy']=='multi-user.target'and not any(s[k]for k in ['RequiredBy','TriggeredBy','Triggers','PartOf','UpheldBy']),'only_reviewed_old_boot_activation_required');link=link_record(OLD_LINK);need(link['target']==s['FragmentPath']and link['identity']['st_ino']==131541 and link['identity']['st_dev']==2049,'actual_normal_owned_boot_link_required');need(h.query("SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='"+SCHEMA+"'))")is False,'new_native_namespace_must_be_absent');need(h.state(NEW)['LoadState']=='not-found','new_source_unit_must_be_absent');preserved=h.preserved();binding={'format':FORMAT,'operatorSha256':sha(protected(Path(__file__).absolute())),'rpcOwnerSha256':h.rpc_sha,'rpcResultSha256':h.rpc_result,'hostBuildResultSha256':h.build_result,'bootId':boot(),'candidateSourceDigest':SOURCE_DIGEST,'buildId':BUILD,'schema':SCHEMA,'oldActor':old,'oldFiles':h.files(s),'oldBoot':link,'retained':preserved,'policy':{k:policy[k]for k in ['profileId','manifestHash','profileFile','profileFileSha256','endpoints']},'payload':PINS,'unitSha256':TEMPLATE_SHA,'sourceCode':code,'sourceRole':h.role()};need(h.actor(OLD)==old and h.preserved()==preserved,'actors_changed_during_readonly_review');return {'binding':binding,'reviewHash':sha(encoded(binding)),'capacity':capacity,'sourceChanges':0,'databaseWrites':0,'providerRequests':0}

def install(h):
    parent=AREA.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==parent.st_gid==0 and stat.S_IMODE(parent.st_mode)==0o755,'protected_runtime_parent_required');AREA.mkdir(mode=0o755);AREA.chmod(0o755);sync(AREA.parent)
    for p in [AREA/'cache',AREA/'cache/.ponder',AREA/'cache/.vite-temp']:p.mkdir(mode=0o750);p.chmod(0o750);os.chown(p,970,964)
    path=AREA/'cache/ponder-env.d.ts';save(path,b'',0o600);os.chown(path,970,964);save(UNIT,protected(TEMPLATE),0o644);save(BASE/'installed.json',{'unitIdentity':identity(UNIT),'areaIdentity':identity(AREA)});manager('daemon-reload');s=h.state(NEW);need(s['MainPID']=='0'and s['FragmentPath']==str(UNIT)and not s['DropInPaths']and s['Job']in{'','0'}and s['RuntimeMaxUSec']=='infinity'and s['MemoryMax']=='6442450944','loaded_inactive_new_source_required')
def wait_read(callback,code,seconds=60):
    deadline=time.monotonic()+seconds
    while True:
        try:return callback()
        except RuntimeError:
            need(time.monotonic()<deadline,code);time.sleep(.5)
def check_preserved(h,op,require_new_routes=True):
    static_inputs(h);old_private_inputs(op)
    if require_new_routes:h.policy()
    need(base_code()==op['sourceCode']and h.role()==op['sourceRole']and h.preserved()==op['retained'],'source_role_old_routes_and_live_YPAL_must_remain_exact')
def bootstrap(h,op):
    a=new_owned(h,op,True);n=h.native();app=n['app'];need(app['build_id']==BUILD and str(app['is_dev'])=='0'and str(app['is_locked'])=='1'and 0<=n['clock']-int(app['heartbeat_at'])<=180000,'actual_new_native_build_and_fresh_heartbeat_required');need(len(n['tables'])==44 and all(v['owner']=='73004621'and v['kind']=='r'for v in n['tables'].values())and n['checkpoints'],'new_native_owned_tables_and_actual_checkpoint_required');return a,n
def stop_old_owned(h,op):
    need(h.actor(OLD)==op['oldActor'],'same_original_source_immediately_before_stop');manager('stop',OLD)
def stop_new_owned(h,op,actor):
    if actor is not None:need(new_owned(h,op,False)==actor,'same_owned_new_source_immediately_before_stop')
    else:new_terminal(h)
    manager('stop',NEW)

def apply(h,pin):
    checked=review(h);need(checked['reviewHash']==pin,'exact_fresh_source_review_required');BASE.mkdir(mode=0o700);sync(BASE.parent);op=checked['binding'];save(BASE/'operation.json',op);step('install-new',lambda:install(h));check_preserved(h,op)
    # Capture actual backend tuples only NOW, immediately before the owned stop.
    q=module(QUALIFIER,QUALIFIER_SHA);q.validate_current(OLD_ACK);need(h.actor(OLD)==op['oldActor'],'original_source_changed_before_stop');capture={'oldNative':h.old_native(),'backends':h.sessions({OLD:op['oldActor'],'freshYPAL':h.fresh_actor()})};save(BASE/'drain-capture.json',capture);op={**op,'oldNative':capture['oldNative']};save(BASE/'old-native-preservation.json',capture['oldNative'])
    exact_link(OLD_LINK,op['oldBoot']);os.link(OLD_LINK,BASE/'original-old-boot',follow_symlinks=False);sync(BASE);save(BASE/'remove-old-boot-intent.json',op['oldBoot']);exact_link(OLD_LINK,op['oldBoot']);OLD_LINK.unlink();sync(OLD_LINK.parent);step('load-old-boot-removal',lambda:manager('daemon-reload'));check_preserved(h,op);need(h.actor(OLD)==op['oldActor'],'original_source_changed_at_stop_boundary');step('stop-old',lambda:stop_old_owned(h,op));wait_read(lambda:h.old_terminal(op),'old_source_stop_not_yet_terminal');h.preserved_old_native(op);wait_read(lambda:h.sessions({'freshYPAL':h.fresh_actor()}),'old_source_backend_drain_incomplete');check_preserved(h,op)
    # The start intent is durable before systemctl. A lost ACK never retries it.
    resources();step('start-new',lambda:manager('start',NEW));actor,native=wait_read(lambda:bootstrap(h,op),'new_source_bootstrap_not_yet_accepted',120);check_preserved(h,op);h.old_terminal(op);h.preserved_old_native(op);sessions=wait_read(lambda:h.sessions({NEW:actor,'freshYPAL':h.fresh_actor()}),'new_source_sessions_not_qualified')
    os.symlink(str(UNIT),BASE/'prepared-new-boot');sync(BASE);record=link_record(BASE/'prepared-new-boot');save(BASE/'new-boot-prepared.json',{**record,'path':str(NEW_LINK)});os.link(BASE/'prepared-new-boot',NEW_LINK,follow_symlinks=False);sync(NEW_LINK.parent);step('load-new-boot',lambda:manager('daemon-reload'));return acknowledge(h,op,actor,native,sessions)
def acknowledge(h,op,actor=None,native=None,sessions=None):
    check_preserved(h,op);h.old_terminal(op);h.preserved_old_native(op);actor,native=bootstrap(h,op)if actor is None else(actor,native);exact_link(NEW_LINK,document(BASE/'new-boot-prepared.json'));need(new_owned(h,op,True)==actor,'same_owned_new_source_before_ack');value={'format':FORMAT,'completed':True,'operatorSha256':op['operatorSha256'],'operationSha256':sha(protected(BASE/'operation.json')),'bootId':boot(),'source':actor,'native':native,'nativeFrameworkReady':str(native['app']['is_ready'])=='1','nativeCoverageAccepted':False,'readerOrWorkerSelectionsChanged':False,'candidateSourceDigest':SOURCE_DIGEST,'schema':SCHEMA,'buildId':BUILD,'rpcResultSha256':h.rpc_result,'rpcOwnerSha256':h.rpc_sha,'hostBuildResultSha256':h.build_result,'oldSourceStopped':True,'oldBootDisabled':True,'newBoot':document(BASE/'new-boot-prepared.json'),'sessionOwnership':sessions,'liveYPALAndOldRoutesPreserved':True,'checkpointCopied':False,'paidAuthority':False};save(BASE/'result.json',value);return value

def reconcile_start(h,pin):
    op=load_operation(pin);need(not (BASE/'result.json').exists()and not (BASE/'inverse-intent.json').exists(),'only_unacknowledged_noninversed_start_required');check_preserved(h,op);h.old_terminal(op);h.preserved_old_native(op);actor,native=bootstrap(h,op)
    if not (BASE/'start-new-result.json').exists():save(BASE/'start-new-result.json',{'completed':True,'observedAfterUnknownACK':True,'newStartCommands':0})
    prepared=BASE/'prepared-new-boot';record=BASE/'new-boot-prepared.json'
    if not record.exists():
        need(not os.path.lexists(prepared)and not os.path.lexists(NEW_LINK),'unacknowledged_foreign_boot_prefix_requires_manual_inspection');os.symlink(str(UNIT),prepared);sync(BASE);save(record,{**link_record(prepared),'path':str(NEW_LINK)})
    expected=document(record);exact_link(prepared,expected)
    if not os.path.lexists(NEW_LINK):os.link(prepared,NEW_LINK,follow_symlinks=False);sync(NEW_LINK.parent)
    exact_link(NEW_LINK,expected)
    if not (BASE/'load-new-boot-intent.json').exists():step('load-new-boot',lambda:manager('daemon-reload'))
    elif not (BASE/'load-new-boot-result.json').exists():need(h.state(NEW)['UnitFileState']=='enabled','lost_reload_ACK_requires_actual_enabled_unit');save(BASE/'load-new-boot-result.json',{'completed':True,'observedAfterUnknownACK':True})
    sessions=wait_read(lambda:h.sessions({NEW:actor,'freshYPAL':h.fresh_actor()}),'reconciled_new_source_sessions_not_qualified');return acknowledge(h,op,actor,native,sessions)

def load_operation(pin):
    op=document(BASE/'operation.json',pin);need(op['format']==FORMAT and op['operatorSha256']==sha(protected(Path(__file__).absolute()))and op['bootId']==boot(),'same_owned_source_operation_required')
    native=BASE/'old-native-preservation.json'
    if native.exists():op={**op,'oldNative':document(native)}
    return op

def new_terminal(h):
    s=h.state(NEW);need(s['MainPID']==s['ControlPID']=='0'and s['Job']in{'','0'}and s['ActiveState']in{'inactive','failed'},'owned_new_source_must_be_terminal');p=Path('/sys/fs/cgroup/system.slice')/NEW/'cgroup.procs';need(not p.exists()or not p.read_text().split(),'new_source_cgroup_not_empty');return s

def old_restored(h,op):
    s=h.state(OLD);need(h.files(s)==op['oldFiles'],'exact_original_source_files_required');a=h.actor(OLD);old_main=next(p for p in op['oldActor']['processes']if p['pid']==op['oldActor']['pid']);main=next(p for p in a['processes']if p['pid']==a['pid']);need(main['commandSha256']==old_main['commandSha256']and main['environmentSha256']==old_main['environmentSha256']and main['environmentFileHashes']==old_main['environmentFileHashes'],'original_source_program_and_private_environment_required')
    if a!=op['oldActor']:
        intent=document(BASE/'inverse-start-old-intent.json');need(a['startMonotonicMicroseconds']>=intent['monotonicUs'],'replacement_old_actor_not_bound_to_inverse_start')
    exact_link(OLD_LINK,op['oldBoot']);need(not os.path.lexists(NEW_LINK),'new_source_boot_must_be_removed');
    if 'oldNative'in op:h.preserved_old_native(op)
    return a

def inverse_step(name,action,observed,finish):
    intent=BASE/(name+'-intent.json');ack=BASE/(name+'-result.json')
    if ack.exists():need(document(ack)['completed']is True,'owned_inverse_ACK_required');return observed()
    if intent.exists():
        need(finish and document(intent)['bootId']==boot(),'uncertain_inverse_needs_explicit_finish');result=observed();save(ack,{'completed':True,'observedAfterUnknownACK':True});return result
    save(intent,{'bootId':boot(),'monotonicUs':time.monotonic_ns()//1000,'automaticRetryAllowed':False});action();result=observed();save(ack,{'completed':True});return result
def finish_unlink_intent(name,value,finish):
    path=BASE/name
    if path.exists():need(finish and document(path)==value,'exact_owned_unlink_intent_for_finish_required')
    else:save(path,value)

def restore(h,pin,finish=False):
    op=load_operation(pin);check_preserved(h,op,False)
    if finish:document(BASE/'inverse-intent.json')
    else:save(BASE/'inverse-intent.json',{'operationSha256':pin,'bootId':boot(),'automaticRetryAllowed':False})
    # A partial install before the stop leaves the original source untouched.
    if os.path.lexists(NEW_LINK):
        record=document(BASE/'new-boot-prepared.json');exact_link(NEW_LINK,record);finish_unlink_intent('inverse-new-boot-unlink-intent.json',record,finish);exact_link(NEW_LINK,record);NEW_LINK.unlink();sync(NEW_LINK.parent)
    removed=not os.path.lexists(UNIT)and (BASE/'inverse-remove-new-unit-intent.json').exists()
    if removed:need(finish and document(BASE/'inverse-remove-new-unit-intent.json')==document(BASE/'installed.json'),'exact_owned_unit_removal_finish_required')
    if (BASE/'start-new-intent.json').exists():
        s=h.state(NEW)
        if s['MainPID']!='0':owned_actor=new_owned(h,op,False)
        elif removed:need(not s['DropInPaths']and s['FragmentPath']in{'',str(UNIT)},'only_owned_removed_definition_can_finish')
        else:need(h.files(s)=={str(UNIT):TEMPLATE_SHA},'owned_terminal_new_definition_required')
        inverse_step('inverse-stop-new',lambda:stop_new_owned(h,op,owned_actor if s['MainPID']!='0'else None),lambda:wait_read(lambda:new_terminal(h),'owned_new_stop_not_yet_terminal'),finish)
    elif os.path.lexists(UNIT):new_terminal(h)
    need(not os.path.lexists(NEW_LINK),'no_new_boot_before_original_restore')
    if not os.path.lexists(OLD_LINK):
        need((BASE/'remove-old-boot-intent.json').exists(),'only_owned_old_boot_removal_can_be_restored');exact_link(BASE/'original-old-boot',op['oldBoot']);save(BASE/'inverse-old-boot-publish-intent.json',op['oldBoot'])if not (BASE/'inverse-old-boot-publish-intent.json').exists()else None;os.link(BASE/'original-old-boot',OLD_LINK,follow_symlinks=False);sync(OLD_LINK.parent)
    exact_link(OLD_LINK,op['oldBoot']);inverse_step('inverse-load-boot',lambda:manager('daemon-reload'),lambda:exact_link(OLD_LINK,op['oldBoot']),finish)
    check_preserved(h,op,False);state=h.state(OLD)
    if state['MainPID']=='0':
        need((BASE/'stop-old-intent.json').exists()and h.files(state)==op['oldFiles'],'owned_old_stop_and_original_files_required');inverse_step('inverse-start-old',lambda:manager('start',OLD),lambda:wait_read(lambda:old_restored(h,op),'original_source_restore_not_yet_accepted',90),finish)
    else:old_restored(h,op)
    restored=old_restored(h,op);check_preserved(h,op,False)
    if os.path.lexists(UNIT):
        installed=document(BASE/'installed.json');need(identity(UNIT)==installed['unitIdentity']and sha(protected(UNIT))==TEMPLATE_SHA,'owned_new_unit_removal_required');new_terminal(h);finish_unlink_intent('inverse-remove-new-unit-intent.json',installed,finish);need(identity(UNIT)==installed['unitIdentity']and sha(protected(UNIT))==TEMPLATE_SHA,'same_owned_new_unit_immediately_before_unlink');UNIT.unlink();sync(UNIT.parent);removed=True
    if removed:inverse_step('inverse-unload-new',lambda:manager('daemon-reload'),lambda:need(h.state(NEW)['LoadState']=='not-found','new_source_definition_not_unloaded'),finish)
    value={'format':FORMAT,'inverse':True,'completed':True,'operationSha256':pin,'oldSource':restored,'originalBootInodeRestored':True,'newSourceStoppedAndBootRemoved':True,'newSourceUnitRemoved':not os.path.lexists(UNIT),'newNativeSchemaAndCachesRetained':True,'originalNativeSchemaAndCheckpointsPreserved':True,'originalWholeValidationPassed':False,'liveYPALAndOldRoutesPreserved':True,'newRPCProfileAndRouteInverseSeparate':True,'newRoutesHealthRequiredForInverse':False,'databaseWrites':0,'paidAuthority':False};save(BASE/'inverse-result.json',value);return value

def inspect(h,pin):
    op=load_operation(pin);return {'format':FORMAT,'operationSha256':pin,'states':{name:{k:v for k,v in h.state(name).items()if k!='ExecStart'}for name in [OLD,NEW]},'acknowledgements':{p.name:sha(protected(p))for p in BASE.glob('*.json')},'oldBootPresent':os.path.lexists(OLD_LINK),'newBootPresent':os.path.lexists(NEW_LINK),'oldFilesMatch':h.files(h.state(OLD))==op['oldFiles'],'retainedYpalAndOldRoutesMatch':h.preserved()==op['retained'],'automaticRetryAllowed':False,'writes':0}

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--rpc-owner-sha');parser.add_argument('--rpc-result-sha');parser.add_argument('--build-result-sha');actions=parser.add_mutually_exclusive_group();actions.add_argument('--apply');actions.add_argument('--inspect');actions.add_argument('--restore');actions.add_argument('--finish-restore');actions.add_argument('--reconcile-start');args=parser.parse_args();need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_production_host_required');os.umask(0o077)
    with transition_lock():
        op_pin=args.inspect or args.restore or args.finish_restore or args.reconcile_start
        if op_pin:
            op=load_operation(op_pin);h=Host(op['rpcOwnerSha256'],op['rpcResultSha256'],op['hostBuildResultSha256'])
            if args.inspect:value=inspect(h,op_pin)
            elif args.restore or args.finish_restore:value=restore(h,op_pin,bool(args.finish_restore))
            else:
                value=reconcile_start(h,op_pin)
        else:
            need(all(isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)for v in [args.rpc_owner_sha,args.rpc_result_sha,args.build_result_sha]),'actual_protected_build_and_route_ACK_pins_required');h=Host(args.rpc_owner_sha,args.rpc_result_sha,args.build_result_sha);value=apply(h,args.apply)if args.apply else review(h)
        print(json.dumps(value,sort_keys=True))
if __name__=='__main__':
    try:main()
    except BaseException as e:
        print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(e).__name__,'fixedCode':str(e)if type(e)is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+',str(e))else'private_diagnostics_withheld','automaticRetryAllowed':False}));raise SystemExit(1)
