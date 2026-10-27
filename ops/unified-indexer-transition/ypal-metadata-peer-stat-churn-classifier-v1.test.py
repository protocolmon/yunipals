"""Real frozen Epoch3 + inventory bodies; subprocess/Owner receipt I/O fixtures."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import time
import types
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent

def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/name);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('ypal-metadata-peer-stat-churn-classifier-v1.py')
prior=load('ypal-ordinary-metadata-current-epoch-v3.test.py')
FIXTURE=json.loads((HERE/'ypal-metadata-peer-stat-churn-classifier-v1.fixture.json').read_bytes())
PID=FIXTURE['missingPID'];ERR=base64.b64decode(FIXTURE['stderrBase64'])

def local(path,digest=None):
 p=HERE/Path(path).name
 if p.name==m.INVENTORY:p=HERE.parent/'booster-launch'/p.name
 raw=p.read_bytes()
 if digest is not None and m.sha(raw)!=digest:raise RuntimeError('actual_classifier_test_source_required')
 return raw

class Controls(unittest.TestCase):
 def setUp(self):
  self.enterContext(patch.object(m,'public',side_effect=local))
  self.f=prior.Controls();self.f.setUp();self.addCleanup(self.f.doCleanups)
  self.saved=[];self.commands=[]
 def observed(self,results):
  def run(*args,**kwargs):
   self.commands.append((args,kwargs))
   value=results.pop(0)
   if isinstance(value,BaseException):raise value
   if callable(value):return value(*args,**kwargs)
   return value
  def save(name,raw):self.saved.append((name,raw));return m.sha(raw)
  value=m.SubprocessDiagnostics(run,save)
  self.enterContext(patch.object(value._inventory,'subprocess',types.SimpleNamespace(run=value)))
  return value
 def failure(self,err=ERR,code=1,out=b''):return subprocess.CompletedProcess([],code,out,err)
 def success(self):return subprocess.CompletedProcess([],0,json.dumps({str(PID):{'startTicks':1,'socketInodes':[]}}).encode(),b'')
 def capture(self,observer,*,policy=False,current=None):
  epoch=self.f.epoch();original=prior.actual.Epoch.__bases__[0].current
  def owner(*_):
   observer._inventory.peer_fds([PID],111,113)
   return copy.deepcopy(self.f.current if current is None else current)
  self.f.owner.actor_current.side_effect=owner
  fn=observer._epoch.capture_current
  if policy:fn=types.FunctionType(fn.__code__,{**fn.__globals__,'FORMAT':'yunipals-ypal-ordinary-metadata-current-policy-v1'},fn.__name__,fn.__defaults__,fn.__closure__)
  with patch.object(time,'sleep',return_value=None):return fn(epoch,original),epoch
 def test_real_payload_and_two_discarded_complete_captures_then_success(self):
  self.assertEqual(FIXTURE['publicScriptSha256'],m.SCRIPT_SHA);self.assertFalse(FIXTURE['actualProductionEvidence'])
  observer=self.observed([self.failure(),self.failure(),self.success()])
  result,epoch=self.capture(observer)
  self.assertEqual(result,self.f.current);self.assertEqual(len(self.commands),3);self.assertEqual(observer.classified,2)
  self.assertEqual([row['discarded']for row in epoch.current_capture_attempts],[True,True,False])
  self.assertEqual(self.f.owner.acknowledgement.call_count,3)
  self.assertEqual(len(self.saved),2)
  payload=json.loads(self.saved[0][1]);self.assertTrue(payload['rawPublicPeerEvidenceRetained']);self.assertEqual(base64.b64decode(payload['stderrBase64']),ERR)
  self.assertTrue(all(row['partialObservationReused']is row['effectsRetried']is False for row in epoch.current_capture_attempts))
 def test_actual_policy_cloned_capture_code_and_format_is_accepted(self):
  observer=self.observed([self.failure(),self.success()]);_,epoch=self.capture(observer,policy=True)
  self.assertEqual(observer.classified,1);self.assertEqual(len(epoch.current_capture_attempts),2)
  self.assertEqual(observer.snapshot()['events'][0]['captureFormat'],'yunipals-ypal-ordinary-metadata-current-policy-v1-capture')
 def test_three_attempt_cap_and_original_window_remain_exact(self):
  observer=self.observed([self.failure(),self.failure(),self.failure(),self.success()])
  with self.assertRaisesRegex(RuntimeError,'^'+m.RETRY_CODE+'$')as caught:self.capture(observer)
  self.assertEqual(observer.classified,3);self.assertEqual(len(self.commands),3)
  self.assertEqual(len(caught.exception.metadata_current_capture_attempts),3)
  self.assertTrue(all(row['discarded']for row in caught.exception.metadata_current_capture_attempts))
 def test_outside_genuine_capture_has_original_strict_failure(self):
  observer=self.observed([self.failure()])
  with self.assertRaisesRegex(RuntimeError,'^bounded_readonly_inventory_command_required$'):observer._inventory.peer_fds([PID],111,113)
  self.assertEqual(observer.classified,0);self.assertEqual(len(self.commands),1)
 def test_nonmatching_errno_path_pid_returncode_stdout_and_traceback_stay_strict(self):
  errors=[self.failure(ERR.replace(b'[Errno 2]',b'[Errno 13]')),
   self.failure(ERR.replace(b'/stat',b'/status')),self.failure(ERR.replace(str(PID).encode(),str(PID-1).encode())),
   self.failure(code=0),self.failure(out=b'partial'),self.failure(b'foreign prefix\n'+ERR),self.failure(ERR+b'foreign suffix\n'),
   self.failure(ERR.replace(b'FileNotFoundError:',b'PermissionError:'))]
  for failure in errors:
   with self.subTest(stderr=m.sha(failure.stderr),status=failure.returncode):
    observer=self.observed([failure]);self.f.owner.actor_current.reset_mock()
    with self.assertRaisesRegex(RuntimeError,'^bounded_readonly_inventory_command_required$'):self.capture(observer)
    self.assertEqual(observer.classified,0);self.assertEqual(len(observer.calls),1);self.assertEqual(self.f.owner.actor_current.call_count,1)
 def test_foreign_uid_gid_script_and_context_are_never_classified(self):
  for kind in['uid','gid','script','no-inventory']:
   observer=self.observed([self.failure()]);epoch=self.f.epoch();original=prior.actual.Epoch.__bases__[0].current
   if kind=='script':observer._inventory.PEER_FDS+='\n'
   def owner(*_):
    if kind=='no-inventory':
     argv=['/usr/bin/setpriv','--reuid=111','--regid=113','--clear-groups','--no-new-privs','--inh-caps=-all','--ambient-caps=-all','/usr/bin/python3','-I','-B','-c',observer._inventory.PEER_FDS,json.dumps([PID]),'111']
     result=observer(argv,capture_output=True,timeout=8,env=observer._inventory.CLEAN)
     if result.returncode:raise RuntimeError('bounded_readonly_inventory_command_required')
    else:observer._inventory.peer_fds([PID],112 if kind=='uid' else 111,114 if kind=='gid' else 113)
    return copy.deepcopy(self.f.current)
   self.f.owner.actor_current.side_effect=owner
   with self.assertRaisesRegex(RuntimeError,'^bounded_readonly_inventory_command_required$'):observer._epoch.capture_current(epoch,original)
   self.assertEqual(observer.classified,0)
 def test_modified_capture_code_or_caps_refuse_the_classification(self):
  for kind in['code','attempts','window']:
   observer=self.observed([self.failure()]);epoch=self.f.epoch();original=prior.actual.Epoch.__bases__[0].current
   self.f.owner.actor_current.side_effect=lambda *_:observer._inventory.peer_fds([PID],111,113)
   fn=observer._epoch.capture_current
   if kind=='code':fn=types.FunctionType(fn.__code__.replace(co_consts=tuple('foreign-docstring'if index==0 else value for index,value in enumerate(fn.__code__.co_consts))),fn.__globals__,fn.__name__)
   else:fn=types.FunctionType(fn.__code__,{**fn.__globals__,**({'MAXIMUM_ATTEMPTS':4}if kind=='attempts'else{'CAPTURE_WINDOW_NS':91_000_000_000})},fn.__name__)
   with self.assertRaisesRegex(RuntimeError,'^bounded_readonly_inventory_command_required$'):fn(epoch,original)
   self.assertEqual(observer.classified,0)
 def test_expired_original_capture_window_cannot_gain_a_retry(self):
  clock=[100];observer=self.observed([self.failure()]);epoch=self.f.epoch();original=prior.actual.Epoch.__bases__[0].current
  def owner(*_):clock[0]+=90_000_000_000;observer._inventory.peer_fds([PID],111,113)
  self.f.owner.actor_current.side_effect=owner
  with patch.object(time,'monotonic_ns',side_effect=lambda:clock[0]):
   with self.assertRaisesRegex(RuntimeError,'^bounded_readonly_inventory_command_required$'):observer._epoch.capture_current(epoch,original)
  self.assertEqual(observer.classified,0);self.assertEqual(len(observer.calls),1)
 def test_immutable_ACK_and_later_foreign_actor_are_still_strict(self):
  observer=self.observed([self.failure(),self.success()]);epoch=self.f.epoch();original=prior.actual.Epoch.__bases__[0].current
  def current(*_):observer._inventory.peer_fds([PID],111,113);return copy.deepcopy(self.f.current)
  def failed(*args,**kwargs):self.f.ack['actor']['main']['startTicks']+=1;return self.failure()
  observer._base.original=failed;self.f.owner.actor_current.side_effect=current
  with self.assertRaisesRegex(RuntimeError,'actual_immutable_ACK_changed'):observer._epoch.capture_current(epoch,original)
  self.assertEqual(observer.classified,1);self.assertEqual(self.f.owner.actor_current.call_count,1)
  observer=self.observed([self.failure(),self.success()]);foreign=copy.deepcopy(self.f.current);foreign['workerSha256']='0'*64
  with self.assertRaises(RuntimeError):self.capture(observer,current=foreign)
  self.assertEqual(observer.classified,1);self.assertEqual(len(observer.calls),2)
 def test_underlying_timeout_identity_and_raw_evidence_cap_preserved(self):
  error=subprocess.TimeoutExpired('actual underlying',8,stderr=ERR);observer=self.observed([error])
  with self.assertRaises(subprocess.TimeoutExpired)as seen:self.capture(observer)
  self.assertIs(seen.exception,error);self.assertEqual(observer.classified,0)
  observer=self.observed([self.failure()]);observer._base.raw_failures=observer._diagnostic.MAX_RAW_FAILURES
  with self.assertRaisesRegex(RuntimeError,'^bounded_readonly_inventory_command_required$'):self.capture(observer)
  self.assertEqual(observer.classified,0);self.assertFalse(json.loads(self.saved[-1][1])['rawPublicPeerEvidenceRetained'])
 def test_success_result_identity_and_original_arguments_environment_timeout_once(self):
  result=self.success();observer=self.observed([result]);argv=['/usr/bin/true'];env={'explicit':'same object'}
  self.assertIs(observer(argv,capture_output=True,timeout=8,env=env),result)
  self.assertIs(self.commands[0][0][0],argv);self.assertIs(self.commands[0][1]['env'],env)
  self.assertEqual(self.commands[0][1]['timeout'],8);self.assertEqual(len(self.commands),1)
  snapshot=observer.snapshot();self.assertFalse(snapshot['newRetryLoopInstalled']);self.assertFalse(snapshot['effectsRetried']);self.assertEqual(snapshot['maximumReadCaptureAttempts'],3)
  self.assertNotIn('argv',json.dumps(snapshot));self.assertNotIn('stderrBase64',json.dumps(snapshot))

if __name__=='__main__':unittest.main()
