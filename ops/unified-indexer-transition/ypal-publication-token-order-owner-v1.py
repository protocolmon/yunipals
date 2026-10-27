"""Inert derived-SQL trial: reverse only base_latest token-group enumeration."""
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import time
import types

FORMAT = "root-publication-token-order-diagnostic-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
UTILITY = OPS / "ypal-publication-explain-owner-v1.py"
UTILITY_SHA = "eaee00ac1f5a09d7c2b76082220563c882ea4269798113e2ebe0237831bab3e4"
PREVIOUS = Path("/var/backups/yunipals-root-publication-explain-20261026-1/result.json")
PREVIOUS_SHA = "fd53eb603e450e6ee8e9aa9a77929eb36ea883292cdd3659b0cdb5b73adb9ac3"
ORIGINAL_QUERY_SHA = "c2cce90adcf317aac802226d6e8d203b109bc5e68337d721057f72e8d9603272"
ORIGINAL_RELATION_SHA = "bc47f8a57a2c0c90df56dd367b1217ee0e44ce9acddfe75c6b2206f7744b40ed"
DERIVED_QUERY_SHA = "4ca00822f6c84d613d94f326bd522a68d5f7df9e38fefbd421b29a334eb95c49"
DERIVED_RELATION_SHA = "ddf70426830310056fedc6ea3d672f940d982191b92b3d44928679e665d4aeaa"
BASELINE_RESULT_SHA = "17ec72f2d3a7e4c530c4a561079c58fadd25b405de5c56773a123d63d9e2765a"
ORIGINAL_ORDER = "ORDER BY event.token_id,event.block_number DESC,event.transaction_index DESC,event.log_index DESC"
DERIVED_ORDER = "ORDER BY event.token_id DESC,event.block_number DESC,event.transaction_index DESC,event.log_index DESC"
PREFIX = "SELECT jsonb_build_object('canonicalRows',(SELECT count(*)FROM "
AUDIT = Path("/var/backups/yunipals-root-publication-token-order-20261026-1")
FRAME = ["st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"]


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + chr(10)).encode()


def protected(path, digest):
    path = Path(path)
    for part in [*path.parents, path]:
        row = part.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
            "protected_token_order_source_or_prior_receipt_required")
    first = path.lstat(); raw = path.read_bytes(); last = path.lstat()
    need(stat.S_ISREG(first.st_mode) and first.st_nlink == 1 and 0 < first.st_size <= 4000000 and
        all(getattr(first, key) == getattr(last, key) for key in FRAME) and len(raw) == first.st_size and sha(raw) == digest,
        "same_exact_token_order_input_bytes_required")
    return raw


def utility():
    value = types.ModuleType("authenticated_original_publication_compiler")
    value.__file__ = str(UTILITY)
    exec(compile(protected(UTILITY, UTILITY_SHA), str(UTILITY), "exec"), value.__dict__)
    return value


def previous(base):
    value = json.loads(protected(PREVIOUS, PREVIOUS_SHA))
    need(value["format"] == base.FORMAT and value["completed"] is True and value["fullQuerySha256"] == ORIGINAL_QUERY_SHA and
        value["relationSqlSha256"] == ORIGINAL_RELATION_SHA and value["fullQueryBytes"] == 3558 and value["relationSqlBytes"] == 3133 and
        value["freshCompilationPerformed"] is value["originalMethodCodeIdentityVerified"] is True and
        value["actualQueryExecutionRequested"] is value["explainAnalyzeRequested"] is False and
        value["planAggregate"]["settings"]["workMemKiB"] == 4096 and value["planAggregate"]["settings"]["jit"] == "on",
        "actual_original_compiler_query_and_unmodified_4MiB_settings_ancestry_required")
    return value


def derive(sql, query):
    need(type(sql) is str and sha(sql.encode()) == ORIGINAL_QUERY_SHA and len(sql.encode()) == 3558 and
        query["fullQuerySha256"] == ORIGINAL_QUERY_SHA and query["relationSqlSha256"] == ORIGINAL_RELATION_SHA and
        query["fullQueryBytes"] == 3558 and query["relationSqlBytes"] == 3133 and
        query["originalMethodCodeIdentityVerified"] is True and sql.startswith(PREFIX) and
        sql.count(ORIGINAL_ORDER) == 1 and sql.count(DERIVED_ORDER) == 0,
        "one_actual_original_base_latest_order_fragment_required")
    relation = sql[len(PREFIX):len(PREFIX) + 3133]
    need(sha(relation.encode()) == ORIGINAL_RELATION_SHA and relation.count(ORIGINAL_ORDER) == 1,
        "unique_order_fragment_must_be_inside_the_original_relation")
    derived = sql.replace(ORIGINAL_ORDER, DERIVED_ORDER)
    derived_relation = relation.replace(ORIGINAL_ORDER, DERIVED_ORDER)
    need(derived.count(DERIVED_ORDER) == 1 and derived.count(ORIGINAL_ORDER) == 0 and
        derived.replace(DERIVED_ORDER, ORIGINAL_ORDER) == sql and
        sha(derived.encode()) == DERIVED_QUERY_SHA and sha(derived_relation.encode()) == DERIVED_RELATION_SHA and
        len(derived.encode()) == 3563 and len(derived_relation.encode()) == 3138,
        "only_one_reversible_five_byte_group_direction_change_required")
    return derived, {"originalFullQuerySha256": ORIGINAL_QUERY_SHA, "originalRelationSqlSha256": ORIGINAL_RELATION_SHA,
        "derivedFullQuerySha256": DERIVED_QUERY_SHA, "derivedRelationSqlSha256": DERIVED_RELATION_SHA,
        "originalFullQueryBytes": 3558, "derivedFullQueryBytes": 3563, "originalRelationSqlBytes": 3133, "derivedRelationSqlBytes": 3138,
        "originalCompilerMethodCodeIdentityVerified": True, "exactReversibleTransformCount": 1,
        "groupTokenDirection": "DESC", "chronologicalDirectionsAndPredicateBytesUnchanged": True,
        "derivedSQLIsOriginalQuery": False, "oldQueryIdentityClaimed": False,
        "ambiguousTieWinnerEquivalenceClaimed": False}


