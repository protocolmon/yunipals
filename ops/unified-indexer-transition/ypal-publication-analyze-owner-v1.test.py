"""Actual compiler plus bounded timed-plan projection; PostgreSQL is mocked."""
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
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load("ypal-publication-analyze-owner-v1.py")
base = load(m.UTILITY.name)
public_previous = json.loads((HERE / "ypal-publication-jit-comparison-owner-v1.explain-fixture.json").read_bytes())
PRIOR = {key: value for key, value in public_previous.items() if key != "resultSha256"}


def node(kind="Result", **extra):
    return {"Node Type": kind, "Plan Rows": 1, "Plan Width": 16, "Startup Cost": 1.5, "Total Cost": 50.0,
        "Actual Startup Time": 2.5, "Actual Total Time": 3.5, "Actual Rows": 1, "Actual Loops": 1, **extra}


def plan():
    return [{"Plan": node(Plans=[node("Nested Loop", **{
        "Join Type": "Inner", "Parent Relationship": "InitPlan", "Subplan Name": "InitPlan 1 (returns $0)",
        "Shared Hit Blocks": 321, "Shared Read Blocks": 12, "I/O Read Time": 1.25,
        "Plans": [node("Index Scan", **{"Schema": "unified_ypal_20261023_v1", "Relation Name": "canonical_event", "Alias": "e_1",
            "Index Name": "canonical_event__block_number_transaction_index_log_index_index", "Scan Direction": "Backward",
            "Actual Rows": 1.25, "Actual Loops": 400000, "Filter": "secret-wallet-and-document-constant", "Output": ["private-row-expression"]}),
            node("Sort", **{"Sort Space Used": 1024, "Temp Written Blocks": 24, "Sort Key": ["private-sort-expression"]})]})]),
        "Planning Time": 2.1, "Execution Time": 20000.5,
        "JIT": {"Functions": 12, "Options": {"Inlining": False, "Optimization": False, "Expressions": True, "Deforming": True},
            "Timing": {"Generation": 0.5, "Inlining": 0, "Optimization": 0.5, "Emission": 1.0, "Total": 2.0}}}]


