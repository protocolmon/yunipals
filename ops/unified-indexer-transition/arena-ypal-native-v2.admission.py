#!/usr/bin/env python3
"""Separate exact-review dormant admission; two acknowledged database boundaries."""
import argparse
import copy
import json
import os
from pathlib import Path
import re
import select
import signal
import socket
import subprocess
import time

# This is an immutable companion; the rollback entrypoint still cannot commit.
HERE = Path(__file__).parent
FORMAT = "yunipals-arena-ypal-admission-v2"
BASE = Path("/var/backups/yunipals-arena-ypal-admission-v2-20261024")
REHEARSAL = Path("/var/backups/yunipals-arena-ypal-admission-rehearsal-v2-20261024")
RUNNER_SHA = "ed2c7fee798b343d10dde2904ff7d3a2ac8ebfe97879e8d14e503632a8ac3e1a"
INVENTORY_SHA = "c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785"
SCOPES = ["operational", "source"]


def runner():
    import hashlib,types
    path=HERE/'arena-ypal-native-v2.rehearsal.py';raw=path.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=RUNNER_SHA:raise RuntimeError('exact_current_actor_rehearsal_required')
    value=types.ModuleType('actual_current_actor_rehearsal');value.__file__=str(path);exec(compile(raw,str(path),'exec'),value.__dict__)
    h=value.api();h.read(path,RUNNER_SHA);return h


