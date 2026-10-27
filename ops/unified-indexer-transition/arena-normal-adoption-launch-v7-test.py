#!/usr/bin/env python3
"""Current normal binding with unchanged adoption/configuration gates; offline only."""
import ast
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


launcher = load('arena_normal_free_launcher', HERE / 'arena-normal-adoption-launch-v7.py')
previous = load('arena_evidence_launcher', HERE / 'arena-normal-adoption-launch-v6.py')


def reconstructed(module):
    inputs = {name: (HERE / name).read_bytes() for name in module.INPUTS}
    for name, raw in inputs.items(): assert hashlib.sha256(raw).hexdigest() == module.INPUTS[name]
    return module.apply_reviewed_patch(inputs)


def functions(raw):
    return {n.name: ast.dump(n, include_attributes=False) for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef)}


class Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.files, cls.old = reconstructed(launcher), reconstructed(previous)

    def test_exact_reconstructed_sources_parse_and_adopter_syntax_is_valid(self):
        self.assertEqual(set(self.files), {launcher.OWNER, launcher.ADOPTER})
        ast.parse(self.files[launcher.OWNER])
        result = subprocess.run(['/root/.nvm/versions/node/v24.18.1/bin/node', '--check', '--input-type=module'],
            input=self.files[launcher.ADOPTER], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())

    def test_current_receipt_pin_is_real_and_obsolete_evidence_runtime_is_refused_before_IO(self):
        expected = 'e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f'
        self.assertEqual(launcher.RUNTIME_SHA, expected)
        with patch.object(launcher, 'read') as read:
            for pin in ['0' * 64, 'a' * 64, '3cd3a36ffad6fd31569835682fd02f6b0100d4d8d5a7b63ee86e1f8eeeede7b8']:
                with self.assertRaises(launcher.LaunchFailure): launcher.compose(pin)
            read.assert_not_called()
        with patch.object(launcher, 'read', side_effect=lambda path: (HERE / path.name).read_bytes()):
            files, owner = launcher.compose(expected)
        self.assertEqual(owner.NORMAL_RECEIPT_SHA, expected)
        self.assertIn(b'"' + b'0' * 64 + b'"', files[launcher.ADOPTER])

    def test_owner_operations_and_descriptor_transport_are_unchanged(self):
        before, after = functions(self.old[previous.OWNER]), functions(self.files[launcher.OWNER])
        self.assertEqual(before.keys(), after.keys())
        for name in before.keys() - {'normal_source_for_arena'}:
            self.assertEqual(before[name], after[name], name)
        normalized = (HERE / 'arena-normal-adoption-launch-v6.py').read_bytes().replace(b'arena-legacy-origin-adopt-v8', b'arena-legacy-origin-adopt-v9')
        before, after = functions(normalized), functions((HERE / 'arena-normal-adoption-launch-v7.py').read_bytes())
        for name in before.keys() - {'apply_reviewed_patch', 'compose'}:
            self.assertEqual(before[name], after[name], name)

    def test_javascript_changes_only_version_and_root_proof_binding(self):
        before = self.old[previous.ADOPTER].decode().replace('arena-legacy-origin-adopt-v8', 'arena-legacy-origin-adopt-v9')
        after = self.files[launcher.ADOPTER].decode()
        start = before.index('  demand(proof.format === ')
        end = before.index('  for (const unit of Object.keys(proof.actors))', start)
        a = after.index('  demand(proof.format === ')
        b = after.index('  for (const unit of Object.keys(proof.actors))', a)
        self.assertEqual(before[:start], after[:a]); self.assertEqual(before[end:], after[b:])
        self.assertIn('proof.nativeReadinessClaimed === false', after[a:b])
        self.assertIn('proof.paidAuthority === false', after[a:b])
        self.assertNotIn('parentNormalRuntimeReceiptSha256', after[a:b])
        for text in ['await verify(observed)', 'await source.read(identity.id)', 'halted_unified_drained_owner_target_required',
                'exact_twelve_official_migrations_required', 'verifyNormalSource(renewalTerminal);']:
            self.assertIn(text, after)

    def fixture(self, owner, root):
        current = {'pid': 716994, 'startTicks': 6611794751, 'invocation': 'c3463c9a2e1240e8890e318ba1360cf4',
            'startMonotonicMicroseconds': 66117947533239}
        receipt = {'runtime': current, 'freeOnly': True, 'paidAuthority': False, 'publicSelectionChanges': 0,
            'baseSourceConcurrency': 1, 'heapMiB': 4096, 'memoryMaxBytes': 6442450944,
            'dropSha256': '2' * 64, 'normalDropFile': '/fixed/normal.conf', 'bootLink': {'inode': 42}}
        receipt_raw = owner.encoded(receipt); pin = owner.sha(receipt_raw)
        completion = {'verified': True, 'completionSha256': '3' * 64, 'controllerResultSha256': '4' * 64}
        terminal = {'format': 'yunipals-arena-bnb-transaction-source-v1', 'verified': True,
            'actors': {owner.RENEWAL_CONTROLLERS[-1]: {'invocation': '5' * 32, 'definitionSha256': '6' * 64}},
            'priorProductiveCompletion': completion, 'controllerResultSha256': '7' * 64,
            'cleanupReceiptSha256': '8' * 64, 'financialHandoffSha256': '9' * 64}
        terminal_raw = owner.encoded(terminal)
        unit_path = Path('/fixed/original-source.service')
        data = {owner.NORMAL_BASE / 'runtime.json': receipt_raw, owner.TERMINAL_PROOF: terminal_raw, unit_path: b'fixed source unit\n'}
        s = types.SimpleNamespace(UNIT='yunipals-unified-source6-free-v2.service', ORIGINAL=unit_path, protected=lambda path: data[path])
        value = {'format': 'yunipals-source6-normal-free-successor', 'validated': True, 'runtime': current,
            'runtimeReceiptSha256': pin, 'normalOperationalRuntime': 'infinity', 'freeOnly': True,
            'paidAuthority': False, 'financialWindowRenewed': False, 'financialExpiresAt': '2026-11-19T18:00:00+00:00'}
        r, b = object(), object(); calls = []
        def validate(actual_r, actual_b, actual_s, actual_pin):
            self.assertIs(actual_r, r); self.assertIs(actual_b, b); self.assertIs(actual_s, s)
            self.assertEqual(actual_pin, pin); calls.append('validate-current'); return deepcopy(value)
        normal = types.SimpleNamespace(BASE=owner.NORMAL_BASE, modules=lambda: (r, b, s), validate=validate)
        (root / 'source6-normal-replay-successor-v2.py').write_bytes(b'controlled validator fixture')
        lease = root / 'lease'; lease.write_bytes(b''); lease.chmod(0o600)
        return types.SimpleNamespace(value=value, receipt=receipt, terminal=terminal, terminal_raw=terminal_raw,
            data=data, normal=normal, calls=calls, lease=lease, completion=completion, pin=pin)

    def test_current_validator_supplies_identity_and_old_proof_supplies_only_terminal_history(self):
        owner = launcher.owner_module(self.files[launcher.OWNER])
        with tempfile.TemporaryDirectory(prefix='arena-normal-source-', dir=HERE) as folder:
            root = Path(folder); f = self.fixture(owner, root); fd = os.open(f.lease, os.O_RDONLY)
            try:
                with patch.object(owner, 'OPS', root), patch.object(owner, 'SOURCE_LEASE', f.lease), \
                     patch.object(owner, 'NORMAL_RECEIPT_SHA', f.pin), patch.object(owner, 'TERMINAL_PROOF_SHA', owner.sha(f.terminal_raw)), \
                     patch.object(owner, 'load', return_value=f.normal), patch.object(owner, 'productive_completed_controller', return_value=f.completion):
                    proof = owner.normal_source_for_arena(fd)
                    self.assertEqual(f.calls, ['validate-current'])
                    self.assertEqual(proof['normalSource']['process'], {key: f.value['runtime'][key] for key in ['pid', 'startTicks']})
                    self.assertEqual(proof['actors'], f.terminal['actors'])
                    self.assertEqual(proof['normalRuntimeReceiptSha256'], f.pin)
                    self.assertEqual(proof['format'], 'yunipals-arena-normal-free-source-v1')
                    self.assertFalse(proof['nativeReadinessClaimed']); self.assertFalse(proof['sourceSelectionChanged'])
                    self.assertTrue(proof['normalSourceMustRemainRunning']); self.assertEqual(proof['providerRequests'], 0)
                    self.assertNotIn('parentNormalRuntimeReceiptSha256', proof)
                    with patch.object(owner, 'normal_source_for_arena', return_value=proof):
                        files, raw, binding, review_hash = launcher.bundle(self.files, owner, fd, launcher.RUNTIME_SHA)
                    self.assertEqual(raw, owner.encoded(proof))
                    self.assertEqual(binding['rootProofSha256'], owner.sha(raw))
                    self.assertIn(('"' + owner.sha(raw) + '"').encode(), files[launcher.ADOPTER])
                    self.assertEqual(review_hash, owner.sha(launcher.encoded(binding)))
            finally: os.close(fd)

    def test_wrong_current_identity_authority_runtime_and_historical_proof_are_refused(self):
        owner = launcher.owner_module(self.files[launcher.OWNER])
        with tempfile.TemporaryDirectory(prefix='arena-normal-source-', dir=HERE) as folder:
            root = Path(folder); f = self.fixture(owner, root); fd = os.open(f.lease, os.O_RDONLY)
            try:
                with patch.object(owner, 'OPS', root), patch.object(owner, 'SOURCE_LEASE', f.lease), \
                     patch.object(owner, 'NORMAL_RECEIPT_SHA', f.pin), patch.object(owner, 'TERMINAL_PROOF_SHA', owner.sha(f.terminal_raw)), \
                     patch.object(owner, 'load', return_value=f.normal), patch.object(owner, 'productive_completed_controller', return_value=f.completion):
                    for key, bad in [('format', 'obsolete-runtime'), ('validated', False), ('paidAuthority', True),
                            ('freeOnly', False), ('normalOperationalRuntime', '4h'), ('financialWindowRenewed', True),
                            ('financialExpiresAt', '2099-01-01'), ('runtime', {'pid': 1}), ('runtimeReceiptSha256', 'f' * 64)]:
                        with self.subTest(key=key), patch.dict(f.value, {key: bad}):
                            with self.assertRaises(RuntimeError): owner.normal_source_for_arena(fd)
                    f.data[owner.TERMINAL_PROOF] = f.terminal_raw + b'changed'
                    with self.assertRaisesRegex(RuntimeError, 'prior_terminal_proof'): owner.normal_source_for_arena(fd)
                    f.data[owner.TERMINAL_PROOF] = f.terminal_raw
                    with patch.object(owner, 'productive_completed_controller', return_value={'verified': False}):
                        with self.assertRaisesRegex(RuntimeError, 'prior_terminal_actors'): owner.normal_source_for_arena(fd)
                    with patch.object(f.normal, 'validate', side_effect=RuntimeError('actual source changed')):
                        with self.assertRaisesRegex(RuntimeError, 'actual source changed'): owner.normal_source_for_arena(fd)
            finally: os.close(fd)

    def test_another_lease_inode_or_held_lease_cannot_authorize_current_proof(self):
        owner = launcher.owner_module(self.files[launcher.OWNER])
        owner.NORMAL_RECEIPT_SHA = 'a' * 64
        with tempfile.TemporaryDirectory(prefix='arena-normal-lease-', dir=HERE) as folder:
            a, b = Path(folder) / 'a', Path(folder) / 'b'; a.write_bytes(b''); b.write_bytes(b'')
            fd = os.open(a, os.O_RDONLY)
            try:
                with patch.object(owner, 'SOURCE_LEASE', b), patch.object(owner, 'load') as load_module:
                    with self.assertRaisesRegex(RuntimeError, 'same_open_source_lease'): owner.normal_source_for_arena(fd)
                    load_module.assert_not_called()
            finally: os.close(fd)

    def test_exact_current_helper_and_prior_terminal_ack_are_actual_existing_artifacts(self):
        owner = launcher.owner_module(self.files[launcher.OWNER])
        self.assertEqual(owner.NORMAL_HELPER_SHA, hashlib.sha256((HERE / 'source6-normal-replay-successor-v2.py').read_bytes()).hexdigest())
        normal = load('actual_current_normal_interface', HERE / 'source6-normal-replay-successor-v2.py')
        self.assertEqual(owner.NORMAL_BASE, normal.BASE); self.assertTrue(callable(normal.validate)); self.assertTrue(callable(normal.modules))
        saved = json.loads((HERE.parents[1] / 'docs/unified-indexer/production-bnb-route-arena-materialized-2026-10-22.json').read_bytes())
        self.assertEqual(owner.TERMINAL_PROOF_SHA, saved['binding']['rootProofSha256'])
        raw = self.files[launcher.OWNER].decode()
        self.assertNotIn('validate_current(', raw[raw.index('def normal_source_for_arena'):raw.index('def productive_is_quiet')])
        self.assertNotIn('source6-evidence-code-reconcile', raw)


if __name__ == '__main__': unittest.main()
