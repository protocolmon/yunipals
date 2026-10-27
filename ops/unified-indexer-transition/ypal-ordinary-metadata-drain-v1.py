#!/usr/bin/env python3
"""Initial V5 metadata drain only; stable authority and fresh session evidence.

Produces the original 9b operation through its real drain body, with a separate
executor intent. It neither fabricates the original CLI review hash nor retries
an effect. Subsequent phases remain with the unchanged V5 metadata owner.
"""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import time
import types

FORMAT='yunipals-ypal-ordinary-metadata-drain-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-ordinary-metadata-drain-v1-20261025')
OWNER=OPS/'ypal-ordinary-metadata-handover-v5.py'
OWNER_SHA='9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f'
COMMON=OPS/'ypal-ordinary-consumer-handover-v5.py'
COMMON_SHA='dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c'
TEMPLATE=OPS/'ypal-restored-metadata-handover-v1.py'
TEMPLATE_SHA='cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3'
INPUT_SHA='bc618a8559a94d4a34d5a6da91c98d2241161f2edd91e540857a5089e5bbe306'
CANDIDATE_SHA='5d6253fafa0654aea433ab5b90674c41a1d099f2140f2205ddec834ba0c5270a'
CANDIDATE_INPUT_SHA='f996c8a7ffe3f4c601d63ae4a2f4ce8b21b4f836e9af2648155e3cc8a92ecbf9'
SESSION_SQL="SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start,'clientAddress',host(client_addr),'clientPort',client_port)ORDER BY pid),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=16388 AND datid=17584"
SESSION_CHURN='metadata_backend_churn_retry_readonly_observation_only'
PEER_FAILURE='bounded_readonly_inventory_command_required'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
def own_sha():return sha(Path(__file__).read_bytes())
def identity(row):return tuple(getattr(row,k)for k in ['st_dev','st_ino','st_size','st_mode','st_uid','st_gid','st_nlink','st_mtime_ns','st_ctime_ns'])


def public(path,digest):
    for item in [*path.parents,path]:
        row=item.lstat();need(row.st_uid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_fixed_metadata_executor_source_required')
    before=path.lstat();raw=path.read_bytes()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and len(raw)<=200000 and sha(raw)==digest and identity(before)==identity(path.lstat()),'same_exact_metadata_executor_source_required')
    return raw


def module(path,digest):
    raw=public(path,digest);n=types.ModuleType(path.stem);n.__file__=str(path)
    exec(compile(raw,str(path),'exec'),n.__dict__);need(public(path,digest)==raw,'metadata_executor_component_changed');return n


class Proxy:
    def __init__(self,original,**overrides):self.original=original;self.__dict__.update(overrides)
    def __getattr__(self,name):return getattr(self.original,name)


