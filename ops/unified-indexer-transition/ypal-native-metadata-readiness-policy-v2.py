#!/usr/bin/env python3
"""Own exactly the native Base readiness age amendment from90 to120 seconds."""
import argparse
import base64
import contextlib
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import types

FORMAT = "yunipals-native-metadata-readiness-policy-v2"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
FILE = OPS / "ypal-native-metadata-readiness-policy-v2.py"
MANIFEST = OPS / "ypal-native-metadata-readiness-policy-v2.manifest.json"
BASE = Path("/var/backups/yunipals-native-metadata-readiness-policy-v2-20261026")
INPUT = Path("/var/backups/yunipals-native-metadata-readiness-policy-input-v2-20261026/input.json")
CREATOR = OPS / "ypal-ordinary-readview-v5.py"
CREATOR_BASE = Path("/var/backups/yunipals-ypal-ordinary-readview-v5-20261025")
TEMPLATE = OPS / "ypal-combined-readview-owner-v1.py"
READ_SCHEMA = "yunipals_ownership_4e77f52b_v5"
READ_IDENTITY = "0xda708289a59500c6a1a40dc661e37cd4b6fab4fee0b4cff312e6232476fa08ab"
IMPLEMENTATION = "0x4ad380760abb9fad95cd48ef2d7c46ed5a072fca"
FUNCTION = "base_metadata_frame(boolean)"
REGPROCEDURE = READ_SCHEMA + "." + FUNCTION
OLD = "interval '90 seconds'"
NEW = "interval '120 seconds'"
CLEAN = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}
SENTINEL = "/run/yunipals-managed-handover-no-password-file"
LOCK = Path('/run/lock/yunipals-ypal-combined-transition.lock')
LOCK_DIRECTORY = Path('/run/lock')
FRAME = ("st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
SOURCE_PINS = {
    "ypal-native-metadata-readiness-policy-v1.py": "cf90a20457cd981f4b4c94ed93e3bd8ad6729588bdbeaa748d3b2146bae787a9",
    "ypal-ordinary-readview-v5.py": "1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2",
    "ypal-alchemy-ordinary-consumer-context-v1.py": "5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986",
    "ypal-fresh-forward-epoch-v1.py": "0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c",
    "ypal-combined-readview-owner-v1.py": "2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058",
    "ypal-combined-readview-v5.preparation.json": "d968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7",
    "ypal-combined-readview-v5-plan.mjs": "91b48f86211b08ceb251e840f89c52ea3e83452fdce17af19a610ef3cc5ac201"
}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + chr(10)).encode()
def pin(value): return type(value) is str and re.fullmatch("[a-f0-9]{64}", value) is not None and value != '0' * 64
def own_sha(): return sha(public(FILE))


def public(path, digest=None):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "fixed_absolute_policy_path_required")
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_native_policy_path_required")
    before = path.lstat(); raw = path.read_bytes(); after = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < len(raw) == before.st_size <= 6000000 and
         all(getattr(before, key) == getattr(after, key) for key in FRAME) and
         (digest is None or pin(digest) and sha(raw) == digest), "same_exact_native_policy_file_required")
    return raw


def document(path, digest=None): return json.loads(public(path, digest))


def authenticate():
    expected = {"format": FORMAT + "-source", "files": {FILE.name: own_sha(), **SOURCE_PINS}}
    need(document(MANIFEST) == expected, "exact_native_readiness_policy_source_manifest_required")
    for name, digest in SOURCE_PINS.items():
        public(OPS / name, digest)


def load(path):
    raw = public(path, SOURCE_PINS[Path(path).name]); value = types.ModuleType("native_policy_" + Path(path).stem)
    value.__file__ = str(path); exec(compile(raw, str(path), "exec"), value.__dict__); return value


def data_identity(target):
    return {key: ([{k: v for k, v in row.items() if k != "acl"} for row in value]
                  if key in {"relations", "functions"} else value)
            for key, value in target.items() if key != "nonownerPermissions"}


def function_row(target):
    rows = [row for row in target["functions"] if row["name"] == FUNCTION]
    need(len(rows) == 1 and rows[0]["owner"] == "postgres" and rows[0]["definer"] is False and
         rows[0]["configuration"] == ["search_path=pg_catalog"] and re.fullmatch("[1-9][0-9]*", rows[0]["oid"]),
         "one_actual_native_frame_OID_owner_invoker_and_search_path_required")
    return rows[0]


