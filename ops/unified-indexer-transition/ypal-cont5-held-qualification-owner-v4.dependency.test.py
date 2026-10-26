"""Genuine CONT5 inspect/apply closure and genuine finite filesystem preauth."""
import copy,hashlib,importlib.util,json,os,stat,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest.mock import Mock,patch
HERE=Path(__file__).resolve().parent
def load(name):
 spec=importlib.util.spec_from_file_location(name,HERE/name);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
family=load('ypal-ordinary-publication-continue-v5.test.py')
peer_source=(HERE/'ypal-ordinary-reader-peer-v6.py').read_bytes();helper_source=(HERE/'ypal-reader-peer-runtime-host-v1.py').read_bytes()
assert hashlib.sha256(peer_source).hexdigest()=='91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6'
assert hashlib.sha256(helper_source).hexdigest()=='06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76'
helper=load('ypal-reader-peer-runtime-host-v1.py')

def qualified_function(cache):
 todo=[cache.sql_child];seen=set()
 while todo:
  fn=todo.pop()
  if type(fn)is not types.FunctionType or id(fn)in seen:continue
  seen.add(id(fn))
  if fn.__name__=='qualified_sql_child'and'dependency_authorizer'in fn.__code__.co_freevars:return fn
  todo.extend(cell.cell_contents for cell in(fn.__closure__ or())if isinstance(cell.cell_contents,types.FunctionType))
  todo.extend(fn.__globals__.get(name)for name in fn.__code__.co_names if isinstance(fn.__globals__.get(name),types.FunctionType))
  if len(seen)>128:raise AssertionError('bounded actual sql_child function graph')
 raise AssertionError('actual v6 qualified dependency closure missing')

