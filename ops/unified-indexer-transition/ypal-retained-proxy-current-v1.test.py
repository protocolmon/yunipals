"""Synthetic observation/peer/real-FS controls; no host, DB or network actions."""
import base64
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
spec = importlib.util.spec_from_file_location('current_proxy', HERE / 'ypal-retained-proxy-current-v1.py')
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

    def peer(self, mutate=None):
        request = {'pid': 222, 'uid': 962, 'gid': 959, 'startTicks': 20, 'invocation': 'new-invocation',
            'expected': {'NODE_ENV': 'production', 'PRIVATE_DATABASE_URL': 'synthetic-only-private'},
            'managerPath': '/usr/bin:/bin', 'managerLang': 'C.UTF-8', 'memoryPressureThresholdUs': 200000}
        environment = {**request['expected'], 'HOME': '/nonexistent', 'USER': 'yunipals-market-prod-rpc', 'LOGNAME': 'yunipals-market-prod-rpc',
            'INVOCATION_ID': request['invocation'], 'SYSTEMD_EXEC_PID': '222', 'PATH': request['managerPath'], 'LANG': request['managerLang'],
            'JOURNAL_STREAM': '11:12', 'MEMORY_PRESSURE_WATCH': '/sys/fs/cgroup/system.slice/yunipals-ypal-base-rpc.service/memory.pressure',
            'MEMORY_PRESSURE_WRITE': base64.b64encode(b'some 200000 2000000\0').decode()}
        if mutate: mutate(environment)
        raw = b''.join(k.encode() + b'=' + v.encode() + b'\0' for k, v in environment.items())
        texts = {'/proc/self/status': 'NoNewPrivs: 1\nCapInh: 0\nCapPrm: 0\nCapEff: 0\nCapAmb: 0\n',
            '/proc/222/cgroup': '0::/system.slice/yunipals-ypal-base-rpc.service\n',
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
        self.assertTrue(self.peer()['allDeclaredValuesMatch'])

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
            components = {'rpc': {'originalSourceOperationSha256': m.SOURCE_OP, 'originalSourceReceiptSha256': m.SOURCE_ACK}, 'sourcePreservation': {'fixed': True}}
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


if __name__ == '__main__': unittest.main()
