"""Explicit Reader5/program-inverse source integration; no runtime acceptance."""
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

m=load('ypal-ordinary-consumer-prefix-source-v3.py')
old=load('ypal-ordinary-consumer-prefix-source-v1.py')
fixtures=load('ypal-ordinary-consumer-prefix-source-v1.test.py')

def public(path,digest=None):
    p=HERE/Path(path).name
    if not p.exists():
        choices=[p for p in HERE.parent.rglob(Path(path).name)if p.is_file()]
        choices=[p for p in choices if digest is None or m.sha(p.read_bytes())==digest]
        m.need(len(choices)==1,'one_actual_source_origin_required');p=choices[0]
    raw=p.read_bytes();m.need(digest is None or m.sha(raw)==digest,'exact_actual_source_pin_required');return raw

class Controls(unittest.TestCase):
    def runtime(self):
        with patch.object(m,'public',side_effect=public):value=m.composition()
        value.own_sha=m.own_sha
        return value

    def config(self):
        return {'format':m.FORMAT+'-input','postfeatureInputSha256':'a'*64,
            'consumerPrefix':{'producerSha256':m.SOURCE_PINS[m.MAPPER],'manifestSha256':m.SOURCE_PINS[m.MAPPER_MANIFEST]},
            'readerRefs':{'resultSha256':'b'*64,'producerSha256':m.SOURCE_PINS[m.READER],'manifestSha256':m.SOURCE_PINS[m.READER_MANIFEST]},
            'metadataInverse':{'inputSha256':'c'*64,'producerSha256':'d'*64,'manifestSha256':'e'*64},'cacheFinish':None}

    def test_complete_actual_new_source_namespace_and_reader5_constructor(self):
        runtime=self.runtime();helper=types.SimpleNamespace(protected=public)
        mapper=m.mapper_module(helper,self.config()['consumerPrefix'])
        self.assertEqual(mapper.FORMAT,m.MAPPER_FORMAT)
        self.assertEqual(mapper.READER_SHA,m.SOURCE_PINS[m.READER])
        self.assertEqual(runtime.POSTFEATURE,'ypal-ordinary-postfeature-source-v5.py')
        self.assertIn('ypal-ordinary-feature-inverse-call-v5.py',runtime.bootstrap.__code__.co_consts)
        self.assertNotIn(m.FILE.name,mapper.SOURCE_PINS)

    def test_full_source_current_feature_and_four_peer_functions_retain_complete_bodies(self):
        runtime=self.runtime()
        for name in ['source_facts','feature_current','consumer_current']:
            self.assertEqual(getattr(runtime,name).__code__.co_code,getattr(old,name).__code__.co_code)
            self.assertEqual(getattr(runtime,name).__code__.co_consts,getattr(old,name).__code__.co_consts)
        parent=runtime.Authority.__mro__[1]
        self.assertEqual(parent.current.__code__.co_code,old.Authority.current.__code__.co_code)
        self.assertEqual(parent.current.__code__.co_consts,old.Authority.current.__code__.co_consts)

    def test_metadata_inverse_refs_must_be_explicit_and_cannot_replace_reader5(self):
        value=self.config();self.assertEqual(m.configuration(value),value)
        value['metadataInverse']=None;self.assertIsNone(m.configuration(value)['metadataInverse'])
        del value['metadataInverse']
        with self.assertRaisesRegex(RuntimeError,'explicit_metadata_inverse'):m.configuration(value)
        value=self.config();value['readerRefs']['producerSha256']='f'*64
        with self.assertRaisesRegex(RuntimeError,'fixed_reader5_and_mapper3'):m.configuration(value)
        value=self.config();value['metadataInverse']['resultSha256']='f'*64
        with self.assertRaisesRegex(RuntimeError,'inverse_three_refs'):m.configuration(value)

    def test_actor_prefix_proxy_passes_exact_distinct_inverse_input_and_refuses_mutation(self):
        refs=self.config()['metadataInverse'];reader=self.config()['readerRefs']
        source=types.SimpleNamespace(validate_current_prefix=Mock(return_value={'binding':{'metadataInverseRefs':copy.deepcopy(refs),'cacheFinishRefs':None}}))
        proxy=m.mapper_direction(source,refs);proxy.validate_current_prefix(reader)
        source.validate_current_prefix.assert_called_once_with(reader,refs,None)
        source.validate_current_prefix.return_value['binding']['metadataInverseRefs']['inputSha256']='f'*64
        with self.assertRaisesRegex(RuntimeError,'same_actual_metadata_inverse_input'):proxy.validate_current_prefix(reader)

    def test_changed_mapper_manifest_or_bytes_refuses_before_evaluation(self):
        refs=self.config()['consumerPrefix']
        def read(path,digest=None):
            if Path(path).name==m.MAPPER_MANIFEST:return m.encoded({'format':'wrong','files':{}})
            return public(path,digest)
        with (patch.object(m,'evaluate',side_effect=AssertionError('never evaluate changed map')),
            self.assertRaisesRegex(RuntimeError,'complete_actual_mapper3_literal_manifest')):
            m.mapper_module(types.SimpleNamespace(protected=read),refs)

    def source_fixture(self):
        fixture=fixtures.Controls();fixture.setUp();self.addCleanup(fixture.doCleanups)
        runtime=self.runtime();config=self.config();fixture.consumer['format']=m.MAPPER_FORMAT
        fixture.consumer['producerSha256']=config['consumerPrefix']['producerSha256']
        fixture.consumer['binding']['refs']=copy.deepcopy(config['readerRefs'])
        fixture.consumer['binding']['metadataInverseRefs']=copy.deepcopy(config['metadataInverse'])
        fixture.consumer['binding']['cacheFinishRefs']=copy.deepcopy(config['cacheFinish'])
        fixture.hash_consumer()
        fixture.a.owner.bound_references.refs={'reader':{key:config['readerRefs'][key]for key in['resultSha256','manifestSha256']}}
        value=runtime.Authority.__new__(runtime.Authority)
        value.a=fixture.a;value.p=fixture.p;value.input_sha='9'*64;value.actors=fixture.actor
        value.h=types.SimpleNamespace(protected=Mock(return_value=m.encoded(config)))
        value.mapper=fixture.mapper;value.config=config
        value.metadata_inverse=copy.deepcopy(config['metadataInverse']);value.supplemental_metadata_inverse=False
        value.cache_finish=copy.deepcopy(config['cacheFinish'])
        return runtime,fixture,value

    def test_cache_finish_refs_are_explicit_fixed_and_bookended_with_metadata_direction(self):
        config=self.config();del config['cacheFinish']
        with self.assertRaisesRegex(RuntimeError,'explicit_metadata_inverse'):m.configuration(config)
        refs={'inputSha256':'1'*64,
            'producerSha256':m.SOURCE_PINS['ypal-ordinary-cache-finish-retained-stop-v1.py'],
            'manifestSha256':m.SOURCE_PINS['ypal-ordinary-cache-finish-retained-stop-v1.manifest.json']}
        config=self.config();config['cacheFinish']=copy.deepcopy(refs);self.assertEqual(m.configuration(config),config)
        config['cacheFinish']['resultSha256']='2'*64
        with self.assertRaisesRegex(RuntimeError,'cache_finish_three_refs'):m.configuration(config)
        config=self.config();config['cacheFinish']={**refs,'producerSha256':'2'*64}
        with self.assertRaisesRegex(RuntimeError,'cache_finish_three_refs'):m.configuration(config)
        source=types.SimpleNamespace(validate_current_prefix=Mock(return_value={
            'binding':{'metadataInverseRefs':None,'cacheFinishRefs':copy.deepcopy(refs)}}))
        proxy=m.mapper_direction(source,None,refs);proxy.validate_current_prefix(self.config()['readerRefs'])
        source.validate_current_prefix.assert_called_once_with(self.config()['readerRefs'],None,refs)
        source.validate_current_prefix.return_value['binding']['cacheFinishRefs']['inputSha256']='3'*64
        with self.assertRaisesRegex(RuntimeError,'same_actual_cache_finish_input'):proxy.validate_current_prefix(self.config()['readerRefs'])

    def test_full_source_proof_keeps_distinct_cache_owner_input_and_frame_binding(self):
        runtime,fixture,value=self.source_fixture()
        refs={'inputSha256':'1'*64,
            'producerSha256':m.SOURCE_PINS['ypal-ordinary-cache-finish-retained-stop-v1.py'],
            'manifestSha256':m.SOURCE_PINS['ypal-ordinary-cache-finish-retained-stop-v1.manifest.json']}
        value.config['cacheFinish']=copy.deepcopy(refs);value.cache_finish=copy.deepcopy(refs)
        value.h.protected.return_value=m.encoded(value.config)
        fixture.consumer['binding']['cacheFinishRefs']=copy.deepcopy(refs);fixture.hash_consumer()
        with patch.object(runtime,'authenticate',return_value={}),patch.object(runtime,'mapper_module',return_value=fixture.mapper):proof=value.current()
        self.assertEqual(proof['cacheFinishRefs'],refs)
        self.assertEqual(proof['binding']['ownedConsumerPrefix']['cacheFinishRefs'],refs)
        self.assertEqual(proof['inputSha256'],value.input_sha)
        self.assertFalse(proof['currentReadersQualified']);fixture.a.current.assert_not_called()

    def test_full_source_ready_zero_retains_writer_kernel_and_explicit_metadata_ancestry(self):
        runtime,fixture,value=self.source_fixture();fixture.base.native['app']['is_ready']='0'
        with patch.object(runtime,'authenticate',return_value={}),patch.object(runtime,'mapper_module',return_value=fixture.mapper):proof=value.current()
        self.assertFalse(proof['frameworkReady']);self.assertTrue(proof['currentWriterQualified'])
        self.assertFalse(proof['sourceReadinessQualified']);self.assertFalse(proof['arenaCurrentQualified'])
        self.assertEqual(proof['metadataInverseRefs'],value.config['metadataInverse'])
        fixture.a.current.assert_not_called();fixture.a.prefix.arena_current.assert_not_called()

    def test_actual_supplemental_inverse_refs_avoid_input_hashcycle_without_relabelling_input(self):
        runtime,fixture,value=self.source_fixture();refs=copy.deepcopy(value.config['metadataInverse'])
        value.config['metadataInverse']=None;value.h.protected.return_value=m.encoded(value.config)
        value.metadata_inverse=refs;value.supplemental_metadata_inverse=True
        with patch.object(runtime,'authenticate',return_value={}),patch.object(runtime,'mapper_module',return_value=fixture.mapper):proof=value.current()
        self.assertEqual(proof['inputSha256'],value.input_sha)
        self.assertEqual(proof['metadataInverseRefs'],refs);self.assertTrue(proof['metadataInverseFromSupplementalRefs'])
        self.assertIsNone(value.config['metadataInverse'])
        self.assertEqual(proof['binding']['ownedConsumerPrefix']['metadataInverseRefs'],refs)

    def test_supplemental_refs_cannot_replace_an_existing_protected_inverse_input(self):
        runtime=self.runtime();parent=runtime.Authority.__mro__[1]
        def initialize(value,_):
            value.config=self.config();value.mapper=types.SimpleNamespace(validate_current_prefix=Mock())
        with patch.object(parent,'__init__',initialize),self.assertRaisesRegex(RuntimeError,'explicit_absent_input_binding'):
            runtime.Authority('a'*64,{'inputSha256':'b'*64,'producerSha256':'c'*64,'manifestSha256':'d'*64})

    def test_missing_SOURCE_positive_owner_stays_hard(self):
        runtime,fixture,value=self.source_fixture()
        fixture.mapper.validate_current_prefix.side_effect=[copy.deepcopy(fixture.consumer),copy.deepcopy(fixture.consumer)]
        fixture.base.owner.h.sessions=Mock(return_value={'73004621':{'owned':{'SOURCE':[]}}})
        with (patch.object(runtime,'authenticate',return_value={}),patch.object(runtime,'mapper_module',return_value=fixture.mapper),
            self.assertRaisesRegex(RuntimeError,'positive_actual_restored')):
            value.current()

    def test_changed_unrelated_consumer_binding_is_refused_at_source_peer_bookend(self):
        runtime,fixture,value=self.source_fixture()
        first=copy.deepcopy(fixture.consumer);changed=copy.deepcopy(first)
        changed['binding']['actualOwnedJournalSha256']='1'*64
        changed['bindingSha256']=m.sha(m.encoded(changed['binding']))
        fixture.mapper.validate_current_prefix.side_effect=[first,changed]
        with (patch.object(runtime,'authenticate',return_value={}),patch.object(runtime,'mapper_module',return_value=fixture.mapper),
            self.assertRaisesRegex(RuntimeError,'owned_consumer_prefix_changed_during_full_source_capture')):
            value.current()

if __name__=='__main__':unittest.main()
