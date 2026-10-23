#!/usr/bin/env python3
"""Exercise real frozen normal-owner checks over its retained local fixture."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


m = load('proxy_requalification', HERE / 'source6-normal-proxy-requalification-v1.py')
retained = load('retained_normal_fixture', HERE / 'source6-normal-replay-successor-v2.test.py')


def proxies():
    return {chain: {'pid': str(100 + i), 'invocation': format(i + 1, '032x'),
                    'commandSha256': 'a' * 64,
                    'definitionHashes': {'/etc/systemd/system/proxy-' + chain + '.service': 'b' * 64}}
            for i, chain in enumerate(sorted(m.CHAINS))}


class Requalification(unittest.TestCase):
    def setUp(self):
        # The retained fixture invokes the actual frozen normal review/apply
        # algorithms against synthetic manager/files/SQL only. No host command.
        f = retained.TypedSourceProperties(); f.setUp(); self.addCleanup(f.doCleanups)
        self.f, self.n, self.r, self.b, self.s = f, retained.v2, f.r, f.b, f.s
        self.current_proxies = proxies()
        self.s.proxies = lambda: copy.deepcopy(self.current_proxies)
        checked = f.reviewed()
        self.normal_result = self.n.apply(self.r, self.b, self.s, checked['reviewHash'])
        self.action_count = len(f.actions)
        self.s.BOOT = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.patch(m, 'ORIGINAL', self.n.BASE / 'runtime.json')
        self.patch(m, 'ORIGINAL_SHA', m.sha(m.ORIGINAL.read_bytes()))
        self.patch(m, 'EXPECTED_RUNTIME', dict(f.normal_identity))
        self.patch(m, 'BASE', f.root / 'proxy-qualification')
        self.patch(m, 'RESULT', m.BASE / 'result.json')
        self.patch(m, 'modules', lambda: (self.n, self.r, self.b, self.s))
        real_protected = m.protected
        def fixture_protected(path, *args):
            return Path(path).read_bytes() if Path(path).is_relative_to(f.root) else real_protected(path, *args)
        self.patch(m, 'protected', fixture_protected)
        for i, row in enumerate(self.current_proxies.values()):
            row.update(pid=str(500 + i), invocation=format(50 + i, '032x'))

    def patch(self, obj, name, value):
        p = patch.object(obj, name, value); p.start(); self.addCleanup(p.stop)

    def capture(self):
        result = m.capture(self.n, self.r, self.b, self.s)
        self.assertEqual(len(self.f.actions), self.action_count)
        return result

    def acknowledge(self):
        checked = self.capture()
        result = m.acknowledge(self.n, self.r, self.b, self.s, checked['reviewHash'])
        self.assertEqual(len(self.f.actions), self.action_count)
        return result

    def test_readonly_review_keeps_original_identity_and_does_not_claim_old_validator_passed(self):
        result = self.capture()
        self.assertFalse(m.BASE.exists())
        self.assertEqual(result['binding']['runtime'], self.f.normal_identity)
        self.assertTrue(all(row == ['pid', 'invocation'] for row in result['binding']['proxyTupleChanges'].values()))
        self.assertFalse(result['binding']['originalWholeValidationPassed'])
        self.assertFalse(result['binding']['nativeCaughtUpClaimed'])
        self.assertFalse(result['binding']['financialWindowRenewed'])

    def test_acknowledgement_and_validation_use_real_frozen_configuration_and_monotonic_native_checks(self):
        original_bytes = m.ORIGINAL.read_bytes()
        result = self.acknowledge()
        self.assertEqual(m.RESULT.stat().st_mode & 0o777, 0o600)
        self.assertEqual(m.BASE.stat().st_mode & 0o777, 0o700)
        self.s.database = lambda running: {'sourceSessions': 8, 'checkpoints': self.f.points('6')}
        current = m.validate_current(result['qualificationReceiptSha256'])
        self.assertTrue(current['validated'])
        self.assertEqual(current['runtime'], self.f.normal_identity)
        self.assertEqual(m.ORIGINAL.read_bytes(), original_bytes)
        self.assertEqual(len(self.f.actions), self.action_count)
        self.assertTrue(all(sql.startswith('SELECT ') for sql in self.f.queries))

    def test_proxy_restart_inside_observation_is_refused(self):
        count = 0
        def changing():
            nonlocal count
            count += 1
            value = copy.deepcopy(self.current_proxies)
            if count == 2: value['base']['pid'] = '9876'
            return value
        self.s.proxies = changing
        with self.assertRaisesRegex(RuntimeError, 'proxy_identity_changed_during_qualification'):
            self.capture()
        self.assertFalse(m.BASE.exists())

    def test_later_proxy_restart_is_not_implicitly_followed(self):
        result = self.acknowledge()
        self.current_proxies['base']['invocation'] = 'f' * 32
        with self.assertRaisesRegex(RuntimeError, 'acknowledged_proxy_source_or_static_binding_changed'):
            m.validate_current(result['qualificationReceiptSha256'])

    def test_changed_source_identity_is_refused_before_receipt(self):
        self.f.fixture.identity['pid'] += 1
        with self.assertRaisesRegex(RuntimeError, 'exact_new_normal_source_invocation'):
            self.capture()
        self.assertFalse(m.BASE.exists())

    def test_any_financial_authority_or_expiry_change_is_refused(self):
        self.s.financial = lambda: {'profile': True, 'activePermits': 1, 'profilePermitRows': 2}
        with self.assertRaisesRegex(RuntimeError, 'exact_original_financial_policy'):
            self.capture()
        self.assertFalse(m.BASE.exists())

    def test_replaced_original_runtime_receipt_is_refused(self):
        raw = json.loads(m.ORIGINAL.read_bytes()); raw['runtime']['pid'] += 1
        m.ORIGINAL.write_bytes(m.encode(raw))
        with self.assertRaisesRegex(RuntimeError, 'exact_original_source_runtime_receipt'):
            self.capture()

    def test_historical_static_review_cannot_be_rebased_on_current(self):
        path = self.n.BASE / 'before.json'
        raw = json.loads(path.read_bytes()); raw['prior']['unit']['MemoryMax'] = '1'
        path.write_bytes(m.encode(raw))
        with self.assertRaisesRegex(RuntimeError, 'authenticated_original_normal_static_review'):
            self.capture()

    def test_source_dropin_or_boot_link_drift_is_refused(self):
        self.f.fixture.state['DropInPaths'] += ' /foreign.conf'
        with self.assertRaisesRegex(RuntimeError, 'exact_loaded_infinite'):
            self.capture()
        self.assertFalse(m.BASE.exists())

    def test_checkpoint_regression_is_refused_without_source_reset(self):
        self.s.database = lambda running: {'sourceSessions': 8, 'checkpoints': self.f.points('4')}
        with self.assertRaisesRegex(RuntimeError, 'saved_native_checkpoint_regressed'):
            self.capture()

    def test_wrong_review_cannot_create_evidence(self):
        with self.assertRaisesRegex(RuntimeError, 'exact_fresh_proxy_qualification_review'):
            m.acknowledge(self.n, self.r, self.b, self.s, '0' * 64)
        self.assertFalse(m.BASE.exists())

    def test_lost_file_ack_can_be_readonly_validated_without_repeated_actions(self):
        checked = self.capture(); original_save = m.save
        def lose_ack(path, value):
            pin = original_save(path, value)
            if path == m.RESULT: raise RuntimeError('simulated_ack_loss')
            return pin
        with patch.object(m, 'save', side_effect=lose_ack), self.assertRaisesRegex(RuntimeError, 'simulated_ack_loss'):
            m.acknowledge(self.n, self.r, self.b, self.s, checked['reviewHash'])
        pin = m.sha(m.RESULT.read_bytes())
        self.assertTrue(m.validate_current(pin)['validated'])
        with self.assertRaisesRegex(RuntimeError, 'fresh_separate_proxy_qualification'):
            m.acknowledge(self.n, self.r, self.b, self.s, checked['reviewHash'])
        self.assertEqual(len(self.f.actions), self.action_count)

    def test_proxy_replacement_during_ack_leaves_no_success_receipt(self):
        checked = self.capture(); real_capture = m.capture; calls = 0
        def changing(*args):
            nonlocal calls
            calls += 1
            if calls == 2: self.current_proxies['bnb']['pid'] = '9876'
            return real_capture(*args)
        with patch.object(m, 'capture', side_effect=changing), self.assertRaisesRegex(RuntimeError, 'changed_before_acknowledgement'):
            m.acknowledge(self.n, self.r, self.b, self.s, checked['reviewHash'])
        self.assertTrue((m.BASE / 'review.json').exists())
        self.assertFalse(m.RESULT.exists())
        self.assertEqual(len(self.f.actions), self.action_count)


class ExactProxyGraph(unittest.TestCase):
    def test_changed_argv_any_definition_or_definition_set_is_refused(self):
        prior = proxies()
        for kind in ['command', 'body', 'extra_dropin', 'missing_dropin']:
            with self.subTest(kind=kind):
                current = copy.deepcopy(prior)
                if kind == 'command': current['base']['commandSha256'] = 'c' * 64
                if kind == 'body': current['base']['definitionHashes'][next(iter(current['base']['definitionHashes']))] = 'c' * 64
                if kind == 'extra_dropin': current['base']['definitionHashes']['/etc/systemd/system/foreign.conf'] = 'c' * 64
                if kind == 'missing_dropin': current['base']['definitionHashes'] = {}
                with self.assertRaises(RuntimeError): m.proxy_differences(prior, current)

    def test_extra_chain_or_field_or_invalid_identity_is_refused(self):
        prior = proxies()
        for kind in ['extra_chain', 'missing_chain', 'extra_field', 'invalid_invocation']:
            with self.subTest(kind=kind):
                current = copy.deepcopy(prior)
                if kind == 'extra_chain': current['other'] = current['base']
                if kind == 'missing_chain': del current['bnb']
                if kind == 'extra_field': current['base']['normalize'] = True
                if kind == 'invalid_invocation': current['base']['invocation'] = ''
                with self.assertRaises(RuntimeError): m.proxy_differences(prior, current)


if __name__ == '__main__': unittest.main()