def session_capture(host,actor,body,attempts,unit):
    """Only re-observe proved backend churn, never catch/retry effect failures."""
    source=host.refresh();private=host.m.snapshot(unit)[0]
    need(host.actor()==actor,'same_metadata_actor_before_readonly_session_capture')
    until=time.monotonic()+90
    for number in range(1,4):
        need(time.monotonic()<until,'bounded_readonly_metadata_session_capture_expired')
        seen=[];backend_failed=[]
        def query(sql):
            need(sql==SESSION_SQL,'only_fixed_readonly_session_query_allowed')
            rows=host.query(sql);need(type(rows)is list and len(rows)<=64,'bounded_metadata_session_observation_required')
            seen.append(copy.deepcopy(rows));return rows
        observer=host.h.observer
        def fds(pids,uid,gid):
            try:return observer.peer_fds(pids,uid,gid)
            except RuntimeError as error:
                if str(error)==PEER_FAILURE and uid==111 and gid==113 and seen and pids==[row['pid']for row in seen[0]]:
                    backend_failed.append(True)
                raise
        peer=Proxy(observer,peer_fds=fds)
        shadow=Proxy(host,query=query,h=Proxy(host.h,observer=peer))
        try:
            result=body(shadow,actor)
        except RuntimeError as error:
            code=str(error)
            possible=(code==SESSION_CHURN and len(seen)==2 and seen[0]!=seen[1])or(code==PEER_FAILURE and backend_failed)
            if not possible:raise
            after=host.query(SESSION_SQL)
            need(type(after)is list and len(after)<=64 and seen and after!=seen[0],
                 'failed_peer_capture_without_proved_backend_churn_is_not_retryable')
            need(host.actor()==actor and host.m.snapshot(unit)[0]==private and host.refresh()==source,
                 'metadata_actor_private_or_source_READ_changed_during_readonly_churn')
            attempts.append({'attempt':number,'qualified':False,'fixedCode':code,'beforeRows':seen[0],'afterRows':after,'effectsRetried':False})
            need(time.monotonic()<until,'bounded_readonly_metadata_session_capture_expired')
            if number==3:raise RuntimeError('bounded_readonly_metadata_session_churn_exhausted')from None
            continue
        need(host.actor()==actor and host.m.snapshot(unit)[0]==private and host.refresh()==source,
             'metadata_actor_private_or_source_READ_changed_during_session_capture')
        need(time.monotonic()<until,'bounded_readonly_metadata_session_capture_expired')
        attempts.append({'attempt':number,'qualified':True,'rows':seen,'sessions':copy.deepcopy(result),'effectsRetried':False})
        return result
    raise AssertionError('unreachable')


def install_session_observer(n,host,observations):
    original=host.sessions.__func__
    need(SESSION_SQL in original.__code__.co_consts,'exact_published_host_session_body_required')
    def sessions(self,actor):
        rows=[];observations.append(rows)
        return session_capture(self,actor,original,rows,n.UNIT)
    host.sessions=types.MethodType(sessions,host)


def authority(binding,phase,input_sha):
    need(binding['operatorSha256']==OWNER_SHA and binding['candidateSha256']==CANDIDATE_SHA and
         binding['executionContext']['inputSha256']==input_sha==INPUT_SHA and
         type(binding['oldSessions'])is dict and set(binding['oldSessions'])=={'owned','otherPeers'},
         'same_original_V5_metadata_operation_domain_and_actual_inputs_required')
    need(phase['validated']is True and phase['inverseOnly']is False and phase['originalWholeValidatorPassed']is False and
         phase['databaseWrites']==phase['serviceActions']==phase['providerCalls']==0 and
         phase['readAdmissionSha256']==binding['readConfig']['admissionSha256']and
         phase['readPlanSha256']==binding['readConfig']['readPlanSha256']and
         phase['readContextInputSha256']==binding['readConfig']['readContextInputSha256'],
         'same_live_source_and_current_V5_READ_authority_required')
    return {'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':input_sha,
            'originalOwnerSha256':OWNER_SHA,'operationAuthority':{k:copy.deepcopy(v)for k,v in binding.items()if k!='oldSessions'},
            'sourceAndReadAuthority':copy.deepcopy(phase),'sessionObservationsExcludedFromActionDigest':True}


def capture(n,host,input_sha,observations):
    need(not os.path.lexists(n.BASE),'only_initial_uncreated_V5_metadata_operation_allowed')
    phase=host.refresh();binding,db=n.review(host)
    need(host.refresh()==phase,'source_or_READ_changed_during_initial_drain_review')
    value=authority(binding,phase,input_sha)
    return {'format':FORMAT,'authority':value,'reviewHash':sha(encoded(value)),
            'originalFullBinding':binding,'databaseObservation':db,'readonlySessionCaptures':copy.deepcopy(observations),
            'originalFullReviewHash':sha(encoded(binding)),'eligibleCoverage':n.covered(db)}


