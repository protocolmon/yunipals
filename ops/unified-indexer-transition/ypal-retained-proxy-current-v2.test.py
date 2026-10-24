"""Synthetic observation/peer/real-FS controls; no host, DB or network actions."""
import base64
import ast
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location('current_proxy', HERE / 'ypal-retained-proxy-current-v2.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def packets():
    old = {'actor': {'pid': 111, 'invocation': 'old', 'startMonotonicMicroseconds': 100,
        'processes': [{'pid': 111, 'startTicks': 10, 'environmentSha256': 'old-env', 'commandSha256': 'exact-code',
            'parentPid': 1, 'privileges': {'uid': 962, 'caps': 'zero'}, 'environmentFileHashes': {'private.env': 'same'}}]},
        'settings': {'MainPID': '111', 'InvocationID': 'old', 'ExecMainStartTimestampMonotonic': '100',
            'NRestarts': '0', 'ActiveState': 'active', 'SubState': 'running', 'WorkingDirectory': '/fixed'},
        'definitionHashes': {'unit.service': 'same'}, 'environmentFileHashes': {'private.env': 'same'},
        'environmentPropertySha256': 'same', 'environmentFilesPropertySha256': 'same'}
    new = copy.deepcopy(old); new['actor'].update(pid=222, invocation='new', startMonotonicMicroseconds=200)
    new['actor']['processes'][0].update(pid=222, startTicks=20, environmentSha256='captured-new-env')
    new['settings'].update(MainPID='222', InvocationID='new', ExecMainStartTimestampMonotonic='200')
    return old, new


class Tests(unittest.TestCase):
    def test_only_explicit_new_runtime_tuple_is_semantically_equal(self):
        old, new = packets(); self.assertEqual(m.semantic_proxy(old, new), m.semantic_proxy(old, old))

    def test_private_static_command_parent_and_privilege_drift_never_normalized(self):
        old, good = packets()
        for change in [lambda v: v['environmentFileHashes'].update({'private.env': 'changed'}),
            lambda v: v['definitionHashes'].update({'unit.service': 'changed'}),
            lambda v: v.update(environmentPropertySha256='changed'),
            lambda v: v['actor']['processes'][0].update(commandSha256='changed'),
            lambda v: v['actor']['processes'][0].update(parentPid=99),
            lambda v: v['actor']['processes'][0]['privileges'].update(caps='new'),
            lambda v: v['actor']['processes'].append(copy.deepcopy(v['actor']['processes'][0])),
            lambda v: v['settings'].update(NRestarts='1'), lambda v: v['settings'].update(WorkingDirectory='/foreign')]:
            bad = copy.deepcopy(good); change(bad)
            with self.assertRaises(RuntimeError): m.semantic_proxy(old, bad)

    def peer(self, mutate=None, unit=m.UNIT, cgroup=None, declared=None):
        cgroup = cgroup or '/system.slice/' + unit
        request = {'pid': 222, 'uid': 962, 'gid': 959, 'startTicks': 20, 'invocation': 'new-invocation',
            'expected': declared if declared is not None else {'NODE_ENV': 'production', 'PRIVATE_DATABASE_URL': 'synthetic-only-private'},
            'managerPath': '/usr/bin:/bin', 'managerLang': 'C.UTF-8', 'memoryPressureThresholdUs': 200000,
            'unit': unit, 'cgroup': cgroup}
        environment = {**request['expected'], 'HOME': '/nonexistent', 'USER': 'yunipals-market-prod-rpc', 'LOGNAME': 'yunipals-market-prod-rpc',
            'INVOCATION_ID': request['invocation'], 'SYSTEMD_EXEC_PID': '222', 'PATH': request['managerPath'], 'LANG': request['managerLang'],
            'JOURNAL_STREAM': '11:12', 'MEMORY_PRESSURE_WATCH': '/sys/fs/cgroup' + cgroup + '/memory.pressure',
            'MEMORY_PRESSURE_WRITE': base64.b64encode(b'some 200000 2000000\0').decode()}
        if mutate: mutate(environment)
        raw = b''.join(k.encode() + b'=' + v.encode() + b'\0' for k, v in environment.items())
        texts = {'/proc/self/status': 'NoNewPrivs: 1\nCapInh: 0\nCapPrm: 0\nCapEff: 0\nCapAmb: 0\n',
            '/proc/222/cgroup': '0::' + cgroup + '\n',
            '/proc/222/stat': '222 (node) ' + ' '.join(['S', '1'] + ['0'] * 17 + ['20'] + ['0'] * 10)}
        binaries = {'/proc/222/environ': raw, '/proc/222/cmdline': b'/opt/node\0/fixed/proxy.mjs\0'}
        class FakePath:
            def __init__(self, value): self.value = str(value)
            def __truediv__(self, value): return FakePath(self.value + '/' + str(value))
            def read_text(self): return texts[self.value]
            def read_bytes(self): return binaries[self.value]
        output = io.StringIO()
        with patch('pathlib.Path', FakePath), patch('os.getuid', return_value=962), patch('os.geteuid', return_value=962), \
             patch('os.getgid', return_value=959), patch('os.getegid', return_value=959), patch('os.getgroups', return_value=[]), \
             patch('pwd.getpwuid', return_value=types.SimpleNamespace(pw_dir='/nonexistent', pw_name='yunipals-market-prod-rpc')), \
             patch('os.stat', return_value=types.SimpleNamespace(st_dev=11, st_ino=12)), patch('sys.stdin', io.StringIO(json.dumps(request))), patch('sys.stdout', output):
            exec(compile(m.ENV_PEER, '<reviewed-peer>', 'exec'), {})
        result = json.loads(output.getvalue())
        self.assertEqual(result['fullEnvironmentSha256'], m.sha(raw)); self.assertEqual(result['valueBytesExported'], 0)
        self.assertNotIn('synthetic-only-private', output.getvalue())
        return result

    def test_actual_peer_program_checks_all_merged_private_values_and_binds_full_digest(self):
        for unit in m.PROXY_UNITS:
            group = '/system.slice/' + ('system-yunipals-rpc.slice/' if '@' in unit else '') + unit
            self.assertTrue(self.peer(unit=unit, cgroup=group)['allDeclaredValuesMatch'])

    def test_peer_refuses_any_unit_outside_exact_five_and_foreign_cgroup(self):
        with self.assertRaises(AssertionError): self.peer(unit='yunipals-foreign.service')
        with self.assertRaises(AssertionError): self.peer(cgroup='/system.slice/foreign.service')

    def test_actual_peer_rejects_unknown_or_changed_private_values(self):
        for change in [lambda v: v.update(UNDECLARED_SECRET='foreign'), lambda v: v.update(PRIVATE_DATABASE_URL='changed'), lambda v: v.pop('NODE_ENV')]:
            with self.assertRaises(AssertionError): self.peer(change)

    def test_actual_peer_rejects_wrong_invocation_exec_account_journal_and_psi_fields(self):
        for key, value in [('INVOCATION_ID', 'foreign'), ('SYSTEMD_EXEC_PID', '333'), ('USER', 'root'), ('HOME', '/root'),
            ('PATH', '/foreign'), ('LANG', 'foreign'), ('JOURNAL_STREAM', '9:9'), ('MEMORY_PRESSURE_WATCH', '/other'),
            ('MEMORY_PRESSURE_WRITE', base64.b64encode(b'some 1 2000000\0').decode())]:
            with self.assertRaises(AssertionError): self.peer(lambda v: v.update({key: value}))

    def test_two_full_stable_observations_are_required_for_default_review(self):
        with patch.object(m, 'observe', side_effect=[({'rpc': {'new': 1}}, {}), ({'rpc': {'new': 2}}, {})]):
            with self.assertRaisesRegex(RuntimeError, 'two_complete_stable'): m.review()

    def test_rpc_component_never_qualifies_or_observes_temporary_source_API(self):
        value = {'rpc': {'same': 'captured'}}; seen = []
        def observe(include_source=True):
            self.assertIs(include_source, False); seen.append(include_source); return value, {'private': 'actual-components'}
        with patch.object(m, 'acknowledgement', return_value={'binding': {'components': {**value, 'sourcePreservation': {'old': 'retired'}}}}), patch.object(m, 'observe', side_effect=observe):
            result, components = m.qualified_rpc_components('a' * 64)
        self.assertEqual(seen, [False, False]); self.assertEqual(components['private'], 'actual-components')
        for key in ('sourceActorQualified', 'temporaryYpalSourceAndApiQualified', 'sourceReadinessQualified', 'readerRoleGraphQualified', 'financialWriteAuthorityQualified', 'historicalWholeValidatorPassed'):
            self.assertIs(result[key], False)

    def test_rpc_current_refuses_any_change_after_actual_acknowledgement(self):
        with patch.object(m, 'acknowledgement', return_value={'binding': {'components': {'rpc': {'expected': True}}}}), patch.object(m, 'observe', return_value=({'rpc': {'foreign': True}}, {})):
            with self.assertRaisesRegex(RuntimeError, 'same_acknowledged_current_RPC'): m.validate_rpc_current('a' * 64)

    def test_strict_source_component_is_separate_and_requires_two_equal_current_frames(self):
        value = {'rpc': {'same': True}, 'sourcePreservation': {'same': True}}; seen = []
        def observe(include_source=True):
            self.assertIs(include_source, True); seen.append(include_source); return value, {'sourcePreservation': {'actualSource': True}}
        with patch.object(m, 'acknowledgement', return_value={'binding': {'components': value}}), patch.object(m, 'observe', side_effect=observe):
            result, raw = m.qualified_source_components('a' * 64)
        self.assertEqual(seen, [True, True]); self.assertTrue(result['sourceActorQualified']); self.assertTrue(result['temporaryYpalSourceAndApiQualified'])
        self.assertFalse(result['sourceReadinessQualified']); self.assertTrue(raw['sourcePreservation']['actualSource'])
        with patch.object(m, 'acknowledgement', return_value={'binding': {'components': value}}), patch.object(m, 'observe', side_effect=[(value, {}), ({**value, 'sourcePreservation': {'changed': True}}, {})]):
            with self.assertRaisesRegex(RuntimeError, 'same_acknowledged_strict_source'): m.validate_source_current('a' * 64)

    def test_wrong_review_cannot_create_any_capture_path(self):
        with tempfile.TemporaryDirectory(dir=HERE) as tmp, patch.object(m, 'review', return_value={'reviewHash': 'expected'}):
            base = Path(tmp) / 'not-created'
            with patch.object(m, 'BASE', base):
                with self.assertRaisesRegex(RuntimeError, 'exact_fresh_current_proxy_review'): m.capture('wrong')
            self.assertFalse(base.exists())

    def test_capture_is_exclusive_0700_0600_summary_and_preserves_old_receipts(self):
        with tempfile.TemporaryDirectory(dir=HERE) as tmp:
            root = Path(tmp); base = root / 'current'; original = root / 'original.json'; original.write_bytes(b'original-receipt')
            components = {'rpc': {'originalSourceOperationSha256': m.SOURCE_OP, 'originalSourceReceiptSha256': m.SOURCE_ACK,
                'finiteSemanticProxyUnits': list(m.PROXY_UNITS), 'newProxyRuntimes': {name: {} for name in m.PROXY_UNITS},
                'fullEnvironmentProofs': {name: {} for name in m.PROXY_UNITS}, 'semanticProxySha256': {name: 'a' * 64 for name in m.PROXY_UNITS}}, 'sourcePreservation': {'fixed': True}}
            binding = {'format': m.FORMAT, 'operatorSha256': m.producer(), 'bootId': m.boot(), 'components': components,
                'historicalWholeValidatorPassed': False, 'semanticCurrentQualificationPassed': True, 'sourceCoverageQualified': False,
                'providerCalls': 0, 'databaseWrites': 0, 'serviceActions': 0, 'secretValuesExported': False}
            checked = {'binding': binding, 'reviewHash': m.sha(m.encoded(binding))}
            def save(path, value, mode):
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode)
                with os.fdopen(fd, 'wb') as stream: stream.write(m.encoded(value))
            register = types.SimpleNamespace(load=lambda: (types.SimpleNamespace(sync=lambda path: None, save=save),))
            with patch.object(m, 'BASE', base), patch.object(m, 'review', return_value=checked), patch.object(m, 'observe', return_value=(components, {})), patch.object(m, 'module', return_value=register):
                result = m.capture(checked['reviewHash']); self.assertTrue(m.acknowledgement(result['receiptSha256'])['captured'])
                self.assertEqual(stat.S_IMODE(base.stat().st_mode), 0o700); self.assertEqual(stat.S_IMODE((base / 'result.json').stat().st_mode), 0o600)
                with self.assertRaisesRegex(RuntimeError, 'fresh_current_proxy_ack_directory'): m.capture(checked['reviewHash'])
                (base / 'result.json').chmod(0o644)
                with self.assertRaisesRegex(RuntimeError, 'exact_private_current_proxy_ack_modes'): m.acknowledgement(result['receiptSha256'])
            self.assertEqual(original.read_bytes(), b'original-receipt')

    def test_source_files_and_frozen_reader_package_remain_exact(self):
        import hashlib
        self.assertEqual(hashlib.sha256((HERE / 'ypal-combined-release-register-v1.py').read_bytes()).hexdigest(), m.REGISTER_SHA)
        self.assertEqual(hashlib.sha256((HERE / 'ypal-native-cutover-v1.py').read_bytes()).hexdigest(), '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b')
        self.assertEqual(hashlib.sha256((HERE / 'ypal-native-cutover-v1.manifest.json').read_bytes()).hexdigest(), 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168')
        self.assertEqual(hashlib.sha256((HERE / 'ypal-retained-proxy-current-v1.py').read_bytes()).hexdigest(), '6149c6851ee15b39c6212ed3b41fe0348e3d6254e2459d4878656782da257221')

    def test_semantic_epoch_is_exact_five_not_an_unbounded_service_exception(self):
        old, current = {}, {}
        for index, unit in enumerate(m.PROXY_UNITS):
            a, b = packets(); a['actor']['pid'] += index; a['actor']['processes'][0]['pid'] += index
            b['actor']['pid'] += index; b['actor']['processes'][0]['pid'] += index; old[unit] = a; current[unit] = b
        with patch.object(m.Path, 'exists', return_value=False):
            self.assertEqual(set(m.semantic_epoch(old, current)), set(m.PROXY_UNITS))
            for mutate in [lambda v: v.pop(m.PROXY_UNITS[0]), lambda v: v.update({'unbounded.service': copy.deepcopy(v[m.UNIT])}),
                lambda v: v[m.UNIT]['actor']['processes'][0].update(parentPid=999),
                lambda v: v[m.UNIT]['actor'].update(invocation=old[m.UNIT]['actor']['invocation'])]:
                bad = copy.deepcopy(current); mutate(bad)
                with self.assertRaises(RuntimeError): m.semantic_epoch(old, bad)
        with patch.object(m.Path, 'exists', return_value=True):
            with self.assertRaisesRegex(RuntimeError, 'original_PIDs_gone'): m.semantic_epoch(old, current)

    def test_all_non_scope_functions_are_AST_identical_to_staged_v1(self):
        def functions(path):
            tree = ast.parse(path.read_text()); return {node.name: ast.dump(node, include_attributes=False) for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef))}
        previous = functions(HERE / 'ypal-retained-proxy-current-v1.py'); current = functions(HERE / 'ypal-retained-proxy-current-v2.py')
        self.assertEqual(set(current) - set(previous), {'semantic_epoch', 'proxy_boot', 'typed_environment_files'})
        self.assertEqual({name for name in previous if previous[name] != current[name]}, {'proxy_environment', 'rpc_snapshot', 'acknowledgement'})

    def typed_fixture(self, rows=None):
        unit = m.PROXY_UNITS[0]; definition = '[Service]\nEnvironmentFile=/fixed/common.env\nEnvironmentFile=/fixed/%i.env\nEnvironmentFile=/fixed/common.env\n'
        files = {'/fixed/unit.service': definition.encode(), '/fixed/common.env': b'FIRST=retained\nVALUE=old\n', '/fixed/ethereum.env': b'VALUE=effective\n'}
        packet = {'definitionHashes': {'/fixed/unit.service': m.sha(files['/fixed/unit.service'])},
            'environmentFileHashes': {path: m.sha(raw) for path, raw in files.items() if path.endswith('.env')}}
        expected = [['/fixed/common.env', False], ['/fixed/ethereum.env', False], ['/fixed/common.env', False]]
        state = {'MainPID': '222', 'InvocationID': 'new', 'EnvironmentFiles': '/fixed/common.env (ignore_errors=no)'}
        current = {'type': 'a(sb)', 'data': expected if rows is None else rows}
        host = types.SimpleNamespace(run=lambda *args, **kwargs: json.dumps(current).encode(), protected=lambda path: files[str(path)])
        return unit, packet, host, expected, files, state

    def test_typed_array_retains_earlier_repeated_properties_order_duplicates_and_instance(self):
        unit, packet, host, expected, _, state = self.typed_fixture()
        # state deliberately contains only the LAST systemctl show row.
        self.assertEqual(state['EnvironmentFiles'], '/fixed/common.env (ignore_errors=no)')
        self.assertEqual(m.typed_environment_files(host, unit, packet), [tuple(row) for row in expected])

    def test_typed_array_refuses_lost_earlier_file_optional_foreign_path_or_order(self):
        for rows in [[['/fixed/common.env', False]], [['/fixed/common.env', True], ['/fixed/ethereum.env', False], ['/fixed/common.env', False]],
                     [['/fixed/foreign.env', False]], [['/fixed/ethereum.env', False], ['/fixed/common.env', False], ['/fixed/common.env', False]],
                     [['/fixed/../foreign.env', False]], [['/fixed/common.env', 0]]]:
            unit, packet, host, *_ = self.typed_fixture(rows)
            with self.assertRaises(RuntimeError): m.typed_environment_files(host, unit, packet)

    def test_full_environment_merge_uses_typed_array_and_checks_the_actual_last_override(self):
        unit, packet, host, expected, files, state = self.typed_fixture()
        packet['settings'] = {'Id': unit}; packet['actor'] = {'pid': 222, 'invocation': 'new', 'cgroup': '/system.slice/' + unit,
            'processes': [{'startTicks': 20, 'environmentSha256': 'e' * 64}]}
        parsed = {'NODE_ENV': 'production', 'FIRST': 'retained', 'VALUE': 'old'}; seen = []
        def run(args, data=None, **kwargs):
            if args[-1] == 'EnvironmentFiles': return json.dumps({'type': 'a(sb)', 'data': expected}).encode()
            if args[-1] == 'MemoryPressureThresholdUSec': return json.dumps({'type': 't', 'data': 200000}).encode()
            if args[:2] == ['/usr/bin/systemctl', 'show-environment']: return b'PATH=/usr/bin:/bin\nLANG=C.UTF-8\n'
            self.assertEqual(args[0], '/usr/bin/setpriv'); value = json.loads(data); seen.append(value['expected'])
            self.assertEqual(value['expected'], parsed)
            return json.dumps({'pid': 222, 'startTicks': 20, 'fullEnvironmentSha256': 'e' * 64,
                'declaredEnvironmentSha256': m.sha(m.encoded(parsed)), 'allDeclaredValuesMatch': True,
                'onlyVerifiedSystemdRuntimeExtras': True, 'valueBytesExported': 0}).encode()
        host.run = run
        parser = types.SimpleNamespace(service_property=lambda unit, key: ['NODE_ENV=production'] if key == 'Environment' else [],
            ordered_files=lambda *_: self.fail('collapsed state property must not be parsed'),
            parse_env=lambda raw: dict(line.split('=', 1) for line in raw.decode().splitlines()))
        api = types.SimpleNamespace(state=lambda *args: state)
        with patch.object(m.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=962, pw_gid=959)):
            result = m.proxy_environment(host, api, packet, parser)
        self.assertEqual(seen, [parsed]); self.assertEqual(result['effectiveEnvironmentFileCount'], 3)
        self.assertTrue(result['allDeclaredValuesMatch'])
        self.assertTrue(self.peer(unit=unit, declared=parsed)['allDeclaredValuesMatch'])
        with self.assertRaises(AssertionError): self.peer(lambda value: value.update(VALUE='wrong-earlier-override'), unit=unit, declared=parsed)


if __name__ == '__main__': unittest.main()
