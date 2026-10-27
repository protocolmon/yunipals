"""Actual failed-root scalars; private proofs/application returns are explicit I/O fixtures."""
import ast
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SOURCE=HERE/'ypal-cont6-baseline-owner-v3.py'
ROOT=HERE.parents[1]
spec=importlib.util.spec_from_file_location('baseline3_controls',SOURCE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
ACTUAL=json.loads((ROOT/'docs/unified-indexer/cont6-baseline2-pre-sql-failure-production-2026-10-26.json').read_bytes())
for label in['cacheContextConstructed','constructorBindingSourceSha256','constructorFixPassed','diagnosis','fullSourcePreflightPassed','observedAt','sourceCommit']:ACTUAL.pop(label)

class Controls(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.baseline3-controls-',dir=ROOT);self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name);self.root.chmod(0o700)
  mask=os.umask(0o077);self.addCleanup(lambda:os.umask(mask))
  self.n={'__name__':'explicit_private_IO_fixture'};exec(compile(m.REMOTE,str(SOURCE)+':remote','exec'),self.n)
 def fixture(self):
  n=self.n;actual=copy.deepcopy(ACTUAL);expected=actual.pop('resultSha256')
  self.assertEqual(n['sha'](n['encoded'](actual)),expected)
  self.assertEqual(expected,'41df8baea9c527276d1f0bff4b7ed69cbf88b826b31bcfc367288e99143902b5')
  old={'explicit-private-original-frame-projection':True}
  source_refs={'explicit-private-source-ref-fixture':True}
  binding={'format':'yunipals-native-readiness-prepared-binding-v1','operatorSha256':n['BINDING_SHA'],'manifestSha256':n['BINDING_MANIFEST_SHA'],
   'nativePolicyRefs':n['POLICY'],'metadataRefs':n['META'],'authorityInputSha256':n['AUTH_SHA'],'sourceRefs':source_refs,
   'sameAlreadyBoundGuardRequired':True,'originalFamily1ConstructorPassed':False,'sourceFactsReused':False,'currentPredicatesChanged':False}
  directory=self.root/'owned-input';directory.mkdir(mode=0o700);file=directory/'input.json';raw=b'explicit exact input-byte IO fixture';file.write_bytes(raw)
  destination=str(n['NEW_INPUT'])
  class FixedInput:
   parent=directory
   def __str__(self):return destination
   def lstat(self):return file.lstat()
  n['NEW_INPUT']=FixedInput()
  copied={'source':str(n['OLD_INPUT']),'destination':destination,'sha256':n['CACHE_SHA'],'originalBytesChanged':False}
  reused={'previousResultSha256':'36fe1cb6da9abc103c332da49829d33bcb04730a3fe1079e423b0b0f520bc0f0','inputCopy':copied,
   'newInputFrame':{key:getattr(file.lstat(),key)for key in n['FRAME']},'inputReusedWithoutWrite':True,'priorSourcePreflightReused':False}
  detail={'type':'RuntimeError','traceback':'static_legacy_host metadata_primitives data_current\nRuntimeError: '+actual['fixedCode']+'\n'}
  audit=self.root/'previous-root';audit.mkdir(mode=0o700);auth=self.root/'authority';(auth/'captures'/'cont6-baseline-20261026-2').mkdir(mode=0o700,parents=True)
  identity={'preparedConstructorBinding':binding,'authorityInputSha256':n['AUTH_SHA']}
  intent={'format':'yunipals-ypal-ordinary-cache-continuation-authority-v6','action':'construct-records','identity':identity,'automaticRetryAllowed':False}
  values={'result.private.json':actual,'old-files-before.private.json':old,'constructor-binding.private.json':binding,
   'owned-input-reuse.private.json':reused,'failure-traceback.private.json':detail,
   'preflight.private.json':{'explicit-private-proof-IO-fixture':True},'metadata-capture-histories.private.json':{'explicit-private-history-IO-fixture':True},
   'intent.json':{'explicit-previous-root-intent-IO-fixture':True}}
  for name,value in values.items():(audit/name).write_bytes(n['encoded'](value))
  cap=auth/'captures'/'cont6-baseline-20261026-2'/'intent.json';cap.write_bytes(n['encoded'](intent));n['AUTH_BASE']=auth
  fixed='/var/backups/yunipals-root-cont6-baseline-20261026-2'
  n['pathlib']=types.SimpleNamespace(Path=lambda value:audit if str(value)==fixed else Path(value))
  def read(path,digest=None):
   path=Path(path)if not isinstance(path,FixedInput)else path
   key=str(path)
   if key in[str(n['OLD_INPUT']),destination]:self.assertEqual(digest,n['CACHE_SHA']);return raw
   if path==cap:return n['encoded'](intent)
   if path.parent==audit:
    if digest is not None:
     known={'result.private.json':expected,'constructor-binding.private.json':actual['proofHashes']['constructorBinding'],
      'owned-input-reuse.private.json':actual['proofHashes']['ownedInputReuse'],'failure-traceback.private.json':actual['proofHashes']['failureTraceback'],
      'old-files-before.private.json':actual['proofHashes']['oldFilesBefore']}
     self.assertEqual(digest,known[path.name])
    return n['encoded'](values[path.name])
   raise AssertionError('unexpected private IO '+key)
  n.update(read=read,old_frames=lambda:copy.deepcopy(old))
  return actual,binding,identity,intent,reused,detail,audit,cap
 def test_actual_failed_header_and_genuine_four_key_intent_then_reuse(self):
  actual,binding,identity,intent,*_=self.fixture();n=self.n
  tree=ast.parse((ROOT/'ops/unified-indexer-transition/ypal-ordinary-cache-continuation-authority-v1.py').read_bytes())
  construct=next(row for row in tree.body if isinstance(row,ast.FunctionDef)and row.name=='construct_records')
  written=next(row.value for row in construct.body if isinstance(row,ast.Expr)and isinstance(row.value,ast.Call)and ast.unparse(row.value.func)=='write')
  self.assertEqual({key.value for key in written.args[1].keys},set(intent))
  with patch.object(os.path,'lexists',return_value=False):value=n['reuse_input']()
  self.assertEqual(value['previousConstructIdentity'],identity);self.assertEqual(value['previousConstructorBinding'],binding)
  self.assertFalse(value['priorSourcePreflightReused'])
 def test_failed_proof_or_intent_mutations_refuse(self):
  actual,binding,identity,intent,reused,detail,*_=self.fixture();n=self.n
  changes=[(actual,'completed',True),(actual,'constructReturned',True),(actual,'fixedCode','unknown_failure'),
   (binding,'operatorSha256','f'*64),(intent,'automaticRetryAllowed',True),(intent,'extra','unknown'),(detail,'traceback','different')]
  for target,key,bad in changes:
   present=key in target;prior=target.get(key);target[key]=bad
   try:
    with self.subTest(key=key),patch.object(os.path,'lexists',return_value=False),self.assertRaises(RuntimeError):n['reuse_input']()
   finally:
    if present:target[key]=prior
    else:del target[key]
 def test_real_failed_files_bookends_allow_only_new_owned_capture_after_success(self):
  *_,cap=self.fixture();n=self.n;before=n['failed_frames']();self.assertEqual(len(before),9)
  own=n['AUTH_BASE']/'captures'/n['CAPTURE'];own.mkdir(mode=0o700);(own/'intent.json').write_bytes(b'new own intent');(own/'result.json').write_bytes(b'new own result')
  with self.assertRaises(RuntimeError):n['failed_frames']()
  self.assertEqual(n['failed_frames'](True),before)
  with cap.open('ab')as stream:stream.write(b' ')
  self.assertNotEqual(n['failed_frames'](True),before)
 def test_default_inert_and_exact_single_original_dispatch(self):
  tree=ast.parse(m.REMOTE);calls=[ast.unparse(row.func)for row in ast.walk(tree)if isinstance(row,ast.Call)]
  for name in['module.Session','session.preflight','helper.bind','session.cache_context','generation.bind','module.construct_records']:self.assertEqual(calls.count(name),1,name)
  for name in['session.finish','module.qualify_held','module.execute_cache','module.execute_reader','sys.settrace','sys.setprofile']:self.assertNotIn(name,calls)
  with patch.object(sys,'argv',[str(SOURCE)]),patch.object(m.subprocess,'run',side_effect=AssertionError('inert default')),contextlib.redirect_stdout(io.StringIO())as out:self.assertEqual(m.main(),0)
  self.assertTrue(json.loads(out.getvalue())['staticOnly'])
 def run_fixture(self,foreign=False):
  n=self.n;events=[];refs={'private-source-refs-IO-fixture':True}
  binding={'format':'yunipals-native-readiness-prepared-binding-v1','operatorSha256':n['BINDING_SHA'],'manifestSha256':n['BINDING_MANIFEST_SHA'],
   'authorityInputSha256':n['AUTH_SHA'],'nativePolicyRefs':n['POLICY'],'metadataRefs':n['META'],'sourceRefs':refs,'sameAlreadyBoundGuardRequired':True,
   'originalFamily1ConstructorPassed':False,'sourceFactsReused':False,'currentPredicatesChanged':False}
  gbind={'format':'yunipals-native-readiness-generation-binding-v1','operatorSha256':n['GENERATION_SHA'],'manifestSha256':n['GENERATION_MANIFEST_SHA'],
   'nativePolicyRefs':n['POLICY'],'authorityInputSha256':n['AUTH_SHA'],'constructorBindingSha256':n['sha'](n['encoded'](binding)),
   'oldWholeGeneration3CurrentPassed':False,'candidateChecksChanged':False,'sourceFactsReused':False,'currentPredicatesRemoved':False}
  before={'preparedConstructorBinding':binding};after={**before,'generationCurrentBinding':gbind}
  authority=types.SimpleNamespace(BASE=n['AUTH_BASE'],TTL_NS=120_000_000_000,COMMIT_RESERVE_NS=5_000_000_000,new_identity=lambda *_:copy.deepcopy(before))
  cache=types.SimpleNamespace(BASE=n['CACHE_BASE'],continuation_authority=authority,continuation_context={});session=types.SimpleNamespace(cache=cache,host=object(),key={})
  session.preflight=lambda:events.append('preflight')or{'validated':True}
  def context(_):events.append('cache_context');session.key['preparedConstructorBinding']=binding;cache.continuation_context['preparedConstructorBinding']=binding
  session.cache_context=context
  caller=types.ModuleType('caller_IO_fixture');caller.Session=lambda *_:events.append('Session')or session
  baseline={'format':'yunipals-ypal-ordinary-cache-continuation-authority-v6','completed':True,'action':'construct-records','identity':after,
   'fullSourcePostflight':{'validated':True},'productionPreparedACKCreated':False,'productionCOMMITQualified':False,'newStopActionPerformed':False,
   'actualNewRehearsalXID':'99999999','sha256':'a'*64,'beforeSha256':'b'*64,'rehearsedSha256':'c'*64,'authorizationSha256':'d'*64}
  caller.construct_records=lambda *_:events.append('construct_records')or baseline
  helper=types.ModuleType('ctor_IO_fixture');helper.bind=lambda _:events.append('constructor_bind')or binding
  generation=types.ModuleType('generation_IO_fixture')
  def gen(_):events.append('generation_bind');session.key['generationCurrentBinding']=gbind;cache.continuation_context['generationCurrentBinding']=gbind;return gbind
  generation.bind=gen
  def read(path,digest=None):
   if path in[n['CALLER'],n['BINDING_HELPER'],n['GENERATION_HELPER']]:return b'pass'
   if path==n['REPORT']:return n['encoded']({'sourceRefs':refs})
   if path==n['AUTH_INPUT']:return n['encoded']({'format':'yunipals-ypal-ordinary-cache-continuation-authority-v6-input','nativePolicyRefs':n['POLICY']})
   if path==n['AUTH_BASE']/'captures'/n['CAPTURE']/'result.json':
    owned=copy.deepcopy(after)
    if foreign:owned['generationCurrentBinding']['operatorSha256']='f'*64
    return n['encoded']({'identity':owned})
   return b'protected-private-record-IO-fixture'
  modules={'root_actual_family6':caller,'root_actual_prepared_binding_successor':helper,'root_actual_generation_binding':generation}
  n.update(read=read,old_frames=lambda:{'old':'same'},failed_frames=lambda after=False:{'failed':'same'},
   reuse_input=lambda:{'previousConstructorBinding':binding,'previousConstructIdentity':before},
   save=lambda name,value:n['sha'](n['encoded'](value)),histories=lambda:{'instances':2},types=types.SimpleNamespace(ModuleType=lambda name:modules[name]))
  with patch.object(os.path,'lexists',return_value=False):
   if foreign:
    with self.assertRaisesRegex(RuntimeError,'same_actual_saved_baseline_identity'):n['run']()
    return
   result=n['run']()
  self.assertEqual(events,['Session','preflight','constructor_bind','cache_context','generation_bind','construct_records'])
  self.assertNotIn('constructorBinding',result);self.assertNotIn('generationCurrentBinding',result)
  self.assertEqual(result['generationBindingSha256'],n['sha'](n['encoded'](gbind)));self.assertTrue(result['baselineConstructed'])
 def test_fresh_call_order_both_owned_private_bindings_and_scalar_only_result(self):self.run_fixture()
 def test_foreign_saved_generation_identity_refuses(self):self.run_fixture(foreign=True)

if __name__=='__main__':unittest.main()
