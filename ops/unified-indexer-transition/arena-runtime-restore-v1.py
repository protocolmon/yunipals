#!/usr/bin/env python3
"""Exact eight owned-drop-in rollback only. Default read-only; no schema writes."""
import argparse,contextlib,fcntl,hashlib,json,os,re,shlex,signal,socket,stat,time,types
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
OWNER=OPS/'arena-owner-migration-v11.py'
OWNER_SHA='041063b1ff57139cafe835d0bd8e1fca0bd68f8c757e6e82743c50709e2bcb3c'
PARENT=Path('/var/backups/yunipals-arena-owner-migration-v11-20261022')
RESULT_SHA='84dbb0028be4099cce8322b5f646289d5d095eb14ec3cf03392a559f76a9beae'
OWNER_REVIEW='d25366f7c8af14c6cf9f2a8bf418da169663ddefa98241b53f31e3808f7073a5'
BASE=Path('/var/backups/yunipals-arena-runtime-restore-v1-20261022')
FORMAT='yunipals-arena-runtime-restore-v1'
PHASE='entry'
class RestoreFailure(RuntimeError):pass
def need(v,label):
    if not v:raise RestoreFailure(label)
def encoded(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def load_owner():
    for p in [*OWNER.parents,OWNER]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_pinned_owner_required')
    raw=OWNER.read_bytes();need(len(raw)<200000 and sha(raw)==OWNER_SHA,'exact_owner11_required')
    m=types.ModuleType('retained_owner11');m.__file__=str(OWNER);exec(compile(raw,str(OWNER),'exec'),m.__dict__)
    need(m.BASE==PARENT and m.DROPIN=='zzzz-arena-compatible-legacy-20261021.conf','fixed_owner_namespace_required')
    return m
def read(o,path,maximum=2000000):return o.read(path,maximum,private=True)[0]
def props(m,unit):
    keys=['Id','LoadState','ActiveState','SubState','MainPID','InvocationID','FragmentPath','DropInPaths','ExecStart','User','Group','WorkingDirectory','Restart','KillMode']
    raw=m.run(['/usr/bin/systemctl','show','--all',unit,*['--property='+k for k in keys]],timeout=5,maximum=100000).decode()
    rows=[line.split('=',1)for line in raw.splitlines()]
    need(all(len(r)==2 and r[0]in keys for r in rows)and len(rows)==len(keys)and len(dict(rows))==len(keys),'complete_fixed_unit_metadata_required')
    p=dict(rows);need(p['Id']==unit and p['LoadState']=='loaded','fixed_loaded_arena_unit_required');return p
def no_jobs(m):
    raw=m.run(['/usr/bin/systemctl','list-jobs','--no-legend','--no-pager','--plain'],timeout=5,maximum=200000).decode()
    for line in raw.splitlines():
        if not line.strip()or line.strip()=='No jobs running.':continue
        row=line.split();need(len(row)>=3 and row[0].isdigit(),'bounded_job_shape_required')
        need(row[1]not in m.UNITS,'no_arena_manager_jobs_required')
def cgroup(unit):
    parent=Path('/sys/fs/cgroup/system.slice');s=parent.lstat()
    need(stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'protected_system_slice_required')
    path=parent/unit
    try:before=path.lstat()
    except FileNotFoundError:
        need((s.st_dev,s.st_ino)==(parent.lstat().st_dev,parent.lstat().st_ino),'system_slice_changed');return 'absent'
    need(stat.S_ISDIR(before.st_mode)and before.st_uid==0 and before.st_dev==s.st_dev and not before.st_mode&0o022,'owned_cgroup_required')
    directory=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        need((os.fstat(directory).st_dev,os.fstat(directory).st_ino)==(before.st_dev,before.st_ino),'cgroup_open_changed')
        values={}
        for name in ['cgroup.procs','cgroup.events']:
            fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)
            try:
                need(stat.S_ISREG(os.fstat(fd).st_mode),'regular_cgroup_metadata_required');raw=os.read(fd,4097);need(len(raw)<=4096,'bounded_cgroup_metadata_required');values[name]=raw.decode('ascii')
            finally:os.close(fd)
        need(not values['cgroup.procs'].strip()and dict(line.split()for line in values['cgroup.events'].splitlines()).get('populated')=='0','arena_cgroup_must_be_recursively_empty')
        after=path.lstat();need((after.st_dev,after.st_ino)==(before.st_dev,before.st_ino),'cgroup_identity_changed');return 'empty'
    finally:os.close(directory)
