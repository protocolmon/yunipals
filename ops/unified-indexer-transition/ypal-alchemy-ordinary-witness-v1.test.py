#!/usr/bin/env python3
"""Isolated wrapper controls; original witness JS and its RPC protocol unchanged."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
import urllib.request
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
FILE=HERE/'ypal-alchemy-ordinary-witness-v1.py'
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load(FILE,'ordinary_witness_tests')
RESULT='a'*64;INPUT='b'*64

def state():
 return {'stable':{'source':{'runtimeReceiptSha256':RESULT,'native':'synthetic44'},'observer':{'actor':{'pid':123,'start':456},'data':'same'}},
  'sourceObservation':{'sourceReadinessQualified':True,'progress':'first'},'controlRows':[{'chainId':c,'revision':'10','ageMs':1}for c in [1,56,137,8453]]}

class Controls(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.ordinary-witness-controls-',dir=HERE.parents[1]);self.root=Path(self.temp.name);self.root.chmod(0o700)
  self.patches=[patch.object(m,'BASE',self.root/'evidence'),patch.object(m,'program_inputs',lambda:{'programs':m.PROGRAMS,'actualProgramGuardFixture':True})]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def test_default_and_bounded_exclusive_paths_preserve_existing_evidence(self):
  p=subprocess.run([sys.executable,'-I','-B',str(FILE)],capture_output=True,check=True)
  self.assertTrue(json.loads(p.stdout)['sourceOnly']);self.assertFalse(p.stderr)
  for bad in ['','../old','/root/old','a/b','A','a'*49]:
   with self.assertRaises(RuntimeError):m.capture_path(bad)
  m.mkdir(m.BASE);base=m.BASE/'fixture';m.mkdir(base);m.save(base,'result.json',{'first':True})
  before=(base/'result.json').read_bytes()
  with self.assertRaises(FileExistsError):m.save(base,'result.json',{'foreign':True})
  self.assertEqual((base/'result.json').read_bytes(),before);self.assertEqual((base/'result.json').stat().st_mode&0o777,0o600)
  self.assertNotEqual(m.plan(base)['output'],str(m.OLD_FAILED))
 def test_exact_prior_plan_and_original_JS_pins_are_unchanged(self):
  template=json.loads((HERE/'fixed-boundary-witness-v3.plan.json.example').read_text());actual=m.plan(m.capture_path('fresh'))
  for key in template:
   if key not in ['output','candidateReportFile','candidateReportSha256']:self.assertEqual(actual[key],template[key],key)
  self.assertEqual(actual['candidateReportFile'],str(m.PARITY));self.assertEqual(actual['candidateReportSha256'],m.PARITY_SHA)
  for name,pin in m.PROGRAMS.items():self.assertEqual(m.sha((HERE/name).read_bytes()),pin,name)
  self.assertEqual(m.sha((HERE/m.INTAKE.name).read_bytes()),m.INTAKE_SHA)
  self.assertEqual(m.sha((HERE/m.OBSERVER.name).read_bytes()),m.OBSERVER_SHA)
 def fixture_run(self,base,phase,expected=None):
  calls=self.calls;calls.append(phase)
  if phase=='review':return {'reviewHash':'d'*64,'providerCallsPerformed':0,'databaseConnectionsPerformed':0,
   'binding':{'helperSha256':m.PROGRAMS[m.WITNESS.name],'plan':m.plan(base),'maximumRpcCalls':21,'maximumHttpCalls':12,'replayPermits':[]}}
  report={'format':'yunipals-ypal-fixed-boundary-witness-v3','completed':True,'reviewHash':expected,'binding':{'plan':m.plan(base)},
   'canonical':{'rpcCalls':21,'httpCalls':12,'permitHeaders':0,'retries':0,'paidDispatchPossibleWithoutPermit':False},
   'acceptance':{'qualified':True},'legacyBaselineUnchanged':True,'productionChanged':False}
  m.save(base,'witness.json',report);return {'completed':True}
 def test_actual_prepare_capture_journals_current_source_and_observer_no_resend(self):
  self.calls=[];current=state()
  def frame(*args):
   self.assertEqual(args,(RESULT,INPUT));current['controlRows'][0]['revision']=str(int(current['controlRows'][0]['revision'])+1)
   return copy.deepcopy(current)
  with patch.object(m,'frame',frame),patch.object(m,'run',self.fixture_run):
   prepared=m.prepare('ordinary-ready',RESULT,INPUT);base=m.capture_path('ordinary-ready')
   result=m.capture('ordinary-ready',prepared['reviewHash']);self.assertTrue(result['qualified']);self.assertEqual(self.calls,['review','capture'])
   self.assertTrue((base/'source-before-capture.json').exists());self.assertTrue((base/'source-after-capture.json').exists())
   self.assertEqual(m.document(base/'input.json')['runtimeResultSha256'],RESULT)
   with self.assertRaises(RuntimeError):m.capture('ordinary-ready',prepared['reviewHash'])
   self.assertEqual(self.calls,['review','capture']);self.assertFalse(result['ongoingReadinessClaimed'])
   with self.assertRaises(RuntimeError):m.prepare('ordinary-ready',RESULT,INPUT)
 def test_source_after_drift_or_unready_never_claims_qualified_and_keeps_witness(self):
  for kind in ['drift','unready','failed-after']:
   self.calls=[];calls=[]
   def frame(*_):
    calls.append(1);v=state()
    if len(calls)==4:
     if kind=='drift':v['stable']['source']['runtimeReceiptSha256']='f'*64
     elif kind=='unready':v['sourceObservation']['sourceReadinessQualified']=False
     else:raise RuntimeError('actual_current_refusal')
    return v
   with self.subTest(kind=kind),patch.object(m,'frame',frame),patch.object(m,'run',self.fixture_run):
    prepared=m.prepare(kind,RESULT,INPUT);base=m.capture_path(kind)
    if kind=='unready':self.assertFalse(m.capture(kind,prepared['reviewHash'])['qualified'])
    else:
     with self.assertRaises(RuntimeError):m.capture(kind,prepared['reviewHash'])
     self.assertFalse((base/'result.json').exists())
    self.assertTrue((base/'capture-intent.json').exists());self.assertTrue((base/'witness.json').exists())
    with self.assertRaises(RuntimeError):m.capture(kind,prepared['reviewHash'])
    self.assertEqual(self.calls.count('capture'),1)
 def test_real_frame_uses_current_observer_and_actual_control_rows_not_seeded(self):
  tables={str(i):{'oid':str(i),'owner':'73004621','kind':'r'}for i in range(44)}
  intake=load(HERE/m.INTAKE.name,'real_ordinary_intake_for_witness');data={**intake.DATA,'nativeTableIdentities':tables}
  source={'binding':data,'observation':{'sourceReadinessQualified':True}}
  identity={k:data[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId']};identity['nativeTableIdentitiesSha256']=m.sha(m.encoded(tables))
  current={'validated':True,'observerCurrentQualified':True,'receiptSha256':m.OBSERVER_ACK,'operatorSha256':m.OBSERVER_SHA,
   'dataIdentity':identity,'sourceActorQualified':False,'currentWriterQualified':False,'paidAuthority':False,'actor':{'pid':123},
   'initialSourceContext':{'historical':'70f'},'bootLink':{'owned':True},'readOnlyInspect':{'writes':0}}
  rows=[{'chainId':c,'revision':'5','ageMs':10,'row':{'release_id':data['sourceRelease'],'chain_id':c,'halted':False,'actualAnchor':'retained'}}for c in [1,56,137,8453]]
  calls=[]
  def query(sql):calls.append(sql);return copy.deepcopy(rows)
  host=types.SimpleNamespace(query=query)
  n=types.SimpleNamespace(BASE=Path('/fixture/observer'),document=lambda *_:{'readAdmissionSha256':'c'*64,'installationReceiptSha256':'d'*64},Host=lambda *_:host)
  def gets(count):
   for _ in range(count):urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1/fixture')
  observer=types.SimpleNamespace(validate_current=lambda s:(gets(16)or copy.deepcopy(current)),namespace=lambda:n)
  runtime=types.SimpleNamespace(observe_runtime=lambda *args:(gets(2)or copy.deepcopy(source)))
  dispatched=[]
  def opened(*args,**kwargs):dispatched.append(1);return object()
  base=self.root/'frame';m.mkdir(base)
  with patch.object(m,'module',lambda p,s:runtime if p==m.INTAKE else observer),patch.object(urllib.request.OpenerDirector,'open',opened):
   v=m.measured_frame(base,'before-review',RESULT,INPUT);self.assertEqual(v['contextHttp']['httpGetAttempts'],18)
   self.assertEqual(v['contextHttp']['httpGetDispatches'],18);self.assertEqual(len(dispatched),18)
   self.assertIs(urllib.request.OpenerDirector.open,opened)
   self.assertEqual(m.document(base/'before-review-context-http.json')['httpGetAttempts'],18)
   self.assertEqual(v['controlRows'],rows);self.assertIn('to_jsonb(s)',calls[0]);self.assertIn('SELECT',calls[0]);self.assertNotIn('UPDATE',calls[0])
   for change in [lambda:rows.pop(),lambda:rows[0].update(ageMs=180001),lambda:current.update(currentWriterQualified=True),lambda:current['dataIdentity'].update(schemaOid='foreign')]:
    saved_rows,saved_current=copy.deepcopy(rows),copy.deepcopy(current);change()
    with self.assertRaises(RuntimeError):m.frame(RESULT,INPUT)
    rows[:]=saved_rows;current.clear();current.update(saved_current)
 def test_child_is_exact_old_command_clean_environment_and_private_logs(self):
  m.mkdir(m.BASE);base=m.BASE/'child';m.mkdir(base);seen=[]
  class Child:
   pid=1234;returncode=0
   def __init__(self,argv,**kwargs):seen.append((argv,kwargs))
   def communicate(self,timeout):return b'{"reviewHash":"fixture"}\n',b''
  with patch.object(m.subprocess,'Popen',Child):out=m.run(base,'review')
  self.assertEqual(out,{'reviewHash':'fixture'});argv,kwargs=seen[0]
  self.assertEqual(argv,[str(m.NODE),'--import',str(m.LOADER),str(m.WITNESS),'--plan',str(base/'plan.json')])
  self.assertEqual(set(kwargs['env']),{'PATH','LANG','TZ','NODE_NO_WARNINGS','PGPASSFILE'})
  self.assertTrue(kwargs['start_new_session']);self.assertEqual(kwargs['cwd'],'/')
  self.assertTrue((base/'review-stdout.log').exists());self.assertEqual((base/'review-stdout.log').stat().st_mode&0o777,0o600)

 def test_failed_get_counts_are_persisted_and_instrumentation_is_restored(self):
  base=self.root/'failed-get';m.mkdir(base);calls=[]
  def opened(*args,**kwargs):calls.append(1);raise OSError('synthetic_transport_failure')
  def failed_frame(*_):urllib.request.build_opener().open('http://127.0.0.1/private-fixture-path')
  with patch.object(urllib.request.OpenerDirector,'open',opened),patch.object(m,'frame',failed_frame):
   with self.assertRaises(OSError):m.measured_frame(base,'after-capture',RESULT,INPUT)
   self.assertIs(urllib.request.OpenerDirector.open,opened)
   with self.assertRaises(RuntimeError):m.measured_frame(base,'after-capture',RESULT,INPUT)
  value=m.document(base/'after-capture-context-http.json')
  self.assertEqual(value['httpGetAttempts'],1);self.assertEqual(value['httpGetDispatches'],1);self.assertFalse(value['completed'])
  self.assertEqual(value['errorClass'],'OSError');self.assertEqual(len(calls),1)
  self.assertNotIn('private-fixture-path',(base/'after-capture-context-http.json').read_text())

 def test_context_get_cap_and_non_get_or_body_refuse_before_dispatch(self):
  for kind in ['cap','post','body']:
   base=self.root/kind;m.mkdir(base);calls=[]
   def opened(*args,**kwargs):calls.append(1);return object()
   def requests(*_):
    opener=urllib.request.build_opener()
    if kind=='cap':
     for _ in range(3):opener.open(fullurl='http://127.0.0.1/fixture')
    elif kind=='post':opener.open(urllib.request.Request('http://127.0.0.1/fixture',data=b'body'))
    else:opener.open(urllib.request.Request('http://127.0.0.1/fixture',method='GET'),data=b'body')
   with self.subTest(kind=kind),patch.object(m,'MAX_CONTEXT_GETS',2),patch.object(urllib.request.OpenerDirector,'open',opened),patch.object(m,'frame',requests):
    with self.assertRaises(RuntimeError):m.measured_frame(base,'before-review',RESULT,INPUT)
    self.assertIs(urllib.request.OpenerDirector.open,opened)
   value=m.document(base/'before-review-context-http.json');self.assertFalse(value['completed'])
   self.assertEqual(len(calls),2 if kind=='cap'else 0)
   if kind=='cap':self.assertEqual(value['httpGetAttempts'],3);self.assertEqual(value['httpGetDispatches'],2)
   elif kind=='post':self.assertEqual(value['nonGetAttempts'],1)
   else:self.assertEqual(value['bodyBearingGetAttempts'],1)

if __name__=='__main__':unittest.main()
