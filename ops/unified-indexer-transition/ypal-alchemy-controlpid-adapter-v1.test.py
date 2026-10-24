#!/usr/bin/env python3
"""Actual terminal/continue/guard functions with explicit peers and real FS."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).absolute().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('.', '_'), HERE/name)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


a = load('ypal-alchemy-controlpid-adapter-v1.py')
t = load('ypal-alchemy-source-switch-v1.test.py')


class Adapter(t.Fixture):
    def terminal_fixture(self):
        self.group_root=self.root/'cgroups';self.group_root.mkdir()
        self.patches.append(patch.object(a,'CGROUP',self.group_root));self.patches[-1].start()
        self.unit='yunipals-combined-rpc@ethereum.service';group=self.group_root/self.unit;group.mkdir();self.procs=group/'cgroup.procs';self.procs.write_text('')
        self.state={'MainPID':'0','ActiveState':'inactive'};self.control={'type':'u','data':0};self.delegations=[]
        self.h.rpc_m=object();self.h.a=types.SimpleNamespace(state=lambda *args:copy.deepcopy(self.state))
        self.m.command=lambda args:json.dumps(self.control).encode()
        self.owner.process_terminal=lambda unit,pids:self.delegations.append(unit)or'actual-source-branch-sentinel'
        a.adapt(self.owner,t.o)

    def test_scalar_u_zero_with_state_lacking_ControlPID_passes_and_source_delegates(self):
        self.terminal_fixture();self.assertNotIn('ControlPID',self.state)
        self.assertIsNone(self.owner.process_terminal(self.unit,[]))
        self.assertEqual(self.owner.process_terminal(t.o.SOURCE,[]),'actual-source-branch-sentinel')
        self.assertEqual(self.delegations,[t.o.SOURCE]);self.assertEqual(self.calls,[])

    def test_nonzero_boolean_array_missing_or_wrong_type_ControlPID_refuses(self):
        self.terminal_fixture()
        for row in [{'type':'u','data':1},{'type':'u','data':False},{'type':'u','data':[0]},{'type':'u'},{'type':'t','data':0}]:
            self.control=row
            with self.subTest(row=row),self.assertRaises(RuntimeError):self.owner.process_terminal(self.unit,[])
        self.assertEqual(self.calls,[])

    def test_cgroup_mainPID_and_known_escaped_process_still_refuse(self):
        self.terminal_fixture();self.procs.write_text('1234\n')
        with self.assertRaises(RuntimeError):self.owner.process_terminal(self.unit,[])
        self.procs.write_text('');self.state['MainPID']='1234'
        with self.assertRaises(RuntimeError):self.owner.process_terminal(self.unit,[])
        self.state['MainPID']='0';raw=Path('/proc/self/stat').read_text();ticks=int(raw[raw.rfind(')')+2:].split()[19])
        with self.assertRaises(RuntimeError):self.owner.process_terminal(self.unit,[{'pid':os.getpid(),'startTicks':ticks}])

    def test_real_reused_switch_continues_existing_stopped_definition_intent_without_stop_resend(self):
        self.terminal_fixture();self.h.proxy_unit=lambda chain:self.unit;self.h.proxy_drop=lambda chain:self.root/'unit.d'/'99.conf'
        actor={'pid':999002,'invocation':'new-paid','processes':[{'pid':999002,'startTicks':2}]}
        prepared=t.p.exclusive(self.hold/'ethereum.conf',b'[Service]\n# exact synthetic paid overlay\n',0o644)
        self.op['overlays']['ethereum']={'sha256':prepared['sha256'],'identity':t.o.six(prepared['identity'])}
        self.op['originalFreeRoutes']={'ethereum':{'actor':copy.deepcopy(self.original)}}
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.intent('source-initial-stop-intent.json',actor=self.original)
        self.intent('financial-admission-link.json',financialResultSha256='e'*64)
        self.intent('ethereum-paid-definition-intent.json',chain='ethereum')
        self.h.paid_route=lambda *args:copy.deepcopy(actor);self.h.proxy_sessions=lambda *args:[{'pid':800,'backendStart':'actual-fixture','transport':'unix'}]
        def manager(verb,unit=None):
            self.calls.append((verb,unit))
            if verb=='start':self.state.update(MainPID='999002',ActiveState='active')
        self.h.manager=manager
        first=self.owner.switch_proxy('ethereum');second=self.owner.switch_proxy('ethereum')
        self.assertTrue(first['paidProxyAcknowledged']);self.assertEqual(first,second)
        self.assertEqual(self.calls,[('daemon-reload',None),('start',self.unit)])
        self.assertTrue(self.owner.exists('ethereum-paid-definition-installed.json'));self.assertTrue(self.owner.exists('ethereum-paid-started.json'))

    def guard_fixture(self):
        model=load('ypal-alchemy-catchup-financial-v1.test.py');before,ranges=model.fixture()
        plan=model.m.plan(before,ranges,'a'*64,before['clockMs'],model.PROFILE)
        self.op['financialPlan']=plan;self.op['planSha256']=t.p.sha(t.p.encoded(plan));self.c.plan=plan;self.c.config['planSha256']=self.op['planSha256']
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.system=self.root/'system';self.system.mkdir();(self.system/'timers.target.wants').mkdir()
        self.audit=self.root/'adapter';self.audit.mkdir(mode=0o700)
        for name,value in [('SYSTEM',self.system),('HOLD',self.system/'.adapter-hold'),('BASE',self.audit)]:
            q=patch.object(a,name,value);q.start();self.patches.append(q)
        q=patch.object(t.p,'LIFECYCLE',a.BUSINESS);q.start();self.patches.append(q)
        self.m.save=lambda path,value:t.p.exclusive(path,t.o.encoded(value))
        self.h.rpc_m=object()
        def command(args,timeout=None):
            if args[0]=='/usr/bin/systemctl':self.calls.append(tuple(args[1:]));return b''
            if args[-1]=='Job':return json.dumps({'type':'(uo)','data':[0,'/']}).encode()
            if args[-1]=='NextElapseUSecRealtime':
                when=plan['nextUtcMs']if'utc'in args[4]else plan['expiresMs']-300000
                return json.dumps({'type':'t','data':when*1000}).encode()
            raise AssertionError('unexpected synthetic command')
        self.m.command=command
        def properties(client,name,fields):
            return {key:{'Id':name,'FragmentPath':str(self.system/name),'DropInPaths':'','ActiveState':'active'if name.endswith('.timer')else'inactive','UnitFileState':'enabled'if name.endswith('.timer')else'static','MainPID':'0'}[key]for key in fields}
        q=patch.object(self.owner.leaf,'manager_properties',properties);q.start();self.patches.append(q)
        return plan

    def test_supplemental_guards_real_files_exact_early_and_UTC_calendar_and_once_manager(self):
        plan=self.guard_fixture();result=a.install_guards(self.owner,t.o,'a'*64)
        self.assertTrue(result['supplementalGuardsInstalled']);calls=list(self.calls)
        self.assertEqual(len(calls),3);self.assertEqual(a.install_guards(self.owner,t.o,'a'*64),result);self.assertEqual(self.calls,calls)
        expected=a.definitions(self.owner,t.o);self.assertEqual(len(expected),4)
        for name,raw in expected.items():
            self.assertEqual((self.system/name).read_bytes(),raw)
            if name.endswith('.service'):self.assertIn(str(Path(a.__file__).absolute()),raw.decode())
            elif'-close-'in name:self.assertIn('OnCalendar='+t.p.calendar(plan['expiresMs']-300000),raw.decode())
            else:self.assertIn('OnCalendar='+t.p.calendar(plan['nextUtcMs']),raw.decode())
        target=next(path for path in self.system.iterdir()if path.name.endswith('.service'));target.write_bytes(b'foreign')
        with self.assertRaises(RuntimeError):a.guards_current(self.owner,t.o,'a'*64)
        self.assertEqual(self.calls,calls)


if __name__=='__main__':
    names=['test_scalar_u_zero_with_state_lacking_ControlPID_passes_and_source_delegates',
           'test_nonzero_boolean_array_missing_or_wrong_type_ControlPID_refuses',
           'test_cgroup_mainPID_and_known_escaped_process_still_refuse',
           'test_real_reused_switch_continues_existing_stopped_definition_intent_without_stop_resend',
           'test_supplemental_guards_real_files_exact_early_and_UTC_calendar_and_once_manager']
    result=unittest.TextTestRunner().run(unittest.TestSuite(Adapter(name)for name in names));sys.exit(not result.wasSuccessful())
