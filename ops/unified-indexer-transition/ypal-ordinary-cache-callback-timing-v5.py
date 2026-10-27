#!/usr/bin/env python3
"""Read-only timing of the exact cache prepared callback; never a COMMIT ACK."""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
import types

FORMAT='yunipals-ypal-ordinary-cache-callback-timing-v5'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-ordinary-cache-callback-timing-v5-20261025')
PROVIDER=OPS/'ypal-ordinary-read-cache-v5.py'
PROVIDER_SHA='387c6a16d5f0c203731212d1a54b618919c0413e4235a37a35510cff584d8cc2'
INTAKE=OPS/'ypal-alchemy-ordinary-consumer-context-v1.py'
INTAKE_SHA='5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986'
CACHE=OPS/'ypal-cache-guard-owner-v1.py'
CACHE_SHA='c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return type(v)is str and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64

def protected(path,digest):
    path=Path(path)
    for item in[*path.parents,path]:
        s=item.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_callback_timing_input_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and len(raw)<200000 and sha(raw)==digest and
         all(getattr(before,k)==getattr(after,k)for k in['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns']),
         'exact_callback_timing_input_before_evaluation_required');return raw

def module(path,digest):
    raw=protected(path,digest);value=types.ModuleType(Path(path).stem);value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);return value

def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def directory(capture_id):
    need(type(capture_id)is str and re.fullmatch('[a-z][a-z0-9-]{0,47}',capture_id),'bounded_new_timing_capture_ID_required')
    for folder in[BASE,BASE/'captures']:
        for parent in folder.parents:
            if parent==BASE:continue
            s=parent.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_timing_capture_parent_required')
        try:folder.mkdir(mode=0o700);sync(folder.parent)
        except FileExistsError:pass
        s=folder.lstat();need(stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o700,'private_timing_capture_directory_required')
    target=BASE/'captures'/capture_id;target.mkdir(mode=0o700);sync(target.parent);return target

def save(base,name,value):
    raw=encoded(value);fd=os.open(base/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as out:out.write(raw);out.flush();os.fsync(out.fileno())
    sync(base);return sha(raw)

def callback(raw,namespace,host,before,rehearsal,durable_observation):
    """Unchanged c54 prepared body, with only its final save redirected."""
    need(sha(raw)==CACHE_SHA,'exact_frozen_cache_prepared_callback_required')
    tree=ast.parse(raw);commit=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='commit')
    original=next(n for n in commit.body if isinstance(n,ast.FunctionDef)and n.name=='prepared')
    value=copy.deepcopy(original);changes=0
    for node in ast.walk(value):
        if isinstance(node,ast.Call)and ast.unparse(node)=="save('sql-prepared.json', value)":
            node.func=ast.Name(id='timing_only_durable_observation',ctx=ast.Load());changes+=1
    need(changes==1,'one_final_prepared_save_redirection_only_required')
    scope={**namespace.__dict__,'host':host,'before':before,'rehearsal':rehearsal,'timing_only_durable_observation':durable_observation}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[value],type_ignores=[])),str(Path(__file__).absolute()),'exec'),scope)
    return scope['prepared']

def measured(base,mode,refs,run):
    save(base,'intent.json',{'format':FORMAT,'mode':mode,'actualReferences':refs,'operatorSha256':sha(Path(__file__).read_bytes()),
        'databaseWrites':0,'serviceActions':0,'productionPreparedACKCreated':False})
    began=time.monotonic_ns();error=None;value=None
    try:value=run()
    except Exception as caught:error=caught
    elapsed=time.monotonic_ns()-began
    result={'format':FORMAT,'completed':error is None,'mode':mode,'elapsedNanoseconds':elapsed,'actualReferences':refs,
      'observation':value,'fixedCode':None if error is None else str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else type(error).__name__,
      'retainedIdleTimeoutSeconds':15,'belowIdleTimeoutAtMeasurement':error is None and elapsed<15_000_000_000,
      'productionCOMMITQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,'productionPreparedACKCreated':False}
    digest=save(base,'result.json',result)
    return {'format':FORMAT,'completed':error is None,'resultSha256':digest,'elapsedNanoseconds':elapsed,
       'belowIdleTimeoutAtMeasurement':result['belowIdleTimeoutAtMeasurement'],'productionCOMMITQualified':False,
       'databaseWrites':0,'serviceActions':0,'providerCalls':0,'fixedCode':result['fixedCode']}

def source_timing(base,result_sha,input_sha):
    need(pin(result_sha)and pin(input_sha),'actual_ordinary_source_refs_required')
    intake=module(INTAKE,INTAKE_SHA)
    def run():
        # This is the real intake, including both full current traversals and
        # registration/native reads. Its failures/attempt codes stay private.
        return intake.observe_runtime(result_sha,input_sha)
    return measured(base,'full-source-intake',{'resultSha256':result_sha,'inputSha256':input_sha},run)

def callback_timing(base,input_sha):
    need(pin(input_sha),'actual_completed_metadata_generation_and_cache_input_required')
    provider=module(PROVIDER,PROVIDER_SHA);common=provider.common()
    config=provider.config_checked(common.intake().document(provider.INPUT,input_sha))
    namespace=provider.namespace(config).cache_runtime();host=namespace.Host(config)
    before,rehearsal,_=namespace.stopped(host)
    need(not(namespace.BASE/'sql-intent.json').exists()and not(namespace.BASE/'sql-committed.json').exists(),
         'timing_only_before_first_cache_COMMIT_attempt_required')
    # The actual rehearsal packet is reused only as input to a read-only
    # callback benchmark. This is not an actual open/prepared SQL transaction.
    packet={**copy.deepcopy(rehearsal['sql']),'mode':'apply','planSha256':sha(rehearsal['sql']['resultJson'].encode())}
    saves=[]
    def observed(name,value):
        need(name=='sql-prepared.json'and not saves,'one_timing_only_prepared_observation_required')
        saves.append(save(base,'timing-only-prepared-observation.json',{'format':FORMAT,'syntheticCallbackInput':True,
          'originalLabel':name,'neverProductionPreparedACK':True,'value':value}))
    fn=callback(protected(CACHE,CACHE_SHA),namespace,host,before,rehearsal,observed)
    def run():
        fn(packet)
        return {'sameFrozenPreparedBody':True,'syntheticRehearsalPacketForTimingOnly':True,'productionPreparedACKCreated':False,
                'durableObservationSha256':saves[0],'beforeReviewHash':before['reviewHash'],
                'fullIntakeCallsPerCallback':4,'fullOrdinaryCurrentTraversalsPerCallback':8}
    return measured(base,'prepared-callback-read-only-benchmark',{'cacheInputSha256':input_sha},run)

def main():
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group()
    g.add_argument('--source-timing',nargs=3,metavar=('NEW_ID','ACTUAL_RESULT_SHA','ACTUAL_INPUT_SHA'))
    g.add_argument('--callback-timing',nargs=2,metavar=('NEW_ID','ACTUAL_CACHE_INPUT_SHA'));a=p.parse_args()
    if not(a.source_timing or a.callback_timing):
        print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'productionCOMMITQualified':False}));return
    import socket,signal
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_readonly_timing_host_required')
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_readonly_callback_timing_expired'));signal.alarm(900)
    args=a.source_timing or a.callback_timing;base=directory(args[0])
    result=source_timing(base,*args[1:])if a.source_timing else callback_timing(base,args[1]);print(json.dumps(result,sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',str(error))else type(error).__name__,
                          'databaseWrites':0,'serviceActions':0,'productionCOMMITQualified':False}));raise SystemExit(1)
