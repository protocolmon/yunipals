#!/usr/bin/env python3
"""One explicit same-origin qualification repair; no automatic retry or renewal.

New controller/timers and13z epoch retain the failed Q1 receipts and original
8-hour allowance. Default review never dispatches or changes SQL/services.
"""
from contextlib import contextmanager
from datetime import datetime,timezone
import argparse
import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import time

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-paid-qualification-repair-live-v2-20261021')
SYSTEMD=Path('/etc/systemd/system')
FORMAT='yunipals-paid-qualification-repair-live-v2'
Q_SHA='2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
TRANSPORT_SHA='f288221ecb9e5f5b18723b54ddb8f7362b5079e1596c1996622454bff2c820d4'
MODEL_SHA='49d906c711b04a026a653ee6428f63f0a6c2ecd4385d60610dbf8f02774220fb'
EPOCH_SHA='fd82c54cbc755070a93e3f48bf0be0b0d93eead5a35230d2cdf976b882d1b63b'
REFERENCE_SHA='d9657ee38c278604c92840bc1c1c46ff43d6644a09fff139a234365740e92061'
ORIGINAL_START='2026-10-21T11:16:25.939473Z'
ORIGINAL_EXPIRES='2026-10-21T19:16:25.939473Z'


def fail(label):raise RuntimeError(label)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):
    import hashlib
    return hashlib.sha256(raw).hexdigest()
def now():return datetime.now(timezone.utc)
def run_id(value):
    if not isinstance(value,str)or not re.fullmatch('20261021-[a-z0-9-]{1,30}',value)or value=='20261021-q1':fail('distinct_fixed_manual_repair_run_required')
    return value


def modules():
    import types
    path=OPS/'paid-capability-live-v1.py'
    for item in [*path.parents,path]:
        v=item.lstat()
        if item.is_symlink()or v.st_uid!=0 or v.st_mode&0o022:fail('protected_frozen_Q_loader_required')
    raw=path.read_bytes()
    if sha(raw)!=Q_SHA:fail('frozen_Q_v2_changed')
    q=types.ModuleType('manual_repair_frozen_Q');q.__file__=str(path);exec(compile(raw,str(path),'exec'),q.__dict__)
    m=q.load(OPS/'paid-qualification-repair-plan-v2.py',MODEL_SHA,'manual_repair_model')
    e=q.load(OPS/'paid-qualification-repair-epoch-v2.py',EPOCH_SHA,'manual_repair_epoch')
    c=q.load(OPS/'paid-capability-controller-v2.py',TRANSPORT_SHA,'manual_repair_transport')
    if e.MODEL_SHA!=MODEL_SHA or m.TRANSPORT_SHA!=TRANSPORT_SHA or c.PLANNER_SHA!=q.PLANNER_SHA:fail('repair_dependency_binding_changed')
    return q,m,e,c


def paths(rid):
    run_id(rid)
    return BASE/rid,OPS/('paid-qualification-repair-v2-'+rid+'.plan.json'),OPS/('paid-qualification-repair-v2-'+rid+'.live.json')


def controller_reference(q,kind,rid,identity):
    ref=q.load(OPS/'paid-controller-reference-v2.py',REFERENCE_SHA,'repair_owned_controller_reference')
    if kind=='original_qualification':
        argv='/usr/bin/python3 -B '+str(OPS/'paid-capability-live-v1.py')+' --run-id '+rid+' --admission-sha256 '+identity['admissionSha256']+' --phase controller --apply '+identity['applyHash']
    else:
        argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-repair-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+identity['planSha256']+' --phase controller --apply '+identity['applyHash']
    return ref.ControllerReference(kind,rid,identity['definition'],argv,identity['invocation'])


def permits(q,m,plan):
    qe,_,_=q.modules();ids=','.join(m.literal(r['permitId'])for r in m.qualification_permits(plan))
    return qe.query("SELECT jsonb_build_object('active',(SELECT count(*)FROM yunipals_market.unified_rpc_replay_permit r JOIN yunipals_market.unified_rpc_profile p USING(profile_id) WHERE p.scope='yunipals-opensea'AND r.enabled AND r.expires_at>clock_timestamp()),'owned',coalesce((SELECT jsonb_agg(jsonb_build_object('permitId',permit_id,'profileId',profile_id,'chainId',chain_id,'fromBlock',from_block::text,'throughBlock',through_block::text,'maximumCu',maximum_cu::text,'spentCu',spent_cu::text,'enabled',enabled,'expires',expires_at)ORDER BY chain_id)FROM yunipals_market.unified_rpc_replay_permit WHERE permit_id IN("+ids+")),'[]'::jsonb))",market=True)


def row_identity(m,plan,rows,*,disabled=False,counts=None):
    expected=m.qualification_permits(plan)
    if not isinstance(rows,list)or len(rows)!=2:fail('exact_repair_permit_pair_required')
    for r in expected:
        found=[x for x in rows if x.get('permitId')==r['permitId']]
        if len(found)!=1:fail('exact_repair_permit_pair_required')
        a=found[0]
        if (set(a)!=set(r)|{'profileId','spentCu','enabled'}or a['profileId']!=m.PROFILE or type(a['chainId'])is not int or type(a['enabled'])is not bool or
            any(a[k]!=v for k,v in r.items()if k!='expires')or m.moment(a['expires'].replace('+00:00','Z'))!=m.moment(r['expires'])or m.cu(a['spentCu'])>180 or
            disabled and a['enabled']is not False or counts is not None and(a['enabled']is not True or m.cu(a['spentCu'])!=60*counts[str(r['chainId'])])):fail('repair_permit_identity_or_spend_changed')


