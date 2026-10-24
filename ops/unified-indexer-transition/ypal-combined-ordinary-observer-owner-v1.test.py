#!/usr/bin/env python3
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
FILE=ROOT/'ops/unified-indexer-transition/ypal-combined-ordinary-observer-owner-v1.py'
spec=importlib.util.spec_from_file_location('ordinary_observer_owner',FILE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='.observer-owner-test-',dir=ROOT)
  self.base=Path(self.temp.name)/'receipt';self.base.mkdir(mode=0o700)
  self.patches=[patch.object(m,'BASE',self.base),patch.object(m,'boot',lambda:'synthetic-boot')]
  for p in self.patches:p.start()
  b={'format':m.FORMAT,'operatorSha256':m.sha(FILE.read_bytes()),'bootId':'synthetic-boot',
    'readAdmissionSha256':'a'*64,'installationReceiptSha256':'b'*64,'preserved':{'exact':'before'},'controlRevisionsBefore':{'1':'5'}}
  self.value={'binding':b,'reviewHash':m.sha(m.encoded(b))}
  m.save('before.json',self.value)
  unit_pin=m.save('unit-installed.json',{'fixture':'owned-unit'});boot_pin=m.save('boot-installed.json',{'fixture':'owned-boot'})
  self.intent={'format':m.FORMAT,'bootId':'synthetic-boot','reviewHash':self.value['reviewHash'],
   'operatorSha256':b['operatorSha256'],'unitSha256':m.TEMPLATE_SHA,'unitInstalledSha256':unit_pin,'bootInstalledSha256':boot_pin,'earliestMonotonicUs':100,
   'latestStartMonotonicUs':135000100,'automaticRetryAllowed':False}
  self.intent_sha=m.save('start-intent.json',self.intent)
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def host(self):
  calls=[]
  h=types.SimpleNamespace(read_ack='a'*64,install_ack='b'*64,source=object(),
   preserved=lambda:{'exact':'before'},peer_inspect=lambda:{'providerCalls':0,'writes':0},
   control=lambda:[{'chainId':c,'revision':'6','ageMs':0}for c in [1,56,137,8453]],
   manager=lambda action:calls.append(action))
  h.read=types.SimpleNamespace(admitted=lambda *args:calls.append('immutable_admission'),
   validate_current=lambda *args:(_ for _ in ()).throw(AssertionError('obsolete_wholegraph_called')))
  return h,calls
 def test_actual_receipt_pins_are_mandatory(self):
  for pin in [None,'','0'*63,'X'*64,'not-an-ack']:
   with self.assertRaises(RuntimeError):m.pin(pin)
 def test_command_template_exact_and_no_receipt_scanner_entry(self):
  with patch.object(m,'TEMPLATE',ROOT/'ops/unified-indexer-transition/ypal-combined-ordinary-observer-serving-v1.service.example'):
   args,env=m.command()
  self.assertEqual(args[:2],['/usr/bin/env','-i']);self.assertEqual(args[-1],'worker')
  self.assertTrue(args[-2].endswith('/dist/unified-observer.mjs'));self.assertEqual(env['UNIFIED_RPC_FREE_ONLY'],'true')
  self.assertEqual({v for k,v in env.items()if k.startswith('PONDER_RPC_URL_')},{f'http://127.0.0.1:{p}/unified'for p in [19221,19222,19223,19224]})
 def test_same_boot_authenticated_start_intent(self):
  self.assertEqual(m.start_intent(m.before(),self.intent_sha),self.intent)
  with self.assertRaises(RuntimeError):m.start_intent(self.value,'f'*64)
 def test_start_intent_cannot_be_replaced_or_retried(self):
  with self.assertRaises(FileExistsError):m.save('start-intent.json',self.intent)
 def test_lost_start_without_failure_marker_is_readonly_reconciled(self):
  h,calls=self.host();actor={'pid':123,'invocation':'c'*32}
  self.assertFalse((m.BASE/'failed.json').exists())
  with patch.object(m,'live',lambda *_:actor):result=m.reconcile(h,self.intent_sha)
  self.assertTrue(result['reconciledStart']);self.assertTrue(result['observationLoopEntered'])
  self.assertNotIn('start',calls);self.assertNotIn('stop',calls);self.assertFalse(result['original143CurrentWholeValidatorPassed'])
  with self.assertRaises(RuntimeError):m.reconcile(h,self.intent_sha)
 def test_reconcile_refuses_changed_owned_inputs_before_ack(self):
  h,calls=self.host();h.preserved=lambda:{'exact':'changed'}
  with self.assertRaises(RuntimeError):m.reconcile(h,self.intent_sha)
  self.assertFalse((m.BASE/'result.json').exists());self.assertNotIn('start',calls)
 def test_postadmission_never_revalidates_old_wholegraph(self):
  h,calls=self.host();m.acknowledged_inputs(h,self.value)
  self.assertEqual(calls,['immutable_admission'])
 def test_first_cycle_requires_all_four_fresh_new_revisions(self):
  rows=[{'chainId':c,'revision':'6','ageMs':1}for c in [1,56,137,8453]]
  self.assertTrue(m.first_cycle_complete(rows,{'1':'5'}))
  for change in [lambda x:x.pop(),lambda x:x[0].update(revision='5'),lambda x:x[0].update(ageMs=180001),lambda x:x[0].update(ageMs=-1),lambda x:x.reverse()]:
   changed=copy.deepcopy(rows);change(changed);self.assertFalse(m.first_cycle_complete(changed,{'1':'5'}))
 def test_terminal_reconcile_never_dispatches_start(self):
  h,calls=self.host()
  with patch.object(m,'live',side_effect=RuntimeError('terminal_observer')):
   with self.assertRaises(RuntimeError):m.reconcile(h,self.intent_sha)
  self.assertNotIn('start',calls);self.assertFalse((m.BASE/'result.json').exists())
 def test_wrong_boot_refuses_owned_records(self):
  with patch.object(m,'boot',lambda:'other-boot'):
   with self.assertRaises(RuntimeError):m.before()
 def test_full_initial_role_graph_required_before_start_mutations(self):
  h,calls=self.host();h.read.validate_current=lambda *_:(_ for _ in ()).throw(RuntimeError('actual_143_missing'))
  with patch.object(m,'BASE',m.BASE/'fresh'),patch.object(m,'absent',lambda _:None):
   with self.assertRaises(RuntimeError):m.review(h)
   self.assertFalse(m.BASE.exists())
 def test_stop_fences_same_actor_after_durable_intent(self):
  h,calls=self.host();actor={'pid':123,'invocation':'c'*32};row={'ActiveState':'active'}
  with patch.object(m,'unit_definition',lambda *_:row),patch.object(m,'live',side_effect=[actor,{'pid':999}]),patch.object(m,'finish_stop',side_effect=AssertionError('must_not_complete')):
   with self.assertRaises(RuntimeError):m.stop(h,self.intent_sha,True)
  self.assertTrue((m.BASE/'stop-intent.json').exists());self.assertNotIn('stop',calls)
 def test_stop_ignores_old_graph_and_uses_owned_expired_safe_identity(self):
  h,calls=self.host();actor={'pid':123,'invocation':'c'*32};seen=[]
  def live(*args):seen.append(args[-1]);return actor
  with patch.object(m,'unit_definition',lambda *_:{'ActiveState':'active'}),patch.object(m,'live',live),patch.object(m,'finish_stop',lambda *_:{'stopped':True}):
   self.assertTrue(m.stop(h,self.intent_sha,True)['stopped'])
  self.assertEqual(calls,['stop']);self.assertEqual(len(seen),2)
 def test_finish_stop_does_not_repeat_unknown_manager_stop(self):
  h,calls=self.host();intent={'format':m.FORMAT,'bootId':'synthetic-boot','reviewHash':self.value['reviewHash'],'operatorSha256':self.value['binding']['operatorSha256'],'actor':{'pid':123}}
  pin=m.save('stop-intent.json',intent)
  fake=self.base/'unit';fake.write_text('present')
  with patch.object(m,'UNIT_FILE',fake),patch.object(m,'terminal',side_effect=RuntimeError('still_active')):
   with self.assertRaises(RuntimeError):m.finish_stop(h,pin)
  self.assertEqual(calls,[]);self.assertTrue(fake.exists())
 def test_required_acl_set_and_native_negative_authority(self):
  row={'role':{'oid':m.ROLE_OID,'name':m.ROLE,'login':True,'super':False,'createRole':False,'createDb':False,'replication':False,'bypassRls':False},'connect':True,
   'nativeWriteAuthority':False,'schemas':[{'name':m.NATIVE,'usage':True,'create':False},{'name':m.CONTROL,'usage':True,'create':False}],
   'tables':[{'name':m.NATIVE+'.'+t,'privileges':['SELECT'],'owner':'1'}for t in m.NATIVE_TABLES]+[
    {'name':m.CONTROL+'.release','privileges':['SELECT'],'owner':'1'},
    {'name':m.CONTROL+'.chain_status','privileges':['INSERT','SELECT','UPDATE'],'owner':'1'},
    {'name':m.CONTROL+'.chain_anchor','privileges':['DELETE','INSERT','SELECT','UPDATE'],'owner':'1'}]}
  self.assertEqual(m.validate_role(row),row)
  for change in [lambda r:r['tables'][0]['privileges'].append('UPDATE'),lambda r:r['role'].update(super=True),lambda r:r['schemas'][0].update(create=True),lambda r:r['tables'].pop()]:
   wrong=copy.deepcopy(row);change(wrong)
   with self.assertRaises(RuntimeError):m.validate_role(wrong)
 def test_direct_leaf_has_no_composite_reader_or_old_source_liveness(self):
  tree=ast.parse(FILE.read_text());host=next(n for n in tree.body if isinstance(n,ast.ClassDef)and n.name=='Host')
  for name in ['direct_source','direct_routes']:
   fn=next(n for n in host.body if isinstance(n,ast.FunctionDef)and n.name==name)
   code=ast.unparse(fn)
   for forbidden in ['validate_current(', 'check_preserved(', '.preserved(', '.policy(', 'a.retained(']:self.assertNotIn(forbidden,code)
 def test_serving_template_is_sustained_and_boot_owned(self):
  raw=(ROOT/'ops/unified-indexer-transition/ypal-combined-ordinary-observer-serving-v1.service.example').read_bytes()
  self.assertEqual(m.sha(raw),m.TEMPLATE_SHA)
  self.assertIn(b'RuntimeMaxSec=infinity\n',raw);self.assertIn(b'WantedBy=multi-user.target\n',raw)
  self.assertIn(b'Restart=no\n',raw);self.assertNotIn(b'RuntimeMaxSec=3600',raw)
 def test_installed_unit_and_boot_inode_cannot_be_adopted_from_replacement(self):
  unit=self.base/'observer.service';unit.write_bytes((ROOT/'ops/unified-indexer-transition/ypal-combined-ordinary-observer-serving-v1.service.example').read_bytes());unit.chmod(0o644)
  link=self.base/'boot.service';link.symlink_to(unit)
  for name in ['unit-installed.json','boot-installed.json']:(self.base/name).unlink()
  with patch.object(m,'UNIT_FILE',unit),patch.object(m,'BOOT',link):
   m.save('unit-installed.json',{'reviewHash':self.value['reviewHash'],'sha256':m.TEMPLATE_SHA,'identity':m.identity(unit)})
   m.save('boot-installed.json',{'reviewHash':self.value['reviewHash'],'bootId':'synthetic-boot','path':str(link),'target':str(unit),'identity':m.identity(link)})
   self.assertEqual(m.installed_unit(self.value)['identity'],m.identity(unit));m.check_boot(self.value)
   original=link.lstat().st_ino
   staged=self.base/'foreign-boot';staged.symlink_to(unit);staged.replace(link)
   self.assertNotEqual(link.lstat().st_ino,original)
   with self.assertRaises(RuntimeError):m.check_boot(self.value)
 def test_start_intent_authenticates_unit_and_boot_records(self):
  (m.BASE/'boot-installed.json').write_bytes(m.encoded({'fixture':'changed'}))
  with self.assertRaises(RuntimeError):m.start_intent(self.value,self.intent_sha)
 def test_manager_only_fixed_new_unit(self):
  calls=[]
  with patch.object(m.subprocess,'run',lambda args,**kw:(calls.append((args,kw))or types.SimpleNamespace(returncode=0,stdout=b'',stderr=b''))):
   h=object.__new__(m.Host);h.manager('start')
   with self.assertRaises(RuntimeError):h.manager('restart')
  self.assertEqual(calls[0][0],['/usr/bin/systemctl','start',m.UNIT]);self.assertEqual(calls[0][1]['timeout'],135)
 def test_failed_manager_ack_does_not_retry(self):
  calls=[]
  with patch.object(m.subprocess,'run',lambda *a,**k:(calls.append(a)or types.SimpleNamespace(returncode=1,stdout=b'',stderr=b'bounded'))):
   with self.assertRaises(RuntimeError):object.__new__(m.Host).manager('start')
  self.assertEqual(len(calls),1)

if __name__=='__main__':unittest.main()
