"""Genuine full approval_snapshot SQL/predicates; clock/SQL rows are fixtures."""
import copy,fcntl,hashlib,importlib.util,os,tempfile,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
def load(path):
 s=importlib.util.spec_from_file_location(Path(path).stem,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=load(HERE/'ypal-cont5-approval-renewal-wait-v1.py')
family=load(HERE/'ypal-ordinary-publication-continue-v5.test.py');actual=family.actual['ypal-ordinary-cache-continuation-authority-v5.py']
class Clock:
 def __init__(self):self.n=0;self.calls=0;self.sleeps=[];self.jump=None
 def monotonic_ns(self):
  self.calls+=1
  if self.jump and self.calls==self.jump[0]:self.n=self.jump[1]
  return self.n
 def sleep(self,duration):self.sleeps.append(duration);self.n+=int(duration*1e9)
class Controls(unittest.TestCase):
 def fixture(self,steps):
  clock=Clock();namespace=types.ModuleType('actual_snapshot_namespace');namespace.__dict__.update(actual.__dict__)
  namespace.time=clock
  fn=actual.approval_snapshot;namespace.approval_snapshot=types.FunctionType(fn.__code__,namespace.__dict__,fn.__name__,fn.__defaults__,fn.__closure__)
  # The real C5 facade and its genuine __getattr__/composition bodies remain;
  # only its already composed snapshot namespace and SQL/clock I/O are fixtures.
  raw=family.wrappers['ypal-ordinary-cache-continuation-authority-v5.py'];facade=types.ModuleType('actual_snapshot_facade');facade.__dict__.update(raw.__dict__)
  facade._implementation=namespace
  for name in ['__getattr__','composition']:
   original=getattr(raw,name);facade.__dict__[name]=types.FunctionType(original.__code__,facade.__dict__,original.__name__,original.__defaults__,original.__closure__)
  cache=types.SimpleNamespace(continuation_authority=facade);host=types.SimpleNamespace(cache=cache);calls=[];position=0
  def query(sql):
   nonlocal position
   self.assertEqual(sql,actual.APPROVAL_SQL);self.assertIs(host.cache,cache)
   row=steps[min(position,len(steps)-1)];position+=1;calls.append(sql)
   if isinstance(row,BaseException):raise row
   age_ns,checked_us,query_ns,changes=row
   at=1_000_000_000_000+clock.n//1000;checked=at-age_ns//1000 if checked_us is None else checked_us
   value={'release':actual.RELEASE,'identity':actual.READ_IDENTITY,'state':'ready','errorCode':None,'probe':True,'nativeMode':True,'canonical':True,
    'frontier':'actualNativeFrontierFixture','frameFrontier':'actualNativeFrontierFixture','implementation':actual.APPROVED_IMPLEMENTATION,
    'atUs':str(checked+age_ns//1000),'checkedUs':str(checked),'checkedBlock':'10','frameBlock':'11','checkedHash':'0x'+'1'*64,'frameHash':'0x'+'2'*64}
   value.update(changes);clock.n+=query_ns;return value
  host.query=query
  self.assertIs(facade.approval_snapshot.__globals__,namespace.__dict__)
  self.assertEqual(actual.code_identity(facade.approval_snapshot.__code__),actual.code_identity(actual.approval_snapshot.__code__))
  return clock,facade,host,calls
 def run_wait(self,steps,change=None):
  clock,facade,host,calls=self.fixture(steps);observations=[]
  if change:change(clock,facade,host,observations)
  with patch.object(m,'time',clock):result=m.wait_for_native_approval_renewal(facade,host,observations)
  return result,observations,clock,facade,host,calls
 def test_complete_genuine_facade_snapshot_observes_advance_but_conveys_no_authority(self):
  result,rows,clock,facade,host,calls=self.run_wait([(45_000_000_000,900_000_000_000,100_000_000,{}),(1_000_000_000,None,100_000_000,{})])
  self.assertEqual(len(calls),2);self.assertEqual(result['sampleCount'],2);self.assertGreater(int(result['selectedCheckedUs']),int(result['firstCheckedUs']))
  self.assertTrue(result['schedulingOnly']);self.assertFalse(result['SQLApprovalAuthority']);self.assertFalse(result['actualHeldCallbackQualified'])
  self.assertFalse(result['approvalClockReset']);self.assertEqual(len(clock.sleeps),1)
  self.assertEqual(rows[1]['actualApprovalSnapshot']['snapshot']['implementation'],actual.APPROVED_IMPLEMENTATION)
 def test_fresh_first_or_unchanged_checked_timestamp_cannot_qualify(self):
  first=1_000_000_000_000
  result,rows,clock,facade,host,calls=self.run_wait([(0,first,0,{}),(0,first,0,{}),(0,first+1,0,{})])
  self.assertEqual(len(calls),3);self.assertFalse(rows[0]['schedulingThresholdsSatisfied']);self.assertFalse(rows[1]['strictlyAdvancedFromInitial'])
  self.assertTrue(rows[2]['schedulingThresholdsSatisfied'])
 def test_age_and_remaining_thresholds_are_exact_and_query_time_stays_charged(self):
  steps=[(45_000_000_000,None,0,{}),(2_000_001_000,None,0,{}),(2_000_000_000,None,1_000_000_001,{}),(2_000_000_000,None,1_000_000_000,{})]
  result,rows,*_=self.run_wait(steps)
  self.assertFalse(rows[1]['schedulingThresholdsSatisfied']);self.assertFalse(rows[2]['schedulingThresholdsSatisfied'])
  self.assertEqual(rows[3]['remainingBeforeReturnNanoseconds'],87_000_000_000);self.assertEqual(result['sampleCount'],4)
 def test_source_predicate_and_query_errors_propagate_once_without_sleep_or_retry(self):
  for step in [(0,None,0,{'probe':False}),(0,None,0,{'nativeMode':False}),(0,None,0,{'frontier':'foreign'}),PermissionError('original_query_error')]:
   clock,facade,host,calls=self.fixture([step]);rows=[]
   with patch.object(m,'time',clock),self.assertRaises((RuntimeError,PermissionError))as caught:m.wait_for_native_approval_renewal(facade,host,rows)
   self.assertEqual(len(calls),1);self.assertEqual(clock.sleeps,[]);self.assertFalse(rows[0]['returned']);self.assertFalse(rows[0]['queryOrPredicateRetried'])
   if isinstance(step,BaseException):self.assertIs(caught.exception,step)
 def test_deadline_checked_after_completed_query_and_before_next_query(self):
  clock,facade,host,calls=self.fixture([(0,None,100_000_000,{})]);clock.jump=(5,90_000_000_000);rows=[]
  with patch.object(m,'time',clock),self.assertRaisesRegex(RuntimeError,'expired_after_snapshot'):m.wait_for_native_approval_renewal(facade,host,rows)
  self.assertEqual(len(calls),1);self.assertTrue(rows[0]['returned']);self.assertEqual(clock.sleeps,[])
 def test_sample_limit_is_independent_of_stalled_fixture_clock(self):
  clock,facade,host,calls=self.fixture([(0,1_000_000_000_000,0,{})]);clock.sleep=lambda duration:clock.sleeps.append(duration);rows=[]
  with patch.object(m,'time',clock),self.assertRaisesRegex(RuntimeError,'sample_limit'):m.wait_for_native_approval_renewal(facade,host,rows)
  self.assertEqual(len(calls),90);self.assertEqual(len(rows),90)
 def test_no_SDK_lock_is_acquired_and_query_runs_after_actual_lock_release(self):
  clock,facade,host,calls=self.fixture([(0,1_000_000_000_000,0,{}),(0,1_000_000_000_001,0,{})]);original=host.query
  with tempfile.TemporaryDirectory(dir=HERE)as directory:
   path=Path(directory)/'owned-sdk.lock';fd=os.open(path,os.O_CREAT|os.O_RDWR,0o600);fcntl.flock(fd,fcntl.LOCK_EX);fcntl.flock(fd,fcntl.LOCK_UN)
   def query(sql):
    other=os.open(path,os.O_RDWR)
    try:fcntl.flock(other,fcntl.LOCK_EX|fcntl.LOCK_NB)
    finally:os.close(other)
    return original(sql)
   host.query=query;host.read_host=types.SimpleNamespace(primitives={'sdk':types.SimpleNamespace(lock=Mock(side_effect=AssertionError('no SDK lock acquisition')))})
   try:
    with patch.object(m,'time',clock):m.wait_for_native_approval_renewal(facade,host,[])
   finally:os.close(fd)
   host.read_host.primitives['sdk'].lock.assert_not_called()
 def test_wrong_host_rebound_function_or_reused_history_refuses(self):
  clock,facade,host,calls=self.fixture([(0,None,0,{})]);host.cache.continuation_authority=object()
  with patch.object(m,'time',clock),self.assertRaisesRegex(RuntimeError,'same_actual_CONT5_Host'):m.wait_for_native_approval_renewal(facade,host,[])
  self.assertEqual(calls,[])
  clock,facade,host,calls=self.fixture([(0,None,0,{})])
  with patch.object(m,'time',clock),self.assertRaisesRegex(RuntimeError,'fresh_private'):m.wait_for_native_approval_renewal(facade,host,[{}])
  self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