def save(h, path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(h.encoded(value)); stream.flush(); os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def saved(h, path):
    # Reuse the protected no-follow bounded reader, pinning actual stored bytes.
    raw = path.read_bytes()
    return json.loads(h.read(path, h.sha(raw), 1000000))


def expected(proposal, scope):
    if scope == "operational":
        return [w["role"] for w in proposal["workers"]], [{"role": w["role"], **e} for w in proposal["workers"] for e in w["requiredEdges"]], ["yunipals_arena"]
    if scope == "source":
        role = proposal["sourceReader"]["role"]
        return [role], [{"role": role, "relation": row["name"], "privilege": "SELECT", "attribute": None} for row in proposal["sourceReader"]["tables"]], ["unified_ypal_20261023_v1", "yunipals_indexer_control"]
    raise RuntimeError("fixed_admission_scope_required")


def catalog_sql(h, proposal, scope, *, inside=False):
    inv = h.module(Path("/opt/yunipals-unified/operations/arena-role-inventory-20261021/arena-operational-role-inventory-v1.py"), INVENTORY_SHA)
    roles, edges, schemas = expected(proposal, scope)
    names = inv.literal(json.dumps(roles))
    auth = "(SELECT jsonb_build_object('backendPid',pg_backend_pid(),'sessionUser',session_user,'currentUser',current_user,'backendStart',(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()),'auth',(SELECT jsonb_object_agg(rolname,jsonb_build_object('passwordPresent',rolpassword IS NOT NULL,'scram',COALESCE(rolpassword LIKE 'SCRAM-SHA-256$%',false),'passwordSha256',CASE WHEN rolpassword IS NOT NULL THEN encode(sha256(convert_to(rolpassword,'UTF8')),'hex') END)) FROM pg_authid WHERE rolname IN(SELECT jsonb_array_elements_text(" + names + "::jsonb)))))"
    text = inv.catalog_sql(roles, edges, schemas, auth)
    database_acl="(SELECT coalesce(jsonb_agg(jsonb_build_object('databaseOid',d.oid::bigint,'granteeOid',a.grantee::bigint,'grantorOid',a.grantor::bigint,'privilege',a.privilege_type,'grantOption',a.is_grantable)ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba)))a WHERE d.datname=current_database())"
    marker="SELECT jsonb_build_object('readOnly',"
    h.need(text.count(marker)==1,"exact_frozen_inventory_SELECT_shape_required")
    text=text.replace(marker,"SELECT jsonb_build_object('databaseAcl',"+database_acl+",'readOnly',")
    if inside:
        start, end = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n", "ROLLBACK;\n"
        h.need(text.startswith(start) and text.endswith(end), "exact_inventory_transaction_shape_required")
        text = text[len(start):-len(end)]
    return text


def current_catalog(h, proposal, scope):
    target = h.TARGETS[SCOPES.index(scope)]
    args = h.peer_args(*target)
    result = subprocess.run(args, input=catalog_sql(h, proposal, scope).encode(), capture_output=True, env=h.ENV, timeout=12)
    h.need(result.returncode == 0 and not result.stderr and len(result.stdout) <= 500000, "bounded_clean_role_catalog_required")
    raw = result.stdout
    doc = json.loads(raw)
    h.need(doc["readOnly"] is True and doc["isolation"] == "repeatable read", "readonly_role_catalog_required")
    peer_identity(h, args, doc)
    return doc


def peer_identity(h, args, doc):
    names = [a.removeprefix("PGUSER=") for a in args if a.startswith("PGUSER=")]
    h.need(len(names) == 1 and doc["markers"]["sessionUser"] == doc["markers"]["currentUser"] == names[0], "exact_peer_session_user_and_reset_role_required")


def validate_catalog(h, proposal, scope, doc, role_oids, *, phase="admitted", password_sha256=None):
    """Only LOGIN/password may vary by phase; OIDs and227/13 ACLs never vary."""
    names, required, schemas = expected(proposal, scope)
    h.need(phase in {"admitted", "passwords", "login"} and set(role_oids) == set(names) and all(type(v) is int and v > 0 for v in role_oids.values()), "exact_owned_role_oids_and_phase_required")
    rows = doc["roles"]
    h.need(len(rows) == len(names) and {r["name"] for r in rows} == set(names), "exact_catalog_role_names_required")
    schema_rows = proposal["operationalTarget" if scope == "operational" else "sourceTarget"]["schemas"]
    schema_pins = {row["name"]: (row["oid"], row["ownerOid"]) for row in schema_rows}
    h.need(set(schema_pins) == set(schemas), "exact_frozen_schema_identity_scope_required")
    relations = {r["name"]: r for r in doc["relations"]}
    source_relations = {r["name"]: r for r in proposal["sourceReader"]["tables"]}
    sql = h.read(h.HISTORICAL_OP, h.PINS["operational-roles.current.sql.review"]).decode()
    op_oids = {name: int(oid) for name, oid in re.findall(r"'(yunipals_arena\.[a-z_]+)',([0-9]+)", sql)}
    if phase == "admitted":
        h.need(password_sha256 is None, "initial_admission_has_no_owned_passwords")
    else:
        h.need(isinstance(password_sha256, dict) and set(password_sha256) == set(names) and all(re.fullmatch("[a-f0-9]{64}", v) for v in password_sha256.values()), "exact_owned_scram_hashes_required")
    for row in rows:
        name, oid = row["name"], row["oid"]
        limit = next(w["connectionLimit"] for w in proposal["workers"] if w["role"] == name) if scope == "operational" else 32
        attrs = {"login": phase == "login", "superuser": False, "inherit": False, "createDb": False, "createRole": False, "replication": False, "bypassRls": False, "connectionLimit": limit}
        h.need(row["exists"] is True and oid == role_oids[name] and row["attributes"] == attrs, "owned_role_oid_or_negative_attributes_changed")
        h.need(row["membershipEdges"] == 0 and row["sessions"] <= limit and (phase == "login" or row["sessions"] == 0), "owned_role_memberships_or_sessions_changed")
        h.need(row["databaseConnect"] is True and row["databaseCreate"] is False and row["databaseTemp"] is (scope == "source"), "exact_database_authority_required")
        h.need(set(row["schemaPrivileges"]) == set(schemas), "exact_schema_scope_required")
        for schema in schemas:
            h.need(row["schemaPrivileges"][schema] == {"oid": schema_pins[schema][0], "usage": True, "create": False, "owns": False}, "exact_schema_usage_without_ownership_required")
        for key in ["extraTablePrivilegeCount", "extraColumnPrivilegeCount", "ownedRelationCount", "ownedFunctionCount", "sequencePrivilegeCount", "securityDefinerExecuteCount"]:
            h.need(row[key] == 0, "unexpected_effective_object_authority")
        h.need(row["functionExecuteCount"] == (0 if scope == "operational" else len(proposal["sourceReader"]["existingAmbientAuthority"]["publicNonDefinerFunctions"])), "exact_existing_invoker_function_authority_required")
        checks = row["requiredGrants"]
        want = {(e["relation"], e["privilege"], e["attribute"]) for e in required if e["role"] == name}
        h.need({(e["relation"], e["privilege"], e["attribute"]) for e in checks} == want and len(checks) == len(want) and all(e["effective"] is True for e in checks), "all_exact_required_grants_must_be_effective")
        direct = set()
        for acl in [*row["directRelationAcl"], *row["directColumnAcl"]]:
            if acl["granteeOid"] != oid:
                continue
            relation = relations[acl["relation"]]
            expected_oid = op_oids.get(relation["name"]) if scope == "operational" else source_relations.get(relation["name"], {}).get("oid")
            owner = schema_pins["yunipals_arena"][1] if scope == "operational" else source_relations.get(relation["name"], {}).get("ownerOid")
            h.need(relation["oid"] == expected_oid and relation["ownerOid"] == owner and relation["kind"] == "r" and relation["rowSecurity"] is False and acl["grantorOid"] == owner and acl["grantOption"] is False, "exact_owned_relation_and_grantor_required")
            direct.add((relation["name"], acl["privilege"], acl.get("attribute")))
        h.need(direct == want, "exact_direct_table_and_column_edges_required")
        own_schema = [a for a in row["directSchemaAcl"] if a["granteeOid"] == oid]
        h.need(len(own_schema) == len(schemas) and {(a["schema"], a["privilege"], a["grantorOid"], a["grantOption"]) for a in own_schema} == {(s, "USAGE", schema_pins[s][1], False) for s in schemas}, "exact_direct_schema_edges_required")
        h.need(not any(a["granteeOid"] == oid for a in row["functionAclIncludingDefaults"]), "no_direct_function_execute_grants_required")
        auth = doc["markers"]["auth"][name]
        desired = {"passwordPresent": phase != "admitted", "scram": phase != "admitted", "passwordSha256": None if phase == "admitted" else password_sha256[name]}
        h.need(auth == desired, "owned_role_password_phase_changed")
    functions = doc["publicExecutableFunctions"]
    ambient = [] if scope == "operational" else proposal["sourceReader"]["existingAmbientAuthority"]["publicNonDefinerFunctions"]
    h.need(functions == ambient, "fixed_ambient_invoker_functions_changed")
    return {"validated": True, "scope": scope, "roles": role_oids, "phase": phase, "requiredEdges": len(required), "catalogSha256": h.sha(h.encoded(graph(doc)))}


def graph(doc):
    # Transaction metadata/sessions/auth are independently validated. Current
    # LOGIN and every ACL/OID/other attribute remain unchanged in this graph.
    value = {k: v for k, v in doc.items() if k not in {"readOnly", "isolation", "markers"}}
    return {**value, "roles": [{k: v for k, v in row.items() if k != "sessions"} for row in value["roles"]]}


def expected_graph(recorded, phase):
    value = copy.deepcopy(graph(recorded))
    for row in value["roles"]:
        row["attributes"]["login"] = phase == "login"
    return value


def verify_current(receipt, *, phase="admitted", password_sha256=None):
    """Read-only entry for the credential owner. No writes/phase transitions."""
    h = runner()
    proposal = h.load_proposal()
    h.need(receipt.get("format") == FORMAT and receipt.get("commitOutcome") == "commit_confirmed" and receipt.get("proposalSha256") == h.PINS["arena-ypal-native-v1.proposal.json"], "actual_acknowledged_admission_required")
    h.need(receipt.get("operationalDatabaseOid") == 2303669 and receipt.get("sourceDatabaseOid") == 17584 and receipt.get("operatorSha256") == h.sha(Path(__file__).read_bytes()), "same_owned_admission_operator_and_databases_required")
    all_names = set(receipt["roles"]) | {receipt["sourceRole"]["name"]}
    h.need((phase == "admitted" and password_sha256 is None) or (phase in {"passwords", "login"} and isinstance(password_sha256, dict) and set(password_sha256) == all_names), "exact_nine_owned_auth_phase_required")
    intent = saved(h, BASE / "intent.json")
    h.need(receipt.get("acknowledgedCurrentActors")==intent["acknowledgedCurrentActors"]==h.acknowledged() and receipt.get("oldWholeInvocationGatePassed") is False,"same_actual_current_actor_ack_required")
    h.need(receipt.get("reviewHash") == intent["reviewHash"] and intent["operatorSha256"] == receipt["operatorSha256"], "same_owned_admission_intent_required")
    h.need(receipt.get("releaseId")=="0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3" and receipt.get("sourceCatalogSha256")==intent["sourceAmbient"]["sourceCatalogSha256"]==h.source_ambient()["sourceCatalogSha256"], "same_actual_YPAL_source_catalog_and_release_required")
    summaries = {}
    for scope in SCOPES:
        boundary = receipt["perDatabase"][scope]
        sql_name = "operational-roles.current.sql.review" if scope == "operational" else "arena-ypal-native-v1.source.sql.review"
        h.need(boundary["commitOutcome"] == "commit_confirmed" and boundary["sqlSha256"] == receipt["sqlSha256"][scope] == h.PINS[sql_name], "both_exact_database_commits_must_be_acknowledged")
        roles = receipt["roles"] if scope == "operational" else {receipt["sourceRole"]["name"]: receipt["sourceRole"]["oid"]}
        current = current_catalog(h, proposal, scope)
        subset = None if password_sha256 is None else {name: password_sha256[name] for name in roles}
        summaries[scope] = validate_catalog(h, proposal, scope, current, roles, phase=phase, password_sha256=subset)
        recorded = saved(h, BASE / (scope + "-prepared.json"))
        h.need(recorded["roles"] == roles and boundary["roles"] == roles and boundary["preparedSha256"] == h.sha(h.encoded(recorded)), "same_prepared_owned_role_oids_required")
        h.need(graph(current) == expected_graph(recorded["catalog"], phase), "committed_acl_and_oid_snapshot_changed")
    return {"format": FORMAT, "validated": True, "phase": phase, "catalogs": summaries, "roleCount": 9, "databaseWrites": 0}


class Lines:
    def __init__(self, h, process):
        self.h, self.process, self.pending = h, process, b""
        self.deadline = time.monotonic() + 45

    def next(self):
        while b"\n" not in self.pending:
            left = self.deadline - time.monotonic()
            self.h.need(left > 0 and select.select([self.process.stdout.fileno()], [], [], left)[0], "bounded_transaction_ack_timeout")
            raw = os.read(self.process.stdout.fileno(), 65536)
            self.h.need(raw and len(self.pending) + len(raw) <= 500000, "bounded_transaction_ack_required")
            self.pending += raw
        row, self.pending = self.pending.split(b"\n", 1)
        return row


def boundary(h, proposal, scope, raw, binding):
    index = SCOPES.index(scope)
    save(h, BASE / (scope + "-intent.json"), {"format": FORMAT, "scope": scope, "sqlSha256": h.sha(raw), "reviewHash": binding["reviewHash"]})
    args = h.peer_args(*h.TARGETS[index], write=True)
    args = ["PGAPPNAME=arena_native_admission_commit" if a.startswith("PGAPPNAME=") else a for a in args]
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=h.ENV)
    lines = Lines(h, process)
    try:
        # The original final COMMIT is held until actual new OIDs+ACLs are fsynced.
        h.rollback_sql(raw)
        process.stdin.write(raw[:-8] + catalog_sql(h, proposal, scope, inside=True).encode() + b"\n\\echo ARENA_ADMISSION_PREPARED\n")
        process.stdin.flush()
        documents = []
        while True:
            line = lines.next()
            if line == b"ARENA_ADMISSION_PREPARED":
                break
            if line.strip():
                documents.append(json.loads(line))
        h.need(len(documents) == 1, "single_in_transaction_role_catalog_required")
        doc = documents[0]
        peer_identity(h, args, doc)
        roles = {r["name"]: r["oid"] for r in doc["roles"]}
        validate_catalog(h, proposal, scope, doc, roles)
        prepared = {"format": FORMAT, "scope": scope, "roles": roles, "catalog": doc}
        save(h, BASE / (scope + "-prepared.json"), prepared)
        h.need(h.context(proposal) == binding["context"], "retained_context_changed_before_commit")
        save(h, BASE / (scope + "-commit-intent.json"), {"preparedSha256": h.sha(h.encoded(prepared)), "backendPid": doc["markers"]["backendPid"], "backendStart": doc["markers"]["backendStart"]})
        process.stdin.write(b"COMMIT;\n\\echo ARENA_ADMISSION_COMMIT_ACK\n")
        process.stdin.flush()
        h.need(lines.next() == b"ARENA_ADMISSION_COMMIT_ACK", "explicit_database_commit_ack_required")
        process.stdin.close(); process.stdin = None
        stdout, stderr = process.communicate(timeout=5)
        h.need(process.returncode == 0 and not stderr and not stdout.strip() and not lines.pending.strip(), "clean_acknowledged_commit_child_required")
        current = current_catalog(h, proposal, scope)
        validate_catalog(h, proposal, scope, current, roles)
        h.need(graph(current) == graph(doc), "committed_role_acl_snapshot_changed")
        result = {"commitOutcome": "commit_confirmed", "acknowledgement": "explicit_commit_ack_and_fresh_catalog", "roles": roles, "preparedSha256": h.sha(h.encoded(prepared)), "sqlSha256": h.sha(raw)}
        save(h, BASE / (scope + "-result.json"), result)
        return result
    finally:
        if process.poll() is None:
            process.kill()
        process.communicate(timeout=5)


