import ast,copy,hashlib,importlib.util,json,os,sys,types,unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
DRIVER=HERE/'ypal-cont5-held-qualification-owner-v3.py'
source=DRIVER.read_text();tree=ast.parse(source)
remote=next(node.value.value for node in tree.body if isinstance(node,ast.Assign)and any(isinstance(target,ast.Name)and target.id=='REMOTE'for target in node.targets))
r=ast.parse(remote);functions={node.name:node for node in r.body if isinstance(node,ast.FunctionDef)}
def load(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
diagnostic_test=load(HERE/'ypal-source6-kernel-diagnostic-owner-v1.test.py')
def need(value,code):
 if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
held_local=json.loads((HERE/'ypal-cont5-held4-result-fixture.json').read_bytes())
kernel_local=json.loads((HERE/'ypal-source6-kernel-diagnostic-result-fixture.json').read_bytes())
held_remote={key:value for key,value in held_local.items()if key not in{'resultSha256','remoteAuditInspectionRequired'}}
kernel_remote={key:value for key,value in kernel_local.items()if key!='resultSha256'}

class Controls(unittest.TestCase):
 def ancestry(self,old=None,diag=None,local_old=None,local_diag=None,present=False):
  old=copy.deepcopy(held_remote)if old is None else old;diag=copy.deepcopy(kernel_remote)if diag is None else diag
  reads=[]
  def document(path,digest):
   value=old if str(path).endswith('held-rollback-qualification-20261026-4/result.json')else diag
   need(sha(encoded(value))==digest,'actual_canonical_server_shape_required');return value
  scope={'pathlib':__import__('pathlib'),'types':types,'json':json,'os':os,'re':__import__('re'),'need':need,'sha':sha,'encoded':encoded,'document':document,
   'protected':lambda path,digest:reads.append((str(path),digest)),
   'held4_local':copy.deepcopy(held_local)if local_old is None else local_old,'kernel_local':copy.deepcopy(kernel_local)if local_diag is None else local_diag,
   'CALLER_SHA':held_remote['callerSha256'],'MANIFEST_SHA':held_remote['readerManifestSha256'],
   'refs':ast.literal_eval(next(node.value for node in tree.body if isinstance(node,ast.Assign)and any(isinstance(target,ast.Name)and target.id=='EXPECTED_REFS'for target in node.targets)))}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[functions['pin'],functions['same_local_remote'],functions['deliberate_ancestry']],type_ignores=[])),str(DRIVER),'exec'),scope)
  with patch.object(os.path,'lexists',return_value=present):value=scope['deliberate_ancestry']()
  return value,reads
 def test_actual_held4_and_kernel_JSON_shapes_canonicalize_to_real_receipts(self):
  self.assertIs(held_local['remoteAuditInspectionRequired'],True)
  self.assertEqual(sha(encoded(held_remote)),'29ecd865d83ccd707dc41957c2e7b513bc66bcc890214b6c66b27125a53a8d90')
  self.assertEqual(sha(encoded(kernel_remote)),'b90ea254cd2965ee9b45a82a14d2dc84cb7687c5b7ae53af34ae8b44ef3f5c66')
  value,reads=self.ancestry();self.assertFalse(value['newRetryAuthority']);self.assertFalse(value['failureCauseReproduced'])
  self.assertEqual(len(reads),len(kernel_remote['privateHashes']))
 def test_transport_annotation_is_only_optional_exact_true_and_unknown_fields_refuse(self):
  without={key:value for key,value in held_local.items()if key!='remoteAuditInspectionRequired'}
  self.ancestry(local_old=without)
  for change in [{**held_local,'remoteAuditInspectionRequired':False},{**held_local,'unknownAnnotation':True},
   {**held_local,'qualifierInvoked':True},{**held_local,'completed':0},{**held_local,'resultSha256':'0'*64},
   {**kernel_local,'sourcePolicyChanged':True},{**kernel_local,'remoteAuditInspectionRequired':True}]:
   kwargs={'local_old':change}if change.get('format')==held_local['format']else{'local_diag':change}
   with self.assertRaises(RuntimeError):self.ancestry(**kwargs)
 def test_existing_held4_capture_or_invocation_record_refuses(self):
  with self.assertRaisesRegex(RuntimeError,'capture_must_remain_absent'):self.ancestry(present=True)
 def kernel_error(self):
  control=diagnostic_test.Controls();kernel,args,calls=control.fixture('incomplete')
  old=diagnostic_test.old
  with patch.object(old,'public',return_value=Path(diagnostic_test.host.__file__).read_bytes()),patch.object(old,'__file__','/opt/yunipals-unified/operations/free-replay-20261020/ypal-ordinary-source-authority-v6.py'):
   kernel=old.classified_kernel(diagnostic_test.host)
  try:kernel(*args)
  except RuntimeError as caught:error=caught
  else:raise AssertionError('genuine hard prefix must refuse')
  self.assertEqual(len(calls),1);return kernel,error
 def capture(self,error,kernel,inner=None,reference=None):
  scope={'types':types,'json':json,'OPS':Path('/opt/yunipals-unified/operations/free-replay-20261020'),'encoded':encoded,'need':need,
   'sql_observation':types.SimpleNamespace(trace=types.SimpleNamespace(error=inner))if inner is not None else None}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[functions['code_shape'],functions['kernel_traceback_evidence']],type_ignores=[])),str(DRIVER),'exec'),scope)
  scope['kernel_reference']=scope['code_shape'](kernel.__code__)if reference is None else reference
  before=sys.gettrace();value=scope['kernel_traceback_evidence'](error);self.assertIs(sys.gettrace(),before);return value
 def test_genuine_exception_traceback_locals_are_retained_without_any_new_query_or_trace(self):
  kernel,error=self.kernel_error();value=self.capture(error,kernel)
  self.assertEqual(len(value['frames']),1);self.assertEqual(value['captureErrors'],[])
  self.assertFalse(value['liveTraceInstalled']);self.assertEqual(value['newObservations'],0)
  local=value['frames'][0]['locals'];self.assertEqual(local['ids'],[11]);self.assertEqual(len(local['rows']),2)
  self.assertEqual(set(local['actors']),{'source','fresh'});self.assertEqual(set(local['backend_fds']),{'11','12'})
  self.assertIs(error.__traceback__.tb_next.tb_frame.f_code,kernel.__code__)
 def test_actual_qualifier_inner_error_object_can_supply_same_authenticated_traceback(self):
  kernel,inner=self.kernel_error()
  outer=RuntimeError('complete_actual_held_callback_then_refused_COMMIT_ACK_required')
  value=self.capture(outer,kernel,inner=inner)
  self.assertEqual(len(value['frames']),1);self.assertEqual(value['frames'][0]['source'],'genuine-qualifier-inner')
  self.assertIsInstance(inner,RuntimeError);self.assertEqual(str(inner),diagnostic_test.scope['FIXED'])
 def test_foreign_derived_code_or_unrelated_traceback_is_never_captured_as_genuine(self):
  kernel,error=self.kernel_error();value=self.capture(error,kernel,reference=('foreign',))
  self.assertEqual(value['frames'],[]);self.assertEqual(len(value['captureErrors']),1)
  try:raise PermissionError('unrelated hard guard')
  except PermissionError as caught:other=caught
  value=self.capture(other,kernel);self.assertEqual(value['frames'],[])
 def test_new_success_map_and_original_held_effect_body_remain_bounded_and_singular(self):
  calls=[ast.unparse(node.func)for node in ast.walk(r)if isinstance(node,ast.Call)]
  self.assertEqual(calls.count('caller.qualify_held'),0) # passed as function to one phase() call
  actual=[node for node in ast.walk(r)if isinstance(node,ast.Call)and ast.unparse(node.func)=='phase'and len(node.args)>1 and ast.unparse(node.args[1])=='caller.qualify_held']
  self.assertEqual(len(actual),1)
  self.assertFalse(any(name in calls for name in['sys.settrace','source_guard.Authority','source_namespace.Authority','caller.execute_cache','caller.construct_records']))
  self.assertIn('authority.require_qualification',[ast.unparse(node.args[1])for node in ast.walk(r)if isinstance(node,ast.Call)and ast.unparse(node.func)=='phase'and len(node.args)>1])
  self.assertEqual(source.count("proof_hashes['authenticated-deliberate-observation-ancestry']="),1)
  self.assertIn('signal.alarm(880)',remote);self.assertIn('remaining=900-',source)
  compile(source,str(DRIVER),'exec');compile(remote,str(DRIVER)+':REMOTE','exec')
 def test_complete_live_preflight_qualifier_and_require_body_matches_frozen_held4(self):
  predecessor=(HERE/'ypal-cont5-held-qualification-owner-v2.py').read_text()
  self.assertEqual(sha(predecessor.encode()),'98636d3beacc9d4ac14a5cdbb4a33c216840cd6424adacd6d008a349c85fe364')
  prior_tree=ast.parse(predecessor)
  prior=next(node.value.value for node in prior_tree.body if isinstance(node,ast.Assign)and any(isinstance(target,ast.Name)and target.id=='REMOTE'for target in node.targets))
  def live(text):return text[text.index(" stage='full-live-preflight'"):text.index('except BaseException as error:\n original_trace=')]
  expected=live(prior).replace('held4-construct-only3-baseline','held5-construct-only3-baseline').replace('root-CONT5-held-rollback-qualification-v2','root-CONT5-held-rollback-qualification-v3')
  self.assertEqual(live(remote),expected)

if __name__=='__main__':unittest.main(verbosity=2)
