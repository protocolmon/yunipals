"""Actual source compositions; receipt fixtures confer no live authority."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value


h=load('ypal-ordinary-generation-accept-binding-v1.py')
p=load('ypal-ordinary-read-cache-accept-v1.py')
r=load('ypal-ordinary-reader-accept-v1.py')
a=load('ypal-ordinary-publication-accept-v1.py')
b=load('ypal-ordinary-publication-accept-manifest-v1.py')
old=load('ypal-ordinary-publication-bound-v1.test.py')
accept_tests=load('ypal-ordinary-generation-accept-v1.test.py')
render_tests=load('ypal-ordinary-publication-input-render-v1.test.py')


class Controls(unittest.TestCase):
    def setUp(self):
        raw=(HERE/h.FROZEN.name).read_bytes();original=load(h.FROZEN.name)
        self.enterContext(patch.object(h,'frozen',return_value=(original,raw)))
        h._implementation=None;self.impl=h.composition()
        self.documents=b.build()
        self.public=old.local(self.documents)
        self.enterContext(patch.object(self.impl,'public',side_effect=self.public))
        actual_load=self.impl.load_code
        def local_load(path,digest):
            value=actual_load(path,digest)
            if Path(path).name in {p.FILE.name,r.FILE.name,a.FILE.name}:value.helper=lambda:h
            if Path(path).name==h.OWNER_FILE:
                value.public=lambda path,digest,maximum=4000000:self.public(path,digest,maximum)
                real=value.implementation
                def implementation():
                    result=real()
                    result.protected=lambda path,digest=None,maximum=4000000:self.public(path,digest,maximum)
                    result.load=accept_tests.local_load
                    result.own_sha=lambda:self.impl.sha(self.public(path))
                    return result
                value.implementation=implementation
            return value
        self.enterContext(patch.object(self.impl,'load_code',side_effect=local_load))
        for module in [p,r,a]:self.enterContext(patch.object(module,'helper',return_value=h))
        self.binding_sha=h.sha(old.encoded(self.documents[h.MANIFEST.name]))
        self.reader_sha=h.sha(old.encoded(self.documents[r.MANIFEST.name]))

    def binding(self):return h.Binding(self.binding_sha)

    def provider(self):
        binding=self.binding();c=old.old_cache.c;original=c.module
        read=old.old_cache.readtest.namespace();read.protected=self.public
        delta=load('ypal-ordinary-read-admission-v5b.py');delta.namespace=lambda:read
        metadata=old.old_cache.metatest.namespace();selector=load('ypal-generation-cache-candidates-v1.py')
        config={**old.old_cache.config,'generationBindingSha256':self.binding_sha}
        real=p.composition
        def composition():
            module=real();real_composed=module.composed
            def composed(binding):
                result=real_composed(binding);result.common=lambda:c;return result
            module.composed=composed;return module
        def module(path,digest):
            self.public(path,digest);name=Path(path).name
            if name=='ypal-ordinary-read-admission-v5b.py':return delta
            if name=='ypal-ordinary-metadata-handover-v5.py':return types.SimpleNamespace(namespace=lambda _:metadata)
            if name==h.OWNER_FILE:return binding.owner
            if name=='ypal-ordinary-generation-candidates-v5.py':return types.SimpleNamespace(namespace=lambda _:selector)
            return original(path,digest)
        with patch.object(p,'composition',side_effect=composition),patch.object(c,'public',side_effect=self.public), \
             patch.object(c,'load_input',return_value=old.old_cache.execution),patch.object(c,'module',side_effect=module), \
             patch.object(c,'intake',return_value=types.SimpleNamespace(protected=self.public)):
            value=p.namespace(config)
        return value,config

    def candidate(self,config):
        return {'format':h.CANDIDATE_FORMAT,'operatorSha256':self.binding().value['owner']['sha256'],
            'operationFile':str(h.BUILD_BASE/'operation.json'),'buildOperatorSha256':h.BUILD_OWNER_SHA,
            'originalAttemptCandidateCLIPassed':False,'originalStrictTerminalInvocationGatePassed':False,
            'previousAcceptanceProducerSha256':'1e29585a8c1b09747c061e47e0b2fbf2a984d10949c12f36d847b336f8a5259d',
            'previousAcceptanceCLIPassed':False,
            'built':True,'validated':True,'completed':True,'published':False,
            'sourceRelease':h.DATA_IDENTITY['sourceRelease'],'readIdentity':h.DATA_IDENTITY['readIdentity'],
            'predecessorGenerationId':'103','readAdmissionSha256':config['readAdmissionSha256'],
            'readConfig':{'admissionSha256':config['readAdmissionSha256'],'readPlanSha256':config['readPlanSha256'],
                'readContextInputSha256':config['readContextInputSha256']},
            'metadataOperatorSha256':p.METADATA_SHA,'metadataSelectedSha256':config['metadataSelectionSha256'],
            'metadataProvenanceSha256':config['metadataProvenanceSha256'],'operationSha256':'c'*64,
            'retainedOperationSha256':h.RETAINED['operationSha256'],'capsuleResultFile':h.RETAINED['capsuleFile'],
            'capsuleResultSha256':h.RETAINED['capsuleSha256'],'recoveryComponent':copy.deepcopy(h.RECOVERY_COMPONENT),
            'originalStrictCapsuleVerifierPassed':False}

    def test_real_source_closure_and_explicit_acceptance_vs_build_exports(self):
        binding=self.binding();owner=binding.owner
        self.assertEqual(owner.BASE,Path(h.ATTEMPT_BASE));self.assertNotEqual(owner.BASE,h.BUILD_BASE)
        self.assertEqual(owner.UNIT,h.ATTEMPT_UNIT)
        self.assertEqual(owner.composition().BASE,h.BUILD_BASE)
        self.assertEqual(owner.composition().FORMAT,'yunipals-ypal-ordinary-generation-attempt-v2')
        self.assertEqual(binding.value['files'][owner.ATTEMPT.name],h.BUILD_OWNER_SHA)
        self.assertNotIn('candidateSha256',binding.value)
        self.assertEqual(binding.value['dataIdentity'],old.h.DATA_IDENTITY)

    def test_actual_provider_and_runtime_route_new_receipt_but_real_old_operation(self):
        value,config=self.provider();runtime=value.cache_runtime()
        self.assertEqual(runtime.GENERATION,Path(h.ATTEMPT_BASE)/'candidate-result.json')
        self.assertEqual(runtime.GENERATION_OWNER.name,h.OWNER_FILE)
        self.assertEqual(runtime.FORMAT,p.FORMAT);self.assertEqual(value.INPUT,p.INPUT)
        candidate=self.candidate(config);read=value.read_module();paths=[]
        op={'format':'yunipals-ypal-ordinary-generation-attempt-v2','operatorSha256':h.BUILD_OWNER_SHA,
            'bootId':'fixture-boot','readAdmissionSha256':config['readAdmissionSha256']}
        def document(path,digest=None):
            paths.append(str(path))
            if Path(path)==runtime.GENERATION:return candidate
            if Path(path)==h.BUILD_BASE/'operation.json':return op
            if str(path)==h.RETAINED['capsuleFile']:return {'fixtureCapsule':True}
            raise AssertionError(str(path))
        phase=object.__new__(value.Phase);phase.cache=runtime;phase.host=types.SimpleNamespace(config=config,new_read=read)
        with patch.object(read,'document',side_effect=document),patch.object(read,'boot',return_value='fixture-boot'):
            result=phase.generation();self.assertEqual(result[1:3],(candidate,op))
            self.assertIn(candidate['operationFile'],paths)
            self.assertNotIn(str(Path(h.ATTEMPT_BASE)/'operation.json'),paths)
            op['operatorSha256']=candidate['operatorSha256']
            with self.assertRaises(RuntimeError):phase.generation()

    def test_original_candidates_and_old_success_aliases_refused(self):
        _,config=self.provider();binding=self.binding();candidate=self.candidate(config)
        binding.candidate(candidate,config)
        for key,value in [('operationFile',str(Path(h.ATTEMPT_BASE)/'operation.json')),
                          ('buildOperatorSha256',candidate['operatorSha256']),
                          ('originalAttemptCandidateCLIPassed',True),('originalStrictTerminalInvocationGatePassed',True),
                          ('previousAcceptanceCLIPassed',True),('previousAcceptanceProducerSha256',h.BUILD_OWNER_SHA),
                          ('format',old.h.CANDIDATE_FORMAT),('operatorSha256',h.BUILD_OWNER_SHA)]:
            changed=copy.deepcopy(candidate);changed[key]=value
            with self.assertRaises(RuntimeError):binding.candidate(changed,config)
        changed=copy.deepcopy(candidate);changed['originalAttemptCandidateCLIpassed']=changed.pop('originalAttemptCandidateCLIPassed')
        with self.assertRaises(KeyError):binding.candidate(changed,config)

    def test_complete_transaction_bodies_and_protocol_are_retained(self):
        value,_=self.provider();runtime=value.cache_runtime();original=load('ypal-cache-guard-owner-v1.py')
        for name in ['commit','reconcile_commit','inverse','reconcile_inverse','prepare_ack']:
            self.assertEqual(getattr(runtime,name).__code__.co_code,getattr(original,name).__code__.co_code)
        proof=r.Proof(self.reader_sha);root=r.assemble(self.public(r.TEMPLATE,r.TEMPLATE_SHA),proof)
        self.assertEqual(root.FORMAT,r.FORMAT);self.assertEqual(root.ENTRY.name,r.SQL)
        self.assertEqual(proof.generation_binding.value['owner']['file'],h.OWNER_FILE)
        original=load('ypal-native-cutover-v1.py')
        for name in ['publish','admit_readers','reconcile_publication','inverse','inverse_global']:
            self.assertEqual(getattr(root,name).__code__.co_code,getattr(original,name).__code__.co_code)
        self.assertIn(360,root.child.__code__.co_consts);self.assertEqual(root.MAX_PREPARATION_SECONDS,1200)
        self.assertEqual(r.WIRE_SHA,old.r.WIRE_SHA);self.assertEqual(r.TRANSPORT_SHA,old.r.TRANSPORT_SHA)

    def test_new_timing_domains_and_explicit_downstream_ack_route(self):
        caller=a.composition().composed()
        self.assertEqual(caller.FORMAT,a.FORMAT);self.assertEqual(caller.READER,a.READER)
        self.assertEqual(caller.PROVIDER_SHA,h.sha(self.public(p.FILE)))
        contract=r.external_feature_contract()
        self.assertEqual(contract['acknowledgementFile'],r.FILE.name)
        self.assertEqual(contract['ownerFile'],r.FEATURE)
        self.assertNotEqual(r.FEATURE,old.r.FEATURE)
        manifest=self.documents[r.MANIFEST.name]
        self.assertEqual(manifest['acknowledgementRoute']['sha256'],h.sha(self.public(r.FILE)))
        self.assertEqual(manifest['contexts']['phase']['file'],p.FILE.name)
        self.assertNotEqual(a.FORMAT,old.a.FORMAT)

    def test_actual_timing_validator_refuses_old_caller_provider_and_other_binding(self):
        caller=a.composition().composed();caller.own_sha=lambda:h.sha(self.public(a.FILE))
        session=types.SimpleNamespace(key={'target':'cache','inputSha256':'fixture-input','direction':'forward'},
            host=types.SimpleNamespace(config={'generationBindingSha256':self.binding_sha}),
            protocol=load('ypal-ordinary-publication-protocol-v6.py'))
        key=caller.timing_key(session,'cache-prepared')
        receipt={'binding':key,'completed':True,'elapsedNanoseconds':20779000000,'reservedEffectNanoseconds':0,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0,'syntheticTimingInputOnly':True}
        session.g=types.SimpleNamespace(public=lambda *_:h.encoded(receipt))
        ref={'captureId':'synthetic-acceptance','sha256':'a'*64}
        self.assertEqual(caller.require_timing(session,ref,'cache-prepared'),receipt)
        for delta in [{'generationBindingSha256':old.h.sha(old.encoded(old.documents()[old.h.MANIFEST.name]))},
                      {'operatorSha256':a.FROZEN_SHA},{'providerSha256':p.FROZEN_SHA},{'readerSha256':r.FROZEN_SHA},
                      {'mode':'reader-after-login'}]:
            receipt['binding']={**key,**delta}
            with self.assertRaises(RuntimeError):caller.require_timing(session,ref,'cache-prepared')

    def test_import_and_defaults_perform_zero_effects(self):
        for module in [h,p,r,a,b,load('ypal-ordinary-publication-input-render-accept-v1.py')]:
            result=subprocess.run(['python3','-I','-B',str(HERE/Path(module.__file__).name)],capture_output=True,check=True)
            self.assertTrue(json.loads(result.stdout)['staticOnly'])


class RendererControls(unittest.TestCase):
    def setUp(self):
        Controls.setUp(self);self.files={};self.base_public=self.public
        def read(path,digest=None,maximum=200000):
            raw=self.files.get(str(path))
            if raw is None:return self.base_public(path,digest,maximum)
            h.need(0<len(raw)<=maximum and (digest is None or h.sha(raw)==digest),'exact_synthetic_acceptance_record_hash_required')
            return raw
        self.enterContext(patch.object(self.impl,'public',side_effect=read))
        wrapper=load('ypal-ordinary-publication-input-render-accept-v1.py');wrapper.helper=lambda:h
        self.render=wrapper.composition();self.enterContext(patch.object(render_tests,'m',self.render))
        self.enterContext(patch.object(render_tests,'h',h));self.renderer=self.render.Renderer()
        render_tests.Controls.make_receipts(self)
        owner=self.renderer.binding.owner
        config=json.loads(self.files[str(owner.INPUT)]);config['format']=owner.composition().FORMAT+'-input';config['maximumSeconds']=2400
        self.config_sha=self.put(owner.INPUT,config)
        self.operation.update(format=owner.composition().FORMAT,operatorSha256=h.BUILD_OWNER_SHA,inputSha256=self.config_sha,
            newExecutionFiles=h.literal_source_pins(h.public(owner.ATTEMPT,h.BUILD_OWNER_SHA)))
        self.candidate.update(operatorSha256=self.renderer.binding.value['owner']['sha256'],operationFile=str(h.BUILD_BASE/'operation.json'),
            buildOperatorSha256=h.BUILD_OWNER_SHA,originalAttemptCandidateCLIPassed=False,originalStrictTerminalInvocationGatePassed=False,
            previousAcceptanceProducerSha256='1e29585a8c1b09747c061e47e0b2fbf2a984d10949c12f36d847b336f8a5259d',previousAcceptanceCLIPassed=False,
            operationSha256=self.put(h.BUILD_BASE/'operation.json',self.operation))
        del self.files[str(Path(h.ATTEMPT_BASE)/'operation.json')]
        fixture=accept_tests.terminal_fixture;args=fixture.fixture();state,start,runtime,started,result=args[:5]
        runtime.update(inputSha256Ref=self.config_sha,artifactDigest=h.ARTIFACT['digest'])
        result.update(inputSha256=self.config_sha,artifactDigest=h.ARTIFACT['digest'],minimumAvailableBytes=30000000000)
        self.candidate['workerIntentSha256']=self.put(Path(h.ATTEMPT_WORK)/'intent.json',runtime)
        self.candidate['workerResultSha256']=self.put(Path(h.ATTEMPT_WORK)/'result.json',result)
        self.put(h.BUILD_BASE/(h.ATTEMPT_UNIT+'-start-intent.json'),start)
        self.put(h.BUILD_BASE/(h.ATTEMPT_UNIT+'-started.json'),started)
        self.candidate['terminalCompletionProof']=fixture.m.validate(*args)
        self.accept()

    def put(self,path,value):return render_tests.Controls.put(self,path,value)
    def accept(self):return render_tests.Controls.accept(self)

    def test_renderer_actual_pure_config_and_ten_fields_no_runtime_authority(self):
        value=self.renderer.render(self.candidate_sha)
        self.assertEqual(len(value['cacheInput']),10)
        self.assertEqual(value['cacheInput']['generationBindingSha256'],self.binding_sha)
        self.assertEqual(value['buildOperationFile'],str(h.BUILD_BASE/'operation.json'))
        self.assertEqual(value['buildOperatorSha256'],h.BUILD_OWNER_SHA)
        self.assertFalse(value['liveTerminalRequalified']);self.assertFalse(value['currentReadinessQualified'])
        self.assertFalse(value['originalAttemptCandidateCLIPassed'])
        self.assertFalse(value['previousAcceptanceCLIPassed'])
        self.assertEqual(value['cacheInput']['generationSha256'],self.candidate_sha)
        self.assertNotIn(str(Path(h.ATTEMPT_BASE)/'operation.json'),self.files)

    def test_renderer_refuses_foreign_build_lineage_and_changed_terminal_records(self):
        original=copy.deepcopy(self.candidate)
        for key,bad in [('buildOperatorSha256',self.candidate['operatorSha256']),('operationFile',str(Path(h.ATTEMPT_BASE)/'operation.json')),
                        ('originalAttemptCandidateCLIPassed',True),('format',old.h.CANDIDATE_FORMAT)]:
            self.candidate=copy.deepcopy(original);self.candidate[key]=bad;self.accept()
            with self.assertRaises((RuntimeError,FileNotFoundError)):self.renderer.render(self.candidate_sha)
        self.candidate=original;self.accept();self.put(h.BUILD_BASE/(h.ATTEMPT_UNIT+'-started.json'),{'foreign':True})
        with self.assertRaisesRegex(RuntimeError,'same_actual_immutable_terminal_worker_records'):self.renderer.render(self.candidate_sha)


if __name__=='__main__':unittest.main()
