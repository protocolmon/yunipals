#!/usr/bin/env python3
"""Explicit V6 publication composition over the genuine unchanged V5 dataset."""
import ast
import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import time
import types

FORMAT='yunipals-ypal-ordinary-publication-caller-v6'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
BASE=Path('/var/backups/yunipals-ypal-ordinary-publication-caller-v6-20261025')
GUARD=OPS/'ypal-ordinary-source-authority-v5.py'
GUARD_SHA='052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0'
PROVIDER=OPS/'ypal-ordinary-read-cache-v6.py'
PROVIDER_SHA='46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c'
READER=OPS/'ypal-ordinary-reader-cutover-v6.py'
READER_SHA='7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0'
PROOF=OPS/'ypal-ordinary-reader-proof-v6.py'
PROOF_SHA='0b4a31b7da89901091c2a68807acb86b5513f99a554c60fdc54809db653069f5'
QUERY=OPS/'ypal-ordinary-publication-query-v2.py'
QUERY_SHA='deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c'
PROTOCOL=OPS/'ypal-ordinary-publication-protocol-v6.py'
PROTOCOL_SHA='543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502'
TIMING=OPS/'ypal-ordinary-cache-callback-timing-v5.py'
TIMING_SHA='c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb'


def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(v):return(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(v):return type(v)is str and re.fullmatch('[a-f0-9]{64}',v)and v!='0'*64
def own_sha():return sha(Path(__file__).read_bytes())


def guard_module():
    import stat
    for path in[*GUARD.parents,GUARD]:
        row=path.lstat();need(row.st_uid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,'protected_fixed_live_source_guard_required')
    raw=GUARD.read_bytes();need(len(raw)<100000 and sha(raw)==GUARD_SHA,'exact_live_source_guard_required')
    n=types.ModuleType('publication_live_source_guard');n.__file__=str(GUARD);exec(compile(raw,str(GUARD),'exec'),n.__dict__);return n


def inverse_active_authority(guard):
    tree=ast.parse(guard.public(GUARD,GUARD_SHA));owner=next(v for v in tree.body if isinstance(v,ast.ClassDef)and v.name=='Authority')
    fn=copy.deepcopy(next(v for v in owner.body if isinstance(v,ast.FunctionDef)and v.name=='_native'));changes=0
    for row in ast.walk(fn):
        if isinstance(row,ast.BoolOp)and isinstance(row.op,ast.And):
            kept=[]
            for value in row.values:
                if ast.unparse(value)=="str(native['app']['is_ready']) == '1'":changes+=1
                else:kept.append(value)
            row.values=kept
    need(changes==1,'one_framework_ready_operand_only_for_active_inverse_required')
    values=dict(guard.__dict__);exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(Path(__file__).absolute()),'exec'),values)
    class InverseActiveAuthority(guard.Authority):
        _native=values['_native']
    return InverseActiveAuthority


