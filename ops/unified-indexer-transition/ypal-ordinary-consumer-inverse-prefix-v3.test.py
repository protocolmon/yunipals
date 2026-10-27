"""Reader5 static-source and distinct metadata-inverse lineage controls.

Synthetic inverse envelopes do not qualify runtime actors or real inverse ACKs.
"""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

m=load('ypal-ordinary-consumer-inverse-prefix-v3.py')
old=load('ypal-ordinary-consumer-inverse-prefix-v1.py')

def local(path,digest=None,maximum=4000000):
    target=HERE/Path(path).name
    if not target.exists():
        choices=[p for p in HERE.parent.rglob(Path(path).name)if p.is_file()]
        choices=[p for p in choices if digest is None or m.sha(p.read_bytes())==digest]
        m.need(len(choices)==1,'one_exact_actual_source_origin_required');target=choices[0]
    raw=target.read_bytes();m.need(len(raw)<=maximum and(digest is None or m.sha(raw)==digest),'exact_actual_local_source_required')
    return raw

class Controls(unittest.TestCase):
    def setUp(self):
        self.binding_class=load('ypal-ordinary-metadata-current-epoch-v1.py').Epoch
        self.enterContext(patch.object(m,'forward_epoch_module',return_value=types.SimpleNamespace(Epoch=self.binding_class)))

    def runtime(self):
        with patch.object(m,'public',side_effect=local):value=m.composition()
        value.protected=local
        return value

    def fixture(self):
        forward={'mode':'current','resultSha256':'a'*64,'inputSha256':'b'*64,'producerSha256':'c'*64,'manifestSha256':'d'*64}
        ack={key:'e'*64 for key in ['operationSha256','metadataInputSha256','metadataOperationSha256','metadataSelectedSha256']}
        ack.update(format='yunipals-native-metadata-approval-epoch-v3',validated=True,immutableAcknowledgementOnly=True,
            operatorSha256=forward['producerSha256'],receiptSha256=forward['resultSha256'],inputSha256=forward['inputSha256'],
            sourceActorQualified=False,READAuthorityQualified=False,publicationAuthorityQualified=False,financialAuthorityQualified=False,
            databaseWrites=0,serviceActions=0,providerCalls=0,
            artifactDigest='actualProgramFixture',artifactManifestSha256='actualManifestFixture',workerSha256='actualWorkerFixture',
            actor={'actualForwardActor':True,'unit':{'MainPID':'100','InvocationID':'actualForwardEpoch'}},
            boot={'actualBoot':True},historicalActor={'historicalActor':True},historicalBoot={'actualBoot':True})
        upgrade=types.SimpleNamespace(FORMAT=ack['format'],acknowledgement=Mock(return_value=copy.deepcopy(ack)),actor_current=Mock(return_value={
            'actor':ack['actor'],'boot':ack['boot'],'currentActorQualified':True}))
        temporary=tempfile.TemporaryDirectory(dir=HERE,prefix='program-inverse-lineage-');self.addCleanup(temporary.cleanup)
        legacy=types.SimpleNamespace(BASE=Path(temporary.name)/'original-metadata');legacy.BASE.mkdir()
        upgrade.METADATA='actual-old-metadata-source';upgrade.module=lambda _:types.SimpleNamespace(namespace=lambda _:legacy)
        prefix=types.SimpleNamespace(refs_checked=Mock(),owner_module=lambda:upgrade)
        runtime=types.SimpleNamespace(epoch_module=lambda:prefix)
        operation={'binding':{'metadata':{'metadataEpoch':self.binding_class.binding(
            types.SimpleNamespace(refs=copy.deepcopy(forward),ack=copy.deepcopy(ack),inverse=False))}}}
        upgrade.actor_current.return_value.update(validated=True,operatorSha256=m.SOURCE_PINS[m.OBSERVER],
            upgradeRefs=copy.deepcopy(forward),upgradeAcknowledgement=copy.deepcopy(ack),upgradeOperationSha256=ack['operationSha256'],
            originalOwner3CurrentPassed=False,sourceActorQualified=False,READAuthorityQualified=False,publicationAuthorityQualified=False,
            financialAuthorityQualified=False,databaseWrites=0,serviceActions=0,providerCalls=0)
        def relation(actual,recorded):
            m.need(actual==recorded,'actual_accepted_upgrade_epoch_required');return{'fixtureSameActualActor':True}
        self.enterContext(patch.object(m,'observer_module',return_value=types.SimpleNamespace(
            actor_current=upgrade.actor_current,actor_relation=relation)))
        refs={'inputSha256':'1'*64,'producerSha256':'2'*64,'manifestSha256':'3'*64}
        proof={'format':m.INVERSE_FORMAT+'-actor-prefix','validated':True,'operatorSha256':refs['producerSha256'],
            'inputSha256':refs['inputSha256'],'upgradeRefs':copy.deepcopy(forward),'upgradeOperationSha256':ack['operationSha256'],
            'phase':'owned-program-terminal','actor':None,'state':{'MainPID':'0'},'boot':ack['boot'],'removedFiles':{},
            'restoredResultSha256':None,'binding':{'actualOwnInverseOperationSha256':'4'*64},
            'sourceActorQualified':False,'READAuthorityQualified':False,'publicationAuthorityQualified':False,
            'financialAuthorityQualified':False,'wholeMetadataInverseQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        proof['bindingSha256']=m.sha(m.encoded(proof['binding']))
        owner=types.SimpleNamespace(actor_prefix_current=Mock(side_effect=lambda *_:copy.deepcopy(proof)),
            sha=m.sha,encoded=m.encoded,acknowledgement=Mock(),BASE=Path(temporary.name)/'new-program-inverse',
            protected=lambda path:Path(path).read_bytes(),restored_actor_relation=Mock(side_effect=relation))
        owner.BASE.mkdir()
        return runtime,operation,refs,forward,ack,upgrade,owner,proof

    def test_complete_actual_reader5_closure_is_authenticated_before_real_namespace(self):
        runtime=self.runtime();reader=runtime.entry()
        self.assertEqual(reader.FORMAT,'yunipals-ypal-ordinary-reader-continue-v5')
        self.assertEqual(runtime.READER_SHA,m.READER_SHA)
        self.assertEqual(runtime.LOADED_SOURCE_SHA,m.own_sha())
        self.assertEqual(m.SOURCE_PINS[m.INVERSE],m.sha((HERE/m.INVERSE).read_bytes()))
        self.assertEqual(m.SOURCE_PINS[m.BRIDGE],m.sha((HERE/m.BRIDGE).read_bytes()))
        self.assertNotIn('ypal-ordinary-consumer-prefix-source-v3.py',m.SOURCE_PINS)

    def test_one_changed_actual_prerequisite_refuses_before_namespace_evaluation(self):
        def changed(path,digest=None,maximum=4000000):
            if Path(path).name=='ypal-ordinary-reader-proof-v6.py':raise RuntimeError('changed exact prerequisite')
            return local(path,digest,maximum)
        with patch.object(m,'public',side_effect=changed),self.assertRaisesRegex(RuntimeError,'changed exact prerequisite'):m.composition()

    def test_all_original_reader_cache_catalog_and_full_frame_bodies_are_retained(self):
        runtime=self.runtime()
        for name in ['catalog_scope','cache_catalog_phase','make_context','bind_metadata_phase','preservation_methods',
            'prefix_file','consumer_definition','consumer_file','preservation_frames','stop_intent','reader_files','reader_boot',
            'terminal_loaded_reader','readers','metadata_loaded','cache_boot_archive','cache','capture']:
            actual_name='retained_'+name if name in {'cache','readers'}else name
            before=getattr(old,name).__code__;after=getattr(runtime,actual_name).__code__
            self.assertEqual(after.co_code,before.co_code,name);self.assertEqual(after.co_consts,before.co_consts,name)

    def test_old_reader3_and_future_result_in_inverse_refs_are_refused(self):
        runtime=self.runtime()
        with self.assertRaisesRegex(RuntimeError,'historical_Owner3_inverse_is_not'):runtime.metadata_direction({})
        with self.assertRaisesRegex(RuntimeError,'reader5_completed_forward'):runtime.validate_current_prefix({
            'resultSha256':'a'*64,'manifestSha256':old.MANIFEST_SHA,'producerSha256':old.READER_SHA})
        refs=self.fixture()[2]
        with self.assertRaisesRegex(RuntimeError,'inverse_input_and_source'):m.inverse_refs({**refs,'resultSha256':'f'*64})

    def test_full_ACK_and_genuine_cropped_Epoch_binding_are_distinct_and_exact(self):
        runtime,operation,refs,forward,ack,upgrade,owner,proof=self.fixture()
        recorded=operation['binding']['metadata']['metadataEpoch']
        self.assertNotEqual(recorded['acknowledgement'],ack)
        self.assertNotIn('immutableAcknowledgementOnly',recorded['acknowledgement'])
        with patch.object(self.binding_class,'__init__',side_effect=AssertionError('no Epoch constructor')),\
                patch.object(self.binding_class,'current',side_effect=AssertionError('no current observation')):
            self.assertEqual(m.forward_epoch(runtime,operation)[3],ack)
        for key in list(recorded['acknowledgement']):
            changed=copy.deepcopy(operation);changed['binding']['metadata']['metadataEpoch']['acknowledgement'][key]='foreign'
            with self.subTest(key=key),self.assertRaisesRegex(RuntimeError,'forward_upgrade_as_reader5'):
                m.forward_epoch(runtime,changed)
        for key in ['operatorSha256','receiptSha256','inputSha256','immutableAcknowledgementOnly','sourceActorQualified']:
            changed=copy.deepcopy(ack);changed[key]=True if key=='sourceActorQualified'else(False if key=='immutableAcknowledgementOnly'else'f'*64)
            upgrade.acknowledgement.return_value=changed
            with self.subTest(fullACK=key),self.assertRaisesRegex(RuntimeError,'full_immutable_forward_upgrade_ACK'):
                m.forward_epoch(runtime,operation)

    def test_current_upgrade_without_inverse_refs_never_infers_old_owner_inverse(self):
        runtime,operation,refs,forward,ack,upgrade,owner,proof=self.fixture()
        value=m.metadata_program(runtime,operation,None)
        self.assertIsNone(value['owner']);self.assertIsNone(value['restoredRefs'])
        self.assertEqual(value['proof']['actor'],ack['actor'])
        upgrade.actor_current.assert_called_once_with(forward['resultSha256'],forward['inputSha256'])

    def test_foreign_current_upgrade_actor_and_forward_ACK_are_refused(self):
        runtime,operation,refs,forward,ack,upgrade,owner,proof=self.fixture()
        upgrade.actor_current.return_value['actor']={'foreignActor':True}
        with self.assertRaisesRegex(RuntimeError,'accepted_upgrade_epoch'):m.metadata_program(runtime,operation,None)
        upgrade.acknowledgement.return_value={'foreignACK':True}
        with self.assertRaises((RuntimeError,KeyError)):m.metadata_program(runtime,operation,None)

    def test_real_observer_returns_actual_rendering_without_substituting_historical_ACK_actor(self):
        source=load('ypal-native-metadata-approval-current-observer-v1.test.py');case=source.Controls();case.setUp();self.addCleanup(case.doCleanups)
        refs={'mode':'current','resultSha256':source.m.RESULT_SHA,'inputSha256':source.m.INPUT_SHA,
            'producerSha256':source.m.OWNER_SHA,'manifestSha256':source.m.OWNER_MANIFEST_SHA}
        upgrade=types.SimpleNamespace(FORMAT=case.ack['format'],acknowledgement=lambda *_:copy.deepcopy(case.ack))
        prefix=types.SimpleNamespace(refs_checked=Mock(),owner_module=lambda:upgrade)
        operation={'binding':{'metadata':{'metadataEpoch':self.binding_class.binding(
            types.SimpleNamespace(refs=refs,ack=copy.deepcopy(case.ack),inverse=False))}}}
        observer=load(m.OBSERVER)
        with patch.object(m,'observer_module',return_value=observer),patch.object(observer,'actor_current',side_effect=lambda *_:case.capture()):
            value=m.metadata_program(types.SimpleNamespace(epoch_module=lambda:prefix),operation,None)
        self.assertEqual(value['proof']['actor'],case.actualActor)
        self.assertNotEqual(value['proof']['actor'],case.ackActor)
        self.assertTrue(value['proof']['currentActorObserver']['presentation']['actualActorReturned'])
        self.assertFalse(value['proof']['currentActorObserver']['originalOwner3CurrentPassed'])

    def test_distinct_inverse_input_producer_is_accepted_only_with_exact_upgrade_ancestry(self):
        runtime,operation,refs,forward,ack,upgrade,owner,proof=self.fixture()
        with patch.object(m,'inverse_module',return_value=owner):value=m.metadata_program(runtime,operation,refs)
        self.assertEqual(value['inverseRefs'],refs);self.assertIsNone(value['restoredRefs'])
        self.assertNotEqual(refs['inputSha256'],forward['inputSha256'])
        self.assertNotEqual(refs['producerSha256'],forward['producerSha256'])
        proof['upgradeOperationSha256']='f'*64
        with patch.object(m,'inverse_module',return_value=owner),self.assertRaisesRegex(RuntimeError,'distinct_metadata_inverse_actor_prefix'):
            m.metadata_program(runtime,operation,refs)

    def test_source_READ_or_whole_inverse_claim_cannot_enter_actor_prefix(self):
        for key in ['sourceActorQualified','READAuthorityQualified','publicationAuthorityQualified','financialAuthorityQualified','wholeMetadataInverseQualified']:
            runtime,operation,refs,forward,ack,upgrade,owner,proof=self.fixture();proof[key]=True
            with patch.object(m,'inverse_module',return_value=owner),self.assertRaisesRegex(RuntimeError,'without_source_or_READ'):
                m.metadata_program(runtime,operation,refs)

    def test_real_new_inverse_ACK_is_required_to_switch_restored_direction(self):
        runtime,operation,refs,forward,ack,upgrade,owner,proof=self.fixture();proof['restoredResultSha256']='5'*64
        proof['actor']={'unit':{'InvocationID':'actualNewCF333Epoch'},'main':{'pid':100,'startTicks':200}}
        restored={**ack,'immutableAcknowledgementOnly':True,'validated':True,'operatorSha256':refs['producerSha256'],
            'receiptSha256':proof['restoredResultSha256'],'inputSha256':refs['inputSha256'],
            'upgradeRefs':forward,'upgradeOperationSha256':ack['operationSha256'],'actor':proof['actor'],
            'artifactDigest':'cf333946766e6c858d143612827fc52fd2f860e22af746c56e571513729696cc',
            'artifactManifestSha256':'6f348bf121060215eb889364a233b48a35a8308f10c11b36a4c964a9869cb626',
            'workerSha256':'5c868742926fb5a56583bc25d87a814ce91c9509728c67df0ab507f8f40adc21'}
        owner.acknowledgement.return_value=restored
        with patch.object(m,'inverse_module',return_value=owner):value=m.metadata_program(runtime,operation,refs)
        self.assertEqual(value['restoredRefs'],{'mode':'restored','resultSha256':'5'*64,**refs})
        restored['upgradeRefs']={**forward,'producerSha256':'f'*64}
        with patch.object(m,'inverse_module',return_value=owner),self.assertRaisesRegex(RuntimeError,'authenticate_original_upgrade'):
            m.metadata_program(runtime,operation,refs)

    def test_later_original_metadata_inverse_uses_only_immutable_new_program_ACK(self):
        runtime,operation,refs,forward,ack,upgrade,owner,proof=self.fixture()
        legacy=upgrade.module(upgrade.METADATA).namespace(ack['metadataInputSha256'])
        (legacy.BASE/'inverse-intent.json').write_bytes(b'actual-owned-legacy-inverse-fixture')
        with patch.object(m,'inverse_module',return_value=owner),self.assertRaises(FileNotFoundError):m.metadata_program(runtime,operation,refs)
        raw=b'actual-existing-new-program-inverse-result';(owner.BASE/'result.json').write_bytes(raw)
        restored={**ack,'immutableAcknowledgementOnly':True,'validated':True,'operatorSha256':refs['producerSha256'],
            'receiptSha256':m.sha(raw),'inputSha256':refs['inputSha256'],'upgradeRefs':forward,'upgradeOperationSha256':ack['operationSha256'],
            'actor':{'actualRestoredProgramEpoch':True},'artifactDigest':'cf333946766e6c858d143612827fc52fd2f860e22af746c56e571513729696cc',
            'artifactManifestSha256':'6f348bf121060215eb889364a233b48a35a8308f10c11b36a4c964a9869cb626',
            'workerSha256':'5c868742926fb5a56583bc25d87a814ce91c9509728c67df0ab507f8f40adc21'}
        owner.acknowledgement.return_value=restored
        owner.actor_prefix_current.side_effect=AssertionError('strict program actor leaf must not run after actual9b inverse begins')
        with patch.object(m,'inverse_module',return_value=owner):value=m.metadata_program(runtime,operation,refs)
        self.assertEqual(value['proof']['phase'],'completed-program-inverse-ancestry-only')
        self.assertIsNone(value['proof']['actor']);self.assertFalse(value['proof']['currentActorQualified'])
        self.assertEqual(value['restoredRefs']['resultSha256'],m.sha(raw));owner.actor_prefix_current.assert_not_called()
        restored['upgradeOperationSha256']='f'*64
        with patch.object(m,'inverse_module',return_value=owner),self.assertRaisesRegex(RuntimeError,'authenticate_original_upgrade'):
            m.metadata_program(runtime,operation,refs)

    def test_new_inverse_static_backedge_or_nonliteral_map_refuses_before_evaluation(self):
        refs=self.fixture()[2];raw=b"SOURCE_PINS={}\nFORMAT='unused'\n"
        manifests=[{'format':m.INVERSE_FORMAT+'-source','files':{m.INVERSE:refs['producerSha256'],m.FILE.name:'6'*64}},
            {'format':m.INVERSE_FORMAT+'-source','files':{m.INVERSE:refs['producerSha256'],'upstream.py':'7'*64}}]
        for manifest in manifests:
            def files(path,digest=None,maximum=4000000):return m.encoded(manifest)if Path(path).name==m.INVERSE_MANIFEST else raw
            with (patch.object(m,'public',side_effect=files),
                patch.object(m,'evaluate',side_effect=AssertionError('must not evaluate')),
                self.assertRaises(RuntimeError)):
                m.inverse_module(refs)

    @unittest.skipUnless((HERE/m.INVERSE).exists() and (HERE/m.INVERSE_MANIFEST).exists(), 'actual metadata inverse2 producer not emitted yet; no future source substituted')
    def test_actual_new_inverse_literal_manifest_composes_without_any_input_or_actor_capture(self):
        # The input digest is an explicit fixture token and is never read here.
        # Both producer and manifest hashes come from the actual new files.
        refs={'inputSha256':'1'*64,'producerSha256':m.sha((HERE/m.INVERSE).read_bytes()),
            'manifestSha256':m.sha((HERE/m.INVERSE_MANIFEST).read_bytes())}
        with patch.object(m,'public',side_effect=local):owner=m.inverse_module(refs)
        self.assertEqual(owner.FORMAT,m.INVERSE_FORMAT)
        self.assertEqual(owner.FILE,m.OPS/m.INVERSE)
        self.assertTrue(callable(owner.actor_prefix_current));self.assertTrue(callable(owner.acknowledgement))
        self.assertNotIn(m.FILE.name,owner.SOURCE_PINS)
        self.assertNotIn('ypal-ordinary-consumer-prefix-source-v3.py',owner.SOURCE_PINS)

    def test_reader_terminal_exposes_only_actual_owned_native_stop_intent(self):
        case=RetainedReader5Controls();case.setUp();self.addCleanup(case.doCleanups)
        runtime=retained.m;case.stop();case.state={'MainPID':'0','InvocationID':'native'}
        with patch.object(runtime,'terminal_loaded_reader',return_value=case.state):rows=runtime.readers(case.root,case.c,case.op,True)
        self.assertTrue(rows['main']['ownedNativeStopIntentQualified'])
        self.assertEqual(rows['main']['ownedNativeStopIntentSha256'],case.digest('reader-main-stop-intent.json'))
        self.assertEqual(rows['main']['stoppedActor'],case.native)

    def test_cache_autoexit_has_no_owned_stop_and_foreign_epoch_cannot_qualify(self):
        case=RetainedReader5Controls();case.setUp();self.addCleanup(case.doCleanups)
        runtime=retained.m;cache,finish,context,state,actor=case.cache_fixture();state['MainPID']='0'
        row=runtime.cache(case.root,context,case.op,True)
        self.assertFalse(row['ownedNativeStopIntentQualified']);self.assertIsNone(row['stoppedActor'])
        (finish.BASE/'operation.json').write_bytes(m.encoded({'actualOwnedFinish':True}))
        intent={'bootId':case.root.boot(),'operationSha256':m.sha((finish.BASE/'operation.json').read_bytes()),
            'actor':copy.deepcopy(actor),'sessions':{'owned':[]}}
        (finish.BASE/'inverse-stop-intent.json').write_bytes(m.encoded(intent))
        row=runtime.cache(case.root,context,case.op,True)
        self.assertTrue(row['ownedNativeStopIntentQualified']);self.assertEqual(row['stoppedActor'],actor)
        intent['actor']['main']={'pid':1073741700,'startTicks':2}
        (finish.BASE/'inverse-stop-intent.json').write_bytes(m.encoded(intent))
        with self.assertRaisesRegex(RuntimeError,'exact_acknowledged_native_stop_epoch'):
            runtime.cache(case.root,context,case.op,True)

    def test_metadata_journal_frame_binds_original_upgrade_and_distinct_inverse_files(self):
        case=RetainedReader5Controls();case.setUp();self.addCleanup(case.doCleanups)
        runtime=retained.m;cache,finish,context,state,actor=case.cache_fixture()
        cache.META=case.base/'metadata-original';cache.META.mkdir()
        upgrade=types.SimpleNamespace(BASE=case.base/'actual-upgrade',protected=lambda path:Path(path).read_bytes())
        inverse=types.SimpleNamespace(BASE=case.base/'distinct-inverse',protected=lambda path:Path(path).read_bytes())
        upgrade.BASE.mkdir();inverse.BASE.mkdir()
        (upgrade.BASE/'result.json').write_bytes(b'actual immutable upgrade fixture')
        (inverse.BASE/'operation.json').write_bytes(b'actual distinct inverse fixture')
        context.owned_metadata_program={'upgrade':upgrade,'owner':inverse}
        first=runtime.journal_frame(case.root,context)
        self.assertIn(str(upgrade.BASE/'result.json'),first);self.assertIn(str(inverse.BASE/'operation.json'),first)
        (upgrade.BASE/'result.json').write_bytes(b'changed historical upgrade fixture')
        self.assertNotEqual(runtime.journal_frame(case.root,context),first)

    def test_restored_phase_factory_binds_new_bridge_without_current_observation(self):
        refs={'mode':'restored','resultSha256':'a'*64,'inputSha256':'b'*64,'producerSha256':'c'*64,'manifestSha256':'d'*64}
        recorded={'refs':{'mode':'current'},'acknowledgement':{'actualForwardACK':True}}
        operation={'binding':{'metadata':{'metadataEpoch':recorded}}}
        epoch=types.SimpleNamespace(reader_operation=Mock(),current=Mock(side_effect=AssertionError('no current in factory')))
        phase=types.SimpleNamespace(cache=types.SimpleNamespace(metadata_epoch=epoch))
        bound=types.SimpleNamespace(create_phase=Mock(return_value=phase))
        provider=types.SimpleNamespace(actualProvider5=True)
        bridge=types.SimpleNamespace(bind_provider=Mock(return_value=bound),bind_proof=Mock(side_effect=lambda value:value))
        proof=types.SimpleNamespace(module_context=lambda role:provider if role=='phase'else role)
        with patch.object(m,'bridge_module',return_value=bridge):
            m.bind_program_phase(types.SimpleNamespace(),proof,operation,{'restoredRefs':refs})
            self.assertEqual(proof.module_context('proof'),'proof')
            self.assertIs(proof.module_context('phase').create_phase('inputs','manifest'),phase)
        bridge.bind_proof.assert_called_once_with(proof)
        bridge.bind_provider.assert_called_once_with(provider,refs)
        bound.create_phase.assert_called_once_with('inputs','manifest',inverse=True,metadata_refs=refs)
        epoch.reader_operation.assert_called_once_with(recorded);epoch.current.assert_not_called()

    def test_changed_actual_restored_bridge_refuses_before_source_evaluation(self):
        def changed(path,digest=None,maximum=4000000):
            if Path(path).name==m.BRIDGE:raise RuntimeError('changed exact actual restored bridge')
            return local(path,digest,maximum)
        with patch.object(m,'public',side_effect=changed),patch.object(m,'evaluate',side_effect=AssertionError('no changed bridge evaluation')):
            with self.assertRaisesRegex(RuntimeError,'changed exact actual restored bridge'):m.bridge_module()

    def finish_refs(self,input_sha='1'*64):
        return {'inputSha256':input_sha,'producerSha256':m.SOURCE_PINS[m.CACHE_FINISH],
            'manifestSha256':m.SOURCE_PINS[m.CACHE_FINISH_MANIFEST]}

    def test_external_cache_owner_complete_actual_manifest_precedes_evaluation(self):
        refs=self.finish_refs()
        with patch.object(m,'public',side_effect=local):owner=m.cache_finish_owner(refs)
        self.assertEqual(owner.FORMAT,m.CACHE_FINISH_FORMAT)
        self.assertNotIn(m.FILE.name,owner.SOURCE_PINS)
        self.assertNotIn(m.CACHE_FINISH, json.loads(local(m.MANIFEST))['files'])
        def changed(path,digest=None,maximum=4000000):
            if Path(path).name==m.CACHE_FINISH_MANIFEST:return m.encoded({'format':'foreign','files':{}})
            return local(path,digest,maximum)
        with patch.object(m,'public',side_effect=changed),patch.object(m,'evaluate',side_effect=AssertionError('no changed owner evaluation')):
            with self.assertRaisesRegex(RuntimeError,'manifest_before_evaluation'):m.cache_finish_owner(refs)

    def test_external_cache_refs_require_actual_input_and_fixed_source_not_future_result(self):
        refs=self.finish_refs();self.assertEqual(m.cache_finish_refs(refs),refs)
        for key in ['producerSha256','manifestSha256']:
            with self.assertRaisesRegex(RuntimeError,'fixed_retained_stop'):m.cache_finish_refs({**refs,key:'2'*64})
        with self.assertRaisesRegex(RuntimeError,'three_refs'):m.cache_finish_refs({**refs,'resultSha256':'3'*64})
        original=Mock();root=types.SimpleNamespace(cache_finish_module=original)
        self.assertIsNone(m.bind_cache_finish(root,object(),{},None));self.assertIs(root.cache_finish_module,original)

    def finish_fixture(self):
        fixtures=load('ypal-ordinary-cache-finish-retained-stop-v1.test.py')
        case=fixtures.Controls();case.setUp();self.addCleanup(case.doCleanups)
        root,proof,unused=case.runtime();owner=fixtures.m;refs=self.finish_refs(case.input_sha)
        # Only protected receipt/OS boundaries are relocated by C's fixture.
        # The external namespace factory and complete actual owner runtime run.
        with patch.object(m,'cache_finish_owner',return_value=owner),\
                patch.object(owner,'reader_ancestry',return_value=(case.ack,{})):
            self.assertIs(m.bind_cache_finish(root,proof,case.refs,refs),owner)
            value=root.cache_finish_module(types.SimpleNamespace(proof=proof))
        case.runtime=lambda:(root,proof,value)
        root,proof,value,context,state=case.lifecycle()
        return case,owner,refs,root,proof,value,context,state

    def test_actual_external_factory_retains_full_lifecycle_and_refuses_foreign_reader(self):
        case,owner,refs,root,proof,value,context,state=self.finish_fixture()
        self.assertEqual(value.BASE,case.owner_base);self.assertEqual(value.FORMAT,m.CACHE_FINISH_FORMAT)
        self.assertIs(value.start.__globals__,value.__dict__)
        self.assertFalse(case.owner_base.exists());self.assertEqual(case.cache.manager.call_count,0)
        self.assertNotIn(m.CACHE_FINISH,proof.manifest['files'])
        with patch.object(owner,'reader_ancestry',return_value=(case.ack,{})):
            root.cache_finish_module(context)
            original=copy.deepcopy(case.owner_config)
            case.owner_config['readerRefs']['resultSha256']='4'*64
            case.put(case.input,case.owner_config)
            with self.assertRaisesRegex(RuntimeError,'exact_fixture_protected_hash'):root.cache_finish_module(context)
            case.put(case.input,original)
        with self.assertRaisesRegex(RuntimeError,'same_reader5_proof'):root.cache_finish_module(types.SimpleNamespace(proof=object()))

    def test_actual_external_start_and_drain_feed_owned_prefix_without_old_stop_alias(self):
        case,owner,refs,root,proof,value,c,state=self.finish_fixture();runtime=self.runtime()
        cache=case.cache;cache.META=case.base/'metadata';cache.META.mkdir()
        cache.UNIT='yunipals-read-cache.service';cache.PROJECT=Path('/fixture/cache');cache.NODE='/fixture/node'
        cache.CANDIDATES=case.base/'candidates'
        original={'FragmentPath':'/fixture/cache.service','DropInPaths':'','User':'cache','Group':'cache',
            'Restart':'on-failure','KillMode':'control-group','WorkingDirectory':'/fixture/legacy',
            'EnvironmentFiles':'old-env','ExecStart':'old-command'}
        c.host.candidate={'originalCacheWriter':{'state':original,'inputHashes':{'/fixture/cache.service':'5'*64}}}
        ordered=lambda text:[('/etc/yunipals-indexer/read-cache.env',False),
            (str(cache.CANDIDATES/'yunipals-read-cache.ownership.env'),False)]if text=='native-env'else[('/fixture/old.env',False)]
        c.host.m=types.SimpleNamespace(ordered_files=ordered);c.host.private=Mock()
        root.pending_definitions=Mock();root.document=lambda path,digest=None:json.loads(case.public(path,digest))
        state.update(original)
        original_manager=cache.manager.side_effect
        def manager(action):
            result=original_manager(action)
            if action=='start':state.update(WorkingDirectory=str(cache.PROJECT),DropInPaths=str(cache.DROP),EnvironmentFiles='native-env',
                ExecStart='{ argv[]='+cache.NODE+' --import tsx '+str(cache.PROJECT/'lib/metadata/read-cache-worker.ts')+' ; }')
            return result
        cache.manager.side_effect=manager
        with patch.object(owner,'reader_ancestry',return_value=(case.ack,{})),\
                patch.object(runtime,'cache_boot_archive',return_value=case.archive):
            # Existing retained8be stop is not an owned native-cache stop.
            before=runtime.cache(root,c,{},True)
            self.assertFalse(before['ownedNativeStopIntentQualified']);self.assertIsNone(before['stoppedActor'])
            reviewed=value.review(root,proof,case.refs['resultSha256'])
            value.start(root,proof,case.refs['resultSha256'],reviewed['reviewHash'])
            case.put(cache.BASE/'drop-published.json',cache.inode(cache.DROP))
            accepted=value.acceptance_review(root,proof);done=value.accept(root,proof,accepted['reviewHash'])
            native=runtime.cache(root,c,{},False);self.assertEqual(native['phase'],'owned-native')
            self.assertEqual(value.BASE,root.cache_finish_module(c).BASE)
            c.manifest=proof.manifest;value.drain_for_inverse(c)
            c.owned_metadata_program={'upgrade':types.SimpleNamespace(BASE=case.base/'no-upgrade',protected=case.public),'owner':None}
            stopped=runtime.cache(root,c,{},True)
            self.assertTrue(stopped['ownedNativeStopIntentQualified'])
            self.assertEqual(stopped['stoppedActor']['main'],native['actor']['main'])
            self.assertEqual(stopped['stoppedActor']['unit']['InvocationID'],native['actor']['unit']['InvocationID'])
            self.assertEqual(stopped['ownedNativeStopIntentSha256'],m.sha(case.public(value.BASE/'inverse-stop-intent.json')))
            self.assertNotEqual(stopped['stoppedActor'],case.stop['actor'])
            journal=runtime.journal_frame(root,c)
            self.assertIn(str(value.BASE/'inverse-stop-intent.json'),journal)
            self.assertIn(str(value.BASE/'result.json'),journal)
            ack=owner.acknowledgement(done['resultSha256'],case.input_sha)
            self.assertFalse(ack['currentActorQualified']);self.assertEqual(ack['readerRefs'],case.refs)
            # The same full prefix rejects an unknown native stop epoch.
            intent=owner.document(value.BASE/'inverse-stop-intent.json');intent['actor']['main']['startTicks']+=1
            case.put(value.BASE/'inverse-stop-intent.json',intent)
            with self.assertRaisesRegex(RuntimeError,'exact_acknowledged_native_stop_epoch'):
                runtime.cache(root,c,{},True)


    def test_actual_mapper_bridge_Phase_and_metadata_callback_are_source_independent(self):
        # Reuse the genuine bridge fixture's private receipt/OS boundaries. Add
        # only the actual mapper route at its explicit bind_proof call; all
        # actual provider/Phase/metadata/terminal functions still execute.
        fixture=load('ypal-ordinary-metadata-restored-epoch-v1.test.py')
        case=fixture.Controls();case.setUp();self.addCleanup(case.doCleanups)
        tree=ast.parse((HERE/'ypal-ordinary-metadata-restored-epoch-v1.test.py').read_bytes())
        cls=next(node for node in tree.body if isinstance(node,ast.ClassDef)and node.name=='Controls')
        fn=copy.deepcopy(next(node for node in cls.body if isinstance(node,ast.FunctionDef)and node.name=='test_actual_provider_factories_bind_exact_refs_and_keep_function_bodies'))
        count=0
        class MapperRoute(ast.NodeTransformer):
            def visit_Expr(self,node):
                nonlocal count
                if ast.unparse(node)=="self.assertIs(bridge.bind_proof(proof), proof)":
                    count+=1
                    return ast.copy_location(ast.parse('actor_mapper_bind(self,proof,provider,epoch,inputs,case,bridge,sdk)').body[0],node)
                return self.generic_visit(node)
        fn=MapperRoute().visit(fn);self.assertEqual(count,1)
        def actor_mapper_bind(control,proof,provider,epoch,inputs,base,bridge,sdk):
            import contextlib
            operation={'binding':{'metadata':{'metadataEpoch':epoch.forward.binding()}}}
            original_module=proof.module_context
            # Explicit public-source loader relocation to the actual compiled
            # provider5 object; no whole current validator is substituted.
            proof.module_context=lambda role:provider if role=='phase'else original_module(role)
            original_bind=bridge.bind_provider;constructed=[]
            with contextlib.ExitStack()as stack:
                def bind_provider(actual,refs):
                    bound=original_bind(actual,refs);real_namespace=bound.namespace
                    def namespace_io(*args,**kwargs):
                        namespace=real_namespace(*args,**kwargs);cache=namespace.cache_runtime()
                        cache.Host=Mock(return_value=types.SimpleNamespace(config=base.config));cache.owned=Mock(return_value=({},{}))
                        stack.enter_context(patch.dict(namespace.Phase.__init__.__globals__,cache_runtime=lambda:cache,read_module=lambda:sdk))
                        constructed.append((namespace,cache));return namespace
                    static=types.SimpleNamespace(intake=lambda:types.SimpleNamespace(document=lambda *_:copy.deepcopy(base.config)))
                    stack.enter_context(patch.dict(bound.create_phase.__globals__,namespace=namespace_io,common=lambda:static))
                    return bound
                with patch.object(m,'bridge_module',return_value=bridge),patch.object(bridge,'bind_provider',side_effect=bind_provider):
                    m.bind_program_phase(types.SimpleNamespace(),proof,operation,{'restoredRefs':control.refs})
                    routed=proof.module_context('phase')
                    class ActualMappedProvider:
                        def __getattr__(self,name):return getattr(routed,name)if hasattr(routed,name)else getattr(base.frozen_provider,name)
                        def namespace(self,config,manifest=None,source_guard=None,inverse=False):
                            control.assertEqual(config,base.config)
                            return routed.create_phase(inputs,control.manifest)
                    with patch.dict(base.base.actual_provider.__globals__,p=ActualMappedProvider()):phase=base.base.actual_provider(True)
                self.assertEqual(len(constructed),1);namespace,cache=constructed[0]
                self.assertIsInstance(phase,namespace.Phase);self.assertIs(phase.cache,cache)
                self.assertEqual(phase.cache.metadata_epoch.refs,control.refs)
                self.assertEqual(proof.metadata_restored_epoch_bridge['sha256'],m.SOURCE_PINS[m.BRIDGE])
                phase.generation=lambda:(None,{'readAdmissionSha256':'a'*64,'metadataOperationSha256':control.ack['metadataOperationSha256']},None,None)
                phase.metadata_primitives=lambda:{'readConfig':{},'admission_ref':{}}
                metadata=namespace.metadata_current_namespace;observed=[]
                def construct(config,refresh,inverse,primitives,admission):
                    observed.append(refresh());self.assertTrue(inverse);return types.SimpleNamespace(admission_pin='a'*64)
                raw=metadata.metadata_inverse_context
                with patch.dict(raw.__globals__,construct_context=construct,operation=lambda *_:{'actual9bReceiptIOFixture':True}):
                    _,_,result=phase.metadata_inverse_context(lambda:{'actualVirtualCatalogOnly':True})
                self.assertEqual(result,{'actual9bReceiptIOFixture':True});self.assertEqual(observed,[{'actualVirtualCatalogOnly':True}])
                control.c2.restored_actor_current.assert_not_called()
        scope={**fixture.__dict__,'actor_mapper_bind':actor_mapper_bind}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(HERE/'ypal-ordinary-metadata-restored-epoch-v1.test.py'),'exec'),scope)
        scope[fn.name](case)

    def test_genuine_9b_prefix_keeps_private_loaded_boot_and_actual_CF333_actor(self):
        case=RetainedReader5Controls();case.setUp();self.addCleanup(case.doCleanups)
        owner,host,operation,state,actor,context=case.metadata_fixture()
        fixture=load('ypal-native-metadata-approval-inverse-v1.test.py')
        ack=fixture.actor('restored',30,300)
        actual=copy.deepcopy(ack)
        actual['unit']['ExecStart']=actual['unit']['ExecStart'].replace('pid=30','pid=0').replace(
            fixture.public_pair['acknowledgedActor'].split('start_time=')[1].split(' ;')[0],'[n/a]')
        # Use the frozen actual CF333 comparator; all manager/SQL observations
        # are explicit fixtures, never a claim that an inverse2 ACK exists.
        relation_owner=load('ypal-native-metadata-approval-inverse-v1.py')
        self.enterContext(patch.object(relation_owner,'protected',side_effect=local))
        relation=relation_owner.restored_actor_relation
        program={'restoredRefs':{'mode':'restored'},'owner':types.SimpleNamespace(restored_actor_relation=relation)}
        context.owned_metadata_program=program
        host.metadata_epoch=types.SimpleNamespace(ack={'actor':ack})
        host.actor.return_value=actual
        op={**case.op,'binding':{'metadata':{'metadataEpoch':{'actualForwardAncestryFixture':True}}}}
        with patch.object(m,'public',side_effect=local):
            value=m.legacy_metadata_prefix(retained.m,case.root,context,op,True)
        self.assertEqual(value['phase'],'owned-native');self.assertEqual(value['actor'],actual)
        self.assertNotEqual(value['actor'],ack);host.private.assert_called_once_with(operation['oldWriter'])
        actual['main']['pid']=31
        with patch.object(m,'public',side_effect=local),self.assertRaisesRegex(RuntimeError,'process_epoch_and_other_unit'):
            m.legacy_metadata_prefix(retained.m,case.root,context,op,True)


    def test_nested_metadata_dispatch_executes_real_9b_tail_after_owned_intent(self):
        case=RetainedReader5Controls();case.setUp();self.addCleanup(case.doCleanups)
        owner,host,operation,state,actor,context=case.metadata_fixture()
        fixture=load('ypal-native-metadata-approval-inverse-v1.test.py')
        acknowledged=fixture.actor('restored',30,300);actual=copy.deepcopy(acknowledged)
        actual['unit']['ExecStart']=actual['unit']['ExecStart'].replace('pid=30','pid=0').replace(
            fixture.public_pair['acknowledgedActor'].split('start_time=')[1].split(' ;')[0],'[n/a]')
        relation_wrapper=load('ypal-native-metadata-approval-inverse-v2.py')
        with patch.object(relation_wrapper,'protected',side_effect=local):relation_owner=relation_wrapper.composition()
        relation_owner.protected=local;relation_owner.__file__=str(HERE/relation_wrapper.FILE.name)
        state.update(MainPID='30',InvocationID='restored',ExecMainStartTimestampMonotonic='300',ExecStart=actual['unit']['ExecStart'])
        # The actual CF333 command supplies the loaded-definition fixture too.
        import re
        argv=re.search(r'argv\[\]=(.*?)\s+;',state['ExecStart']).group(1).split()
        host.m.NODE=argv[0];host.installer.TARGET=Path(argv[1]).parent.parent
        host.actor.return_value=actual;host.metadata_epoch=types.SimpleNamespace(ack={'actor':acknowledged})
        owner.module=lambda _:types.SimpleNamespace(namespace=lambda _:owner)
        owner.METADATA='actual-original9b-fixture'
        refs={'inputSha256':'1'*64,'producerSha256':'2'*64,'manifestSha256':'3'*64}
        program={'inverseRefs':refs,'restoredRefs':{'mode':'restored',**refs},'upgrade':owner,
            'owner':types.SimpleNamespace(restored_actor_relation=relation_owner.restored_actor_relation),
            'forwardACK':{'metadataInputSha256':'a'*64,'metadataOperationSha256':'e'*64}}
        context.owned_metadata_program={'inverseRefs':refs}
        (owner.BASE/'inverse-intent.json').write_bytes(m.encoded({'nativeActor':actual,'oldStillRunning':False}))
        case.put('cache-inverse-catalog.json',{'actualOwnedCacheInverseFixture':True})
        case.put('inverse-global-restored.json',{'actualOwnedGlobalInverseFixture':True})
        delegated={'format':case.root.FORMAT,'bootId':case.root.boot(),
            'operationSha256':case.digest('operation.json'),'metadataOperationSha256':'e'*64,
            'metadataProducerSha256':'f'*64,'newExplicitInverseContext':True,
            'cacheInverseSha256':case.digest('cache-inverse-catalog.json'),
            'globalInverseSha256':case.digest('inverse-global-restored.json')}
        case.put('metadata-inverse-intent.json',delegated)
        root_operation={**case.op,'binding':{'metadata':{'metadataEpoch':{'actualRecordedEpochFixture':True}}}}
        runtime=self.runtime()
        with patch.object(m,'public',side_effect=local),patch.object(m,'metadata_program',return_value=program)as program_check:
            row=runtime.metadata(case.root,context,root_operation,True)
        self.assertEqual(row['phase'],'owned-native');self.assertEqual(row['actor'],actual)
        program_check.assert_called_once_with(runtime,root_operation,refs)
        host.private.assert_called_once_with(operation['oldWriter'])
        self.assertEqual(context.owned_metadata_program,program)
        delegated['metadataProducerSha256']='0'*64;case.put('metadata-inverse-intent.json',delegated)
        with patch.object(m,'public',side_effect=local),patch.object(m,'metadata_program',return_value=program),\
                self.assertRaisesRegex(RuntimeError,'coordinator_metadata_inverse_delegation'):
            runtime.metadata(case.root,context,root_operation,True)


