"""Actual CONT5 full qualifier; receipt/transport/DB boundaries are fixtures."""
import copy,hashlib,importlib.util,json,sys,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
def load(path):
 spec=importlib.util.spec_from_file_location(Path(path).stem,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
m=load(HERE/'ypal-cont5-held-after-exception-v1.py')
family=load(HERE/'ypal-ordinary-publication-continue-v5.test.py')
actual=family.actual[m.AUTHORITY]

def local(path,digest):
 raw=(HERE/Path(path).name).read_bytes();m.need(hashlib.sha256(raw).hexdigest()==digest,'exact_actual_test_source_hash_required');return raw

class Controls(unittest.TestCase):
 def setUp(self):
  self.enterContext(patch.object(m,'public',side_effect=local));self.native_evaluate=m.evaluate
  def evaluate(raw,path):
   if Path(path).name==m.AUTHORITY:
    # Reuse the genuinely composed protected-source fixture namespace. Its
    # nested file readers were relocated during the existing actual factory
    # construction; no current/Host method or business body is replaced here.
    self.assertEqual(raw,(HERE/m.AUTHORITY).read_bytes())
    return family.wrappers[m.AUTHORITY]
   return self.native_evaluate(raw,path)
  self.enterContext(patch.object(m,'evaluate',side_effect=evaluate))
  self.assertIsNone(sys.gettrace());self.assertIsNone(sys.getprofile())
 def fixture(self,inner=None):
  value=types.ModuleType('genuine_held_fixture');value.__dict__.update(actual.__dict__)
  for name,fn in list(vars(actual).items()):
   if type(fn)is types.FunctionType:value.__dict__[name]=types.FunctionType(fn.__code__,value.__dict__,fn.__name__,fn.__defaults__,fn.__closure__)
  value.qualification_key=lambda *_:{};value.capture_directory=lambda _:Path('/unused-owned-held-witness-fixture')
  value.write=Mock(return_value='fixture');value.original_catalog=lambda *_:({},{});value.stopped=lambda *_:({}, {'sql':{'result':{},'resultJson':'{}'}},{})
  value.rollback_transport=lambda fn,*_:fn;value.prepared_callback=lambda *_:None
  def parent():return None
  parent=types.FunctionType(parent.__code__,{'protected':lambda *_:b''})
  def fail(*_args,**_kwargs):
   if inner is not None:raise inner
   return {'explicitUnexpectedReturnIOFixture':True}
  cache=types.SimpleNamespace(_sql_child=parent,prior_cache=types.SimpleNamespace(_sql_child=parent),
   BASE=Path('/unused-owned-held-witness-fixture'),continuation_authority=value,sql_child=fail)
  return value,cache,parent
 def caught(self,value,cache):
  try:value.qualify_held(cache,object(),'fixture')
  except BaseException as error:return error
  raise AssertionError('genuine qualifier unexpectedly accepted')
 def test_exact_actual_reference_factory_has_complete_source_authentication(self):
  reference=m.reference();self.assertEqual(m.code_identity(reference._qualify_held.__code__),m.code_identity(actual._qualify_held.__code__))
  self.assertEqual(reference.FILE,actual.FILE)
 def test_actual_provider_authority_and_original_rollback_callback_compilers(self):
  case=family.Controls();case.setUp();self.addCleanup(case.doCleanups)
  cache=case.provider().cache_runtime();authority=cache.continuation_authority;original=cache._sql_child
  self.assertIs(authority._qualify_held.__globals__,authority.__dict__)
  inner=RuntimeError('actual_bound_provider_inner_refusal')
  def fail(*_args,**_kwargs):raise inner
  with patch.object(authority,'qualification_key',return_value={}),\
       patch.object(authority,'capture_directory',return_value=Path('/unused-owned-held-witness-fixture')),\
       patch.object(authority,'write',return_value='fixture'),\
       patch.object(authority,'original_catalog',return_value=({},{})),\
       patch.object(authority,'stopped',return_value=({}, {'sql':{'result':{},'resultJson':'{}'}},{})),\
       patch.object(cache,'sql_child',side_effect=fail):
   outer=self.caught(authority,cache);witness=m.Witness(outer,authority)
  self.assertIs(witness.inner_error,inner);self.assertIs(cache._sql_child,original)
  self.assertIsNone(sys.gettrace());self.assertIsNone(sys.getprofile())
 def test_genuine_caught_error_survives_unwinding_without_trace_or_parent_change(self):
  inner=RuntimeError('fixture_original_full_publication_refusal');value,cache,parent=self.fixture(inner)
  code=value._qualify_held.__code__;outer=self.caught(value,cache)
  witness=m.Witness(outer,value);record=witness.snapshot()
  self.assertIs(witness.inner_error,inner);self.assertTrue(record['actualQualifierFrameMatched']);self.assertTrue(record['caughtInnerErrorObserved'])
  self.assertEqual(record['innerErrorMessage'],str(inner));self.assertIn('fixture_original_full_publication_refusal',record['innerErrorTraceback'])
  self.assertEqual(str(outer),'complete_actual_held_callback_then_refused_COMMIT_ACK_required')
  self.assertIs(cache._sql_child,parent);self.assertIs(value._qualify_held.__code__,code)
  self.assertFalse(hasattr(cache,'_continuation_qualification'));self.assertFalse(hasattr(cache,'_continuation_approval_gate'))
  self.assertIsNone(sys.gettrace());self.assertIsNone(sys.getprofile())
  self.assertFalse(record['liveTraceInstalled']);self.assertFalse(record['SQLParentWrapped']);self.assertFalse(record['transactionOutcomeQualified'])
 def test_unknown_outer_exception_is_preserved_without_invented_inner_error(self):
  try:raise RuntimeError('different_original_failure')
  except RuntimeError as outer:
   witness=m.Witness(outer,actual);record=witness.snapshot();self.assertIs(witness.outer_error,outer)
  self.assertFalse(record['actualQualifierFrameMatched']);self.assertIsNone(witness.inner_error)
 def test_genuine_no_inner_error_cut_remains_explicit_absence(self):
  value,cache,parent=self.fixture();outer=self.caught(value,cache);witness=m.Witness(outer,value)
  self.assertTrue(witness.matched);self.assertIsNone(witness.inner_error);self.assertFalse(witness.snapshot()['caughtInnerErrorObserved'])
 def test_actual_code_or_namespace_mutation_refuses(self):
  value,cache,parent=self.fixture(RuntimeError('original'));outer=self.caught(value,cache)
  value._qualify_held=lambda *_:None
  with self.assertRaisesRegex(RuntimeError,'genuine_complete_CONT5'):m.Witness(outer,value)
  value,cache,parent=self.fixture(RuntimeError('original'));outer=self.caught(value,cache);value.NEW_BASE=Path('/foreign')
  with self.assertRaisesRegex(RuntimeError,'genuine_complete_CONT5'):m.Witness(outer,value)
 def test_cache_authority_mismatch_and_changed_source_refuse(self):
  value,cache,parent=self.fixture(RuntimeError('original'));outer=self.caught(value,cache);cache.continuation_authority=object()
  with self.assertRaisesRegex(RuntimeError,'actual_cache_bound'):m.Witness(outer,value)
  with patch.object(m,'public',side_effect=RuntimeError('changed_actual_source')):
   with self.assertRaisesRegex(RuntimeError,'changed_actual_source'):m.Witness(outer,actual)
 def test_existing_observer_state_is_preserved_without_install_or_removal(self):
  value,cache,parent=self.fixture(RuntimeError('original'));outer=self.caught(value,cache)
  trace=lambda *_:None;profile=lambda *_:None;sys.settrace(trace);sys.setprofile(profile)
  try:
   witness=m.Witness(outer,value);self.assertIs(sys.gettrace(),trace);self.assertIs(sys.getprofile(),profile)
  finally:sys.settrace(None);sys.setprofile(None)
  self.assertTrue(witness.snapshot()['existingTracePreserved'])
 def test_witness_never_invokes_business_current_query_or_transport(self):
  value,cache,parent=self.fixture(RuntimeError('original'));outer=self.caught(value,cache)
  calls=Mock(side_effect=AssertionError('no effect/current after exception'))
  for name in ['qualify_held','fresh_approval','original_catalog','stopped','write']:
   if name!='qualify_held':setattr(value,name,calls)
  cache.sql_child=calls;m.Witness(outer,value).snapshot();calls.assert_not_called()

if __name__=='__main__':unittest.main()
