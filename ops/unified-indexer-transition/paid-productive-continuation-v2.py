#!/usr/bin/env python3
"""One explicit failed-start-prod2-closed continuation; unchanged original plan/allowance."""
import argparse
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import types

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
SYSTEMD=Path('/etc/systemd/system')
TRANSIENT=Path('/run/systemd/transient')
RUN_ID='20261021-prod3'
FORMAT='yunipals-productive-failed-start-continuation-v2'
BASE=OPS/('paid-productive-continuation-v2-'+RUN_ID)
Q_SHA='2d9b95e2e8d13b161f7f50e3218a4822bd0d89cc86575ce9f82b8cddce629a99'
LIVE_SHA='1c91d4e9c5a8c5c8ba4c737c6b85a99227b67de512458e90f1f2e951b6c8642f'
PLAN_SHA='c4d0683cc2fae50579d2a77c70f4e60a009dbd9988954a0fad42abbc2280fb70'


def fail(code):raise RuntimeError(code)
def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':')).encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()


def failure(error):
    frames=[];labels=set();trace=error.__traceback__
    while trace:
        code=trace.tb_frame.f_code;path=Path(code.co_filename)
        if path.absolute()==Path(__file__).absolute():
            frames.append({'file':path.name,'function':code.co_name,'line':trace.tb_lineno})
            if error.args and isinstance(error.args[0],str)and error.args[0]in code.co_consts:labels.add(error.args[0])
        trace=trace.tb_next
    return {'errorClass':type(error).__name__,'fixedCodeLabels':sorted(labels),'publicFrames':frames[-12:],'rawMessageExported':False}


