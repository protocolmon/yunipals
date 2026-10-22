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
BASE=Path('/var/backups/yunipals-paid-qualification-second-repair-live-v1-20261021')
SYSTEMD=Path('/etc/systemd/system')
FORMAT='yunipals-paid-qualification-second-repair-live-v1'
Q_SHA='2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
TRANSPORT_SHA='bcc43ed7b59fe1420c60498eeb809c74ddc63e1a0689fa74ad20b75cbf9a5955'
PRIOR_LIVE_SHA='a8e05d69d3c0d46bc9ffb92734b66db377b6c98472bf295356e181c5b41d3c4c'
PRIOR_EPOCH_SHA='fd82c54cbc755070a93e3f48bf0be0b0d93eead5a35230d2cdf976b882d1b63b'
MODEL_SHA='2f7fa24a6684e365a708363f15f90c9ca55a8355eaeba077a5fbbaaef2f888e1'
EPOCH_SHA='3cb94946e664f2304cd5777084b603591890a6875111214a2e31884b8f6ad579'
REFERENCE_SHA='06c4e41c70edf7c4bbb41a014c3333ed602952051219d56b4e6bf35f758b84a2'
ORIGINAL_START='2026-10-21T11:16:25.939473Z'
ORIGINAL_EXPIRES='2026-10-21T19:16:25.939473Z'
ACTUAL_PREVIOUS={
    'runId':'20261021-qrepair1','livePlanSha256':'d948193efa5f4f6c7248a92304b49c1669e56fbc0afcae45066218450bb2a976',
    'priorRepairPlanSha256':'b882df7305160540c2786722972be6de8ad8a9b9ebc25ea8c65dc7d2f780cc65',
    'controllerResultSha256':'e2a3db6d7217b9d1d6b97dd1b2de0ab68489dcd55a8f27090562d8915bb256b9',
    'controllerFinishedAckSha256':'b78979ece5b7dbd5dddddc2ef5e8a9ce1e8b19900a6f8d060507c90b8bdd6c00',
    'probeResultSha256':'f665bf047640fff996371ecdb6516308cfbc368906cb867b764b5432ad107fa7',
    'probeCompleteAckSha256':'4b752eb7b3a079e8069c79af0360872eddb3892a25c9544865dcdbf4cab13f51',
    'cleanupReceiptSha256':'73f9ac96a6080aa472d3b92ef1ac7cd4a4492a94463b61043901e7a858e1faae',
    'cleanupAckSha256':'89be484af006616b852c0846a8c4c96f13e8e69861aac51e30e8c3860f286667',
    'cacheCleanupReceiptSha256':'16aaf188d62983b547b3674a2c1a0071dca5d2df6d1c060f4ead8cf87d225eb6',
    'epochRecordFile':'/var/backups/yunipals-paid-qualification-repair-epoch-v2-20261021/20261021-qrepair1/0e701df75a52a8046205721bcde581bd72f146c28633c276f9c7a1bef0407f48/cleaned.json',
    'epochRecordSha256':'135b9f96538b7dc67c49002764fe20fb56526d487c4390dcd1e2aca25acbe970',
    'restoredFalseInvocations':{'base':'a0b6cb4400204be0bef96d7c016a60d6','bnb':'1a17cc3b4c264b129f09506f20129174'}}


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
    m=q.load(OPS/'paid-qualification-second-repair-plan-v1.py',MODEL_SHA,'manual_repair_model')
    e=q.load(OPS/'paid-qualification-second-repair-epoch-v1.py',EPOCH_SHA,'manual_repair_epoch')
    c=q.load(OPS/'paid-capability-filtered-v3.py',TRANSPORT_SHA,'manual_repair_transport')
    if e.MODEL_SHA!=MODEL_SHA or m.TRANSPORT_SHA!=TRANSPORT_SHA or c.TRANSPORT_SHA!='f288221ecb9e5f5b18723b54ddb8f7362b5079e1596c1996622454bff2c820d4':fail('repair_dependency_binding_changed')
    return q,m,e,c


