#!/usr/bin/env python3
import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path); value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

r = load(HERE / 'ypal-combined-rpc-routes-v1.py', 'routes')


class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.routes-test-', dir=HERE); self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.a = load(HERE / 'ypal-combined-rpc-admission-v3.py', 'frozen_admission')
        self.m = load(HERE.parent / 'booster-launch/ypal-rpc-admission-v1.py', 'primitives'); self.m.BASE = self.base
        p = patch.object(r, 'BASE', self.base); p.start(); self.addCleanup(p.stop)

    def capacity(self):
        return {'roleOid': '123', 'roleLimit': 16, 'roleSessions': 8, 'clientSessions': 19, 'maxConnections': 96, 'reserved': 3}

    def test_actual_producer_and_artifact_pins(self):
        self.assertEqual(r.sha((HERE / 'ypal-combined-rpc-admission-v3.py').read_bytes()), r.ADMISSION_HELPER_SHA)
        self.assertEqual(r.sha((HERE / 'ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs').read_bytes()), r.ARTIFACT_SHA)
        for value in [r.ADMISSION_SHA, r.STAGE_SHA]: self.assertRegex(value, '^[0-9a-f]{64}$')
        self.assertEqual(r.LOCK, '/run/lock/yunipals-ypal-combined-transition.lock')

    def test_capacity_counts_all_four_new_pools_and_retained_growth(self):
        for remaining in range(5):
            with patch.object(self.m, 'query', return_value=self.capacity()) as query:
                value = r.capacity(self.m, remaining)
            self.assertEqual(value['requiredRoleCapacity'], 16)
            self.assertEqual(value['newPoolMax'], 1); self.assertIn("usename='market_prod_budget'", query.call_args.args[0])

    def test_capacity_refuses_pressure_or_unreviewed_limit_changes(self):
        for key, value in [('roleSessions', 11), ('roleLimit', 15), ('roleLimit', 18), ('clientSessions', 90), ('maxConnections', 100), ('reserved', 2), ('roleOid', None)]:
            row = self.capacity(); row[key] = value
            with patch.object(self.m, 'query', return_value=row), self.assertRaisesRegex(RuntimeError, 'headroom'): r.capacity(self.m)
        for value in [-1, 5, True]:
            with self.assertRaises(RuntimeError): r.capacity(self.m, value)

    def test_only_final_new_unit_exec_override_changes(self):
        old = '/opt/retained/rpc-budget-proxy.mjs'; body = ('[Service]\nExecStart=' + self.a.NODE + ' ' + old + '\n[Service]\nExecStart=\nExecStart=' + self.a.NODE + ' ' + old + '\nRestart=on-failure\n').encode()
        plan = {'entry': old, 'entrySha256': 'a' * 64, 'unitSha256': r.sha(body), 'security': {'User': 'retained'}}
        self.a.original_plan = lambda *_: (plan, body)
        new, rendered = r.route_plan(self.m, self.a, 'base')
        self.assertEqual(rendered.count(('ExecStart=' + self.a.NODE + ' ' + old).encode()), 1)
        self.assertEqual(rendered.count(str(r.ARTIFACT).encode()), 1)
        self.assertEqual(new['entry'], str(r.ARTIFACT)); self.assertEqual(new['security'], plan['security']); self.assertEqual(new['budgetPoolMax'], 1)
        self.assertEqual(new['retainedEntrySha256'], plan['entrySha256'])

    def test_route_baseline_never_requires_old_source_qualifier(self):
        identity = {k: self.capacity()[k] for k in ['roleOid', 'roleLimit', 'maxConnections', 'reserved']}
        binding = {'operatorSha256': r.sha(Path(r.__file__).read_bytes()), 'bootId': self.m.boot(), 'inputs': {'pins': True}, 'retained': {'live': 'ypal'},
                   'plans': {c: {} for c in self.a.CHAINS}, 'budgetCapacityIdentity': identity}
        before = {'binding': binding, 'catalog': {}}; before['reviewHash'] = r.sha(r.encoded(before)); self.m.save('before.json', before)
        with patch.object(r, 'inputs', return_value=binding['inputs']), patch.object(self.a, 'retained', return_value=binding['retained']), patch.object(self.a, 'plan', return_value=({}, b'')), patch.object(r, 'capacity_snapshot', return_value=self.capacity()), patch.object(self.m, 'source_guard', side_effect=AssertionError('old source gone')):
            self.assertEqual(r.baseline(self.m, self.a), before)

    def test_route_baseline_refuses_retained_actor_drift(self):
        before = {'binding': {'operatorSha256': r.sha(Path(r.__file__).read_bytes()), 'bootId': self.m.boot(), 'inputs': {}, 'retained': 'old'}}
        self.m.save('before.json', before)
        with patch.object(r, 'inputs', return_value={}), patch.object(self.a, 'retained', return_value='changed'), self.assertRaisesRegex(RuntimeError, 'direct_binding'):
            r.baseline(self.m, self.a)

    def test_actual_admission_receipt_shape_and_no_sql_reexecution(self):
        # The fixture is the actual canonical public acknowledgement, not a SQL mock.
        raw = (HERE / 'fixtures/combined-rpc-admitted-v3.json').read_bytes(); self.assertEqual(r.sha(raw), r.ADMISSION_SHA)
        saved = json.loads(raw); before = {'reviewHash': saved['reviewHash']}
        def pinned(path, pin): self.assertEqual(pin, r.ADMISSION_SHA); return raw
        with patch.object(self.m, 'pinned', side_effect=pinned), patch.object(self.m, 'protected', return_value=r.encoded(before)), patch.object(r, 'load_admission', side_effect=AssertionError('no recursive validation')):
            value, actual, returned = r.admission_inputs(self.m)
        self.assertEqual(actual, raw); self.assertEqual(returned, before); self.assertEqual(value['admissionReceiptSha256'], r.ADMISSION_SHA)

    def test_stage_receipt_has_real_import_and_actual_owned_link(self):
        raw = (HERE / 'fixtures/combined-rpc-pool-one-stage-v1.json').read_bytes(); self.assertEqual(r.sha(raw), r.STAGE_SHA)
        stage = json.loads(raw)
        self.assertEqual(stage['runtimeImport'], {'actualInstalledModuleImport': True, 'databaseQueries': 0, 'networkAttempts': 0, 'serviceStarted': False})
        self.assertEqual(stage['dependencyLink']['identity']['st_ino'], 2719690)
        text = Path(r.__file__).read_text(); self.assertIn("m.pinned(STAGE, STAGE_SHA)", text)
        self.assertIn("'identity': m.identity(ls)", text)

    def test_start_copies_exact_admission_before_owned_install(self):
        raw = (HERE / 'fixtures/combined-rpc-admitted-v3.json').read_bytes()
        # start requires a fresh directory; use a child path.
        target = self.base / 'fresh'; self.m.BASE = target
        def owned_start(m, pin):
            self.assertEqual(pin, r.ADMISSION_SHA); self.assertEqual((target / 'admitted.json').read_bytes(), raw)
            self.assertEqual(m.load('before.json')['reviewHash'], 'review'); return {'started': True}
        with patch.object(r, 'BASE', target), patch.object(r, 'review', return_value={'reviewHash': 'review'}), patch.object(r, 'admission_inputs', return_value=({}, raw, {})), patch.object(self.a, 'start', side_effect=owned_start):
            self.assertEqual(r.start(self.m, self.a, 'review'), {'started': True})

    def test_stale_route_review_does_not_create_operation(self):
        target = self.base / 'fresh'
        with patch.object(r, 'BASE', target), patch.object(r, 'review', return_value={'reviewHash': 'fresh'}), self.assertRaisesRegex(RuntimeError, 'fresh_route'):
            r.start(self.m, self.a, 'stale')
        self.assertFalse(target.exists())

    def test_unchanged_lifecycle_functions_are_reused(self):
        # Configure the real frozen module; only the documented seams change.
        self.a.core = lambda: (self.m, None)
        old_start, old_restore, old_reconcile, old_validate = self.a.start, self.a.restore, self.a.reconcile_start, self.a.validate_current
        with patch.object(r, 'load_admission', return_value=self.a): m, a = r.core()
        self.assertIs(a.start, old_start); self.assertIs(a.restore, old_restore); self.assertIs(a.reconcile_start, old_reconcile); self.assertIs(a.validate_current, old_validate)
        self.assertEqual(a.BASE, self.base); self.assertEqual(a.__file__, str(Path(r.__file__).absolute()))
        self.assertEqual(a.SINGLE_CONNECTION_ROUTE_ARTIFACT_SHA, r.ARTIFACT_SHA)
        self.assertIs(m.route_owner, a)

    def test_manager_capacity_guard_only_before_new_starts(self):
        calls = []; self.a.core = lambda: (self.m, None); self.a.manager = lambda m, verb, chain=None: calls.append((verb, chain))
        with patch.object(r, 'load_admission', return_value=self.a): m, a = r.core()
        with patch.object(r, 'capacity') as capacity:
            a.manager(m, 'start', 'base'); self.assertEqual(capacity.call_args.args[1], 4)
            a.manager(m, 'stop', 'base'); a.manager(m, 'daemon-reload'); self.assertEqual(capacity.call_count, 1)
        self.assertEqual(calls, [('start', 'base'), ('stop', 'base'), ('daemon-reload', None)])

    def test_owned_inverse_does_not_depend_on_gate_health(self):
        source = Path(r.__file__).read_text(); tree = ast.parse(source)
        body = ast.get_source_segment(source, next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'owned_stop_identity'))
        self.assertNotIn('gate(', body); self.assertNotIn('get(', body)
        for required in ['check_published', 'live_actor', 'commandSha256', 'entrySha256', 'earliestMonotonicUs', 'CapBnd', 'bootId']:
            self.assertIn(required, body)
        inverse = ast.get_source_segment(Path(self.a.__file__).read_text(), next(n for n in ast.parse(Path(self.a.__file__).read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'restore'))
        self.assertIn('combined_stopped(m)', inverse); self.assertIn('owned_stop_intent_actor_changed', inverse)

    def test_owned_unhealthy_actor_can_be_stopped_but_foreign_command_refuses(self):
        chain = 'base'; entry = '/fixed/owned-proxy.mjs'; raw = b'fixed proxy'
        security = {k: '' for k in self.m.SECURITY}; account = types.SimpleNamespace(pw_uid=978, pw_gid=972)
        plan = {'entry': entry, 'entrySha256': r.sha(raw), 'unitSha256': 'a' * 64, 'security': security}
        before = {'binding': {'plans': {chain: plan}}}
        value = {**security, 'FragmentPath': str(self.a.paths(chain)['unit']), 'DropInPaths': '', 'NRestarts': '0'}
        intent = {'bootId': self.m.boot(), 'unitSha256': plan['unitSha256'], 'earliestMonotonicUs': 140000000}
        privileges = {'Uid': '978 978 978 978', 'Gid': '972 972 972 972', 'Groups': '972', 'NoNewPrivs': '1', **{k: '0' for k in ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']}}
        actor = {'startMonotonicMicroseconds': 150000000, 'processes': [{'privileges': privileges, 'commandSha256': r.sha((self.a.NODE + '\0' + entry + '\0').encode())}]}
        with patch.object(self.m, 'check_published') as published, patch.object(self.m, 'load', return_value=intent), patch.object(self.m, 'protected', return_value=raw), patch.object(self.a, 'state', return_value=value), patch.object(self.a, 'live_actor', return_value=actor), patch.object(self.a, 'gate', side_effect=AssertionError('unhealthy route')) as gate, patch.object(r.pwd, 'getpwnam', return_value=account), patch.object(r.time, 'monotonic_ns', return_value=200000000000):
            result = r.owned_stop_identity(self.m, self.a, chain, before)
            self.assertEqual(result, {'actor': actor, 'healthRequiredForOwnedStop': False}); gate.assert_not_called()
            self.assertEqual([c.args[0] for c in published.call_args_list], ['base-unit', 'base-env'])
            actor['processes'][0]['commandSha256'] = 'b' * 64
            with self.assertRaisesRegex(RuntimeError, 'owned_stop_process'): r.owned_stop_identity(self.m, self.a, chain, before)

    def test_fixed_route_cli_has_no_policy_mutation_or_old_service_action(self):
        source = Path(r.__file__).read_text(); tree = ast.parse(source)
        main = ast.get_source_segment(source, next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main'))
        for forbidden in ['commit', 'rehearse', 'official(', 'DELETE ', 'DROP ', 'ALTER ROLE']:
            self.assertNotIn(forbidden, main)
        self.assertIn("['start', 'reconcile-start', 'validate', 'restore']", main)
        self.assertIn('LOCK_EX | fcntl.LOCK_NB', main)


if __name__ == '__main__': unittest.main()
