#!/usr/bin/env python3
"""Compare the temporary and combined native booster datasets without writing.

A common block is supplied with a fresh external canonical header. Different
framework heights are acceptable only when neither dataset has booster events
after that block. No historical state reconstruction or second reducer is used.
This proves data parity, not reader cutover or retirement of the old service.
"""
import argparse
import datetime
import json
from pathlib import Path
import re
import subprocess

LEFT = "yunipals_boosters_launch_v1"
RIGHT = "unified_shadow_20261020_7e7375b0"
BUILDS = {LEFT: "6d581272ce", RIGHT: "bf4939b3ff"}
FLOOR = 52848542
ADDRESSES = (
    "0xeaee2da120a398f21729d50672ac5d1dd71d7274",
    "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609",
    "0x105319be2182018c31fb10b1be198c3cf238a146",
)
TABLES = (
    "booster_type", "booster_original", "booster_request", "booster_monster",
    "booster_refund", "booster_engine_state", "booster_checkpoint", "booster_event",
)


def identifier(value):
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", value):
        raise ValueError("invalid_schema_identifier")
    return '"' + value + '"'


def complete_block(value):
    """Same pinned 0.17.5 offsets as indexer-client/src/ponder.ts."""
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{75}", value):
        raise ValueError("invalid_native_checkpoint")
    if value == "0" * 75:
        return None
    if int(value[10:26]) != 8453:
        raise ValueError("wrong_native_checkpoint_chain")
    end = value[42:58] == "9" * 16 and value[58] == "9" and value[59:] == "9" * 16
    block = int(value[26:42]) - (0 if end else 1)
    return block if block >= 0 else None


def header_witness(document):
    # Accept only an explicit normalized header observation, not RPC result
    # wrappers or a last-domain-event hash relabelled as a scanned block.
    if set(document) != {"chainId", "number", "hash", "timestamp", "observedAt"}:
        raise ValueError("explicit_external_header_observation_required")
    if document["chainId"] != 8453 or type(document["number"]) is not int or document["number"] < FLOOR:
        raise ValueError("wrong_header_chain_or_boundary")
    if not isinstance(document["hash"], str) or not re.fullmatch(r"0x[0-9a-f]{64}", document["hash"]):
        raise ValueError("invalid_header_hash")
    if document["hash"] == "0x" + "0" * 64 or type(document["timestamp"]) is not int:
        raise ValueError("invalid_header_witness")
    observed = datetime.datetime.fromisoformat(document["observedAt"].replace("Z", "+00:00"))
    if observed.utcoffset() is None:
        raise ValueError("header_observation_timezone_required")
    return {**document, "observedAtUnix": observed.timestamp()}


def row_expression(alias, table):
    # Event args are JSON serialized in a text column; object key order is not
    # a semantic difference. Every other field, including block hashes, stays.
    if table == "booster_event":
        return f"(to_jsonb({alias})-'args')||jsonb_build_object('args',{alias}.args::jsonb)"
    return f"to_jsonb({alias})"