# Execute retained meaningful reader/cache/file/catalog controls against the
# actual new namespace. The historical test source itself remains unchanged.
retained=load('ypal-ordinary-consumer-inverse-prefix-v1.test.py')
with patch.object(m,'public',side_effect=local):retained.m=m.composition()
retained.m.protected=local
selected=[
    'test_source_current_is_bound_to_the_program_actually_evaluated',
    'test_forward_native_actor_is_not_confused_with_previously_stopped_original',
    'test_owned_stop_can_be_terminal_before_stop_ACK_but_foreign_epoch_cannot',
    'test_missing_owned_overlay_requires_exact_inode_unlink_intent_and_actual_absence',
    'test_restored_reader_requires_actual_ACK_and_start_lower_bound',
    'test_virtual_context_blocks_forward_source_before_constructor_callbacks',
    'test_full_genuine_frame_functions_keep_real_present_and_explicit_owned_missing_files',
    'test_catalog_scope_checks_full_owned_READ_cache_LOGIN_column_and_guard_prefix',
    'test_real_committed_cache_SQL_before_ACK_is_a_distinct_owned_prefix',
    'test_missing_or_uncommitted_foreign_cache_SQL_never_becomes_rollback_authority',
    'test_cache_inverse_ACK_binds_same_actual_committed_intent_and_source_owner',
    'test_metadata_loaded_selector_order_is_part_of_terminal_prefix',
    'test_full_capture_bookends_refuse_changed_owned_journal_or_consumer_frame',
    'test_cache_native_and_terminal_prefixes_preserve_private_boot_and_actor_chain',
    'test_cache_private_selector_order_unknown_start_and_foreign_boot_refuse',
    'test_actual_continuation_uses_retained_old_boot_path_without_alias_or_copy',
    'test_cache_restored_requires_genuine_start_ACK_and_prior_metadata_global_restore',
    'test_real_metadata_inverse_context_uses_virtual_scope_before_Host_refresh',
    'test_genuine_cache_restore_body_calls_source_boundary_before_start_then_writes_ACK']
methods={name:getattr(retained.Controls,name)for name in selected}
methods.update({name:getattr(retained.Controls,name)for name in ['setUp','put','digest','publish','stop','committed_cache_fixture','metadata_fixture','cache_fixture']})
original=retained.Controls.test_actual_CONT3_provider_metadata_context_uses_virtual_catalog_scope_before_Host_constructor
before='ypal-ordinary-publication-continue-v3.test.py';after='ypal-ordinary-publication-continue-v5.test.py'
assert original.__code__.co_consts.count(before)==1
code=original.__code__.replace(co_consts=tuple(after if value==before else value for value in original.__code__.co_consts))
methods['test_actual_Reader5_Phase_metadata_constructor_selects_virtual_scope_first']=types.FunctionType(code,original.__globals__)
RetainedReader5Controls=type('RetainedReader5Controls',(unittest.TestCase,),methods)

if __name__=='__main__':unittest.main()
