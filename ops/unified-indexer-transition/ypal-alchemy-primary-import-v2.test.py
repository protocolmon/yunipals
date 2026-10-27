#!/usr/bin/env python3
"""Actual Node metadata-lookup regression plus inherited guarded-import controls."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

HERE = Path(__file__).absolute().parent
spec = importlib.util.spec_from_file_location("import_successor", HERE / "ypal-alchemy-primary-import-v2.py")
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)
spec = importlib.util.spec_from_file_location("real_parent_import_tests", HERE / "ypal-alchemy-primary-stage-v1.test.py")
t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
ORIGINAL = t.m.IMPORT
CORRECTED = v.derived_guard(ORIGINAL)


class Derivation(unittest.TestCase):
    def test_only_metadata_counter_changes_all_effect_guards_retained(self):
        self.assertNotEqual(CORRECTED, ORIGINAL)
        for fragment in ["net.Socket.prototype.connect=deny('network')", "net.Server.prototype.listen=deny('listen')",
                         "cls.prototype[name]=deny('database')", "throw Error('pg_construction_refused')",
                         "unknown_dependency_before_evaluation", "changed_dependency_before_evaluation"]:
            self.assertIn(fragment, CORRECTED)
        self.assertIn("nativeMetadataReads++;throw Error('pg_native_metadata_lookup_refused')", CORRECTED)
        self.assertIn("assert.deepEqual(counts,{network:0,listen:0,database:0,pool:0,spawn:0})", CORRECTED)
        self.assertIn("nativeMetadataReads<=1", CORRECTED)
        for raw in [ORIGINAL + "\n", ORIGINAL.replace("deny('network')", "()=>{}", 1)]:
            with self.assertRaises(RuntimeError): v.derived_guard(raw)

    def test_qualification_body_uses_new_producer_without_mutating_original_namespace(self):
        before = (t.m.BASE, t.m.IMPORT, t.m.FORMAT, t.m.qualify, t.m.qualified_stage)
        derived = v.qualifier(t.m)
        self.assertIs(derived.__globals__["qualified_stage"], t.m.qualified_stage)
        self.assertEqual(derived.__globals__["BASE"], v.BASE)
        self.assertEqual(derived.__globals__["IMPORT"], CORRECTED)
        self.assertEqual((t.m.BASE, t.m.IMPORT, t.m.FORMAT, t.m.qualify, t.m.qualified_stage), before)
        self.assertIn("producer_sha", derived.__code__.co_names)

    def test_default_cli_has_no_host_actions(self):
        result = subprocess.run(["python3", "-I", "-B", str(HERE / "ypal-alchemy-primary-import-v2.py")],
                                capture_output=True, check=True, text=True, timeout=5)
        value = json.loads(result.stdout)
        self.assertTrue(value["sourceOnly"])
        self.assertFalse(value["hostQualified"])
        self.assertEqual((value["databaseConnections"], value["providerCalls"], value["serviceActions"]), (0, 0, 0))


class NodeGuard(t.NodeGuard):
    def execute(self, root, cfg):
        with patch.object(t.m, "IMPORT", CORRECTED):
            return super().execute(root, cfg)

    def with_native_export(self):
        root, client, candidate, cfg = self.fixture()
        index = Path(cfg["context"]) / "pg/index.js"
        # Node's actual CJS export analysis recognizes this real pg pattern;
        # the ESM wrapper catches its guarded getter's thrown error.
        # Preserve pg's complete real lazy-export pattern, including its inner
        # value descriptor; Node's static CJS export analysis recognizes that
        # descriptor rather than every arbitrary user-defined getter.
        actual_pg = (HERE.parent.parent / "node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js").read_text()
        self.assertEqual(t.m.sha(actual_pg.encode()), t.m.DEPENDENCIES["node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js"])
        tail = actual_pg[actual_pg.index("// lazy require native module"):]
        index.write_text(index.read_text() + "\n" + tail)
        relative = str(index.relative_to(Path(cfg["release"])))
        cfg["entries"][relative] = {"type": "file", "bytes": index.stat().st_size, "sha256": t.m.sha(index.read_bytes())}
        (root / "node_modules").symlink_to(cfg["context"])
        candidate.write_text("import pg from 'pg';\n" + candidate.read_text())
        cfg["candidateSha"] = t.m.sha(candidate.read_bytes())
        return root, candidate, cfg

    def test_real_cjs_metadata_lookup_reproduces_old_failure_then_zero_database_success(self):
        root, _, cfg = self.with_native_export()
        with patch.object(t.m, "IMPORT", ORIGINAL):
            code, out, err = t.NodeGuard.execute(self, root, cfg)
        self.assertNotEqual(code, 0)
        self.assertIn(b"database: 1", err)
        code, out, err = self.execute(root, cfg)
        self.assertEqual(code, 0, err.decode())
        proof = json.loads(out)
        self.assertEqual(proof["nativeMetadataReads"], 1)
        self.assertEqual(proof["counts"], {"network": 0, "listen": 0, "database": 0, "pool": 0, "spawn": 0})
        self.assertFalse(proof["applicationConstructed"])

    def test_extra_explicit_native_access_is_refused_without_constructing_database(self):
        root, candidate, cfg = self.with_native_export()
        candidate.write_text("import pg from 'pg';try{pg.native}catch{};\n" + candidate.read_text().replace("import pg from 'pg';\n", "", 1))
        cfg["candidateSha"] = t.m.sha(candidate.read_bytes())
        code, _, err = self.execute(root, cfg)
        self.assertNotEqual(code, 0)
        self.assertIn(b"nativeMetadataReads", err)


if __name__ == "__main__":
    unittest.main()
