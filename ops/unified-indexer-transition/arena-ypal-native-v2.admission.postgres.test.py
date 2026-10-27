#!/usr/bin/env python3
"""Real local PG16 catalog + interactive psql commit-ack proof; synthetic only."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
from unittest.mock import patch

HERE = Path(__file__).parent
CONTAINER = "yunipals-unified-indexer-test-20261020"
DOCKER = ["/usr/bin/docker", "--host=unix:///var/run/docker.sock"]
DATABASE = "arena_admission_source_" + str(os.getpid())
ROLE = "arena_admission_reader_" + str(os.getpid())
ENV = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}


def module(path):
    m = types.ModuleType(path.stem); m.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), "exec"), m.__dict__)
    return m


def command(args, data=b""):
    value = subprocess.run(args, input=data, capture_output=True, env=ENV, timeout=20)
    assert value.returncode == 0 and not value.stderr and len(value.stdout) < 1000000, "fixed_local_fixture_command_failed"
    return value.stdout


def args(database):
    return ["/usr/bin/env", "PGUSER=unified_test", *DOCKER, "exec", "-i", CONTAINER, "psql", "-U", "unified_test", "-d", database, "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"]


def sql(database, text):
    return command(args(database), text.encode())


def qi(value):
    return '"' + value.replace('"', '""') + '"'


def main():
    shape = json.loads(command([*DOCKER, "inspect", "--format", '{"image":{{json .Config.Image}},"ports":{{json .NetworkSettings.Ports}}}', CONTAINER]))
    assert shape["image"] == "postgres:16.15"
    assert shape["ports"]["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": "56967"}]
    assert sql("postgres", "SELECT count(*) FROM pg_roles WHERE rolname='" + ROLE + "';").strip() == b"0"
    h = module(HERE / "arena-ypal-native-v1.rehearsal.py")
    m = module(HERE / "arena-ypal-native-v2.admission.py")
    inv = module(HERE.parent / "unified-indexer-transition/arena-operational-role-inventory-v1.py")
    proposal = json.loads((HERE / "arena-ypal-native-v1.proposal.json").read_bytes())
    proposal = copy.deepcopy(proposal)
    proposal["sourceReader"]["role"] = ROLE
    schemas = [s["name"] for s in proposal["sourceTarget"]["schemas"]]
    names = [r["name"] for r in proposal["sourceReader"]["tables"]]
    created = False
    try:
        sql("postgres", "CREATE DATABASE " + qi(DATABASE) + ";")
        created = True
        schema_sql = "".join("CREATE SCHEMA " + qi(s) + ";" for s in schemas)
        table_sql = "".join("CREATE TABLE " + ".".join(map(qi, n.split("."))) + "(fixture integer);" for n in names)
        functions = [schemas[0] + ".fixture_invoker_a", schemas[0] + ".fixture_invoker_b"]
        function_sql = "".join("CREATE FUNCTION " + ".".join(map(qi, n.split("."))) + "() RETURNS integer LANGUAGE sql SECURITY INVOKER AS 'SELECT 1';" for n in functions)
        sql(DATABASE, schema_sql + table_sql + function_sql)
        meta = json.loads(sql(DATABASE, "SELECT jsonb_build_object('schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'oid',oid::int,'ownerOid',nspowner::int) ORDER BY nspname) FROM pg_namespace WHERE nspname IN('" + "','".join(schemas) + "')),'tables',(SELECT jsonb_agg(jsonb_build_object('name',n.nspname||'.'||c.relname,'oid',c.oid::int,'ownerOid',c.relowner::int) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('" + "','".join(schemas) + "')AND c.relkind='r'),'functions',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid::int,'securityDefiner',p.prosecdef) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('" + "','".join(schemas) + "')));").decode())
        proposal["sourceTarget"]["schemas"] = meta["schemas"]
        proposal["sourceReader"]["tables"] = meta["tables"]
        proposal["sourceReader"]["existingAmbientAuthority"]["publicNonDefinerFunctions"] = meta["functions"]
        payload = ("BEGIN;CREATE ROLE " + qi(ROLE) + " NOLOGIN PASSWORD NULL NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32;GRANT CONNECT ON DATABASE " + qi(DATABASE) + " TO " + qi(ROLE) + ";GRANT USAGE ON SCHEMA " + ",".join(map(qi, schemas)) + " TO " + qi(ROLE) + ";GRANT SELECT ON " + ",".join(".".join(map(qi, n.split("."))) for n in names) + " TO " + qi(ROLE) + ";SET LOCAL ROLE " + qi(ROLE) + ";RESET ROLE;\nCOMMIT;\n").encode()
        # A missing RESET is a real SQL failure: the restricted role cannot
        # read pg_authid, and its uncommitted CREATE/grants must roll back.
        with tempfile.TemporaryDirectory(prefix="arena-admission-no-reset-") as directory:
            with patch.object(m, "BASE", Path(directory)), patch.object(h, "peer_args", return_value=args(DATABASE)), patch.object(h, "module", return_value=inv), patch.object(h, "context", return_value={"fixture": True}), patch.object(h, "read", side_effect=lambda path, pin, *other:(HERE.parent / "arena-native-admission-20261022/operational-roles.current.sql.review").read_bytes() if Path(path).name=="operational-roles.current.sql.review" else (HERE / Path(path).name).read_bytes()):
                try:
                    m.boundary(h, proposal, "source", payload.replace(b"RESET ROLE;\nCOMMIT",b"\nCOMMIT"), {"reviewHash": "a" * 64, "context": {"fixture": True}})
                except h.RehearsalFailure:
                    pass
                else:
                    raise AssertionError("Nonprivileged pg_authid query unexpectedly passed")
            assert sql("postgres", "SELECT count(*) FROM pg_roles WHERE rolname='" + ROLE + "';").strip() == b"0"
            assert not (Path(directory) / "source-prepared.json").exists()
        with tempfile.TemporaryDirectory(prefix="arena-admission-ack-") as directory:
            original_read = h.read
            with patch.object(m, "BASE", Path(directory)), patch.object(h, "peer_args", return_value=args(DATABASE)), patch.object(h, "module", return_value=inv), patch.object(h, "context", return_value={"fixture": True}), patch.object(h, "read", side_effect=lambda path, pin, *other:(HERE.parent / "arena-native-admission-20261022/operational-roles.current.sql.review").read_bytes() if Path(path).name=="operational-roles.current.sql.review" else (HERE / Path(path).name).read_bytes()):
                result = m.boundary(h, proposal, "source", payload, {"reviewHash": "a" * 64, "context": {"fixture": True}})
                assert result["commitOutcome"] == "commit_confirmed"
                prepared = json.loads((Path(directory) / "source-prepared.json").read_bytes())
                current = m.current_catalog(h, proposal, "source")
                m.validate_catalog(h, proposal, "source", current, result["roles"])
                assert m.graph(current) == m.graph(prepared["catalog"])
                assert len(current["roles"][0]["requiredGrants"]) == 13
                # Real unexpected SQL authority is rejected, then restored only
                # inside this owned disposable database for the next check.
                sql(DATABASE, "GRANT UPDATE ON " + ".".join(map(qi, names[0].split("."))) + " TO " + qi(ROLE) + ";")
                try:
                    m.validate_catalog(h, proposal, "source", m.current_catalog(h, proposal, "source"), result["roles"])
                except h.RehearsalFailure:
                    pass
                else:
                    raise AssertionError("Actual extra UPDATE was accepted")
                sql(DATABASE, "REVOKE UPDATE ON " + ".".join(map(qi, names[0].split("."))) + " FROM " + qi(ROLE) + ";")
                # SQL auth phase checks use a synthetic local-only SCRAM value;
                # neither plaintext nor verifier is printed or stored in repo.
                sql(DATABASE, "ALTER ROLE " + qi(ROLE) + " PASSWORD 'synthetic-local-admission-only';")
                authed = m.current_catalog(h, proposal, "source")
                pins = {ROLE: authed["markers"]["auth"][ROLE]["passwordSha256"]}
                m.validate_catalog(h, proposal, "source", authed, result["roles"], phase="passwords", password_sha256=pins)
                sql(DATABASE, "ALTER ROLE " + qi(ROLE) + " LOGIN;")
                authed = m.current_catalog(h, proposal, "source")
                m.validate_catalog(h, proposal, "source", authed, result["roles"], phase="login", password_sha256=pins)
                assert m.graph(authed) == m.expected_graph(prepared["catalog"], "login")
                sql(DATABASE, "ALTER ROLE " + qi(ROLE) + " NOLOGIN PASSWORD NULL;")
        print(json.dumps({"format": "yunipals-arena-ypal-admission-local-pg-proof-v2", "passed": True, "postgres": "16.15", "actualInteractivePsqlCommitAcknowledged": True, "restrictedAuthQueryWithoutResetRejected": True, "sessionUserEqualsResetCurrentUser": True, "preparedOidsDurableBeforeCommit": True, "actualSourceReads": 13, "actualExtraUpdateRejected": True, "ownedScramAndLoginPhasesPassed": True, "fixtureOnly": True, "productionActions": 0}, sort_keys=True))
    finally:
        if created:
            sql("postgres", "DROP DATABASE " + qi(DATABASE) + " WITH (FORCE);")
            sql("postgres", "DROP ROLE IF EXISTS " + qi(ROLE) + ";")


if __name__ == "__main__":
    main()
