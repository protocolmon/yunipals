"""Private audit/root FD boundary controls; no service or PG actions."""
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
m=load('arena-native-derived-boundary-diagnostic-v1.py')
real=load('arena-native-derived-projector-v3.test.py')

class Controls(unittest.TestCase):
    def test_default_is_inert(self):
        result=subprocess.run(['python3','-B',str(HERE/'arena-native-derived-boundary-diagnostic-v1.py')],capture_output=True,check=True)
        self.assertTrue(json.loads(result.stdout)['staticOnly']);self.assertFalse(result.stderr)

    def test_actual_owner3_source_closure_authenticates_before_evaluation(self):
        raw=b'fixture private input bytes';digest=m.sha(raw)
        def read(path,expected=None,maximum=4000000):
            if path==m.INPUT:
                self.assertEqual(expected,digest);return raw
            return real.public(path,expected,maximum)
        with patch.object(m,'protected',side_effect=read):source=m.authenticate(digest)
        self.assertEqual(m.sha(source),m.OWNER_SHA)
        def changed(path,expected=None,maximum=4000000):
            if Path(path).name=='arena-native-read-pool-v1.mjs':raise RuntimeError('changed exact pool source')
            return read(path,expected,maximum)
        with patch.object(m,'protected',side_effect=changed),self.assertRaisesRegex(RuntimeError,'changed exact pool'):m.authenticate(digest)
        self.assertFalse(hasattr(real.actual.Owner,'NODE'));self.assertEqual(real.actual.NODE,Path('/opt/node-v24.18.1/bin/node'))

    def fixture(self):
        temporary=tempfile.TemporaryDirectory(dir=HERE,prefix='boundary-fixture-');self.addCleanup(temporary.cleanup)
        parent=Path(temporary.name);base=parent/'projector';base.mkdir();audit=parent/'new-audit';input_path=parent/'input.json'
        actor={'pid':100,'startTicks':200,'invocation':'a'*32,'programSha256':'b'*64}
        owner=types.SimpleNamespace(actor=Mock(side_effect=lambda:dict(actor)),socket_identity=Mock(return_value={'actualSocket':True}))
        namespace=types.SimpleNamespace(BASE=base,INPUT=input_path,NODE=Path('/opt/node-v24.18.1/bin/node'),
            Owner=Mock(return_value=owner),document=Mock(side_effect=lambda _:dict(actor)))
        private={'format':m.FORMAT,'completed':True,'inspectionSucceeded':False,'bothReadClientsClosed':True,
            'genuineUnchangedExportedInspector':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
            'error':{'message':'PRIVATE_SENTINEL'},'observation':{'privateRawRow':'PRIVATE_SENTINEL'},
            'summary':{'sampledNativeAndTarget':True,'cursorRelation':'strictly-behind','savedHashMatchesNativeComplete':False,
                'savedBoundaryCanonical':True,'finalizedAgeMilliseconds':20,'finalizedFresh180Seconds':True,
                'nativeFrameworkReady':True,'nativeRunning':True}}
        child=types.SimpleNamespace(stdout=m.encoded(private),stderr=b'',returncode=0)
        return base,audit,input_path,actor,owner,namespace,private,child

    def capture(self,fixture):
        base,audit,input_path,actor,owner,namespace,private,child=fixture
        with (patch.object(m,'BASE',base),patch.object(m,'AUDIT',audit),patch.object(m,'INPUT',input_path),
            patch.object(m.socket,'gethostname',return_value='yunipals-main'),patch.object(m,'runtime',return_value=namespace),
            patch.object(m,'authenticate',return_value=b'actual source fixture'),patch.object(m,'invoke',return_value=child)):
            return m.capture('a'*64)

    def test_raw_child_is_private_and_only_scalar_summary_is_exported(self):
        fixture=self.fixture();result=self.capture(fixture);audit=fixture[1]
        self.assertTrue(result['completed']);self.assertFalse(result['inspectionSucceeded']);self.assertFalse(result['currentProjectionQualified'])
        self.assertFalse(result['retryAuthorized']);self.assertTrue(result['sameWorkerEpoch'])
        self.assertNotIn('PRIVATE_SENTINEL',json.dumps(result));self.assertIn('PRIVATE_SENTINEL',(audit/'child.stdout.private.json').read_text())
        self.assertEqual(audit.stat().st_mode&0o777,0o700)
        for path in audit.iterdir():self.assertEqual(path.stat().st_mode&0o777,0o600)
        self.assertFalse((fixture[0]/'result.json').exists())
        with self.assertRaises(FileExistsError):self.capture(fixture)

    def test_worker_change_is_never_a_successful_diagnostic_bookend(self):
        fixture=self.fixture();fixture[4].actor.side_effect=[fixture[3],{**fixture[3],'pid':101}]
        result=self.capture(fixture);self.assertFalse(result['completed']);self.assertFalse(result['sameWorkerEpoch'])
        self.assertTrue(result['failure']['postflightFailed'])

    def test_private_row_cannot_be_exported_under_a_summary_key(self):
        fixture=self.fixture();fixture[6]['summary']['cursorRelation']={'raw':'PRIVATE_SENTINEL'}
        fixture[7].stdout=m.encoded(fixture[6])
        with self.assertRaisesRegex(RuntimeError,'only_scalar_boundary_diagnostic_summary'):self.capture(fixture)

    def test_invoke_delegates_existing_sockets_and_always_closes_without_manager_actions(self):
        native,peer1=socket.socketpair();target,peer2=socket.socketpair();self.addCleanup(peer1.close);self.addCleanup(peer2.close)
        owner=types.SimpleNamespace(connect_pool=Mock(side_effect=[native,target]),public_config=lambda:{'actualPublicConfig':True},
            pool_identity=lambda _: {'actualEpoch':True},actor=lambda:{'actualActor':True})
        def run(args,**kwargs):
            self.assertIn('--no-new-privs',args);self.assertIn('--clear-groups',args)
            self.assertEqual(args[-3:-1],['--diagnose','--config-fd'])
            self.assertEqual(set(kwargs['pass_fds'][1:]),{native.fileno(),target.fileno()})
            descriptor=kwargs['pass_fds'][0];self.assertEqual(os.fstat(descriptor).st_mode&0o777,0o600)
            self.assertEqual(json.loads(os.read(descriptor,100000))['readPoolIdentity'],{'actualEpoch':True})
            raise subprocess.TimeoutExpired(args,120)
        with patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=111,pw_gid=113)),patch.object(m.subprocess,'run',side_effect=run):
            with self.assertRaises(subprocess.TimeoutExpired):m.invoke(owner,Path('/opt/node-v24.18.1/bin/node'))
        self.assertEqual(native.fileno(),-1);self.assertEqual(target.fileno(),-1)

if __name__=='__main__':unittest.main()
