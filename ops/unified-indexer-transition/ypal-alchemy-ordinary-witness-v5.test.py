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

HERE=Path(__file__).parent
def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load(HERE/'ypal-alchemy-ordinary-witness-v5.py','V5_wrapper_tests')
old=load(HERE/'ypal-alchemy-ordinary-witness-v1.py','actual_721')
def local(path,digest):
 raw=(HERE/Path(path).name).read_bytes();m.need(m.sha(raw)==digest,'exact_local_frozen_namespace_source_required');return raw
def namespace():
 with patch.object(m,'source',local):return m.namespace()

class Controls(unittest.TestCase):
 def test_default_has_no_runtime_construction_and_actual_refs_are_real(self):
  result=subprocess.run([sys.executable,'-I','-B',m.__file__],capture_output=True,check=True)
  self.assertTrue(json.loads(result.stdout)['sourceOnly']);self.assertFalse(result.stderr)
  self.assertEqual(m.CREATED_SHA,'5acb7de8be040d76458d2a8e2c0792f33df89a9f790e94377c177cd4f75d7337')
  self.assertEqual(m.SCHEMA_OID,'77370532')
  for name,digest in m.PROGRAMS.items():self.assertEqual(m.sha((HERE/name).read_bytes()),digest,name)
 def test_new_namespace_keeps_actual_prepare_capture_unknown_ACK_and_counter_bodies(self):
  n=namespace();self.assertNotEqual(n.BASE,old.BASE);self.assertNotEqual(n.FORMAT,old.FORMAT)
  for name in ['prepare','capture','measured_frame','review_wire','save','protected']:
   self.assertEqual(getattr(n,name).__code__.co_code,getattr(old,name).__code__.co_code,name)
   self.assertIsNot(getattr(n,name).__globals__,getattr(old,name).__globals__)
  self.assertIn('yunipals-ypal-fixed-boundary-witness-v5',n.capture.__code__.co_consts)
  self.assertNotIn('yunipals-ypal-fixed-boundary-witness-v3',n.capture.__code__.co_consts)
  self.assertEqual(old.WITNESS.name,'fixed-boundary-witness-v3.mjs')
 def test_new_plan_separates_retained_runtime_and_actual_V5_created_marker(self):
  n=namespace();base=m.BASE/'captures'/'first'
  value=n.plan(base);self.assertEqual(value['createdReceiptSha256'],m.CREATED_SHA)
  self.assertEqual(value['format'],'yunipals-ypal-fixed-boundary-witness-v5-plan')
  self.assertEqual(value['retainedRuntimePlanSha256'],n.sha(n.encoded(old.plan(base))))
  self.assertEqual(value['output'],str(base/'witness.json'))
  self.assertNotIn('sourceRoot',value)
 def frame_fixture(self,n):
  data={key:key for key in ['sourceRelease','manifestHash','schema','schemaOid','buildId']};data['nativeTableIdentities']={str(i):{}for i in range(44)}
  current={'validated':True,'observerCurrentQualified':True,'receiptSha256':n.OBSERVER_ACK,'operatorSha256':n.OBSERVER_SHA,
    'sourceActorQualified':False,'currentWriterQualified':False,'paidAuthority':False,'dataIdentity':{**{k:data[k]for k in ['sourceRelease','manifestHash','schema','schemaOid','buildId']},'nativeTableIdentitiesSha256':n.sha(n.encoded(data['nativeTableIdentities']))},
    'actor':{},'initialSourceContext':{},'bootLink':{},'readOnlyInspect':{}}
  rows=[{'chainId':chain,'revision':'1','ageMs':100,'row':{'release_id':data['sourceRelease'],'chain_id':chain,'halted':False}}for chain in [1,56,137,8453]]
  observer=types.SimpleNamespace(validate_current=lambda _:copy.deepcopy(current),namespace=lambda:types.SimpleNamespace(BASE=Path('/recorded'),document=lambda *args:{'readAdmissionSha256':'a'*64,'installationReceiptSha256':'b'*64},Host=lambda *args:types.SimpleNamespace(query=lambda _:copy.deepcopy(rows))))
  created={'validated':True,'createdAcknowledged':True,'readviewDataOnly':True,'readSchema':m.READ_SCHEMA,'readIdentity':m.READ_IDENTITY,'schemaOid':m.SCHEMA_OID,
    'receiptSha256':m.CREATED_SHA,'sourceActorQualified':False,'currentWriterQualified':False,'permissionAuthorityQualified':False,'currentRoleGraphQualified':False,'dataIdentitySha256':'c'*64}
  intake=types.SimpleNamespace(observe_runtime=lambda *args:{'binding':copy.deepcopy(data),'observation':{'sourceReadinessQualified':True}})
  n.module=lambda path,pin:intake if Path(path).name==n.INTAKE.name else observer if Path(path).name==n.OBSERVER.name else types.SimpleNamespace(data_current=lambda expected:copy.deepcopy(created))
  return created
 def test_frame_adds_real_V5_data_scope_separately_from_standalone_writer(self):
  n=namespace();created=self.frame_fixture(n);value=n.frame('d'*64,'e'*64)
  self.assertEqual(value['stable']['v5ReadContext']['readIdentity'],m.READ_IDENTITY)
  self.assertEqual(value['stable']['v5ReadContext']['schemaOid'],m.SCHEMA_OID)
  self.assertIn('source',value['stable']);self.assertIn('observer',value['stable'])
  for field,wrong in [('schemaOid','foreign'),('permissionAuthorityQualified',True),('readIdentity','oldV4')]:
   previous=created[field];created[field]=wrong
   with self.assertRaises(RuntimeError):n.frame('d'*64,'e'*64)
   created[field]=previous
 def test_unknown_capture_intent_does_not_send_source_or_witness_request(self):
  n=namespace()
  with tempfile.TemporaryDirectory(dir=HERE)as temp:
   base=Path(temp);(base/'capture-intent.json').write_text('{}')
   n.capture_path=lambda _:base
   with patch.object(n.subprocess,'Popen',side_effect=AssertionError('must_not_resend')):
    with self.assertRaisesRegex(RuntimeError,'no_witness_resend'):n.capture('capture','f'*64)
 def test_real_reused_run_is_direct_JS_no_TSX_and_preserves_private_logs(self):
  n=namespace()
  with tempfile.TemporaryDirectory(dir=HERE)as temp:
   base=Path(temp);base.chmod(0o700);n.program_inputs=lambda:{}
   calls=[]
   class Child:
    returncode=0;pid=2147483000
    def communicate(self,timeout):return b'{}',b''
   def popen(argv,**kwargs):calls.append((argv,kwargs));return Child()
   with patch.object(n.subprocess,'Popen',popen):self.assertEqual(n.run(base,'review'),{})
   argv,kw=calls[0];self.assertEqual(argv,[str(n.NODE),str(n.WITNESS),'--plan',str(base/'plan.json')]);self.assertNotIn('--import',argv)
   self.assertEqual(kw['env']['PGPASSFILE'],n.SENTINEL);self.assertEqual(len(calls),1)
   self.assertTrue((base/'retained-runtime-plan.json').exists());self.assertTrue((base/'review-process.json').exists())

if __name__=='__main__':unittest.main()
