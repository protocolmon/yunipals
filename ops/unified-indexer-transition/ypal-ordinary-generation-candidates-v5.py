#!/usr/bin/env python3
"""Fresh V5 generation/cache selectors; no worker, grants or database writes."""
import hashlib
import json
import os
from pathlib import Path
import re
import types

FORMAT='yunipals-ypal-ordinary-generation-candidates-v5'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-generation-candidates-v5.py'
COMMON=OPS/'ypal-ordinary-consumer-handover-v5.py'
COMMON_SHA='dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c'
TEMPLATE=OPS/'ypal-generation-cache-candidates-v1.py'
TEMPLATE_SHA='3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3'
BASE=Path('/var/backups/yunipals-ypal-ordinary-generation-candidates-v5-20261025')


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def common():
    import stat
    for p in [*COMMON.parents,COMMON]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_V5_generation_common_required')
    raw=COMMON.read_bytes();need(len(raw)<100000 and sha(raw)==COMMON_SHA,'exact_V5_generation_common_required')
    n=types.ModuleType('ordinary_generation_common');n.__file__=str(COMMON);exec(compile(raw,str(COMMON),'exec'),n.__dict__);return n


def namespace(input_sha):
    c=common();config=c.candidate_context(input_sha);meta=c.candidate_namespace(config);factory=c.module(c.FACTORY,c.FACTORY_SHA)
    def forbidden(*_):raise RuntimeError('historical_generation_candidate_source_constructor_forbidden')
    n=factory.namespace(c.public(TEMPLATE,TEMPLATE_SHA),TEMPLATE_SHA,FILE,{'FORMAT':FORMAT,'BASE':BASE,'META_FILE':COMMON,'META_SHA':COMMON_SHA},
      {'metadata':lambda:meta,'prepare':forbidden,'stage':forbidden,'main':forbidden})
    def prepare(check_absent=True):
        p=c.metadata_primitives(input_sha);s,m=p['s'],p['m'];config=c.candidate_context(input_sha)
        if check_absent:need(not os.path.lexists(BASE),'fresh_V5_generation_selector_directory_required')
        source=c.source_current(config['ordinaryRuntime']);admission=c.module(c.READ,c.READ_SHA)
        graph=admission.validate_catalog_current(config['readConfig']['admissionSha256']);c.authenticate_recorded_read(config['readConfig'])
        prior=s.document(meta.PREVIOUS/'result.json',meta.PREVIOUS_SHA);originals={name:m.protected(meta.PREVIOUS/name)for name in n.FILES}
        need(prior['staged']is True and prior['readSchema']==meta.OLD_READ and all(sha(raw)==prior['files'][name]for name,raw in originals.items()),'actual_original_dormant_generation_selector_bytes_required')
        files=n.render(meta,m,originals);manifest=m.document(m.ROOT/'RELEASE-MANIFEST.json',n.MANIFEST_SHA);rows={r['path']:r for r in manifest['files']};closure=[]
        for name in n.CLOSURE:
            raw=m.protected(m.PROJECT/name);r=rows['apps/yunipals-indexer/'+name]
            need(sha(raw)==r['sha256']and len(raw)==r['bytes'],'exact_retained_generation_cache_installed_source_closure_required')
            closure.append({'path':name,'sha256':sha(raw),'bytes':len(raw)})
        leader=m.snapshot(n.LEADERBOARD)[0];cache=n.cache_snapshot(m);observed=p['h'].query(n.context_sql(meta));facts=n.legacy_facts(observed)
        created=c.module(c.CREATOR,c.CREATOR_SHA).data_current(config['createdReceiptSha256'])
        binding={'format':FORMAT,'operatorSha256':sha(Path(__file__).read_bytes()),'bootId':s.boot(),'candidateInputSha256':input_sha,'input':config,
          'metadataPreparerSha256':COMMON_SHA,'readviewResultSha256':config['createdReceiptSha256'],'readConfig':config['readConfig'],
          'readSchema':meta.READ,'readIdentity':meta.IDENTITY,'sourceRelease':meta.RELEASE,'physicalSchema':meta.PHYSICAL,'sourceBinding':source,
          'catalogSha256':graph['catalogSha256'],'created':created,'previousCandidateReceiptSha256':meta.PREVIOUS_SHA,'originalGenerationWriter':leader,
          'originalCacheWriter':cache,'retainedLegacyFacts':facts,'acceptedSourceManifestSha256':n.MANIFEST_SHA,'officialSourceClosure':closure,
          'files':{name:sha(raw)for name,raw in files.items()},'selectorChanges':{n.LEADERBOARD:5,n.CACHE:4},'privateEnvironmentFilesCopied':False,
          'sourceCodeOrExecutableChanged':False,'existingDatabaseAndPrivateSelectorsPreserved':True}
        need(m.snapshot(n.LEADERBOARD)[0]==leader and n.cache_snapshot(m)==cache and c.source_current(config['ordinaryRuntime'])==source and
             admission.validate_catalog_current(config['readConfig']['admissionSha256'])==graph,'V5_generation_current_source_catalog_or_writers_changed')
        return s,binding,observed,files
    def stage(expected):
        s,binding,_,files=prepare();need(sha(encoded(binding))==expected,'exact_V5_generation_selector_review_required')
        BASE.mkdir(mode=0o700);s.sync(BASE.parent);s.save(BASE/'intent.json',binding)
        for name,raw in files.items():s.save(BASE/name,raw,0o600)
        _,again,_,outputs=prepare(False);need(again==binding and outputs==files and all(s.protected(BASE/name)==raw for name,raw in files.items()),'same_V5_generation_selector_intent_files_and_poststage_fence_required')
        return s.save(BASE/'result.json',{**binding,'staged':True,'selected':False,'generationStarted':False,'cacheStarted':False,'guardTransitionExecuted':False,
             'databaseWrites':0,'servicesChanged':False,'providerRequests':0,'permissionAdmissionAcknowledged':False})
    n.prepare=prepare;n.stage=stage;return n


def main():
    import argparse,socket
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--candidate-input-sha');p.add_argument('--stage');a=p.parse_args()
    if not a.candidate_input_sha:
        need(not a.stage,'actual_V5_generation_candidate_input_required');print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_V5_generation_candidate_host_required');os.umask(0o077)
    n=namespace(a.candidate_input_sha)
    if a.stage:print(json.dumps({'format':FORMAT,'staged':True,'receiptSha256':n.stage(a.stage),'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    _,binding,_,_=n.prepare();print(json.dumps({'format':FORMAT,'reviewHash':sha(encoded(binding)),'staged':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))


if __name__=='__main__':
    import signal
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_V5_generation_candidate_phase_expired'));signal.alarm(240)
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',code)else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
    finally:signal.alarm(0)