def graph(m,o,base,binding,*,owned):
    result={};public={r['unit']:r for r in (m.resumed_baseline(base)if owned else base)['services']}
    for row in binding['currentUnits']:
        role=row['role'];unit=row['unit'];p=props(m,unit);expected=dict(row['unitDefinitionsSha256'])
        if owned:expected[str(Path('/etc/systemd/system')/(unit+'.d')/m.DROPIN)]=binding['legacyOverrides'][role]
        paths=[p['FragmentPath'],*shlex.split(p['DropInPaths'])]
        need(len(paths)==len(set(paths))and set(paths)==set(expected),'exact_original_plus_owned_definition_graph_required')
        for path,pin in expected.items():need(sha(o.read(Path(path),1000000)[0])==pin,'definition_bytes_changed')
        b=public[unit]
        need((p['User'],p['Group'],p['WorkingDirectory'],p['Restart'],p['KillMode'])==(b['User'],b['Group'],b['WorkingDirectory'],'on-failure','control-group'),'retained_unit_actor_or_runtime_selector_changed')
        inline=o.exec_settings(unit,p['ExecStart'],b)
        if owned:need(inline.get('ARENA_INDEXER_MODE')=='legacy'and all(inline.get(k)==''for k in ['ARENA_INDEXER_DATABASE_URL','ARENA_INDEXER_RELEASE_ID','ARENA_INDEXER_SOURCE_KIND']),'new_runtime_must_remain_legacy')
        typed=o.typed_properties(unit)
        need(typed['EnvironmentFiles']==[[x,False]for x in b['environmentFiles']]and sha(o.encoded(typed['Environment']))==row['inlineEnvironmentSha256'],'retained_ordered_environment_changed')
        expected_credentials=dict(x.split(':',1)for x in b['credentialFileReferences'])
        need(len(dict(typed['LoadCredential']))==len(typed['LoadCredential'])and dict(typed['LoadCredential'])==expected_credentials,'retained_credential_mapping_changed')
        result[unit]={'definitions':expected,'inlineEnvironmentSha256':row['inlineEnvironmentSha256']}
    return result
def database(m,*,quiet=False):
    value=m.sql("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SELECT jsonb_build_object('markers',(SELECT jsonb_agg(jsonb_build_object('version',version,'checksum',checksum)ORDER BY version)FROM yunipals_arena.operational_migration),'legacyMode',(SELECT bool_and(indexer_mode='legacy')FROM yunipals_arena.deployment),'selectors',(SELECT count(*)FROM yunipals_arena.source_selection),'history',(SELECT count(*)FROM yunipals_arena.source_switch_history),'identities',(SELECT count(*)FROM yunipals_arena.tournament_identity),'legacyIdentities',(SELECT bool_and(incarnation='legacy'AND cipher_context=deployment||'/'||tournament_id::text)FROM yunipals_arena.tournament_identity),'appInsert',has_table_privilege('yunipals_arena_app','yunipals_arena.tournament_identity','INSERT'),'appRead',has_table_privilege('yunipals_arena_app','yunipals_arena.deployment','SELECT'));ROLLBACK;")
    expected=json.loads(m.observer().read(m.MIGRATIONS,100000)[0])['markers']
    need(value=={'markers':expected,'legacyMode':True,'selectors':0,'history':0,'identities':2,'legacyIdentities':True,'appInsert':True,'appRead':True},'committed_legacy_compatibility_without_selection_required')
    target=m.catalog();m.verify_target(target)
    if quiet:need(target['otherSessions']==0,'operational_clients_must_be_drained')
    return value
