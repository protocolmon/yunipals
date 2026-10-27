"""Fresh OS/resource fixtures and original SQL transport; no DB/SSH/Git."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


m = load("ypal-publication-work-mem-owner-v1.py")
base = load(m.UTILITY.name)
previous_public = json.loads((HERE / "ypal-publication-jit-comparison-owner-v1.explain-fixture.json").read_bytes())
PRIOR = {key: value for key, value in previous_public.items() if key != "resultSha256"}


def units():
    return {name: {"Id": name, "LoadState": "loaded", "ActiveState": "active", "SubState": "running", "MainPID": str(100 + index),
        "InvocationID": str(index + 1) * 32, "MemoryCurrent": "15426502656" if index == 0 else "631410688",
        "MemoryHigh": "infinity" if index == 0 else "1610612736", "MemoryMax": "infinity" if index == 0 else "2147483648"}
        for index, name in enumerate([m.MAIN_UNIT, m.FINANCIAL_UNIT])}


def manager_output(value):
    return ("\n\n".join("\n".join(key + "=" + item for key, item in row.items()) for row in value.values()) + "\n").encode()


def resources():
    return {"MemAvailableKiB": 21419184, "MemTotalKiB": 32089308, "units": units(), "freshOSAndManagerReads": True, "serviceActions": 0}


def peer():
    return types.SimpleNamespace(SENTINEL="/run/nonexistent-public-work-mem-fixture", CLEAN=base.CLEAN,
        READ_OPTIONS="-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=72000")


def identity():
    return {"role": "postgres", "database": "yunipals_backfill", "databaseOid": "17584", "maxConnections": 100,
        "superuserReserved": 3, "currentConnections": 33, "requiredConnectionMargin": 10, "resourceGuard": 1}


def output(ident=None, settings=None, result=None):
    return b"\n".join(m.encoded(value) for value in [ident or identity(), settings or {**PRIOR["planAggregate"]["settings"], "workMemKiB": 65536},
        result if result is not None else {"canonicalRows": 31, "publishedRows": 31, "probe": True}])


class Controls(unittest.TestCase):
    def observe(self, raw):
        sql = "SELECT explicit_original_query_fixture"; process = types.SimpleNamespace(pid=123, returncode=0, communicate=Mock(return_value=(raw, b"")))
        with patch.object(m, "QUERY_SHA", m.sha(sql.encode())), patch.object(m.os.path, "lexists", return_value=False), patch.object(m, "save", return_value="a" * 64), patch.object(m.subprocess, "Popen", return_value=process):
            return m.observe(base, peer(), sql, PRIOR)

    def test_default_inert_actual_utility_prior_and_fixed_baseline_hash(self):
        with patch.object(m, "utility", side_effect=AssertionError("not loaded")), patch.object(m.subprocess, "Popen", side_effect=AssertionError("not dispatched")), contextlib.redirect_stdout(io.StringIO()) as stream:
            self.assertEqual(m.main([]), 0)
        self.assertTrue(json.loads(stream.getvalue())["staticOnly"])
        self.assertEqual(m.sha((HERE / m.UTILITY.name).read_bytes()), m.UTILITY_SHA)
        self.assertEqual(m.sha(m.encoded(PRIOR)), m.PREVIOUS_SHA)
        self.assertEqual(m.BASELINE_RESULT_SHA, "17ec72f2d3a7e4c530c4a561079c58fadd25b405de5c56773a123d63d9e2765a")
        with patch.object(m, "protected", return_value=m.encoded(PRIOR)):
            self.assertEqual(m.previous(base), PRIOR)

    def test_fresh_meminfo_and_exact_unit_limits_are_read_without_service_action(self):
        memory = b"MemTotal:       32089308 kB\nMemAvailable:   21419184 kB\n"
        result = types.SimpleNamespace(returncode=0, stdout=manager_output(units()), stderr=b"")
        original = Path.read_bytes
        def read(path):
            self.assertEqual(path, Path("/proc/meminfo")); return memory
        with patch.object(Path, "read_bytes", read), patch.object(m.subprocess, "run", return_value=result) as run:
            value = m.resources(base)
        self.assertEqual(value, resources())
        self.assertEqual(run.call_args.kwargs, {"capture_output": True, "timeout": 15, "env": base.CLEAN})
        args = run.call_args.args[0]
        self.assertEqual(args[:3], ["/usr/bin/systemctl", "show", "--no-pager"])
        self.assertEqual(args[-2:], [m.MAIN_UNIT, m.FINANCIAL_UNIT])
        self.assertNotIn("set-property", args); self.assertIs(Path.read_bytes, original)

    def test_insufficient_memory_wrong_main_limits_and_financial_drift_refuse(self):
        variants = []
        main_limit = units(); main_limit[m.MAIN_UNIT]["MemoryMax"] = "21474836480"; variants.append(main_limit)
        market_limit = units(); market_limit[m.FINANCIAL_UNIT]["MemoryMax"] = "4294967296"; variants.append(market_limit)
        inactive = units(); inactive[m.MAIN_UNIT]["ActiveState"] = "inactive"; variants.append(inactive)
        pid_zero = units(); pid_zero[m.MAIN_UNIT]["MainPID"] = "0"; variants.append(pid_zero)
        for current in variants:
            process = types.SimpleNamespace(returncode=0, stdout=manager_output(current), stderr=b"")
            with patch.object(Path, "read_bytes", return_value=b"MemTotal: 32089308 kB\nMemAvailable: 21419184 kB\n"), patch.object(m.subprocess, "run", return_value=process), self.assertRaises(RuntimeError):
                m.resources(base)
        with patch.object(Path, "read_bytes", return_value=b"MemTotal: 32089308 kB\nMemAvailable: 10485759 kB\n"), patch.object(m.subprocess, "run") as run, self.assertRaises(RuntimeError):
            m.resources(base)
        run.assert_not_called()

    def test_resource_bookends_allow_current_memory_movement_but_not_unit_restart_or_limits(self):
        first = resources(); second = copy.deepcopy(first); second["units"][m.MAIN_UNIT]["MemoryCurrent"] = "16000000000"
        self.assertTrue(m.same_units(first, second))
        for key in ["MainPID", "InvocationID", "MemoryHigh", "MemoryMax"]:
            changed = copy.deepcopy(second); changed["units"][m.MAIN_UNIT][key] = "changed"
            self.assertFalse(m.same_units(first, changed))

    def test_sql_headroom_guard_precedes_64MiB_and_exact_query_with_no_other_delta(self):
        sql = "SELECT exact_original_publication"
        with patch.object(m, "QUERY_SHA", m.sha(sql.encode())):
            request = m.payload(base, sql).decode()
        self.assertEqual(request.count(sql), 1)
        self.assertLess(request.index(m.IDENTITY_RESOURCE), request.index("SET LOCAL work_mem='64MB'"))
        self.assertLess(request.index("SET LOCAL work_mem='64MB'"), request.index(sql))
        self.assertIn("1/(CASE WHEN c.n<=current_setting('max_connections')::int-current_setting('superuser_reserved_connections')::int-10", request)
        self.assertIn("current_setting('hash_mem_multiplier')::numeric=2", request)
        self.assertIn("current_setting('max_parallel_workers_per_gather')::int=2", request)
        self.assertIn("current_setting('jit')='on' THEN 1 ELSE 0 END)", request)
        self.assertTrue(request.startswith("BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;"))
        self.assertTrue(request.endswith(sql + ";ROLLBACK;"))
        for forbidden in ["SET LOCAL jit", "SET LOCAL hash_mem_multiplier", "ALTER ", "CREATE ", "GRANT ", "COMMIT", "EXPLAIN", "ANALYZE"]:
            self.assertNotIn(forbidden, request)
        self.assertEqual(m.ESTIMATED_ENVELOPE_BYTES, 2112 * 1024 * 1024)

    def test_original_peer_limits_and_exact_typed_private_observation(self):
        sql = "SELECT exact_original_publication"; raw = output(); process = types.SimpleNamespace(pid=123, returncode=0, communicate=Mock(return_value=(raw, b"")))
        with patch.object(m, "QUERY_SHA", m.sha(sql.encode())), patch.object(m.os.path, "lexists", return_value=False), patch.object(m, "save", return_value="a" * 64) as save, patch.object(m.subprocess, "Popen", return_value=process) as launch, patch.object(m.time, "monotonic_ns", side_effect=[100, 200]):
            value = m.observe(base, peer(), sql, PRIOR)
        self.assertEqual(value["transportWallNanoseconds"], 100)
        self.assertEqual(value["settings"]["workMemKiB"], 65536)
        self.assertEqual(value["result"], {"canonicalRows": 31, "publishedRows": 31, "probe": True})
        self.assertEqual(value["resultSha256"], m.sha(m.encoded(value["result"])))
        self.assertEqual(process.communicate.call_args.kwargs, {"timeout": 80})
        for arg in ["--reuid=111", "--regid=113", "PGOPTIONS=" + peer().READ_OPTIONS, "postgres", "yunipals_backfill", "ON_ERROR_STOP=1"]:
            self.assertIn(arg, launch.call_args.args[0])
        self.assertEqual(launch.call_args.kwargs["env"], peer().CLEAN)
        self.assertTrue(launch.call_args.kwargs["start_new_session"])
        self.assertEqual(save.call_args.args[0], "sql-transport.private.json")
        self.assertIn("canonicalRows", save.call_args.args[1]["stdout"])

    def test_bad_connection_guard_identity_settings_and_counts_fail_closed(self):
        cases = [output(ident=identity() | {"role": "foreign"}), output(ident=identity() | {"resourceGuard": True}),
            output(ident=identity() | {"currentConnections": 88}), output(ident=identity() | {"requiredConnectionMargin": 9}),
            output(settings=PRIOR["planAggregate"]["settings"] | {"workMemKiB": 65536, "jit": "off"}),
            output(settings=PRIOR["planAggregate"]["settings"] | {"workMemKiB": 65536, "hashMemMultiplier": 4}),
            output(settings=PRIOR["planAggregate"]["settings"] | {"workMemKiB": 32768}),
            output(result={"canonicalRows": 0, "publishedRows": 0, "probe": True}),
            output(result={"canonicalRows": 31, "publishedRows": 32, "probe": True}),
            output(result={"canonicalRows": 31, "publishedRows": 31, "probe": False}),
            output(result={"canonicalRows": True, "publishedRows": 1, "probe": True})]
        for index, raw in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(RuntimeError): self.observe(raw)

    def test_bad_query_refuses_before_Popen_and_timeout_preserves_original(self):
        with patch.object(m.subprocess, "Popen") as launch, self.assertRaises(RuntimeError): m.payload(base, "SELECT changed")
        launch.assert_not_called()
        sql = "SELECT exact_fixture"; error = m.subprocess.TimeoutExpired("own query", 80)
        process = types.SimpleNamespace(pid=123, communicate=Mock(side_effect=[error, (b"", b"")]))
        with patch.object(m, "QUERY_SHA", m.sha(sql.encode())), patch.object(m.os.path, "lexists", return_value=False), patch.object(m.subprocess, "Popen", return_value=process), patch.object(m.os, "killpg") as kill:
            with self.assertRaises(m.subprocess.TimeoutExpired) as caught: m.observe(base, peer(), sql, PRIOR)
        self.assertIs(caught.exception, error); kill.assert_called_once_with(123, m.signal.SIGKILL)

    def test_full_main_fresh_resources_before_one_query_no_baseline_redo_and_private_counts(self):
        for bad in [None, "resource-before", "service-after", "source-after"]:
            with self.subTest(bad=bad), tempfile.TemporaryDirectory(dir=ROOT, prefix=".work-mem-main-") as temporary, contextlib.ExitStack() as stack:
                audit = Path(temporary) / "audit"; events = []
                stack.enter_context(patch.object(m, "AUDIT", audit)); stack.enter_context(patch.object(m.socket, "gethostname", return_value="yunipals-main"))
                source = {"same": True}
                def compile_query(_):
                    events.append("compile"); return "exactCompilerIOFixture", {"fullQuerySha256": m.QUERY_SHA, "relationSqlSha256": m.RELATION_SHA, "fullQueryBytes": 3558, "relationSqlBytes": 3133}
                utility = types.SimpleNamespace(snapshot=Mock(side_effect=[source, source if bad != "source-after" else {"same": False}]), load_peer=peer, compile_query=compile_query)
                stack.enter_context(patch.object(m, "utility", return_value=utility)); stack.enter_context(patch.object(m, "previous", return_value=PRIOR)); stack.enter_context(patch.object(m, "protected", return_value=b"protectedReceiptIOFixture"))
                count = 0
                def actual_resources(_):
                    nonlocal count
                    count += 1; events.append("resource-" + str(count))
                    if bad == "resource-before" and count == 1: raise RuntimeError("insufficient_actual_memory_fixture")
                    value = resources()
                    if bad == "service-after" and count == 2: value["units"][m.MAIN_UNIT]["MainPID"] = "different"
                    return value
                stack.enter_context(patch.object(m, "resources", side_effect=actual_resources))
                result = {"canonicalRows": 31, "publishedRows": 31, "probe": True}
                def observe(*_):
                    events.append("query-64MB")
                    return {"identityAndConnectionGuard": identity(), "settings": PRIOR["planAggregate"]["settings"] | {"workMemKiB": 65536},
                        "result": result, "resultSha256": m.sha(m.encoded(result)), "transportWallNanoseconds": 100}
                observed = stack.enter_context(patch.object(m, "observe", side_effect=observe))
                with contextlib.redirect_stdout(io.StringIO()) as stream:
                    if bad is not None:
                        with self.assertRaises(RuntimeError): m.main(["--run"])
                        self.assertFalse((audit / "result.json").exists())
                    else:
                        self.assertEqual(m.main(["--run"]), 0); value = json.loads(stream.getvalue())
                        self.assertNotIn("canonicalRows", json.dumps(value)); self.assertTrue(value["baselineIsDiagnosticComparisonOnly"])
                        self.assertFalse(value["newCurrentAuthority"]); self.assertFalse(value["newHeldQualification"])
                        self.assertTrue(value["estimateIsNotAnRSSHardCap"])
                        self.assertEqual(value["resultSha256"], m.sha((audit / "result.json").read_bytes()))
                        self.assertIn("canonicalRows", (audit / "query-observation.private.json").read_text())
                        self.assertEqual((audit / "query-observation.private.json").stat().st_mode & 0o777, 0o600)
                if bad == "resource-before": observed.assert_not_called()
                else:
                    observed.assert_called_once(); self.assertEqual(events, ["compile", "resource-1", "query-64MB", "resource-2"])
                with self.assertRaises(RuntimeError): m.main(["--run"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
