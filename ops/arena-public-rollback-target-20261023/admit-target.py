#!/usr/bin/env python3
"""Exact new public-only Arena rollback database. Default is read-only review.

Separate, acknowledged role / CREATE DATABASE / ACL / schema boundaries. No
retry, DROP, migration, source switch, service or operational-data command.
"""
from __future__ import annotations

import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import select
import signal
import socket
import stat
import subprocess
import time

HERE = Path(__file__).parent
FORMAT = "yunipals-arena-public-rollback-target-v1"
BASE = Path("/var/backups/yunipals-arena-public-rollback-target-v1-20261023")
CREDENTIAL_BASE = Path("/var/backups/yunipals-arena-public-rollback-credentials-v1-20261023")
DATABASE = "yunipals_arena_public_rollback"
MAINTENANCE = "yunipals_backfill"
OWNER = "arena_public_rollback_owner"
WRITER = "arena_public_rollback_writer"
READER = "arena_public_rollback_reader"
PEER_USER = "postgres"
ROLES = [OWNER, WRITER, READER]
TABLES = ["chain_event", "credit", "deployment", "tournament"]
PROPOSAL_SHA = "8c8a15d44cee4d333dd595a372d1bd3aab7bb465c5ff202c1b2f5382cd1a20e1"
ENV = {"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "LANG": "C.UTF-8", "TZ": "UTC"}
PHASE = "entry"


class Refusal(RuntimeError):
    pass


def need(value, code):
    if not value:
        raise Refusal(code)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def metadata(s):
    return [s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns]


def protected(path, maximum=2000000):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "absolute_protected_input_required")
    for parent in path.parents:
        s = parent.lstat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022, "protected_input_ancestry_required")
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0 and before.st_nlink == 1 and not before.st_mode & 0o022 and before.st_size <= maximum, "bounded_protected_regular_file_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        need(metadata(before) == metadata(os.fstat(fd)), "protected_input_open_changed")
        raw = os.read(fd, maximum + 1)
        need(len(raw) <= maximum and metadata(before) == metadata(os.fstat(fd)) == metadata(path.lstat()), "protected_input_read_changed")
        return raw
    finally:
        os.close(fd)


def save(path, value):
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def load_saved(path):
    return json.loads(protected(path))


def proposal():
    raw = protected(HERE / "proposal.json")
    need(sha(raw) == PROPOSAL_SHA, "exact_public_proposal_required")
    value = json.loads(raw)
    for name, pin in value["sql"].items():
        need(name in {"roles.sql", "schema.sql"} and sha(protected(HERE / name)) == pin, "exact_public_sql_required")
    return value


def peer_args(database, *, write=False, port=5432):
    need((port, database) in {(5432, MAINTENANCE), (5432, DATABASE), (15438, "yunipals_arena")}, "fixed_peer_database_required")
    account = pwd.getpwnam("postgres")
    options = "-c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=45000 -c default_transaction_read_only=" + ("off" if write else "on")
    return ["/usr/bin/setpriv", "--reuid=" + str(account.pw_uid), "--regid=" + str(account.pw_gid), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "HOME=/nonexistent", "PGHOST=/var/run/postgresql", "PGPORT=" + str(port), "PGDATABASE=" + database, "PGUSER=postgres", "PGPASSFILE=/run/arena-public-rollback-target-no-password", "PGAPPNAME=arena_public_rollback_target_owner", "PGOPTIONS=" + options, "/usr/bin/psql", "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"]


def run(database, sql, *, write=False, port=5432):
    result = subprocess.run(peer_args(database, write=write, port=port), input=sql.encode(), capture_output=True, env=ENV, timeout=25)
    need(result.returncode == 0 and not result.stderr and len(result.stdout) < 2000000, "bounded_clean_peer_command_required")
    return result.stdout


