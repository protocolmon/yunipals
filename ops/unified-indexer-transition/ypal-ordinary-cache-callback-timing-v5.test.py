"""Genuine prepared AST + exclusive readonly timing capture controls."""
import ast
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('callback_timing',HERE/'ypal-ordinary-cache-callback-timing-v5.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Controls(unittest.TestCase):
 def test_actual_prepared_body_only_one_final_save_is_redirected(self):
  raw=(HERE/m.CACHE.name).read_bytes();calls=[];durable=[]
  sql={'resultJson':'{"exact":"wire"}','result':{'fourReads':True}}
  rehearsal={'sql':sql};host=types.SimpleNamespace(refresh=lambda:calls.append('full-current'),prerequisites=lambda:calls.append('metadata-current')or{'same':True})
  before={'binding':{'prerequisites':{'same':True}}}
  ns=types.SimpleNamespace(need=m.need,sha=m.sha,read_extension=lambda *args:calls.append('catalog-delta'),stopped=lambda _: (before,{},{}),save=lambda *args:self.fail('production prepared file must never be written'))
  # The original callback also references the recorded cache-before catalog.
  before['catalog']={'postProof':{'catalog':{'before':True}}}
  fn=m.callback(raw,ns,host,before,rehearsal,lambda name,value:durable.append((name,value)))
  # commit's local before is explicitly bound as the authenticated stopped op.
  value={'mode':'apply','planSha256':m.sha(sql['resultJson'].encode()),'postProof':{'catalog':{'after':True}}}
  fn(value);self.assertEqual(calls,['catalog-delta','full-current','metadata-current']);self.assertEqual(durable,[('sql-prepared.json',value)])
  with self.assertRaisesRegex(RuntimeError,'exact_frozen'):m.callback(raw+b'\n',ns,host,before,rehearsal,lambda *_:None)
  durable.clear();value['planSha256']='foreign'
  with self.assertRaises(RuntimeError):fn(value)
  self.assertEqual(durable,[])
 def test_exclusive_own_capture_never_retries_or_reuses_name(self):
  with tempfile.TemporaryDirectory()as tmp,patch.object(m,'BASE',Path(tmp)/'timing'):
   # tempfile is /tmp (sticky); use the new directory primitive on an owned
   # workspace parent so the same production parent checks stay unchanged.
   m.BASE=HERE.resolve()/Path(tmp).name
   self.addCleanup(lambda:__import__('shutil').rmtree(m.BASE,ignore_errors=True))
   folder=m.directory('once');self.assertEqual(folder.stat().st_mode&0o777,0o700)
   m.save(folder,'sentinel.json',{'exact':True})
   with self.assertRaises(FileExistsError):m.directory('once')
   with self.assertRaises(FileExistsError):m.save(folder,'sentinel.json',{'foreign':True})
   self.assertEqual(json.loads((folder/'sentinel.json').read_bytes()),{'exact':True})
 def test_source_mode_uses_actual_intake_and_preserves_failure_without_qualifying_commit(self):
  with tempfile.TemporaryDirectory()as tmp:
   folder=Path(tmp);observed={'binding':{'actualActor':'synthetic'},'observation':{'attempts':[{'validated':True}]}}
   intake=types.SimpleNamespace(observe_runtime=lambda result,context:observed)
   with patch.object(m,'module',return_value=intake):value=m.source_timing(folder,'1'*64,'2'*64)
   self.assertTrue(value['completed']);self.assertFalse(value['productionCOMMITQualified']);self.assertFalse(json.loads((folder/'intent.json').read_bytes())['productionPreparedACKCreated'])
   self.assertEqual(json.loads((folder/'result.json').read_bytes())['observation'],observed)
  with tempfile.TemporaryDirectory()as tmp:
   folder=Path(tmp)
   def fail(*args):raise RuntimeError('genuine_source_refusal')
   with patch.object(m,'module',return_value=types.SimpleNamespace(observe_runtime=fail)):value=m.source_timing(folder,'1'*64,'2'*64)
   self.assertFalse(value['completed']);self.assertEqual(value['fixedCode'],'genuine_source_refusal');self.assertFalse(value['productionCOMMITQualified'])

if __name__=='__main__':unittest.main(verbosity=2)
