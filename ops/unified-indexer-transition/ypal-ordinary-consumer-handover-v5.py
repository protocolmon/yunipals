#!/usr/bin/env python3
"""Explicit ordinary source/READ context for unchanged native consumer bodies.

Construction binds real input refs. New phase namespaces retain historical
business code; an initial writer receipt is never a current managed epoch.
"""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import types

FORMAT='yunipals-ypal-ordinary-consumer-handover-v5'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-consumer-handover-v5.py'
INTAKE=OPS/'ypal-alchemy-ordinary-consumer-context-v1.py'
INTAKE_SHA='5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986'
FACTORY=OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA='0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
READ=OPS/'ypal-ordinary-read-admission-v5b.py'
READ_SHA='a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3'
READ_RESULT=Path('/var/backups/yunipals-ypal-ordinary-read-admission-v5b-20261025/result.json')
STATIC=OPS/'ypal-restored-metadata-context-v1.py'
STATIC_SHA='fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4'
RUNTIME=OPS/'ypal-alchemy-ordinary-runtime-v1.py'
RUNTIME_SHA='3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5'
METADATA=OPS/'ypal-ordinary-metadata-handover-v5.py'
META_FORMAT='yunipals-ypal-ordinary-metadata-handover-v5'
META_BASE=Path('/var/backups/yunipals-ypal-ordinary-metadata-handover-v5-20261025')
META_INPUT=Path('/var/backups/yunipals-ypal-ordinary-metadata-input-v5-20261025/input.json')
META_SOURCES=OPS/'ypal-ordinary-metadata-handover-v5.sources.json'
META_TEMPLATE=OPS/'ypal-restored-metadata-handover-v1.py'
META_TEMPLATE_SHA='cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64

def public(path,expected):
    import stat
    path=Path(path)
    for p in [*path.parents,path]:
        s=p.lstat();need(s.st_uid==0 and not stat.S_ISLNK(s.st_mode)and not s.st_mode&0o022,'protected_ordinary_consumer_source_required')
    before=path.lstat();raw=path.read_bytes();identity=lambda s:tuple(getattr(s,k)for k in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and len(raw)<=200000 and sha(raw)==expected and identity(before)==identity(path.lstat()),
         'exact_ordinary_consumer_source_before_evaluation_required');return raw

def module(path,expected):
    raw=public(path,expected);value=types.ModuleType('ordinary_consumer_'+Path(path).stem);value.__file__=str(path)
    exec(compile(raw,str(path),'exec'),value.__dict__);need(public(path,expected)==raw,'ordinary_consumer_source_changed_during_evaluation');return value

def intake():return module(INTAKE,INTAKE_SHA)
def source_refs(value):
    need(type(value)is dict and set(value)=={'resultSha256','inputSha256'}and all(pin(v)for v in value.values()),'actual_two_ordinary_source_refs_required');return value

def read_config(value):
    need(type(value)is dict and set(value)=={'admissionSha256','readPlanSha256','readContextInputSha256'}and all(pin(v)for v in value.values()),'actual_three_current_READ_refs_required');return value

def metadata_input(value):
    need(type(value)is dict and set(value)=={'format','sourcesSha256','readConfig','ordinaryRuntime','candidateInputSha256','candidateReceiptSha256'}and value['format']==META_FORMAT+'-input'and pin(value['sourcesSha256']),
         'exact_ordinary_metadata_execution_input_required')
    read_config(value['readConfig']);source_refs(value['ordinaryRuntime']);need(pin(value['candidateInputSha256'])and pin(value['candidateReceiptSha256']),'actual_V5_candidate_refs_required');return value

def sources(value):
    need(type(value)is dict and set(value)=={'format','provider','readAdmission'}and value['format']==META_FORMAT+'-sources'and
         value['provider']=={'file':FILE.name,'sha256':sha(Path(__file__).read_bytes())}and
         value['readAdmission']=={'file':READ.name,'sha256':READ_SHA},'exact_ordinary_metadata_provider_and_READ_sources_required');return value

