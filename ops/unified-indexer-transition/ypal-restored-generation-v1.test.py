#!/usr/bin/env python3
"""New-generation constructor/identity guards and retained local lifecycle controls."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).parent

def load(name,file):
 spec=importlib.util.spec_from_file_location(name,HERE/file);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v);return v

m=load('new_restored_generation','ypal-restored-generation-v1.py')
old=load('historical_generation_controls','ypal-native-generation-v1.test.py')
old.m=m;old.PATH=Path(m.__file__)


class Retained(old.Tests):
 def fixture_leaf(self):
  _,_,bridges=super().fixture_leaf()
  op=self.document(self.base/'operation.json')
  fields={'readConfig':{'admissionSha256':'read','readPlanSha256':'plan','readContextInputSha256':'context'},'metadataInputSha256':'metadata-input',
          'metadataOperatorSha256':m.META_SHA,'historicalGenerationProducerSha256':m.TEMPLATE_SHA}
  op.update(fields);op_sha=self.replace(self.base/'operation.json',op)
  result=self.document(self.base/'candidate-result.json');result.update(fields,format='yunipals-ypal-restored-generation-candidate-v1',operationSha256=op_sha)
  result_sha=self.replace(self.base/'candidate-result.json',result)
  self.s.Host=lambda *_:self.fail('Old 3a Host query constructor was called')
  static=types.SimpleNamespace(query_components=lambda:{'privilegedSourcePrimitives':{'host':types.SimpleNamespace(s=self.s)},'readerHost':types.SimpleNamespace(query=lambda _:self.g)})
  installer=types.SimpleNamespace(shared=lambda:types.SimpleNamespace(),installed=lambda *_:None)
  def modules(path,pin):
   if path==m.STATIC:return static
   if path==m.INSTALL_FILE:return installer
   self.fail('Unexpected legacy constructor/module: '+str(path))
  return result_sha,modules,bridges
 def replace(self,path,value):
  raw=m.encoded(value);self.files[str(path)]=raw;path.write_bytes(raw);return m.sha(raw)
 def manager_properties(self,loaded=False):
  raw=(HERE/'ypal-restored-metadata-handover-v1.py').read_bytes();self.assertEqual(m.sha(raw),m.META_SHA)
  tree=ast.parse(raw);props=next(ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='PROPS'for x in n.targets))
  values={key:''for key in props};values.update(Id=m.UNIT,LoadState='loaded'if loaded else'not-found',ActiveState='inactive',SubState='dead',MainPID='0',ControlPID='0',Job='',FragmentPath='/unit'if loaded else'',DropInPaths='',KillMode='control-group')
  values.pop('EnvironmentFiles');values.pop('ExecStart')if not loaded else None
  return props,values
 def test_capacity_monitor_retains_accepted_safety_algorithms(self):
  before=ast.parse((HERE/'ypal-generation-capacity-watch-v1.py').read_text());after=ast.parse((HERE/'ypal-restored-generation-capacity-watch-v1.py').read_text())
  funcs=lambda tree:{n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,ast.FunctionDef)}
  self.assertEqual(funcs(before),funcs(after))
  a,b=assignments(before),assignments(after)
  self.assertEqual({key for key in a if ast.dump(a[key],include_attributes=False)!=ast.dump(b[key],include_attributes=False)},{'UNIT','WORK','APP','ENV_FILES'})
  self.assertEqual({k:ast.literal_eval(b[k])for k in ['MIN_RESERVE','ABORT_FREE','MAX_SECONDS']},{'MIN_RESERVE':25000000000,'ABORT_FREE':30000000000,'MAX_SECONDS':1470})
  self.assertEqual(m.sha((HERE/'ypal-restored-generation-capacity-watch-v1.py').read_bytes()),m.MONITOR_SHA)


def assignments(tree):return{n.targets[0].id:n.value for n in tree.body if isinstance(n,ast.Assign)and isinstance(n.targets[0],ast.Name)}


class Constructor(unittest.TestCase):
 def test_new_labels_paths_artifact_and_capsule_are_honest(self):
  self.assertEqual(m.FORMAT,'yunipals-ypal-restored-generation-v1')
  self.assertIn('restored-generation-v1',str(m.BASE));self.assertIn('restored-metadata',str(m.META_BASE))
  self.assertIn('restored-generation-prepare',m.UNIT);self.assertIn('restored-generation',str(m.WORK))
  self.assertEqual(m.sha((HERE/'ypal-native-generation-v1.py').read_bytes()),m.TEMPLATE_SHA)
  self.assertEqual(m.sha((HERE/'ypal-restored-metadata-handover-v1.py').read_bytes()),m.META_SHA)
  self.assertEqual(m.sha((HERE/'ypal-generation-recovery-v1.mjs').read_bytes()),m.CAPSULE_SHA)
 def fixture(self):
  args=types.SimpleNamespace(metadata_input_sha='input',read_ack='read',phase=None,install_ack='installed')
  calls=[]
  def prot(path,*args):
   if path==m.CANDIDATES/'selectors':return b'unchanged-selectors'
   return (HERE/path.name).read_bytes()
  candidate={'staged':True,'selected':False,'files':{'selectors':m.sha(b'unchanged-selectors')}}
  s=types.SimpleNamespace(document=lambda *args:candidate,protected=prot)
  h=types.SimpleNamespace(s=s,m=types.SimpleNamespace(protected=prot),admission_pin='read')
  meta=types.SimpleNamespace(cli_context=lambda pin,inverse:(calls.append((pin,inverse))or h),Host=lambda *a:self.fail('old Host constructor called'))
  installer=types.SimpleNamespace(installed=lambda *a:{'installed':True})
  return args,calls,lambda path,pin:meta if path==m.META_FILE else installer
 def test_constructor_uses_new_explicit_metadata_input_and_direction(self):
  args,calls,modules=self.fixture()
  with patch.object(m,'module',modules):m.Host(args)
  self.assertEqual(calls,[('input',False)])
  args.phase='restore-activation'
  with patch.object(m,'module',modules):m.Host(args)
  self.assertEqual(calls[-1],('input',True))
 def test_mismatched_metadata_admission_refuses_before_worker_or_SQL(self):
  args,calls,modules=self.fixture();args.read_ack='foreign'
  with patch.object(m,'module',modules),self.assertRaisesRegex(RuntimeError,'same_actual_new_READ'):
   m.Host(args)
 def test_consumer_frame_uses_actual_timeout_signature_on_explicit_SDK(self):
  pure=load('actual_frozen_read_consumer_helper','ypal-combined-read-admission-v2.py');calls=[]
  def command(argv,timeout):
   self.assertEqual(timeout,8);unit=argv[3];calls.append(unit)
   row={'Id':unit,'FragmentPath':'/fixture/'+unit,'DropInPaths':'','MainPID':'42','InvocationID':'fixture','ActiveState':'active'}
   return '\n'.join(k+'='+v for k,v in row.items()).encode()
  sdk=types.SimpleNamespace(command=command,protected=lambda path:b'[Service]\n')
  read=types.SimpleNamespace(module=lambda *args:pure,READ_HELPERS='fixture',READ_HELPERS_SHA='fixture')
  static=types.SimpleNamespace(read_context=lambda:read,query_components=lambda:{'privilegedSourcePrimitives':{'sdk':sdk}})
  h=m.Host.__new__(m.Host);h.h=types.SimpleNamespace();h.meta=types.SimpleNamespace(UNIT='yunipals-metadata.service')
  h.m=types.SimpleNamespace(run=lambda argv:self.fail('retained.run without timeout must not be used'))
  candidate=types.SimpleNamespace(cache_snapshot=lambda actual: {'legacyCache':'same'})
  with patch.object(m,'module',side_effect=lambda path,pin: static if path==m.STATIC else candidate):result=h.consumers()
  self.assertEqual(set(calls),set(pure.UNITS));self.assertNotIn(h.meta.UNIT,result['apis'])
  self.assertEqual(result['cache'],{'legacyCache':'same'})
 def test_default_cli_never_constructs_runtime(self):
  value=subprocess.run([sys.executable,str(HERE/'ypal-restored-generation-v1.py')],capture_output=True,check=True)
  row=json.loads(value.stdout);self.assertTrue(row['staticOnly']);self.assertFalse(row['generationStarted']);self.assertEqual(value.stderr,b'')
 def test_finite_operational_AST_seams_and_unchanged_SQL(self):
  before=ast.parse((HERE/'ypal-native-generation-v1.py').read_bytes());after=ast.parse((HERE/'ypal-restored-generation-v1.py').read_bytes())
  dump=lambda n:ast.dump(n,include_attributes=False)
  a={n.name:n for n in before.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};b={n.name:n for n in after.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))};changed=[]
  for name,node in a.items():
   if name=='Host':
    old={x.name:x for x in node.body if isinstance(x,ast.FunctionDef)};new={x.name:x for x in b[name].body if isinstance(x,ast.FunctionDef)}
    changed.extend('Host.'+key for key in old if dump(old[key])!=dump(new[key]))
   elif dump(node)!=dump(b[name]):changed.append(name)
  self.assertEqual(sorted(changed),['Host.__init__','Host.consumers','accept_candidate','main','operation','review','unit_bytes','validate_candidate_database_current','worker_terminal'])
  self.assertEqual(dump(assignments(before)['BRIDGE']),dump(assignments(after)['BRIDGE']))
  for key in ['CAPSULE','CAPSULE_SHA','GUARD','GUARD_SHA','INSTALL_FILE','INSTALL_SHA','CANDIDATES','CANDIDATE_SHA']:
   self.assertEqual(dump(assignments(before)[key]),dump(assignments(after)[key]),key)


if __name__=='__main__':unittest.main(verbosity=2)
