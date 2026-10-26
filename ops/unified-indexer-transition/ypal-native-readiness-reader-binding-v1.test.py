"""Real cold Reader6 grammar/core; explicit private constructor I/O boundaries."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
w=load('ypal-native-readiness-reader-binding-v1.py')
family_tests=load('ypal-ordinary-readiness-family-v1.test.py')
prepared_tests=load('ypal-native-readiness-prepared-binding-v1.test.py')
real_load=w.load

def relocated_generation_source(name):
    module=real_load(name)
    if name==w.GENERATION:
        module.public=family_tests.local;parent_load=module.load
        def source_parent(basename):
            parent=parent_load(basename);parent.public=family_tests.local;return parent
        module.load=source_parent;genuine=module.generation
        def generation(owner,policy):
            # The old caller fixture supplies a stand-in owner whose
            # implementation is a test lambda. Restore the actual public
            # owner before exercising the new complete-code provenance guard.
            self_path=Path(owner.__file__)
            if self_path!=w.OPS/'ypal-ordinary-generation-accept-v3.py':raise AssertionError('foreign fixture owner')
            actual=real_load('ypal-ordinary-generation-accept-v3.py')
            actual.public=family_tests.local;return genuine(actual,policy)
        module.generation=generation
    return module


class Cold(unittest.TestCase):
    def setUp(self):
        self.f=family_tests.Controls();self.f.setUp();self.addCleanup(self.f.doCleanups)
        self.enterContext(patch.object(w,'public',side_effect=family_tests.local))
        self.enterContext(patch.object(w,'load',side_effect=relocated_generation_source))

    def test_complete_actual_map_and_default_inert(self):
        w.authenticate();expected=json.loads(family_tests.local(w.MANIFEST))
        self.assertEqual(len(expected['files']),340)
        result=subprocess.run([sys.executable,'-I','-B',str(HERE/w.FILE.name)],check=True,capture_output=True,text=True)
        self.assertTrue(json.loads(result.stdout)['staticOnly']);self.assertFalse(result.stderr)

    def test_actual_old_refusal_then_full_core_and_real_phase_provider_route(self):
        original=self.f.family.reader()
        with self.assertRaisesRegex(RuntimeError,'finite_actual_bound_reader_manifest'):original.core(self.f.manifest_sha)
        reader=w.reader_namespace(self.f.family);root,proof=reader.core(self.f.manifest_sha)
        provider=proof.module_context('phase')
        self.assertIs(provider,self.f.family.provider());self.assertTrue(callable(provider.create_phase))
        self.assertEqual(proof.native_readiness_reader_binding,reader.native_readiness_reader_binding)
        self.assertEqual(proof.native_readiness_reader_binding['readerManifestSha256'],self.f.manifest_sha)
        # Scope's full predicate body remains the actual inherited code. Supply
        # its I/O result here to test the one new return/operation data seam.
        method=proof._implementation.Proof.scope
        with patch.object(proof._implementation.Proof,'scope',lambda self,*args,**kwargs:{'explicitFullScopeIOFixture':True}):
            scope=proof.scope(object(),False)
        self.assertTrue(scope['explicitFullScopeIOFixture'])
        self.assertEqual(scope['readerRouteBinding'],reader.native_readiness_reader_binding)
        self.assertIs(proof._implementation.Proof.scope,method)
        # Actual unmodified review saves this exact scope under sourceScope.
        review=next(node for node in ast.parse(family_tests.local('ypal-native-cutover-v1.py')).body if isinstance(node,ast.FunctionDef)and node.name=='review')
        saved=[row for row in ast.walk(review)if isinstance(row,ast.Dict)and any(isinstance(key,ast.Constant)and key.value=='sourceScope'for key in row.keys)]
        self.assertEqual(len(saved),1)
        self.assertEqual(next(ast.unparse(value)for key,value in zip(saved[0].keys,saved[0].values)if isinstance(key,ast.Constant)and key.value=='sourceScope'),'scope')
        self.assertEqual(w.code(root.review.__code__),w.code(load('ypal-native-cutover-v1.py').review.__code__))

    def test_only_exact_four_equal_duplicates_and_full_other_manifest_predicates(self):
        reader=w.reader_namespace(self.f.family);_,proof=reader.core(self.f.manifest_sha)
        good=copy.deepcopy(proof.manifest)
        self.assertTrue(w.same_declared_overlap(good))
        mutations=[lambda value:value['dependencies'].pop(next(iter(w.OVERLAP))),
            lambda value:value['dependencies'].update({w.READER:value['files'][w.READER]}),
            lambda value:value['dependencies'].update({next(iter(w.OVERLAP)):'f'*64}),
            lambda value:value.update(dataIdentity={}),lambda value:value.update(externalFeatureContract={}),
            lambda value:value['contexts']['phase'].update(sha256='f'*64),lambda value:value['acknowledgementRoute'].update(method='current')]
        for mutate in mutations:
            bad=copy.deepcopy(good);mutate(bad)
            with self.assertRaises(RuntimeError):reader.manifest_contract(bad,proof.generation_binding)
        with self.assertRaisesRegex(RuntimeError,'one_explicit'):w.reader_namespace(self.f.family)

    def test_ACK_route_requires_recorded_operation_descriptor_and_preserves_original_error(self):
        reader=w.reader_namespace(self.f.family);binding=reader.native_readiness_reader_binding
        original=w.closure(reader.acknowledgement)['original_ack']
        operation={'binding':{'sourceScope':{'readerRouteBinding':copy.deepcopy(binding)}}}
        original_result={'operationSha256':'a'*64,'explicitCompleteACKIOFixture':True}
        calls=[]
        def read(path,digest=None):
            if Path(path)==reader.BASE/'operation.json':
                self.assertEqual(digest,'a'*64);calls.append('immutable-operation-I/O');return w.encoded(operation)
            return family_tests.local(path,digest)
        owner=types.SimpleNamespace(acknowledgement=lambda *_:copy.deepcopy(original_result))
        with patch.dict(original.__globals__,{'coordinator_module':lambda:owner}),patch.object(w,'public',side_effect=read),\
                patch.object(reader,'core',side_effect=AssertionError('new wrapper must not create a current context')):
            result=reader.acknowledgement('b'*64,self.f.manifest_sha)
            self.assertTrue(result['explicitCompleteACKIOFixture']);self.assertEqual(result['readerRouteBinding'],binding)
            self.assertFalse(result['originalReader6ACKRoutePassed'])
            operation['binding']['sourceScope']['readerRouteBinding']={}
            with self.assertRaisesRegex(RuntimeError,'must_record'):reader.acknowledgement('b'*64,self.f.manifest_sha)
            error=TimeoutError('actual-original-ACK-I/O-error')
            owner.acknowledgement=lambda *_:(_ for _ in()).throw(error)
            with self.assertRaises(TimeoutError)as caught:reader.acknowledgement('b'*64,self.f.manifest_sha)
            self.assertIs(caught.exception,error)
        self.assertEqual(len(calls),2)


class SessionBinding(unittest.TestCase):
    def test_real_prepared_session_reader_constructor_and_timing_keep_both_bindings(self):
        fixture=prepared_tests.Controls();self.addCleanup(fixture.doCleanups)
        original_caller=prepared_tests.frozen_tests.Controls.caller
        def construct_with_actual_reader(actual):
            # Older caller fixture replaces every nested helper export for
            # bootstrap I/O. Build the genuine Family reader before that
            # temporary relocation, preserving its actual feature5 literals.
            actual.family.reader();return original_caller(actual)
        with patch.object(prepared_tests.frozen_tests.Controls,'caller',new=construct_with_actual_reader):fixture.setUp()
        self.enterContext(patch.object(w,'public',side_effect=family_tests.local))
        self.enterContext(patch.object(w,'load',side_effect=relocated_generation_source))
        constructor=prepared_tests.m.bind(fixture.session)
        binding=w.bind(fixture.session);session=fixture.session;caller=fixture.caller
        self.assertEqual(binding,session.native_readiness_reader_binding)
        root=fixture.family.reader();original_bind=caller.bind_proof
        # The complete public Session.reader_context and complete cold Proof
        # constructor run. Only the later private Phase/Host/metadata workload
        # initializer is explicit I/O, not a production-context qualification.
        def phase_IO(proof_class,provider):
            self.assertIs(proof_class,root.Proof)
            class Proof(proof_class):
                def initialize(self,context,inputs):
                    context.explicitPrivatePhaseIO=True
                    context.host=types.SimpleNamespace(config={'generationBindingSha256':fixture.f.manifest['generationBinding']['sha256']})
            return Proof
        original_public=fixture.f.old.h.public
        def actual_reader_manifest(path,digest=None,maximum=4000000):
            if Path(path).name==w.READER_MANIFEST:return family_tests.local(path,digest)
            return original_public(path,digest,maximum)
        with patch.object(caller,'bind_proof',side_effect=phase_IO),patch.object(fixture.f.old.h,'public',side_effect=actual_reader_manifest):
            session.readonly_preflight={'explicitPreflightIOFixture':True}
            _,proof,context=session.reader_context(fixture.f.manifest_sha,{'explicitPrivateInputsIOFixture':True})
        self.assertIs(caller.bind_proof,original_bind);self.assertTrue(context.explicitPrivatePhaseIO)
        self.assertEqual(session.key['readerRouteBinding'],binding)
        self.assertEqual(session.key['preparedConstructorBinding'],constructor)
        key=caller.timing_key(session,'reader-before-login')
        self.assertEqual(key['readerRouteBinding'],binding);self.assertEqual(key['preparedConstructorBinding'],constructor)
        self.assertEqual(proof.native_readiness_reader_binding,binding)
        with self.assertRaisesRegex(RuntimeError,'one_reader_route'):w.bind(session)
        session.native_readiness_prepared_binding={}
        with self.assertRaisesRegex(RuntimeError,'same_owned_reader_route'):caller.timing_key(session,'reader-before-login')


if __name__=='__main__':unittest.main()
