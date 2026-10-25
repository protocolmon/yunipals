"""Genuine finite inverse actor body, with catalog recursion made impossible."""
import ast
import copy
import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import Mock

HERE = Path(__file__).resolve().parent
def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE/name); value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value
m = load('ypal-ordinary-feature-inverse-actors-v1.py')
old = load('ypal-restored-feature-context-v1.py')


class Controls(unittest.TestCase):
    def setUp(self):
        self.source = {'sdkActor': {'processes': [{'fixtureOnlyPID': 100}], 'nativeIdentity': {'fixtureNative': True}}}
        self.api = {'fixtureActualAPI': True}; self.boot = {'fixtureBootInode': 7}
        self.op = {'operatorSha256': 'actualBoundFeature', 'sourceBoot': self.boot}
        self.result = {'format': 'actualBoundFeatureFormat', 'inverse': True, 'ownedEightSELECTsRevoked': True,
            'prior143AndCache4Preserved': True, 'operatorSha256': 'actualBoundFeature', 'operationSha256': m.sha(b'op'),
            'bootId': 'fixtureBoot', 'restoredSchema': 'fixtureFresh', 'restoredBuild': 'fixtureBuild',
            'source': self.source, 'api': self.api}
        self.helpers = types.SimpleNamespace(temporary_sessions=Mock(return_value=[{'fixtureOwnBackend': True}]),
            heartbeat_current=Mock(return_value=[{'fixtureOwnBackend': True}]))
        self.h = types.SimpleNamespace(inverse_mode=False, helpers=self.helpers, source_activation=Mock(), definitions=Mock(),
            source_actor=Mock(side_effect=lambda *_: copy.deepcopy(self.source)), actor=Mock(side_effect=lambda *_: copy.deepcopy(self.api)),
            native=Mock(), availability=Mock(return_value={'fixtureLocalAvailability': True}),
            state=Mock(return_value={'ActiveState': 'active', 'UnitFileState': 'enabled'}),
            catalog=Mock(side_effect=AssertionError('reader/catalog authority is not an actor predicate')))
        self.o = types.SimpleNamespace(operation=lambda: self.op, phase=Mock(),
            get=lambda name: {'switch-result.json': {'switchBoundary': 101}, 'inverse-review.json': {'lastFeatureCursor': 102}}[name])
        self.b = types.SimpleNamespace(OPS=HERE, Host=lambda *_: self.h, Owner=lambda *_: self.o, need=m.need, sha=m.sha,
            document=lambda *_: copy.deepcopy(self.result), protected=lambda path: (HERE/m.SOURCE).read_bytes() if Path(path).name == m.SOURCE else b'op',
            BASE=Path('/not-a-real-owned-feature-fixture'), boot=lambda: 'fixtureBoot', boot_record=lambda: self.boot,
            FORMAT='actualBoundFeatureFormat', FRESH='fixtureFresh', FRESH_BUILD='fixtureBuild', TIMER='fixtureTimer')

    def test_complete_owned_actor_boot_private_phase_and_native_body_executes_without_catalog(self):
        proof = m.validate_actors(self.b, 'a'*64, 'b'*64, 'c'*64)
        self.assertEqual(proof['format'], m.FORMAT); self.assertEqual(proof['featureOperatorSha256'], 'actualBoundFeature')
        self.assertTrue(proof['temporarySourceActorQualified']); self.assertFalse(proof['sourceActorQualified'])
        self.assertFalse(proof['currentCatalogQualified']); self.assertFalse(proof['originalWholeFeatureInverseLeafPassed'])
        self.assertNotIn('inverseCatalogPhase', proof); self.h.catalog.assert_not_called()
        self.h.native.assert_called_once_with('fixtureFresh', 'fixtureBuild', 102, True)
        self.h.definitions.assert_called_once_with(False); self.h.source_activation.assert_called_once()
        self.helpers.temporary_sessions.assert_called_once(); self.helpers.heartbeat_current.assert_not_called()
        self.assertEqual(self.h.source_actor.call_count, 2); self.assertEqual(self.h.actor.call_count, 2)

    def test_wrong_receipt_operation_boot_schema_or_authority_ack_refuses(self):
        for key, value in [('inverse', False), ('operationSha256', 'f'*64), ('bootId', 'foreign'),
                           ('restoredSchema', 'foreign'), ('ownedEightSELECTsRevoked', False)]:
            saved = copy.deepcopy(self.result); self.result[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):m.validate_actors(self.b, 'a'*64, 'b'*64, 'c'*64)
            self.result = saved

    def test_source_or_API_replacement_or_inactive_timer_refuses(self):
        self.h.actor.side_effect = lambda *_: {'foreignAPI': True}
        with self.assertRaises(RuntimeError):m.validate_actors(self.b, 'a'*64, 'b'*64, 'c'*64)
        self.h.actor.side_effect = lambda *_: copy.deepcopy(self.api)
        self.h.state.return_value = {'ActiveState': 'inactive', 'UnitFileState': 'enabled'}
        with self.assertRaises(RuntimeError):m.validate_actors(self.b, 'a'*64, 'b'*64, 'c'*64)

    def test_only_catalog_assignment_bookend_and_return_field_are_removed(self):
        raw = (HERE/m.SOURCE).read_bytes(); result = m.actor_tree(raw).body[0]
        original = copy.deepcopy(next(node for node in ast.parse(raw).body if isinstance(node, ast.FunctionDef) and node.name == 'inverse_leaf'))
        # Every retained statement before the sole return is byte-for-byte AST
        # equal; only the two named catalog statements are absent.
        expected = [node for node in original.body[:-1] if not (isinstance(node, ast.Assign) and
            ast.unparse(node.targets[0]) == '(expected_catalog, catalog_phase)') and not (isinstance(node, ast.Expr) and
            any(isinstance(row, ast.Call) and ast.unparse(row.func) == 'inverse_catalog_phase' for row in ast.walk(node)))]
        self.assertEqual([ast.dump(node, include_attributes=False) for node in result.body[:-1]],
                         [ast.dump(node, include_attributes=False) for node in expected])
        keys = [key.value for key in result.body[-1].value.keys]
        self.assertNotIn('inverseCatalogPhase', keys); self.assertIn('sameProgramsPrivateInputsAndPrivilegesQualified', keys)
        with self.assertRaises(RuntimeError):m.actor_tree(raw+b'\n')


if __name__ == '__main__':unittest.main()
