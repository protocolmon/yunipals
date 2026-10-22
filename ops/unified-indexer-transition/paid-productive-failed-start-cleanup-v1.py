#!/usr/bin/env python3
"""Explicit failed-prod2 terminal cleanup and original timer duty; no admission."""
import argparse
from contextlib import contextmanager
import hashlib,json,os,re,signal,stat,types
from pathlib import Path
from datetime import datetime,timezone

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
SYSTEMD=Path('/etc/systemd/system')
LIVE_SHA='b7acb834b429f3f9dded7ea97a46207b73aa91b0372421e7bfdd18d5b4eecb1d'
SEAL_SHA='a90b1dbf59cc11fd478130003bc6ef7181c59f55737dc069b7025e63bdbc58fb'
PLAN_SHA='c4d0683cc2fae50579d2a77c70f4e60a009dbd9988954a0fad42abbc2280fb70'
FORMAT='yunipals-paid-failed-start-cleanup-v1'
RUN_ID='20261021-prod2'
DIRECTORY=Path('/var/backups/yunipals-paid-productive-live-v5-20261021')/RUN_ID
BASE=DIRECTORY/'failed-start-cleanup-v1'
SCRIPT=OPS/'paid-productive-failed-start-cleanup-v1.py'
DROPIN='18z-failed-start-cleanup-v1.conf'

def fail(code):raise RuntimeError(code)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def modules():
    path=OPS/'paid-productive-live-v5.py'
    for p in [*path.parents,path]:
        s=p.lstat()
        if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_frozen_live_required')
    raw=path.read_bytes()
    if sha(raw)!=LIVE_SHA:fail('frozen_live_changed')
    live=types.ModuleType('failed_start_original_live');live.__file__=str(path);exec(compile(raw,str(path),'exec'),live.__dict__)
    q,model,epoch,native=live.modules()
    seal=q.load(OPS/'paid-productive-failed-start-seal-v1.py',SEAL_SHA,'actual_failed_start_terminal_seal')
    return live,q,model,epoch,native,seal

def failure(error):
    frames=[];labels=set();tb=error.__traceback__
    allowed={SCRIPT.name,'paid-productive-failed-start-seal-v1.py','paid-productive-live-v5.py','paid-productive-epoch-v5.py','paid-productive-native-v7.py','paid-dependent-transition-v1.py','paid-cleanup-observer-v1.py','paid-capability-live-v1.py','source6-paid-epoch-v1.py'}
    while tb:
        c=tb.tb_frame.f_code;p=Path(c.co_filename)
        if p.name in allowed and(p.parent==OPS or p.name==SCRIPT.name):
            frames.append({'file':p.name,'function':c.co_name,'line':tb.tb_lineno})
            if error.args and isinstance(error.args[0],str)and error.args[0]in c.co_consts:labels.add(error.args[0])
        tb=tb.tb_next
    return {'errorClass':type(error).__name__,'fixedCodeLabels':sorted(labels),'publicFrames':frames[-16:],'errno':error.errno if isinstance(error,OSError)and type(error.errno)is int else None,'rawMessageExported':False}

