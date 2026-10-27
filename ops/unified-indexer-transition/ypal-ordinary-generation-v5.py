#!/usr/bin/env python3
"""Ordinary V5 one-shot generation; explicit current metadata/source context."""
import ast
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

FORMAT='yunipals-ypal-ordinary-generation-v5'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-generation-v5.py'
BASE=Path('/var/backups/yunipals-ypal-ordinary-generation-v5-20261025')
COMMON=OPS/'ypal-ordinary-consumer-handover-v5.py'
COMMON_SHA='dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c'
METADATA=OPS/'ypal-ordinary-metadata-handover-v5.py'
METADATA_SHA='9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f'
TEMPLATE=OPS/'ypal-restored-generation-v1.py'
TEMPLATE_SHA='48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946'
CANDIDATES=OPS/'ypal-ordinary-generation-candidates-v5.py'
CANDIDATES_SHA='869a37bf324575c569c22fe020cc4ad62e9776429e1e5a137078bf5acaa262ca'
CANDIDATE_BASE=Path('/var/backups/yunipals-ypal-ordinary-generation-candidates-v5-20261025')
MONITOR=OPS/'ypal-ordinary-generation-watch-v5.py'
MONITOR_SHA='376e75c883793905533e58fff3699fbd0a183201f19c5033f35aa2d77fcc7aa9'
UNIT='yunipals-ypal-ordinary-generation-prepare-v5.service'
WORK=Path('/run/yunipals-ypal-ordinary-generation-prepare-v5-20261025')
CANDIDATE_FORMAT='yunipals-ypal-ordinary-generation-candidate-v5'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):return isinstance(value,str)and re.fullmatch('[a-f0-9]{64}',value)and value!='0'*64

def common():
    import stat
    for path in [*COMMON.parents,COMMON]:
        s=path.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_V5_generation_context_required')
    raw=COMMON.read_bytes();need(len(raw)<100000 and sha(raw)==COMMON_SHA,'exact_V5_generation_context_required')
    n=types.ModuleType('V5_generation_context');n.__file__=str(COMMON);exec(compile(raw,str(COMMON),'exec'),n.__dict__);return n


def namespace(metadata_input_sha,candidate_sha):
    need(pin(metadata_input_sha)and pin(candidate_sha),'actual_V5_metadata_input_and_selector_result_required')
    c=common();config=c.load_input(metadata_input_sha);factory=c.module(c.FACTORY,c.FACTORY_SHA)
    metadata_entry=c.module(METADATA,METADATA_SHA);metadata=metadata_entry.namespace(metadata_input_sha)
    candidates=c.module(CANDIDATES,CANDIDATES_SHA).namespace(config['candidateInputSha256'])
    # Explicit producer routing in this NEW namespace. No old module globals or
    # current predicates are patched. Both returned objects are the new owners.
    historical=c.module(TEMPLATE,TEMPLATE_SHA)
    def component(path,digest):
        if path==METADATA:need(digest==METADATA_SHA,'exact_V5_metadata_component_required');return metadata
        if path==CANDIDATES:need(digest==CANDIDATES_SHA,'exact_V5_selector_component_required');return candidates
        return historical.module(path,digest)
    changes={'candidate-format':0,'runtime-directory':0}
    def transform(node):
        if isinstance(node,ast.FunctionDef)and node.name in{'accept_candidate','validate_candidate_database_current'}:
            for item in ast.walk(node):
                if isinstance(item,ast.Constant)and item.value=='yunipals-ypal-restored-generation-candidate-v1':item.value=CANDIDATE_FORMAT;changes['candidate-format']+=1
        if isinstance(node,ast.FunctionDef)and node.name=='unit_bytes':
            for item in ast.walk(node):
                if isinstance(item,ast.Constant)and item.value=='yunipals-ypal-restored-generation-prepare-v1-20261024':item.value=WORK.name;changes['runtime-directory']+=1
        return node
    n=factory.namespace(c.public(TEMPLATE,TEMPLATE_SHA),TEMPLATE_SHA,FILE,{'FORMAT':FORMAT,'BASE':BASE,'META_BASE':c.META_BASE,'META_FILE':METADATA,'META_SHA':METADATA_SHA,
       'CANDIDATES':CANDIDATE_BASE,'CANDIDATE_SHA':candidate_sha,'CANDIDATE_FILE':CANDIDATES,'CANDIDATE_PRODUCER_SHA':CANDIDATES_SHA,
       'MONITOR':MONITOR,'MONITOR_SHA':MONITOR_SHA,'UNIT':UNIT,'WORK':WORK},{'module':component},transform)
    need(changes=={'candidate-format':2,'runtime-directory':1},'exact_V5_generation_candidate_and_runtime_identity_seams_required')
    inherited=n.Host
    class Host(inherited):
        def __init__(self,args):
            super().__init__(args)
            intent=self.s.document(CANDIDATE_BASE/'intent.json');value=self.candidates
            need(value=={**intent,'staged':True,'selected':False,'generationStarted':False,'cacheStarted':False,'guardTransitionExecuted':False,
                      'databaseWrites':0,'servicesChanged':False,'providerRequests':0,'permissionAdmissionAcknowledged':False}and
                 intent['format']==candidates.FORMAT and intent['operatorSha256']==CANDIDATES_SHA and intent['candidateInputSha256']==config['candidateInputSha256']and
                 intent['readConfig']==config['readConfig']and intent['readIdentity']==c.READ_IDENTITY and intent['readSchema']==c.READ_SCHEMA and
                 intent['selectorChanges']=={n.LEADER:5,'yunipals-read-cache.service':4}and set(intent['files'])==set(candidates.FILES),
                 'actual_V5_generation_selector_exclusive_intent_result_and_scope_required')
    n.Host=Host
    return n


