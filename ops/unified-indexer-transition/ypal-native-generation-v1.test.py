#!/usr/bin/env python3
"""Finite operator controls; no production, systemd, database or providers."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2];PATH=ROOT/'ops/unified-indexer-transition/ypal-native-generation-v1.py'
spec=importlib.util.spec_from_file_location('native_generation',PATH);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setUp(self):
  self.work=tempfile.TemporaryDirectory();self.base=Path(self.work.name);self.oldbase=m.BASE;m.BASE=self.base
  self.files={};self.calls=[]
  self.s=types.SimpleNamespace(document=self.document,protected=lambda p,limit=1000000:PATH.read_bytes()if Path(p)==PATH else self.files[str(p)],save=self.save,boot=lambda:'boot',sync=lambda _:None)
 def tearDown(self):m.BASE=self.oldbase;self.work.cleanup()
 def save(self,path,value,*_):
  raw=value if isinstance(value,bytes)else m.encoded(value);Path(path).parent.mkdir(parents=True,exist_ok=True)
  with Path(path).open('xb')as f:f.write(raw)
  self.files[str(path)]=raw;return m.sha(raw)
 def document(self,path,pin=None):
  raw=self.files.get(str(path),Path(path).read_bytes()if Path(path).exists()else None)
  if raw is None:raise FileNotFoundError(path)
  if pin is not None and m.sha(raw)!=pin:raise RuntimeError('fixture_pin_changed')
  return json.loads(raw)
 def test_no_generic_publication_or_leaderboard_execution_phase(self):
  self.assertEqual(m.PHASES,('drain','capsule','reconcile-capsule','build','reconcile-build','accept-candidate','restore-activation','reconcile-start'))
  self.assertNotIn('restoreGenerationRecovery',m.BRIDGE);self.assertIn("v.phase==='capsule'",m.BRIDGE)
 def test_readonly_bridge_rejects_mutating_phase_before_subprocess(self):
  with self.assertRaisesRegex(RuntimeError,'only_readonly_capsule_inspection_allowed'):m.read_bridge(None,'capsule',{})
 def test_unit_has_one_shot_only_policy_and_owned_monitor(self):
  h=types.SimpleNamespace(m=types.SimpleNamespace(PROJECT=Path('/public/accepted/app'),CLEAN={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC'}))
  text=m.unit_bytes(h).decode();self.assertIn('RuntimeMaxSec=1500',text);self.assertIn('Restart=no',text);self.assertIn('KillMode=control-group',text)
  self.assertIn('CapabilityBoundingSet=\nAmbientCapabilities=\n',text);self.assertNotIn('[Install]',text);self.assertNotIn('generation-refresh.mjs',text)
 def test_start_intent_prevents_second_build_before_any_manager_action(self):
  self.save(self.base/(m.UNIT+'-start-intent.json'),{'owned':True});self.save(self.base/'capsule-result.json',{'preservedGenerations':['103','102']})
  h=types.SimpleNamespace(qualify=lambda:None,s=self.s,manager=lambda *a:self.calls.append(a))
  with patch.object(m,'drained',lambda *_:None):
   with self.assertRaisesRegex(RuntimeError,'owned_generation_build_never_repeated'):m.build(h,{})
  self.assertEqual(self.calls,[])
 def test_global_pointer_stamp_wallet_and_generation_binding_are_all_required(self):
  receipt={'currentGeneration':'103','previousGeneration':'102','generationBindingSha256':'bound','walletStats':{'count':'1','sha256':'a'},'derivedStamps':{'count':'2','sha256':'b'}}
  observation={'pointer':{'current_id':'103','previous_id':'102'},'generationBindingSha256':'bound','walletStats':{'count':'1','sha256':'a'},'derivedStamps':{'count':'2','sha256':'b'}}
  for field in ['pointer','generationBindingSha256','walletStats','derivedStamps']:
   altered=copy.deepcopy(observation);altered[field]='foreign'
   with patch.object(m,'read_bridge',lambda *_:altered):
    with self.assertRaisesRegex(RuntimeError,'original_global_generation_wallets_and_stamps_must_remain_unchanged'):m.read_only_capsule(None,receipt)
  with patch.object(m,'read_bridge',lambda *_:observation):self.assertEqual(m.read_only_capsule(None,receipt),observation)
 def fixture_leaf(self):
  validation={'sourceSnapshot':{'readIdentity':'read-fixture','predecessor':'103'}}
  self.g={'state':'ready','published_at':None,'metadata_release_id':'archive','ownership_release_id':'release','ownership_read_identity':'read-fixture','validation':validation}
  op={'operatorSha256':m.sha(PATH.read_bytes()),'readAdmissionSha256':'read','metadataOperationSha256':'meta-op','metadataSelectedSha256':'meta-selected','metadataProvenanceSha256':'provenance'}
  op_sha=self.save(self.base/'operation.json',op)
  capsule={'currentGeneration':'103','previousGeneration':'102','generationBindingSha256':'bound','walletStats':{'count':'1','sha256':'a'},'derivedStamps':{'count':'2','sha256':'b'}};cap_sha=self.save(self.base/'capsule-result.json',capsule)
  baseline={'pointer':{'current_id':'103','previous_id':'102'},'generationBindingSha256':'bound','walletStats':{'count':'1','sha256':'a'},'derivedStamps':{'count':'2','sha256':'b'}}
  result={'format':'yunipals-ypal-native-generation-candidate-v1','completed':True,'built':True,'validated':True,'published':False,'publicationAllowed':False,'operatorSha256':op['operatorSha256'],'operationSha256':op_sha,'readAdmissionSha256':'read','metadataOperationSha256':'meta-op','metadataSelectedSha256':'meta-selected','metadataProvenanceSha256':'provenance','installSha256':'installed','capsuleResultSha256':cap_sha,'generationId':'104','metadataReleaseId':'archive','sourceRelease':'release','readIdentity':'read-fixture','generationValidationSha256':m.sha(m.encoded(validation)),'sourceSnapshot':validation['sourceSnapshot'],'predecessorGenerationId':'103','originalGlobalObservation':baseline}
  result_sha=self.save(self.base/'candidate-result.json',result)
  self.s.load_operation=lambda _:dict(rpcOwnerSha256='rpc',rpcResultSha256='routes',hostBuildResultSha256='build')
  self.s.Host=lambda *_:types.SimpleNamespace(query=lambda _:self.g)
  installer=types.SimpleNamespace(shared=lambda:types.SimpleNamespace(),installed=lambda *_:None)
  modules=lambda path,_:installer if path==m.INSTALL_FILE else self.s
  bridges=lambda h,phase,data:({'validated':True}if phase=='verify-capsule'else baseline)
  return result_sha,modules,bridges
 def test_database_leaf_remains_independent_of_cache_actor_and_143_full_guard(self):
  pin,modules,bridge=self.fixture_leaf()
  with patch.object(m,'module',modules),patch.object(m,'read_bridge',bridge):
   result=m.validate_candidate_database_current(pin)
  self.assertTrue(result['validated']);self.assertFalse(result['sourceReadinessQualified']);self.assertFalse(result['readAdmissionGraphQualified']);self.assertFalse(result['cacheActorQualified']);self.assertFalse(result['published'])
 def test_candidate_database_leaf_refuses_published_or_changed_validation(self):
  pin,modules,bridge=self.fixture_leaf()
  with patch.object(m,'module',modules),patch.object(m,'read_bridge',bridge):
   for field,value in [('published_at','now'),('state','failed'),('ownership_read_identity','foreign'),('validation',{})]:
    before=copy.deepcopy(self.g);self.g[field]=value
    with self.assertRaisesRegex(RuntimeError,'candidate_database_identity_or_validation_changed'):m.validate_candidate_database_current(pin)
    self.g=before
 def test_candidate_database_leaf_refuses_changed_global_context(self):
  pin,modules,bridge=self.fixture_leaf()
  def wrong(h,phase,data):
   value=bridge(h,phase,data)
   if phase=='observe':value={**value,'generationBindingSha256':'foreign'}
   return value
  with patch.object(m,'module',modules),patch.object(m,'read_bridge',wrong):
   with self.assertRaisesRegex(RuntimeError,'original_global_generation_wallets_and_stamps_must_remain_unchanged'):m.validate_candidate_database_current(pin)
 def link(self,path):
  st=Path(path).lstat();return {'target':os.readlink(path),'device':st.st_dev,'inode':st.st_ino,'mode':st.st_mode,'uid':st.st_uid,'gid':st.st_gid}
 def actor_fixture(self,boot):
  writer={'state':{'MainPID':'42'},'definitions':{'unit':'sha'},'configuredEnvironmentSha256':'env'}
  def actor():
   return {'writer':copy.deepcopy(writer),'unit':{'UnitFileState':'enabled'if os.path.lexists(boot)else'disabled','WantedBy':'multi-user.target'if os.path.lexists(boot)else'','ActiveState':'active','MainPID':'42','ExecMainStartTimestampMonotonic':'100'},'main':{'pid':42,'startTicks':100},'processes':[{'pid':42,'startTicks':100}]}
  return actor
 def test_drain_rechecks_exact_actor_after_durable_stop_intent(self):
  oldbase=m.BASE;oldboot=m.BOOT;m.BASE=self.base/'owned';m.BOOT=self.base/'boot';m.BOOT.symlink_to('/etc/systemd/system/'+m.LEADER)
  actor=self.actor_fixture(m.BOOT);old=actor();binding={'oldActor':old,'oldBoot':self.link(m.BOOT)}
  def race():
   a=actor()
   if(m.BASE/'stop-old-intent.json').exists():a['main']['pid']=99
   return a
  h=types.SimpleNamespace(s=self.s,qualify=lambda:None,actor=race,meta=types.SimpleNamespace(link=self.link),manager=lambda *a:self.calls.append(a),h=types.SimpleNamespace(sessions=lambda _:dict(owned=[{'pid':1,'backendStart':'captured'}],otherPeers=[])))
  try:
   with self.assertRaisesRegex(RuntimeError,'generation_actor_changed_after_stop_intent'):m.drain(h,binding)
   self.assertEqual(self.calls,[('daemon-reload',)]);self.assertTrue((m.BASE/'drain-sessions.json').exists());self.assertFalse(m.BOOT.exists());self.assertTrue((m.BASE/'original-boot-link').is_symlink())
  finally:m.BASE=oldbase;m.BOOT=oldboot
 def test_partial_drain_live_original_restores_only_boot_without_start(self):
  oldboot=m.BOOT;m.BOOT=self.base/'boot';m.BOOT.symlink_to('/etc/systemd/system/'+m.LEADER)
  actor=self.actor_fixture(m.BOOT);op={'oldActor':actor(),'oldBoot':self.link(m.BOOT)};os.rename(m.BOOT,self.base/'original-boot-link')
  inverse={'restored':True,'oldWriter':{'meta':'original'}};self.files[str(m.META_BASE/'inverse-result.json')]=m.encoded(inverse)
  h=types.SimpleNamespace(s=self.s,qualify=lambda **_:None,private=lambda _:None,actor=actor,state=lambda:actor()['unit'],manager=lambda *a:self.calls.append(a),args=types.SimpleNamespace(metadata_inverse=m.sha(m.encoded(inverse))),meta=types.SimpleNamespace(UNIT='metadata',state=lambda _:{'ActiveState':'active'},link=self.link),m=types.SimpleNamespace(snapshot=lambda _:({'meta':'original'},None)))
  try:
   result=m.restore_activation(h,op)
   self.assertTrue(result);self.assertEqual(self.calls,[('daemon-reload',)]);self.assertEqual(self.link(m.BOOT),op['oldBoot']);self.assertTrue(self.document(self.base/'activation-restored.json')['originalRemainedRunning'])
  finally:m.BOOT=oldboot
 def test_lost_original_start_ack_reconciliation_never_starts_again(self):
  oldboot=m.BOOT;m.BOOT=self.base/'boot';m.BOOT.symlink_to('/etc/systemd/system/'+m.LEADER)
  actor=self.actor_fixture(m.BOOT);op={'oldActor':actor(),'oldBoot':self.link(m.BOOT)}
  self.save(self.base/'original-boot-publish-intent.json',op['oldBoot']);self.save(self.base/'original-start-intent.json',{'boot':op['oldBoot'],'monotonicUs':1})
  inverse={'restored':True,'oldWriter':{'meta':'original'}};self.files[str(m.META_BASE/'inverse-result.json')]=m.encoded(inverse)
  h=types.SimpleNamespace(s=self.s,qualify=lambda **_:None,private=lambda _:None,actor=actor,state=lambda:actor()['unit'],manager=lambda *a:self.calls.append(a),args=types.SimpleNamespace(metadata_inverse=m.sha(m.encoded(inverse))),meta=types.SimpleNamespace(UNIT='metadata',state=lambda _:{'ActiveState':'active'},link=self.link),m=types.SimpleNamespace(snapshot=lambda _:({'meta':'original'},None)))
  try:
   result=m.restore_activation(h,op,True);self.assertTrue(result);self.assertEqual(self.calls,[])
  finally:m.BOOT=oldboot
 def manager_properties(self,loaded=False):
  raw=(ROOT/'ops/unified-indexer-transition/ypal-native-metadata-handover-v1.py').read_bytes();self.assertEqual(m.sha(raw),m.META_SHA)
  tree=ast.parse(raw);props=next(ast.literal_eval(n.value)for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(x,ast.Name)and x.id=='PROPS'for x in n.targets))
  values={key:''for key in props};values.update(Id=m.UNIT,LoadState='loaded'if loaded else'not-found',ActiveState='inactive',SubState='dead',MainPID='0',ControlPID='0',Job='',FragmentPath='/unit'if loaded else'',DropInPaths='',KillMode='control-group')
  values.pop('EnvironmentFiles');values.pop('ExecStart')if not loaded else None
  return props,values
 def test_exact_not_found_unit_missing_array_and_exec_are_bounded(self):
  props,values=self.manager_properties();h=m.Host.__new__(m.Host);h.meta=types.SimpleNamespace(PROPS=props);h.m=types.SimpleNamespace(run=lambda args:m.encoded({'type':'a(sb)','data':[['foreign',False]]})if'get-property'in args else'\n'.join(k+'='+v for k,v in values.items()).encode())
  result=h.state(m.UNIT);self.assertEqual(result['EnvironmentFiles'],[]);self.assertEqual(result['ExecStart'],'')
  values['MainPID']='1'
  with self.assertRaisesRegex(RuntimeError,'typed_empty_generation_unit_environment_required|complete_generation_unit_state_required'):h.state(m.UNIT)
 def test_loaded_empty_environment_requires_exact_typed_array(self):
  props,values=self.manager_properties(True);h=m.Host.__new__(m.Host);h.meta=types.SimpleNamespace(PROPS=props)
  typed={'type':'a(sb)','data':[]};h.m=types.SimpleNamespace(run=lambda args:m.encoded(typed)if 'get-property'in args else'\n'.join(k+'='+v for k,v in values.items()).encode())
  self.assertEqual(h.state(m.UNIT)['EnvironmentFiles'],[])
  typed['data']=[['foreign',False]]
  with self.assertRaisesRegex(RuntimeError,'typed_empty_generation_unit_environment_required'):h.state(m.UNIT)
 def test_capacity_monitor_retains_accepted_safety_algorithms(self):
  old=ast.parse((ROOT/'ops/unified-indexer-transition/consumer-generation-v4-capacity-watch.py').read_text());new=ast.parse((ROOT/'ops/unified-indexer-transition/ypal-generation-capacity-watch-v1.py').read_text())
  funcs=lambda tree:{n.name:ast.dump(n,include_attributes=False)for n in tree.body if isinstance(n,ast.FunctionDef)}
  a,b=funcs(old),funcs(new)
  for name in ['identity','backend_query','no_overlap_window','available','write','protected_inputs','stop_owned']:
   self.assertEqual(a[name],b[name],name)
  constants={n.targets[0].id:ast.literal_eval(n.value)for n in new.body if isinstance(n,ast.Assign)and isinstance(n.targets[0],ast.Name)and n.targets[0].id in{'MIN_RESERVE','ABORT_FREE','MAX_SECONDS'}}
  self.assertEqual(constants,{'MIN_RESERVE':25000000000,'ABORT_FREE':30000000000,'MAX_SECONDS':1470})
  source=(ROOT/'ops/unified-indexer-transition/ypal-generation-capacity-watch-v1.py').read_text();self.assertIn('dist/generation-prepare.mjs',source);self.assertNotIn('generation-refresh.mjs',source);self.assertNotIn('leaderboard-only.mjs',source)

if __name__=='__main__':unittest.main()
