#!/usr/bin/env python3
"""Transfer completed prod3's remaining UTC duty to a financial-only executor.

Default review is read-only. Apply installs one exact UTC timer before disabling
the two stopped-runtime timers. No source launch, provider call or budget grant.
"""
from datetime import datetime, timezone
from copy import deepcopy
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-paid-financial-handoff-v1-20261021')
SYSTEMD=Path('/etc/systemd/system')
FORMAT='yunipals-paid-financial-handoff-v1'
RUN_ID='20261021-prod3'
PLAN_SHA='c4d0683cc2fae50579d2a77c70f4e60a009dbd9988954a0fad42abbc2280fb70'
Q_SHA='2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
LIVE_SHA='1c91d4e9c5a8c5c8ba4c737c6b85a99227b67de512458e90f1f2e951b6c8642f'
FINANCIAL_SHA='b57acd4d8bfac91a26dedaddd3f497223c58e58527f0fae83a7ba089ea745e55'
SEAL_SHA='a90b1dbf59cc11fd478130003bc6ef7181c59f55737dc069b7025e63bdbc58fb'
EXECUTOR_REFS_SHA='26916362fddbd08f7e8e383138a85a0a1bae3d70e296c08394376bc61ecb233e'
WORKSPACE=Path('/var/lib/yunipals-unified-shadow/20261020-008028af-a')

def fail(code):raise RuntimeError(code)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def now():return datetime.now(timezone.utc)

def modules():
    path=OPS/'paid-capability-live-v1.py'
    for p in [*path.parents,path]:
        s=p.lstat()
        if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_frozen_loader_required')
    raw=path.read_bytes()
    if len(raw)>300000 or sha(raw)!=Q_SHA:fail('exact_frozen_loader_required')
    q=types.ModuleType('financial_handoff_frozen_loader');q.__file__=str(path);exec(compile(raw,str(path),'exec'),q.__dict__)
    live=q.load(OPS/'paid-productive-live-v6.py',LIVE_SHA,'completed_prod3_reader')
    _,model,epoch,native=live.modules()
    financial=q.load(OPS/'paid-productive-financial-utc-v1.py',FINANCIAL_SHA,'financial_only_original_utc')
    return q,live,model,epoch,native,financial

def pinned(q,path,expected,maximum=2000000):
    raw=q.protected(Path(path),maximum)
    if not q.is_sha(expected)or sha(raw)!=expected:fail('protected_completion_reference_changed')
    return json.loads(raw)

def context(q,live,model):
    directory,_,path=live.paths(RUN_ID);raw=q.protected(path,1000000);value=json.loads(raw)
    if(value.get('format')!=live.FORMAT or value.get('reviewHash')!=sha(encoded(value.get('review')))or
        value['review'].get('operatorSha256')!=LIVE_SHA or value['review']['spec'].get('runId')!=RUN_ID or
        model.digest(value['review']['spec']['plan'])!=PLAN_SHA):fail('exact_actual_prod3_live_context_required')
    model.validate(value['review']['spec']['plan'])
    return value,live.journal_for(q,directory),sha(raw)

