"""Live SAMEACTOR CAS contract; no production calls or effects."""
import copy
import ast
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import subprocess
import unittest
from unittest.mock import patch
HERE=Path(__file__).parent.resolve()
def load(name):
 s=importlib.util.spec_from_file_location(name,HERE/name);n=importlib.util.module_from_spec(s);s.loader.exec_module(n);return n
m=load('ypal-ordinary-source-authority-v3.py')

class Controls(unittest.TestCase):
 def test_actual_GetAll_method_reply_shape_and_no_silent_defaults(self):
  actual={'type':'a{sv}','data':[{'Environment':{'type':'as','data':[]},'BindPaths':{'type':'a(ssbt)','data':[['/a','/b',False,0]]}}]}
  self.assertEqual(m.decode_all(json.dumps(actual)),actual['data'][0])
  for change in [dict(type='a{sv}',data=actual['data'][0]),dict(type='a{sv}',data=[]),dict(type='as',data=actual['data']),dict(type='a{sv}',data=[{'missing':{'data':[]}}])]:
   with self.assertRaises(RuntimeError):m.decode_all(json.dumps(change))
 def test_only_dependency_sets_are_canonical_inline_values_are_digest_only(self):
  values={'Unit':{'Requires':{'type':'ao','data':['/z','/a']}},'Service':{'Environment':{'type':'as','data':['SECRET=synthetic']},'EnvironmentFiles':{'type':'a(sb)','data':[['/one',False],['/two',False]]}}}
  first=m.selected_properties(values,{'Requires','Environment','EnvironmentFiles'});values['Unit']['Requires']['data'].reverse()
  self.assertEqual(m.selected_properties(values,set(first)),first);self.assertNotIn('synthetic',json.dumps(first));values['Service']['EnvironmentFiles']['data'].reverse()
  self.assertNotEqual(m.selected_properties(values,set(first)),first)
  with self.assertRaises(RuntimeError):m.selected_properties(values,{'unknown'})
 def test_private_files_same_bytes_foreign_inode_or_changed_bytes_refuse_CAS(self):
  with tempfile.TemporaryDirectory()as tmp:
   p=Path(tmp)/'private';p.write_text('synthetic');before=m.file_frame({str(p)})
   p.write_text('changed');self.assertNotEqual(m.file_frame({str(p)}),before)
   replacement=p.with_name('replacement');replacement.write_text('synthetic');replacement.replace(p);self.assertNotEqual(m.file_frame({str(p)}),before)
 def guard(self):
  a=object.__new__(m.Authority);a.ready=True;a.result_sha='1'*64;a.input_sha='2'*64
  a.binding={'schemaOid':'75963410','nativeTableIdentities':{'one':'oid'},'syncCacheIdentity':{'cache':'oid'},'buildId':'71e2a7f3b7','currentWriterQualified':True}
  a.expected={'actualSameActor':'private-frame'};a._snapshot=lambda:a.expected.copy();a.registration={'actual12':'same'};a.actors={m.SOURCE:{'parent':{'pid':101}},m.FRESH:{'parent':{'pid':102}}}
  a.intake=types.SimpleNamespace(registration=lambda _:a.registration.copy())
  native={'schemaOid':'75963410','tables':{'one':'oid'},'cache':{'cache':'oid'},'app':{'build_id':'71e2a7f3b7','is_ready':1,'heartbeat_at':1},'clock':100}
  flags=[]
  owner=types.SimpleNamespace(h=types.SimpleNamespace(source=types.SimpleNamespace(native=lambda:native,query=lambda _:None,inputs=lambda:{'genuineInputs':'same'}),r=types.SimpleNamespace(recovery_floor=lambda *_:flags.append('floor'),epoch_heartbeat=lambda *_:flags.append('heartbeat')),observer=object()),
    original={'native':{},'inputs':{'genuineInputs':'same'}},journal=lambda _:{'genuineStart':True},c=types.SimpleNamespace(host_module=types.SimpleNamespace(kernel_backends=lambda *args:{m.SOURCE:[{'pid':5}],m.FRESH:[]})))
  a.owner=owner;return a,native,flags
 def test_current_samples_ready_native_heartbeat_finance_and_positive_kernel_every_time(self):
  a,native,flags=self.guard();calls=[]
  with patch.object(m,'financial_current',side_effect=lambda _:calls.append('finance')or{'financialQualified':True}):
   result=a.current();self.assertTrue(result['currentWriterQualified']);self.assertFalse(result['financialAuthorityQualified']);self.assertEqual(flags,['floor','heartbeat','floor','heartbeat']);self.assertEqual(calls,['finance'])
   native['app']['is_ready']=0
   with self.assertRaisesRegex(RuntimeError,'fresh_live_ready'):a.current()
   self.assertEqual(calls,['finance'])
 def test_changed_epoch_static_data_or_escaped_source_backend_never_returns_cached_authority(self):
  a,native,flags=self.guard()
  with patch.object(m,'financial_current',return_value={}):
   a.current();a._snapshot=lambda:{'foreignEpoch':True}
   with self.assertRaises(RuntimeError):a.current()
   a._snapshot=lambda:a.expected.copy();native['tables']={'new':'foreign'}
   with self.assertRaises(RuntimeError):a.current()
   native['tables']={'one':'oid'}
   def orphan(*args):raise RuntimeError('unattributed_source_backend')
   a.owner.c.host_module.kernel_backends=orphan
   with self.assertRaisesRegex(RuntimeError,'unattributed'):a.current()
   a.owner.h.source.inputs=lambda:{'changedCodePrivateOrRole':True}
   with self.assertRaisesRegex(RuntimeError,'all_original_source'):a.current()
 def test_unprepared_or_inverse_does_not_gain_forward_source_authority(self):
  a,native,flags=self.guard();a.ready=False
  with self.assertRaises(RuntimeError):a.current()
  a.ready=True
  with self.assertRaises(RuntimeError):a.current(True)
 def test_actual_preflight_READ_failure_never_leaves_current_enabled(self):
  a=object.__new__(m.Authority);a.ready=False;a.result_sha='1'*64;a.input_sha='2'*64;a.read_config={'actualReadRefs':True}
  chains=['ethereum','base','polygon','bnb'];retained=['retained-'+str(i)+'.service'for i in range(5)]
  units=[m.SOURCE,m.FRESH,*chains,*retained]
  states={name:{'MainPID':str(100+i),'InvocationID':str(i).zfill(32),'FragmentPath':'/synthetic/'+name,'DropInPaths':'','ControlGroup':'/system.slice/'+name}for i,name in enumerate(units)}
  def sdk(name):return{'parent':{'pid':int(states[name]['MainPID']),'argv':[]},'unit':{'InvocationID':states[name]['InvocationID'],'ControlGroup':states[name]['ControlGroup']},'processes':[]}
  def proxy(name):return{'pid':int(states[name]['MainPID']),'invocation':states[name]['InvocationID'],'cgroup':states[name]['ControlGroup']}
  source=sdk(m.SOURCE);fresh=sdk(m.FRESH);op={'retirement':{'units':['retired-'+str(i)for i in range(12)]},'originalFreeRoutes':{},'publicFiles':{}}
  original={'inputs':{},'sourceDefinitions':{},'sourcePrivateInputs':{},'sourceBoot':{},'sourceRuntime':{},'retainedRPC':{unit:{'packet':{'actor':proxy(unit)}}for unit in retained}}
  a.owner=types.SimpleNamespace(operation=lambda:op,journal=lambda name:{'source':source}if name=='result.json'else{'actor':proxy(name.removesuffix('-started.json'))},
   original=original,leaf=types.SimpleNamespace(UNIT_SECURITY_FIELDS=()),h=types.SimpleNamespace(source=types.SimpleNamespace(actor=lambda name:fresh,query=lambda _:None),r=types.SimpleNamespace(BOOT='/synthetic/source-boot')),old=types.SimpleNamespace(ns=types.SimpleNamespace(SOURCE_DROP='/synthetic/retired-source99.conf')))
  a._units=lambda:units;a._snapshot=lambda *args:{'properties':{}}
  a.runtime=types.SimpleNamespace(CHAINS=chains,INPUT=Path('/synthetic/input'),BASE=Path('/synthetic/base'))
  a.owner.h.proxy_unit=lambda name:name
  a.intake=types.SimpleNamespace(observe_runtime=lambda *args:{'binding':{'routingMode':'paid','currentWriterQualified':True}},registration=lambda _:{} )
  service={'Service':{'BindPaths':{'type':'a(ssbt)','data':[['/back-rw'+str(i),'/in-rw'+str(i),False,0]for i in range(3)]},'BindReadOnlyPaths':{'type':'a(ssbt)','data':[['/back-ro'+str(i),'/in-ro'+str(i),False,0]for i in range(3)]},'EnvironmentFiles':{'type':'a(sb)','data':[]}}}
  def fail_read(_):raise RuntimeError('changed_actual_read_catalog')
  a._read_current=fail_read
  with patch.object(m,'state_batch',return_value=states),patch.object(m,'properties',return_value=service):
   with self.assertRaisesRegex(RuntimeError,'changed_actual_read'):a.preflight()
  self.assertFalse(a.ready)
  self.assertIn('/synthetic/retired-source99.conf',a.paths)
  with self.assertRaisesRegex(RuntimeError,'actual_complete_forward'):a.current()
 def test_genuine_financial_current_body_uses_existing_authenticated_owner_and_live_checks(self):
  financial=load('ypal-alchemy-ordinary-financial-v1.py');calls=[];sha='a'*64
  # Exercise genuine89a body with a preauthenticated synthetic owner. Its
  # model/SQL primitives are isolated, not replaced in the production module.
  fn=financial.validate_current
  scope={**fn.__globals__,'saved_owner':lambda:self.fail('new constructor must not run'),'monotonic':lambda *args:calls.append('monotonic'),'BASE':Path('/never-existing-source-authority-fixture')}
  n=types.SimpleNamespace(validate_current=types.FunctionType(fn.__code__,scope,fn.__name__,fn.__defaults__))
  fo=types.SimpleNamespace(digest=lambda _:sha,receipt=lambda _:{'reviewSha256':'b'*64,'after':{}},reviewed=lambda _:{'before':{},'proposal':{'permits':[],'expiresMs':100,'ordinaryPolicy':{}}},
   h=types.SimpleNamespace(snapshot=lambda:calls.append('snapshot')or{},immutable=lambda:calls.append('immutable')),
   p=types.SimpleNamespace(validate_current=lambda *args:calls.append('model')),
   m=types.SimpleNamespace(PROFILE='actual-profile',PROFILE_FILE_SHA='c'*64,MANIFEST='actual-manifest'))
  value=m.financial_current(types.SimpleNamespace(financial=n,fo=fo,config={'financialReceiptSha256':sha}))
  self.assertTrue(value['financialQualified']);self.assertEqual(calls,['snapshot','model','monotonic','immutable'])
  self.assertFalse(value['sourceActorQualified'])
 def test_fresh_whole_read_graph_and_all_columns_use_actual_leaf_body(self):
  readtest=load('ypal-ordinary-read-admission-v5b.test.py');n=readtest.namespace();_,_,after=readtest.fixture()
  config={'admissionSha256':'1'*64,'readPlanSha256':'2'*64,'readContextInputSha256':'3'*64}
  parts={'host':types.SimpleNamespace(catalog=lambda:copy.deepcopy(after)),'rehearsal':{'after':copy.deepcopy(after)},'reference':{'receiptSha256':config['admissionSha256']},'plan':{'missingCount':71}}
  a=object.__new__(m.Authority);a.read_parts=(config.copy(),n,parts)
  a.read_target_sql='genuine-target-fixture';a.read_target={'marker':{'identity':'actual'}};a.read_query=lambda sql:copy.deepcopy(a.read_target)
  with tempfile.TemporaryDirectory()as tmp:
   f=Path(tmp)/'actual-ref';f.write_text('private-immutable-ref');a.read_record_paths={str(f)};a.read_records=m.file_frame(a.read_record_paths)
   self.assertTrue(a._read_current(config)['validated'])
   after['allColumnAcl'].append({'foreign':'column'})
   with self.assertRaises(RuntimeError):a._read_current(config)
   after['allColumnAcl'].clear();f.write_text('changed-private-ref')
   with self.assertRaisesRegex(RuntimeError,'immutable_read'):a._read_current(config)
 def test_V5_data_identity_uses_genuine_creator_projection_and_refuses_marker_drift(self):
  creator=ast.parse((HERE/'ypal-ordinary-readview-v5.py').read_text())
  body=next(v for v in creator.body if isinstance(v,ast.FunctionDef)and v.name=='data_current')
  identity=next(v for v in body.body if isinstance(v,ast.FunctionDef)and v.name=='identity')
  namespace={};exec(compile(ast.fix_missing_locations(ast.Module(body=[identity],type_ignores=[])),'genuine_creator_identity','exec'),namespace)
  value={'schemaOid':'77370532','marker':{'read_identity':'V5'},'relations':[{'oid':'100','name':'token','acl':'original'}],'functions':[{'oid':'101','definition':'genuine','acl':'original'}],'nonownerPermissions':71}
  self.assertEqual(m.read_data_identity(value),namespace['identity'](value))
  changed=copy.deepcopy(value);changed['relations'][0]['acl']='changed';changed['nonownerPermissions']=72
  self.assertEqual(m.read_data_identity(value),m.read_data_identity(changed))
  changed['marker']['read_identity']='foreign';self.assertNotEqual(m.read_data_identity(value),m.read_data_identity(changed))
 def test_retired_deadline_activation_or_job_is_never_accepted(self):
  units=['retired-'+str(i)+'.timer'for i in range(12)]
  def output(active='inactive'):
   return ('\n\n'.join('Id='+unit+'\nLoadState=not-found\nActiveState='+active+'\nJob='for unit in units)+'\n').encode()
  with patch.object(m,'command',return_value=output()),patch.object(m.os.path,'lexists',return_value=False):
   self.assertEqual(len(m.retired_frame(units)),12)
   with patch.object(m,'command',return_value=output('active')):
    with self.assertRaisesRegex(RuntimeError,'terminal_and_jobless'):m.retired_frame(units)
   with patch.object(m,'command',return_value=output().replace(b'Job=',b'Job=123')):
    with self.assertRaisesRegex(RuntimeError,'terminal_and_jobless'):m.retired_frame(units)
 def test_actual_cap0_process_peer_reads_current_proc_without_values_or_sockets(self):
  # Execute the exact production peer body under a numeric disposable local
  # UID, supplying its own actual PID. No production identity or path is used.
  program='import io,json,os,sys\nsys.stdin=io.StringIO(json.dumps({"uid":65534,"gid":65534,"pids":[os.getpid()],"sourcePid":None,"mounts":{}}))\n'+m.PROCESS_PEER
  result=subprocess.run(['/usr/bin/setpriv','--reuid=65534','--regid=65534','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs','/usr/bin/env','-i','/usr/bin/python3','-I','-B','-c',program],capture_output=True,timeout=8)
  self.assertEqual(result.returncode,0,result.stderr.decode());value=json.loads(result.stdout)
  self.assertTrue(value['capabilitiesZero']);self.assertTrue(value['noNewPrivileges']);self.assertEqual(len(value['processes']),1)
  row=next(iter(value['processes'].values()));self.assertGreater(row['startTicks'],0);self.assertEqual(row['uid'],['65534']*4);self.assertEqual(row['groups'],[]);self.assertTrue(row['cgroup'].startswith('0::'))
  states={m.SOURCE:{'ControlGroup':row['cgroup'][3:]}};pids={m.SOURCE:[row['pid']]}
  self.assertTrue(m.kernel_cgroups(states,pids,[value]))
  changed=copy.deepcopy(value);next(iter(changed['processes'].values()))['cgroup']+='-foreign'
  with self.assertRaisesRegex(RuntimeError,'kernel_cgroup'):m.kernel_cgroups(states,pids,[changed])
  self.assertNotIn('PATH=',result.stdout.decode());self.assertNotIn('program',row)
  a,_,_=self.guard();a.expected={'process':{'groups':[]}};a._snapshot=lambda:{'process':{'groups':[65534]}}
  with self.assertRaisesRegex(RuntimeError,'sameactor_private'):a.current()
 def test_qualification_journals_are_exclusive_and_default_has_zero_effects(self):
  with tempfile.TemporaryDirectory()as tmp:
   path=Path(tmp)/'private.json';m.exclusive(path,{'actual':'private'})
   self.assertEqual(path.stat().st_mode&0o777,0o600)
   with self.assertRaises(FileExistsError):m.exclusive(path,{'replacement':True})
  result=subprocess.run(['/usr/bin/python3','-I','-B',str(HERE/'ypal-ordinary-source-authority-v3.py')],capture_output=True,timeout=5,check=True)
  self.assertTrue(json.loads(result.stdout)['staticOnly']);self.assertEqual(json.loads(result.stdout)['serviceActions'],0)

 def test_actual_two_source_missing_EnvironmentFiles_require_typed_empty_and_no_other_missing_keys(self):
  units=[m.SOURCE,m.FRESH,*['route-'+str(i)+'.service'for i in range(9)]]
  rows={unit:{key:''for key in m.IDENTITY_FIELDS}for unit in units}
  for index,(unit,row)in enumerate(rows.items()):
   row.update(Id=unit,LoadState='loaded',ActiveState='active',SubState='running',ControlPID='0',MainPID=str(100+index),InvocationID=str(index).zfill(32))
   if unit in{m.SOURCE,m.FRESH}:del row['EnvironmentFiles']
   else:row['EnvironmentFiles']='/synthetic/route.env (ignore_errors=no)'
  output=lambda:('\n\n'.join('\n'.join(key+'='+value for key,value in row.items())for row in rows.values())+'\n').encode()
  good={'Service':{'EnvironmentFiles':{'type':'a(sb)','data':[]}}}
  with patch.object(m,'command',side_effect=lambda *args:output()),patch.object(m,'properties',return_value=good)as typed:
   actual=m.state_batch(units);self.assertEqual(typed.call_count,2)
   self.assertEqual(actual[m.SOURCE]['EnvironmentFiles'],[]);self.assertEqual(actual[m.FRESH]['EnvironmentFiles'],[])
   for value in[{'type':'a(sb)','data':[['/foreign',False]]},{'type':'as','data':[]},{'data':[]},None]:
    with patch.object(m,'properties',return_value={'Service':{'EnvironmentFiles':value}}):
     with self.assertRaisesRegex(RuntimeError,'actual_typed_empty_array'):m.state_batch(units)
   del rows[m.SOURCE]['Group']
   with self.assertRaisesRegex(RuntimeError,'all_same_acknowledged'):m.state_batch(units)
   rows[m.SOURCE]['Group']='';del rows[units[2]]['EnvironmentFiles']
   with self.assertRaises(RuntimeError):m.state_batch(units)

 def test_actual_three_cgroup_families_keep_literal_backslashes_and_refuse_unknown_paths(self):
  combined='yunipals-combined-rpc@base.service';market='yunipals-market-production-rpc@bnb.service'
  self.assertEqual(m.fixed_cgroup(m.SOURCE),'/system.slice/'+m.SOURCE)
  self.assertEqual(m.fixed_cgroup(combined),r'/system.slice/system-yunipals\x2dcombined\x2drpc.slice/'+combined)
  self.assertEqual(m.fixed_cgroup(market),r'/system.slice/system-yunipals\x2dmarket\x2dproduction\x2drpc.slice/'+market)
  for unknown in['other.service','yunipals-combined-rpc@unknown.service','../yunipals-ypal-base-rpc.service']:
   with self.assertRaises(RuntimeError):m.fixed_cgroup(unknown)
  # The real process_frame reaches the actual cgroup read for the exact
  # accepted template path, rather than rejecting that path as v2 did.
  states={combined:{'ControlGroup':m.fixed_cgroup(combined),'MainPID':'101'}}
  with patch.object(Path,'read_text',side_effect=RuntimeError('reached_exact_cgroup_file')):
   with self.assertRaisesRegex(RuntimeError,'reached_exact_cgroup_file'):m.process_frame(states,{})
  states[combined]['ControlGroup']='/system.slice/'+combined
  with self.assertRaisesRegex(RuntimeError,'exact_fixed'):m.process_frame(states,{})

if __name__=='__main__':unittest.main(verbosity=2)
