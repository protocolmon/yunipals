#!/usr/bin/env python3
"""Focused current-READ observer controls; isolated fixtures, no host actions."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
FILE=HERE/'ypal-alchemy-ordinary-observer-v1.py'
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load(FILE,'current_observer_tests')
m.OLD=HERE/m.OLD.name
n=m.namespace()

def initial():
 return {'sourceRelease':n.RELEASE,'manifestHash':n.MANIFEST,'schema':n.NATIVE,'schemaOid':'75963410','buildId':n.BUILD,
  'nativeTableIdentities':{str(i):{'oid':str(i),'owner':'73004621','kind':'r'}for i in range(44)},
  'sourceEpoch':'acknowledged-alchemy-completion','intakeOnly':True,'currentWriterQualified':True,
  'sourceReadinessQualified':False,'currentCanonicalCoverageQualified':False}
def dataset(v=None):
 v=v or initial();return {**{k:v[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId']},
  'nativeTableIdentitiesSha256':n.sha(n.encoded(v['nativeTableIdentities']))}
def recorded(v=None):
 return {'validated':True,'immutableAdmissionOnly':True,'operatorSha256':m.READ_SHA,'readEdgeCount':143,
  'sourceActorQualified':False,'currentWriterQualified':False,'currentRoleGraphQualified':False,
  'planSha256':'b'*64,'contextInputSha256':'c'*64,'recordedSourceBinding':v or initial(),'catalogAfterSha256':'d'*64}

class Tests(unittest.TestCase):
 def test_default_and_file_only_constructor(self):
  p=subprocess.run([sys.executable,'-I','-B',str(FILE)],capture_output=True,check=True)
  self.assertTrue(json.loads(p.stdout)['staticOnly']);self.assertFalse(p.stderr)
  def forbidden(*_a,**_k):raise AssertionError('runtime_dependency_called_during_constructor')
  sdk=types.SimpleNamespace(command=forbidden,protected=forbidden,lock=object(),Host=types.SimpleNamespace(peer_query=forbidden))
  modules={n.READ:types.SimpleNamespace(acknowledgement=forbidden),n.STATIC:types.SimpleNamespace(query_components=forbidden),
   n.SDK:sdk,n.PEER:object(),n.INSTALLER:types.SimpleNamespace(shared=lambda:object())}
  with patch.object(n,'module',lambda p,s:modules[p]):
   h=n.Host('a'*64,m.INSTALL_ACK);self.assertIsNone(h.activation_source)
   with self.assertRaises(RuntimeError):n.Host('a'*64,'b'*64)
 def test_actual_READ_contract_and_dataset_rejects_historical_or_foreign(self):
  actual=load(HERE/'ypal-alchemy-read-admission-v1.py','actual_current_READ')
  self.assertEqual(m.sha((HERE/actual.FILE.name).read_bytes()),m.READ_SHA)
  self.assertEqual(actual.FORMAT,'yunipals-ypal-alchemy-read-admission-v1')
  ack=recorded();read=types.SimpleNamespace(FORMAT=actual.FORMAT,acknowledgement=lambda _:ack)
  self.assertEqual(n.read_acknowledgement(read,'a'*64)['initialSourceContext'],initial())
  for change in [lambda x:x.update(operatorSha256='e'*64),lambda x:x.update(readEdgeCount=142),lambda x:x.update(currentWriterQualified=True)]:
   wrong=copy.deepcopy(ack);change(wrong)
   with patch.object(read,'acknowledgement',lambda _:wrong),self.assertRaises(RuntimeError):n.read_acknowledgement(read,'a'*64)
  self.assertEqual(n.data_matches_initial(dataset(),initial()),dataset())
  for field,value in [('sourceEpoch','acknowledged-de4-original-pool5-restore'),('schemaOid','73004622'),('nativeTableIdentities',{})]:
   wrong=initial();wrong[field]=value
   with self.assertRaises(RuntimeError):n.data_matches_initial(dataset(wrong),wrong)
 def test_initial_full_graph_and_current_writer_rechecked_at_start_only(self):
  calls=[];v=initial();h=object.__new__(n.Host);h.read_ack='a'*64;h.activation_source=None
  h.read=types.SimpleNamespace(FORMAT='currentREAD',acknowledgement=lambda _:recorded(),
   validate_catalog_current=lambda _:(calls.append('catalog')or{'validated':True,'catalogOnly':True,'sourceActorQualified':False}))
  intake=types.SimpleNamespace(validate_runtime=lambda:(calls.append('writer')or copy.deepcopy(v)))
  base=n.Host.__mro__[1]
  with patch.object(n,'module',lambda p,s:intake),patch.object(base,'manager',lambda _,action:calls.append(action)):
   h.initial_source();h.manager('start');self.assertEqual(calls,['catalog','writer','catalog','writer','start'])
   v['schemaOid']='foreign'
   with self.assertRaises(RuntimeError):h.manager('start')
   h.manager('stop');self.assertEqual(calls[-1],'stop');self.assertEqual(calls.count('start'),1)
 def test_policy_lanes_are_free_and_budget_observations_are_not_actor_identity(self):
  profile=json.loads((HERE/'ypal-combined-rpc-profile-v1.json').read_text());calls=[];budget=[1]
  def policy(chain,port,workload):
   calls.append((chain,port,workload));return {'profileId':m.PROFILE_ID,'manifestHash':n.MANIFEST,'chainId':chain,
    'scope':profile['scope'],'coordinatorId':profile['coordinatorId'],'workload':workload,
    'paid':'explicit_bounded_permit_only','replay':{'mode':'free_only'},'limits':profile['limits'],'budget':{'used':budget[0]}}
  h=object.__new__(n.Host)
  with patch.object(n,'document',lambda *_:profile),patch.object(m,'preflight',policy):
   first=h.direct_routes();budget[0]=2;self.assertEqual(first,h.direct_routes());self.assertEqual(len(calls),16)
   self.assertFalse(first['currentWriterQualified']);self.assertFalse(first['routeActorQualified'])
   for changes in [{'replay':{'mode':'paid_first'}},{'paid':'always'},{'profileId':'foreign'}]:
    def bad(*args):return {**policy(*args),**changes}
    with patch.object(m,'preflight',bad),self.assertRaises(RuntimeError):h.direct_routes()
 def test_readonly_catalog_query_uses_genuine_sdk_bounds(self):
  sdk=load(HERE/'ypal-managed-handover-v1.py','actual_sdk_for_observer');seen=[]
  h=object.__new__(n.Host);h.sdk=sdk
  def command(argv,stdin=None,timeout=0):seen.append((argv,stdin,timeout));return b'{}'
  with patch.object(sdk,'command',command):self.assertEqual(h.query('SELECT jsonb_build_object()'),{})
  argv,raw,timeout=seen[0];self.assertIn('5432',argv)
  self.assertIn('PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=12000',argv)
  self.assertEqual(raw,b'BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;SET LOCAL jit=off;SELECT jsonb_build_object();ROLLBACK;')
  self.assertEqual(timeout,20)
 def test_ongoing_scope_reuses_real_body_without_initial_writer_or_wholegraph(self):
  calls=[];v=initial();ack=recorded(v);read=types.SimpleNamespace(FORMAT='currentREAD',BASE=Path('/nonexistent-observer-test'),
   acknowledgement=lambda _:(calls.append('recorded')or ack),
   validate_catalog_current=lambda _:(_ for _ in()).throw(AssertionError('old_wholegraph_called')))
  h=types.SimpleNamespace(read=read,read_ack='a'*64,install_ack=m.INSTALL_ACK,
   preserved=lambda:(calls.append('own_scope')or{'own':'exact'}))
  value={'binding':{'readAdmissionSha256':h.read_ack,'installationReceiptSha256':h.install_ack,
   'initialSourceContext':v,'dataIdentity':dataset(v),'preserved':{'own':'exact'}}}
  n.acknowledged_inputs(h,value);self.assertEqual(calls,['recorded','own_scope'])
  h.preserved=lambda:{'own':'changed'}
  with self.assertRaises(RuntimeError):n.acknowledged_inputs(h,value)
 def test_retained_real_unknown_start_reconciliation_never_dispatches_manager(self):
  calls=[];actor={'pid':123,'invocation':'c'*32};v=initial();ack=recorded(v)
  with tempfile.TemporaryDirectory(prefix='.current-observer-journal-',dir=HERE.parents[1])as temp:
   base=Path(temp);base.chmod(0o700)
   with patch.object(n,'BASE',base),patch.object(n,'boot',lambda:'synthetic-boot'):
    binding={'format':n.FORMAT,'operatorSha256':n.sha(FILE.read_bytes()),'bootId':'synthetic-boot',
     'readAdmissionSha256':'a'*64,'installationReceiptSha256':m.INSTALL_ACK,'preserved':{'exact':'before'},
     'controlRevisionsBefore':{'1':'5'},'initialSourceContext':v,'dataIdentity':dataset(v)}
    value={'binding':binding,'reviewHash':n.sha(n.encoded(binding))};n.save('before.json',value)
    unit=n.save('unit-installed.json',{'fixture':'owned'});boot=n.save('boot-installed.json',{'fixture':'owned'})
    intent={'format':n.FORMAT,'bootId':'synthetic-boot','reviewHash':value['reviewHash'],'operatorSha256':binding['operatorSha256'],
     'unitSha256':n.TEMPLATE_SHA,'unitInstalledSha256':unit,'bootInstalledSha256':boot,'earliestMonotonicUs':100,
     'latestStartMonotonicUs':135000100,'automaticRetryAllowed':False};pin=n.save('start-intent.json',intent)
    h=types.SimpleNamespace(read_ack='a'*64,install_ack=m.INSTALL_ACK,
     read=types.SimpleNamespace(FORMAT='currentREAD',BASE=base/'read',acknowledgement=lambda _:ack),
     preserved=lambda:{'exact':'before'},peer_inspect=lambda:{'providerCalls':0,'writes':0},
     control=lambda:[{'chainId':c,'revision':'6','ageMs':0}for c in [1,56,137,8453]],manager=lambda action:calls.append(action))
    with patch.object(n,'live',lambda *_:actor):result=n.reconcile(h,pin)
    self.assertTrue(result['reconciledStart']);self.assertFalse(result['sourceActorQualified']);self.assertFalse(calls)
    with self.assertRaises(RuntimeError):n.reconcile(h,pin)
 def test_all_unmodified_lifecycle_functions_and_worker_template_are_exact(self):
  old=load(HERE/m.OLD.name,'original_observer_for_comparison')
  for name in ['start','reconcile','stop','finish_stop','terminal','live','role_sql','validate_role','acknowledgement','acknowledged_inputs','validate_current']:
   self.assertEqual(getattr(n,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
  self.assertEqual(n.TEMPLATE_SHA,m.sha((HERE/n.TEMPLATE.name).read_bytes()))
  for method in ['direct_source','inputs','peer_inspect','control','state','capacity']:
   self.assertEqual(getattr(n.Host,method).__code__.co_code,getattr(old.Host,method).__code__.co_code,method)

if __name__=='__main__':unittest.main()