def failed_context(q,m,spec,*,terminal=True):
    plan=spec['plan'];m.validate_plan(plan);origin=plan['origin'];om=m.model();qe,_,_=q.modules()
    if origin['start']!=ORIGINAL_START or origin['expires']!=ORIGINAL_EXPIRES:fail('actual_original_epoch_must_never_change')
    ref=spec['qualification']
    if set(ref)!={'runId','livePlanSha256'}or ref['runId']!='20261021-q1':fail('fixed_actual_Q1_closure_required')
    value,directory=q.load_live(om,ref['runId'],m.digest(origin));_,_,livefile=q.run_paths(ref['runId'])
    if sha(q.protected(livefile))!=ref['livePlanSha256']or value['review']['admission']!=origin:fail('actual_Q1_live_plan_changed')
    journal=q.Journal(directory);result=q.finished_controller(journal)
    probe=json.loads(q.protected(directory/'probe-result.json'));p_ack=journal.latest('probe_complete');f_ack=journal.latest('controller_finished')
    cache=journal.latest('owned_caches_destroyed');cleanup_ack=journal.latest('sql_ack_cleanup');er=journal.latest('epoch_record');started=journal.latest('controller_started')
    if (result.get('qualified')is not False or result.get('cleaned')is not True or p_ack is None or f_ack is None or cache is None or cleanup_ack is None or er is None or started is None or
        p_ack.get('receiptSha256')!=sha(encoded(probe))or p_ack.get('capabilityQualified')is not False or result.get('probeReceiptSha256')!=sha(encoded(probe))or
        started.get('identity',{}).get('unit')!=q.controller_unit('20261021-q1')or started['identity'].get('admissionSha256')!=m.digest(origin)or
        any(cache.get('result',{}).get('proxies',{}).get(n,{}).get('ownedPaidProxyCacheDestroyed')is not True for n in ['base','bnb'])):fail('actual_failed_cleaned_Q1_ACK_chain_required')
    cleanup=q.acknowledged_cleanup(om,origin,journal)
    old=qe.permit_snapshot(om,origin);q.row_identity(om,origin,old['owned'],disabled=True)
    oldrows=[]
    for r,spent in zip(om.qualification_permits(origin),['60','0']):
        actual=next(a for a in old['owned']if a['permitId']==r['permitId'])
        if om.cu(actual['spentCu'])!=int(spent):fail('actual_failed_Q1_spend_must_stay_charged')
        oldrows.append({**r,'enabled':False,'spentCu':spent})
    closure={'format':'yunipals-failed-qualification-closure-v1','originAdmissionSha256':m.digest(origin),'runId':'20261021-q1',
        'controllerResultSha256':sha(encoded(result)),'probeResultSha256':sha(encoded(probe)),'controllerFinishedAckSha256':sha(encoded(f_ack)),
        'probeCompleteAckSha256':sha(encoded(p_ack)),'livePlanSha256':ref['livePlanSha256'],'cleanupReceipt':cleanup,'cleanupAckSha256':sha(encoded(cleanup_ack)),
        'cacheCleanupReceiptSha256':sha(encoded(cache['result'])),'epochRecordFile':er['path'],'epochRecordSha256':er['sha256'],
        'qualified':False,'cleaned':True,'attemptedRpcCalls':probe.get('attemptedRpcCalls'),'completedRpcCalls':probe.get('completedRpcCalls'),
        'failure':probe.get('failure'),'oldPermits':oldrows}
    if closure!=plan['failedClosure']:fail('protected_failed_Q1_closure_mismatch')
    m.validate_failed_closure(origin,closure)
    if terminal:
        identity=started['identity']
        with controller_reference(q,'original_qualification','20261021-q1',identity):
            props=q.unit_properties(identity['unit'])
            if (props['MainPID']!='0'or props['ActiveState']not in {'inactive','failed'}or props['InvocationID']not in {'',identity['invocation']}or
                props['LoadState']!='loaded'or q.controller_definition_proof(qe,identity['unit'])!=identity['definition']or
                sha(encoded(q.static_controller_properties(props)))!=identity['staticPropertiesSha256']or not q.original_process_gone(identity['process'],identity['unit'])):fail('original_Q1_must_be_finished_without_replacement')
    manual=OPS/('paid-qualification-repair-v2-'+spec['runId']+'.approval.json')
    if spec['repairReceiptFile']!=str(manual):fail('fixed_root_manual_repair_receipt_required')
    raw=q.protected(manual)
    if sha(raw)!=spec['repairReceiptSha256']or json.loads(raw)!=plan['manualRepair']or m.digest(json.loads(raw))!=plan['manualRepairSha256']:fail('explicit_root_reviewed_manual_repair_receipt_changed')
    return value,directory,closure


def load_spec(q,m,rid,expected):
    _,path,_=paths(rid);raw=q.protected(path,500000)
    if sha(raw)!=expected:fail('exact_root_repair_plan_pin_required')
    spec=json.loads(raw)
    if set(spec)!={'format','runId','plan','qualification','repairReceiptFile','repairReceiptSha256'}or spec['format']!='yunipals-paid-qualification-repair-live-plan-v2'or spec['runId']!=rid:fail('exact_manual_repair_spec_required')
    failed_context(q,m,spec)
    return spec


@contextmanager
def session_scope(q,m,epoch,spec,journal,timer_file,timer_sha):
    value,_,_=failed_context(q,m,spec);qe,_,_=q.modules();path,expected=q.session_plan(value)
    with qe.open_session(path,expected)as s:
        ref=spec['plan']['failedClosure'];s.restore_record(ref['epochRecordFile'],ref['epochRecordSha256'])
        e=epoch.prepare(s,spec['plan'],spec['runId'],timer_file=timer_file,timer_sha=timer_sha,record_callback=epoch_callback(q,journal))
        yield s,e


def epoch_callback(q,journal):
    def callback(path,expected):
        raw=q.protected(Path(path),2000000)
        if sha(raw)!=expected:fail('repair_phase_changed_before_ACK')
        q.sync_directory(Path(path).parent);journal.emit('repair_epoch_record',path=str(path),sha256=expected)
    return callback


