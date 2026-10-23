import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


H = load('booster-feature-handover-v6')
PARITY = load('booster-source-parity-v2')


def checkpoint(number):
    return str(int(time.time())).zfill(10) + str(8453).zfill(16) + str(number).zfill(16) + '9' * 33


def fixture():
    graph = json.loads((HERE / 'consumer-owned-booster-graph-v1.json').read_bytes())
    role = {'oid': H.ROLE_OID, 'name': H.ROLE, 'login': True, 'inherit': False, 'super': False,
        'createRole': False, 'createDatabase': False, 'replication': False, 'bypassRls': False,
        'limit': 6, 'passwordConfigured': False, 'memberships': 0}
    def row(schema, name, oid, selected):
        return {'schema': schema, 'name': name, 'oid': oid, 'owner': H.OWNER_OID, 'kind': 'r',
                'select': selected, 'writes': False, 'acl': [{'grantor': H.OWNER_OID, 'grantee': H.OWNER_OID, 'privilege': 'SELECT', 'grantable': False}]}
    value = {'identity': {'database': 'yunipals_backfill', 'socket': True}, 'role': role,
        'schemas': [{'name': schema, 'oid': oid, 'owner': H.OWNER_OID, 'usage': True, 'create': False, 'acl': 'unchanged'}
                    for schema, oid in ((H.OLD, graph['schemaOid']), (H.TARGET, H.TARGET_OID))],
        'tables': [row(H.OLD, r['name'], r['oid'], r['name'] in H.TARGET_OIDS) for r in graph['tables']] +
                  [row(H.TARGET, name, oid, name.startswith('_ponder_')) for name, oid in H.TARGET_OIDS.items()]}
    return graph, value


class FakeHost:
    """Only controlled lifecycle I/O is faked; Owner methods/files are actual."""
    def __init__(self, env):
        self.env = env; self.graph, self.catalog = fixture(); self.boundary = 52848550
        self.commands = []; self.serial = 100; self.valid_event = True; self.drop_sql_ack = False
        self.units = {}
        self.unit_bytes = {}
        for unit, uid in ((H.API, H.ROLE), (H.QUEUE, H.ROLE), (H.TIMER, H.ROLE), (H.SOURCE, 'yunipals_unified_shadow')):
            self.unit_bytes['/etc/systemd/system/' + unit] = unit.encode()
            self.units[unit] = {'Id': unit, 'ActiveState': 'active' if unit != H.QUEUE else 'inactive',
                'SubState': 'running', 'MainPID': '123' if unit not in {H.QUEUE, H.TIMER} else '0',
                'InvocationID': 'a' * 32 if unit == H.API else 'c' * 32, 'Job': '0',
                'ExecMainStartTimestampMonotonic': '1', 'User': uid, 'Group': uid,
                'FragmentPath': '/etc/systemd/system/' + unit, 'DropInPaths': '', 'ControlGroup': '',
                'UnitFileState': 'enabled', 'WantedBy': 'multi-user.target' if unit == H.SOURCE else '',
                'RequiredBy': '', 'UpheldBy': '', 'TriggeredBy': '', 'Result': 'success'}
        self.policy = types.SimpleNamespace(QUEUE_INPUTS={
            '/etc/systemd/system/' + H.QUEUE: H.sha(self.unit_bytes['/etc/systemd/system/' + H.QUEUE]),
            '/etc/systemd/system/' + H.TIMER: H.sha(self.unit_bytes['/etc/systemd/system/' + H.TIMER]),
            'queue/booster-artwork-sync.mjs': 'e' * 64})

    def state(self, unit): return copy.deepcopy(self.units[unit])
    def actor(self, unit): return self.state(unit)
    def source(self, terminal=False):
        value = self.state(H.SOURCE)
        if not terminal and value['ActiveState'] != 'active': H.fail('old_source_must_stay_live_until_new_event_proof')
        return value
    def source_inputs(self): return {'argvSha256': '1' * 64, 'environmentFiles': {'exact': '2' * 64}, 'nodeSha256': '3' * 64, 'workingDirectory': 'exact'}
    def feature(self, expected):
        if self.env.read_bytes() != expected or self.units[H.API]['ActiveState'] != 'active': H.fail('fixture_feature_unavailable')
        api = {**self.state(H.API), 'definitionSha256': H.sha(self.unit_bytes['/etc/systemd/system/' + H.API]),
               'environmentSha256': H.sha(expected), 'bundleSha256': 'd' * 64}
        return {'api': api, 'queueInputs': dict(self.policy.QUEUE_INPUTS), 'timer': self.state(H.TIMER), 'queue': self.state(H.QUEUE)}
    def snapshot(self, admitted): return H.validate_snapshot(copy.deepcopy(self.catalog), self.graph, admitted)
    def sql(self, text):
        if text.endswith('COMMIT;'):
            self.catalog = H.after_eight_reads(self.catalog, 'REVOKE SELECT' in text)
            if self.drop_sql_ack:
                self.drop_sql_ack = False; raise OSError('intentional lost commit acknowledgement')
        return ''
    def mono(self): return time.monotonic_ns() // 1000
    def command(self, action, unit, expected_identity=None):
        self.commands.append((action, unit)); state = self.units[unit]
        if action == 'stop': state.update(ActiveState='inactive', SubState='dead', MainPID='0', InvocationID='', ControlGroup='')
        elif action == 'start':
            self.serial += 1
            state.update(ActiveState='active' if unit != H.QUEUE else 'inactive', SubState='running',
                MainPID=str(self.serial) if unit not in {H.QUEUE, H.TIMER} else '0',
                InvocationID=format(self.serial, '032x'), ExecMainStartTimestampMonotonic=str(self.mono()))
        else:
            state['UnitFileState'] = 'enabled' if action == 'enable' else 'disabled'
            if unit == H.SOURCE: state['WantedBy'] = 'multi-user.target' if action == 'enable' else ''
    def query(self, text): return {'n': 0}
    def consumers(self, *args, **kwargs): return [{'role': r, 'resultSha256': 'f' * 64, 'invocation': 'a' * 32} for r in ('yunipals_unified_api', 'yunipals_unified_collector', 'yunipals_unified_read_cache', 'yunipals_unified_islands_api')]
    def parity_proof(self, path, pin): return {'reportSha256': pin, 'boundary': self.boundary, 'headerHash': '0x' + 'a' * 64}
    def availability(self, boundary, build): return {'publicReady': True, 'buildId': build, 'indexedBlock': boundary, 'cachedArtwork': ['unchanged']}
    def queue_proof(self, start_us, boundary): return {'invocation': self.units[H.QUEUE]['InvocationID'] or 'b' * 32, 'queued': 0, 'indexedBlock': boundary, 'monotonicUs': self.mono()}
    def activation_paths(self): return ['multi-user.target.wants/' + H.SOURCE] if self.units[H.SOURCE]['UnitFileState'] == 'enabled' else []
    def fresh_event(self, event, boundary):
        if not self.valid_event or event['blockNumber'] <= boundary: H.fail('actual_unique_post_switch_event_and_native_header_required')
        return event
    def native_ready(self, schema, build, boundary): return {'buildId': build, 'completeBlock': boundary}
    def queue_live(self): return True
    def shared_quiet(self): return {'combinedUnlocked': True, 'port9024Closed': True}
    def source_runtime(self, inputs, boundary):
        source = self.source()
        return {'unit': H.SOURCE, 'invocation': source['InvocationID'], 'pid': int(source['MainPID']), 'uid': 970, 'gid': 964,
            'cgroup': '/system.slice/' + H.SOURCE, 'actorPids': [int(source['MainPID'])], 'completeUidInventory': True,
            'schema': H.OLD, 'buildId': '6d581272ce', 'nativeLocked': True, 'nativeReady': True,
            'completeBlock': boundary, 'sourceRoleSessions': 5, 'inputs': inputs}