def review(h, rehearsal_review_sha, rehearsal_result_sha):
    proposal, sqls, roles, before, rbinding = h.inspect()
    first = json.loads(h.read(REHEARSAL / "review.json", rehearsal_review_sha))
    result = json.loads(h.read(REHEARSAL / "result.json", rehearsal_result_sha))
    h.need(first["status"] == "readonly_review_passed" and first["binding"]["operatorSha256"] == RUNNER_SHA and first["reviewHash"] == h.sha(h.encoded(first["binding"])) and result["status"] == "rollback_rehearsal_passed" and result["reviewHash"] == first["reviewHash"], "actual_owned_rollback_rehearsal_required")
    h.need(first["binding"]["acknowledgedCurrentActors"]==rbinding["acknowledgedCurrentActors"]==result["acknowledgedCurrentActors"] and first["binding"]["oldWholeInvocationGatePassed"] is False and result["oldWholeInvocationGatePassed"] is False,"actual_current_actor_rehearsal_ACK_required")
    h.need(first["binding"]["context"] == rbinding["context"] and first["binding"]["catalogSha256"] == rbinding["catalogSha256"], "rollback_rehearsal_context_or_catalog_changed")
    h.need(len(result["rehearsals"]) == 2 and all(r["sqlSha256"] == h.sha(raw) and r["rollbackSqlSha256"] == h.sha(h.rollback_sql(raw)) and r["catalogUnchanged"] is True and r["rolesAbsentAfterRollback"] == len(names) for r, raw, names in zip(result["rehearsals"], sqls, roles)), "both_exact_rollback_boundaries_required")
    binding = {**rbinding, "format": FORMAT, "operatorSha256": h.sha(Path(__file__).read_bytes()), "rollbackOperatorSha256": RUNNER_SHA, "rehearsalReviewSha256": rehearsal_review_sha, "rehearsalResultSha256": rehearsal_result_sha}
    return proposal, sqls, {**binding, "reviewHash": h.sha(h.encoded(binding))}