def load_input(input_sha):
    need(pin(input_sha),'actual_ordinary_metadata_input_SHA_required');i=intake();value=metadata_input(i.document(META_INPUT,input_sha))
    sources(i.document(META_SOURCES,value['sourcesSha256']));candidate=candidate_context(value['candidateInputSha256'])
    need(candidate['readConfig']==value['readConfig']and candidate['ordinaryRuntime']==value['ordinaryRuntime'],'same_initial_V5_candidate_and_metadata_input_refs_required');return value


def admission_reference(config):
    read_config(config)
    return {'producerFile':str(READ),'producerSha256':READ_SHA,'resultFile':str(READ_RESULT),
      'receiptSha256':config['admissionSha256'],'planSha256':config['readPlanSha256'],'contextInputSha256':config['readContextInputSha256']}


def authenticate_recorded_read(config):
    value=module(READ,READ_SHA).acknowledgement(config['admissionSha256'])
    need(value['planSha256']==config['readPlanSha256']and value['contextInputSha256']==config['readContextInputSha256'],
         'exact_current_V5_logical_and_baseline_READ_refs_required');return value


def source_current(refs,inverse=False):
    source_refs(refs);i=intake()
    if not inverse:return i.validate_runtime(refs['resultSha256'],refs['inputSha256'])
    runtime=module(RUNTIME,RUNTIME_SHA);owner=runtime.Owner(refs['inputSha256'])
    state=owner.h.source.state(runtime.SOURCE)
    if state['MainPID']!='0':return i.validate_runtime(refs['resultSha256'],refs['inputSha256'])
    # Only the actual ordinary owner's own stopped journal plus loaded/private,
    # boot/native/cache/process/kernel proof can qualify a terminal source.
    proof=runtime.validate_current_source(refs['resultSha256'],refs['inputSha256'],inverse=True)
    need(proof['validated']is proof['terminalInverseOnly']is True and proof['sourceState']=='owned-terminal'and
         proof['currentWriterQualified']is proof['sourceActorQualified']is proof['financialAuthorityQualified']is False,
         'actual_ordinary_owned_terminal_inverse_source_required');return proof


