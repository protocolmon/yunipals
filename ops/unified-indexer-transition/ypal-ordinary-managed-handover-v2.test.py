"""Finite local filesystem/lifecycle tests. No production, service or provider calls."""
import ast
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

HERE=Path(__file__).parent

def load(name):
    p=HERE/name;spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
m=load('ypal-ordinary-managed-handover-v2.py');f=load('ypal-ordinary-managed-runtime-v2.py');old=load('ypal-managed-handover-v1.py')
fixture=load('ypal-managed-handover-v1.test.py');foundation_fixture=load('ypal-ordinary-managed-runtime-v2.test.py')


def primitives():return m.lifecycle_primitives((HERE/m.TEMPLATE.name).read_bytes(),Path(m.__file__))

def owner(root):
    o=m.Owner.__new__(m.Owner);o.input_sha='a'*64;o.m=primitives();o.m.BASE=root;o.m.HOLD=root/'hold';o.m.boot=lambda:'boot';o.m.mono=lambda:100
    o.f=f;o.h=types.SimpleNamespace();o.o=types.SimpleNamespace();o.mapper=m.terminal_mapper((HERE/m.KERNEL.name).read_bytes(),m.KERNEL)
    for name in m.OWNER_METHODS:setattr(o,name,getattr(o.m.Owner,name).__get__(o))
    o.put('operation.json',{**o.envelope(),'reviewBinding':{},'reviewHash':m.sha(m.encoded({}))})
    return o


