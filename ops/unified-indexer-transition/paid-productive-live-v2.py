#!/usr/bin/env python3
"""Explicit Q-closed promotion, original-window productive replay, owned cleanup.

No automatic promotion, renewal, account upgrade, counter reset or75 retry.
Default is read-only review; install/controller apply use exact fresh hashes.
"""
from contextlib import contextmanager
from datetime import datetime,timezone
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import time

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-paid-productive-live-v2-20261021')
SYSTEMD=Path('/etc/systemd/system')
FORMAT='yunipals-paid-productive-live-v2'
Q_SHA='2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
MODEL_SHA='7005ba952fd29ea319b87252c497b5c8777bc1489df2eb9d9f4df1c2d659ed66'
NATIVE_SHA='eeaca059b97f215cf38d87c3fdb349c16befbd49157b203bf4917c6e872161e8'
EPOCH_SHA='8fe34e7cd7289aa17b5e10dd342fb18a36a5b3806773ec7e6caf8f2be9a682cd'
REPAIR_LIVE_SHA='a8e05d69d3c0d46bc9ffb92734b66db377b6c98472bf295356e181c5b41d3c4c'
REPAIR_EPOCH_SHA='fd82c54cbc755070a93e3f48bf0be0b0d93eead5a35230d2cdf976b882d1b63b'
REFERENCE_SHA='8c52c7346df1cd4b988397dc263247eb34e6d2b93fd37621fc729528a1c0b879'


def fail(label):raise RuntimeError(label)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def now():return datetime.now(timezone.utc)
def run_id(value):
    if not isinstance(value,str)or not re.fullmatch('20261021-[a-z0-9-]{1,30}',value):fail('fixed_productive_run_id_required')
    return value


def modules():
    # Only the initial pinned loader is opened directly. All later imports use
    # its protected root/ancestry/size/hash checks, without changed globals.
    path=OPS/'paid-capability-live-v1.py'
    import types
    for p in [*path.parents,path]:
        v=p.lstat()
        if p.is_symlink()or v.st_uid!=0 or v.st_mode&0o022:fail('protected_Q_loader_required')
    raw=path.read_bytes()
    if sha(raw)!=Q_SHA:fail('frozen_Q_loader_changed')
    q=types.ModuleType('productive_frozen_Q_live');q.__file__=str(path);exec(compile(raw,str(path),'exec'),q.__dict__)
    model=q.load(OPS/'paid-productive-plan-v4.py',MODEL_SHA,'productive_live_model')
    epoch=q.load(OPS/'paid-productive-epoch-v2.py',EPOCH_SHA,'productive_live_epoch')
    native=q.load(OPS/'paid-productive-native-v4.py',NATIVE_SHA,'productive_live_native')
    if native.MODEL_SHA!=MODEL_SHA or epoch.MODEL_SHA!=MODEL_SHA:fail('productive_model_binding_changed')
    return q,model,epoch,native


def paths(rid):
    run_id(rid)
    return BASE/rid,OPS/('paid-productive-v2-'+rid+'.plan.json'),OPS/('paid-productive-v2-'+rid+'.live.json')


def repair_context(q,model,spec):
    driver=q.load(OPS/'paid-qualification-repair-live-v2.py',REPAIR_LIVE_SHA,'productive_closed_manual_repair_driver')
    if driver.MODEL_SHA!=model.REPAIR_SHA or driver.EPOCH_SHA!=REPAIR_EPOCH_SHA:fail('closed_repair_dependency_pins_changed')
    ref=spec['qualification']
    return driver.closed_repair(q,model.repair_model(),ref['runId'],ref['livePlanSha256'])


def closed_qualification(q,model,spec):
    plan=spec['plan'];model.validate(plan);ref=spec['qualification'];qrid=run_id(ref['runId'])
    if qrid==spec['runId'] or set(ref)!={'runId','livePlanSha256','controllerResultSha256','controllerFinishedAckSha256','epochRecordFile','epochRecordSha256'}:
        fail('distinct_exact_successful_manual_repair_reference_required')
    if any(not model.is_sha(ref[k])for k in ['livePlanSha256','controllerResultSha256','controllerFinishedAckSha256','epochRecordSha256']):fail('actual_closed_repair_proof_hashes_required')
    closed=repair_context(q,model,spec);probe=closed['probe'];cleanup=closed['cleanup'];record=closed['epochRecord']
    promotion=json.loads(q.protected(OPS/('paid-productive-v2-'+spec['runId']+'.promotion.json')))
    if (closed['plan']!=plan['repairPlan']or closed['controllerResultSha256']!=ref['controllerResultSha256']or
        closed['controllerFinishedAckSha256']!=ref['controllerFinishedAckSha256']or
        record['path']!=ref['epochRecordFile']or record['sha256']!=ref['epochRecordSha256']or
        probe!=plan['repairProbe']or cleanup!=plan['repairCleanupReceipt']or promotion!=plan['promotion']or model.digest(promotion)!=spec['promotionSha256']or
        promotion['probeResultSha256']!=model.digest(probe)or promotion['qualificationCleanupReceiptSha256']!=model.digest(cleanup)or
        promotion['qualificationCacheReceiptSha256']!=model.digest(closed['cacheReceipt'])or promotion['qualificationCleanupAckSha256']!=model.digest(closed['cleanupAck'])):
        fail('actual_failed_and_repaired_promotion_proof_closure_changed')
    model.successful_probe(probe,int(plan['repairedQualificationBookedCu']))
    return closed['originalQValue'],closed['directory'],probe,cleanup,record


