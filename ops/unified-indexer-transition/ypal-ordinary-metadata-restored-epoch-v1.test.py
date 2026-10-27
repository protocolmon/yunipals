"""Real metadata factories and pure ACK bodies; lifecycle I/O is explicit."""
import copy
import contextlib
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
bridge=load('ypal-ordinary-metadata-restored-epoch-v1.py')
observation=load('ypal-ordinary-metadata-current-observation-v1.test.py')
template=load(bridge.TEMPLATE);retry=load(bridge.RETRY)
c2base=load('ypal-native-metadata-approval-inverse-v1.py')
observer=observation.observer
_origins={}
def public(path,digest=None,maximum=4000000):
    name=Path(path).name
    if name not in _origins:
        target=HERE/name
        if not target.exists():
            matches=list(HERE.parent.rglob(name));matches=[item for item in matches if item.is_file()]
            if digest is not None:matches=[item for item in matches if bridge.sha(item.read_bytes())==digest]
            if len(matches)!=1:raise AssertionError('one actual local source '+name)
            target=matches[0]
        _origins[name]=target
    raw=_origins[name].read_bytes()
    if len(raw)>maximum or digest is not None and bridge.sha(raw)!=digest:raise RuntimeError('actual_restored_bridge_fixture_bytes_required')
    return raw

