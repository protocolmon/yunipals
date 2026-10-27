#!/usr/bin/env python3
"""Source-only V6 deadline, immutable-body and wire-closure controls."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import types
import unittest

HERE = Path(__file__).parent.resolve()


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load('ypal-ordinary-publication-protocol-v6.py')
cache_transport = load('ypal-restored-read-cache-provider-v1.py')
reader_transport = load('ypal-ordinary-reader-cutover-v5.py')


def source(name):
    return (HERE / name).read_text()


def digest(name):
    return hashlib.sha256((HERE / name).read_bytes()).hexdigest()


def function(name, file):
    return next(node for node in ast.parse(source(file)).body
                if isinstance(node, ast.FunctionDef) and node.name == name)


class Controls(unittest.TestCase):
    def test_original_bytes_unchanged_and_cache_only_idle_seam(self):
        self.assertEqual(digest('ypal-cache-guard-owner-v1.py'),
                         'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba')
        self.assertEqual(digest('ypal-native-cutover-v1.py'), reader_transport.TEMPLATE_SHA)
        expected = source('ypal-ordinary-cache-sql-v5.mjs').replace(
            '// New fixed entry; frozen d441 owns the actual cache transaction and installer.',
            '// V6 bounded protocol: V5 cache transaction, schema and authenticated SQL retained.'
        ).replace('idle_in_transaction_session_timeout=15000',
                  'idle_in_transaction_session_timeout=240000')
        self.assertEqual(source('ypal-ordinary-cache-sql-v6.mjs'), expected)
        self.assertEqual(digest('ypal-ordinary-cache-driver-v5.mjs'),
                         '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a')

    def test_reader_only_explicit_idle_wire_and_actual_capsule_pin_seams(self):
        original = source('ypal-ordinary-reader-sql-v5.mjs')
        self.assertEqual(original.count("idle_in_transaction_session_timeout='90s'"), 3)
        self.assertEqual(original.count('idle_in_transaction_session_timeout=90000'), 1)
        old_capsule = 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21'
        self.assertEqual(original.count(old_capsule), 2)
        expected = original.replace(
            '// One owned client retains its private leaderboard handle until publication.',
            '// V6 bounded protocol; one V5 client retains its private handle until publication.'
        ).replace("idle_in_transaction_session_timeout='90s'",
                  "idle_in_transaction_session_timeout='240s'").replace(
            'idle_in_transaction_session_timeout=90000', 'idle_in_transaction_session_timeout=240000'
        ).replace('ypal-ordinary-reader-wire-v5', 'ypal-ordinary-reader-wire-v6').replace(
            'ypal-ordinary-reader-sql-v5.mjs', 'ypal-ordinary-reader-sql-v6.mjs'
        ).replace(old_capsule, digest('ypal-ordinary-generation-recovery-v5.mjs'))
        self.assertEqual(source('ypal-ordinary-reader-sql-v6.mjs'), expected)
        self.assertEqual(digest('ypal-ordinary-generation-recovery-v5.mjs'),
                         'a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df')
        expected_probe = source('ypal-ordinary-reader-probe-v5.mjs').replace(
            'ypal-ordinary-reader-wire-v5.manifest.json', 'ypal-ordinary-reader-wire-v6.manifest.json'
        ).replace('ypal-ordinary-reader-probe-v5.mjs', 'ypal-ordinary-reader-probe-v6.mjs')
        self.assertEqual(source('ypal-ordinary-reader-probe-v6.mjs'), expected_probe)

    def test_v6_wire_authenticates_new_entrypoints_and_preserves_V5_data(self):
        old = json.loads(source('ypal-ordinary-reader-wire-v5.manifest.json'))
        wire = json.loads(source('ypal-ordinary-reader-wire-v6.manifest.json'))
        peer = load('ypal-ordinary-reader-peer-v6.py')
        self.assertEqual(wire['format'], 'yunipals-ypal-ordinary-reader-wire-v6')
        self.assertEqual((wire['readSchema'], wire['readIdentity']), (old['readSchema'], old['readIdentity']))
        self.assertEqual(wire['dependencies'], old['dependencies'])
        self.assertEqual(peer.PINS['ypal-ordinary-reader-wire-v6.manifest.json'],
                         digest('ypal-ordinary-reader-wire-v6.manifest.json'))
        for name, pin in {**wire['files'], **wire['dependencies']}.items():
            self.assertEqual(pin, digest(name), name)
        for name, pin in peer.PINS.items():
            self.assertEqual(pin, digest(name), name)
        self.assertNotIn('ypal-ordinary-reader-sql-v5.mjs', peer.PINS)
        cache = load('ypal-ordinary-cache-peer-v6.py')
        for name, pin in cache.PINS.items():
            self.assertEqual(pin, digest(name), name)
        self.assertEqual(cache.ENTRY, 'ypal-ordinary-cache-sql-v6.mjs')

    def restored_parent(self, successor, old_deadline):
        restored = copy.deepcopy(successor)
        guards = 0
        for node in ast.walk(restored):
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'deadline' for t in node.targets):
                node.value = ast.parse(old_deadline, mode='eval').body
            for field, value in ast.iter_fields(node):
                if isinstance(value, list):
                    kept = []
                    for item in value:
                        if (isinstance(item, ast.Expr) and isinstance(item.value, ast.Call) and
                                ast.unparse(item.value.func) == 'need' and
                                any(isinstance(part, ast.Constant) and part.value ==
                                    'V6_parent_deadline_expired_before_literal_ACK_reconcile_only'
                                    for part in ast.walk(item))):
                            guards += 1
                        else:
                            kept.append(item)
                    setattr(node, field, kept)
        self.assertEqual(guards, 2)
        return ast.dump(restored, include_attributes=False)

    def test_cache_held_XID_actor_durable_ACK_and_cleanup_body_retained(self):
        original = function('sql_child', 'ypal-cache-guard-owner-v1.py')
        transported = cache_transport.transport_function(original)
        before = ast.dump(transported, include_attributes=False)
        new = m.cache_parent_window(transported)
        self.assertEqual(ast.dump(transported, include_attributes=False), before)
        self.assertEqual(self.restored_parent(new, 'time.monotonic() + 100'), before)
        self.assertIn('deadline = time.monotonic() + 360', ast.unparse(new))
        with self.assertRaisesRegex(RuntimeError, 'one_exact_original_parent_deadline'):
            m.cache_parent_window(new)

    def test_reader_held_XID_same_session_and_literal_ACK_body_retained(self):
        original = function('child', 'ypal-native-cutover-v1.py')
        transported = reader_transport.transported_function(original)
        before = ast.dump(transported, include_attributes=False)
        new = m.reader_parent_window(transported)
        self.assertEqual(self.restored_parent(new,
            "time.monotonic() + (MAX_PREPARATION_SECONDS if mode == 'publish' else 120)"), before)
        self.assertIn("MAX_PREPARATION_SECONDS if mode == 'publish' else 360", ast.unparse(new))
        with self.assertRaisesRegex(RuntimeError, 'fixed_authenticated_V5_protocol_function'):
            m.reader_parent_window(original.body[0])

    def test_actual_expired_parent_callback_cannot_send_literal_ACK(self):
        original = ast.parse('''
def sql_child(callback):
    deadline = time.monotonic() + 100
    callback()
    proc.stdin.write(encoded({'preparedSha256': 'fixed'}))
    proc.stdin.write(encoded({'openedSha256': 'fixed'}))
''').body[0]
        transformed = m.cache_parent_window(original)
        writes = []
        clock = types.SimpleNamespace(value=0)
        scope = {'time': types.SimpleNamespace(monotonic=lambda: clock.value), 'need': m.need,
                 'encoded': lambda value: value, 'proc': types.SimpleNamespace(
                     stdin=types.SimpleNamespace(write=writes.append))}
        exec(compile(ast.Module(body=[transformed], type_ignores=[]), '<V6-test>', 'exec'), scope)
        with self.assertRaisesRegex(RuntimeError, 'V6_parent_deadline_expired_before_literal_ACK'):
            scope['sql_child'](lambda: setattr(clock, 'value', 361))
        self.assertEqual(writes, [])

    def test_actual_comparison_fits_only_new_explicit_arithmetic_policy(self):
        comparison_ns = 20779000000
        self.assertGreater(comparison_ns, 15000000000)
        self.assertGreater(comparison_ns + 70000000000, 90000000000)
        for target, reserved in [('cache', 0), ('reader', 70000000000)]:
            receipt = {'elapsedNanoseconds': comparison_ns, 'reservedEffectNanoseconds': reserved}
            self.assertIs(m.require_callback_window(receipt, target), receipt)
            receipt['elapsedNanoseconds'] = 240000000000 - reserved
            with self.assertRaisesRegex(RuntimeError, 'must_fit_V6_SQL_idle_window'):
                m.require_callback_window(receipt, target)
        for elapsed, reserved in [(True, 0), (1, False), (0, 0), (-1, 0), (1, -1)]:
            with self.assertRaises(RuntimeError):
                m.require_callback_window({'elapsedNanoseconds': elapsed, 'reservedEffectNanoseconds': reserved}, 'cache')
        self.assertFalse(m.policy()['originalV5TimingGatePassed'])
        self.assertFalse(m.policy()['productionCOMMITQualified'])
        self.assertEqual(m.policy()['readerPublishParentSeconds'], 1200)


if __name__ == '__main__':
    unittest.main()
