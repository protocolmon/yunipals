"""Inert one-shot 64 MiB work_mem measurement of the exact publication SELECT."""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import sys
import time
import types

FORMAT = "root-genuine-publication-work-mem-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
UTILITY = OPS / "ypal-publication-explain-owner-v1.py"
UTILITY_SHA = "eaee00ac1f5a09d7c2b76082220563c882ea4269798113e2ebe0237831bab3e4"
PREVIOUS = Path("/var/backups/yunipals-root-publication-explain-20261026-1/result.json")
PREVIOUS_SHA = "fd53eb603e450e6ee8e9aa9a77929eb36ea883292cdd3659b0cdb5b73adb9ac3"
QUERY_SHA = "c2cce90adcf317aac802226d6e8d203b109bc5e68337d721057f72e8d9603272"
RELATION_SHA = "bc47f8a57a2c0c90df56dd367b1217ee0e44ce9acddfe75c6b2206f7744b40ed"
BASELINE_RESULT_SHA = "17ec72f2d3a7e4c530c4a561079c58fadd25b405de5c56773a123d63d9e2765a"
AUDIT = Path("/var/backups/yunipals-root-publication-work-mem-20261026-1")
MAIN_UNIT = "postgresql@16-main.service"
FINANCIAL_UNIT = "postgresql@16-yunipals_market_production.service"
MINIMUM_AVAILABLE_KIB = 10 * 1024 * 1024
WORK_MEM_KIB = 64 * 1024
ESTIMATED_ENVELOPE_BYTES = (5 * 64 * 2 + 64) * 3 * 1024 * 1024
FRAME = ["st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"]
UNIT_FIELDS = {"Id", "LoadState", "ActiveState", "SubState", "MainPID", "InvocationID", "MemoryCurrent", "MemoryHigh", "MemoryMax"}
IDENTITY_RESOURCE = """SELECT jsonb_build_object('role',current_user,'database',current_database(),
'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
'maxConnections',current_setting('max_connections')::int,
'superuserReserved',current_setting('superuser_reserved_connections')::int,
'currentConnections',c.n,'requiredConnectionMargin',10,
'resourceGuard',1/(CASE WHEN c.n<=current_setting('max_connections')::int-current_setting('superuser_reserved_connections')::int-10
 AND current_setting('hash_mem_multiplier')::numeric=2
 AND current_setting('max_parallel_workers_per_gather')::int=2
 AND current_setting('jit')='on' THEN 1 ELSE 0 END))
FROM(SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity)c"""


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + chr(10)).encode()


def protected(path, digest):
    path = Path(path)
    for part in [*path.parents, path]:
        row = part.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
            "protected_exact_work_mem_input_required")
    first = path.lstat(); raw = path.read_bytes(); last = path.lstat()
    need(stat.S_ISREG(first.st_mode) and first.st_nlink == 1 and 0 < first.st_size <= 4000000 and
        all(getattr(first, key) == getattr(last, key) for key in FRAME) and len(raw) == first.st_size and sha(raw) == digest,
        "same_exact_work_mem_source_or_prior_receipt_required")
    return raw


def utility():
    value = types.ModuleType("authenticated_exact_publication_compiler")
    value.__file__ = str(UTILITY)
    exec(compile(protected(UTILITY, UTILITY_SHA), str(UTILITY), "exec"), value.__dict__)
    return value


def previous(base):
    value = json.loads(protected(PREVIOUS, PREVIOUS_SHA))
    need(value["format"] == base.FORMAT and value["completed"] is True and value["fullQuerySha256"] == QUERY_SHA and
        value["relationSqlSha256"] == RELATION_SHA and value["fullQueryBytes"] == 3558 and value["relationSqlBytes"] == 3133 and
        value["originalMethodCodeIdentityVerified"] is value["freshCompilationPerformed"] is True and
        value["actualQueryExecutionRequested"] is value["explainAnalyzeRequested"] is False and
        value["planAggregate"]["settings"]["jit"] == "on" and value["planAggregate"]["settings"]["workMemKiB"] == 4096 and
        value["planAggregate"]["settings"]["hashMemMultiplier"] == 2 and value["planAggregate"]["settings"]["maxParallelWorkersPerGather"] == 2,
        "actual_original_query_and_4MiB_settings_ancestry_required")
    return value