def service_properties():
    return ('Restart=no\nUMask=0077\nRuntimeMaxSec=900\nTimeoutStopSec=60\nKillMode=control-group\nNoNewPrivileges=yes\n'
        'AmbientCapabilities=CAP_SETUID CAP_SETGID CAP_KILL\nCapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_KILL\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\n'
        'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nIPAddressDeny=any\nIPAddressAllow=127.0.0.0/8 ::1\nMemoryMax=536870912\nMemorySwapMax=0\nCPUQuota=50%\nTasksMax=64\n'
        'ReadWritePaths='+str(BASE)+' '+str(OPS)+' /etc/systemd/system /run/lock /var/backups/yunipals-paid-qualification-repair-epoch-v2-20261021\n')


def controller_unit(rid):return 'yunipals-paid-qualification-repair-v2-'+run_id(rid)+'.service'
def controller_definition(m,plan,rid,marker):
    if not m.is_sha(marker):fail('exact_repair_controller_apply_hash_required')
    argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-repair-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+m.digest(plan)+' --phase controller --apply '+marker
    raw='[Unit]\nDescription=Yunipals same-origin explicit qualification repair '+m.digest(plan)+'\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(OPS)+'\nExecStart='+argv+'\n'+service_properties()
    return {'unit':controller_unit(rid),'definition':raw,'definitionSha256':sha(raw.encode())}


def timer_definitions(m,plan,rid):
    rows=[]
    for kind,due in [('deadline',plan['qualificationExpiresAt']),('utc',plan['nextUtc'])]:
        prefix='yunipals-paid-qualification-repair-v2-'+kind+'-'+m.digest(plan)[:16];timer=prefix+'.timer';service=prefix+'.service'
        argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-repair-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+m.digest(plan)+' --phase '+kind
        text='[Unit]\nDescription=Yunipals same-origin repair '+kind+' '+m.digest(plan)+'\n[Timer]\nOnCalendar='+m.moment(due).strftime('%Y-%m-%d %H:%M:%S.%f UTC')+'\nAccuracySec=1us\nRandomizedDelaySec=0\nPersistent=true\nUnit='+service+'\n[Install]\nWantedBy=timers.target\n'
        service_text='[Unit]\nDescription=Yunipals same-origin repair executor '+m.digest(plan)+'\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(OPS)+'\nExecStart='+argv+'\n'+service_properties()
        rows.append({'kind':kind,'dueUtc':due,'timerUnit':timer,'serviceUnit':service,'timerText':text,'serviceText':service_text,'definitions':{str(SYSTEMD/timer):sha(text.encode()),str(SYSTEMD/service):sha(service_text.encode())}})
    return rows


def prepare(q,m,epoch,spec):
    qvalue,directory,closure=failed_context(q,m,spec);qe,_,om=q.modules();current=q.snapshot(qe,om);plan=spec['plan']
    if m.prepare(plan['origin'],closure,current,plan['manualRepair'],plan['phaseStart'])!=plan:fail('same_origin_manual_repair_plan_changed')
    if not m.moment(plan['phaseStart'])<=now()<m.moment(plan['qualificationExpiresAt']):fail('bounded_repair_phase_unavailable')
    qe.source_gate();q.approval();q.require_sandbox_preflight(om,qvalue,q.Journal(directory))
    _,allocations,_,_,work,_=m.current_state(plan,current,temporary=False)
    policy={'global':current['global'],'allocations':sorted(allocations.values(),key=lambda r:r['workload']),'sourceGrantedCu':work['unified_source'],'day':current['grants']['day'],'profileExpiresAt':current['profileExpiresAt']}
    return {'format':FORMAT,'spec':spec,'policy':policy,'operatorSha256':sha(q.protected(Path(__file__).absolute())),
        'timers':timer_definitions(m,plan,spec['runId']),'originalStart':plan['start'],'originalExpires':plan['expires'],'priorBookedCu':'1000','newCalls':False}