def load_spec(q,model,rid,expected):
    _,path,_=paths(rid);raw=q.protected(path,700000)
    if sha(raw)!=expected:fail('protected_productive_plan_pin_changed')
    spec=json.loads(raw)
    if (set(spec)!={'format','runId','plan','qualification','promotionSha256','drainBoundEvidence'} or spec['format']!='yunipals-paid-productive-live-plan-v2' or spec['runId']!=rid):fail('exact_productive_live_plan_required')
    model.validate(spec['plan']);closed_qualification(q,model,spec)
    #90s is an operational drain, never an absolute async-handler claim.
    # This reviewed rollout cannot admit paid authority near UTC at all.
    if spec['drainBoundEvidence']!={'operationalDrainSeconds':90,'minimumOriginalExpiryBeforeUtcSeconds':600,'absoluteHandlerDeadlineClaimed':False}:
        fail('exact_no_cross_day_operational_drain_policy_required')
    if (model.model().moment(spec['plan']['nextUtc'])-model.model().moment(spec['plan']['expires'])).total_seconds()<600:
        fail('productive_expiry_must_precede_UTC_by_at_least600seconds')
    return spec


def journal_for(q,directory):
    class ProductiveJournal(q.Journal):
        def rows(self):
            path=self.directory/'journal.jsonl'
            if not path.exists():return []
            raw=q.protected(path,16000000);rows=[json.loads(r)for r in raw.splitlines()]
            if len(rows)>4096:fail('bounded_productive_journal_exceeded')
            return rows
    return ProductiveJournal(directory)


def epoch_callback(q,journal):
    def callback(path,expected):
        raw=q.protected(Path(path),2000000)
        if sha(raw)!=expected:fail('productive_phase_changed_before_ACK')
        q.sync_directory(Path(path).parent);journal.emit('productive_epoch_record',path=str(path),sha256=expected)
    return callback


def native_callback(q,journal):
    def callback(path,expected):
        raw=q.protected(Path(path),2000000)
        if sha(raw)!=expected:fail('native_phase_changed_before_ACK')
        q.sync_directory(Path(path).parent);journal.emit('productive_native_record',path=str(path),sha256=expected)
    return callback


@contextmanager
def session_scope(q,model,epoch,spec,value,journal,timer_file,timer_sha):
    qepoch,_,_=q.modules();path,expected=q.session_plan(value)
    with qepoch.open_session(path,expected)as session:
        original=spec['plan']['repairPlan']['failedClosure']
        session.restore_record(original['epochRecordFile'],original['epochRecordSha256'])
        closed=repair_context(q,model,spec);ref=spec['qualification']
        repaired=q.load(OPS/'paid-qualification-repair-epoch-v2.py',REPAIR_EPOCH_SHA,'productive_retained_repair_epoch')
        def no_mutation(*_):fail('historical_repair_epoch_must_remain_immutable')
        re=repaired.prepare(session,spec['plan']['repairPlan'],ref['runId'],timer_file=closed['value']['timerReceiptFile'],
            timer_sha=closed['value']['timerReceiptSha256'],record_callback=no_mutation)
        re.restore_record(ref['epochRecordFile'],ref['epochRecordSha256'])
        instance=epoch.prepare(session,spec['plan'],spec['runId'],qualification_epoch=re,timer_file=timer_file,timer_sha=timer_sha,record_callback=epoch_callback(q,journal))
        yield session,instance


def service_properties(*,controller=False):
    maximum=30600 if controller else 900
    roots=[BASE,Path('/var/backups/yunipals-paid-productive-epoch-v2-20261021'),Path('/var/backups/yunipals-paid-productive-native-v4-20261021')]
    retained=['7e7375b0-20261020','008028af-20261020','ae3619c9-20261021','1612f7bf-20261021','d727f87e-20261021','6e112a0c-20261021']
    return ('Restart=no\nUMask=0077\nRuntimeMaxSec='+str(maximum)+'\nTimeoutStopSec=60\nKillMode=control-group\nNoNewPrivileges=yes\n'
        'AmbientCapabilities=CAP_SETUID CAP_SETGID CAP_KILL\nCapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_KILL\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\n'
        'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nIPAddressDeny=any\nIPAddressAllow=127.0.0.0/8 ::1\nMemoryMax=536870912\nMemorySwapMax=0\nCPUQuota=50%\nTasksMax=64\n'
        'ReadWritePaths='+' '.join(map(str,roots))+' '+str(OPS)+' /etc/systemd/system /run/lock\n'
        'BindReadOnlyPaths='+' '.join('/var/tmp/yunipals-runtime-'+r for r in retained)+'\n')


