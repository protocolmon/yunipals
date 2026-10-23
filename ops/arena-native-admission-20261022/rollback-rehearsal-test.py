#!/usr/bin/env python3
"""Finite rollback payload/command/control-path checks; no external action."""
import copy
import hashlib
import json
from pathlib import Path
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
path = HERE / "rollback-rehearsal.py"
m = types.ModuleType("rollback_rehearsal")
m.__file__ = str(path)
exec(compile(path.read_bytes(), str(path), "exec"), m.__dict__)


class Rehearsal(unittest.TestCase):
    def test_final_frozen_package_and_existing_runtime_dependency_pins(self):
        for name, pin in m.PINS.items():
            self.assertEqual(hashlib.sha256((HERE / name).read_bytes()).hexdigest(), pin)
        self.assertEqual(hashlib.sha256((HERE.parent / "unified-indexer-transition/arena-runtime-restore-v1.py").read_bytes()).hexdigest(), m.RESTORE_SHA)
        self.assertEqual(m.RESTORE.name, "yunipals-arena-runtime-restore-v1-20261022.py")
        raw = (HERE.parent / "unified-indexer-transition/arena-owner-migration-v11.py").read_text()
        self.assertIn("raw=value if isinstance(value,bytes)else encoded(value)", raw)

    def test_actual_sql_transformation_changes_only_final_terminator(self):
        for name in ["operational-roles.current.sql.review", "source-reader.current.sql.review"]:
            raw = (HERE / name).read_bytes()
            result = m.rollback_sql(raw)
            self.assertEqual(result, raw[:-8] + b"ROLLBACK;\n")
            self.assertNotIn(b"COMMIT;", result)
        for raw in [b"BEGIN;COMMIT;", b"BEGIN;COMMIT;\nCOMMIT;\n", b"BEGIN;\n\\! touch x\nCOMMIT;\n", b"BEGIN;ABORT;\nCOMMIT;\n"]:
            with self.assertRaises(m.RehearsalFailure):
                m.rollback_sql(raw)

    def test_peer_is_fixed_unix_no_password_no_inherited_environment(self):
        with patch.object(m.os.path, "lexists", return_value=False), patch.object(m.pwd, "getpwnam", return_value=types.SimpleNamespace(pw_uid=102, pw_gid=105)):
            for target in m.TARGETS:
                for write in [False, True]:
                    args = m.peer_args(*target, write=write)
                    self.assertIn("PGHOST=/var/run/postgresql", args)
                    self.assertIn("PGPASSFILE=" + str(m.NO_PASSWORD), args)
                    self.assertIn("--clear-groups", args)
                    self.assertIn("--no-new-privs", args)
                    self.assertIn("--no-password", args)
                    self.assertIn("ON_ERROR_STOP=1", args)
                    self.assertIn("PGOPTIONS=-c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000 -c default_transaction_read_only=" + ("off" if write else "on"), args)
                    self.assertEqual(args[args.index("/usr/bin/env") + 1], "-i")
            with self.assertRaises(m.RehearsalFailure):
                m.peer_args(5432, "yunipals_arena", write=True)
        with patch.object(m.os.path, "lexists", return_value=True):
            with self.assertRaises(m.RehearsalFailure):
                m.peer_args(*m.TARGETS[0])

    def fixtures(self):
        proposal = json.loads((HERE / "proposal.current.json").read_bytes())
        sqls = [(HERE / name).read_bytes() for name in ["operational-roles.current.sql.review", "source-reader.current.sql.review"]]
        roles = [[w["role"] for w in proposal["workers"]], [proposal["sourceReader"]["role"]]]
        before = [{"catalog": 1}, {"catalog": 2}]
        binding = {"context": {"actorsSha256": "a" * 64}, "catalogSha256": ["b" * 64, "c" * 64]}
        return proposal, sqls, roles, before, binding

    def execute(self, values, context=None, catalog=None, run=None, review=None):
        proposal, sqls, roles, before, binding = values
        context = context or binding["context"]
        with patch.object(m, "context", return_value=context), patch.object(m, "catalog", side_effect=catalog or [before[0], before[0], before[1], before[1]]), patch.object(m, "peer_args", side_effect=lambda *target, **kw:["fixed-peer", str(target[0])]), patch.object(m, "run", side_effect=run or [b"\n", b""]), patch.object(m.os.path, "lexists", return_value=False):
            return m.rehearse(*values, review or m.sha(m.encoded(binding)))

    def test_two_exact_rollback_payloads_and_postchecks(self):
        values = self.fixtures()
        seen = []
        def capture(argv, data, **kw):
            seen.append((argv, data, kw))
            return b"\n"
        result = self.execute(values, run=capture)
        self.assertEqual([p[0] for p in seen], [["fixed-peer", "15438"], ["fixed-peer", "5432"]])
        self.assertEqual([p[1] for p in seen], [m.rollback_sql(raw) for raw in values[1]])
        self.assertEqual([p[2]["timeout"] for p in seen], [45, 45])
        self.assertEqual(result["persistentRoleOrGrantChanges"], 0)
        self.assertEqual([r["rolesAbsentAfterRollback"] for r in result["rehearsals"]], [8, 1])
        self.assertFalse(result["inTransactionEffectiveRoleProof"])
        self.assertFalse(result["automaticRetryAllowed"])

    def test_stale_review_changed_actor_or_catalog_refuses_before_sql(self):
        values = self.fixtures()
        for change in [dict(review="f" * 64), dict(context={"actorsSha256": "e" * 64}), dict(catalog=[{"catalog": 99}])]:
            with self.subTest(change=change), self.assertRaises(m.RehearsalFailure), patch.object(m, "run") as command:
                self.execute(values, **change)
                self.assertFalse(command.called)

    def test_first_peer_failure_or_postrollback_drift_never_repeats_or_runs_source_sql(self):
        values = self.fixtures()
        for failure, snapshots in [(TimeoutError("synthetic"), None), (m.RehearsalFailure("synthetic_peer_failure"), None), (b"unexpected", None), (b"", [values[3][0], {"catalog": 99}])]:
            calls = []
            def one(argv, data, **kw):
                calls.append(argv)
                if isinstance(failure, BaseException):
                    raise failure
                return failure
            with self.subTest(failure=type(failure).__name__), self.assertRaises((m.RehearsalFailure, TimeoutError)):
                self.execute(values, run=one, catalog=snapshots)
            self.assertEqual(len(calls), 1)


if __name__ == "__main__":
    unittest.main()
