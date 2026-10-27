#!/usr/bin/env python3
"""Exact ACL/auth phases and real local child-protocol controls; no DB/host call."""
import copy
import contextlib
import io
import os
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent

def load(name):
    p = HERE / name
    module = types.ModuleType(p.stem); module.__file__ = str(p)
    exec(compile(p.read_bytes(), str(p), "exec"), module.__dict__)
    return module

m = load("commit-admission.py")
h = load("rollback-rehearsal.py")
proposal = json.loads((HERE / "proposal.current.json").read_bytes())


def fixture(scope):
    names, edges, schemas = m.expected(proposal, scope)
    source = {r["name"]: r for r in proposal["sourceReader"]["tables"]}
    import re
    text = (HERE / "operational-roles.current.sql.review").read_text()
    op = {name: int(oid) for name, oid in re.findall(r"'(yunipals_arena\.[a-z_]+)',([0-9]+)", text)}
    relations = [{"name": name, "oid": op[name] if scope == "operational" else source[name]["oid"], "ownerOid": 2303667 if scope == "operational" else source[name]["ownerOid"], "kind": "r", "rowSecurity": False, "columns": {}} for name in sorted({e["relation"] for e in edges})]
    rels = {r["name"]: r for r in relations}
    schema_pins = {"yunipals_arena": (2303670, 2303667), "unified_shadow_20261020_7e7375b0": (73004622, 73004621), "yunipals_indexer_control": (73011094, 10)}
    oids = {name: 980000+i for i,name in enumerate(names)}
    rows = []
    for name in names:
        oid=oids[name]
        limit=next(w["connectionLimit"]for w in proposal["workers"]if w["role"]==name)if scope=="operational"else 32
        row={"name":name,"oid":oid,"exists":True,"attributes":{"login":False,"superuser":False,"inherit":False,"createDb":False,"createRole":False,"replication":False,"bypassRls":False,"connectionLimit":limit},"membershipEdges":0,"sessions":0,"databaseConnect":True,"databaseCreate":False,"databaseTemp":scope=="source","schemaPrivileges":{s:{"oid":schema_pins[s][0],"usage":True,"create":False,"owns":False}for s in schemas},"requiredGrants":[],"extraTablePrivilegeCount":0,"extraColumnPrivilegeCount":0,"ownedRelationCount":0,"ownedFunctionCount":0,"sequencePrivilegeCount":0,"securityDefinerExecuteCount":0,"functionExecuteCount":0 if scope=="operational"else 2,"directRelationAcl":[],"directColumnAcl":[],"directSchemaAcl":[{"schema":s,"granteeOid":oid,"privilege":"USAGE","grantorOid":schema_pins[s][1],"grantOption":False}for s in schemas],"functionAclIncludingDefaults":[]}
        for e in edges:
            if e["role"]!=name:continue
            row["requiredGrants"].append({k:v for k,v in {**e,"relation_oid":rels[e["relation"]]["oid"],"attnum":None if e["attribute"]is None else 1,"effective":True}.items()if k!="role"})
            acl={"relation":e["relation"],"granteeOid":oid,"privilege":e["privilege"],"grantorOid":rels[e["relation"]]["ownerOid"],"grantOption":False}
            if e["attribute"]is not None:acl["attribute"]=e["attribute"]
            row["directRelationAcl"if e["attribute"]is None else"directColumnAcl"].append(acl)
        rows.append(row)
    doc={"readOnly":True,"isolation":"repeatable read","roles":rows,"relations":relations,"publicExecutableFunctions":[]if scope=="operational"else proposal["sourceReader"]["existingAmbientAuthority"]["publicNonDefinerFunctions"],"markers":{"backendPid":123,"sessionUser":"postgres","currentUser":"postgres","backendStart":"2026-10-23 00:00:00+00","auth":{name:{"passwordPresent":False,"scram":False,"passwordSha256":None}for name in names}}}
    return doc,oids