class Tests(unittest.TestCase):
    def test_environment_changes_exactly_one_public_selector(self):
        original = (HERE.parent / 'booster-launch/booster-api.env').read_bytes()
        changed = H.replace_schema(original)
        self.assertEqual(changed.replace(H.TARGET.encode(), H.OLD.encode()), original)
        for raw in (original + b'BOOSTER_DATABASE_SCHEMA=foreign\n', original.replace(H.OLD.encode(), b'foreign')):
            with self.assertRaises(RuntimeError): H.replace_schema(raw)

    def test_exact_eight_read_delta_has_no_login_write_or_old_read_mutation(self):
        graph, before = fixture(); H.validate_snapshot(before, graph, False)
        after = H.after_eight_reads(before); H.validate_snapshot(after, graph, True)
        self.assertEqual(before['role'], after['role'])
        self.assertEqual([r for r in before['tables'] if r['schema'] == H.OLD], [r for r in after['tables'] if r['schema'] == H.OLD])
        self.assertEqual(H.after_eight_reads(after, True), before)
        text = H.grant_sql(before, after)
        self.assertEqual(text.count('GRANT SELECT ON TABLE'), 8)
        self.assertNotIn('ALTER ROLE', text); self.assertTrue(text.endswith('ROLLBACK;'))
        for mutate in ('login', 'password', 'targetoid', 'oldread', 'write'):
            bad = copy.deepcopy(before)
            if mutate == 'login': bad['role']['login'] = False
            elif mutate == 'password': bad['role']['passwordConfigured'] = True
            elif mutate == 'targetoid': next(r for r in bad['tables'] if r['schema'] == H.TARGET)['oid'] = '1'
            elif mutate == 'oldread': next(r for r in bad['tables'] if r['name'] == 'booster_event')['select'] = False
            else: bad['tables'][0]['writes'] = True
            with self.assertRaises(RuntimeError, msg=mutate): H.validate_snapshot(bad, graph, False)

    def test_stopped_actor_GC_is_not_a_foreign_invocation_exception(self):
        prior = {'Id': H.API, 'FragmentPath': '/etc/systemd/system/' + H.API, 'User': H.ROLE, 'Group': H.ROLE, 'InvocationID': 'a' * 32}
        state = {**prior, 'MainPID': '0', 'ActiveState': 'inactive', 'InvocationID': '', 'Job': '0', 'DropInPaths': ''}
        H.stopped_owned(state, prior, 'same', 'same')
        for key, value in [('InvocationID', 'b' * 32), ('MainPID', '123'), ('Group', 'root'), ('Job', '12'), ('DropInPaths', 'foreign')]:
            with self.assertRaises(RuntimeError): H.stopped_owned({**state, key: value}, prior, 'same', 'same')
        with self.assertRaises(RuntimeError): H.stopped_owned(state, prior, 'same', 'foreign-file')

    def test_queue_GC_requires_trusted_actor_new_success_and_coverage(self):
        row = {'_SYSTEMD_UNIT': H.QUEUE, '_SYSTEMD_INVOCATION_ID': 'a' * 32, '__MONOTONIC_TIMESTAMP': '101',
               '_UID': '967', '_GID': '961', '_EXE': '/opt/node-v24.18.1/bin/node',
               'MESSAGE': json.dumps({'event': 'booster_artwork_queue_sync', 'skipped': False, 'queued': 0, 'indexedBlock': '200'})}
        self.assertEqual(H.queue_completion([row], 100, 200)['indexedBlock'], 200)
        for changed in ({'_UID': '0'}, {'_EXE': '/tmp/foreign'}, {'__MONOTONIC_TIMESTAMP': '99'}, {'_SYSTEMD_INVOCATION_ID': ''}):
            with self.assertRaises(RuntimeError): H.queue_completion([{**row, **changed}], 100, 200)
        with self.assertRaises(RuntimeError): H.queue_completion([row], 100, 201)

    def test_lost_ack_is_reconciled_without_repeating_successful_action(self):
        with tempfile.TemporaryDirectory(prefix='feature-step-') as tmp:
            host = types.SimpleNamespace(mono=lambda: 1); owner = H.Owner(host, tmp); owner.initialize()
            calls = []
            def action(): calls.append('start'); raise OSError('lost acknowledgement after successful start')
            observe = lambda intent: {'invocation': 'a' * 32}
            with self.assertRaises(OSError): owner.step('owned-start', action, observe)
            with self.assertRaisesRegex(RuntimeError, 'explicit_reconcile'): owner.step('owned-start', action, observe)
            result = owner.step('owned-start', action, observe, True)
            self.assertTrue(result['reconciled']); self.assertEqual(calls, ['start'])
            with tempfile.TemporaryDirectory(prefix='cross-boot-') as other:
                stale = H.Owner(host, other); stale.initialize()
                stale.put('old-start-intent.json', {'bootId': 'another-boot'})
                with self.assertRaisesRegex(RuntimeError, 'cross_boot'):
                    stale.step('old-start', action, observe, True)

    def test_only_the_actual_pinned_esbuild_direct_child_is_allowed(self):
        argv = [H.ESBUILD, '--service=0.25.12', '--ping']
        # Exact production path/argv pins remain in force. Only the executable
        # digest is replaced for this synthetic binary-content fixture.
        with patch.object(H, 'ESBUILD_SHA', H.sha(b'fixture executable')):
            H.validate_esbuild_child(H.ESBUILD, b'fixture executable', argv, 10, 10)
            for path, raw, args, parent in [(H.ESBUILD, b'foreign', argv, 10),
                    ('/tmp/esbuild', b'fixture executable', argv, 10),
                    (H.ESBUILD, b'fixture executable', argv, 11),
                    (H.ESBUILD, b'fixture executable', [H.ESBUILD, '--service=0.25.12', '--foreign'], 10)]:
                with self.assertRaises(RuntimeError): H.validate_esbuild_child(path, raw, args, parent, 10)

    def test_actual_fresh_event_query_requires_both_sources_and_canonical_header(self):
        host = H.Host.__new__(H.Host); host.parity = PARITY
        event = {'blockNumber': 52848551, 'blockHash': '0x' + 'a' * 64, 'transactionHash': '0x' + 'b' * 64, 'logIndex': 0}
        value = {'left': 1, 'right': 1, 'header': event['blockHash'], 'checkpoint': checkpoint(event['blockNumber'])}
        host.query = lambda text: value
        self.assertEqual(host.fresh_event(event, 52848550), event)
        for key, change in [('left', 0), ('right', 2), ('header', '0x' + 'c' * 64), ('checkpoint', checkpoint(52848550))]:
            with patch.dict(value, {key: change}):
                with self.assertRaises(RuntimeError): host.fresh_event(event, 52848550)
        with self.assertRaises(RuntimeError): host.fresh_event(event, event['blockNumber'])

    def test_native_readiness_and_source_env_argv_bindings_are_exact(self):
        host = H.Host.__new__(H.Host); host.parity = PARITY
        app = {'build_id': '6d581272ce', 'is_ready': 1, 'is_locked': 1, 'is_dev': 0, 'version': '6', 'heartbeat_at': int(time.time() * 1000)}
        value = {'app': app, 'checkpoint': checkpoint(52848560)}
        host.query = lambda sql: value
        self.assertEqual(host.native_ready(H.OLD, '6d581272ce', 52848560)['completeBlock'], 52848560)
        for key, bad in [('build_id', 'wrong'), ('is_locked', 0), ('is_ready', 0), ('heartbeat_at', 0)]:
            with patch.dict(app, {key: bad}):
                with self.assertRaises(RuntimeError): host.native_ready(H.OLD, '6d581272ce', 52848560)
        with tempfile.TemporaryDirectory(prefix='source-env-') as tmp:
            a, b = Path(tmp) / 'launch.env', Path(tmp) / 'public.env'
            a.write_bytes(b'opaque-private-fixture-only\n'); b.write_bytes(b'PUBLIC=fixture\n')
            argv = ['/usr/bin/env', '-i', '/opt/node-v24.18.1/bin/node', '--max-old-space-size=1024',
                    '--env-file=' + str(a), '--env-file=' + str(b), '/fixed/ponder.js', 'start', '--root', '/fixed',
                    '--config', 'fixed.ts', '--schema', H.OLD, '--hostname', '127.0.0.1', '--port', '9026']
            state = {'ExecStart': '{ path=/usr/bin/env ; argv[]=' + ' '.join(argv) + ' ; ignore_errors=no ; }', 'WorkingDirectory': '/fixed'}
            host.source = lambda *args: state
            original = H.protected
            with patch.object(H, 'protected', side_effect=lambda path, cap=4000000: b'Node fixture bytes' if str(path) == argv[2] else original(path, cap)):
                proof = host.source_inputs()
                self.assertEqual(proof['argvSha256'], H.sha(H.encode(argv[2:])))
                a.write_bytes(b'changed-private-fixture\n')
                self.assertNotEqual(host.source_inputs(), proof)
                state['ExecStart'] = state['ExecStart'].replace('--port 9026', '--port 9024')
                with self.assertRaises(RuntimeError): host.source_inputs()

    def test_every_production_dependency_pin_is_frozen(self):
        self.assertGreaterEqual(len(H.DEPS), 6)
        for name, pin in H.DEPS.items():
            self.assertEqual(H.sha((HERE / name).read_bytes()), pin, name)

    def test_real_protected_dependency_import_and_queue_interface(self):
        # Construct the actual Host with its frozen, protected dependency bytes.
        # Only the manager observation is substituted; no FakeHost is involved.
        with patch.object(H, 'OPS', HERE): host = H.Host()
        for module, names in ((host.admission, ('sql', 'capture', 'api_binding')),
                (host.policy, ('validate_owned_feature',)),
                (host.runtime, ('validate_timer_state', 'validate_process_status')),
                (host.parity, ('assess', 'header_witness', 'query', 'snapshot_sql'))):
            for name in names: self.assertTrue(callable(getattr(module, name)), name)
        with patch.object(H, 'OPS', HERE): installer = H.load('consumer-operational-install-v7.py')
        for name in ('modules', 'installed_other', 'verify_installed'):
            self.assertTrue(callable(getattr(installer, name)), name)
        timer = {'Id': H.TIMER, 'FragmentPath': '/etc/systemd/system/' + H.TIMER,
            'ActiveState': 'active', 'SubState': 'waiting', 'UnitFileState': 'enabled',
            'DropInPaths': '', 'Triggers': H.QUEUE}
        host.state = lambda unit: copy.deepcopy(timer)
        for substate in ('waiting', 'running'):
            timer['SubState'] = substate; self.assertTrue(host.queue_live())
        for key, value in (('SubState', 'elapsed'), ('Triggers', 'foreign.service'), ('DropInPaths', '/foreign.conf')):
            with patch.dict(timer, {key: value}):
                with self.assertRaises(RuntimeError): host.queue_live()

    def test_actual_source_status_preserves_exact_inherited_capabilities(self):
        status = {'Uid': '970 970 970 970', 'Gid': '964 964 964 964', 'NoNewPrivs': '1',
            'CapInh': '0000000000200100', 'CapBnd': '000001ffffffffff',
            'CapPrm': '0000000000000000', 'CapEff': '0000000000000000', 'CapAmb': '0000000000000000'}
        proof = H.validate_source_status(status)
        self.assertEqual(proof['inheritableSha256'], H.SOURCE_CAPINH_SHA)
        for key, value in (('Uid', '0 0 0 0'), ('Gid', '964 0 964 964'), ('NoNewPrivs', '0'),
                ('CapInh', '0000000000000000'), ('CapBnd', '000001fffffffffe'),
                ('CapPrm', '1'), ('CapEff', '1'), ('CapAmb', '1')):
            with self.assertRaises(RuntimeError, msg=key): H.validate_source_status({**status, key: value})

    def test_real_Host_command_checks_current_static_inputs_and_final_stop_identity(self):
        with patch.object(H, 'OPS', HERE): host = H.Host()
        original = (HERE.parent / 'booster-launch/booster-api.env').read_bytes()
        unit_path = '/etc/systemd/system/' + H.API
        receipt_path, bundle_path = '/fixture/receipt.json', '/fixture/API.mjs'
        files = {unit_path: b'fixed API unit', str(H.ENV): original,
            '/fixture/queue.service': b'queue', '/fixture/timer.timer': b'timer',
            '/fixture/queue.mjs': b'queue bundle', bundle_path: b'API bundle'}
        files[receipt_path] = H.encode({'unitSha256': H.sha(files[unit_path])})
        host.policy.QUEUE_INPUTS = {name: H.sha(files[name]) for name in
            ('/fixture/queue.service', '/fixture/timer.timer', '/fixture/queue.mjs', str(H.ENV))}
        host.policy.RECEIPT_SHA = H.sha(files[receipt_path]); host.runtime.RECEIPT = receipt_path
        host.admission.BUNDLE = bundle_path; host.admission.BUNDLE_SHA = H.sha(files[bundle_path])
        state = {'Id': H.API, 'FragmentPath': unit_path, 'DropInPaths': '', 'Job': '0',
            'User': H.ROLE, 'Group': H.ROLE, 'ActiveState': 'inactive', 'MainPID': '0',
            'InvocationID': '', 'ExecMainStartTimestampMonotonic': '0'}
        host.state = lambda unit: copy.deepcopy(state)
        with patch.object(H, 'protected', side_effect=lambda path, cap=4000000: files[str(path)]), patch.object(host, 'run', return_value='') as run:
            host.command('start', H.API); run.assert_called_once(); run.reset_mock()
            for path, raw in ((unit_path, b'foreign unit'), (bundle_path, b'foreign bundle'),
                    (str(H.ENV), original + b'FOREIGN=1\n'), ('/fixture/queue.mjs', b'foreign queue')):
                with patch.dict(files, {path: raw}):
                    with self.assertRaises(RuntimeError): host.command('start', H.API)
                run.assert_not_called()
            with patch.dict(state, {'ActiveState': 'active', 'MainPID': '123'}):
                with self.assertRaisesRegex(RuntimeError, 'already_active_replacement'):
                    host.command('start', H.API)
            run.assert_not_called()
            state.update(ActiveState='active', MainPID='123', InvocationID='a' * 32, ExecMainStartTimestampMonotonic='20')
            prior = copy.deepcopy(state); calls = [0]
            def replaced(unit):
                calls[0] += 1
                return {**state, **({'InvocationID': 'f' * 32} if calls[0] == 3 else {})}
            host.state = replaced
            with self.assertRaisesRegex(RuntimeError, 'identity_changed_at_command_boundary'):
                host.command('stop', H.API, prior)
            run.assert_not_called()

    def test_foreign_replacement_is_refused_before_stop_and_not_adopted_after_GC(self):
        with tempfile.TemporaryDirectory(prefix='feature-stop-cas-') as tmp:
            host = FakeHost(Path(tmp) / 'env'); owner = H.Owner(host, Path(tmp) / 'owner'); owner.initialize()
            prior = host.state(H.API); pin = H.sha(host.unit_bytes['/etc/systemd/system/' + H.API])
            host.units[H.API]['InvocationID'] = 'f' * 32
            with patch.object(H, 'protected', side_effect=lambda path, cap=4000000:
                    host.unit_bytes[str(path)] if str(path) in host.unit_bytes else Path(path).read_bytes()):
                with self.assertRaisesRegex(RuntimeError, 'fresh_exact_process_identity'):
                    owner.stop_actor('replacement', H.API, prior, pin, False)
                self.assertEqual(host.commands, [])
                host.units[H.API].update(ActiveState='inactive', MainPID='0', InvocationID='')
                with self.assertRaisesRegex(RuntimeError, 'unattempted_stop_cannot'):
                    owner.stop_actor('replacement', H.API, prior, pin, True)
                self.assertEqual(host.commands, [])
                host.units[H.API] = copy.deepcopy(prior)
                def replace_during_actor_check(unit):
                    host.units[unit]['InvocationID'] = 'e' * 32
                host.actor = replace_during_actor_check
                with self.assertRaisesRegex(RuntimeError, 'changed_immediately_before_stop'):
                    owner.stop_actor('replacement-at-command', H.API, prior, pin, False)
                self.assertEqual(host.commands, [])

    def test_queue_natural_completion_after_precheck_is_adopted_without_stop(self):
        with tempfile.TemporaryDirectory(prefix='feature-queue-race-') as tmp:
            host = FakeHost(Path(tmp) / 'env'); owner = H.Owner(host, Path(tmp) / 'owner'); owner.initialize()
            host.units[H.QUEUE].update(ActiveState='active', MainPID='123', InvocationID='d' * 32)
            prior = host.state(H.QUEUE); state = host.state; calls = [0]
            def finish(unit):
                calls[0] += 1
                if calls[0] == 3: host.units[H.QUEUE].update(ActiveState='inactive', MainPID='0', InvocationID='')
                return state(unit)
            host.state = finish
            host.queue_proof = lambda *args: {'invocation': 'd' * 32, 'indexedBlock': 0, 'queued': 0}
            with patch.object(H, 'protected', side_effect=lambda path, cap=4000000:
                    host.unit_bytes[str(path)] if str(path) in host.unit_bytes else Path(path).read_bytes()):
                pin = H.sha(host.unit_bytes['/etc/systemd/system/' + H.QUEUE])
                with self.assertRaisesRegex(RuntimeError, 'changed_immediately_before_stop'):
                    owner.stop_actor('race', H.QUEUE, prior, pin, False)
                self.assertEqual(host.commands, [])
                result = owner.stop_actor('race', H.QUEUE, prior, pin, True)
                self.assertTrue(result['reconciled']); self.assertEqual(host.commands, [])

    def test_eight_read_commit_refuses_missing_final_consumer_admissions(self):
        with tempfile.TemporaryDirectory(prefix='feature-grant-order-') as tmp:
            env = Path(tmp) / 'env'; env.write_bytes((HERE.parent / 'booster-launch/booster-api.env').read_bytes())
            host = FakeHost(env); owner = H.Owner(host, Path(tmp) / 'owner'); owner.initialize()
            with patch.object(H, 'ENV', env):
                rehearsed = owner.grant_rehearsal()
                with patch.object(host, 'consumers', return_value=host.consumers()[:3]), patch.object(host, 'sql') as sql:
                    with self.assertRaisesRegex(RuntimeError, 'all_four_final_admissions'):
                        owner.grant_commit(rehearsed['reviewHash'], 'artifact', 'b' * 64)
                    sql.assert_not_called()

    def test_peer_reads_only_fixed_executable_booleans_and_stable_start_ticks(self):
        host = H.Host.__new__(H.Host)
        value = {'startTicks': 42, 'nodeExecutable': True, 'esbuildExecutable': False}
        with patch.object(host, 'run', return_value=json.dumps(value)) as run:
            self.assertEqual(host.peer_process_properties(123), value)
            args = run.call_args.args[0]
            self.assertEqual(args[:10], ['/usr/bin/setpriv', '--reuid=970', '--regid=964', '--clear-groups', '--no-new-privs',
                '--inh-caps=-all', '--ambient-caps=-all', '/usr/bin/python3', '-I', '-B'])
            self.assertNotIn('environ', H.PEER_PROC_CODE); self.assertNotIn('cmdline', H.PEER_PROC_CODE)
            for bad in ({**value, 'startTicks': True}, {**value, 'startTicks': 0},
                    {**value, 'nodeExecutable': False}, {**value, 'esbuildExecutable': True},
                    {**value, 'rawExecutable': '/foreign'}):
                run.return_value = json.dumps(bad)
                with self.assertRaises(RuntimeError): host.peer_process_properties(123)
            run.reset_mock()
            for pid in (True, 0, -1, 2 ** 31):
                with self.assertRaises(RuntimeError): host.peer_process_properties(pid)
            run.assert_not_called()

    def test_full_owned_switch_retirement_and_inverse_control_path(self):
        with tempfile.TemporaryDirectory(prefix='feature-owner-') as tmp:
            root = Path(tmp); env = root / 'env'; env.write_bytes((HERE.parent / 'booster-launch/booster-api.env').read_bytes())
            host = FakeHost(env); original_protected = H.protected
            artifact = root / 'artifact.json'; artifact.write_bytes(b'public consumer artifact fixture\n'); artifact_sha = H.sha(artifact.read_bytes())
            def read(path, cap=4000000):
                return host.unit_bytes[str(path)] if str(path) in host.unit_bytes else original_protected(path, cap)
            with patch.object(H, 'ENV', env), patch.object(H, 'BASE', root / 'owner'), patch.object(H, 'protected', side_effect=read), \
                 patch.object(H, 'SOURCE_SHA', H.sha(host.unit_bytes['/etc/systemd/system/' + H.SOURCE])), patch.object(H, 'OPS', HERE):
                owner = H.Owner(host, root / 'owner'); owner.initialize()
                rehearsed = owner.grant_rehearsal(); before = copy.deepcopy(host.catalog)
                host.drop_sql_ack = True
                with self.assertRaises(OSError): owner.grant_commit(rehearsed['reviewHash'], str(artifact), artifact_sha)
                committed = owner.grant_commit(rehearsed['reviewHash'], str(artifact), artifact_sha, True)
                self.assertTrue(committed['reconciled'])
                review = owner.switch_review('parity', 'a' * 64, 'artifact', 'b' * 64)
                command = host.command
                lost_start = [True]
                def lose_start_ack(action, unit, expected_identity=None):
                    command(action, unit, expected_identity)
                    if action == 'start' and unit == H.API and lost_start[0]:
                        lost_start[0] = False; raise OSError('intentional lost API start acknowledgement')
                with patch.object(host, 'command', side_effect=lose_start_ack):
                    with self.assertRaises(OSError): owner.switch(review, review['reviewHash'])
                starts_before = host.commands.count(('start', H.API))
                with patch.object(host, 'parity_proof', side_effect=RuntimeError('expired original header')):
                    switched = owner.switch(review, review['reviewHash'], True)
                self.assertEqual(host.commands.count(('start', H.API)), starts_before)
                self.assertFalse(switched['oldSourceRetired'])
                self.assertFalse(any(unit == H.SOURCE for action, unit in host.commands))
                self.assertEqual(env.read_bytes(), H.replace_schema((HERE.parent / 'booster-launch/booster-api.env').read_bytes()))
                event = {'blockNumber': host.boundary + 1, 'blockHash': '0x' + 'a' * 64, 'transactionHash': '0x' + 'b' * 64, 'logIndex': 0}
                host.valid_event = False
                with self.assertRaises(RuntimeError): owner.retirement_review('parity', 'c' * 64, event)
                self.assertFalse(any(unit == H.SOURCE for action, unit in host.commands))
                host.valid_event = True; host.boundary = event['blockNumber']
                review = owner.retirement_review('parity', 'c' * 64, event)
                retired = owner.retire(review, review['reviewHash'])
                self.assertEqual(retired['format'], 'yunipals-booster-source-retirement-v1')
                self.assertLessEqual(retired['parity']['boundary'], switched['switchBoundary'])
                self.assertGreaterEqual(retired['postSwitchParity']['boundary'], event['blockNumber'])
                self.assertTrue(retired['activationPathsAbsent']); self.assertTrue(retired['oldSchemaPreserved'])
                inverse = owner.inverse_review()
                actions_before = list(host.commands)
                with patch.object(host, 'shared_quiet', side_effect=RuntimeError('combined still active')):
                    with self.assertRaisesRegex(RuntimeError, 'combined still active'):
                        owner.inverse(inverse, inverse['reviewHash'])
                self.assertEqual(host.commands, actions_before)
                with patch.object(host, 'source_inputs', return_value={'foreign': True}):
                    with self.assertRaisesRegex(RuntimeError, 'original_source_inputs_required'):
                        owner.inverse(inverse, inverse['reviewHash'])
                self.assertEqual(host.commands, actions_before)
                with patch.object(host, 'source_runtime', side_effect=RuntimeError('combined not yet quiet')):
                    with self.assertRaisesRegex(RuntimeError, 'combined not yet quiet'):
                        owner.inverse(inverse, inverse['reviewHash'])
                completed_actions = list(host.commands)
                restored = owner.inverse(inverse, inverse['reviewHash'], True)
                self.assertEqual(host.commands, completed_actions)
                self.assertEqual(restored['format'], 'yunipals-booster-feature-inverse-v1')
                self.assertEqual(host.catalog, before)
                self.assertEqual(env.read_bytes(), (HERE.parent / 'booster-launch/booster-api.env').read_bytes())
                with patch.object(H, 'Host', return_value=host):
                    proof = H.validate_inverse(root / 'owner/inverse-result.json', restored['receiptSha256'])
                self.assertTrue(proof['validated']); self.assertEqual(proof['source']['sourceRoleSessions'], 5)
                self.assertEqual(host.units[H.SOURCE]['UnitFileState'], 'enabled')
                self.assertTrue(host.catalog['role']['login'])

