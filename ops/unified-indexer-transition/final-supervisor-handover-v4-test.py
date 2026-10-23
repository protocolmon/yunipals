#!/usr/bin/env python3
"""Retained handover protocol regressions plus exact proxy-ACK source admission."""
import importlib.util
import ast
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import tempfile
import types
from pathlib import Path
from unittest import TestCase, TestLoader, TestSuite, TextTestRunner
from unittest.mock import patch

HERE = Path(__file__).parent

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

h = module("handover_v4", "final-supervisor-handover-v4.py")
ACK = "add6d4fbeaacb500bdd8f61dcf0d57e66a85ec7e0f4451ef71beba1b103fd49d"
ORIGINAL = "e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f"
KIND = "normal-free-proxy-qualified-base1"

class ImmutableDelta(TestCase):
    def test_all_functions_and_acceptance_gates_match_v3_with_only_four_binding_constants(self):
        previous=module("historical_final_v3","final-supervisor-handover-v3.py")
        def functions(filename):
            tree=ast.parse((HERE/filename).read_text())
            return {node.name:ast.dump(node,include_attributes=False) for node in tree.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))}
        self.assertEqual(functions("final-supervisor-handover-v3.py"),functions("final-supervisor-handover-v4.py"))
        def constants(filename):
            tree=ast.parse((HERE/filename).read_text())
            return {node.targets[0].id:ast.dump(node.value,include_attributes=False) for node in tree.body if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name)}
        a,b=constants("final-supervisor-handover-v3.py"),constants("final-supervisor-handover-v4.py")
        self.assertEqual({key for key in a if a[key]!=b[key]},{"EVIDENCE","CONSUMER_OPERATOR_SHA","FEATURE_HELPER","FEATURE_HELPER_SHA"})
        self.assertEqual(h.CHECKS,previous.CHECKS)
        self.assertEqual(len(h.CHECKS),10)
        self.assertEqual(len(h.INSTALL_UNITS),4)
        self.assertIn("nativeArenaAdoptedAndCurrent",h.CHECKS)
        self.assertIn("financialDutyAcknowledged",h.CHECKS)
        self.assertEqual(h.SOURCE_BINDINGS,previous.SOURCE_BINDINGS)
        self.assertEqual(h.SOURCE_BINDINGS[ACK]["helperSha256"],"8f95600ddb4bc788be223e35559dba147bf9b219e5243698da84dd95cdc04658")


