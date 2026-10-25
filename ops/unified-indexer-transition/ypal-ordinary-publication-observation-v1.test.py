"""Actual readonly caller composition; immutable ACKs and SOURCE I/O are fixtures."""
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
old=load('ypal-ordinary-publication-continue-v4.test.py')
meta=load('ypal-ordinary-metadata-current-observation-v1.test.py');current=meta.actual
m=load('ypal-ordinary-publication-observation-v1.py')

def local_public(path,expected=None,maximum=4000000):return old.public(path,expected,maximum)

class Controls(unittest.TestCase):
    def setUp(self):
        self.control=old.Controls();self.control.setUp();self.addCleanup(self.control.doCleanups)
        control=self.control;self.h=control.h
        self.enterContext(patch.object(current,'utility',return_value=control.utility))
        self.enterContext(patch.object(control.frozen_provider,'utility',return_value=control.utility))
        self.enterContext(patch.object(meta.wrapper,'public',side_effect=local_public))
        self.enterContext(patch.object(m,'public',side_effect=local_public))
        frozen=old.actual['ypal-ordinary-publication-continue-v4.py']
        def loader(path,digest):
            local_public(path,digest)
            if Path(path)==m.CURRENT:return current
            if Path(path)==m.FROZEN:return types.SimpleNamespace(composition=lambda:frozen)
            raise AssertionError('unknown readonly fixture load '+str(path))
        self.enterContext(patch.object(m,'load',side_effect=loader))
        pair=meta.pair
        control.ack['actor']['unit'].update(MainPID=str(control.ack['actor']['main']['pid']),ExecStart=pair['acknowledgedActor'].replace('pid=1180697','pid='+str(control.ack['actor']['main']['pid'])))
        self.actual_actor=copy.deepcopy(control.ack['actor']);self.actual_actor['unit']['ExecStart']=pair['actualActor']
        def observe(*_):
            ack=copy.deepcopy(control.ack)
            return{'format':meta.observer.FORMAT,'validated':True,'operatorSha256':meta.wrapper.OBSERVER_SHA,
                'inputSha256':control.refs['inputSha256'],'upgradeRefs':copy.deepcopy(control.refs),
                'upgradeOperationSha256':ack['operationSha256'],'upgradeAcknowledgement':ack,'actor':copy.deepcopy(self.actual_actor),
                **{key:copy.deepcopy(ack[key])for key in['boot','metadataInputSha256','metadataOperationSha256','metadataSelectedSha256',
                    'historicalActor','historicalBoot','artifactDigest','artifactManifestSha256','workerSha256',
                    'sourceActorQualified','READAuthorityQualified','publicationAuthorityQualified','financialAuthorityQualified',
                    'databaseWrites','serviceActions','providerCalls']},
                'execStartPresentation':meta.observer.actor_relation(self.actual_actor,ack['actor']),
                'currentActorQualified':True,'immutableAcknowledgementOnly':False,'originalOwner3CurrentPassed':False}
        self.observe=Mock(side_effect=observe);self.enterContext(patch.object(meta.observer,'actor_current',side_effect=self.observe))
        actual_derive=self.h.derive
        def derive(*args,**kwargs):
            result=actual_derive(*args,**kwargs)
            if args[1]==old.scope['prior'].a.KERNEL_SHA:result.helper=lambda:self.h
            return result
        self.enterContext(patch.object(self.h,'derive',side_effect=derive))
        self.value=m.composed(control.manifest_sha,control.refs)

    def test_real_preflight_calls_observer_with_full_source_parent_once_and_raw_ACK_unchanged(self):
        session=object.__new__(self.value.Session)
        cls=next(c for c in self.value.Session.__mro__ if 'preflight'in vars(c))
        with patch.object(cls.__bases__[0],'preflight',return_value={'fullSOURCE':'fixture'})as source:
            proof=session.preflight()
        source.assert_called_once();self.assertEqual(self.observe.call_count,2)
        self.assertEqual(proof['metadataActorCurrent']['actor'],self.actual_actor)
        self.assertEqual(proof['metadataEpoch']['acknowledgement']['actor'],self.control.ack['actor'])
        self.assertNotEqual(proof['metadataActorCurrent']['actor'],proof['metadataEpoch']['acknowledgement']['actor'])

    def test_real_bound_provider_selects_observed_namespace_before_prepared_constructor(self):
        provider=object.__new__(self.value.BoundProvider);provider.entry=old.scope['p']
        provider.source=types.SimpleNamespace(inverse=False,current=Mock())
        control=self.control
        class Entry:
            def __getattr__(self,name):
                entry=old.scope['p']
                return getattr(entry,name)if hasattr(entry,name)else getattr(control.frozen_provider,name)
            def namespace(self,config,*args,**kwargs):return provider.namespace(config)
        # Reuse the retained fixture's exact filesystem/common-module seam;
        # the real bound Provider.namespace and cache factory still execute.
        with patch.object(old.scope['prior'],'p',Entry()):n=control.base.actual_provider()
        cache=n.cache_runtime()
        self.assertTrue(cache.readonly_metadata_observation)
        self.assertEqual(cache.metadata_epoch_namespace.metadata_epoch_helper_file,meta.wrapper.FILE)
        self.assertEqual(cache.metadata_epoch.binding()['refs'],self.control.refs)
        self.assertEqual(cache.FORMAT,'yunipals-ypal-ordinary-read-cache-continue-v4')
        self.assertEqual(cache.ENTRY_SHA,'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705')
        self.assertEqual(cache.metadata_epoch_namespace.metadata.__code__.co_freevars,())

    def test_both_derived_and_public_effects_and_reader_constructor_are_closed(self):
        for name in ['execute_cache','execute_reader','attempt','qualify','reader_inverse_core']:
            with self.assertRaisesRegex(RuntimeError,'no_effect_or_qualification'):getattr(self.value,name)()
        for name in ['construct_records','qualify_held','execute_cache','execute_reader']:
            with self.assertRaisesRegex(RuntimeError,'no_effect_or_qualification'):getattr(m,name)()
        with self.assertRaisesRegex(RuntimeError,'no_effect_or_qualification'):self.value.Session.reader_context(object())
        with self.assertRaisesRegex(RuntimeError,'no_inverse_authority'):m.Session({},'fixture',{},True)

    def test_context_identity_binds_new_helper_and_caller_without_old_timing_alias(self):
        self.value.own_sha=lambda:m.sha(local_public(m.FILE))
        epoch=current.Epoch(self.control.refs,self.control.manifest)
        session=types.SimpleNamespace(key={'target':'cache','inputSha256':'fixture','direction':'forward'},metadata_epoch=epoch,
            host=types.SimpleNamespace(config={'generationBindingSha256':self.control.base.control.binding_sha}),
            protocol=load('ypal-ordinary-publication-protocol-v6.py'))
        key=self.value.timing_key(session,'cache-prepared-held')
        self.assertEqual(key['operatorSha256'],m.sha(local_public(m.FILE)))
        self.assertEqual(key['metadataCurrentHelperSha256'],m.CURRENT_SHA)
        self.assertEqual(key['metadataEpoch']['acknowledgement']['actor'],self.control.ack['actor'])
        self.assertNotEqual(key['metadataCurrentHelperSha256'],'33ae8619fe0a43b94745b1a00ae57db166592c83ccf6a997d50cd8c583fdff51')

    def test_real_defaults_are_inert_and_all_current_sources_authenticate(self):
        import subprocess
        for name in [m.FILE.name,meta.wrapper.FILE.name]:
            output=json.loads(subprocess.run(['python3','-I','-B',str(HERE/name)],capture_output=True,check=True).stdout)
            self.assertTrue(output['staticOnly']);self.assertFalse(output['effectAuthority'])
        self.assertEqual(m.authenticate()['files'][m.FILE.name],m.sha(local_public(m.FILE)))

if __name__=='__main__':unittest.main()