def fence(n,host,binding,expected):
    need(not os.path.lexists(n.BASE),'initial_metadata_operation_already_exists')
    phase=host.refresh();host.private(binding['oldWriter'])
    need(host.m.snapshot(n.UNIT)[0]==binding['oldWriter']and host.actor()==binding['oldActor']and
         n.link(n.BOOT)==binding['oldBoot']and not os.path.lexists(n.DROP),
         'exact_current_metadata_action_identity_before_first_effect_required')
    need(authority(binding,phase,INPUT_SHA)==expected,'source_or_READ_changed_before_metadata_first_effect')


def drain_body(n,raw):
    """One pre-effect fence; every original filesystem/stop/drain statement stays."""
    need(sha(raw)==TEMPLATE_SHA,'exact_published_metadata_drain_body_required')
    tree=ast.parse(raw);node=copy.deepcopy(next(v for v in tree.body if isinstance(v,ast.FunctionDef)and v.name=='drain'))
    indices=[i for i,v in enumerate(node.body)if isinstance(v,ast.Expr)and isinstance(v.value,ast.Call)and ast.unparse(v.value.func)=='BASE.mkdir']
    need(len(indices)==1,'one_original_first_effect_directory_creation_required')
    node.body.insert(indices[0],ast.parse('initial_action_fence(h,binding)').body[0])
    scope=dict(n.__dict__);scope['initial_action_fence']=lambda h,b:fence(n,h,b,n.executor_authority)
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),str(TEMPLATE),'exec'),scope)
    return scope['drain']


def directory():
    for path in BASE.parents:
        row=path.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==0 and not row.st_mode&0o022,
                             'protected_drain_executor_parent_required')
    if not os.path.lexists(BASE):
        BASE.mkdir(mode=0o700);sync(BASE.parent)
    row=BASE.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700,'owned_private_drain_executor_directory_required')


