"""Offline seven-contract source/constructor/qualification boundary controls."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

import verify_ypal_basescan as v

NODE = "/root/.nvm/versions/node/v24.18.1/bin/node"


def fixture():
    package = json.loads(v.PACKAGE.read_text())
    artwork = json.loads((v.ROOT / "apps/yunipals-home-web/src/lib/fixtures/ypal-approved-art-manifest.json").read_text())
    address = lambda n: "0x" + format(n, "040x")
    digest = lambda n: "0x" + format(n, "064x")
    steps = [*v.STEPS, "metadata", "configure", "activate"]
    return {"format": "yunipals-ypal-fresh-deployment-confirmed-v1", "launchId": "base-ypal-v1",
            "chainId": 8453, "owner": package["owner"], "pmon": package["pmon"],
            "burnAddress": package["burnAddress"], "vrfWrapper": package["vrfWrapper"],
            "ypal": address(1000), "registry": address(1002), "monsters": address(1004), "engine": address(1006),
            "implementations": {"registry": address(1001), "monsters": address(1003), "engine": address(1005)},
            "packTypeId": "1", "packageSha256": v.PACKAGE_SHA, "sourceStartBlock": "102",
            "metadataBaseURI": package["tokenMetadataBasePrefix"] + address(1004) + "/",
            "artworkHash": package["pack"]["artworkHash"], "catalogHash": artwork["catalogHash"],
            "receipts": {step: {"transactionHash": digest(i + 1), "blockNumber": str(100 + i),
                "blockHash": digest(1000 + i), "status": "success",
                "contractAddress": address(1000 + i) if i < 7 else None} for i, step in enumerate(steps)}}


class Verification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.confirmed = Path(cls.temp.name) / "confirmed.json"
        cls.confirmed.write_text(json.dumps(fixture()))
        cls.plan = v.prepare(cls.confirmed, NODE)
        cls.standards, cls.proof = v.reviewed_inputs()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def source(self, entry, *, similar=False, runs=1):
        standard = copy.deepcopy(self.standards[entry["inputKey"]])
        standard["settings"]["optimizer"]["runs"] = runs
        return {"SourceCode": "{" + json.dumps(standard) + "}", "ContractName": entry["contractName"],
                "CompilerVersion": entry["compilerVersion"], "OptimizationUsed": "1", "Runs": str(runs),
                "ConstructorArguments": entry["constructorArguments"],
                "ABI": json.dumps(self.proof["artifacts"][entry["artifactKey"]]["abi"]),
                "SimilarMatch": "0x" + "99" * 20 if similar else "", "Proxy": "1" if entry["implementation"] else "0",
                "Implementation": entry["implementation"] or ""}

    def fresh(self):
        rows = [{key: row[key] for key in ("step", "address", "artifactKey", "contractName", "constructorArguments",
                 "creationInputKeccak256", "runtimeKeccak256", "implementation", "receipt")} for row in self.plan["contracts"]]
        return {"format": "yunipals-ypal-basescan-chain-preparation-v1", "chainQualified": True,
            "packageSha256": v.PACKAGE_SHA, "backendSha256": v.BACKEND_SHA,
            "confirmedManifestFileSha256": self.plan["confirmedManifestFileSha256"], "contracts": rows,
            "publicReadOnlyQualification": {"endpoint": "https://mainnet.base.org", "requestCap": 128,
                "maximumSeconds": 180, "rpcCalls": 2, "methodCounts": {"eth_call": 1, "eth_getStorageAt": 1},
                "retryCount": 0, "financialIndexerProfileUsed": False, "profileChanges": 0,
                "paidProvider": False, "transactionMethodsAllowed": False},
            "qualification": {"format": "yunipals-ypal-backend-chain-qualification-v1", "packageSha256": v.PACKAGE_SHA,
                "currentStateQualified": True, "chainId": 8453, "blockHash": "0x" + "aa" * 32,
                "transactions": [{} for _ in range(10)], "codeHashes": {r["step"]: r["runtimeKeccak256"] for r in rows}}}

    def test_default_sources_only_never_loads_key_or_network(self):
        with patch.object(v, "load_key", side_effect=AssertionError("no key")), patch.object(v, "bridge", side_effect=AssertionError("no RPC")):
            value = v.prepare(None)
        self.assertTrue(value["sourcesReady"])
        self.assertFalse(value["chainQualified"])

    def test_real_offline_bridge_derives_seven_constructor_sets(self):
        self.assertFalse(self.plan["chainQualified"])
        self.assertEqual(len(self.plan["contracts"]), 7)
        self.assertEqual(self.plan["contracts"][0]["constructorArguments"], fixture()["pmon"][2:].lower().rjust(64, "0") + fixture()["burnAddress"][2:].lower().rjust(64, "0"))
        self.assertEqual({r["compilerVersion"] for r in self.plan["contracts"]}, {"v0.8.28+commit.7893614a", "v0.8.30+commit.73712a01"})
        self.assertEqual(sum(bool(r["implementation"]) for r in self.plan["contracts"]), 3)

    def test_bridge_excludes_explorer_and_unrelated_provider_credentials(self):
        result = types.SimpleNamespace(returncode=0, stderr=b"", stdout=b"{}")
        with patch.dict(os.environ, {"ETHERSCAN_API_KEY": "synthetic-key", "ALCHEMY_API_KEY": "synthetic-provider-key"}), patch.object(subprocess, "run", return_value=result) as called:
            v.bridge(self.confirmed, NODE)
        env = called.call_args.kwargs["env"]
        self.assertNotIn("ETHERSCAN_API_KEY", env)
        self.assertNotIn("ALCHEMY_API_KEY", env)

    def test_complete_sources_and_abis_match_all_seven_records(self):
        for entry in self.plan["contracts"]:
            with self.subTest(step=entry["step"]):
                checked = v.validate_record(self.source(entry), entry, self.standards, self.proof)
                self.assertEqual(checked["verificationLevel"], "full")
                self.assertTrue(checked["fullAbiMatch"])
                self.assertTrue(checked["explorerConstructorExact"])

    def test_token_impl_similar_match_and_foreign_constructor_refuse(self):
        for entry in self.plan["contracts"]:
            if not entry["implementation"]:
                with self.assertRaises(ValueError):
                    v.validate_record(self.source(entry, similar=True), entry, self.standards, self.proof)
            changed = self.source(entry); changed["ConstructorArguments"] += "00"
            with self.assertRaises(ValueError):
                v.validate_record(changed, entry, self.standards, self.proof)

    def test_changed_source_abi_and_compiler_settings_refuse(self):
        for entry in self.plan["contracts"]:
            for mode in ("source", "abi", "viaIR", "metadata", "libraries", "compiler"):
                row = self.source(entry)
                published = v.published_input(row)
                if mode == "source": next(iter(published["sources"].values()))["content"] += "\n// changed"
                elif mode == "abi": row["ABI"] = "[]"
                elif mode == "viaIR": published["settings"]["viaIR"] = False
                elif mode == "metadata": published["settings"]["metadata"] = {"bytecodeHash": "ipfs"}
                elif mode == "libraries": published["settings"]["libraries"] = {"x": {"x": "0x" + "11" * 20}}
                else: row["CompilerVersion"] = "v0.8.29"
                row["SourceCode"] = json.dumps(published)
                with self.subTest(step=entry["step"], mode=mode), self.assertRaises(ValueError):
                    v.validate_record(row, entry, self.standards, self.proof)

    def test_only_proxy_may_use_proven_runs200_and_similar_reference_constructor(self):
        proxy = next(r for r in self.plan["contracts"] if r["implementation"])
        row = self.source(proxy, similar=True, runs=200)
        row["ConstructorArguments"] = "11" * 100  # Similar source's constructor is not this deployment's proof.
        checked = v.validate_record(row, proxy, self.standards, self.proof)
        self.assertEqual(checked["verificationLevel"], "similar-proxy")
        self.assertFalse(checked["explorerConstructorExact"])
        for entry in self.plan["contracts"]:
            if not entry["implementation"]:
                with self.assertRaises(ValueError):
                    v.validate_record(self.source(entry, runs=200), entry, self.standards, self.proof)

    def test_similar_proxy_requires_independent_full_reference(self):
        entry = next(r for r in self.plan["contracts"] if r["implementation"])
        with patch.object(v, "record", return_value=self.source(entry, runs=200)) as called:
            checked = v.validate_source("synthetic-key", self.source(entry, similar=True), entry, self.standards, self.proof)
            self.assertTrue(checked["independentFullReferenceSourceChecked"])
            called.assert_called_once()
        with patch.object(v, "record", return_value=self.source(entry, similar=True)), self.assertRaises(ValueError):
            v.validate_source("synthetic-key", self.source(entry, similar=True), entry, self.standards, self.proof)

    def test_proxy_transitive_closure_can_ignore_unrelated_old_source(self):
        entry = next(r for r in self.plan["contracts"] if r["implementation"])
        row = self.source(entry, similar=True)
        published = v.published_input(row)
        published["sources"]["unrelated/OldApplication.sol"] = {"content": "irrelevant to proxy transitive source closure"}
        row["SourceCode"] = json.dumps(published)
        self.assertEqual(v.validate_record(row, entry, self.standards, self.proof)["sourceFilesChecked"], 8)

    def test_public_qualification_requires_exact_endpoint_bounds_and_no_financial_claim(self):
        with patch.object(v, "bridge", return_value=self.fresh()):
            self.assertTrue(v.qualify(self.plan, self.confirmed, NODE)["currentStateQualified"])
        for field, value in (("endpoint", "https://arbitrary.example"), ("paidProvider", True),
                             ("financialIndexerProfileUsed", True), ("rpcCalls", 129),
                             ("methodCounts", {"eth_sendRawTransaction": 2})):
            fresh = self.fresh(); fresh["publicReadOnlyQualification"][field] = value
            with self.subTest(field=field), patch.object(v, "bridge", return_value=fresh), self.assertRaises(ValueError):
                v.qualify(self.plan, self.confirmed, NODE)

    def test_changed_actual_runtime_constructor_or_manifest_refuses(self):
        for mode in ("runtime", "constructor", "manifest"):
            fresh = self.fresh()
            if mode == "runtime": fresh["qualification"]["codeHashes"]["ypal"] = "0x" + "00" * 32
            elif mode == "constructor": fresh["contracts"][0]["constructorArguments"] += "00"
            else: fresh["confirmedManifestFileSha256"] = "00" * 32
            with self.subTest(mode=mode), patch.object(v, "bridge", return_value=fresh), self.assertRaises(ValueError):
                v.qualify(self.plan, self.confirmed, NODE)

    def test_failed_live_qualification_never_loads_key_or_posts(self):
        output = Path(self.temp.name) / "failure" / "basescan-results.json"
        with patch.object(v, "prepare", return_value=self.plan), patch.object(v, "qualify", side_effect=ValueError("not deployed")), patch.object(v, "load_key", side_effect=AssertionError("no key")), patch.object(v, "api", side_effect=AssertionError("no explorer")), self.assertRaises(ValueError):
            v.submit(self.confirmed, self.plan["planSha256"], output, NODE)
        self.assertFalse(output.exists())

    def test_success_rereads_all_records_and_requalifies_chain_without_posts(self):
        entries = {r["address"]: r for r in self.plan["contracts"]}
        def request(_key, action, fields, post=False):
            self.assertEqual(action, "getsourcecode"); self.assertFalse(post)
            return {"status": "1", "result": [self.source(entries[fields["address"]])]}
        output = Path(self.temp.name) / "verified" / "basescan-results.json"
        with patch.object(v, "prepare", return_value=self.plan), patch.object(v, "qualify", return_value=self.fresh()["qualification"]) as q, patch.object(v, "load_key", return_value="synthetic-key"), patch.object(v, "api", side_effect=request) as api:
            report = v.submit(self.confirmed, self.plan["planSha256"], output, NODE)
        self.assertTrue(report["completed"]); self.assertEqual(q.call_count, 2)
        self.assertEqual(len(report["contracts"]), 7); self.assertEqual(len(report["proxies"]), 3)
        self.assertGreaterEqual(api.call_count, 20)

    def test_unverified_source_submission_preserves_exact_compiler_and_constructor(self):
        entries = {r["address"]: r for r in self.plan["contracts"]}; published = set(); submitted = []
        def request(_key, action, fields, post=False):
            entry = entries[fields.get("address") or fields.get("contractaddress")]
            if action == "getsourcecode":
                return {"status": "1", "result": [self.source(entry) if entry["address"] in published else {"SourceCode": ""}]}
            self.assertEqual(action, "verifysourcecode"); self.assertTrue(post)
            self.assertEqual(fields["constructorArguments"], entry["constructorArguments"])
            self.assertEqual(fields["constructorArguements"], entry["constructorArguments"])
            self.assertEqual(fields["compilerversion"], entry["compilerVersion"])
            self.assertEqual(fields["contractname"], entry["contractIdentifier"])
            published.add(entry["address"]); submitted.append(entry["step"])
            return {"status": "1", "result": "synthetic-guid-" + entry["step"]}
        output = Path(self.temp.name) / "submitted" / "basescan-results.json"
        with patch.object(v, "prepare", return_value=self.plan), patch.object(v, "qualify", return_value=self.fresh()["qualification"]), patch.object(v, "load_key", return_value="synthetic-key"), patch.object(v, "api", side_effect=request), patch.object(v, "poll"):
            report = v.submit(self.confirmed, self.plan["planSha256"], output, NODE)
        self.assertEqual(len(submitted), 7); self.assertTrue(report["completed"])
        self.assertTrue(all("guid" in row for row in report["contracts"].values()))

    def test_final_chain_failure_cannot_leave_completed_true(self):
        entries = {r["address"]: r for r in self.plan["contracts"]}
        output = Path(self.temp.name) / "late-failure" / "basescan-results.json"
        output.parent.mkdir(); output.write_text(json.dumps({"format": v.FORMAT, "plan": self.plan, "contracts": {}, "proxies": {}, "completed": True}))
        def request(_key, _action, fields, post=False):
            self.assertFalse(post)
            return {"status": "1", "result": [self.source(entries[fields["address"]])]}
        with patch.object(v, "prepare", return_value=self.plan), patch.object(v, "qualify", side_effect=[self.fresh()["qualification"], ValueError("chain changed")]), patch.object(v, "load_key", return_value="synthetic-key"), patch.object(v, "api", side_effect=request), self.assertRaises(ValueError):
            v.submit(self.confirmed, self.plan["planSha256"], output, NODE)
        self.assertFalse(json.loads(output.read_text())["completed"])

    def test_proxy_association_posts_expected_implementation_and_rechecks_flags(self):
        entries = {r["address"]: r for r in self.plan["contracts"]}; linked = set(); posted = []
        def request(_key, action, fields, post=False):
            entry = entries[fields["address"]]
            if action == "getsourcecode":
                row = self.source(entry)
                if entry["implementation"] and entry["address"] not in linked:
                    row["Proxy"] = "0"  # Even a matching Implementation field requires confirmed proxy metadata.
                return {"status": "1", "result": [row]}
            self.assertEqual(action, "verifyproxycontract"); self.assertTrue(post)
            self.assertEqual(fields["expectedimplementation"], entry["implementation"])
            posted.append(entry["address"]); linked.add(entry["address"])
            return {"status": "1", "result": "synthetic-proxy-guid"}
        output = Path(self.temp.name) / "association" / "basescan-results.json"
        with patch.object(v, "prepare", return_value=self.plan), patch.object(v, "qualify", return_value=self.fresh()["qualification"]), patch.object(v, "load_key", return_value="synthetic-key"), patch.object(v, "api", side_effect=request), patch.object(v, "poll"):
            report = v.submit(self.confirmed, self.plan["planSha256"], output, NODE)
        self.assertEqual(len(posted), 3); self.assertTrue(report["completed"])
        self.assertTrue(all(row["status"] == "linked" for row in report["proxies"].values()))

    def test_existing_source_guid_resumes_poll_without_duplicate_submission(self):
        entries = {r["address"]: r for r in self.plan["contracts"]}
        engine = next(row for row in self.plan["contracts"] if row["step"] == "engineImplementation")
        acknowledged = False
        def request(_key, action, fields, post=False):
            self.assertFalse(post); self.assertEqual(action, "getsourcecode")
            entry = entries[fields["address"]]
            row = self.source(entry) if acknowledged or entry != engine else {"SourceCode": ""}
            return {"status": "1", "result": [row]}
        def poll(_key, action, guid):
            nonlocal acknowledged
            self.assertEqual(action, "checkverifystatus"); self.assertEqual(guid, "owned-prior-guid")
            acknowledged = True
        output = Path(self.temp.name) / "resume" / "basescan-results.json"
        output.parent.mkdir(); output.write_text(json.dumps({"format": v.FORMAT, "plan": self.plan,
            "contracts": {engine["address"]: {"guid": "owned-prior-guid", "status": "pending"}}, "proxies": {}}))
        with patch.object(v, "prepare", return_value=self.plan), patch.object(v, "qualify", return_value=self.fresh()["qualification"]), patch.object(v, "load_key", return_value="synthetic-key"), patch.object(v, "api", side_effect=request), patch.object(v, "poll", side_effect=poll) as polling:
            report = v.submit(self.confirmed, self.plan["planSha256"], output, NODE)
        polling.assert_called_once(); self.assertTrue(report["completed"])
        self.assertEqual(report["contracts"][engine["address"]]["guid"], "owned-prior-guid")


if __name__ == "__main__":
    unittest.main()
