#!/usr/bin/env python3
"""Local recorded-chain/constructor/lifecycle tests; no production authority."""
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
ROOT=HERE.parents[1]
FILE=HERE/'ypal-restored-ordinary-observer-v1.py'
spec=importlib.util.spec_from_file_location('restored_observer',FILE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def initial():
 return {'sourceRelease':m.RELEASE,'manifestHash':m.MANIFEST,'schema':m.NATIVE,'schemaOid':'75963410','buildId':m.BUILD,
  'nativeTableIdentities':{str(i):{'oid':str(i),'owner':'73004621','kind':'r'}for i in range(44)},
  'sourceEpoch':'acknowledged-de4-original-pool5-restore','sourceReadinessQualified':False,'currentCanonicalCoverageQualified':False}

def dataset(v=None):
 v=v or initial()
 return {**{k:v[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId']},
  'nativeTableIdentitiesSha256':m.sha(m.encoded(v['nativeTableIdentities']))}

# Re-execute the unchanged local lifecycle controls against the new owner,
# with explicit new immutable-ancestry fixtures for the changed proof seam.
retained=types.ModuleType('retained_restored_observer_tests')
retained.__file__=str(HERE/'ypal-combined-ordinary-observer-owner-v1.test.py')
source=(HERE/'ypal-combined-ordinary-observer-owner-v1.test.py').read_text()
source=source.replace("ypal-combined-ordinary-observer-owner-v1.py",FILE.name)
source=source.replace("ypal-combined-ordinary-observer-serving-v1.service.example",'ypal-restored-ordinary-observer-v1.service.example')
exec(compile(source,retained.__file__,'exec'),retained.__dict__)
retained.m=m
class RetainedLifecycle(retained.Tests):
 def setUp(self):
  super().setUp()
  self.value['binding'].update({'initialSourceContext':initial(),'dataIdentity':dataset()})
  self.value['reviewHash']=m.sha(m.encoded(self.value['binding']))
  for name in ['before.json','start-intent.json']:(m.BASE/name).unlink()
  m.save('before.json',self.value)
  self.intent['reviewHash']=self.value['reviewHash'];self.intent_sha=m.save('start-intent.json',self.intent)
 def host(self):
  h,calls=super().host();h.read.BASE=self.base/'read'
  def recorded(*_):
   calls.append('immutable_admission');return {'initialSourceContext':initial()}
  self.patches.append(patch.object(m,'read_acknowledgement',recorded));self.patches[-1].start()
  return h,calls

class NewScope(unittest.TestCase):
 def test_constructor_is_file_only_and_terminal_stop_does_not_require_DB(self):
  calls=[]
  def forbidden(*_a,**_k):raise AssertionError('runtime_or_query_constructed')
  sdk=types.SimpleNamespace(command=lambda *a,**k:b'',protected=forbidden,lock=object(),Host=type('H',(),{'query':forbidden}))
  modules={m.READ:types.SimpleNamespace(validate_current=forbidden,Host=forbidden),
   m.STATIC:types.SimpleNamespace(query_components=forbidden),m.SDK:sdk,m.PEER:object(),
   m.INSTALLER:types.SimpleNamespace(shared=lambda:object(),installed=forbidden)}
  with patch.object(m,'module',lambda p,s:(calls.append((p,s))or modules[p])):
   h=m.Host('a'*64,'b'*64)
  self.assertEqual(len(calls),5);self.assertIs(h.source.transition_lock,sdk.lock)
  self.assertIs(h.m.run,sdk.command);self.assertFalse(hasattr(h,'source_ack'))
 def test_logical_identity_rejects_any_other_dataset_without_claiming_writer(self):
  v=initial();self.assertEqual(m.data_matches_initial(dataset(v),v),dataset(v))
  for field in ['sourceRelease','manifestHash','schema','schemaOid','buildId','nativeTableIdentitiesSha256']:
   wrong=dataset(v);wrong[field]='foreign'
   with self.assertRaises(RuntimeError):m.data_matches_initial(wrong,v)
 def test_template_can_outlive_a_writer_transition_and_remains_hardened(self):
  raw=(HERE/'ypal-restored-ordinary-observer-v1.service.example').read_bytes()
  self.assertEqual(m.sha(raw),m.TEMPLATE_SHA)
  for forbidden in [b'PartOf=',b'BindsTo=',b'Requisite=',b'yunipals-ypal-combined-source.service']:
   self.assertNotIn(forbidden,raw)
  for required in [b'After=network-online.target postgresql.service',b'IPAddressDeny=any',b'Restart=no',b'NoNewPrivileges=yes']:
   self.assertIn(required,raw)
 def test_default_cli_is_static_and_does_not_construct_Host(self):
  p=subprocess.run([sys.executable,str(FILE)],capture_output=True,check=True)
  v=json.loads(p.stdout);self.assertTrue(v['staticOnly']);self.assertFalse(v['currentWriterQualified'])
 def test_recorded_ack_has_no_live_source_DB_or_boot_guard(self):
  tree=ast.parse(FILE.read_text())
  for name in ['acknowledgement','read_acknowledgement']:
   fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name==name)
   code=ast.unparse(fn)
   for forbidden in ['boot()', 'Host(', '.query(', '.query_components(', 'validate_current(', 'owned_result(', 'live(', '.state(']:
    self.assertNotIn(forbidden,code)
 def test_operational_bodies_reused_only_new_explicit_seams(self):
  def bodies(path):
   rows={}
   for n in ast.parse(path.read_text()).body:
    if isinstance(n,ast.FunctionDef):rows[n.name]=ast.dump(n,include_attributes=False)
    if isinstance(n,ast.ClassDef):
     for f in n.body:
      if isinstance(f,ast.FunctionDef):rows[n.name+'.'+f.name]=ast.dump(f,include_attributes=False)
   return rows
  old=bodies(HERE/'ypal-combined-ordinary-observer-owner-v1.py');new=bodies(FILE)
  seams={'Host.__init__','Host.query','Host.direct_source','Host.direct_routes','Host.state','review','acknowledged_inputs','unit_definition','acknowledge','validate_current','main'}
  self.assertEqual({n for n in old if old[n]!=new[n]},seams)
  for name in ['start','reconcile','stop','finish_stop','terminal','live','role_sql','validate_role','first_cycle_complete']:
   self.assertEqual(old[name],new[name])

class RecordedChain(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.restored-observer-ack-',dir=ROOT)
  self.base=Path(self.temp.name);self.readbase=self.base/'read';self.readbase.mkdir()
  self.planpath=self.readbase/'plan.json';self.inputpath=self.readbase/'input.json'
  self.read=types.SimpleNamespace(FORMAT='yunipals-ypal-restored-read-admission-v1',BASE=self.readbase,
    PLAN=self.planpath,CONTEXT=Path('/fixture/context.py'),CONTEXT_SHA='c'*64,document=m.document)
  self.context=types.SimpleNamespace(INPUT=self.inputpath)
  self.patches=[patch.object(m,'BASE',self.base/'observer'),patch.object(m,'module',lambda p,s:self.read if p==m.READ else self.context)]
  for p in self.patches:p.start()
  m.BASE.mkdir()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def write(self,p,v):
  p.write_bytes(m.encoded(v));p.chmod(0o600);return m.sha(p.read_bytes())
 def chain(self):
  f=self.read.FORMAT;s=m.READ_SHA;bo='recorded-boot-that-is-not-current';ctxsha=self.write(self.inputpath,{'fixture':'explicit-input'})
  stable={'runtime':initial()};cat={'fixture':'before'}
  plan={'format':f+'-plan','operatorSha256':s,'bootId':bo,'contextInputSha256':ctxsha,'missingCount':143,
    'missingPermissions':[{'fixture':i}for i in range(143)],'newRoles':0,'loginChanges':0,'newDml':0,'catalogBefore':cat,'stable':stable}
  plan['planReviewHash']=m.sha(m.encoded(plan));plansha=self.write(self.planpath,plan)
  before={'format':f,'operatorSha256':s,'bootId':bo,'planSha256':plansha,'contextInputSha256':ctxsha,'catalogBefore':cat,'stable':stable}
  before['reviewHash']=m.sha(m.encoded(before));bs=self.write(self.readbase/'before.json',before)
  rh={'format':f,'operatorSha256':s,'rehearsed':True,'databaseCommitted':False,'reviewHash':before['reviewHash'],'beforeSha256':bs,'after':{'fixture':'after'}}
  rs=self.write(self.readbase/'rehearsed.json',rh)
  intent={'format':f,'operatorSha256':s,'bootId':bo,'planSha256':plansha,'contextInputSha256':ctxsha,'reviewHash':before['reviewHash'],
   'rehearsalSha256':rs,'postgraphSha256':m.sha(m.encoded(rh['after'])),'automaticRetryAllowed':False}
  ins=self.write(self.readbase/'commit-intent.json',intent)
  r={'format':f,'operatorSha256':s,'admitted':True,'bootId':bo,'planSha256':plansha,'contextInputSha256':ctxsha,'reviewHash':before['reviewHash'],
   'beforeSha256':bs,'rehearsalSha256':rs,'commitIntentSha256':ins,'catalogAfterSha256':intent['postgraphSha256'],
   'commitOutcome':'commit_confirmed','readEdgeCount':143,'loginChanges':0,'newDml':0,'serviceActions':0,'originalWholeValidatorPassed':False,'sourceReadinessQualified':False}
  ack=self.write(self.readbase/'result.json',r)
  return ack,r
 def observer(self):
  ra,_=self.chain();proof=m.read_acknowledgement(self.read,ra)
  b={'format':m.FORMAT,'operatorSha256':m.sha(FILE.read_bytes()),'bootId':'recorded-boot-that-is-not-current','readAdmissionSha256':ra,
   'installationReceiptSha256':'b'*64,'initial143QualificationSha256':m.sha(m.encoded(proof['qualificationAtActivation'])),
   'initialSourceContext':initial(),'dataIdentity':dataset(),'preserved':{'source':{'dataIdentity':dataset()}},
   'runtimeMaximumSeconds':None,'automaticRestart':False,'bootEnablement':True,'ordinarySustainedObserver':True,
   'currentWriterQualifiedByObserver':False,'poolMaximum':2,'controlRevisionsBefore':{str(c):'0'for c in [1,56,137,8453]}}
  value={'binding':b,'reviewHash':m.sha(m.encoded(b))};self.write(m.BASE/'before.json',value)
  unit={'reviewHash':value['reviewHash'],'sha256':m.TEMPLATE_SHA,'identity':{'fixture':'unit'}}
  link={'reviewHash':value['reviewHash'],'bootId':b['bootId'],'path':str(m.BOOT),'target':str(m.UNIT_FILE),'identity':{'fixture':'boot'}}
  us=self.write(m.BASE/'unit-installed.json',unit);ls=self.write(m.BASE/'boot-installed.json',link)
  intent={'format':m.FORMAT,'operatorSha256':b['operatorSha256'],'bootId':b['bootId'],'reviewHash':value['reviewHash'],
   'unitSha256':m.TEMPLATE_SHA,'unitInstalledSha256':us,'bootInstalledSha256':ls,'earliestMonotonicUs':100,'latestStartMonotonicUs':135000100,'automaticRetryAllowed':False}
  ins=self.write(m.BASE/'start-intent.json',intent)
  result={'format':m.FORMAT,'completed':True,'operatorSha256':b['operatorSha256'],'bootId':b['bootId'],'reviewHash':value['reviewHash'],
   'startIntentSha256':ins,'readAdmissionSha256':ra,'installationReceiptSha256':'b'*64,'observerScopeOnly':True,'ordinarySustainedObserver':True,
   'observationLoopEntered':True,'bootEnabled':True,'original143CurrentWholeValidatorPassed':False,'readerSelectionsQualified':False,
   'sourceCoverageAccepted':False,'sourceActorQualified':False,'currentWriterQualified':False,'paidAuthority':False,'receiptHistoryEnabled':False,
   'sourceOrConsumerMutations':0,'freeOnly':True,'dataIdentity':dataset(),'initialSourceContext':initial(),
   'firstCycleControl':[{'chainId':c,'revision':'1','ageMs':0}for c in [1,56,137,8453]]}
  return self.write(m.BASE/'result.json',result),result
 def test_recorded_READ_chain_does_not_consult_current_epoch_or_database(self):
  ack,r=self.chain()
  with patch.object(m,'boot',side_effect=AssertionError('live_boot_called')):
   proof=m.read_acknowledgement(self.read,ack)
  self.assertEqual(proof['initialSourceContext'],initial());self.assertFalse(proof['currentWriterQualified'])
 def test_READ_chain_rejects_replaced_rehearsal_or_wrong_producer(self):
  ack,r=self.chain();self.write(self.readbase/'rehearsed.json',{'fixture':'foreign'})
  with self.assertRaises(RuntimeError):m.read_acknowledgement(self.read,ack)
 def test_pure_observer_ACK_after_different_writer_or_stop_has_no_current_claim(self):
  ack,_=self.observer();self.write(m.BASE/'stop-intent.json',{'fixture':'stopped-later'})
  with patch.object(m,'boot',side_effect=AssertionError('live_epoch_called')),patch.object(m,'Host',side_effect=AssertionError('Host_constructed')):
   proof=m.acknowledgement(ack)
  self.assertTrue(proof['recordedActivationQualified']);self.assertFalse(proof['observerCurrentQualified']);self.assertFalse(proof['currentWriterQualified'])
 def test_observer_ACK_rejects_relabelled_writer_authority_and_changed_data(self):
  ack,result=self.observer()
  for field,value in [('currentWriterQualified',True),('sourceActorQualified',True),('dataIdentity',{**dataset(),'schemaOid':'other'})]:
   changed={**result,field:value};bad=self.write(m.BASE/'result.json',changed)
   with self.assertRaises(RuntimeError):m.acknowledgement(bad)
 def test_current_validator_runs_live_scope_and_never_accepts_changed_dataset(self):
  ack,_=self.observer()
  with patch.object(m,'owned_result',side_effect=RuntimeError('current_epoch_required')):
   with self.assertRaisesRegex(RuntimeError,'current_epoch_required'):m.validate_current(ack)

if __name__=='__main__':unittest.main(verbosity=2)