class SourcePhase:
    """Explicit active inverse versus the actual ordinary owned-stop leaf.

    A terminal branch is never returned by the forward guard. The genuine3bf
    body executes on every terminal call; its runtime cost is not assumed to
    fit a held transaction. Each callback mode needs its own timing gate.
    """
    def __init__(self,refs,inverse=False):
        need(type(refs)is dict and set(refs)=={'resultSha256','inputSha256'}and all(pin(v)for v in refs.values())and type(inverse)is bool,'actual_ordinary_source_ref2_and_explicit_direction_required')
        self.refs=copy.deepcopy(refs);self.inverse=inverse;self.g=guard_module()
        authority=inverse_active_authority(self.g)if inverse else self.g.Authority
        self.authority=authority(refs['resultSha256'],refs['inputSha256']);self.owner=self.authority.owner
        self.prepared=False;self.kind=None
    def terminal(self):
        need(self.inverse,'forward_cannot_use_a_terminal_source')
        value=self.owner.current(self.refs['resultSha256'],inverse=True)
        need(value['validated']is value['terminalInverseOnly']is True and value['sourceState']=='owned-terminal'and
             value['receiptSha']==self.refs['resultSha256']and value['inputSha256']==self.refs['inputSha256']and
             value['currentWriterQualified']is value['sourceActorQualified']is value['financialAuthorityQualified']is False and
             value['databaseWrites']==value['serviceActions']==value['providerCalls']==0,
             'genuine_actual_ordinary_stopped_journal_and_full_terminal_proof_required')
        data=self.authority.intake.DATA;native=self.owner.h.source.native()
        need(native['schemaOid']==data['schemaOid']and native['tables']==self.owner.original['native']['tables']and
             native['cache']==self.owner.original['native']['cache']and native['app']['build_id']==data['buildId'],
             'genuine_terminal_source_native44_cache_and_registered_dataset_required')
        self.authority.intake.registration(self.owner.h.source.query)
        return {**value,**{k:data[k]for k in('sourceRelease','manifestHash','schema','schemaOid','buildId')},
                'format':FORMAT+'-inverse-terminal','operatorSha256':own_sha(),'ordinaryTerminalProof':value,
                'ordinaryTerminalProducerSha256':self.g.RUNTIME_SHA,'nativeTableIdentities':native['tables'],'syncCacheIdentity':native['cache'],
                'sourceReadinessQualified':False,'currentCanonicalCoverageQualified':False,'originalWholeValidatorPassed':False}
    def preflight(self):
        need(not self.prepared,'one_full_source_preflight_per_caller_required')
        state=self.owner.h.source.state(self.g.SOURCE)
        if state['MainPID']=='0':
            need(self.inverse,'forward_requires_actual_active_source')
            first=self.terminal();self.kind='inverse-owned-terminal';self.initial=first
            need(self.terminal()==first,'same_genuine_terminal_source_bookends_required')
        else:
            self.initial=self.authority.preflight();self.kind='inverse-active'if self.inverse else'forward-active'
        self.prepared=True;return {'kind':self.kind,'fullPreflight':self.initial}
    def current(self,inverse=False):
        need(self.prepared and type(inverse)is bool,'complete_source_preflight_and_typed_direction_required')
        if self.kind=='inverse-owned-terminal':
            need(inverse,'terminal_source_is_inverse_only');return self.terminal()
        if inverse:
            need(self.inverse,'inverse_dispatch_requires_an_explicit_inverse_session')
            value=self.authority.current()
            need(value['currentWriterQualified']is value['sourceActorQualified']is True and
                 value['runtimeReceiptSha256']==self.refs['resultSha256']and value['runtimeInputSha256']==self.refs['inputSha256'],
                 'same_positive_active_ordinary_source_for_inverse_required')
            return {**value,'format':FORMAT+'-inverse-active','inverseOnly':True,'inverseActiveOnly':True,
                    'operatorSha256':own_sha(),'sourceAuthorityTemplateSha256':GUARD_SHA,
                    'sourceState':'acknowledged-active','terminalInverseOnly':False,'sourceTerminalQualified':False,
                    'sourceReadinessQualified':False}
        need(not self.inverse,'inverse_session_cannot_dispatch_a_forward_source_claim')
        return self.authority.current()
    def finish(self):
        need(self.prepared,'full_preflight_required_before_source_postflight')
        if self.kind=='inverse-owned-terminal':
            value=self.terminal();need(value==self.initial,'same_ordinary_terminal_source_after_operation_required');return value
        return self.authority.finish()


class BoundProvider:
    """Public factory seam; no old module global or whole-validator success."""
    def __init__(self,entry,source):self.entry,self.source=entry,source
    def __getattr__(self,name):return getattr(self.entry,name)
    def namespace(self,config,manifest=None,source_guard=None):
        need(source_guard is None,'caller_cannot_replace_the_reviewed_source_phase_dispatch')
        return self.entry.namespace(config,manifest,self.source.current)
    def cache_runtime(self,config=None,manifest=None,source_guard=None):
        need(config is not None,'actual_cache_config_required_before_bound_runtime_construction')
        return self.namespace(config,manifest,source_guard).cache_runtime()
    def create_phase(self,inputs,coordinator_manifest,source_guard=None):
        need(source_guard is None,'caller_cannot_override_reader_source_dispatch')
        config=self.entry.config_checked(self.entry.common().intake().document(self.entry.INPUT,inputs['cacheInputsSha256']))
        return self.namespace(config,coordinator_manifest).Phase(inputs,coordinator_manifest)