def payload(base, sql):
    need(type(sql) is str and sha(sql.encode()) == DERIVED_QUERY_SHA and len(sql.encode()) == 3563 and
        ";" not in sql and "\\" not in sql, "only_the_explicit_new_derived_SELECT_may_run")
    return ("BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;" + base.IDENTITY + ";" + base.SETTINGS + ";" + sql + ";ROLLBACK;").encode()


def observe(base, peer, sql, prior):
    need(not os.path.lexists(peer.SENTINEL), "absent_original_readonly_peer_password_file_required")
    args = ["/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "--no-new-privs", "/usr/bin/env", "-i",
        "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "TZ=UTC", "PGPASSFILE=" + peer.SENTINEL,
        "PGAPPNAME=ypal_publication_token_order_once", "PGOPTIONS=" + peer.READ_OPTIONS,
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
        "stderr": err.decode("utf-8", "replace"), "returncode": process.returncode, "stdoutSha256": sha(out), "stderrSha256": sha(err)})
    need(process.returncode == 0 and not err and 0 < len(out) < 100000 and not os.path.lexists(peer.SENTINEL),
        "bounded_single_derived_SELECT_failed_no_retry")
    identity, settings, result = base.decode_values(out)
    need(identity == {"role": "postgres", "database": "yunipals_backfill", "databaseOid": "17584"} and
        encoded(settings) == encoded(prior["planAggregate"]["settings"]) and settings["workMemKiB"] == 4096 and settings["jit"] == "on" and
        settings["readOnly"] == "on" and settings["statementTimeoutMs"] == 60000 and settings["lockTimeoutMs"] == 1000 and
        settings["idleTransactionTimeoutMs"] == 72000, "original_target_readonly_identity_and_all_settings_unchanged_required")
    need(type(result) is dict and set(result) == {"canonicalRows", "publishedRows", "probe"} and result["probe"] is True and
        type(result["canonicalRows"]) is type(result["publishedRows"]) is int and result["canonicalRows"] == result["publishedRows"] > 0 and
        type(elapsed) is int and elapsed > 0, "fresh_positive_complete_derived_query_counts_and_probe_required")
    return {"result": result, "resultSha256": sha(encoded(result)), "settings": settings,
        "privateTransportSha256": transport_sha, "transportWallNanoseconds": elapsed,
        "stdoutSha256": sha(out), "stdoutBytes": len(out), "stderrBytes": 0, "requestSha256": sha(request)}


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
    need(args == ["--run"], "one_explicit_derived_query_only")
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "root_on_exact_host_required")
    need(not os.path.lexists(AUDIT), "exclusive_new_token_order_audit_required")
    row = AUDIT.parent.lstat()
    need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and not row.st_mode & 0o022, "protected_token_order_audit_parent_required")
    AUDIT.mkdir(mode=0o700); os.chmod(AUDIT, 0o700)
    save("intent.json", {"format": FORMAT, "originalQuerySha256": ORIGINAL_QUERY_SHA, "derivedQuerySha256": DERIVED_QUERY_SHA,
        "oldQueryIdentityClaimed": False, "automaticRetryAllowed": False})
    try:
        base = utility(); prior = previous(base); before = base.snapshot(); peer = base.load_peer()
        original, query = base.compile_query(peer); derived, derivation = derive(original, query)
        observed = observe(base, peer, derived, prior)
        observation_sha = save("query-observation.private.json", observed)
        need(base.snapshot() == before and protected(PREVIOUS, PREVIOUS_SHA) and protected(UTILITY, UTILITY_SHA),
            "all_original_compiler_env_and_receipt_bytes_unchanged_required")
        bookends = save("source-bookends.private.json", before)
        value = {"format": FORMAT, "completed": True, **derivation, "priorEXPLAINSha256": PREVIOUS_SHA,
            "privateObservationSha256": observation_sha, "sourceBookendsSha256": bookends,
            "resultSha256OfCounts": observed["resultSha256"], "baselineResultSha256": BASELINE_RESULT_SHA,
            "baselineResultHashMatches": observed["resultSha256"] == BASELINE_RESULT_SHA, "baselineIsDiagnosticComparisonOnly": True,
            "transportWallNanoseconds": observed["transportWallNanoseconds"], "settings": observed["settings"],
            "allCompilerAndEnvFilesUnchanged": True, "actualCountsKeptPrivate": True, "actualQueryExecutionRequested": True,
            "originalBaselineQueryRepeated": False, "settingsChanged": False, "explainAnalyzeRequested": False,
            "separateSnapshotsCacheAndConcurrentMovementUncontrolled": True, "causalPerformanceQualified": False,
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
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("bounded_single_derived_token_order_query")))
        signal.alarm(140)
    raise SystemExit(main(sys.argv[1:]))
