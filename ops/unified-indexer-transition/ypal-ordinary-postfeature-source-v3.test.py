"""Current source boundaries after completed feature inverse; no live receipts."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value

def assembled(name):
    wrapper=load(name);actual_read=Path.read_bytes
    def local(path,digest=None):
        path=HERE/Path(path).name
        if not path.exists()and path.name=='final-supervisor-inventory-v1.py':path=HERE.parent/'solana-acceptance'/path.name
        if not path.exists()and path.name=='ypal-old-runtime-inventory-v1.py':path=HERE.parent/'booster-launch'/path.name
        raw=actual_read(path);wrapper.need(digest is None or wrapper.sha(raw)==digest,'actual_local_feature_inverse3_source');return raw
    def self_read(path):return actual_read(HERE/path.name)if path==wrapper.FILE else actual_read(path)
    with patch.object(wrapper,'authenticate',lambda:None),patch.object(wrapper,'public',local),patch.object(Path,'read_bytes',self_read):
        value=wrapper.composition()
    value.__file__=str(HERE/name);wrapper.public=local
    return value

m=assembled('ypal-ordinary-postfeature-source-v3.py')
source_tests=load('ypal-ordinary-feature-inverse-source-v3.test.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.original=source_tests.Controls();self.original.setUp();self.addCleanup(self.original.doCleanups)
        self.base=self.original.base
        self.enterContext(patch.object(m,'public',side_effect=self.original.public))

    def test_default_and_complete_finite_actual_closure(self):
        value=subprocess.run([sys.executable,'-I','-B',str(HERE/m.FILE.name)],capture_output=True,check=True)
        self.assertTrue(json.loads(value.stdout)['staticOnly']);self.assertFalse(value.stderr)
        files=m.authenticate()['files'];self.assertEqual(len(files),len(m.SOURCE_PINS)+1)
        self.assertEqual(files,{m.FILE.name:m.own_sha(),**m.SOURCE_PINS})
        self.assertNotIn('arena-ypal-business-inverse-v1.py',files)
        self.assertNotIn('ypal-ordinary-consumer-inverse-prefix-v1.py',files)
        self.assertEqual(m.encoded({'format':m.FORMAT+'-source','files':files}),(HERE/m.MANIFEST.name).read_bytes())

    def test_manifest_and_all_sources_authenticate_before_caller_eval(self):
        with patch.object(m,'public',side_effect=RuntimeError('source_drift')),patch.object(m,'caller_module',side_effect=AssertionError('no_eval')):
            with self.assertRaisesRegex(RuntimeError,'source_drift'):m.Authority('a'*64)

    def refs(self):
        return{'resultSha256':'a'*64,'operationId':'b'*32,'producerSha256':m.SOURCE_PINS[m.CALLER],
            'manifestSha256':m.SOURCE_PINS[m.CALLER_MANIFEST]}

    def test_exact_completed_caller_domain_and_real_refs_required(self):
        value={'format':m.FORMAT+'-input','featureInverseCaller':self.refs()};self.assertEqual(m.configuration(value),value)
        for change in [{'format':'foreign'},{'arenaCurrent':True},{'featureInverseCaller':{**self.refs(),'producerSha256':'c'*64}},
            {'featureInverseCaller':{**self.refs(),'operationId':'future'}},
            {'featureInverseCaller':{**self.refs(),'manifestSha256':'c'*64}}]:
            with self.subTest(change=change),self.assertRaises(RuntimeError):m.configuration({**value,**change})

    def authority(self):
        a,initial=self.original.authority(True)
        a.owner.feature_runtime=self.base.owner.feature_runtime
        a._inputs=Mock();a.initial_config['arenaInverse']={key:'c'*64 for key in['resultSha256','planSha256','producerSha256','manifestSha256']}
        self.original.phase['temporarySourceActor']={'unit':{},'processes':[{'pid':1073741700}]}
        value=m.Authority.__new__(m.Authority);value.input_sha='d'*64
        value.config={'format':m.FORMAT+'-input','featureInverseCaller':self.refs()};value.authority=a
        value.ack={'featureRefs':copy.deepcopy(a.feature_refs),'featureInverseResultSha256':'e'*64,
            'featureOperationSha256':'4'*64,'binding':{'actualCompletedCaller':True}}
        value._acknowledgement=Mock(side_effect=lambda:copy.deepcopy(value.ack))
        a.prefix.arena_current.side_effect=AssertionError('no_current_Arena_callback_or_old_whole_source_pass')
        a.current=Mock(side_effect=AssertionError('no_old_Arena_aware_current'))
        self.leaf={'format':'actual-feature-format-inverse-leaf','validated':True,'receiptSha256':'e'*64,
            'operatorSha256':a.feature_refs['producerSha256'],'manifestSha256':a.feature_refs['manifestSha256'],
            'inputSha256':a.feature_refs['inputSha256'],'contextSha256':a.feature_refs['contextSha256'],
            'operationSha256':'4'*64,'temporarySourceActorQualified':True,'originalBootInodeRestored':True,
            'sameProgramsPrivateInputsAndPrivilegesQualified':True,'sourceActorQualified':False,
            'financialAuthorityQualified':False,'originalWholeValidatorsPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
            'temporarySourceActor':copy.deepcopy(self.original.phase['temporarySourceActor']),
            'temporarySourceNativeIdentity':{'fixtureFreshNative10':True},'api':{'fixtureActualAPI':True},
            'inverseCatalogPhase':{'fixtureExactOwnedFeatureInverseCatalog':True}}
        a.business=types.SimpleNamespace(FORMAT='actual-feature-format',validate_inverse_leaf=Mock(side_effect=lambda *_:copy.deepcopy(self.leaf)))
        self.base.native['app']['is_ready']='1'
        return value

    def current(self,value):
        raw=m.encoded(value.config)
        with patch.object(m,'authenticate',return_value={}),patch.object(m,'public',return_value=raw):return value.current()

    def test_actual_full_source_facts_without_C_current_callback_or_old_whole_pass(self):
        a=self.authority();proof=self.current(a)
        a.authority.prefix.arena_current.assert_not_called();a.authority.current.assert_not_called()
        self.assertEqual(set(a.last_actors),{'SOURCE','SOLANA','FRESH'})
        self.assertEqual(a.authority.phase.validate_current_phase.call_count,2)
        self.assertEqual(a.authority.business.validate_inverse_leaf.call_count,2)
        self.assertEqual(a.authority._inputs.call_count,2)
        self.assertEqual(proof['arenaInverseRefs'],a.authority.initial_config['arenaInverse'])
        self.assertEqual(proof['registeredDataSha256'],self.base.data['registeredDataSha256'])
        for key in['sourceOnlyCurrent','sourceActorQualified','currentWriterQualified','frameworkReady']:self.assertTrue(proof[key])
        for key in['arenaCurrentQualified','financialAuthorityQualified','oldStandaloneSuccessClaimed','originalWholeStablePassed',
            'originalWholeFeatureInvariantPassed','currentReadersQualified','sourceReadinessQualified']:self.assertFalse(proof[key])
        self.assertEqual(proof['bindingSha256'],m.sha(m.encoded(proof['binding'])))

    def test_four_unrelated_consumer_frames_remain_exact(self):
        a=self.authority();self.base.peers['og']['currentFrames']['yunipals-api.service']={'foreign':True}
        with self.assertRaisesRegex(RuntimeError,'four_unrelated_consumer_frames'):self.current(a)

    def test_source_private_routes_native_cache_epoch_and_positive_kernel_remain_strict(self):
        for change in [lambda:self.base.sourcefacts.update(inputs={'foreign':True}),
            lambda:self.base.actor['SOURCE']['unit'].update(NRestarts='1'),lambda:self.base.native.update(cache={'foreign':True}),
            lambda:setattr(self.base.owner.h,'sessions',Mock(return_value={'73004621':{'owned':{'SOURCE':[]}}}))]:
            with self.subTest(change=change):
                before=copy.deepcopy((self.base.sourcefacts,self.base.actor,self.base.native));sessions=self.base.owner.h.sessions
                a=self.authority();change()
                with self.assertRaises(RuntimeError):self.current(a)
                self.base.sourcefacts,self.base.actor,self.base.native=before;self.base.owner.h.sessions=sessions

    def test_incomplete_or_foreign_feature_leaf_refuses_before_source_facts(self):
        for change in [{'receiptSha256':'0'*64},{'contextSha256':'c'*64},{'temporarySourceActorQualified':False},
            {'operationSha256':'c'*64},{'originalWholeValidatorsPassed':True}]:
            a=self.authority();self.leaf.update(change)
            with self.subTest(change=change),self.assertRaisesRegex(RuntimeError,'genuine_completed_feature_inverse'):self.current(a)

    def test_catalog_and_actor_phase_bookends_refuse_drift(self):
        a=self.authority();first=copy.deepcopy(self.leaf);second={**first,'inverseCatalogPhase':{'foreign':True}}
        a.authority.business.validate_inverse_leaf.side_effect=[first,second]
        with self.assertRaisesRegex(RuntimeError,'actor_catalog_or_owned_phase_changed'):self.current(a)
        a=self.authority();a.authority.phase.validate_current_phase.side_effect=[copy.deepcopy(self.original.phase),
            {**self.original.phase,'fixtureActualOwnedPhase':'changed'}]
        with self.assertRaisesRegex(RuntimeError,'actor_catalog_or_owned_phase_changed'):self.current(a)

    def test_completed_caller_ack_must_remain_immutable_around_source_capture(self):
        a=self.authority();a._acknowledgement.side_effect=[copy.deepcopy(a.ack),{**a.ack,'foreign':True}]
        with self.assertRaisesRegex(RuntimeError,'receipt_or_source_input_changed_after'):self.current(a)

    def test_readiness_is_observation_and_never_an_old_API_success_alias(self):
        a=self.authority();self.base.native['app']['is_ready']='0';proof=self.current(a)
        self.assertFalse(proof['frameworkReady']);self.assertFalse(proof['sourceReadinessQualified'])
        self.assertFalse(proof['currentReadersQualified'])

    def test_typed_ack_is_immutable_only_and_foreign_or_current_authority_refuses(self):
        a=self.authority();refs=self.refs();binding={'fixtureActualRecordedCaller':True}
        ack={'format':'yunipals-ordinary-feature-inverse-call-v1-acknowledgement','validated':True,'immutableAcknowledgementOnly':True,
            'producerSha256':refs['producerSha256'],'manifestSha256':refs['manifestSha256'],
            'receiptSha256':refs['resultSha256'],'operationId':refs['operationId'],'binding':binding,
            'bindingSha256':m.sha(m.encoded(binding)),'sourceActorQualified':False,'currentWriterQualified':False,
            'currentFeatureActorsQualified':False,'currentReadersQualified':False,'financialAuthorityQualified':False,
            'originalFeatureCLIPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        a.caller=types.SimpleNamespace(FORMAT='yunipals-ordinary-feature-inverse-call-v1',sha=m.sha,encoded=m.encoded,
            acknowledgement=Mock(side_effect=lambda *_:copy.deepcopy(ack)))
        self.assertEqual(m.Authority._acknowledgement(a),ack)
        a.caller.acknowledgement.assert_called_once_with(refs['resultSha256'],refs['operationId'])
        for change in [{'producerSha256':'c'*64},{'manifestSha256':'c'*64},{'currentWriterQualified':True},
            {'immutableAcknowledgementOnly':False},{'bindingSha256':'c'*64}]:
            original=copy.deepcopy(ack);ack.update(change)
            with self.subTest(change=change),self.assertRaisesRegex(RuntimeError,'immutable_actual_new_feature_inverse_ACK'):
                m.Authority._acknowledgement(a)
            ack.clear();ack.update(original)


if __name__=='__main__':unittest.main()