def amend_definition(definition):
    need(type(definition) is str and definition.startswith("CREATE OR REPLACE FUNCTION " + READ_SCHEMA + ".base_metadata_frame(") and
         definition.count(OLD) == 1 and NEW not in definition and "approval.checked_at" in definition and
         IMPLEMENTATION in definition and READ_IDENTITY in definition,
         "one_genuine_native_frame_ninety_second_policy_operand_required")
    changed = definition.replace(OLD, NEW)
    need(changed.replace(NEW, OLD) == definition, "only_native_approval_age_90_to120_may_change")
    return changed


def amend_target(target):
    value = copy.deepcopy(target); row = function_row(value); row["definition"] = amend_definition(row["definition"]); return value


def snapshot_sql():
    # Reuse the genuine pure target query; no creator/Source/actor construction.
    original = load(TEMPLATE)
    query = types.FunctionType(original.target_sql.__code__, {**original.target_sql.__globals__, "READ_SCHEMA": READ_SCHEMA},
                               original.target_sql.__name__, original.target_sql.__defaults__)
    return ("SELECT jsonb_build_object('databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),"
            "'target',(" + query({}) + "),'schemaAcl',(SELECT nspacl::text FROM pg_namespace WHERE nspname='" + READ_SCHEMA + "'),"
            "'columnAcl',(SELECT coalesce(jsonb_agg(jsonb_build_object('relationOid',c.oid::text,'column',a.attnum,"
            "'name',a.attname,'acl',a.attacl::text)ORDER BY c.oid,a.attnum),'[]'::jsonb)FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid "
            "WHERE c.relnamespace='" + READ_SCHEMA + "'::regnamespace AND a.attnum>0 AND NOT a.attisdropped))")


def peer(sql, readonly=True, journal=None):
    need(not os.path.lexists(SENTINEL), "absent_policy_peer_password_file_required")
    options = "-c statement_timeout=60000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=72000"
    if readonly: options += " -c default_transaction_read_only=on"
    argv = ["/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "/usr/bin/env", "-i",
            "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "TZ=UTC", "PGPASSFILE=" + SENTINEL,
            "PGAPPNAME=ypal_native_metadata_policy_v2", "PGOPTIONS=" + options,
            "/usr/bin/psql", "-XwAtq", "-h", "/var/run/postgresql", "-p", "5432", "-U", "postgres", "-d", "yunipals_backfill", "-v", "ON_ERROR_STOP=1"]
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=CLEAN, cwd="/", start_new_session=True)
    out = err = b''
    try:
        if journal:
            write(journal + '-child.json', {'pid': process.pid, 'processStat': Path('/proc/' + str(process.pid) + '/stat').read_text(),
                'requestSha256': sha(sql.encode()), 'automaticRetryAllowed': False})
        out, err = process.communicate(sql.encode(), timeout=80)
    except BaseException as original:
        try:
            try: os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError: pass
            out, err = process.communicate(timeout=5)
        except BaseException:
            pass
        if journal:
            try: transport(journal, sql, process, out, err, type(original).__name__)
            except BaseException: pass
        raise
    if journal: transport(journal, sql, process, out, err, None)
    need(process.returncode == 0 and not err and 0 < len(out) < 6000000 and not os.path.lexists(SENTINEL),
         "native_policy_SQL_outcome_unknown_inspect_owned_intent_never_repeat")
    return [json.loads(line) for line in out.splitlines() if line]


def transport(journal, sql, process, out, err, failure):
    write(journal + '-transport.json', {'requestSha256': sha(sql.encode()), 'pid': process.pid,
        'returncode': process.returncode, 'stdoutBase64': base64.b64encode(out).decode(),
        'stderrBase64': base64.b64encode(err).decode(), 'failureType': failure, 'automaticRetryAllowed': False})


def query_snapshot(host=None):
    sql = snapshot_sql()
    if host is not None: value = host.query(sql)
    else:
        rows = peer("BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;" + sql + ";ROLLBACK;")
        need(len(rows) == 1, 'one_actual_policy_catalog_snapshot_required'); value = rows[0]
    need(type(value) is dict and value["databaseOid"] == "17584", "actual_policy_target_database_required")
    function_row(value["target"]); return value


