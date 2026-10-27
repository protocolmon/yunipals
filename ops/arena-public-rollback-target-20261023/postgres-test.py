#!/usr/bin/env python3
"""Real PG16.15, owned isolated fixture only. No production/provider/service call."""
import importlib.util
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("public_target", HERE / "admit-target.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
cspec = importlib.util.spec_from_file_location("public_target_credentials", HERE / "credentials.py")
c = importlib.util.module_from_spec(cspec)
cspec.loader.exec_module(c)
DOCKER = ["/usr/bin/docker", "--host=unix:///var/run/docker.sock"]
CONTAINER = "yunipals-unified-indexer-test-20261020"
ENV = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}


def command(args, data=b""):
    value = subprocess.run(args, input=data, capture_output=True, env=ENV, timeout=20)
    assert value.returncode == 0 and not value.stderr, "local_fixture_command_failed"
    return value.stdout


def args(database, **kw):
    return [*DOCKER, "exec", "-i", CONTAINER, "psql", "-U", "unified_test", "-d", database, "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"]


def sql(database, text):
    return command(args(database), text.encode())


def absent():
    return json.loads(sql("postgres", "SELECT jsonb_build_object('database',(SELECT oid::int FROM pg_database WHERE datname='" + m.DATABASE + "'),'roles',(SELECT count(*) FROM pg_roles WHERE rolname IN('" + "','".join(m.ROLES) + "')));"))


def cleanup():
    # The exact fresh fixture set is proven absent before this test; only this
    # test creates it. No other database/role or fixture is touched.
    if absent()["database"]:
        sql("postgres", "DROP DATABASE " + m.DATABASE + " WITH (FORCE);")
    for role in m.ROLES:
        sql("postgres", "DROP ROLE IF EXISTS " + role + ";")


def context():
    assert absent() == {"database": None, "roles": 0}
    return {"source": {"fixture": True, "port": 56967}, "operational": {"fixture": True, "port": 15438}}


def rejected(text):
    p = subprocess.run(args(m.DATABASE), input=text.encode(), env=ENV, capture_output=True, timeout=10)
    assert p.returncode != 0 and b"permission denied" in p.stderr, "actual_permission_rejection_required"


def local_auth(h, role, password, text, *, failure=None):
    # Same real SCRAM/TCP identities; this executor has no host psql binary.
    # Use its already installed pg client against the fixed loopback fixture.
    # Password is stdin only, never argv/environment/log output.
    node = "/root/.nvm/versions/node/v24.18.1/bin/node"
    script = """import{createRequire}from'node:module';import{readFileSync}from'node:fs';
const{Client}=createRequire('/root/yunipals/apps/yunipals-market-api/package.json')('pg');
const p=JSON.parse(readFileSync(0,'utf8'));globalThis.fetch=()=>{throw Error('HTTP forbidden')};
const d=new Client({host:'127.0.0.1',port:56967,database:p.database,user:p.role,password:p.password,connectionTimeoutMillis:3000});
try{await d.connect();const q=await d.query(p.sql),r=(Array.isArray(q)?q:[q]).flatMap(x=>x.rows);process.stdout.write(JSON.stringify(r[0]?.jsonb_build_object??{}));}
catch(e){process.stdout.write(JSON.stringify({errorCode:e.code??'unknown'}));process.exitCode=3;}
finally{await d.end();}"""
    result = subprocess.run([node, "--input-type=module", "--eval", script], input=json.dumps({"database": h.DATABASE, "role": role, "password": password, "sql": text}).encode(), env=ENV, capture_output=True, timeout=10)
    assert not result.stderr
    if failure:
        code = "28P01" if failure == "authentication" else failure
        assert result.returncode == 3 and json.loads(result.stdout) == {"errorCode": code}, "actual_target_tcp_denial_required"
        return None
    assert result.returncode == 0, "actual_target_tcp_authentication_required"
    return result.stdout