class Admission(unittest.TestCase):
    def setUp(self):
        self.read = patch.object(h,"read",side_effect=lambda path,pin,*args:(HERE/Path(path).name).read_bytes())
        self.read.start()
        self.addCleanup(self.read.stop)

    def test_frozen_current_source_and_dependency_pins(self):
        self.assertEqual(hashlib.sha256((HERE/"rollback-rehearsal.py").read_bytes()).hexdigest(),m.RUNNER_SHA)
        self.assertEqual(hashlib.sha256((HERE.parent/"unified-indexer-transition/arena-operational-role-inventory-v1.py").read_bytes()).hexdigest(),m.INVENTORY_SHA)

    def test_operational_reset_precedes_private_auth_query_and_exact_peer_is_checked(self):
        raw=(HERE/"operational-roles.current.sql.review").read_bytes()
        self.assertTrue(raw[:-8].rstrip().endswith(b"RESET ROLE;"))
        doc,_=fixture("source")
        m.peer_identity(h,["PGUSER=postgres"],doc)
        for session,current in[("postgres","owner"),("other","other")]:
            changed=copy.deepcopy(doc);changed["markers"].update(sessionUser=session,currentUser=current)
            with self.assertRaises(h.RehearsalFailure):m.peer_identity(h,["PGUSER=postgres"],changed)

    def test_exact_227_and13_shapes_validate_without_broad_authority(self):
        for scope,count in[("operational",227),("source",13)]:
            doc,oids=fixture(scope)
            result=m.validate_catalog(h,proposal,scope,doc,oids)
            self.assertEqual(result["requiredEdges"],count)

    def test_initial_null_to_owned_scram_to_login_only_changes_expected_auth(self):
        for scope in m.SCOPES:
            original,oids=fixture(scope)
            current=copy.deepcopy(original)
            pins={name:"a"*64 for name in oids}
            for name in oids:current["markers"]["auth"][name]={"passwordPresent":True,"scram":True,"passwordSha256":pins[name]}
            m.validate_catalog(h,proposal,scope,current,oids,phase="passwords",password_sha256=pins)
            self.assertEqual(m.graph(current),m.expected_graph(original,"passwords"))
            for row in current["roles"]:row["attributes"]["login"]=True;row["sessions"]=1
            m.validate_catalog(h,proposal,scope,current,oids,phase="login",password_sha256=pins)
            self.assertEqual(m.graph(current),m.expected_graph(original,"login"))
            self.assertFalse(original["roles"][0]["attributes"]["login"])
            self.assertTrue(m.graph(current)["roles"][0]["attributes"]["login"])
            current["roles"][0]["directRelationAcl"][0]["grantOption"]=True
            self.assertNotEqual(m.graph(current),m.expected_graph(original,"login"))
            with self.assertRaises(h.RehearsalFailure):m.validate_catalog(h,proposal,scope,current,oids,phase="login",password_sha256=pins)

    def test_actual_verify_current_interface_accepts_owned_auth_phases_without_acl_changes(self):
        original={scope:fixture(scope)[0]for scope in m.SCOPES}
        op=fixture("operational")[1];source=fixture("source")[1];name=next(iter(source))
        prepared={scope:{"roles":fixture(scope)[1],"catalog":original[scope]}for scope in m.SCOPES}
        operator=h.sha(Path(m.__file__).read_bytes())
        receipt={"format":m.FORMAT,"commitOutcome":"commit_confirmed","proposalSha256":h.PINS["proposal.current.json"],"operatorSha256":operator,"reviewHash":"a"*64,"roles":op,"sourceRole":{"name":name,"oid":source[name]},"operationalDatabaseOid":2303669,"sourceDatabaseOid":17584,"sqlSha256":{},"perDatabase":{}}
        for scope,sql in[("operational","operational-roles.current.sql.review"),("source","source-reader.current.sql.review")]:
            receipt["sqlSha256"][scope]=h.PINS[sql]
            receipt["perDatabase"][scope]={"commitOutcome":"commit_confirmed","sqlSha256":h.PINS[sql],"roles":prepared[scope]["roles"],"preparedSha256":h.sha(h.encoded(prepared[scope]))}
        def stored(_,path):
            if path.name=="intent.json":return{"reviewHash":"a"*64,"operatorSha256":operator}
            return prepared[path.name.split("-")[0]]
        pins={name:"a"*64 for name in [*op,*source]}
        for phase in["admitted","passwords","login"]:
            current=copy.deepcopy(original)
            for scope in m.SCOPES:
                for row in current[scope]["roles"]:
                    row["attributes"]["login"]=phase=="login"
                    current[scope]["markers"]["auth"][row["name"]]={"passwordPresent":phase!="admitted","scram":phase!="admitted","passwordSha256":None if phase=="admitted"else pins[row["name"]]}
            with patch.object(m,"runner",return_value=h),patch.object(m,"saved",side_effect=stored),patch.object(m,"current_catalog",side_effect=lambda _,p,s:current[s]):
                self.assertTrue(m.verify_current(receipt,phase=phase,password_sha256=None if phase=="admitted"else pins)["validated"])
                current["source"]["relations"][0]["ownerOid"]=99
                with self.assertRaises(h.RehearsalFailure):m.verify_current(receipt,phase=phase,password_sha256=None if phase=="admitted"else pins)

    def test_wrong_oid_grantor_edge_elevation_owner_membership_and_password_reject(self):
        original,oids=fixture("operational")
        changes=[lambda d:d["roles"][0].update(oid=7),lambda d:d["roles"][0]["attributes"].update(superuser=True),lambda d:d["roles"][0].update(membershipEdges=1),lambda d:d["roles"][0].update(extraColumnPrivilegeCount=1),lambda d:d["roles"][0]["directRelationAcl"][0].update(grantorOid=10),lambda d:d["roles"][0]["directRelationAcl"].pop(),lambda d:d["roles"][0]["requiredGrants"][0].update(effective=False),lambda d:d["markers"]["auth"][next(iter(oids))].update(passwordPresent=True)]
        for change in changes:
            doc=copy.deepcopy(original);change(doc)
            with self.subTest(change=change),self.assertRaises(h.RehearsalFailure):m.validate_catalog(h,proposal,"operational",doc,oids)

    def test_source_ambient_is_exact_no_definer_or_direct_execute(self):
        original,oids=fixture("source")
        for change in[lambda d:d["publicExecutableFunctions"][0].update(securityDefiner=True),lambda d:d["roles"][0]["functionAclIncludingDefaults"].append({"granteeOid":next(iter(oids.values()))}),lambda d:d["roles"][0].update(databaseCreate=True)]:
            doc=copy.deepcopy(original);change(doc)
            with self.assertRaises(h.RehearsalFailure):m.validate_catalog(h,proposal,"source",doc,oids)

    def protocol(self, directory, *, lost_ack=False, context_changed=False):
        base=Path(directory);doc,oids=fixture("source")
        expected={"context":{"same":True},"reviewHash":"a"*64}
        script=r'''import json,sys
from pathlib import Path
base=Path(sys.argv[1]);doc=json.loads(sys.argv[2]);lost=sys.argv[3]=='true'
for line in sys.stdin:
 if line.strip()==r'\echo ARENA_ADMISSION_PREPARED':
  print(json.dumps(doc),flush=True);print('ARENA_ADMISSION_PREPARED',flush=True)
 if line.strip()=='COMMIT;':
  assert(base/'source-prepared.json').is_file() and(base/'source-commit-intent.json').is_file()
  if lost:sys.exit(0)
 if line.strip()==r'\echo ARENA_ADMISSION_COMMIT_ACK':print('ARENA_ADMISSION_COMMIT_ACK',flush=True)
'''
        args=["/usr/bin/env","PGUSER=postgres",sys.executable,"-u","-c",script,str(base),json.dumps(doc),str(lost_ack).lower()]
        with patch.object(m,"BASE",base),patch.object(h,"peer_args",return_value=args),patch.object(m,"catalog_sql",return_value="SELECT fixed_catalog;\n"),patch.object(m,"current_catalog",return_value=doc),patch.object(h,"context",return_value={"same":not context_changed}):
            return m.boundary(h,proposal,"source",(HERE/"source-reader.current.sql.review").read_bytes(),expected)

    def test_real_child_protocol_persists_actual_oids_before_commit_then_ack(self):
        with tempfile.TemporaryDirectory()as d:
            result=self.protocol(d)
            self.assertEqual(result["commitOutcome"],"commit_confirmed")
            self.assertEqual(result["roles"],fixture("source")[1])
            self.assertTrue((Path(d)/"source-result.json").is_file())

    def test_lost_ack_retains_known_prepared_oids_and_commit_intent_no_success(self):
        with tempfile.TemporaryDirectory()as d:
            with self.assertRaises(h.RehearsalFailure):self.protocol(d,lost_ack=True)
            self.assertEqual(json.loads((Path(d)/"source-prepared.json").read_bytes())["roles"],fixture("source")[1])
            self.assertTrue((Path(d)/"source-commit-intent.json").is_file())
            self.assertFalse((Path(d)/"source-result.json").exists())

    def test_changed_actor_before_commit_never_records_commit_intent(self):
        with tempfile.TemporaryDirectory()as d:
            with self.assertRaises(h.RehearsalFailure):self.protocol(d,context_changed=True)
            self.assertTrue((Path(d)/"source-prepared.json").is_file())
            self.assertFalse((Path(d)/"source-commit-intent.json").exists())

    def test_partial_two_database_failure_retains_first_ack_and_never_claims_atomic_success(self):
        with tempfile.TemporaryDirectory()as d:
            base=Path(d)/"attempt"
            binding={"reviewHash":"a"*64,"context":{"same":True}}
            first={"commitOutcome":"commit_confirmed","roles":fixture("operational")[1],"sqlSha256":h.PINS["operational-roles.current.sql.review"]}
            args=["commit-admission.py","--rehearsal-review","b"*64,"--rehearsal-result","c"*64,"--commit","a"*64]
            with patch.object(m,"BASE",base),patch.object(m,"HERE",h.OPS),patch.object(m,"runner",return_value=h),patch.object(m,"review",return_value=(proposal,[b"one",b"two"],binding)),patch.object(m,"boundary",side_effect=[first,RuntimeError("synthetic_lost_second_ack")])as boundary,patch.object(m.socket,"gethostname",return_value="yunipals-main"),patch.object(m.signal,"signal"),patch.object(m.signal,"alarm"),patch.object(sys,"argv",args),patch.dict(os.environ,dict(os.environ),clear=True),contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError):m.main()
            self.assertEqual(boundary.call_count,2)
            failed=json.loads((base/"failed.json").read_bytes())
            self.assertEqual(failed["commitOutcome"],"partial_or_unknown")
            self.assertEqual(failed["acknowledgedDatabaseBoundaries"],{"operational":first})
            self.assertFalse(failed["automaticRetryAllowed"])
            self.assertFalse((base/"result.json").exists())

    def test_reconciliation_requires_exact_prepared_oids_and_terminal_backend_and_is_readonly(self):
        original={scope:fixture(scope)[0]for scope in m.SCOPES}
        prepared={scope:{"roles":fixture(scope)[1],"catalog":original[scope]}for scope in m.SCOPES}
        binding={"operatorSha256":h.sha(Path(m.__file__).read_bytes()),"reviewHash":"a"*64,"context":{"same":True}}
        def stored(_,path):
            if path.name=="intent.json":return binding
            scope=path.name.split("-")[0]
            if path.name.endswith("-prepared.json"):return prepared[scope]
            if path.name.endswith("-commit-intent.json"):
                backend=prepared[scope]["catalog"]["markers"]
                return{"preparedSha256":h.sha(h.encoded(prepared[scope])),"backendPid":backend["backendPid"],"backendStart":backend["backendStart"]}
            return{"reviewHash":binding["reviewHash"],"sqlSha256":h.PINS["operational-roles.current.sql.review"if scope=="operational"else"source-reader.current.sql.review"]}
        for mode in["success","alive_backend","changed_oid"]:
            with self.subTest(mode=mode),tempfile.TemporaryDirectory()as d:
                base=Path(d)
                for scope in m.SCOPES:(base/(scope+"-prepared.json")).write_text("{}")
                current=copy.deepcopy(original)
                if mode=="changed_oid":current["source"]["roles"][0]["oid"]+=1
                queries=[]
                def query(argv,data):
                    queries.append(data)
                    self.assertNotIn(b"COMMIT",data)
                    self.assertIn(b"BEGIN READ ONLY;",data)
                    return b"1\n"if mode=="alive_backend"else b"0\n"
                with patch.object(m,"BASE",base),patch.object(m,"saved",side_effect=stored),patch.object(m,"current_catalog",side_effect=lambda _,p,s:current[s]),patch.object(h,"run",side_effect=query),patch.object(h,"peer_args",return_value=["fixed-readonly-peer"]),patch.object(h,"context",return_value=binding["context"]):
                    if mode=="success":
                        receipt=m.reconcile(h)
                        self.assertEqual(receipt["commitOutcome"],"commit_confirmed")
                        self.assertFalse(receipt["databaseBoundariesAtomic"])
                        self.assertEqual(set(receipt["perDatabase"]),set(m.SCOPES))
                        self.assertTrue((base/"result.json").is_file())
                    else:
                        with self.assertRaises(h.RehearsalFailure):m.reconcile(h)
                        self.assertFalse((base/"result.json").exists())
                self.assertTrue(queries)


if __name__=="__main__":unittest.main()
