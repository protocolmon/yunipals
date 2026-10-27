#!/usr/bin/env python3
"""Focused successor seams over actual frozen business functions; no host work."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).absolute().parent


def load(name):
    path = HERE / name; spec = importlib.util.spec_from_file_location(name.replace('.', '_'), path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


v = load('ypal-alchemy-source-switch-v2.py')
identity = load('ypal-alchemy-source-identity-v2.py')
prior_tests = load('ypal-alchemy-source-switch-v1.test.py')


class Pure(unittest.TestCase):
    def test_default_is_inactive(self):
        result = subprocess.run([sys.executable, '-I', '-B', str(HERE/'ypal-alchemy-source-switch-v2.py')], capture_output=True, check=True, text=True)
        row = json.loads(result.stdout); self.assertTrue(row['sourceOnly']); self.assertFalse(row['newAdmission']); self.assertEqual(result.stderr, '')

    def test_action_refuses_foreign_host_or_nonroot_before_constructing_context(self):
        with patch.object(sys,'argv',[str(HERE/'ypal-alchemy-source-switch-v2.py'),'--review']),patch.object(v.os,'geteuid',return_value=1):
            with self.assertRaisesRegex(RuntimeError,'fixed_production_root_host_required'):v.main()
        with patch.object(sys,'argv',[str(HERE/'ypal-alchemy-source-switch-v2.py'),'--review']),patch.object(v.os,'geteuid',return_value=0),patch.object(v.os,'getegid',return_value=0),patch.object(v.socket,'gethostname',return_value='foreign-host'):
            with self.assertRaisesRegex(RuntimeError,'fixed_production_root_host_required'):v.main()

    def test_dependency_order_only_canonicalization_keeps_every_other_security_field(self):
        before = {'Requires':'postgres.service network.target', 'Wants':'a b', 'ExecStop':'exact-status', 'NoNewPrivileges':'yes'}
        after = {**before, 'Requires':'network.target postgres.service', 'Wants':'b a'}
        self.assertEqual(v.canonical_security(before), v.canonical_security(after))
        after['ExecStop'] = 'changed'; self.assertNotEqual(v.canonical_security(before), v.canonical_security(after))
        after['Requires'] = 'postgres.service postgres.service'
        with self.assertRaises(RuntimeError): v.canonical_security(after)
        self.assertEqual(before['Requires'], 'postgres.service network.target')

    def test_namespace_is_separate_and_frozen_business_source_unchanged(self):
        path = HERE/v.FILES['business'][0]; raw = path.read_bytes(); before = v.sha(raw)
        module = v.namespace(raw, HERE/'ypal-alchemy-source-switch-v2.py', {'FORMAT':repr(v.FORMAT), 'BASE':"Path('/fixed/new-base')"})
        self.assertEqual(module.FORMAT, v.FORMAT); self.assertEqual(str(module.BASE), '/fixed/new-base')
        self.assertEqual(v.sha(path.read_bytes()), before); self.assertEqual(before, v.PARENT['operatorSha256'])
        with self.assertRaises(RuntimeError): v.namespace(raw, path, {'unknown':'1'})

    def test_plan_new_deadlines_keep_original_window_and_exact_program(self):
        financial = load('ypal-alchemy-catchup-financial-v1.test.py'); before, ranges = financial.fixture()
        plan = financial.m.plan(before, ranges, 'a'*64, before['clockMs'], financial.PROFILE)
        own = HERE/'ypal-alchemy-source-switch-v2.py'
        p = v.namespace((HERE/v.FILES['plan'][0]).read_bytes(), own,
            {'BASE':"Path('/fixed/v2')", 'LIFECYCLE':repr(str(own)), 'FINANCIAL_BASE':"Path('/fixed/close-v2')"}, {'-v1':'-v2'})
        definitions = p.deadline_definitions(plan, p.sha(p.encoded(plan)))
        self.assertEqual(len(definitions), 4)
        self.assertTrue(all('-v2.' in name for name in definitions))
        for name, raw in definitions.items():
            text = raw.decode()
            if name.endswith('.service'):
                self.assertIn(str(own), text); self.assertIn('TimeoutStartSec=900', text)
                self.assertIn('PrivateTmp=yes', text); self.assertIn(str(p.IMPORT_INVENTORY), text)
            else:
                when = plan['nextUtcMs'] if '-utc-' in name else plan['expiresMs']
                self.assertIn('OnCalendar='+p.calendar(when), text)
        self.assertEqual(plan['maximumAdditionalBookedCu'], '15000000')

    def test_proxy_typed_program_ignores_only_runtime_status(self):
        row = ['/fixed/node', ['/fixed/node','/fixed/proxy.mjs'], False, 1, 2, 3, 4, 99, 0, 0]
        m = types.SimpleNamespace(command=lambda args: json.dumps({'type':'a(sasbttttuii)','data':[row]}).encode())
        first = v.proxy_program(m, 'fixed.service', '/fixed/node', '/fixed/proxy.mjs')
        row[3:] = [0]*7; self.assertEqual(v.proxy_program(m, 'fixed.service', '/fixed/node', '/fixed/proxy.mjs'), first)
        row[1].append('--foreign')
        with self.assertRaises(RuntimeError): v.proxy_program(m, 'fixed.service', '/fixed/node', '/fixed/proxy.mjs')

    def test_close_namespace_reuses_real_financial_methods_but_cannot_admit_or_rearm(self):
        original = load('ypal-alchemy-catchup-financial-v1.py')
        f = v.namespace((HERE/v.FILES['financial'][0]).read_bytes(), HERE/'ypal-alchemy-source-switch-v2.py',
            {'FORMAT':repr('yunipals-ypal-alchemy-close-v2'), 'BASE':"Path('/fixed/new-close')"})
        calls=[]; original_owner=types.SimpleNamespace(admitted=lambda digest:calls.append(digest)or{'actualParent':True})
        C = v.close_owner_class(f, original_owner, types.SimpleNamespace(validate_current=lambda digest:True))
        owner = C.__new__(C)
        for phase in ['admit','rearm','unknown']:
            with self.assertRaisesRegex(RuntimeError,'cannot_admit_or_rearm'): owner.transaction(phase, True)
        self.assertTrue(owner.admitted(v.PARENT['financialResultSha256'])['actualParent'])
        with self.assertRaises(RuntimeError): owner.admitted('f'*64)
        self.assertEqual(calls,[v.PARENT['financialResultSha256']])
        self.assertEqual(f.Owner.transaction.__code__.co_code,original.Owner.transaction.__code__.co_code)
        self.assertEqual(f.Client.finish.__code__.co_code,original.Client.finish.__code__.co_code)


class Source(prior_tests.Fixture):
    # Inherit fixture setup only; execute the actual frozen source-stop body in
    # a new namespace against a raw SDK packet with reset ExecStart metadata.
    def runTest(self): pass

    def test_successor_raw_and_projected_canonicalization_is_idempotent_and_real_stop_once(self):
        raw=copy.deepcopy(self.original); raw['unit'].update(Id='yunipals-ypal-combined-source.service',ExecStart='volatile-reset')
        self.original=raw; self.h.source.actor=lambda unit,terminal=False:None if terminal else copy.deepcopy(raw)
        self.m.command=lambda args:json.dumps({'type':'a(sasbttttuii)','data':[['/usr/bin/env',['/usr/bin/env','-i',*raw['parent']['argv']],False,0,0,0,0,0,0,0]]}).encode()
        self.h.restore=v.source_restore(types.SimpleNamespace(canonical_actor=lambda actor:copy.deepcopy(actor)),self.h,self.m,identity,'yunipals-ypal-combined-source.service')
        projected=self.h.restore.canonical_actor(raw)
        self.assertNotIn('ExecStart',projected['unit']);self.assertEqual(self.h.restore.canonical_actor(projected),projected)
        self.op['source']=projected
        (self.base/'operation.json').unlink();self.owner.put('operation.json',self.op)
        self.owner.terminal=lambda *args,**kwargs:{'terminal':True,'remainingWriterAttribution':{},'sourceScanSha256':'f'*64}
        self.owner.source_stop('initial');self.owner.source_stop('initial')
        self.assertEqual(self.calls,[('stop',prior_tests.o.SOURCE)])
        foreign=copy.deepcopy(projected);foreign['parent']['startTicks']+=1
        with self.assertRaises(RuntimeError):self.h.restore.canonical_actor(foreign)


if __name__ == '__main__':
    suite=unittest.TestSuite()
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(Pure))
    suite.addTest(Source('test_successor_raw_and_projected_canonicalization_is_idempotent_and_real_stop_once'))
    unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful()or sys.exit(1)
