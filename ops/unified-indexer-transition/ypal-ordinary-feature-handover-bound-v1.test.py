"""Actual thin feature composition; source fixtures never replace real events."""
import ast
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent

def load(name):
    path = HERE/name; spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

helper_code = load('ypal-ordinary-generation-binding-v1.py')
def local_public(path, expected=None, maximum=4000000):
    raw = (HERE/Path(path).name).read_bytes()
    if expected is not None: helper_code.need(helper_code.sha(raw) == expected, 'actual_exact_public_fixture_source_required')
    helper_code.need(len(raw) <= maximum, 'bounded_public_fixture_source_required')
    return raw

source_helper = types.SimpleNamespace(public=local_public, derive=helper_code.derive, need=helper_code.need,
    pin=helper_code.pin, sha=helper_code.sha)
wrapper = load('ypal-ordinary-feature-handover-bound-v1.py')
context = load('ypal-ordinary-feature-context-bound-v1.py')
wrapper.helper = lambda: source_helper
context.helper = lambda: source_helper
original = (HERE/'ypal-feature-handover-v1.py').read_bytes()
assembler_raw = (HERE/'ypal-restored-feature-handover-v1.py').read_bytes()
m = wrapper.assemble(original, context, assembler_raw)
# Fixture source lives in this checkout; operational namespaces retain OPS.
m.__file__ = str(HERE/wrapper.FILE.name)

# Execute the25 reviewed original lifecycle/file/unknown-ACK controls unchanged.
old_tests = (HERE/'ypal-feature-handover-v1.test.py').read_bytes()
assert helper_code.sha(old_tests) == 'eaed49340a4ccd59590cf385b28b2763d1440ef5a289f446d1077379a7694255'
body = [value for value in ast.parse(old_tests).body if isinstance(value, (ast.FunctionDef, ast.ClassDef))]
exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), __file__, 'exec'), globals())


def dependencies():
    return {**context.PINNED, **{name:helper_code.sha((HERE/name).read_bytes()) for name in context.EXTERNAL}}


