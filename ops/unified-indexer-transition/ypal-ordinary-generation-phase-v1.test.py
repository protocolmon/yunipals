import importlib.util
from pathlib import Path
import signal
import sys
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).with_name("ypal-ordinary-generation-phase-v1.py")
spec = importlib.util.spec_from_file_location("generation_entry", FILE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Controls(unittest.TestCase):
    def test_exact_owner_main_gets_unchanged_arguments_and_restores_process_context(self):
        argv = ["new-entry", "--phase", "drain", "--ack", "actual-review"]
        seen = []
        owner = types.SimpleNamespace(main=lambda: seen.append(sys.argv.copy()) or "actual-owner-result")
        with patch.object(sys, "argv", argv), patch.object(m.signal, "alarm", return_value=0) as alarm, patch.object(m.signal, "signal") as handler:
            self.assertEqual(m.invoke(owner), "actual-owner-result")
            self.assertIs(sys.argv, argv)
        self.assertEqual(seen, [[str(m.OWNER), *argv[1:]]])
        self.assertEqual([call.args[0] for call in alarm.call_args_list], [0, 480, 0])
        self.assertEqual(handler.call_args_list[-1].args[0], signal.SIGALRM)

    def test_owner_errors_are_not_turned_into_success_or_retried(self):
        calls = []
        def fail():
            calls.append("once")
            raise RuntimeError("original_owner_failure")
        argv = ["entry", "--phase", "capsule"]
        with patch.object(sys, "argv", argv), patch.object(m.signal, "alarm", return_value=0), patch.object(m.signal, "signal"):
            self.assertRaisesRegex(RuntimeError, "original_owner_failure", m.invoke, types.SimpleNamespace(main=fail))
            self.assertIs(sys.argv, argv)
        self.assertEqual(calls, ["once"])

    def test_default_never_loads_or_invokes_owner(self):
        with patch.object(sys, "argv", ["entry"]), patch.object(m, "load") as load, patch("builtins.print"):
            m.main()
            load.assert_not_called()

    def test_existing_deadline_is_restored_and_owner_is_not_entered(self):
        owner = types.SimpleNamespace(main=lambda: self.fail("Owner must not run"))
        with patch.object(m.signal, "alarm", side_effect=[12, 0]) as alarm:
            self.assertRaisesRegex(RuntimeError, "no_inherited_alarm", m.invoke, owner)
        self.assertEqual([call.args[0] for call in alarm.call_args_list], [0, 12])


if __name__ == "__main__":
    unittest.main()
