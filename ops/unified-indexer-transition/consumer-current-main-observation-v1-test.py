#!/usr/bin/env python3
"""Offline current-main qualification controls; no service/database/provider."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


m = load('consumer-current-main-observation-v1')
r = load('paid-source6-dependent-restarts-v1')
v = load('proxy-upgrade')
retained = load('retained-workers-stage-v1')


def fixture(root):
    old = {'format': 'yunipals-consumer-retained-selectors-v1', 'completed': True, 'services': []}
    for n, unit in enumerate(m.UNITS):
        old['services'].append({'unit': unit, 'invocationId': str(n + 1) * 32,
            'process': {'pid': n + 10, 'startTicks': n + 100, 'boot': 'fixed-boot'},
            'flags': {'SOLANA_API_ENABLED': 'true'}, 'orderedEnvironmentFileSelectors': ['fixed-file'],
            'actualProcessEnvironmentCompared': True})
    fresh = copy.deepcopy(old['services'])
    fresh[0]['invocationId'] = 'a' * 32
    fresh[0]['process'] = {'pid': 99, 'startTicks': 999, 'boot': 'fixed-boot'}
    env_file = root / 'private.env'
    env_file.write_text('DATABASE_URL=postgresql://private-never-export\n')
    runtime = root / 'worker.ts'; runtime.write_text('accepted public source')
    definition = root / 'api.service'; definition.write_text('[Service]\nExecStart=accepted\n')
    before = {'Id': m.MAIN, 'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running', 'InvocationID': 'b' * 32}
    props = {**before, 'InvocationID': fresh[0]['invocationId'], 'Result': 'success', 'MainPID': '99',
        'User': 'root', 'Group': 'root', 'WorkingDirectory': '/accepted',
        'ExecStart': '{ path=/usr/bin/node ; argv[]=/usr/bin/node /accepted/main.ts ; }',
        'FragmentPath': str(definition), 'DropInPaths': '', 'Environment': 'PUBLIC_FLAG=true',
        'EnvironmentFiles': str(env_file) + ' (ignore_errors=no)',
        'EnvironmentFilesEntries': [str(env_file) + ' (ignore_errors=no)']}
    prior = {'unit': m.MAIN, 'afterState': before, 'execPath': '/usr/bin/node',
        'execArgv': ['/usr/bin/node', '/accepted/main.ts'], 'workingDirectory': '/accepted',
        'definitions': {str(definition): m.sha(definition.read_bytes())},
        'privateSettings': v.private_settings(props), 'runtimeFiles': {str(runtime): m.sha(runtime.read_bytes())}}
    accepted = {'services': [prior if unit == m.MAIN else {'unit': unit} for unit in r.FIVE]}
    return old, fresh, props, accepted, runtime, env_file


class Tests(unittest.TestCase):
    def fixture(self):
        temp = tempfile.TemporaryDirectory(dir=HERE); self.addCleanup(temp.cleanup)
        return fixture(Path(temp.name))

    def context(self, old, fresh, props, accepted):
        modules = {
            'paid-source6-dependent-restarts-v1.py': types.SimpleNamespace(FIVE=r.FIVE,
                properties=lambda *args: copy.deepcopy(props), equivalent=r.equivalent),
            'proxy-upgrade.py': v,
            'dependency-rebase-range-hints-v5.py': types.SimpleNamespace(legacy_runtime=lambda path, maximum: Path(path).read_bytes()),
            'consumer-retained-selectors-observe-v1.py': types.SimpleNamespace(observe=lambda unit: copy.deepcopy(next(row for row in fresh if row['unit'] == unit))),
            'retained-workers-stage-v1.py': retained,
        }
        patches = [patch.object(m, 'load', lambda name: modules[name]),
            patch.object(m, 'document', lambda name, pin: copy.deepcopy(old if name == m.SELECTORS else accepted)),
            patch.object(v, 'safe_file', lambda path, maximum: Path(path)),
            patch.object(retained, 'process', lambda pid: {'pid': 99, 'startTicks': 999, 'bootId': 'fixed-boot'}),
            patch.object(retained, 'process_env', lambda pid: {'DATABASE_URL': 'postgresql://private-never-export', 'PUBLIC_FLAG': 'true'})]
        # The established observer names its process boot key 'boot'; retained
        # worker snapshot uses 'bootId'. The new helper must compare identities
        # through their actual fields rather than equating those DTOs directly.
        for p in patches: p.start(); self.addCleanup(p.stop)
        return modules

    def test_only_main_identity_changes_are_qualified(self):
        old, fresh, *_ = self.fixture()
        current = m.selector_delta(old, fresh)
        self.assertEqual(current['services'], fresh)
        self.assertNotEqual(old['services'][0]['invocationId'], fresh[0]['invocationId'])

    def test_original_and_all_other_selector_fields_are_preserved(self):
        for mode in ('main-flag', 'main-files', 'collector-restart', 'islands-flag', 'unchanged-main', 'missing'):
            old, fresh, *_ = self.fixture()
            if mode == 'main-flag': fresh[0]['flags']['SOLANA_API_ENABLED'] = 'false'
            if mode == 'main-files': fresh[0]['orderedEnvironmentFileSelectors'] = []
            if mode == 'collector-restart': fresh[1]['invocationId'] = 'f' * 32
            if mode == 'islands-flag': fresh[2]['flags'] = {}
            if mode == 'unchanged-main': fresh[0] = copy.deepcopy(old['services'][0])
            if mode == 'missing': fresh.pop()
            with self.subTest(mode=mode), self.assertRaises(RuntimeError): m.selector_delta(old, fresh)

    def test_full_capture_reuses_actual_static_equivalence_and_hides_private_values(self):
        old, fresh, props, accepted, *_ = self.fixture(); self.context(old, fresh, props, accepted)
        proof = m.capture()
        self.assertTrue(proof['originalMainIdentityMismatchExplicit'])
        self.assertFalse(proof['oldStoredInvocationGateClaimedPassed'])
        self.assertFalse(proof['sourceReadinessQualified'])
        self.assertNotIn('private-never-export', json.dumps(proof))

    def test_changed_runtime_definition_or_inline_private_setting_refuses(self):
        for mode in ('runtime', 'definition', 'inline'):
            old, fresh, props, accepted, runtime, _ = self.fixture(); self.context(old, fresh, props, accepted)
            if mode == 'runtime': runtime.write_text('different public source')
            if mode == 'definition': Path(props['FragmentPath']).write_text('different definition')
            if mode == 'inline': props['Environment'] = 'PUBLIC_FLAG=false'
            with self.subTest(mode=mode), self.assertRaises(RuntimeError): m.capture()

    def test_current_private_file_and_live_environment_must_match(self):
        old, fresh, props, accepted, _, env = self.fixture(); self.context(old, fresh, props, accepted)
        env.write_text('DATABASE_URL=postgresql://changed-never-export\n')
        with self.assertRaisesRegex(RuntimeError, 'files_and_source_selectors'): m.capture()

    def test_unconfigured_source_selector_in_live_process_refuses(self):
        old, fresh, props, accepted, *_ = self.fixture(); self.context(old, fresh, props, accepted)
        with patch.object(retained, 'process_env', lambda pid: {'DATABASE_URL': 'postgresql://private-never-export', 'PUBLIC_FLAG': 'true', 'OWNERSHIP_READ_MODE': 'unified'}):
            with self.assertRaisesRegex(RuntimeError, 'files_and_source_selectors'): m.capture()

    def test_actual_process_replacement_during_capture_refuses(self):
        old, fresh, props, accepted, *_ = self.fixture(); self.context(old, fresh, props, accepted)
        with patch.object(retained, 'process', side_effect=[{'pid': 99, 'startTicks': 999}, {'pid': 99, 'startTicks': 1000}]):
            with self.assertRaisesRegex(RuntimeError, 'identity_changed'): m.capture()

    def test_second_peer_observation_replacement_refuses(self):
        old, fresh, props, accepted, *_ = self.fixture(); modules = self.context(old, fresh, props, accepted)
        count = 0
        def observe(unit):
            nonlocal count
            count += 1
            row = copy.deepcopy(next(row for row in fresh if row['unit'] == unit))
            if count == 5: row['invocationId'] = 'e' * 32
            return row
        modules['consumer-retained-selectors-observe-v1.py'].observe = observe
        with self.assertRaisesRegex(RuntimeError, 'changed_during_qualification'): m.capture()

    def test_private_file_changes_during_observation_refuse_even_same_values(self):
        old, fresh, props, accepted, _, env = self.fixture(); modules = self.context(old, fresh, props, accepted)
        calls = 0
        def properties(*args):
            nonlocal calls
            calls += 1
            if calls == 2: env.write_text('# changed bytes\nDATABASE_URL=postgresql://private-never-export\n')
            return copy.deepcopy(props)
        modules['paid-source6-dependent-restarts-v1.py'].properties = properties
        with self.assertRaisesRegex(RuntimeError, 'changed_during_qualification'): m.capture()

    def test_public_runtime_changes_during_observation_refuse(self):
        old, fresh, props, accepted, runtime, _ = self.fixture(); modules = self.context(old, fresh, props, accepted)
        calls = 0
        def properties(*args):
            nonlocal calls
            calls += 1
            if calls == 2: runtime.write_text('changed after first qualification')
            return copy.deepcopy(props)
        modules['paid-source6-dependent-restarts-v1.py'].properties = properties
        with self.assertRaisesRegex(RuntimeError, 'runtime_bytes_changed'): m.capture()

    def test_scope_requires_actual_current_ack_and_never_mutates_original(self):
        old, fresh, *_ = self.fixture(); scope = {'retainedSelectors': old, 'readView': {'schema': 'fixed'}}
        before = copy.deepcopy(scope)
        current = {'currentSelectors': m.selector_delta(old, fresh), 'operatorSha256': 'a' * 64,
            'originalMainInvocation': old['services'][0]['invocationId'], 'currentMainInvocation': fresh[0]['invocationId']}
        with patch.object(m, 'validate_current', return_value=current), patch.object(m, 'document', return_value=old):
            value = m.qualify_scope(scope, '/fixed/result.json', 'b' * 64)
            self.assertEqual(scope, before)
            self.assertEqual(value['retainedSelectors']['services'][0], fresh[0])
            self.assertEqual(value['readView'], before['readView'])
            self.assertEqual(value['acknowledgedCurrentMainObservation']['sha256'], 'b' * 64)
            with self.assertRaises(RuntimeError): m.qualify_scope({'retainedSelectors': {}}, '/fixed/result.json', 'b' * 64)

    def test_default_review_has_no_output_or_service_action(self):
        with patch.object(m, 'capture', return_value={'fixed': 'safe'}), patch.object(m, 'acknowledge', side_effect=AssertionError('no write')):
            checked = m.review()
            self.assertFalse(checked['acknowledged'])
            self.assertEqual(checked['reviewHash'], m.sha(m.encoded(checked['binding'])))

    def test_existing_receipt_or_partial_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory, patch.object(m, 'BASE', Path(directory) / 'observations'), patch.object(m, 'capture', return_value={'fixed': 'safe'}):
            checked = m.review(); result = m.acknowledge(checked['reviewHash'], 'first')
            path = Path(result['receiptFile']); original = path.read_bytes()
            with self.assertRaises(FileExistsError): m.acknowledge(checked['reviewHash'], 'first')
            self.assertEqual(path.read_bytes(), original)

    def test_validate_current_refuses_unknown_changed_or_unacknowledged_receipts(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory, patch.object(m, 'BASE', Path(directory) / 'observations'), patch.object(m, 'capture', return_value={'fixed': 'safe'}):
            result = m.acknowledge(m.review()['reviewHash'], 'first'); path = Path(result['receiptFile'])
            self.assertEqual(m.validate_current(path, result['receiptSha256']), {'fixed': 'safe'})
            with self.assertRaises(RuntimeError): m.validate_current(path, '0' * 64)
            with patch.object(m, 'capture', return_value={'fixed': 'new-main-identity'}):
                with self.assertRaisesRegex(RuntimeError, 'requires_new_fresh'): m.validate_current(path, result['receiptSha256'])
            value = json.loads(path.read_bytes()); value['acknowledged'] = False; path.write_bytes(m.encoded(value))
            with self.assertRaises(RuntimeError): m.validate_current(path, m.sha(path.read_bytes()))

    def test_run_id_and_foreign_receipt_paths_refuse(self):
        for name in ('', '../foreign', '/absolute', 'x' * 41):
            with self.assertRaises(RuntimeError): m.receipt_path(name)
        with self.assertRaises(RuntimeError): m.validate_current('/tmp/result.json', 'a' * 64)

    def test_protected_inputs_reject_symlinks_hardlinks_and_writable_files(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory); target = root / 'input'; target.write_text('public')
            link = root / 'symlink'; link.symlink_to(target)
            with self.assertRaises(RuntimeError): m.protected(link)
            import os
            hard = root / 'hardlink'; os.link(target, hard)
            with self.assertRaises(RuntimeError): m.protected(hard)
            hard.unlink(); target.chmod(0o666)
            with self.assertRaises(RuntimeError): m.protected(target)

    def test_wrong_review_hash_writes_nothing(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory, patch.object(m, 'BASE', Path(directory) / 'observations'), patch.object(m, 'capture', return_value={'fixed': 'safe'}):
            with self.assertRaises(RuntimeError): m.acknowledge('0' * 64, 'first')
            self.assertFalse(m.BASE.exists())


if __name__ == '__main__': unittest.main()
