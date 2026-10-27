#!/usr/bin/env python3
"""Current-actor admission rehearsal; default read-only, no COMMIT mode."""
import argparse, json, os, signal, socket
from pathlib import Path
import hashlib, stat, types
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
CONTEXT=OPS/'arena-ypal-native-v2.context.py'
CONTEXT_SHA='b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd'
FORMAT='yunipals-arena-ypal-admission-rehearsal-v2'

def api():
    for p in [*CONTEXT.parents,CONTEXT]:
        s=p.lstat()
        if s.st_uid!=0 or stat.S_ISLNK(s.st_mode)or s.st_mode&0o022:raise RuntimeError('protected_explicit_actor_context_required')
    raw=CONTEXT.read_bytes()
    if len(raw)>200000 or hashlib.sha256(raw).hexdigest()!=CONTEXT_SHA:raise RuntimeError('exact_explicit_actor_context_required')
    m=types.ModuleType('arena_current_actor_context');m.__file__=str(CONTEXT);exec(compile(raw,str(CONTEXT),'exec'),m.__dict__)
    return m.Context()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--rehearse');a=p.parse_args();h=api()
    h.need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main'and Path(__file__)==OPS/'arena-ypal-native-v2.rehearsal.py','fixed_current_actor_rehearsal_host_required')
    os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:(_ for _ in()).throw(TimeoutError()));signal.alarm(180)
    proposal,sqls,roles,before,binding=h.inspect()
    if a.rehearse:result=h.rehearse(proposal,sqls,roles,before,binding,a.rehearse)
    else:result={'format':FORMAT,'status':'readonly_review_passed','reviewHash':h.sha(h.encoded(binding)),'binding':binding,'roleChanges':0,'serviceJobs':0,'privateFileWrites':0,'providerCalls':0,'oldWholeInvocationGatePassed':False}
    print(json.dumps(result,sort_keys=True))
if __name__=='__main__':
    try:main()
    except BaseException as e:
        print(json.dumps({'format':FORMAT,'status':'failed','errorClass':type(e).__name__,'rawMessagesExported':False,'automaticRetryAllowed':False},sort_keys=True));raise SystemExit(1)