def snapshot_sql(left=LEFT, right=RIGHT, boundary=FLOOR):
    if type(boundary) is not int or boundary < FLOOR:
        raise ValueError("invalid_comparison_boundary")
    lhs, rhs = identifier(left), identifier(right)
    schemas = ((left, lhs), (right, rhs))
    headers = []
    for name, quoted in schemas:
        headers.append(f"SELECT jsonb_build_object('schema','{name}',"
                       f"'schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='{name}'),"
                       f"'app',(SELECT value FROM {quoted}._ponder_meta WHERE key='app'),"
                       f"'checkpoint',(SELECT latest_checkpoint FROM {quoted}._ponder_checkpoint WHERE chain_id=8453)) AS value")
    comparisons = []
    for table in TABLES:
        lrow, rrow = row_expression("t", table), row_expression("t", table)
        # The EXCEPT ALL check, counts and sorted SHA256 are independent
        # witnesses, calculated in this same repeatable-read transaction.
        a, b = f"{lhs}.{table}", f"{rhs}.{table}"
        def digest(source, expression):
            return f"(SELECT encode(sha256(convert_to(coalesce(string_agg(({expression})::text,E'\\n' ORDER BY t.id COLLATE \"C\"),''),'UTF8')),'hex') FROM {source} t)"
        def columns(schema):
            return ("(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',a.atttypid,"
                    "'modifier',a.atttypmod,'notNull',a.attnotnull) ORDER BY a.attnum)"
                    " FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid"
                    " JOIN pg_namespace n ON n.oid=c.relnamespace"
                    f" WHERE n.nspname='{schema}' AND c.relname='{table}' AND a.attnum>0 AND NOT a.attisdropped)")
        comparisons.append(f"SELECT jsonb_build_object('table','{table}',"
                           f"'leftColumns',{columns(left)},'rightColumns',{columns(right)},"
                           f"'leftCount',(SELECT count(*) FROM {a}),"
                           f"'rightCount',(SELECT count(*) FROM {b}),"
                           f"'leftSha256',{digest(a, lrow)},'rightSha256',{digest(b, rrow)},"
                           f"'differences',(SELECT count(*) FROM ((SELECT {lrow} AS row FROM {a} t EXCEPT ALL SELECT {rrow} FROM {b} t)"
                           f" UNION ALL (SELECT {rrow} AS row FROM {b} t EXCEPT ALL SELECT {lrow} FROM {a} t)) d)) AS value")
    # The caller first executes header_sql to avoid a large comparison while
    # replay is still behind. Authoritative comparisons repeat their headers.
    allowed = ",".join("'" + address + "'" for address in ADDRESSES)
    tails = [f"'{label}',(SELECT count(*) FROM {quoted}.booster_event WHERE block_number>{boundary})"
             for label, quoted in (("left", lhs), ("right", rhs))]
    unexpected = [f"'{label}',(SELECT count(*) FROM {quoted}.booster_event WHERE lower(address) NOT IN ({allowed}))"
                  for label, quoted in (("left", lhs), ("right", rhs))]
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
            "SET LOCAL statement_timeout='45s'; SET LOCAL lock_timeout='1s';\n"
            "SELECT jsonb_build_object('now',extract(epoch FROM transaction_timestamp()),"
            "'readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),"
            "'sources',(SELECT jsonb_agg(value) FROM (" + " UNION ALL ".join(headers) + ") h),"
            "'tails',jsonb_build_object(" + ",".join(tails) + "),"
            "'unexpectedContracts',jsonb_build_object(" + ",".join(unexpected) + "),"
            "'nativeBoundaryHeader',(SELECT jsonb_build_object('number',block_number,'hash',block_hash,'timestamp',timestamp)"
            f" FROM {rhs}.chain_block WHERE chain_id=8453 AND block_number={boundary}),"
            "'tables',(SELECT jsonb_agg(value) FROM (" + " UNION ALL ".join(comparisons) + ") p));\nROLLBACK;\n")


def header_sql(left=LEFT, right=RIGHT):
    values = []
    for name in (left, right):
        quoted = identifier(name)
        values.append(f"SELECT jsonb_build_object('schema','{name}',"
                      f"'app',(SELECT value FROM {quoted}._ponder_meta WHERE key='app'),"
                      f"'checkpoint',(SELECT latest_checkpoint FROM {quoted}._ponder_checkpoint WHERE chain_id=8453)) AS value")
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s';"
            " SELECT jsonb_build_object('now',extract(epoch FROM transaction_timestamp()),'sources',"
            "(SELECT jsonb_agg(value) FROM (" + " UNION ALL ".join(values) + ") s)); ROLLBACK;")