class Controls(unittest.TestCase):
 def setUp(self):
  self.case=family.Controls();self.case.setUp();self.addCleanup(self.case.doCleanups)
  self.namespace=self.case.provider();self.cache=self.namespace.cache_runtime();self.qualified=qualified_function(self.cache)
  self.assertIsNone(sys.gettrace())
  self.folder=self.enterContext(tempfile.TemporaryDirectory());self.root=Path(self.folder)
  dep=self.root/'node_modules';dep.mkdir(mode=0o755);(dep/'module.js').write_bytes(b'export const fixture=1;\n');(dep/'module.js').chmod(0o644)
  os.symlink('module.js',dep/'alias.js')
  entries={}
  for p in[dep,*dep.iterdir()]:
   row=p.lstat();entry={'mode':stat.S_IMODE(row.st_mode)}
   if stat.S_ISDIR(row.st_mode):entry['type']='directory'
   elif stat.S_ISLNK(row.st_mode):entry.update(type='symlink',target=os.readlink(p))
   else:entry.update(type='file',bytes=row.st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
   entries[str(p.relative_to(self.root))]=entry
  self.entries=entries
  with patch.object(helper,'ROOT',self.root):self.expected=helper.preauthorize_dependencies(entries)
  self.production={'actualStaticProductionIOFixture':True};self.receipt={'productionDependencies':self.production,'preEvaluationDependencyProof':self.expected}
  self.calls=[];self.peer=types.ModuleType('actual_peer6_fixture');self.peer.__file__=str(HERE/'ypal-ordinary-reader-peer-v6.py')
  exec(compile(peer_source,self.peer.__file__,'exec'),self.peer.__dict__)
  case=self
  class ReadOnlyHelper(types.ModuleType):
   def __getattribute__(self,name):
    if name=='document':return lambda path,digest:copy.deepcopy(case.receipt)
    if name=='production':return lambda:(copy.deepcopy(case.production),copy.deepcopy(case.entries))
    if name=='preauthorize_dependencies':
     raw=types.ModuleType.__getattribute__(self,name)
     genuine=types.FunctionType(raw.__code__,{**raw.__globals__,'ROOT':case.root},raw.__name__,raw.__defaults__,raw.__closure__)
     def observed(entries):
      case.calls.append({'trace':sys.gettrace(),'root':case.root});return genuine(entries)
     return observed
    return super().__getattribute__(name)
  original_types=self.peer.types;proxy=types.SimpleNamespace(**vars(types));proxy.ModuleType=lambda name:ReadOnlyHelper(name)
  self.peer.types=proxy
  self.peer.public_bytes=lambda path,digest:helper_source if digest==self.peer.DEPENDENCY_QUALIFIER_SHA else(_ for _ in()).throw(AssertionError('exact helper SHA'))
  self.peer_types_original=original_types
  cells=dict(zip(self.qualified.__code__.co_freevars,self.qualified.__closure__))
  self.authorizer_cell=cells['dependency_authorizer'];common=cells['c'].cell_contents;module=common.module
  def actual_load(path,digest):
   if Path(path).name=='ypal-ordinary-reader-peer-v6.py':
    self.assertEqual(digest,'91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6');return self.peer
   return module(path,digest)
  self.enterContext(patch.object(common,'module',side_effect=actual_load))
  self.columns={'genuineAllColumnACLIOFixture':True}
  self.host=types.SimpleNamespace(config=self.case.config,new_read=types.SimpleNamespace(admitted=lambda *_:(None,None,{'after':{'allColumnAcl':self.columns}})),read_host=object())
  self.result={'catalogSha256':'c'*64,'postProof':{'allColumnAcl':self.columns},'state':{'genuineReadOnlyCatalogIOFixture':True}}
  self.transport=Mock(return_value=self.result);self.cache._sql_child=self.transport
 def test_actual_inspect_warms_same_cached_closure_then_apply_reauthenticates(self):
  code=self.qualified.__code__;body=family.actual['ypal-ordinary-cache-continuation-authority-v5.py'].code_identity(code)
  self.assertIsNone(self.authorizer_cell.cell_contents)
  self.assertIs(self.cache.sql_child(self.host,'inspect'),self.result)
  self.assertEqual(len(self.calls),1);self.assertIsNone(self.calls[0]['trace']);self.assertIs(self.authorizer_cell.cell_contents,self.peer)
  proof=self.peer._dependency_proof;self.assertEqual(proof,self.expected)
  self.assertIs(self.cache.sql_child(self.host,'apply',{'fixturePlan':True},None,None,'fixtureJson'),self.result)
  self.assertIs(self.peer._dependency_proof,proof);self.assertEqual(len(self.calls),1)
  self.assertIs(self.qualified.__code__,code);self.assertEqual(family.actual['ypal-ordinary-cache-continuation-authority-v5.py'].code_identity(code),body)
  self.assertEqual([call.args[1]for call in self.transport.call_args_list],['inspect','apply'])
 def test_added_dependency_refuses_without_caching_or_transport(self):
  (self.root/'node_modules'/'foreign.js').write_text('unlisted')
  with self.assertRaisesRegex(RuntimeError,'unlisted_or_duplicate'):self.cache.sql_child(self.host,'inspect')
  self.assertIsNone(self.peer._dependency_proof);self.transport.assert_not_called()
 def test_original_120_second_dependency_deadline_is_unchanged_and_strict(self):
  times=iter([0,121])
  with patch.object(helper.time,'monotonic',side_effect=lambda:next(times)):
   with self.assertRaisesRegex(RuntimeError,'dependency_preauthorization_deadline_expired'):self.cache.sql_child(self.host,'inspect')
  self.assertIsNone(self.peer._dependency_proof);self.transport.assert_not_called()
 def test_mismatched_actual_proof_refuses_without_caching_or_transport(self):
  self.receipt['preEvaluationDependencyProof']={**self.expected,'dependencyNodes':999}
  with self.assertRaisesRegex(RuntimeError,'exact_accepted_dependencies'):self.cache.sql_child(self.host,'inspect')
  self.assertIsNone(self.peer._dependency_proof);self.transport.assert_not_called()
 def test_genuine_c413_inspect_does_not_create_forward_approval_or_effect_scope(self):
  authority=family.actual['ypal-ordinary-cache-continuation-authority-v5.py']
  cache=types.SimpleNamespace();host=object()
  with patch.dict(authority.approval_before_launch.__globals__,fresh_approval=Mock(side_effect=AssertionError('inspect cannot refresh or qualify approval'))):
   self.assertIsNone(authority.approval_before_launch(cache,host,'inspect'))
  self.assertEqual(vars(cache),{})

if __name__=='__main__':unittest.main(verbosity=2)
