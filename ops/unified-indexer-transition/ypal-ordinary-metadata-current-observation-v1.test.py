"""Actual metadata/PreparedMetadata bodies; lifecycle I/O is an explicit fixture."""
import copy
import importlib.util
import json
from pathlib import Path
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
wrapper=load('ypal-ordinary-metadata-current-observation-v1.py');prior=load('ypal-ordinary-metadata-current-epoch-v1.test.py')
observer=load('ypal-native-metadata-approval-current-observer-v1.py');pair=json.loads((HERE/'ypal-native-metadata-approval-current-observer-v1.execstart-fixture.json').read_bytes())
def public(path,expected=None,maximum=4000000):
    name=Path(path).name;p=HERE/name
    if not p.exists()and name=='ypal-old-runtime-inventory-v1.py':p=HERE.parent/'booster-launch'/name
    if not p.exists()and name=='final-supervisor-inventory-v1.py':p=HERE.parent/'solana-acceptance'/name
    raw=p.read_bytes()
    if expected is not None and wrapper.sha(raw)!=expected:raise RuntimeError('actual_local_observation_bytes_required')
    return raw
compiler=load('ypal-fresh-forward-epoch-v1.py');real_namespace=compiler.namespace

def namespace(*args,**kwargs):
    value=real_namespace(*args,**kwargs)
    if 'public'in vars(value):value.public=public
    if 'factory'in vars(value):value.factory=lambda:compiler
    return value
compiler.namespace=namespace
real_load=wrapper.load

def local_load(path,digest):
    public(path,digest)
    if Path(path)==wrapper.FACTORY:return compiler
    if Path(path)==wrapper.OBSERVER:return observer
    raise AssertionError('unexpected fixture load '+str(path))
with patch.object(wrapper,'public',side_effect=public),patch.object(wrapper,'load',side_effect=local_load):actual=wrapper.composition()
prior.m=actual