def context(live,q,model):
    directory,_,file=live.paths(RUN_ID)
    if directory!=DIRECTORY:fail('exact_original_productive_directory_required')
    raw=q.protected(file,1000000);value=json.loads(raw);spec=value['review']['spec'];plan=spec['plan']
    if(value.get('format')!=live.FORMAT or value['reviewHash']!=sha(encoded(value['review']))or value['review']['operatorSha256']!=LIVE_SHA or
        spec['runId']!=RUN_ID or model.digest(plan)!=PLAN_SHA or plan['expires']!='2026-10-21T19:16:25.939473Z'or plan['qualificationBookedCu']!='5000'):
        fail('unchanged_actual_prod2_plan_required')
    journal=live.journal_for(q,DIRECTORY)
    finished=journal.latest('controller_finished');started=journal.latest('controller_started')
    outcome_raw=q.protected(DIRECTORY/'controller-result.json',200000);outcome=json.loads(outcome_raw)
    if(finished is None or started is None or finished.get('outcomeSha256')!=sha(outcome_raw)or finished.get('cleaned')is not False or
        outcome.get('cleaned')is not False or outcome.get('nativeStarted')is not False or outcome.get('failureStage')!='native_launch'or
        outcome.get('errorClass')!='PermissionError'or outcome.get('automaticRetryAllowed')is not False or
        journal.latest('sql_ack_promotion')is None or journal.latest('sql_ack_revoke')is None):fail('exact_finished_failed_start_and_revocation_required')
    unit='yunipals-paid-productive-controller-v5-'+RUN_ID+'.service'
    props=q.unit_properties(unit)
    if props['MainPID']!='0'or props['ActiveState']not in{'inactive','failed'}or props['SubState']not in{'dead','failed'}:fail('original_controller_must_be_terminal')
    qraw=q.protected(Path(value['timerReceiptFile']),150000)
    if sha(qraw)!=value['timerReceiptSha256']:fail('original_timer_receipt_changed')
    return value,journal,sha(raw),sha(outcome_raw)

@contextmanager
def held(live,q,model,epoch,native,seal_module,value,journal):
    spec=value['review']['spec'];qvalue,_,_,_,_=live.closed_qualification(q,model,spec)
    with live.session_scope(q,model,epoch,spec,qvalue,journal,value['timerReceiptFile'],value['timerReceiptSha256'])as(s,e):
        er=journal.latest('productive_epoch_record')
        if er is None:fail('actual_enabled_productive_epoch_ACK_required')
        e.restore_record(er['path'],er['sha256'])
        yield s,e,seal_module.Seal(q,q.modules()[0],native,value,journal,s,e)

def replacement(row):
    argv='/usr/bin/python3 -B '+str(SCRIPT)+' --phase '+row['kind']
    return '[Service]\nExecStart=\nExecStart='+argv+'\n'

def executor_metadata(q,qe,unit,*,with_id=False):
    keys=['FragmentPath','DropInPaths']+(['Id']if with_id else[])
    text=q.run(['/usr/bin/systemctl','show','--all',unit,'--property='+','.join(keys)],timeout=5)
    pairs=[line.split('=',1)for line in text.splitlines()]
    if any(len(row)!=2 for row in pairs)or len(pairs)!=len(dict(pairs)):fail('unique_executor_metadata_required')
    current=dict(pairs)
    if 'DropInPaths'not in current:
        if qe.bus_property(unit,'org.freedesktop.systemd1.Unit','DropInPaths','as')!=[]:fail('typed_empty_executor_dropins_required')
        current['DropInPaths']=''
    if set(current)!=set(keys):fail('complete_executor_metadata_required')
    return current