def context(input_sha):
    authenticate(); need(pin(input_sha), "actual_policy_input_SHA_required")
    config = document(INPUT, input_sha)
    need(type(config) is dict and set(config) == {"format", "createdReceiptSha256"} and config["format"] == FORMAT + "-input" and
         pin(config["createdReceiptSha256"]), "exact_native_policy_input_and_original_creator_receipt_required")
    creator = load(CREATOR); ack = creator.acknowledgement(config["createdReceiptSha256"])
    saved = document(CREATOR_BASE / "created.json", config["createdReceiptSha256"])
    need(ack["createdAcknowledged"] is True and ack["readSchema"] == READ_SCHEMA and ack["readIdentity"] == READ_IDENTITY and
         saved["readSchema"] == READ_SCHEMA and saved["readIdentity"] == READ_IDENTITY,
         "actual_immutable_original_V5_creator_ACK_required")
    function_row(saved["target"]); amend_target(saved["target"])
    return config, saved["target"]


def review(input_sha):
    config, saved = context(input_sha); before = query_snapshot()
    need(encoded(data_identity(before["target"])) == encoded(data_identity(saved)), "all_original_V5_objects_OIDs_bodies_columns_and_marker_before_policy_required")
    after = {**copy.deepcopy(before), "target": amend_target(before["target"])}
    value = {"format": FORMAT, "operatorSha256": own_sha(), "inputSha256": input_sha,
             "input": config, "before": before, "after": after, "policyTTLSeconds": 120,
             "originalCreatorReceiptSha256": config["createdReceiptSha256"]}
    return {**value, "reviewHash": sha(encoded(value))}


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def write(name, value):
    raw = encoded(value); fd = os.open(BASE / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream: stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    sync(BASE); return sha(raw)


@contextlib.contextmanager
def transition_lock():
    parent = LOCK.parent.lstat()
    need(stat.S_ISDIR(parent.st_mode) and parent.st_uid == parent.st_gid == 0 and not stat.S_ISLNK(parent.st_mode) and
         (not parent.st_mode & 0o022 or LOCK.parent == LOCK_DIRECTORY and stat.S_IMODE(parent.st_mode) == 0o1777),
         'protected_existing_transition_lock_parent_required')
    fd = os.open(LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        row = os.fstat(fd)
        need(stat.S_ISREG(row.st_mode) and row.st_uid == row.st_gid == 0 and row.st_nlink == 1 and stat.S_IMODE(row.st_mode) == 0o600,
             'protected_existing_transition_lock_required')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(all(getattr(LOCK.lstat(), key) == getattr(row, key) for key in FRAME), 'same_existing_transition_lock_inode_required')
        yield
    finally: os.close(fd)


def literal(value): return "E'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def amendment_sql(before, after, commit=False):
    need(encoded(after) == encoded({**before, "target": amend_target(before["target"])}), "exact_one_native_policy_body_delta_required")
    sql = snapshot_sql()
    guard = "WITH actual AS(" + sql + ")SELECT jsonb_build_object('transactionId',pg_current_xact_id()::text,'guard',1/(CASE WHEN " \
        "(SELECT * FROM actual)=" + literal(encoded(before).decode()) + "::jsonb THEN 1 ELSE 0 END))"
    expected = "WITH actual AS(" + sql + ")SELECT jsonb_build_object('after',(SELECT * FROM actual),'guard',1/(CASE WHEN " \
        "(SELECT * FROM actual)=" + literal(encoded(after).decode()) + "::jsonb THEN 1 ELSE 0 END))"
    return ("BEGIN;SET LOCAL search_path=pg_catalog;DO $policy_lock$ BEGIN PERFORM pg_advisory_xact_lock(hashtext('yunipals:native-metadata-policy-v1')); END $policy_lock$;" +
            guard + ";" + function_row(after["target"])["definition"] + ";" + expected + ";" + ("COMMIT;" if commit else "ROLLBACK;"))


def _saved(input_sha):
    config, saved = context(input_sha); operation = document(BASE / "operation.json")
    need(operation["format"] == FORMAT and operation["operatorSha256"] == own_sha() and operation["inputSha256"] == input_sha and
         type(operation['policyTTLSeconds']) is int and operation['policyTTLSeconds'] == 120 and
         operation['originalCreatorReceiptSha256'] == config['createdReceiptSha256'] and
         operation["input"] == config and operation["reviewHash"] == sha(encoded({key: value for key, value in operation.items() if key != "reviewHash"})) and
         encoded(data_identity(operation["before"]["target"])) == encoded(data_identity(saved)) and
         encoded(operation["after"]) == encoded({**operation["before"], "target": amend_target(operation["before"]["target"])}),
         "actual_owned_policy_operation_original_creator_and_one_body_delta_required")
    return operation


def rehearse(input_sha, expected):
    operation = review(input_sha); need(operation["reviewHash"] == expected and not os.path.lexists(BASE), "same_review_and_exclusive_policy_namespace_required")
    BASE.mkdir(mode=0o700); sync(BASE.parent); operation_sha = write("operation.json", operation)
    sql = amendment_sql(operation["before"], operation["after"])
    write("rehearsal-intent.json", {"operationSha256": operation_sha, "requestSha256": sha(sql.encode()), "automaticRetryAllowed": False})
    rows = peer(sql, False, 'rehearsal')
    xid = checked_rows(rows, operation)
    status = peer("SELECT to_jsonb(pg_xact_status('" + xid + "'::xid8));")[0]
    need(status == "aborted" and query_snapshot() == operation["before"], "actual_policy_rehearsal_aborted_and_all_catalog_columns_restored_required")
    return {"sha256": write("rehearsed.json", {"format": FORMAT, "completed": True, "operationSha256": operation_sha,
        "intentSha256": sha(public(BASE / 'rehearsal-intent.json')), 'transportSha256': sha(public(BASE / 'rehearsal-transport.json')),
        "transactionId": xid, "transactionStatus": "aborted", "catalogRestored": True}), "rehearsed": True}


def checked_rows(rows, operation):
    need(type(rows) is list and len(rows) == 2 and set(rows[0]) == {'transactionId', 'guard'} and set(rows[1]) == {'after', 'guard'} and
         type(rows[0]['guard']) is type(rows[1]['guard']) is int and rows[0]['guard'] == rows[1]['guard'] == 1 and
         encoded(rows[1]['after']) == encoded(operation['after']) and type(rows[0]['transactionId']) is str and
         re.fullmatch('[1-9][0-9]*', rows[0]['transactionId']), 'actual_policy_transaction_and_exact_after_required')
    return rows[0]['transactionId']


def observed_transport(name, operation, commit):
    value = document(BASE / (name + '-transport.json'))
    sql = amendment_sql(operation['before'], operation['after'], commit)
    need(value['requestSha256'] == sha(sql.encode()) and type(value['returncode']) is int and value['returncode'] == 0 and
         value['failureType'] is None and value['stderrBase64'] == '' and value['automaticRetryAllowed'] is False,
         'actual_successful_owned_policy_transport_required')
    raw = base64.b64decode(value['stdoutBase64'], validate=True)
    rows = [json.loads(line) for line in raw.splitlines() if line]
    checked_rows(rows, operation)
    return rows


def checked_rehearsal(operation):
    value = document(BASE / 'rehearsed.json'); intent = document(BASE / 'rehearsal-intent.json')
    operation_sha = sha(public(BASE / 'operation.json'))
    need(value['format'] == FORMAT and value['completed'] is value['catalogRestored'] is True and
         value['transactionStatus'] == 'aborted' and value['operationSha256'] == intent['operationSha256'] == operation_sha and
         intent['requestSha256'] == sha(amendment_sql(operation['before'], operation['after'], False).encode()) and
         intent['automaticRetryAllowed'] is False and value['intentSha256'] == sha(public(BASE / 'rehearsal-intent.json')) and
         value['transportSha256'] == sha(public(BASE / 'rehearsal-transport.json')) and
         value['transactionId'] == checked_rows(observed_transport('rehearsal', operation, False), operation),
         'actual_same_operation_rollback_rehearsal_and_restoration_required')
    return value


def _acknowledge(operation, xid, reconciled=False):
    need(query_snapshot() == operation["after"], "actual_complete_policy_after_catalog_and_columns_required")
    value = {"format": FORMAT, "completed": True, "operatorSha256": own_sha(), "inputSha256": operation["inputSha256"],
             "operationSha256": sha(public(BASE / "operation.json")), "rehearsalSha256": sha(public(BASE / "rehearsed.json")),
             "intentSha256": sha(public(BASE / "apply-intent.json")), "transactionId": xid, "transactionStatus": "committed",
             'transportSha256': sha(public(BASE / 'apply-transport.json')), 'observationSha256': sha(public(BASE / 'apply-sql-observation.json')),
             "beforeCatalogSha256": sha(encoded(operation["before"])), "afterCatalogSha256": sha(encoded(operation["after"])),
             "policyTTLSeconds": 120, "reconciledAfterUnknown": reconciled, "functionDDLCount": 1,
             "nativeDataWritten": False, "grantsChanged": False, "servicesChanged": False, "automaticRetryAllowed": False}
    digest = write("result.json", value); return {"completed": True, "receiptSha256": digest, "policyTTLSeconds": 120}


def apply(input_sha, expected):
    operation = _saved(input_sha); rehearsal = checked_rehearsal(operation)
    need(operation["reviewHash"] == expected and rehearsal["completed"] is rehearsal["catalogRestored"] is True and
         rehearsal["operationSha256"] == sha(public(BASE / "operation.json")) and
         not any(os.path.lexists(BASE / name) for name in ["apply-intent.json", "result.json"]), "one_actual_rehearsed_policy_amendment_only_no_retry")
    sql = amendment_sql(operation["before"], operation["after"], True)
    write("apply-intent.json", {"operationSha256": sha(public(BASE / "operation.json")), "rehearsalSha256": sha(public(BASE / "rehearsed.json")),
        "requestSha256": sha(sql.encode()), "automaticRetryAllowed": False})
    rows = peer(sql, False, 'apply')
    xid = checked_rows(rows, operation)
    write("apply-sql-observation.json", {"rows": rows, "transactionId": xid})
    need(peer("SELECT to_jsonb(pg_xact_status('" + xid + "'::xid8));")[0] == "committed", "actual_policy_XID_committed_required")
    return _acknowledge(operation, xid)


def acknowledgement(result_sha):
    authenticate(); need(pin(result_sha), "actual_policy_result_SHA_required"); result = document(BASE / "result.json", result_sha)
    operation = _saved(result["inputSha256"]); rehearsal = checked_rehearsal(operation); intent = document(BASE / "apply-intent.json")
    observed = document(BASE / "apply-sql-observation.json")
    need(result["format"] == FORMAT and result["completed"] is True and result["operatorSha256"] == own_sha() and
         result["operationSha256"] == sha(public(BASE / "operation.json")) == rehearsal["operationSha256"] == intent["operationSha256"] and
         result["rehearsalSha256"] == sha(public(BASE / "rehearsed.json")) == intent["rehearsalSha256"] and
         result["intentSha256"] == sha(public(BASE / "apply-intent.json")) and result["transactionStatus"] == "committed" and
         result['transportSha256'] == sha(public(BASE / 'apply-transport.json')) and result['observationSha256'] == sha(public(BASE / 'apply-sql-observation.json')) and
         result["transactionId"] == observed["transactionId"] == checked_rows(observed["rows"], operation) and
         encoded(observed['rows']) == encoded(observed_transport('apply', operation, True)) and type(result["policyTTLSeconds"]) is int and result["policyTTLSeconds"] == 120 and
         rehearsal['completed'] is rehearsal['catalogRestored'] is True and rehearsal['transactionStatus'] == 'aborted' and
         rehearsal['transactionId'] == checked_rows(observed_transport('rehearsal', operation, False), operation) and
         rehearsal['intentSha256'] == sha(public(BASE / 'rehearsal-intent.json')) and rehearsal['transportSha256'] == sha(public(BASE / 'rehearsal-transport.json')) and
         intent['requestSha256'] == sha(amendment_sql(operation['before'], operation['after'], True).encode()) and intent['automaticRetryAllowed'] is False and
         result['automaticRetryAllowed'] is False and type(result['functionDDLCount']) is int and result['functionDDLCount'] == 1 and
         result["beforeCatalogSha256"] == sha(encoded(operation["before"])) and result["afterCatalogSha256"] == sha(encoded(operation["after"])) and
         result["nativeDataWritten"] is result["grantsChanged"] is result["servicesChanged"] is False,
         "actual_immutable_policy_commit_observation_and_complete_catalog_chain_required")
    before = function_row(operation["before"]["target"]); after = function_row(operation["after"]["target"])
    return {"format": FORMAT, "validated": True, "operatorSha256": own_sha(), "receiptSha256": result_sha,
        "inputSha256": result["inputSha256"], "operationSha256": result["operationSha256"], "policyTTLSeconds": 120,
        "readSchema": READ_SCHEMA, "readIdentity": READ_IDENTITY, "approvedImplementation": IMPLEMENTATION,
        "functionOid": after["oid"], "functionRegprocedure": REGPROCEDURE, "functionBodySha256": sha(after["definition"].encode()),
        "beforeFunctionDefinition": before["definition"], "afterFunctionDefinition": after["definition"],
        "beforeFunctionDefinitionSha256": sha(before["definition"].encode()), "afterFunctionDefinitionSha256": sha(after["definition"].encode()),
        "beforeFunctionDefinitionMd5": hashlib.md5(before["definition"].encode()).hexdigest(),
        "afterFunctionDefinitionMd5": hashlib.md5(after["definition"].encode()).hexdigest(),
        "beforeCatalogSha256": result["beforeCatalogSha256"], "afterCatalogSha256": result["afterCatalogSha256"],
        "immutableAcknowledgementOnly": True, "actualPolicyBodyCurrent": False, "originalCreatorWholeValidatorPassed": False,
        "sourceActorQualified": False, "currentRoleGraphQualified": False, "publicationAuthorityQualified": False,
        "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}


def expected_target(original_target, result_sha):
    ack = acknowledgement(result_sha); result = document(BASE / "result.json", result_sha); operation = _saved(result["inputSha256"])
    need(encoded(data_identity(original_target)) == encoded(data_identity(operation["before"]["target"])), "exact_original_target_before_owned120_projection_required")
    target = amend_target(original_target)
    need(function_row(target)["definition"] == ack["afterFunctionDefinition"], "actual_owned120_definition_projection_required")
    return target


def current(result_sha, host=None):
    first = acknowledgement(result_sha); result = document(BASE / "result.json", result_sha); operation = _saved(result["inputSha256"])
    value = query_snapshot(host)
    need(encoded(data_identity(value["target"])) == encoded(data_identity(operation["after"]["target"])),
         "actual_policy120_all_original_objects_OIDs_body_columns_and_marker_required")
    need(acknowledgement(result_sha) == first, "same_actual_policy_ACK_before_and_after_current_capture_required")
    return {**first, "immutableAcknowledgementOnly": False, "actualPolicyBodyCurrent": True,
            "actualCatalogSha256": sha(encoded(value)), "permissionChangesRequireSeparateGraphAuthority": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--input-sha")
    group = parser.add_mutually_exclusive_group(); group.add_argument("--review", action="store_true")
    group.add_argument("--rehearse"); group.add_argument("--apply"); group.add_argument("--acknowledgement"); group.add_argument("--current")
    args = parser.parse_args()
    if not any([args.review, args.rehearse, args.apply, args.acknowledgement, args.current]):
        print(json.dumps({"format": FORMAT, "staticOnly": True, "databaseWrites": 0, "serviceActions": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "root_on_exact_policy_host_required")
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError("bounded_native_policy_phase"))); signal.alarm(240)
    try:
        if args.acknowledgement: value = acknowledgement(args.acknowledgement)
        elif args.current: value = current(args.current)
        elif args.review: value = review(args.input_sha)
        else:
            with transition_lock():
                if args.rehearse: value = rehearse(args.input_sha, args.rehearse)
                else: value = apply(args.input_sha, args.apply)
        allowed = {"format", "completed", "reviewHash", "receiptSha256", "policyTTLSeconds", "rehearsed", "validated", "immutableAcknowledgementOnly", "actualPolicyBodyCurrent"}
        print(json.dumps({key: val for key, val in value.items() if key in allowed}, sort_keys=True))
    finally: signal.alarm(0)


if __name__ == "__main__": main()
