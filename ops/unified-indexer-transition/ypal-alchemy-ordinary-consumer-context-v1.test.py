#!/usr/bin/env python3
"""Six isolated intake controls; no actual future runtime/admission ACK claimed."""
import copy
import importlib.util
import inspect
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
FILE=HERE/'ypal-alchemy-ordinary-consumer-context-v1.py'
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load(FILE,'ordinary_intake_test')
RESULT='a'*64;INPUT='b'*64;READ_RESULT='c'*64

def fixture():
 actor={'unit':{'Id':m.UNIT,'InvocationID':'synthetic-owned-epoch'},'parent':{'pid':123,'startTicks':456},'processes':[{'pid':123,'startTicks':456}]}
 tables={str(i):{'oid':str(i),'owner':'73004621','kind':'r'}for i in range(44)}
 native={'schemaOid':m.DATA['schemaOid'],'tables':tables,'cache':{'schemaOid':'synthetic-same-cache'},'buildId':m.DATA['buildId']}
 binding={'format':'yunipals-alchemy-ordinary-runtime-v1','operatorSha256':m.RUNTIME_SHA,'inputSha256':INPUT,
  'source':actor,'nativeIdentity':native,'financialReceiptSha256':'d'*64,'ordinaryPolicy':{'sourceDailyLimitCu':1500000},'routingMode':'paid'}
 value={'validated':True,'currentWriterQualified':True,'terminalInverseOnly':False,'sourceState':'acknowledged-active',
  'receiptSha':RESULT,'inputSha256':INPUT,'operatorSha256':m.RUNTIME_SHA,'financialAuthorityQualified':False,
  **{k:m.DATA[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId']},
  'sourceKernelActors':{m.UNIT:actor},'binding':binding,'bindingSha256':m.sha(m.encoded(binding)),
  'nativeTables':tables,'routingMode':'paid','managedHandoverAllowed':False,'ordinaryFinancialClosed':False,
  'chainRouting':{'ethereum':'paid_primary','base':'paid_primary','polygon':'paid_primary','bnb':'paid_logs_free_blocks'},
  'sourceReadinessQualified':True,'observation':{'native':{'clock':1,'heartbeat':2,'complete':'first'},'positiveKernelSessions':3}}
 data={'format':m.FORMAT+'-query-components','dataIdentity':{**m.DATA,'nativeTableIdentities':tables,
  'syncCacheIdentity':native['cache'],'registeredDataSha256':'e'*64}}
 runtime=types.SimpleNamespace(validate_current_source=lambda *_a,**_k:copy.deepcopy(value))
 return runtime,value,data

def observe(runtime,data):
 with patch.object(m,'module',lambda path,pin:runtime),patch.object(m,'query_components',lambda:copy.deepcopy(data)):
  return m.observe_runtime(RESULT,INPUT)

class Controls(unittest.TestCase):
 def test_default_and_real_protected_loader_reject_changed_or_linked_bytes(self):
  p=subprocess.run([sys.executable,'-I','-B',str(FILE)],capture_output=True,check=True)
  self.assertTrue(json.loads(p.stdout)['sourceOnly']);self.assertFalse(p.stderr)
  with tempfile.TemporaryDirectory(prefix='.ordinary-intake-loader-',dir=HERE.parents[1])as temp:
   path=Path(temp)/'public.py';path.write_bytes(b'value=1\n');pin=m.sha(path.read_bytes())
   self.assertEqual(m.module(path,pin).value,1);path.write_bytes(b'value=2\n')
   with self.assertRaises(RuntimeError):m.module(path,pin)
   link=Path(temp)/'linked.py';link.symlink_to(path)
   with self.assertRaises(RuntimeError):m.module(link,m.sha(path.read_bytes()))
 def test_real_runtime_contract_and_actual_refs_preserve_standalone_financial_boundary(self):
  actual=load(HERE/m.RUNTIME.name,'actual_ordinary_runtime')
  self.assertEqual(m.sha((HERE/m.RUNTIME.name).read_bytes()),m.RUNTIME_SHA)
  self.assertEqual(list(inspect.signature(actual.validate_current_source).parameters),['result_sha','input_sha','retained_current','inverse'])
  runtime,value,data=fixture();calls=[]
  def leaf(result_sha,input_sha,retained_current=None):calls.append((result_sha,input_sha,retained_current));return copy.deepcopy(value)
  runtime.validate_current_source=leaf;out=observe(runtime,data);binding=out['binding']
  self.assertEqual(calls,[(RESULT,INPUT,None)]*2);self.assertEqual(binding['sourceKind'],'standalone')
  self.assertFalse(binding['managedHandoverAllowed']);self.assertFalse(binding['financialAuthorityQualified']);self.assertNotIn('currentManagedEpoch',binding)
  value.update(routingMode='free',managedHandoverAllowed=True,ordinaryFinancialClosed=True)
  value['binding']['routingMode']='free';value['bindingSha256']=m.sha(m.encoded(value['binding']))
  self.assertTrue(observe(runtime,data)['binding']['managedHandoverAllowed'])
  for bad in [None,'','0'*64,'not-a-result']:
   with self.assertRaises(RuntimeError):m.observe_runtime(bad,INPUT)
 def test_progress_separated_and_only_exact_kernel_pool_error_retries(self):
  runtime,value,data=fixture();first=observe(runtime,data)
  value['observation'].update(native={'clock':2,'heartbeat':3,'complete':'advanced'},positiveKernelSessions=6);value['sourceReadinessQualified']=False
  second=observe(runtime,data);self.assertEqual(first['binding'],second['binding']);self.assertNotEqual(first['observation'],second['observation'])
  calls=[]
  def transient(*args,**kwargs):
   calls.append(1)
   if len(calls)==1:raise RuntimeError(m.RETRY)
   return copy.deepcopy(value)
  runtime.validate_current_source=transient
  with patch.object(m.time,'sleep',lambda _:None):out=observe(runtime,data)
  self.assertEqual(len(calls),3);self.assertEqual(out['observation']['currentLeafAttemptsBefore'][0]['fixedCode'],m.RETRY)
  runtime.validate_current_source=lambda *_a,**_k:(_ for _ in()).throw(RuntimeError('different_bounded_failure'))
  with patch.object(m.time,'sleep',side_effect=AssertionError('wrong_retry')),self.assertRaises(RuntimeError):observe(runtime,data)
 def test_foreign_runtime_receipt_input_managed_alias_and_native_drift_refuse(self):
  changes=[lambda v,d:v.update(receiptSha='f'*64),lambda v,d:v.update(inputSha256='f'*64),lambda v,d:v.update(operatorSha256='f'*64),
   lambda v,d:v.update(currentManagedEpoch={'fake':True}),lambda v,d:v.update(managedHandoverAllowed=True),
   lambda v,d:v['binding']['source']['unit'].update(Id='yunipals-indexer.service'),
   lambda v,d:d['dataIdentity'].update(syncCacheIdentity={'schemaOid':'foreign'}),
   lambda v,d:d['dataIdentity']['nativeTableIdentities']['0'].update(oid='foreign')]
  for change in changes:
   runtime,value,data=fixture();data=copy.deepcopy(data);change(value,data)
   with self.subTest(change=change),self.assertRaises(RuntimeError):observe(runtime,data)
  runtime,value,data=fixture();seen=[]
  def changed(*_a,**_k):
   seen.append(1);v=copy.deepcopy(value)
   if len(seen)==2:v['binding']['source']['parent']['startTicks']+=1;v['bindingSha256']=m.sha(m.encoded(v['binding']))
   return v
  runtime.validate_current_source=changed
  with self.assertRaises(RuntimeError):observe(runtime,data)
 def test_actual_fbb_components_and_full_registered_twelve_source_read_marker(self):
  actual=load(HERE/m.STATIC.name,'actual_static_query_helpers')
  self.assertEqual(m.sha((HERE/m.STATIC.name).read_bytes()),m.STATIC_SHA)
  self.assertTrue(callable(actual.query_components));runtime,value,data=fixture()
  manifest={'sources':[{'id':'source-'+str(i),'chainId':8453,'fixture':i}for i in range(12)]}
  registered={'registered':True,'releaseId':m.DATA['sourceRelease'],'manifestHash':m.DATA['manifestHash'],
   'sourceReceiptSha256':m.REGISTERED_SOURCE_ANCESTOR,'activeReleaseChanged':False}
  created={'created':True,'selected':False,'readSchema':m.DATA['readSchema'],'readIdentity':m.DATA['readIdentity'],
   'sourceRelease':m.DATA['sourceRelease'],'target':{'schemaOid':m.DATA['readSchemaOid'],'marker':{'identity':'fixture-original'}}}
  documents={m.REGISTERED:registered,m.PROFILE:{'manifest':manifest},m.READ_CREATED:created}
  query_value={'registered':{'id':m.DATA['sourceRelease'],'schema':m.DATA['schema'],'build':m.DATA['buildId'],'manifestHash':m.DATA['manifestHash'],'manifest':manifest},
   'sources':sorted([{'id':r['id'],'chainId':r['chainId'],'manifestHash':m.DATA['manifestHash'],'definition':r}for r in manifest['sources']],key=lambda r:r['id']),
   'readSchemaOid':m.DATA['readSchemaOid'],'marker':created['target']['marker']}
  seen=[]
  def query(sql):seen.append(sql);return copy.deepcopy(query_value)
  parts={'sourceActorQualified':False,'financialAuthorityQualified':False,'historicalReadPlan':{'missingCount':143},
   'nativeIdentity':value['binding']['nativeIdentity'],'readerHost':types.SimpleNamespace(query=query)}
  static=types.SimpleNamespace(query_components=lambda:parts,validate_runtime=lambda:(_ for _ in()).throw(AssertionError('old_active_called')))
  with patch.object(m,'module',lambda p,s:static),patch.object(m,'document',lambda path,pin:copy.deepcopy(documents[path])):
   out=m.query_components();self.assertEqual(len(out['dataIdentity']['nativeTableIdentities']),44);self.assertFalse(out['currentWriterQualified'])
   self.assertIn('.indexer_source',seen[0]);self.assertIn('._unified_read_release',seen[0])
   for kind in ['registered','source','marker','oid']:
    wrong=copy.deepcopy(query_value)
    if kind=='registered':wrong['registered']['build']='foreign'
    elif kind=='source':wrong['sources'][0]['definition']['fixture']='foreign'
    elif kind=='marker':wrong['marker']={'identity':'foreign'}
    else:wrong['readSchemaOid']='foreign'
    parts['readerHost'].query=lambda _,v=wrong:v
    with self.assertRaises(RuntimeError):m.query_components()
 def test_actual_c2da_ack_and_current_catalog_are_separate_source_free_leaves(self):
  actual=load(HERE/m.READ.name,'actual_current_read_for_ordinary')
  self.assertEqual(m.sha((HERE/m.READ.name).read_bytes()),m.READ_SHA)
  initial={**m.DATA,'nativeTableIdentities':fixture()[1]['nativeTables'],'sourceEpoch':'acknowledged-alchemy-completion'}
  ack={'validated':True,'immutableAdmissionOnly':True,'receiptSha256':READ_RESULT,'operatorSha256':m.READ_SHA,'readEdgeCount':143,
   'recordedSourceBinding':initial,'sourceActorQualified':False,'currentWriterQualified':False,'currentRoleGraphQualified':False}
  graph={'validated':True,'catalogOnly':True,'receiptSha256':READ_RESULT,'operatorSha256':m.READ_SHA,'readEdgeCount':143,
   'sourceActorQualified':False,'sourceReadinessQualified':False,'financialAuthorityQualified':False}
  calls=[];read=types.SimpleNamespace(acknowledgement=lambda s:(calls.append('recorded')or copy.deepcopy(ack)),
   validate_catalog_current=lambda s:(calls.append('catalog')or copy.deepcopy(graph)),
   validate_current=lambda *_:(_ for _ in()).throw(AssertionError('old_initial_writer_called')))
  with patch.object(m,'module',lambda p,s:read):
   self.assertEqual(m.read_acknowledgement(READ_RESULT),ack);self.assertEqual(calls,['recorded'])
   self.assertEqual(m.read_catalog_current(READ_RESULT),graph);self.assertEqual(calls,['recorded','recorded','catalog'])
   for change in [lambda a,g:a.update(operatorSha256='f'*64),lambda a,g:a['recordedSourceBinding'].update(schemaOid='foreign'),
                  lambda a,g:g.update(sourceActorQualified=True)]:
    saved_a,saved_g=copy.deepcopy(ack),copy.deepcopy(graph);change(ack,graph)
    with self.assertRaises(RuntimeError):m.read_catalog_current(READ_RESULT)
    ack.clear();ack.update(saved_a);graph.clear();graph.update(saved_g)

if __name__=='__main__':unittest.main()