class PreparedMetadata:
    """Authenticate static construction once; run the complete live body.

    This replaces only construct_context inside a new function namespace.
    Its actual phase callback still executes at that same constructor seam,
    plus the original operation/final refreshes and actor/private/DB proofs.
    """
    def __init__(self,namespace,phase,refresh,inverse,guard):
        self.n,self.phase,self.inverse,self.g=namespace,phase,inverse,guard
        self.p=phase.metadata_primitives();p=self.p
        self.host=namespace.construct_context(p['readConfig'],refresh,inverse,p,p['admission_ref'])
        self.publication_query_binding=guard.module(QUERY,QUERY_SHA).bind(self.host)
        creator=p['reader'];i=creator.intake();factory=i.module(creator.FACTORY,creator.FACTORY_SHA)
        pure=factory.namespace(i.protected(creator.TEMPLATE,creator.TEMPLATE_SHA),creator.TEMPLATE_SHA,Path(creator.__file__).absolute(),{'READ_SCHEMA':creator.READ_SCHEMA,'READ_IDENTITY':creator.READ_IDENTITY})
        self.sql=pure.target_sql(creator.validate_plan(i.document(creator.PLAN,creator.PLAN_SHA)))
        self.target=guard.read_data_identity(p['created']['target'])
        paths={str(creator.BASE/name)for name in['created.json','before.json','rehearsed.json','commit-intent.json']}
        paths|={str(namespace.CANDIDATES/name)for name in['result.json','intent.json']}
        paths|={str(QUERY),str(PROTOCOL)}
        paths|={str(path)for path in[creator.INPUT,creator.PLAN,namespace.INPUT,namespace.SOURCES,Path(namespace.__file__)]}
        self.paths=paths;self.records=guard.file_frame(paths)
    def invoke(self,candidate,refresh,selection=None):
        need(callable(refresh)and self.g.file_frame(self.paths)==self.records,'same_immutable_metadata_constructor_and_creator_inputs_required')
        need(self.g.read_data_identity(self.host.query(self.sql))==self.target,'current_V5_marker_object_bodies_and_columns_required')
        slot=self
        class Phase:
            def metadata_primitives(self):return slot.p
        def construct(config,callback,inverse=False,primitives=None,admission_ref=None):
            need(config==slot.p['readConfig']and callback is refresh and inverse is slot.inverse and primitives is slot.p and admission_ref==slot.p['admission_ref'],
                 'exact_preconstructed_metadata_direction_refs_and_current_callback_required')
            slot.host.refresh_callback=callback;slot.host.refresh()
            return slot.host
        original=self.n.metadata_inverse_context if self.inverse else self.n.metadata
        fn=types.FunctionType(original.__code__,{**original.__globals__,'construct_context':construct},original.__name__,original.__defaults__)
        return fn(Phase(),candidate,refresh)if self.inverse else fn(Phase(),candidate,selection,refresh)


class ReaderPhase:
    def __init__(self,phase,proof,context,source,guard):
        self.phase=phase;self.inverse=source.inverse
        # The exact provider exports the actual new metadata namespace through
        # dependency(); this is a static construction dependency, not a source
        # predicate or a whole-consumer validator.
        self.metadata_namespace=guard.module(OPS/'ypal-ordinary-metadata-handover-v5.py',proof.pins['ypal-ordinary-metadata-handover-v5.py']).namespace(phase.host.config['metadataInputSha256'])
        self.guard=guard
        self.default=lambda:proof.metadata_refresh(context,self.inverse)
        # Inverse metadata starts only after actual cache4/LOGIN reversal. Its
        # constructor cannot claim that future prefix in an earlier context.
        self.slot=None if self.inverse else PreparedMetadata(self.metadata_namespace,phase,self.default,False,guard)
    def __getattr__(self,name):return getattr(self.phase,name)
    def metadata(self,refresh_callback=None):
        need(not self.inverse,'inverse_reader_context_cannot_claim_current_native_metadata')
        _,candidate,_,_=self.phase.generation();r=self.phase.host.new_read
        selection=r.document(self.phase.cache.META/'selected.json',self.phase.host.config['metadataSelectionSha256'])
        return self.slot.invoke(candidate,refresh_callback or self.default,selection)
    def metadata_inverse_context(self,refresh_callback=None):
        need(self.inverse,'metadata_inverse_requires_explicit_inverse_reader_context')
        _,candidate,_,_=self.phase.generation()
        if self.slot is None:self.slot=PreparedMetadata(self.metadata_namespace,self.phase,self.default,True,self.guard)
        return self.slot.invoke(candidate,refresh_callback or self.default)


