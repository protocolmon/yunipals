"""Actual Reader core/Session and complete Host prerequisites; private I/O explicit."""
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
m=load('ypal-native-readiness-reader-generation-binding-v1.py')
r=load('ypal-native-readiness-reader-binding-v1.test.py')
local=r.family_tests.local
real_load=m.load

def source(name):
    if name==m.ROUTE:return r.w
    value=real_load(name)
    if name==m.GENERATION:value.public=local
    return value


class Actual(unittest.TestCase):
    def setUp(self):
        self.cold=r.Cold();self.cold.setUp();self.addCleanup(self.cold.doCleanups)
        self.f=self.cold.f
        self.enterContext(patch.object(m,'public',side_effect=local))
        self.enterContext(patch.object(m,'load',side_effect=source))
        self.reader=m.reader_namespace(self.f.family)
        self.namespace=self.f.provider_namespace();self.cache=self.namespace.cache_runtime()
        # The actual compiled Host class and unchanged prerequisites body are
        # retained. Its private data constructor is explicit I/O for this test.
        self.host=object.__new__(self.cache.Host);self.host.config=copy.deepcopy(self.f.old.config)

    def test_full_source_default_inert_and_actual_cold_core(self):
        m.authenticate();self.assertEqual(len(m.SOURCE_PINS)+1,342)
        out=subprocess.run([sys.executable,'-I','-B',str(HERE/m.FILE.name)],capture_output=True,text=True,check=True)
        self.assertTrue(json.loads(out.stdout)['staticOnly']);self.assertFalse(out.stderr)
        _,proof=self.reader.core(self.f.manifest_sha)
        self.assertIs(proof.module_context('phase'),self.f.family.provider())
        self.assertEqual(proof.scope.__func__.__code__,r.w.nested(m.reader_namespace.__code__,'Proof','scope'))

    def fixture_Host_io(self):
        generation=source(m.GENERATION);raw=self.host.prerequisites.__func__;g=raw.__globals__;config=self.host.config
        self.assertEqual(generation.code_body(raw.__code__),generation.code_body(generation.expected_prerequisites()))
        candidate={'format':load(m.OWNER).CANDIDATE_FORMAT,'completed':True,'built':True,'validated':True,'published':False,
            'sourceRelease':g['RELEASE'],'readIdentity':g['IDENTITY'],'readAdmissionSha256':config['readAdmissionSha256'],
            'metadataSelectedSha256':config['metadataSelectionSha256'],'metadataProvenanceSha256':config['metadataProvenanceSha256'],
            'candidateSelectorsSha256':g['CANDIDATE_SHA'],'predecessorGenerationId':'103','generationId':'105'}
        proof={'validated':True,'operatorSha256':g['GENERATION_OWNER_SHA'],'receiptSha256':config['generationSha256'],'generationId':'105',
            'sourceRelease':g['RELEASE'],'readIdentity':g['IDENTITY'],'published':False,'globalContextUnchanged':True,
            'sourceReadinessQualified':False,'metadataCurrentReadinessQualified':False,'readAdmissionGraphQualified':False}
        owner=types.SimpleNamespace(validate_candidate_database_current=lambda _:copy.deepcopy(proof));calls=[]
        def modules(path,digest):
            calls.append((path,digest));return owner if path==g['GENERATION_OWNER']else object()
        def documents(path,digest=None):
            if path==g['GENERATION']:return copy.deepcopy(candidate)
            if path.name=='selected.json':return{'selected':True}
            return{'completeForCurrentPublishedArchiveBase':True,'remainingPublished':0,'publicationProof':{'allPublishedCanonical':True}}
        self.host.prerequisites=types.MethodType(generation.clone(raw,{'module':modules,'document':documents}),self.host)
        self.host.query=lambda _:{'current':'103','id':'105','state':'ready','published':False,'release':g['RELEASE'],'identity':g['IDENTITY'],'baseFrame':True}
        self.host.metadata_current=lambda *_:{'explicitFullMetadataProofIO':True}
        return generation,proof,owner,calls,g

    def test_complete_real_Host_prerequisites_keeps_body_and_rejects_candidate_and_method_drift(self):
        generation,proof,owner,calls,g=self.fixture_Host_io()
        real=m.load
        self.enterContext(patch.object(m,'load',side_effect=lambda name:generation if name==m.GENERATION else real(name)))
        # Bind uses the already authenticated generation component object
        # captured by reader_namespace; relocate only its external validator
        # I/O. Complete nested Common/Creator execution is covered by that
        # frozen component's own seven constructor/current controls.
        binder=self.reader._native_readiness_bind_reader_generation_host
        component=r.w.closure(binder)['generation']
        before=self.host.prerequisites.__func__.__code__;binder(self.host)
        self.assertIs(self.host.prerequisites.__func__.__code__,before)
        with patch.object(component,'generation',side_effect=lambda actual,policy:actual)as observed:
            value=self.host.prerequisites();self.assertEqual(value['generationId'],'105')
            self.assertEqual([row[0]for row in calls],[g['META_OWNER'],g['GENERATION_OWNER']])
            self.assertIs(observed.call_args.args[0],owner);self.assertIs(observed.call_args.args[1],self.f.family.readiness)
            proof['generationId']='106'
            with self.assertRaises(RuntimeError):self.host.prerequisites()
            error=TimeoutError('actual original generation transport error')
            owner.validate_candidate_database_current=lambda _:(_ for _ in()).throw(error)
            with self.assertRaises(TimeoutError)as caught:self.host.prerequisites()
            self.assertIs(caught.exception,error)
        self.host.prerequisites=types.MethodType(lambda self:None,self.host)
        with self.assertRaisesRegex(RuntimeError,'same_actual_reader_Host'):binder(self.host)

    def test_scope_and_pure_ACK_require_actual_owned_operation_binding(self):
        _,proof=self.reader.core(self.f.manifest_sha);binding=self.reader.native_readiness_reader_generation_binding
        parent=proof._implementation.Proof
        with patch.object(parent,'scope',lambda self,*args,**kwargs:{'explicitFullScopeIO':True}):
            value=proof.scope(types.SimpleNamespace(host=self.host),False)
        self.assertTrue(value['explicitFullScopeIO']);self.assertEqual(value['readerGenerationBinding'],binding)
        self.assertIn('readerRouteBinding',value)
        original=r.w.closure(self.reader.acknowledgement)['original_ack']
        base=r.w.closure(original)['original_ack']
        operation={'binding':{'sourceScope':{'readerRouteBinding':self.reader.native_readiness_reader_binding,
            'readerGenerationBinding':copy.deepcopy(binding)}}}
        def records(path,digest=None):
            if Path(path)==self.reader.BASE/'operation.json':
                self.assertEqual(digest,'a'*64);return m.encoded(operation)
            return local(path,digest)
        io=types.SimpleNamespace(acknowledgement=lambda *_:{'operationSha256':'a'*64,'explicitFullACKIO':True})
        with patch.dict(base.__globals__,coordinator_module=lambda:io),patch.object(m,'public',side_effect=records),patch.object(r.w,'public',side_effect=records):
            value=self.reader.acknowledgement('b'*64,self.f.manifest_sha)
            self.assertTrue(value['explicitFullACKIO']);self.assertEqual(value['readerGenerationBinding'],binding)
            operation['binding']['sourceScope']['readerGenerationBinding']={}
            with self.assertRaisesRegex(RuntimeError,'must_record_its_phase'):self.reader.acknowledgement('b'*64,self.f.manifest_sha)
        with self.assertRaises(RuntimeError):m.reader_namespace(self.f.family)


