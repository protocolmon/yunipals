#!/usr/bin/env python3
import ast
import hashlib
import importlib.util
import inspect
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('v2',HERE/'ypal-rpc-admission-v2.py');v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class Controls(unittest.TestCase):
 def load(self):
  with patch.object(v,'OLD_FILE',HERE/'ypal-rpc-admission-v1.py'):return v.core()
 def test_v1_pin_and_complete_v2_producer_binding(self):
  m=self.load();self.assertEqual(m.__file__,str(HERE/'ypal-rpc-admission-v2.py'));self.assertEqual(m.sha(m.protected(Path(m.__file__))),hashlib.sha256((HERE/'ypal-rpc-admission-v2.py').read_bytes()).hexdigest());self.assertEqual(hashlib.sha256((HERE/'ypal-rpc-admission-v1.py').read_bytes()).hexdigest(),v.OLD_SHA)
 def test_changed_v1_source_refused_before_import(self):
  with patch.object(v,'OLD_FILE',HERE/'ypal-rpc-admission-v1.py'),patch.object(v,'OLD_SHA','0'*64),self.assertRaisesRegex(RuntimeError,'frozen_v1'):v.core()
 def test_query_peer_and_strict_stderr_contract_unchanged(self):
  m=self.load()
  with patch.object(m,'run',return_value=b'{"ok":true}') as run,patch.object(v.os.path,'lexists',return_value=False):self.assertEqual(m.query('SELECT 1'),{'ok':True})
  args=run.call_args.args[0];self.assertIn('PGPASSFILE='+v.NO_PASSWORD_FILE,args);self.assertNotIn('PGPASSFILE=/dev/null',args);self.assertIn('-XwAtq',args);self.assertIn('-i',args);self.assertEqual(args[:len(m.peer())],m.peer());self.assertTrue(run.call_args.args[1].startswith(b'BEGIN READ ONLY;'));self.assertIn('default_transaction_read_only=on',next(x for x in args if x.startswith('PGOPTIONS=')))
 def test_existing_password_sentinel_refuses_without_command(self):
  m=self.load()
  with patch.object(v.os.path,'lexists',return_value=True),patch.object(m,'run') as run,self.assertRaisesRegex(RuntimeError,'explicitly_absent'):m.query('SELECT 1')
  run.assert_not_called()
 def test_query_ast_only_guard_and_password_path_change(self):
  before=ast.parse((HERE/'ypal-rpc-admission-v1.py').read_text());old=next(x for x in before.body if isinstance(x,ast.FunctionDef) and x.name=='query')
  after=ast.parse((HERE/'ypal-rpc-admission-v2.py').read_text());new=next(x for x in ast.walk(after) if isinstance(x,ast.FunctionDef) and x.name=='query');new.body.pop(0)
  class Normalize(ast.NodeTransformer):
   def visit_Attribute(self,node):
    node=self.generic_visit(node)
    if isinstance(node.value,ast.Name) and node.value.id=='m':return ast.Name(id=node.attr,ctx=node.ctx)
    return node
   def visit_BinOp(self,node):
    node=self.generic_visit(node)
    if isinstance(node.op,ast.Add) and isinstance(node.left,ast.Constant) and node.left.value=='PGPASSFILE=' and isinstance(node.right,ast.Name) and node.right.id=='NO_PASSWORD_FILE':return ast.Constant(value='PGPASSFILE=/dev/null')
    return node
  self.assertEqual(ast.dump(old,include_attributes=False),ast.dump(Normalize().visit(new),include_attributes=False))
 def test_every_other_function_and_runtime_constant_is_retained(self):
  m=self.load();ns={'__name__':'retained_not_main','__file__':str(HERE/'ypal-rpc-admission-v1.py')};exec(compile((HERE/'ypal-rpc-admission-v1.py').read_bytes(),ns['__file__'],'exec'),ns)
  for name,obj in ns.items():
   if inspect.isfunction(obj) and name!='query':self.assertEqual(m.__dict__[name].__code__.co_code,obj.__code__.co_code,name)
  for name in ['BASE','PROFILE','APPROVAL','UNIT','UNIT_FILE','ARTIFACT','ARTIFACT_SHA','QUALIFIED_SHA','PROFILE_ID','MANIFEST_HASH','EXPIRY','RUNNER_SHA','SECURITY','FIELDS']:self.assertEqual(getattr(m,name),ns[name],name)

if __name__=='__main__':unittest.main()