def controller_definition(model,plan,rid,marker):
    if not model.is_sha(marker):fail('exact_controller_apply_hash_required')
    run_id(rid);unit='yunipals-paid-productive-controller-v2-'+rid+'.service'
    argv='/usr/bin/python3 -B '+str(OPS/'paid-productive-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+model.digest(plan)+' --phase controller --apply '+marker
    text='[Unit]\nDescription=Yunipals original-window paid productive '+model.digest(plan)+'\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(OPS)+'\nExecStart='+argv+'\n'+service_properties(controller=True)
    return {'unit':unit,'definition':text,'definitionSha256':sha(text.encode())}


def controller_review_definition(model,plan,rid):
    run_id(rid);unit='yunipals-paid-productive-review-v2-'+rid+'.service'
    argv='/usr/bin/python3 -B '+str(OPS/'paid-productive-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+model.digest(plan)+' --phase controller-review'
    text='[Unit]\nDescription=Yunipals original paid productive read-only review '+model.digest(plan)+'\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(OPS)+'\nExecStart='+argv+'\n'+service_properties()
    return {'unit':unit,'definition':text,'definitionSha256':sha(text.encode())}


def timer_definitions(q,model,plan,rid):
    rows=[];prefix_digest=model.digest(plan)[:16]
    for kind,due in [('deadline',plan['dispatchExpires']),('utc',plan['nextUtc'])]:
        prefix='yunipals-paid-productive-v2-'+kind+'-'+prefix_digest;timer=prefix+'.timer';service=prefix+'.service'
        calendar=model.model().moment(due).strftime('%Y-%m-%d %H:%M:%S.%f UTC')
        timer_text='[Unit]\nDescription=Yunipals original paid productive '+kind+' '+model.digest(plan)+'\n[Timer]\nOnCalendar='+calendar+'\nAccuracySec=1us\nRandomizedDelaySec=0\nPersistent=true\nUnit='+service+'\n[Install]\nWantedBy=timers.target\n'
        argv='/usr/bin/python3 -B '+str(OPS/'paid-productive-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+model.digest(plan)+' --phase '+kind
        service_text='[Unit]\nDescription=Yunipals original paid productive executor '+model.digest(plan)+'\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(OPS)+'\nExecStart='+argv+'\n'+service_properties()
        rows.append({'kind':kind,'dueUtc':due,'timerUnit':timer,'serviceUnit':service,'timerText':timer_text,'serviceText':service_text,'definitions':{str(SYSTEMD/timer):sha(timer_text.encode()),str(SYSTEMD/service):sha(service_text.encode())}})
    return rows


def policy_identity(model,current,plan):
    """Stable reviewed authority, not a hash of moving foreground counters."""
    daily,reserve,allocations=model.model().policy(current);_,_,grants=model.model().grants(current,allocations)
    if current['grants']['day']!=plan['grantDay'] or grants['unified_source']!=int(plan['baselineSourceGrantedCu'])+int(plan['qualificationBookedCu']):fail('quiescent_productive_source_baseline_changed')
    return {'scope':current['scope'],'global':current['global'],'allocations':sorted(allocations.values(),key=lambda r:r['workload']),
        'profileId':model.model().PROFILE,'profileExpiresAt':current['profileExpiresAt'],'grantDay':current['grants']['day'],'sourceGrantedCu':str(grants['unified_source'])}


def prepare(q,model,epoch,native,spec):
    value,directory,probe,cleanup,record=closed_qualification(q,model,spec);qepoch,_,oldmodel=q.modules()
    current=q.snapshot(qepoch,oldmodel)
    rebuilt=model.prepare(spec['plan']['repairPlan'],probe,cleanup,current,spec['plan']['promotion'],oldmodel.text_time(now()))
    if rebuilt!=spec['plan']:fail('fresh_same_origin_productive_plan_changed')
    qepoch.source_gate();q.approval()
    # Actual original same-sandbox preflight is not inferred from a capability
    # bounding set. Its immutable acknowledged receipt was required byQ.
    q.require_sandbox_preflight(oldmodel,value,q.Journal(q.run_paths(spec['plan']['repairPlan']['failedClosure']['runId'])[0]))
    return {'format':FORMAT,'phase':'install_review','spec':spec,'policy':policy_identity(model,current,spec['plan']),'qualificationLivePlanSha256':spec['qualification']['livePlanSha256'],
        'operatorSha256':sha(q.protected(Path(__file__).absolute(),180000)),'timers':timer_definitions(q,model,spec['plan'],spec['runId']),
        'nativeHelperSha256':NATIVE_SHA,'epochHelperSha256':EPOCH_SHA,'automaticRenewal':False,'sourceStarted':False}


def install(q,model,epoch,native,review,expected):
    if sha(encoded(review))!=expected:fail('exact_fresh_productive_install_review_required')
    spec=review['spec'];rid=spec['runId'];directory,_,livefile=paths(rid)
    # Never reuse/alter an existing productive attempt, even one that failed
    # before admission. The root must reconcile its retained artifacts.
    if directory.exists()or livefile.exists():fail('fresh_productive_attempt_required')
    parent=BASE
    parent.mkdir(mode=0o700,exist_ok=True)
    if parent.is_symlink()or parent.stat().st_uid!=0 or stat.S_IMODE(parent.stat().st_mode)!=0o700:fail('private_productive_root_required')
    directory.mkdir(mode=0o700);journal=journal_for(q,directory)
    q.save(directory/'review.json',review);journal.emit('install_intent',reviewHash=expected)
    (OPS).stat()
    for root in [epoch.BASE,native.BASE]:
        root.mkdir(mode=0o700,exist_ok=True);st=root.lstat()
        if root.is_symlink()or not stat.S_ISDIR(st.st_mode)or st.st_uid!=0 or stat.S_IMODE(st.st_mode)!=0o700:fail('exact_private_productive_runtime_evidence_root_required')
    for r in review['timers']:
        for p in r['definitions']:
            if os.path.lexists(p):fail('fresh_productive_timer_unit_required')
        if os.path.lexists(SYSTEMD/'timers.target.wants'/r['timerUnit']):fail('fresh_productive_timer_link_required')
    for r in review['timers']:
        for key,name in [('timerText',r['timerUnit']),('serviceText',r['serviceUnit'])]:
            fd=os.open(SYSTEMD/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
            with os.fdopen(fd,'wb')as out:os.fchmod(out.fileno(),0o644);out.write(r[key].encode());out.flush();os.fsync(out.fileno())
    q.sync_directory(SYSTEMD);q.run(['/usr/bin/systemctl','daemon-reload'])
    rows=[{k:r[k]for k in ['kind','dueUtc','timerUnit','serviceUnit','definitions']}for r in review['timers']]
    receipt={'format':'yunipals-paid-productive-timers-v2','productivePlanSha256':model.digest(spec['plan']),'runId':rid,'executorSha256':review['operatorSha256'],'timers':rows}
    timer_file=OPS/('paid-productive-v2-'+rid+'.timers.json');timer_sha=q.save(timer_file,receipt)
    value={'format':FORMAT,'reviewHash':expected,'review':review,'timerReceiptSha256':timer_sha,'timerReceiptFile':str(timer_file)}
    q.save(livefile,value);journal.emit('productive_execution_context_prepared',livePlanSha256=sha(encoded(value)))
    for r in review['timers']:q.run(['/usr/bin/systemctl','enable','--now',r['timerUnit']],timeout=15)
    wants=SYSTEMD/'timers.target.wants'
    for r in review['timers']:
        link=wants/r['timerUnit']
        if not link.is_symlink()or link.lstat().st_uid!=0 or link.resolve(strict=True)!=SYSTEMD/r['timerUnit']:fail('durable_exact_productive_wants_link_required')
    q.sync_directory(wants);q.sync_directory(SYSTEMD)
    qvalue,_,_,_,_=closed_qualification(q,model,spec)
    with session_scope(q,model,epoch,spec,qvalue,journal,timer_file,timer_sha)as(s,e):
        e.timers();e.qualification_epoch.verify_cleaned()
        # Replacement is proved first. Disable ONLY original exactQ timer
        # definitions; their files/evidence remain, and no financial policy is
        # transferred by disabling an unowned or currently executing service.
        old=repair_context(q,model,spec)['value']['review']['timers']
        for r in old:
            if any(sha(q.protected(Path(p),50000))!=h for p,h in r['definitions'].items()):fail('Q_timer_definition_drift')
            props=q.unit_properties(r['serviceUnit'])
            if props['ActiveState']not in {'inactive','failed'}or props['MainPID']!='0':fail('Q_executor_must_be_finished_before_handoff')
        for r in old:q.run(['/usr/bin/systemctl','disable','--now',r['timerUnit']],timeout=15)
        q.sync_directory(wants);q.sync_directory(SYSTEMD)
        for r in old:
            p=q.run(['/usr/bin/systemctl','show','--all',r['timerUnit'],'--property=ActiveState'])
            if p!='ActiveState=inactive' or os.path.lexists(wants/r['timerUnit']):fail('Q_timer_disable_not_confirmed')
    journal.emit('productive_timers_installed',livePlanSha256=sha(encoded(value)),repairTimersDisabledAfterReplacementProof=True)
    return {'format':FORMAT,'installed':True,'reviewHash':expected,'productivePlanSha256':model.digest(spec['plan']),'budgetOrPermitsApplied':False,'sourceStarted':False}


def permits(q,model,plan):
    qe,_,_=q.modules();ids=','.join(model.literal(r['permitId'])for r in plan['permits'])
    return qe.query("SELECT jsonb_build_object('active',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea'AND r.enabled AND r.expires_at>clock_timestamp()),'owned',coalesce((SELECT jsonb_agg(jsonb_build_object('permitId',permit_id,'profileId',profile_id,'chainId',chain_id,'fromBlock',from_block::text,'throughBlock',through_block::text,'maximumCu',maximum_cu::text,'spentCu',spent_cu::text,'enabled',enabled,'expires',expires_at)ORDER BY chain_id)FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN("+ids+")),'[]'::jsonb))",market=True)


def permit_rows(model,plan,value,*,disabled=False):
    rows=value.get('owned')
    if not isinstance(rows,list)or len(rows)!=2:fail('exact_productive_permit_pair_required')
    for r in plan['permits']:
        a=next((x for x in rows if x.get('permitId')==r['permitId']),{})
        if (set(a)!=set(r)|{'profileId','enabled','spentCu'}or a.get('profileId')!=model.model().PROFILE or type(a.get('enabled'))is not bool or(disabled and a['enabled']is not False)or
            any(a.get(k)!=v for k,v in r.items()if k!='expires')or model.model().moment(a.get('expires','').replace('+00:00','Z'))!=model.model().moment(r['expires'])or model.model().cu(a['spentCu'])>int(r['maximumCu'])):fail('productive_permit_identity_drift')


def execute(q,model,phase,plan,current,journal,*,receipt=None):
    if journal.latest('sql_intent_'+phase)is not None:fail('productive_SQL_attempt_uncertain_or_complete_no_retry')
    text=model.owner_sql(phase,plan,current,receipt=receipt)
    q.save(journal.directory/('owner-'+phase+'.sql.json'),{'sql':text,'sha256':sha(text.encode())});journal.emit('sql_intent_'+phase,sqlSha256=sha(text.encode()))
    try:
        raw=q.peer(text,write=True);rows=[json.loads(x)for x in raw.splitlines()if x.strip()]
        expected={'productivePlanSha256':model.digest(plan),'phase':phase,'applied':True,'grantCountersReset':False}
        if rows!=[expected]:fail('productive_commit_ack_mismatch')
    except BaseException:
        journal.emit('sql_ambiguous_'+phase,manualReconcileRequired=True);raise
    journal.emit('sql_ack_'+phase,receipt=expected);return expected


def revoke(q,model,plan,journal):
    with q.mutex(journal.directory/'financial.lock',seconds=12):
        state=permits(q,model,plan);path=journal.directory/'revoked.json'
        if state['owned']==[]:
            if journal.latest('sql_intent_promotion')is not None or state['active']!=0:fail('unknown_productive_admission_requires_reconcile')
            outcome='not_admitted_confirmed'
        else:
            permit_rows(model,plan,state)
            if journal.latest('sql_ack_revoke')is None:
                if journal.latest('sql_intent_revoke')is not None:fail('uncertain_productive_revoke_requires_reconcile')
                execute(q,model,'revoke',plan,None,journal)
            state=permits(q,model,plan);permit_rows(model,plan,state,disabled=True)
            if state['active']!=0:fail('unrelated_active_paid_authority')
            outcome='commit_confirmed'
        result={'format':'yunipals-paid-productive-revocation-v2','productivePlanSha256':model.digest(plan),'transactionOutcome':outcome,'permitIds':[r['permitId']for r in plan['permits']]}
        if path.exists():
            if json.loads(q.protected(path))!=result:fail('revocation_receipt_drift')
        else:q.save(path,result)
        return result


def static_controller_properties(props):
    result={k:v for k,v in props.items()if k not in {'Id','LoadState','ActiveState','SubState','InvocationID','MainPID','ExecStart'}}
    raw=props.get('ExecStart','');paths=re.findall(r'(?:^|[ {;])path=([^ ;]+)',raw);argv=re.findall(r'argv\[\]=(.*?)\s+;',raw);ignore=re.findall(r'ignore_errors=(yes|no)(?:[ ;}]|$)',raw)
    if len(paths)!=1 or len(argv)!=1 or ignore!=['no']:fail('exact_static_controller_executable_argv_required')
    result['ExecStart']={'path':paths[0],'argv':argv[0],'ignoreErrors':False}
    return result


def controller_definition_proof(q,qe,unit):
    fragment=qe.bus_property(unit,'org.freedesktop.systemd1.Unit','FragmentPath','s')
    drops=qe.bus_property(unit,'org.freedesktop.systemd1.Unit','DropInPaths','as')
    if fragment not in {str(SYSTEMD/unit),'/run/systemd/transient/'+unit}or drops!=[]:fail('exact_productive_controller_definition_required')
    return {'path':fragment,'sha256':sha(q.protected(Path(fragment),50000)),'dropInPaths':[]}


def original_process_gone(saved,proc_root=Path('/proc')):
    if (set(saved)!={'pid','startTicks','bootId'}or type(saved['pid'])is not int or saved['pid']<=1 or
        type(saved['startTicks'])is not int or saved['startTicks']<=0 or not isinstance(saved['bootId'],str)or not re.fullmatch('[0-9a-f-]{36}',saved['bootId'])):fail('exact_saved_controller_process_required')
    boot=(proc_root/'sys/kernel/random/boot_id').read_text().strip()
    if not re.fullmatch('[0-9a-f-]{36}',boot):fail('actual_boot_identity_unavailable')
    if boot!=saved['bootId']:fail('controller_boot_changed_manual_reconcile_required')
    try:raw=(proc_root/str(saved['pid'])/'stat').read_text()
    except FileNotFoundError:return True
    # Permission errors, malformed state and same lifetime in a moved cgroup
    # never become a proof that the original process exited.
    if len(raw)>65536 or ')'not in raw:fail('original_controller_stat_invalid')
    tail=raw[raw.rfind(')')+2:].split()
    if len(tail)<20 or not tail[19].isdigit():fail('original_controller_start_unavailable')
    return int(tail[19])!=saved['startTicks']


def finished_controller(q,journal):
    ack=journal.latest('controller_finished')
    if ack is None:fail('GC_controller_requires_actual_finished_ACK')
    raw=q.protected(journal.directory/'controller-result.json');result=json.loads(raw)
    if ack.get('outcomeSha256')!=sha(raw)or result.get('format')!=FORMAT or result.get('automaticRetryAllowed')is not False or type(result.get('cleaned'))is not bool or ack.get('cleaned')is not result['cleaned']:fail('GC_controller_finished_receipt_mismatch')
    return result


def controller_identity(q,qe,rid,plan_sha,marker,*,self_required):
    unit='yunipals-paid-productive-controller-v2-'+rid+'.service';props=q.unit_properties(unit)
    argv='/usr/bin/python3 -B '+str(OPS/'paid-productive-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+plan_sha+' --phase controller --apply '+marker
    if (props['Id']!=unit or props['LoadState']!='loaded'or props['ActiveState']!='active'or props['SubState']!='running'or props['Type']!='exec'or props['Restart']!='no'or props['WorkingDirectory']!=str(OPS)or props['User']not in {'','root'}or props['Group']not in {'','root'}or props['NoNewPrivileges']!='yes'or
        not re.fullmatch('[0-9a-f]{32}',props['InvocationID'])or not props['MainPID'].isdigit()or int(props['MainPID'])<=1 or
        set(props['AmbientCapabilities'].split())!={'cap_setuid','cap_setgid','cap_kill'}or set(props['CapabilityBoundingSet'].split())!={'cap_setuid','cap_setgid','cap_kill'}or
        re.findall(r'argv\[\]=(.*?)\s+;',props['ExecStart'])!=[argv]):fail('exact_owned_productive_controller_required')
    q.assert_no_unit_environment(qe,unit)
    if qe.bus_property(unit,'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=30600000000:fail('exact_bounded_productive_root_runtime_required')
    if self_required:
        if int(props['MainPID'])!=os.getpid():fail('productive_controller_actual_main_required')
        q.actual_root_capabilities()
    return {'unit':unit,'invocation':props['InvocationID'],'definition':controller_definition_proof(q,qe,unit),'staticPropertiesSha256':sha(encoded(static_controller_properties(props))),'process':q.process_identity(int(props['MainPID']),unit),'applyHash':marker,'planSha256':plan_sha,'propertiesSha256':sha(encoded(props))}


def controller_reference(q,rid,identity):
    reference=q.load(OPS/'paid-controller-reference-v1.py',REFERENCE_SHA,'productive_owned_controller_reference')
    argv='/usr/bin/python3 -B '+str(OPS/'paid-productive-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+identity['planSha256']+' --phase controller --apply '+identity['applyHash']
    return reference.ControllerReference('productive_v2',rid,identity['definition'],argv,identity['invocation'])


def stop_controller(q,qe,model,value,journal):
    saved=journal.latest('controller_started')
    if saved is None:
        if journal.latest('sql_intent_promotion')is not None:fail('productive_admission_without_controller_identity')
        return
    expected=saved['identity'];rid=value['review']['spec']['runId'];fd=None
    try:
        # One live bus connection holds RefUnit throughout ALL terminal readers.
        # A separate CLI busctl ref would disappear before the next GetUnit.
        with controller_reference(q,rid,expected):
            props=q.unit_properties(expected['unit'])
            if props['InvocationID']=='':
                if props['LoadState']!='loaded'or props['ActiveState']!='inactive'or props['SubState']!='dead'or props['MainPID']!='0':fail('foreign_or_active_GC_controller_refused')
                finished_controller(q,journal)
                if controller_definition_proof(q,qe,expected['unit'])!=expected.get('definition')or sha(encoded(static_controller_properties(props)))!=expected.get('staticPropertiesSha256')or not original_process_gone(expected['process']):fail('GC_original_controller_not_proven_gone_or_definition_changed')
                journal.emit('controller_GC_reconciled',originalInvocation=expected['invocation'],actualFinishedAcknowledged=True,originalProcessGone=True);return
            if props['InvocationID']!=expected['invocation']:fail('foreign_productive_controller_refused')
            if props['ActiveState']in {'inactive','failed'}and props['MainPID']=='0':
                if not original_process_gone(expected['process']):fail('terminal_original_controller_process_still_exists')
                return
            current=controller_identity(q,qe,rid,model.digest(value['review']['spec']['plan']),expected['applyHash'],self_required=False)
            if current!=expected or current['process']['pid']==os.getpid():fail('owned_distinct_productive_controller_required')
            fd=os.pidfd_open(current['process']['pid'],0)
            if q.process_identity(current['process']['pid'],expected['unit'])!=expected['process']:fail('productive_controller_PID_reused')
        # No slow cleanup wait is allowed to outlive the bounded bus reference.
        p=select.poll();p.register(fd,select.POLLIN)
        if not p.poll(0):signal.pidfd_send_signal(fd,signal.SIGTERM,None,0)
        if not p.poll(360000):fail('productive_controller_cleanup_active_no_lock_wait')
    finally:
        if fd is not None:os.close(fd)


def inherited_repair_UTC(q,model,spec,current,journal):
    # Productive timer installation takes over the repaired phase's UTC duty
    # even if no productive admission was ever attempted. Keep its real ACK.
    plan=spec['plan'];repaired=model.repair_model();receipt=plan['repairCleanupReceipt']
    phase='inherited_repair_utc';key='sql_ack_'+phase
    if journal.latest(key)is not None:
        q.same_policy(model.model(),current,plan['originalPolicy'],plan['otherAllocationsSha256'])
        return {'cleaned':True,'neverAdmitted':True,'inheritedRepairOriginalPolicyRestored':True}
    if journal.latest('sql_intent_'+phase)is not None:fail('inherited_repair_UTC_uncertain_no_retry')
    text=repaired.owner_sql('utc',plan['repairPlan'],current,receipt=receipt,at=model.model().text_time(now()))
    q.save(journal.directory/'owner-inherited-repair-utc.sql.json',{'sql':text,'sha256':sha(text.encode())})
    journal.emit('sql_intent_'+phase,sqlSha256=sha(text.encode()),repairCleanupReceiptSha256=model.digest(receipt))
    expected={'repairPlanSha256':model.digest(plan['repairPlan']),'phase':'utc','applied':True,'grantCountersReset':False}
    try:
        rows=[json.loads(line)for line in q.peer(text,write=True).splitlines()if line.strip()]
        if rows!=[expected]:fail('inherited_repair_UTC_commit_ACK_mismatch')
    except BaseException:
        journal.emit('sql_ambiguous_'+phase,manualReconcileRequired=True);raise
    journal.emit(key,receipt=expected)
    return {'cleaned':True,'neverAdmitted':True,'inheritedRepairOriginalPolicyRestored':True}


def cleanup(q,model,epoch,native,value,journal,session,e,*,at_utc=False,runner=None,handle=None,stop_reason='operator_interrupt'):
    spec=value['review']['spec'];plan=spec['plan'];revoked=None;revoke_error=None
    try:revoked=revoke(q,model,plan,journal)
    except BaseException as error:
        revoke_error=error;journal.emit('cleanup_revoke_unconfirmed',errorClass=type(error).__name__,manualReconcileRequired=True)
    er=journal.latest('productive_epoch_record')
    nr=journal.latest('productive_native_record')
    # Even an uncertain financial ACK must not leave our acknowledged native
    # actor running after releasing the source/chain leases.
    try:
        if nr is not None:
            if runner is None:
                if er is not None and e.record is None:e.restore_record(er['path'],er['sha256'])
                runner=native.prepare(session,plan,spec['runId'],record_callback=native_callback(q,journal))
                if e.record is None:fail('native_recovery_requires_acknowledged_productive_epoch')
                if e.record.get('cleaned')is True:
                    caches=journal.latest('owned_caches_destroyed')
                    if caches is None or not isinstance(caches.get('receiptFile'),str)or not model.is_sha(caches.get('receiptSha256')):fail('cleaned_epoch_cache_receipt_ACK_required_for_native_recovery')
                    runner.bind_owned_proxy_cleanup(e,caches['receiptFile'],caches['receiptSha256'])
                handle=runner.restore_handle(nr['path'],nr['sha256'],owned_proxy_epoch=e)
            seal=runner.stop_owned(handle,stop_reason);journal.emit('native_stopped',seal=seal)
        else:session.quiet()
    finally:
        if runner is not None:runner.close()
    if revoke_error is not None:fail('revocation_unconfirmed_native_contained_manual_reconcile')
    if er is not None and e.record is None:e.restore_record(er['path'],er['sha256'])
    if e.record is not None:
        caches=e.cleanup(revoked);cache_file=journal.directory/('cache-cleanup-'+str(len(journal.rows()))+'.json');cache_sha=q.save(cache_file,caches)
        journal.emit('owned_caches_destroyed',result=caches,receiptFile=str(cache_file),receiptSha256=cache_sha)
    elif journal.latest('sql_intent_promotion')is not None:fail('missing_productive_epoch_after_admission')
    # Counters are read only AFTER native stopped and caches were destroyed.
    qe,_,om=q.modules()
    with q.mutex(journal.directory/'financial.lock',seconds=12):
        current=q.snapshot(qe,om)
        if journal.latest('sql_intent_promotion')is None:
            if at_utc:return inherited_repair_UTC(q,model,spec,current,journal)
            return {'cleaned':True,'neverAdmitted':True}
        if journal.latest('sql_ack_promotion')is None:fail('uncertain_productive_promotion_manual_reconcile')
        if at_utc:
            if journal.latest('sql_ack_utc')or journal.latest('sql_ack_boundary'):
                q.same_policy(om,current,plan['originalPolicy'],plan['otherAllocationsSha256']);return {'cleaned':True,'alreadyRestoredOriginalPolicy':True}
            receipt_file=journal.directory/'current-day-cleanup.json';ack=journal.latest('sql_ack_cleanup')
            if ack is not None:
                raw=q.protected(receipt_file);receipt=json.loads(raw);prepared=journal.latest('current_day_cleanup_prepared')
                if prepared is None or prepared['receiptSha256']!=sha(raw):fail('prepared_cleanup_ack_receipt_mismatch')
                execute(q,model,'utc',plan,current,journal,receipt=receipt)
            else:
                if journal.latest('sql_intent_cleanup')is not None or receipt_file.exists():fail('uncertain_cleanup_requires_manual_reconcile')
                prior=q.snapshot(qe,om,day=plan['grantDay']);receipt=model.boundary_receipt(plan,current,prior,om.text_time(now()))
                q.save(journal.directory/'boundary-cleanup.json',receipt);execute(q,model,'boundary',plan,current,journal,receipt=receipt)
            return {'cleaned':True,'originalPolicyRestored':True}
        if current['grants']['day']!=plan['grantDay']:fail('owned_midnight_requires_UTC_executor')
        if journal.latest('sql_ack_cleanup')is not None:
            receipt=json.loads(q.protected(journal.directory/'current-day-cleanup.json'));q.same_policy(om,current,receipt['policy'],plan['otherAllocationsSha256'])
        else:
            if journal.latest('sql_intent_cleanup')is not None:fail('uncertain_cleanup_manual_reconcile')
            receipt=model.cleanup_receipt(plan,current);h=q.save(journal.directory/'current-day-cleanup.json',receipt);journal.emit('current_day_cleanup_prepared',receiptSha256=h)
            execute(q,model,'cleanup',plan,current,journal)
        return {'cleaned':True,'migrationBookedCu':receipt['migrationBookedGrantsCu'],'cleanupCompletedBeforeOriginalExpiry':now()<om.moment(plan['expires'])}


def review_in_session(q,model,epoch,native,value,journal,s,e):
    spec=value['review']['spec'];plan=spec['plan'];qe,_,om=q.modules()
    if journal.latest('controller_started')or journal.latest('sql_intent_promotion'):fail('productive_attempt_not_restartable')
    installed=journal.latest('productive_timers_installed')
    if installed is None or installed.get('livePlanSha256')!=sha(encoded(value))or installed.get('repairTimersDisabledAfterReplacementProof')is not True:fail('complete_productive_timer_handoff_ACK_required_before_admission')
    er=e.review();runner=native.prepare(s,plan,spec['runId'],record_callback=native_callback(q,journal));nr=runner.review()
    current=q.snapshot(qe,om);model.owner_sql('promotion',plan,current)
    review={'format':FORMAT,'phase':'controller_review','livePlanSha256':sha(encoded(value)),'epochReviewHash':sha(encoded(er)),
        'nativeReviewHash':nr['reviewHash'],'currentPolicySha256':sha(encoded(policy_identity(model,current,plan))),'planSha256':model.digest(plan),'operatorSha256':sha(q.protected(Path(__file__).absolute()))}
    return review,runner


def controller_review(q,model,epoch,native,value,directory):
    spec=value['review']['spec'];journal=journal_for(q,directory);qvalue,_,_,_,_=closed_qualification(q,model,spec)
    with session_scope(q,model,epoch,spec,qvalue,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
        review,_=review_in_session(q,model,epoch,native,value,journal,s,e);return review


def controller(q,model,epoch,native,value,directory,expected):
    spec=value['review']['spec'];plan=spec['plan'];journal=journal_for(q,directory);qe,_,om=q.modules()
    qvalue,_,_,_,_=closed_qualification(q,model,spec);out={'format':FORMAT,'cleaned':False,'nativeStarted':False,'automaticRetryAllowed':False}
    with session_scope(q,model,epoch,spec,qvalue,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
        reviewed,runner=review_in_session(q,model,epoch,native,value,journal,s,e)
        if sha(encoded(reviewed))!=expected:fail('exact_fresh_productive_controller_review_required')
        ident=controller_identity(q,qe,spec['runId'],model.digest(plan),expected,self_required=True);q.save(directory/'controller-identity.json',ident);journal.emit('controller_started',identity=ident)
        handle=None
        try:
            enabled=e.enable(reviewed['epochReviewHash']);e.timers();e.validate_current(zero=True);q.check_empty_caches(s)
            # Native static ancestry was reconstructed before any admission.
            # Recheck the prepared source/canonical/checkpoint binding cheaply.
            native_review=runner.bind_owned_proxy_epoch(e,reviewed['nativeReviewHash'],enabled['recordFile'],enabled['recordSha256'])
            selected_sha=q.save(directory/'native-selected-review.json',native_review)
            journal.emit('native_owned_proxy_epoch_selected',nativeReviewHash=native_review['reviewHash'],receiptSha256=selected_sha)
            with q.mutex(directory/'financial.lock',seconds=12):execute(q,model,'promotion',plan,q.snapshot(qe,om),journal)
            handle=runner.launch(native_review['reviewHash']);out['nativeStarted']=True
            while True:
                state=runner.observe(handle)
                if state.get('stopReason')is not None:out['stopReason']=state['stopReason'];break
                if now()>=om.moment(plan['dispatchExpires']):out['stopReason']='dispatch_deadline';break
                health=e.validate_current()
                if any(row['counters']['unified_source']['refused']!=0 for row in health['proxies'].values()):fail('productive_provider_or_policy_refusal')
                authority=permits(q,model,plan);permit_rows(model,plan,authority)
                if authority['active']!=2 or any(row['enabled']is not True for row in authority['owned']):fail('productive_authority_changed')
                current=q.snapshot(qe,om);model.cleanup_receipt(plan,current)
                journal.emit('native_sample',state=state,sourceGrantedCu=current['grants']['workloads']['unified_source'])
                time.sleep(min(15,max(0,(om.moment(plan['dispatchExpires'])-now()).total_seconds())))
        except BaseException as error:
            out['errorClass']=type(error).__name__;out.setdefault('stopReason','operator_interrupt'if isinstance(error,InterruptedError)else'guard_failure');journal.emit('productive_work_failed',errorClass=type(error).__name__)
        finally:
            try:out.update(cleanup(q,model,epoch,native,value,journal,s,e,runner=runner if handle is not None else None,handle=handle,stop_reason=out.get('stopReason','operator_interrupt')))
            except BaseException as error:out['cleanupErrorClass']=type(error).__name__;journal.emit('productive_cleanup_failed',errorClass=type(error).__name__,manualReconcileRequired=True)
    q.save(directory/'controller-result.json',out);journal.emit('controller_finished',outcomeSha256=sha(encoded(out)),cleaned=out['cleaned']);return out


def timer_executor(q,model,epoch,native,value,directory,kind):
    spec=value['review']['spec'];plan=spec['plan'];journal=journal_for(q,directory);qe,_,om=q.modules()
    if kind not in {'deadline','utc'}:fail('fixed_productive_timer_kind_required')
    # Verify actual executor unit/argv separately from the controller identity.
    row=next(r for r in value['review']['timers']if r['kind']==kind);p=q.unit_properties(row['serviceUnit'])
    argv='/usr/bin/python3 -B '+str(OPS/'paid-productive-live-v2.py')+' --run-id '+spec['runId']+' --plan-sha256 '+model.digest(plan)+' --phase '+kind
    if p['Type']!='exec'or p['Id']!=row['serviceUnit']or p['ActiveState']!='active'or p['SubState']!='running'or p['MainPID']!=str(os.getpid())or p['User']not in {'','root'}or p['Group']not in {'','root'}or p['Restart']!='no'or re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])!=[argv]:fail('exact_actual_productive_timer_executor_required')
    if p['NoNewPrivileges']!='yes'or p['WorkingDirectory']!=str(OPS)or set(p['AmbientCapabilities'].split())!={'cap_setuid','cap_setgid','cap_kill'}or set(p['CapabilityBoundingSet'].split())!={'cap_setuid','cap_setgid','cap_kill'}or any(sha(q.protected(Path(path),50000))!=h for path,h in row['definitions'].items()):fail('productive_timer_sandbox_or_definition_drift')
    q.assert_no_unit_environment(qe,row['serviceUnit']);q.actual_root_capabilities()
    if qe.bus_property(row['serviceUnit'],'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=900000000:fail('exact_bounded_productive_cleanup_runtime_required')
    if now()<om.moment(plan['dispatchExpires']if kind=='deadline'else plan['nextUtc']):fail('productive_cleanup_timer_too_early')
    revoke_error=None
    try:revoke(q,model,plan,journal)
    except BaseException as error:revoke_error=type(error).__name__;journal.emit('timer_revoke_failed',errorClass=revoke_error)
    stop_controller(q,qe,model,value,journal)
    if revoke_error:fail('revocation_uncertain_controller_stopped_manual_reconcile')
    qvalue,_,_,_,_=closed_qualification(q,model,spec)
    with q.mutex(directory/'cleanup.lock'):
        with session_scope(q,model,epoch,spec,qvalue,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
            result=cleanup(q,model,epoch,native,value,journal,s,e,at_utc=kind=='utc')
    q.save(directory/('timer-'+kind+'-result.json'),result);return result


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-id',required=True);parser.add_argument('--plan-sha256',required=True)
    parser.add_argument('--phase',choices=['review','install','controller-review','controller','deadline','utc'],default='review');parser.add_argument('--apply')
    a=parser.parse_args();q,model,epoch,native=modules();rid=run_id(a.run_id)
    if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('exact_production_root_host_required')
    directory,_,livefile=paths(rid)
    if a.phase in {'review','install'}:
        spec=load_spec(q,model,rid,a.plan_sha256);review=prepare(q,model,epoch,native,spec)
        result=install(q,model,epoch,native,review,a.apply)if a.phase=='install'else {'format':FORMAT,'reviewHash':sha(encoded(review)),'applied':False,'sourceStarted':False}
    else:
        value=json.loads(q.protected(livefile,1000000));spec=value['review']['spec']
        if value.get('format')!=FORMAT or value['reviewHash']!=sha(encoded(value['review']))or model.digest(spec['plan'])!=a.plan_sha256 or spec['runId']!=rid or value['review']['operatorSha256']!=sha(q.protected(Path(__file__).absolute())):fail('exact_installed_productive_plan_required')
        # No second policy timer/controller may overlap an owned cleanup path.
        if a.phase=='controller-review':result={'format':FORMAT,'reviewHash':sha(encoded(controller_review(q,model,epoch,native,value,directory))),'applied':False}
        elif a.phase=='controller':
            def interrupted(signum,frame):raise InterruptedError('owned_productive_stop')
            for sig in [signal.SIGTERM,signal.SIGINT]:signal.signal(sig,interrupted)
            result=controller(q,model,epoch,native,value,directory,a.apply)
        else:result=timer_executor(q,model,epoch,native,value,directory,a.phase)
    print(json.dumps({k:v for k,v in result.items()if k in {'format','reviewHash','applied','installed','cleaned','nativeStarted','stopReason','errorClass','cleanupErrorClass','automaticRetryAllowed','sourceStarted','productivePlanSha256'}},indent=2))


if __name__=='__main__':main()