def final_receipt(h, binding, parts):
    roles = parts["operational"]["roles"]
    source = parts["source"]["roles"]
    name = next(iter(source))
    return {"format": FORMAT, "commitOutcome": "commit_confirmed", "roles": roles, "sourceRole": {"name": name, "oid": source[name]}, "operationalDatabaseOid": 2303669, "sourceDatabaseOid": 17584, "proposalSha256": h.PINS["arena-ypal-native-v1.proposal.json"], "sqlSha256": {s: parts[s]["sqlSha256"] for s in SCOPES}, "operatorSha256": binding["operatorSha256"], "reviewHash": binding["reviewHash"], "perDatabase": parts, "loginChanges": 0, "privateFileWrites": 0, "serviceJobs": 0, "schemaMigrations": 0, "sourceSelectionsChanged": 0, "automaticRetryAllowed": False, "databaseBoundariesAtomic": False, "releaseId": "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3", "sourceCatalogSha256": binding["sourceAmbient"]["sourceCatalogSha256"], "acknowledgedCurrentActors":binding["acknowledgedCurrentActors"],"oldWholeInvocationGatePassed":False}


def reconcile(h):
    binding = saved(h, BASE / "intent.json")
    proposal = h.load_proposal()
    h.need(binding["operatorSha256"] == h.sha(Path(__file__).read_bytes()), "exact_original_admission_attempt_required")
    parts = {}
    for scope in SCOPES:
        prepared_path = BASE / (scope + "-prepared.json")
        h.need(prepared_path.exists(), "partial_attempt_without_prepared_role_oids_requires_manual_recovery")
        prepared = saved(h, prepared_path)
        commit_intent = saved(h, BASE / (scope + "-commit-intent.json"))
        backend = prepared["catalog"]["markers"]
        h.need(commit_intent == {"preparedSha256": h.sha(h.encoded(prepared)), "backendPid": backend["backendPid"], "backendStart": backend["backendStart"]}, "exact_owned_durable_commit_intent_required")
        current = current_catalog(h, proposal, scope)
        # An alive original transaction or absent/mixed roles is never adopted.
        query = "BEGIN READ ONLY;SELECT count(*) FROM pg_stat_activity WHERE pid=" + str(int(backend["backendPid"])) + " AND backend_start::text='" + backend["backendStart"].replace("'", "''") + "';ROLLBACK;"
        alive = h.run(h.peer_args(*h.TARGETS[SCOPES.index(scope)]), query.encode())
        h.need(alive.strip() == b"0", "original_commit_backend_must_be_terminal_before_reconciliation")
        validate_catalog(h, proposal, scope, current, prepared["roles"])
        h.need(graph(current) == graph(prepared["catalog"]), "exact_owned_prepared_oids_and_acls_required")
        intent = saved(h, BASE / (scope + "-intent.json"))
        sql_name = "operational-roles.current.sql.review" if scope == "operational" else "arena-ypal-native-v1.source.sql.review"
        h.need(intent["sqlSha256"] == h.PINS[sql_name] and intent["reviewHash"] == binding["reviewHash"], "same_owned_database_attempt_required")
        result = {"commitOutcome": "commit_confirmed", "acknowledgement": "reconciled_exact_prepared_oids_and_acls_after_terminal_backend", "roles": prepared["roles"], "preparedSha256": h.sha(h.encoded(prepared)), "sqlSha256": intent["sqlSha256"]}
        prior_path = BASE / (scope + "-result.json")
        if prior_path.exists():
            prior = saved(h, prior_path)
            h.need(all(prior.get(k) == result[k] for k in ["commitOutcome", "roles", "preparedSha256", "sqlSha256"]), "prior_database_acknowledgement_must_match")
            result = prior
        parts[scope] = result
    h.need(h.context(proposal) == binding["context"], "retained_context_changed_during_reconciliation")
    receipt = final_receipt(h, binding, parts)
    result_path = BASE / "result.json"
    if result_path.exists():
        original = saved(h, result_path)
        verify_current(original)
        return original
    save(h, result_path, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rehearsal-review")
    parser.add_argument("--rehearsal-result")
    parser.add_argument("--commit", metavar="EXACT_REVIEW_HASH")
    parser.add_argument("--reconcile", action="store_true")
    args = parser.parse_args()
    h = runner()
    os.umask(0o077); os.environ.clear(); os.environ.update(h.ENV)
    h.need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main" and HERE == h.OPS, "fixed_root_admission_host_required")
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(240)
    try:
        if args.reconcile:
            h.need(not any([args.commit, args.rehearsal_review, args.rehearsal_result]), "reconciliation_is_separate_and_readonly")
            receipt = reconcile(h)
            print(json.dumps({"format": FORMAT, "commitOutcome": receipt["commitOutcome"], "resultSha256": h.sha(h.encoded(receipt)), "reconciled": True}, sort_keys=True))
            return
        h.need(args.rehearsal_review and args.rehearsal_result and not os.path.lexists(BASE), "fresh_attempt_and_actual_rehearsal_pins_required")
        proposal, sqls, binding = review(h, args.rehearsal_review, args.rehearsal_result)
        if not args.commit:
            print(json.dumps({"format": FORMAT, "status": "reviewed_not_committed", "reviewHash": binding["reviewHash"], "binding": binding, "roleChanges": 0}, sort_keys=True))
            return
        h.need(args.commit == binding["reviewHash"], "exact_fresh_commit_review_required")
        BASE.mkdir(mode=0o700)
        save(h, BASE / "intent.json", binding)
        parts = {}
        try:
            for scope, raw in zip(SCOPES, sqls):
                parts[scope] = boundary(h, proposal, scope, raw, binding)
            h.need(h.context(proposal) == binding["context"], "original_context_must_remain_unchanged")
            receipt = final_receipt(h, binding, parts)
            verify_current(receipt)
            save(h, BASE / "result.json", receipt)
            print(json.dumps({"format": FORMAT, "commitOutcome": "commit_confirmed", "resultSha256": h.sha(h.encoded(receipt)), "roles": receipt["roles"], "sourceRole": receipt["sourceRole"], "databaseBoundariesAtomic": False, "releaseId": "0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3", "sourceCatalogSha256": binding["sourceAmbient"]["sourceCatalogSha256"], "acknowledgedCurrentActors":binding["acknowledgedCurrentActors"],"oldWholeInvocationGatePassed":False}, sort_keys=True))
        except BaseException as error:
            save(h, BASE / "failed.json", {"format": FORMAT, "commitOutcome": "partial_or_unknown", "acknowledgedDatabaseBoundaries": parts, "errorClass": type(error).__name__, "automaticRetryAllowed": False, "rawMessagesExported": False})
            raise
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "commitOutcome": "not_started_or_partial_or_unknown", "errorClass": type(error).__name__, "rawMessagesExported": False, "automaticRetryAllowed": False, "manualReconciliationRequired": True}, sort_keys=True))
        raise SystemExit(1)
