"""Independent real Source6 composition/code/frame boundary review.

Only public-file relocation and socket/query observations are fixtures. Actual
Source6 composition, derived kernel, original7034 mapping and trace bodies run.
No source Authority or host current operation, SSH, SQL or service is executed.
"""
import ast,hashlib,importlib.util,json,types,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
DRIVER=HERE/'ypal-source6-kernel-diagnostic-owner-v1.py'
tree=ast.parse(DRIVER.read_bytes());remote=ast.literal_eval(next(n.value for n in tree.body if isinstance(n,ast.Assign)and n.targets[0].id=='REMOTE'));rt=ast.parse(remote)
definitions={n.name:n for n in rt.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}
def load_file(path):
 spec=importlib.util.spec_from_file_location(path.stem,path);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);return v
b=load_file(HERE/'ypal-source6-kernel-diagnostic-owner-v1.test.py')
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def public(path,digest=None):
 path=Path(path);p=HERE/path.name
 if path.name=='ypal-old-runtime-inventory-v1.py':p=HERE.parent/'booster-launch'/path.name
 raw=p.read_bytes()
 if digest is not None and sha(raw)!=digest:raise RuntimeError('actual_public_bytes_must_match')
 return raw

def namespace():
 scope={'protected':public,'types':types}
 exec(compile(ast.fix_missing_locations(ast.Module(body=[definitions['load']],type_ignores=[])),str(DRIVER),'exec'),scope)
 constants={n.targets[0].id:ast.literal_eval(n.value)for n in rt.body if isinstance(n,ast.Assign)and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)and isinstance(n.value,ast.Constant)}
 ops=Path('/opt/yunipals-unified/operations/free-replay-20261020')
 guard=scope['load'](ops/'ypal-ordinary-source-authority-v6.py',constants['GUARD_SHA'])
 with patch.object(guard,'public',side_effect=public):actual=guard.composition()
 actual.public=public
 host=scope['load'](ops/'ypal-alchemy-source-switch-v1.host.py',constants['HOST_SHA'])
 original=scope['load'](ops/'ypal-old-runtime-inventory-v1.py',constants['INVENTORY_SHA'])
 independently_loaded=scope['load'](ops/'ypal-old-runtime-inventory-v1.py',constants['INVENTORY_SHA'])
 return guard,actual,host,original,independently_loaded

class Controls(unittest.TestCase):
 def test_actual_fixed_path_loaded_source6_and_map_pass_full_recursive_identity(self):
  guard,actual,host,original,other=namespace()
  one=actual.classified_kernel(host);two=actual.classified_kernel(host)
  shape=b.scope['code_shape']
  self.assertEqual(shape(one.__code__),shape(two.__code__))
  self.assertEqual(shape(original.map_owned_backends.__code__),shape(other.map_owned_backends.__code__))
  self.assertTrue(one.__code__.co_filename.endswith('/ypal-ordinary-source-authority-v6.py'))
  self.assertTrue(original.map_owned_backends.__code__.co_filename.startswith('/opt/yunipals-unified/operations/'))
  self.assertIs(actual.Authority.current.__wrapped__.__globals__['current_kernel'],guard.current_kernel)
  self.assertIs(one.__globals__['need'],host.need)
  for kind in ['good','incomplete']:
   fixture=b.Controls();_,args,calls=fixture.fixture(kind)
   args[1].map_owned_backends=original.map_owned_backends
   collector=b.scope['KernelFrames'](one,original.map_owned_backends);before=json.loads(json.dumps(args[3]));result=None;error=None
   import sys
   self.assertIsNone(sys.gettrace());sys.settrace(collector)
   try:result=one(*args)
   except RuntimeError as caught:error=caught
   finally:sys.settrace(None)
   self.assertEqual(args[3],before);self.assertEqual(collector.calls,1);self.assertEqual(len(collector.maps),2);self.assertEqual(collector.errors,[])
   if kind=='good':self.assertIsNone(error);self.assertEqual(len(calls),2);self.assertEqual(set(result),{'source','fresh'});self.assertEqual(collector.frames,[])
   else:
    self.assertIsNone(result);self.assertEqual(str(error),b.scope['FIXED']);self.assertEqual(len(calls),1)
    self.assertEqual(collector.frames[0]['locals']['ids'],[11]);self.assertEqual(b.scope['kernel_summary'](collector)[0]['unmappedCount'],1)

if __name__=='__main__':unittest.main()