def modules():
    path=OPS/'paid-capability-live-v1.py'
    for p in [*path.parents,path]:
        s=p.lstat()
        if stat.S_ISLNK(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:fail('protected_frozen_loader_required')
    raw=path.read_bytes()
    if len(raw)>300_000 or sha(raw)!=Q_SHA:fail('exact_frozen_loader_required')
    q=types.ModuleType('continuation_frozen_loader');q.__file__=str(path);exec(compile(raw,str(path),'exec'),q.__dict__)
    live=q.load(OPS/'paid-productive-live-v6.py',LIVE_SHA,'explicit_productive_continuation')
    _,model,epoch,native=live.modules()
    return q,model,epoch,native,live


def construction(q,model,epoch,native,live):
    directory,specfile,livefile=live.paths(RUN_ID)
    promotionfile=OPS/('paid-productive-v6-'+RUN_ID+'.promotion.json')
    if any(os.path.lexists(p)for p in [BASE,directory,specfile,livefile,promotionfile]):fail('one_fresh_explicit_continuation_required')
    driver=q.load(OPS/'paid-productive-failed-start-cleanup-v1.py',live.CLEANUP_DRIVER_SHA,'continuation_failed_start_cleanup')
    old=q.load(OPS/'paid-productive-live-v5.py',live.PARENT_LIVE_SHA,'continuation_original_failed_parent')
    value,old_journal,_,_=driver.context(old,q,model);driver.receipt(q)
    original=value['review']['spec'];plan=original['plan'];model.validate(plan)
    if (model.digest(plan)!=PLAN_SHA or plan['expires']!='2026-10-21T19:16:25.939473Z' or
        plan['dispatchExpires']!='2026-10-21T19:14:55.939473Z' or plan['qualificationBookedCu']!='5000' or
        plan['qualificationPermitAuthorityCu']!='1080'):fail('unchanged_original_financial_plan_required')
    if (model.model().moment(plan['dispatchExpires'])-live.now()).total_seconds()<1200:fail('insufficient_original_window_no_renewal')
    old.closed_qualification(q,model,original)
    parent=live.continuation_parent(q,model,plan,live=True)
    spec={**deepcopy(original),'format':'yunipals-paid-productive-live-plan-v6','runId':RUN_ID,'continuationParent':parent}
    promotion=deepcopy(plan['promotion'])
    qe,_,om=q.modules();current=q.snapshot(qe,om);adapter=q.load(OPS/'paid-productive-reactivation-v1.py',live.REACTIVATION_SHA,'continuation_existing_permit_reactivation');adapter.review(plan,parent,current,live.permits(q,model,plan))
    policy=live.policy_identity(model,current,plan)
    # No native.prepare here. It executes once under the actual owned
    # controller, with all historical/current guards, before proxy enable.
    review={'format':FORMAT,'operatorSha256':sha(q.protected(Path(__file__).absolute(),180000)),
        'runId':RUN_ID,'sourceAttempt':'20261021-prod2','parentSha256':sha(encoded(parent)),
        'specSha256':sha(encoded(spec)),'promotionSha256':sha(encoded(promotion)),
        'productivePlanSha256':PLAN_SHA,'currentPolicySha256':sha(encoded(policy)),
        'reactivationHelperSha256':live.REACTIVATION_SHA,'liveHelperSha256':LIVE_SHA,'epochHelperSha256':live.EPOCH_SHA,'nativeHelperSha256':live.NATIVE_SHA,
        'originalExpires':plan['expires'],'dispatchExpires':plan['dispatchExpires'],
        'priorBookedCu':5000,'priorIssuedQualificationAuthorityCu':1080,'newApprovalWindow':False,
        'automaticRetryAllowed':False,'nativeVerificationPerformedByOwnedControllerOnly':True}
    return review,spec,promotion


def unused(q,unit,*,defined=False):
    if (not defined and os.path.lexists(SYSTEMD/unit)or
        os.path.lexists(SYSTEMD/(unit+'.d'))or os.path.lexists(TRANSIENT/unit)):
        fail('fresh_controller_definition_required')
    state=dict(line.split('=',1)for line in q.run(['/usr/bin/systemctl','show','--all',unit,
        '--property=LoadState','--property=ActiveState','--property=MainPID','--property=InvocationID']).splitlines())
    if (set(state)!={'LoadState','ActiveState','MainPID','InvocationID'}or state['LoadState']!=('loaded'if defined else'not-found')or
        state['ActiveState']!='inactive'or state['MainPID']!='0'or state['InvocationID']!=''):fail('unused_exact_controller_unit_required')


def apply(q,model,epoch,native,live,review,spec,promotion,expected):
    if sha(encoded(review))!=expected:fail('exact_fresh_continuation_review_required')
    directory,specfile,_=live.paths(RUN_ID);unit='yunipals-paid-productive-controller-v6-'+RUN_ID+'.service'
    unused(q,unit);BASE.mkdir(mode=0o700)
    q.sync_directory(BASE.parent);q.save(BASE/'review.json',review)
    q.save(BASE/'start-intent.json',{'format':FORMAT,'reviewHash':expected,'productivePlanSha256':PLAN_SHA,'automaticRetryAllowed':False})
    result={'format':FORMAT,'reviewHash':expected,'completed':False,'controllerStartAttempted':False,
        'controllerStartJobSubmitted':False,'nativeStartClaimed':False,'automaticRetryAllowed':False}
    stage='inert_input_construction'
    try:
        q.save(OPS/('paid-productive-v6-'+RUN_ID+'.promotion.json'),promotion);q.save(specfile,spec)
        q.save(BASE/'construction.json',{'reviewHash':expected,'review':review})
        live.load_spec(q,model,RUN_ID,review['specSha256'])
        stage='new_timer_install_review';prepared=live.prepare(q,model,epoch,native,spec)
        q.save(BASE/'install-review.json',prepared)
        stage='durable_new_timers_then_parent_handoff';live.install(q,model,epoch,native,prepared,sha(encoded(prepared)))
        value=json.loads(q.protected(live.paths(RUN_ID)[2],1_000_000))
        stage='cheap_held_controller_review';selected=live.controller_review(q,model,epoch,native,value,directory)
        q.save(BASE/'controller-review.json',selected);marker=sha(encoded(selected))
        definition=live.controller_definition(model,spec['plan'],RUN_ID,marker)
        if definition['unit']!=unit:fail('exact_first_continuation_controller_required')
        stage='exact_first_controller_definition';unused(q,unit)
        q.save(BASE/'controller-definition.json',definition)
        path=SYSTEMD/unit
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
        with os.fdopen(fd,'wb')as stream:os.fchmod(stream.fileno(),0o644);stream.write(definition['definition'].encode());stream.flush();os.fsync(stream.fileno())
        q.sync_directory(path.parent);q.run(['/usr/bin/systemctl','daemon-reload']);unused(q,unit,defined=True)
        if sha(q.protected(path,50_000))!=definition['definitionSha256']:fail('exact_controller_definition_hash_required')
        stage='single_controller_start';q.save(BASE/'controller-start-intent.json',{'unit':unit,'definitionSha256':definition['definitionSha256'],'controllerReviewHash':marker})
        result['controllerStartAttempted']=True;q.run(['/usr/bin/systemctl','start','--no-block',unit])
        result.update(completed=True,controllerStartJobSubmitted=True,controllerUnit=unit)
    except BaseException as error:
        result.update(failureStage=stage,failure=live.failure(error),manualReconcileRequired=True)
        raise
    finally:q.save(BASE/'result.json',result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply');args=parser.parse_args()
    q,model,epoch,native,live=modules()
    if os.geteuid()!=0 or os.uname().nodename!='yunipals-main':fail('fixed_root_host_required')
    q.actual_root_capabilities()
    def interrupted(*_):raise InterruptedError('bounded_continuation_interrupted')
    for sig in [signal.SIGINT,signal.SIGTERM,signal.SIGALRM]:signal.signal(sig,interrupted)
    signal.alarm(240)
    try:
        review,spec,promotion=construction(q,model,epoch,native,live)
        result=apply(q,model,epoch,native,live,review,spec,promotion,args.apply)if args.apply else {
            'format':FORMAT,'reviewHash':sha(encoded(review)),'applied':False,'productivePlanSha256':PLAN_SHA,
            'originalExpires':review['originalExpires'],'priorBookedCu':5000,'newApprovalWindow':False}
        print(json.dumps(result,sort_keys=True))
    finally:signal.alarm(0)


if __name__=='__main__':
    try:main()
    except BaseException as error:
        # The pinned live helper's public classifier is used if bootstrap got
        # far enough. No arbitrary exception message, traceback or argv prints.
        print(json.dumps({'format':FORMAT,'completed':False,'failure':failure(error),'automaticRetryAllowed':False}))
        raise SystemExit(1)