def bind_proof(proof_class,provider):
    class PublicationProof(proof_class):
        def module_context(self,role):
            original=super().module_context(role)
            if role=='phase':
                need(original.__file__==str(PROVIDER)and sha(self.protected(PROVIDER))==PROVIDER_SHA,'same_actual_frozen_provider_factory_required')
                return provider
            return original
        def initialize(self,context,inputs):
            super().initialize(context,inputs)
            phase=context.phase
            context.phase=ReaderPhase(phase,self,context,provider.source,provider.source.g)
    return PublicationProof


class Session:
    """One explicit composition; full source fences are outside child scopes."""
    def __init__(self,source_refs,inverse=False):
        self.source=SourcePhase(source_refs,inverse);self.g=self.source.g;self.readonly_preflight=None
        self.protocol=self.g.module(PROTOCOL,PROTOCOL_SHA)
        self.provider=BoundProvider(self.g.module(PROVIDER,PROVIDER_SHA),self.source)
        self.cache=None;self.host=None;self.root=None;self.proof=None;self.key=None
    def preflight(self):self.readonly_preflight=self.source.preflight();return self.readonly_preflight
    def cache_context(self,input_sha):
        need(self.readonly_preflight is not None and pin(input_sha),'full_source_preflight_before_cache_construction_required')
        config=self.provider.config_checked(self.provider.common().intake().document(self.provider.INPUT,input_sha))
        self.key={'target':'cache','inputSha256':input_sha,'source':self.source.refs,'sourceKind':self.source.kind,'direction':'inverse'if self.source.inverse else'forward'}
        self.cache=self.provider.namespace(config).cache_runtime();self.cache.inverse_mode=self.source.inverse
        cache=self.cache;parent=cache.Host;session=self
        class CacheHost(parent):
            def __init__(self,value):
                super().__init__(value)
                self.publication_slot=None
                if not session.source.inverse:
                    n=session.g.module(OPS/'ypal-ordinary-metadata-handover-v5.py',session.provider.METADATA_SHA).namespace(value['metadataInputSha256'])
                    self.publication_refresh=lambda:self.refresh()
                    self.publication_slot=PreparedMetadata(n,self,self.publication_refresh,False,session.g)
            def metadata_current(self,generation,selection):
                need(self.publication_slot is not None,'current_native_metadata_proof_is_forward_only')
                return self.publication_slot.invoke(generation,self.publication_refresh,selection)
        cache.Host=CacheHost;self.host=cache.Host(config)
        return self.cache,self.host
    def reader_context(self,manifest_sha,inputs):
        need(self.readonly_preflight is not None and pin(manifest_sha),'full_source_preflight_before_reader_construction_required')
        reader=self.g.module(READER,READER_SHA);original=self.g.module(PROOF,PROOF_SHA)
        proof=bind_proof(original.Proof,self.provider)(manifest_sha)
        root=reader.assemble(reader.protected(reader.TEMPLATE,reader.TEMPLATE_SHA),proof)
        need(root.load_proof(manifest_sha)is proof,'same_bound_reader_proof_in_every_original_business_closure_required')
        self.root,self.proof=root,proof
        self.key={'target':'reader','manifestSha256':manifest_sha,'inputsSha256':sha(encoded(inputs)),
                  'source':self.source.refs,'sourceKind':self.source.kind,'direction':'inverse'if self.source.inverse else'forward'}
        # Eager construction happens before a held child is entered. The real
        # context retains Phase.scope/inverse_scope and every catalog predicate.
        self.context=proof.Context(copy.deepcopy(inputs));return root,proof,self.context
    def finish(self):return self.source.finish()