def peer():
    return types.SimpleNamespace(SENTINEL="/run/nonexistent-public-analyze-fixture", CLEAN=base.CLEAN,
        READ_OPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=72000")


def output(identity=None, settings=None, actual_plan=None):
    return b"\n".join(m.encoded(value) for value in [
        identity or {"role": "postgres", "database": "yunipals_backfill", "databaseOid": "17584"},
        settings or PRIOR["planAggregate"]["settings"], actual_plan or plan()])


class Controls(unittest.TestCase):
    def test_default_is_inert_and_prior_utility_and_actual_receipt_authenticate(self):
        with patch.object(m, "utility", side_effect=AssertionError("no loading")), patch.object(m.subprocess, "Popen", side_effect=AssertionError("no dispatch")), contextlib.redirect_stdout(io.StringIO()) as stream:
            self.assertEqual(m.main([]), 0)
        self.assertTrue(json.loads(stream.getvalue())["staticOnly"])
        self.assertEqual(m.sha((HERE / m.UTILITY.name).read_bytes()), m.UTILITY_SHA)
        self.assertEqual(m.sha(m.encoded(PRIOR)), m.PREVIOUS_SHA)
        with patch.object(m, "protected", return_value=m.encoded(PRIOR)):
            self.assertEqual(m.previous(base), PRIOR)
        for field, value in [("completed", 0), ("fullQuerySha256", "f" * 64), ("actualQueryExecutionRequested", True)]:
            with patch.object(m, "protected", return_value=m.encoded(PRIOR | {field: value})), self.assertRaises(RuntimeError):
                m.previous(base)

    def test_real_official_compiler_reproduces_exact_query_and_one_timed_payload(self):
        candidates = [Path(os.environ["YUNIPALS_PUBLICATION_TEST_NODE"])] if "YUNIPALS_PUBLICATION_TEST_NODE" in os.environ else [
            Path("/opt/node-v24.18.1/bin/node"), Path.home() / ".nvm/versions/node/v24.18.1/bin/node"]
        runtime = next((candidate for candidate in candidates if candidate.is_file()), None)
        if runtime is None:
            self.skipTest("explicit local Node24.18.1 fixture unavailable")
        if subprocess.run([str(runtime), "--version"], capture_output=True, text=True, check=True, timeout=5).stdout.strip() != "v24.18.1":
            self.skipTest("exact Node24.18.1 fixture required")
        original_protected = base.protected
        def public(path, digest=None):
            if Path(path) in {base.TEMPLATE, base.PEER}:
                raw = (HERE / Path(path).name).read_bytes()
                base.need(digest is None or base.sha(raw) == digest, "actual_source_fixture_required")
                return raw
            return original_protected(path, digest)
        with tempfile.TemporaryDirectory(dir=ROOT, prefix=".analyze-public-compiler-") as temporary:
            folder = Path(temporary)
            (folder / "native-recovery.env").write_text("\n".join([
                "DATABASE_SCHEMA=unified_ypal_20261023_v1", "READ_DATABASE_SCHEMA=" + base.READ,
                "OWNERSHIP_READ_MODE=unified", "OWNERSHIP_READ_SCHEMA=" + base.READ,
                "OWNERSHIP_RELEASE_ID=0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3",
                "YUNIPALS_PROJECTION_MODE=generation", "METADATA_SOURCE_MODE=archive", "BASE_METADATA_INGESTION=native", "BNB_CONFIRMATIONS=20"]) + "\n")
            with patch.object(base, "protected", side_effect=public):
                actual_peer = base.load_peer()
            with patch.object(base, "protected", side_effect=public), patch.object(base, "PROJECT", ROOT / "apps/yunipals-indexer"), patch.object(base, "NODE", str(runtime)), patch.object(actual_peer, "CANDIDATES", folder):
                sql, query = base.compile_query(actual_peer)
            self.assertEqual((query["fullQuerySha256"], query["relationSqlSha256"]), (m.QUERY_SHA, m.RELATION_SHA))
            request = m.payload(base, sql).decode()
            self.assertEqual(request.count(sql), 1)
            self.assertIn("EXPLAIN (ANALYZE TRUE,BUFFERS TRUE,VERBOSE TRUE,", request)
            self.assertTrue(request.startswith("BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;"))
            self.assertTrue(request.endswith(sql + ";ROLLBACK;"))
            for forbidden in ["COMMIT", "SET LOCAL jit", "SET LOCAL work_mem", "CREATE ", "ALTER ", "GRANT "]:
                self.assertNotIn(forbidden, request)

    def test_node_paths_parent_subplan_identifier_and_actual_scalar_projection(self):
        projected = m.project(plan(), PRIOR)
        self.assertEqual([row["path"] for row in projected["nodes"]], ["0", "0.0", "0.0.0", "0.0.1"])
        self.assertEqual([row["parentPath"] for row in projected["nodes"]], [None, "0", "0.0", "0.0"])
        nested, scan, sort = projected["nodes"][1:]
        self.assertEqual(nested["subplan"], {"name": "InitPlan 1 (returns $0)"})
        self.assertEqual(nested["joinType"], {"name": "Inner"})
        self.assertEqual(scan["schema"], {"name": "unified_ypal_20261023_v1"})
        self.assertEqual(scan["relation"], {"name": "canonical_event"})
        self.assertEqual(scan["alias"], {"name": "e_1"})
        self.assertEqual(scan["scanDirection"], {"name": "Backward"})
        self.assertEqual((scan["actualRowsPerLoop"], scan["actualLoops"]), (1.25, 400000))
        self.assertEqual(nested["buffers"], {"Shared Hit Blocks": 321, "Shared Read Blocks": 12})
        self.assertNotIn("Shared Read Blocks", scan["buffers"])
        self.assertEqual(sort["otherScalarMetrics"]["Sort Space Used"], 1024)
        self.assertEqual(projected["jit"]["milliseconds"]["Total"], 2.0)
        self.assertTrue(projected["nodeTimeIncludesChildrenAndMayOverlap"])
        self.assertTrue(projected["functionInternalPlansMayBeOpaque"])

    def test_all_unknown_names_and_raw_expressions_are_private_or_hashed(self):
        value = plan(); scan = value[0]["Plan"]["Plans"][0]["Plans"][0]
        for key in ["Schema", "Relation Name", "Alias", "Index Name", "Join Type", "Scan Direction", "Parent Relationship", "Subplan Name"]:
            scan[key] = "private_identifier_marker_" + key.replace(" ", "_")
        scan["Workers"] = [{"Output": ["private-worker-row"]}]
        projected = m.project(value, PRIOR)
        public = json.dumps(projected)
        for secret in ["private_identifier_marker", "secret-wallet-and-document-constant", "private-row-expression", "private-worker-row", "private-sort-expression"]:
            self.assertNotIn(secret, public)
        for key in ["schema", "relation", "alias", "index", "joinType", "scanDirection", "parentRelationship", "subplan"]:
            self.assertEqual(set(projected["nodes"][2][key]), {"sha256"})

    def test_unexecuted_malformed_boolean_nonfinite_or_negative_evidence_refuses(self):
        changes = [lambda value: value[0].pop("Execution Time"), lambda value: value[0].update(Triggers=[{"private": True}]),
            lambda value: value[0]["Plan"].pop("Actual Loops"), lambda value: value[0]["Plan"].update({"Actual Rows": True}),
            lambda value: value[0]["Plan"].update({"Actual Total Time": float("nan")}),
            lambda value: value[0]["Plan"].update({"Actual Loops": -1}), lambda value: value[0]["Plan"].update({"Shared Read Blocks": False}),
            lambda value: value[0]["Plan"].update(Plans={}), lambda value: value[0]["JIT"].update(Timing={"Total": float("inf")})]
        for index, change in enumerate(changes):
            value = plan(); change(value)
            with self.subTest(index=index), self.assertRaises(RuntimeError):
                m.project(value, PRIOR)

    def test_depth_and_node_population_are_bounded(self):
        root = node(); current = root
        for _ in range(130):
            child = node(); current["Plans"] = [child]; current = child
        with self.assertRaises(RuntimeError): m.project([{"Plan": root, "Execution Time": 1}], PRIOR)
        with self.assertRaises(RuntimeError): m.project([{"Plan": node(Plans=[node() for _ in range(5000)]), "Execution Time": 1}], PRIOR)

    def test_original_readonly_transport_identity_limits_and_single_payload(self):
        sql = "SELECT explicit_publication_fixture"; raw = output()
        process = types.SimpleNamespace(pid=123, returncode=0, communicate=Mock(return_value=(raw, b"")))
        with patch.object(m, "QUERY_SHA", m.sha(sql.encode())), patch.object(m.os.path, "lexists", return_value=False), patch.object(m.subprocess, "Popen", return_value=process) as launch, patch.object(m.time, "monotonic_ns", side_effect=[100, 200]):
            expected_request = m.payload(base, sql)
            settings, actual, transport = m.observe(base, peer(), sql, PRIOR)
        self.assertEqual(settings, PRIOR["planAggregate"]["settings"])
        self.assertEqual(actual, plan()); self.assertEqual(transport["transportWallNanoseconds"], 100)
        args = launch.call_args.args[0]
        for argument in ["--reuid=111", "--regid=113", "--clear-groups", "--no-new-privs", "PGOPTIONS=" + peer().READ_OPTIONS, "postgres", "yunipals_backfill"]:
            self.assertIn(argument, args)
        self.assertEqual(process.communicate.call_args.kwargs, {"timeout": 80})
        self.assertEqual(process.communicate.call_args.args[0], expected_request)
        self.assertEqual(launch.call_args.kwargs["env"], peer().CLEAN)
        self.assertTrue(launch.call_args.kwargs["start_new_session"])

    def test_foreign_identity_JIT_or_other_setting_drift_refuses(self):
        sql = "SELECT explicit_publication_fixture"
        variants = [output(identity={"role": "foreign"}), output(settings=PRIOR["planAggregate"]["settings"] | {"jit": "off"}),
            output(settings=PRIOR["planAggregate"]["settings"] | {"statementTimeoutMs": 60001}),
            output(settings=PRIOR["planAggregate"]["settings"] | {"workMemKiB": 8192})]
        for raw in variants:
            process = types.SimpleNamespace(pid=123, returncode=0, communicate=Mock(return_value=(raw, b"")))
            with patch.object(m, "QUERY_SHA", m.sha(sql.encode())), patch.object(m.os.path, "lexists", return_value=False), patch.object(m.subprocess, "Popen", return_value=process), self.assertRaises(RuntimeError):
                m.observe(base, peer(), sql, PRIOR)

    def test_query_mutation_refuses_before_process_and_timeout_keeps_original_error(self):
        with patch.object(m.subprocess, "Popen") as launch, self.assertRaises(RuntimeError):
            m.payload(base, "SELECT changed")
        launch.assert_not_called()
        sql = "SELECT explicit_publication_fixture"; error = subprocess.TimeoutExpired("owned-plan", 80)
        process = types.SimpleNamespace(pid=123, communicate=Mock(side_effect=[error, (b"", b"")]))
        with patch.object(m, "QUERY_SHA", m.sha(sql.encode())), patch.object(m.os.path, "lexists", return_value=False), patch.object(m.subprocess, "Popen", return_value=process), patch.object(m.os, "killpg") as kill:
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                m.observe(base, peer(), sql, PRIOR)
        self.assertIs(caught.exception, error); kill.assert_called_once_with(123, m.signal.SIGKILL)

    def test_whole_main_keeps_full_plan_private_projection_public_and_refuses_source_drift(self):
        for drift in [False, True]:
            with self.subTest(drift=drift), tempfile.TemporaryDirectory(dir=ROOT, prefix=".analyze-main-") as temporary, contextlib.ExitStack() as stack:
                audit = Path(temporary) / "audit"
                stack.enter_context(patch.object(m, "AUDIT", audit)); stack.enter_context(patch.object(m.socket, "gethostname", return_value="yunipals-main"))
                actual_base = types.SimpleNamespace(snapshot=Mock(side_effect=[{"same": True}, {"same": not drift}]), load_peer=lambda: peer(),
                    compile_query=lambda _: ("explicitCompilerIOFixture", {"fullQuerySha256": m.QUERY_SHA, "relationSqlSha256": m.RELATION_SHA, "fullQueryBytes": 3558, "relationSqlBytes": 3133}))
                stack.enter_context(patch.object(m, "utility", return_value=actual_base)); stack.enter_context(patch.object(m, "previous", return_value=PRIOR))
                stack.enter_context(patch.object(m, "protected", return_value=b"explicitProtectedReceiptIOFixture"))
                transport = {"transportWallNanoseconds": 100, "stdoutSha256": "a" * 64, "stdoutBytes": 1000, "stderrBytes": 0, "requestSha256": "b" * 64}
                observed = stack.enter_context(patch.object(m, "observe", return_value=(PRIOR["planAggregate"]["settings"], plan(), transport)))
                with contextlib.redirect_stdout(io.StringIO()) as stream:
                    if drift:
                        with self.assertRaises(RuntimeError): m.main(["--run"])
                        self.assertFalse((audit / "result.json").exists())
                    else:
                        self.assertEqual(m.main(["--run"]), 0)
                        value = json.loads(stream.getvalue())
                        self.assertTrue(value["explainAnalyzeRequested"])
                        self.assertFalse(value["newCurrentAuthority"])
                        self.assertFalse(value["newHeldQualification"])
                        self.assertEqual(value["resultSha256"], m.sha((audit / "result.json").read_bytes()))
                        self.assertNotIn("secret-wallet-and-document-constant", json.dumps(value))
                observed.assert_called_once()
                self.assertIn("secret-wallet-and-document-constant", (audit / "full-plan.private.json").read_text())
                self.assertEqual((audit / "full-plan.private.json").stat().st_mode & 0o777, 0o600)
                with self.assertRaises(RuntimeError): m.main(["--run"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
