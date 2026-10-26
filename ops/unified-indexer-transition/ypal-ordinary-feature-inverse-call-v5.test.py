"""Actual composed feature owner plus protected caller intent/ACK controls."""
import contextlib
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
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

m=assembled('ypal-ordinary-feature-inverse-call-v5.py')
s=assembled('ypal-ordinary-feature-inverse-source-v5.py')
feature_tests=load('ypal-ordinary-feature-continue-v5.test.py')


def body(function):
    code=function.__code__ if hasattr(function,'__code__')else function
    return(code.co_code,code.co_names,tuple(body(value)if isinstance(value,types.CodeType)else value for value in code.co_consts))


class Controls(unittest.TestCase):
    def setUp(self):
        self.feature=feature_tests.Controls();self.feature.setUp();self.addCleanup(self.feature.doCleanups)
        original=feature_tests.owner.composition().composition()
        b=original.assemble((HERE/'ypal-feature-handover-v1.py').read_bytes(),feature_tests.context,
            (HERE/'ypal-restored-feature-handover-v1.py').read_bytes());self.b=b
        refs={'resultSha256':'a'*64,'manifestSha256':'b'*64,'inputSha256':'c'*64,
            'producerSha256':'8d392dfcf5d663a9561f4c0d4f39f2aed56f3013567116116693312320a492c8',
            'contextSha256':'62099f9cd61cb2fdbca6e2c19bb1eb20ebd06bee6e070384b64d09ef2e95787a'}
        self.proof={'format':s.FORMAT,'operatorSha256':m.SOURCE_SHA,'inputSha256':'d'*64,'validated':True,
            'sourceOnlyCurrent':True,'sourceActorQualified':True,'currentWriterQualified':True,'featureRefs':refs,
            'ordinaryRuntimeAncestry':{'resultSha256':'e'*64,'inputSha256':'f'*64},'sourceKind':'restored-owned-feature-inverse-prefix',
            'binding':{'actualOwnedSourceAndFeaturePhase':True},'sourceKernelActors':{'SOURCE':{'fixtureActualRestoredSOURCE':True}},
            'financialAuthorityQualified':False,'oldStandaloneSuccessClaimed':False,'supersededPeerFrameQualified':False,
            'originalWholeStablePassed':False,'originalWholeFeatureInversePassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        self.proof['bindingSha256']=s.sha(s.encoded(self.proof['binding']))
        self.authority=types.SimpleNamespace(business=b,feature_host=types.SimpleNamespace(old_inputs=Mock(),peers=Mock(return_value={'actualFourPeers':True}),manager=Mock()),
            feature_refs=refs,current=Mock(side_effect=lambda:copy.deepcopy(self.proof)),last_actors={'SOURCE':{'fixtureActualRestoredSOURCE':True}},
            owner=types.SimpleNamespace(m=types.SimpleNamespace(SOURCE='SOURCE'),bound_references=types.SimpleNamespace(ordinary=self.proof['ordinaryRuntimeAncestry']),
                f=types.SimpleNamespace(canonical_actor=copy.deepcopy),h=types.SimpleNamespace(sessions=Mock(return_value={'73004621':{'owned':{'SOURCE':[{'positive':True}]}}}))))
        module=types.SimpleNamespace(FORMAT=s.FORMAT,Authority=Mock(return_value=self.authority),sha=s.sha,encoded=s.encoded,
            SOURCE_PINS=s.SOURCE_PINS)
        self.source_module=module
        self.enterContext(patch.object(m,'authenticate',return_value=(m.own_sha(),'a'*64)))
        self.enterContext(patch.object(m,'source_module',return_value=module));self.context=m.Context('d'*64)

    def test_every_original_effect_body_is_inherited_except_named_source_invariant_and_entry_guard(self):
        for name,function in self.b.Owner.__dict__.items():
            if hasattr(function,'__code__')and name not in{'invariant','step','inverse'}:
                self.assertEqual(body(getattr(type(self.context.owner),name)),body(function),name)
        self.assertIsNot(type(self.context.owner).invariant,self.b.Owner.invariant)

    def test_actual_typed_source_replaces_only_old_combined_PID_equality_and_keeps_four_peers(self):
        self.context.owner.operation=Mock(return_value={'peers':{'actualFourPeers':True},'combined':{'obsoleteInitialPID':1}})
        self.context.owner.admitted=Mock();self.context.owner.invariant()
        value=self.context.host.combined();self.assertFalse(value['terminal']);self.assertTrue(value['inverseOnly'])
        self.assertFalse(value['oldStandaloneSuccessClaimed']);self.assertEqual(value['source'],self.proof['sourceKernelActors']['SOURCE'])
        self.context.host.peers.return_value={'foreignPrivatePeer':True}
        with self.assertRaises(RuntimeError):self.context.owner.invariant()

    def test_source_producer_domain_whole_success_or_binding_tamper_refuses(self):
        for change in [lambda:self.proof.update(operatorSha256='f'*64),lambda:self.proof.update(oldStandaloneSuccessClaimed=True),
                       lambda:self.proof.update(sourceKind='ordinary-standalone'),lambda:self.proof.update(bindingSha256='f'*64)]:
            before=copy.deepcopy(self.proof);change()
            with self.subTest(change=change),self.assertRaises(RuntimeError):self.context.current()
            self.proof=before

    def test_step_checks_current_source_before_original_owned_intent_or_effect_dispatch(self):
        events=[];self.authority.current.side_effect=lambda:events.append('source')or copy.deepcopy(self.proof)
        with patch.object(self.context,'effect_fence',side_effect=lambda *_:events.append('lease')),patch.object(self.b.Owner,'step',side_effect=lambda name,effect:events.append('original-step')or effect({'owned':True})):
            self.assertEqual(self.context.owner.step('inverse-source-start',lambda _:events.append('effect')or'actual'), 'actual')
        self.assertEqual(events,['lease','source','original-step','effect'])

    def runtime_fixture(self):
        tmp=tempfile.TemporaryDirectory(dir=HERE);self.addCleanup(tmp.cleanup);base=Path(tmp.name)/'caller';business=Path(tmp.name)/'business';business.mkdir(mode=0o700)
        self.enterContext(patch.object(m,'BASE',base));self.enterContext(patch.object(m,'LOCK',Path(tmp.name)/'transition.lock'))
        self.b.BASE=business;self.enterContext(patch.object(m,'FEATURE_BASE',business))
        source_input=Path(tmp.name)/'source-input.json';source_bytes=m.encoded({'format':s.FORMAT+'-input','prefixInputSha256':'a'*64})
        self.b.save(source_input,source_bytes);self.source_module.INPUT=source_input
        self.context.input_sha=m.sha(source_bytes);self.proof['inputSha256']=self.context.input_sha
        refs=self.authority.feature_refs
        operation={'format':self.b.FORMAT,'operatorSha256':refs['producerSha256'],'manifestSha256':refs['manifestSha256'],
            'inputSha256':refs['inputSha256'],'bootId':self.b.boot()}
        self.b.save(business/'operation.json',operation)
        original={'reviewHash':'a'*64,'binding':{'fixtureActualOriginalInverseReview':True}}
        binding={'format':m.FORMAT,'operatorSha256':m.own_sha(),'sourceProducerSha256':m.SOURCE_SHA,
            'callerManifestSha256':self.context.manifest_sha,
            'sourceManifestSha256':m.SOURCE_MANIFEST_SHA,'sourceInputSha256':self.context.input_sha,
            'featureRefs':self.authority.feature_refs,'featureOperationSha256':self.b.sha(self.b.protected(business/'operation.json')),
            'originalInverseReviewHash':original['reviewHash'],'sourceBinding':self.proof['binding'],
            'originalWholeFeatureInvariantPassed':False,'newExplicitInverseSourceContext':True}
        review={'binding':binding,'reviewHash':m.sha(m.encoded(binding)),'originalReview':original}
        self.context.review=Mock(side_effect=lambda:copy.deepcopy(review))
        def inverse(expected):
            self.assertEqual(expected,original['reviewHash'])
            self.b.save(business/'inverse-result.json',{'format':self.b.FORMAT,'operatorSha256':refs['producerSha256'],
                'operationSha256':binding['featureOperationSha256'],'bootId':self.b.boot(),'inverse':True,
                'ownedEightSELECTsRevoked':True,'prior143AndCache4Preserved':True})
            self.b.save(business/'inverse-review.json',{'reviewHash':original['reviewHash'],'operationSha256':binding['featureOperationSha256']})
            return{'inverse':True}
        self.context.owner.inverse=Mock(side_effect=inverse)
        refs=self.authority.feature_refs
        self.b.validate_inverse_leaf=Mock(side_effect=lambda result,*_:{'format':self.b.FORMAT+'-inverse-leaf','validated':True,'receiptSha256':result,
            'operatorSha256':refs['producerSha256'],'manifestSha256':refs['manifestSha256'],'inputSha256':refs['inputSha256'],
            'contextSha256':refs['contextSha256'],'operationSha256':binding['featureOperationSha256'],
            'temporarySourceActorQualified':True,'originalBootInodeRestored':True,'sameProgramsPrivateInputsAndPrivilegesQualified':True,
            'sourceActorQualified':False,'financialAuthorityQualified':False,'originalWholeValidatorsPassed':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0})
        return base,review

    def test_new_effect_requires_real_review_and_writes_own_immutable_intent_then_ACK(self):
        base,review=self.runtime_fixture()
        with self.assertRaises(RuntimeError):m.execute(self.context,'f'*64,'1'*32)
        self.context.owner.inverse.assert_not_called();self.assertFalse(base.exists())
        value=m.execute(self.context,review['reviewHash'],'1'*32);self.assertTrue(value['completed'])
        self.assertFalse(value['originalFeatureCLIPassed']);self.assertFalse(value['effectsReplayed'])
        for name in ['intent.json','result.json']:self.assertEqual((base/('1'*32)/name).stat().st_mode&0o777,0o600)
        intent=json.loads((base/('1'*32)/'intent.json').read_bytes());ack=json.loads((base/('1'*32)/'result.json').read_bytes())
        self.assertEqual(ack['intentSha256'],m.sha(m.encoded(intent)));self.assertFalse(ack['originalWholeFeatureInvariantPassed'])

    def test_lost_new_ACK_readonly_acceptance_revalidates_genuine_result_without_effect_replay(self):
        base,review=self.runtime_fixture();m.execute(self.context,review['reviewHash'],'2'*32)
        (base/('2'*32)/'result.json').unlink();value=m.accept(self.context,'2'*32)
        self.assertTrue(value['acknowledgementReconciledReadOnly']);self.assertFalse(value['effectsReplayed'])
        self.assertEqual(self.context.owner.inverse.call_count,1)
        with self.assertRaises(RuntimeError):m.accept(self.context,'2'*32)

    def test_foreign_old_intent_or_changed_original_operation_cannot_be_readonly_accepted(self):
        base,review=self.runtime_fixture();m.execute(self.context,review['reviewHash'],'3'*32)
        (base/('3'*32)/'result.json').unlink();path=base/('3'*32)/'intent.json';intent=json.loads(path.read_bytes())
        intent['operatorSha256']='f'*64;path.write_bytes(m.encoded(intent))
        with self.assertRaises(RuntimeError):m.accept(self.context,'3'*32)
        self.assertEqual(self.context.owner.inverse.call_count,1)

    def test_pure_recorded_new_ACK_route_constructs_no_Host_or_current_source(self):
        _,review=self.runtime_fixture();result=m.execute(self.context,review['reviewHash'],'4'*32)
        calls=self.authority.current.call_count;constructors=self.source_module.Authority.call_count
        proof=m.acknowledgement(result['receiptSha256'],'4'*32)
        self.assertTrue(proof['immutableAcknowledgementOnly']);self.assertFalse(proof['sourceActorQualified'])
        self.assertFalse(proof['currentFeatureActorsQualified']);self.assertEqual(self.authority.current.call_count,calls)
        self.assertEqual(self.source_module.Authority.call_count,constructors)
        path=m.FEATURE_BASE/'inverse-result.json';path.write_bytes(m.encoded({'foreign':True}))
        with self.assertRaises(RuntimeError):m.acknowledgement(result['receiptSha256'],'4'*32)

    def test_real_shared_transition_lock_refuses_contenders_and_preserves_protected_inode(self):
        tmp=tempfile.TemporaryDirectory(dir=HERE);self.addCleanup(tmp.cleanup);path=Path(tmp.name)/'transition.lock'
        with patch.object(m,'LOCK',path):
            with m.transition_lock():
                with self.assertRaises(BlockingIOError):
                    with m.transition_lock():pass
            self.assertEqual(path.stat().st_mode&0o777,0o600)

    def test_direct_inverse_manager_or_arbitrary_step_cannot_bypass_new_intent_and_lease(self):
        with patch.object(self.b.Owner,'inverse')as original:
            with self.assertRaisesRegex(RuntimeError,'own_intent_and_live_shared_lock'):self.context.owner.inverse('a'*64)
            original.assert_not_called()
        with self.assertRaisesRegex(RuntimeError,'own_intent_and_live_shared_lock'):self.context.host.manager('start',self.b.API)
        with self.assertRaisesRegex(RuntimeError,'only_original_owned_feature_inverse_steps'):
            self.context.owner.step('arbitrary-forward-grant',lambda _:None)

    def test_live_effect_fence_reauthenticates_intent_and_rejects_closed_shared_lock_FD(self):
        base,review=self.runtime_fixture()
        original=self.context.owner.inverse
        def run(expected):
            self.context.effect_fence(expected);root=base/('5'*32);path=root/'intent.json';raw=path.read_bytes()
            changed=json.loads(raw);changed['sourceProducerSha256']='f'*64;path.write_bytes(m.encoded(changed))
            with self.assertRaises(RuntimeError):self.context.effect_fence(expected)
            path.write_bytes(raw);return original(expected)
        self.context.owner.inverse=run;m.execute(self.context,review['reviewHash'],'5'*32)
        self.assertIsNone(self.context.effect)

    def test_import_default_CLI_is_inert(self):
        value=subprocess.run([sys.executable,'-I','-B',str(HERE/m.FILE.name)],capture_output=True,check=True)
        self.assertTrue(json.loads(value.stdout)['staticOnly']);self.assertEqual(value.stderr,b'')

    def test_actual_source_module_finite_map_authentication_uses_new_code_before_constructor(self):
        actual=assembled(m.FILE.name);seen=[]
        def public(path,digest=None,maximum=4000000):
            origin=HERE/path.name
            if path.name=='final-supervisor-inventory-v1.py':origin=HERE.parent/'solana-acceptance'/path.name
            if path.name=='ypal-old-runtime-inventory-v1.py':origin=HERE.parent/'booster-launch'/path.name
            raw=origin.read_bytes();m.need(0<len(raw)<=maximum and(digest is None or m.sha(raw)==digest),'actual_source_module_fixture_required')
            seen.append(path.name);return raw
        actual.protected=public;module=actual.source_module();producer,manifest=actual.authenticate()
        self.assertTrue(set(module.SOURCE_PINS)<=set(seen));self.assertEqual(module.FORMAT,s.FORMAT)
        self.assertEqual(producer,actual.own_sha());self.assertEqual(len(manifest),64)
        actual.SOURCE_SHA='f'*64
        with self.assertRaises(RuntimeError):actual.source_module()


if __name__=='__main__':unittest.main()
