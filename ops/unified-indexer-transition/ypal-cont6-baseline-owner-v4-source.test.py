"""Source3 behavior retained; actual failure/diagnostic scalars and passive capture I/O controls."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path('/root/yunipals');SOURCE=Path(__file__).with_name('ypal-cont6-baseline-owner-v4.py')
def load(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);return v
m=load(SOURCE);legacy=load(ROOT/'ops/unified-indexer-transition/ypal-cont6-baseline-owner-v3.test.py')
source_context=load(ROOT/'ops/unified-indexer-transition/ypal-native-readiness-context-v2.test.py')
FAILED=json.loads((ROOT/'docs/unified-indexer/cont6-baseline3-inventory-refusal-production-2026-10-26.json').read_bytes())
DIAG=json.loads((ROOT/'docs/unified-indexer/cont6-runtime-peer-diagnostic-production-2026-10-26.json').read_bytes())
for row in[FAILED,DIAG]:
 for key in['diagnosis','observedAt','sourceCommit']:row.pop(key)

class Controls(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.baseline4-controls-',dir=ROOT);self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.root.chmod(0o700)
  mask=os.umask(0o077);self.addCleanup(lambda:os.umask(mask))
  self.n={'__name__':'explicit_IO_fixture'};exec(compile(m.REMOTE,str(SOURCE)+':remote','exec'),self.n)
 def test_actual_failure_and_diagnostic_canonical_ancestry_no_authority_reuse(self):
  n=self.n;failed=copy.deepcopy(FAILED);fsha=failed.pop('resultSha256');diag=copy.deepcopy(DIAG);dsha=diag.pop('resultSha256')
  self.assertEqual(n['sha'](n['encoded'](failed)),fsha);self.assertEqual(n['sha'](n['encoded'](diag)),dsha)
  before={'explicit-second-input-IO-fixture':True};trace={'type':'RuntimeError','traceback':'source_sessions kernel_backends peer_fds ypal-old-runtime-inventory-v1.py'}
  def read(path,digest=None):
   path=Path(path)
   if path.name=='result.private.json':self.assertEqual(digest,fsha);return n['encoded'](failed)
   if path.name=='failure-traceback.private.json':self.assertEqual(digest,failed['proofHashes']['failureTraceback']);return n['encoded'](trace)
   if path.name=='owned-input-reuse.private.json':self.assertEqual(digest,failed['proofHashes']['ownedInputReuse']);return n['encoded'](before)
   if path==n['DIAGNOSTIC_AUDIT']/'result.json':self.assertEqual(digest,dsha);return n['encoded'](diag)
   self.assertEqual(digest,diag['privateHashes'][path.name]);return b'explicit protected private diagnostic I/O fixture'
  n.update(second_input=lambda:copy.deepcopy(before),read=read)
  value=n['reuse_input']();self.assertEqual(value['previousThirdResultSha256'],fsha);self.assertFalse(value['priorCurrentFactReused'])
  for target,key,bad in[(failed,'constructInvoked',True),(diag,'fullSourcePreflightQualified',True),(diag,'oldFailedRunRelabelled',True),(diag,'failedCommandCount',1)]:
   prior=target[key];target[key]=bad
   try:
    with self.subTest(key=key),self.assertRaises(RuntimeError):n['reuse_input']()
   finally:target[key]=prior
 def test_original_run_body_and_single_fresh_application_flow_unchanged(self):
  old=ast.parse(legacy.m.REMOTE);new=ast.parse(m.REMOTE)
  a=next(row for row in old.body if isinstance(row,ast.FunctionDef)and row.name=='run')
  b=copy.deepcopy(next(row for row in new.body if isinstance(row,ast.FunctionDef)and row.name=='run'))
  extra=[row for row in b.body if isinstance(row,ast.Expr)and isinstance(row.value,ast.Call)and ast.unparse(row.value)=='start_commands()']
  self.assertEqual(len(extra),1);b.body.remove(extra[0]);self.assertEqual(ast.dump(a,include_attributes=False),ast.dump(b,include_attributes=False))
  with patch.object(legacy,'m',m):
   control=legacy.Controls();control.setUp()
   try:control.n['start_commands']=lambda:None;control.run_fixture()
   finally:control.doCleanups()
 def test_old_failed_frames_preserved_with_exact_third_attempt_namespace(self):
  with patch.object(legacy,'m',m):
   control=legacy.Controls();control.setUp()
   try:
    control.fixture();n=control.n;third=control.root/'third-root';third.mkdir(mode=0o700)
    for name in['intent.json','old-files-before.private.json','owned-input-reuse.private.json','failed-files-before.private.json','failure-traceback.private.json','metadata-capture-histories.private.json','result.private.json']:(third/name).write_bytes(b'explicit immutable third private file fixture')
    original_path=n['pathlib'].Path;original_read=n['read']
    n['pathlib']=types.SimpleNamespace(Path=lambda value:third if str(value)=='/var/backups/yunipals-root-cont6-baseline-20261026-3'else original_path(value))
    n['read']=lambda path,digest=None:Path(path).read_bytes()if Path(path).parent==third else original_read(path,digest)
    before=n['failed_frames']();self.assertEqual(len(before),16)
    own=n['AUTH_BASE']/'captures'/n['CAPTURE'];own.mkdir(mode=0o700);(own/'intent.json').write_bytes(b'new own intent')
    self.assertEqual(n['failed_frames'](True),before)
    with self.assertRaises(RuntimeError):n['failed_frames']()
   finally:control.doCleanups()
 def main_capture(self,failure=False,broken_snapshot=False):
  n=self.n;n['AUDIT']=self.root/'audit';events=[];original=lambda *args,**kwargs:types.SimpleNamespace(returncode=0,stdout=b'{}',stderr=b'')
  n['original_run']=original;n['read']=source_context.local
  real_save=n['save']
  def saved(name,value):
   if name in['failure-traceback.private.json','subprocess-command-summaries.private.json','result.private.json']:
    self.assertIs(subprocess.run,original);events.append(name)
   if name=='subprocess-command-summaries.private.json'and broken_snapshot:raise OSError('explicit private-write I/O refusal')
   return real_save(name,value)
  n['save']=saved
  def run():
   n['start_commands']();self.assertIs(subprocess.run,n['command_trace']);subprocess.run(['/usr/bin/true'])
   if failure:raise RuntimeError('original_application_probe_refusal')
   return{'format':n['FORMAT'],'completed':True,'baselineConstructed':True,'automaticRetryAllowed':False}
  n.update(run=run,socket=types.SimpleNamespace(gethostname=lambda:'yunipals-main'),signal=types.SimpleNamespace(SIGALRM=14,signal=lambda *_:None,alarm=lambda *_:None))
  before=subprocess.run
  try:
   with patch.object(subprocess,'run',original),contextlib.redirect_stdout(io.StringIO())as out:status=n['main']()
   self.assertIs(subprocess.run,before)
  finally:subprocess.run=before
  return status,json.loads(out.getvalue()),events
 def test_passive_proxy_scope_and_success_restoration_before_private_snapshot(self):
  status,value,events=self.main_capture();self.assertEqual(status,0);self.assertEqual(value['commandCapture']['commands'],1)
  self.assertTrue(value['commandCapture']['subprocessRunRestored']);self.assertEqual(events[-1],'result.private.json')
 def test_original_failure_code_preserved_and_proxy_restored_first(self):
  status,value,events=self.main_capture(failure=True);self.assertEqual(status,1)
  self.assertEqual(value['fixedCode'],'original_application_probe_refusal');self.assertEqual(events[0],'failure-traceback.private.json')
  self.assertFalse(value['automaticRetryAllowed']);self.assertTrue(value['commandCapture']['subprocessRunRestored'])
 def test_missing_private_command_snapshot_requires_inspection_never_replay(self):
  status,value,_=self.main_capture(broken_snapshot=True);self.assertEqual(status,1);self.assertFalse(value['completed'])
  self.assertTrue(value['baselineConstructed']);self.assertTrue(value['remoteAuditInspectionRequired']);self.assertFalse(value['automaticRetryAllowed'])

if __name__=='__main__':unittest.main()
