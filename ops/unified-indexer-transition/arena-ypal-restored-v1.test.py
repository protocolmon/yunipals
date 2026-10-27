#!/usr/bin/env python3
"""Restored Arena owner/source controls. All runtime records are explicit fixtures."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
FILE=HERE/'arena-ypal-restored-v1.py'
SOURCE=HERE/'arena-ypal-restored-v1.source.py'
def imported(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=imported(FILE,'restored_arena_owner');s=imported(SOURCE,'restored_arena_source')
# Retain actual existing lifecycle/transaction/FD controls against NEW owner.
retained=types.ModuleType('retained_current_arena_controls');retained.__file__=str(HERE/'arena-ypal-native-v2.test.py')
exec(compile((HERE/'arena-ypal-native-v2.test.py').read_bytes(),retained.__file__,'exec'),retained.__dict__)
retained.m=m
class RetainedLifecycle(retained.Controls):pass
class RetainedTerminalInverse(retained.SourceTerminalInverse):pass

class SourceScope(unittest.TestCase):
 def setUp(self):
  self.tables={name:{'oid':oid,'owner':'73004621','kind':'r'}for name,oid in s.TABLES.items()}
  self.tables.update({f'fixture_{i}':{'oid':str(9000000+i),'owner':'73004621','kind':'r'}for i in range(44-len(self.tables))})
  self.native={'schemaOid':'75963410','tables':self.tables,'cache':{'fixture':'cache'}}
  self.receipt={'operatorSha256':s.RESTORE_SHA,'bootId':'recorded-fixture-boot','startIntentSha256':'a'*64}
  self.actor={'fixture':'exact-restored-invocation'}
  self.parts={'nativeIdentity':self.native,'privilegedSourcePrimitives':{'restoreReceipt':self.receipt},'sourceContext':types.SimpleNamespace(RESULT_SHA=s.RESTORE_RECEIPT)}
  self.runtime={'sourceRelease':s.RELEASE,'manifestHash':s.MANIFEST,'schema':s.SCHEMA,'schemaOid':'75963410','buildId':s.BUILD,
    'nativeTableIdentities':self.tables,'operationalRestore':{'producerSha256':s.RESTORE_SHA,'receiptSha256':s.RESTORE_RECEIPT},
    'sourceReadinessQualified':False,'currentCanonicalCoverageQualified':False,'source':self.actor}
  self.inverse={'validated':True,'restoreReceiptSha256':s.RESTORE_RECEIPT,'restoreOperatorSha256':s.RESTORE_SHA,
    'nativeIdentity':self.native,'sourceState':'terminal','sourceTerminalQualified':True,'recordedSource':self.actor,
    'frameworkReadinessQualified':False,'currentCanonicalCoverageQualified':False,'financialAuthorityQualified':False}
  self.calls=[]
  def inverse():self.calls.append('inverse');return self.inverse
  def active():self.calls.append('active');return self.runtime
  self.static=types.SimpleNamespace(query_components=lambda:self.parts,validate_inverse_runtime=inverse)
  self.current=types.SimpleNamespace(validate_runtime=active)
  self.qproof={'validated':True,'rpcScopeOnly':True,'freeOnly':True,'operatorSha256':s.QUALIFIER_SHA,
    'receiptSha256':s.QUALIFICATION_RECEIPT_SHA,'currentRPCComponentSha256':s.QUALIFICATION_COMPONENT_SHA,
    'paidAuthority':False,'historicalWholeValidatorPassed':False,'sourceActorQualified':False,'sourceReadinessQualified':False,
    'financialWriteAuthorityQualified':False,'providerCalls':0,'databaseWrites':0,'serviceActions':0}
  def rpc(ack):
   self.calls.append('rpc');self.assertEqual(ack,s.QUALIFICATION_RECEIPT_SHA)
   return copy.deepcopy(self.qproof),{'catalog':{'profile':{'enabled':True,'expires_at':'2026-11-19T00:00:00Z'}}}
  self.q=types.SimpleNamespace(qualified_rpc_components=rpc,BASE=Path('/fixture/rpc'))
  modules={s.STATIC:self.static,s.CURRENT:self.current,s.QUALIFIER:self.q}
  p=patch.object(s,'module',lambda path,digest:modules[path]);p.start();self.addCleanup(p.stop)
 def test_forward_qualifies_only_actual_restored_source_and_independent_nine_RPC(self):
  proof=s.validate_current()
  self.assertEqual(self.calls,['rpc','active','rpc']);self.assertEqual(proof['source'],self.actor)
  self.assertFalse(proof['sourceTerminal']);self.assertFalse(proof['inverseOnly']);self.assertFalse(proof['nativeReadinessQualified'])
  self.assertFalse(proof['currentWriterExclusivityQualified']);self.assertEqual(proof['sourceReceiptSha256'],s.RESTORE_RECEIPT)
 def test_inverse_terminal_never_calls_active_context_or_reports_ready(self):
  proof=s.validate_current(terminal_ok=True)
  self.assertEqual(self.calls,['rpc','inverse','rpc']);self.assertIsNone(proof['source'])
  self.assertTrue(proof['inverseOnly']);self.assertTrue(proof['sourceTerminal']);self.assertFalse(proof['sourceActorQualified'])
  self.assertFalse(proof['nativeReadinessQualified']);self.assertFalse(proof['currentCanonicalCoverageQualified'])
 def test_inverse_active_is_explicitly_inverse_only_and_exact_recorded_actor(self):
  self.inverse.update(sourceState='acknowledged-active',sourceTerminalQualified=False)
  proof=s.validate_current(terminal_ok=True);self.assertEqual(proof['source'],self.actor)
  self.assertTrue(proof['inverseOnly']);self.assertFalse(proof['sourceTerminal'])
 def test_foreign_epoch_old_c96_source_wrong_schema_or_changed_tables_refuse(self):
  for change in [lambda:self.runtime['operationalRestore'].update(receiptSha256='c96'+'0'*61),
                 lambda:self.runtime.update(schema='old_schema'),lambda:self.runtime.update(nativeTableIdentities={}),
                 lambda:self.parts['sourceContext'].__setattr__('RESULT_SHA','foreign')]:
   with self.subTest(change=change):
    original=copy.deepcopy(self.runtime);oldpin=self.parts['sourceContext'].RESULT_SHA;change()
    with self.assertRaises(RuntimeError):s.validate_current()
    self.runtime=original;self.parts['sourceContext'].RESULT_SHA=oldpin
 def test_inverse_foreign_restorer_or_claimed_readiness_refuses(self):
  for field,value in [('restoreReceiptSha256','b'*64),('sourceState','other'),('frameworkReadinessQualified',True),('currentCanonicalCoverageQualified',True)]:
   original=copy.deepcopy(self.inverse);self.inverse[field]=value
   with self.assertRaises(RuntimeError):s.validate_current(terminal_ok=True)
   self.inverse=original
 def test_wrong_RPC_component_paid_authority_or_current_change_refuses(self):
  for field,value in [('currentRPCComponentSha256','a'*64),('paidAuthority',True),('sourceActorQualified',True),('providerCalls',1)]:
   original=copy.deepcopy(self.qproof);self.qproof[field]=value
   with self.assertRaises(RuntimeError):s.validate_current()
   self.qproof=original
  calls=[0]
  def shifted(_):
   calls[0]+=1;v=copy.deepcopy(self.qproof)
   if calls[0]==2:v['fixtureChanged']=True
   return v,{'catalog':{'profile':{'enabled':True,'expires_at':'2026-11-19T00:00:00Z'}}}
  self.q.qualified_rpc_components=shifted
  with self.assertRaisesRegex(RuntimeError,'changed_during'):s.validate_current()
 def test_native44_and_nine_actual_Arena_OIDs_are_required(self):
  self.assertEqual(s.native_identity(self.native)['schemaOid'],'75963410')
  for changed in [lambda v:v.update(schemaOid='old'),lambda v:v['tables'].pop('arena_credit'),
                  lambda v:v['tables']['arena_credit'].update(oid='wrong'),lambda v:v['tables']['arena_credit'].update(owner='foreign')]:
   v=copy.deepcopy(self.native);changed(v)
   with self.assertRaises(RuntimeError):s.native_identity(v)

class OwnerSeams(unittest.TestCase):
 def test_historical_operational_bodies_and_private_SQL_remain_exact(self):
  def methods(path):
   rows={}
   for node in ast.parse(path.read_text()).body:
    if isinstance(node,ast.FunctionDef):rows[node.name]=ast.dump(node,include_attributes=False)
    if isinstance(node,ast.ClassDef):
     for f in node.body:
      if isinstance(f,ast.FunctionDef):rows[node.name+'.'+f.name]=ast.dump(f,include_attributes=False)
   return rows
  before=methods(HERE/'arena-ypal-native-v2.py');after=methods(FILE)
  self.assertEqual({name for name in before if before[name]!=after[name]}, {'validate_manifest','Host.normal','validate_phase_leaf','main'})
  self.assertNotEqual(m.BASE.name,'yunipals-arena-ypal-native-v2-20261024')
  self.assertEqual(m.ADMISSION_HELPER.name,'arena-ypal-native-v2.admission.py')
  self.assertEqual(m.AUTH_OPERATOR.name,'arena-ypal-native-v2.credentials.py')
 def test_explicit_mode_and_new_source_receipt_are_required_by_owner(self):
  h=object.__new__(m.Host);h.manifest={'files':{m.SOURCE_CONTEXT.name:'a'*64},'source':m.SOURCE_CONTEXT_VALUE}
  value={'format':s.FORMAT,'inverseOnly':False,'sourceReceiptSha256':s.RESTORE_RECEIPT,'releaseId':m.SOURCE_ID,
   'manifestHash':m.SOURCE_CONTEXT_VALUE['manifestHash'],'schemaOid':'75963410','buildId':'71e2a7f3b7',
   'originalWholeValidationPassed':False,'paidAuthority':False,'sourceTerminal':False}
  context=types.SimpleNamespace(QUALIFIER_SHA=s.QUALIFIER_SHA,QUALIFICATION_RECEIPT_SHA=s.QUALIFICATION_RECEIPT_SHA,
   validate_current=lambda **kw:value)
  h.p=types.SimpleNamespace(load=lambda *args:context)
  self.assertEqual(h.normal(),value)
  value['sourceTerminal']=True
  with self.assertRaisesRegex(m.CutoverFailure,'terminal_source'):h.normal()
  with self.assertRaisesRegex(m.CutoverFailure,'explicit_mode'):h.normal(terminal_ok=True)
  value['inverseOnly']=True;self.assertEqual(h.normal(terminal_ok=True),value)
  value['sourceReceiptSha256']='c96'+'0'*61
  with self.assertRaises(m.CutoverFailure):h.normal(terminal_ok=True)
 def test_phase_leaf_keeps_separate_source_financial_and_canonical_authority(self):
  fn=next(n for n in ast.parse(FILE.read_text()).body if isinstance(n,ast.FunctionDef)and n.name=='validate_phase_leaf')
  code=ast.unparse(fn)
  self.assertNotIn('.normal(',code);self.assertNotIn('.current_actors(',code)
  self.assertIn('yunipals-arena-ypal-restored-phase-leaf-v1',code)
  for field in ['sourceActorQualified','financialAuthorityQualified','currentCanonicalCoverageQualified']:
   self.assertIn("'"+field+"': False",code)
 def test_new_manifest_and_source_runtime_dependency_pins_are_exact(self):
  value=json.loads((HERE/'arena-ypal-restored-v1.manifest.json').read_bytes());m.validate_manifest(value)
  for name,digest in value['files'].items():self.assertEqual(hashlib.sha256((HERE/name).read_bytes()).hexdigest(),digest)
  for path,digest in [(s.STATIC,s.STATIC_SHA),(s.CURRENT,s.CURRENT_SHA),(s.QUALIFIER,s.QUALIFIER_SHA)]:
   self.assertEqual(hashlib.sha256((HERE/path.name).read_bytes()).hexdigest(),digest)
 def test_default_owner_and_source_cli_are_static_without_runtime_or_credentials(self):
  for path in [FILE,SOURCE]:
   p=subprocess.run([sys.executable,str(path)],capture_output=True,check=True)
   self.assertTrue(json.loads(p.stdout)['staticOnly'])

if __name__=='__main__':unittest.main(verbosity=2)