def install(q,m,epoch,review,expected):
    if sha(encoded(review))!=expected:fail('exact_fresh_root_repair_install_review_required')
    spec=review['spec'];rid=spec['runId'];directory,_,livefile=paths(rid)
    if directory.exists()or livefile.exists():fail('fresh_single_manual_repair_attempt_required')
    for root in [BASE,epoch.BASE]:
        root.mkdir(mode=0o700,exist_ok=True);s=root.lstat()
        if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700:fail('protected_private_repair_evidence_root_required')
    directory.mkdir(mode=0o700);journal=q.Journal(directory);q.save(directory/'review.json',review);journal.emit('install_intent',reviewHash=expected)
    for row in review['timers']:
        for path in row['definitions']:
            if os.path.lexists(path):fail('fresh_repair_timer_definition_required')
        if os.path.lexists(SYSTEMD/'timers.target.wants'/row['timerUnit']):fail('fresh_repair_timer_link_required')
    for row in review['timers']:
        for name,key in [(row['timerUnit'],'timerText'),(row['serviceUnit'],'serviceText')]:
            fd=os.open(SYSTEMD/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
            with os.fdopen(fd,'wb')as out:os.fchmod(out.fileno(),0o644);out.write(row[key].encode());out.flush();os.fsync(out.fileno())
    q.sync_directory(SYSTEMD);q.run(['/usr/bin/systemctl','daemon-reload'])
    receipt={'format':'yunipals-paid-qualification-repair-timers-v2','repairPlanSha256':m.digest(spec['plan']),'runId':rid,'executorSha256':review['operatorSha256'],
        'timers':[{k:r[k]for k in ['kind','dueUtc','timerUnit','serviceUnit','definitions']}for r in review['timers']]}
    timer_file=OPS/('paid-qualification-repair-v2-'+rid+'.timers.json');timer_sha=q.save(timer_file,receipt)
    # Executors must already have a durable context when first armed. A crash
    # after old-UTC handoff still leaves a fully identified inherited duty.
    value={'format':FORMAT,'reviewHash':expected,'review':review,'timerReceiptFile':str(timer_file),'timerReceiptSha256':timer_sha}
    q.save(livefile,value);journal.emit('repair_execution_context_prepared',livePlanSha256=sha(encoded(value)))
    for row in review['timers']:q.run(['/usr/bin/systemctl','enable','--now',row['timerUnit']],timeout=15)
    wants=SYSTEMD/'timers.target.wants'
    for row in review['timers']:
        link=wants/row['timerUnit']
        if not link.is_symlink()or link.lstat().st_uid!=0 or link.resolve(strict=True)!=SYSTEMD/row['timerUnit']:fail('exact_durable_repair_timer_link_required')
    q.sync_directory(wants);q.sync_directory(SYSTEMD)
    with session_scope(q,m,epoch,spec,journal,timer_file,timer_sha)as(s,e):
        e.timers();s.restored_state()
        old,_,_=failed_context(q,m,spec)
        for row in old['review']['timers']:
            if any(sha(q.protected(Path(p),50000))!=h for p,h in row['definitions'].items()):fail('original_Q1_timer_definition_changed')
            p=q.unit_properties(row['serviceUnit'])
            if p['MainPID']!='0'or p['ActiveState']not in {'inactive','failed'}:fail('original_Q1_timer_executor_still_active')
        for row in old['review']['timers']:q.run(['/usr/bin/systemctl','disable','--now',row['timerUnit']],timeout=15)
        q.sync_directory(wants);q.sync_directory(SYSTEMD)
        for row in old['review']['timers']:
            if q.run(['/usr/bin/systemctl','show','--all',row['timerUnit'],'--property=ActiveState'])!='ActiveState=inactive'or os.path.lexists(wants/row['timerUnit']):fail('old_timer_handoff_not_acknowledged')
    journal.emit('repair_timers_installed',livePlanSha256=sha(encoded(value)),oldTimersDisabledAfterReplacementProof=True)
    return {'format':FORMAT,'installed':True,'reviewHash':expected,'budgetOrPermitsApplied':False,'newCalls':False}


def execute(q,m,phase,plan,current,journal,*,receipt=None):
    if journal.latest('sql_intent_'+phase)is not None:fail('repair_SQL_already_attempted_no_retry')
    sql=m.owner_sql(phase,plan,current,receipt=receipt,at=m.text_time(now()))
    q.save(journal.directory/('owner-'+phase+'.sql.json'),{'sql':sql,'sha256':sha(sql.encode())});journal.emit('sql_intent_'+phase,sqlSha256=sha(sql.encode()))
    try:
        rows=[json.loads(line)for line in q.peer(sql,write=True).splitlines()if line.strip()]
        expected={'repairPlanSha256':m.digest(plan),'phase':phase,'applied':True,'grantCountersReset':False}
        if rows!=[expected]:fail('repair_commit_ACK_mismatch')
    except BaseException:
        journal.emit('sql_ambiguous_'+phase,manualReconcileRequired=True);raise
    journal.emit('sql_ack_'+phase,receipt=expected);return expected


def revoke(q,m,plan,journal):
    with q.mutex(journal.directory/'financial.lock',seconds=12):
        current=permits(q,m,plan);path=journal.directory/'revoked.json'
        if current['owned']==[]:
            if current['active']!=0 or journal.latest('sql_intent_admission')is not None:fail('uncertain_manual_repair_admission_requires_reconcile')
            outcome='not_admitted_confirmed'
        else:
            row_identity(m,plan,current['owned'])
            if journal.latest('sql_ack_revoke')is None:execute(q,m,'revoke',plan,None,journal)
            current=permits(q,m,plan);row_identity(m,plan,current['owned'],disabled=True)
            if current['active']!=0:fail('unrelated_active_paid_authority')
            outcome='commit_confirmed'
        value={'format':'yunipals-paid-qualification-repair-revocation-v1','repairPlanSha256':m.digest(plan),'transactionOutcome':outcome,'permitIds':[r['permitId']for r in m.qualification_permits(plan)]}
        if path.exists():
            if json.loads(q.protected(path))!=value:fail('owned_repair_revocation_receipt_changed')
        else:q.save(path,value)
        return value


def controller_identity(q,qe,rid,plan_sha,marker,*,self_required):
    unit=controller_unit(rid);p=q.unit_properties(unit)
    argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-repair-live-v2.py')+' --run-id '+rid+' --plan-sha256 '+plan_sha+' --phase controller --apply '+marker
    if (p['Id']!=unit or p['LoadState']!='loaded'or p['ActiveState']!='active'or p['SubState']!='running'or p['Type']!='exec'or p['Restart']!='no'or p['User']not in {'','root'}or p['Group']not in {'','root'}or p['WorkingDirectory']!=str(OPS)or p['Description']!='Yunipals same-origin explicit qualification repair '+plan_sha or p['NoNewPrivileges']!='yes'or not re.fullmatch('[0-9a-f]{32}',p['InvocationID'])or not p['MainPID'].isdigit()or int(p['MainPID'])<=1 or
        re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])!=[argv]or set(p['AmbientCapabilities'].split())!={'cap_setuid','cap_setgid','cap_kill'}or set(p['CapabilityBoundingSet'].split())!={'cap_setuid','cap_setgid','cap_kill'}):fail('exact_owned_repair_controller_required')
    q.assert_no_unit_environment(qe,unit)
    if qe.bus_property(unit,'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=900000000:fail('bounded_repair_root_runtime_required')
    if self_required:
        if int(p['MainPID'])!=os.getpid():fail('repair_controller_actual_main_required')
        q.actual_root_capabilities()
    return {'unit':unit,'invocation':p['InvocationID'],'process':q.process_identity(int(p['MainPID']),unit),'definition':q.controller_definition_proof(qe,unit),
        'staticPropertiesSha256':sha(encoded(q.static_controller_properties(p))),'propertiesSha256':sha(encoded(p)),'applyHash':marker,'planSha256':plan_sha}


def stop_controller(q,qe,m,value,journal):
    saved=journal.latest('controller_started')
    if saved is None:
        if journal.latest('sql_intent_admission')is not None:fail('missing_repair_controller_ACK_after_admission')
        return
    expected=saved['identity'];fd=None
    try:
        with controller_reference(q,'qualification_repair_v2',value['review']['spec']['runId'],expected):
            props=q.unit_properties(expected['unit'])
            if props['InvocationID']not in {'',expected['invocation']}:fail('foreign_repair_controller_refused')
            if props['ActiveState']in {'inactive','failed'}and props['MainPID']=='0':
                ack=journal.latest('controller_finished');raw=q.protected(journal.directory/'controller-result.json');result=json.loads(raw)
                if (ack is None or ack.get('outcomeSha256')!=sha(raw)or ack.get('cleaned')is not result.get('cleaned')or type(result.get('cleaned'))is not bool or result.get('format')!=FORMAT or result.get('automaticRetryAllowed')is not False or
                    props['LoadState']!='loaded'or q.controller_definition_proof(qe,expected['unit'])!=expected['definition']or sha(encoded(q.static_controller_properties(props)))!=expected['staticPropertiesSha256']or
                    not q.original_process_gone(expected['process'],expected['unit'])):fail('finished_repair_controller_identity_or_ACK_changed')
                return
            current=controller_identity(q,qe,value['review']['spec']['runId'],m.digest(value['review']['spec']['plan']),expected['applyHash'],self_required=False)
            if current!=expected or current['process']['pid']==os.getpid():fail('exact_distinct_owned_repair_controller_required')
            fd=os.pidfd_open(current['process']['pid'],0)
            if q.process_identity(current['process']['pid'],expected['unit'])!=expected['process']:fail('repair_controller_PID_reused')
        # The kernel pidfd remains the exact lifetime fence after the short
        # readonly bus proof; no lookup occurs during the graceful wait.
        poll=select.poll();poll.register(fd,select.POLLIN)
        if not poll.poll(0):signal.pidfd_send_signal(fd,signal.SIGTERM,None,0)
        if not poll.poll(360000):fail('repair_cleanup_still_active_no_force_or_lock_wait')
    finally:
        if fd is not None:os.close(fd)


def fresh_guard(q,m,plan,s,e,counts,baseline=None):
    health=e.validate_current();qe,_,om=q.modules();current=q.snapshot(qe,om);m.current_state(plan,current,temporary=True)
    actual=permits(q,m,plan);row_identity(m,plan,actual['owned'],counts=counts)
    if actual['active']!=2:fail('only_both_owned_repair_permits_required')
    # Old failed authority is independently immutable throughout the repair.
    old=qe.permit_snapshot(om,plan['origin']);q.row_identity(om,plan['origin'],old['owned'],disabled=True)
    if [om.cu(next(a for a in old['owned']if a['chainId']==chain)['spentCu'])for chain in [56,8453]]!=[60,0]:fail('prior_failed_qualification_spend_changed')
    free={};evidence={}
    for name,(chain,port)in s.v.CHAINS.items():
        metrics=s.v.request(port,'/metrics');traffic=metrics.get('unified',{}).get('traffic',{});source=traffic.get('unified_source',{});ev=traffic.get('unified_evidence',{})
        if any(type(row.get(k))is not int for row,k in [(source,'paidCalls'),(source,'refused'),(ev,'paidCalls'),(ev,'refused')])or source.get('paidCalls')!=counts.get(str(chain),0)or source.get('refused')!=0 or ev.get('paidCalls')!=0 or ev.get('refused')!=0:fail('unexpected_repair_paid_or_refused_traffic')
        n=source.get('freeCalls')
        if type(n)is not int or n<0 or n>(1<<53)-1:fail('invalid_repair_source_free_counter')
        free[str(chain)]=n;evidence[str(chain)]=[ev['paidCalls'],ev['refused']]
    aggregate=om.cu(current['grants']['workloads']['unified_source'])-om.cu(plan['baselineSourceGrantedCu']);phase=aggregate-1000
    if not 0<=phase<=2000 or baseline is None and phase!=0 or baseline is not None and free!=baseline['sourceFreeCalls']:fail('repair_phase_booked_or_routing_changed')
    return {'phaseBookedCu':phase,'aggregateBookedCu':aggregate,'sourceFreeCalls':free,'evidence':evidence}


def run_probe(q,m,c,plan,s,e,*,utc_now=now,monotonic=time.monotonic,sleep=time.sleep,transport=None):
    # Reuse only the corrected transport, immutable fixed call/headers and strict
    # ERC721 decoder; the frozen old-planner loop/window is never substituted.
    transport=transport or c.LoopbackTransport();started=monotonic();counts={'56':0,'8453':0};previous={56:{},8453:{}};last_booked=0
    out={'format':c.FORMAT,'repairPlanSha256':m.digest(plan),'originAdmissionSha256':plan['originAdmissionSha256'],'status':'failed','attemptedRpcCalls':0,'completedRpcCalls':0,
        'maximumDispatchCu':360,'responseBytes':0,'calls':[],'bookedMigrationCu':None,'aggregateMigrationBookedCu':None,'priorFailedQualificationBookedCu':1000,
        'accountingComplete':False,'cleanupRequired':True,'automaticRetryAllowed':False,'productivePromotionAllowed':False,'rawResponsesEmitted':False}
    def allowance():
        current=utc_now();left=min(20,90-(monotonic()-started),(m.moment(plan['qualificationExpiresAt'])-current).total_seconds(),(m.moment(plan['expires'])-current).total_seconds())
        if current<m.moment(plan['phaseStart'])or left<=0:fail('repair_probe_deadline')
        return left
    try:
        m.validate_plan(plan);allowance();baseline=fresh_guard(q,m,plan,s,e,counts)
        calls=[c.ProbeCall(index+1,row['chainId'],span,row['permitId'])for index,(row,span)in enumerate((row,span)for row in m.qualification_permits(plan)for span in c.SPANS)]
        if len(calls)!=6:fail('fixed_six_manual_repair_calls_required')
        for index,call in enumerate(calls):
            if index:
                if allowance()<=1:fail('repair_probe_deadline')
                sleep(1)
            before=fresh_guard(q,m,plan,s,e,counts,baseline)
            if before['phaseBookedCu']<last_booked:fail('repair_booked_grants_regressed')
            out['attemptedRpcCalls']+=1
            status,raw=transport(call,allowance(),2_000_000-out['responseBytes'])
            if not isinstance(raw,bytes)or len(raw)+out['responseBytes']>2_000_000:fail('repair_shared_response_limit')
            out['responseBytes']+=len(raw);allowance();summary,found=c.decode_reply(call,status,raw,previous[call.chain]);previous[call.chain]=found
            counts[str(call.chain)]+=1;after=fresh_guard(q,m,plan,s,e,counts,baseline)
            if after['phaseBookedCu']<before['phaseBookedCu']:fail('repair_booked_grants_regressed')
            last_booked=after['phaseBookedCu'];out['calls'].append({'chainId':call.chain,'span':call.span,**summary});out['completedRpcCalls']+=1
        known=any(r['chainId']==8453 and r['knownBaseBlockLogCount']>0 for r in out['calls'])
        out.update(status='capability_responses_qualified'if known else'availability_only_known_event_absent',capabilityQualified=known,knownBaseEventObserved=known,
            allSixRangesAnswered=True,bookedMigrationCu=last_booked,aggregateMigrationBookedCu=1000+last_booked,accountingComplete=True)
    except c.Refusal as error:out['failure']=str(error)if str(error)in c.FIXED_FAILURES else'component_guard_refused'
    except TimeoutError:out['failure']='transport_timeout'
    except Exception as error:out.update(failure='transport_or_live_guard_failed',errorClass=type(error).__name__)
    out['elapsedSeconds']=round(monotonic()-started,3);return out


def cleanup(q,m,epoch,value,journal,s,e,*,at_utc=False):
    plan=value['review']['spec']['plan'];revoked=revoke(q,m,plan,journal)
    er=journal.latest('repair_epoch_record')
    if er is not None and e.record is None:e.restore_record(er['path'],er['sha256'])
    if e.record is not None:
        caches=e.cleanup(revoked);q.save(journal.directory/('cache-cleanup-'+str(len(journal.rows()))+'.json'),caches);journal.emit('owned_repair_caches_destroyed',result=caches)
    elif journal.latest('sql_intent_admission')is not None:fail('missing_repair_epoch_after_admission')
    else:
        e.cleanup_parent_cleaned()
    qe,_,om=q.modules()
    with q.mutex(journal.directory/'financial.lock',seconds=12):
        current=q.snapshot(qe,om)
        if journal.latest('sql_intent_admission')is None:
            if journal.latest('sql_ack_admission')or journal.latest('sql_ambiguous_admission'):fail('contradictory_repair_admission_journal')
            if not at_utc:return {'cleaned':True,'neverAdmitted':True}
            if journal.latest('sql_ack_inherited_utc')is not None:
                q.same_policy(om,current,plan['originalPolicy'],plan['otherAllocationsSha256'])
                return {'cleaned':True,'neverAdmitted':True,'inheritedQ1OriginalPolicyAlreadyRestored':True}
            execute(q,m,'inherited_utc',plan,current,journal,receipt=plan['failedClosure']['cleanupReceipt'])
            return {'cleaned':True,'neverAdmitted':True,'inheritedQ1OriginalPolicyRestored':True}
        if journal.latest('sql_ack_admission')is None:fail('uncertain_repair_admission_manual_reconcile')
        if at_utc:
            if journal.latest('sql_ack_utc')or journal.latest('sql_ack_boundary'):
                q.same_policy(om,current,plan['originalPolicy'],plan['otherAllocationsSha256']);return {'cleaned':True,'alreadyRestoredOriginalPolicy':True}
            if journal.latest('sql_ack_cleanup')is not None:
                raw=q.protected(journal.directory/'current-day-cleanup.json');receipt=json.loads(raw);prepared=journal.latest('current_day_cleanup_prepared')
                if prepared is None or prepared.get('receiptSha256')!=sha(raw):fail('repair_cleanup_receipt_ACK_mismatch')
                execute(q,m,'utc',plan,current,journal,receipt=receipt)
            else:
                if journal.latest('sql_intent_cleanup')or(journal.directory/'current-day-cleanup.json').exists():fail('uncertain_repair_cleanup_manual_reconcile')
                prior=q.snapshot(qe,om,day=plan['grantDay']);receipt=m.boundary_receipt(plan,current,prior,m.text_time(now()),m.QUIET)
                q.save(journal.directory/'boundary-cleanup.json',receipt);execute(q,m,'boundary',plan,current,journal,receipt=receipt)
            return {'cleaned':True,'originalPolicyRestored':True}
        if journal.latest('sql_ack_cleanup')is not None:
            receipt=json.loads(q.protected(journal.directory/'current-day-cleanup.json'));q.same_policy(om,current,receipt['policy'],plan['otherAllocationsSha256'])
        else:
            if journal.latest('sql_intent_cleanup')is not None:fail('uncertain_repair_cleanup_manual_reconcile')
            receipt=m.cleanup(plan,current,m.QUIET);h=q.save(journal.directory/'current-day-cleanup.json',receipt);journal.emit('current_day_cleanup_prepared',receiptSha256=h)
            execute(q,m,'cleanup',plan,current,journal)
        return {'cleaned':True,'aggregateMigrationBookedCu':receipt['migrationBookedGrantsCu'],'priorFailedQualificationBookedCu':'1000'}


def review_controller(q,m,epoch,value,directory):
    spec=value['review']['spec'];plan=spec['plan'];journal=q.Journal(directory)
    if journal.latest('controller_started')or journal.latest('sql_intent_admission'):fail('manual_repair_attempt_cannot_be_restarted')
    installed=journal.latest('repair_timers_installed')
    if installed is None or installed.get('livePlanSha256')!=sha(encoded(value))or installed.get('oldTimersDisabledAfterReplacementProof')is not True:fail('completed_repair_timer_handoff_ACK_required_before_admission')
    qvalue,qdir,_=failed_context(q,m,spec);qe,_,om=q.modules();q.require_sandbox_preflight(om,qvalue,q.Journal(qdir))
    with session_scope(q,m,epoch,spec,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
        er=e.review();current=q.snapshot(qe,om);m.current_state(plan,current,temporary=False)
        d,a,_,_,w,_=m.current_state(plan,current,temporary=False)
        policy={'global':current['global'],'allocations':sorted(a.values(),key=lambda r:r['workload']),'sourceGrantedCu':w['unified_source'],'day':current['grants']['day'],'profileExpiresAt':current['profileExpiresAt']}
        return {'format':FORMAT,'phase':'controller_review','livePlanSha256':sha(encoded(value)),'epochReviewHash':sha(encoded(er)),
            'policySha256':sha(encoded(policy)),'operatorSha256':sha(q.protected(Path(__file__).absolute())),'manualRepairSha256':plan['manualRepairSha256']}


def controller(q,m,epoch,c,value,directory,expected):
    spec=value['review']['spec'];plan=spec['plan'];journal=q.Journal(directory);prepared=review_controller(q,m,epoch,value,directory)
    if sha(encoded(prepared))!=expected:fail('fresh_exact_manual_repair_controller_review_required')
    qe,_,om=q.modules();identity=controller_identity(q,qe,spec['runId'],m.digest(plan),expected,self_required=True)
    q.save(directory/'controller-identity.json',identity);journal.emit('controller_started',identity=identity)
    out={'format':FORMAT,'qualified':False,'cleaned':False,'automaticRetryAllowed':False,'originalStart':plan['start'],'originalExpires':plan['expires'],'priorFailedQualificationBookedCu':'1000'}
    try:
        with session_scope(q,m,epoch,spec,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
            try:
                er=e.review()
                if sha(encoded(er))!=prepared['epochReviewHash']:fail('repair_epoch_changed_before_enable')
                e.enable(prepared['epochReviewHash']);e.timers();e.validate_current(zero=True);q.check_empty_caches(s)
                failed_context(q,m,spec)
                with q.mutex(directory/'financial.lock',seconds=12):execute(q,m,'admission',plan,q.snapshot(qe,om),journal)
                signal.setitimer(signal.ITIMER_REAL,90)
                try:probe=run_probe(q,m,c,plan,s,e)
                finally:signal.setitimer(signal.ITIMER_REAL,0)
                h=q.save(directory/'probe-result.json',probe);journal.emit('probe_complete',receiptSha256=h,capabilityQualified=probe.get('capabilityQualified')is True)
                out.update(qualified=probe.get('capabilityQualified')is True,probeReceiptSha256=h,phaseBookedCu=probe.get('bookedMigrationCu'),aggregateMigrationBookedCu=probe.get('aggregateMigrationBookedCu'))
            except BaseException as error:
                out['errorClass']=type(error).__name__;journal.emit('repair_work_failed',errorClass=type(error).__name__)
            finally:
                signal.setitimer(signal.ITIMER_REAL,0)
                try:out.update(cleanup(q,m,epoch,value,journal,s,e))
                except BaseException as error:out['cleanupErrorClass']=type(error).__name__;journal.emit('repair_cleanup_failed',errorClass=type(error).__name__,manualReconcileRequired=True)
    except BaseException as error:
        out['cleanupErrorClass']=type(error).__name__;journal.emit('repair_session_failed',errorClass=type(error).__name__,manualReconcileRequired=True)
    q.save(directory/'controller-result.json',out);journal.emit('controller_finished',outcomeSha256=sha(encoded(out)),cleaned=out['cleaned']);return out


def timer_executor(q,m,epoch,value,directory,kind):
    spec=value['review']['spec'];plan=spec['plan'];journal=q.Journal(directory);qe,_,_=q.modules()
    if kind not in {'deadline','utc'}:fail('fixed_owned_repair_timer_required')
    row=next(r for r in value['review']['timers']if r['kind']==kind);p=q.unit_properties(row['serviceUnit'])
    argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-repair-live-v2.py')+' --run-id '+spec['runId']+' --plan-sha256 '+m.digest(plan)+' --phase '+kind
    if (p['Id']!=row['serviceUnit']or p['Type']!='exec'or p['ActiveState']!='active'or p['SubState']!='running'or p['MainPID']!=str(os.getpid())or p['User']not in {'','root'}or p['Group']not in {'','root'}or p['Restart']!='no'or p['NoNewPrivileges']!='yes'or p['WorkingDirectory']!=str(OPS)or
        set(p['AmbientCapabilities'].split())!={'cap_setuid','cap_setgid','cap_kill'}or set(p['CapabilityBoundingSet'].split())!={'cap_setuid','cap_setgid','cap_kill'}or re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])!=[argv]or
        any(sha(q.protected(Path(path),50000))!=h for path,h in row['definitions'].items())or qe.bus_property(row['serviceUnit'],'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=900000000):fail('exact_repair_cleanup_executor_required')
    q.assert_no_unit_environment(qe,row['serviceUnit']);q.actual_root_capabilities()
    if now()<m.moment(row['dueUtc']):fail('owned_repair_timer_too_early')
    error=None
    try:revoke(q,m,plan,journal)
    except BaseException as exc:error=type(exc).__name__;journal.emit('timer_revoke_unconfirmed',errorClass=error)
    stop_controller(q,qe,m,value,journal)
    if error:fail('repair_revocation_unconfirmed_controller_stopped_manual_reconcile')
    with q.mutex(directory/'cleanup.lock'):
        with session_scope(q,m,epoch,spec,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
            result=cleanup(q,m,epoch,value,journal,s,e,at_utc=kind=='utc')
    q.save(directory/('timer-'+kind+'-result.json'),result);return result


def closed_repair(q,m,rid,expected_live_sha):
    """Read-only handoff: new false IDs come only from this ACKed clean record."""
    directory,_,livefile=paths(rid);live_raw=q.protected(livefile,1000000);value=json.loads(live_raw)
    if (sha(live_raw)!=expected_live_sha or value.get('format')!=FORMAT or value.get('reviewHash')!=sha(encoded(value.get('review')))or
        value['review']['spec']['runId']!=rid or value['review']['operatorSha256']!=sha(q.protected(Path(__file__).absolute()))):fail('exact_closed_repair_live_plan_required')
    spec=value['review']['spec'];plan=spec['plan'];failed_context(q,m,spec);journal=q.Journal(directory)
    raw=q.protected(directory/'controller-result.json');out=json.loads(raw);ack=journal.latest('controller_finished')
    probe=json.loads(q.protected(directory/'probe-result.json'));pa=journal.latest('probe_complete');ca=journal.latest('sql_ack_cleanup');cache=journal.latest('owned_repair_caches_destroyed');er=journal.latest('repair_epoch_record')
    if (out.get('qualified')is not True or out.get('cleaned')is not True or out.get('automaticRetryAllowed')is not False or ack is None or ack.get('outcomeSha256')!=sha(raw)or ack.get('cleaned')is not True or
        pa is None or pa.get('capabilityQualified')is not True or pa.get('receiptSha256')!=sha(encoded(probe))or out.get('probeReceiptSha256')!=sha(encoded(probe))or ca is None or cache is None or er is None or
        cache['result'].get('ownedRepairCachesDestroyed')is not True):fail('actual_closed_successful_manual_repair_required')
    cleanup_raw=q.protected(directory/'current-day-cleanup.json');cleanup_value=json.loads(cleanup_raw);prepared=journal.latest('current_day_cleanup_prepared')
    if prepared is None or prepared.get('receiptSha256')!=sha(cleanup_raw)or ca.get('receipt')!={'repairPlanSha256':m.digest(plan),'phase':'cleanup','applied':True,'grantCountersReset':False}:fail('actual_repair_cleanup_commit_ACK_required')
    m.validate_receipt(plan,cleanup_value)
    expected={'format':'yunipals-paid-capability-components-v1','status':'capability_responses_qualified','capabilityQualified':True,'knownBaseEventObserved':True,'allSixRangesAnswered':True,
        'accountingComplete':True,'attemptedRpcCalls':6,'completedRpcCalls':6,'maximumDispatchCu':360,'automaticRetryAllowed':False,'productivePromotionAllowed':False,
        'repairPlanSha256':m.digest(plan),'originAdmissionSha256':plan['originAdmissionSha256'],'priorFailedQualificationBookedCu':1000}
    if (any(probe.get(k)!=v or type(probe.get(k))is not type(v)for k,v in expected.items())or
        [(r.get('chainId'),r.get('span'))for r in probe.get('calls',[])]!=[(chain,span)for chain in [56,8453]for span in [26,1000,10000]]or
        any(type(r.get('logCount'))is not int or r['logCount']<0 or not m.is_sha(r.get('responseSha256'))for r in probe['calls'])or
        not any(r['chainId']==8453 and type(r.get('knownBaseBlockLogCount'))is int and r['knownBaseBlockLogCount']>0 for r in probe['calls'])):fail('actual_six_call_repair_capability_proof_required')
    if probe.get('bookedMigrationCu')!=int(cleanup_value['repairPhaseBookedCu'])or probe.get('aggregateMigrationBookedCu')!=int(cleanup_value['migrationBookedGrantsCu']):fail('repair_probe_and_total_booked_grants_disagree')
    record=json.loads(q.protected(Path(er['path']),2000000))
    if (sha(encoded(record))!=er['sha256']or record.get('format')!='yunipals-paid-qualification-repair-epoch-v2'or record.get('state',{}).get('cleaned')is not True or
        record['state'].get('review',{}).get('plan')!=plan or cache['result'].get('recordFile')!=er['path']or cache['result'].get('recordSha256')!=er['sha256']):fail('actual_new_cleaned_repair_epoch_required')
    original,_,_=failed_context(q,m,spec)
    return {'value':value,'directory':directory,'originalQ':spec['qualification'],'originalQValue':original,'plan':plan,'probe':probe,'cleanup':cleanup_value,'cleanupReceipt':cleanup_value,
        'cacheReceipt':cache['result'],'cleanupAck':ca,'finishedAck':ack,'epochRecord':{'path':er['path'],'sha256':er['sha256']},
        'controllerResultSha256':sha(raw),'controllerFinishedAckSha256':sha(encoded(ack)),'probeCompleteAckSha256':sha(encoded(pa)),
        'cleanupAckSha256':sha(encoded(ca)),'cacheCleanupReceiptSha256':sha(encoded(cache['result'])),'originalStart':plan['start'],'originalExpires':plan['expires']}


def main():
    os.umask(0o077);parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run-id',required=True);parser.add_argument('--plan-sha256',required=True)
    parser.add_argument('--phase',choices=['review','install','controller-review','controller','deadline','utc'],default='review');parser.add_argument('--apply');a=parser.parse_args()
    q,m,epoch,c=modules();rid=run_id(a.run_id)
    if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('exact_production_root_host_required')
    directory,_,livefile=paths(rid)
    if a.phase in {'review','install'}:
        spec=load_spec(q,m,rid,a.plan_sha256);review=prepare(q,m,epoch,spec)
        result=install(q,m,epoch,review,a.apply)if a.phase=='install'else{'format':FORMAT,'reviewHash':sha(encoded(review)),'applied':False,'newCalls':False}
    else:
        value=json.loads(q.protected(livefile,1000000));spec=value['review']['spec']
        if value.get('format')!=FORMAT or value['reviewHash']!=sha(encoded(value['review']))or m.digest(spec['plan'])!=a.plan_sha256 or spec['runId']!=rid or value['review']['operatorSha256']!=sha(q.protected(Path(__file__).absolute())):fail('exact_installed_manual_repair_plan_required')
        if a.phase=='controller-review':result={'format':FORMAT,'reviewHash':sha(encoded(review_controller(q,m,epoch,value,directory))),'applied':False}
        elif a.phase=='controller':
            def interrupted(*_):raise InterruptedError('owned_manual_repair_stop')
            for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGALRM]:signal.signal(sig,interrupted)
            result=controller(q,m,epoch,c,value,directory,a.apply)
        else:result=timer_executor(q,m,epoch,value,directory,a.phase)
    print(json.dumps({k:v for k,v in result.items()if k in {'format','reviewHash','applied','installed','qualified','cleaned','errorClass','cleanupErrorClass','automaticRetryAllowed','aggregateMigrationBookedCu','newCalls'}}))


if __name__=='__main__':main()
