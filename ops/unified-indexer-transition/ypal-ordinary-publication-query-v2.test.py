import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load("ypal-ordinary-publication-query-v2.py")
RAW = (HERE / "ypal-restored-metadata-handover-v1.py").read_bytes()
COMPILER = (HERE.parents[1] / "apps/yunipals-indexer/lib/metadata/read-source.ts").read_bytes()


def host():
    # Exercise the same complete-class compilation used by the real factory.
    scope = {"__name__": "genuine_template"}
    exec(compile(ast.parse(RAW), "genuine-template", "exec"), scope)
    scope["CANDIDATES"] = m.CANDIDATES
    original = types.SimpleNamespace(query=lambda sql: {"originalQuery": sql}, marker="original")
    value = types.SimpleNamespace(
        s=types.SimpleNamespace(protected=lambda path: RAW),
        m=types.SimpleNamespace(PROJECT=Path("/synthetic/project"), NODE="/synthetic/node",
                                CLEAN=m.CLEAN, protected=lambda path: COMPILER),
        meta=types.SimpleNamespace(READ=m.READ_SCHEMA, OLD_READ="unified_shadow_20261020_7e7375b0"), h=original
    )
    value.publication_proof = types.MethodType(scope["Host"].publication_proof, value)
    return value


class FakeProcess:
    data = [{"role": "postgres", "database": "yunipals_backfill", "databaseOid": "17584"},
            {"canonicalRows": 440194, "publishedRows": 440194, "probe": True}]
    arguments = None
    returncode = 0

    def __init__(self, args, **kwargs):
        type(self).arguments = args, kwargs
        self.pid = 123

    def communicate(self, payload=None, timeout=None):
        self.payload, self.timeout = payload, timeout
        return b"\n".join(json.dumps(row).encode() for row in self.data) + b"\n", b""


class Controls(unittest.TestCase):
    def test_genuine_compiler_body_is_captured_without_a_database_result(self):
        self.assertEqual(hashlib.sha256(RAW).hexdigest(), m.TEMPLATE_SHA)
        self.assertEqual(hashlib.sha256(COMPILER).hexdigest(), "1c80f8ca18c609c8a47e164730aa5409ea2a9a65c2697bac4498c2ab1ba63208")
        value = host()
        relation = "(SELECT * FROM " + m.READ_SCHEMA + ".base_metadata_event WHERE chain_event_block_hash IS NOT NULL)"
        with patch.object(subprocess, "run", return_value=types.SimpleNamespace(returncode=0, stderr=b"", stdout=json.dumps({"sql": relation}).encode())):
            sql = m.capture_query(value)
            proof = m.bind(value)
        self.assertIn(relation, sql)
        self.assertEqual(value.h.query("SELECT 1"), {"originalQuery": "SELECT 1"})
        self.assertEqual(value.h.marker, "original")
        self.assertTrue(proof["readOnly"])
        with patch.object(m, "peer_read", return_value={"canonicalRows": 1, "publishedRows": 1, "probe": True}) as query:
            value.h.query(sql)
            query.assert_called_once_with(sql)
        self.assertRaises(RuntimeError, m.bind, value)

    def test_changed_body_or_read_schema_cannot_redirect_queries(self):
        value = host()
        value.meta.READ = "foreign"
        self.assertRaises(RuntimeError, m.capture_query, value)
        value = host()
        value.publication_proof = types.MethodType(lambda self: None, value)
        self.assertRaises(RuntimeError, m.capture_query, value)

    def test_same_peer_identity_readonly_window_and_typed_counts(self):
        with patch.object(m.os.path, "lexists", return_value=False), patch.object(m.subprocess, "Popen", FakeProcess):
            result = m.peer_read("SELECT actual_publication_count")
        self.assertEqual(result["canonicalRows"], 440194)
        args, kwargs = FakeProcess.arguments
        self.assertIn("--reuid=111", args)
        self.assertIn("--regid=113", args)
        self.assertIn("PGOPTIONS=" + m.READ_OPTIONS, args)
        self.assertIn("default_transaction_read_only=on", m.READ_OPTIONS)
        self.assertIn("statement_timeout=60000", m.READ_OPTIONS)
        self.assertEqual(kwargs["env"], m.CLEAN)
        for data in [
            [{"role": "foreign", "database": "yunipals_backfill", "databaseOid": "17584"}, FakeProcess.data[1]],
            [FakeProcess.data[0], {"canonicalRows": "440194", "publishedRows": 440194, "probe": True}],
            [FakeProcess.data[0], {"canonicalRows": 440194, "publishedRows": 440194, "probe": 1}]
        ]:
            with patch.object(m.os.path, "lexists", return_value=False), patch.object(m.subprocess, "Popen", FakeProcess), patch.object(FakeProcess, "data", data):
                self.assertRaises(RuntimeError, m.peer_read, "SELECT actual_publication_count")

    def test_unrelated_bound_methods_stay_on_original_host(self):
        class Original:
            def __init__(self):
                self.marker = "actual-original"

            def read_marker(self):
                return self.marker

            def query(self, sql):
                return sql

        original = Original()
        proxy = m.PublicationQueryPeer(original, "full-proof")
        self.assertEqual(proxy.read_marker(), "actual-original")
        self.assertIs(proxy.read_marker.__self__, original)
        self.assertEqual(proxy.query("ordinary-query"), "ordinary-query")

    def test_timeout_kills_only_its_own_process_group_and_never_returns_a_proof(self):
        class Timeout(FakeProcess):
            calls = 0

            def communicate(self, payload=None, timeout=None):
                self.calls += 1
                if self.calls == 1:
                    raise subprocess.TimeoutExpired("owned-readonly-peer", timeout)
                return b"", b""

        with patch.object(m.os.path, "lexists", return_value=False), patch.object(m.subprocess, "Popen", Timeout), patch.object(m.os, "killpg") as kill:
            self.assertRaises(subprocess.TimeoutExpired, m.peer_read, "SELECT actual_publication_count")
            kill.assert_called_once_with(123, m.signal.SIGKILL)


if __name__ == "__main__":
    unittest.main()