def saved_completion(q,live,model,native):
    """Only actual completed ACKs; no native.prepare or source reconstruction."""
    value,journal,vpin=context(q,live,model);plan=value['review']['spec']['plan']
    result=live.finished_controller(q,journal)
    if result.get('cleaned')is not True or result.get('cleanupErrorClass')is not None:fail('actual_completed_prod3_cleanup_required')
    rows=journal.rows()
    for phase in ['sql_ack_promotion','sql_ack_revoke','sql_ack_cleanup','owned_caches_destroyed','productive_epoch_record']:
        if journal.latest(phase)is None:fail('complete_productive_financial_and_cache_ACKs_required')
    if any(journal.latest('sql_ambiguous_'+phase)is not None for phase in ['promotion','revoke','cleanup','utc','boundary']):fail('ambiguous_financial_attempt_requires_manual_reconcile')
    er=journal.latest('productive_epoch_record');estate=pinned(q,er['path'],er['sha256']);state=estate.get('state',{})
    if(estate.get('format')!='yunipals-paid-productive-epoch-v6' or Path(er['path']).name!='cleaned.json' or
        state.get('cleaned')is not True or state.get('enabled')is not True or state.get('review',{}).get('plan')!=plan or
        state['review'].get('runId')!=RUN_ID or state['reviewHash']!=sha(encoded(state['review']))):fail('exact_completed_prod3_epoch_required')
    cache_ack=journal.latest('owned_caches_destroyed');cache=pinned(q,cache_ack['receiptFile'],cache_ack['receiptSha256'])
    if(cache_ack.get('result')!=cache or cache.get('recordFile')!=er['path']or cache.get('recordSha256')!=er['sha256']or
        cache.get('ownedProductiveCachesDestroyed')is not True or cache.get('grantCountersReset')is not False):fail('actual_cache_destruction_ACK_required')
    receipt_file=journal.directory/'current-day-cleanup.json';receipt_raw=q.protected(receipt_file,300000);receipt=json.loads(receipt_raw)
    prepared=journal.latest('current_day_cleanup_prepared')
    if prepared is None or prepared.get('receiptSha256')!=sha(receipt_raw):fail('actual_prepared_current_day_cleanup_receipt_required')
    if(receipt.get('productivePlanSha256')!=PLAN_SHA or receipt.get('ownedPermits')!=plan['permits']or
        receipt.get('nextUtc')!=plan['nextUtc']or receipt.get('counterResetOrRefundAllowed')is not False):fail('exact_acknowledged_original_cleanup_receipt_required')
    nr=journal.latest('productive_native_record');native_record=None
    if nr is not None:
        payload=pinned(q,nr['path'],nr['sha256']);native_record=payload.get('record',{})
        stopped=journal.latest('native_stopped');seal=native_record.get('seal')or{}
        if(payload.get('format')!=native.FORMAT or native_record.get('phase')!='stopped' or Path(nr['path']).name!='stopped.json' or
            native_record.get('binding',{}).get('productivePlanSha256')!=PLAN_SHA or
            native_record['binding'].get('operatorSha256')!=live.NATIVE_SHA or native_record['binding'].get('runId')!=RUN_ID or
            native_record['reviewHash']!=sha(encoded(native_record['binding']))or native_record.get('terminal')!=seal.get('terminal')or
            stopped is None or any(stopped.get('seal',{}).get(k)!=v for k,v in {**seal,'recordFile':nr['path'],'recordSha256':nr['sha256']}.items())or
            seal.get('sourceConnections')!=0 or seal.get('automaticRetryAllowed')is not False):fail('actual_acknowledged_native_terminal_seal_required')
    elif result.get('nativeStarted')is not False:fail('missing_native_terminal_ACK_requires_reconcile')
    refs={'live':{'file':str(live.paths(RUN_ID)[2]),'sha256':vpin},
        'controllerResult':{'file':str(journal.directory/'controller-result.json'),'sha256':sha(q.protected(journal.directory/'controller-result.json'))},
        'journal':{'file':str(journal.directory/'journal.jsonl'),'sha256':sha(q.protected(journal.directory/'journal.jsonl',16000000))},
        'epoch':{'file':er['path'],'sha256':er['sha256']},'cache':{'file':cache_ack['receiptFile'],'sha256':cache_ack['receiptSha256']},
        'currentDayCleanup':{'file':str(receipt_file),'sha256':sha(receipt_raw)}}
    if nr:refs['nativeStopped']={'file':nr['path'],'sha256':nr['sha256']}
    transition=journal.latest('native_proxy_cleanup_transition')
    if nr:
        if transition is None:fail('actual_native_proxy_cleanup_transition_ACK_required')
        pinned(q,transition['receiptFile'],transition['receiptSha256']);refs['nativeCleanupTransition']={'file':transition['receiptFile'],'sha256':transition['receiptSha256']}
    return value,journal,plan,receipt,state,native_record,refs

