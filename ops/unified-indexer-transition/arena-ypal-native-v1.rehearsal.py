#!/usr/bin/env python3
"""Fixed nine-role admission rehearsal. Default read-only; no commit mode."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import subprocess
import types

FORMAT = "yunipals-arena-ypal-admission-rehearsal-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
HISTORICAL_OP = Path("/opt/yunipals-unified/operations/arena-native-admission-20261022/operational-roles.current.sql.review")
CATALOG_FILE = Path("/var/backups/yunipals-arena-ypal-catalog-v1-20261024/result.json")
CATALOG_HELPER = OPS / "arena-ypal-native-v1.catalog.py"
CATALOG_HELPER_SHA = "933c3357ae1c231012f24d9235ec6a97fb2e7db2f1a5ce1046adbf9e6cdb1430"
RESTORE = Path("/opt/yunipals-unified/operations/free-replay-20261020/yunipals-arena-runtime-restore-v1-20261022.py")
RESTORE_SHA = "505a4937867abdc623b7d21367bf76a42ecea4a103d374116dbb3181fb60febb"
PINS = {'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80', 'operational-roles.current.sql.review': '310b817daf1ee7254e54d21a783334638d3ef58aee3c430dd10f4991a704d9b3', 'arena-ypal-native-v1.source.sql.review': 'a045f16cd35135d6ae60c522f39bbefe50a683d57906482e78597edec9ca1c45'}
NO_PASSWORD = Path("/run/yunipals-arena-admission-rehearsal-no-password")
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TZ": "UTC", "PYTHONDONTWRITEBYTECODE": "1"}
TARGETS = [(15438, "yunipals_arena"), (5432, "yunipals_backfill")]


class RehearsalFailure(RuntimeError):
    pass


def need(value, code):
    if not value:
        raise RehearsalFailure(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def read(path, pin=None, maximum=500000):
    path = Path(path)
    for ancestor in [*path.parents, path]:
        s = ancestor.lstat()
        need(s.st_uid == 0 and not stat.S_ISLNK(s.st_mode) and not s.st_mode & 0o022, "protected_fixed_public_input_required")
    s = path.lstat()
    need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_size <= maximum, "bounded_regular_public_input_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        raw = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    identity = lambda x: (x.st_dev, x.st_ino, x.st_size, x.st_mtime_ns, x.st_ctime_ns)
    need(identity(s) == identity(before) == identity(after) == identity(path.lstat()) and len(raw) <= maximum and (pin is None or sha(raw) == pin), "exact_public_input_bytes_required")
    return raw


def module(path, pin):
    raw = read(path, pin)
    value = types.ModuleType("admission_" + Path(path).stem)
    value.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), value.__dict__)
    return value


def rollback_sql(raw):
    need(raw.endswith(b"COMMIT;\n") and raw.count(b"COMMIT;") == 1, "single_exact_final_commit_required")
    # The authenticated SQL contains no psql commands or alternate terminators.
    need(not re.search(rb"(?mi)^\s*\\|\b(?:ROLLBACK|ABORT|END\s*TRANSACTION|PREPARE\s+TRANSACTION)\s*;", raw), "no_other_transaction_or_psql_command_required")
    return raw[:-8] + b"ROLLBACK;\n"


def run(argv, data, timeout=8):
    result = subprocess.run(argv, input=data, capture_output=True, env=ENV, timeout=timeout)
    need(result.returncode == 0 and not result.stderr and len(result.stdout) <= 100000, "bounded_clean_peer_command_failed")
    return result.stdout


def peer_args(port, database, *, write=False):
    need((port, database) in TARGETS and not os.path.lexists(NO_PASSWORD), "fixed_peer_target_and_absent_password_path_required")
    account = pwd.getpwnam("postgres")
    need(account.pw_uid > 0 and account.pw_gid > 0, "existing_nonroot_postgres_peer_required")
    options = "-c statement_timeout=15000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=15000 -c default_transaction_read_only=" + ("off" if write else "on")
    return ["/usr/bin/setpriv", "--reuid=" + str(account.pw_uid), "--regid=" + str(account.pw_gid), "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "HOME=/nonexistent", "USER=postgres", "LOGNAME=postgres", "PGHOST=/var/run/postgresql", "PGPORT=" + str(port), "PGDATABASE=" + database, "PGUSER=postgres", "PGPASSFILE=" + str(NO_PASSWORD), "PGAPPNAME=arena_native_admission_rollback_rehearsal", "PGOPTIONS=" + options, "/usr/bin/psql", "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"]


def catalog(port, database, roles):
    names = json.dumps(roles).replace("'", "''")
    text = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
SELECT jsonb_build_object('databaseOid',(SELECT oid::int FROM pg_database WHERE datname=current_database()),
 'roleCount',(SELECT count(*) FROM pg_roles WHERE rolname IN(SELECT jsonb_array_elements_text('NAMES'::jsonb))),
 'transactionReadOnly',current_setting('transaction_read_only')='on',
 'schemaAcl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('oid',n.oid::int,'owner',n.nspowner::int,'acl',n.nspacl::text) ORDER BY n.oid),'[]'::jsonb) FROM pg_namespace n WHERE n.nspname IN(SCHEMAS)),
 'relationAcl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('oid',c.oid::int,'owner',c.relowner::int,'acl',c.relacl::text,'columnAcl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('n',a.attnum,'acl',a.attacl::text) ORDER BY a.attnum),'[]'::jsonb) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.oid),'[]'::jsonb) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN(SCHEMAS)),
 'functionAcl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('oid',p.oid::int,'owner',p.proowner::int,'acl',p.proacl::text) ORDER BY p.oid),'[]'::jsonb) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN(SCHEMAS)),
 'databaseAcl',(SELECT datacl::text FROM pg_database WHERE datname=current_database()));
ROLLBACK;
""".replace("NAMES", names).replace("SCHEMAS", "'yunipals_arena'" if port == 15438 else "'unified_ypal_20261023_v1','yunipals_indexer_control'")
    value = json.loads(run(peer_args(port, database), text.encode()))
    need(value["roleCount"] == 0 and value["transactionReadOnly"] is True and value["databaseOid"] == (2303669 if port == 15438 else 17584), "fresh_absent_role_catalog_required")
    return value