def source_checks(snapshot, boundary):
    reasons = []
    sources = snapshot.get("sources") or []
    if {row.get("schema") for row in sources} != set(BUILDS) or len(sources) != 2:
        return ["exact_source_pair_required"]
    now = float(snapshot["now"])
    for source in sources:
        name, app = source["schema"], source.get("app") or {}
        if (str(app.get("version")) != "6" or str(app.get("is_dev")) != "0"
                or str(app.get("is_locked")) != "1" or str(app.get("is_ready")) != "1"
                or app.get("build_id") != BUILDS[name]):
            reasons.append(name + ":native_ready_build_required")
        try:
            heartbeat = int(app["heartbeat_at"]) / 1000
            if not 0 <= now - heartbeat <= 180:
                reasons.append(name + ":stale_runtime")
            value = source.get("checkpoint")
            complete = complete_block(value)
            if complete is None or complete < boundary:
                reasons.append(name + ":incomplete_boundary")
            if value != "0" * 75 and not 0 <= now - int(value[:10]) <= 180:
                reasons.append(name + ":stale_checkpoint")
        except (KeyError, TypeError, ValueError):
            reasons.append(name + ":invalid_native_progress")
    return reasons


def assess(snapshot, header):
    witness = header_witness(header)
    reasons = source_checks(snapshot, witness["number"])
    now = float(snapshot["now"])
    if (not 0 <= now - witness["observedAtUnix"] <= 180
            or not 0 <= now - witness["timestamp"] <= 180
            or witness["timestamp"] > witness["observedAtUnix"]):
        reasons.append("fresh_external_canonical_header_required")
    if snapshot.get("readOnly") != "on" or snapshot.get("isolation") != "repeatable read":
        reasons.append("single_readonly_repeatable_snapshot_required")
    if snapshot.get("tails") != {"left": 0, "right": 0}:
        reasons.append("newer_booster_events_require_a_later_boundary")
    if snapshot.get("unexpectedContracts") != {"left": 0, "right": 0}:
        reasons.append("unexpected_booster_contract")
    if snapshot.get("nativeBoundaryHeader") != {key: witness[key] for key in ("number", "hash", "timestamp")}:
        reasons.append("combined_native_header_must_match_external_witness")
    rows = snapshot.get("tables") or []
    if len(rows) != len(TABLES) or {row.get("table") for row in rows} != set(TABLES):
        reasons.append("all_eight_booster_relations_required")
    for row in rows:
        if (row.get("leftCount") != row.get("rightCount") or row.get("differences") != 0
                or row.get("leftSha256") != row.get("rightSha256")
                or not row.get("leftColumns") or row.get("leftColumns") != row.get("rightColumns")
                or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("leftSha256")))):
            reasons.append(str(row.get("table")) + ":state_difference")
    return {"format": "yunipals-booster-common-boundary-parity-v1", "passed": not reasons,
            "reasons": reasons, "canonicalHeader": header, "snapshot": snapshot,
            "databaseWrites": 0, "providerCalls": 0, "serviceActions": 0,
            "provesReaderSwitch": False, "provesTemporarySourceRetirement": False}


def query(sql):
    command = ["/usr/sbin/runuser", "-u", "postgres", "--", "/usr/bin/psql", "-XwqAt",
               "--set=ON_ERROR_STOP=1", "--host=/var/run/postgresql", "--port=5432",
               "--dbname=yunipals_backfill"]
    result = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=55, check=True)
    return json.loads(result.stdout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--header", type=Path, help="Fresh normalized external Base header JSON")
    args = parser.parse_args()
    # The cheap observation never scans NFT ownership rows or prints arguments.
    head = query(header_sql())
    if args.header is None:
        print(json.dumps({"format": "yunipals-booster-parity-preflight-v1", "observation": head,
                          "reasons": source_checks(head, FLOOR), "fullParityClaimed": False,
                          "databaseWrites": 0, "providerCalls": 0, "serviceActions": 0}, sort_keys=True))
        return
    header = json.loads(args.header.read_text())
    witness = header_witness(header)
    reasons = source_checks(head, witness["number"])
    if reasons:
        print(json.dumps({"passed": False, "reasons": reasons, "fullComparisonSkipped": True,
                          "observation": head, "databaseWrites": 0, "providerCalls": 0}, sort_keys=True))
        raise SystemExit(2)
    report = assess(query(snapshot_sql(boundary=witness["number"])), header)
    print(json.dumps(report, sort_keys=True))
    if not report["passed"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