RUNTIME = load('consumer-owned-booster-runtime-v3')


class EightReadHarness:
    """Real owner files/SQL control and original graph validator; fixed consumer I/O."""
    def __init__(self, root):
        self.root = root; self.env = root / 'feature.env'
        self.env.write_bytes((HERE.parent / 'booster-launch/booster-api.env').read_bytes())
        self.artifact = root / 'artifact.json'; self.artifact.write_bytes(b'fixed public consumer artifact\n')
        self.artifact_sha = H.sha(self.artifact.read_bytes())
        self.host = FakeHost(self.env); self.owner = H.Owner(self.host, root / 'owner'); self.owner.initialize()
        self.sql_calls = []; sql = self.host.sql
        def observed_sql(text): self.sql_calls.append(text); return sql(text)
        self.host.sql = observed_sql
        self.guards = []; self.guard_calls = 0; self.modules_calls = 0
        self.roles = {'main': 'yunipals_unified_api', 'collector': H.ROLE,
            'cache': 'yunipals_unified_read_cache', 'islands': 'yunipals_unified_islands_api'}
        self.installer = types.SimpleNamespace(BASE=root / 'installs',
            SERVICES={name: 'yunipals-' + name + '.service' for name in self.roles})
        for name, role in self.roles.items():
            base = self.installer.BASE / role; base.mkdir(parents=True)
            review = {'binding': {'fixed': name}}
            (base / 'review.json').write_bytes(H.encode(review))
            (base / 'result.json').write_bytes(H.encode({'invocation': 'a' * 32,
                'reviewFileSha256': H.sha(H.encode(review))}))
        def modules(*args):
            calls_before = self.guard_calls
            guard = types.SimpleNamespace(allowed_relations={H.OLD + '.' + name for name in H.TARGET_OIDS}
                | {H.TARGET + '.' + name for name in H.TARGET_OIDS if name not in H.ADDITIONS})
            def ensure():
                self.guard_calls += 1
                rows = self.host.catalog['tables']
                graph = {'schema': {'oid': str(self.host.graph['schemaOid']), 'owner': H.OWNER_OID},
                    'buildId': self.host.graph['buildId'],
                    'tables': [{key: row[key] for key in ('name', 'oid', 'owner', 'kind', 'select', 'writes')}
                        | {'grantable': False} for row in rows if row['schema'] == H.OLD],
                    'readerRelations': [{'name': row['schema'] + '.' + row['name'], 'select': row['select'], 'writes': row['writes']}
                        for row in rows if row['select']]}
                return RUNTIME.validate_graph(graph, self.host.graph, H.TARGET_OIDS, guard.allowed_relations)
            guard.ensure = ensure; self.guards.append(guard); self.modules_calls += 1
            a = types.SimpleNamespace(owned_booster=guard, ROLES={role: i for i, role in enumerate(self.roles.values())},
                document=H.document, protected=H.protected, sha=H.sha)
            scope = {'units': [{'unit': unit, 'role': self.roles[name]} for name, unit in self.installer.SERVICES.items()]}
            if self.guard_calls != calls_before: raise AssertionError('modules called Guard.ensure')
            return a, None, None, None, None, None, scope
        def installed(a, helper, unit, role, oid):
            a.owned_booster.ensure()
            result = H.document(self.installer.BASE / role / 'result.json')
            return {'role': role, 'resultSha256': H.sha(H.protected(self.installer.BASE / role / 'result.json')),
                'invocation': result['invocation']}
        self.installer.modules = modules; self.installer.installed_other = installed
        self.installer.verify_installed = lambda a, *args: a.owned_booster.ensure()
        self.host.acknowledge_eight_reads = types.MethodType(H.Host.acknowledge_eight_reads, self.host)
        self.host.consumers = types.MethodType(H.Host.consumers, self.host)
        self.patches = [patch.object(H, 'BASE', self.owner.base), patch.object(H, 'ENV', self.env),
            patch.object(H, 'load', return_value=types.SimpleNamespace(core=lambda mode: self.installer))]
        for item in self.patches: item.start()
        self.review = self.owner.grant_rehearsal()

    def close(self):
        for item in reversed(self.patches): item.stop()

    def consumers(self): return self.host.consumers(str(self.artifact), self.artifact_sha)
    def commit(self, resume=False): return self.owner.grant_commit(self.review['reviewHash'], str(self.artifact), self.artifact_sha, resume)
    def rewrite(self, name, mutate):
        path = self.owner.base / name; value = H.document(path); mutate(value); path.write_bytes(H.encode(value))


