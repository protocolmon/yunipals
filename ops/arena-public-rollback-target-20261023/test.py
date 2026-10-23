#!/usr/bin/env python3
"""Finite offline authority/protocol controls. No host/database/provider call."""
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / (name + ".py"))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m, c = module("admit-target"), module("credentials")


def roles():
    return [{"name": name, "oid": 100 + i, "login": False, "inherit": False, "superuser": False, "createDb": False, "createRole": False, "replication": False, "bypassRls": False, "limit": [-1, 2, 32][i], "validUntil": None, "settings": ["default_transaction_read_only=on"] if name == m.READER else None, "memberships": 0, "sessions": 0, "passwordSha256": None, "scram": False} for i, name in enumerate(m.ROLES)]


class Controls(unittest.TestCase):
    def test_exact_frozen_public_sql_has_four_tables_no_private_migration(self):
        p = m.proposal()
        self.assertEqual(p["sql"], {name: m.sha((HERE / name).read_bytes()) for name in ["roles.sql", "schema.sql"]})
        sql = (HERE / "schema.sql").read_text()
        self.assertEqual(sql.count("CREATE TABLE "), 4)
        for name in ["submission", "frozen_input", "provider_task", "transaction_intent", "source_selection", "migrateArena"]:
            self.assertNotIn(name, sql)
        self.assertIn("GRANT SELECT,INSERT ON yunipals_arena.chain_event", sql)
        self.assertNotIn("GRANT DELETE", sql)
    def test_wrong_review_refuses_before_directory_or_sql(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory, patch.object(m, "BASE", Path(directory) / "new"), patch.object(m, "review", return_value={"actual": True}), patch.object(m, "boundary", side_effect=AssertionError("SQL ran")):
            with self.assertRaises(m.Refusal):
                m.admit("0" * 64)
            self.assertFalse(m.BASE.exists())
    def test_role_oid_negative_flags_limits_and_owner_nologin_are_exact(self):
        values = roles()
        ids = m.validate_roles(values)
        for key, value in [("login", True), ("inherit", True), ("limit", 99), ("memberships", 1), ("sessions", 1), ("passwordSha256", "a" * 64)]:
            changed = copy.deepcopy(values)
            changed[1][key] = value
            with self.assertRaises(m.Refusal):
                m.validate_roles(changed, ids)
        hashes = {m.WRITER: "b" * 64, m.READER: "c" * 64}
        for row in values[1:]:
            row.update(login=True, passwordSha256=hashes[row["name"]], scram=True)
        m.validate_roles(values, ids, "login", hashes)
        values[0]["login"] = True
        with self.assertRaises(m.Refusal):
            m.validate_roles(values, ids, "login", hashes)
    def test_graph_preserves_objects_dependencies_defaults_and_ignores_only_dynamic_fields(self):
        doc = {"roles": roles(), "tables": [{"oid": 9}], "roleDependencies": [{"objectOid": 7}], "defaultAclCount": 0, "empty": True, "ambientDatabaseAuthority": {"observed": True}}
        same = copy.deepcopy(doc)
        same["empty"] = False
        same["roles"][1]["sessions"] = 1
        same["roles"][1]["passwordSha256"] = "a" * 64
        self.assertEqual(m.graph(doc), m.graph(same))
        same["roleDependencies"][0]["objectOid"] = 8
        self.assertNotEqual(m.graph(doc), m.graph(same))
        same = copy.deepcopy(doc)
        same["tables"][0]["oid"] = 10
        self.assertNotEqual(m.graph(doc), m.graph(same))
    def test_aborted_and_missing_role_prefix_reconciliation_is_readonly(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory, patch.object(m, "BASE", Path(directory)), patch.object(m, "current_roles", return_value=[]), patch.object(m, "current_database", return_value=None), patch.object(m, "run", return_value=b"aborted\n"):
            m.save(m.BASE / "intent.json", {"operatorSha256": m.sha(Path(m.__file__).read_bytes()), "proposalSha256": m.PROPOSAL_SHA})
            first = m.reconcile()
            self.assertEqual(first["rolePrefix"], "absent_unprepared")
            m.save(m.BASE / "roles-prepared.json", {"value": roles()})
            m.save(m.BASE / "roles-commit-intent.json", {"xid": "123"})
            after = m.reconcile()
            self.assertEqual(after["rolePrefix"], "aborted_and_absent")
            self.assertEqual(after["actions"], 0)
            self.assertIsNone(after["ownedRoleOids"])
            self.assertFalse((m.BASE / "result.json").exists())
    def test_credential_parser_excludes_selectors_and_original_env_keys(self):
        raw = c.content(m.READER, "r" * 48, m.DATABASE)
        self.assertEqual(c.parse(m, m.READER, raw), "r" * 48)
        self.assertIn(b"default_transaction_read_only%3Don", raw)
        for changed in [raw + b"ARENA_DATABASE_URL=unasked\n", raw.replace(b"5432", b"15438"), raw.replace(m.DATABASE.encode(), b"yunipals_arena"), raw.replace(b"127.0.0.1", b"elsewhere")]:
            with self.assertRaises(c.Refusal):
                c.parse(m, m.READER, changed)
    def test_two_distinct_passwords_not_plaintext_in_sql_or_argv(self):
        value = c.scram("a" * 48, b"synthetic-salt-16")
        op = object.__new__(c.Operator)
        op.roles = [{"name": m.WRITER, "oid": 101}, {"name": m.READER, "oid": 102}]
        text = op.sql("password", {}, {m.WRITER: value, m.READER: value})
        self.assertNotIn("a" * 48, text)
        self.assertEqual(text.count("PASSWORD 'SCRAM-SHA-256$4096:"), 2)
        self.assertNotIn(m.OWNER + " LOGIN", text)
        self.assertIn("NOT rolcanlogin", text)
        self.assertIn("pg_stat_activity", text)
    def test_anonymous_password_fd_is_sealed_and_absent_from_argv_environment(self):
        secret = "p" * 48
        seen = {}
        def execute(args, **kw):
            self.assertNotIn(secret, " ".join(args))
            self.assertNotIn(secret, json.dumps(kw["env"]))
            fd = kw["pass_fds"][0]
            self.assertEqual(os.fstat(fd).st_mode & 0o777, 0o600)
            self.assertEqual(fcntl.fcntl(fd, fcntl.F_GET_SEALS), 15)
            self.assertIn(secret.encode(), os.read(fd, 1000))
            seen["fd"] = fd
            return types.SimpleNamespace(returncode=0, stdout=b"{}\n", stderr=b"")
        with patch.object(c.subprocess, "run", execute):
            self.assertEqual(c.auth_probe(m, m.WRITER, secret, "SELECT 1;"), b"{}\n")
        with self.assertRaises(OSError):
            os.fstat(seen["fd"])
    def test_negative_authentication_requires_password_failure_not_network_outage(self):
        failed = types.SimpleNamespace(returncode=2, stdout=b"", stderr=b"connection refused")
        with patch.object(c.subprocess, "run", return_value=failed):
            with self.assertRaises(c.Refusal):
                c.auth_probe(m, m.WRITER, "p" * 48, "SELECT 1;", failure="authentication")
        failed.stderr = b"FATAL: password authentication failed"
        with patch.object(c.subprocess, "run", return_value=failed):
            self.assertIsNone(c.auth_probe(m, m.WRITER, "p" * 48, "SELECT 1;", failure="authentication"))
    def test_negative_privilege_requires_42501_and_rejects_syntax_error(self):
        for code in [b"42601", b"25006"]:
            with patch.object(c.subprocess, "run", return_value=types.SimpleNamespace(returncode=3, stdout=b"", stderr=code)):
                with self.assertRaises(c.Refusal):
                    c.auth_probe(m, m.READER, "p" * 48, "SELECT;", failure="42501")
    def test_private_file_never_overwrites_or_follows_links(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            root = Path(directory)
            target = root / "target"
            c.save(target, b"original")
            with self.assertRaises(FileExistsError):
                c.save(target, b"replace")
            link = root / "link"
            link.symlink_to(target)
            with self.assertRaises(FileExistsError):
                c.save(link, b"replace")
            parent = root / "parent"
            parent.symlink_to(root, target_is_directory=True)
            with self.assertRaises(OSError):
                c.save(parent / "foreign", b"replace")
            self.assertEqual(target.read_bytes(), b"original")
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
    def test_no_hidden_service_migration_or_cluster_public_revoke(self):
        sources = (HERE / "admit-target.py").read_text() + (HERE / "credentials.py").read_text()
        self.assertNotIn("systemctl", sources)
        self.assertNotIn("DROP DATABASE", sources)
        self.assertNotIn("migrateArena(", sources)
        self.assertNotIn("ALTER SYSTEM", sources)
        self.assertNotIn("pg_hba.conf", sources)
        self.assertIn("REVOKE ALL ON DATABASE ", sources)


if __name__ == "__main__":
    unittest.main(verbosity=2)
