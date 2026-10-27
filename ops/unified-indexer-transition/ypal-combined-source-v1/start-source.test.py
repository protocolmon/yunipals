import ast,importlib.util,unittest,tempfile,os,hashlib,copy
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('source_owner',HERE/'start-source.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Controls(unittest.TestCase):
 def test_exact_accepted_old_capabilities_are_distinct_from_zero_new_policy(self):
  priv={'Uid':'970 970 970 970','Gid':'964 964 964 964','Groups':'964','NoNewPrivs':'1','CapPrm':'0000','CapEff':'0000','CapAmb':'0000','CapInh':'0001','CapBnd':'0002'};pins={k:m.sha(priv[k].encode())for k in ['CapInh','CapBnd']}
  self.assertEqual(m.OLD_CAPABILITY_SHA256,{'CapInh':'f2da78b49f1566ebca881c763328012aee1f1e48070862ed835ab22d8aa1ff3e','CapBnd':'d984c7de822c5fcb3a5b069faac937cf92a47564dfb77c5b528dd70cd9e98cf9'})
  with patch.object(m,'OLD_CAPABILITY_SHA256',pins):
   m.source_privileges(m.OLD,priv)
   with self.assertRaisesRegex(RuntimeError,'exact_legacy_or_zero_new'):m.source_privileges(m.NEW,priv)
   wrong={**priv,'CapInh':'0003'}
   with self.assertRaisesRegex(RuntimeError,'exact_legacy_or_zero_new'):m.source_privileges(m.OLD,wrong)
   zero={**priv,'CapInh':'0000','CapBnd':'0000'};m.source_privileges(m.NEW,zero)
   for name in [m.OLD,m.NEW]:
    with self.assertRaisesRegex(RuntimeError,'bounded_unprivileged'):m.source_privileges(name,{**priv,'CapEff':'0001'})
 def test_old_stop_cas_runs_after_real_durable_intent(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'BASE',Path(t)),patch.object(m,'manager')as manager:
   actor={'pid':1};original=m.save
   class H:
    def actor(self,name):return actor
   def save(p,v,*args):
    value=original(p,v,*args)
    if p.name=='stop-old-intent.json':actor['pid']=2
    return value
   with patch.object(m,'save',side_effect=save):
    with self.assertRaisesRegex(RuntimeError,'same_original_source_immediately_before_stop'):m.step('stop-old',lambda:m.stop_old_owned(H(),{'oldActor':{'pid':1}}))
   manager.assert_not_called();self.assertTrue((Path(t)/'stop-old-intent.json').exists());self.assertFalse((Path(t)/'stop-old-result.json').exists())
 def test_new_inverse_stop_cas_runs_after_real_durable_intent(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'BASE',Path(t)),patch.object(m,'manager')as manager:
   actor={'pid':1};original=m.save
   def save(p,v,*args):
    value=original(p,v,*args)
    if p.name=='inverse-stop-new-intent.json':actor['pid']=2
    return value
   with patch.object(m,'save',side_effect=save),patch.object(m,'new_owned',side_effect=lambda *a:actor):
    with self.assertRaisesRegex(RuntimeError,'same_owned_new_source_immediately_before_stop'):m.inverse_step('inverse-stop-new',lambda:m.stop_new_owned(None,{}, {'pid':1}),lambda:self.fail('no stop'),False)
   manager.assert_not_called();self.assertTrue((Path(t)/'inverse-stop-new-intent.json').exists());self.assertFalse((Path(t)/'inverse-stop-new-result.json').exists())
 def test_retained_private_file_changes_are_rejected_before_start(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t:
   p=Path(t).absolute()/'runtime.env';p.write_bytes(b'synthetic-only');op={'oldActor':{'pid':9,'processes':[{'pid':9,'environmentFileHashes':{str(p):m.sha(p.read_bytes())}}]}}
   m.old_private_inputs(op);p.write_bytes(b'changed-synthetic-only')
   with self.assertRaisesRegex(RuntimeError,'original_private_inputs_changed_before_source_start'):m.old_private_inputs(op)
 def test_new_source_peer_allows_node_file_missing_keys_but_refuses_conflicts(self):
  tree=ast.parse(m.PUBLIC_ENV_PEER);fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='matches_public_environment');scope={};exec(compile(ast.Module(body=[fn],type_ignores=[]),'<actual_fixed_peer>','exec'),scope);match=scope['matches_public_environment'];expected={'BOOSTER_ENGINE_ADDRESS':'fresh','NODE_OPTIONS':'--max-old-space-size=4096'}
  self.assertTrue(match({},expected));self.assertTrue(match({b'BOOSTER_ENGINE_ADDRESS':b'fresh'},expected));self.assertFalse(match({b'BOOSTER_ENGINE_ADDRESS':b'old'},expected));self.assertFalse(match({b'NODE_OPTIONS':b'--other'},expected));self.assertTrue(match({b'UNRELATED':b'ignored'},expected))
 def test_shared_real_transition_lock_excludes_route_inverse(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'TRANSITION_LOCK',Path(t)/'transition.lock'):
   with m.transition_lock():
    with self.assertRaisesRegex(RuntimeError,'transition_in_progress'):
     with m.transition_lock():self.fail('concurrent route/source transition')
   with m.transition_lock():pass
 def test_shared_lock_rejects_symlink_and_broad_permissions(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'TRANSITION_LOCK',Path(t)/'lock'):
   p=Path(t)/'lock';p.write_text('');p.chmod(0o644)
   with self.assertRaisesRegex(RuntimeError,'protected_shared_transition_lock_required'):
    with m.transition_lock():pass
   p.unlink();p.symlink_to(Path(t)/'foreign')
   with self.assertRaises(OSError):
    with m.transition_lock():pass
 def test_actual_root_sticky_lock_parent_allowed_but_nonsticky_writable_refused(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'TRANSITION_LOCK',Path(t)/'lock'):
   p=Path(t);p.chmod(0o1777)
   with m.transition_lock():pass
   p.chmod(0o777)
   with self.assertRaisesRegex(RuntimeError,'protected_shared_transition_lock_parent'):
    with m.transition_lock():pass
   p.chmod(0o700)
 def test_transition_lock_fd_path_race_is_refused(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'TRANSITION_LOCK',Path(t)/'lock'):
   p=Path(t)/'lock'
   def replace(*args):p.unlink();m.save(p,b'foreign')
   with patch.object(m.fcntl,'flock',side_effect=replace):
    with self.assertRaisesRegex(RuntimeError,'shared_transition_lock_replaced'):
     with m.transition_lock():pass
 def test_finish_inverse_reuses_only_identical_owned_unlink_intent(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'BASE',Path(t)):
   record={'owned':'exact'};m.finish_unlink_intent('intent.json',record,False);m.finish_unlink_intent('intent.json',record,True)
   for value,finish in [({'foreign':'intent'},True),(record,False)]:
    with self.assertRaisesRegex(RuntimeError,'exact_owned_unlink_intent_for_finish'):m.finish_unlink_intent('intent.json',value,finish)
 def test_real_restore_finishes_boot_unit_and_post_unlink_prefixes_once(self):
  for prefix in ['boot-intent','unit-intent','unit-removed']:
   with self.subTest(prefix=prefix),tempfile.TemporaryDirectory(dir=HERE)as t:
    root=Path(t);base=root/'receipts';base.mkdir();unit=root/'new.service';unit.write_bytes(b'exact new unit');oldboot=root/'old-boot';oldboot.symlink_to('/exact/old.service');newboot=root/'new-boot';newboot.symlink_to(str(unit));oldrecord=m.link_record(oldboot);newrecord=m.link_record(newboot);installed={'unitIdentity':m.identity(unit),'areaIdentity':{'owned':'retained'}};op={'oldBoot':oldrecord,'oldFiles':{'old':'exact'}};state={'loaded':True};actions=[]
    class H:
     def state(self,name):
      if name==m.OLD:return{'MainPID':'77'}
      return{'MainPID':'0','ControlPID':'0','Job':'','ActiveState':'inactive','DropInPaths':'','FragmentPath':str(unit)if state['loaded']else'','LoadState':'loaded'if state['loaded']else'not-found'}
     def files(self,s):return{str(unit):m.sha(unit.read_bytes())}
    def manager(action,name=None):actions.append((action,name));self.assertEqual(action,'daemon-reload');state['loaded']=False
    with patch.object(m,'BASE',base),patch.object(m,'UNIT',unit),patch.object(m,'NEW_LINK',newboot),patch.object(m,'OLD_LINK',oldboot),patch.object(m,'TEMPLATE_SHA',m.sha(unit.read_bytes())),patch.object(m,'load_operation',return_value=op),patch.object(m,'check_preserved'),patch.object(m,'old_restored',return_value={'pid':77}),patch.object(m,'manager',side_effect=manager):
     m.save(base/'inverse-intent.json',{'bootId':m.boot()});m.save(base/'start-new-intent.json',{'monotonicUs':1});m.save(base/'installed.json',installed);m.save(base/'new-boot-prepared.json',newrecord)
     m.save(base/'inverse-stop-new-result.json',{'completed':True});m.save(base/'inverse-load-boot-result.json',{'completed':True})
     if prefix=='boot-intent':m.save(base/'inverse-new-boot-unlink-intent.json',newrecord)
     else:
      newboot.unlink();m.save(base/'inverse-remove-new-unit-intent.json',installed)
      if prefix=='unit-removed':unit.unlink()
     result=m.restore(H(),'owned-operation',True);self.assertTrue(result['completed']);self.assertFalse(os.path.lexists(newboot));self.assertFalse(unit.exists());m.exact_link(oldboot,oldrecord);self.assertEqual(actions,[('daemon-reload',None)])
 def test_actual_absent_unit_missing_execstart_is_narrowly_supported(self):
  tree=ast.parse((HERE/'start-source.py').read_text());fn=next(n for n in ast.walk(tree)if isinstance(n,ast.FunctionDef)and n.name=='state');keys=ast.literal_eval(next(n.value for n in fn.body if isinstance(n,ast.Assign)and any(isinstance(v,ast.Name)and v.id=='keys'for v in n.targets)))
  fields={k:''for k in keys if k!='ExecStart'};fields.update(Id=m.NEW,LoadState='not-found',ActiveState='inactive',SubState='dead',MainPID='0',ControlPID='0');raw=lambda:'\n'.join(k+'='+v for k,v in fields.items()).encode()
  class Runner:
   def run(self,*a,**kw):return raw()
  class H:m=Runner()
  self.assertEqual(m.Host.state(H(),m.NEW)['ExecStart'],'')
  for key,value in [('LoadState','loaded'),('SubState','failed'),('Job','1'),('FragmentPath','/foreign.service')]:
   before=fields[key];fields[key]=value
   with self.assertRaisesRegex(RuntimeError,'complete_two_source_properties'):m.Host.state(H(),m.NEW)
   fields[key]=before
 def test_umask077_runtime_is_traversable_and_only_cache_source_owned(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t:
   root=Path(t);root.chmod(0o755);base=root/'receipts';base.mkdir();area=root/'runtime';unit=root/'new.service';template=root/'template';template.write_text('public unit\n')
   class H:
    def state(self,name):return{'MainPID':'0','FragmentPath':str(unit),'DropInPaths':'','Job':'','RuntimeMaxUSec':'infinity','MemoryMax':'6442450944'}
   with patch.object(m,'AREA',area),patch.object(m,'BASE',base),patch.object(m,'UNIT',unit),patch.object(m,'TEMPLATE',template),patch.object(m,'manager'),patch.object(m.os,'chown')as chown:
    previous=os.umask(0o077)
    try:m.install(H())
    finally:os.umask(previous)
   self.assertEqual(area.stat().st_mode&0o777,0o755);self.assertEqual(area.stat().st_uid,0)
   for name in ['cache','cache/.ponder','cache/.vite-temp']:
    p=area/name;self.assertEqual(p.stat().st_mode&0o777,0o750);self.assertIn(unittest.mock.call(p,970,964),chown.call_args_list)
   self.assertIn(unittest.mock.call(area/'cache/ponder-env.d.ts',970,964),chown.call_args_list)
   self.assertEqual((area/'cache/ponder-env.d.ts').stat().st_mode&0o777,0o600)
 def test_manager_refuses_restart_and_other_services(self):
  for action,name in [('restart',m.OLD),('stop','yunipals-booster-ypal-source.service'),('start','yunipals-booster-api.service')]:
   with self.assertRaisesRegex(RuntimeError,'source_only_manager'):m.manager(action,name)
 def test_boot_inverse_restores_the_same_real_symlink_inode(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t:
   root=Path(t);original=root/'boot';backup=root/'saved';os.symlink('/exact/original.service',original);record=m.link_record(original);os.link(original,backup,follow_symlinks=False);original.unlink();m.exact_link(backup,record);os.link(backup,original,follow_symlinks=False);m.exact_link(original,record);self.assertEqual(original.lstat().st_ino,backup.lstat().st_ino)
 def test_foreign_boot_inode_is_not_removed_or_adopted(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t:
   p=Path(t)/'boot';os.symlink('/same/target',p);record=m.link_record(p);p.unlink();os.symlink('/same/target',p)
   # Ensure identity changed even on filesystems immediately reusing an inode.
   record['identity']['st_ino']-=1
   with self.assertRaisesRegex(RuntimeError,'exact_owned_boot'):m.exact_link(p,record)
   self.assertTrue(p.is_symlink())
 def test_unknown_stop_ACK_is_observed_without_a_second_stop(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'BASE',Path(t)):
   calls=[];state={'terminal':False}
   def stop():calls.append('stop');state['terminal']=True;raise RuntimeError('lost_ACK')
   def observe():self.assertTrue(state['terminal']);return 'terminal'
   with self.assertRaisesRegex(RuntimeError,'lost_ACK'):m.inverse_step('inverse-stop-new',stop,observe,False)
   self.assertEqual(m.inverse_step('inverse-stop-new',stop,observe,True),'terminal');self.assertEqual(calls,['stop'])
 def test_unknown_start_ACK_is_not_repeated_or_fabricated(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'BASE',Path(t)):
   calls=[];state={'active':False}
   def start():calls.append('start');state['active']=True;raise RuntimeError('lost_ACK')
   def observe():self.assertTrue(state['active']);return 'owned_running'
   with self.assertRaisesRegex(RuntimeError,'lost_ACK'):m.inverse_step('inverse-start-old',start,observe,False)
   self.assertEqual(m.inverse_step('inverse-start-old',start,observe,True),'owned_running');self.assertEqual(calls,['start'])
 def test_unknown_start_without_actual_running_proof_stays_refused(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'BASE',Path(t)):
   m.save(Path(t)/'inverse-start-old-intent.json',{'bootId':m.boot()})
   def refuse():raise RuntimeError('still_terminal')
   with self.assertRaisesRegex(RuntimeError,'still_terminal'):m.inverse_step('inverse-start-old',lambda:self.fail('repeated start'),refuse,True)
   self.assertFalse((Path(t)/'inverse-start-old-result.json').exists())
 def test_stopped_old_source_accepts_actual_systemd_GC_fields(self):
  class H:
   def state(self,name):return{'MainPID':'0','ControlPID':'0','ActiveState':'inactive','Job':'','InvocationID':'','ExecMainStartTimestampMonotonic':'0'}
   def files(self,s):return{'exact':'old'}
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'OLD_LINK',Path(t)/'absent'),patch.object(m,'OLD','local-fixture-source.service'):
   value=m.Host.old_terminal(H(),{'oldFiles':{'exact':'old'},'oldActor':{'pid':2147483646}});self.assertEqual(value['MainPID'],'0')
 def test_stopped_source_does_not_accept_changed_definitions(self):
  class H:
   def state(self,name):return{'MainPID':'0','ControlPID':'0','ActiveState':'inactive','Job':''}
   def files(self,s):return{'foreign':'change'}
  with self.assertRaisesRegex(RuntimeError,'owned_old_source_terminal'):m.Host.old_terminal(H(),{'oldFiles':{'exact':'old'},'oldActor':{'pid':2147483646}})
 def test_bootstrap_requires_real_checkpoint_and_keeps_framework_readiness_separate(self):
  class H:
   def native(self):return{'app':{'build_id':m.BUILD,'is_dev':0,'is_locked':1,'is_ready':0,'heartbeat_at':100},'clock':100,'tables':{str(i):{'owner':'73004621','kind':'r'}for i in range(44)},'checkpoints':{'56':'actual_checkpoint'}}
  with patch.object(m,'new_owned',return_value={'owned':'actor'}):
   a,n=m.bootstrap(H(),{});self.assertEqual(n['app']['is_ready'],0)
   class Missing(H):
    def native(self):v=super().native();v['checkpoints']=None;return v
   with self.assertRaisesRegex(RuntimeError,'actual_checkpoint'):m.bootstrap(Missing(),{})
 def test_same_native_schema_and_nonregressed_points_are_required(self):
  class H:
   def old_native(self):return{'schemaOid':'1','app':{'build_id':'bf4939b3ff'},'checkpoints':{'56':'0002'}}
  op={'oldNative':{'schemaOid':'1','checkpoints':{'56':'0001'}}};self.assertEqual(m.Host.preserved_old_native(H(),op)['schemaOid'],'1');op['oldNative']['checkpoints']['56']='0003'
  with self.assertRaisesRegex(RuntimeError,'original_native_schema'):m.Host.preserved_old_native(H(),op)
 def test_new_source_requires_exact_argv_and_start_intent(self):
  text=(HERE/'yunipals-ypal-combined-source.service.example').read_bytes();args=m.shlex.split(next(x.split('=',1)[1]for x in text.decode().splitlines()if x.startswith('ExecStart=')));command=m.sha(('\0'.join(args[2:])+'\0').encode())
  class H:
   def __init__(self):self.restart='0';self.command=command;self.started=20;self.memory='6442450944'
   def state(self,name):return{'FragmentPath':str(m.UNIT),'DropInPaths':'','MemoryMax':self.memory,'RuntimeMaxUSec':'infinity','NRestarts':self.restart}
   def files(self,state):return{str(m.UNIT):m.TEMPLATE_SHA}
   def public_environment(self,actor):return{}
   def actor(self,name,env=None):return{'pid':9,'startMonotonicMicroseconds':self.started,'processes':[{'pid':9,'commandSha256':self.command}]}
  h=H()
  with patch.object(m,'protected',return_value=text),patch.object(m,'expected_env',return_value={}),patch.object(m,'document',return_value={'monotonicUs':10}):
   self.assertEqual(m.new_owned(h,{},True)['pid'],9);h.command='foreign'
   with self.assertRaisesRegex(RuntimeError,'actual_new_source_argv'):m.new_owned(h,{})
   h.command=command;h.started=9
   with self.assertRaisesRegex(RuntimeError,'follow_owned_start'):m.new_owned(h,{})
 def test_owned_inverse_can_stop_restarted_source_but_first_ack_cannot(self):
  text=(HERE/'yunipals-ypal-combined-source.service.example').read_bytes();args=m.shlex.split(next(x.split('=',1)[1]for x in text.decode().splitlines()if x.startswith('ExecStart=')));command=m.sha(('\0'.join(args[2:])+'\0').encode())
  class H:
   def state(self,name):return{'FragmentPath':str(m.UNIT),'DropInPaths':'','MemoryMax':'6442450944','RuntimeMaxUSec':'infinity','NRestarts':'1'}
   def files(self,state):return{str(m.UNIT):m.TEMPLATE_SHA}
   def public_environment(self,actor):return{}
   def actor(self,name,env=None):return{'pid':9,'startMonotonicMicroseconds':20,'processes':[{'pid':9,'commandSha256':command}]}
  with patch.object(m,'protected',return_value=text),patch.object(m,'expected_env',return_value={}),patch.object(m,'document',return_value={'monotonicUs':10}):
   self.assertEqual(m.new_owned(H(),{},False)['pid'],9)
   with self.assertRaisesRegex(RuntimeError,'first_source_start_must_be_pristine'):m.new_owned(H(),{},True)
 def test_source_role_or_retained_frame_drift_is_refused(self):
  class H:
   def policy(self):return{}
   def role(self):return{'limit':33}
   def preserved(self):return{'same':'frame'}
  with patch.object(m,'static_inputs'),patch.object(m,'old_private_inputs'),patch.object(m,'base_code',return_value={}):
   with self.assertRaisesRegex(RuntimeError,'source_role_old_routes'):m.check_preserved(H(),{'sourceCode':{},'sourceRole':{'limit':32},'retained':{'same':'frame'}})
 def test_source_code_drift_prevents_manager_actions_in_inverse(self):
  class H:
   def policy(self):return{}
   def role(self):return{'limit':32}
   def preserved(self):return{'same':'frame'}
  op={'sourceCode':{'exact':'original'},'sourceRole':{'limit':32},'retained':{'same':'frame'}}
  with patch.object(m,'load_operation',return_value=op),patch.object(m,'static_inputs'),patch.object(m,'old_private_inputs'),patch.object(m,'base_code',return_value={'foreign':'code'}),patch.object(m,'manager')as manager:
   with self.assertRaisesRegex(RuntimeError,'source_role_old_routes'):m.restore(H(),'pin')
   manager.assert_not_called()
 def test_inverse_preservation_does_not_depend_on_new_route_health(self):
  class H:
   def policy(self):raise RuntimeError('new_routes_down')
   def role(self):return{'limit':32}
   def preserved(self):return{'same':'frame'}
  op={'sourceCode':{},'sourceRole':{'limit':32},'retained':{'same':'frame'}}
  with patch.object(m,'static_inputs'),patch.object(m,'old_private_inputs'),patch.object(m,'base_code',return_value={}):
   m.check_preserved(H(),op,False)
   with self.assertRaisesRegex(RuntimeError,'new_routes_down'):m.check_preserved(H(),op)
 def test_forward_lost_start_ack_reconciliation_never_starts_again(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t:
   base=Path(t);boot=base/'published';op={'old':'owned'};actor={'pid':9};native={'checkpoint':'actual'}
   class H:
    def old_terminal(self,op):return{}
    def preserved_old_native(self,op):return{}
    def fresh_actor(self):return{'pid':8}
    def sessions(self,actors):return{'new':[9],'fresh':[8]}
   with patch.object(m,'BASE',base),patch.object(m,'NEW_LINK',boot),patch.object(m,'load_operation',return_value=op),patch.object(m,'check_preserved'),patch.object(m,'bootstrap',return_value=(actor,native)),patch.object(m,'manager',return_value=None)as manager,patch.object(m,'acknowledge',return_value={'completed':True})as ack:
    actual_starts=[]
    def start_once():actual_starts.append('start');raise RuntimeError('lost_start_ACK')
    with self.assertRaisesRegex(RuntimeError,'lost_start_ACK'):m.step('start-new',start_once)
    self.assertTrue((base/'start-new-intent.json').exists());self.assertFalse((base/'start-new-result.json').exists())
    result=m.reconcile_start(H(),'ownedpin');self.assertTrue(result['completed']);self.assertEqual(actual_starts,['start']);self.assertEqual(manager.call_args_list,[unittest.mock.call('daemon-reload')]);self.assertEqual(m.document(base/'start-new-result.json')['newStartCommands'],0);ack.assert_called_once()
 def test_forward_unknown_start_does_not_adopt_wrong_actual_actor(self):
  with tempfile.TemporaryDirectory(dir=HERE)as t,patch.object(m,'BASE',Path(t)),patch.object(m,'load_operation',return_value={}),patch.object(m,'check_preserved'),patch.object(m,'bootstrap',side_effect=RuntimeError('wrong_actor')),patch.object(m,'manager')as manager:
   class H:
    def old_terminal(self,op):return{}
    def preserved_old_native(self,op):return{}
   with self.assertRaisesRegex(RuntimeError,'wrong_actor'):m.reconcile_start(H(),'pin')
   manager.assert_not_called();self.assertFalse((Path(t)/'start-new-result.json').exists())
if __name__=='__main__':unittest.main()