class Session(unittest.TestCase):
    def test_real_public_Reader_constructor_then_Host_binding_and_all_timing_layers(self):
        fixture=r.prepared_tests.Controls();self.addCleanup(fixture.doCleanups)
        original=r.prepared_tests.frozen_tests.Controls.caller
        def actual_reader(actual):actual.family.reader();return original(actual)
        with patch.object(r.prepared_tests.frozen_tests.Controls,'caller',new=actual_reader):fixture.setUp()
        self.enterContext(patch.object(r.w,'public',side_effect=local))
        self.enterContext(patch.object(r.w,'load',side_effect=r.relocated_generation_source))
        self.enterContext(patch.object(m,'public',side_effect=local));self.enterContext(patch.object(m,'load',side_effect=source))
        prepared=r.prepared_tests.m.bind(fixture.session);route=r.w.bind(fixture.session);binding=m.bind(fixture.session)
        session=fixture.session;caller=fixture.caller;reader=fixture.family.reader()
        def private_phase(proof_class,provider):
            self.assertIs(proof_class,reader.Proof)
            class Proof(proof_class):
                def initialize(self,context,inputs):
                    context.host=object.__new__(fixture.cache.Host)
                    context.host.config=copy.deepcopy(fixture.f.old.config)
                    context.phase=types.SimpleNamespace(host=context.host)
                    context.explicitPrivatePhaseIO=True
            return Proof
        original_public=fixture.f.old.h.public
        def manifests(path,digest=None,maximum=4000000):
            if Path(path).name=='ypal-ordinary-reader-continue-v6.manifest.json':return local(path,digest)
            return original_public(path,digest,maximum)
        with patch.object(caller,'bind_proof',side_effect=private_phase),patch.object(fixture.f.old.h,'public',side_effect=manifests):
            session.readonly_preflight={'explicitFullPreflightIO':True}
            _,proof,context=session.reader_context(fixture.f.manifest_sha,{'explicitPrivateInputsIO':True})
        self.assertTrue(context.explicitPrivatePhaseIO)
        self.assertEqual(context.host.native_readiness_reader_generation_binding,binding)
        key=caller.timing_key(session,'reader-before-login')
        self.assertEqual(key['readerGenerationBinding'],binding);self.assertEqual(key['context']['readerGenerationBinding'],binding)
        self.assertEqual(key['preparedConstructorBinding'],prepared);self.assertEqual(key['readerRouteBinding'],route)
        with self.assertRaises(RuntimeError):m.bind(session)
        context.host.prerequisites=types.MethodType(lambda self:None,context.host)
        with self.assertRaises(RuntimeError):reader._native_readiness_bind_reader_generation_host(context.host)


if __name__=='__main__':unittest.main()