def context(proposal):
    source = source_ambient()
    r = module(RESTORE, RESTORE_SHA)
    m = r.load_owner()
    o = m.observer()
    result = json.loads(r.read(o, r.PARENT / "result.json"))
    need(sha(r.read(o, r.PARENT / "result.json")) == proposal["current"]["ownerResultSha256"] == r.RESULT_SHA, "acknowledged_owner11_result_required")
    binding = json.loads(r.read(o, r.PARENT / "review.json"))
    need(sha(m.encoded(binding)) == proposal["current"]["ownerReviewHash"] == r.OWNER_REVIEW and result["reviewHash"] == r.OWNER_REVIEW, "acknowledged_owner11_review_required")
    restored_raw = r.read(o, r.BASE / "result.json")
    restored = json.loads(restored_raw)
    need(sha(r.encoded(restored)) == proposal["current"]["restoreResultSha256"] and restored["restored"] is True and restored["originalActors"] == proposal["current"]["actors"], "acknowledged_original_actor_restore_required")
    base = json.loads(o.read(r.OPS / "arena-config-public-baseline-v1.json", 200000)[0])
    need(sha(o.read(r.OPS / "arena-config-public-baseline-v1.json", 200000)[0]) == o.BASELINE_SHA, "fixed_original_baseline_required")
    graph = r.graph(m, o, base, binding, owned=False)
    need(graph == proposal["current"]["definitions"], "original_definition_graph_changed")
    actors = {}
    for row in base["services"]:
        props = r.props(m, row["unit"])
        need(props["ActiveState"] == "active" and props["SubState"] == "running", "retained_original_actor_must_remain_running")
        actors[row["unit"]] = {"invocation": props["InvocationID"], "process": m.process_identity(props, row)}
    need(actors == proposal["current"]["actors"], "retained_original_actor_identity_changed")
    m.verify_inputs(o, binding["privateInputHashes"])
    r.no_jobs(m)
    for row in proposal["filesAbsent"]:
        need(not os.path.lexists(row["path"]), "native_private_overlay_must_remain_absent")
    return {"actorsSha256": sha(encoded(actors)), "definitionsSha256": sha(encoded(graph)), "privateInputsUnchanged": True, "privateOverlaysAbsent": 9, "ownerResultSha256": r.RESULT_SHA, "restoreResultSha256": sha(r.encoded(restored)), "sourceCatalogSha256": source["sourceCatalogSha256"], "sourceAmbientSha256":source["sourceAmbientSha256"]}