def main():
    shape = json.loads(command([*DOCKER, "inspect", "--format", '{"image":{{json .Config.Image}},"ports":{{json .NetworkSettings.Ports}}}', CONTAINER]))
    assert shape["image"] == "postgres:16.15" and shape["ports"]["5432/tcp"] == [{"HostIp": "127.0.0.1", "HostPort": "56967"}]
    assert absent() == {"database": None, "roles": 0}, "test_names_must_be_absent"
    with tempfile.TemporaryDirectory(prefix=".public-target-pg-", dir=HERE) as directory:
        root = Path(directory)
        with patch.object(m, "MAINTENANCE", "postgres"), patch.object(m, "PEER_USER", "unified_test"), patch.object(m, "peer_args", side_effect=args), patch.object(m, "initial_context", side_effect=context):
            try:
                # CREATE DATABASE has no enclosing transaction. A deliberately
                # lost command ACK must preserve the newly owned disabled DB,
                # role OIDs and intent, then refuse all automatic retries.
                with patch.object(m, "BASE", root / "lost-create"):
                    original = m.run
                    def lose_create(database, text, **kw):
                        value = original(database, text, **kw)
                        if text.startswith("CREATE DATABASE "):
                            raise m.Refusal("fixture_lost_create_ack")
                        return value
                    binding = m.review()
                    with patch.object(m, "run", side_effect=lose_create):
                        try:
                            m.admit(m.sha(m.encoded(binding)))
                        except m.Refusal as error:
                            assert str(error) == "fixture_lost_create_ack"
                        else:
                            raise AssertionError("Lost CREATE ACK was accepted")
                    status = m.reconcile()
                    assert status["database"]["allowConnections"] is False and status["transactionStatus"]["roles"] == "committed" and status["schemaPrepared"] is False and status["actions"] == 0
                    assert not (m.BASE / "result.json").exists() and not (m.BASE / "database-create-result.json").exists()
                    try:
                        m.admit(m.sha(m.encoded(binding)))
                    except m.Refusal:
                        pass
                    else:
                        raise AssertionError("Unknown partial CREATE was retried")
                cleanup()
                with patch.object(m, "BASE", root / "complete"):
                    binding = m.review()
                    result = m.admit(m.sha(m.encoded(binding)))
                    assert result["commitOutcome"] == "commit_confirmed" and result["emptyAtAdmission"] is True and len(result["tables"]) == 4 and result["loginEnabled"] is False
                    assert len(result["perBoundary"]) == 4 and m.validate_target(result)["validated"] is True
                    assert [x["name"] for x in m.catalog()["tables"]] == m.TABLES
                    assert sql(m.DATABASE, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='yunipals_arena' AND c.relkind='r';").strip() == b"4"
                    assert sql(m.DATABASE, "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='yunipals_arena';").strip() == b"0"
                    deployment = "8453:0xebd141b6ae36f74fe70b9139b262ee9771b72aca"
                    sql(m.DATABASE, "SET ROLE " + m.WRITER + ";INSERT INTO yunipals_arena.deployment(id,contract,start_block)VALUES('" + deployment + "','0xebd141b6ae36f74fe70b9139b262ee9771b72aca',52648146);")
                    rejected("SET ROLE " + m.READER + ";INSERT INTO yunipals_arena.credit VALUES('" + deployment + "','0x" + "1" * 40 + "',1);")
                    for text in ["UPDATE yunipals_arena.chain_event SET event_name='changed'", "DELETE FROM yunipals_arena.tournament", "TRUNCATE yunipals_arena.credit", "CREATE TABLE yunipals_arena.forbidden(id integer)"]:
                        rejected("SET ROLE " + m.WRITER + ";" + text + ";")
                    # Actual extra privilege changes must be rejected, not
                    # hidden by a same-count or effective-only comparison.
                    sql(m.DATABASE, "SET ROLE " + m.OWNER + ";GRANT UPDATE ON yunipals_arena.chain_event TO " + m.WRITER + ";")
                    try:
                        m.validate_target(result)
                    except m.Refusal:
                        pass
                    else:
                        raise AssertionError("Unexpected real chain_event UPDATE was accepted")
                    sql(m.DATABASE, "SET ROLE " + m.OWNER + ";REVOKE UPDATE ON yunipals_arena.chain_event FROM " + m.WRITER + ";")
                    assert m.validate_target(result)["validated"] is True
                    sql(m.DATABASE, "SET ROLE " + m.OWNER + ";ALTER DEFAULT PRIVILEGES IN SCHEMA yunipals_arena GRANT SELECT ON TABLES TO " + m.READER + ";")
                    try:
                        m.validate_target(result)
                    except m.Refusal:
                        pass
                    else:
                        raise AssertionError("Unexpected actual default ACL was accepted")
                    sql(m.DATABASE, "SET ROLE " + m.OWNER + ";ALTER DEFAULT PRIVILEGES IN SCHEMA yunipals_arena REVOKE SELECT ON TABLES FROM " + m.READER + ";")
                    # An explicit grant is detected even when existing PUBLIC
                    # CONNECT already makes that privilege effective elsewhere.
                    sql("postgres", "GRANT CONNECT ON DATABASE postgres TO " + m.READER + ";")
                    try:
                        m.validate_target(result)
                    except m.Refusal as error:
                        assert str(error) == "explicit_foreign_database_role_dependency_refused"
                    else:
                        raise AssertionError("Actual foreign database grant was accepted")
                    sql("postgres", "REVOKE CONNECT ON DATABASE postgres FROM " + m.READER + ";")
                    assert m.validate_target(result)["validated"] is True
                    # Shared verifier accepts only its explicitly owned auth
                    # fields; exact original table/schema/ACL OIDs stay fixed.
                    sql("postgres", "ALTER ROLE " + m.WRITER + " PASSWORD 'synthetic-local-target-writer';ALTER ROLE " + m.READER + " PASSWORD 'synthetic-local-target-reader';")
                    rows = m.current_roles()
                    passwords = {r["name"]: r["passwordSha256"] for r in rows if r["name"] != m.OWNER}
                    assert m.validate_target(result, auth_phase="passwords", password_sha256=passwords)["validated"] is True
                    sql("postgres", "ALTER ROLE " + m.WRITER + " LOGIN;ALTER ROLE " + m.READER + " LOGIN;")
                    assert m.validate_target(result, auth_phase="login", password_sha256=passwords)["validated"] is True
                    sql("postgres", "ALTER ROLE " + m.WRITER + " NOLOGIN PASSWORD NULL;ALTER ROLE " + m.READER + " NOLOGIN PASSWORD NULL;")
                    # Simulate losing a real COMMIT response AFTER its durable
                    # prepared XID, then independently query PostgreSQL status.
                    old_next = m.Lines.next
                    def lose_commit(self):
                        value = old_next(self)
                        if value == b"PUBLIC_TARGET_COMMIT_ACK":
                            raise m.Refusal("fixture_lost_commit_ack")
                        return value
                    raw = "BEGIN;SET LOCAL ROLE " + m.WRITER + ";UPDATE yunipals_arena.deployment SET halted=true;RESET ROLE;\nCOMMIT;\n"
                    with patch.object(m.Lines, "next", lose_commit):
                        try:
                            m.boundary("lost-commit", m.DATABASE, raw, m.catalog_query(), m.validate_catalog)
                        except m.Refusal as error:
                            assert str(error) == "fixture_lost_commit_ack"
                        else:
                            raise AssertionError("Lost COMMIT ACK was accepted")
                    prepared = json.loads((m.BASE / "lost-commit-prepared.json").read_bytes())
                    assert sql("postgres", "SELECT pg_xact_status('" + prepared["xid"] + "'::xid8);").strip() == b"committed"
                    assert not (m.BASE / "lost-commit-result.json").exists()
                    assert sql(m.DATABASE, "SELECT halted FROM yunipals_arena.deployment;").strip() == b"t"
                    # Exercise the concrete separate password + LOGIN owners
                    # and actual SCRAM authentication over the fixture's TCP.
                    private_dir = root / "private"
                    private_dir.mkdir(mode=0o700)
                    private_files = {k: str(private_dir / (k + ".env")) for k in ["writer", "reader"]}
                    original_proposal = m.proposal
                    def fixture_proposal():
                        value = copy.deepcopy(original_proposal())
                        value["privateFiles"] = private_files
                        return value
                    with patch.object(c, "BASE", root / "credentials"), patch.object(c, "FILES", private_files), patch.object(c, "auth_probe", side_effect=local_auth), patch.object(m, "CREDENTIAL_BASE", root / "credentials"), patch.object(m, "proposal", side_effect=fixture_proposal):
                        operator = c.Operator(m, result, m.sha(m.encoded(result)))
                        setup = operator.setup(c.sha(c.encoded(operator.review("setup"))))
                        assert setup["loginEnabled"] is False
                        enabled = operator.enable(c.sha(c.encoded(operator.review("enable"))))
                        assert enabled["loginEnabled"] is True
                        auth = operator.authenticate(c.sha(c.encoded(operator.review("auth"))))
                        assert auth["tcpAuthenticationProven"] and len(auth["authentication"]) == 2
                        assert m.validate_target(result, auth_phase="login")["validated"] is True
                        assert all(Path(path).stat().st_mode & 0o777 == 0o600 for path in private_files.values())
                        # Current password drift cannot be normalized away by
                        # an old successful AUTH receipt.
                        sql("postgres", "ALTER ROLE " + m.WRITER + " PASSWORD 'foreign-local-password-change';")
                        try:
                            m.validate_target(result, auth_phase="login")
                        except m.Refusal:
                            pass
                        else:
                            raise AssertionError("Current SCRAM drift was accepted")
                    print(json.dumps({"format": "yunipals-arena-public-rollback-target-local-pg-v1", "passed": True, "postgres": "16.15", "actualTables": 4, "privateTables": 0, "functions": 0, "initiallyEmpty": True, "realAcknowledgedBoundaries": 4, "unknownCreateAckPreservedWithoutRetry": True, "actualCommitAckLossReconciledByXid": True, "readerWritesDenied": True, "writerEventUpdateDeleteTruncateCreateDenied": True, "actualExtraGrantRejected": True, "actualDefaultAclRejected": True, "actualForeignDatabaseGrantRejected": True, "ambientOtherDatabasePublicAuthorityDisclosed": True, "ownedPasswordLoginMetadataPhasesValidated": True, "separateCredentialOwnerAndTwoRealTcpIdentitiesPassed": True, "actualScramDriftRejected": True, "tcpClientFixture": "existing node-pg because executor has no host psql", "operationalDatabaseAccess": False, "providerRequests": 0, "productionActions": 0}, sort_keys=True))
            finally:
                cleanup()


if __name__ == "__main__":
    main()