def resources(base):
    raw = Path("/proc/meminfo").read_bytes()
    need(0 < len(raw) < 65536, "bounded_fresh_OS_memory_inventory_required")
    memory = {}
    for line in raw.decode("ascii").splitlines():
        match = re.fullmatch(r"(MemAvailable|MemTotal):\s+([0-9]+) kB", line)
        if match:
            need(match[1] not in memory, "unique_OS_memory_scalar_required")
            memory[match[1]] = int(match[2])
    need(set(memory) == {"MemAvailable", "MemTotal"} and MINIMUM_AVAILABLE_KIB <= memory["MemAvailable"] <= memory["MemTotal"],
        "at_least_10GiB_fresh_available_memory_required")
    args = ["/usr/bin/systemctl", "show", "--no-pager", "--property=" + ",".join(sorted(UNIT_FIELDS)), MAIN_UNIT, FINANCIAL_UNIT]
    result = subprocess.run(args, capture_output=True, timeout=15, env=base.CLEAN)
    need(result.returncode == 0 and not result.stderr and 0 < len(result.stdout) < 65536, "bounded_readonly_PG_memory_unit_inventory_required")
    units = {}
    for block in result.stdout.decode("ascii").strip().split("\n\n"):
        row = {}
        for line in block.splitlines():
            key, separator, value = line.partition("=")
            need(separator and key not in row, "unique_typed_PG_unit_property_required"); row[key] = value
        need(set(row) == UNIT_FIELDS and row["Id"] in {MAIN_UNIT, FINANCIAL_UNIT} and row["Id"] not in units and
            row["LoadState"] == "loaded" and row["ActiveState"] == "active" and row["SubState"] == "running" and
            row["MainPID"].isdigit() and int(row["MainPID"]) > 0 and re.fullmatch("[a-f0-9]{32}", row["InvocationID"]) and
            row["MemoryCurrent"].isdigit(), "exact_active_PG_unit_identity_and_memory_fields_required")
        units[row["Id"]] = row
    need(set(units) == {MAIN_UNIT, FINANCIAL_UNIT} and units[MAIN_UNIT]["MemoryHigh"] == units[MAIN_UNIT]["MemoryMax"] == "infinity" and
        units[FINANCIAL_UNIT]["MemoryHigh"] == "1610612736" and units[FINANCIAL_UNIT]["MemoryMax"] == "2147483648" and
        int(units[FINANCIAL_UNIT]["MemoryCurrent"]) <= 2147483648, "unchanged_exact_main_and_financial_PG_memory_limits_required")
    return {"MemAvailableKiB": memory["MemAvailable"], "MemTotalKiB": memory["MemTotal"], "units": units,
        "freshOSAndManagerReads": True, "serviceActions": 0}


def same_units(before, after):
    keys = UNIT_FIELDS - {"MemoryCurrent"}
    return all({key: before["units"][name][key] for key in keys} == {key: after["units"][name][key] for key in keys}
        for name in [MAIN_UNIT, FINANCIAL_UNIT])


def payload(base, sql):
    need(type(sql) is str and sha(sql.encode()) == QUERY_SHA and ";" not in sql and "\\" not in sql,
        "one_exact_unchanged_publication_SELECT_required")
    return ("BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;" + IDENTITY_RESOURCE +
        ";SET LOCAL work_mem='64MB';" + base.SETTINGS + ";" + sql + ";ROLLBACK;").encode()


def observe(base, peer, sql, prior):
    need(not os.path.lexists(peer.SENTINEL), "absent_original_peer_password_file_required")
    args = ["/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "--no-new-privs", "/usr/bin/env", "-i",
        "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "TZ=UTC", "PGPASSFILE=" + peer.SENTINEL,
        "PGAPPNAME=ypal_publication_work_mem_once", "PGOPTIONS=" + peer.READ_OPTIONS,
        "/usr/bin/psql", "-XwAtq", "-h", "/var/run/postgresql", "-p", "5432", "-U", "postgres", "-d", "yunipals_backfill", "-v", "ON_ERROR_STOP=1"]
    request = payload(base, sql); started = time.monotonic_ns()
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=peer.CLEAN, cwd="/", start_new_session=True)
    try:
        out, err = process.communicate(request, timeout=80)
    except BaseException:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.communicate(); raise
    elapsed = time.monotonic_ns() - started
    transport_sha = save("sql-transport.private.json", {"stdout": out.decode("utf-8", "replace"),
        "stderr": err.decode("utf-8", "replace"), "returncode": process.returncode,
        "stdoutSha256": sha(out), "stderrSha256": sha(err)})
    need(process.returncode == 0 and not err and 0 < len(out) < 100000 and not os.path.lexists(peer.SENTINEL),
        "bounded_single_readonly_work_mem_query_failed_no_retry")
    identity, settings, result = base.decode_values(out)
    keys = {"role", "database", "databaseOid", "maxConnections", "superuserReserved", "currentConnections", "requiredConnectionMargin", "resourceGuard"}
    need(type(identity) is dict and set(identity) == keys and identity["role"] == "postgres" and
        identity["database"] == "yunipals_backfill" and identity["databaseOid"] == "17584" and
        all(type(identity[key]) is int and identity[key] >= 0 for key in keys - {"role", "database", "databaseOid"}) and
        identity["requiredConnectionMargin"] == 10 and identity["resourceGuard"] == 1 and
        identity["currentConnections"] <= identity["maxConnections"] - identity["superuserReserved"] - 10,
        "fresh_actual_target_database_and_connection_headroom_guard_required")
    expected = {**prior["planAggregate"]["settings"], "workMemKiB": WORK_MEM_KIB}
    need(encoded(settings) == encoded(expected) and settings["readOnly"] == "on" and settings["jit"] == "on" and
        settings["hashMemMultiplier"] == 2 and settings["maxParallelWorkersPerGather"] == 2 and
        settings["statementTimeoutMs"] == 60000 and settings["lockTimeoutMs"] == 1000 and settings["idleTransactionTimeoutMs"] == 72000,
        "only_transaction_local_64MiB_work_mem_may_differ_from_original_settings")
    need(type(result) is dict and set(result) == {"canonicalRows", "publishedRows", "probe"} and result["probe"] is True and
        type(result["canonicalRows"]) is type(result["publishedRows"]) is int and result["canonicalRows"] == result["publishedRows"] > 0 and
        type(elapsed) is int and elapsed > 0, "fresh_positive_complete_publication_result_required")
    return {"identityAndConnectionGuard": identity, "settings": settings, "result": result, "resultSha256": sha(encoded(result)),
        "privateTransportSha256": transport_sha, "transportWallNanoseconds": elapsed, "stdoutSha256": sha(out),
        "stdoutBytes": len(out), "stderrBytes": 0, "requestSha256": sha(request)}