def paths(rid):
    run_id(rid)
    return BASE/rid,OPS/('paid-qualification-second-repair-v1-'+rid+'.plan.json'),OPS/('paid-qualification-second-repair-v1-'+rid+'.live.json')


def controller_reference(q,kind,rid,identity):
    ref=q.load(OPS/'paid-controller-reference-v3.py',REFERENCE_SHA,'repair_owned_controller_reference')
    if kind=='original_qualification':
        argv='/usr/bin/python3 -B '+str(OPS/'paid-capability-live-v1.py')+' --run-id '+rid+' --admission-sha256 '+identity['admissionSha256']+' --phase controller --apply '+identity['applyHash']
    else:
        argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-second-repair-live-v1.py')+' --run-id '+rid+' --plan-sha256 '+identity['planSha256']+' --phase controller --apply '+identity['applyHash']
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


def previous_context(q,m,reference,*,terminal=True):
    """Reconstruct actual failed repair2; never relabel a success or adopt IDs."""
    if not isinstance(reference,dict)or set(reference)!={'runId','livePlanSha256'}or any(reference.get(k)!=ACTUAL_PREVIOUS[k]for k in ['runId','livePlanSha256']):fail('exact_actual_previous_failed_repair_reference_required')
    prior=q.load(OPS/'paid-qualification-repair-live-v2.py',PRIOR_LIVE_SHA,'second_repair_previous_driver');pm=m.prior_model()
    directory,_,livefile=prior.paths(reference['runId']);raw=q.protected(livefile,1000000);value=json.loads(raw)
    if(sha(raw)!=reference['livePlanSha256']or value.get('format')!=prior.FORMAT or value.get('reviewHash')!=sha(encoded(value.get('review')))or
        value['review']['operatorSha256']!=PRIOR_LIVE_SHA or value['review']['spec']['runId']!=reference['runId']):fail('actual_previous_repair_live_context_required')
    spec=value['review']['spec'];plan=spec['plan'];original,qdir,_=prior.failed_context(q,pm,spec,terminal=terminal);journal=q.Journal(directory)
    result_raw=q.protected(directory/'controller-result.json');out=json.loads(result_raw);ack=journal.latest('controller_finished');started=journal.latest('controller_started')
    probe=json.loads(q.protected(directory/'probe-result.json'));pa=journal.latest('probe_complete');ca=journal.latest('sql_ack_cleanup');cache=journal.latest('owned_repair_caches_destroyed');er=journal.latest('repair_epoch_record')
    if(out.get('qualified')is not False or out.get('cleaned')is not True or out.get('automaticRetryAllowed')is not False or any(row is None for row in [ack,started,pa,ca,cache,er])or
        ack.get('outcomeSha256')!=sha(result_raw)or ack.get('cleaned')is not True or pa.get('capabilityQualified')is not False or pa.get('receiptSha256')!=sha(encoded(probe))or
        out.get('probeReceiptSha256')!=sha(encoded(probe))or cache.get('result',{}).get('ownedRepairCachesDestroyed')is not True):fail('actual_failed_cleaned_previous_repair_ACKs_required')
    cleanup_raw=q.protected(directory/'current-day-cleanup.json');receipt=json.loads(cleanup_raw);prepared=journal.latest('current_day_cleanup_prepared')
    if(prepared is None or prepared.get('receiptSha256')!=sha(cleanup_raw)or ca.get('receipt')!={'repairPlanSha256':pm.digest(plan),'phase':'cleanup','applied':True,'grantCountersReset':False}):fail('previous_repair_cleanup_commit_ACK_required')
    pm.validate_receipt(plan,receipt);actual=prior.permits(q,pm,plan);prior.row_identity(pm,plan,actual['owned'],disabled=True)
    if actual['active']!=0:fail('previous_paid_authority_must_be_disabled')
    rows=[{**r,'enabled':False,'spentCu':next(a['spentCu']for a in actual['owned']if a['permitId']==r['permitId'])}for r in pm.qualification_permits(plan)]
    closure={'format':'yunipals-failed-manual-repair-closure-v1','originAdmissionSha256':m.digest(plan['origin']),'priorRepairPlanSha256':m.digest(plan),'runId':reference['runId'],
        'controllerResultSha256':sha(result_raw),'probeResultSha256':sha(encoded(probe)),'controllerFinishedAckSha256':sha(encoded(ack)),
        'probeCompleteAckSha256':sha(encoded(pa)),'livePlanSha256':reference['livePlanSha256'],'cleanupReceipt':receipt,'cleanupAckSha256':sha(encoded(ca)),
        'cacheCleanupReceiptSha256':sha(encoded(cache['result'])),'epochRecordFile':er['path'],'epochRecordSha256':er['sha256'],
        'qualified':False,'cleaned':True,'attemptedRpcCalls':probe.get('attemptedRpcCalls'),'completedRpcCalls':probe.get('completedRpcCalls'),'failure':probe.get('failure'),'oldPermits':rows}
    m.validate_failed_closure(plan,closure);record=json.loads(q.protected(Path(er['path']),2000000))
    if(sha(encoded(record))!=er['sha256']or record.get('format')!='yunipals-paid-qualification-repair-epoch-v2'or record.get('state',{}).get('cleaned')is not True or
        record['state'].get('review',{}).get('plan')!=plan or cache['result'].get('recordFile')!=er['path']or cache['result'].get('recordSha256')!=er['sha256']):fail('previous_false_epoch_ACK_required')
    if(any(closure.get(k)!=value for k,value in ACTUAL_PREVIOUS.items()if k not in {'cleanupReceiptSha256','restoredFalseInvocations'})or
        sha(cleanup_raw)!=ACTUAL_PREVIOUS['cleanupReceiptSha256']or receipt['migrationBookedGrantsCu']!='3000'or
        [row['spentCu']for row in rows]!=['180','120']or
        {name:row.get('restoredFalseInvocationId')for name,row in record['state'].get('chains',{}).items()}!=ACTUAL_PREVIOUS['restoredFalseInvocations']):fail('accepted_actual_failed_repair2_proof_mismatch')
    if terminal:
        identity=started['identity'];qe,_,_=q.modules()
        with prior.controller_reference(q,'qualification_repair_v2',reference['runId'],identity):
            props=q.unit_properties(identity['unit'])
            if(props['MainPID']!='0'or props['ActiveState']not in {'inactive','failed'}or props['InvocationID']not in {'',identity['invocation']}or props['LoadState']!='loaded'or
                q.controller_definition_proof(qe,identity['unit'])!=identity['definition']or sha(encoded(q.static_controller_properties(props)))!=identity['staticPropertiesSha256']or
                not q.original_process_gone(identity['process'],identity['unit'])):fail('previous_manual_repair_must_be_finished_without_replacement')
    return {'value':value,'directory':directory,'plan':plan,'closure':closure,'originalQValue':original,'originalQDirectory':qdir,'epochRecord':{'path':er['path'],'sha256':er['sha256']},'probe':probe,'cleanup':receipt}


