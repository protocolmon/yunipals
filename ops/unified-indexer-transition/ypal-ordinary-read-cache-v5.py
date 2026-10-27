#!/usr/bin/env python3
"""Ordinary V5 READ143+71 ancestry and separate cache4 lifecycle/context."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import types

FORMAT='yunipals-ypal-ordinary-read-cache-v5'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-read-cache-v5.py'
BASE=Path('/var/backups/yunipals-ypal-ordinary-read-cache-v5-20261025')
INPUT=Path('/var/backups/yunipals-ypal-ordinary-read-cache-input-v5-20261025/input.json')
COMMON=OPS/'ypal-ordinary-consumer-handover-v5.py'
COMMON_SHA='dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c'
TEMPLATE=OPS/'ypal-restored-read-cache-provider-v1.py'
TEMPLATE_SHA='2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9'
READ=OPS/'ypal-ordinary-read-admission-v5b.py'
READ_SHA='a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3'
METADATA=OPS/'ypal-ordinary-metadata-handover-v5.py'
METADATA_SHA='9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f'
GENERATION=OPS/'ypal-ordinary-generation-v5b.py'
GENERATION_SHA='1ae130895711cd6ec7ddb26a23deb93c62f1bef7c859787b762ce5552a40f512'
CANDIDATES=OPS/'ypal-ordinary-generation-candidates-v5.py'
CANDIDATES_SHA='869a37bf324575c569c22fe020cc4ad62e9776429e1e5a137078bf5acaa262ca'
CANDIDATE_BASE=Path('/var/backups/yunipals-ypal-ordinary-generation-candidates-v5-20261025')
TRANSPORT=OPS/'ypal-ordinary-cache-peer-v5.py'
TRANSPORT_SHA='de96ead72265718132002263c4bceb9ec6530beb5fff2817da68594d53bbccc8'
ENTRY=OPS/'ypal-ordinary-cache-sql-v5.mjs'
ENTRY_SHA='de3d4e597b45781b98c2874c74630effe4787cb35822bb73e8bc1076d11a658f'
DEPENDENCY_PREFLIGHT=OPS/'ypal-ordinary-reader-peer-v5.py'
DEPENDENCY_PREFLIGHT_SHA='ac44d60d89e1a72fea5363b3168006ba72423d50c9bcf89f8013f47f68409e82'
CATALOG=OPS/'ypal-ordinary-read-catalog-v5.sql'
CATALOG_SHA='8362df110cd3b0d70f9e5969b0619d373885c17ec2f5b8f5921517b71678c7dd'
READER=OPS/'ypal-ordinary-reader-cutover-v5.py'
KEYS={'readAdmissionSha256','readPlanSha256','readContextInputSha256','metadataSelectionSha256','metadataProvenanceFile','metadataProvenanceSha256','generationSha256','metadataInputSha256','selectorCandidateSha256'}


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64

def common():
    import stat
    for path in [*COMMON.parents,COMMON]:
        s=path.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_ordinary_V5_cache_context_required')
    raw=COMMON.read_bytes();need(len(raw)<100000 and sha(raw)==COMMON_SHA,'exact_ordinary_V5_cache_context_required')
    n=types.ModuleType('ordinary_V5_cache_context');n.__file__=str(COMMON);exec(compile(raw,str(COMMON),'exec'),n.__dict__);return n


def config_checked(config):
    need(type(config)is dict and set(config)==KEYS and all(pin(config[k])for k in KEYS if k!='metadataProvenanceFile')and
         isinstance(config['metadataProvenanceFile'],str)and re.fullmatch(r'provenance-(0|[1-9][0-9]*)-observed.json',config['metadataProvenanceFile'])and
         int(config['metadataProvenanceFile'].split('-')[1])<128,'exact_actual_V5_cache_metadata_generation_and_READ_refs_required')
    return config


def namespace(config,manifest=None,source_guard=None):
    config=config_checked(config);c=common();execution=c.load_input(config['metadataInputSha256'])
    need(execution['readConfig']=={'admissionSha256':config['readAdmissionSha256'],'readPlanSha256':config['readPlanSha256'],'readContextInputSha256':config['readContextInputSha256']},'same_V5_cache_and_metadata_admission_triple_required')
    factory=c.module(c.FACTORY,c.FACTORY_SHA);reader=c.module(READ,READ_SHA).namespace()
    metadata=c.module(METADATA,METADATA_SHA).namespace(config['metadataInputSha256'])
    generation=c.module(GENERATION,GENERATION_SHA).namespace(config['metadataInputSha256'],config['selectorCandidateSha256'])
    candidate=c.module(CANDIDATES,CANDIDATES_SHA).namespace(execution['candidateInputSha256'])
    previous=c.module(TEMPLATE,TEMPLATE_SHA);catalog=c.public(CATALOG,CATALOG_SHA).decode().strip()
    need(catalog==c.module(READ,READ_SHA).enhanced_catalog(c.intake().protected(c.module(READ,READ_SHA).CATALOG,c.module(READ,READ_SHA).CATALOG_SHA).decode().strip()),'exact_V5_admission_catalog_SQL_required')
    def dependency(path,digest):
        if path==METADATA:need(digest==METADATA_SHA,'exact_new_V5_metadata_dependency_required');return metadata
        if path==GENERATION:need(digest==GENERATION_SHA,'exact_new_V5_generation_dependency_required');return generation
        if path==CANDIDATES:need(digest==CANDIDATES_SHA,'exact_new_V5_selector_dependency_required');return candidate
        return reader.module(path,digest)
    def source_current(inverse=False):
        if source_guard is None:return c.source_current(execution['ordinaryRuntime'],inverse)
        value=source_guard(inverse=inverse)
        need(value['validated']is True and value['databaseWrites']==value['serviceActions']==value.get('providerCalls',0)==0 and
             all(value[k]==c.intake().DATA[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId'])and
             (value['currentWriterQualified']is True or(inverse and value['sourceState']=='owned-terminal'and value['currentWriterQualified']is False)),
             'caller_must_supply_actual_phase_qualified_same_native44_writer_or_owned_terminal_proof')
        return value
    def static_read_host(refs):
        class ReadHost(reader.Host):
            def runtime(self):return source_current(False)
        h=ReadHost(refs['readContextInputSha256'],refs['readPlanSha256'],inverse=True)
        h.context=types.SimpleNamespace(module=reader.module,READ_HELPERS=reader.OPS/'ypal-combined-read-admission-v2.py',READ_HELPERS_SHA='c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd')
        receipt,before,rehearsal=reader.admitted(h,refs['readAdmissionSha256'])
        expected=reader.document(reader.PLAN,refs['readPlanSha256'])
        need(expected['contextInputSha256']==refs['readContextInputSha256']and receipt['baselineReadEdgeCount']==143 and receipt['nativeRegrants']==0,'actual_baseline143_plus_equivalent_V5_logical_read_chain_required')
        static=types.SimpleNamespace(inverse_source=lambda:source_current(True),metadata_primitives=lambda:c.metadata_primitives(execution['candidateInputSha256']))
        return reader,static,h,receipt,before,rehearsal
    def initialize(host,refs,cache,inverse_mode=False):
        host.config=config_checked(refs);host.cache=cache;host.inverse_mode=inverse_mode
        r,static,h,receipt,before,rehearsal=static_read_host(refs);host.new_read=r;host.static=static;host.read_host=h
        host.h=types.SimpleNamespace(query=h.h.query,observer=h.h.raw.observer,m=types.SimpleNamespace(run=h.primitives['sdk'].command,protected=h.primitives['sdk'].protected))
        host.read_receipt,host.read_before,host.read_rehearsal=receipt,before,{**rehearsal,'after':rehearsal['after']['read']}
        host.plan=h.plan;host.catalog_sql=catalog;host.m=dependency(cache.RETAINED,cache.RETAINED_SHA);host.m.artifact()
        host.candidate_owner=candidate;host.candidate=r.document(CANDIDATE_BASE/'result.json',refs['selectorCandidateSha256']);intent=r.document(CANDIDATE_BASE/'intent.json')
        need(host.candidate=={**intent,'staged':True,'selected':False,'generationStarted':False,'cacheStarted':False,'guardTransitionExecuted':False,'databaseWrites':0,'servicesChanged':False,'providerRequests':0,'permissionAdmissionAcknowledged':False}and
             intent['format']==candidate.FORMAT and intent['operatorSha256']==CANDIDATES_SHA and intent['candidateInputSha256']==execution['candidateInputSha256']and
             intent['readConfig']==execution['readConfig']and intent['readSchema']==c.READ_SCHEMA and intent['readIdentity']==c.READ_IDENTITY and set(intent['files'])==set(candidate.FILES),
             'actual_V5_generation_cache_candidate_intent_and_exact_scope_required')
        def exact_current(receipt_sha):
            need(receipt_sha==refs['readAdmissionSha256'],'same_actual_V5_READ_ACK_required');return n.current_reads(host,False,inverse=host.inverse_mode)
        host.read=types.SimpleNamespace(SQL=CATALOG,acl_catalog=r.acl_catalog,consumer_frame=h.helpers.consumer_frame,
             reader_catalog=lambda _:n.reader_catalog(host),validate_current=exact_current)
        host.view=types.SimpleNamespace(query=lambda _h,sql:h.query(sql));_,host.reader_sql=n.reader_catalog(host)
        host.s=types.SimpleNamespace(transition_lock=h.primitives['sdk'].lock)
        host.admission_ref={'producerFile':str(READ),'producerSha256':READ_SHA,'resultFile':str(r.BASE/'result.json'),'receiptSha256':refs['readAdmissionSha256'],
             'planSha256':refs['readPlanSha256'],'contextInputSha256':refs['readContextInputSha256']}
        host.metadata_primitives=lambda:{**c.metadata_primitives(execution['candidateInputSha256']),'admission_ref':host.admission_ref,'readConfig':execution['readConfig']}
    def metadata_current(host,generation_value,selection):return metadata.metadata(host,generation_value,selection,lambda:n.refresh(host))
    def transport_function(fn):
        value=previous.transport_function(fn);count=0
        for node in ast.walk(value):
            if isinstance(node,ast.Constant)and node.value=='yunipals_ownership_4e77f52b_v4':node.value=c.READ_SCHEMA;count+=1
        need(count==2,'exact_two_V5_cache_SQL_selector_seams_required');return value
    dependency_authorizer=None
    def qualified_sql_child(cache,host,mode,plan=None,prepared=None,generation=None,plan_json=None):
        nonlocal dependency_authorizer
        if dependency_authorizer is None:dependency_authorizer=c.module(DEPENDENCY_PREFLIGHT,DEPENDENCY_PREFLIGHT_SHA)
        # The historical full installed dependency inventory is independent of
        # reader/source authority. Verify it before this new public child can
        # evaluate pg or official worker dependencies; no module is started.
        dependency_authorizer.dependency_current()
        return previous.qualified_sql_child(cache,host,mode,plan,prepared,generation,plan_json)
    constants={'FORMAT':FORMAT,'BASE':BASE,'INPUT':INPUT,'READ':READ,'READ_SHA':READ_SHA,'METADATA':METADATA,'METADATA_SHA':METADATA_SHA,
       'TRANSPORT':TRANSPORT,'TRANSPORT_SHA':TRANSPORT_SHA,'ENTRY':ENTRY,'ENTRY_SHA':ENTRY_SHA,'GENERATION_OWNER':GENERATION,'GENERATION_SHA':GENERATION_SHA,
       'GENERATION':generation.BASE/'candidate-result.json','GENERATION_FORMAT':generation.CANDIDATE_FORMAT if hasattr(generation,'CANDIDATE_FORMAT')else'yunipals-ypal-ordinary-generation-candidate-v5b'}
    changes={'runtime-constants':0}
    coordinator_sha=None if manifest is None else manifest['files'].get(READER.name)
    if coordinator_sha is not None:need(pin(coordinator_sha)and sha(c.public(READER,coordinator_sha))==coordinator_sha,'actual_fixed_new_reader_producer_before_published_cache_phase_required')
    def transform(node):
        if isinstance(node,ast.FunctionDef)and node.name=='cache_runtime':
            assignment=next(v for v in node.body if isinstance(v,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='changes'for t in v.targets))
            extra={'IDENTITY':repr(c.READ_IDENTITY),'CANDIDATES':'Path('+repr(str(CANDIDATE_BASE))+')','CANDIDATE_SHA':repr(config['selectorCandidateSha256']),
              'CANDIDATE_OWNER_SHA':repr(CANDIDATES_SHA),'COMPONENT':"OPS / 'ypal-ordinary-cache-transition-v5.mjs'",'COMPONENT_SHA':repr('591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2'),'DROP':"Path('/etc/systemd/system/yunipals-read-cache.service.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-ordinary-v5-read-cache.conf')",'COORDINATED_OWNER':'OPS / '+repr(READER.name),'COORDINATED_OWNER_SHA':repr(coordinator_sha)}
            for key,value in extra.items():assignment.value.keys.append(ast.Constant(key));assignment.value.values.append(ast.Constant(value));changes['runtime-constants']+=1
            # The original META path was a literal in the original changes map.
            for key,value in zip(assignment.value.keys,assignment.value.values):
                if isinstance(key,ast.Constant)and key.value=='META':value.value='Path('+repr(str(c.META_BASE))+')'
            appends=[v for v in ast.walk(node)if isinstance(v,ast.Call)and ast.unparse(v.func)=='body.append']
            need(len(appends)==1,'one_original_cache_AST_body_append_required')
            appends[0].args=[ast.Call(func=ast.Name(id='retarget_V5_cache_node',ctx=ast.Load()),args=appends[0].args,keywords=[])]
        return node
    n=factory.namespace(c.public(TEMPLATE,TEMPLATE_SHA),TEMPLATE_SHA,FILE,constants,
      {'read_module':lambda:reader,'dependency':dependency,'config_checked':config_checked,'static_read_host':static_read_host,
       'initialize':initialize,'metadata_current':metadata_current,'transport_function':transport_function,'qualified_sql_child':qualified_sql_child},transform)
    need(changes=={'runtime-constants':9},'exact_new_cache_runtime_identity_and_external_coordinator_seams_required')
    inherited=n.Phase
    class Phase(inherited):
        def metadata_primitives(self):return self.host.metadata_primitives()
    n.Phase=Phase
    def retarget(node):
        if isinstance(node,ast.ClassDef)and node.name=='Host':
            method=next(v for v in node.body if isinstance(v,ast.FunctionDef)and v.name=='prerequisites');count=0
            for value in ast.walk(method):
                if isinstance(value,ast.Constant)and isinstance(value.value,str)and 'yunipals_ownership_4e77f52b_v4'in value.value:
                    count+=value.value.count('yunipals_ownership_4e77f52b_v4');value.value=value.value.replace('yunipals_ownership_4e77f52b_v4',c.READ_SCHEMA)
            need(count==1,'one_V5_metadata_frame_prerequisite_SQL_seam_required')
            for name in ['sessions','sql_session']:
                method=next(v for v in node.body if isinstance(v,ast.FunctionDef)and v.name==name);count=0
                for value in ast.walk(method):
                    if isinstance(value,ast.Constant)and isinstance(value.value,str)and 'client_addr::text'in value.value:
                        count+=value.value.count('client_addr::text');value.value=value.value.replace('client_addr::text','host(client_addr)')
                need(count==1,'one_exact_cache_client_host_SQL_seam_per_mapper_required')
        return node
    n.retarget_V5_cache_node=retarget
    return n


def static_read_host(refs):
    """Immutable/static admission constructor; no current source qualification."""
    c=common();r=c.module(READ,READ_SHA).namespace()
    host=r.Host(refs['readContextInputSha256'],refs['readPlanSha256'],inverse=True)
    host.context=types.SimpleNamespace(module=r.module,READ_HELPERS=r.OPS/'ypal-combined-read-admission-v2.py',READ_HELPERS_SHA='c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd')
    receipt,before,rehearsal=r.admitted(host,refs['readAdmissionSha256'])
    need(receipt['baselineReadEdgeCount']==143 and receipt['nativeRegrants']==0,'actual_143_plus_V5_read_ancestry_required')
    static=types.SimpleNamespace(query_components=c.intake().query_components,sourceActorQualified=False,currentWriterQualified=False)
    return r,static,host,receipt,before,rehearsal


def cache_runtime(config=None,manifest=None,source_guard=None):
    if config is None:
        c=common();raw=INPUT.read_bytes();config=config_checked(c.intake().document(INPUT,sha(raw)))
    return namespace(config,manifest,source_guard).cache_runtime()
def create_phase(inputs,coordinator_manifest,source_guard=None):
    c=common();config=config_checked(c.intake().document(INPUT,inputs['cacheInputsSha256']))
    return namespace(config,coordinator_manifest,source_guard).Phase(inputs,coordinator_manifest)


def main():
    import argparse,contextlib,io,sys
    if len(sys.argv)==1:
        print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    args=sys.argv[1:];need('--inputs-sha'in args and args.index('--inputs-sha')+1<len(args),'actual_V5_cache_input_required')
    c=common();config=config_checked(c.intake().document(INPUT,args[args.index('--inputs-sha')+1]));n=namespace(config);output=io.StringIO()
    with contextlib.redirect_stdout(output):n.main()
    value=json.loads(output.getvalue());folder=INPUT.parent/'observations'
    try:folder.mkdir(mode=0o700)
    except FileExistsError:pass
    s=folder.lstat();need(s.st_uid==s.st_gid==0 and s.st_mode&0o777==0o700 and not folder.is_symlink(),'protected_V5_cache_observations_required')
    import time
    n.read_module().save(folder/(str(time.time_ns())+'-'+str(os.getpid())+'.json'),{'stdout':output.getvalue()})
    print(json.dumps({k:v for k,v in value.items()if k in{'format','reviewHash','prepared','rehearsed','committed','additionalReadDeltaSha256','databaseWrites','serviceActions','providerCalls'}},sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',code)else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