class Controls(unittest.TestCase):
    def test_default_has_no_constructor_effects(self):
        v=subprocess.run(['/usr/bin/python3','-I','-B',m.__file__],capture_output=True,text=True,check=True)
        value=json.loads(v.stdout);self.assertTrue(value['sourceOnly']);self.assertEqual(value['serviceActions'],0)

    def test_exact_dependency_pins(self):
        for name,pin in [(m.FOUNDATION.name,m.FOUNDATION_SHA),(m.TEMPLATE.name,m.TEMPLATE_SHA),(m.KERNEL.name,m.KERNEL_SHA)]:
            self.assertEqual(m.sha((HERE/name).read_bytes()),pin)
        self.assertEqual(m.sha((HERE.parent/'solana-acceptance'/m.INVENTORY.name).read_bytes()),m.INVENTORY_SHA)

    def test_finite_reused_bodies_exclude_old_authority_and_full_inverse(self):
        n=primitives();self.assertEqual(n.BASE,m.BASE);self.assertEqual(n.HOLD,m.HOLD)
        self.assertFalse(hasattr(n.Host,'__init__') and n.Host.__init__ is not object.__init__)
        for name in ['review','drain','install','inverse','leaves','private_inputs','routes','current']:
            self.assertFalse(hasattr(n.Owner,name));self.assertFalse(hasattr(n.Host,name))
        for name in m.OWNER_METHODS-{'stop_exact','finish_stop','move_owned','publish_file'}:self.assertEqual(getattr(n.Owner,name).__code__.co_code,getattr(old.Owner,name).__code__.co_code)
        for name in m.HOST_METHODS:self.assertEqual(getattr(n.Host,name).__code__.co_code,getattr(old.Host,name).__code__.co_code)
        with self.assertRaises(RuntimeError):m.lifecycle_primitives((HERE/m.TEMPLATE.name).read_bytes()+b'# drift',Path(m.__file__))

    def test_terminal_mapper_keeps_actual_kernel_join_only_two_roles(self):
        n=m.terminal_mapper((HERE/m.KERNEL.name).read_bytes(),m.KERNEL)
        ctx=n.Context();ctx.query=Mock(side_effect=AssertionError('no query'))
        with self.assertRaisesRegex(RuntimeError,'only_two'):ctx.terminal_sessions({'processes':[]},'73036832')
        self.assertFalse(hasattr(n.Context,'scope'));self.assertFalse(hasattr(n.Context,'__init__') and n.Context.__init__ is not object.__init__)

    def test_manager_scope_never_touches_observer_or_other_services(self):
        o=m.Owner.__new__(m.Owner);o.m=types.SimpleNamespace(command=Mock(return_value=b''))
        for action,unit in [('start',m.OBSERVER),('stop','other.service'),('restart',m.PARENT)]:
            with self.assertRaises(RuntimeError):o.manager(action,unit)
        o.m.command.assert_not_called();o.manager('start',m.PARENT)
        self.assertEqual(o.m.command.call_args.kwargs['timeout'],130)

    def test_stop_captures_fresh_sessions_and_final_actor_CAS(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o=owner(Path(d));actor={'pid':1};calls=[];active=[actor]
            o.h.actor=lambda unit,allow=False:active[0]
            o.h.sessions=lambda actors:(calls.append('sessions') or {'current':actors})
            o.h.sessions_gone=lambda proof:calls.append('gone')
            o.h.manager=lambda action,unit:(calls.append('stop'),active.__setitem__(0,None))
            o.stop_exact(m.SOURCE,actor,'drain');self.assertEqual(calls,['sessions','stop','gone'])
            self.assertTrue(o.has('drain-intent.json'));o.finish_stop(m.SOURCE,actor,'drain');self.assertEqual(calls.count('stop'),1)

    def test_lost_stop_ACK_observation_never_reissues_stop(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o=owner(Path(d));actor={'pid':1};active=[actor];calls=[]
            o.h.actor=lambda *args:active[0];o.h.sessions=lambda _:{};o.h.sessions_gone=lambda _:None
            def command(*_):active[0]=None;calls.append('stop');raise TimeoutError()
            o.h.manager=command
            with self.assertRaises(TimeoutError):o.stop_exact(m.SOURCE,actor,'drain')
            self.assertFalse(o.has('drain-result.json'));o.finish_stop(m.SOURCE,actor,'drain');self.assertEqual(calls,['stop'])

    def test_postintent_actor_replacement_refuses_before_stop(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o=owner(Path(d));actor={'pid':1};o.h.actor=Mock(side_effect=[actor,{'pid':2}]);o.h.sessions=lambda _:{};o.h.manager=Mock()
            with self.assertRaisesRegex(RuntimeError,'post_intent'):o.stop_exact(m.SOURCE,actor,'drain')
            o.h.manager.assert_not_called();self.assertTrue(o.has('drain-intent.json'))

    def test_real_file_move_preserves_inode_and_unknown_rename_reconciles_only(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o=owner(Path(d));a=Path(d)/'old';b=Path(d)/'held';a.write_bytes(b'exact');before=o.m.identity(a)
            o.move_owned(a,b,before,'move');self.assertEqual(o.m.identity(b),before)
            with self.assertRaises(RuntimeError):o.move_owned(a,b,before,'move')
            o.move_owned(a,b,before,'move',True);self.assertEqual(b.read_bytes(),b'exact')

    def test_foreign_restore_destination_is_never_overwritten(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o=owner(Path(d));a=Path(d)/'old';b=Path(d)/'held';a.write_bytes(b'original');b.write_bytes(b'foreign')
            with self.assertRaises(RuntimeError):o.move_owned(a,b,o.m.identity(a),'move')
            self.assertEqual(a.read_bytes(),b'original');self.assertEqual(b.read_bytes(),b'foreign')

    def test_start_existing_intent_refuses_before_any_manager_or_snapshot(self):
        o=m.Owner.__new__(m.Owner);o.has=lambda _:True;o.frozen=Mock();o.h=types.SimpleNamespace(manager=Mock())
        with self.assertRaisesRegex(RuntimeError,'existing_start_intent'):o.start()
        o.frozen.assert_not_called();o.h.manager.assert_not_called()

    def test_reconcile_start_only_observes_real_foundation_and_preserves_ACK(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)),patch.object(f,'BASE',Path(d)/'foundation'):
            o=owner(Path(d));o.operation=lambda:{'native':'old'};o.stable=lambda _:None;o.installed=lambda:None
            o.put('parent-start-intent.json',o.envelope(notBeforeUs=100,operationSha256=o.digest('operation.json'),native={'x':1}))
            o.put('drained.json',{'solana':fixture.solana()});o.h.state=lambda _:{'ExecMainStartTimestampMonotonic':'101'}
            o.h.sql_solana=lambda _:fixture.solana();o.h.manager=Mock(side_effect=AssertionError('no manager'))
            o.o=types.SimpleNamespace(h=types.SimpleNamespace(r=types.SimpleNamespace(recovery_floor=lambda *_:None)))
            snap={'binding':{'currentManagedEpoch':{'pid':123,'unit':{}}},'native':{'x':2}}
            o.owned_parent_for_stop=lambda:copy.deepcopy(snap['binding']['currentManagedEpoch'])
            def begin():f.BASE.mkdir();return None
            o.foundation=types.SimpleNamespace(snapshot=lambda:copy.deepcopy(snap),begin=begin,record=lambda _:{'binding':copy.deepcopy(snap['binding'])})
            o.observe_start();saved=(Path(d)/'parent-observed.json').read_bytes();o.observe_start()
            self.assertEqual(saved,(Path(d)/'parent-observed.json').read_bytes());o.h.manager.assert_not_called()
            snap['binding']['currentManagedEpoch']['pid']=124
            with self.assertRaises(RuntimeError):o.observe_start()

    def test_changed_or_preintent_managed_epoch_refuses_before_foundation(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o=owner(Path(d));o.stable=lambda _:None;o.installed=lambda:None;o.put('parent-start-intent.json',o.envelope(notBeforeUs=100,operationSha256=o.digest('operation.json')))
            o.h.state=lambda _:{'ExecMainStartTimestampMonotonic':'99'};o.foundation=types.SimpleNamespace(snapshot=Mock())
            with self.assertRaisesRegex(RuntimeError,'after_own_intent'):o.observe_start()
            o.foundation.snapshot.assert_not_called()

    def partial_parent(self):
        o=m.Owner.__new__(m.Owner);o.f=f;o.m=primitives();o.installed=lambda:None;o.get=lambda _: {'notBeforeUs':100}
        p=foundation_fixture.process(10,[f.NODE,str(f.STAGE/'launcher.mjs')],1)
        a={'unit':{'ExecMainStartTimestampMonotonic':'101'},'parent':p,'processes':[p]}
        o.h=types.SimpleNamespace(actor=lambda _:a);return o,a

    def test_partial_failed_child_parent_can_be_owned_for_inverse(self):
        o,a=self.partial_parent();self.assertEqual(o.owned_parent_for_stop(),a)
        envs=[*o.m.ENV_FILES[:3],str(f.ORDINARY_ENV)];a['processes'].append(foundation_fixture.process(11,f.source_arguments(envs),10,f.PROJECT))
        self.assertEqual(o.owned_parent_for_stop(),a)

    def test_partial_parent_refuses_foreign_program_or_capability(self):
        for key,value in [('argv',['/bin/false']),('capabilitiesZero',False),('uid',0)]:
            o,a=self.partial_parent();a['parent'][key]=value
            with self.assertRaises(RuntimeError):o.owned_parent_for_stop()
        o,a=self.partial_parent();a['processes'].append(foundation_fixture.process(11,['/bin/sleep','2'],10))
        with self.assertRaises(RuntimeError):o.owned_parent_for_stop()

    def test_terminal_inverse_requires_residual_kernel_attribution_not_global_shared_zero(self):
        o=m.Owner.__new__(m.Owner);seen=[]
        class Context:
            def terminal_sessions(self,a,role):seen.append(role);return {'otherLiveKernelPeers':[{'pid':99}]}
        o.mapper=types.SimpleNamespace(Context=Context);o.o=types.SimpleNamespace(h=types.SimpleNamespace(observer='kernel'))
        o.h=types.SimpleNamespace(query=lambda _:0,sql_solana=lambda:{'workerLock':{'granted':0,'waiting':0}})
        self.assertEqual(o.terminal_backends()['solanaResidual']['otherLiveKernelPeers'],[{'pid':99}]);self.assertEqual(seen,['16388'])
        o.h.query=lambda _:1
        with self.assertRaises(RuntimeError):o.terminal_backends()

    def inverse_fixture(self,d):
        o=owner(Path(d));op=o.operation();old={m.SOURCE:{'old':1},m.SOLANA:{'old':2}}
        op.update(units=old,activations={},unitDefinitionFrames={});o.operation=lambda:op;o.stable=lambda _:None
        o.put('inverse-intent.json',o.envelope(operationSha256=o.digest('operation.json')))
        native=foundation_fixture.native(2000,1900);sol=fixture.solana()
        o.put('inverse-drained.json',o.envelope(native=native,solana=sol,solanaFrozen=True))
        actors={m.SOURCE:{'unit':{'NRestarts':'0'},'pid':11},m.SOLANA:{'unit':{'NRestarts':'0'},'pid':12}}
        for unit in [m.SOURCE,m.SOLANA]:
            o.put('drain-'+unit+'-intent.json',{})
            o.put('inverse-start-'+unit+'-intent.json',o.envelope(notBeforeUs=100,operationSha256=o.digest('operation.json'),native=foundation_fixture.native(1000,900)))
        o.put('inverse-reload-intent.json',{'operationSha256':o.digest('operation.json'),'bootId':'boot','value':{}})
        o.stop_managed=Mock(side_effect=AssertionError('already drained'));o.finish_stop=Mock(side_effect=AssertionError('already restarted'))
        o.restore_files=lambda *_:None;o.restored_files=lambda *_:None;o.original_actor=lambda unit,intent:actors[unit]
        o.h=types.SimpleNamespace(actor=lambda unit,*_:None if unit==m.PARENT else actors[unit],manager=Mock(side_effect=AssertionError('no command')),
             native=lambda:native,sessions=lambda *_:{'73004621':{'owned':{m.SOURCE:[{'pid':10}]}}},sql_solana=lambda *_:sol)
        o.o=types.SimpleNamespace(h=types.SimpleNamespace(r=types.SimpleNamespace(recovery_floor=lambda *_:None)))
        o.restored_current=lambda digest:{'receipt':digest};return o,actors

    def test_finish_inverse_after_lost_old_start_ACK_observes_only_and_never_restops(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o,actors=self.inverse_fixture(d);result=o.inverse(True)
            self.assertTrue(result['receipt']);o.h.manager.assert_not_called();o.stop_managed.assert_not_called();o.finish_stop.assert_not_called()
            self.assertEqual(o.get('inverse-result.json')['actors'],actors)

    def test_unknown_inverse_without_explicit_finish_refuses_before_effects(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o,_=self.inverse_fixture(d)
            with self.assertRaisesRegex(RuntimeError,'explicit_finish'):o.inverse(False)
            o.h.manager.assert_not_called()

    def file_install_fixture(self,d):
        root=Path(d);o=owner(root);system=root/'system';system.mkdir();wants=system/'multi-user.target.wants';wants.mkdir()
        hold=root/'hold';hold.mkdir(mode=0o700);stage=root/'stage';stage.mkdir()
        raw=(HERE/'ypal-ordinary-managed-indexer-v1/yunipals-indexer.service.example').read_bytes()
        (stage/'yunipals-indexer.service.example').write_bytes(raw)
        o.m.SYSTEM=system;o.m.HOLD=hold
        originals={}
        for unit in o.m.WRITERS:
            paths=[]
            if unit in {m.SOURCE,m.SOLANA,m.PARENT}:
                path=system/unit;path.write_text('original '+unit);paths.append(path)
                os.symlink('../'+unit,wants/unit)
            if unit==m.PARENT:
                drop=system/(unit+'.d');drop.mkdir();path=drop/'legacy.conf';path.write_text('retained original drop');paths.append(path)
            originals[unit]=paths
        def activation(unit):
            return {'boot':o.m.link_record(wants/unit), 'definitions':{str(p):{'identity':o.m.identity(p),'sha256':m.sha(p.read_bytes())} for p in originals[unit] if p.exists()}}
        op=o.operation();op.update(activations={u:activation(u) for u in o.m.WRITERS});o.operation=lambda:op
        o.h.activation=activation;o.h.boot_link=lambda unit:wants/unit;o.h.manager=Mock(return_value=None)
        o.f=types.SimpleNamespace(STAGE=stage,PUBLIC=f.PUBLIC,protected=lambda path,pin:Path(path).read_bytes())
        o.frozen=lambda:None;o.installed=lambda:{'actual':'loaded six mount foundation separately tested'}
        return o,op,system,hold,wants

    def test_real_install_and_exact_inverse_preserve_all_old_boot_and_definition_inodes(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)),patch.object(m,'HOLD',Path(d)/'hold'):
            o,op,system,hold,wants=self.file_install_fixture(d);o.install()
            self.assertEqual(m.sha((system/m.PARENT).read_bytes()),f.PUBLIC['yunipals-indexer.service.example'])
            self.assertFalse((wants/m.SOURCE).exists());self.assertFalse((wants/m.SOLANA).exists())
            self.assertNotEqual(o.m.identity(wants/m.PARENT),op['activations'][m.PARENT]['boot']['identity'])
            o.restore_files(op,False)
            for unit,before in op['activations'].items():
                self.assertEqual(o.h.activation(unit),before)
            o.restore_files(op,True)
            self.assertEqual(o.h.manager.call_args_list[0].args,('daemon-reload',))
            self.assertTrue((hold/'managed-unit.removed').exists())

    def test_unknown_reload_after_install_still_has_exact_file_inverse(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)),patch.object(m,'HOLD',Path(d)/'hold'):
            o,op,system,hold,wants=self.file_install_fixture(d);o.h.manager=Mock(side_effect=TimeoutError())
            with self.assertRaises(TimeoutError):o.install()
            self.assertTrue(o.has('reload-managed-intent.json'));self.assertFalse(o.has('installed.json'))
            o.restore_files(op,False)
            for unit,before in op['activations'].items():self.assertEqual(o.h.activation(unit),before)
            self.assertEqual(o.h.manager.call_count,1)

    def test_inverse_never_overwrites_foreign_replacement_at_new_unit_path(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)),patch.object(m,'HOLD',Path(d)/'hold'):
            o,op,system,hold,wants=self.file_install_fixture(d);o.install()
            target=system/m.PARENT;target.rename(hold/'external-rename');target.write_text('foreign')
            with self.assertRaises(RuntimeError):o.restore_files(op,False)
            self.assertEqual(target.read_text(),'foreign')

    def test_actual_recorded_PID_epoch_still_alive_refuses_even_empty_cgroup(self):
        o=m.Owner.__new__(m.Owner);o.mapper=m.terminal_mapper((HERE/m.KERNEL.name).read_bytes(),m.KERNEL)
        actual=o.mapper.process(os.getpid())
        with self.assertRaisesRegex(RuntimeError,'still_live'):o.known_gone({'processes':[actual]})
        o.known_gone({'processes':[{**actual,'startTicks':actual['startTicks']-1}]})

    def test_terminal_stop_ACK_does_not_accept_escaped_recorded_process(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o=owner(Path(d));a={'processes':[o.mapper.process(os.getpid())]};active=[a]
            o.h.actor=lambda *args:active[0];o.h.sessions=lambda _:{};o.h.sessions_gone=Mock()
            o.h.manager=lambda *_:active.__setitem__(0,None)
            with self.assertRaisesRegex(RuntimeError,'still_live'):o.stop_exact(m.SOURCE,a,'drain')
            o.h.sessions_gone.assert_not_called();self.assertFalse(o.has('drain-result.json'))
            with self.assertRaisesRegex(RuntimeError,'still_live'):o.finish_stop(m.SOURCE,a,'drain')

    def test_atomic_rename_racing_target_preserves_both_files(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o=owner(Path(d));a=Path(d)/'original';b=Path(d)/'target';a.write_bytes(b'original')
            def race(source,target):Path(target).write_bytes(b'racing foreign');m.rename_no_replace(source,target)
            o.m.rename_no_replace=race
            with self.assertRaises(FileExistsError):o.move_owned(a,b,o.m.identity(a),'race')
            self.assertEqual(a.read_bytes(),b'original');self.assertEqual(b.read_bytes(),b'racing foreign')
            self.assertFalse(o.has('race-result.json'))

    def test_real_TCP_mapper_handles_host_addresses_in_both_copied_SQL_cores(self):
        import ipaddress
        spec=importlib.util.spec_from_file_location('actual_socket_join',HERE.parent/'booster-launch/ypal-old-runtime-inventory-v1.py')
        join=importlib.util.module_from_spec(spec);spec.loader.exec_module(join)
        row={'pid':22,'backendStart':'epoch','clientAddress':'127.0.0.1','clientPort':12345}
        tcp={12:{'clientAddress':'127.0.0.1','clientPort':12345,'transport':'tcp'}}
        def fds(pids,uid,gid):return {str(pid):{'socketInodes':[12 if pid==11 else 32],'startTicks':99} for pid in pids}
        obs=types.SimpleNamespace(peer_fds=fds,unix_peers=lambda _: {},tcp_clients=lambda *args:tcp,map_owned_backends=join.map_owned_backends,
             run=lambda args:b'' if '-xHn' in args or '-xHnp' in args else b'ESTAB 0 0 127.0.0.1:12345 127.0.0.1:5432 users:(("node",pid=11,fd=4))')
        def query(sql):
            if 'pg_locks' in sql:return []
            self.assertIn('host(client_addr)',sql);self.assertNotIn('client_addr::text',sql)
            return [copy.deepcopy(row)] if 'usesysid=16388' in sql else []
        n=primitives();h=n.Host();h.raw=types.SimpleNamespace(observer=obs);h.query=query
        result=h.sessions({'writer':{'processes':[{'pid':11,'uid':0,'gid':0}]}},False)
        self.assertEqual(result['16388']['owned']['writer'][0]['pid'],22)
        kernel=m.terminal_mapper((HERE/m.KERNEL.name).read_bytes(),m.KERNEL);ctx=kernel.Context();ctx.query=query
        ctx.host=types.SimpleNamespace(h=types.SimpleNamespace(observer=obs))
        with patch.object(kernel,'process',side_effect=lambda pid:{'pid':pid,'startTicks':99}),patch.object(kernel,'proc_status',return_value={'uid':[0]*4,'gid':[0]*4}):
            result=ctx.terminal_sessions({'processes':[]},'16388')
        self.assertTrue(result['kernelPeerAttribution']);self.assertEqual(result['otherLiveKernelPeers'][0]['pid'],22)
        with self.assertRaises(ValueError):join.map_owned_backends(fds([11],0,0),fds([22],111,113),[{**row,'clientAddress':'127.0.0.1/32'}],{},tcp)

    def test_restored_current_rechecks_own_start_heartbeat_freshness(self):
        with tempfile.TemporaryDirectory(dir=HERE) as d,patch.object(m,'BASE',Path(d)):
            o,_=self.inverse_fixture(d);o.inverse(True)
            o.restored_current=m.Owner.restored_current.__get__(o)
            pin=o.digest('inverse-result.json');self.assertTrue(o.restored_current(pin)['currentWriterQualified'])
            old=o.h.native();o.h.native=lambda:{**old,'clock':old['clock']+180001}
            with self.assertRaisesRegex(RuntimeError,'heartbeat'):o.restored_current(pin)

    def test_untouched_partial_inverse_uses_real_original_start_heartbeat_floor(self):
        o=m.Owner.__new__(m.Owner);o.f=f;o.has=lambda _:False
        o.o=types.SimpleNamespace(journal=lambda name:{'preStartDatabaseClock':1000,'predecessorHeartbeat':900})
        o.restored_heartbeat(foundation_fixture.native(1200,1100))
        for n in [foundation_fixture.native(200000,1100),foundation_fixture.native(1200,950)]:
            with self.assertRaises(RuntimeError):o.restored_heartbeat(n)

    def test_legacy_typed_configuration_is_bound_to_real_stage_even_while_terminal(self):
        o=m.Owner.__new__(m.Owner);o.m=primitives();typed={'EnvironmentFiles':[['/fixed1',False],['/fixed2',False]],'LoadCredential':[],'Environment':[]}
        worker=b'exact original worker';path=str(o.m.SYSTEM/m.SOLANA)
        review={'binding':{'sourceInputs':{path:{'sha256':'a'*64}},'typedConfiguredPropertiesSha256':m.sha(json.dumps(typed,sort_keys=True,separators=(',',':')).encode())}}
        o.inventory=types.SimpleNamespace(FILES=['/fixed1','/fixed2'],LEGACY=Path('/synthetic'),WORKER_SHA=m.sha(worker),command=Mock(),
             observer=lambda:types.SimpleNamespace(typed_properties=lambda *args,**kwargs:typed),read=lambda *args:(worker,[1]),state=Mock(side_effect=AssertionError('must not need running')))
        o.m.document=lambda _:review;o.h=types.SimpleNamespace(definitions=lambda _:{path:{'sha256':'a'*64}},retained_solana_auth=lambda:{'actual':'stage'})
        o.legacy_inputs();o.inventory.state.assert_not_called()
        typed['Environment'].append('SOLANA_RPC_DAILY_CREDIT_LIMIT=99999')
        with self.assertRaisesRegex(RuntimeError,'staged_typed'):o.legacy_inputs()

    def test_forward_completion_does_not_claim_scheduled_or_consumer_acceptance(self):
        source=Path(m.__file__).read_text()
        for text in ['scheduledSolanaPublicationQualified=False','consumerAcceptanceQualified=False','supervisedRestartQualified=False']:
            self.assertIn(text,source)
        self.assertNotIn('oldStandaloneReceiptRelabelled=True',source)
        self.assertNotIn('self.foundation.core.leaves',source)


if __name__=='__main__':unittest.main()
