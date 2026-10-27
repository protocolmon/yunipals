#!/usr/bin/env python3
"""Bound only the genuine full-publication count to a larger read-only window."""
import ast
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import types

FORMAT = "yunipals-ypal-ordinary-publication-query-v2"
TEMPLATE_SHA = "cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3"
TEMPLATE = Path("/opt/yunipals-unified/operations/free-replay-20261020/ypal-restored-metadata-handover-v1.py")
CANDIDATES = Path("/var/backups/yunipals-ypal-ordinary-metadata-candidates-v5-20261025")
READ_SCHEMA = "yunipals_ownership_4e77f52b_v5"
SENTINEL = "/run/yunipals-managed-handover-no-password-file"
READ_OPTIONS = (
    "-c default_transaction_read_only=on -c statement_timeout=60000 "
    "-c lock_timeout=1000 -c idle_in_transaction_session_timeout=72000"
)
CLEAN = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class CapturedPublicationQuery(Exception):
    def __init__(self, sql):
        self.sql = sql


def code_identity(code):
    return (
        code.co_code, code.co_names, code.co_varnames, code.co_argcount,
        code.co_posonlyargcount, code.co_kwonlyargcount, code.co_flags,
        code.co_freevars, code.co_cellvars, code.co_exceptiontable,
        tuple(code_identity(value) if isinstance(value, types.CodeType) else value
              for value in code.co_consts)
    )


def capture_query(host):
    """Run the unchanged compiler/body until its query seam; return no proof."""
    need(host.meta.READ == READ_SCHEMA, "fixed_V5_publication_read_schema_required")
    raw = host.s.protected(TEMPLATE)
    need(sha(raw) == TEMPLATE_SHA, "genuine_unchanged_metadata_publication_template_required")
    # Compile in its real module/class scope. Python can generate different
    # method bytecode when a class method is extracted as a standalone function.
    compiled = compile(ast.parse(raw), str(TEMPLATE), "exec")
    cls = next(value for value in compiled.co_consts
               if isinstance(value, types.CodeType) and value.co_name == "Host")
    expected = next(value for value in cls.co_consts
                    if isinstance(value, types.CodeType) and value.co_name == "publication_proof")
    body = host.publication_proof.__func__
    need(code_identity(body.__code__) == code_identity(expected) and
         body.__globals__["CANDIDATES"] == CANDIDATES,
         "genuine_unchanged_metadata_publication_body_required")

    def capture(sql):
        raise CapturedPublicationQuery(sql)

    receiver = types.SimpleNamespace(m=host.m, meta=host.meta, query=capture)
    try:
        body(receiver)
    except CapturedPublicationQuery as result:
        sql = result.sql
        need(type(sql) is str and len(sql) < 100000 and
             sql.startswith("SELECT jsonb_build_object('canonicalRows'") and
             READ_SCHEMA in sql and "base_metadata_event" in sql and
             "chain_event_block_hash" in sql,
             "exact_genuine_full_publication_query_required")
        return sql
    raise RuntimeError("publication_capture_must_stop_before_database_query")


def peer_read(sql):
    need(not os.path.lexists(SENTINEL), "absent_publication_peer_password_file_required")
    args = [
        "/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "--no-new-privs",
        "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "TZ=UTC",
        "PGPASSFILE=" + SENTINEL, "PGAPPNAME=ypal_full_publication_readonly",
        "PGOPTIONS=" + READ_OPTIONS, "/usr/bin/psql", "-XwAtq", "-h", "/var/run/postgresql",
        "-p", "5432", "-U", "postgres", "-d", "yunipals_backfill", "-v", "ON_ERROR_STOP=1"
    ]
    identity = (
        "SELECT jsonb_build_object('role',current_user,'database',current_database(),"
        "'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()))"
    )
    payload = ("BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;" + identity + ";" + sql + ";ROLLBACK;").encode()
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, env=CLEAN, cwd="/", start_new_session=True)
    try:
        out, err = process.communicate(payload, timeout=80)
    except BaseException:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise
    need(process.returncode == 0 and not err and len(out) < 100000,
         "bounded_readonly_full_publication_query_failed")
    rows = [json.loads(line) for line in out.splitlines() if line]
    need(len(rows) == 2 and rows[0] == {
        "role": "postgres", "database": "yunipals_backfill", "databaseOid": "17584"
    }, "same_original_publication_peer_database_identity_required")
    result = rows[1]
    need(type(result) is dict and set(result) == {"canonicalRows", "publishedRows", "probe"} and
         all(type(result[key]) is int and result[key] >= 0 for key in ["canonicalRows", "publishedRows"]) and
         type(result["probe"]) is bool and not os.path.lexists(SENTINEL),
         "genuine_typed_publication_counts_and_readiness_required")
    return result


class PublicationQueryPeer:
    """Keep the original host's bound methods; redirect exactly one query."""
    def __init__(self, original, sql):
        self.original = original
        self.sql = sql

    def __getattr__(self, name):
        return getattr(self.original, name)

    def query(self, sql):
        if sql == self.sql:
            return peer_read(sql)
        return self.original.query(sql)


def bind(host):
    need(not isinstance(host.h, PublicationQueryPeer), "publication_query_peer_must_bind_once")
    sql = capture_query(host)
    host.h = PublicationQueryPeer(host.h, sql)
    return {
        "format": FORMAT, "operatorSha256": sha(Path(__file__).read_bytes()),
        "querySha256": sha(sql.encode()), "statementTimeoutMs": 60000,
        "lockTimeoutMs": 1000, "readOnly": True, "otherQueriesUnchanged": True
    }


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "staticOnly": True, "databaseWrites": 0, "serviceActions": 0}))
