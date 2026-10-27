"""Inert one-shot timed plan for the unchanged genuine publication SELECT."""
import hashlib
import json
import math
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

FORMAT = "root-genuine-publication-analyze-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
UTILITY = OPS / "ypal-publication-explain-owner-v1.py"
UTILITY_SHA = "eaee00ac1f5a09d7c2b76082220563c882ea4269798113e2ebe0237831bab3e4"
PREVIOUS = Path("/var/backups/yunipals-root-publication-explain-20261026-1/result.json")
PREVIOUS_SHA = "fd53eb603e450e6ee8e9aa9a77929eb36ea883292cdd3659b0cdb5b73adb9ac3"
QUERY_SHA = "c2cce90adcf317aac802226d6e8d203b109bc5e68337d721057f72e8d9603272"
RELATION_SHA = "bc47f8a57a2c0c90df56dd367b1217ee0e44ce9acddfe75c6b2206f7744b40ed"
AUDIT = Path("/var/backups/yunipals-root-publication-analyze-20261026-1")
FRAME = ["st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"]
READ = "yunipals_ownership_4e77f52b_v5"
OWNERSHIP_TABLES = {"token_lifecycle", "transfer_event", "canonical_event", "base_metadata_event", "base_metadata_scan",
    "native_base_metadata_state", "base_metadata_approval"}
PUBLIC_RELATIONS = {
    "metadata": {"token_metadata", "token_publication", "publication_runtime"},
    "metadata_source": {"archive_release"},
    READ: OWNERSHIP_TABLES,
    "unified_ypal_20261023_v1": OWNERSHIP_TABLES
}
PUBLIC_ALIASES = {"p", "a", "r", "published", "document_row", "provenance", "publication_lifecycle",
    "publication_mint", "event", "scan", "base_latest", "latest", "publication_runtime", "active_release",
    "l", "e", "b", "source_boundary", "base_metadata_frame", "frame"}
PUBLIC_INDEXES = {"canonical_event__block_number_transaction_index_log_index_index"}
BUFFER_FIELDS = ["Shared Hit Blocks", "Shared Read Blocks", "Shared Dirtied Blocks", "Shared Written Blocks",
    "Local Hit Blocks", "Local Read Blocks", "Local Dirtied Blocks", "Local Written Blocks", "Temp Read Blocks", "Temp Written Blocks"]
IO_FIELDS = ["I/O Read Time", "I/O Write Time", "Temp I/O Read Time", "Temp I/O Write Time"]
COUNT_FIELDS = ["Workers Planned", "Workers Launched", "Sort Space Used", "Hash Buckets", "Original Hash Buckets",
    "Hash Batches", "Original Hash Batches", "Peak Memory Usage", "HashAgg Batches", "Disk Usage"]
REMOVED_FIELDS = ["Rows Removed by Filter", "Rows Removed by Join Filter", "Rows Removed by Index Recheck"]


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + chr(10)).encode()


def protected(path, digest):
    path = Path(path)
    for part in [*path.parents, path]:
        row = part.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
            "protected_exact_analyze_source_or_prior_receipt_required")
    first = path.lstat()
    need(stat.S_ISREG(first.st_mode) and first.st_nlink == 1 and 0 < first.st_size <= 4000000,
        "bounded_regular_analyze_input_required")
    raw = path.read_bytes(); last = path.lstat()
    need(all(getattr(first, key) == getattr(last, key) for key in FRAME) and len(raw) == first.st_size and sha(raw) == digest,
        "same_exact_analyze_input_bytes_required")
    return raw


def utility():
    value = types.ModuleType("authenticated_genuine_publication_compiler")
    value.__file__ = str(UTILITY)
    exec(compile(protected(UTILITY, UTILITY_SHA), str(UTILITY), "exec"), value.__dict__)
    return value


