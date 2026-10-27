"""Actual original constructors/validators; private data and OS/SQL observations are explicit I/O fixtures."""
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=load('ypal-native-readiness-generation-binding-v1.py')
context_tests=load('ypal-native-readiness-context-v2.test.py')
generation_tests=load('ypal-ordinary-generation-accept-v3.test.py')
attempt_tests=load('ypal-ordinary-generation-attempt-v1.test.py')
prepared_tests=load('ypal-native-readiness-prepared-binding-v1.test.py')

class Controls(unittest.TestCase):
    def setUp(self):
        self.native=context_tests.Controls();self.native.setUp();self.addCleanup(self.native.doCleanups)
        self.ctx=self.native.ctx;self.lifecycle=self.native.lifecycle
        self.enterContext(patch.object(m,'public',side_effect=context_tests.local))

    def bound_generation(self):
        owner=load(m.GENERATION);owner.__file__=str(m.OPS/m.GENERATION)
        owner.public=generation_tests.base.local_public
        class Factory(types.ModuleType):
            def __getattribute__(self,name):
                original=super().__getattribute__(name)
                if name!='namespace':return original
                def namespace(*args,**kwargs):
                    value=original(*args,**kwargs)
                    value.protected=generation_tests.base.local_public
                    value.load=generation_tests.base.local_load
                    return value
                return namespace
        owner.implementation=m.clone(owner.implementation,{'types':types.SimpleNamespace(ModuleType=Factory)})
        result=m.generation(owner,self.ctx)
        current=m.closure(result.validate_candidate_database_current)['current']
        return result,current.__globals__['prepared_attempt']

    def static_fixture(self,prepare):
        _,attempt=prepare();wrapper=attempt.static_legacy_host
        original=m.closure(wrapper)['retained'];events=[]
        common=context_tests.load(context_tests.m.COMMON.name);common.__file__=str(context_tests.m.COMMON)
        creator=context_tests.m.Proxy(context_tests.policy_tests.old_tests.m,__file__=str(context_tests.m.CREATOR))
        created=__import__('json').loads((self.lifecycle.legacy.base/'created.json').read_bytes())
        read={'admissionSha256':'4'*64};execution={'candidateReceiptSha256':'1'*64,'candidateInputSha256':'2'*64,
            'readConfig':read,'sourcesSha256':'3'*64}
        selectors=types.SimpleNamespace(FORMAT='explicit-selector-private-fixture',FILES=['one.json'])
        entry=types.SimpleNamespace(common=lambda:common,CANDIDATES=Path('/explicit/selectors.py'),CANDIDATES_SHA='a'*64,CANDIDATE_BASE=Path('/explicit/private-selector'))
        intent={'format':selectors.FORMAT,'operatorSha256':entry.CANDIDATES_SHA,'candidateInputSha256':execution['candidateInputSha256'],
            'readConfig':read,'readIdentity':common.READ_IDENTITY,'readSchema':common.READ_SCHEMA,'files':{'one.json':m.sha(b'private selector bytes')}}
        result={**intent,'staged':True,'selected':False,'generationStarted':False,'cacheStarted':False,'guardTransitionExecuted':False,
            'databaseWrites':0,'servicesChanged':False,'providerRequests':0,'permissionAdmissionAcknowledged':False}
        storage=types.SimpleNamespace(document=lambda path,*args:copy.deepcopy(intent if path.name=='intent.json'else result),protected=lambda _:b'private selector bytes')
        primitive={'host':types.SimpleNamespace(s=storage,raw=types.SimpleNamespace(observer=object()),source_op={}), 'restoreReceipt':{}}
        intake=types.SimpleNamespace(query_components=lambda:{'components':{'privilegedSourcePrimitives':primitive,'readerHost':types.SimpleNamespace(query=lambda _:None)}},
            document=lambda *_:copy.deepcopy(created))
        meta=types.SimpleNamespace(RETAINED_SHA='retained-fixture',INSTALLER_SHA='installer-fixture',INSTALL_SHA='install-fixture',
            READ=common.READ_SCHEMA,IDENTITY=common.READ_IDENTITY,RELEASE=created['sourceRelease'])
        def module(path,digest):
            if Path(path)==context_tests.m.CREATOR:return creator
            if digest=='installer-fixture':return types.SimpleNamespace(installed=lambda *_:events.append('metadata-installer'))
            return object()
        common.module=module
        common.metadata_primitives=context_tests.m.clone(common.metadata_primitives,{'module':module,'candidate_context':lambda _: {'createdReceiptSha256':self.lifecycle.created_sha},
            'intake':lambda:intake,'candidate_namespace':lambda _:meta})
        common.load_input=lambda _:copy.deepcopy(execution)
        common.metadata_namespace=lambda _:types.SimpleNamespace(Host=type('PrivateMetadataHostIOFixture',(),{}))
        common.read_config=lambda _:copy.deepcopy(read)
        common.admission_reference=lambda _: {'immutable-admission-IO-fixture':True}
        common.authenticate_admission=lambda _,ref:copy.deepcopy(ref)
        common.acknowledge_candidates=lambda *_: {'immutable-selector-ACK-IO-fixture':True}
        common.execution_context=lambda *_:events.append('execution-context')
        retained=types.SimpleNamespace(Host=type('PrivateRetainedHostIOFixture',(),{}),module=lambda *_:selectors,CANDIDATE_SHA='b'*64)
        args=types.SimpleNamespace(metadata_input_sha='c'*64,read_ack=read['admissionSha256'],install_ack='d'*64)
        attempt.load=lambda _:types.SimpleNamespace(installed=lambda *_:events.append('generation-installer')or{'installed':True})
        query_parts=self.lifecycle.legacy.i.query_components()
        query_parts['components']['readerHost'].query=lambda _:copy.deepcopy(self.lifecycle.actual['target'])
        self.enterContext(patch.object(self.lifecycle.legacy.i,'query_components',return_value=query_parts))
        return original,wrapper,entry,retained,args,events,result,attempt

    def test_actual_336_source_manifest_and_no_effect_dispatch(self):
        m.authenticate();self.assertEqual(len(m.SOURCE_PINS)+1,336)
        self.assertNotIn('main',m.bind.__code__.co_names)

    def test_actual_nested_static_constructor_reproduces_old_body_and_accepts_exact_policy(self):
        _,prepare=self.bound_generation();old,new,entry,retained,args,events,result,_=self.static_fixture(prepare)
        with self.assertRaisesRegex(RuntimeError,'OIDs_owner_body_columns'):old(entry,retained,args)
        actual=new(entry,retained,args)
        self.assertEqual(actual.h.created['target'],self.lifecycle.before['target'])
        self.assertFalse(actual.h.inverse_mode);self.assertEqual(events.count('execution-context'),1)
        self.assertEqual(actual.candidates,result)
        self.assertFalse(hasattr(actual,'oldWholeGeneration3CurrentPassed'))
        self.lifecycle.actual['target']['relations'][0]['columns'].append({'foreign':'column'})
        with self.assertRaises(RuntimeError):new(entry,retained,args)

    def test_actual_attempt_Host_constructor_dispatches_policy_static_common(self):
        _,prepare=self.bound_generation();old,new,entry,retained,args,events,_,attempt=self.static_fixture(prepare)
        config={'metadataInputSha256':args.metadata_input_sha,'selectorCandidateSha256':'a'*64,
            'originalInstallSha256':args.install_ack,'readAdmissionSha256':args.read_ack,'metadataOperationSha256':'b'*64,
            'metadataSelectedSha256':'c'*64,'metadataProvenanceFile':'private-provenance.json',
            'metadataProvenanceSha256':'d'*64,'installSha256':'e'*64}
        installer=types.SimpleNamespace(DIGEST=attempt.ARTIFACT,installed=lambda *_:{'artifactDigest':attempt.ARTIFACT,'manifestSha256':attempt.ARTIFACT_MANIFEST})
        watch=types.SimpleNamespace(UNIT=attempt.UNIT,WORK=attempt.WORK,APP=attempt.APP,ARTIFACT=Path('/explicit-artifact')/attempt.ARTIFACT)
        entry.namespace=lambda *_:retained
        def source(name):
            if name=='ypal-ordinary-generation-v5c.py':return entry
            if name==attempt.MONITOR.name:return watch
            return installer
        attempt.config_checked=lambda value:value;attempt.document=lambda *_:copy.deepcopy(config)
        attempt.protected=generation_tests.base.local_public;attempt.load=source
        attempt.static_legacy_host=old
        with self.assertRaisesRegex(RuntimeError,'OIDs_owner_body_columns'):attempt.Host('f'*64,current=False)
        attempt.static_legacy_host=new
        actual=attempt.Host('f'*64,current=False)
        self.assertFalse(actual.current_authority);self.assertEqual(actual.h.created['target'],self.lifecycle.before['target'])
        self.assertEqual(actual.install['artifactDigest'],attempt.ARTIFACT);self.assertIs(actual.watch,watch)

    def test_complete_original_current_validator_and_retained_capsule_gates_keep_candidate_producer(self):
        bound,prepare=self.bound_generation();current=m.closure(bound.validate_candidate_database_current)['current']
        # The public acceptance dispatcher and complete original retained-current
        # body execute. Private accepted-candidate/worker observations are fixtures.
        h,docs,op,runtime,result=attempt_tests.retained_fixture()
        h.h.query.return_value=[{'id':'105','state':'ready','published':False}]
        source=attempt_tests.m
        retained=m.clone(source.retained_current,{'document':lambda path,*_:copy.deepcopy(docs[path.name]),
            'terminal_worker':lambda *_:({},runtime,result),'load':lambda _:types.SimpleNamespace(protected_inputs=lambda:runtime['inputSha256'])})
        candidate={'format':'explicit-immutable-candidate-format','operatorSha256':m.SOURCE_PINS[m.GENERATION],'generationId':'105',
            'sourceRelease':'immutable-release','readIdentity':'immutable-read-identity','predecessorGenerationId':'103'}
        validator=m.clone(source.validate_candidate_database_current,{'candidate_context':lambda sha:(copy.deepcopy(candidate),h),'retained_current':retained,
            'CANDIDATE_FORMAT':candidate['format']})
        def exports(entry,attempt):return None,None,{'validate_candidate_database_current':validator}
        current.__globals__['acceptance_functions']=exports
        with patch.object(source.os.path,'lexists',return_value=False):
            value=bound.validate_candidate_database_current('e'*64)
            self.assertEqual(value['operatorSha256'],candidate['operatorSha256']);self.assertEqual(value['generationId'],'105')
            self.assertFalse(value['generationCurrentObserver']['oldWholeGeneration3CurrentPassed'])
            self.assertEqual(value['generationCurrentObserver']['operatorSha256'],m.sha(context_tests.local(m.FILE)))
            result['ownedTermination']['remainingBackends']=1
            with self.assertRaises(RuntimeError):bound.validate_candidate_database_current('e'*64)

    def test_changed_generation_owner_or_policy_refuses_without_validator(self):
        owner=load(m.GENERATION);owner.__file__='/explicit/foreign.py'
        with self.assertRaises(RuntimeError):m.generation(owner,self.ctx)
        bound,_=self.bound_generation();self.ctx.refs['producerSha256']='f'*64
        with self.assertRaises(RuntimeError):bound.validate_candidate_database_current('e'*64)

    def test_actual_Host_loader_and_both_owned_identity_and_full_timing_bindings(self):
        prepared=prepared_tests.Controls();prepared.setUp();self.addCleanup(prepared.doCleanups)
        constructor=prepared_tests.m.bind(prepared.session);session=prepared.session;family=prepared.family
        provider=family.provider();session.readonly_preflight={'explicitSourcePreflightIOFixtureOnly':True};session.source.kind='forward-active'
        def initialize(host,config):
            host.config=config;host.cache=prepared.cache;host.inverse_mode=False;host.metadata_primitives=lambda:prepared.primitives
        original_doc=family.authority_context.value.document
        def document(path,digest=None):
            if Path(path)==family.authority_context.value.PRIOR_INPUT:return copy.deepcopy(prepared.f.old.config)
            return original_doc(path,digest)
        self.enterContext(patch.object(provider,'common',return_value=types.SimpleNamespace(intake=lambda:types.SimpleNamespace(document=lambda *_:copy.deepcopy(prepared.f.old.config)))))
        self.enterContext(patch.object(provider,'namespace',return_value=prepared.namespace))
        self.enterContext(patch.object(prepared.namespace,'cache_runtime',return_value=prepared.cache))
        self.enterContext(patch.dict(prepared.cache.Host.__init__.__globals__,initialize_current=initialize))
        self.enterContext(patch.object(family.authority_context.value,'document',side_effect=document))
        session.cache_context('4'*64);raw=session.host.prerequisites.__func__;calls=[];g=raw.__globals__;config=session.host.config
        candidate={'format':load(m.GENERATION).CANDIDATE_FORMAT,'completed':True,'built':True,'validated':True,'published':False,
            'sourceRelease':g['RELEASE'],'readIdentity':g['IDENTITY'],'readAdmissionSha256':config['readAdmissionSha256'],
            'metadataSelectedSha256':config['metadataSelectionSha256'],'metadataProvenanceSha256':config['metadataProvenanceSha256'],
            'candidateSelectorsSha256':g['CANDIDATE_SHA'],'predecessorGenerationId':'103','generationId':'105'}
        proof={'validated':True,'operatorSha256':g['GENERATION_OWNER_SHA'],'receiptSha256':config['generationSha256'],'generationId':'105',
            'sourceRelease':g['RELEASE'],'readIdentity':g['IDENTITY'],'published':False,'globalContextUnchanged':True,
            'sourceReadinessQualified':False,'metadataCurrentReadinessQualified':False,'readAdmissionGraphQualified':False}
        owner=types.SimpleNamespace(validate_candidate_database_current=lambda _:copy.deepcopy(proof))
        def modules(path,digest):calls.append((path,digest));return owner if path==g['GENERATION_OWNER']else object()
        def documents(path,digest=None):
            if path==g['GENERATION']:return copy.deepcopy(candidate)
            if path.name=='selected.json':return{'selected':True}
            return{'completeForCurrentPublishedArchiveBase':True,'remainingPublished':0,'publicationProof':{'allPublishedCanonical':True}}
        session.host.prerequisites=types.MethodType(m.clone(raw,{'module':modules,'document':documents}),session.host)
        session.host.query=lambda _: {'current':'103','id':'105','state':'ready','published':False,'release':g['RELEASE'],'identity':g['IDENTITY'],'baseFrame':True}
        session.host.metadata_current=lambda *_:{'explicitFullMetadataIOFixtureOnly':True}
        before=session.host.prerequisites.__func__.__code__;binding=m.bind(session)
        self.assertEqual(session.host.prerequisites.__func__.__code__,before)
        with patch.object(m,'generation',side_effect=lambda actual,policy:actual):
            result=session.host.prerequisites();self.assertEqual(result['generationId'],'105')
            self.assertEqual([row[0]for row in calls],[g['META_OWNER'],g['GENERATION_OWNER']])
            proof['generationId']='106'
            with self.assertRaises(RuntimeError):session.host.prerequisites()
        identity=family.authority_context.value.new_identity(session.cache,session.host)
        self.assertEqual(identity['preparedConstructorBinding'],constructor);self.assertEqual(identity['generationCurrentBinding'],binding)
        self.assertEqual(session.cache.continuation_context['generationCurrentBinding'],binding)
        self.assertEqual(session.cache.continuation_context['context']['generationCurrentBinding'],binding)
        self.assertEqual(session.continuation_caller.timing_key(session,'cache-prepared-held')['generationCurrentBinding'],binding)
        with self.assertRaises(RuntimeError):family.authority_context.value.new_identity(session.cache,object())
        with self.assertRaises(RuntimeError):m.bind(session)

    def test_changed_static_constructor_or_Host_dispatch_globals_refuse_before_current(self):
        _,prepare=self.bound_generation();entry,attempt=prepare();static=attempt.static_legacy_host
        original=m.closure(static)['retained'];attempt.static_legacy_host=original
        real_init=attempt.Host.__init__;attempt.Host.__init__=m.clone(real_init,{'explicitForeignNamespace':True})
        cells=tuple((lambda value:lambda:value)(lambda:(entry,attempt)).__closure__[0]if name=='prepare'else cell
            for name,cell in zip(prepare.__code__.co_freevars,prepare.__closure__))
        foreign=types.FunctionType(prepare.__code__,prepare.__globals__,prepare.__name__,prepare.__defaults__,cells)
        with self.assertRaisesRegex(RuntimeError,'shared_Host_namespace'):foreign()

if __name__=='__main__':unittest.main()