class Controls(unittest.TestCase):
    def setUp(self):
        self.forward=observation.Controls('test_current_actor_is_bookended_against_exact_owned_ACK')
        self.forward.setUp();self.addCleanup(self.forward.doCleanups)
        self.manifest=json.loads(public(bridge.OPS/bridge.READER_MANIFEST))
        self.refs={'mode':'restored','resultSha256':'2'*64,'inputSha256':'3'*64,
            'producerSha256':bridge.SOURCE_PINS[bridge.INVERSE],'manifestSha256':bridge.SOURCE_PINS[bridge.INVERSE_MANIFEST]}
        actor=copy.deepcopy(self.forward.actor)
        actor['main'].update(pid=1180800,startTicks=800)
        actor['unit'].update(MainPID='1180800',InvocationID='fixture-owned-CF333')
        actor['unit']['ExecStart']=actor['unit']['ExecStart'].replace(observer.WORKER,c2base.RESTORED_WORKER).replace('pid=1180697','pid=1180800')
        self.ack={**copy.deepcopy(self.forward.ack),'format':bridge.INVERSE_FORMAT,'operatorSha256':self.refs['producerSha256'],
            'receiptSha256':self.refs['resultSha256'],'inputSha256':self.refs['inputSha256'],'operationSha256':'4'*64,
            'upgradeRefs':copy.deepcopy(self.forward.refs),'upgradeOperationSha256':self.forward.ack['operationSha256'],
            'actor':actor,'artifactDigest':template.PREDECESSOR_ARTIFACT,'artifactManifestSha256':template.PREDECESSOR_MANIFEST,
            'workerSha256':template.PREDECESSOR_WORKER_SHA,'wholeMetadataInverseQualified':False}
        self.actual_actor=copy.deepcopy(actor)
        self.actual_actor['unit']['ExecStart']=observation.pair['actualActor'].replace(observer.WORKER,c2base.RESTORED_WORKER)
        self.relation=types.FunctionType(c2base.restored_actor_relation.__code__,
            {**c2base.restored_actor_relation.__globals__,'module':lambda name:observer,'FORMAT':bridge.INVERSE_FORMAT,
             'own_sha':lambda:self.refs['producerSha256']},c2base.restored_actor_relation.__name__,c2base.restored_actor_relation.__defaults__,c2base.restored_actor_relation.__closure__)
        self.c2=types.SimpleNamespace(acknowledgement=Mock(side_effect=lambda *_:copy.deepcopy(self.ack)),restored_actor_relation=self.relation)
        def current(*_):
            return{**copy.deepcopy(self.ack),'actor':copy.deepcopy(self.actual_actor),'immutableAcknowledgementOnly':False,
                'currentActorQualified':True,'currentActorIsRawObserved':True,'originalOwner3CurrentPassed':False,
                'restoredExecStartPresentation':self.relation(self.actual_actor,self.ack['actor'])}
        self.c2.restored_actor_current=Mock(side_effect=current)
        self.actual_modules={bridge.TEMPLATE:template,bridge.CURRENT:observation.actual,bridge.RETRY:retry,
            bridge.INVERSE:types.SimpleNamespace(composition=lambda:self.c2)}
        def module(name):
            # All source/manifest bytes stay genuine. Only lifecycle receipt and
            # current actor I/O are explicit fixtures.
            public(bridge.OPS/name,bridge.SOURCE_PINS[name])
            return self.actual_modules[name]
        self.enterContext(patch.object(bridge,'public',side_effect=public))
        self.enterContext(patch.object(bridge,'module',side_effect=module))
        self.enterContext(patch.object(bridge,'utility',return_value=self.forward.utility))
        self.enterContext(patch.object(bridge.os.path,'lexists',return_value=False))
    def epoch(self):return bridge.Epoch(self.refs,self.manifest,True)
    def test_separate_actual_source_closure_and_unchanged_reader_manifest(self):
        bridge.authenticate();epoch=self.epoch();self.assertTrue(epoch.ack['validated'])
        for changed in [{**self.manifest,'newBridge':'not actual455c'},{'files':{},'dependencies':{}}]:
            with self.assertRaisesRegex(RuntimeError,'unchanged_actual_reader5_manifest'):bridge.Epoch(self.refs,changed,True)
        self.c2.restored_actor_current.assert_not_called()
    def test_direction_and_inverse_producer_are_exact(self):
        for inverse in [False,'inverse']:
            with self.assertRaises(RuntimeError):bridge.Epoch(self.refs,self.manifest,inverse)
        for key,value in [('producerSha256','0'*64),('manifestSha256','1'*64),('mode','current')]:
            with self.assertRaises(RuntimeError):bridge.Epoch({**self.refs,key:value},self.manifest,True)
    def test_real_forward_cropped_binding_not_full_ACK_drives_reader_ancestry(self):
        epoch=self.epoch();recorded=epoch.forward.binding();epoch.reader_operation(recorded)
        self.assertNotIn('format',recorded['acknowledgement']);self.assertNotEqual(recorded['acknowledgement'],epoch.forward.ack)
        self.assertNotEqual(epoch.refs['producerSha256'],recorded['refs']['producerSha256'])
        self.assertNotEqual(epoch.refs['inputSha256'],recorded['refs']['inputSha256'])
        for key in recorded['acknowledgement']:
            changed=copy.deepcopy(recorded);changed['acknowledgement'][key]={'foreign':True}
            with self.assertRaisesRegex(RuntimeError,'cropped_upgrade_binding'):epoch.reader_operation(changed)
        for key in recorded['refs']:
            changed=copy.deepcopy(recorded);changed['refs'][key]='foreign'
            with self.assertRaises(RuntimeError):epoch.reader_operation(changed)
    def test_actual_C2_relation_returns_raw_observed_actor_without_ACK_substitution(self):
        epoch=self.epoch();before=copy.deepcopy(epoch.ack);value=epoch.current()
        self.assertEqual(value['actor'],self.actual_actor);self.assertNotEqual(value['actor'],epoch.ack['actor'])
        self.assertEqual(epoch.ack,before);self.assertEqual(value['restoredExecStartPresentation'],self.relation(self.actual_actor,self.ack['actor']))
        with self.assertRaisesRegex(RuntimeError,'only_actual_inverse2'):epoch.actor_relation(self.actual_actor,self.actual_actor)
    def test_ACK_upgrade_program_private_boot_and_flags_drift_refuse(self):
        for key,value in [('upgradeOperationSha256','0'*64),('boot',{'foreign':True}),('historicalActor',{'foreign':True}),
            ('workerSha256','0'*64),('wholeMetadataInverseQualified',True),('actor',self.forward.actor)]:
            before=copy.deepcopy(self.ack);self.ack[key]=value
            with self.assertRaises(RuntimeError,msg=key):self.epoch()
            self.ack=before
    def test_exact_classified_churn_repeats_complete_C2_leaf_and_retains_history(self):
        epoch=self.epoch();good=self.c2.restored_actor_current.side_effect
        self.c2.restored_actor_current.side_effect=[RuntimeError(retry.RETRY_CODE),RuntimeError(retry.RETRY_CODE),good()]
        self.assertEqual(epoch.current()['actor'],self.actual_actor);self.assertEqual(self.c2.restored_actor_current.call_count,3)
        self.assertEqual([row['discarded']for row in epoch.current_capture_attempts],[True,True,False])
        self.assertEqual(epoch.current_capture_history[0]['format'],bridge.FORMAT+'-capture')
    def test_unknown_error_stays_same_object_and_is_not_retried(self):
        epoch=self.epoch();error=PermissionError('actual permission fixture');self.c2.restored_actor_current.side_effect=error
        with self.assertRaises(PermissionError)as caught:epoch.current()
        self.assertIs(caught.exception,error);self.assertEqual(self.c2.restored_actor_current.call_count,1)
        self.assertEqual(len(error.metadata_current_capture_history),1)
    def test_original_metadata_inverse_intent_closes_C2_current_not_pure_ancestry(self):
        epoch=self.epoch();raw=bridge.encoded({'nativeActor':self.actual_actor,'nativeSessions':{'owned':['fixture']},'oldStillRunning':False})
        original=bridge.public.side_effect
        def with_intent(path,digest=None):return raw if Path(path)==bridge.LEGACY_BASE/'inverse-intent.json'else original(path,digest)
        with patch.object(bridge.os.path,'lexists',return_value=True),patch.object(bridge,'public',side_effect=with_intent):
            self.assertTrue(epoch.legacy_started())
            with self.assertRaisesRegex(RuntimeError,'not_available_after_original'):epoch.current()
            epoch.reader_operation(epoch.forward.binding())
        self.c2.restored_actor_current.assert_not_called()

    def test_original_inverse_actor_route_rechecks_pure_ancestry_then_delegates_raw_Host(self):
        raw=b'actual original metadata operation I/O fixture\n';operation_sha=bridge.sha(raw)
        self.ack['metadataOperationSha256']=self.forward.ack['metadataOperationSha256']=operation_sha
        epoch=self.epoch();selection={'nativeActor':self.forward.historical,'boot':self.forward.boot}
        host=types.SimpleNamespace(private=Mock(),s=types.SimpleNamespace(document=lambda *_:copy.deepcopy(selection),protected=lambda *_:raw))
        native=copy.deepcopy(self.actual_actor);epoch.raw_actor=Mock(return_value=native)
        intent=bridge.encoded({'nativeActor':native,'nativeSessions':{'actualRecordedNativeSessions':True},'oldStillRunning':False})
        public_original=bridge.public.side_effect
        def with_intent(path,digest=None):return intent if Path(path)==bridge.LEGACY_BASE/'inverse-intent.json'else public_original(path,digest)
        operation={'oldWriter':{'actualPrivateIO':True}}
        with patch.object(bridge.os.path,'lexists',return_value=True),patch.object(bridge,'public',side_effect=with_intent):
            value=epoch.actor(host,operation,False)
            self.assertIs(value,native);epoch.raw_actor.assert_called_once_with(host,operation,True,False)
            self.c2.restored_actor_current.assert_not_called();host.private.assert_called_once_with(operation['oldWriter'])
            selection['nativeActor']={'foreignHistoricalActor':True}
            with self.assertRaisesRegex(RuntimeError,'only_actual_owned_cf333'):epoch.actor(host,operation,False)
            self.assertEqual(epoch.raw_actor.call_count,1)

    def test_actual_provider_factories_bind_exact_refs_and_keep_function_bodies(self):
        family=load('ypal-ordinary-publication-continue-v5.test.py')
        case=family.Controls();case.setUp();self.addCleanup(case.doCleanups)
        self.forward.legacy_host();self.forward.legacy.BASE=bridge.LEGACY_BASE
        self.forward.ack['metadataInputSha256']=self.ack['metadataInputSha256']=case.config['metadataInputSha256']
        utility=family.e.consumer_utility();load_original=case.utility.load
        def loaded(path,digest):
            public(path,digest)
            if Path(path)==template.LEGACY:return types.SimpleNamespace(namespace=lambda _:self.forward.legacy)
            return load_original(path,digest)
        utility.load=loaded
        utility.public=public;utility.helper=lambda:case.h
        fn=utility.authority
        utility.authority=types.FunctionType(fn.__code__,{**fn.__globals__,'public':public,'load':loaded},fn.__name__,fn.__defaults__,fn.__closure__)
        with patch.object(bridge,'utility',return_value=utility),patch.object(bridge,'consumer_utility',return_value=utility):
            provider=family.actual[bridge.PROVIDER];bound=bridge.bind_provider(provider,self.refs)
            for name in ['config_checked','common','namespace','cache_runtime','create_phase','static_read_host']:
                self.assertIs(getattr(bound,name).__code__,getattr(provider,name).__code__,name)
                self.assertEqual(getattr(bound,name).__defaults__,getattr(provider,name).__defaults__,name)
                self.assertEqual(getattr(bound,name).__closure__,getattr(provider,name).__closure__,name)
            for refs in [None,{**self.refs,'resultSha256':'9'*64},{**self.refs,'mode':'current'}]:
                with self.assertRaisesRegex(RuntimeError,'same_exact_bound_inverse2_refs'):
                    bound.namespace(case.config,self.manifest,inverse=True,metadata_refs=refs)
                # create_phase reads the same protected static input before it
                # reaches namespace's exact per-call bound-ref check.
                static=types.SimpleNamespace(intake=lambda:types.SimpleNamespace(document=lambda *_:copy.deepcopy(case.config)))
                with patch.dict(bound.create_phase.__globals__,common=lambda:static):
                    with self.assertRaisesRegex(RuntimeError,'same_exact_bound_inverse2_refs'):
                        bound.create_phase({'cacheInputsSha256':'b'*64},self.manifest,inverse=True,metadata_refs=refs)
            self.c2.restored_actor_current.assert_not_called()
            control=self
            class BoundProvider:
                def __getattr__(self,name):return getattr(bound,name)if hasattr(bound,name)else getattr(case.frozen_provider,name)
                def namespace(self,config,manifest=None,source_guard=None,inverse=False):
                    return bound.namespace(config,control.manifest,source_guard,inverse,control.refs)
            with patch.dict(case.base.actual_provider.__globals__,p=BoundProvider()):namespace=case.base.actual_provider(True)
            cache=namespace.cache_runtime();epoch=cache.metadata_epoch
            self.assertEqual(epoch.refs,self.refs);self.assertTrue(cache.inverse_mode)
            epoch.reader_operation(epoch.forward.binding());self.c2.restored_actor_current.assert_not_called()
            self.assertEqual(epoch.manifest,self.manifest)
            # The actual retained Phase initializer executes unchanged. Its
            # receipt and static Host I/O are explicit; no current/source call.
            calls=[];prepared={'format':namespace.FORMAT,'operatorSha256':bridge.sha(public(Path(namespace.__file__))),
                'prepared':True,'nativeWorkerStarted':False,'nativeGenerationPublished':False,'config':case.config,
                'additionalReadAcknowledgementSha256':'c'*64}
            cache.Host=Mock(return_value=types.SimpleNamespace(config=case.config));cache.owned=Mock(return_value=({},{}))
            def document(path,digest):
                if Path(path).name=='prepared.json':return copy.deepcopy(prepared)
                if Path(path).name=='sql-committed.json':return{'genuineHeldReceiptIOFixture':True}
                if Path(path)==namespace.INPUT:return copy.deepcopy(case.config)
                raise AssertionError('unexpected actual Phase static input '+str(path))
            sdk=types.SimpleNamespace(protected=public,document=document,BASE=load('ypal-ordinary-read-admission-v5b.py').BASE)
            inputs={'cachePreparedSha256':'a'*64,'cacheInputsSha256':'b'*64,
                **{key:case.config[key]for key in ['readPlanSha256','readContextInputSha256']}}
            init=namespace.Phase.__init__
            with patch.dict(init.__globals__,cache_runtime=lambda:cache,read_module=lambda:sdk):phase=namespace.Phase(inputs,self.manifest)
            self.assertEqual(phase.cache.metadata_epoch.refs,self.refs);cache.Host.assert_called_once_with(case.config)
            phase.generation=lambda:(None,{'readAdmissionSha256':'a'*64,'metadataOperationSha256':self.ack['metadataOperationSha256']},None,None)
            phase.metadata_primitives=lambda:{'readConfig':{},'admission_ref':{}}
            metadata=namespace.metadata_current_namespace
            def construct(config,refresh,inverse,primitives,admission):
                calls.append(refresh());self.assertTrue(inverse);return types.SimpleNamespace(admission_pin='a'*64)
            original_inverse=metadata.metadata_inverse_context
            with patch.dict(original_inverse.__globals__,construct_context=construct,operation=lambda *_:{'actualOriginalMetadataOperationIO':True}):
                owner,host,operation=phase.metadata_inverse_context(lambda:{'actualVirtualCatalogOnly':True})
            self.assertEqual(calls,[{'actualVirtualCatalogOnly':True}]);self.assertEqual(operation,{'actualOriginalMetadataOperationIO':True})
            self.c2.restored_actor_current.assert_not_called()
            with self.assertRaisesRegex(RuntimeError,'does_not_confer_forward'):metadata.metadata(None,None,None,None)
            # Execute the exact exported API A calls. The namespace adapter
            # delegates the complete genuine factory, then installs only the
            # same static receipt/Host I/O fixtures before its real Phase init.
            factory_namespace=bound.namespace;constructed=[]
            with contextlib.ExitStack()as stack:
                def namespace_io(*args,**kwargs):
                    value=factory_namespace(*args,**kwargs);real_cache=value.cache_runtime()
                    real_cache.Host=Mock(return_value=types.SimpleNamespace(config=case.config))
                    real_cache.owned=Mock(return_value=({},{}))
                    stack.enter_context(patch.dict(value.Phase.__init__.__globals__,cache_runtime=lambda:real_cache,read_module=lambda:sdk))
                    constructed.append((value,real_cache));return value
                class DirectProvider:
                    def __getattr__(self,name):return getattr(bound,name)if hasattr(bound,name)else getattr(case.frozen_provider,name)
                    def namespace(self,config,manifest=None,source_guard=None,inverse=False):
                        self_outer.assertEqual(config,case.config)
                        return bound.create_phase(inputs,self_outer.manifest,source_guard,inverse,self_outer.refs)
                self_outer=self
                static=types.SimpleNamespace(intake=lambda:types.SimpleNamespace(document=lambda *_:copy.deepcopy(case.config)))
                with patch.dict(bound.create_phase.__globals__,namespace=namespace_io,common=lambda:static),\
                    patch.dict(case.base.actual_provider.__globals__,p=DirectProvider()):
                    direct_phase=case.base.actual_provider(True)
                self.assertEqual(len(constructed),1);actual_namespace,actual_cache=constructed[0]
                self.assertIsInstance(direct_phase,actual_namespace.Phase)
                self.assertIs(direct_phase.cache,actual_cache);self.assertEqual(actual_cache.metadata_epoch.refs,self.refs)
                actual_cache.Host.assert_called_once_with(case.config)
                actual_cache.metadata_epoch.reader_operation(epoch.forward.binding())
                self.c2.restored_actor_current.assert_not_called()
            # Bind the actual Reader5 Proof without editing its manifest. The
            # complete retained terminal prefix still checks intent, boot,
            # definition, invocation, loaded state and terminal sessions.
            reader=family.actual['ypal-ordinary-reader-continue-v5.py']
            proof=reader.Proof(bridge.SOURCE_PINS[bridge.READER_MANIFEST])
            legacy_owner=types.SimpleNamespace(BASE=bridge.LEGACY_BASE,DROP=Path('/fixture/metadata.conf'),BOOT=Path('/fixture/metadata.boot'))
            old_boot={'actualRetainedBootIO':True};created={'actualDropInodeIO':True}
            operation={'oldBoot':old_boot,'candidateDropSha256':'7'*64}
            intent={'nativeActor':copy.deepcopy(self.actual_actor),'nativeSessions':None,'oldStillRunning':False}
            docs={'inverse-intent.json':intent,'selected.json':{'nativeActor':self.forward.historical},'native-drop-created.json':created,
                'inverse-drop-remove-intent.json':{'sha256':operation['candidateDropSha256'],'identity':created},
                'inverse-boot-publish-intent.json':old_boot}
            proof.document=lambda path,*_:copy.deepcopy(docs[Path(path).name])
            legacy_owner.state=lambda _: {'InvocationID':self.actual_actor['unit']['InvocationID']}
            legacy_owner.link=lambda _:copy.deepcopy(old_boot);legacy_owner.loaded=Mock(return_value=True)
            host=types.SimpleNamespace(metadata_epoch=epoch,m=object())
            outer=types.SimpleNamespace(prepared={'config':{'metadataSelectionSha256':template.SELECTED_SHA}},terminal_sessions=Mock(return_value={'actualTerminalSessionsIO':True}))
            terminal=Mock(return_value={'genuineTerminalDelegateIO':True})
            with patch.object(proof.pure,'inverse_metadata_terminal',return_value=terminal),patch.object(bridge.os.path,'lexists',side_effect=lambda path:Path(path)==legacy_owner.BOOT):
                with self.assertRaisesRegex(RuntimeError,'cf333_epoch'):proof.metadata_terminal(legacy_owner,outer)(host,operation,self.actual_actor)
                self.assertIs(bridge.bind_proof(proof),proof)
                result=proof.metadata_terminal(legacy_owner,outer)(host,operation,self.actual_actor)
                self.assertEqual(result,{'genuineTerminalDelegateIO':True});terminal.assert_called_once_with(host,operation,self.actual_actor,{'actualTerminalSessionsIO':True})
                legacy_owner.loaded.assert_called_once_with(host,operation,False,True)
                changed=copy.deepcopy(intent);changed['nativeActor']['main']['startTicks']+=1;docs['inverse-intent.json']=changed
                with self.assertRaises(RuntimeError):proof.metadata_terminal(legacy_owner,outer)(host,operation,self.actual_actor)
                self.assertEqual(terminal.call_count,1)

if __name__=='__main__':unittest.main(verbosity=2)
