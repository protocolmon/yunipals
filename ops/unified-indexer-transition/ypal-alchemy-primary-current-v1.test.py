#!/usr/bin/env python3
"""Actual leaf bodies, protected receipt files, typed-manager fixtures; no host actions."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name('ypal-alchemy-primary-current-v1.py')


def load():
    spec = importlib.util.spec_from_file_location('alchemy_current_test', FILE)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def sibling(name):
    spec = importlib.util.spec_from_file_location('actual_' + name.replace('.', '_'), FILE.with_name(name))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


FINANCIAL_OWNER = sibling('ypal-alchemy-catchup-financial-v1.py')


class Fixture:
    def __init__(self, test, modes=None, plan=None):
        self.v = load()
        self.tmp = tempfile.TemporaryDirectory(prefix='.alchemy-current-test-', dir=FILE.parents[2])
        test.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.v.BASE = self.root / 'operation'
        self.v.FINANCIAL = self.root / 'financial'
        self.v.OPS = self.root / 'ops'
        self.v.SYSTEMD = self.root / 'systemd'
        for path in (self.v.BASE, self.v.FINANCIAL, self.v.OPS, self.v.SYSTEMD):
            path.mkdir(mode=0o700)
        self.v.LIFECYCLE = self.v.OPS / 'ypal-alchemy-source-switch-v1.py'
        self.v.MANIFEST = self.v.OPS / 'ypal-alchemy-source-switch-v1.sources.json'
        self.v.FREE_ARTIFACT = self.v.OPS / 'rpc-budget-proxy.mjs'
        self.v.LIFECYCLE.write_bytes(b'# reviewed lifecycle fixture\n')
        self.v.FREE_ARTIFACT.write_bytes(b'// reviewed free artifact fixture\n')
        self.v.FREE_ARTIFACT_SHA = self.v.sha(self.v.FREE_ARTIFACT.read_bytes())
        self.operator = self.v.sha(self.v.LIFECYCLE.read_bytes())
        self.manifest_sha = self.put(self.v.MANIFEST, {'format': 'yunipals-alchemy-source-switch-v1-sources',
            'lifecycle': {'file': self.v.LIFECYCLE.name, 'sha256': self.operator}})
        self.plan = plan or {'permits': {'ethereum': 'permit-a', 'base': 'permit-b', 'polygon': 'permit-c', 'bnb': 'permit-d'},
                     'startMs': 1800000000000, 'expiresMs': 1800003600000, 'nextUtcMs': 1800057600000}
        self.plan_sha = self.put(self.v.FINANCIAL / 'plan.json', self.plan)
        self.actors = {}
        self.states = {}
        self.security = {}
        self.env_paths = {}
        self.env_data = {}
        self.jobs = {}
        self.metrics = {port: {'unified': {'sourceRouting': 'free_first'}, 'traffic': {'paidCalls': 0},
                              'activeUpstreamRequests': 0, 'queuedSourceRequests': 0,
                              'maximumConcurrentUpstreamRequests': 2, 'sourceQueueLimit': 64,
                              **dict.fromkeys(('paidFallbackOnFreeFailure', 'foregroundPaidFallbackOnFreeFailure',
                                  'orderPaidFallbackOnFreeFailure', 'sourcePaidFallbackOnFreeFailure',
                                  'salePaidFallbackOnFreeFailure'), False)} for port in self.v.CHAINS.values()}
        self.rows = []
        self.hook = None
        self.metric_calls = 0
        self.m = types.SimpleNamespace(boot=lambda: 'boot-fixture', run=self.run, protected=self.v.protected,
                                      query=lambda _: copy.deepcopy(self.rows))
        self.a = types.SimpleNamespace(NODE='/usr/bin/node', state=self.state, live_actor=self.actor,
                                      env_bytes=lambda chain: b'PUBLIC_FREE_FLAG=false\n')
        self.v.routes_context = lambda: (self.m, self.a)
        self.v.metrics = self.metric
        original = {}
        for index, chain in enumerate(self.v.CHAINS):
            unit = self.unit(chain)
            definition = self.v.SYSTEMD / unit
            definition.write_bytes(b'[Service]\nExecStart=/usr/bin/node reviewed-free\n')
            env = self.v.OPS / (chain + '.private.env')
            env.write_bytes(b'fixture private hash input only\n')
            self.env_paths[unit] = env
            self.jobs[unit] = [0, '/']
            self.actors[chain] = self.make_actor(100000 + index, 10000000 + index)
            self.states[unit] = {'Id': unit, 'MainPID': str(100000 + index), 'ActiveState': 'active',
                'SubState': 'running', 'DropInPaths': '', 'FragmentPath': str(definition)}
            self.security[unit] = dict.fromkeys(self.v.UNIT_SECURITY_FIELDS, '')
            self.security[unit].update(NoNewPrivileges='yes', KillMode='control-group', Restart='on-failure')
            original[chain] = {'actor': copy.deepcopy(self.actors[chain]),
                'definitions': {str(definition): {'sha256': self.v.sha(definition.read_bytes()),
                                                 'identity': self.v.file_identity(definition)}},
                'environmentFiles': self.v.environment_files(self.m, unit),
                'unitSecurity': self.v.unit_security(self.m, unit), 'activation': self.v.activation(self.m, unit)}
        self.operation = {'operatorSha256': self.operator, 'manifestSha256': self.manifest_sha,
            'planSha256': self.plan_sha, 'bootId': 'boot-fixture', 'originalFreeRoutes': original}
        self.op_sha = self.put(self.v.BASE / 'operation.json', self.operation)
        self.financial = {'format': FINANCIAL_OWNER.FORMAT, 'phase': 'admit', 'committed': True,
            'planSha256': self.plan_sha, **{k: self.plan[k] for k in ('permits', 'startMs', 'expiresMs')}}
        self.financial_sha = self.put(self.v.FINANCIAL / 'result.json', self.financial)
        self.link = {'format': 'yunipals-alchemy-source-switch-v1-admission-link', 'operatorSha256': self.operator,
            'manifestSha256': self.manifest_sha, 'operationSha256': self.op_sha,
            'planSha256': self.plan_sha, 'financialResultSha256': self.financial_sha}
        self.link_sha = self.put(self.v.BASE / 'financial-admission-link.json', self.link)
        routes = {}
        for index, chain in enumerate(self.v.CHAINS):
            mode = (modes or {}).get(chain, 'never-paid')
            row = {'mode': mode, **{k: copy.deepcopy(original[chain][k]) for k in ('actor', 'definitions', 'environmentFiles')}}
            if mode != 'never-paid':
                row['actor'] = self.make_actor(200000 + index, 30000000 + index)
                self.actors[chain] = copy.deepcopy(row['actor'])
                self.states[self.unit(chain)]['MainPID'] = str(200000 + index)
                definition_sha = self.journal(chain, 'paid-definition-intent', {'operationSha256': self.op_sha,
                    'chain': chain, 'bootId': 'boot-fixture'})
                intent = {'operationSha256': self.op_sha, 'chain': chain, 'bootId': 'boot-fixture',
                    'paidDefinitionIntentSha256': definition_sha, 'processes': [], 'ownedBackends': []}
                if mode == 'prepared-stopped':
                    intent['startNeverAttempted'] = True
                else:
                    intent['paidStartIntentSha256'] = self.journal(chain, 'paid-start-intent', {
                        'operationSha256': self.op_sha, 'chain': chain, 'bootId': 'boot-fixture',
                        'admissionLinkSha256': self.link_sha})
                    intent['processes'] = [{'pid': 99999999, 'startTicks': 100}]
                    intent['ownedBackends'] = [{'pid': 900000 + index, 'backendStart': 'owned-epoch-' + chain}]
                stop_sha = self.journal(chain, 'paid-stop-intent', intent)
                row['paidStopResultSha256'] = self.journal(chain, 'paid-stopped', {
                    'operationSha256': self.op_sha, 'intentSha256': stop_sha, 'terminal': True})
                row['freeStartIntentSha256'] = self.journal(chain, 'free-start-intent', {
                    'operationSha256': self.op_sha, 'bootId': 'boot-fixture', 'notBeforeUs': 30000000})
                row['freeStartResultSha256'] = self.journal(chain, 'free-started', {
                    'operationSha256': self.op_sha, 'intentSha256': row['freeStartIntentSha256'], 'actor': row['actor']})
            routes[chain] = row
        self.quiet = {'format': 'yunipals-alchemy-source-switch-v1-paid-quiet', 'financialResultSha256': self.financial_sha,
            'planSha256': self.plan_sha, 'admissionLinkSha256': self.link_sha, 'operationSha256': self.op_sha,
            'operatorSha256': self.operator, 'manifestSha256': self.manifest_sha, 'routes': routes}
        self.save_quiet()

    def unit(self, chain):
        return 'yunipals-combined-rpc@' + chain + '.service'

    def make_actor(self, pid, start):
        return {'startMonotonicMicroseconds': start, 'processes': [{'pid': pid, 'startTicks': start,
            'commandSha256': self.v.sha((self.a.NODE + '\0' + str(self.v.FREE_ARTIFACT) + '\0').encode()),
            'privileges': {'NoNewPrivs': '1', **dict.fromkeys(['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'], '0')}}]}

    def put(self, path, value):
        raw = self.v.encoded(value)
        path.write_bytes(raw)
        path.chmod(0o600)
        return self.v.sha(raw)

    def journal(self, chain, name, value):
        return self.put(self.v.BASE / (chain + '-' + name + '.json'), value)

    def save_quiet(self):
        self.quiet_sha = self.put(self.v.BASE / 'paid-quiet.json', self.quiet)

    def state(self, _m, unit):
        return copy.deepcopy(self.states[unit])

    def actor(self, _m, state, expected):
        chain = state['Id'].split('@')[1].split('.')[0]
        if self.hook:
            self.hook(chain)
        if expected != {'PUBLIC_FREE_FLAG': 'false'}:
            raise RuntimeError('exact_selected_free_environment_required')
        return copy.deepcopy(self.actors[chain])

    def metric(self, port):
        self.metric_calls += 1
        return copy.deepcopy(self.metrics[port])

    def run(self, args):
        if args[0].endswith('busctl'):
            obj, prop = args[-3], args[-1]
            unit = next((name for name in self.states if self.bus_object(name) == obj), None)
            if prop == 'Job':
                return json.dumps({'type': '(uo)', 'data': self.jobs[unit]})
            if prop == 'EnvironmentFiles':
                return json.dumps({'type': 'a(sb)', 'data': [[str(self.env_paths[unit]), False]]})
            if prop in {'ExecCondition', 'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost'}:
                return json.dumps(getattr(self, 'hook_bus_values', {}).get(prop,
                    {'type': 'a(sasbttttuii)', 'data': []}))
            if hasattr(self, 'bus_values'):
                return json.dumps(self.bus_values[(unit, prop)])
            raise AssertionError(args)
        if args[0].endswith('systemctl'):
            unit = args[2]
            fields = [arg.split('=', 1)[1] for arg in args[3:]]
            values = {'UnitFileState': 'enabled', **self.security.get(unit, {}), **self.states[unit]}
            return '\n'.join(key + '=' + values[key] for key in fields
                             if key not in getattr(self, 'omitted_manager_properties', set()))
        raise AssertionError(args)

    @staticmethod
    def bus_object(name):
        return '/org/freedesktop/systemd1/unit/' + ''.join(c if c.isalnum() else '_' + format(ord(c), '02x') for c in name)

    def validate(self):
        return self.v.validate_paid_quiet(self.quiet_sha, self.financial_sha)

    def deadlines(self):
        self.bus_values = {}
        units = {}
        wants = self.v.SYSTEMD / 'timers.target.wants'
        wants.mkdir(mode=0o755)
        for name, verb in self.v.DEADLINES.items():
            self.jobs[name] = [0, '/']
            path = self.v.SYSTEMD / name
            if verb:
                content = '\n'.join(['[Service]', 'Type=oneshot', 'ExecStart=/usr/bin/python3 -I -B ' +
                    str(self.v.LIFECYCLE) + ' ' + verb + ' ' + self.plan_sha]) + '\n'
                self.states[name] = {'Id': name, 'LoadState': 'loaded', 'FragmentPath': str(path), 'DropInPaths': '',
                    'MainPID': '0', 'UnitFileState': 'static', 'ActiveState': 'inactive', 'Type': 'oneshot',
                    'User': 'root', 'Group': 'root', 'Restart': 'no', 'NoNewPrivileges': 'yes', 'KillMode': 'control-group'}
                self.bus_values[(name, 'TimeoutStartUSec')] = {'type': 't', 'data': [900000000]}
                self.bus_values[(name, 'TimeoutStopUSec')] = {'type': 't', 'data': [90000000]}
            else:
                due = self.plan['nextUtcMs'] if '-utc-' in name else self.plan['expiresMs']
                content = '\n'.join(['[Timer]', 'Persistent=true', 'Unit=' + name.replace('.timer', '.service'),
                    'OnCalendar=' + self.v.calendar(due), 'AccuracySec=1us', 'RandomizedDelaySec=0']) + '\n'
                self.states[name] = {'Id': name, 'LoadState': 'loaded', 'FragmentPath': str(path), 'DropInPaths': '',
                    'UnitFileState': 'enabled', 'ActiveState': 'active'}
                self.bus_values[(name, 'NextElapseUSecRealtime')] = {'type': 't', 'data': [due * 1000]}
            path.write_text(content)
            row = {'sha256': self.v.sha(path.read_bytes()), 'identity': self.v.file_identity(path)}
            if not verb:
                (wants / name).symlink_to(path)
                row['bootLink'] = self.v.link_record(wants / name)
            units[name] = row
        self.deadline = {'format': 'yunipals-alchemy-source-switch-v1-deadline-prepared', 'planSha256': self.plan_sha,
            'operationSha256': self.op_sha, 'operatorSha256': self.operator, 'manifestSha256': self.manifest_sha,
            'units': units}
        self.deadline_sha = self.put(self.v.BASE / 'deadline-prepared.json', self.deadline)
        return self.v.validate_deadline_prepared(self.plan_sha, self.deadline_sha)


class Tests(unittest.TestCase):
    def test_actual31_field_manager_shape_uses_five_typed_empty_hooks(self):
        f = Fixture(self)
        f.omitted_manager_properties = {'ExecCondition', 'ExecStartPre', 'ExecStartPost', 'ExecStop', 'ExecStopPost'}
        self.assertEqual(len(f.v.UNIT_SECURITY_FIELDS) - len(f.omitted_manager_properties), 31)
        self.assertTrue(f.validate()['paidRequestsQuiet'])
        f.hook_bus_values = {'ExecStop': {'type': 'a(sasbttttuii)', 'data': [['foreign-hook']]}}
        with self.assertRaisesRegex(RuntimeError, 'actual_typed_empty'): f.validate()
        f.hook_bus_values = {'ExecStop': {'type': 'as', 'data': []}}
        with self.assertRaisesRegex(RuntimeError, 'actual_typed_empty'): f.validate()
        f.hook_bus_values = {}
        f.omitted_manager_properties.add('KillMode')
        with self.assertRaisesRegex(RuntimeError, 'complete_actual_manager'): f.validate()

    def test_actual_financial_acknowledge_result_is_consumed_by_actual_leaf(self):
        # Execute the actual producer's result builder and actual financial model
        # against its public offline snapshot fixture, rather than copying its
        # wire format into the consumer fixture. No production query or COMMIT.
        controls = sibling('ypal-alchemy-catchup-financial-v1.test.py')
        before, ranges = controls.fixture()
        model = controls.m
        plan = model.plan(before, ranges, 'd' * 64, before['clockMs'], controls.PROFILE)
        f = Fixture(self, plan=plan)
        (f.v.FINANCIAL / 'result.json').unlink()
        row = {'before': before, 'plan': plan, 'planSha256': f.plan_sha}
        f.put(f.v.FINANCIAL / 'prepared.json', row)
        current = model.expected_admitted(before, plan)
        intent = {'phase': 'admit', 'xid': '123', 'before': before, 'after': current}
        f.put(f.v.FINANCIAL / 'admission-commit-intent.json', intent)
        owner = types.SimpleNamespace(intent=lambda _: intent, prepared=lambda: row, m=model,
            h=types.SimpleNamespace(snapshot=lambda: current, sources_sha='a' * 64, range_sha='d' * 64),
            s=types.SimpleNamespace(boot=lambda: 'boot-fixture'), producer=lambda: 'b' * 64,
            xid_status=lambda _: 'committed',
            digest=lambda name: f.v.sha((f.v.FINANCIAL / name).read_bytes()),
            put=lambda name, value: f.put(f.v.FINANCIAL / name, value))
        # The producer checks its own fixed BASE for exclusive absence.
        actual_base = FINANCIAL_OWNER.BASE
        try:
            FINANCIAL_OWNER.BASE = f.v.FINANCIAL
            proof = FINANCIAL_OWNER.Owner.acknowledge(owner, 'admission-commit-intent.json', 'admit')
        finally:
            FINANCIAL_OWNER.BASE = actual_base
        f.financial_sha = proof['resultSha256']
        f.link['financialResultSha256'] = f.financial_sha
        f.quiet['financialResultSha256'] = f.financial_sha
        f.quiet['admissionLinkSha256'] = f.put(f.v.BASE / 'financial-admission-link.json', f.link)
        f.save_quiet()
        self.assertTrue(f.validate()['paidRequestsQuiet'])
        actual_result = json.loads((f.v.FINANCIAL / 'result.json').read_bytes())
        self.assertEqual(actual_result['format'], FINANCIAL_OWNER.FORMAT)
        self.assertTrue(actual_result['committed'])

    def test_four_never_paid_after_real_financial_ack(self):
        f = Fixture(self)
        before = (f.v.BASE / 'operation.json').read_bytes()
        self.assertTrue(f.validate()['paidRequestsQuiet'])
        self.assertEqual((f.v.BASE / 'operation.json').read_bytes(), before)
        self.assertNotIn('financialResultSha256', f.operation)

    def test_mixed_never_prepared_and_paid_stopped(self):
        f = Fixture(self, {'base': 'paid-stopped', 'polygon': 'prepared-stopped'})
        self.assertEqual(f.validate()['routeModes'], {'ethereum': 'never-paid', 'base': 'paid-stopped',
            'polygon': 'prepared-stopped', 'bnb': 'never-paid'})

    def test_never_paid_new_intent_refuses(self):
        for phase in load().ROUTE_JOURNALS:
            with self.subTest(phase=phase):
                f = Fixture(self)
                f.journal('base', phase, {'notAcknowledged': True})
                with self.assertRaisesRegex(RuntimeError, 'never_attempted'):
                    f.validate()

    def test_prepared_with_any_start_intent_refuses(self):
        f = Fixture(self, {'base': 'prepared-stopped'})
        f.journal('base', 'paid-start-intent', {})
        with self.assertRaisesRegex(RuntimeError, 'never_attempted'):
            f.validate()

    def test_missing_admission_link_refuses(self):
        f = Fixture(self)
        (f.v.BASE / 'financial-admission-link.json').unlink()
        with self.assertRaises(FileNotFoundError):
            f.validate()

    def test_wrong_plan_financial_result_refuses(self):
        f = Fixture(self)
        f.financial['expiresMs'] += 1
        f.financial_sha = f.put(f.v.FINANCIAL / 'result.json', f.financial)
        f.quiet['financialResultSha256'] = f.financial_sha
        f.link['financialResultSha256'] = f.financial_sha
        f.quiet['admissionLinkSha256'] = f.put(f.v.BASE / 'financial-admission-link.json', f.link)
        f.save_quiet()
        with self.assertRaisesRegex(RuntimeError, 'committed_financial_result'):
            f.validate()

    def test_never_paid_restarted_actor_refuses(self):
        f = Fixture(self)
        f.actors['ethereum']['processes'][0]['startTicks'] += 1
        with self.assertRaisesRegex(RuntimeError, 'exact_acknowledged'):
            f.validate()

    def test_changed_private_file_refuses(self):
        f = Fixture(self)
        f.env_paths[f.unit('ethereum')].write_bytes(b'changed private input\n')
        with self.assertRaisesRegex(RuntimeError, 'private_file_chain'):
            f.validate()

    def test_changed_definition_same_path_refuses(self):
        f = Fixture(self)
        Path(f.states[f.unit('base')]['FragmentPath']).write_bytes(b'changed definition\n')
        with self.assertRaisesRegex(RuntimeError, 'definition_bytes'):
            f.validate()

    def test_original_security_and_activation_are_not_actor_fields(self):
        f = Fixture(self)
        f.security[f.unit('bnb')]['NoNewPrivileges'] = 'no'
        with self.assertRaisesRegex(RuntimeError, 'security_and_boot'):
            f.validate()

    def test_actual_proxy_process_must_retain_nnp_and_empty_caps(self):
        for field in ('NoNewPrivs', 'CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'):
            with self.subTest(field=field):
                f = Fixture(self)
                actor = f.actors['base']
                actor['processes'][0]['privileges'][field] = '0' if field == 'NoNewPrivs' else '1'
                # Even an otherwise matching immutable operation must not admit this security profile.
                f.operation['originalFreeRoutes']['base']['actor'] = copy.deepcopy(actor)
                f.op_sha = f.put(f.v.BASE / 'operation.json', f.operation)
                f.link['operationSha256'] = f.op_sha
                f.quiet['admissionLinkSha256'] = f.put(f.v.BASE / 'financial-admission-link.json', f.link)
                f.quiet['operationSha256'] = f.op_sha
                f.quiet['routes']['base']['actor'] = copy.deepcopy(actor)
                f.save_quiet()
                with self.assertRaisesRegex(RuntimeError, 'zero_capability'):
                    f.validate()

    def test_boot_link_added_refuses(self):
        f = Fixture(self)
        wants = f.v.SYSTEMD / 'multi-user.target.wants'
        wants.mkdir(mode=0o755)
        (wants / f.unit('base')).symlink_to(f.states[f.unit('base')]['FragmentPath'])
        with self.assertRaisesRegex(RuntimeError, 'security_and_boot'):
            f.validate()

    def test_manager_job_refuses(self):
        f = Fixture(self)
        f.jobs[f.unit('base')] = [42, '/org/freedesktop/systemd1/job/42']
        with self.assertRaisesRegex(RuntimeError, 'manager_must_have_no_job'):
            f.validate()

    def test_escaped_known_paid_process_refuses_using_real_proc_identity(self):
        f = Fixture(self, {'ethereum': 'paid-stopped'})
        path = f.v.BASE / 'ethereum-paid-stop-intent.json'
        intent = json.loads(path.read_bytes())
        raw = Path('/proc/self/stat').read_text()
        intent['processes'] = [{'pid': os.getpid(), 'startTicks': int(raw[raw.rfind(')') + 2:].split()[19])}]
        stopped_path = f.v.BASE / 'ethereum-paid-stopped.json'
        stopped = json.loads(stopped_path.read_bytes())
        stopped['intentSha256'] = f.put(path, intent)
        f.quiet['routes']['ethereum']['paidStopResultSha256'] = f.put(stopped_path, stopped)
        f.save_quiet()
        with self.assertRaisesRegex(RuntimeError, 'gone_even_if_escaped'):
            f.validate()

    def test_owned_backend_start_tuple_still_present_refuses(self):
        f = Fixture(self, {'base': 'paid-stopped'})
        intent = json.loads((f.v.BASE / 'base-paid-stop-intent.json').read_bytes())
        f.rows = intent['ownedBackends']
        with self.assertRaisesRegex(RuntimeError, 'backend_epochs_must_be_drained'):
            f.validate()
        f.rows[0]['backendStart'] += '-new-independent-epoch'
        self.assertTrue(f.validate()['validated'])

    def test_paid_started_without_positive_process_witness_refuses(self):
        f = Fixture(self, {'base': 'paid-stopped'})
        intent_path = f.v.BASE / 'base-paid-stop-intent.json'
        intent = json.loads(intent_path.read_bytes())
        intent['processes'] = []
        stopped_path = f.v.BASE / 'base-paid-stopped.json'
        stopped = json.loads(stopped_path.read_bytes())
        stopped['intentSha256'] = f.put(intent_path, intent)
        f.quiet['routes']['base']['paidStopResultSha256'] = f.put(stopped_path, stopped)
        f.save_quiet()
        with self.assertRaisesRegex(RuntimeError, 'lost_paid_start_identity'):
            f.validate()

    def test_lost_paid_start_ack_accepts_only_explicit_stable_terminal_scan(self):
        f = Fixture(self, {'base': 'paid-stopped'})
        f.v.PROC = f.root / 'proc'
        f.v.PROC.mkdir()
        intent_path = f.v.BASE / 'base-paid-stop-intent.json'
        intent = json.loads(intent_path.read_bytes())
        intent.update(processes=[], terminalScanRequired=True)
        stopped_path = f.v.BASE / 'base-paid-stopped.json'
        stopped = json.loads(stopped_path.read_bytes())
        stopped['intentSha256'] = f.put(intent_path, intent)
        f.quiet['routes']['base']['paidStopResultSha256'] = f.put(stopped_path, stopped)
        f.save_quiet()
        calls = []
        original = f.v.rpc_process_snapshot
        def capture(uid, deadline):
            calls.append(uid)
            return original(uid, deadline)
        f.v.rpc_process_snapshot = capture
        with patch.object(f.v.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=111)):
            self.assertTrue(f.validate()['paidRequestsQuiet'])
        self.assertEqual(calls, [111] * 4)  # initial pair plus final pre-CAS pair

    def test_full_uid_scan_real_proc_escaped_paid_child_then_crashed_child(self):
        f = Fixture(self)
        # Actual kernel /proc and actual subprocess, outside every owned cgroup
        # fixture. Direct parser accepts the local test UID; production export
        # still derives and requires the fixed non-root RPC account.
        f.v.PAID_ARTIFACT = f.root / 'reviewed-paid.mjs'
        child = subprocess.Popen(['/usr/bin/python3', '-c', 'import time;time.sleep(20)', str(f.v.PAID_ARTIFACT)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            with self.assertRaisesRegex(RuntimeError, 'outside_owned_cgroup'):
                f.v.rpc_process_snapshot(os.getuid(), f.v.time.monotonic() + 8)
        finally:
            child.kill()
            child.wait(timeout=5)
        rows = f.v.rpc_process_snapshot(os.getuid(), f.v.time.monotonic() + 8)
        self.assertNotIn(child.pid, [row['pid'] for row in rows])

    def test_same_uid_scan_changed_or_unknown_program_refuses(self):
        f = Fixture(self)
        f.v.PROC = f.root / 'proc'
        f.v.PROC.mkdir()
        def process(pid, command, state='S'):
            root = f.v.PROC / str(pid)
            root.mkdir()
            (root / 'status').write_text('Uid:\t111\t111\t111\t111\n')
            (root / 'stat').write_text(str(pid) + ' (fixture) ' + state + ' ' + ' '.join(['1'] * 18 + ['100']))
            (root / 'cmdline').write_bytes(command)
            return root
        p = process(100, b'/usr/bin/node\0reviewed-free.mjs\0')
        with patch.object(f.v.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=111)):
            self.assertTrue(f.v.assert_no_paid_proxy_processes()['zeroPaid'])
            (p / 'cmdline').write_bytes(b'')
            with self.assertRaisesRegex(RuntimeError, 'unknown_live_same_uid'):
                f.v.assert_no_paid_proxy_processes()
            (p / 'cmdline').write_bytes(b'/usr/bin/node\0reviewed-free.mjs\0')
            original = f.v.rpc_process_snapshot
            count = 0
            def drift(uid, deadline):
                nonlocal count
                result = original(uid, deadline)
                count += 1
                if count == 1:
                    (p / 'cmdline').write_bytes(b'/usr/bin/node\0changed-free.mjs\0')
                return result
            f.v.rpc_process_snapshot = drift
            with self.assertRaisesRegex(RuntimeError, 'inventory_must_be_stable'):
                f.v.assert_no_paid_proxy_processes()

    def test_scan_paid_invocation_in_unknown_or_escaped_same_uid_path_refuses(self):
        f = Fixture(self)
        f.v.PROC = f.root / 'proc'
        f.v.PROC.mkdir()
        p = f.v.PROC / '200'
        p.mkdir()
        (p / 'status').write_text('Uid:\t111\t111\t111\t111\n')
        (p / 'stat').write_text('200 (escaped) S ' + ' '.join(['1'] * 18 + ['100']))
        (p / 'cmdline').write_bytes(b'/usr/bin/python3\0-c\0import(' + str(f.v.PAID_ARTIFACT).encode() + b')\0')
        with patch.object(f.v.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=111)):
            with self.assertRaisesRegex(RuntimeError, 'outside_owned_cgroup'):
                f.v.assert_no_paid_proxy_processes()

    def test_late_first_actor_and_definition_drift_fenced_after_last_metrics(self):
        for kind in ('actor', 'definition'):
            with self.subTest(kind=kind):
                f = Fixture(self)
                metric = f.metric
                def late(port):
                    result = metric(port)
                    if f.metric_calls == 8:
                        if kind == 'actor':
                            f.actors['ethereum']['processes'][0]['startTicks'] += 1
                        else:
                            Path(f.states[f.unit('ethereum')]['FragmentPath']).write_bytes(b'late mutation\n')
                    return result
                f.v.metrics = late
                with self.assertRaisesRegex(RuntimeError, 'final_four'):
                    f.validate()

    def test_free_active_and_queued_work_does_not_block_paid_quiet(self):
        f = Fixture(self, {'base': 'paid-stopped', 'bnb': 'prepared-stopped'})
        for metric in f.metrics.values():
            metric.update(activeUpstreamRequests=2, queuedSourceRequests=17)
        self.assertTrue(f.validate()['paidRequestsQuiet'])

    def test_paid_mode_calls_and_each_actual_fallback_flag_refuse(self):
        flags = ('paidFallbackOnFreeFailure', 'foregroundPaidFallbackOnFreeFailure',
                 'orderPaidFallbackOnFreeFailure', 'sourcePaidFallbackOnFreeFailure',
                 'salePaidFallbackOnFreeFailure')
        source = FILE.with_name('ypal-combined-rpc-pool-one-v1') / 'rpc-budget-proxy.mjs'
        self.assertEqual(load().sha(source.read_bytes()), load().FREE_ARTIFACT_SHA)
        text = source.read_text()
        for key in flags:
            self.assertIn(key, text)
        for path in ('paidCalls', 'sourceRouting', *flags):
            with self.subTest(field=path):
                f = Fixture(self)
                metric = f.metrics[f.v.CHAINS['base']]
                if path == 'paidCalls': metric['traffic'][path] = 1
                elif path == 'sourceRouting': metric['unified'][path] = 'paid_primary'
                else: metric[path] = True
                with self.assertRaisesRegex(RuntimeError, 'free_route_without_paid'):
                    f.validate()

    def test_free_work_metrics_are_typed_and_bounded(self):
        for key, value in (('activeUpstreamRequests', -1), ('activeUpstreamRequests', 3),
                           ('activeUpstreamRequests', False), ('queuedSourceRequests', 65),
                           ('queuedSourceRequests', '1'), ('maximumConcurrentUpstreamRequests', 65),
                           ('sourceQueueLimit', 65), ('sourcePaidFallbackOnFreeFailure', 0)):
            with self.subTest(key=key, value=value):
                f = Fixture(self)
                f.metrics[f.v.CHAINS['base']][key] = value
                with self.assertRaisesRegex(RuntimeError, 'free_route_without_paid'):
                    f.validate()

    def test_backend_tuple_projection_matches_actual_lifecycle_sql(self):
        f = Fixture(self)
        statements = []
        f.m.query = lambda sql: statements.append(sql) or []
        f.validate()
        lifecycle = FILE.with_name('ypal-alchemy-source-switch-v1.py').read_text()
        projection = "jsonb_build_object('pid',pid,'backendStart',backend_start::text)"
        self.assertIn(projection, lifecycle)
        self.assertIn(projection, statements[0])

    def test_deadlines_can_be_prepared_before_financial_commit(self):
        f = Fixture(self)
        (f.v.FINANCIAL / 'result.json').unlink()
        (f.v.BASE / 'financial-admission-link.json').unlink()
        self.assertTrue(f.deadlines()['deadlinePrepared'])

    def test_actual_six_field_timer_show_has_no_service_mainpid(self):
        f = Fixture(self)
        self.assertTrue(f.deadlines()['deadlinePrepared'])
        observed = {'Id', 'LoadState', 'ActiveState', 'UnitFileState', 'FragmentPath', 'DropInPaths'}
        for name, verb in f.v.DEADLINES.items():
            if not verb:
                self.assertEqual(set(f.states[name]), observed)
                self.assertNotIn('MainPID', f.states[name])
        timer = next(n for n, verb in f.v.DEADLINES.items() if not verb)
        f.jobs[timer] = [42, '/org/freedesktop/systemd1/job/42']
        with self.assertRaisesRegex(RuntimeError, 'manager_must_have_no_job'):
            f.v.validate_deadline_prepared(f.plan_sha, f.deadline_sha)

    def test_typed_timeout_and_due_date_negative_controls(self):
        for prop, value in [('TimeoutStartUSec', {'type': 't', 'data': [899000000]}),
                            ('TimeoutStopUSec', {'type': 't', 'data': [91000000]}),
                            ('TimeoutStartUSec', {'type': 's', 'data': ['900000000']}),
                            ('NextElapseUSecRealtime', {'type': 't', 'data': [1]})]:
            with self.subTest(prop=prop):
                f = Fixture(self)
                f.deadlines()
                name = next(n for n, verb in f.v.DEADLINES.items() if (verb is None) == prop.startswith('Next'))
                f.bus_values[(name, prop)] = value
                with self.assertRaises(RuntimeError):
                    f.v.validate_deadline_prepared(f.plan_sha, f.deadline_sha)

    def test_runtime_max_does_not_substitute_oneshot_timeout(self):
        f = Fixture(self)
        f.deadlines()
        service = next(n for n, verb in f.v.DEADLINES.items() if verb)
        f.bus_values[(service, 'TimeoutStartUSec')] = {'type': 't', 'data': [18446744073709551615]}
        with self.assertRaisesRegex(RuntimeError, 'bounded_root_owned'):
            f.v.validate_deadline_prepared(f.plan_sha, f.deadline_sha)

    def test_deadline_executor_nnp_oneshot_and_kill_group_are_required(self):
        for field, value in [('NoNewPrivileges', 'no'), ('Type', 'exec'), ('KillMode', 'process'), ('Restart', 'on-failure')]:
            with self.subTest(field=field):
                f = Fixture(self)
                f.deadlines()
                service = next(n for n, verb in f.v.DEADLINES.items() if verb)
                f.states[service][field] = value
                with self.assertRaisesRegex(RuntimeError, 'bounded_root_owned'):
                    f.v.validate_deadline_prepared(f.plan_sha, f.deadline_sha)

    def test_protected_file_change_and_symlink_refuse_before_use(self):
        f = Fixture(self)
        path = f.v.BASE / 'paid-quiet.json'
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaisesRegex(RuntimeError, 'unchanged_actual_input'):
            f.validate()
        path.unlink()
        path.symlink_to(f.v.BASE / 'operation.json')
        with self.assertRaisesRegex(RuntimeError, 'protected_actual'):
            f.validate()


if __name__ == '__main__':
    unittest.main()