def terminal(q,live,native,journal,record):
    qe,_,_=q.modules();started=journal.latest('controller_started')
    if started is None:fail('actual_controller_started_and_finished_ACK_required')
    ident=started['identity']
    with live.controller_reference(q,RUN_ID,ident):
        props=q.unit_properties(ident['unit'])
        if(props['ActiveState']not in {'inactive','failed'}or props['MainPID']!='0'or props['InvocationID']not in {'',ident['invocation']}or
            live.controller_definition_proof(q,qe,ident['unit'])!=ident['definition']or
            sha(encoded(live.static_controller_properties(props)))!=ident['staticPropertiesSha256']or
            not live.original_process_gone(ident['process'])):fail('original_controller_not_terminal_or_definition_changed')
    unit=native.unit_name(RUN_ID)
    observed=dict(line.split('=',1)for line in q.run(['/usr/bin/systemctl','show','--all',unit,'--property=LoadState','--property=ActiveState','--property=MainPID','--property=InvocationID']).splitlines())
    if record is None:
        if observed!={'LoadState':'not-found','ActiveState':'inactive','MainPID':'0','InvocationID':''}:fail('unexpected_native_actor_without_ACK')
    else:
        t=record['terminal']
        if(t.get('Id')!=unit or t.get('InvocationID')!=record['invocation']or t.get('MainPID')!='0'or t.get('ActiveState')not in {'inactive','failed'}):fail('saved_native_terminal_witness_required')
        if observed.get('LoadState')!='not-found':
            reference=native.References(unit);reference.acquire()
            try:
                # All saved terminal fields plus immutable transient bytes.
                keys=list(t);current=dict(line.split('=',1)for line in q.run(['/usr/bin/systemctl','show','--all',unit,*['--property='+k for k in keys]]).splitlines())
                if current!=t or sha(q.protected(Path(record['definition']['path']),100000))!=record['definition']['sha256']:fail('saved_native_terminal_identity_changed')
                cg=dict(line.split('=',1)for line in q.run(['/usr/bin/systemctl','show','--all',unit,'--property=Slice','--property=ControlGroup']).splitlines())
                if cg.get('Slice')!='system.slice'or cg.get('ControlGroup')not in {'','/system.slice/'+unit}:fail('saved_native_terminal_cgroup_changed')
            finally:reference.close()
        process=record['process'];path=Path('/proc')/str(process['pid'])/'stat'
        try:raw=path.read_text()
        except FileNotFoundError:raw=None
        if raw is not None:
            tail=raw[raw.rfind(')')+2:].split()
            if len(tail)<20 or not tail[19].isdigit()or int(tail[19])==process['startTicks']:fail('original_native_process_not_proven_gone')
    seal=q.load(OPS/'paid-productive-failed-start-seal-v1.py',SEAL_SHA,'bounded_owned_cgroup_reader')
    return seal.cgroup_empty(Path('/sys/fs/cgroup/system.slice')/unit)

def definitions(plan):
    prefix='yunipals-paid-financial-utc-v1-'+PLAN_SHA[:16];timer=prefix+'.timer';service=prefix+'.service'
    due=datetime.fromisoformat(plan['nextUtc'].replace('Z','+00:00')).strftime('%Y-%m-%d %H:%M:%S.%f UTC')
    timer_text='[Unit]\nDescription=Yunipals original UTC financial closure '+PLAN_SHA+'\n[Timer]\nOnCalendar='+due+'\nAccuracySec=1us\nRandomizedDelaySec=0\nPersistent=true\nUnit='+service+'\n[Install]\nWantedBy=timers.target\n'
    argv='/usr/bin/python3 -B '+str(OPS/'paid-productive-financial-handoff-v1.py')+' --phase utc'
    service_text='[Unit]\nDescription=Yunipals financial-only UTC executor '+PLAN_SHA+'\n[Service]\nType=exec\nUser=root\nGroup=root\nWorkingDirectory='+str(OPS)+'\nExecStart='+argv+'\nRestart=no\nUMask=0077\nRuntimeMaxSec=60\nTimeoutStopSec=15\nKillMode=control-group\nNoNewPrivileges=yes\nAmbientCapabilities=CAP_SETUID CAP_SETGID CAP_KILL\nCapabilityBoundingSet=CAP_SETUID CAP_SETGID CAP_KILL\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nRestrictSUIDSGID=yes\nRestrictAddressFamilies=AF_UNIX\nIPAddressDeny=any\nMemoryMax=268435456\nMemorySwapMax=0\nCPUQuota=50%\nTasksMax=32\nReadWritePaths='+str(BASE)+'\n'
    return {'dueUtc':plan['nextUtc'],'timerUnit':timer,'serviceUnit':service,'argv':argv,'timerText':timer_text,'serviceText':service_text,
        'definitions':{str(SYSTEMD/timer):sha(timer_text.encode()),str(SYSTEMD/service):sha(service_text.encode())}}