def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def save(name,value):
    need(re.fullmatch(r'[a-z0-9-]+\.json',name),'fixed_private_executor_record_name_required')
    raw=encoded(value);fd=os.open(BASE/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as out:os.fchmod(out.fileno(),0o600);out.write(raw);out.flush();os.fsync(out.fileno())
    sync(BASE);return sha(raw)


def record(name,digest=None):
    need(re.fullmatch(r'[a-z0-9-]+\.json',name),'fixed_private_executor_record_name_required')
    path=BASE/name;fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'rb')as source:
        row=os.fstat(source.fileno())
        need(stat.S_ISREG(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o600 and row.st_nlink==1 and row.st_size<=4000000,
             'same_private_executor_record_required')
        raw=source.read(4000001)
        need(identity(row)==identity(os.fstat(source.fileno()))==identity(path.lstat())and len(raw)==row.st_size and
             (digest is None or sha(raw)==digest),'same_private_executor_record_required')
    return json.loads(raw)


def intent_current(intent):
    review=intent['review']
    need(intent['format']==FORMAT and intent['operatorSha256']==own_sha()and intent['inputSha256']==INPUT_SHA and
         intent['automaticRetryAllowed']is False and review['format']==FORMAT and review['eligibleCoverage']is True and
         review['reviewHash']==sha(encoded(review['authority']))and
         review['originalFullReviewHash']==sha(encoded(review['originalFullBinding']))and
         review['authority']==authority(review['originalFullBinding'],review['authority']['sourceAndReadAuthority'],INPUT_SHA),
         'same_executor_intent_before_readonly_reconciliation_required')
    return intent


def completed(n,h,intent):
    intent_current(intent)
    binding=intent['review']['originalFullBinding'];op_sha=sha(encoded(binding))
    need(h.s.document(n.BASE/'operation.json',op_sha)==binding,'executor_must_produce_the_exact_fresh_original_operation')
    op=n.operation(h,op_sha);n.drained(h,op)
    drained=h.s.document(n.BASE/'drained.json')
    need(drained['stopped']is True and drained['operationSha256']==op_sha and
         not any((n.BASE/name).exists()for name in ['adopt-intent.json','adopted.json','native-drop-intent.json','selected.json','inverse-intent.json']),
         'only_initial_completed_drain_may_be_acknowledged_by_executor')
    return {'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':INPUT_SHA,'reviewHash':intent['review']['reviewHash'],
            'intentSha256':sha((BASE/'apply-intent.json').read_bytes()),'originalOwnerSha256':OWNER_SHA,
            'operationSha256':op_sha,'drainedReceiptSha256':sha(h.s.protected(n.BASE/'drained.json')),
            'drained':True,'adopted':False,'selected':False,'automaticRetryAllowed':False}


def execute(n,h,review,expected,observations,raw):
    need(review['reviewHash']==expected,'exact_stable_metadata_action_review_required')
    need(review['eligibleCoverage']is True,'actual_native_coverage_required_before_metadata_drain')
    directory();need(not any((BASE/name).exists()for name in ['apply-intent.json','result.json','failed.json']),
                     'one_drain_executor_attempt_only_inspect_unknown_prefix')
    intent={'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':INPUT_SHA,'review':review,'automaticRetryAllowed':False}
    intent_current(intent);save('apply-intent.json',intent);n.executor_authority=review['authority']
    try:
        drain_body(n,raw)(h,review['originalFullBinding'])
        result=completed(n,h,intent);save('result.json',result);return result
    except Exception as error:
        save('failed.json',{'format':FORMAT,'operatorSha256':own_sha(),'intentSha256':sha((BASE/'apply-intent.json').read_bytes()),
            'errorClass':type(error).__name__,'automaticRetryAllowed':False,'readonlySessionCaptures':observations,
            'originalOperationMayExist':os.path.lexists(n.BASE)})
        raise


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input-sha');g=p.add_mutually_exclusive_group();g.add_argument('--apply');g.add_argument('--reconcile')
    a=p.parse_args()
    if a.input_sha is None:
        need(not a.apply and not a.reconcile,'actual_input_required');print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(a.input_sha==INPUT_SHA and os.geteuid()==os.getegid()==0 and os.uname().nodename=='yunipals-main','fixed_actual_metadata_input_and_host_required');os.umask(0o077)
    owner=module(OWNER,OWNER_SHA);ctx=module(COMMON,COMMON_SHA);input_value=ctx.load_input(a.input_sha)
    need(input_value['candidateReceiptSha256']==CANDIDATE_SHA and input_value['candidateInputSha256']==CANDIDATE_INPUT_SHA,'exact_existing_staged_metadata_candidate_required')
    n=owner.namespace(a.input_sha);raw=public(TEMPLATE,TEMPLATE_SHA)
    with n.lock():
        h=owner.cli_context(a.input_sha);observations=[];install_session_observer(n,h,observations)
        if a.reconcile:
            need(os.path.lexists(BASE),'existing_executor_attempt_required_for_reconciliation')
            directory();intent=intent_current(record('apply-intent.json',a.reconcile))
            result=completed(n,h,intent)
            if not (BASE/'result.json').exists():save('result.json',result)
            need(record('result.json')==result,'same_once_executor_ACK_required')
            print(json.dumps(result,sort_keys=True));return
        review=capture(n,h,a.input_sha,observations)
        if a.apply:
            value=execute(n,h,review,a.apply,observations,raw);print(json.dumps(value,sort_keys=True));return
        directory();name='review-'+str(time.time_ns())+'-'+str(os.getpid())+'.json';digest=save(name,review)
        print(json.dumps({'format':FORMAT,'reviewHash':review['reviewHash'],'eligibleCoverage':review['eligibleCoverage'],
            'privateObservationFile':str(BASE/name),'privateObservationSha256':digest,'effects':False,'originalOperationCreated':False},sort_keys=True))


if __name__=='__main__':
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_initial_metadata_drain_expired'));signal.alarm(720)
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[a-z0-9_]+',code)else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
    finally:signal.alarm(0)