def failed_context(q,m,spec,*,terminal=True):
    plan=spec['plan'];m.validate_plan(plan);ctx=previous_context(q,m,spec['qualification'],terminal=terminal)
    if(plan['previousRepairPlan']!=ctx['plan']or plan['failedClosure']!=ctx['closure']or plan['start']!=ORIGINAL_START or plan['expires']!=ORIGINAL_EXPIRES or spec['runId']==ctx['closure']['runId']):fail('same_original_previous_failed_repair_mismatch')
    manual=OPS/('paid-qualification-second-repair-v1-'+spec['runId']+'.approval.json')
    if spec['repairReceiptFile']!=str(manual):fail('fixed_second_manual_repair_receipt_required')
    raw=q.protected(manual)
    if sha(raw)!=spec['repairReceiptSha256']or json.loads(raw)!=plan['manualRepair']or m.digest(json.loads(raw))!=plan['manualRepairSha256']:fail('explicit_second_repair_receipt_changed')
    return ctx['value'],ctx['directory'],ctx['closure']


def load_spec(q,m,rid,expected):
    _,path,_=paths(rid);raw=q.protected(path,500000)
    if sha(raw)!=expected:fail('exact_root_repair_plan_pin_required')
    spec=json.loads(raw)
    if set(spec)!={'format','runId','plan','qualification','repairReceiptFile','repairReceiptSha256'}or spec['format']!='yunipals-paid-qualification-second-repair-live-plan-v1'or spec['runId']!=rid:fail('exact_manual_repair_spec_required')
    failed_context(q,m,spec)
    return spec