def previous(base):
    value = json.loads(protected(PREVIOUS, PREVIOUS_SHA))
    need(type(value) is dict and value.get("format") == base.FORMAT and value.get("completed") is True and
        value.get("fullQuerySha256") == QUERY_SHA and value.get("relationSqlSha256") == RELATION_SHA and
        value.get("fullQueryBytes") == 3558 and value.get("relationSqlBytes") == 3133 and
        value.get("originalMethodCodeIdentityVerified") is value.get("freshCompilationPerformed") is True and
        value.get("actualQueryExecutionRequested") is value.get("explainAnalyzeRequested") is False and
        value["planAggregate"]["settings"]["jit"] == "on",
        "actual_nonexecuting_EXPLAIN_and_original_JIT_on_query_ancestry_required")
    return value


def payload(base, sql):
    need(type(sql) is str and sha(sql.encode()) == QUERY_SHA and ";" not in sql and "\\" not in sql,
        "one_exact_unchanged_publication_SELECT_required")
    return ("BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;" + base.IDENTITY + ";" + base.SETTINGS +
        ";EXPLAIN (ANALYZE TRUE,BUFFERS TRUE,VERBOSE TRUE,COSTS TRUE,SETTINGS TRUE,SUMMARY TRUE,FORMAT JSON) " + sql + ";ROLLBACK;").encode()


def observe(base, peer, sql, prior):
    need(not os.path.lexists(peer.SENTINEL), "absent_original_peer_password_file_required")
    args = ["/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "--no-new-privs", "/usr/bin/env", "-i",
        "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "TZ=UTC", "PGPASSFILE=" + peer.SENTINEL,
        "PGAPPNAME=ypal_publication_analyze_once", "PGOPTIONS=" + peer.READ_OPTIONS,
        "/usr/bin/psql", "-XwAtq", "-h", "/var/run/postgresql", "-p", "5432", "-U", "postgres", "-d", "yunipals_backfill", "-v", "ON_ERROR_STOP=1"]
    request = payload(base, sql); started = time.monotonic_ns()
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=peer.CLEAN, cwd="/", start_new_session=True)
    try:
        out, err = process.communicate(request, timeout=80)
    except BaseException:
        try: os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        process.communicate()
        raise
    elapsed = time.monotonic_ns() - started
    need(process.returncode == 0 and not err and 0 < len(out) < 10000000 and not os.path.lexists(peer.SENTINEL),
        "bounded_single_readonly_publication_analyze_failed_no_retry")
    identity, settings, plan = base.decode_values(out)
    need(identity == {"role": "postgres", "database": "yunipals_backfill", "databaseOid": "17584"} and
        encoded(settings) == encoded(prior["planAggregate"]["settings"]) and settings["jit"] == "on" and
        settings["readOnly"] == "on" and settings["statementTimeoutMs"] == 60000 and
        settings["lockTimeoutMs"] == 1000 and settings["idleTransactionTimeoutMs"] == 72000,
        "same_original_readonly_identity_JIT_on_and_all_settings_required")
    return settings, plan, {"transportWallNanoseconds": elapsed, "stdoutSha256": sha(out), "stdoutBytes": len(out),
        "stderrBytes": 0, "requestSha256": sha(request)}


def number(value): return type(value) in {int, float} and math.isfinite(value) and 0 <= value <= 1e30


def identifier(value, allowed):
    if value is None: return None
    need(type(value) is str and len(value.encode()) <= 10000, "bounded_typed_plan_identifier_required")
    if re.fullmatch("[A-Za-z_][A-Za-z0-9_$]{0,127}", value) and value in allowed:
        return {"name": value}
    return {"sha256": sha(value.encode())}