def timer_state(q,qe,row,*,executing=False):
    for path,pin in row['definitions'].items():
        if sha(q.protected(Path(path),50000))!=pin:fail('exact_financial_timer_definition_required')
    service=row['serviceUnit'];p=q.unit_properties(service)
    if(p['Id']!=service or p['Type']!='exec'or p['Restart']!='no'or p['User']not in {'','root'}or p['Group']not in {'','root'}or
        p['NoNewPrivileges']!='yes'or p['WorkingDirectory']!=str(OPS)or
        re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])!=[row['argv']]or
        set(p['AmbientCapabilities'].split())!={'cap_setuid','cap_setgid','cap_kill'}or set(p['CapabilityBoundingSet'].split())!={'cap_setuid','cap_setgid','cap_kill'}):fail('exact_financial_executor_sandbox_required')
    if executing:
        if(p['ActiveState'],p['SubState'],p['MainPID'])!=('active','running',str(os.getpid())):fail('exact_financial_executor_lifecycle_required')
    elif p['ActiveState']!='inactive':fail('exact_financial_executor_lifecycle_required')
    q.assert_no_unit_environment(qe,service)
    if(qe.bus_property(service,'org.freedesktop.systemd1.Unit','FragmentPath','s')!=str(SYSTEMD/service)or
        qe.bus_property(service,'org.freedesktop.systemd1.Unit','DropInPaths','as')!=[]or
        qe.bus_property(service,'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=60000000):fail('exact_financial_executor_metadata_required')
    if not executing:
        p=dict(line.split('=',1)for line in q.run(['/usr/bin/systemctl','show','--all',row['timerUnit'],'--property=ActiveState','--property=SubState']).splitlines())
        delta=datetime.fromisoformat(row['dueUtc'].replace('Z','+00:00'))-datetime(1970,1,1,tzinfo=timezone.utc)
        stamp=(delta.days*86400+delta.seconds)*1000000+delta.microseconds
        if(p!={'ActiveState':'active','SubState':'waiting'}or qe.bus_property(row['timerUnit'],'org.freedesktop.systemd1.Timer','NextElapseUSecRealtime','t')!=stamp or
            qe.bus_property(row['timerUnit'],'org.freedesktop.systemd1.Timer','Unit','s')!=service or qe.bus_property(row['timerUnit'],'org.freedesktop.systemd1.Timer','RandomizedDelayUSec','t')!=0 or
            qe.bus_property(row['timerUnit'],'org.freedesktop.systemd1.Timer','AccuracyUSec','t')!=1):fail('exact_original_UTC_timer_not_armed')

def old_pair(q,qe,live,value,*,armed):
    rows=value['review']['timers'];refs=q.load(OPS/'paid-executor-references-v2.py',EXECUTOR_REFS_SHA,'old_prod3_timer_references')
    with refs.references(q,PLAN_SHA,rows,family='productive_v6'):
        for row in rows:
            if any(sha(q.protected(Path(p),50000))!=pin for p,pin in row['definitions'].items()):fail('original_runtime_timer_definition_changed')
            s=q.unit_properties(row['serviceUnit'])
            if s['ActiveState']!='inactive'or s['MainPID']!='0':fail('old_runtime_cleanup_executor_active')
            q.assert_no_unit_environment(qe,row['serviceUnit'])
            state=dict(line.split('=',1)for line in q.run(['/usr/bin/systemctl','show','--all',row['timerUnit'],'--property=ActiveState']).splitlines())
            if state!={'ActiveState':'active'if armed else'inactive'}:fail('old_runtime_timer_state_changed')
            link=SYSTEMD/'timers.target.wants'/row['timerUnit']
            if not armed and os.path.lexists(link):fail('old_runtime_timer_enablement_still_present')
    return rows

def review(q,live,model,epoch,native):
    value,journal,plan,receipt,state,record,refs=saved_completion(q,live,model,native)
    if(model.model().moment(plan['nextUtc'])-now()).total_seconds()<180:fail('handoff_before_original_UTC_required')
    if os.path.lexists(BASE/'intent.json'):fail('one_explicit_timer_handoff_only_no_retry')
    for name in ['timerUnit','serviceUnit']:
        unit=definitions(plan)[name]
        if os.path.lexists(SYSTEMD/unit)or os.path.lexists(SYSTEMD/(unit+'.d'))or os.path.lexists(SYSTEMD/'timers.target.wants'/unit):fail('fresh_financial_timer_selectors_required')
    terminal(q,live,native,journal,record);qe,_,om=q.modules();old_pair(q,qe,live,value,armed=True)
    qvalue,_,_,_,_=live.closed_qualification(q,model,value['review']['spec'])
    with live.session_scope(q,model,epoch,value['review']['spec'],qvalue,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
        s.quiet();er=journal.latest('productive_epoch_record');e.restore_record(er['path'],er['sha256'])
        caches=e.cleanup(json.loads(q.protected(journal.directory/'revoked.json')))
        if caches!=json.loads(q.protected(Path(refs['cache']['file']))):fail('exact_completed_current_false_cache_proof_required')
        current=q.snapshot(qe,om);q.same_policy(om,current,receipt['policy'],plan['otherAllocationsSha256'])
        # Reuse the exact frozen receipt generator with ONLY the already
        # acknowledged temporary policy restored in a labelled pure template.
        # Real counters are unchanged; this is not a database observation.
        template=deepcopy(current);template['global']['dailyCu']=plan['temporaryPolicy']['globalDailyCu']
        next(r for r in template['allocations']if r['workload']=='unified_source')['dailyCu']=plan['temporaryPolicy']['unifiedSourceDailyCu']
        if model.cleanup_receipt(plan,template)!=receipt:fail('actual_booked_grants_must_match_acknowledged_cleanup_receipt')
        proxy_rows={}
        observer=e.observer()
        for name in ['ethereum','base','polygon','bnb']:
            expected=state['chains'][name]['restoredFalseInvocationId']if name in state['chains']else s.record['review']['otherProxies'][name]['invocation']
            proxy_rows[name]=observer.metadata(s,name,expected)
        role=s.quiet()['role']
    return {'format':FORMAT,'operatorSha256':sha(q.protected(Path(__file__).absolute(),200000)),'productivePlanSha256':PLAN_SHA,
        'completion':refs,'migrationBookedCu':receipt['migrationBookedGrantsCu'],'policy':receipt['policy'],'sourceRole':role,
        'proxies':proxy_rows,'timer':definitions(plan),'oldTimers':value['review']['timers'],'newPaidAuthority':False,'automaticRetryAllowed':False},plan,receipt

def write_unit(q,path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
    with os.fdopen(fd,'wb')as out:os.fchmod(out.fileno(),0o644);out.write(raw);out.flush();os.fsync(out.fileno())
    q.sync_directory(path.parent)

def timer_link(row):
    path=SYSTEMD/'timers.target.wants'/row['timerUnit'];s=path.lstat()
    if not stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or path.resolve(strict=True)!=SYSTEMD/row['timerUnit']:
        fail('exact_owned_financial_timer_enablement_link_required')

def apply(q,live,model,epoch,native,reviewed,plan,receipt,expected):
    value,journal,_=context(q,live,model);qvalue,_,_,_,_=live.closed_qualification(q,model,value['review']['spec'])
    with live.session_scope(q,model,epoch,value['review']['spec'],qvalue,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
        s.quiet();er=journal.latest('productive_epoch_record');e.restore_record(er['path'],er['sha256'])
        caches=e.cleanup(json.loads(q.protected(journal.directory/'revoked.json')))
        if caches!=json.loads(q.protected(Path(reviewed['completion']['cache']['file']))):fail('held_handoff_false_cache_proof_changed')
        state=live.permits(q,model,plan);live.permit_rows(model,plan,state,disabled=True)
        if state['active']!=0:fail('active_paid_authority_blocks_financial_handoff')
        return apply_locked(q,live,model,reviewed,plan,receipt,expected)

def apply_locked(q,live,model,reviewed,plan,receipt,expected):
    if sha(encoded(reviewed))!=expected:fail('exact_fresh_financial_handoff_review_required')
    if not BASE.exists():BASE.mkdir(mode=0o700);q.sync_directory(BASE.parent)
    s=BASE.lstat()
    if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or stat.S_IMODE(s.st_mode)!=0o700:fail('protected_financial_evidence_root_required')
    if any(BASE.iterdir()):fail('fresh_financial_handoff_evidence_required')
    journal=q.Journal(BASE);q.save(BASE/'review.json',reviewed);q.save(BASE/'intent.json',{'reviewHash':expected,'automaticRetryAllowed':False})
    row=reviewed['timer'];stage='write_new_definitions'
    try:
        for key,name in [('timerText',row['timerUnit']),('serviceText',row['serviceUnit'])]:write_unit(q,SYSTEMD/name,row[key].encode())
        q.run(['/usr/bin/systemctl','daemon-reload']);stage='arm_new_original_UTC_timer'
        q.run(['/usr/bin/systemctl','enable','--now',row['timerUnit']]);timer_link(row);q.sync_directory(SYSTEMD/'timers.target.wants');q.sync_directory(SYSTEMD)
        # Load/ref this exact inactive service on one persistent bus while all
        # typed metadata readers run. No service start or job control from refs.
        with new_reference(q,row):timer_state(q,q.modules()[0],row)
        journal.emit('replacement_UTC_timer_proven',definitionsSha256=sha(encoded(row['definitions'])))
        stage='disable_exact_old_runtime_timers';value,old_journal,_=context(q,live,model);qe,_,_=q.modules()
        old_pair(q,qe,live,value,armed=True)
        for old in reviewed['oldTimers']:q.run(['/usr/bin/systemctl','disable','--now',old['timerUnit']],timeout=15)
        q.sync_directory(SYSTEMD/'timers.target.wants');q.sync_directory(SYSTEMD);old_pair(q,qe,live,value,armed=False)
        result={'format':FORMAT,'reviewHash':expected,'reviewFile':str(BASE/'review.json'),'reviewSha256':expected,
            'originalDueUtc':plan['nextUtc'],'migrationBookedCu':receipt['migrationBookedGrantsCu'],
            'replacementArmedBeforeOldDisable':True,'sourceStarted':False,'paidAuthorityAdded':False,'grantCountersReset':False}
        pin=q.save(BASE/'handoff.json',result);journal.emit('financial_timer_handoff_complete',receiptFile=str(BASE/'handoff.json'),receiptSha256=pin)
        return {'format':FORMAT,'applied':True,'handoffSha256':pin,'sourceStarted':False,'paidAuthorityAdded':False}
    except BaseException as error:
        q.save(BASE/'failed.json',{'stage':stage,'failure':failure(error),'manualReconcileRequired':True});raise

def new_reference(q,row):
    # Same accepted persistent bus implementation, exact new two definition
    # files checked by the local override; no generic accepted unit selector.
    parent=q.load(OPS/'paid-productive-handoff-continue-v1.py','b9d018d495f70922ac8c63cff9b5b7c3e63c47f961640fee2ed80fc09822ea83','financial_executor_metadata_reference')
    import ctypes
    class One(parent.OldExecutorReferences):
        def __init__(self):
            self.q=q;self.rows=[row];self.sha=PLAN_SHA;self.units=[row['serviceUnit']];self.held=[];self.bus=ctypes.c_void_p();self.lib=None;self.started=None
            self.seal=q.sha(q.encoded(self.rows));self.check_files()
        def check_metadata(self):
            self.check_files()
            qe,_,_=q.modules();unit=row['serviceUnit']
            if(qe.bus_property(unit,'org.freedesktop.systemd1.Unit','FragmentPath','s')!=str(SYSTEMD/unit)or
                qe.bus_property(unit,'org.freedesktop.systemd1.Unit','DropInPaths','as')!=[]):fail('exact_financial_metadata_reference_required')
    return One()

def validate_handoff(q,live,model,native):
    if os.path.lexists(BASE/'failed.json'):fail('failed_timer_handoff_requires_manual_reconcile')
    receipt=json.loads(q.protected(BASE/'handoff.json',300000));reviewed=pinned(q,receipt['reviewFile'],receipt['reviewSha256'],500000)
    if(receipt.get('format')!=FORMAT or receipt.get('reviewHash')!=sha(encoded(reviewed))or reviewed.get('format')!=FORMAT or
        reviewed.get('operatorSha256')!=sha(q.protected(Path(__file__).absolute(),200000))or reviewed.get('productivePlanSha256')!=PLAN_SHA or
        receipt.get('replacementArmedBeforeOldDisable')is not True or receipt.get('grantCountersReset')is not False):fail('actual_financial_timer_handoff_receipt_required')
    journal=q.Journal(BASE);ack=journal.latest('financial_timer_handoff_complete')
    if ack is None or ack.get('receiptSha256')!=sha(q.protected(BASE/'handoff.json')):fail('durable_financial_timer_handoff_ACK_required')
    for ref in reviewed['completion'].values():pinned(q,ref['file'],ref['sha256'],16000000)
    value,_,plan,cleanup,_,_,refs=saved_completion(q,live,model,native)
    if refs!=reviewed['completion']or definitions(plan)!=reviewed['timer']:fail('immutable_completed_prod3_lineage_changed')
    old_pair(q,q.modules()[0],live,value,armed=False)
    return receipt,reviewed,plan,cleanup

def utc(q,live,model,native,financial):
    receipt,reviewed,plan,cleanup=validate_handoff(q,live,model,native)
    if now()<model.model().moment(plan['nextUtc']):fail('original_UTC_boundary_not_reached')
    qe,_,om=q.modules();timer_state(q,qe,reviewed['timer'],executing=True);q.actual_root_capabilities();journal=q.Journal(BASE)
    with q.mutex(BASE/'financial.lock',seconds=12):
        current=q.snapshot(qe,om)
        if journal.latest('sql_ack_utc')is not None:
            q.same_policy(om,current,plan['originalPolicy'],plan['otherAllocationsSha256']);return {'format':FORMAT,'originalPolicyRestored':True,'alreadyAcknowledged':True}
        if journal.latest('sql_intent_utc')is not None:fail('uncertain_financial_UTC_attempt_manual_reconcile')
        text=financial.owner_sql(plan,current,cleanup);q.save(BASE/'owner-utc.sql.json',{'sql':text,'sha256':sha(text.encode())})
        journal.emit('sql_intent_utc',sqlSha256=sha(text.encode()),cleanupReceiptSha256=sha(encoded(cleanup)))
        expected={'productivePlanSha256':PLAN_SHA,'phase':'utc','applied':True,'grantCountersReset':False}
        try:
            rows=[json.loads(line)for line in q.peer(text,write=True).splitlines()if line.strip()]
            if rows!=[expected]:fail('financial_UTC_commit_ACK_mismatch')
        except BaseException:
            journal.emit('sql_ambiguous_utc',manualReconcileRequired=True);raise
        journal.emit('sql_ack_utc',receipt=expected)
        return {'format':FORMAT,'originalPolicyRestored':True,'grantCountersReset':False,'paidAuthorityAdded':False}

def failure(error):
    trace=error.__traceback__;frames=[];labels=set()
    while trace:
        code=trace.tb_frame.f_code;path=Path(code.co_filename)
        if path.absolute()==Path(__file__).absolute():
            frames.append({'file':path.name,'function':code.co_name,'line':trace.tb_lineno})
            if error.args and isinstance(error.args[0],str)and error.args[0]in code.co_consts:labels.add(error.args[0])
        trace=trace.tb_next
    return {'errorClass':type(error).__name__,'fixedCodeLabels':sorted(labels),'publicFrames':frames[-12:],'rawMessageExported':False}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--apply');p.add_argument('--phase',choices=['review','utc'],default='review');a=p.parse_args()
    os.umask(0o077);q,live,model,epoch,native,financial=modules()
    if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('fixed_production_root_required')
    q.actual_root_capabilities()
    def stop(*_):raise InterruptedError('bounded_financial_handoff_interrupted')
    for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGALRM]:signal.signal(sig,stop)
    signal.alarm(120 if a.phase=='review'else 45)
    try:
        if a.phase=='utc':result=utc(q,live,model,native,financial)
        else:
            reviewed,plan,receipt=review(q,live,model,epoch,native)
            result=apply(q,live,model,epoch,native,reviewed,plan,receipt,a.apply)if a.apply else {'format':FORMAT,'reviewHash':sha(encoded(reviewed)),'applied':False,'migrationBookedCu':receipt['migrationBookedGrantsCu'],'originalDueUtc':plan['nextUtc']}
        print(json.dumps(result,sort_keys=True))
    finally:signal.alarm(0)

if __name__=='__main__':
    try:main()
    except BaseException as error:print(json.dumps({'format':FORMAT,'completed':False,'failure':failure(error),'automaticRetryAllowed':False},sort_keys=True));raise SystemExit(1)
