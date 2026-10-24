#!/usr/bin/env python3
"""Fixed-prefix parity for the fresh and combined YPAL native booster sources.

No provider client, writer, service action or historical-state reconstruction.
Current framework readiness is deliberately separate from this fixed-prefix proof.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import time

FORMAT = "yunipals-ypal-booster-source-parity-v1"
PLAN_FORMAT = "yunipals-ypal-booster-source-parity-plan-v1"
BASE = Path("/var/backups/yunipals-ypal-booster-source-parity-v1-20261024")
LEFT = "yunipals_boosters_ypal_v1"
RIGHT = "unified_ypal_20261023_v1"
FLOOR = 53000661
TABLES = ("booster_type", "booster_original", "booster_request", "booster_monster",
          "booster_refund", "booster_engine_state", "booster_checkpoint", "booster_event")
SCHEMAS = {LEFT: {"oid": "75837058", "build": "8e88ea2e00"},
           RIGHT: {"oid": "75963410", "build": "71e2a7f3b7"}}
RELEASE = "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3"
MANIFEST = "0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112"
FRESH_MANIFEST = "0x83262c45a53f94ed561c6116fc9efeccf69bd55839e7296f7f5276bc7c89e9ac"
READ_SCHEMA = "yunipals_ownership_4e77f52b_v4"
READ_OID = "75994954"
READ_ID = "0xcac869bf65116323b9e1e8e539d999964ad740ab1e4194be0a335ce624c5ea67"
REGISTRY = "0x39a766a2a5ab6421929bcdc317b7b31f97d8e7e3"
ENGINE = "0xdf4aaa47fe0e8208b5a33c74898f834b2952189e"
MONSTERS = "0x7d62628806e7eef76a354c7c48787879e3440b16"
YPAL = "0xcd3709e84fc817b46196fa2d5b7202710ab51346"
WRAPPER = "0xb0407dbe851f8318bd31404a49e658143c982f23"
ADDRESSES = (REGISTRY, ENGINE, MONSTERS)
INPUT_HASHES = {
    "deployment": "3249c24a567f611cf7276776668825bf28ced27902c9d3804dc0b5c33acf394c",
    "combinedProfile": "c77235fd2729cf2676cd0e038c33fa33014f87e1ef12c0f2ab3f3b35be45631b",
    "freshProfile": "0e19f87a728a0150fae82e6125436739864edd86a6b5b1ecdfcd3503e70e0e05"
}
SOURCE_DEFINITIONS = [{'id': 'boosters:boosterengine', 'feature': 'boosters', 'chainId': 8453, 'contractName': 'BoosterEngine', 'address': '0xdf4aaa47fe0e8208b5a33c74898f834b2952189e', 'startBlock': '52995174', 'endBlock': None, 'enabled': True, 'abiHash': '0x4127c2493eff266363adae3bb24fcf53038b7da4d72af5f517600e2a7920635d', 'events': ['BlockhashCheckpointed', 'Initialized', 'OriginalRevealed', 'PaymentBurned', 'ProofContextRecorded', 'RandomnessReceived', 'RandomnessRestored', 'RecoveryRequired', 'RefundCredited', 'RefundReturned', 'RefundWithdrawn', 'RequestCompleted', 'RequestCreated', 'RequestForfeited', 'RequestsPaused', 'RoleAdminChanged', 'RoleGranted', 'RoleRevoked', 'Upgraded'], 'receiptRequirement': 'none', 'policies': [{'kind': 'latest'}, {'kind': 'finalized'}]}, {'id': 'boosters:boostermonsters', 'feature': 'boosters', 'chainId': 8453, 'contractName': 'BoosterMonsters', 'address': '0x7d62628806e7eef76a354c7c48787879e3440b16', 'startBlock': '52995029', 'endBlock': None, 'enabled': True, 'abiHash': '0x680148b00be6884d25a426041f93861ac175dfe3535224636c46cdcb3daa3a94', 'events': ['Approval', 'ApprovalForAll', 'Initialized', 'MonsterMinted', 'OriginalBurned', 'RoleAdminChanged', 'RoleGranted', 'RoleRevoked', 'Transfer', 'Upgraded'], 'receiptRequirement': 'none', 'policies': [{'kind': 'latest'}, {'kind': 'finalized'}]}, {'id': 'boosters:boosterregistry', 'feature': 'boosters', 'chainId': 8453, 'contractName': 'BoosterRegistry', 'address': '0x39a766a2a5ab6421929bcdc317b7b31f97d8e7e3', 'startBlock': '52995007', 'endBlock': None, 'enabled': True, 'abiHash': '0xadfe0b475fd8d3f48aa768e359b6112834f3048a297263baaa01db4fbea8a79d', 'events': ['Initialized', 'RoleAdminChanged', 'RoleGranted', 'RoleRevoked', 'SalesPaused', 'TypeActivated', 'TypeConfigured', 'Upgraded'], 'receiptRequirement': 'none', 'policies': [{'kind': 'latest'}, {'kind': 'finalized'}]}]
SOURCE_UNITS = ("yunipals-booster-ypal-source.service", "yunipals-ypal-combined-source.service")
CLEAN = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}
APPLICATION_NAME = "ypal_booster_source_parity_v1"
PASSWORD_SENTINEL = "/run/yunipals-ypal-booster-parity-no-password-file"
MAX_ROWS = 50000
RESERVE = 27 * 1024**3
# Exact native Ponder columns, including numeric(78,0), nullability and order.
COLUMN_FIELDS = {
 "booster_type": "id:t pack_type_id:t registry:t engine:t payment_token:t price:t interval_seconds:n mints_per_interval:n total_variants:n max_batch:i catalog_hash:t rule_hash:t manifest_uri:t metadata_base_uri:t sales_paused:b openings:n",
 "booster_original": "id:t collection:t token_id:t type_key:t engine:t owner:t revealed_at:n? daily_committed:n minted:n remaining:n pending_request:t? burned:b",
 "booster_request": "id:t engine:t wrapper:t request_id:t original_key:t payer:t quantity:i opening:b paid:t rule_hash:t callback_gas:i status:t seed:t? requested_at:n received_at:n? transaction_hash:t recipient:t?",
 "booster_monster": "id:t collection:t token_id:t original_key:t request_key:t type_key:t owner:t minted_to:t variant_id:n monster_type:n color:n horn:n glitter:n is_original:b burned:b mint_block:n",
 "booster_refund": "id:t engine:t requester:t credit:n returned:n withdrawn:n",
 "booster_engine_state": "id:t paused:b",
 "booster_checkpoint": "id:t block_number:n block_hash:t timestamp:n",
 "booster_event": "id:t address:t name:t args:t block_number:n block_hash:t timestamp:n transaction_hash:t log_index:i"
}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def capture_path(capture_id):
    need(isinstance(capture_id, str) and re.fullmatch(r"[a-z][a-z0-9-]{0,47}", capture_id), "bounded_explicit_capture_id_required")
    return BASE / "captures" / capture_id / "result.json"


def columns(table):
    types = {"t": "25", "n": "1700", "i": "23", "b": "16"}
    return [{"name": name, "type": types[kind[0]], "modifier": 5111812 if kind[0] == "n" else -1,
             "notNull": not kind.endswith("?")} for name, kind in
            (field.split(":") for field in COLUMN_FIELDS[table].split())]


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


def row_expression(alias, table):
    # Original comparison semantics: JSON object key order in text args is not
    # a difference; all other fields, including journal block hashes, remain.
    if table == "booster_event":
        return f"(to_jsonb({alias})-'args')||jsonb_build_object('args',{alias}.args::jsonb)"
    return f"to_jsonb({alias})"


def boundary_number(boundary):
    need(type(boundary) is int and FLOOR <= boundary < 2**63, "bounded_ypal_comparison_boundary_required")
    return boundary


def context_sql(boundary):
    boundary_number(boundary)
    sources = []
    for schema in (LEFT, RIGHT):
        q = identifier(schema)
        catalogs = []
        for table in TABLES:
            catalogs.append(f"SELECT '{table}'AS name,c.oid::text,c.relkind::text,"
                "(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',a.atttypid::text,"
                "'modifier',a.atttypmod,'notNull',a.attnotnull)ORDER BY a.attnum)FROM pg_attribute a"
                " WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)AS columns"
                f" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='{schema}'AND c.relname='{table}'")
        sources.append(f"SELECT jsonb_build_object('schema','{schema}','schemaOid',"
            f"(SELECT oid::text FROM pg_namespace WHERE nspname='{schema}'),'app',"
            f"(SELECT value FROM {q}._ponder_meta WHERE key='app'),'checkpoint',"
            f"(SELECT latest_checkpoint FROM {q}._ponder_checkpoint WHERE chain_id=8453),"
            f"'eventCount',(SELECT count(*)FROM {q}.booster_event),'lastEvent',(SELECT max(block_number)FROM {q}.booster_event),"
            f"'tail',(SELECT count(*)FROM {q}.booster_event WHERE block_number>{boundary}),"
            "'relations',(SELECT jsonb_agg(to_jsonb(r)ORDER BY name)FROM(" + " UNION ALL ".join(catalogs) + ")r),"
            "'counts',jsonb_build_object(" + ",".join(f"'{t}',(SELECT count(*)FROM {q}.{t})" for t in TABLES) + "))AS value")
    return ("SELECT jsonb_build_object('now',extract(epoch FROM transaction_timestamp()),"
        "'database',(SELECT oid::text FROM pg_database WHERE datname=current_database()),"
        "'databaseName',current_database(),'role',current_user,'sessionRole',session_user,"
        "'unix',inet_client_addr()IS NULL,'port',current_setting('port'),'snapshot',pg_current_snapshot()::text,"
        "'readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),"
        "'sources',(SELECT jsonb_agg(value)FROM(" + " UNION ALL ".join(sources) + ")s),"
        "'release',(SELECT jsonb_build_object('id',id,'schema',physical_schema,'build',build_id,'manifestHash',manifest_hash)"
        f" FROM yunipals_indexer_control.release WHERE id='{RELEASE}'),"
        f"'marker',(SELECT jsonb_build_object('schemaOid','{READ_SCHEMA}'::regnamespace::oid::text,'releaseId',release_id,"
        f"'identity',identity,'manifestHash',manifest_hash)FROM {READ_SCHEMA}._unified_read_release WHERE singleton),"
        f"'definitions',(SELECT jsonb_agg(jsonb_build_object('id',id,'chainId',chain_id,'manifestHash',manifest_hash,"
        f"'definition',definition::jsonb)ORDER BY id)FROM {RIGHT}.indexer_source WHERE id LIKE 'boosters:%'),"
        "'nativeBoundaryHeaders',(SELECT coalesce(jsonb_agg(jsonb_build_object('number',block_number,'hash',block_hash,"
        f"'parentHash',parent_hash,'timestamp',timestamp)),'[]'::jsonb)FROM {RIGHT}.chain_block WHERE chain_id=8453 AND block_number={boundary}))")


def prefix():
    return ("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
        "SET LOCAL statement_timeout='45s';SET LOCAL lock_timeout='1s';"
        "SET LOCAL idle_in_transaction_session_timeout='15s';SET LOCAL work_mem='8MB';"
        "SET LOCAL temp_file_limit='512MB';SET LOCAL max_parallel_workers_per_gather=0;\n")


def preflight_sql(boundary):
    return prefix() + context_sql(boundary) + ";\nROLLBACK;\n"


def guard_sql(boundary):
    # This SQL guard runs in the authoritative RR snapshot BEFORE comparison.
    checks = ["f->>'database'='17584'", "f->>'databaseName'='yunipals_backfill'", "f->>'role'='postgres'",
        "f->>'sessionRole'='postgres'", "(f->>'unix')::boolean", "f->>'port'='5432'",
        "f->'release'=" + "'" + json.dumps({"id": RELEASE, "schema": RIGHT, "build": SCHEMAS[RIGHT]["build"], "manifestHash": MANIFEST}) + "'::jsonb",
        "f->'marker'=" + "'" + json.dumps({"schemaOid": READ_OID, "releaseId": RELEASE, "identity": READ_ID, "manifestHash": MANIFEST}) + "'::jsonb"]
    expected = [{"id": s["id"], "chainId": 8453, "manifestHash": MANIFEST, "definition": s} for s in SOURCE_DEFINITIONS]
    checks.append("f->'definitions'='" + json.dumps(expected) + "'::jsonb")
    body = """DECLARE f jsonb;s jsonb;v text;BEGIN
 """ + context_sql(boundary) + " INTO f;\n IF NOT coalesce((" + " AND ".join(checks) + "),false)THEN RAISE EXCEPTION 'exact_ypal_source_peer_context_required';END IF;\n"
    body += "IF jsonb_array_length(f->'sources')<>2 THEN RAISE EXCEPTION 'exact_ypal_source_pair_required';END IF;\n"
    for schema, spec in SCHEMAS.items():
        body += "SELECT x INTO s FROM jsonb_array_elements(f->'sources')x WHERE x->>'schema'='" + schema + "';\n"
        body += ("IF NOT coalesce((s->>'schemaOid'='" + spec["oid"] + "' AND s->'app'->>'version'='6'"
            " AND s->'app'->>'build_id'='" + spec["build"] + "' AND s->'app'->>'is_dev'='0'"
            " AND s->'app'->>'is_locked'='1' AND s->'app'->>'is_ready'IN('0','1')"
            " AND (f->>'now')::numeric-(s->'app'->>'heartbeat_at')::numeric/1000 BETWEEN 0 AND 180),false)"
            " THEN RAISE EXCEPTION 'live_exact_ypal_build_required';END IF;\n")
        body += ("v:=s->>'checkpoint';IF v IS NULL OR v!~'^[0-9]{75}$' OR v=repeat('0',75)"
            " THEN RAISE EXCEPTION 'complete_Base_boundary_required';END IF;\n"
            "IF (substring(v,11,16)::numeric<>8453 OR substring(v,27,16)::numeric-(CASE WHEN right(v,33)=repeat('9',33)THEN 0 ELSE 1 END)<" + str(boundary) + ") THEN RAISE EXCEPTION 'complete_Base_boundary_required';END IF;\n"
            "IF NOT coalesce(((s->>'tail')::bigint=0 AND (s->>'lastEvent')::bigint BETWEEN " + str(FLOOR) + " AND " + str(boundary) + "),false) THEN RAISE EXCEPTION 'no_future_feature_tail_and_known_mint_required';END IF;\n")
        for table in TABLES:
            body += "IF NOT coalesce(((s->'counts'->>'" + table + "')::bigint BETWEEN 0 AND " + str(MAX_ROWS) + "),false)THEN RAISE EXCEPTION 'bounded_full_table_capture_required';END IF;\n"
        for table in ("booster_type", "booster_original", "booster_request", "booster_monster", "booster_event"):
            body += "IF NOT coalesce(((s->'counts'->>'" + table + "')::bigint>0),false)THEN RAISE EXCEPTION 'nonempty_ypal_mint_required';END IF;\n"
        expected_relations = [{"name": table, "relkind": "r", "columns": columns(table)} for table in sorted(TABLES)]
        body += "IF (SELECT jsonb_agg(x-'oid'ORDER BY x->>'name')FROM jsonb_array_elements(s->'relations')x)IS DISTINCT FROM '" + json.dumps(expected_relations) + "'::jsonb THEN RAISE EXCEPTION 'exact_native_booster_columns_required';END IF;\n"
    return "DO $ypal_parity_guard$ " + body + "END $ypal_parity_guard$;\n"


def comparisons_sql():
    comparisons = []
    for table in TABLES:
        a, b = f'{identifier(LEFT)}.{table}', f'{identifier(RIGHT)}.{table}'
        row = row_expression("t", table)
        def digest(source):
            return ("(SELECT encode(sha256(convert_to(coalesce(string_agg((" + row + ")::text,E'\\n'"
                "ORDER BY t.id COLLATE \"C\"),''),'UTF8')),'hex')FROM " + source + " t)")
        comparisons.append(f"SELECT jsonb_build_object('table','{table}','leftCount',(SELECT count(*)FROM {a}),"
            f"'rightCount',(SELECT count(*)FROM {b}),'leftSha256',{digest(a)},'rightSha256',{digest(b)},"
            f"'differences',(SELECT count(*)FROM((SELECT {row} AS row FROM {a} t EXCEPT ALL SELECT {row} FROM {b} t)"
            f"UNION ALL(SELECT {row} AS row FROM {b} t EXCEPT ALL SELECT {row} FROM {a} t))d))AS value")
    return "SELECT jsonb_agg(value ORDER BY value->>'table')FROM(" + " UNION ALL ".join(comparisons) + ")p"


def unexpected_sql():
    checks = {
        "booster_type": f"registry<>'{REGISTRY}'OR engine<>'{ENGINE}'OR payment_token<>'{YPAL}'",
        "booster_original": f"collection<>'{MONSTERS}'OR engine<>'{ENGINE}'",
        "booster_request": f"engine<>'{ENGINE}'OR wrapper<>'{WRAPPER}'",
        "booster_monster": f"collection<>'{MONSTERS}'",
        "booster_refund": f"engine<>'{ENGINE}'",
        "booster_engine_state": f"id<>'{ENGINE}'",
        "booster_checkpoint": "id<>'8453'",
        "booster_event": "address NOT IN(" + ",".join("'" + address + "'" for address in ADDRESSES) + ")"
    }
    return "SELECT jsonb_build_object(" + ",".join("'" + label + "',(SELECT sum(n)FROM(" + " UNION ALL ".join(
        "SELECT count(*)AS n FROM " + identifier(schema) + "." + table + " WHERE " + check for table, check in checks.items()) + ")s)" for label, schema in [("left", LEFT), ("right", RIGHT)]) + ")"


def snapshot_sql(boundary):
    return (prefix() + guard_sql(boundary) + context_sql(boundary) + ";\n" + comparisons_sql() + ";\n" + unexpected_sql() + ";\nROLLBACK;\n")


def source_checks(frame, boundary):
    reasons = []
    if (frame.get("database"), frame.get("databaseName"), frame.get("role"), frame.get("sessionRole"), frame.get("unix"), frame.get("port")) != ("17584", "yunipals_backfill", "postgres", "postgres", True, "5432"):
        reasons.append("exact_postgres_peer_database_required")
    if frame.get("readOnly") != "on" or frame.get("isolation") != "repeatable read" or not frame.get("snapshot"):
        reasons.append("single_readonly_repeatable_snapshot_required")
    if frame.get("release") != {"id": RELEASE, "schema": RIGHT, "build": SCHEMAS[RIGHT]["build"], "manifestHash": MANIFEST}:
        reasons.append("exact_combined_release_required")
    if frame.get("marker") != {"schemaOid": READ_OID, "releaseId": RELEASE, "identity": READ_ID, "manifestHash": MANIFEST}:
        reasons.append("exact_combined_read_marker_required")
    expected = [{"id": s["id"], "chainId": 8453, "manifestHash": MANIFEST, "definition": s} for s in SOURCE_DEFINITIONS]
    if frame.get("definitions") != expected:
        reasons.append("exact_three_ypal_source_definitions_required")
    sources = frame.get("sources") or []
    if len(sources) != 2 or {s.get("schema") for s in sources} != set(SCHEMAS):
        return reasons + ["exact_ypal_source_pair_required"]
    for source in sources:
        name, app = source["schema"], source.get("app") or {}
        if (source.get("schemaOid") != SCHEMAS[name]["oid"] or str(app.get("version")) != "6"
            or app.get("build_id") != SCHEMAS[name]["build"] or str(app.get("is_dev")) != "0"
            or str(app.get("is_locked")) != "1" or str(app.get("is_ready")) not in {"0", "1"}):
            reasons.append(name + ":exact_live_native_build_required")
        try:
            if not 0 <= float(frame["now"]) - int(app["heartbeat_at"]) / 1000 <= 180:
                reasons.append(name + ":stale_runtime")
            complete = complete_block(source.get("checkpoint"))
            if complete is None or complete < boundary:
                reasons.append(name + ":incomplete_boundary")
            # A fixed historical prefix does not require a fresh checkpoint
            # timestamp or multichain frameworkReady; report those separately.
            if source.get("tail") != 0 or type(source.get("lastEvent")) is not int or not FLOOR <= source["lastEvent"] <= boundary:
                reasons.append(name + ":newer_or_missing_feature_events")
            if set(source.get("counts", {})) != set(TABLES) or any(type(n) is not int or not 0 <= n <= MAX_ROWS for n in source["counts"].values()):
                reasons.append(name + ":bounded_all_eight_counts_required")
            if any(source["counts"].get(t, 0) < 1 for t in ("booster_type", "booster_original", "booster_request", "booster_monster", "booster_event")):
                reasons.append(name + ":nonempty_minted_ypal_state_required")
        except (KeyError, TypeError, ValueError):
            reasons.append(name + ":invalid_native_progress")
        relations = source.get("relations") or []
        if len(relations) != 8 or {r.get("name") for r in relations} != set(TABLES):
            reasons.append(name + ":all_eight_native_relations_required")
        for row in relations:
            if (row.get("name") not in TABLES or row.get("relkind") != "r" or not re.fullmatch(r"[1-9][0-9]*", str(row.get("oid")))
                or row.get("columns") != columns(row["name"])):
                reasons.append(name + ":exact_native_relation_columns_required")
    return reasons


def header_witness(document, now, boundary):
    need(set(document) == {"format", "chainId", "number", "hash", "parentHash", "timestamp", "observedAt", "latest", "finalized", "repeatedBoundary"}
         and document["format"] == "yunipals-base-canonical-header-v1" and document["chainId"] == 8453
         and document["number"] == boundary, "explicit_Base_canonical_header_required")
    observed = datetime.datetime.fromisoformat(document["observedAt"].replace("Z", "+00:00"))
    need(observed.utcoffset() is not None and 0 <= now - observed.timestamp() <= 180, "fresh_canonical_observation_required")
    finalized, latest = document["finalized"], document["latest"]
    need(isinstance(finalized, dict) and set(finalized) == {"number", "hash", "parentHash", "timestamp"}, "explicit_finalized_anchor_required")
    need(isinstance(latest, dict) and set(latest) == set(finalized), "explicit_latest_anchor_required")
    need(document["repeatedBoundary"] == {k: document[k] for k in finalized}, "repeated_canonical_boundary_required")
    for point in (document, finalized, latest):
        need(type(point["number"]) is int and point["number"] >= FLOOR and type(point["timestamp"]) is int
             and 0 < point["timestamp"] <= observed.timestamp(), "valid_canonical_header_fields_required")
        for key in ("hash", "parentHash"):
            need(isinstance(point[key], str) and re.fullmatch(r"0x[0-9a-f]{64}", point[key]) and point[key] != "0x" + "0" * 64,
                 "valid_canonical_header_hash_required")
    need(latest["number"] >= finalized["number"] >= boundary and latest["timestamp"] >= finalized["timestamp"]
         and 0 <= now - latest["timestamp"] <= 180, "fresh_latest_and_finalized_boundary_coverage_required")
    if latest["number"] == finalized["number"]:
        need(latest == finalized, "same_height_finalized_latest_required")
    if finalized["number"] == boundary:
        need(all(finalized[k] == document[k] for k in finalized), "same_height_canonical_header_required")
    need(finalized["timestamp"] >= document["timestamp"], "ordered_canonical_timestamps_required")
    return {k: document[k] for k in ("number", "hash", "parentHash", "timestamp")}


def data_checks(frame, comparisons, unexpected, boundary):
    reasons = source_checks(frame, boundary)
    rows = comparisons or []
    if len(rows) != 8 or {r.get("table") for r in rows} != set(TABLES):
        reasons.append("all_eight_booster_relations_required")
    counts = {s.get("schema"): s.get("counts", {}) for s in frame.get("sources", [])}
    for row in rows:
        if (type(row.get("leftCount")) is not int or not 0 <= row["leftCount"] <= MAX_ROWS
            or row.get("leftCount") != counts.get(LEFT, {}).get(row.get("table"))
            or row.get("rightCount") != counts.get(RIGHT, {}).get(row.get("table"))
            or row.get("leftCount") != row.get("rightCount") or type(row.get("differences")) is not int or row.get("differences") != 0
            or row.get("leftSha256") != row.get("rightSha256") or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("leftSha256")))):
            reasons.append(str(row.get("table")) + ":state_difference")
    if unexpected != {"left": 0, "right": 0}:
        reasons.append("unexpected_ypal_state_identity")
    return reasons


def assess(frame, comparisons, unexpected, header, boundary):
    reasons = data_checks(frame, comparisons, unexpected, boundary)
    rows = comparisons or []
    data_reasons = list(reasons)
    try:
        witness = header_witness(header, float(frame["now"]), boundary)
        if frame.get("nativeBoundaryHeaders") != [witness]:
            reasons.append("combined_native_header_must_match_canonical_witness")
    except (RuntimeError, ValueError, KeyError, TypeError):
        reasons.append("fresh_canonical_header_and_finalized_anchor_required")
    return {"exactDataParity": not data_reasons, "canonicalQualifiedAtCapture": not reasons,
            "allEightRelations": len(rows) == 8 and {r.get("table") for r in rows} == set(TABLES),
            "reasons": reasons, "currentReadinessQualified": False, "provesReaderSwitch": False,
            "provesTemporarySourceRetirement": False}


def protected(path, cap=20000):
    path = Path(path)
    need(path.is_absolute(), "absolute_protected_input_required")
    for entry in [path, *path.parents]:
        info = entry.lstat()
        need(info.st_uid == 0 and not stat.S_ISLNK(info.st_mode) and not info.st_mode & 0o022, "protected_unredirected_inputs_required")
    info = path.stat()
    need(stat.S_ISREG(info.st_mode) and info.st_size <= cap, "bounded_regular_input_required")
    before = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    raw = path.read_bytes(); after = path.stat()
    need(before == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), "input_changed_during_read")
    return raw


def command(args, data=None, timeout=10):
    process = subprocess.Popen(args, text=True, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env=CLEAN, cwd="/", start_new_session=True)
    try:
        out, err = process.communicate(data, timeout=timeout)
    except subprocess.TimeoutExpired:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(process.pid, sig)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=2)
                break
            except subprocess.TimeoutExpired:
                continue
        else:
            raise RuntimeError("reader_group_termination_unknown_inspect_only")
        raise RuntimeError("bounded_parity_timeout_inspect_only")
    if process.returncode or err or len(out) > 128000:
        codes = re.findall(r"ERROR:\s+([A-Z0-9]{5})", err)
        raise RuntimeError("bounded_parity_command_failed_sqlstate_" + (codes[0] if len(codes) == 1 else "unknown"))
    return out


def actors():
    result = {}
    for unit in SOURCE_UNITS:
        raw = command(["/usr/bin/systemctl", "show", unit,
            "--property=ActiveState,SubState,MainPID,InvocationID,ExecMainStartTimestampMonotonic"])
        fields = dict(line.split("=", 1) for line in raw.splitlines())
        need(fields.get("ActiveState") == "active" and fields.get("SubState") == "running"
             and re.fullmatch("[1-9][0-9]*", fields.get("MainPID", "")) and re.fullmatch("[0-9a-f]{32}", fields.get("InvocationID", "")),
             "both_fixed_native_sources_must_be_running")
        raw = (Path("/proc") / fields["MainPID"] / "stat").read_bytes()
        fields["startTicks"] = int(raw[raw.rfind(b")") + 2:].split()[19])
        result[unit] = fields
    valid_actors(result)
    return result


def valid_actors(value):
    need(isinstance(value, dict) and set(value) == set(SOURCE_UNITS), "both_fixed_source_handles_required")
    for actor in value.values():
        need(set(actor) == {"ActiveState", "SubState", "MainPID", "InvocationID", "ExecMainStartTimestampMonotonic", "startTicks"}
             and actor["ActiveState"] == "active" and actor["SubState"] == "running"
             and re.fullmatch("[1-9][0-9]*", actor["MainPID"])
             and re.fullmatch("[0-9a-f]{32}", actor["InvocationID"])
             and re.fullmatch("[1-9][0-9]*", actor["ExecMainStartTimestampMonotonic"])
             and type(actor["startTicks"]) is int and actor["startTicks"] > 0, "exact_live_source_handle_required")


def query(sql):
    need(not os.path.lexists(PASSWORD_SENTINEL), "absent_peer_password_sentinel_required")
    args = ["/usr/sbin/runuser", "-u", "postgres", "--", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin",
            "LANG=C.UTF-8", "PGHOST=/var/run/postgresql", "PGPORT=5432", "PGUSER=postgres", "PGDATABASE=yunipals_backfill",
            "PGAPPNAME=" + APPLICATION_NAME, "PGPASSFILE=" + PASSWORD_SENTINEL,
            "/usr/bin/psql", "-w", "-XqAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"]
    return [json.loads(line) for line in command(args, sql, 150).splitlines()]


def review(plan_path):
    need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "exact_host_required")
    raw = protected(plan_path); plan = json.loads(raw)
    need(set(plan) == {"format", "captureId", "boundary", "deployment", "freshProfile", "combinedProfile", "header", "output"}
         and plan["format"] == PLAN_FORMAT and plan["output"] == str(capture_path(plan["captureId"])), "exact_fixed_parity_plan_required")
    boundary_number(plan["boundary"])
    for key, pin in INPUT_HASHES.items():
        need(sha(protected(plan[key])) == pin, "exact_public_" + key + "_input_required")
    deployment = json.loads(protected(plan["deployment"]))
    need(all(deployment[k].lower() == v for k, v in {"registry": REGISTRY, "engine": ENGINE, "monsters": MONSTERS, "ypal": YPAL}.items()),
         "confirmed_fresh_ypal_contracts_required")
    output = capture_path(plan["captureId"])
    need(not os.path.lexists(output.parent), "exclusive_new_capture_operation_required")
    for path in [output.parent.parent, *output.parent.parent.parents]:
        info = path.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, "protected_private_output_directory_required")
    need(all(stat.S_IMODE(path.stat().st_mode) == 0o700 for path in (BASE, BASE / "captures")), "private_capture_parents_0700_required")
    disk = os.statvfs("/var/lib/postgresql"); free_bytes = disk.f_bavail * disk.f_frsize
    need(free_bytes >= RESERVE, "comparison_disk_reserve_required")
    header = None
    if plan["header"] is not None:
        need(isinstance(plan["header"], dict) and set(plan["header"]) == {"file", "sha256"}, "exact_header_reference_required")
        hraw = protected(plan["header"]["file"])
        need(sha(hraw) == plan["header"]["sha256"], "exact_canonical_header_bytes_required")
        header = json.loads(hraw)
        header_witness(header, time.time(), plan["boundary"])
    binding = {"format": FORMAT, "planSha256": sha(raw), "plan": plan, "producerSha256": sha(Path(__file__).read_bytes()),
        "sqlSha256": sha(snapshot_sql(plan["boundary"]).encode()), "inputs": INPUT_HASHES,
        "providerCalls": 0, "databaseWrites": 0, "serviceActions": 0}
    return {"binding": binding, "reviewHash": sha(encoded(binding)), "header": header, "freeBytes": free_bytes}


def validate_receipt(value):
    need(value.get("format") == FORMAT and value.get("completed") is True
         and value.get("producerSha256") == sha(Path(__file__).read_bytes())
         and value.get("inputSha256") == INPUT_HASHES and value.get("sqlSha256") == sha(snapshot_sql(value["boundary"]).encode()),
         "exact_ypal_parity_receipt_producer_required")
    need(value.get("reportFile") == str(capture_path(value.get("captureId"))), "exact_named_capture_path_required")
    proof = assess(value["frame"], value["tables"], value["unexpected"], value["canonicalHeader"], value["boundary"])
    need(proof == value["qualification"] and proof["exactDataParity"] and proof["canonicalQualifiedAtCapture"],
         "all_eight_exact_ypal_state_and_canonical_capture_required")
    valid_actors(value.get("actorsBefore")); valid_actors(value.get("actorsAfter"))
    need(value.get("actorsBefore") == value.get("actorsAfter"), "same_both_source_handles_required")
    need(all(value.get(k) == 0 for k in ("databaseWrites", "providerCalls", "serviceActions")), "read_only_capture_receipt_required")
    return {"validated": True, "format": FORMAT, "boundary": value["boundary"], **proof,
            "sourceRelease": RELEASE, "readIdentity": READ_ID, "databaseWrites": 0, "providerCalls": 0}


def validate_current_prefix(result_sha, canonical_header, capture_id):
    """Current DB prefix only; never refresh an old external observation."""
    need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "exact_host_required")
    need(isinstance(result_sha, str) and re.fullmatch("[0-9a-f]{64}", result_sha), "actual_parity_result_hash_required")
    raw = protected(capture_path(capture_id), 128000)
    need(sha(raw) == result_sha, "exact_immutable_parity_result_required")
    value = json.loads(raw); proof = validate_receipt(value)
    need(value["captureId"] == capture_id, "same_acknowledged_capture_id_required")
    before = actors()
    need(before == value["actorsAfter"], "acknowledged_both_source_handles_required")
    rows = query(snapshot_sql(value["boundary"]))
    need(len(rows) == 3 and not data_checks(*rows, value["boundary"]), "current_full_ypal_prefix_required")
    need(rows[1] == value["tables"] and rows[2] == value["unexpected"], "all_eight_captured_payloads_must_remain_equal")
    boundary_header = {k: value["canonicalHeader"][k] for k in ("number", "hash", "parentHash", "timestamp")}
    current_header = header_witness(canonical_header, time.time(), value["boundary"])
    need(current_header == boundary_header and rows[0]["nativeBoundaryHeaders"] == [current_header], "same_native_canonical_boundary_required")
    need(actors() == before, "source_actor_changed_during_capture")
    observed = datetime.datetime.fromisoformat(value["canonicalHeader"]["observedAt"].replace("Z", "+00:00"))
    current_observed = datetime.datetime.fromisoformat(canonical_header["observedAt"].replace("Z", "+00:00"))
    return {**proof, "receiptSha256": result_sha, "currentPrefixUnchanged": True,
        "captureId": capture_id, "reportFile": str(capture_path(capture_id)),
        "headerHash": boundary_header["hash"], "canonicalObservedAtUnix": current_observed.timestamp(),
        "originalCanonicalObservedAtUnix": observed.timestamp(), "currentCanonicalInputQualified": True,
        "currentCanonicalProviderQualified": False, "currentReadinessQualified": False,
        "frameworkReady": {r["schema"]: str(r["app"].get("is_ready")) == "1" for r in rows[0]["sources"]}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    modes = parser.add_mutually_exclusive_group(); modes.add_argument("--preflight"); modes.add_argument("--capture")
    args = parser.parse_args(); current = review(args.plan)
    if args.preflight is None and args.capture is None:
        print(json.dumps({"format": FORMAT, "reviewHash": current["reviewHash"], "boundary": current["binding"]["plan"]["boundary"],
            "databaseConnections": 0, "providerCalls": 0, "databaseWrites": 0, "currentReadinessQualified": False})); return
    need((args.preflight or args.capture) == current["reviewHash"], "exact_fresh_review_required")
    before = actors(); boundary = current["binding"]["plan"]["boundary"]
    if args.preflight:
        values = query(preflight_sql(boundary)); need(len(values) == 1, "one_preflight_frame_required")
        after = actors(); need(before == after, "source_actor_changed_during_capture")
        reasons = source_checks(values[0], boundary)
        print(json.dumps({"format": FORMAT, "preflightOnly": True, "eligibleForFullComparison": not reasons,
            "reasons": reasons, "sourceProgress": [{"schema": s["schema"], "completeThrough": complete_block(s["checkpoint"]),
                "lastFeatureEvent": s["lastEvent"], "postBoundaryEvents": s["tail"], "frameworkReady": str(s["app"].get("is_ready")) == "1"} for s in values[0]["sources"]],
            "currentReadinessQualified": False, "databaseWrites": 0, "providerCalls": 0})); return
    need(current["header"] is not None, "actual_fresh_canonical_header_required")
    output = capture_path(current["binding"]["plan"]["captureId"])
    output.parent.mkdir(mode=0o700)
    parent_fd = os.open(output.parent.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent_fd)
    finally:
        os.close(parent_fd)
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        values = query(snapshot_sql(boundary)); need(len(values) == 3, "one_context_and_all_eight_comparisons_required")
        after = actors(); need(before == after, "source_actor_changed_during_capture")
        result = {"format": FORMAT, "completed": True, "reviewHash": current["reviewHash"],
            "captureId": current["binding"]["plan"]["captureId"], "reportFile": str(output),
            "producerSha256": current["binding"]["producerSha256"], "sqlSha256": current["binding"]["sqlSha256"],
            "inputSha256": INPUT_HASHES, "boundary": boundary, "frame": values[0], "tables": values[1], "unexpected": values[2],
            "canonicalHeader": current["header"], "actorsBefore": before, "actorsAfter": after,
            "qualification": assess(*values, current["header"], boundary), "databaseWrites": 0, "providerCalls": 0, "serviceActions": 0}
        raw = encoded(result)
        with os.fdopen(fd, "wb", closefd=False) as out:
            out.write(raw); out.flush(); os.fsync(out.fileno())
        directory_fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        print(json.dumps({"format": FORMAT, "completed": True, "reportSha256": sha(raw), "boundary": boundary,
            "tables": [{k: row[k] for k in ("table", "leftCount", "rightCount", "differences", "leftSha256", "rightSha256")} for row in values[1]],
            **result["qualification"], "databaseWrites": 0, "providerCalls": 0, "serviceActions": 0}))
        if not result["qualification"]["canonicalQualifiedAtCapture"]:
            raise SystemExit(2)
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"format": FORMAT, "completed": False, "code": str(error) if type(error) is RuntimeError and re.fullmatch("[A-Za-z0-9_]+", str(error)) else "private_parity_diagnostics_withheld", "automaticRetryAllowed": False}))
        raise SystemExit(1)