@contextmanager
def session_scope(q,m,epoch,spec,journal,timer_file,timer_sha):
    failed_context(q,m,spec);ctx=previous_context(q,m,spec['qualification']);qe,_,_=q.modules();path,expected=q.session_plan(ctx['originalQValue'])
    with qe.open_session(path,expected)as s:
        original=spec['plan']['previousRepairPlan']['failedClosure'];s.restore_record(original['epochRecordFile'],original['epochRecordSha256'])
        old=q.load(OPS/'paid-qualification-repair-epoch-v2.py',PRIOR_EPOCH_SHA,'second_repair_previous_epoch')
        def no_mutation(*_):fail('previous_repair_history_immutable')
        parent=old.prepare(s,spec['plan']['previousRepairPlan'],spec['qualification']['runId'],timer_file=ctx['value']['timerReceiptFile'],timer_sha=ctx['value']['timerReceiptSha256'],record_callback=no_mutation)
        parent.restore_record(ctx['epochRecord']['path'],ctx['epochRecord']['sha256'])
        e=epoch.prepare(s,spec['plan'],spec['runId'],previous_epoch=parent,timer_file=timer_file,timer_sha=timer_sha,record_callback=epoch_callback(q,journal))
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
        'ReadWritePaths='+str(BASE)+' '+str(OPS)+' /etc/systemd/system /run/lock /var/backups/yunipals-paid-qualification-second-repair-epoch-v1-20261021\n')


def controller_unit(rid):return 'yunipals-paid-qualification-second-repair-v1-'+run_id(rid)+'.service'
def controller_definition(m,plan,rid,marker):
    if not m.is_sha(marker):fail('exact_repair_controller_apply_hash_required')
    argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-second-repair-live-v1.py')+' --run-id '+rid+' --plan-sha256 '+m.digest(plan)+' --phase controller --apply '+marker
    raw='[Unit]\nDescription=Yunipals same-origin explicit qualification repair '+m.digest(plan)+'\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(OPS)+'\nExecStart='+argv+'\n'+service_properties()
    return {'unit':controller_unit(rid),'definition':raw,'definitionSha256':sha(raw.encode())}


def timer_definitions(m,plan,rid):
    rows=[]
    for kind,due in [('deadline',plan['qualificationExpiresAt']),('utc',plan['nextUtc'])]:
        prefix='yunipals-paid-qualification-second-repair-v1-'+kind+'-'+m.digest(plan)[:16];timer=prefix+'.timer';service=prefix+'.service'
        argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-second-repair-live-v1.py')+' --run-id '+rid+' --plan-sha256 '+m.digest(plan)+' --phase '+kind
        text='[Unit]\nDescription=Yunipals same-origin repair '+kind+' '+m.digest(plan)+'\n[Timer]\nOnCalendar='+m.moment(due).strftime('%Y-%m-%d %H:%M:%S.%f UTC')+'\nAccuracySec=1us\nRandomizedDelaySec=0\nPersistent=true\nUnit='+service+'\n[Install]\nWantedBy=timers.target\n'
        service_text='[Unit]\nDescription=Yunipals same-origin repair executor '+m.digest(plan)+'\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(OPS)+'\nExecStart='+argv+'\n'+service_properties()
        rows.append({'kind':kind,'dueUtc':due,'timerUnit':timer,'serviceUnit':service,'timerText':text,'serviceText':service_text,'definitions':{str(SYSTEMD/timer):sha(text.encode()),str(SYSTEMD/service):sha(service_text.encode())}})
    return rows


