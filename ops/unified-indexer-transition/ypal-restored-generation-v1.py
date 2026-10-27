#!/usr/bin/env python3
"""Explicit owned generation drain/capsule/run/accept/inverse; default read-only.

This owner never grants, relabels generation103, runs a source/RPC scanner or
repeats an unknown SQL/start acknowledgement. Actual receipts are CLI inputs.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import time
import types

FORMAT='yunipals-ypal-restored-generation-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-restored-generation-v1-20261024')
META_BASE=Path('/var/backups/yunipals-ypal-restored-metadata-handover-v1-20261024')
META_FILE=OPS/'ypal-restored-metadata-handover-v1.py'
META_SHA='cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3'
STATIC=OPS/'ypal-restored-metadata-context-v1.py'
STATIC_SHA='fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
TEMPLATE=OPS/'ypal-native-generation-v1.py'
TEMPLATE_SHA='762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6'
CANDIDATES=Path('/var/backups/yunipals-ypal-generation-cache-candidates-v1-20261024')
CANDIDATE_SHA='53826e1e87e4d72301992b267223b4d759298478ca95daedee0723b777f33b72'
INSTALL_FILE=OPS/'ypal-generation-runtime-install-v2.py'
INSTALL_SHA='0c031bdc798b8466ea29624bbfdb253e392830ab2b2f833be4c41d6fb91c5e8f'
MONITOR=OPS/'ypal-restored-generation-capacity-watch-v1.py'
MONITOR_SHA='c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6'
CAPSULE=OPS/'ypal-generation-recovery-v1.mjs'
CAPSULE_SHA='b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21'
CANDIDATE_FILE=OPS/'ypal-generation-cache-candidates-v1.py'
CANDIDATE_PRODUCER_SHA='3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3'
GUARD=OPS/'ypal-cache-guard-transition-v1.mjs'
GUARD_SHA='6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2'
LEADER='yunipals-leaderboard.service'
BOOT=Path('/etc/systemd/system/multi-user.target.wants')/LEADER
UNIT='yunipals-ypal-restored-generation-prepare-v1.service'
WORK=Path('/run/yunipals-ypal-restored-generation-prepare-v1-20261024')
LOCK=Path('/run/lock/yunipals-ypal-native-generation-transition.lock')
PHASES=('drain','capsule','reconcile-capsule','build','reconcile-build','accept-candidate','restore-activation','reconcile-start')


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return isinstance(v,str)and re.fullmatch('[0-9a-f]{64}',v)
def module(path,digest):
    need(pin(digest),'reviewed_component_not_yet_frozen')
    for part in [*path.parents,path]:
        st=part.lstat();need(st.st_uid==0 and not stat.S_ISLNK(st.st_mode)and not st.st_mode&0o022,'protected_generation_component_required')
    raw=path.read_bytes();need(sha(raw)==digest and len(raw)<100000,'exact_generation_component_required')
    m=types.ModuleType('generation_'+path.stem.replace('-','_'));m.__file__=str(path);exec(compile(raw,str(path),'exec'),m.__dict__);return m

@contextlib.contextmanager
def lock():
    st=LOCK.parent.lstat();need(st.st_uid==st.st_gid==0 and stat.S_ISDIR(st.st_mode)and(not st.st_mode&0o022 or stat.S_IMODE(st.st_mode)==0o1777),'protected_generation_lock_parent_required')
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        st=os.fstat(fd);path=LOCK.lstat();need(stat.S_ISREG(st.st_mode)and st.st_uid==st.st_gid==0 and st.st_nlink==1 and stat.S_IMODE(st.st_mode)==0o600 and(st.st_dev,st.st_ino)==(path.st_dev,path.st_ino),'owned_generation_lock_required')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);yield
    finally:os.close(fd)

class Host:
    def __init__(self,args):
        self.meta=module(META_FILE,META_SHA);self.h=self.meta.cli_context(args.metadata_input_sha,args.phase in {'restore-activation','reconcile-start'});self.s=self.h.s;self.m=self.h.m
        need(self.h.admission_pin==args.read_ack,'same_actual_new_READ_and_metadata_input_required')
        need(sha(self.s.protected(TEMPLATE))==TEMPLATE_SHA,'unchanged_historical762_source_required')
        self.args=args;self.installer=module(INSTALL_FILE,INSTALL_SHA);self.install=self.installer.installed(self.m,args.install_ack)
        self.candidates=self.s.document(CANDIDATES/'result.json',CANDIDATE_SHA)
        need(self.candidates.get('staged')is True and self.candidates.get('selected')is False,'acknowledged_unselected_generation_candidate_required')
        for name,expected in self.candidates['files'].items():need(sha(self.m.protected(CANDIDATES/name))==expected,'generation_candidate_changed')
        need(sha(self.m.protected(MONITOR))==MONITOR_SHA and pin(CAPSULE_SHA)and sha(self.m.protected(CAPSULE))==CAPSULE_SHA and sha(self.m.protected(GUARD))==GUARD_SHA,'exact_generation_execution_components_required')
    def qualify(self,native=True):
        self.h.refresh();self.installer.installed(self.m,self.args.install_ack)
        candidate=module(CANDIDATE_FILE,CANDIDATE_PRODUCER_SHA)
        legacy=candidate.legacy_facts(self.h.query(candidate.context_sql(self.h.meta)))
        need(legacy==self.candidates['retainedLegacyFacts'],'unchanged_original_generation103_guard35_and_cache_role_required')
        op=self.meta.operation(self.h,self.args.metadata_operation)
        if native:
            selected=self.s.document(META_BASE/'selected.json',self.args.metadata_selected)
            need(selected.get('selected')is True and self.h.actor(op,True)==selected['nativeActor'],'same_acknowledged_native_metadata_writer_required')
            name=self.args.metadata_provenance;need(re.fullmatch(r'provenance-(0|[1-9][0-9]{0,2})-observed.json',name)and int(name.split('-')[1])<128,'bounded_actual_provenance_receipt_required')
            proof=self.s.document(META_BASE/name,self.args.metadata_provenance_sha)
            need(proof.get('completeForCurrentPublishedArchiveBase')is True and proof.get('remainingPublished')==0 and proof.get('publicationProof',{}).get('allPublishedCanonical')is True,'complete_actual_native_metadata_provenance_required')
            db=self.h.database();need(db['probe']is True and db['scan']['ingestion_mode']=='native'and db['remainingPublished']==0,'current_native_metadata_approval_and_provenance_required')
            actual=self.h.publication_proof();need(actual['allPublishedCanonical']is True,'all_current_published_base_rows_need_canonical_provenance')
        return op
    def state(self,unit=LEADER):
        raw=self.m.run(['/usr/bin/systemctl','show','--all',unit,*['--property='+k for k in self.meta.PROPS]])
        value={}
        for line in raw.decode().splitlines():
            k,sep,v=line.partition('=');need(sep and k in self.meta.PROPS,'fixed_generation_unit_keys_required')
            if k=='EnvironmentFiles':value.setdefault(k,[]).append(v)
            else:need(k not in value,'unique_generation_unit_keys_required');value[k]=v
        absent=all(value.get(k)==v for k,v in {'Id':unit,'LoadState':'not-found','ActiveState':'inactive','SubState':'dead','MainPID':'0','ControlPID':'0','Job':'','FragmentPath':'','DropInPaths':''}.items())
        if absent and 'ExecStart'not in value:value['ExecStart']=''
        if 'EnvironmentFiles'not in value:
            if not absent:
                obj='/org/freedesktop/systemd1/unit/'+re.sub(r'[^A-Za-z0-9]',lambda x:'_'+format(ord(x[0]),'02x'),unit)
                typed=json.loads(self.m.run(['/usr/bin/busctl','--system','--json=short','get-property','org.freedesktop.systemd1',obj,'org.freedesktop.systemd1.Service','EnvironmentFiles']))
                need(typed=={'type':'a(sb)','data':[]},'typed_empty_generation_unit_environment_required')
            value['EnvironmentFiles']=[]
        need(set(value)==set(self.meta.PROPS)and value['Id']==unit and(value['LoadState']=='not-found'or value['KillMode']=='control-group'),'complete_generation_unit_state_required');return value
    def actor(self):
        old,_=self.m.snapshot(LEADER);u=self.state();need(u['MainPID']==str(old['process']['pid'])and u['ControlGroup']=='/system.slice/'+LEADER and u['Job']=='','same_original_leaderboard_actor_required')
        cg=Path('/sys/fs/cgroup/system.slice')/LEADER/'cgroup.procs';pids=[int(p)for p in cg.read_text().split()]
        need(old['process']['pid']in pids and 1<=len(pids)<=8,'bounded_owned_generation_cgroup_required')
        processes=[self.m.process(str(p))for p in sorted(pids)]
        need(self.m.snapshot(LEADER)[0]==old and self.state()==u,'leaderboard_changed_during_capture')
        return {'writer':old,'unit':u,'main':old['process'],'processes':processes}
    def private(self,op):
        old=op['oldActor']['writer'];self.h.private(old);u=self.state()
        need(self.h.files(u)==old['definitions']and self.m.ordered_files(u['EnvironmentFiles'])==[(p,False)for p in self.m.ENV_FILES[LEADER]],'same_original_leaderboard_definitions_and_private_order_required')
        need(sha(encoded(self.m.service_property(LEADER,'Environment')))==old['inlineEnvironmentSha256']and not any(self.m.service_property(LEADER,k)for k in['PassEnvironment','UnsetEnvironment']),'same_original_leaderboard_inline_context_required')
    def consumers(self):
        static=module(STATIC,STATIC_SHA);read=static.read_context()
        pure=read.module(read.READ_HELPERS,read.READ_HELPERS_SHA)
        sdk=static.query_components()['privilegedSourcePrimitives']['sdk']
        frame=pure.consumer_frame(types.SimpleNamespace(m=types.SimpleNamespace(run=sdk.command,protected=sdk.protected)))
        frame.pop(self.meta.UNIT)
        candidate=module(CANDIDATE_FILE,CANDIDATE_PRODUCER_SHA)
        return {'apis':frame,'cache':candidate.cache_snapshot(self.m)}
    def external(self,op):
        need(self.consumers()==op['consumerFence'],'unchanged_or_preinversed_consumers_required')
        self.private(op)
        return sha(encoded({'consumers':op['consumerFence'],'private':op['oldActor']['writer']['environmentFileHashes']}))
    def terminal(self,op):
        u=self.state();need(u['MainPID']==u['ControlPID']=='0'and u['Job']==''and u['ActiveState']in{'inactive','failed'},'original_leaderboard_must_be_terminal')
        cg=Path('/sys/fs/cgroup/system.slice')/LEADER/'cgroup.procs';need(not cg.exists()or not cg.read_text().split(),'original_leaderboard_cgroup_must_be_empty')
        need(not any(self.meta.identity_alive(self.m,p)for p in op['oldActor']['processes']),'old_leaderboard_processes_must_be_gone')
        fresh=self.s.document(BASE/'drain-sessions.json')['sessions'];rows=self.h.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start)),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=16388 AND datid=17584")
        need(not any(any(r['pid']==s['pid']and r['backendStart']==s['backendStart']for s in fresh['owned'])for r in rows),'original_leaderboard_backend_sessions_remain')
        self.private(op);return u
    def manager(self,action,unit=None):
        need(action in{'daemon-reload','start','stop'}and(unit in{LEADER,UNIT}or action=='daemon-reload'),'fixed_generation_manager_action_required')
        r=subprocess.run(['/usr/bin/systemctl',action,*([]if action=='daemon-reload'else[unit])],capture_output=True,timeout=90,env=self.m.CLEAN,cwd='/')
        need(r.returncode==0 and not r.stdout and not r.stderr,'generation_manager_ack_unknown_do_not_repeat')
    def context(self):
        return self.h.query("SELECT jsonb_build_object('generation',(SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)FROM metadata_projection.active a JOIN metadata_projection.generation g ON g.id=a.current_id WHERE a.singleton),'previous',(SELECT previous_id::text FROM metadata_projection.active WHERE singleton),'archive',(SELECT release_id FROM metadata_source.archive_release WHERE state='active'),'stamps',(SELECT jsonb_agg(to_jsonb(s)ORDER BY name)FROM metadata.derived_snapshot s WHERE name IN('traits','leaderboard')),'ready',(SELECT bool_and(coalesce(("+self.h.meta.READ+".source_probe(c)->>'ready')::boolean,false))FROM unnest(ARRAY['ethereum','base','polygon','bnb'])c),'epochCount',(SELECT count(*)FROM metadata_projection.read_epoch),'capsuleSchemaPresent',to_regnamespace('ypal_generation_recovery_v1')IS NOT NULL)")

def review(h):
    h.qualify();capacity_preflight(h);a=h.actor();u=a['unit'];need(u['Restart']=='on-failure'and u['UnitFileState']=='enabled'and u['WantedBy']=='multi-user.target'and all(u[k]==''for k in['RequiredBy','TriggeredBy','Triggers','PartOf','UpheldBy']),'sole_original_generation_boot_path_required')
    boot=h.meta.link(BOOT);need(boot['target']=='/etc/systemd/system/'+LEADER,'exact_original_generation_boot_link_required')
    need(not os.path.lexists(BASE)and all(h.state(unit)['LoadState']=='not-found'for unit in[UNIT]),'fresh_owned_generation_runtime_required')
    context=h.context();need(context['generation']['id']=='103'and context['generation']['state']=='ready'and context['generation']['ownership_release_id']is None and context['generation']['ownership_read_identity']is None and context['ready']is True,'all_four_ready_and_original_unlabelled_generation103_required')
    files={str(p):sha(h.m.protected(p))for p in[MONITOR,CAPSULE,GUARD]}
    binding={'format':FORMAT,'operatorSha256':sha(h.s.protected(Path(__file__).absolute())),'bootId':h.s.boot(),'readAdmissionSha256':h.args.read_ack,'readConfig':h.h.read_config,'metadataInputSha256':h.args.metadata_input_sha,'metadataOperatorSha256':META_SHA,'historicalGenerationProducerSha256':TEMPLATE_SHA,'metadataOperationSha256':h.args.metadata_operation,'metadataSelectedSha256':h.args.metadata_selected,'metadataProvenanceFile':h.args.metadata_provenance,'metadataProvenanceSha256':h.args.metadata_provenance_sha,'candidateSha256':CANDIDATE_SHA,'installSha256':h.args.install_ack,'artifactDigest':h.installer.DIGEST,'oldActor':a,'oldBoot':boot,'consumerFence':h.consumers(),'context':context,'executionFiles':files}
    need(h.actor()==a,'original_generation_actor_changed_during_review');h.qualify();return binding

def capacity_preflight(h):
    sizes=h.h.query("SELECT jsonb_build_object('capsule',(pg_total_relation_size('leaderboard.wallet_stats')+pg_total_relation_size('metadata.derived_snapshot')+pg_total_relation_size('metadata_projection.active'))::text,'snapshot',(pg_table_size('metadata.token_metadata')+2*pg_table_size('unified_ypal_20261023_v1.token'))::text,'generation',(pg_total_relation_size('metadata.token_search')+pg_total_relation_size('metadata.token_trait')+pg_total_relation_size('metadata.projection_revision'))::text)")
    need(all(isinstance(v,str)and re.fullmatch('[0-9]+',v)for v in sizes.values())and set(sizes)=={'capsule','snapshot','generation'},'bounded_existing_relation_capacity_estimates_required')
    estimate=lambda value:(int(value)*3+1)//2
    peak=estimate(sizes['capsule'])+estimate(sizes['snapshot'])+max(8000000000,estimate(sizes['generation']))
    fs=os.statvfs('/');free=fs.f_bavail*fs.f_frsize
    need(free>=30000000000+peak,'measured_capsule_snapshot_generation_and_abort_reserve_required')
    monitor=module(MONITOR,MONITOR_SHA);monitor.no_overlap_window(monitor.MAX_SECONDS)
    return {'availableBytes':free,'estimatedPeakBytes':peak,'reserveBytes':25000000000,'abortFreeBytes':30000000000,'paidAuthorityChanged':False}

def operation(h,p):
    op=h.s.document(BASE/'operation.json',p);need(op['format']==FORMAT and op['operatorSha256']==sha(h.s.protected(Path(__file__).absolute()))and op['bootId']==h.s.boot()and op['readAdmissionSha256']==h.args.read_ack and op['installSha256']==h.args.install_ack and op['readConfig']==h.h.read_config and op['metadataInputSha256']==h.args.metadata_input_sha and op['metadataOperatorSha256']==META_SHA and op['historicalGenerationProducerSha256']==TEMPLATE_SHA,'same_owned_generation_operation_required')
    for key,value in [('metadataOperationSha256',h.args.metadata_operation),('metadataSelectedSha256',h.args.metadata_selected),('metadataProvenanceSha256',h.args.metadata_provenance_sha)]:need(op[key]==value,'same_owned_metadata_receipts_required')
    need(op['metadataProvenanceFile']==h.args.metadata_provenance,'same_owned_metadata_provenance_path_required')
    return op

def drained(h,op):
    need(not os.path.lexists(BOOT)and h.meta.link(BASE/'original-boot-link')==op['oldBoot'],'owned_disabled_generation_boot_required');h.terminal(op)

def drain(h,binding):
    h.qualify();need(h.actor()==binding['oldActor'],'same_reviewed_generation_actor_required')
    BASE.mkdir(mode=0o700);h.s.sync(BASE.parent);p=h.s.save(BASE/'operation.json',binding)
    h.s.save(BASE/'boot-remove-intent.json',binding['oldBoot']);need(h.meta.link(BOOT)==binding['oldBoot'],'original_generation_boot_changed');os.rename(BOOT,BASE/'original-boot-link');h.s.sync(BOOT.parent);h.s.sync(BASE)
    h.s.save(BASE/'boot-remove-result.json',{'removed':True});h.manager('daemon-reload')
    current=h.actor();need(current['writer']==binding['oldActor']['writer']and current['main']==binding['oldActor']['main']and current['processes']==binding['oldActor']['processes']and current['unit']=={**binding['oldActor']['unit'],'UnitFileState':'disabled','WantedBy':''},'same_actor_before_fresh_generation_sessions_required')
    sessions=h.h.sessions(current);need(h.actor()==current,'generation_actor_changed_during_session_capture');h.s.save(BASE/'drain-sessions.json',{'actor':current,'sessions':sessions})
    h.s.save(BASE/'stop-old-intent.json',{'actor':current,'monotonicUs':time.monotonic_ns()//1000});need(h.actor()==current,'generation_actor_changed_after_stop_intent');h.manager('stop',LEADER)
    drained(h,binding);h.s.save(BASE/'drained.json',{'operationSha256':p,'stopped':True});return p

BRIDGE=r"""
import{createRequire}from'node:module';import{createInterface}from'node:readline';const require=createRequire(process.cwd()+'/package.json'),{Client}=require('pg');
const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();const v=JSON.parse((await lines.next()).value);
const guard='data:text/javascript;base64,'+Buffer.from(v.guard).toString('base64');
const source=v.component.replace('"./ypal-cache-guard-transition-v1.mjs"',JSON.stringify(guard));const m=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const db=new Client({host:'/var/run/postgresql',port:5432,user:'postgres',database:'yunipals_backfill',connectionTimeoutMillis:3000,statement_timeout:60000});
try{await db.connect();const who=(await db.query("SELECT current_user AS role,current_database()AS database")).rows[0];if(who.role!=='postgres'||who.database!=='yunipals_backfill')throw Error('fixed_capsule_peer_required');
if(v.phase!=='capsule')await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const before=async prepared=>{console.log(JSON.stringify({prepared}));if((await lines.next()).value!=='COMMIT')throw Error('prepared_commit_ack_required');};
let result;if(v.phase==='capsule')result=await m.captureGenerationRecovery(db,v.external,before);
else if(v.phase==='verify-capsule')result=await m.verifyGenerationRecovery(db,v.receipt);
else if(v.phase==='observe')result=await m.observeGenerationRecovery(db);
else throw Error('fixed_capsule_phase_required');if(v.phase!=='capsule')await db.query('ROLLBACK');console.log(JSON.stringify({result}));
}catch(error){console.log(JSON.stringify({failed:true,code:/^[a-z_]+$/.test(error.message??'')?error.message:'capsule_outcome_requires_readonly_inspection'}));process.exitCode=1;}finally{await db.end().catch(()=>{});lines.return?.();}
"""

def bridge(h,phase,payload,record=None):
    need(pin(CAPSULE_SHA)and sha(h.s.protected(CAPSULE))==CAPSULE_SHA and sha(h.s.protected(GUARD))==GUARD_SHA,'same_capsule_and_guard_component_required')
    data={'phase':phase,'component':h.s.protected(CAPSULE).decode(),'guard':h.s.protected(GUARD).decode(),**payload}
    import pwd,grp
    u,g=pwd.getpwnam('postgres'),grp.getgrnam('postgres');need(u.pw_uid>0 and u.pw_gid==g.gr_gid,'fixed_nonroot_postgres_peer_required')
    args=['/usr/bin/setpriv','--reuid='+str(u.pw_uid),'--regid='+str(g.gr_gid),'--clear-groups','/usr/bin/env','-i',*[k+'='+v for k,v in h.m.CLEAN.items()],h.m.NODE,'--input-type=module','-e',BRIDGE]
    h.s.save(BASE/(record+'-intent.json'),{'phase':phase,'payloadSha256':sha(encoded(payload)),'automaticRetry':False})if record else None
    log=BASE/(record+'.stderr.private')if record else next((BASE/(phase+'-'+str(i)+'.stderr.private')for i in range(16)if not(BASE/(phase+'-'+str(i)+'.stderr.private')).exists()),None)
    need(log is not None,'bounded_readonly_capsule_observation_logs_required')
    with log.open('xb')as err:
        child=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=err,env=h.m.CLEAN,cwd=str(h.m.PROJECT),text=True,bufsize=1)
        child.stdin.write(encoded(data).decode());child.stdin.flush();first=json.loads(child.stdout.readline(1000000))
        if record:
            need('prepared'in first,'capsule_prepare_ack_missing_unknown_outcome');h.s.save(BASE/(record+'-prepared.json'),first['prepared']);h.h.refresh();child.stdin.write('COMMIT\n');child.stdin.flush();result=json.loads(child.stdout.readline(1000000))
        else:result=first
        child.stdin.close();status=child.wait(timeout=90)
    need(status==0 and 'result'in result and log.stat().st_size==0,'capsule_ack_unknown_inspect_do_not_repeat')
    if record:h.s.save(BASE/(record+'-result.json'),result['result'])
    return result['result']

def read_bridge(h,phase,payload):
    need(phase in{'observe','verify-capsule'},'only_readonly_capsule_inspection_allowed')
    need(sha(h.s.protected(CAPSULE))==CAPSULE_SHA and sha(h.s.protected(GUARD))==GUARD_SHA,'same_readonly_capsule_code_required')
    import pwd,grp
    u,g=pwd.getpwnam('postgres'),grp.getgrnam('postgres');need(u.pw_uid>0 and u.pw_gid==g.gr_gid,'fixed_nonroot_postgres_peer_required')
    args=['/usr/bin/setpriv','--reuid='+str(u.pw_uid),'--regid='+str(g.gr_gid),'--clear-groups','/usr/bin/env','-i',*[k+'='+v for k,v in h.m.CLEAN.items()],h.m.NODE,'--input-type=module','-e',BRIDGE]
    data={'phase':phase,'component':h.s.protected(CAPSULE).decode(),'guard':h.s.protected(GUARD).decode(),**payload}
    result=subprocess.run(args,input=encoded(data),capture_output=True,timeout=90,env=h.m.CLEAN,cwd=str(h.m.PROJECT))
    need(result.returncode==0 and not result.stderr and len(result.stdout)<1000000,'readonly_capsule_inspection_failed')
    value=json.loads(result.stdout);need('result'in value,'readonly_capsule_result_required');return value['result']

def worker_terminal(h,unit,work):
    path=BASE/(unit+'-start-intent.json')
    if path.exists():
        intent=h.s.document(path);definition=Path('/etc/systemd/system')/unit
        need(h.meta.file_identity(definition)==h.s.document(BASE/(unit+'-file-created.json'))and sha(h.s.protected(definition))==intent['definitionSha256'],'same_owned_generation_unit_file_required')
    u=h.state(unit);
    need(u['DropInPaths']==''and(u['LoadState']=='not-found'or(u['User']==u['Group']=='root'and u['Restart']=='no')),'unmodified_one_shot_identity_and_restart_policy_required')
    need(u['MainPID']==u['ControlPID']=='0'and u['Job']==''and u['ActiveState']in{'inactive','failed'},'owned_generation_worker_must_be_terminal')
    cg=Path('/sys/fs/cgroup/system.slice')/unit/'cgroup.procs';need(not cg.exists()or not cg.read_text().split(),'owned_generation_worker_cgroup_must_be_empty')
    app='yunipals_ypal_restored_generation_prepare_20261024'
    need(h.h.query("SELECT count(*)FROM pg_stat_activity WHERE datid=17584 AND usesysid=16388 AND application_name='"+app+"'")==0,'owned_generation_worker_backend_sessions_remain');return u

def unit_bytes(h):
    unit=UNIT;runtime='yunipals-ypal-restored-generation-prepare-v1-20261024'
    command='/usr/bin/python3 -I -B '+str(MONITOR)
    return ('[Unit]\nDescription=Owned native generation one shot\nAfter=postgresql.service\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(h.m.PROJECT)+'\nExecStart=/usr/bin/env -i '+ ' '.join(k+'='+v for k,v in h.m.CLEAN.items())+' '+command+'\nRestart=no\nRuntimeMaxSec=1500\nTimeoutStartSec=30\nTimeoutStopSec=20\nKillMode=control-group\nUMask=0077\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nAmbientCapabilities=\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nRuntimeDirectory='+runtime+'\nRuntimeDirectoryMode=0700\nRuntimeDirectoryPreserve=yes\n').encode()

def build(h,op):
    unit=UNIT;need(not(BASE/(unit+'-start-intent.json')).exists(),'owned_generation_build_never_repeated')
    h.qualify();capacity_preflight(h);drained(h,op);capsule=h.s.document(BASE/'capsule-result.json')
    read_only_capsule(h,capsule);ids=capsule['preservedGenerations'];need(all(re.fullmatch('[1-9][0-9]{0,18}',v)for v in ids),'actual_capsule_generation_ids_required')
    public={'PROJECTION_PRESERVE_GENERATION_IDS':','.join(ids),'OFFCHAIN_DB_POOL_MAX':'4','PROJECTION_BACKUP_PEAK_BYTES':'0','PROJECTION_MIN_FREE_BYTES':'25000000000','PROJECTION_STORAGE_PATH':'/'}
    path=BASE/'generation.public.env';raw=h.m.env_bytes(public);need(not path.exists(),'fresh_owned_generation_public_parameters_required');h.s.save(path,raw)
    target=Path('/etc/systemd/system')/unit;need(not os.path.lexists(target)and h.state(unit)['LoadState']=='not-found','fresh_one_shot_unit_required')
    definition=unit_bytes(h);h.s.save(BASE/(unit+'-file-intent.json'),{'sha256':sha(definition)})
    h.s.save(target,definition,0o644);h.s.save(BASE/(unit+'-file-created.json'),h.meta.file_identity(target));h.manager('daemon-reload')
    h.qualify();drained(h,op);read_only_capsule(h,capsule);h.s.save(BASE/(unit+'-start-intent.json'),{'definitionSha256':sha(definition),'monotonicUs':time.monotonic_ns()//1000,'automaticRetry':False,'publicationAllowed':False})
    need(h.state(unit)['MainPID']=='0'and sha(h.s.protected(target))==sha(definition),'one_shot_changed_after_start_intent');h.manager('start',unit)
    u=h.state(unit);need(u['ActiveState']=='active'and re.fullmatch('[0-9a-f]{32}',u['InvocationID']),'owned_started_generation_invocation_required')
    return h.s.save(BASE/(unit+'-started.json'),{'invocation':u['InvocationID'],'main':h.m.process(u['MainPID']),'unitSha256':sha(definition)})

def reconcile_build(h,op):
    drained(h,op);unit=UNIT;work=WORK
    intent=h.s.document(BASE/(unit+'-start-intent.json'));created=h.s.document(BASE/(unit+'-file-created.json'));path=Path('/etc/systemd/system')/unit
    need(h.meta.file_identity(path)==created and sha(h.s.protected(path))==intent['definitionSha256']and intent['publicationAllowed']is False,'same_owned_preparation_unit_required')
    u=h.state(unit);w=h.s.document(work/'intent.json');need(u['InvocationID']==w['invocation']and w['unit']==unit and w['automaticRetry']is False,'actual_owned_worker_intent_required')
    if u['MainPID']=='0':worker_terminal(h,unit,work)
    else:need(u['MainPID']==str(w['mainPid'])and int(u['ExecMainStartTimestampMonotonic'])>=intent['monotonicUs'],'owned_one_shot_start_boundary_required')
    return h.s.save(BASE/(unit+'-started.json'),{'invocation':u['InvocationID'],'unitSha256':intent['definitionSha256'],'reconciledWithoutStart':True})

def read_only_capsule(h,receipt):
    actual=read_bridge(h,'observe',{})
    need(actual['pointer']=={'current_id':receipt['currentGeneration'],'previous_id':receipt['previousGeneration']}and actual['generationBindingSha256']==receipt['generationBindingSha256']and actual['walletStats']=={k:receipt['walletStats'][k]for k in['count','sha256']}and actual['derivedStamps']=={k:receipt['derivedStamps'][k]for k in['count','sha256']},'original_global_generation_wallets_and_stamps_must_remain_unchanged')
    return actual

def accept_candidate(h,op):
    h.qualify();drained(h,op);u=worker_terminal(h,UNIT,WORK);started=h.s.document(BASE/(UNIT+'-started.json'));out=h.s.document(WORK/'result.json');runtime=h.s.document(WORK/'intent.json')
    need(u['InvocationID']==started['invocation']==out['invocation']==runtime['invocation']and out['childExit']==0 and out['failure']is None and out['minimumAvailableBytes']>=30000000000,'acknowledged_successful_owned_candidate_worker_required')
    raw=h.s.protected(WORK/'child.stdout.private',1000000);rows=[json.loads(line)for line in raw.splitlines()if line.startswith(b'{')]
    need(len(rows)==1 and rows[0].get('event')=='native_generation_prepared'and rows[0].get('published')is False and rows[0].get('prepared')is True,'actual_official_unpublished_candidate_result_required')
    candidate=rows[0];g_id=candidate['generationId'];need(re.fullmatch('[1-9][0-9]{0,18}',g_id),'actual_candidate_id_required')
    g=h.h.query("SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)FROM metadata_projection.generation g WHERE id="+g_id)
    need(g and g['state']=='ready'and g['published_at']is None and g['ownership_release_id']==h.h.meta.RELEASE and g['ownership_read_identity']==h.h.meta.IDENTITY and g['validation']==candidate['validation']and candidate['predecessor']==op['context']['generation']['id'],'actual_ready_unpublished_native_candidate_required')
    since=runtime['startedUnix'];need(type(since)in{float,int}and since>0 and h.h.query("SELECT count(*)FROM metadata_projection.generation WHERE id="+g_id+"AND extract(epoch FROM started_at)>="+str(since-1))==1,'candidate_must_have_started_in_owned_build')
    capsule=h.s.document(BASE/'capsule-result.json');baseline=read_only_capsule(h,capsule)
    result={'format':'yunipals-ypal-restored-generation-candidate-v1','completed':True,'built':True,'validated':True,'published':False,'operatorSha256':sha(h.s.protected(Path(__file__).absolute())),'operationSha256':sha(h.s.protected(BASE/'operation.json')),'readAdmissionSha256':h.args.read_ack,'readConfig':h.h.read_config,'metadataInputSha256':h.args.metadata_input_sha,'metadataOperatorSha256':META_SHA,'historicalGenerationProducerSha256':TEMPLATE_SHA,'metadataOperationSha256':h.args.metadata_operation,'metadataSelectedSha256':h.args.metadata_selected,'metadataProvenanceSha256':h.args.metadata_provenance_sha,'candidateSelectorsSha256':CANDIDATE_SHA,'artifactDigest':h.installer.DIGEST,'installSha256':h.args.install_ack,'generationId':g_id,'sourceRelease':g['ownership_release_id'],'readIdentity':g['ownership_read_identity'],'metadataReleaseId':g['metadata_release_id'],'predecessorGenerationId':candidate['predecessor'],'generationValidationSha256':sha(encoded(g['validation'])),'sourceSnapshot':g['validation']['sourceSnapshot'],'capsuleResultSha256':sha(h.s.protected(BASE/'capsule-result.json')),'originalGlobalObservation':baseline,'sourceReadinessQualified':False,'publicationAllowed':False,'separateCoordinatedCutoverRequired':True}
    return h.s.save(BASE/'candidate-result.json',result)

def validate_candidate_database_current(candidate_sha):
    """Database/immutable receipt leaf only; caller owns READ+4/source/cache guards."""
    installer=module(INSTALL_FILE,INSTALL_SHA);m=installer.shared()
    static=module(STATIC,STATIC_SHA);parts=static.query_components()
    source=parts['privilegedSourcePrimitives']['host'].s;query=parts['readerHost'].query
    h=types.SimpleNamespace(s=source,m=m)
    value=source.document(BASE/'candidate-result.json',candidate_sha)
    need(value['format']=='yunipals-ypal-restored-generation-candidate-v1'and value['completed']is True and value['built']is True and value['validated']is True and value['published']is False and value['operatorSha256']==sha(source.protected(Path(__file__).absolute()))and value['publicationAllowed']is False,'actual_owned_unpublished_candidate_receipt_required')
    op=source.document(BASE/'operation.json',value['operationSha256']);need(op['operatorSha256']==value['operatorSha256']and op['readAdmissionSha256']==value['readAdmissionSha256']and op['metadataOperationSha256']==value['metadataOperationSha256']and op['metadataSelectedSha256']==value['metadataSelectedSha256']and op['metadataProvenanceSha256']==value['metadataProvenanceSha256'] and op['readConfig']==value['readConfig'] and op['metadataOperatorSha256']==value['metadataOperatorSha256']==META_SHA and op['metadataInputSha256']==value['metadataInputSha256'] and op['historicalGenerationProducerSha256']==value['historicalGenerationProducerSha256']==TEMPLATE_SHA,'candidate_owned_receipt_chain_required')
    installer.installed(m,value['installSha256']);capsule=source.document(BASE/'capsule-result.json',value['capsuleResultSha256']);read_bridge(h,'verify-capsule',{'receipt':capsule})
    need(read_only_capsule(h,capsule)==value['originalGlobalObservation'],'candidate_original_global_context_changed')
    g_id=value['generationId'];need(isinstance(g_id,str)and re.fullmatch('[1-9][0-9]{0,18}',g_id),'actual_candidate_id_required')
    g=query("SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)FROM metadata_projection.generation g WHERE id="+g_id)
    need(g and g['state']=='ready'and g['published_at']is None and g['metadata_release_id']==value['metadataReleaseId']and g['ownership_release_id']==value['sourceRelease']and g['ownership_read_identity']==value['readIdentity']and sha(encoded(g['validation']))==value['generationValidationSha256']and g['validation']['sourceSnapshot']==value['sourceSnapshot']and value['predecessorGenerationId']==capsule['currentGeneration'],'candidate_database_identity_or_validation_changed')
    return {'format':value['format'],'validated':True,'receiptSha256':candidate_sha,'operatorSha256':value['operatorSha256'],'generationId':g_id,'sourceRelease':value['sourceRelease'],'readIdentity':value['readIdentity'],'predecessorGenerationId':value['predecessorGenerationId'],'published':False,'globalContextUnchanged':True,'sourceReadinessQualified':False,'metadataCurrentReadinessQualified':False,'readAdmissionGraphQualified':False,'cacheActorQualified':False,'databaseWrites':0,'serviceActions':0}

def restore_activation(h,op,reconcile=False):
    need(not(BASE/'activation-restored.json').exists(),'completed_original_activation_cannot_repeat')
    if(BASE/(UNIT+'-start-intent.json')).exists():worker_terminal(h,UNIT,WORK)
    if(BASE/'capsule-result.json').exists():read_only_capsule(h,h.s.document(BASE/'capsule-result.json'))
    h.qualify(native=False);inverse=h.s.document(META_BASE/'inverse-result.json',h.args.metadata_inverse)
    need(inverse.get('restored')is True and h.meta.state(h.m)['ActiveState']=='active','accepted_metadata_inverse_before_legacy_generation_restart_required')
    need(h.m.snapshot(h.meta.UNIT)[0]==inverse['oldWriter'],'same_restored_original_metadata_context_required');h.private(op)
    u=h.state();old_live=u['ActiveState']=='active'and u['MainPID']!='0'
    if old_live:
        actor=h.actor()
        if(BASE/'original-start-intent.json').exists():
            need(reconcile,'owned_start_ack_unknown_requires_explicit_reconciliation')
            intent=h.s.document(BASE/'original-start-intent.json');started=u['ExecMainStartTimestampMonotonic']
            need(intent['boot']==op['oldBoot']and isinstance(started,str)and started.isdecimal()and intent['monotonicUs']<=int(started)<=time.monotonic_ns()//1000,'original_resume_must_follow_its_owned_start_intent')
            need(actor['writer']['definitions']==op['oldActor']['writer']['definitions']and actor['writer']['configuredEnvironmentSha256']==op['oldActor']['writer']['configuredEnvironmentSha256'],'exact_restored_original_generation_actor_required')
        else:need(actor['main']==op['oldActor']['main']and actor['processes']==op['oldActor']['processes'],'only_same_original_live_actor_may_be_retained')
    else:h.terminal(op)
    publish=BASE/'original-boot-publish-intent.json'
    if os.path.lexists(BOOT):
        need(reconcile and publish.exists()and h.s.document(publish)==op['oldBoot']and h.meta.link(BOOT)==op['oldBoot'],'only_owned_published_boot_prefix_can_be_reconciled')
        need(u['UnitFileState']=='enabled'and u['WantedBy']=='multi-user.target','owned_reload_outcome_must_be_observed_not_retried')
    else:
        need(h.meta.link(BASE/'original-boot-link')==op['oldBoot'],'same_owned_original_boot_link_required')
        if publish.exists():need(reconcile and h.s.document(publish)==op['oldBoot'],'explicit_same_owned_boot_intent_required')
        else:h.s.save(publish,op['oldBoot'])
        need(h.meta.link(BASE/'original-boot-link')==op['oldBoot'],'boot_changed_after_restore_intent')
        os.rename(BASE/'original-boot-link',BOOT);h.s.sync(BOOT.parent);h.s.sync(BASE);h.manager('daemon-reload')
    start=BASE/'original-start-intent.json'
    if not old_live:
        need(not start.exists(),'unknown_original_start_cannot_be_repeated');h.s.save(start,{'boot':op['oldBoot'],'monotonicUs':time.monotonic_ns()//1000})
        h.private(op);need(h.state()['MainPID']=='0'and h.meta.link(BOOT)==op['oldBoot'],'original_generation_changed_after_start_intent');h.manager('start',LEADER);actor=h.actor()
    else:
        current=h.actor();need(current['main']==actor['main']and current['processes']==actor['processes']and current['writer']==actor['writer'],'same_original_live_actor_after_boot_restoration_required');actor=current
    h.private(op);need(h.meta.link(BOOT)==op['oldBoot']and h.actor()==actor,'same_original_generation_actor_and_boot_at_inverse_finish_required')
    return h.s.save(BASE/'activation-restored.json',{'restored':True,'oldWriter':actor['writer'],'metadataInverseSha256':h.args.metadata_inverse,'originalRemainedRunning':old_live and not start.exists(),'generation103Relabelled':False,'candidatePublished':False})

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in['read-ack','install-ack','metadata-operation','metadata-selected','metadata-provenance-sha','metadata-input-sha']:p.add_argument('--'+name)
    p.add_argument('--metadata-provenance');p.add_argument('--metadata-inverse');p.add_argument('--phase',choices=PHASES);p.add_argument('--ack');a=p.parse_args()
    if not any(vars(a).values()):
        print(json.dumps({'format':FORMAT,'staticOnly':True,'generationStarted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(all(pin(getattr(a,n))for n in ['read_ack','install_ack','metadata_operation','metadata_selected','metadata_provenance_sha','metadata_input_sha'])and isinstance(a.metadata_provenance,str),'actual_current_generation_and_metadata_refs_required')
    need(os.geteuid()==os.getegid()==0 and __import__('socket').gethostname()=='yunipals-main','fixed_root_generation_host_required');os.umask(0o077)
    h=Host(a)
    with lock():
        if not a.phase or a.phase=='drain':
            binding=review(h);digest=sha(encoded(binding))
            result=drain(h,binding)if a.phase and a.ack==digest else None
            need(not a.phase or result is not None,'fresh_exact_generation_review_required');print(json.dumps({'format':FORMAT,'reviewHash':digest,'binding':binding,'operationSha256':result,'databaseWrites':0,'generationStarted':False},sort_keys=True));return
        op=operation(h,a.ack)
        if a.phase=='capsule':h.qualify();capacity_preflight(h);drained(h,op);need(not(BASE/'capsule-intent.json').exists(),'capsule_unknown_ack_never_repeated');result=bridge(h,'capsule',{'external':h.external(op)},'capsule')
        elif a.phase=='reconcile-capsule':result=read_bridge(h,'verify-capsule',{'receipt':h.s.document(BASE/'capsule-prepared.json')});h.s.save(BASE/'capsule-result.json',h.s.document(BASE/'capsule-prepared.json'))
        elif a.phase=='reconcile-build':result=reconcile_build(h,op)
        elif a.phase=='build':result=build(h,op)
        elif a.phase=='accept-candidate':result=accept_candidate(h,op)
        else:result=restore_activation(h,op,a.phase=='reconcile-start')
        print(json.dumps({'format':FORMAT,'phase':a.phase,'acknowledged':True,'result':result},sort_keys=True))

if __name__=='__main__':
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_generation_owner_phase_expired'));signal.alarm(180)
    try:main()
    except Exception as error:
        print(json.dumps({'format':FORMAT,'completed':False,'errorClass':type(error).__name__,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[a-z0-9_]+',str(error))else'private_generation_diagnostics_withheld'}));raise SystemExit(1)
    finally:signal.alarm(0)