def pair(q,model,value,*,corrected=False,active_kind=None):
    qe,_,_=q.modules();rows=value['review']['timers']
    refs=q.load(OPS/'paid-executor-references-v1.py','e08f0ac0d2a275e51a8dba743b5c5825b1440ae0e41073aa18cdacff8f9ef6a4','failed_start_timer_metadata_refs')
    result=[]
    original=refs.references(q,PLAN_SHA,rows,family='productive_v5')
    class ExactCleanupReferences(type(original)):
        def check_metadata(self):
            for row in rows:
                unit=row['serviceUnit'];drop=SYSTEMD/(unit+'.d')/DROPIN
                current=executor_metadata(q,qe,unit,with_id=True)
                if current!={'Id':unit,'FragmentPath':str(SYSTEMD/unit),'DropInPaths':str(drop)if corrected else ''}:fail('exact_referenced_cleanup_selector_required')
    with ExactCleanupReferences():
        for row in rows:
            if row['dueUtc']!=value['review']['spec']['plan']['dispatchExpires'if row['kind']=='deadline'else'nextUtc']:fail('original_timer_due_required')
            if any(sha(q.protected(Path(path),50000))!=pin for path,pin in row['definitions'].items()):fail('unchanged_original_timer_fragments_required')
            p=q.unit_properties(row['serviceUnit']);drop=SYSTEMD/(row['serviceUnit']+'.d')/DROPIN
            expected='/usr/bin/python3 -B '+str(SCRIPT)+' --phase '+row['kind']if corrected else '/usr/bin/python3 -B '+str(OPS/'paid-productive-live-v5.py')+' --run-id '+RUN_ID+' --plan-sha256 '+PLAN_SHA+' --phase '+row['kind']
            if(p['LoadState']!='loaded'or p['Type']!='exec'or p['User']not in{'','root'}or p['Group']not in{'','root'}or p['Restart']!='no'or
                p['NoNewPrivileges']!='yes'or p['WorkingDirectory']!=str(OPS)or
                set(p['AmbientCapabilities'].split())!={'cap_setuid','cap_setgid','cap_kill'}or set(p['CapabilityBoundingSet'].split())!={'cap_setuid','cap_setgid','cap_kill'}or
                re.findall(r'argv\[\]=(.*?)\s+;',p['ExecStart'])!=[expected]):fail('exact_cleanup_only_executor_required')
            props=executor_metadata(q,qe,row['serviceUnit'])
            if props!={'FragmentPath':str(SYSTEMD/row['serviceUnit']),'DropInPaths':str(drop)if corrected else''}:fail('only_exact_owned_cleanup_dropin_allowed')
            if corrected:
                if q.protected(drop,10000)!=replacement(row).encode():fail('exact_cleanup_executor_dropin_bytes_required')
            elif os.path.lexists(drop.parent):fail('fresh_cleanup_dropin_directory_required')
            if row['kind']==active_kind:
                if(p['ActiveState'],p['SubState'],p['MainPID'])!=('active','running',str(os.getpid())):fail('exact_actual_cleanup_timer_process_required')
            elif p['MainPID']!='0'or p['ActiveState']not in{'inactive','failed'}:fail('other_cleanup_executor_must_be_terminal')
            q.assert_no_unit_environment(qe,row['serviceUnit'])
            if qe.bus_property(row['serviceUnit'],'org.freedesktop.systemd1.Service','RuntimeMaxUSec','t')!=900000000:fail('unchanged_cleanup_runtime_bound_required')
            for key,wanted in [('Unit',row['serviceUnit']),('RandomizedDelayUSec',0),('AccuracyUSec',1)]:
                actual=qe.bus_property(row['timerUnit'],'org.freedesktop.systemd1.Timer',key,'s'if key=='Unit'else't')
                if actual!=wanted:fail('original_exact_timer_schedule_required')
            # Original OnCalendar bytes remain pinned above. Before due, require
            # the manager's next firing timestamp too; elapsed deadlines are not renewed.
            now=datetime.now(timezone.utc)
            if now<model.model().moment(row['dueUtc']):
                timer=q.run(['/usr/bin/systemctl','show','--all',row['timerUnit'],'--property=Id,LoadState,ActiveState,SubState'])
                if dict(line.split('=',1)for line in timer.splitlines())!={'Id':row['timerUnit'],'LoadState':'loaded','ActiveState':'active','SubState':'waiting'}:fail('original_cleanup_timer_must_remain_armed')
                expected_us=qe.epoch_usec(model.model().moment(row['dueUtc']))
                if qe.bus_property(row['timerUnit'],'org.freedesktop.systemd1.Timer','NextElapseUSecRealtime','t')!=expected_us:fail('original_next_elapse_required')
            result.append({'kind':row['kind'],'serviceUnit':row['serviceUnit'],'timerUnit':row['timerUnit'],'dueUtc':row['dueUtc'],'definitions':row['definitions'],'dropin':str(drop),'dropinSha256':sha(replacement(row).encode())})
    return result