class QualifiedSource(TestCase):
    def fixture(self, mutation=None, reject=False):
        runtime = {"pid":716994,"startTicks":6611794751,"invocation":"c3463c9a2e1240e8890e318ba1360cf4",
                   "startMonotonicMicroseconds":66117947533239}
        link = {"file":"/etc/systemd/system/multi-user.target.wants/"+h.SOURCE_UNIT,"inode":400,"device":2}
        receipt = {"format":"yunipals-source6-normal-proxy-requalification-v1","acknowledged":True,
                   "runtime":runtime,"originalRuntimeReceiptSha256":ORIGINAL,"bootLink":link,
                   "nativeIdentity":{"schema":h.SCHEMA,"schemaOid":"73004622","buildId":h.BUILD,
                   "catalogSha256":"d9f3d0988229ad954cc8d4e1f34878c5882c4026b024a25885bd45dd30564b76"}}
        validated = {"validated":True,"qualificationReceiptSha256":ACK,"originalRuntimeReceiptSha256":ORIGINAL,
                     "runtime":runtime,"bootLink":link,"freeOnly":True,"paidAuthority":False,
                     "normalOperationalRuntime":"infinity","financialWindowRenewed":False,
                     "sourceRestarted":False,"nativeCaughtUpClaimed":False,"originalWholeValidationPassed":False,
                     "financialExpiresAt":(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat()}
        if mutation: mutation(receipt, validated)
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        # A real protected fixture file supplies its own producer hash. No
        # injected import namespace or repeated self-referential source rewrite.
        return runtime,receipt,validated,boot

    def invoke(self, mutation=None, reject=False, tamper=False):
        runtime,receipt,validated,boot=self.fixture(mutation,reject)
        with tempfile.TemporaryDirectory(prefix=".qualified-source-v4-",dir=HERE)as directory:
            helper=Path(directory)/"qualified-source.py"
            program=("import types,hashlib\nfrom pathlib import Path\n"
              "def modules():return None,None,None,types.SimpleNamespace(BOOT="+repr(boot)+")\n"
              "def validate_current(pin):\n"
              +(" raise RuntimeError('current_proxy_or_source_changed')\n"if reject else
                " assert pin=="+repr(ACK)+"\n value="+repr(validated)+"\n value['operatorSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()\n return value\n")).encode()
            helper.write_bytes(program)
            producer=h.sha(program);receipt["operatorSha256"]=producer
            binding={"file":str(Path(directory)/"qualified-result.json"),"helper":str(helper),"helperSha256":producer,"kind":KIND}
            plan={"sourceRecovery":{"file":binding["file"],"sha256":ACK},"sourceHelperSha256":producer}
            if tamper:helper.write_bytes(program+b"# replaced after review\n")
            with patch.dict(h.SOURCE_BINDINGS,{ACK:binding}),patch.object(h,"document",return_value=receipt):
                return h.current_source(plan)

    def test_actual_binding_is_exact_and_historical_bindings_remain(self):
        b=h.SOURCE_BINDINGS[ACK]
        self.assertEqual(b["kind"],KIND)
        self.assertEqual(b["helperSha256"],"8f95600ddb4bc788be223e35559dba147bf9b219e5243698da84dd95cdc04658")
        self.assertEqual(b["file"],"/var/backups/yunipals-source6-normal-proxy-requalification-v1-20261023/result.json")
        self.assertIn(ORIGINAL,h.SOURCE_BINDINGS)
        self.assertNotEqual(h.EVIDENCE.name,"yunipals-final-supervisor-handover-v2")

    def test_explicit_qualification_keeps_owned_boot_link_without_claiming_old_pass(self):
        v=self.invoke();self.assertEqual(v["kind"],KIND);self.assertIsNotNone(v["bootLink"])
        self.assertIs(v["originalWholeValidationPassed"],False);self.assertIs(v["nativeCaughtUpClaimed"],False)
        self.assertEqual(v["runtime"]["pid"],716994)

    def test_live_source_or_proxy_drift_refuses_without_old_validator_fallback(self):
        with self.assertRaisesRegex(RuntimeError,"current_proxy_or_source_changed"):self.invoke(reject=True)

    def test_qualification_does_not_admit_authority_renewal_or_source_replacement(self):
        mutations=[("paidAuthority",True),("freeOnly",False),("financialWindowRenewed",True),
                   ("sourceRestarted",True),("nativeCaughtUpClaimed",True),("originalWholeValidationPassed",True),
                   ("qualificationReceiptSha256","0"*64),("originalRuntimeReceiptSha256","0"*64),
                   ("runtime",{"pid":42}),("bootLink",None),
                   ("financialExpiresAt",(datetime.now(timezone.utc)+timedelta(minutes=5)).isoformat())]
        for k,v in mutations:
            with self.subTest(field=k), self.assertRaises(RuntimeError):
                self.invoke(lambda receipt,proof:proof.update({k:v}))

    def test_changed_helper_bytes_refuse_before_execution(self):
        with self.assertRaisesRegex(RuntimeError,"actual_direct_source_successor_binding_required"):
            self.invoke(tamper=True)

    def test_wrong_native_catalog_and_unacknowledged_receipt_refuse(self):
        for change in [lambda r,v:r["nativeIdentity"].update({"schemaOid":"9"}),
                       lambda r,v:r.update({"acknowledged":False}),
                       lambda r,v:r.update({"originalRuntimeReceiptSha256":"0"*64})]:
            with self.assertRaises(RuntimeError):self.invoke(change)

def test_current_feature_binding(self):
    self.assertEqual(h.FEATURE_HELPER.name,"booster-feature-handover-v7.py")
    self.assertEqual(h.sha((HERE/h.FEATURE_HELPER.name).read_bytes()),h.FEATURE_HELPER_SHA)
    self.assertNotEqual(h.FEATURE_HELPER_SHA,"3dc1889e9d0cf9233d71324c7b1a4af88da7bd5bd103f9b44d756aaab91e4e50")
    feature=module("actual_current_feature",h.FEATURE_HELPER.name)
    self.assertEqual(feature.TARGET_OIDS['booster_event'],'73032629')
    self.assertEqual(len(feature.ADDITIONS),8)
    self.assertEqual(feature.BASE.name,"yunipals-booster-feature-handover-v7-20261023")


def test_current_entry_and_feature_share_actual_producer(self):
    entry=module("current_booster_consumer_entry","consumer-operational-live-booster-v2.py")
    previous=module("retained_marketplace_entry","consumer-operational-marketplace-ack-v2.py");previous.OPS=HERE.absolute()
    with patch.object(entry,"load",return_value=previous):installer=entry.core("install")
    self.assertEqual(installer.FORMAT,h.CONSUMER_FORMAT)
    self.assertEqual(Path(installer.__file__),HERE.absolute()/"consumer-operational-live-booster-v2.py")
    self.assertEqual(h.sha(Path(installer.__file__).read_bytes()),h.CONSUMER_OPERATOR_SHA)
    feature=module("actual_current_feature_loader",h.FEATURE_HELPER.name)
    self.assertEqual(feature.DEPS[Path(installer.__file__).name],h.CONSUMER_OPERATOR_SHA)
    self.assertEqual(feature.DEPS[previous.HISTORY],previous.HISTORY_SHA)
    self.assertEqual(h.sha((HERE/previous.HISTORY).read_bytes()),previous.HISTORY_SHA)
    self.assertFalse(entry.proof()["currentObservationsNormalized"])
    self.assertEqual(entry.proof()["launchReadCount"],10)
    self.assertEqual(entry.proof()["format"],"yunipals-current-booster-feature-binding-v2")
    self.assertTrue(entry.proof()["recentOpeningsVerified"])
    self.assertEqual(entry.proof()["apiBundleSha256"],"41fe9b9cb87edaa5689ed611cd2c99b299215be7c8fb6262b560660854657c73")
    self.assertEqual(entry.proof()["apiUnitSha256"],"5ae76b4b54b359dc63cd9b990b227a32e4c984255308e1cd90982fa7de146414")
    self.assertEqual(entry.proof()["rolloutReceiptSha256"],"6f2b288741503d2f5d34ee9ba4563d0215b9144b2b6b22cc38f2763378799080")
    self.assertNotEqual(h.CONSUMER_OPERATOR_SHA,previous.CORES["install"][1])


def test_current_feature_inverse_requires_ten_preserved_reads(self):
    program=b"# frozen read-only current feature owner fixture\n";pin=h.sha(program)
    ref={"file":"/root/actual-feature-inverse","sha256":"a"*64}
    receipt={"format":"yunipals-booster-feature-inverse-v1","operatorSha256":pin,
      "retirementReceiptSha256":"b"*64,"restoredSchema":"yunipals_boosters_launch_v1","publicReady":True}
    proof={**self.restored(),"operatorSha256":pin,"inverseReceiptSha256":ref["sha256"],
      "oldTenReadsPreserved":True,"priorTwoTargetReadsPreserved":True}
    fixture=types.ModuleType("fixed_current_feature_fixture");calls=[]
    fixture.validate_inverse=lambda path,pin:calls.append((path,pin))or proof
    with patch.object(h,"FEATURE_HELPER_SHA",pin),patch.object(h,"document",return_value=receipt),patch.object(h,"read",return_value=program)as read,patch.object(h.types,"ModuleType",return_value=fixture):
        self.assertEqual(h.feature_inverse(ref,"b"*64),proof)
        self.assertEqual(calls,[(ref["file"],ref["sha256"])])
        read.reset_mock()
        with self.assertRaisesRegex(RuntimeError,"actual_matching_owned_feature_inverse"):h.feature_inverse(ref,"c"*64)
        read.assert_not_called()
        proof.pop("oldTenReadsPreserved");proof['oldNineReadsPreserved']=True
        with self.assertRaisesRegex(RuntimeError,"fresh_owned_feature_inverse_validation"):h.feature_inverse(ref,"b"*64)


if __name__=="__main__":
    suite=TestSuite([TestLoader().loadTestsFromTestCase(ImmutableDelta),TestLoader().loadTestsFromTestCase(QualifiedSource)])
    for filename in ["final-supervisor-handover-v2-test.py","final-supervisor-handover-v2-boot-test.py"]:
        prior=module("retained_"+filename.replace('-','_'),filename)
        prior.h=h
        if filename=="final-supervisor-handover-v2-test.py":
            case=prior.CoordinatedInverseAndTypedUnits
            case.test_feature_binding_is_peer_qualified_immutable_v5_and_not_superseded_owners=test_current_feature_binding
            case.test_receipt_producer_and_feature_loader_share_exact_marketplace_ack_entry=test_current_entry_and_feature_share_actual_producer
            case.test_feature_inverse_loads_only_reviewed_owner_and_same_forward_retirement=test_current_feature_inverse_requires_ten_preserved_reads
        suite.addTests(TestLoader().loadTestsFromModule(prior))
    raise SystemExit(not TextTestRunner(verbosity=1).run(suite).wasSuccessful())
