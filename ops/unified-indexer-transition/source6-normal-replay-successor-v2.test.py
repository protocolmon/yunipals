"""Reuse all owner/inverse cases and exercise real systemctl empty-array output."""
import importlib.util
import json
from pathlib import Path
import unittest

HERE = Path(__file__).parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


original = load('normal_owner_tests', HERE / 'source6-normal-replay-successor.test.py')
v2 = load('normal_owner_v2', HERE / 'source6-normal-replay-successor-v2.py')
original.m = v2


class TypedSourceProperties(original.NormalSuccessor):
    def setUp(self):
        super().setUp()
        command = self.s.run; self.omit_additional = None; self.typed_calls = []
        self.environment_files = {'type':'a(sb)','data':[]}
        def typed_command(argv, **kwargs):
            if argv[0] == '/usr/bin/busctl':
                self.typed_calls.append(argv)
                self.assertEqual(argv[-1], 'EnvironmentFiles')
                self.assertEqual(argv[-2], 'org.freedesktop.systemd1.Service')
                self.assertNotIn('GetUnit', argv)
                return json.dumps(self.environment_files).encode()
            answer = command(argv, **kwargs)
            if 'show' in argv:
                self.assertIn('--all', argv)
                names = {'EnvironmentFiles', self.omit_additional}
                return ('\n'.join(line for line in answer.decode().splitlines()
                                  if line.split('=',1)[0] not in names)+'\n').encode()
            return answer
        self.s.run = typed_command

    def test_actual_empty_array_omission_is_completed_with_typed_read(self):
        properties = v2.extra(self.s)
        self.assertEqual(properties['EnvironmentFilesSha256'], v2.sha(b'[]'))
        self.assertEqual(len(self.typed_calls), 1)
        self.assertNotIn('EnvironmentFiles', properties)

    def test_unrelated_missing_property_stays_fail_closed(self):
        self.omit_additional = 'Job'
        with self.assertRaisesRegex(RuntimeError, 'complete_actual_source_properties_required'):
            v2.extra(self.s)
        self.assertEqual(self.typed_calls, [])

    def test_nonempty_environment_files_are_rejected_without_export(self):
        self.environment_files = {'type':'a(sb)','data':[['/private/not-exported.env',False]]}
        with self.assertRaisesRegex(RuntimeError, '^typed_empty_unit_environment_files_required$'):
            v2.extra(self.s)
        self.assertEqual(self.actions, [])

    def test_wrong_dbus_property_type_is_rejected(self):
        self.environment_files = {'type':'as','data':[]}
        with self.assertRaisesRegex(RuntimeError, '^typed_empty_unit_environment_files_required$'):
            v2.extra(self.s)


if __name__ == '__main__': unittest.main()