def prepare(q,m,epoch,spec):
    qvalue,directory,closure=failed_context(q,m,spec);qe,_,om=q.modules();current=q.snapshot(qe,om);plan=spec['plan']
    if m.prepare(plan['previousRepairPlan'],closure,current,plan['manualRepair'],plan['phaseStart'])!=plan:fail('same_origin_manual_repair_plan_changed')
    if not m.moment(plan['phaseStart'])<=now()<m.moment(plan['qualificationExpiresAt']):fail('bounded_repair_phase_unavailable')
    qe.source_gate();q.approval();q.require_sandbox_preflight(om,previous_context(q,m,spec['qualification'])['originalQValue'],q.Journal(previous_context(q,m,spec['qualification'])['originalQDirectory']))
    _,allocations,_,_,work,_=m.current_state(plan,current,temporary=False)
    policy={'global':current['global'],'allocations':sorted(allocations.values(),key=lambda r:r['workload']),'sourceGrantedCu':work['unified_source'],'day':current['grants']['day'],'profileExpiresAt':current['profileExpiresAt']}
    return {'format':FORMAT,'spec':spec,'policy':policy,'operatorSha256':sha(q.protected(Path(__file__).absolute())),
        'timers':timer_definitions(m,plan,spec['runId']),'originalStart':plan['start'],'originalExpires':plan['expires'],'priorBookedCu':plan['priorBookedCu'],'newCalls':False}


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
    receipt={'format':'yunipals-paid-qualification-second-repair-timers-v1','repairPlanSha256':m.digest(spec['plan']),'runId':rid,'executorSha256':review['operatorSha256'],
        'timers':[{k:r[k]for k in ['kind','dueUtc','timerUnit','serviceUnit','definitions']}for r in review['timers']]}
    timer_file=OPS/('paid-qualification-second-repair-v1-'+rid+'.timers.json');timer_sha=q.save(timer_file,receipt)
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
        e.timers();e.previous_epoch.verify_cleaned()
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
        value={'format':'yunipals-paid-qualification-second-repair-revocation-v1','repairPlanSha256':m.digest(plan),'transactionOutcome':outcome,'permitIds':[r['permitId']for r in m.qualification_permits(plan)]}
        if path.exists():
            if json.loads(q.protected(path))!=value:fail('owned_repair_revocation_receipt_changed')
        else:q.save(path,value)
        return value


