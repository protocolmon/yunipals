#!/usr/bin/env python3
"""Actual pure comparator; explicit synthetic SDK/typed-manager packets."""
import copy
import importlib.util
from pathlib import Path
import unittest

PATH = Path(__file__).absolute().with_name("ypal-alchemy-source-identity-v2.py")
SPEC = importlib.util.spec_from_file_location("actual_source_identity", PATH)
identity = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(identity)


class Identity(unittest.TestCase):
    def setUp(self):
        self.actor = {"unit": {"MainPID": "1234", "InvocationID": "recorded-epoch", "ExecStart": "command; status=active"},
                      "parent": {"pid": 1234, "startTicks": 123456, "argv": ["/fixed/node", "--env-file=/fixed/private", "/fixed/ponder.js", "start"],
                                 "environmentSha256": "e" * 64, "executable": "/fixed/node"},
                      "processes": [{"pid": 1234, "startTicks": 123456, "privileges": {"CapEff": "0"}}]}
        self.typed = {"type": "a(sasbttttuii)", "data": [["/usr/bin/env", ["/usr/bin/env", "-i", *self.actor["parent"]["argv"]], False, 1, 2, 3, 4, 1234, 0, 0]]}

    def test_reload_status_changes_preserve_actual_program_epoch_without_mutating_packets(self):
        recorded = copy.deepcopy(self.actor); current = copy.deepcopy(self.actor)
        current["unit"]["ExecStart"] = "command; status=reset"
        first = identity.compare_same_epoch(recorded, current, self.typed)
        typed = copy.deepcopy(self.typed); typed["data"][0][3:] = [0] * 7
        second = identity.compare_same_epoch(recorded, current, typed)
        self.assertEqual(first["identitySha256"], second["identitySha256"])
        self.assertNotEqual(first["recordedPacketSha256"], first["currentPacketSha256"])
        self.assertEqual(recorded, self.actor); self.assertEqual(current["unit"]["ExecStart"], "command; status=reset")
        self.assertFalse(first["originalWholeValidatorPassed"]); self.assertFalse(first["currentWriterQualified"])
        self.assertFalse(first["financialAuthorityQualified"])

    def test_any_other_actor_epoch_environment_program_or_privilege_change_refuses(self):
        for path, value in [(('unit', 'MainPID'), '1235'), (('unit', 'InvocationID'), 'replacement'),
                            (('parent', 'startTicks'), 123457), (('parent', 'environmentSha256'), 'f' * 64),
                            (('parent', 'executable'), '/other/node')]:
            with self.subTest(path=path):
                current = copy.deepcopy(self.actor); current[path[0]][path[1]] = value
                with self.assertRaises(RuntimeError): identity.compare_same_epoch(self.actor, current, self.typed)
        current = copy.deepcopy(self.actor); current['processes'][0]['privileges']['CapEff'] = '1'
        with self.assertRaises(RuntimeError): identity.compare_same_epoch(self.actor, current, self.typed)
        current = copy.deepcopy(self.actor); current['unit']['unrecorded'] = 'added'
        with self.assertRaises(RuntimeError): identity.compare_same_epoch(self.actor, current, self.typed)

    def test_typed_path_order_environment_reset_or_argument_difference_refuses(self):
        for index, value in [(0, '/other/env'), (1, ['/usr/bin/env', *self.actor['parent']['argv']]), (2, True), (2, 0)]:
            with self.subTest(index=index):
                typed = copy.deepcopy(self.typed); typed['data'][0][index] = value
                with self.assertRaises(RuntimeError): identity.compare_same_epoch(self.actor, self.actor, typed)
        typed = copy.deepcopy(self.typed); typed['data'][0][1].append('--injection')
        with self.assertRaises(RuntimeError): identity.compare_same_epoch(self.actor, self.actor, typed)

    def test_missing_or_unknown_typed_shapes_and_boolean_status_refuse(self):
        for typed in [{"type": "as", "data": []}, {**self.typed, "extra": True}, {**self.typed, "data": self.typed['data'] * 2}]:
            with self.subTest(typed=typed), self.assertRaises(RuntimeError):
                identity.compare_same_epoch(self.actor, self.actor, typed)
        typed = copy.deepcopy(self.typed); typed['data'][0][3] = True
        with self.assertRaises(RuntimeError): identity.compare_same_epoch(self.actor, self.actor, typed)


if __name__ == "__main__":
    unittest.main()