def roles_query():
    return """SELECT coalesce(jsonb_agg(jsonb_build_object(
 'name',r.rolname,'oid',r.oid::int,'login',r.rolcanlogin,'inherit',r.rolinherit,
 'superuser',r.rolsuper,'createDb',r.rolcreatedb,'createRole',r.rolcreaterole,
 'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'limit',r.rolconnlimit,
 'validUntil',r.rolvaliduntil::text,'settings',(SELECT to_jsonb(s.setconfig) FROM pg_db_role_setting s WHERE s.setrole=r.oid AND s.setdatabase=0),
 'memberships',(SELECT count(*) FROM pg_auth_members m WHERE m.member=r.oid OR m.roleid=r.oid),
 'sessions',(SELECT count(*) FROM pg_stat_activity a WHERE a.usesysid=r.oid),
 'passwordSha256',CASE WHEN r.rolpassword IS NULL THEN NULL ELSE encode(sha256(convert_to(r.rolpassword,'UTF8')),'hex') END,
 'scram',coalesce(r.rolpassword LIKE 'SCRAM-SHA-256$%',false)) ORDER BY r.rolname),'[]'::jsonb)
 FROM pg_authid r WHERE r.rolname IN (NAMES)""".replace("NAMES", ",".join(map(quote, ROLES)))


def transaction_doc(sql):
    return "SELECT jsonb_build_object('xid',pg_current_xact_id_if_assigned()::text,'backendPid',pg_backend_pid(),'backendStart',(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()),'sessionUser',session_user,'currentUser',current_user,'value',(" + sql + "));\n"


