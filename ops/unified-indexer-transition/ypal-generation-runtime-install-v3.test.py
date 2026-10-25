#!/usr/bin/env python3
"""Real-filesystem exact artifact tests; dependency qualification is a fixture."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import types
import unittest

ROOT=Path(__file__).resolve().parents[2]
PATH=ROOT/'ops/unified-indexer-transition/ypal-generation-runtime-install-v3.py'
spec=importlib.util.spec_from_file_location('generation_installer',PATH);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setUp(self):
  self.work=tempfile.TemporaryDirectory(prefix='.generation-install-test-',dir=ROOT);self.root=Path(self.work.name);self.root.chmod(0o700)
  self.old={k:getattr(m,k)for k in ['INCOMING','TARGET','BASE','dependencies']}
  m.INCOMING=self.root/'incoming';shutil.copytree('/tmp/ypal-generation-statistics-runtime-v3-20261025',m.INCOMING)
  (self.root/'releases').mkdir();m.TARGET=self.root/'releases'/m.DIGEST;m.BASE=self.root/'receipt'
  dep=self.root/'deps';dep.mkdir();self.dep={'target':json.loads((m.INCOMING/'manifest.json').read_text())['requiredRuntimeDependencyTarget'],'testFixtureOnly':True}
  m.dependencies=lambda *_:self.dep
  self.shared=types.SimpleNamespace(SOURCE='41e5b5fdb1ae4623fb742a9cc77e6e5c578d48845c9102bbafbb06880045987b',
   document=lambda p,pin=None:self.doc(p,pin),protected=lambda p,limit=40000000:Path(p).read_bytes(),sha=lambda raw:hashlib.sha256(raw).hexdigest(),
   encoded=lambda v:(json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode(),write_new=lambda p,raw,mode=0o600:self.save(p,raw,mode),sync_directory=lambda _:None)
 def tearDown(self):
  for k,v in self.old.items():setattr(m,k,v)
  self.work.cleanup()
 def doc(self,path,pin):
  raw=Path(path).read_bytes()
  if pin and hashlib.sha256(raw).hexdigest()!=pin:raise RuntimeError('fixture_pin_changed')
  return json.loads(raw)
 def save(self,path,raw,mode):
  with Path(path).open('xb')as f:f.write(raw)
  Path(path).chmod(mode)
 def test_real_fresh_install_and_exact_readonly_validation(self):
  plan,files=m.prepare(self.shared);pin=m.install(self.shared,plan,files)
  self.assertTrue(m.installed(self.shared,pin)['installed']);self.assertEqual(len(files),10)
  self.assertEqual((m.TARGET/'node_modules').readlink(),Path(self.dep['target']))
  with self.assertRaises(RuntimeError):m.install(self.shared,plan,files)
 def test_changed_bundle_refuses_before_install(self):
  path=m.INCOMING/'dist/generation-refresh.mjs';path.write_bytes(path.read_bytes()+b'\n')
  with self.assertRaises(RuntimeError):m.prepare(self.shared)
  self.assertFalse(m.BASE.exists())
 def test_foreign_installed_file_refuses(self):
  plan,files=m.prepare(self.shared);pin=m.install(self.shared,plan,files);(m.TARGET/'foreign').write_text('x')
  with self.assertRaises(RuntimeError):m.installed(self.shared,pin)
 def test_dependency_and_write_algorithms_are_retained_AST(self):
  old=ast.parse((ROOT/'ops/unified-indexer-transition/metadata-normalization-runtime-install-v1.py').read_text());new=ast.parse(PATH.read_text())
  functions=lambda t:{n.name:ast.dump(n,include_attributes=False)for n in t.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
  a,b=functions(old),functions(new)
  for name in ['shared','directory','dependencies','install','installed','main']:
   self.assertEqual(a[name],b[name],name)

if __name__=='__main__':unittest.main()
