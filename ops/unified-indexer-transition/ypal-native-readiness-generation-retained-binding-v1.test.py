"""Actual static Host/current dispatch; private receipt, worker and SQL observations are explicit I/O fixtures."""
import ast
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent

def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/name);n=importlib.util.module_from_spec(spec);spec.loader.exec_module(n);return n
m=load('ypal-native-readiness-generation-retained-binding-v1.py')
g=load('ypal-native-readiness-generation-binding-v1.test.py')

class Controls(unittest.TestCase):
 def setUp(self):
  self.base=g.Controls();self.base.setUp();self.addCleanup(self.base.doCleanups)
  self.enterContext(patch.object(m,'public',side_effect=g.context_tests.local))
  original=m.load
  def source(name):
   value=original(name)
   if name==m.PARENT:value.public=g.context_tests.local
   return value
  self.enterContext(patch.object(m,'load',side_effect=source))
 def bound(self):
  old,_=self.base.bound_generation();value=m.generation(old._original,self.base.ctx)
  parent=m.load(m.PARENT);retained=parent.closure(value.validate_retained_current)['retained']
  return value,retained.__globals__['prepared_attempt'],retained,parent
 def test_complete_338_source_closure_and_separate_provenance(self):
  m.authenticate();self.assertEqual(len(m.SOURCE_PINS)+1,338)
  bound,_,_,_=self.bound();record=bound.generation_retained_binding
  self.assertEqual(record['operatorSha256'],m.sha(g.context_tests.local(m.FILE)))
  self.assertEqual(record['candidateCurrentAdapterSha256'],m.SOURCE_PINS[m.PARENT])
  self.assertFalse(record['retainedResultChanged']);self.assertFalse(record['oldWholeGeneration3CurrentPassed'])
 def test_actual_attempt_Host_uses_exact_shared_static_common_on_retained_route(self):
  original=self.base.bound_generation
  def bound_generation():
   old,_=original();value=m.generation(old._original,self.base.ctx);parent=m.load(m.PARENT)
   retained=parent.closure(value.validate_retained_current)['retained']
   return value,retained.__globals__['prepared_attempt']
  self.base.bound_generation=bound_generation
  self.base.test_actual_attempt_Host_constructor_dispatches_policy_static_common()
 def test_full_retained_dispatch_returns_exact_original_object_and_terminal_key_set(self):
  bound,_,retained,parent=self.bound();source=g.attempt_tests.m;made=[]
  h,docs,op,runtime,result=g.attempt_tests.retained_fixture()
  actual_retained=parent.clone(source.retained_current,{'document':lambda path,*_:copy.deepcopy(docs[path.name]),
   'terminal_worker':lambda *_:({},runtime,result),'load':lambda _:types.SimpleNamespace(protected_inputs=lambda:runtime['inputSha256'])})
  candidate={'operatorSha256':m.SOURCE_PINS[parent.GENERATION],'generationId':'105','operationSha256':'1'*64}
  original=parent.clone(source.validate_retained_current,{'candidate_context':lambda *args,**kwargs:(copy.deepcopy(candidate),h),
   'retained_current':actual_retained,'terminal_worker':lambda *_:({},runtime,result)})
  def run(candidate_sha):
   value=original(candidate_sha);made.append(value);return value
  retained.__globals__['acceptance_functions']=lambda *_:(None,None,{'validate_retained_current':run})
  with patch.object(source.os.path,'lexists',return_value=False):
   value=bound.validate_retained_current('2'*64)
   terminal=load('ypal-ordinary-generation-binding-v1.py')
   tree=ast.parse((HERE/'ypal-ordinary-generation-binding-v1.py').read_bytes())
   method=next(row for row in ast.walk(tree)if isinstance(row,ast.FunctionDef)and row.name=='terminal')
   keys=ast.literal_eval(next(row.value for row in method.body if isinstance(row,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='keys'for t in row.targets)))
   self.assertIs(value,made[0]);self.assertEqual(set(value),keys)
   self.assertNotIn('generationCurrentObserver',value);self.assertEqual(value['operatorSha256'],candidate['operatorSha256'])
   self.assertTrue(value['attemptWorkerTerminal']);self.assertTrue(value['actualAttemptApplicationEmpty'])
   self.assertEqual(value['databaseWrites'],0)
   declaration=types.SimpleNamespace(current=lambda:None,owner=bound,value={'owner':{'sha256':candidate['operatorSha256']}})
   self.assertEqual(terminal.Binding.terminal(declaration,'2'*64,candidate),value)
   result['ownedTermination']['remainingBackends']=1
   with self.assertRaises(RuntimeError):bound.validate_retained_current('2'*64)
 def test_policy_drift_and_original_failure_keep_refusal_identity(self):
  bound,_,retained,_=self.bound();error=RuntimeError('actual_original_retained_leaf_refusal')
  def refusal(*_):raise error
  retained.__globals__['acceptance_functions']=lambda *_:(None,None,{'validate_retained_current':refusal})
  try:bound.validate_retained_current('2'*64)
  except RuntimeError as observed:self.assertIs(observed,error)
  else:self.fail('original refusal was swallowed')
  self.base.ctx.refs['producerSha256']='f'*64
  with self.assertRaises(RuntimeError)as changed:bound.validate_retained_current('2'*64)
  self.assertIsNot(changed.exception,error)

if __name__=='__main__':unittest.main()