def metadata_refresh(config,input_sha,inverse=False):
    read_config(config);initial=load_input(input_sha);need(initial['readConfig']==config,'same_metadata_input_and_READ_refs_required')
    authenticate_recorded_read(config)
    def refresh():
        need(load_input(input_sha)==initial,'ordinary_metadata_input_changed_during_phase')
        first=module(READ,READ_SHA).validate_catalog_current(config['admissionSha256']);runtime=source_current(initial['ordinaryRuntime'],inverse)
        second=module(READ,READ_SHA).validate_catalog_current(config['admissionSha256'])
        need(first==second,'complete143_all_column_graph_changed_during_current_writer_capture')
        return {'validated':True,'readAdmissionSha256':config['admissionSha256'],'readPlanSha256':config['readPlanSha256'],
         'readContextInputSha256':config['readContextInputSha256'],'catalogSha256':first['catalogSha256'],'sourceBinding':runtime,
         'inverseOnly':inverse,'originalWholeValidatorPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    return refresh


def execution_context(host,refs):
    need(type(refs)is dict and set(refs)=={'inputSha256','sourcesSha256'}and all(pin(v)for v in refs.values()),'actual_metadata_execution_refs_required')
    value=load_input(refs['inputSha256'])
    need(value['sourcesSha256']==refs['sourcesSha256']and value['readConfig']==host.read_config,'same_immutable_metadata_input_and_source_manifest_required')
    # This is immutable operation ancestry. The caller-supplied refresh callback
    # separately qualifies the then-current writer; a managed handover must not
    # keep the initial standalone PID alive merely to authenticate this input.
    authenticate_recorded_read(host.read_config);return dict(refs)


def metadata_namespace(candidate_sha):
    factory=module(FACTORY,FACTORY_SHA);counts={'restore-label':0,'tcp-host':0,'fds-epoch':0}
    def transform(node):
        if isinstance(node,ast.ClassDef)and node.name=='Host':
            sessions=next(v for v in node.body if isinstance(v,ast.FunctionDef)and v.name=='sessions')
            for v in ast.walk(sessions):
                if isinstance(v,ast.Constant)and isinstance(v.value,str)and 'client_addr::text'in v.value:
                    need(v.value.count('client_addr::text')==1,'one_metadata_session_address_cast_required')
                    v.value=v.value.replace('client_addr::text','host(client_addr)');counts['tcp-host']+=1
                if isinstance(v,ast.Call)and isinstance(v.func,ast.Attribute)and v.func.attr=='map_owned_backends':
                    need(isinstance(v.args[0],ast.Call)and ast.unparse(v.args[0].func)=='o.peer_fds','exact_original_metadata_client_FD_capture_required')
                    v.args[0]=ast.parse('owned_metadata_fds(o,actor)',mode='eval').body;counts['fds-epoch']+=1
        if isinstance(node,ast.FunctionDef)and node.name=='review':
            for v in ast.walk(node):
                if isinstance(v,ast.Constant)and v.value=='sourceRestoreReceiptSha256':v.value='historicalRestoreReceiptSha256';counts['restore-label']+=1
        return node
    n=factory.namespace(public(META_TEMPLATE,META_TEMPLATE_SHA),META_TEMPLATE_SHA,METADATA,{
      'FORMAT':META_FORMAT,'BASE':META_BASE,'INPUT':META_INPUT,'SOURCES':META_SOURCES,'PROVIDER':FILE,
      'CANDIDATES':CANDIDATES,'CANDIDATE_SHA':candidate_sha,'META_FILE':FILE,'META_SHA':sha(Path(__file__).read_bytes()),
      'ADMISSION_FILE':READ,'ADMISSION_RESULT':READ_RESULT,
      'DROP':Path('/etc/systemd/system/yunipals-metadata.service.d/zzzzzzzzzzzzzzzzzzzzzzzz-ypal-ordinary-native-metadata-v5.conf')},
      {'cli_context':lambda input_sha,inverse=False:metadata_context(input_sha,inverse), 'execution_context':execution_context,
       'initialize':lambda *args,**kwargs:initialize_metadata(n,*args,**kwargs),'authenticate_admission':authenticate_admission},transform)
    need(counts=={'restore-label':1,'tcp-host':1,'fds-epoch':1},'exact_current_READ_history_TCP_host_and_epoch_seams_required')
    n.owned_metadata_fds=owned_metadata_fds
    n.Host.terminal=metadata_terminal(n)
    original_review=n.review
    def review(host):
        binding,observation=original_review(host)
        need(all(binding['oldWriter'][key]==host.candidate['oldWriter'][key]for key in ['definitions','environmentFileHashes','configuredEnvironmentSha256']),
             'live_metadata_private_and_definition_inputs_must_match_staged_candidate_baseline')
        return binding,observation
    review.__wrapped__=original_review
    n.review=review
    return n

def owned_metadata_fds(observer,actor):
    rows=actor['processes'];need(1<=len(rows)<=8,'bounded_actual_metadata_kernel_process_set_required')
    own=observer.peer_fds([row['pid']for row in rows],0,0)
    need(all(type(row['pid'])is int and type(row['startTicks'])is int and row['startTicks']>0 and
             own[str(row['pid'])]['startTicks']==row['startTicks']for row in rows),'metadata_client_FD_epoch_must_match_recorded_actor')
    return own


def metadata_context(input_sha,inverse=False):
    value=load_input(input_sha);config=value['readConfig'];n=metadata_namespace(value['candidateReceiptSha256'])
    primitives=metadata_primitives(value['candidateInputSha256'])
    host=n.construct_context(config,metadata_refresh(config,input_sha,inverse),inverse,primitives,admission_reference(config))
    host.execution_context={'inputSha256':input_sha,'sourcesSha256':value['sourcesSha256']}
    execution_context(host,host.execution_context);return host


CREATOR=OPS/'ypal-ordinary-readview-v5.py'
CREATOR_SHA='1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2'
CANDIDATE_TEMPLATE=OPS/'ypal-native-metadata-candidates-v1.py'
CANDIDATE_TEMPLATE_SHA='146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525'
CANDIDATES=Path('/var/backups/yunipals-ypal-ordinary-metadata-candidates-v5-20261025')
CANDIDATE_INPUT=Path('/var/backups/yunipals-ypal-ordinary-metadata-candidate-input-v5-20261025/input.json')
TERMINAL_TEMPLATE=OPS/'ypal-native-cutover-proof-v1.py'
TERMINAL_TEMPLATE_SHA='9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946'
READ_SCHEMA='yunipals_ownership_4e77f52b_v5'
READ_IDENTITY='0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab'


def candidate_input(value):
    need(type(value)is dict and set(value)=={'format','ordinaryRuntime','readConfig','createdReceiptSha256'}and
         value['format']==FORMAT+'-candidate-input'and pin(value['createdReceiptSha256']),'exact_V5_candidate_context_required')
    source_refs(value['ordinaryRuntime']);read_config(value['readConfig']);return value


def candidate_context(input_sha):
    need(pin(input_sha),'actual_V5_candidate_input_required');return candidate_input(intake().document(CANDIDATE_INPUT,input_sha))


def candidate_namespace(config):
    factory=module(FACTORY,FACTORY_SHA);original=module(CANDIDATE_TEMPLATE,CANDIDATE_TEMPLATE_SHA)
    repin=copy.deepcopy(original.REPIN)
    for key in ['READ_DATABASE_SCHEMA','OWNERSHIP_READ_SCHEMA']:repin[key]=(repin[key][0],READ_SCHEMA)
    def forbidden(*_):raise RuntimeError('historical_source_constructor_not_authority_for_V5_candidates')
    return factory.namespace(public(CANDIDATE_TEMPLATE,CANDIDATE_TEMPLATE_SHA),CANDIDATE_TEMPLATE_SHA,FILE,
      {'BASE':CANDIDATES,'FORMAT':FORMAT+'-candidates','READ':READ_SCHEMA,'IDENTITY':READ_IDENTITY,'REPIN':repin,
       'READ_RESULT_SHA':config['createdReceiptSha256'],'SOURCE_RESULT_SHA':config['ordinaryRuntime']['resultSha256']},
      {'load':forbidden,'source_guard':forbidden,'prepare':forbidden,'stage':forbidden,'main':forbidden})


def metadata_primitives(candidate_input_sha):
    config=candidate_context(candidate_input_sha);i=intake();parts=i.query_components()['components'];p=parts['privilegedSourcePrimitives'];s=p['host'].s
    meta=candidate_namespace(config);m=module(OPS/'retained-workers-stage-v1.py',meta.RETAINED_SHA)
    installer=module(OPS/'metadata-normalization-runtime-install-v1.py',meta.INSTALLER_SHA);installer.installed(m,meta.INSTALL_SHA)
    creator=module(CREATOR,CREATOR_SHA);creator.acknowledgement(config['createdReceiptSha256']);creator.data_current(config['createdReceiptSha256'])
    created=i.document(creator.BASE/'created.json',config['createdReceiptSha256'])
    return {'meta':meta,'s':s,'h':types.SimpleNamespace(query=parts['readerHost'].query,observer=p['host'].raw.observer),
      'm':m,'installer':installer,'reader':creator,'source_op':p['host'].source_op,'source':p['restoreReceipt'],'created':created,
      'sourceAuthorityQualified':False,'candidateInputSha256':candidate_input_sha,'candidateInput':config}


def authenticate_admission(host,reference):
    need(reference==admission_reference(host.read_config),'exact_V5_logical_read_reference_required')
    ack=authenticate_recorded_read(host.read_config)
    need(ack['operatorSha256']==READ_SHA and ack['readSchema']==READ_SCHEMA and ack['readIdentity']==READ_IDENTITY and
         ack['baselineReadEdgeCount']==143 and ack['immutableAdmissionOnly']is True and ack['sourceActorQualified']is False,
         'actual_baseline143_plus_V5_logical_admission_chain_required')
    return dict(reference)


def acknowledge_candidates(input_sha,receipt_sha):
    config=candidate_context(input_sha);i=intake();value=i.document(CANDIDATES/'result.json',receipt_sha)
    # The stage result contains the exact exclusive intent, not a synthesized
    # replacement for a missing intent. Authenticate both protected files.
    raw=(CANDIDATES/'intent.json').read_bytes();intent=i.document(CANDIDATES/'intent.json',sha(raw))
    meta=candidate_namespace(config)
    need(value=={**intent,'staged':True,'selected':False,'adopted':False}and intent['format']==FORMAT+'-candidates'and
         intent['operatorSha256']==sha(Path(__file__).read_bytes())and intent['candidateInputSha256']==input_sha and intent['input']==config and
         intent['readviewResultSha256']==config['createdReceiptSha256']and intent['readConfig']==config['readConfig']and
         intent['readSchema']==READ_SCHEMA and intent['readIdentity']==READ_IDENTITY and set(intent['files'])==set(meta.FILES)and
         all(pin(v)for v in intent['files'].values())and intent['previousReceiptSha256']==meta.PREVIOUS_SHA and
         intent['changedPrivateEnvironmentKeys']==sorted(meta.REPIN)and intent['allOtherEnvironmentValuesPreserved']is True and
         intent['newPasswordOrDatabaseUrl']is False and intent['databaseWrites']==intent['serviceActions']==intent['providerCalls']==0,
         'actual_V5_private_candidate_exclusive_intent_result_and_exact_selector_scope_required')
    return value


def initialize_metadata(owner,host,config,refresh_callback,inverse=False,primitives=None,admission_ref=None):
    need(type(inverse)is bool and callable(refresh_callback)and type(primitives)is dict and primitives.get('sourceAuthorityQualified')is False,
         'explicit_static_V5_metadata_primitives_and_current_phase_callback_required')
    for key in ['meta','s','h','m','installer','reader','source_op','source','created']:setattr(host,key,primitives[key])
    host.read_config=read_config(config);host.admission_pin=config['admissionSha256'];host.admission_ref=authenticate_admission(host,admission_ref)
    need(sha(host.s.protected(META_TEMPLATE))==META_TEMPLATE_SHA and sha(host.s.protected(FILE))==owner.META_SHA and
         str(host.meta.__file__)==str(FILE),'exact_V5_metadata_and_historical_lifecycle_sources_required')
    candidate_config=primitives['candidateInput'];need(candidate_config['readConfig']==config,'same_actual_V5_candidate_and_metadata_READ_context_required')
    ack=module(CREATOR,CREATOR_SHA).acknowledgement(candidate_config['createdReceiptSha256'])
    need(host.created['readSchema']==host.meta.READ==READ_SCHEMA and host.created['readIdentity']==host.meta.IDENTITY==READ_IDENTITY and
         host.created['target']['schemaOid']==ack['schemaOid']and host.created['sourceRelease']==intake().DATA['sourceRelease'],
         'actual_created_V5_objects_and_logical_identity_required')
    host.candidate=acknowledge_candidates(primitives['candidateInputSha256'],owner.CANDIDATE_SHA)
    need(host.candidate['format']==FORMAT+'-candidates'and host.candidate['staged']is True and host.candidate['selected']is host.candidate['adopted']is False and
         host.candidate['operatorSha256']==owner.META_SHA and host.candidate['candidateInputSha256']==primitives['candidateInputSha256']and
         host.candidate['readviewResultSha256']==candidate_config['createdReceiptSha256']and host.candidate['readConfig']==config and
         host.candidate['readSchema']==READ_SCHEMA and host.candidate['readIdentity']==READ_IDENTITY,
         'same_actual_unselected_V5_private_candidate_receipt_required')
    host.refresh_callback=refresh_callback;host.inverse_mode=inverse;host.refresh()


def prepare_candidates(input_sha):
    config=candidate_context(input_sha);p=metadata_primitives(input_sha);meta,s,m=p['meta'],p['s'],p['m']
    need(not os.path.lexists(CANDIDATES),'fresh_V5_private_candidate_directory_required')
    admission=module(READ,READ_SHA);ack=authenticate_recorded_read(config['readConfig']);first=source_current(config['ordinaryRuntime'])
    graph=admission.validate_catalog_current(config['readConfig']['admissionSha256'])
    prior=s.document(meta.PREVIOUS/'result.json',meta.PREVIOUS_SHA);originals={name:m.protected(meta.PREVIOUS/name)for name in meta.FILES}
    need(prior['staged']is True and prior['readSchema']==meta.OLD_READ and
         all(sha(raw)==prior['files'][name]for name,raw in originals.items())and sha(originals['native-recovery.env'])==meta.PREVIOUS_ENV_SHA,
         'exact_retained_dormant_candidate_bytes_required')
    files,db,old_env=meta.render(m,originals);writer,current_env=m.snapshot(meta.UNIT)
    meta.same_private_configuration(old_env,current_env,{*m.PUBLIC,'PONDER_RPC_URL_8453'})
    observed=p['h'].query(meta.context_sql())
    need(observed['databaseOid']=='17584'and observed['role']['oid']=='16388'and observed['role']['name']=='yunipals'and
         observed['scan']['ingestionMode']=='rpc'and not any(not r['allowed']for r in observed['requiredReadPermissions']),
         'actual_existing_metadata_role_cursor_and_V5_native_control_reads_required')
    created=module(CREATOR,CREATOR_SHA).data_current(config['createdReceiptSha256'])
    binding={'format':FORMAT+'-candidates','operatorSha256':sha(Path(__file__).read_bytes()),'bootId':s.boot(),
       'candidateInputSha256':input_sha,'input':config,'readviewResultSha256':config['createdReceiptSha256'],'readConfig':config['readConfig'],
       'readAdmission':ack,'readSchema':READ_SCHEMA,'readIdentity':READ_IDENTITY,'created':created,'role':observed['role'],
       'database':db,'oldWriter':writer,'sourceBinding':first,'catalogSha256':graph['catalogSha256'],'previousReceiptSha256':meta.PREVIOUS_SHA,
       'files':{name:sha(raw)for name,raw in files.items()},'changedPrivateEnvironmentKeys':sorted(meta.REPIN),'allOtherEnvironmentValuesPreserved':True,
       'newPasswordOrDatabaseUrl':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    need(m.snapshot(meta.UNIT)[0]==writer and source_current(config['ordinaryRuntime'])==first and
         admission.validate_catalog_current(config['readConfig']['admissionSha256'])==graph,'V5_candidate_source_catalog_or_original_writer_changed')
    return p,binding,files,observed


def stage_candidates(input_sha,review_sha):
    p,binding,files,_=prepare_candidates(input_sha);need(sha(encoded(binding))==review_sha,'exact_V5_candidate_review_required')
    s,m=p['s'],p['m'];CANDIDATES.mkdir(mode=0o700);s.sync(CANDIDATES.parent);s.save(CANDIDATES/'intent.json',binding)
    for name,raw in files.items():s.save(CANDIDATES/name,raw,0o700 if name.endswith('.sh')else 0o600)
    need(all(m.protected(CANDIDATES/name)==raw for name,raw in files.items()),'exact_staged_V5_private_candidate_bytes_required')
    config=binding['input'];need(m.snapshot(p['meta'].UNIT)[0]==binding['oldWriter']and
         source_current(config['ordinaryRuntime'])==binding['sourceBinding']and
         module(READ,READ_SHA).validate_catalog_current(config['readConfig']['admissionSha256'])['catalogSha256']==binding['catalogSha256']and
         module(CREATOR,CREATOR_SHA).data_current(config['createdReceiptSha256'])==binding['created'],
         'same_V5_candidate_current_writer_catalog_and_objects_after_stage_required')
    value={**binding,'staged':True,'selected':False,'adopted':False};return s.save(CANDIDATES/'result.json',value)


def terminal_sessions(host,actor):
    """Reuse the reviewed positive residual-peer kernel proof in new globals."""
    raw=public(TERMINAL_TEMPLATE,TERMINAL_TEMPLATE_SHA);tree=ast.parse(raw)
    cls=next(v for v in tree.body if isinstance(v,ast.ClassDef)and v.name=='Context')
    fn=next(v for v in cls.body if isinstance(v,ast.FunctionDef)and v.name=='terminal_sessions');casts=0
    for node in ast.walk(fn):
        if isinstance(node,ast.Constant)and isinstance(node.value,str)and 'client_addr::text'in node.value:
            node.value=node.value.replace('client_addr::text','host(client_addr)');casts+=1
    need(casts==1,'exact_terminal_backend_host_cast_required')
    old=module(TERMINAL_TEMPLATE,TERMINAL_TEMPLATE_SHA);scope=dict(old.__dict__)
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(FILE),'exec'),scope)
    observer=host.h.observer
    def fds(pids,uid,gid):
        before={pid:old.process(pid)for pid in pids};value=observer.peer_fds(pids,uid,gid)
        need(all(value[str(pid)]['startTicks']==record['startTicks']and old.process(pid)==record for pid,record in before.items()),
             'terminal_residual_FD_epochs_must_match_actual_processes')
        return value
    wrapped=types.SimpleNamespace(**{name:getattr(observer,name)for name in ['run','unix_peers','tcp_clients','map_owned_backends']},peer_fds=fds)
    shim=types.SimpleNamespace(query=host.query,host=types.SimpleNamespace(h=types.SimpleNamespace(observer=wrapped)))
    return scope['terminal_sessions'](shim,actor,'16388')


