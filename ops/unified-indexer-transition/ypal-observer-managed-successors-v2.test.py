"""The new observer epoch changes producer bindings, not managed lifecycle code."""
import ast
import hashlib
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).parent
OBSERVER = 'ypal-ordinary-observer-retained-prefix-v1.py'
OBSERVER_SHA = '451f1abe40d4bfba0d561e20f64c3e36c1c050ecbbea3415ecf318b00333e32e'


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


class Controls(unittest.TestCase):
    def compare(self, old, new, substitutions, old_hash):
        original = (HERE / old).read_text()
        self.assertEqual(digest(HERE / old), old_hash)
        expected = original
        for before, after in substitutions:
            self.assertIn(before, expected)
            expected = expected.replace(before, after)
        actual = (HERE / new).read_text()
        self.assertEqual(actual, expected)
        self.assertEqual(ast.dump(ast.parse(actual)), ast.dump(ast.parse(expected)))

    def test_foundation_only_changes_observer_and_owned_epoch_names(self):
        self.compare('ypal-ordinary-managed-runtime-v1.py', 'ypal-ordinary-managed-runtime-v2.py', [
            ('yunipals-ordinary-managed-runtime-v1', 'yunipals-ordinary-managed-runtime-v2'),
            ('yunipals-ordinary-managed-runtime-input-v1', 'yunipals-ordinary-managed-runtime-input-v2'),
            ('managed-runtime-v2-20261024', 'managed-runtime-v2-20261025'),
            ('managed-runtime-input-v2-20261024', 'managed-runtime-input-v2-20261025'),
            ('ypal-alchemy-ordinary-observer-v1.py', OBSERVER),
            ('2a84e16a31df3d5266d0ff3992753d01c6849b3755d173a6e29f2f1cdeebab93', OBSERVER_SHA)
        ], 'bdaa7a51ed190757567eef4913953a83d7016735f0ae4ebb35599cbcb3b23a63')

    def test_lifecycle_only_changes_foundation_and_owned_epoch_names(self):
        self.compare('ypal-ordinary-managed-handover-v1.py', 'ypal-ordinary-managed-handover-v2.py', [
            ('ordinary-managed-handover-v1', 'ordinary-managed-handover-v2'),
            ('ypal-ordinary-managed-runtime-v1.py', 'ypal-ordinary-managed-runtime-v2.py'),
            ('bdaa7a51ed190757567eef4913953a83d7016735f0ae4ebb35599cbcb3b23a63', digest(HERE / 'ypal-ordinary-managed-runtime-v2.py'))
        ], '24cc64863bad4ae647029053be98e7112281cddfcb54285535b62e3ee476db0b')

    def test_recurring_only_changes_actual_managed_producer_bindings(self):
        self.compare('ypal-ordinary-recurring-source-v5.py', 'ypal-ordinary-recurring-source-v5b.py', [
            ('ordinary-recurring-source-v5', 'ordinary-recurring-source-v5b'),
            ('ypal-ordinary-managed-handover-v1.py', 'ypal-ordinary-managed-handover-v2.py'),
            ('24cc64863bad4ae647029053be98e7112281cddfcb54285535b62e3ee476db0b', digest(HERE / 'ypal-ordinary-managed-handover-v2.py')),
            ('bdaa7a51ed190757567eef4913953a83d7016735f0ae4ebb35599cbcb3b23a63', digest(HERE / 'ypal-ordinary-managed-runtime-v2.py'))
        ], '49774f32c403147ca5d81c3187ab1bcbd4565786497f0655009f3682c34a136f')

    def test_new_observer_producer_and_existing_four_runtime_files_are_exact(self):
        new = load('ypal-ordinary-managed-runtime-v2.py')
        old = load('ypal-ordinary-managed-runtime-v1.py')
        observer = load(OBSERVER)
        self.assertEqual(new.CODE[OBSERVER], OBSERVER_SHA)
        self.assertEqual(digest(HERE / OBSERVER), OBSERVER_SHA)
        self.assertNotIn('ypal-alchemy-ordinary-observer-v1.py', new.CODE)
        self.assertTrue(callable(observer.acknowledgement))
        self.assertTrue(callable(observer.validate_current))
        self.assertEqual(new.STAGE, old.STAGE)
        self.assertEqual(new.PUBLIC, old.PUBLIC)
        self.assertEqual(new.ORDINARY_ENV, old.ORDINARY_ENV)
        self.assertEqual(new.NODE_SHA, old.NODE_SHA)
        self.assertNotEqual(new.BASE, old.BASE)
        self.assertNotEqual(new.INPUT, old.INPUT)


if __name__ == '__main__': unittest.main()