def source_ambient():
    input_raw=read(OPS/'arena-ypal-native-v1.proposal.json',PINS['arena-ypal-native-v1.proposal.json']);value=json.loads(input_raw)
    need(value['sourceCatalogFile']==str(CATALOG_FILE) and value['sourceCatalogSha256']=='938a9821e266b79c5963f0f66ffc52a9a301bc908d8a870744feeed9272a4083','actual_938a_source_catalog_required')
    saved=json.loads(read(CATALOG_FILE,value['sourceCatalogSha256'],1000000))
    helper=module(CATALOG_HELPER,CATALOG_HELPER_SHA)
    need(saved['format']==helper.FORMAT and saved['operatorSha256']==CATALOG_HELPER_SHA and saved['sqlSha256']==sha(helper.sql().encode()),'exact_readonly_new_source_catalog_producer_required')
    current=json.loads(run(peer_args(5432,'yunipals_backfill'),helper.sql().encode(),timeout=12))
    # Only ambient PUBLIC database/schema rights are inherited by this NOINHERIT
    # role. Other reader role grants are separate owners' phase transitions.
    # Our exact direct CONNECT/USAGE is independently bound by the prepared graph.
    def ambient(doc):
        import copy
        doc=copy.deepcopy(doc);role=next((r['oid']for r in doc['sourceRole']if r['name']=='arena_native_reader'),None)
        doc.pop('sourceRole');doc.pop('readOnly');doc.pop('isolation')
        for row in [doc['database'],*doc['schemas']]:row['acl']=[a for a in row['acl']if a['granteeOid']==0]
        return doc
    need(ambient(current)==ambient(saved['catalog']),'actual_new_source_ambient_function_defaultACL_or_identity_changed')
    funcs=[{'oid':f['oid'],'securityDefiner':f['securityDefiner']}for f in current['functions']if any(a['granteeOid']==0 and a['privilege']=='EXECUTE'for a in f['acl'])]
    need(all(not f['securityDefiner']for f in funcs),'PUBLIC_security_definer_in_new_scope_requires_separate_review')
    return {'sourceCatalogSha256':value['sourceCatalogSha256'],'sourceAmbientSha256':sha(encoded(ambient(current))),'publicNonDefinerFunctions':funcs,'inputSha256':sha(input_raw)}


def load_proposal():
    proposal=json.loads(read(OPS/'arena-ypal-native-v1.proposal.json',PINS['arena-ypal-native-v1.proposal.json']))
    ambient=source_ambient();need(proposal['sourceReader']['existingAmbientAuthority']['publicNonDefinerFunctions']==ambient['publicNonDefinerFunctions'],'same_actual_75963762_and75963763_PUBLIC_invokers_required')
    return proposal