def metadata_terminal(owner):
    def terminal(host,op,actor,sessions=None):
        before=owner.state(host.m)
        need(before['MainPID']==before['ControlPID']=='0'and before['Job']==''and before['ActiveState']in{'inactive','failed'},'metadata_unit_must_be_terminal')
        if sessions is None:
            candidates=[op['oldActor']]
            for name in ['native-started.json','selected.json','inverse-intent.json']:
                if (owner.BASE/name).exists():
                    v=host.s.document(owner.BASE/name);value=v.get('nativeActor',v)
                    if value is not None:candidates.append(value)
            matches=[v for v in candidates if v['unit']['InvocationID']==before['InvocationID']]
            need(matches and all(v['processes']==matches[0]['processes']for v in matches),'exact_acknowledged_terminal_metadata_invocation_required')
            actor=matches[0];native=os.path.lexists(owner.DROP);enabled=os.path.lexists(owner.BOOT)
            if native:need(owner.file_identity(owner.DROP)==host.s.document(owner.BASE/'native-drop-created.json')and sha(host.s.protected(owner.DROP))==op['candidateDropSha256'],'same_owned_terminal_metadata_overlay_required')
            boot=owner.BOOT if enabled else owner.BASE/'original-boot-link'
            need(owner.link(boot)==op['oldBoot']and owner.loaded(host,op,native,enabled),'exact_terminal_metadata_loaded_definition_private_selectors_and_boot_required')
            sessions=terminal_sessions(host,actor)
        group=Path('/sys/fs/cgroup/system.slice')/owner.UNIT/'cgroup.procs'
        need(not group.exists()or not group.read_text().split(),'metadata_cgroup_must_be_empty')
        need(not any(owner.identity_alive(host.m,p)for p in actor['processes']),'owned_metadata_processes_must_be_gone')
        rows=host.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start)),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=16388 AND datid=17584")
        need(not any(r['pid']==v['pid']and r['backendStart']==v['backendStart']for r in rows for v in sessions['owned']),'owned_metadata_backend_sessions_must_be_gone')
        host.private(op['oldWriter']);host.refresh();need(owner.state(host.m)==before,'terminal_metadata_changed_during_private_and_phase_fences')
        return before
    return terminal


def main():
    import argparse,socket
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--candidate-input-sha');parser.add_argument('--stage');a=parser.parse_args()
    if not a.candidate_input_sha:
        need(not a.stage,'actual_V5_candidate_input_before_staging_required');print(json.dumps({'format':FORMAT,'sourceOnly':True,'consumerPhaseExecuted':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_V5_metadata_candidate_host_required');os.umask(0o077)
    if a.stage:result=stage_candidates(a.candidate_input_sha,a.stage);print(json.dumps({'format':FORMAT,'staged':True,'candidateReceiptSha256':result,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    _,binding,_,observed=prepare_candidates(a.candidate_input_sha)
    print(json.dumps({'format':FORMAT,'reviewHash':sha(encoded(binding)),'permissionsReady':True,'baseMetadataReady':observed['baseProbe'],'adopted':False,'selected':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))


if __name__=='__main__':
    import signal
    signal.signal(signal.SIGALRM,lambda *_:need(False,'bounded_V5_metadata_candidate_phase_expired'));signal.alarm(240)
    try:main()
    except Exception as error:
        code=str(error);print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',code)else type(error).__name__,'automaticRetryAllowed':False}));raise SystemExit(1)
    finally:signal.alarm(0)