def inspect(m,o):
    need(not os.path.lexists(BASE),'fresh_runtime_restore_evidence_required')
    raw=read(o,PARENT/'result.json');need(sha(raw)==RESULT_SHA,'actual_committed_owner_result_required');result=json.loads(raw)
    binding=json.loads(read(o,PARENT/'review.json'));need(sha(encoded(binding))==OWNER_REVIEW and result['reviewHash']==OWNER_REVIEW and binding['operatorSha256']==OWNER_SHA,'exact_owner_binding_required')
    need(result['migrationCommitOutcome']=='commit_confirmed'and result['sourceSelectionChanged']is False and result['sourceModeAfter']=='legacy','committed_unselected_legacy_parent_required')
    post=json.loads(read(o,PARENT/'postcheck.json'));need(post==result['postcheck']and post['sourceMode']=='legacy'and post['sourceSelectorCount']==0 and post['legacyIdentities']==2,'actual_retained_private_postcheck_required')
    need(sha(encoded(m.schema_objects()))==post['officialObjects']['objectsSha256'],'committed_function_trigger_graph_changed')
    base=json.loads(o.read(OPS/'arena-config-public-baseline-v1.json',200000)[0])
    need(sha(o.read(OPS/'arena-config-public-baseline-v1.json',200000)[0])==o.BASELINE_SHA,'retained_baseline_required')
    need({r['unit']for r in binding['currentUnits']}==set(m.UNITS)and len(binding['currentUnits'])==8,'fixed_eight_binding_required')
    m.verify_inputs(o,binding['privateInputHashes']);m.verify_original_definitions(o,binding['currentUnits'])
    original_runtime={}
    for role in m.ROLES:
        unit='yunipals-arena-'+role+'.service';row=next(r for r in binding['currentUnits']if r['role']==role)
        public,tokens=m.legacy_row(base,role);path=Path('/etc/systemd/system')/(unit+'.d')/m.DROPIN
        receipt=json.loads(read(o,PARENT/(role+'-override.json')));body=m.dropin(role,base)
        need(receipt=={'path':str(path),'sha256':sha(body)}and receipt['sha256']==binding['legacyOverrides'][role]and o.read(path,10000)[0]==body,'only_exact_owner_created_override_allowed')
        entry=Path(base['resolvedRelease'])/'apps/yunipals-market-api'/tokens[-1]
        need(sha(o.read(entry,5000000)[0])==row['runtimeSha256'],'retained_original_runtime_changed')
        original_runtime[role]=row['runtimeSha256']
    observed=graph(m,o,base,binding,owned=True);db=database(m)
    proof={'format':FORMAT,'ownerSha256':OWNER_SHA,'ownerResultSha256':RESULT_SHA,'ownerReviewHash':OWNER_REVIEW,'graphs':observed,'originalRuntime':original_runtime,'database':db,'privateInputs':binding['privateInputHashes'],'schemaAndPrivateDataRestored':False}
    return proof,binding,base

