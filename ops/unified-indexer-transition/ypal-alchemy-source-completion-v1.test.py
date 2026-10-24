#!/usr/bin/env python3
"""Focused real frozen-method seams, own start intent, and filesystem cleanup."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).absolute().parent


def load(name):
    spec=importlib.util.spec_from_file_location(name.replace('.','_'),HERE/name)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


s=load('ypal-alchemy-source-completion-v1.py');t=load('ypal-alchemy-source-switch-v1.test.py')
v=load('ypal-alchemy-source-switch-v2.py');a=load('ypal-alchemy-controlpid-adapter-v1.py');host=load('ypal-alchemy-source-switch-v1.host.py')


class Focused(t.Fixture):
    def completion_fixture(self):
        own=self.root/'completion';own.mkdir(mode=0o700);hold=self.root/'hold-completion';hold.mkdir(mode=0o700)
        zz=self.root/'source.d'/'zz-source-completion-bindings-v1.conf';zz.parent.mkdir();t.p.exclusive(zz,b'[Service]\nBindPaths=/cache:/inside\n',0o644)
        for name,value in [('BASE',own),('HOLD',hold),('ZZ',zz)]:
            q=patch.object(s,name,value);q.start();self.patches.append(q)
        self.m.save=lambda path,value:t.p.exclusive(path,t.o.encoded(value));self.m.sync=t.p.sync
        self.m.NAMESPACE={t.p.PROJECT+'/.ponder':'/fixed/cache',t.p.PROJECT+'/node_modules/.vite-temp':'/fixed/vite',t.p.PROJECT+'/ponder-env.d.ts':'/fixed/env',
            t.p.PROJECT+'/ponder.config.ts':'/fixed/config',t.p.PROJECT+'/lib/boosters/config.ts':'/fixed/boosters',t.p.PROJECT+'/lib/unified/rpc-preflight.ts':'/fixed/original-transport'}
        self.op['sourceDefinitions']={'/fixed/source.service':{'sha256':'d'*64,'identity':{}}};self.op['sourceOverlay']={'sha256':'e'*64,'identity':{}}
        self.op['sourceRuntime']={'BindPaths':'historical-render','MemoryMax':'6GiB'};self.runtime={**self.op['sourceRuntime'],'BindPaths':'actual-append-render'}
        self.op['source']['parent']['argv']=['/fixed/node','--env-file=/fixed/first','--env-file=/fixed/second','--env-file=/fixed/third',t.p.PROJECT+'/node_modules/ponder/dist/esm/bin/ponder.js','start']
        pairs=list(self.m.NAMESPACE.items());self.op['sourceBindings']={'BindPaths':{'type':'a(ssbt)','data':[[backing,inside,False,16384]for inside,backing in pairs[:3]]},
            'BindReadOnlyPaths':{'type':'a(ssbt)','data':[[backing,inside,False,16384]for inside,backing in pairs[3:]]},'EnvironmentFiles':{'type':'a(sb)','data':[]}}
        self.bindings=copy.deepcopy(self.op['sourceBindings']);self.bindings['BindReadOnlyPaths']['data'][2][0]=str(t.p.OPS/'ypal-rpc-deadline-host-build-v1/rpc-preflight.ts')
        argv=list(self.op['source']['parent']['argv']);argv.insert(argv.index(t.p.PROJECT+'/node_modules/ponder/dist/esm/bin/ponder.js'),'--env-file='+str(t.p.STAGE/'source.public.env'))
        self.bindings['ExecStart']={'type':'a(sasbttttuii)','data':[['/usr/bin/env',['/usr/bin/env','-i',*argv],False,0,0,0,0,0,0,0]]}
        self.m.command=lambda args:json.dumps(self.bindings[args[-1]]).encode()
        self.m.link_record=lambda path:self.op['sourceBoot'];self.h.r.BOOT='/fixed/boot'
        self.h.source.runtime_properties=lambda:copy.deepcopy(self.runtime)
        self.h.source.state=lambda unit:{'MainPID':'0','ControlPID':'0','NRestarts':'0','Job':'','ExecMainStartTimestampMonotonic':'1'}
        item={'path':str(zz),'sha256':t.o.sha(t.p.read(zz)),'identity':t.leaf.file_identity(zz)}
        self.h.definitions=lambda state:{**self.op['sourceDefinitions'],str(t.o.SOURCE_DROP):self.op['sourceOverlay'],str(zz):{'sha256':item['sha256'],'identity':item['identity']}}
        self.c.source_bindings=types.MethodType(t.o.Context.source_bindings,self.c)
        self.h.source_epoch=lambda *args:(copy.deepcopy(self.original),copy.deepcopy(self.native))
        self.c.host_module=host
        local_v=types.SimpleNamespace(FILES=v.FILES,OPS=HERE,typed_command=v.typed_command)
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.intent('source-paid-start-intent.json',notBeforeUs=100)
        x=s.Completion(a,local_v,t.o,self.c,self.owner);x.bindfix=lambda:{'file':item,'completed':True}
        return x,own,hold,zz

    def test_real_pinned_AST_extract_loaded_source_accepts_exact_extended_six_and_refuses_zero_RW(self):
        x,_,_,_=self.completion_fixture()
        self.assertTrue(x.loaded('paid'))
        self.bindings['BindPaths']['data']=[]
        with self.assertRaisesRegex(RuntimeError,'actual_three_original_RW_bindings_required'):x.loaded('paid')
        self.assertFalse((s.BASE/'start-intent.json').exists());self.assertEqual(self.calls,[])

    def test_only_BindPaths_render_can_differ_after_real_typed_match_and_no_extra_definition(self):
        x,_,_,_=self.completion_fixture();self.assertTrue(x.runtime_current(self.h,self.op))
        self.runtime['MemoryMax']='7GiB'
        with self.assertRaises(RuntimeError):x.runtime_current(self.h,self.op)
        self.runtime['MemoryMax']='6GiB';before=self.h.definitions
        self.h.definitions=lambda state:{**before(state),'/foreign/dropin':{}}
        with self.assertRaises(RuntimeError):x.loaded('paid')

    def start_fixture(self):
        x,own,_,_=self.completion_fixture()
        x.guards_current=lambda:{'validated':True};x.loaded=lambda mode:True
        self.owner.source_context=lambda:(self.owner.operation(),copy.deepcopy(self.native));self.owner.routes_current=lambda mode:{}
        self.owner.terminal=lambda *args:{'terminal':True};self.owner.known_source_processes=lambda:[]
        self.c.cache=types.SimpleNamespace(validate_restart_capture=lambda *args:{'validated':True,'cacheCoverageQualified':True,'providerCalls':0,'databaseWrites':0})
        self.c.source_private_inputs=lambda actor:[]
        self.h.source.query=lambda sql:None;self.h.source_sessions=lambda actor:{t.o.SOURCE:[{'pid':800,'backendStart':'actual-fixture'}]}
        self.native['clock']=50000;self.native['app']['heartbeat_at']='10000'
        x.save('context.json',x.envelope(bindfixReceiptSha256=s.BIND_RESULT_SHA))
        actor=copy.deepcopy(self.original);actor['parent']['pid']=999002;actor['processes'][0]['pid']=999002
        def epoch(op,intent,mode,*args):
            self.assertEqual(intent['notBeforeUs'],self.tick);self.assertEqual(intent['preStartDatabaseClock'],50000);self.assertEqual(intent['predecessorHeartbeat'],10000)
            return actor,copy.deepcopy(self.native)
        self.h.source_epoch=epoch
        def manager(verb,unit=None):
            self.assertTrue((own/'start-intent.json').exists());self.calls.append((verb,unit))
        self.h.manager=manager
        return x,own

    def test_new_start_has_fresh_intent_one_manager_and_own_ACK_never_old_ACK(self):
        x,own=self.start_fixture()
        first=x.start();second=x.start()
        self.assertEqual(self.calls,[('start',t.o.SOURCE)]);self.assertEqual(first,second)
        self.assertFalse(self.owner.exists('source-paid-started.json'));self.assertFalse(self.owner.exists('result.json'))
        self.assertFalse(x.record('result.json')['original440PaidStartAcknowledged'])

    def test_source_appearing_during_final_guard_read_prevents_manager_start(self):
        x,own=self.start_fixture()
        def guard():
            if (own/'start-intent.json').exists():
                self.h.source.state=lambda unit:{'MainPID':'999777','ControlPID':'0','NRestarts':'0','Job':'','ExecMainStartTimestampMonotonic':'101'}
            return {'validated':True}
        x.guards_current=guard
        with self.assertRaisesRegex(RuntimeError,'actual_no_start_effect'):x.start()
        self.assertEqual(self.calls,[]);self.assertTrue((own/'start-intent.json').exists());self.assertFalse((own/'result.json').exists())

    def test_original_pending_start_must_have_real_no_start_effect(self):
        x,_,_,_=self.completion_fixture();x.no_start_effect()
        self.h.source.state=lambda unit:{'MainPID':'0','ControlPID':'0','NRestarts':'0','Job':'','ExecMainStartTimestampMonotonic':'100'}
        with self.assertRaises(RuntimeError):x.no_start_effect()

    def test_real_bindfix_inode_moves_after_source_drain_before_free_restore(self):
        x,_,hold,zz=self.completion_fixture();events=[]
        self.owner.close=lambda **kwargs:events.append('paid-stop-and-financial-close')or{'sourceRestorePending':True}
        self.owner.process_terminal=lambda *args:events.append('positive-owned-terminal')
        self.owner.known_source_processes=lambda:[];self.c.remaining_source_facts=lambda:events.append('positive-remaining-kernel-map')
        def free(mode):
            self.assertFalse(zz.exists());self.assertTrue((hold/'zz.removed.conf').exists());events.append('free-restore');return{'sourceAcknowledged':True}
        self.owner.start_source=free
        original=zz.stat().st_ino;self.assertTrue(x.close(resume=True)['sourceAcknowledged'])
        self.assertEqual((hold/'zz.removed.conf').stat().st_ino,original)
        self.assertEqual(events,['paid-stop-and-financial-close','positive-owned-terminal','positive-remaining-kernel-map','free-restore'])


if __name__=='__main__':
    names=[name for name in Focused.__dict__ if name.startswith('test_')]
    result=unittest.TextTestRunner().run(unittest.TestSuite(Focused(name)for name in names));sys.exit(not result.wasSuccessful())