def save(name, value):
    raw = encoded(value); fd = os.open(AUDIT / name, os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "wb") as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(AUDIT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
    return sha(raw)


def main(args):
    if not args:
        print(json.dumps({"format": FORMAT, "staticOnly": True, "databaseDispatchRequested": False})); return 0
    need(args == ["--run"], "one_explicit_64MiB_query_only")
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "root_on_exact_host_required")
    need(not os.path.lexists(AUDIT), "exclusive_new_work_mem_audit_required")
    row = AUDIT.parent.lstat()
    need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and not row.st_mode & 0o022, "protected_work_mem_audit_parent_required")
    AUDIT.mkdir(mode=0o700); os.chmod(AUDIT, 0o700)
    save("intent.json", {"format": FORMAT, "workMemKiB": WORK_MEM_KIB, "onlyTransactionLocalWorkMemChanged": True, "automaticRetryAllowed": False})
    try:
        base = utility(); prior = previous(base); before = base.snapshot(); peer = base.load_peer(); sql, query = base.compile_query(peer)
        need(query["fullQuerySha256"] == QUERY_SHA and query["relationSqlSha256"] == RELATION_SHA and
            query["fullQueryBytes"] == 3558 and query["relationSqlBytes"] == 3133, "fresh_exact_original_publication_query_required")
        resource_before = resources(base)
        observed = observe(base, peer, sql, prior)
        observation_sha = save("query-observation.private.json", observed)
        resource_after = resources(base)
        need(same_units(resource_before, resource_after) and base.snapshot() == before and
            protected(PREVIOUS, PREVIOUS_SHA) and protected(UTILITY, UTILITY_SHA), "unchanged_original_sources_env_and_PG_unit_identities_and_limits_required")
        resource_sha = save("resource-bookends.private.json", {"before": resource_before, "after": resource_after})
        source_sha = save("source-bookends.private.json", before)
        value = {"format": FORMAT, "completed": True, **query, "priorEXPLAINSha256": PREVIOUS_SHA,
            "privateObservationSha256": observation_sha, "resourceBookendsSha256": resource_sha, "sourceBookendsSha256": source_sha,
            "resultSha256OfCounts": observed["resultSha256"], "baselineResultSha256": BASELINE_RESULT_SHA,
            "baselineResultHashMatches": observed["resultSha256"] == BASELINE_RESULT_SHA, "baselineIsDiagnosticComparisonOnly": True,
            "transportWallNanoseconds": observed["transportWallNanoseconds"], "settings": observed["settings"],
            "connectionHeadroom": observed["identityAndConnectionGuard"],
            "MemAvailableKiBBefore": resource_before["MemAvailableKiB"], "MemAvailableKiBAfter": resource_after["MemAvailableKiB"],
            "estimatedConservativeEnvelopeBytes": ESTIMATED_ENVELOPE_BYTES, "estimateIsNotAnRSSHardCap": True,
            "separateSnapshotsCacheAndConcurrentMovementUncontrolled": True, "causalPerformanceQualified": False,
            "allCompilerAndEnvFilesUnchanged": True, "PGUnitIdentitiesAndLimitsUnchanged": True,
            "actualCountsKeptPrivate": True, "actualQueryExecutionRequested": True, "explainAnalyzeRequested": False,
            "onlyTransactionLocalWorkMemChanged": True, "jitOrHashMultiplierOrGlobalSettingChanged": False,
            "newCurrentAuthority": False, "newHeldQualification": False, "databaseMutationsRequested": False,
            "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0, "automaticRetryAllowed": False}
        digest = save("result.json", value); print(json.dumps({**value, "resultSha256": digest}, sort_keys=True)); return 0
    except BaseException as error:
        try: save("failure.json", {"format": FORMAT, "completed": False, "failureType": type(error).__name__,
            "failureSha256": sha(str(error).encode()), "automaticRetryAllowed": False, "newCurrentAuthority": False})
        except Exception: pass
        raise


if __name__ == "__main__":
    if sys.argv[1:]:
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("bounded_single_64MiB_readonly_query")))
        signal.alarm(170)
    raise SystemExit(main(sys.argv[1:]))
