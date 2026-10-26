"""Local-only source/controller/regular-FD fixture; never run the root payload.

One local child executes only sleep(5), not Source6/SQL/commit code. All durable
status and descriptor bodies are genuine; the test owns and removes its private
workspace directory and child. No SSH/production input/effect is executed.
"""
import ast,base64,copy,hashlib,importlib.util,json,os,re,stat,subprocess,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
FILE=HERE/'ypal-cont5-held7-detached-owner-v1.py'
spec=importlib.util.spec_from_file_location('durable_fixture',FILE);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
remote=ast.parse(m.REMOTE);defs=[n for n in remote.body if isinstance(n,ast.FunctionDef)]
sha=lambda raw:hashlib.sha256(raw).hexdigest()
encoded=lambda value:(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
P=lambda text:sha(('explicit-no-authority-fixture:'+text).encode())

class Controls(unittest.TestCase):
 def setUp(self):
  self.enterContext(patch.object(m,'SOURCE',HERE/'ypal-cont5-held-qualification-owner-v5.py'))
 def public_inputs(self,driver):
  files={'BASELINE_RESULT':'ypal-cont5-construct3-result-fixture.json','HELD4_RESULT':'ypal-cont5-held4-result-fixture.json',
   'KERNEL_RESULT':'ypal-source6-kernel-diagnostic-result-fixture.json','HELD5_RESULT':'ypal-cont5-held5-result-fixture.json',
   'RECON_RESULT':'ypal-cont5-held6-reconciliation-result-fixture.json'}
  return{'METADATA_REFS':copy.deepcopy(driver.EXPECTED_REFS),**{k:json.loads((HERE/name).read_bytes())for k,name in files.items()}}
 def fixture_reader(self,driver,values):
  paths={getattr(driver,name):name for name in values}
  def read(path):return copy.deepcopy(values[paths[path]])
  return read
 def test_exact_retained_engine_has_only_source_namespace_format_and_activation_deltas(self):
  old=(HERE/'ypal-cont5-held6-detached-owner-v1.py').read_text()
  expected=old.replace('HELD6','HELD7').replace('held6','held7').replace('20261026-6.py','20261026-7.py').replace('qualification-20261026-6','qualification-20261026-7')
  expected=expected.replace('57a65391c3935945ddb22cce922181ad1aaf3a03926441ee7fb46b6e074e1a1a','8e0cf675f94f64fa408f751494141714b9e784f512e46470c63238d0ab6c41db')
  expected=expected.replace('# Root and independent complete source reviews passed; actual57a gates remain.',
   '# Retained engine is reviewed; this new exact HELD7 binding awaits review.')
  expected=expected.replace('DURABLE_LAUNCH_REVIEWED=True','DURABLE_LAUNCH_REVIEWED=False').replace('root-CONT5-held-rollback-qualification-v4','root-CONT5-held-rollback-qualification-v5')
  actual=FILE.read_text()
  if m.DURABLE_LAUNCH_REVIEWED:
   actual=actual.replace('# Root and independent complete source reviews passed; actual8e0 gates remain.',
    '# Retained engine is reviewed; this new exact HELD7 binding awaits review.').replace('DURABLE_LAUNCH_REVIEWED=True','DURABLE_LAUNCH_REVIEWED=False')
  self.assertEqual(actual,expected)

 def remote_fixture(self):
  temporary=tempfile.TemporaryDirectory(prefix='detached-source-fixture-',dir=HERE);self.addCleanup(temporary.cleanup)
  parent=Path(temporary.name);area=parent/'owned-launch';effect=parent/'absent-effect'
  # This is intentionally NOT the frozen root REMOTE. It only keeps a local
  # Python stdin process alive to verify genuine regular-FD/PIDepoch behavior.
  payload=b'import time\ntime.sleep(5)\n'
  meta={'sourceSha256':m.SOURCE_SHA,'effectAudit':str(effect),'payloadSha256':sha(payload),
   'expectedEffect':{'callerSha256':P('caller'),'readerManifestSha256':P('manifest'),'metadataRefsSha256':P('refs'),
    'baselineRootResultSha256':P('baseline'),'baselineReceiptSha256':P('baseline-authority')}}
  scope={'os':os,'pathlib':types.SimpleNamespace(Path=Path),'re':re,'json':json,'hashlib':hashlib,'stat':stat,'base64':base64,
   'subprocess':subprocess,'sys':sys,'datetime':__import__('datetime'),'SOURCE_SHA':m.SOURCE_SHA,'AREA':area,'EFFECT':effect,
   'FORMAT':'root-CONT5-held7-detached-v1','META':meta,'PAYLOAD':base64.b64encode(payload).decode(),'invoked':False,'process':None}
  exec(compile(ast.fix_missing_locations(ast.Module(body=defs,type_ignores=[])),'actual_durable_remote_helpers','exec'),scope)
  def cleanup_child():
   child=scope['process']
   if child is not None:
    if child.poll()is None:child.terminate()
    child.wait(timeout=5)
  self.addCleanup(cleanup_child)
  return scope

 def test_exact_frozen_held7_actual_predecessor_gates_and_original_REMOTE_render(self):
  driver,raw=m.source_module();self.assertEqual(sha(raw),'8e0cf675f94f64fa408f751494141714b9e784f512e46470c63238d0ab6c41db')
  # Only actual local predecessor JSONs are read. No future held7 success is
  # needed to render the new one-shot qualifier, and no remote call executes.
  values=self.public_inputs(driver)
  with patch.object(driver,'read_private',side_effect=self.fixture_reader(driver,values)),patch.object(driver,'RESULT',Path('/explicit-fixture/absent-held7-result')),patch.object(driver.os,'umask'):
   payload,meta=m.render_payload(driver,raw)
  expected=driver.REMOTE.replace('ACTUAL_CONSTRUCT_BASELINE_RESULT',repr(values['BASELINE_RESULT'])).replace('ACTUAL_METADATA_REFS',repr(values['METADATA_REFS'])).replace('ACTUAL_HELD4_FAILURE',repr(values['HELD4_RESULT'])).replace('ACTUAL_KERNEL_DIAGNOSTIC',repr(values['KERNEL_RESULT'])).replace('ACTUAL_HELD5_FAILURE',repr(values['HELD5_RESULT'])).replace('ACTUAL_HELD6_RECONCILIATION',repr(values['RECON_RESULT'])).encode()
  self.assertEqual(payload,expected);self.assertEqual(meta['payloadSha256'],sha(expected))
  self.assertEqual(meta['expectedEffect']['baselineRootResultSha256'],'2935d53ffa101664c882d93dce210f08a23a393196be36dcefe9044c9b51a195')
  self.assertEqual(meta['expectedEffect']['baselineReceiptSha256'],'6116063820737afd9afcfd9b78f6eabc10572d7473886e2bab999c78c83cab71')

 def test_any_changed_actual_predecessor_refuses_before_any_transport(self):
  driver,raw=m.source_module();original=self.fixture_reader(driver,self.public_inputs(driver))
  def changed(path):
   value=original(path)
   if path==driver.HELD5_RESULT:value['sourcePolicyChanged']=True
   return value
  with patch.object(driver,'read_private',side_effect=changed),patch.object(driver.os,'umask'),patch.object(driver,'RESULT',Path('/explicit-fixture/absent-held7-result')):
   with self.assertRaises((RuntimeError,SystemExit)):m.render_payload(driver,raw)

 def test_real_detached_stdin_and_regular_output_FDs_have_a_durable_actual_epoch(self):
  scope=self.remote_fixture();value=scope['launch']();process=scope['process']
  self.assertTrue(value['completed']);self.assertTrue(value['workerEpochQualified']);self.assertEqual(value['pid'],process.pid)
  self.assertIsNone(value['operationCompleted']);self.assertFalse(value['operationOutcomeInferred'])
  receipt=json.loads((scope['AREA']/'launch.json').read_bytes());self.assertGreater(receipt['worker']['startTicks'],0)
  self.assertEqual(set(receipt['worker']['descriptors']),{'0','1','2'})
  self.assertEqual(receipt['worker']['argv'],[sys.executable,'-I','-B','-'])
  for name in ['payload.py','worker-stdout.private','worker-stderr.private','intent.json','launch.json']:
   self.assertEqual((scope['AREA']/name).lstat().st_mode&0o777,0o600)
  observed=scope['inspect']();self.assertTrue(observed['sameWorkerEpochAlive']);self.assertIsNone(observed['operationResult'])
  self.assertTrue(observed['unknownOutcomeRequiresInspection']);self.assertFalse(observed['currentOrSQLOutcomeRequalified'])
  with patch.object(scope['subprocess'],'Popen',side_effect=AssertionError('no second launch')),self.assertRaises(RuntimeError):scope['launch']()
  process.terminate();process.wait(timeout=5)
  gone=scope['inspect']();self.assertFalse(gone['sameWorkerEpochAlive']);self.assertIsNone(gone['operationCompleted'])

 def test_launch_ACK_gap_is_unknown_not_a_replay_or_zero_effect_claim(self):
  scope=self.remote_fixture()
  with patch.object(scope['subprocess'],'Popen',side_effect=OSError('fixture launch outcome unknown')):
   with self.assertRaises(OSError):scope['launch']()
  self.assertTrue(scope['invoked']);self.assertTrue((scope['AREA']/'intent.json').exists());self.assertFalse((scope['AREA']/'launch.json').exists())
  value=scope['inspect']();self.assertTrue(value['completed']);self.assertFalse(value['launchReceiptPresent'])
  self.assertTrue(value['unknownOutcomeRequiresInspection']);self.assertIsNone(value['operationResult'])

 def test_only_actual_protected_effect_receipt_can_report_completion(self):
  scope=self.remote_fixture();scope['launch']();scope['EFFECT'].mkdir(mode=0o700)
  expected=scope['META']['expectedEffect']
  result={'format':'root-CONT5-held-rollback-qualification-v5','completed':True,**expected,'transactionStatus':'aborted',
   **{key:True for key in ['qualificationOnly','completeHeldCallback','childGone','backendGone','catalogRestored','transactionalCatalogMutationsRolledBack']},
   **{key:False for key in ['realCOMMITDispatched','productionCOMMITQualified','productionPreparedACKCreated','LOGINDispatched','sourcePolicyChanged']},'serviceActionsDispatched':0}
  path=scope['EFFECT']/'result.json';path.write_bytes(encoded(result));path.chmod(0o600)
  observed=scope['inspect']();self.assertEqual(observed['operationResult'],{**result,'resultSha256':sha(path.read_bytes())})
  self.assertTrue(observed['actualProtectedResultOnly']);self.assertFalse(observed['currentOrSQLOutcomeRequalified'])
  result['baselineReceiptSha256']=P('foreign');path.write_bytes(encoded(result))
  with self.assertRaises(RuntimeError):scope['inspect']()


 def test_actual_outer_recovers_exact_canonical_result_once_never_unknown_or_overwrite(self):
  import contextlib,io
  scope=self.remote_fixture();scope['launch']();scope['EFFECT'].mkdir(mode=0o700)
  value={'format':'root-CONT5-held-rollback-qualification-v5','completed':True,**scope['META']['expectedEffect'],
   'transactionStatus':'aborted',**{key:True for key in ['qualificationOnly','completeHeldCallback','childGone','backendGone','catalogRestored','transactionalCatalogMutationsRolledBack']},
   **{key:False for key in ['realCOMMITDispatched','productionCOMMITQualified','productionPreparedACKCreated','LOGINDispatched','sourcePolicyChanged']},'serviceActionsDispatched':0}
  result_path=scope['EFFECT']/'result.json';result_path.write_bytes(encoded(value));result_path.chmod(0o600)
  observed={**scope['inspect'](),'format':'root-CONT5-held7-detached-v1'}
  target=scope['AREA'].parent/'local-success.json';driver=types.SimpleNamespace(RESULT=target);saved=[];real=m.exclusive
  def save(path,item):
   saved.append((path,copy.deepcopy(item)))
   if path==target:real(target,item)
  def run(output,capture):
   transport=Mock(return_value=types.SimpleNamespace(stdout=json.dumps(output),stderr='',returncode=0))
   with patch.object(m,'DURABLE_LAUNCH_REVIEWED',True),patch.object(m,'source_module',return_value=(driver,b'')),patch.object(m,'exclusive',side_effect=save),    patch.object(m.subprocess,'run',transport),patch('sys.argv',[str(FILE),'--inspect','--capture-id',capture,'--recover-result']),contextlib.redirect_stdout(io.StringIO()):
    return m.main()
  with self.assertRaises(SystemExit)as done:run(observed,'fixture-first')
  self.assertEqual(done.exception.code,0);actual=observed['operationResult'];self.assertEqual(target.read_bytes(),encoded(actual))
  self.assertEqual(sha(encoded({k:v for k,v in actual.items()if k!='resultSha256'})),actual['resultSha256'])
  with self.assertRaisesRegex(RuntimeError,'cannot_be_overwritten'):run(observed,'fixture-second')
  self.assertEqual(sum(path==target for path,_ in saved),1)
  target.unlink();unknown={**observed,'operationResult':None,'operationCompleted':None}
  with self.assertRaisesRegex(RuntimeError,'no_inference'):run(unknown,'fixture-unknown')
  self.assertFalse(target.exists());self.assertEqual(sum(path==target for path,_ in saved),1)

 def test_no_systemd_SQL_transport_or_original_payload_dispatch_by_default(self):
  source=FILE.read_bytes();compile(source,str(FILE),'exec');compile(m.REMOTE,str(FILE)+':REMOTE','exec')
  calls=[n for n in ast.walk(remote)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)]
  self.assertEqual(sum(n.func.attr=='Popen'for n in calls),1)
  self.assertFalse({'execute_cache','execute_reader','manager','qualify_held','construct_records'}&{n.func.attr for n in calls})
  self.assertNotIn('systemd-run',m.REMOTE);self.assertNotIn('ObservedQualification',m.REMOTE)
  with patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')),patch('sys.argv',[str(FILE)]):m.main()
  with patch.object(m,'DURABLE_LAUNCH_REVIEWED',False),patch.object(m.subprocess,'run',side_effect=AssertionError('no SSH')),patch('sys.argv',[str(FILE),'--launch']),self.assertRaisesRegex(RuntimeError,'not_yet_reviewed'):m.main()

if __name__=='__main__':unittest.main()