def project(plan, prior):
    need(type(plan) is list and len(plan) == 1 and type(plan[0]) is dict and type(plan[0].get("Plan")) is dict,
        "one_actual_timed_plan_required")
    top = plan[0]
    need(number(top.get("Execution Time")) and not top.get("Triggers"), "actual_SELECT_execution_time_without_write_trigger_evidence_required")
    indexes = set(prior["planAggregate"]["indexNames"]) | PUBLIC_INDEXES
    nodes = []; stack = [(top["Plan"], "0", None, 0)]
    while stack:
        node, path, parent, depth = stack.pop()
        need(len(nodes) < 5000 and depth <= 128 and type(node) is dict and type(node.get("Node Type")) is str and
            re.fullmatch("[A-Za-z][A-Za-z ]{0,79}", node["Node Type"]), "bounded_typed_analyzed_plan_tree_required")
        need(all(type(node.get(key)) is int and node[key] >= 0 for key in ["Plan Rows", "Plan Width"]) and
            all(number(node.get(key)) for key in ["Startup Cost", "Total Cost", "Actual Startup Time", "Actual Total Time", "Actual Rows", "Actual Loops"]),
            "complete_typed_estimated_and_actual_node_metrics_required")
        schema = node.get("Schema"); relation = node.get("Relation Name"); alias = node.get("Alias")
        aliases = {name for name in PUBLIC_ALIASES}
        if type(alias) is str:
            base_alias = re.sub("_[0-9]+$", "", alias)
            if base_alias in PUBLIC_ALIASES: aliases.add(alias)
        subplan = node.get("Subplan Name")
        if type(subplan) is str and re.fullmatch(r"(?:InitPlan [0-9]+ \(returns \$[0-9]+\)|SubPlan [0-9]+)", subplan):
            subplan_value = {"name": subplan}
        else: subplan_value = identifier(subplan, set())
        row = {"path": path, "parentPath": parent, "nodeType": node["Node Type"],
            "parentRelationship": identifier(node.get("Parent Relationship"), {"Outer", "Inner", "Member", "Subquery", "InitPlan", "SubPlan"}),
            "subplan": subplan_value, "joinType": identifier(node.get("Join Type"), {"Inner", "Left", "Right", "Full", "Semi", "Anti"}),
            "schema": identifier(schema, set(PUBLIC_RELATIONS)),
            "relation": identifier(relation, PUBLIC_RELATIONS.get(schema, set()) if type(schema) is str else set()),
            "alias": identifier(alias, aliases), "index": identifier(node.get("Index Name"), indexes),
            "scanDirection": identifier(node.get("Scan Direction"), {"Forward", "Backward", "NoMovement"}),
            "planRows": node["Plan Rows"], "planWidthBytes": node["Plan Width"], "startupCost": node["Startup Cost"], "totalCost": node["Total Cost"],
            "actualStartupMillisecondsPerLoop": node["Actual Startup Time"], "actualTotalMillisecondsPerLoop": node["Actual Total Time"],
            "actualRowsPerLoop": node["Actual Rows"], "actualLoops": node["Actual Loops"], "buffers": {}, "ioMilliseconds": {},
            "otherScalarMetrics": {}, "rowsRemovedPerLoop": {}}
        for key in BUFFER_FIELDS + COUNT_FIELDS:
            if key in node:
                need(type(node[key]) is int and node[key] >= 0, "nonnegative_integer_buffer_or_memory_metric_required")
                row["buffers" if key in BUFFER_FIELDS else "otherScalarMetrics"][key] = node[key]
        for key in IO_FIELDS + REMOVED_FIELDS:
            if key in node:
                need(number(node[key]), "finite_actual_IO_or_removed_row_metric_required")
                row["ioMilliseconds" if key in IO_FIELDS else "rowsRemovedPerLoop"][key] = node[key]
        nodes.append(row)
        children = node.get("Plans", [])
        need(type(children) is list, "typed_actual_child_plan_array_required")
        stack.extend((child, path + "." + str(index), path, depth + 1) for index, child in reversed(list(enumerate(children))))
    jit = top.get("JIT", {}); need(type(jit) is dict, "typed_optional_actual_JIT_object_required")
    jit_summary = {}
    if jit:
        need(type(jit.get("Functions")) is int and jit["Functions"] >= 0 and type(jit.get("Options")) is dict and
            set(jit["Options"]) <= {"Inlining", "Optimization", "Expressions", "Deforming"} and
            all(type(value) is bool for value in jit["Options"].values()), "typed_actual_JIT_functions_and_options_required")
        timings = jit.get("Timing", {})
        need(type(timings) is dict and set(timings) <= {"Generation", "Inlining", "Optimization", "Emission", "Total"} and
            all(number(value) for value in timings.values()), "finite_known_actual_JIT_timing_fields_required")
        jit_summary = {"functions": jit["Functions"], "options": jit["Options"], "milliseconds": timings}
    planning = top.get("Planning Time")
    need(planning is None or number(planning), "finite_optional_actual_planning_time_required")
    return {"nodes": nodes, "nodeCount": len(nodes), "planningMilliseconds": planning, "executionMilliseconds": top["Execution Time"],
        "jit": jit_summary, "nodeTimeIncludesChildrenAndMayOverlap": True, "actualRowsAndTimesArePerLoop": True,
        "parallelWorkerDetailsKeptPrivate": True, "missingBufferFieldsNotInventedAsZero": True,
        "functionInternalPlansMayBeOpaque": True, "rawFiltersOutputsSQLConstantsAndRowsKeptPrivate": True}


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
    need(args == ["--run"], "one_explicit_timed_plan_only")
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "root_on_exact_host_required")
    need(not os.path.lexists(AUDIT), "exclusive_new_timed_plan_audit_required")
    row = AUDIT.parent.lstat()
    need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and not row.st_mode & 0o022, "protected_timed_plan_audit_parent_required")
    AUDIT.mkdir(mode=0o700); os.chmod(AUDIT, 0o700)
    save("intent.json", {"format": FORMAT, "querySha256": QUERY_SHA, "explainAnalyzeRequested": True,
        "buffersRequested": True, "JITOrWorkMemSettingChanged": False, "automaticRetryAllowed": False})
    try:
        base = utility(); prior = previous(base); before = base.snapshot(); peer = base.load_peer(); sql, query = base.compile_query(peer)
        need(query["fullQuerySha256"] == QUERY_SHA and query["relationSqlSha256"] == RELATION_SHA and
            query["fullQueryBytes"] == 3558 and query["relationSqlBytes"] == 3133, "fresh_exact_original_publication_query_required")
        settings, plan, transport = observe(base, peer, sql, prior)
        plan_sha = save("full-plan.private.json", {"settings": settings, "plan": plan, "transport": transport})
        projection = project(plan, prior)
        need(base.snapshot() == before and protected(PREVIOUS, PREVIOUS_SHA) and protected(UTILITY, UTILITY_SHA),
            "all_compiler_env_and_prior_receipt_bytes_unchanged_required")
        bookends = save("source-bookends.private.json", before)
        value = {"format": FORMAT, "completed": True, **query, "priorEXPLAINSha256": PREVIOUS_SHA,
            "fullPlanPrivateSha256": plan_sha, "sourceBookendsSha256": bookends, "settings": settings,
            "planProjection": projection, "transport": transport, "actualQueryExecutionRequested": True,
            "explainAnalyzeRequested": True, "buffersRequested": True, "JITOrWorkMemSettingChanged": False,
            "allCompilerAndEnvFilesUnchanged": True, "freshCompilationPerformed": True,
            "newCurrentAuthority": False, "newHeldQualification": False, "causalPerformanceQualified": False,
            "databaseMutationsRequested": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0, "automaticRetryAllowed": False}
        digest = save("result.json", value); print(json.dumps({**value, "resultSha256": digest}, sort_keys=True)); return 0
    except BaseException as error:
        try: save("failure.json", {"format": FORMAT, "completed": False, "failureType": type(error).__name__,
            "failureSha256": sha(str(error).encode()), "automaticRetryAllowed": False, "newCurrentAuthority": False})
        except Exception: pass
        raise


if __name__ == "__main__":
    if sys.argv[1:]:
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("bounded_original_readonly_timed_plan")))
        signal.alarm(140)
    raise SystemExit(main(sys.argv[1:]))
