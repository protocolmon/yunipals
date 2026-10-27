#!/usr/bin/env python3
"""Ordinary metadata owner: exact cf779 lifecycle in a new explicit context."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import sys
import time
import types

FORMAT='yunipals-ypal-ordinary-metadata-handover-v5'
COMMON=Path('/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-consumer-handover-v5.py')
COMMON_SHA='dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c'


def common():
    import stat
    for p in [*COMMON.parents,COMMON]:
        s=p.lstat()
        if s.st_uid!=0 or stat.S_ISLNK(s.st_mode)or s.st_mode&0o022:raise RuntimeError('protected_ordinary_metadata_context_required')
    raw=COMMON.read_bytes()
    if len(raw)>200000 or hashlib.sha256(raw).hexdigest()!=COMMON_SHA:raise RuntimeError('exact_ordinary_metadata_context_required')
    value=types.ModuleType('ordinary_metadata_context');value.__file__=str(COMMON);exec(compile(raw,str(COMMON),'exec'),value.__dict__)
    return value

def namespace(input_sha):
    ctx=common();value=ctx.load_input(input_sha);return ctx.metadata_namespace(value['candidateReceiptSha256'])
def construct_context(*args,input_sha,**kwargs):return namespace(input_sha).construct_context(*args,**kwargs)
def cli_context(input_sha,inverse=False):return common().metadata_context(input_sha,inverse)
def metadata(*args,input_sha,**kwargs):return namespace(input_sha).metadata(*args,**kwargs)
def metadata_inverse_context(*args,input_sha,**kwargs):return namespace(input_sha).metadata_inverse_context(*args,**kwargs)

def main():
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'operationCreated':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    ctx=common();argv=sys.argv[1:];ctx.need('--input-sha'in argv and argv.index('--input-sha')+1<len(argv),'actual_V5_metadata_execution_input_required')
    n=namespace(argv[argv.index('--input-sha')+1]);out=io.StringIO()
    with contextlib.redirect_stdout(out):n.main()
    value=json.loads(out.getvalue())
    # All detailed actor/private/cursor observations stay root-private. The
    # command still exposes the exact original review/operation hashes.
    if value.get('staticOnly'):print(json.dumps(value));return
    folder=ctx.META_INPUT.parent/'observations'
    try:folder.mkdir(mode=0o700)
    except FileExistsError:pass
    s=folder.lstat();ctx.need(s.st_uid==s.st_gid==0 and s.st_mode&0o777==0o700 and not folder.is_symlink(),'private_metadata_observation_directory_required')
    path=folder/('phase-'+str(time.time_ns())+'-'+str(os.getpid())+'.json');raw=out.getvalue().encode()
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as f:os.fchmod(f.fileno(),0o600);f.write(raw);f.flush();os.fsync(f.fileno())
    result={k:v for k,v in value.items()if k in{'format','reviewHash','phase','acknowledged','eligibleCoverage','effects'}}
    if isinstance(value.get('result'),str)and re.fullmatch('[a-f0-9]{64}',value['result']):result['operationOrResultSha256']=value['result']
    result.update(privateObservationFile=str(path),privateObservationSha256=hashlib.sha256(raw).hexdigest())
    print(json.dumps(result,sort_keys=True))


if __name__=='__main__':
    signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(RuntimeError('bounded_ordinary_metadata_phase_deadline')));signal.alarm(720)
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[a-z0-9_]+',code)else type(error).__name__,
         'automaticRetryAllowed':False}));raise SystemExit(1)
    finally:signal.alarm(0)