def timing_key(session,mode):
    need(session.key is not None,'actual_cache_or_reader_context_before_timing_required')
    return {'format':FORMAT,'operatorSha256':own_sha(),'guardSha256':GUARD_SHA,'providerSha256':PROVIDER_SHA,
            'readerSha256':READER_SHA,'proofSha256':PROOF_SHA,'querySha256':QUERY_SHA,
            'protocolSha256':PROTOCOL_SHA,'protocolPolicy':session.protocol.policy(),'context':session.key,'mode':mode}


def require_timing(session,receipt,mode):
    need(type(receipt)is dict and set(receipt)=={'captureId','sha256'}and re.fullmatch('[a-z][a-z0-9-]{0,47}',receipt['captureId'])and pin(receipt['sha256']),
         'actual_protected_callback_timing_receipt_reference_required')
    receipt=json.loads(session.g.public(BASE/'captures'/receipt['captureId']/'result.json',receipt['sha256']))
    need(type(receipt)is dict and receipt.get('binding')==timing_key(session,mode)and receipt.get('completed')is True and
         type(receipt.get('elapsedNanoseconds'))is int and receipt['elapsedNanoseconds']>0 and
         receipt['databaseWrites']==receipt['serviceActions']==receipt['providerCalls']==0 and receipt['syntheticTimingInputOnly']is True,
         'actual_same_caller_context_mode_and_readonly_callback_measurement_required')
    session.protocol.require_callback_window(receipt,session.key['target'])
    return receipt