def apply(m,o,v,review_hash,proof,binding,base):
    global PHASE
    need(review_hash==sha(encoded(proof)),'fresh_exact_runtime_restore_review_required')
    BASE.mkdir(mode=0o700);m.save(BASE/'intent.json',proof)
    PHASE='stop_owned_eight'
    with m.References():
        graph(m,o,base,binding,owned=True);m.verify_inputs(o,binding['privateInputHashes'])
        m.run(['/usr/bin/systemctl','stop',*m.UNITS],timeout=90)
        deadline=time.monotonic()+15
        while True:
            states={u:props(m,u)for u in m.UNITS}
            if all(p['MainPID']=='0'and p['ActiveState']in{'inactive','failed'}and p['SubState']in{'dead','failed'}for p in states.values()):break
            need(time.monotonic()<deadline,'owned_arena_stop_incomplete');time.sleep(.2)
        no_jobs(m);groups={u:cgroup(u)for u in m.UNITS};m.save(BASE/'stopped.json',{'states':states,'cgroups':groups})
        graph(m,o,base,binding,owned=True);database(m,quiet=True)
        PHASE='remove_only_owned_overrides'
        for role in m.ROLES:
            unit='yunipals-arena-'+role+'.service';parent=Path('/etc/systemd/system')/(unit+'.d');fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:
                before=os.stat(m.DROPIN,dir_fd=fd,follow_symlinks=False);body=o.read(parent/m.DROPIN,10000)[0]
                need(stat.S_ISREG(before.st_mode)and before.st_uid==0 and before.st_gid==0 and stat.S_IMODE(before.st_mode)==0o644 and before.st_nlink==1 and sha(body)==binding['legacyOverrides'][role],'exact_owned_override_inode_and_bytes_required')
                m.save(BASE/(role+'-removed.conf'),body)
                after=os.stat(m.DROPIN,dir_fd=fd,follow_symlinks=False)
                need(o.metadata(before)==o.metadata(after),'owned_override_changed_before_unlink')
                os.unlink(m.DROPIN,dir_fd=fd);os.fsync(fd)
                m.save(BASE/(role+'-removed.json'),{'sha256':sha(body),'device':before.st_dev,'inode':before.st_ino,'path':str(parent/m.DROPIN)})
            finally:os.close(fd)
        m.run(['/usr/bin/systemctl','daemon-reload'],timeout=10)
        PHASE='verify_restored_original_definitions'
        graph(m,o,base,binding,owned=False);m.verify_inputs(o,binding['privateInputHashes']);no_jobs(m);database(m,quiet=True)
        PHASE='start_original_eight_once'
        m.save(BASE/'start-intent.json',{'units':list(m.UNITS),'automaticRetry':False})
        m.run(['/usr/bin/systemctl','start','--no-block',*m.UNITS],timeout=10)
        deadline=time.monotonic()+60;initial=None;stable_at=None
        PHASE='twenty_second_original_runtime_stability'
        while True:
            states={u:props(m,u)for u in m.UNITS}
            healthy=all(p['ActiveState']=='active'and p['SubState']=='running'and int(p['MainPID'])>1 and re.fullmatch('[0-9a-f]{32}',p['InvocationID'])for p in states.values())
            if healthy:
                identity={r['unit']:{'invocation':states[r['unit']]['InvocationID'],'process':m.process_identity(states[r['unit']],r)}for r in base['services']}
                if initial is None:initial=identity;stable_at=time.monotonic()
                need(identity==initial,'original_runtime_restarted_during_stability')
                if time.monotonic()-stable_at>=20:break
            elif initial is not None:raise RestoreFailure('original_runtime_failed_during_stability')
            need(time.monotonic()<deadline,'original_eight_availability_not_restored');time.sleep(.5)
        graph(m,o,base,binding,owned=False);m.verify_inputs(o,binding['privateInputHashes']);no_jobs(m)
        configured=o.observe(v,base);before={r['role']:r for r in binding['currentUnits']}
        for row in configured['roles']:
            old=before[row['role']]
            for key in old:
                if key!='invocation':need(row[key]==old[key],'original_runtime_configuration_or_role_mapping_changed')
        need(configured['environmentFileSha256']==binding['configurationFiles'],'original_environment_files_changed')
        m.save(BASE/'restored-config.private.json',configured)
        result={'format':FORMAT,'restored':True,'stableSeconds':20,'units':list(m.UNITS),'reviewHash':review_hash,'originalActors':initial,'schemaWrites':0,'privateDataRestores':0,'overrideFilesRemoved':8,'automaticRetryAllowed':False}
        m.save(BASE/'result.json',result)
        return {'format':FORMAT,'restored':True,'stableSeconds':20,'units':8,'resultSha256':sha(encoded(result)),'schemaWrites':0,'privateDataRestores':0,'automaticRetryAllowed':False}

def main():
    global PHASE
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply');args=parser.parse_args()
    need(os.geteuid()==0 and socket.gethostname()=='yunipals-main','fixed_root_host_required')
    os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError()));signal.alarm(300)
    m=load_owner();o=m.observer();v=m.load(OPS/'proxy-upgrade.py',m.VERIFIER_SHA,'runtime_restore_existing_unit_reader',o)
    with m.existing_source_lease():
        lock=os.open(m.BACKUP_LOCK,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);m.verify_backup_lock(lock);PHASE='read_only_exact_review'
            proof,binding,base=inspect(m,o);review_hash=sha(encoded(proof))
            if args.apply:out=apply(m,o,v,args.apply,proof,binding,base)
            else:out={'format':FORMAT,'reviewHash':review_hash,'serviceJobs':0,'schemaWrites':0,'units':8,'ownedOverridesVerified':8,'schemaCommitPreserved':True,'rawValuesExported':False}
        finally:os.close(lock)
    print(json.dumps(out,sort_keys=True))
if __name__=='__main__':
    try:main()
    except BaseException as error:
        frames=[];trace=error.__traceback__
        while trace:
            if Path(trace.tb_frame.f_code.co_filename)==Path(__file__):frames.append({'function':trace.tb_frame.f_code.co_name,'line':trace.tb_lineno})
            trace=trace.tb_next
        safe={'format':FORMAT,'restored':False,'phase':PHASE,'fixedCode':str(error)if isinstance(error,RestoreFailure)else'external_runtime_restore_failure','errorClass':type(error).__name__,'publicFrames':frames[-8:],'automaticRetryAllowed':False,'manualReconciliationRequired':True}
        try:
            if BASE.is_dir():
                fd=os.open(BASE/'failed.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                with os.fdopen(fd,'wb')as f:f.write(encoded(safe));f.flush();os.fsync(f.fileno())
        except BaseException:pass
        print(json.dumps(safe,sort_keys=True));raise SystemExit(1)