def review(live,q,model,epoch,native,seal_module):
    q.actual_root_capabilities();value,journal,vpin,rpin=context(live,q,model)
    if os.path.lexists(BASE)or os.path.lexists(seal_module.BASE):fail('fresh_manual_failed_cleanup_required_no_retry')
    rows=pair(q,model,value)
    state=live.permits(q,model,value['review']['spec']['plan']);live.permit_rows(model,value['review']['spec']['plan'],state,disabled=True)
    if state['active']!=0:fail('zero_active_paid_authority_required')
    with held(live,q,model,epoch,native,seal_module,value,journal)as(s,e,seal):
        checked=seal.prepare()
        return {'format':FORMAT,'operatorSha256':sha(q.protected(SCRIPT,200000)),'sealOperatorSha256':SEAL_SHA,'originalLiveSha256':vpin,
            'controllerResultSha256':rpin,'originalJournalSha256':sha(q.protected(DIRECTORY/'journal.jsonl',16000000)),
            'productivePlanSha256':PLAN_SHA,'originalExpires':value['review']['spec']['plan']['expires'],'permitStateSha256':sha(encoded(state)),
            'sealReviewHash':checked['reviewHash'],'timers':rows,'automaticRetryAllowed':False,'admissionAllowed':False}

def financial_cleanup(live,q,model,value,journal,*,at_utc):
    spec=value['review']['spec'];plan=spec['plan']
    # Counters are read only AFTER native stopped and caches were destroyed.
    qe,_,om=q.modules()
    with q.mutex(journal.directory/'financial.lock',seconds=12):
        current=q.snapshot(qe,om)
        if journal.latest('sql_intent_promotion')is None:
            if at_utc:return live.inherited_repair_UTC(q,model,spec,current,journal)
            return {'cleaned':True,'neverAdmitted':True}
        if journal.latest('sql_ack_promotion')is None:fail('uncertain_productive_promotion_manual_reconcile')
        if at_utc:
            if journal.latest('sql_ack_utc')or journal.latest('sql_ack_boundary'):
                q.same_policy(om,current,plan['originalPolicy'],plan['otherAllocationsSha256']);return {'cleaned':True,'alreadyRestoredOriginalPolicy':True}
            receipt_file=journal.directory/'current-day-cleanup.json';ack=journal.latest('sql_ack_cleanup')
            if ack is not None:
                raw=q.protected(receipt_file);receipt=json.loads(raw);prepared=journal.latest('current_day_cleanup_prepared')
                if prepared is None or prepared['receiptSha256']!=sha(raw):fail('prepared_cleanup_ack_receipt_mismatch')
                live.execute(q,model,'utc',plan,current,journal,receipt=receipt)
            else:
                if journal.latest('sql_intent_cleanup')is not None or receipt_file.exists():fail('uncertain_cleanup_requires_manual_reconcile')
                prior=q.snapshot(qe,om,day=plan['grantDay']);receipt=model.boundary_receipt(plan,current,prior,om.text_time(live.now()))
                q.save(journal.directory/'boundary-cleanup.json',receipt);live.execute(q,model,'boundary',plan,current,journal,receipt=receipt)
            return {'cleaned':True,'originalPolicyRestored':True}
        if current['grants']['day']!=plan['grantDay']:fail('owned_midnight_requires_UTC_executor')
        if journal.latest('sql_ack_cleanup')is not None:
            receipt=json.loads(q.protected(journal.directory/'current-day-cleanup.json'));q.same_policy(om,current,receipt['policy'],plan['otherAllocationsSha256'])
        else:
            if journal.latest('sql_intent_cleanup')is not None:fail('uncertain_cleanup_manual_reconcile')
            receipt=model.cleanup_receipt(plan,current);h=q.save(journal.directory/'current-day-cleanup.json',receipt);journal.emit('current_day_cleanup_prepared',receiptSha256=h)
            live.execute(q,model,'cleanup',plan,current,journal)
        return {'cleaned':True,'migrationBookedCu':receipt['migrationBookedGrantsCu'],'cleanupCompletedBeforeOriginalExpiry':live.now()<om.moment(plan['expires'])}