def validate_candidate_database_current(candidate_sha):
    c=common();i=c.intake();value=i.document(BASE/'candidate-result.json',candidate_sha)
    need(value['format']==CANDIDATE_FORMAT and value['operatorSha256']==sha(Path(__file__).read_bytes()),'actual_ordinary_V5_generation_candidate_required')
    return namespace(value['metadataInputSha256'],value['candidateSelectorsSha256']).validate_candidate_database_current(candidate_sha)


def main():
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'generationStarted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    args=list(sys.argv[1:]);need('--metadata-input-sha'in args and '--selector-candidate-sha'in args,'actual_V5_generation_execution_refs_required')
    index=args.index('--selector-candidate-sha');need(index+1<len(args),'actual_V5_selector_receipt_required');candidate_sha=args[index+1];del args[index:index+2]
    index=args.index('--metadata-input-sha');need(index+1<len(args),'actual_V5_metadata_execution_input_required');metadata_input=args[index+1]
    n=namespace(metadata_input,candidate_sha);output=io.StringIO()
    with contextlib.redirect_stdout(output):
        original=sys.argv;sys.argv=[original[0],*args]
        try:n.main()
        finally:sys.argv=original
    value=json.loads(output.getvalue());folder=common().META_INPUT.parent/'generation-observations'
    try:folder.mkdir(mode=0o700)
    except FileExistsError:pass
    s=folder.lstat();need(s.st_uid==s.st_gid==0 and s.st_mode&0o777==0o700 and not folder.is_symlink(),'private_V5_generation_observations_required')
    path=folder/(str(time.time_ns())+'-'+str(os.getpid())+'.json');raw=output.getvalue().encode();fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as file:os.fchmod(file.fileno(),0o600);file.write(raw);file.flush();os.fsync(file.fileno())
    allowed={'format','reviewHash','operationSha256','phase','acknowledged','generationStarted','databaseWrites','serviceActions','providerCalls'}
    result={k:v for k,v in value.items()if k in allowed}
    if isinstance(value.get('result'),str)and pin(value['result']):result['resultSha256']=value['result']
    print(json.dumps({**result,'privateObservationSha256':sha(raw),'rawCatalogExported':False},sort_keys=True))


if __name__=='__main__':
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_V5_generation_owner_phase_expired'));signal.alarm(240)
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',code)else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
    finally:signal.alarm(0)