def controller_identity(q,qe,rid,plan_sha,marker,*,self_required):
    unit=controller_unit(rid);p=q.unit_properties(unit)
    argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-second-repair-live-v1.py')+' --run-id '+rid+' --plan-sha256 '+plan_sha+' --phase controller --apply '+marker
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
        with controller_reference(q,'qualification_second_repair_v1',value['review']['spec']['runId'],expected):
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
    prior=q.load(OPS/'paid-qualification-repair-live-v2.py',PRIOR_LIVE_SHA,'second_repair_guard_previous_driver');pm=m.prior_model()
    previous=prior.permits(q,pm,plan['previousRepairPlan']);prior.row_identity(pm,plan['previousRepairPlan'],previous['owned'],disabled=True)
    for row in plan['failedClosure']['oldPermits']:
        actual=next(a for a in previous['owned']if a['permitId']==row['permitId'])
        if pm.cu(actual['spentCu'])!=m.cu(row['spentCu']):fail('previous_manual_repair_spend_changed')
    free={};evidence={}
    for name,(chain,port)in s.v.CHAINS.items():
        metrics=s.v.request(port,'/metrics');traffic=metrics.get('unified',{}).get('traffic',{});source=traffic.get('unified_source',{});ev=traffic.get('unified_evidence',{})
        if any(type(row.get(k))is not int for row,k in [(source,'paidCalls'),(source,'refused'),(ev,'paidCalls'),(ev,'refused')])or source.get('paidCalls')!=counts.get(str(chain),0)or source.get('refused')!=0 or ev.get('paidCalls')!=0 or ev.get('refused')!=0:fail('unexpected_repair_paid_or_refused_traffic')
        n=source.get('freeCalls')
        if type(n)is not int or n<0 or n>(1<<53)-1:fail('invalid_repair_source_free_counter')
        free[str(chain)]=n;evidence[str(chain)]=[ev['paidCalls'],ev['refused']]
    aggregate=om.cu(current['grants']['workloads']['unified_source'])-om.cu(plan['baselineSourceGrantedCu']);phase=aggregate-m.cu(plan['priorBookedCu'])
    if not 0<=phase<=2000 or baseline is None and phase!=0 or baseline is not None and free!=baseline['sourceFreeCalls']:fail('repair_phase_booked_or_routing_changed')
    return {'phaseBookedCu':phase,'aggregateBookedCu':aggregate,'sourceFreeCalls':free,'evidence':evidence}