def measure(session,mode,callback,reserved_effect_ns=0):
    started=time.monotonic_ns();value=callback();elapsed=time.monotonic_ns()-started
    return {'binding':timing_key(session,mode),'completed':True,'elapsedNanoseconds':elapsed,'observation':value,
            'syntheticTimingInputOnly':True,'reservedEffectNanoseconds':reserved_effect_ns,
            'productionCOMMITQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def cache_callback_measurement(session,audit_save):
    need(not session.source.inverse,'forward_cache_prepared_callback_measurement_requires_forward_session')
    cache,host=session.cache,session.host;before,rehearsal,_=cache.stopped(host)
    need(not(cache.BASE/'sql-intent.json').exists()and not(cache.BASE/'sql-committed.json').exists(),'before_first_actual_cache_COMMIT_only')
    timing=session.g.module(TIMING,TIMING_SHA)
    packet={**copy.deepcopy(rehearsal['sql']),'mode':'apply','planSha256':sha(rehearsal['sql']['resultJson'].encode())}
    callback=timing.callback(timing.protected(timing.CACHE,timing.CACHE_SHA),cache,host,before,rehearsal,audit_save)
    return measure(session,'cache-prepared',lambda:callback(packet))


def prepared_callback(raw,outer,name,scope,original_save,audit_save):
    tree=ast.parse(raw);fn=next(v for v in tree.body if isinstance(v,ast.FunctionDef)and v.name==outer)
    found=[v for v in ast.walk(fn)if isinstance(v,ast.FunctionDef)and v.name==name]
    need(len(found)==1,'one_exact_original_prepared_callback_required');value=copy.deepcopy(found[0]);changes=0
    for row in ast.walk(value):
        if isinstance(row,ast.Call)and ast.unparse(row.func)=='save'and row.args and isinstance(row.args[0],ast.Constant)and row.args[0].value==original_save:
            row.func=ast.Name(id='caller_audit_save',ctx=ast.Load());changes+=1
    need(changes==1,'exact_one_prepared_save_only_redirected_to_audit_record')
    values={**scope,'caller_audit_save':audit_save};exec(compile(ast.fix_missing_locations(ast.Module(body=[value],type_ignores=[])),str(Path(__file__).absolute()),'exec'),values)
    return values[name]


def cache_inverse_measurement(session,audit_save):
    need(session.source.inverse,'cache_inverse_callback_requires_actual_inverse_source_session')
    cache,host=session.cache,session.host;committed=cache.document(cache.BASE/'sql-committed.json')
    cache.validate_reads(host)
    packet={'mode':'inverse','planSha256':sha(committed['resultJson'].encode()),'postProof':{'catalog':host.read_rehearsal['after']}}
    raw=session.g.public(OPS/'ypal-cache-guard-owner-v1.py','c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba')
    callback=prepared_callback(raw,'inverse','prepared',{**cache.__dict__,'host':host,'committed':committed},'sql-inverse-prepared.json',audit_save)
    return measure(session,'cache-inverse',lambda:callback(packet))


def reader_callback_measurement(session):
    need(not session.source.inverse,'forward_reader_callback_measurement_requires_forward_session')
    root,proof,c=session.root,session.proof,session.context
    if (root.BASE/'operation.json').exists():op=root.operation(proof)
    else:op=root.review(proof,c.inputs)
    enabled=c.logins_enabled();mode='reader-after-login'if enabled else'reader-before-login'
    def run():
        root.prepublication(c,op);c.cache.legacy_http(c.host,True)
        return {'allOriginalPrepublicationPredicates':True,'twoLOGINCurrentlyEnabled':enabled,
                'ownedBootAndReloadEffectsNotExecuted':True}
    # The unchanged publication callback can dispatch one bounded60s reload.
    # Reserve another10s for its exact file moves/fsync. This is an explicit
    # allowance, not a claim to have rehearsed service effects in this capture.
    return measure(session,mode,run,70_000_000_000)


def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def directory(branch,name):
    import stat
    need(branch in{'captures','attempts'}and type(name)is str and re.fullmatch('[a-z][a-z0-9-]{0,47}',name),'fixed_bounded_publication_caller_audit_path_required')
    for folder in[BASE,BASE/branch]:
        parent=folder.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==parent.st_gid==0 and not parent.st_mode&0o022,'protected_real_caller_audit_parent_required')
        try:folder.mkdir(mode=0o700);sync(folder.parent)
        except FileExistsError:pass
        row=folder.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700,'root_private_publication_caller_audit_directory_required')
    folder=BASE/branch/name;folder.mkdir(mode=0o700);sync(folder.parent);return folder