def ancestry_fixture():
    implementation = context.composition(); deps = dependencies(); config = {key:'3'*64 for key in context.CONFIG}
    config['readerManifestSha256'] = deps[context.READER_MANIFEST]
    files = {wrapper.FILE.name:helper_code.sha((HERE/wrapper.FILE.name).read_bytes()),
        context.FILE.name:helper_code.sha((HERE/context.FILE.name).read_bytes())}
    recorded = {'validated':True,'immutableReaderAcknowledgementOnly':True,'published':True,
        'receiptSha256':config['readerResultSha256'],'manifestSha256':config['readerManifestSha256'],
        'operatorSha256':deps[context.READER],'operationSha256':'5'*64,'publicationSha256':'6'*64,
        'readSchema':implementation.READ_SCHEMA,'readIdentity':implementation.READ_IDENTITY,'sourceRelease':'4e',
        'readConfig':{'admissionSha256':config['readAdmissionSha256'],'readPlanSha256':config['readPlanSha256'],
            'readContextInputSha256':config['readContextInputSha256']},
        'cachePreparedSha256':config['cachePreparedSha256'],'cacheInputsSha256':config['cacheInputsSha256'],
        'currentReadersQualified':False,'currentWriterQualified':False,'sourceActorQualified':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    manifest = {'acknowledgementRoute':{'file':context.READER,'sha256':deps[context.READER],'method':'acknowledgement'},
        'files':{context.READER:deps[context.READER]},'contexts':{'phase':{'file':context.PROVIDER,'sha256':deps[context.PROVIDER]}}}
    h = types.SimpleNamespace(b=types.SimpleNamespace(document=Mock(return_value=manifest)),config=config,
        manifest={'files':files,'dependencies':deps},manifest_pin='a'*64,input_pin='b'*64,
        intake=types.SimpleNamespace(DATA={'sourceRelease':'4e'}),coordinator=types.SimpleNamespace(
            MANIFEST=context.OPS/context.READER_MANIFEST,acknowledgement=Mock(return_value=recorded),
            validate_reader_leaf=Mock(side_effect=AssertionError('feature recursion forbidden')),
            validate_current=Mock(side_effect=AssertionError('whole reader validation forbidden'))))
    proof = {'format':context.FORMAT,'validated':True,'operatorSha256':files[wrapper.FILE.name],'receiptSha256':'e'*64,
        'sourceActorQualified':False,'financialAuthorityQualified':False,'originalWholeValidatorsPassed':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}
    return h, manifest, recorded, proof


class BoundFeatureControls(unittest.TestCase):
    def test_default_owner_and_context_are_inert_without_OPS_or_future_receipts(self):
        for module in [wrapper,context]:
            value = subprocess.run(['/usr/bin/python3','-I','-B',module.__file__],capture_output=True,check=True)
            data = json.loads(value.stdout)
            self.assertEqual(data['databaseWrites'],0);self.assertEqual(data['serviceActions'],0)
            self.assertTrue(data.get('sourceOnly') or data.get('staticOnly'))

    def test_new_namespaces_and_all_owner_business_bodies_are_retained(self):
        frozen_wrapper = load('ypal-ordinary-feature-handover-v6.py')
        frozen_context = load('ypal-ordinary-feature-context-v6.py')
        old = frozen_wrapper.assemble(original,frozen_context,assembler_raw)
        self.assertEqual(m.FORMAT,wrapper.FORMAT);self.assertEqual(m.BASE,wrapper.BASE)
        self.assertEqual(m.INPUT,wrapper.INPUT);self.assertNotEqual(m.BASE,old.BASE)
        self.assertIn('feature-bound-v1',str(m.SELECTOR));self.assertNotIn('ordinary-v6',str(m.DROPS[m.API]))
        for name,member in vars(old.Owner).items():
            if callable(member):self.assertEqual(getattr(m.Owner,name).__code__.co_code,member.__code__.co_code,name)
        for name in ['fresh_event','availability','parity_current','definitions','old_inputs','source_activation']:
            self.assertEqual(getattr(m.HistoricalHost,name).__code__.co_code,getattr(old.HistoricalHost,name).__code__.co_code,name)

    def test_context_has_only_manifest_identity_and_external_dependency_seams(self):
        frozen = load('ypal-ordinary-feature-context-v6.py'); actual = context.composition()
        self.assertEqual(actual.PROVIDER,context.PROVIDER);self.assertEqual(actual.READER,context.READER)
        for name in ['reader_ancestry','initialize','feature_leaf_binding','inverse_catalog_phase']:
            self.assertEqual(getattr(actual,name).__code__.co_code,getattr(frozen,name).__code__.co_code,name)
        for name,member in vars(frozen.HostMixin).items():
            if callable(member):self.assertEqual(getattr(actual.HostMixin,name).__code__.co_code,member.__code__.co_code,name)
        self.assertIn(wrapper.FILE.name,actual.initialize.__code__.co_consts)
        self.assertNotIn('ypal-ordinary-feature-handover-v6.py',actual.feature_leaf_binding.__code__.co_consts)

    def test_manifest_uses_actual_new_reader_provider_and_ACK_route(self):
        builder = load('ypal-ordinary-feature-bound-v1-manifest.py'); value = builder.build()
        self.assertEqual(value['format'],context.FORMAT+'-code')
        self.assertEqual(set(value['files']),{wrapper.FILE.name,context.FILE.name})
        self.assertEqual(value['dependencies'][context.READER],helper_code.sha((HERE/context.READER).read_bytes()))
        self.assertNotIn('ypal-ordinary-reader-cutover-v6.py',value['dependencies'])
        self.assertNotIn('ypal-ordinary-read-cache-v6.py',value['dependencies'])
        with tempfile.TemporaryDirectory() as folder,self.assertRaises(FileNotFoundError):builder.build(Path(folder))
        with self.assertRaises(RuntimeError):context.exact_dependencies({**dependencies(),'foreign.py':'1'*64})

    def test_bound_immutable_reader_route_and_source_only_envelope_are_exact(self):
        h,manifest,recorded,proof = ancestry_fixture(); value = context.feature_leaf_binding(h,proof)
        self.assertEqual(value['operatorSha256'],proof['operatorSha256']);self.assertEqual(value['manifestSha256'],h.manifest_pin)
        self.assertEqual(value['contextSha256'],h.manifest['files'][context.FILE.name])
        self.assertEqual(value['readerAncestry']['readerOperatorSha256'],h.manifest['dependencies'][context.READER])
        self.assertEqual(value['readerAncestry']['readerManifestSha256'],h.config['readerManifestSha256'])
        h.coordinator.acknowledgement.assert_called_once_with(h.config['readerResultSha256'],h.config['readerManifestSha256'])
        h.coordinator.validate_reader_leaf.assert_not_called();h.coordinator.validate_current.assert_not_called()
        for key,bad in [('file','ypal-ordinary-reader-cutover-v6.py'),('sha256','7'*64),('method','validate_current')]:
            previous=manifest['acknowledgementRoute'][key];manifest['acknowledgementRoute'][key]=bad
            with self.assertRaises(RuntimeError):context.feature_leaf_binding(h,proof)
            manifest['acknowledgementRoute'][key]=previous
        recorded['currentWriterQualified']=True
        with self.assertRaises(RuntimeError):context.feature_leaf_binding(h,proof)

    def test_reader_manifest_ref_must_match_actual_external_feature_dependency(self):
        h,manifest,recorded,proof = ancestry_fixture();h.config['readerManifestSha256']='8'*64
        with self.assertRaises(RuntimeError):context.acknowledgement_route(h)
        h.b.document.assert_not_called()

    def test_strict_opening_claim_gate_still_requires_all9_fields_before_canonical_gate(self):
        event={'blockNumber':101,'blockHash':'0x'+'1'*64,'transactionHash':'0x'+'2'*64,'logIndex':0}
        row={'id':'fixture-only','address':'0x'+'3'*40,'name':'RequestCreated','args':'{"opening":true}',
            'block_number':101,'block_hash':event['blockHash'],'timestamp':1000,'transaction_hash':event['transactionHash'],'log_index':0}
        frozen={'left':1,'right':1,'canonical':event['blockHash']}
        h=types.SimpleNamespace(b=m,query=Mock(),native=Mock())
        for name in ['RequestCreated','RequestCompleted']:
            actual={**row,'name':name};h.query.side_effect=[{'left':[actual],'right':[actual]},frozen]
            self.assertEqual(context.HostMixin.fresh_event(h,event,100),event)
        for rows in [{'left':[row],'right':[{**row,'args':'changed'}]},
            {'left':[{**row,'name':'TypeActivated'}],'right':[{**row,'name':'TypeActivated'}]},
            {'left':[row,row],'right':[row]}, {'left':[row],'right':[]}]:
            h.query.side_effect=[rows]
            with self.assertRaises(RuntimeError):context.HostMixin.fresh_event(h,event,100)
        h.query.reset_mock()
        with self.assertRaises(RuntimeError):context.HostMixin.fresh_event(h,{**event,'blockNumber':100},100)
        h.query.assert_not_called()

    def test_runtime_wrapper_routes_actual_new_context_without_frozen_success_alias(self):
        actual=wrapper.composition()
        self.assertEqual(actual.CONTEXT,context.FILE);self.assertEqual(actual.MANIFEST,wrapper.MANIFEST)
        self.assertIn('actual_bound_feature_context',actual.runtime.__code__.co_consts)
        self.assertNotEqual(actual.__file__,str(wrapper.FROZEN))
        self.assertEqual(helper_code.sha((HERE/wrapper.FROZEN.name).read_bytes()),wrapper.FROZEN_SHA)
        self.assertEqual(helper_code.sha((HERE/context.FROZEN.name).read_bytes()),context.FROZEN_SHA)


if __name__ == '__main__':unittest.main()