def receipt(q):
    if os.path.lexists(BASE/'failed.json'):fail('partial_cleanup_reconciliation_requires_manual_review')
    raw=q.protected(BASE/'receipt.json',200000);value=json.loads(raw)
    if(value.get('format')!=FORMAT or value.get('operatorSha256')!=sha(q.protected(SCRIPT,200000))or value.get('productivePlanSha256')!=PLAN_SHA or
        value.get('admissionAllowed')is not False or value.get('originalExpires')!='2026-10-21T19:16:25.939473Z'):
        fail('exact_acknowledged_cleanup_only_receipt_required')
    return value,sha(raw)

def cleanup(live,q,model,value,journal,s,e,seal,proof):
    # No native.prepare, restore_handle, running adoption, signal or admission.
    terminal=journal.latest('native_failed_start_terminal')
    if terminal is None or terminal.get('receiptFile')!=proof['sealReceiptFile']or terminal.get('receiptSha256')!=proof['sealReceiptSha256']:
        fail('explicit_failed_start_terminal_ACK_required')
    transition=journal.latest('native_failed_start_cleanup_transition')
    kw={}if transition is None else{'cleanup_transition_file':transition['receiptFile'],'cleanup_transition_sha':transition['receiptSha256']}
    seal.validate_saved(proof['sealReceiptFile'],proof['sealReceiptSha256'],**kw)
    revoked=live.revoke(q,model,value['review']['spec']['plan'],journal)
    was_cleaned=e.record.get('cleaned')is True
    if was_cleaned and transition is None:fail('cleaned_failed_start_requires_saved_transition_manual_reconcile')
    caches=e.cleanup(revoked)
    live.retain_cleanup_proofs(q,journal,e,caches,was_cleaned=was_cleaned,runner=None,has_native=False)
    if transition is None:
        ack=journal.latest('owned_caches_destroyed')
        body=seal.bind_cleanup(proof['sealReceiptFile'],proof['sealReceiptSha256'],ack['receiptFile'],ack['receiptSha256'])
        file=DIRECTORY/('failed-native-cleanup-'+str(len(journal.rows()))+'.json');pin=q.save(file,body)
        journal.emit('native_failed_start_cleanup_transition',receiptFile=str(file),receiptSha256=pin)
        kw={'cleanup_transition_file':str(file),'cleanup_transition_sha':pin}
    seal.validate_saved(proof['sealReceiptFile'],proof['sealReceiptSha256'],**kw)
    journal.emit('failed_native_terminal_and_caches_verified',nativeRunningAcknowledged=False,failedStartReceiptSha256=proof['sealReceiptSha256'])
    return caches