class EightReadSuccessorTests(unittest.TestCase):
    def harness(self):
        temporary = tempfile.TemporaryDirectory(prefix='feature-v5-eight-read-')
        self.addCleanup(temporary.cleanup)
        harness = EightReadHarness(Path(temporary.name)); self.addCleanup(harness.close)
        return harness

    def test_pre_grant_guard_is_unchanged_and_post_receipt_changes_only_new_instance(self):
        h = self.harness(); before = h.consumers(); original = h.guards[-1]
        additions = {H.TARGET + '.' + name for name in H.ADDITIONS}
        self.assertFalse(original.allowed_relations & additions)
        h.commit(); self.assertEqual(h.consumers(), before)
        self.assertEqual(h.guards[-1].allowed_relations - original.allowed_relations, additions)
        self.assertFalse(original.allowed_relations & additions)
        with self.assertRaisesRegex(RuntimeError, 'unexpected_collector_namespace'):
            original.ensure()
        self.assertGreater(h.guard_calls, h.modules_calls)

    def test_lost_SQL_ack_requires_explicit_resume_and_never_reissues_SQL(self):
        h = self.harness(); h.host.drop_sql_ack = True
        with self.assertRaises(OSError): h.commit()
        self.assertTrue((h.owner.base / 'grants-inputs.json').exists())
        self.assertFalse((h.owner.base / 'grants-result.json').exists())
        count = len(h.sql_calls)
        with self.assertRaisesRegex(RuntimeError, 'explicit_owned_grants_resume'): h.commit()
        with self.assertRaisesRegex(RuntimeError, 'unexpected_collector_namespace'): h.consumers()
        result = h.commit(True)
        self.assertTrue(result['reconciled']); self.assertEqual(len(h.sql_calls), count)
        self.assertEqual(h.consumers(), result['consumerAdmissions'])

    def test_completed_ack_with_missing_result_finishes_without_repeating_SQL(self):
        h = self.harness(); put = h.owner.put
        def lost(name, value):
            if name == 'grants-result.json': raise OSError('lost result publication')
            return put(name, value)
        with patch.object(h.owner, 'put', side_effect=lost):
            with self.assertRaises(OSError): h.commit()
        self.assertTrue((h.owner.base / 'grants-ack.json').exists())
        count = len(h.sql_calls); result = h.commit(True)
        self.assertTrue(result['committed']); self.assertEqual(len(h.sql_calls), count)

    def test_result_review_artifact_transaction_and_current_graph_mutations_refuse_before_extension(self):
        h = self.harness(); h.commit()
        result_path = h.owner.base / 'grants-result.json'; original_result = result_path.read_bytes()
        review_path = h.owner.base / 'grants-review.json'; original_review = review_path.read_bytes()
        for key, value in [('operatorSha256', 'f' * 64), ('reviewHash', 'f' * 64),
                ('beforeSha256', 'f' * 64), ('afterSha256', 'f' * 64), ('transactionSha256', 'f' * 64),
                ('artifactFile', '/tmp/unknown-artifact.json'), ('artifactSha256', 'f' * 64),
                ('committed', False), ('grantsAckSha256', 'f' * 64), ('consumerAdmissions', [])]:
            with self.subTest(key=key):
                h.rewrite('grants-result.json', lambda result: result.update({key: value}))
                with self.assertRaises(RuntimeError): h.consumers()
                self.assertFalse(h.guards[-1].allowed_relations & {H.TARGET + '.' + name for name in H.ADDITIONS})
                result_path.write_bytes(original_result)
        review = H.document(review_path); review['binding']['operatorSha256'] = 'f' * 64
        review_path.write_bytes(H.encode(review))
        with self.assertRaises(RuntimeError): h.consumers()
        review_path.write_bytes(original_review)
        h.artifact.write_bytes(b'changed artifact\n')
        with self.assertRaises(RuntimeError): h.consumers()
        h.artifact.write_bytes(b'fixed public consumer artifact\n')
        before = copy.deepcopy(h.host.catalog)
        target = next(row for row in h.host.catalog['tables'] if row['schema'] == H.TARGET)
        target['acl'].append({'grantor': H.OWNER_OID, 'grantee': '999', 'privilege': 'SELECT', 'grantable': False})
        with self.assertRaisesRegex(RuntimeError, 'current_exact_owned'): h.consumers()
        h.host.catalog = before
        old = next(row for row in h.host.catalog['tables'] if row['schema'] == H.OLD)
        old['writes'] = True
        with self.assertRaises(RuntimeError): h.consumers()

    def test_resume_refuses_changed_consumer_receipt_artifact_review_and_cross_boot(self):
        h = self.harness(); h.host.drop_sql_ack = True
        with self.assertRaises(OSError): h.commit()
        count = len(h.sql_calls)
        h.artifact.write_bytes(b'changed artifact\n')
        with self.assertRaises(RuntimeError): h.commit(True)
        h.artifact.write_bytes(b'fixed public consumer artifact\n')
        original_read = Path.read_text
        def changed_boot(path, *args, **kwargs):
            return '00000000-0000-0000-0000-000000000000' if str(path) == '/proc/sys/kernel/random/boot_id' else original_read(path, *args, **kwargs)
        with patch.object(Path, 'read_text', changed_boot):
            with self.assertRaisesRegex(RuntimeError, 'same_boot'): h.commit(True)
        review_path = h.owner.base / 'grants-review.json'; before = review_path.read_bytes()
        h.rewrite('grants-review.json', lambda value: value.update(reviewHash='f' * 64))
        with self.assertRaises(RuntimeError): h.commit(True)
        review_path.write_bytes(before)
        catalog_before = copy.deepcopy(h.host.catalog)
        target = next(row for row in h.host.catalog['tables'] if row['schema'] == H.TARGET)
        target['acl'].append({'grantor': H.OWNER_OID, 'grantee': '999', 'privilege': 'SELECT', 'grantable': False})
        with self.assertRaisesRegex(RuntimeError, 'only_exact_owned_read_delta'): h.commit(True)
        self.assertFalse((h.owner.base / 'grants-ack.json').exists())
        h.host.catalog = catalog_before
        receipt = h.installer.BASE / H.ROLE / 'result.json'
        receipt.write_bytes(H.encode({**H.document(receipt), 'invocation': 'b' * 32}))
        with self.assertRaisesRegex(RuntimeError, 'same_four_protected'): h.commit(True)
        self.assertFalse((h.owner.base / 'grants-result.json').exists())
        self.assertEqual(len(h.sql_calls), count)

    def test_actual_v2_entry_producer_and_v5_pins_are_coherent(self):
        entry = load('consumer-operational-live-booster-v1')
        previous=load('consumer-operational-marketplace-ack-v2'); previous.OPS=HERE
        with patch.object(entry, 'OPS', HERE), patch.object(entry, 'load',return_value=previous): installer = entry.core('install')
        self.assertEqual(installer.FORMAT, 'yunipals-consumer-operational-install-v7')
        self.assertEqual(H.sha(H.protected(installer.__file__)), H.DEPS['consumer-operational-live-booster-v1.py'])
        self.assertEqual(previous.HISTORY_SHA, H.DEPS[previous.HISTORY])
        self.assertNotIn('consumer-operational-marketplace-ack.py', H.DEPS)


if __name__ == '__main__': unittest.main()
