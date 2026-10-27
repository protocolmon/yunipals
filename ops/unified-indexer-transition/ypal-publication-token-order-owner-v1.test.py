"""Real official compiler, reference candidate sets and mocked PG; no DB/SSH/Git."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


m = load("ypal-publication-token-order-owner-v1.py")
base = load(m.UTILITY.name)
PUBLIC = json.loads((HERE / "ypal-publication-jit-comparison-owner-v1.explain-fixture.json").read_bytes())
PRIOR = {key: value for key, value in PUBLIC.items() if key != "resultSha256"}


def peer():
    return types.SimpleNamespace(SENTINEL="/run/nonexistent-public-token-order-fixture", CLEAN=base.CLEAN,
        READ_OPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=72000")


def output(identity=None, settings=None, result=None):
    return b"\n".join(m.encoded(value) for value in [identity if identity is not None else
        {"role": "postgres", "database": "yunipals_backfill", "databaseOid": "17584"},
        settings if settings is not None else PRIOR["planAggregate"]["settings"],
        result if result is not None else {"canonicalRows": 31, "publishedRows": 31, "probe": True}])


def reference_candidates(rows, reverse_groups):
    """A finite ordering model, not a PostgreSQL execution or tie-winner oracle."""
    groups = {}
    for token, block, transaction, log, payload in rows:
        groups.setdefault(token, []).append(((block, transaction, log), payload))
    keys = sorted(groups, key=lambda token: (token is None, token or ""), reverse=reverse_groups)
    return [(token, frozenset(payload for chronology, payload in groups[token]
        if chronology == max(key for key, _ in groups[token]))) for token in keys]


class Controls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        candidates = [Path(os.environ["YUNIPALS_PUBLICATION_TEST_NODE"])] if "YUNIPALS_PUBLICATION_TEST_NODE" in os.environ else [
            Path("/opt/node-v24.18.1/bin/node"), Path.home() / ".nvm/versions/node/v24.18.1/bin/node"]
        node = next((value for value in candidates if value.is_file()), None)
        if node is None: raise RuntimeError("exact local Node24.18.1 public compiler fixture required")
        if subprocess.run([str(node), "--version"], capture_output=True, text=True, check=True, timeout=5).stdout.strip() != "v24.18.1":
            raise RuntimeError("exact local Node24.18.1 public compiler fixture required")
        original_protected = base.protected
        def public(path, digest=None):
            path = Path(path)
            if path in {base.TEMPLATE, base.PEER}:
                raw = (HERE / path.name).read_bytes(); base.need(digest is None or base.sha(raw) == digest, "actual_public_source_required"); return raw
            return original_protected(path, digest)
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".token-order-public-compiler-") as temporary:
            folder = Path(temporary)
            (folder / "native-recovery.env").write_text("\n".join([
                "DATABASE_SCHEMA=unified_ypal_20261023_v1", "READ_DATABASE_SCHEMA=" + base.READ, "OWNERSHIP_READ_MODE=unified",
                "OWNERSHIP_READ_SCHEMA=" + base.READ, "OWNERSHIP_RELEASE_ID=0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
                "YUNIPALS_PROJECTION_MODE=generation", "METADATA_SOURCE_MODE=archive", "BASE_METADATA_INGESTION=native", "BNB_CONFIRMATIONS=20"]) + "\n")
            with patch.object(base, "protected", side_effect=public): actual_peer = base.load_peer()
            with patch.object(base, "protected", side_effect=public), patch.object(base, "PROJECT", ROOT / "apps/yunipals-indexer"), patch.object(base, "NODE", str(node)), patch.object(actual_peer, "CANDIDATES", folder):
                cls.sql, cls.query = base.compile_query(actual_peer)
        cls.derived, cls.derivation = m.derive(cls.sql, cls.query)

    def observe(self, raw, stderr=b"", returncode=0):
        process = types.SimpleNamespace(pid=123, returncode=returncode, communicate=Mock(return_value=(raw, stderr)))
        with patch.object(m.os.path, "lexists", return_value=False), patch.object(m, "save", return_value="a" * 64), patch.object(m.subprocess, "Popen", return_value=process):
            return m.observe(base, peer(), self.derived, PRIOR)

    def test_default_inert_and_actual_utility_prior_canonical_provenance(self):
        with patch.object(m, "utility", side_effect=AssertionError("not loaded")), patch.object(m.subprocess, "Popen", side_effect=AssertionError("not dispatched")), contextlib.redirect_stdout(io.StringIO()) as stream:
            self.assertEqual(m.main([]), 0)
        self.assertTrue(json.loads(stream.getvalue())["staticOnly"])
        self.assertEqual(m.sha((HERE / m.UTILITY.name).read_bytes()), m.UTILITY_SHA)
        self.assertEqual(m.sha(m.encoded(PRIOR)), m.PREVIOUS_SHA)
        with patch.object(m, "protected", return_value=m.encoded(PRIOR)): self.assertEqual(m.previous(base), PRIOR)
        for delta in [{"completed": 0}, {"actualQueryExecutionRequested": True}, {"fullQuerySha256": "f" * 64}]:
            with self.subTest(delta=delta), patch.object(m, "protected", return_value=m.encoded(PRIOR | delta)), self.assertRaises(RuntimeError): m.previous(base)

    def test_real_official_compiler_exact_new_hashes_and_unique_full_reversal(self):
        self.assertEqual(m.sha(self.sql.encode()), m.ORIGINAL_QUERY_SHA)
        self.assertEqual(self.query["relationSqlSha256"], m.ORIGINAL_RELATION_SHA)
        self.assertEqual(m.sha(self.derived.encode()), m.DERIVED_QUERY_SHA)
        self.assertEqual(len(self.derived.encode()) - len(self.sql.encode()), 5)
        self.assertEqual(self.sql.count(m.ORIGINAL_ORDER), 1)
        self.assertEqual(self.derived.count(m.DERIVED_ORDER), 1)
        self.assertEqual(self.derived.replace(m.DERIVED_ORDER, m.ORIGINAL_ORDER), self.sql)
        self.assertFalse(self.derivation["oldQueryIdentityClaimed"])
        self.assertFalse(self.derivation["ambiguousTieWinnerEquivalenceClaimed"])

    def test_source_hash_and_compiler_metadata_mutations_refuse_before_transport(self):
        for sql, query in [(self.sql.replace("DESC", "ASC", 1), self.query), (self.sql + m.ORIGINAL_ORDER, self.query),
            (self.derived, self.query), (self.sql, self.query | {"originalMethodCodeIdentityVerified": False}),
            (self.sql, self.query | {"relationSqlSha256": "f" * 64})]:
            with self.subTest(query=query), patch.object(m.subprocess, "Popen") as launch, self.assertRaises(RuntimeError): m.derive(sql, query)
            launch.assert_not_called()

    def test_all_actual_filter_and_chronology_bytes_remain_identical(self):
        # Equality of the split prefix/suffix covers every predicate, not selected tokens alone.
        self.assertEqual(self.sql.split(m.ORIGINAL_ORDER), self.derived.split(m.DERIVED_ORDER))
        self.assertEqual(m.ORIGINAL_ORDER.split(",")[1:], m.DERIVED_ORDER.split(",")[1:])
        for token in ["DISTINCT ON(event.token_id)", "chain_event_block_hash", "mint_transaction_hash", "base_error IS NOT NULL", "publication_content_hash", "base_metadata_probe()"]:
            self.assertIn(token, self.sql); self.assertIn(token, self.derived)

    def test_reference_groupwise_maxima_multi_token_duplicates_and_ambiguous_ties(self):
        rows = [("2", 4, 9, 1, "older"), ("2", 5, 0, 0, "newer-block"), ("2", 5, 1, 0, "newer-tx"),
            ("2", 5, 1, 1, "tie-A"), ("2", 5, 1, 1, "tie-B"), ("2", 5, 1, 1, "tie-A"),
            ("10", 6, 0, 2, "other"), (None, 7, 0, 0, "null-token")]
        original = reference_candidates(rows, False); derived = reference_candidates(rows, True)
        self.assertNotEqual([key for key, _ in original], [key for key, _ in derived])
        self.assertEqual(dict(original), dict(derived))
        self.assertEqual(dict(derived)["2"], frozenset({"tie-A", "tie-B"}))
        # Eligibility is unchanged before either ordering in this finite reference fixture.
        eligible = [row for row, canonical in [(rows[0], True), (rows[1], False), (rows[2], True)] if canonical]
        self.assertEqual(dict(reference_candidates(eligible, False)), dict(reference_candidates(eligible, True)))

    def test_payload_one_derived_select_original_4MiB_and_no_settings_delta(self):
        request = m.payload(base, self.derived).decode()
        self.assertEqual(request.count(self.derived), 1)
        self.assertEqual(request, "BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;" + base.IDENTITY + ";" + base.SETTINGS + ";" + self.derived + ";ROLLBACK;")
        for forbidden in ["SET LOCAL jit", "SET LOCAL work_mem", "SET LOCAL hash_mem_multiplier", "EXPLAIN", "ANALYZE", "COMMIT", "CREATE ", "ALTER ", "GRANT "]:
            self.assertNotIn(forbidden, request)
        with self.assertRaises(RuntimeError): m.payload(base, self.sql)

    def test_original_peer_args_80_seconds_typed_private_counts_and_no_retry(self):
        raw = output(); process = types.SimpleNamespace(pid=123, returncode=0, communicate=Mock(return_value=(raw, b"")))
        with patch.object(m.os.path, "lexists", return_value=False), patch.object(m, "save", return_value="a" * 64) as save, patch.object(m.subprocess, "Popen", return_value=process) as launch, patch.object(m.time, "monotonic_ns", side_effect=[100, 200]):
            value = m.observe(base, peer(), self.derived, PRIOR)
        self.assertEqual(value["transportWallNanoseconds"], 100)
        self.assertEqual(value["result"], {"canonicalRows": 31, "publishedRows": 31, "probe": True})
        self.assertEqual(value["settings"]["workMemKiB"], 4096)
        self.assertEqual(process.communicate.call_args.kwargs, {"timeout": 80})
        self.assertEqual(process.communicate.call_args.args[0], m.payload(base, self.derived))
        args = launch.call_args.args[0]
        for arg in ["--reuid=111", "--regid=113", "--no-new-privs", "PGOPTIONS=" + peer().READ_OPTIONS, "postgres", "yunipals_backfill", "ON_ERROR_STOP=1"]: self.assertIn(arg, args)
        self.assertEqual(launch.call_args.kwargs["env"], peer().CLEAN)
        self.assertTrue(launch.call_args.kwargs["start_new_session"])
        save.assert_called_once(); self.assertIn("canonicalRows", save.call_args.args[1]["stdout"])

    def test_identity_settings_typed_count_probe_and_transport_failures_refuse(self):
        variants = [output(identity={"role": "foreign", "database": "yunipals_backfill", "databaseOid": "17584"}),
            output(settings=PRIOR["planAggregate"]["settings"] | {"workMemKiB": 65536}),
            output(settings=PRIOR["planAggregate"]["settings"] | {"jit": "off"}),
            output(result={"canonicalRows": 0, "publishedRows": 0, "probe": True}),
            output(result={"canonicalRows": 31, "publishedRows": 32, "probe": True}),
            output(result={"canonicalRows": True, "publishedRows": 1, "probe": True}),
            output(result={"canonicalRows": 31, "publishedRows": 31, "probe": False})]
        for raw in variants:
            with self.subTest(raw=raw), self.assertRaises(RuntimeError): self.observe(raw)
        for stderr, rc in [(b"original error", 0), (b"", 1)]:
            with self.assertRaises(RuntimeError): self.observe(output(), stderr, rc)

    def test_timeout_preserves_exact_error_and_kills_only_owned_process_group(self):
        error = subprocess.TimeoutExpired("own derived query", 80)
        process = types.SimpleNamespace(pid=123, communicate=Mock(side_effect=[error, (b"", b"")]))
        with patch.object(m.os.path, "lexists", return_value=False), patch.object(m.subprocess, "Popen", return_value=process), patch.object(m.os, "killpg") as kill:
            with self.assertRaises(subprocess.TimeoutExpired) as caught: m.observe(base, peer(), self.derived, PRIOR)
        self.assertIs(caught.exception, error); kill.assert_called_once_with(123, m.signal.SIGKILL)

    def test_whole_main_one_derived_query_exclusive_private_output_and_source_drift(self):
        for drift in [False, True]:
            with self.subTest(drift=drift), tempfile.TemporaryDirectory(dir=ROOT, prefix=".token-order-main-") as temporary, contextlib.ExitStack() as stack:
                audit = Path(temporary) / "audit"; stack.enter_context(patch.object(m, "AUDIT", audit))
                stack.enter_context(patch.object(m.socket, "gethostname", return_value="yunipals-main"))
                utility = types.SimpleNamespace(snapshot=Mock(side_effect=[{"source": True}, {"source": not drift}]), load_peer=peer, compile_query=lambda _: (self.sql, self.query))
                stack.enter_context(patch.object(m, "utility", return_value=utility)); stack.enter_context(patch.object(m, "previous", return_value=PRIOR)); stack.enter_context(patch.object(m, "protected", return_value=b"protectedReceiptIOFixture"))
                counts = {"canonicalRows": 31, "publishedRows": 31, "probe": True}
                observation = {"result": counts, "resultSha256": m.sha(m.encoded(counts)), "settings": PRIOR["planAggregate"]["settings"], "transportWallNanoseconds": 100}
                observed = stack.enter_context(patch.object(m, "observe", return_value=observation))
                with contextlib.redirect_stdout(io.StringIO()) as stream:
                    if drift:
                        with self.assertRaises(RuntimeError): m.main(["--run"])
                        self.assertFalse((audit / "result.json").exists()); self.assertTrue((audit / "failure.json").exists())
                    else:
                        self.assertEqual(m.main(["--run"]), 0); value = json.loads(stream.getvalue())
                        self.assertEqual(value["originalFullQuerySha256"], m.ORIGINAL_QUERY_SHA)
                        self.assertEqual(value["derivedFullQuerySha256"], m.DERIVED_QUERY_SHA)
                        self.assertNotIn("fullQuerySha256", value); self.assertNotIn("canonicalRows", json.dumps(value))
                        self.assertFalse(value["oldQueryIdentityClaimed"]); self.assertFalse(value["newHeldQualification"])
                        self.assertFalse(value["originalBaselineQueryRepeated"]); self.assertTrue(value["baselineIsDiagnosticComparisonOnly"])
                        self.assertEqual(value["resultSha256"], m.sha((audit / "result.json").read_bytes()))
                        self.assertEqual((audit / "query-observation.private.json").stat().st_mode & 0o777, 0o600)
                observed.assert_called_once_with(utility, unittest.mock.ANY, self.derived, PRIOR)
                with self.assertRaises(RuntimeError): m.main(["--run"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