def reconcile(live,q,model,epoch,native,seal_module,expected):
    checked=review(live,q,model,epoch,native,seal_module)
    if sha(encoded(checked))!=expected:fail('exact_fresh_failed_cleanup_review_required')
    BASE.mkdir(mode=0o700);q.sync_directory(BASE.parent);q.save(BASE/'review.json',checked)
    value,journal,_,_=context(live,q,model);stage='seal'
    try:
        with q.mutex(DIRECTORY/'cleanup.lock',seconds=0):
            with held(live,q,model,epoch,native,seal_module,value,journal)as(s,e,seal):
                stored=seal.store(checked['sealReviewHash'])
                proof={'format':FORMAT,'operatorSha256':checked['operatorSha256'],'productivePlanSha256':PLAN_SHA,
                    'originalExpires':checked['originalExpires'],'parentReviewHash':expected,'originalLiveSha256':checked['originalLiveSha256'],
                    'sealReceiptFile':stored['receiptFile'],'sealReceiptSha256':stored['receiptSha256'],'timers':checked['timers'],
                    'admissionAllowed':False,'automaticRetryAllowed':False}
                q.save(BASE/'prepared-receipt.json',proof)
                stage='timer_selector_handoff';journal.emit('failed_start_cleanup_timer_handoff_intent',reviewHash=expected)
                for row in value['review']['timers']:
                    path=SYSTEMD/(row['serviceUnit']+'.d');path.mkdir(mode=0o755)
                    fd=os.open(path/DROPIN,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
                    with os.fdopen(fd,'wb')as out:
                        os.fchmod(out.fileno(),0o644);out.write(replacement(row).encode());out.flush();os.fsync(out.fileno())
                    q.sync_directory(path)
                q.sync_directory(SYSTEMD);q.run(['/usr/bin/systemctl','daemon-reload'],timeout=15)
                pair(q,model,value,corrected=True)
                pin=q.save(BASE/'receipt.json',proof)
                journal.emit('failed_start_cleanup_timer_handoff_ack',receiptFile=str(BASE/'receipt.json'),receiptSha256=pin)
                stage='owned_proxy_cleanup';cleanup(live,q,model,value,journal,s,e,seal,proof)
                stage='financial_cleanup';result=financial_cleanup(live,q,model,value,journal,at_utc=False)
                result.update({'format':FORMAT,'failedStartReconciled':True,'nativeRunningAcknowledged':False,'automaticRetryAllowed':False})
                q.save(BASE/'result.json',result);journal.emit('failed_start_cleanup_completed',resultSha256=sha(encoded(result)),cleaned=result['cleaned'])
                return result
    except BaseException as error:
        q.save(BASE/'failed.json',{'format':FORMAT,'stage':stage,'failure':failure(error),'manualReconcileRequired':True,'automaticRetryAllowed':False})
        raise

def timer_executor(live,q,model,epoch,native,seal_module,kind):
    if kind not in{'deadline','utc'}:fail('only_cleanup_timer_phases_allowed')
    q.actual_root_capabilities();value,journal,vpin,_=context(live,q,model)
    proof,pin=receipt(q)
    ack=journal.latest('failed_start_cleanup_timer_handoff_ack')
    if ack is None or ack.get('receiptFile')!=str(BASE/'receipt.json')or ack.get('receiptSha256')!=pin or proof['originalLiveSha256']!=vpin:fail('exact_durable_cleanup_selector_handoff_required')
    pair(q,model,value,corrected=True,active_kind=kind)
    plan=value['review']['spec']['plan']
    if live.now()<model.model().moment(plan['dispatchExpires'if kind=='deadline'else'nextUtc']):fail('original_cleanup_due_not_reached')
    with q.mutex(DIRECTORY/'cleanup.lock',seconds=0):
        with held(live,q,model,epoch,native,seal_module,value,journal)as(s,e,seal):
            cleanup(live,q,model,value,journal,s,e,seal,proof)
            result=financial_cleanup(live,q,model,value,journal,at_utc=kind=='utc')
    q.save(BASE/('timer-'+kind+'-result.json'),result);return result

def main():
    os.umask(0o077);signal.alarm(900)
    a=argparse.ArgumentParser(description=__doc__);a.add_argument('--phase',choices=['review','reconcile','deadline','utc'],default='review');a.add_argument('--apply');args=a.parse_args()
    if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('exact_production_root_host_required')
    live,q,model,epoch,native,seal_module=modules()
    if args.phase=='review':
        checked=review(live,q,model,epoch,native,seal_module);result={'format':FORMAT,'reviewHash':sha(encoded(checked)),'applied':False,'admissionAllowed':False}
    elif args.phase=='reconcile':result=reconcile(live,q,model,epoch,native,seal_module,args.apply)
    else:result=timer_executor(live,q,model,epoch,native,seal_module,args.phase)
    print(json.dumps({k:v for k,v in result.items()if k in{'format','reviewHash','applied','cleaned','failedStartReconciled','nativeRunningAcknowledged','automaticRetryAllowed','admissionAllowed'}},sort_keys=True))

if __name__=='__main__':
    try:main()
    except BaseException as error:
        print(json.dumps({'format':FORMAT,'completed':False,'failure':failure(error),'automaticRetryAllowed':False},sort_keys=True));raise SystemExit(1)
