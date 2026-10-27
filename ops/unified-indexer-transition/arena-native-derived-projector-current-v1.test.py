"""New current-producer receipt/ancestry/readonly FD controls; no live claim."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import types
import unittest
from unittest.mock import Mock,patch

HERE=Path(__file__).resolve().parent

def load(name):
    spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load('arena-native-derived-projector-current-v1.py')
diag=load(m.DIAGNOSTIC)
prior=load('arena-native-derived-projector-v3.test.py')

def local(path,digest=None,maximum=4000000):return prior.public(path,digest,maximum)

class Controls(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory(dir=HERE,prefix='current-producer-fixture-');self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name);self.base=self.root/'new-current';self.base.mkdir();self.service=self.root/'actual-service';self.service.mkdir()
        self.input=self.root/'input.json';self.oldinput=self.root/'original-input.json';self.oldinput.write_bytes(b'actual-original-input-fixture')
        self.config={'format':m.FORMAT+'-input','projectorInputSha256':m.sha(self.oldinput.read_bytes()),'supportManifestSha256':m.SUPPORT_SHA}
        self.input.write_bytes(m.encoded(self.config));self.input_sha=m.sha(self.input.read_bytes())
        self.actor={'pid':100,'startTicks':200,'invocation':'a'*32,'unitSha256':'b'*64}
        for name in ['intent.json','start-intent.json','started.json']:(self.service/name).write_bytes(m.encoded(self.actor if name=='started.json'else{'actualOriginalRecord':name}))
        ancestry={'producerSha256':m.SERVICE_SHA,'sourceManifestSha256':m.SERVICE_MANIFEST_SHA,
            'inputSha256':self.config['projectorInputSha256'],'actor':self.actor,
            **{key:m.sha((self.service/name).read_bytes())for name,key in [('intent.json','reviewSha256'),('start-intent.json','startIntentSha256'),('started.json','startedSha256')]}}
        self.binding={'inputSha256':self.input_sha,'projectorAncestry':ancestry,'service':{'actor':self.actor,'support':{'manifestSha256':m.SUPPORT_SHA}}}
        self.intent={'format':m.FORMAT,'operatorSha256':m.own_sha(),'inputSha256':self.input_sha,'config':self.config,'projectorAncestry':ancestry}
        (self.base/'capture-intent.json').write_bytes(m.encoded(self.intent))
        self.receipt={'format':m.FORMAT,'operatorSha256':m.own_sha(),'inputSha256':self.input_sha,'ready':True,'binding':self.binding,
            'bindingSha256':m.sha(m.encoded(self.binding)),'captureIntentSha256':m.sha((self.base/'capture-intent.json').read_bytes()),
            'support':{'manifestSha256':m.SUPPORT_SHA},'originalOwner3CapturePassed':False,
            'firstCurrentObservation':{'validated':True,'exactOriginalInspectorSuccess':True}}
        (self.base/'result.json').write_bytes(m.encoded(self.receipt));self.result_sha=m.sha((self.base/'result.json').read_bytes())

    def scope(self):
        return (patch.object(m,'authenticate',return_value={}),patch.object(m,'INPUT',self.input),patch.object(m,'BASE',self.base),
            patch.object(m,'SERVICE_BASE',self.service),patch.object(m,'SERVICE_INPUT',self.oldinput))

    def ack(self):
        from contextlib import ExitStack
        with ExitStack()as stack:
            for value in self.scope():stack.enter_context(value)
            return m.acknowledgement(self.result_sha,self.input_sha)

    def test_default_and_renderer_are_inert(self):
        for args in [[],['--render-input','a'*64]]:
            result=subprocess.run(['python3','-B',str(HERE/m.FILE.name),*args],check=True,capture_output=True)
            value=json.loads(result.stdout);self.assertFalse(result.stderr)
            self.assertTrue(value['staticOnly']if not args else value['projectorInputSha256']=='a'*64)

    def test_actual_finite_current_source_closure_authenticates_before_any_context(self):
        with patch.object(m,'protected',side_effect=local):manifest=m.authenticate()
        self.assertEqual(len(manifest['files']),171);self.assertEqual(len(manifest['externalPrograms']),6)
        def bad(path,digest=None,maximum=4000000):
            if Path(path).name=='arena-native-derived-projector-current-v1.mjs':raise RuntimeError('changed current inspector')
            return local(path,digest,maximum)
        with patch.object(m,'protected',side_effect=bad),self.assertRaisesRegex(RuntimeError,'changed current inspector'):m.authenticate()

    def test_own_pure_ACK_never_constructs_owner_or_claims_original_capture(self):
        with patch.object(m,'Context',side_effect=AssertionError('pure ACK must not construct Context')):ack=self.ack()
        self.assertTrue(ack['immutableAcknowledgementOnly']);self.assertFalse(ack['currentProjectionQualified'])
        self.assertFalse(ack['originalOwner3CapturePassed']);self.assertEqual(ack['operatorSha256'],m.own_sha())
        self.assertEqual(ack['binding']['projectorAncestry']['producerSha256'],m.SERVICE_SHA)
        with self.assertRaisesRegex(RuntimeError,'receipt_and_input_SHA'):m.acknowledgement(None,self.input_sha)

    def test_old_source_receipt_or_changed_start_actor_is_never_a_new_ACK(self):
        original=copy.deepcopy(self.receipt)
        self.receipt['operatorSha256']=m.SERVICE_SHA;(self.base/'result.json').write_bytes(m.encoded(self.receipt));self.result_sha=m.sha((self.base/'result.json').read_bytes())
        with self.assertRaisesRegex(RuntimeError,'new_current_ACK'):self.ack()
        self.receipt=original;(self.base/'result.json').write_bytes(m.encoded(self.receipt));self.result_sha=m.sha((self.base/'result.json').read_bytes())
        (self.service/'started.json').write_bytes(m.encoded({**self.actor,'pid':101}))
        with self.assertRaisesRegex(RuntimeError,'start_receipts'):self.ack()

    def test_original_owner_result_must_stay_absent_and_input_bytes_immutable(self):
        (self.service/'result.json').write_text('unexpected old capture')
        with self.assertRaisesRegex(RuntimeError,'absent_old_capture_ACK'):self.ack()
        (self.service/'result.json').unlink();self.oldinput.write_bytes(b'changed original input')
        with self.assertRaisesRegex(RuntimeError,'same_actual_current_projector_file'):self.ack()

    def test_sealed_FD_wrapper_is_original_body_with_only_actual_command_identity(self):
        native,p1=socket.socketpair();target,p2=socket.socketpair();self.addCleanup(p1.close);self.addCleanup(p2.close)
        owner=types.SimpleNamespace(connect_pool=Mock(side_effect=[native,target]),public_config=lambda:{'public':True},
            pool_identity=lambda _: {'actualServiceEpoch':True},actor=lambda:self.actor)
        def run(args,**kwargs):
            self.assertIn(str(m.NODE_PROGRAM),args);self.assertEqual(args[-3:-1],['--current','--config-fd'])
            self.assertIn('--no-new-privs',args);self.assertEqual(set(kwargs['pass_fds'][1:]),{native.fileno(),target.fileno()})
            return types.SimpleNamespace(stdout=b'private',stderr=b'',returncode=0)
        with patch.object(diag.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=111,pw_gid=113)),patch.object(diag.subprocess,'run',side_effect=run):
            m.invoke(diag,owner,Path('/opt/node-v24.18.1/bin/node'))
        self.assertEqual(native.fileno(),-1);self.assertEqual(target.fileno(),-1)

    def context(self):
        context=m.Context.__new__(m.Context);context.input_sha=self.input_sha;context.config=self.config;context.ancestry=self.binding['projectorAncestry']
        context.diag=diag;context.namespace=types.SimpleNamespace(NODE=Path('/opt/node-v24.18.1/bin/node'))
        context.before=Mock(return_value=(self.actor,{'actualSocket':True}))
        context.owner=types.SimpleNamespace(current_catalogs=Mock(side_effect=[{'version':'same','globalUsed':3},{'version':'same','globalUsed':4}]),
            binding=Mock(side_effect=lambda actor,catalogs:{'actor':actor,'catalogIdentity':catalogs['version']}))
        proof={'format':m.FORMAT,'validated':True,'exactOriginalInspectorSuccess':True,'writerProgressWaitsOnly':True,
            'originalOwner3CapturePassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
            'attempts':[{'completed':True,'discarded':False}],'elapsedMilliseconds':20,
            'observation':{'validated':True,'databaseWrites':0,'providerCalls':0}}
        return context,types.SimpleNamespace(stdout=m.encoded(proof),stderr=b'',returncode=0)

    def test_whole_current_success_uses_own_domain_and_both_full_catalog_fences(self):
        context,child=self.context();audit=self.root/'observation';audit.mkdir()
        with patch.object(m,'invoke',return_value=child):binding,value=context.observe(audit)
        self.assertEqual(context.owner.current_catalogs.call_count,2);self.assertEqual(context.before.call_count,2)
        self.assertEqual(binding['projectorAncestry']['producerSha256'],m.SERVICE_SHA)
        self.assertTrue(value['exactOriginalInspectorSuccess']);self.assertFalse(value['originalOwner3CapturePassed'])
        self.assertEqual((audit/'child.stdout.private.json').stat().st_mode&0o777,0o600)

    def test_partial_unknown_failed_or_changed_catalog_capture_never_qualifies(self):
        for failure in ['child','catalog','epoch']:
            context,child=self.context();audit=self.root/('observation-'+failure);audit.mkdir()
            if failure=='child':child.returncode=1
            if failure=='catalog':context.owner.current_catalogs.side_effect=[{'version':'same'},{'version':'changed'}]
            if failure=='epoch':context.before.side_effect=[(self.actor,{}),({**self.actor,'pid':101},{})]
            with patch.object(m,'invoke',return_value=child),self.assertRaises(RuntimeError):context.observe(audit)

    def test_pool_connector_authenticates_new_ACK_but_uses_original_service_identity_without_current_recursion(self):
        service={**self.binding['service'],'readPoolSocket':{'actualSocket':True},'readPoolIdentity':{'serviceProducer':m.SERVICE_SHA},
            'publicConfigSha256':m.sha(m.encoded({'public':True})),'inputSha256':self.config['projectorInputSha256'],
            'sourceRole':{'nativeRole':True},'nativeRelease':{'actualRelease':True},'target':{'actualTarget':True}}
        first={'binding':{**self.binding,'service':service},'bindingSha256':'a'*64}
        channel=Mock();owner=types.SimpleNamespace(pool_identity=lambda _:service['readPoolIdentity'],public_config=lambda:{'public':True},
            support=service['support'],source_auth={'sourceRole':service['sourceRole']},native=service['nativeRelease'],provision=service['target'],connect_pool=Mock(return_value=channel))
        context=types.SimpleNamespace(owner=owner,config=self.config,before=Mock(return_value=(self.actor,service['readPoolSocket'])))
        with patch.object(m,'acknowledgement',return_value=first),patch.object(m,'Context',return_value=context),\
            patch.object(m,'validate_current',side_effect=AssertionError('connector cannot recurse through whole current')):
            result=m.open_read_pool('b'*64,self.input_sha,m.SUPPORT_SHA,'native')
        self.assertIs(result['socket'],channel);self.assertEqual(result['identity']['serviceProducer'],m.SERVICE_SHA)
        self.assertEqual(result['currentProducerSha256'],m.own_sha());channel.close.assert_not_called()
        context.before.side_effect=[(self.actor,service['readPoolSocket']),({**self.actor,'pid':101},service['readPoolSocket'])]
        with patch.object(m,'acknowledgement',return_value=first),patch.object(m,'Context',return_value=context),self.assertRaises(RuntimeError):
            m.open_read_pool('b'*64,self.input_sha,m.SUPPORT_SHA,'native')
        channel.close.assert_called_once()

if __name__=='__main__':unittest.main()
