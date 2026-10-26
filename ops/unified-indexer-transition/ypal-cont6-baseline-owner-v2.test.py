#!/usr/bin/env python3
"""Actual failed-root envelope; private old-frame/trace/input I/O are explicit fixtures."""
import copy
import ast
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
import sys
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SOURCE=HERE/'ypal-cont6-baseline-owner-v2.py'
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('baseline2_controls',SOURCE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ACTUAL=json.loads((ROOT/'docs/unified-indexer/cont6-baseline-preconstruct-failure-production-2026-10-26.json').read_bytes())
# These are the public report's labelled additions, not remote execution fields.
for label in ['diagnosis','fullSourcePreflightPassed','observedAt','sourceCommit']:ACTUAL.pop(label)

class Controls(unittest.TestCase):
 def test_inert_default_and_exact_single_original_dispatch(self):
  compile(SOURCE.read_bytes(),str(SOURCE),'exec');tree=ast.parse(m.REMOTE)
  calls=[ast.unparse(row.func)for row in ast.walk(tree)if isinstance(row,ast.Call)]
  for name in['module.Session','session.preflight','helper.bind','session.cache_context','module.construct_records']:self.assertEqual(calls.count(name),1,name)
  for name in['session.finish','module.qualify_held','module.execute_cache','module.execute_reader','sys.settrace','sys.setprofile']:self.assertNotIn(name,calls)
  with patch.object(sys,'argv',[str(SOURCE)]),patch.object(m.subprocess,'run',side_effect=AssertionError('inert default must not dispatch')),contextlib.redirect_stdout(io.StringIO())as out:self.assertEqual(m.main(),0)
  self.assertTrue(json.loads(out.getvalue())['staticOnly'])
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.baseline2-controls-',dir=ROOT);self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name);self.root.chmod(0o700)
  mask=os.umask(0o077);self.addCleanup(lambda:os.umask(mask))
  self.n={'__name__':'explicit_IO_fixture'};exec(compile(m.REMOTE,str(SOURCE)+':remote','exec'),self.n)
 def fixture(self):
  n=self.n;actual=copy.deepcopy(ACTUAL);expected=actual.pop('resultSha256')
  self.assertEqual(n['sha'](n['encoded'](actual)),expected)
  copied={'source':str(n['OLD_INPUT']),'destination':str(n['NEW_INPUT']),'sha256':n['CACHE_SHA'],'originalBytesChanged':False}
  self.assertEqual(n['sha'](n['encoded'](copied)),actual['proofHashes']['inputCopy'])
  directory=self.root/'owned-input';directory.mkdir(mode=0o700);file=directory/'input.json';raw=b'explicit-original-input-bytes-fixture';file.write_bytes(raw);file.chmod(0o600)
  destination=str(n['NEW_INPUT'])
  class FixedPath:
   parent=directory
   def __str__(self):return destination
   def lstat(self):return file.lstat()
  n['NEW_INPUT']=FixedPath()
  frames={'explicit-private-old-frame-projection':{'unchanged':True}}
  detail={'type':'KeyError','traceback':"ypal-native-readiness-context-v2.py bind_source_guard\nKeyError: 'module'\n"}
  prefix='/var/backups/yunipals-root-cont6-baseline-20261026-1/'
  def read(path,digest=None):
   key=str(path)
   if key==prefix+'result.private.json':self.assertEqual(digest,expected);return n['encoded'](actual)
   if key==prefix+'input-copy.private.json':self.assertEqual(digest,actual['proofHashes']['inputCopy']);return n['encoded'](copied)
   if key==prefix+'failure-traceback.private.json':self.assertEqual(digest,actual['proofHashes']['failureTraceback']);return n['encoded'](detail)
   if key==prefix+'old-files-before.private.json':self.assertEqual(digest,actual['proofHashes']['oldFilesBefore']);return n['encoded'](frames)
   if key in[destination,str(n['OLD_INPUT'])]:self.assertEqual(digest,n['CACHE_SHA']);return raw
   raise AssertionError('unexpected private input '+key)
  n.update(read=read,old_frames=lambda:copy.deepcopy(frames))
  return actual,copied,detail,frames,file
 def test_actual_failed_root_and_exact_copy_proof_canonical_hashes(self):
  actual,copied,detail,frames,file=self.fixture()
  self.assertEqual(actual['stage'],'cache-context');self.assertIs(actual['constructInvoked'],False)
  with patch.object(os.path,'lexists',return_value=False):proof=self.n['reuse_input']()
  self.assertTrue(proof['inputReusedWithoutWrite']);self.assertFalse(proof['priorSourcePreflightReused'])
  self.assertEqual(proof['newInputFrame']['st_ino'],file.stat().st_ino)
 def test_prior_failure_or_copy_or_trace_mutations_refuse(self):
  actual,copied,detail,frames,file=self.fixture()
  for target,key,value in[(actual,'completed',True),(actual,'constructInvoked',True),(actual,'stage','construct-records'),(copied,'sha256','f'*64),(detail,'traceback',"KeyError: 'different'\n")]:
   original=target[key];target[key]=value
   try:
    with self.subTest(key=key),patch.object(os.path,'lexists',return_value=False),self.assertRaises(RuntimeError):self.n['reuse_input']()
   finally:target[key]=original
 def test_changed_old_frames_existing_effect_namespace_and_bad_mode_refuse(self):
  self.fixture();n=self.n
  with patch.dict(n,{'old_frames':lambda:{'foreign':'frame'}}),patch.object(os.path,'lexists',return_value=False),self.assertRaises(RuntimeError):n['reuse_input']()
  with patch.object(os.path,'lexists',return_value=True),self.assertRaises(RuntimeError):n['reuse_input']()
  n['NEW_INPUT'].lstat  # The real relocated inode/mode is used by the guard.
  n['NEW_INPUT'].parent.joinpath('input.json').chmod(0o644)
  with patch.object(os.path,'lexists',return_value=False),self.assertRaises(RuntimeError):n['reuse_input']()
 def run_order_fixture(self,mutate_saved=False):
  n=self.n;events=[];refs={'resultSha256':'a'*64,'inputSha256':'b'*64}
  binding={'format':'yunipals-native-readiness-prepared-binding-v1','operatorSha256':n['BINDING_SHA'],'manifestSha256':n['BINDING_MANIFEST_SHA'],'authorityInputSha256':n['AUTH_SHA'],'nativePolicyRefs':n['POLICY'],'metadataRefs':n['META'],'sourceRefs':refs,'sameAlreadyBoundGuardRequired':True,'originalFamily1ConstructorPassed':False,'sourceFactsReused':False,'currentPredicatesChanged':False}
  authority=types.SimpleNamespace(BASE=n['AUTH_BASE'],TTL_NS=120_000_000_000,COMMIT_RESERVE_NS=5_000_000_000)
  cache=types.SimpleNamespace(BASE=n['CACHE_BASE'],continuation_authority=authority,continuation_context={})
  session=types.SimpleNamespace(cache=cache,key={})
  session.preflight=lambda:events.append('preflight')or{'validated':True}
  def context(digest):events.append('cache_context');session.key['preparedConstructorBinding']=binding;cache.continuation_context['preparedConstructorBinding']=binding
  session.cache_context=context
  caller=types.ModuleType('caller_IO_fixture');caller.Session=lambda *args:events.append('Session')or session
  baseline={'format':'yunipals-ypal-ordinary-cache-continuation-authority-v6','completed':True,'action':'construct-records','identity':{'preparedConstructorBinding':copy.deepcopy(binding)},'fullSourcePostflight':{'validated':True},'productionPreparedACKCreated':False,'productionCOMMITQualified':False,'newStopActionPerformed':False,'actualNewRehearsalXID':'99999999','sha256':'a'*64,'beforeSha256':'b'*64,'rehearsedSha256':'c'*64,'authorizationSha256':'d'*64}
  caller.construct_records=lambda *args:events.append('construct_records')or baseline
  helper=types.ModuleType('binding_IO_fixture');helper.bind=lambda value:events.append('bind')or binding
  def read(path,digest=None):
   if path in[n['CALLER'],n['BINDING_HELPER']]:return b'pass'
   if path==n['REPORT']:return n['encoded']({'sourceRefs':refs})
   if path==n['AUTH_INPUT']:return n['encoded']({'format':'yunipals-ypal-ordinary-cache-continuation-authority-v6-input','nativePolicyRefs':n['POLICY']})
   if path==n['AUTH_BASE']/'captures'/n['CAPTURE']/'result.json':
    self.assertEqual(digest,baseline['sha256']);identity=copy.deepcopy(baseline['identity'])
    if mutate_saved:identity['preparedConstructorBinding']['manifestSha256']='f'*64
    return n['encoded']({'identity':identity})
   return b'protected-record-I/O-fixture'
  n.update(read=read,old_frames=lambda:{'same':'frames'},reuse_input=lambda:{'actual-prior-proof-I/O-fixture':True},save=lambda name,value:n['sha'](n['encoded'](value)),histories=lambda:{'instances':2},types=types.SimpleNamespace(ModuleType=lambda name:caller if name=='root_actual_family6'else helper))
  with patch.object(os.path,'lexists',return_value=False):
   if mutate_saved:
    with self.assertRaisesRegex(RuntimeError,'same_actual_saved_baseline_identity'):n['run']()
    return
   result=n['run']()
  self.assertEqual(events,['Session','preflight','bind','cache_context','construct_records'])
  self.assertNotIn('constructorBinding',result);self.assertEqual(result['constructorBindingSha256'],n['sha'](n['encoded'](binding)));self.assertTrue(result['baselineConstructed'])
 def test_fresh_call_order_preflight_then_binding_then_cache_and_one_construct(self):self.run_order_fixture()
 def test_foreign_saved_baseline_binding_refuses_after_original_return(self):self.run_order_fixture(mutate_saved=True)

if __name__=='__main__':unittest.main()
