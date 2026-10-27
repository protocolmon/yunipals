#!/usr/bin/env python3
"""V5 creator context + genuine reused owner SQL/lifecycle controls."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
FILE=HERE/'ypal-ordinary-readview-v5.py'
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);return v
m=load(FILE,'ordinary_V5_creator_tests');real=load(HERE/m.INTAKE.name,'genuine_current_intake_for_V5')
CONFIG={'format':m.FORMAT+'-input','ordinaryRuntime':{'resultSha256':'1'*64,'inputSha256':'2'*64},'readAdmissionSha256':'3'*64}

class Controls(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.V5-creator-controls-',dir=HERE.parents[1]);self.root=Path(self.temp.name);self.root.chmod(0o700)
  self.base=self.root/'operation';self.patches=[patch.object(m,'BASE',self.base)];self.current={};self.calls=[]
  for p in self.patches:p.start()
  def save(path,value,*args):
   path=Path(path);raw=value if isinstance(value,bytes)else m.encoded(value)
   with path.open('xb')as f:os.fchmod(f.fileno(),0o600);f.write(raw)
   return m.sha(raw)
  self.s=types.SimpleNamespace(protected=lambda p,*_:Path(p).read_bytes(),document=lambda p,*_:json.loads(Path(p).read_bytes()),
   save=save,sync=lambda _:None,boot=lambda:'same-boot')
  self.parts={'privilegedSourcePrimitives':{'sdk':types.SimpleNamespace(command=lambda *a,**k:b'{}',protected=self.s.protected),'host':types.SimpleNamespace(s=self.s)},
   'readerHost':types.SimpleNamespace(query=lambda _:copy.deepcopy(self.current))}
  def protected(path,pin):
   path=Path(path);local=path if path.exists()else HERE/path.name;return real.protected(local,pin)
  def document(path,pin):
   return copy.deepcopy(CONFIG)if path==m.INPUT else json.loads(protected(path,pin))
  def module(path,pin):
   local=HERE/Path(path).name;raw=protected(local,pin);v=types.ModuleType('genuine_'+local.stem);v.__file__=str(local)
   exec(compile(raw,str(local),'exec'),v.__dict__);return v
  self.runtime={'format':'actual-fixture-ordinary','runtimeReceiptSha256':CONFIG['ordinaryRuntime']['resultSha256'],'currentWriterQualified':True,'sourceKind':'standalone'}
  self.i=types.SimpleNamespace(DATA=real.DATA,protected=protected,document=document,module=module,query_components=lambda:{'components':self.parts},
   read_acknowledgement=lambda sha:{'receiptSha256':sha,'immutableAdmissionOnly':True},
   validate_runtime=lambda *args:(self.calls.append(('actualordinary',args))or copy.deepcopy(self.runtime)))
  self.patches.append(patch.object(m,'intake',lambda:self.i));self.patches[-1].start()
  self.n,self.args=m.build('4'*64)
  self.plan=self.args[-1]
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def target(self):
  return {'schemaOid':'991','owner':'postgres','nonownerPermissions':0,
   'marker':{'singleton':True,'identity':m.READ_IDENTITY,'release_id':real.DATA['sourceRelease'],'manifest_hash':real.DATA['manifestHash'],'definitions':self.plan['definitions']},
   'relations':[{'oid':str(1000+i),'name':name,'kind':kind,'owner':'postgres','acl':None,'definition':None,'columns':[]}for i,(name,kind)in enumerate(self.n.RELATIONS.items())],
   'functions':[{'oid':str(1100+i),'name':name,'owner':'postgres','definer':False,'configuration':['search_path=pg_catalog'],'acl':'postgres only','definition':'same genuine-plan fixture body'}for i,name in enumerate(self.n.FUNCTIONS)]}
 def prepare_fake_database(self):
  before={'targetAbsent':True,'otherCatalog':'unchanged'};self.current=self.target()
  def query(host,sql,readonly=True):
   self.calls.append(('sql',readonly,sql))
   if not readonly:return [copy.deepcopy(self.current)]
   return [copy.deepcopy(before)if not self.committed else{**before,'targetAbsent':False}]
  self.committed=False
  original=query
  def phase_query(host,sql,readonly=True):
   if not readonly and sql.rstrip().endswith('COMMIT;'):self.committed=True
   if readonly and sql==self.n.target_sql(self.plan):return [copy.deepcopy(self.current)]
   return original(host,sql,readonly)
  def review(*args):
   value={'format':m.FORMAT,'binding':self.n.source_binding(*self.args[:-1]),'before':before,'planSha256':m.PLAN_SHA,
    'operatorSha256':m.own_sha(),'selected':False,'grantsChanged':False}
   return {**value,'reviewHash':m.sha(m.encoded(value))}
  patches=[patch.object(self.n,'query',phase_query),patch.object(self.n,'validate_snapshot',lambda *_:None),patch.object(self.n,'review',review)]
  for p in patches:p.start();self.patches.append(p)
  return review()
 def test_default_and_exact_input_and_plan_source_provenance(self):
  p=subprocess.run([sys.executable,'-I','-B',str(FILE)],capture_output=True,check=True)
  self.assertTrue(json.loads(p.stdout)['sourceOnly']);self.assertFalse(p.stderr)
  self.assertEqual(m.checked_input(CONFIG),CONFIG)
  self.assertFalse(m.validate_plan(self.plan)['installedCreatorQualified'])
  for wrong in [{**CONFIG,'ordinaryRuntime':{'resultSha256':None,'inputSha256':'2'*64}},{**CONFIG,'format':'old-owner'}]:
   with self.assertRaises(RuntimeError):m.checked_input(wrong)
  bad=copy.deepcopy(self.plan);bad['readIdentity']='0x'+'f'*64
  with self.assertRaises(RuntimeError):m.validate_plan(bad)
 def test_reused_SQL_and_lifecycle_bodies_only_new_context(self):
  old=load(HERE/m.TEMPLATE.name,'actual2e8body')
  for name in ['owner_sql','snapshot_sql','target_sql','validate_target','rehearse','commit','reconcile','acknowledge','saved_review']:
   self.assertEqual(getattr(self.n,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
  self.assertIsNot(self.n.commit.__globals__,old.commit.__globals__);self.assertNotEqual(self.n.BASE,old.BASE)
  self.assertEqual(self.n.READ_SCHEMA,m.READ_SCHEMA);self.assertEqual(len(self.plan['expectedOwnerStatements']),19)
  b=self.n.source_binding(*self.args[:-1]);self.assertFalse(b['installedCreatorArtifactClaimed'])
  self.assertEqual(self.calls[-1][1],('1'*64,'2'*64))
  self.assertIn('historicalArtifactInstallReceiptSha256',repr(self.n.review.__code__.co_consts))
 def test_exact19_SQL_V4_and_native_untouched_no_grants_and_cap0_source_query(self):
  sql=self.n.owner_sql(self.plan,{'same':'catalog'},True,{'same':'actual-rehearsal'})
  self.assertIn('COMMIT;',sql);self.assertIn('CREATE SCHEMA "'+m.READ_SCHEMA+'"',sql)
  self.assertNotIn('GRANT ',sql);self.assertNotIn('DROP ',sql);self.assertNotIn('CREATE SCHEMA "yunipals_ownership_4e77f52b_v4"',sql)
  calls=[];host=self.args[2]
  def command(argv,data,timeout):calls.append((argv,data,timeout));return b'{}\n'
  host.m.run=command;self.n.query(host,'SELECT 1')
  argv,data,timeout=calls[0];self.assertIn('--reuid=111',argv);self.assertIn('--bounding-set=-all',argv);self.assertIn('5432',argv)
  self.assertTrue(any('default_transaction_read_only=on'in arg for arg in argv));self.assertEqual(timeout,55)
 def test_actual_reused_rehearse_commit_and_no_unknown_commit_resend(self):
  review=self.prepare_fake_database();self.n.rehearse(*self.args,review['reviewHash'])
  self.assertTrue((self.base/'rehearsed.json').exists());self.assertFalse(self.committed)
  self.n.commit(*self.args,review['reviewHash']);self.assertTrue(self.committed);self.assertTrue((self.base/'created.json').exists())
  sqls=[v[2]for v in self.calls if v[0]=='sql'and not v[1]];self.assertEqual(len(sqls),2)
  self.assertTrue(sqls[0].rstrip().endswith('ROLLBACK;'));self.assertTrue(sqls[1].rstrip().endswith('COMMIT;'))
  with self.assertRaises(RuntimeError):self.n.commit(*self.args,review['reviewHash'])
  self.assertEqual(len([v for v in self.calls if v[0]=='sql'and not v[1]]),2)
 def test_source_free_recorded_ack_uses_genuine_intake_reader_signature(self):
  review=self.prepare_fake_database();self.n.rehearse(*self.args,review['reviewHash']);self.n.commit(*self.args,review['reviewHash'])
  digest=m.sha((self.base/'created.json').read_bytes());self.calls.clear()
  self.i.validate_runtime=lambda *_:(_ for _ in()).throw(AssertionError('historical_source_must_not_run'))
  ack=m.acknowledgement(digest);self.assertTrue(ack['createdAcknowledged']);self.assertFalse(ack['currentWriterQualified']);self.assertFalse(self.calls)
  with self.assertRaises(RuntimeError):m.acknowledgement('f'*64)
 def test_data_leaf_allows_separate_grants_but_rejects_OID_body_marker_changes(self):
  review=self.prepare_fake_database();self.n.rehearse(*self.args,review['reviewHash']);self.n.commit(*self.args,review['reviewHash'])
  digest=m.sha((self.base/'created.json').read_bytes());self.current['nonownerPermissions']=3;self.current['relations'][0]['acl']='owned new SELECT'
  value=m.data_current(digest);self.assertTrue(value['readviewDataOnly']);self.assertFalse(value['permissionAuthorityQualified'])
  for change in [lambda v:v.update(schemaOid='foreign'),lambda v:v['functions'][0].update(definition='foreign'),lambda v:v['marker'].update(identity='foreign')]:
   old=copy.deepcopy(self.current);change(self.current)
   with self.assertRaises(RuntimeError):m.data_current(digest)
   self.current=old

if __name__=='__main__':unittest.main()