def run_probe(q,m,c,plan,s,e,*,utc_now=now,monotonic=time.monotonic,sleep=time.sleep,transport=None):
    def guard(counts,baseline):return fresh_guard(q,m,plan,s,e,counts,baseline)
    out=c.run_probe(permits=m.qualification_permits(plan),fresh_guard=guard,transport=transport,utc_now=utc_now,monotonic=monotonic,sleep=sleep,
        prior_booked_cu=m.cu(plan['priorBookedCu']),phase_start=plan['phaseStart'],phase_expires=plan['qualificationExpiresAt'],original_expires=plan['expires'])
    out.update(repairPlanSha256=m.digest(plan),originAdmissionSha256=plan['originAdmissionSha256'],priorFailedQualificationBookedCu=m.cu(plan['priorBookedCu']),
        priorIssuedPermitAuthorityCu=720,aggregateIssuedPermitAuthorityCu=1080,componentOnly=False,integrationComplete=True)
    return out


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
                return {'cleaned':True,'neverAdmitted':True,'inheritedPreviousRepairOriginalPolicyAlreadyRestored':True}
            execute(q,m,'inherited_utc',plan,current,journal,receipt=plan['failedClosure']['cleanupReceipt'])
            return {'cleaned':True,'neverAdmitted':True,'inheritedPreviousRepairOriginalPolicyRestored':True}
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
        return {'cleaned':True,'aggregateMigrationBookedCu':receipt['migrationBookedGrantsCu'],'priorFailedQualificationBookedCu':plan['priorBookedCu']}


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
    out={'format':FORMAT,'qualified':False,'cleaned':False,'automaticRetryAllowed':False,'originalStart':plan['start'],'originalExpires':plan['expires'],'priorFailedQualificationBookedCu':plan['priorBookedCu']}
    try:
        with session_scope(q,m,epoch,spec,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
            try:
                er=e.review()
                if sha(encoded(er))!=prepared['epochReviewHash']:fail('repair_epoch_changed_before_enable')
                e.enable(prepared['epochReviewHash']);e.timers();e.validate_current(zero=True);q.check_empty_caches(s)
                failed_context(q,m,spec)
                with q.mutex(directory/'financial.lock',seconds=12):execute(q,m,'admission',plan,q.snapshot(qe,om),journal)
                signal.setitimer(signal.ITIMER_REAL,180)
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
    argv='/usr/bin/python3 -B '+str(OPS/'paid-qualification-second-repair-live-v1.py')+' --run-id '+spec['runId']+' --plan-sha256 '+m.digest(plan)+' --phase '+kind
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


def closed_second_repair(q,m,rid,expected_live_sha):
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
        'probeRevision':'filtered_base_v3','qualificationScope':'filtered_historical_span_capability','denseSourceCapacityQualified':False,
        'repairPlanSha256':m.digest(plan),'originAdmissionSha256':plan['originAdmissionSha256'],'priorFailedQualificationBookedCu':m.cu(plan['priorBookedCu'])}
    if (any(probe.get(k)!=v or type(probe.get(k))is not type(v)for k,v in expected.items())or
        [(r.get('chainId'),r.get('span'))for r in probe.get('calls',[])]!=[(chain,span)for chain in [56,8453]for span in [26,1000,10000]]or
        any(type(r.get('logCount'))is not int or r['logCount']<0 or not m.is_sha(r.get('responseSha256'))for r in probe['calls'])or
        not any(r['chainId']==8453 and type(r.get('knownBaseBlockLogCount'))is int and r['knownBaseBlockLogCount']>0 for r in probe['calls'])):fail('actual_six_call_repair_capability_proof_required')
    witness=probe.get('selectorWitness',{})
    if(witness.get('chainId')!=8453 or witness.get('knownBlock')!=22224858 or witness.get('address')!='0x98433df878e8c898cb907345c3a7756e5f72240f'or
        witness.get('selectionRule')!='first_inclusion_tuple_in_known_block'or any(not m.is_sha(witness.get(k))for k in ['selectorSha256','baselineLogSha256','baselineResponseSha256'])or
        type(witness.get('baselineMatchingLogCount'))is not int or witness['baselineMatchingLogCount']<1 or
        witness.get('filteredResponsesContainBaseline')is not True or witness.get('filteredNestedConsistency')is not True or
        type(probe.get('responseBytes'))is not int or not 0<probe['responseBytes']<=2000000 or probe.get('maximumSeconds')!=180 or
        probe.get('componentOnly')is not False or probe.get('integrationComplete')is not True):fail('actual_filtered_selector_capability_witness_required')
    for row in probe['calls']:
        filtered=row['chainId']==8453 and row['span']in {1000,10000}
        if(row.get('filterKind')!=('selected_token_transfer'if filtered else'collection_transfer')or
            row.get('nestedConsistencyChecked')is not(row['span']in {1000,10000})or
            filtered and(row.get('selectorSha256')!=witness['selectorSha256']or row.get('selectedBaselineLogSha256')!=witness['baselineLogSha256']or row.get('selectedBaselineObserved')is not True)):
            fail('actual_selected_baseline_and_nested_subset_required')
    if(type(probe.get('bookedMigrationCu'))is not int or not 360<=probe['bookedMigrationCu']<=2000 or
        probe['bookedMigrationCu']!=int(cleanup_value['repairPhaseBookedCu'])or probe.get('aggregateMigrationBookedCu')!=int(cleanup_value['migrationBookedGrantsCu'])):fail('repair_probe_and_total_booked_grants_disagree')
    record=json.loads(q.protected(Path(er['path']),2000000))
    if (sha(encoded(record))!=er['sha256']or record.get('format')!='yunipals-paid-qualification-second-repair-epoch-v1'or record.get('state',{}).get('cleaned')is not True or
        record['state'].get('review',{}).get('plan')!=plan or cache['result'].get('recordFile')!=er['path']or cache['result'].get('recordSha256')!=er['sha256']):fail('actual_new_cleaned_repair_epoch_required')
    original,_,_=failed_context(q,m,spec)
    return {'value':value,'directory':directory,'previousQualification':spec['qualification'],'originalQValue':previous_context(q,m,spec['qualification'])['originalQValue'],'previousClosedRepair':previous_context(q,m,spec['qualification']),'plan':plan,'probe':probe,'cleanup':cleanup_value,'cleanupReceipt':cleanup_value,
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
