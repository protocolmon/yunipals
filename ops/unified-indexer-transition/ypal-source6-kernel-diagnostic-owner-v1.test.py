"""Portable local controls for the frozen read-only Source6 diagnostic owner.

Actual kernel/mapping bodies execute; SQL/FD observations are explicit fixtures.
No production input, SSH, Source Authority or manager operation is executed.
"""
import ast,copy,hashlib,importlib.util,json,marshal,os,re,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
DRIVER=HERE/'ypal-source6-kernel-diagnostic-owner-v1.py'
outer=DRIVER.read_text();tree=ast.parse(outer)
remote=next(node.value.value for node in tree.body if isinstance(node,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='REMOTE'for t in node.targets))
r=ast.parse(remote);definitions={node.name:node for node in r.body if isinstance(node,(ast.ClassDef,ast.FunctionDef))}
def load(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
old=load(HERE/'ypal-ordinary-source-authority-v5.py');host=load(HERE/'ypal-alchemy-source-switch-v1.host.py')
inventory=load(HERE.parent/'booster-launch'/'ypal-old-runtime-inventory-v1.py')
def need(value,code):
 if not value:raise RuntimeError(code)
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def sha(raw):return hashlib.sha256(raw).hexdigest()
assert sha(DRIVER.read_bytes())=='cddac6cbe4e6985608402cc3aa727f119943a161210e011bd7fe0c62737265df'
scope={'json':json,'encoded':encoded,'FIXED':'all_required_backends_need_unique_positive_stable_kernel_attribution'}
scope['types']=types
exec(compile(ast.fix_missing_locations(ast.Module(body=[definitions['code_shape'],definitions['KernelFrames'],definitions['kernel_summary']],type_ignores=[])),str(DRIVER),'exec'),scope)

class Controls(unittest.TestCase):
 def setUp(self):
  self.assertIsNone(sys.gettrace());self.assertEqual(sha(Path(host.__file__).read_bytes()),'3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02')
  self.assertEqual(sha(Path(inventory.__file__).read_bytes()),'7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b')
 def fixture(self,kind):
  with patch.object(old,'public',return_value=Path(host.__file__).read_bytes()):kernel=old.classified_kernel(host)
  rows=[{'pid':pid,'backendStart':'epoch-'+str(pid),'clientAddress':None,'clientPort':-1}for pid in[11,12]]
  actors={'source':{'processes':[{'pid':101,'startTicks':901}]},'fresh':{'processes':[{'pid':102,'startTicks':902}]}}
  backend={'11':{'startTicks':811,'socketInodes':[1101]},'12':{'startTicks':812,'socketInodes':[1102]}}
  own={'101':{'startTicks':901,'socketInodes':[1001]},'102':{'startTicks':902,'socketInodes':[1002]}}
  peers={1001:1101,1002:1102}
  if kind=='incomplete':own['102']['socketInodes']=[]
  if kind=='duplicate':own['102']['socketInodes']=[1001]
  calls=[]
  def query(sql):
   calls.append(sql)
   if kind=='changed-final'and len(calls)==2:return rows[:1]
   return copy.deepcopy(rows)
  def peer_fds(pids,*_):
   if kind=='permission':raise PermissionError('strict permission fixture')
   return{str(pid):copy.deepcopy((backend if pid<100 else own)[str(pid)])for pid in pids}
  observer=types.SimpleNamespace(peer_fds=peer_fds,unix_peers=lambda _:peers,run=lambda _:b'',tcp_clients=lambda *_:{},map_owned_backends=inventory.map_owned_backends)
  args=(query,observer,73004621,actors,{name:(970,964)for name in actors},True)
  return kernel,args,calls
 def invoke(self,kind):
  kernel,args,calls=self.fixture(kind);trace=scope['KernelFrames'](kernel,inventory.map_owned_backends)
  body=scope['code_shape'](kernel.__code__);mapping=scope['code_shape'](inventory.map_owned_backends.__code__);defaults=kernel.__defaults__;original_code=kernel.__code__;error=None;value=None
  sys.settrace(trace)
  try:value=kernel(*args)
  except BaseException as caught:error=caught
  finally:sys.settrace(None)
  self.assertIs(kernel.__code__,original_code);self.assertEqual(scope['code_shape'](kernel.__code__),body);self.assertEqual(scope['code_shape'](inventory.map_owned_backends.__code__),mapping)
  self.assertIs(kernel.__defaults__,defaults);self.assertIsNone(sys.gettrace());return trace,calls,value,error
 def test_actual_genuine_positive_kernel_result_and_query_count_are_unchanged(self):
  traced,calls,value,error=self.invoke('good');self.assertIsNone(error);self.assertEqual(len(calls),2)
  self.assertEqual(set(value),{'source','fresh'});self.assertEqual(traced.calls,1);self.assertEqual(len(traced.maps),2);self.assertEqual(traced.frames,[]);self.assertEqual(traced.errors,[])
 def test_actual_unmapped_prefix_captures_all_private_inputs_without_final_query(self):
  traced,calls,value,error=self.invoke('incomplete');self.assertEqual(type(error),RuntimeError);self.assertEqual(str(error),scope['FIXED']);self.assertIsNone(value);self.assertEqual(len(calls),1)
  self.assertEqual(len(traced.frames),1);self.assertEqual(len(traced.maps),2);self.assertEqual(traced.errors,[])
  local=traced.frames[0]['locals'];self.assertEqual(local['ids'],[11]);self.assertEqual(len(local['rows']),2)
  self.assertEqual(set(local['actors']),{'source','fresh'});self.assertEqual(set(local['backend_fds']),{'11','12'})
  self.assertEqual(traced.maps[0]['locals']['actor_fds']['101']['startTicks'],901)
  self.assertEqual(traced.maps[1]['locals']['actor_fds']['102']['socketInodes'],[])
  summary=scope['kernel_summary'](traced)[0];self.assertEqual(summary['classification'],'incomplete');self.assertEqual(summary['unmappedCount'],1);self.assertFalse(summary['finalKernelQueryObserved'])
 def test_actual_duplicate_prefix_remains_strict_and_is_classified_separately(self):
  traced,calls,_,error=self.invoke('duplicate');self.assertEqual(str(error),scope['FIXED']);self.assertEqual(len(calls),1)
  summary=scope['kernel_summary'](traced)[0];self.assertTrue(summary['duplicateAttributionObserved']);self.assertEqual(summary['classification'],'duplicate-and-incomplete')
 def test_actual_final_query_churn_is_not_relabelled_as_prefix_failure(self):
  traced,calls,_,error=self.invoke('changed-final');self.assertIs(type(error),old.KernelQueryChurn);self.assertEqual(len(calls),2);self.assertEqual(traced.frames,[])
 def test_unknown_permission_remains_exact_original_exception_without_retry(self):
  traced,calls,_,error=self.invoke('permission');self.assertIs(type(error),PermissionError);self.assertEqual(str(error),'strict permission fixture');self.assertEqual(len(calls),1);self.assertEqual(traced.frames,[])
 def test_non_target_code_and_derived_error_subclass_do_not_create_refusal_evidence(self):
  kernel,args,calls=self.fixture('incomplete');traced=scope['KernelFrames'](kernel,inventory.map_owned_backends)
  class Child(RuntimeError):pass
  def foreign():raise RuntimeError(scope['FIXED'])
  sys.settrace(traced)
  try:
   with self.assertRaises(RuntimeError):foreign()
  finally:sys.settrace(None)
  self.assertEqual(traced.calls,0);self.assertEqual(traced.frames,[])
  foreign_kernel=types.FunctionType(kernel.__code__,{**kernel.__globals__,'need':lambda value,code:None if value else(_ for _ in()).throw(Child(code))})
  traced=scope['KernelFrames'](foreign_kernel,inventory.map_owned_backends);sys.settrace(traced)
  try:
   with self.assertRaises(Child):foreign_kernel(*args)
  finally:sys.settrace(None)
  self.assertEqual(traced.frames,[])
 def test_capture_size_failure_does_not_replace_original_hard_refusal(self):
  kernel,args,calls=self.fixture('incomplete');traced=scope['KernelFrames'](kernel,inventory.map_owned_backends);traced.maximum=1
  sys.settrace(traced)
  try:
   with self.assertRaisesRegex(RuntimeError,scope['FIXED']):kernel(*args)
  finally:sys.settrace(None)
  self.assertEqual(len(calls),1);self.assertTrue(traced.errors);self.assertEqual(traced.frames,[])
 def test_real_private_exclusive_write_keeps_raw_frames_out_of_public_summary(self):
  with tempfile.TemporaryDirectory()as folder:
   values={'AUDIT':Path(folder),'private_hashes':{},'re':re,'os':os,'need':need,'sha':sha,'encoded':encoded}
   exec(compile(ast.fix_missing_locations(ast.Module(body=[definitions['sync'],definitions['write']],type_ignores=[])),str(DRIVER),'exec'),values)
   values['write']('private-frame.json',{'pid':111,'raw':'fixture'});self.assertEqual((Path(folder)/'private-frame.json').stat().st_mode&0o777,0o600)
   with self.assertRaises(FileExistsError):values['write']('private-frame.json',{})
  public=next(node.value for node in r.body if isinstance(node,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='result'for t in node.targets))
  self.assertNotIn('actors',ast.unparse(public));self.assertNotIn('backend_fds',ast.unparse(public))
 def test_limited_postfailure_is_separate_and_never_queries_without_a_matching_fence(self):
  for matching,failed in [(False,True),(True,False),(True,True)]:
   calls=[];saved={};frame={'private':'same'};pids=[{'pid':11,'backendStart':'epoch-11','clientAddress':None,'clientPort':-1}]
   authority=types.SimpleNamespace(expected=frame,_snapshot=lambda:frame if matching else{'foreign':True},owner=types.SimpleNamespace(h=types.SimpleNamespace(source=types.SimpleNamespace(query=lambda sql:(calls.append(sql)or[])))))
   collector=types.SimpleNamespace(frames=[{'locals':{'rows':pids,'ids':[],'backend_fds':{'11':{'startTicks':811}}}}]if failed else[])
   guard=types.SimpleNamespace(SESSION_SQL='fixedSQL',proc_epoch=lambda pid:None)
   values={'authority':authority,'before':frame,'deadline_hit':False,'collector':collector,'guard':guard,'namespace':types.SimpleNamespace(valid_final_source_rows=lambda rows:rows==[]),
    'write':lambda name,value:saved.setdefault(name,value),'traceback':__import__('traceback'),'need':need}
   exec(compile(ast.fix_missing_locations(ast.Module(body=[definitions['limited_postfailure']],type_ignores=[])),str(DRIVER),'exec'),values)
   result=values['limited_postfailure']();self.assertFalse(result['positiveBackendAttributionQualified']);self.assertEqual(calls,['fixedSQL']if matching and failed else[])
   if calls:self.assertEqual(result['initialDatabaseEpochGoneCount'],1);self.assertEqual(result['initialProcessEpochGoneCount'],1)
 def test_actual_call_scope_is_once_with_finally_restoration_and_no_effects(self):
  calls=[ast.unparse(node.func)for node in ast.walk(r)if isinstance(node,ast.Call)]
  self.assertEqual(calls.count('authority.current'),1);self.assertEqual(calls.count('authority.preflight'),1)
  self.assertEqual(calls.count('authority.owner.h.source.query'),1);self.assertNotIn('authority.finish',calls)
  self.assertFalse(any(name in calls for name in['subprocess.run','authority.commit','authority._sql_child','authority.qualify_held']))
  compile(outer,str(DRIVER),'exec');compile(remote,str(DRIVER)+':REMOTE','exec')

if __name__=='__main__':unittest.main(verbosity=2)