def inspect():
    proposal=load_proposal()
    need(proposal['sourceContext']['releaseId']=='0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3' and proposal['sourceContext']['schemaOid']==75963410 and proposal['sourceContext']['nativePolicy']=='latest' and proposal['sourceContext']['applicationBufferBlocks']==0,'exact_new_source_proposal_required')
    need(sum(len(w['requiredEdges'])for w in proposal['workers'])==227 and len(proposal['sourceReader']['tables'])==13 and len({r['name']for r in proposal['sourceReader']['tables']})==13,'same_logical_227_and13_edges_required')
    sqls=[read(HISTORICAL_OP,PINS['operational-roles.current.sql.review']),read(OPS/'arena-ypal-native-v1.source.sql.review',PINS['arena-ypal-native-v1.source.sql.review'])]
    need(b'unified_shadow_'not in sqls[1]and b'75963410'in sqls[1],'old_source_namespace_is_not_admissible')
    for raw in sqls:rollback_sql(raw)
    roles=[[w['role']for w in proposal['workers']],[proposal['sourceReader']['role']]]
    before=[catalog(*target,names)for target,names in zip(TARGETS,roles)]
    binding={'format':FORMAT,'operatorSha256':sha(Path(__file__).read_bytes()),'proposalSha256':PINS['arena-ypal-native-v1.proposal.json'],'context':context(proposal),'catalogSha256':[sha(encoded(row))for row in before],'sourceAmbient':source_ambient()}
    return proposal,sqls,roles,before,binding


def rehearse(proposal, sqls, roles, before, binding, review_hash):
    need(review_hash == sha(encoded(binding)), "fresh_exact_readonly_review_required")
    completed = []
    for target, raw, names, baseline in zip(TARGETS, sqls, roles, before):
        need(context(proposal) == binding["context"] and catalog(*target, names) == baseline, "retained_context_or_catalog_changed")
        payload = rollback_sql(raw)
        output = run(peer_args(*target, write=True), payload, timeout=45)
        need(not output.strip(), "unexpected_rehearsal_query_output")
        need(not os.path.lexists(NO_PASSWORD) and catalog(*target, names) == baseline, "rollback_role_or_acl_catalog_changed")
        completed.append({"port": target[0], "database": target[1], "sqlSha256": sha(raw), "rollbackSqlSha256": sha(payload), "rolesAbsentAfterRollback": len(names), "catalogUnchanged": True})
    need(context(proposal) == binding["context"], "retained_context_changed_after_rehearsal")
    return {"format": FORMAT, "status": "rollback_rehearsal_passed", "reviewHash": review_hash, "rehearsals": completed, "persistentRoleOrGrantChanges": 0, "loginChanges": 0, "privateFileWrites": 0, "serviceJobs": 0, "schemaMigrations": 0, "sourceSelectionsChanged": 0, "providerCalls": 0, "inTransactionEffectiveRoleProof": False, "automaticRetryAllowed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rehearse", metavar="READONLY_REVIEW_SHA256")
    args = parser.parse_args()
    os.umask(0o077)
    os.environ.clear()
    os.environ.update(ENV)
    need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main" and Path(__file__) == OPS / "arena-ypal-native-v1.rehearsal.py", "fixed_root_host_and_staged_helper_required")
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
    signal.alarm(180)
    try:
        proposal, sqls, roles, before, binding = inspect()
        if args.rehearse:
            result = rehearse(proposal, sqls, roles, before, binding, args.rehearse)
        else:
            result = {"format": FORMAT, "status": "readonly_review_passed", "reviewHash": sha(encoded(binding)), "binding": binding, "roleChanges": 0, "serviceJobs": 0, "privateFileWrites": 0, "providerCalls": 0}
        print(json.dumps(result, sort_keys=True))
    finally:
        signal.alarm(0)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "status": "failed", "errorClass": type(error).__name__, "fixedCode": str(error) if isinstance(error, RehearsalFailure) else "fixed_rehearsal_operation_failed", "rawMessagesExported": False, "automaticRetryAllowed": False, "manualRoleAndAclReconciliationRequired": True}, sort_keys=True))
        raise SystemExit(1)