def initial_context():
    names = ",".join(map(quote, ROLES))
    sql = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
 SELECT jsonb_build_object('databaseOid',(SELECT oid::int FROM pg_database WHERE datname=current_database()),
 'database',current_database(),'port',current_setting('port')::int,'version',current_setting('server_version_num')::int,
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'roles',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',rolname,'oid',oid::int) ORDER BY rolname),'[]'::jsonb) FROM pg_roles WHERE rolname IN (NAMES)),
 'target',(SELECT jsonb_build_object('oid',oid::int,'ownerOid',datdba::int) FROM pg_database WHERE datname=TARGET));
 ROLLBACK;""".replace("NAMES", names).replace("TARGET", quote(DATABASE))
    source = json.loads(run(MAINTENANCE, sql))
    need(source["databaseOid"] == 17584 and source["database"] == MAINTENANCE and source["port"] == 5432 and source["version"] >= 160000, "actual_source_cluster_identity_required")
    operational = json.loads(run("yunipals_arena", "BEGIN READ ONLY;SELECT jsonb_build_object('database',current_database(),'oid',(SELECT oid::int FROM pg_database WHERE datname=current_database()),'port',current_setting('port')::int,'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()));ROLLBACK;", port=15438))
    need(operational["database"] == "yunipals_arena" and operational["oid"] == 2303669 and operational["port"] == 15438, "actual_private_operational_identity_required")
    need(not source["roles"] and source["target"] is None, "initial_database_and_all_three_roles_must_be_absent")
    return {"source": source, "operational": operational}


def database_query():
    return """SELECT jsonb_build_object('name',d.datname,'oid',d.oid::int,'ownerOid',d.datdba::int,
 'allowConnections',d.datallowconn,'connectionLimit',d.datconnlimit,'encoding',pg_encoding_to_char(d.encoding),
 'collate',d.datcollate,'ctype',d.datctype,'isTemplate',d.datistemplate,
 'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::int,'grantee',a.grantee::int,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a))
 FROM pg_database d WHERE d.datname=TARGET""".replace("TARGET", quote(DATABASE))


def current_roles():
    return json.loads(run(MAINTENANCE, "BEGIN READ ONLY;" + roles_query() + ";ROLLBACK;"))


def current_database():
    raw = run(MAINTENANCE, "BEGIN READ ONLY;" + database_query() + ";ROLLBACK;").strip()
    return json.loads(raw) if raw else None


def catalog_query():
    return """SELECT jsonb_build_object('database',(""" + database_query() + """),'roles',(""" + roles_query() + """),
 'serverIdentity',jsonb_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'port',current_setting('port')::int,'version',current_setting('server_version_num')::int),
 'schemas',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',n.nspname,'oid',n.oid::int,'owner',n.nspowner::int,'acl',n.nspacl::text) ORDER BY n.nspname),'[]'::jsonb) FROM pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'),
 'tables',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::int,'owner',c.relowner::int,'kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'acl',(SELECT coalesce(jsonb_agg(jsonb_build_object('grantor',a.grantor::int,'grantee',a.grantee::int,'privilege',a.privilege_type,'grantable',a.is_grantable) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a),
 'columns',(SELECT coalesce(jsonb_agg(jsonb_build_object('n',a.attnum,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'acl',a.attacl::text,'default',pg_get_expr(x.adbin,x.adrelid)) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a LEFT JOIN pg_attrdef x ON x.adrelid=a.attrelid AND x.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',k.oid::int,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname),'[]'::jsonb) FROM pg_constraint k WHERE k.conrelid=c.oid),
 'indexes',(SELECT coalesce(jsonb_agg(jsonb_build_object('oid',i.indexrelid::int,'valid',i.indisvalid,'ready',i.indisready,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid),'[]'::jsonb) FROM pg_index i WHERE i.indrelid=c.oid),
 'triggers',(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)) ORDER BY c.relname),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='yunipals_arena' AND c.relkind='r'),
 'otherRelations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND NOT(n.nspname='yunipals_arena' AND c.relkind IN('r','i'))),
 'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'),
 'defaultAclCount',(SELECT count(*) FROM pg_default_acl),
 'roleDependencies',(SELECT coalesce(jsonb_agg(jsonb_build_object('roleOid',d.refobjid::int,'databaseOid',d.dbid::int,'class',d.classid::regclass::text,'objectOid',d.objid::int,'subId',d.objsubid,'type',d.deptype) ORDER BY d.refobjid,d.dbid,d.classid,d.objid,d.objsubid,d.deptype),'[]'::jsonb) FROM pg_shdepend d WHERE d.refclassid='pg_authid'::regclass AND d.refobjid IN(SELECT oid FROM pg_roles WHERE rolname IN(OWNER,WRITER,READER))),
 'ambientDatabaseAuthority',(SELECT jsonb_object_agg(r.rolname,(SELECT coalesce(jsonb_agg(jsonb_build_object('databaseOid',d.oid::int,'connect',has_database_privilege(r.oid,d.oid,'CONNECT'),'temp',has_database_privilege(r.oid,d.oid,'TEMP'),'create',has_database_privilege(r.oid,d.oid,'CREATE')) ORDER BY d.oid),'[]'::jsonb) FROM pg_database d WHERE d.datallowconn AND d.datname<>TARGET)) FROM pg_roles r WHERE r.rolname IN(WRITER,READER)),
 'empty',NOT(EXISTS(SELECT 1 FROM yunipals_arena.deployment) OR EXISTS(SELECT 1 FROM yunipals_arena.chain_event) OR EXISTS(SELECT 1 FROM yunipals_arena.tournament) OR EXISTS(SELECT 1 FROM yunipals_arena.credit)),
 'privileges',(SELECT jsonb_object_agg(r.rolname,jsonb_build_object('databaseCreate',has_database_privilege(r.oid,current_database(),'CREATE'),'databaseTemp',has_database_privilege(r.oid,current_database(),'TEMP'),'connect',has_database_privilege(r.oid,current_database(),'CONNECT'),'schemaCreate',has_schema_privilege(r.oid,'yunipals_arena','CREATE'),'schemaUsage',has_schema_privilege(r.oid,'yunipals_arena','USAGE'),'publicCreate',has_schema_privilege(r.oid,'public','CREATE'),'publicUsage',has_schema_privilege(r.oid,'public','USAGE'))) FROM pg_roles r WHERE r.rolname IN (READER,WRITER)))""".replace("READER", quote(READER)).replace("WRITER", quote(WRITER)).replace("OWNER", quote(OWNER)).replace("TARGET", quote(DATABASE))


def catalog():
    return json.loads(run(DATABASE, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;" + catalog_query() + ";ROLLBACK;"))


def validate_roles(rows, expected=None, phase="admitted", passwords=None):
    need(phase in {"admitted", "passwords", "login"} and len(rows) == 3 and {r["name"] for r in rows} == set(ROLES), "exact_three_target_roles_required")
    if expected is not None:
        need({r["name"]: r["oid"] for r in rows} == expected, "owned_role_oids_changed")
    if phase != "admitted":
        need(isinstance(passwords, dict) and set(passwords) == {WRITER, READER} and all(re.fullmatch("[0-9a-f]{64}", x) for x in passwords.values()), "owned_two_scram_hashes_required")
    for r in rows:
        owner = r["name"] == OWNER
        need(r["oid"] > 0 and r["limit"] == (-1 if owner else 2 if r["name"] == WRITER else 32), "exact_target_role_connection_limits_required")
        need(r["login"] is (phase == "login" and not owner) and all(r[k] is False for k in ["inherit", "superuser", "createDb", "createRole", "replication", "bypassRls"]), "negative_role_capabilities_changed")
        need(r["memberships"] == 0 and r["validUntil"] is None and (r["sessions"] == 0 or (phase == "login" and not owner and 0 <= r["sessions"] <= r["limit"])), "owned_role_memberships_or_dormant_sessions_changed")
        need(r["settings"] == (["default_transaction_read_only=on"] if r["name"] == READER else None), "exact_reader_default_readonly_required")
        wanted = None if phase == "admitted" or owner else passwords[r["name"]]
        need(r["passwordSha256"] == wanted and r["scram"] is (wanted is not None), "owned_password_phase_changed")
    return {r["name"]: r["oid"] for r in rows}


def validate_database(db, role_oids, *, accessible=True):
    need(db is not None and db["name"] == DATABASE and db["ownerOid"] == role_oids[OWNER] and db["allowConnections"] is accessible and db["connectionLimit"] == -1 and db["encoding"] == "UTF8" and db["collate"] == db["ctype"] == "C" and db["isTemplate"] is False, "exact_owned_isolated_database_required")
    if accessible:
        want = {(role_oids[OWNER], p) for p in ["CREATE", "CONNECT", "TEMPORARY"]} | {(role_oids[r], "CONNECT") for r in [WRITER, READER]}
        need({(a["grantee"], a["privilege"]) for a in db["acl"]} == want and all(a["grantor"] == role_oids[OWNER] and not a["grantable"] for a in db["acl"]), "exact_database_connect_without_public_authority_required")


def validate_catalog(doc, expected=None, *, phase="admitted", passwords=None):
    ids = validate_roles(doc["roles"], expected, phase, passwords)
    validate_database(doc["database"], ids)
    need(doc["serverIdentity"]["port"] == 5432 and doc["serverIdentity"]["version"] >= 160000 and re.fullmatch("[0-9]+", doc["serverIdentity"]["systemIdentifier"]), "actual_public_target_postmaster_identity_required")
    need(len(doc["schemas"]) == 2 and {r["name"] for r in doc["schemas"]} == {"public", "yunipals_arena"}, "exact_public_only_schema_set_required")
    schema = next(r for r in doc["schemas"] if r["name"] == "yunipals_arena")
    need(schema["owner"] == ids[OWNER] and len(doc["tables"]) == 4 and {t["name"] for t in doc["tables"]} == set(TABLES) and doc["otherRelations"] == doc["functions"] == doc["defaultAclCount"] == 0, "only_four_public_tables_no_private_functions_relations_or_default_acl")
    for dependency in doc["roleDependencies"]:
        need(dependency["roleOid"] in ids.values() and (dependency["databaseOid"] == doc["database"]["oid"] or (dependency["databaseOid"] == 0 and dependency["class"] == "pg_database" and dependency["objectOid"] == doc["database"]["oid"])), "explicit_foreign_database_role_dependency_refused")
    for r in [WRITER, READER]:
        need(doc["privileges"][r] == {"databaseCreate": False, "databaseTemp": False, "connect": True, "schemaCreate": False, "schemaUsage": True, "publicCreate": False, "publicUsage": False}, "least_privilege_target_authority_required")
    for t in doc["tables"]:
        need(t["owner"] == ids[OWNER] and t["kind"] == "r" and not t["rls"] and not t["forceRls"] and t["triggers"] == 0 and all(c["acl"] is None for c in t["columns"]) and all(i["valid"] and i["ready"] for i in t["indexes"]), "exact_owned_untriggered_public_table_required")
        want = {(ids[OWNER], p) for p in ["INSERT", "SELECT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]} | {(ids[READER], "SELECT")} | {(ids[WRITER], p) for p in (["SELECT", "INSERT"] if t["name"] == "chain_event" else ["SELECT", "INSERT", "UPDATE"])}
        need({(a["grantee"], a["privilege"]) for a in t["acl"]} == want and all(a["grantor"] == ids[OWNER] and not a["grantable"] for a in t["acl"]), "exact_finite_direct_public_grants_required")
    return ids


def graph(doc, phase="admitted"):
    value = copy.deepcopy(doc)
    value.pop("empty", None)
    # PUBLIC authority in other databases is disclosed, not revoked or claimed
    # globally absent. Explicit foreign grant/ownership edges are always refused.
    value.pop("ambientDatabaseAuthority", None)
    for r in value["roles"]:
        r.pop("sessions")
        r.pop("passwordSha256")
        r.pop("scram")
        r["login"] = phase == "login" and r["name"] != OWNER
    return value


class Lines:
    def __init__(self, process):
        self.process, self.pending, self.deadline = process, b"", time.monotonic() + 35

    def next(self):
        while b"\n" not in self.pending:
            left = self.deadline - time.monotonic()
            need(left > 0 and select.select([self.process.stdout.fileno()], [], [], left)[0], "bounded_transaction_ack_timeout")
            data = os.read(self.process.stdout.fileno(), 65536)
            need(data and len(self.pending) + len(data) < 2000000, "bounded_transaction_ack_required")
            self.pending += data
        line, self.pending = self.pending.split(b"\n", 1)
        return line


def boundary(name, database, raw, query, validate, *, directory=None):
    directory = BASE if directory is None else directory
    need(raw.startswith("BEGIN;") and raw.endswith("COMMIT;\n") and raw.count("COMMIT;") == 1 and not re.search(r"(?m)^\s*\\", raw), "single_pinned_transaction_required")
    save(directory / (name + "-intent.json"), {"sqlSha256": sha(raw.encode()), "automaticRetryAllowed": False})
    proc = subprocess.Popen(peer_args(database, write=True), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV)
    lines = Lines(proc)
    try:
        proc.stdin.write((raw[:-8] + transaction_doc(query) + "\n\\echo PUBLIC_TARGET_PREPARED\n").encode())
        proc.stdin.flush()
        docs = []
        while True:
            row = lines.next()
            if row == b"PUBLIC_TARGET_PREPARED":
                break
            if row.strip():
                docs.append(json.loads(row))
        need(len(docs) == 1 and docs[0]["sessionUser"] == docs[0]["currentUser"] == PEER_USER, "reset_fixed_postgres_peer_required")
        prepared = docs[0]
        need(re.fullmatch("[1-9][0-9]*", prepared["xid"] or ""), "actual_assigned_transaction_id_required")
        validate(prepared["value"])
        save(directory / (name + "-prepared.json"), prepared)
        save(directory / (name + "-commit-intent.json"), {"xid": prepared["xid"], "preparedSha256": sha(encoded(prepared))})
        proc.stdin.write(b"COMMIT;\n\\echo PUBLIC_TARGET_COMMIT_ACK\n")
        proc.stdin.flush()
        need(lines.next() == b"PUBLIC_TARGET_COMMIT_ACK", "explicit_commit_ack_required_no_retry")
        proc.stdin.close()
        proc.stdin = None
        out, err = proc.communicate(timeout=5)
        need(proc.returncode == 0 and not out.strip() and not err and not lines.pending.strip(), "clean_commit_ack_required")
        result = {"commitOutcome": "commit_confirmed", "xid": prepared["xid"], "preparedSha256": sha(encoded(prepared)), "sqlSha256": sha(raw.encode())}
        save(directory / (name + "-result.json"), result)
        return prepared["value"], result
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.communicate(timeout=5)


def access_sql():
    return "BEGIN;SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='15s';SET LOCAL ROLE " + OWNER + ";REVOKE ALL ON DATABASE " + DATABASE + " FROM PUBLIC;GRANT CONNECT ON DATABASE " + DATABASE + " TO " + WRITER + "," + READER + ";RESET ROLE;ALTER DATABASE " + DATABASE + " ALLOW_CONNECTIONS true;\nCOMMIT;\n"


def review():
    need(not os.path.lexists(BASE), "fresh_owned_attempt_required")
    p = proposal()
    context = initial_context()
    need(all(not os.path.lexists(path) for path in p["privateFiles"].values()), "new_owner_credential_paths_must_be_absent")
    return {"format": FORMAT, "operatorSha256": sha(Path(__file__).read_bytes()), "proposalSha256": PROPOSAL_SHA, "sqlSha256": p["sql"], "context": context, "database": DATABASE, "roleNames": ROLES, "privateFilesAbsent": p["privateFiles"], "databaseBoundariesAtomic": False, "serviceChanges": 0, "operationalWrites": 0}


def make_receipt(binding, doc, parts):
    ids = validate_catalog(doc)
    need(doc["empty"] is True, "new_public_target_must_be_empty_at_admission")
    return {"format": FORMAT, "commitOutcome": "commit_confirmed", "operatorSha256": binding["operatorSha256"], "proposalSha256": PROPOSAL_SHA, "rolesSqlSha256": binding["sqlSha256"]["roles.sql"], "schemaSqlSha256": binding["sqlSha256"]["schema.sql"], "reviewHash": sha(encoded(binding)), "database": {**doc["database"], "port": 5432}, "serverIdentity": doc["serverIdentity"], "schema": {"name": "yunipals_arena", "oid": next(s["oid"] for s in doc["schemas"] if s["name"] == "yunipals_arena")}, "tables": {t["name"]: t["oid"] for t in doc["tables"]}, "ownerRole": {"name": OWNER, "oid": ids[OWNER]}, "writerRole": {"name": WRITER, "oid": ids[WRITER]}, "readerRole": {"name": READER, "oid": ids[READER]}, "catalogSha256": sha(encoded(graph(doc))), "catalog": doc, "perBoundary": parts, "maintenanceDatabaseOid": 17584, "operationalDatabaseOid": 2303669, "emptyAtAdmission": True, "loginEnabled": False, "privateFileWrites": 0, "privateTables": 0, "migrationInvocations": 0, "serviceChanges": 0, "sourceSelectionsChanged": 0, "databaseBoundariesAtomic": False}


def admit(expected):
    binding = review()
    need(re.fullmatch("[0-9a-f]{64}", expected) and sha(encoded(binding)) == expected, "fresh_exact_review_required_before_any_write")
    BASE.mkdir(mode=0o700)
    save(BASE / "intent.json", binding)
    role_rows, role_part = boundary("roles", MAINTENANCE, protected(HERE / "roles.sql").decode(), roles_query(), validate_roles)
    ids = validate_roles(role_rows)
    create = "CREATE DATABASE " + DATABASE + " WITH OWNER " + OWNER + " TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' ALLOW_CONNECTIONS false;\n"
    save(BASE / "database-create-intent.json", {"sqlSha256": sha(create.encode()), "ownerRole": {"name": OWNER, "oid": ids[OWNER]}, "rolePreparedSha256": role_part["preparedSha256"], "unknownOutcomeRequiresReadOnlyReconciliation": True})
    run(MAINTENANCE, create, write=True)
    db = current_database()
    validate_database(db, ids, accessible=False)
    create_part = {"commitOutcome": "commit_confirmed", "acknowledgement": "create_command_ack_and_fresh_owned_database_oid", "databaseOid": db["oid"], "ownerOid": ids[OWNER], "sqlSha256": sha(create.encode())}
    save(BASE / "database-create-result.json", create_part)
    access, access_part = boundary("database-access", MAINTENANCE, access_sql(), database_query(), lambda value: validate_database(value, ids))
    need(access["oid"] == db["oid"], "created_database_oid_changed")
    doc, schema_part = boundary("schema", DATABASE, protected(HERE / "schema.sql").decode(), catalog_query(), lambda value: validate_catalog(value, ids))
    current = catalog()
    validate_catalog(current, ids)
    need(graph(current) == graph(doc), "committed_catalog_changed")
    result = make_receipt(binding, current, {"roles": role_part, "databaseCreate": create_part, "databaseAccess": access_part, "schema": schema_part})
    save(BASE / "result.json", result)
    return result


def owned_passwords(receipt, phase):
    auth_base = CREDENTIAL_BASE
    setup_raw = protected(auth_base / "setup-result.json")
    setup = json.loads(setup_raw)
    credential_helper_sha = sha(protected(HERE / "credentials.py"))
    need(setup.get("format") == "yunipals-arena-public-rollback-credentials-v1" and setup.get("operatorSha256") == credential_helper_sha and setup.get("targetResultSha256") == sha(protected(BASE / "result.json")) and setup.get("writerRole") == receipt["writerRole"] and setup.get("readerRole") == receipt["readerRole"], "actual_owned_password_setup_receipt_required")
    paths = proposal()["privateFiles"]
    need(set(setup["credentialFiles"]) == set(paths.values()), "exact_two_owned_target_credential_files_required")
    for path, pin in setup["credentialFiles"].items():
        raw = protected(Path(path), 10000)
        need(sha(raw) == pin and metadata(Path(path).lstat()) == setup["credentialIdentities"][path] and stat.S_IMODE(Path(path).stat().st_mode) == 0o600, "actual_owned_target_credential_file_changed")
    if phase == "login":
        auth = json.loads(protected(auth_base / "auth-result.json"))
        need(auth.get("format") == "yunipals-arena-public-rollback-auth-v1" and auth.get("operatorSha256") == credential_helper_sha and auth.get("targetOperatorSha256") == receipt["operatorSha256"] and auth.get("targetResultSha256") == setup["targetResultSha256"] and auth.get("setupResultSha256") == sha(setup_raw) and auth.get("writerRole") == receipt["writerRole"] and auth.get("readerRole") == receipt["readerRole"] and auth.get("credentialFiles") == setup["credentialFiles"] and auth.get("passwordVerifierSha256") == setup["passwordVerifierSha256"] and all(auth.get(k) is True for k in ["credentialsConfigured", "loginEnabled", "tcpAuthenticationProven", "grantsVerified"]), "actual_acknowledged_target_authentication_required")
    return setup["passwordVerifierSha256"]


def validate_target(receipt, *, auth_phase="admitted", password_sha256=None):
    """Read-only shared verifier. No role/file/connection phase is performed."""
    need(receipt.get("format") == FORMAT and receipt.get("commitOutcome") == "commit_confirmed" and receipt.get("operatorSha256") == sha(Path(__file__).read_bytes()) and receipt.get("proposalSha256") == PROPOSAL_SHA, "actual_same_owner_target_admission_required")
    stored = load_saved(BASE / "result.json")
    need(stored == receipt and all(b.get("commitOutcome") == "commit_confirmed" for b in receipt["perBoundary"].values()), "protected_complete_admission_receipt_required")
    if auth_phase != "admitted" and password_sha256 is None:
        password_sha256 = owned_passwords(receipt, auth_phase)
    ids = {r["name"]: r["oid"] for r in [receipt["ownerRole"], receipt["writerRole"], receipt["readerRole"]]}
    doc = catalog()
    validate_catalog(doc, ids, phase=auth_phase, passwords=password_sha256)
    need(graph(doc, auth_phase) == graph(receipt["catalog"], auth_phase), "actual_target_object_or_acl_identity_changed")
    return {"format": FORMAT, "validated": True, "phase": auth_phase, "databaseOid": doc["database"]["oid"], "tables": receipt["tables"], "writerRole": receipt["writerRole"], "readerRole": receipt["readerRole"], "catalogSha256": sha(encoded(graph(doc, auth_phase))), "ambientDatabaseAuthority": doc["ambientDatabaseAuthority"], "globalPublicAuthorityRevoked": False, "databaseWrites": 0}


def reconcile():
    binding = load_saved(BASE / "intent.json")
    need(binding["operatorSha256"] == sha(Path(__file__).read_bytes()) and binding["proposalSha256"] == PROPOSAL_SHA, "same_exact_owned_attempt_required")
    statuses = {}
    for name in ["roles", "database-access", "schema"]:
        p = BASE / (name + "-commit-intent.json")
        if p.exists():
            intent = load_saved(p)
            status = run(MAINTENANCE, "BEGIN READ ONLY;SELECT pg_xact_status(" + quote(intent["xid"]) + "::xid8);ROLLBACK;").strip().decode()
            need(status in {"committed", "aborted", "in progress"}, "retained_actual_transaction_status_required")
            statuses[name] = status
    rows = current_roles()
    prepared_path = BASE / "roles-prepared.json"
    ids = None
    role_prefix = "absent_unprepared" if not rows and not prepared_path.exists() else "unowned_or_partial"
    if prepared_path.exists():
        prepared = load_saved(prepared_path)
        prepared_ids = validate_roles(prepared["value"])
        if not rows and statuses.get("roles") == "aborted":
            role_prefix = "aborted_and_absent"
        elif rows:
            ids = validate_roles(rows, prepared_ids)
            role_prefix = "exact_prepared_roles_present"
    db = current_database()
    database_owned = False
    if db is not None:
        need(ids is not None, "database_without_acknowledged_owned_role_prefix_requires_manual_review")
        validate_database(db, ids, accessible=db["allowConnections"])
        database_owned = True
    # This command never retries DDL, drops a database, completes an unknown
    # partial attempt or fabricates an admission result. Preserve every receipt.
    return {"format": FORMAT, "reconciliation": True, "rolePrefix": role_prefix, "ownedRoleOids": ids, "observedRoleCount": len(rows), "database": db, "databaseOwned": database_owned, "transactionStatus": statuses, "schemaPrepared": (BASE / "schema-prepared.json").exists(), "actions": 0, "automaticRetryAllowed": False, "manualExactBoundaryRecoveryRequired": not (BASE / "result.json").exists()}


def main():
    global PHASE
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply", help="Exact fresh admission review hash; separate authorization is required.")
    modes.add_argument("--reconcile", action="store_true")
    modes.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(240)
    lock = os.open("/run/lock/yunipals-arena-public-rollback-target-v1.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        s = os.fstat(lock)
        need(stat.S_ISREG(s.st_mode) and s.st_uid == 0 and s.st_nlink == 1 and stat.S_IMODE(s.st_mode) == 0o600, "owned_target_lease_required")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        PHASE = "readonly_review" if not args.apply else "new_isolated_target_admission"
        if args.reconcile:
            value = reconcile()
        elif args.verify:
            value = validate_target(load_saved(BASE / "result.json"))
        elif args.apply:
            value = admit(args.apply)
        else:
            value = review()
            value = {"format": FORMAT, "reviewHash": sha(encoded(value)), "review": value, "applied": False, "persistentChanges": 0}
        print(json.dumps(value, sort_keys=True))
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "status": "refused", "phase": PHASE, "fixedCode": str(error) if isinstance(error, Refusal) else "bounded_target_admission_failed", "errorClass": type(error).__name__, "rawMessagesExported": False, "automaticRetryAllowed": False}, sort_keys=True))
        raise SystemExit(1)