def qualify(session,capture_id):
    folder=directory('captures',capture_id);session.g.exclusive(folder/'intent.json',timing_key(session,'qualification-intent'))
    labels=[]
    def saved(label,value):
        need(label not in labels and re.fullmatch(r'[a-z0-9-]+\.json',label),'one_private_timing_observation_per_original_prepared_label_required');labels.append(label)
        session.g.exclusive(folder/('timing-only-'+label),{'neverProductionPreparedACK':True,'value':value})
    try:
        if session.key['target']=='cache':
            value=cache_inverse_measurement(session,saved)if session.source.inverse else cache_callback_measurement(session,saved)
        else:value=reader_callback_measurement(session)
        value['fullPostflight']=session.finish()
        digest=session.g.exclusive(folder/'result.json',value)
        return {'completed':True,'captureId':capture_id,'sha256':digest,'elapsedNanoseconds':value['elapsedNanoseconds'],
                'reservedEffectNanoseconds':value['reservedEffectNanoseconds'],'productionCOMMITQualified':False}
    except Exception as error:
        session.g.exclusive(folder/'failure.json',{'format':FORMAT,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+',str(error))else type(error).__name__})
        raise


def attempt(session,attempt_id,action,run):
    folder=directory('attempts',attempt_id)
    session.g.exclusive(folder/'intent.json',{'format':FORMAT,'operatorSha256':own_sha(),'context':session.key,'action':action,
         'sourcePreflight':session.readonly_preflight,'oldOwnerReceiptsRewritten':False,'automaticEffectRetryAllowed':False})
    failure=None;result=None
    try:
        session.source.current(inverse=session.source.inverse)
        result=run()
        session.g.exclusive(folder/'business-result.json',result)
    except Exception as error:failure=error
    try:postflight=session.finish()
    except Exception as error:
        postflight={'validated':False,'fixedCode':str(error)if type(error)is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+',str(error))else type(error).__name__}
        if failure is None:failure=error
    session.g.exclusive(folder/'result.json',{'format':FORMAT,'completed':failure is None,'action':action,'context':session.key,'postflight':postflight,
        'businessResultPresent':result is not None,'fixedCode':None if failure is None else str(failure)if type(failure)is RuntimeError and re.fullmatch('[a-zA-Z0-9_]+',str(failure))else type(failure).__name__,
        'originalOwnerJournalsAreEffectAuthority':True,'automaticEffectRetryAllowed':False})
    if failure is not None:raise failure
    return result


def execute_cache(session,action,args,attempt_id,timing_receipt=None):
    cache,host=session.cache,session.host
    inverse_actions={'inverse-review','inverse','finish-inverse','reconcile-inverse'}
    need((action in inverse_actions)is session.source.inverse,'cache_action_and_explicit_source_direction_must_agree')
    functions={'review':cache.review,'rehearse':cache.rehearsal,'drain':cache.drain,'reconcile-stop':cache.reconcile_stop,
       'commit':cache.commit,'reconcile-commit':cache.reconcile_commit,'prepare-ack':cache.prepare_ack,'inspect':cache.inspect,
       'inverse-review':cache.inverse_review,'inverse':cache.inverse,'finish-inverse':cache.finish_inverse,'reconcile-inverse':cache.reconcile_inverse}
    need(action in functions and type(args)is list,'finite_existing_cache_action_only')
    if action=='commit':require_timing(session,timing_receipt,'cache-prepared')
    if action in{'inverse','finish-inverse'}:
        # An inverse SQL callback has a different graph and source branch. A
        # forward timing record is never accepted as its deadline evidence.
        require_timing(session,timing_receipt,'cache-inverse')
    def run():
        with host.read_host.primitives['sdk'].lock():return functions[action](host,*args)
    return attempt(session,attempt_id,action,run)


def execute_reader(session,action,args,attempt_id,timing_receipt=None):
    root,proof=session.root,session.proof
    inverse_actions={'inverse-review','inverse','finish-inverse','reconcile-inverse'}
    need((action in inverse_actions)is session.source.inverse,'reader_action_and_explicit_source_direction_must_agree')
    functions={'review':root.review,'admit-readers':root.admit_readers,'publication-review':root.publication_review,
       'publish':root.publish,'continue-review':root.continue_review,'continue-readers':root.continue_readers,
       'reconcile-roles':root.reconcile_roles,'reconcile-publication':root.reconcile_publication,'inverse-review':root.inverse_review,
       'inverse':root.inverse,'finish-inverse':lambda p,*v:root.inverse(p,*v,finish=True),'reconcile-inverse':root.reconcile_inverse}
    need(action in functions and type(args)is list,'finite_existing_reader_action_only')
    need(action not in{'inverse','finish-inverse'},'reader_inverse_execution_needs_actual_separate_context_and_mode_window_qualifications')
    if action in{'admit-readers','publish'}:require_timing(session,timing_receipt,'reader-before-login'if action=='admit-readers'else'reader-after-login')
    generation=proof.module('ypal-native-generation-v1.py',proof.DEPENDENCIES['ypal-native-generation-v1.py'])
    def run():
        with root.transition_lock(),generation.lock():return functions[action](proof,*args)
    return attempt(session,attempt_id,action,run)


def reader_inverse_core(session):
    """Executable unchanged inverse for an independently qualified caller.

    This does not authorize/dispatch any effect or create a timing receipt.
    The per-boundary actual-prefix timing gate is not replaced by a generic
    forward measurement. The complete original inverse/XID bodies remain.
    """
    need(session.source.inverse and session.source.prepared and session.root is not None,'actual_explicit_inverse_source_session_and_reader_context_required')
    return session.root,session.proof,session.context


if __name__=='__main__':
    print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
                     'productionTimingQualified':False,'existingOwnersModified':False}))
