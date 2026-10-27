"""Offline exact-runtime inventory proxy controls; no SSH, DB or real subprocess."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path('/root/yunipals')
SOURCE=Path(__file__).with_name('ypal-cont6-runtime-peer-diagnostic-owner-v1.py')
def load(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load(SOURCE)
diagnostic=load(ROOT/'ops/unified-indexer-transition/ypal-ordinary-metadata-capture-diagnostic-v1.py')
inventory=load(ROOT/'ops/booster-launch/ypal-old-runtime-inventory-v1.py')
context=load(ROOT/'ops/unified-indexer-transition/ypal-native-readiness-context-v2.test.py')
ACTUAL=json.loads((ROOT/'docs/unified-indexer/cont6-baseline3-inventory-refusal-production-2026-10-26.json').read_bytes())
for key in['diagnosis','observedAt','sourceCommit']:ACTUAL.pop(key)

class Controls(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.runtime-peer-controls-',dir=ROOT);self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name);self.root.chmod(0o700);mask=os.umask(0o077);self.addCleanup(lambda:os.umask(mask))
  self.n={'__name__':'explicit_diagnostic_IO_fixture'};exec(compile(m.REMOTE,str(SOURCE)+':remote','exec'),self.n)
  self.n['AUDIT']=self.root/'audit'
 def preauth(self):
  n=self.n;actual=copy.deepcopy(ACTUAL);expected=actual.pop('resultSha256')
  self.assertEqual(n['sha'](n['encoded'](actual)),expected);self.assertEqual(expected,n['FAILED_SHA'])
  refs={'resultSha256':'1'*64,'inputSha256':'2'*64};trace={'type':'RuntimeError','traceback':'source_sessions kernel_backends peer_fds ypal-old-runtime-inventory-v1.py'}
  def read(path,digest=None):
   path=Path(path)
   if path==n['FAILED']/'result.private.json':self.assertEqual(digest,expected);return n['encoded'](actual)
   if path==n['FAILED']/'failure-traceback.private.json':self.assertEqual(digest,actual['proofHashes']['failureTraceback']);return n['encoded'](trace)
   if path==n['REPORT']:self.assertEqual(digest,n['REPORT_SHA']);return n['encoded']({'sourceRefs':refs})
   return context.local(path,digest)
  n['read']=read
  return actual,refs,trace
 def argv(self):return['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--no-new-privs','--inh-caps=-all','--ambient-caps=-all','/usr/bin/python3','-I','-B','-c',inventory.PEER_FDS,'[12345]','111']
 def test_actual_failure_canonical_and_full_runtime_sources_authenticate_before_eval(self):
  actual,refs,trace=self.preauth();n=self.n
  with patch.object(os.path,'lexists',return_value=False):self.assertEqual(n['authenticate'](),refs)
  actual['constructInvoked']=True
  with patch.object(os.path,'lexists',return_value=False),self.assertRaises(RuntimeError):n['authenticate']()
  self.assertFalse(n['invoked'])
 def test_default_inert_and_one_original_runtime_call_no_other_action(self):
  tree=ast.parse(m.REMOTE);calls=[ast.unparse(row.func)for row in ast.walk(tree)if isinstance(row,ast.Call)]
  self.assertEqual(calls.count('runtime.validate_current_source'),1)
  for name in['session.preflight','module.construct_records','module.qualify_held','module.execute_cache','sys.setprofile','sys.settrace']:self.assertNotIn(name,calls)
  with patch.object(sys,'argv',[str(SOURCE)]),patch.object(m.subprocess,'run',side_effect=AssertionError('no dispatch')),contextlib.redirect_stdout(io.StringIO())as out:self.assertEqual(m.main(),0)
  self.assertTrue(json.loads(out.getvalue())['staticOnly'])
 def run_probe(self,value=None,error=None):
  n=self.n;n['AUDIT'].mkdir(mode=0o700);argv=self.argv();seen=[]
  def original(*args,**kwargs):
   seen.append((args,kwargs))
   if error is not None:raise error
   return value
  n['original_run']=original
  runtime=types.SimpleNamespace(validate_current_source=lambda result_sha,input_sha:inventory.run(argv))
  original_code=inventory.run.__code__;before=subprocess.run
  try:
   with patch.object(subprocess,'run',original):
    try:returned=n['observe'](runtime,diagnostic,{'resultSha256':'1'*64,'inputSha256':'2'*64})
    except BaseException as observed:returned=observed
    self.assertIs(subprocess.run,original)
  finally:self.assertIs(subprocess.run,before)
  self.assertIs(inventory.run.__code__,original_code);self.assertEqual(len(seen),1);self.assertIs(seen[0][0][0],argv)
  self.assertEqual(seen[0][1],{'capture_output':True,'timeout':8,'env':inventory.CLEAN})
  return returned
 def test_original_inventory_success_returns_exact_bytes_and_restores(self):
  value=types.SimpleNamespace(returncode=0,stdout=b'{"fixed":true}',stderr=b'')
  self.assertIs(self.run_probe(value=value),value.stdout);self.assertEqual(self.n['trace'].failures,[])
 def test_original_nonzero_guard_and_private_exact_peer_stderr_retained(self):
  err=b"FileNotFoundError: [Errno 2] No such file or directory: '/proc/12345/stat'\n"
  returned=self.run_probe(value=types.SimpleNamespace(returncode=1,stdout=b'',stderr=err))
  self.assertIs(type(returned),RuntimeError);self.assertEqual(str(returned),'bounded_readonly_inventory_command_required')
  payload=json.loads((self.n['AUDIT']/'failed-command-1.json').read_bytes())
  self.assertTrue(payload['rawPublicPeerEvidenceRetained']);self.assertEqual(payload['argv'],self.argv())
  self.assertEqual(__import__('base64').b64decode(payload['stderrBase64']),err)
  self.assertEqual((self.n['AUDIT']/'failed-command-1.json').stat().st_mode&0o777,0o600)
 def test_original_timeout_exception_identity_and_restoration(self):
  error=subprocess.TimeoutExpired(self.argv(),8,output=b'',stderr=b'private timeout fixture')
  self.assertIs(self.run_probe(error=error),error);self.assertEqual(len(self.n['trace'].failures),1)
 def test_public_main_exports_only_scalars_hashes_and_no_authority(self):
  n=self.n;refs={'resultSha256':'1'*64,'inputSha256':'2'*64}
  proof={'validated':True,'currentWriterQualified':True,'terminalInverseOnly':False,'operatorSha256':n['RUNTIME_SHA'],
   'inputSha256':refs['inputSha256'],'receiptSha':refs['resultSha256'],'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0,
   'privateFixtureSecret':'never export this private value'}
  runtime=types.SimpleNamespace(validate_current_source=lambda *_:proof)
  n.update(authenticate=lambda:refs,load=lambda path,digest:diagnostic if path==n['DIAGNOSTIC']else runtime,
   socket=types.SimpleNamespace(gethostname=lambda:'yunipals-main'),signal=types.SimpleNamespace(SIGALRM=14,signal=lambda *_:None,alarm=lambda *_:None))
  with contextlib.redirect_stdout(io.StringIO())as out:self.assertEqual(n['main'](),0)
  value=json.loads(out.getvalue());self.assertNotIn('never export',out.getvalue());self.assertTrue(value['originalRuntimeObservationPassed'])
  for name in['fullSourcePreflightQualified','baselineQualified','timingOrHeldAuthorityQualified','oldFailedRunRelabelled','automaticRetryAllowed','databaseMutationRequested']:self.assertIs(value[name],False)
  self.assertTrue((n['AUDIT']/'original-runtime-proof-private.json').exists());self.assertIs(subprocess.run,n['original_run'])

if __name__=='__main__':unittest.main()