class Controls(prior.Controls):
    def setUp(self):
        super().setUp()
        # Preserve the real finite owner source/manifest pins. Only immutable
        # receipt and lifecycle I/O are fixtures, never fictitious source bytes.
        self.code=(HERE/actual.OWNER).read_bytes();self.owner_sha=wrapper.sha(self.code)
        self.source_raw=(HERE/actual.OWNER_MANIFEST).read_bytes();self.source=json.loads(self.source_raw)
        self.refs.update(producerSha256=self.owner_sha,manifestSha256=wrapper.sha(self.source_raw))
        self.manifest={'files':{},'dependencies':{**self.source['files'],actual.OWNER_MANIFEST:self.refs['manifestSha256']}}
        self.ack['operatorSha256']=self.current['operatorSha256']=self.owner_sha
        old_public=self.utility.public
        def fixture_public(path,digest=None,maximum=4000000):
            if Path(path).name in{'ypal-old-runtime-inventory-v1.py','final-supervisor-inventory-v1.py'}:return public(path,digest,maximum)
            return old_public(path,digest,maximum)
        self.utility.public=fixture_public
        self.actor['main']['pid']=1180697;self.actor['unit'].update(MainPID='1180697',ExecStart=pair['acknowledgedActor'])
        self.ack['actor']=copy.deepcopy(self.actor)
        self.actual_actor=copy.deepcopy(self.actor);self.actual_actor['unit']['ExecStart']=pair['actualActor']
        self.current['actor']=copy.deepcopy(self.actual_actor)
        def capture(*_):
            relation=observer.actor_relation(self.current['actor'],self.ack['actor'])
            return{'format':observer.FORMAT,'validated':True,'operatorSha256':wrapper.OBSERVER_SHA,'inputSha256':self.refs['inputSha256'],
                'upgradeRefs':copy.deepcopy(self.refs),'upgradeAcknowledgement':copy.deepcopy(self.ack),'upgradeOperationSha256':self.ack['operationSha256'],
                'actor':copy.deepcopy(self.current['actor']),**{key:copy.deepcopy(self.current[key])for key in
                    ['boot','metadataInputSha256','metadataOperationSha256','metadataSelectedSha256','historicalActor','historicalBoot',
                     'artifactDigest','artifactManifestSha256','workerSha256','sourceActorQualified','READAuthorityQualified',
                     'publicationAuthorityQualified','financialAuthorityQualified','databaseWrites','serviceActions','providerCalls']},
                'execStartPresentation':relation,'currentActorQualified':True,'immutableAcknowledgementOnly':False,'originalOwner3CurrentPassed':False}
        self.capture=Mock(side_effect=capture)
        self.enterContext(patch.object(observer,'actor_current',side_effect=self.capture))
        self.enterContext(patch.object(wrapper,'public',side_effect=public))

    def test_default_import_and_CLI_are_inert(self):
        import subprocess
        value=json.loads(subprocess.run(['python3','-I','-B',str(HERE/wrapper.FILE.name)],capture_output=True,check=True).stdout)
        self.assertTrue(value['staticOnly']);self.assertFalse(value['effectAuthority']);self.assertFalse(value['inverseAuthority'])

    def test_current_actor_is_bookended_against_exact_owned_ACK(self):
        epoch=self.epoch();ack_before=copy.deepcopy(epoch.ack)
        self.assertEqual(epoch.current()['actor'],self.actual_actor);self.assertNotEqual(self.actual_actor,self.actor)
        self.assertEqual(epoch.ack,ack_before);self.assertEqual(epoch.binding()['acknowledgement']['actor'],self.actor)
        self.current['actor']['main']['pid']=999
        with self.assertRaises(RuntimeError):epoch.current()

    def test_retained_metadata_body_executes_full_READ_database_publication_and_bookends(self):
        self.legacy_host();n=actual.namespace(self.ack['metadataInputSha256'],self.refs,self.manifest)
        refresh=Mock(return_value={'fixtureReadProof':True});result=n.metadata(self.phase,self.candidate,self.selection,refresh)
        self.assertEqual(self.calls,['complete-current-READ','old-private','native-database','full-canonical-publication','complete-current-READ','old-private'])
        self.assertEqual(refresh.call_count,2);self.assertEqual(self.capture.call_count,2);self.owner.actor_current.assert_not_called()
        self.assertTrue(result['allPublishedCanonical']);self.assertFalse(result['oldMetadataCurrentHelperPassed'])
        self.assertEqual(result['metadataCurrentObserver'],actual.OBSERVATION_REF);self.assertEqual(n.metadata.__code__.co_freevars,())
        self.assertEqual(result['actorSha256'],self.legacy.sha(self.legacy.encoded(self.actual_actor)))

    def test_restored_worker_is_a_distinct_owned_epoch_with_shared_upgrade_ancestry(self):
        with self.assertRaisesRegex(RuntimeError,'no_inverse_authority'):actual.namespace(self.ack['metadataInputSha256'],self.refs,self.manifest,True)

    def test_two_classified_churns_retry_whole_observer_not_source_or_effect(self):
        epoch=self.epoch();good=self.capture.side_effect
        self.capture.side_effect=[RuntimeError('metadata_backend_churn_retry_readonly_observation_only'),
            RuntimeError('metadata_backend_churn_retry_readonly_observation_only'),good()]
        self.assertEqual(epoch.current()['actor'],self.actual_actor);self.assertEqual(self.capture.call_count,3)
        self.assertEqual([row['discarded']for row in epoch.current_capture_attempts],[True,True,False])

    def test_observer_upgrade_program_boot_and_witness_mutations_refuse(self):
        original=self.capture.side_effect
        for field,value in [('upgradeOperationSha256','0'*64),('artifactDigest','1'*64),('boot',{'foreign':True}),
            ('execStartPresentation',{'forged':True}),('operatorSha256','9'*64)]:
            result=original();result[field]=value
            self.capture.side_effect=lambda *_:copy.deepcopy(result)
            with self.assertRaises(RuntimeError,msg=field):self.epoch().current()
            self.capture.side_effect=original

if __name__=='__main__':unittest.main()
