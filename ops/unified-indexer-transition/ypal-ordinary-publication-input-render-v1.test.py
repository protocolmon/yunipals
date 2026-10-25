"""Actual pure validators, synthetic receipt graph, no live evidence or effects."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


m = load("ypal-ordinary-publication-input-render-v1.py")
h = load("ypal-ordinary-generation-binding-v1.py")


class Controls(unittest.TestCase):
    def setUp(self):
        self.files = {}
        self.reader_fixture = False
        self.enterContext(patch.object(h, "public", side_effect=self.read))
        self.enterContext(patch.object(m, "helper", return_value=h))
        actual_load = h.load_code
        def code(path, digest):
            value = actual_load(path, digest)
            if hasattr(value, "helper"):
                value.helper = lambda: h
            if Path(path).name == h.OWNER_FILE:
                value.public = self.read
            if Path(path).name == "ypal-ordinary-reader-bound-v1.py" and self.reader_fixture:
                real_core = value.core
                def core(digest):
                    root, proof = real_core(digest)
                    # Synthetic installer receipts cannot hash to real receipts.
                    # Keep the actual static core; substitute only those two
                    # expected receipt digests, never a runtime Context/result.
                    proof.PUBLISHER_INSTALL_SHA = self.publisher_sha
                    proof.MAIN_INSTALL_SHA = self.main_sha
                    proof.Context = lambda *_: (_ for _ in ()).throw(AssertionError("runtime Context"))
                    return root, proof
                value.core = core
            return value
        self.enterContext(patch.object(h, "load_code", side_effect=code))
        self.renderer = m.Renderer()
        self.make_receipts()

    def read(self, path, digest=None, maximum=200000):
        path = Path(path)
        if str(path) in self.files:
            raw = self.files[str(path)]
        elif path.parent == m.OPS:
            raw = (HERE / path.name).read_bytes()
        else:
            raise RuntimeError("missing_actual_candidate_or_lineage")
        h.need(0 < len(raw) <= maximum and (digest is None or h.sha(raw) == digest), "exact_local_receipt_hash_required")
        return raw

    def put(self, path, value):
        raw = h.encoded(value)
        self.files[str(path)] = raw
        return h.sha(raw)

    def make_receipts(self):
        r, b, c = self.renderer, self.renderer.binding, self.renderer.common
        source_refs = {"resultSha256": "1" * 64, "inputSha256": "2" * 64}
        read_base = Path("/var/backups/yunipals-ypal-ordinary-read-input-v5b-20261025")
        read_input = {"ordinaryRuntime": source_refs}
        input_sha = self.put(read_base / "input.json", read_input)
        plan = {"operatorSha256": c.READ_SHA, "contextInputSha256": input_sha, "input": read_input}
        plan_sha = self.put(read_base / "plan.json", plan)
        admission = {"format": "yunipals-ypal-ordinary-read-admission-v5b", "operatorSha256": c.READ_SHA,
                     "planSha256": plan_sha, "contextInputSha256": input_sha}
        admission_sha = self.put(c.READ_RESULT, admission)
        read_config = {"admissionSha256": admission_sha, "readPlanSha256": plan_sha, "readContextInputSha256": input_sha}
        self.enterContext(patch.object(m, "READ_CONFIG", read_config))
        sources_sha = self.put(c.META_SOURCES, {"format": c.META_FORMAT + "-sources",
            "provider": {"file": m.COMMON.name, "sha256": m.COMMON_SHA}, "readAdmission": {"file": c.READ.name, "sha256": c.READ_SHA}})
        meta = {"format": c.META_FORMAT + "-input", "sourcesSha256": sources_sha, "readConfig": read_config,
                "ordinaryRuntime": source_refs, "candidateInputSha256": "3" * 64, "candidateReceiptSha256": "4" * 64}
        metadata_sha = self.put(c.META_INPUT, meta)
        meta_op_sha = self.put(c.META_BASE / "operation.json", {"format": c.META_FORMAT,
            "operatorSha256": r.provider.METADATA_SHA, "readConfig": read_config, "admissionSha256": admission_sha})
        selected_sha = self.put(c.META_BASE / "selected.json", {"selected": True, "provenanceComplete": False})
        provenance_sha = self.put(c.META_BASE / m.PROVENANCE_FILE, {"completeForCurrentPublishedArchiveBase": True,
            "remainingPublished": 0, "publicationProof": {"allPublishedCanonical": True}})
        selector_base = Path("/var/backups/yunipals-ypal-ordinary-generation-candidates-v5-20261025")
        intent = {"readConfig": read_config, "candidateInputSha256": meta["candidateInputSha256"],
                  "readSchema": h.DATA_IDENTITY["readSchema"], "readIdentity": h.DATA_IDENTITY["readIdentity"]}
        self.put(selector_base / "intent.json", intent)
        selector_sha = self.put(selector_base / "result.json", {**intent, "staged": True, "selected": False,
            "generationStarted": False, "cacheStarted": False, "guardTransitionExecuted": False, "databaseWrites": 0,
            "servicesChanged": False, "providerRequests": 0, "permissionAdmissionAcknowledged": False})
        for name, value in [("META_INPUT_SHA", metadata_sha), ("SELECTED_SHA", selected_sha),
                            ("PROVENANCE_SHA", provenance_sha), ("SELECTOR_SHA", selector_sha)]:
            self.enterContext(patch.object(m, name, value))
        config = {"format": b.owner.FORMAT + "-input", "maximumSeconds": 1800, "metadataInputSha256": metadata_sha,
                  "selectorCandidateSha256": selector_sha, "originalInstallSha256": "5" * 64, "installSha256": "6" * 64,
                  "readAdmissionSha256": admission_sha, "metadataOperationSha256": meta_op_sha,
                  "metadataSelectedSha256": selected_sha, "metadataProvenanceFile": m.PROVENANCE_FILE,
                  "metadataProvenanceSha256": provenance_sha}
        self.config_sha = self.put(b.owner.INPUT, config)
        observation = {"semanticIdentityMatched": True, "capturedAllocatedBytes": "100", "observedAllocatedBytes": "200",
                       "allocatedBytesChanged": True}
        semantic = {"validated": True, "databaseWrites": 0, "rawRowsExported": False,
                    "recoverySemantics": h.RECOVERY_COMPONENT["semantics"],
                    "allocationObservations": {"walletStats": observation, "derivedStamps": observation}}
        self.operation = {"format": b.owner.FORMAT, "operatorSha256": b.value["owner"]["sha256"],
            "inputSha256": self.config_sha, "newExecutionFiles": b.owner.SOURCE_PINS, "adoptedRetainedLineage": True,
            "capsuleResultFile": h.RETAINED["capsuleFile"], "capsuleResultSha256": h.RETAINED["capsuleSha256"],
            "retainedOperationSha256": h.RETAINED["operationSha256"], "recoveryComponent": h.RECOVERY_COMPONENT,
            "originalStrictCapsuleVerifierPassed": False, "capsuleSemanticVerification": semantic,
            "readAdmissionSha256": admission_sha, "readConfig": read_config, "metadataInputSha256": metadata_sha,
            "metadataOperatorSha256": r.provider.METADATA_SHA, "metadataOperationSha256": meta_op_sha,
            "historicalGenerationProducerSha256": "7" * 64, "metadataSelectedSha256": selected_sha,
            "metadataProvenanceFile": m.PROVENANCE_FILE, "metadataProvenanceSha256": provenance_sha,
            "artifactDigest": h.ARTIFACT["digest"], "artifactManifestSha256": h.ARTIFACT["manifestSha256"],
            "installSha256": config["installSha256"], "originalInstallSha256": config["originalInstallSha256"]}
        operation_sha = self.put(Path(h.ATTEMPT_BASE) / "operation.json", self.operation)
        work = Path(h.ATTEMPT_WORK)
        runtime = {"unit": h.ATTEMPT_UNIT, "applicationName": h.ATTEMPT_APP, "invocation": "1" * 32,
                   "maximumSeconds": 1800, "automaticRetry": False, "inputSha256Ref": self.config_sha,
                   "artifactDigest": h.ARTIFACT["digest"]}
        runtime_sha = self.put(work / "intent.json", runtime)
        result_sha = self.put(work / "result.json", {"invocation": runtime["invocation"], "childExit": 0, "failure": None,
            "automaticRetry": False, "minimumAvailableBytes": 30000000000, "inputSha256": self.config_sha,
            "artifactDigest": h.ARTIFACT["digest"]})
        validation = {"sourceSnapshot": {"fixtureOnly": True}}
        stdout_sha = self.put(work / "child.stdout.private", {"event": "native_generation_prepared", "built": True,
            "validated": True, "prepared": True, "published": False, "generationId": "104", "validation": validation})
        self.candidate = {**self.operation, "format": h.CANDIDATE_FORMAT, "completed": True, "built": True, "validated": True,
            "published": False, "publicationAllowed": False, "sourceReadinessQualified": False,
            "separateCoordinatedCutoverRequired": True, "operationSha256": operation_sha, "candidateSelectorsSha256": selector_sha,
            "generationId": "104", "predecessorGenerationId": "103", "sourceRelease": h.DATA_IDENTITY["sourceRelease"],
            "readIdentity": h.DATA_IDENTITY["readIdentity"], "workerIntentSha256": runtime_sha, "workerResultSha256": result_sha,
            "stdoutSha256": stdout_sha, "generationValidationSha256": h.sha(h.encoded(validation)),
            "sourceSnapshot": validation["sourceSnapshot"], "originalGlobalObservation": {"fixtureOnly": True}}
        self.accept()

    def accept(self):
        review = {key: self.candidate[key] for key in ["operationSha256", "generationId", "generationValidationSha256",
            "workerIntentSha256", "workerResultSha256", "stdoutSha256", "capsuleResultSha256", "originalGlobalObservation"]}
        self.put(Path(h.ATTEMPT_BASE) / "accept-intent.json", {"binding": review, "reviewHash": h.sha(h.encoded(review)), "automaticRetry": False})
        self.candidate_sha = self.put(Path(h.ATTEMPT_BASE) / "candidate-result.json", self.candidate)

    def test_actual_source_pins_and_ten_fields_with_real_pure_provider_validator(self):
        value = self.renderer.render(self.candidate_sha)
        self.assertEqual(len(value["cacheInput"]), 10)
        self.assertEqual(self.renderer.provider.config_checked(value["cacheInput"]), value["cacheInput"])
        self.assertEqual(value["cacheInputsSha256"], h.sha(h.encoded(value["cacheInput"])))
        self.assertEqual(value["cacheInput"]["generationBindingSha256"], m.BINDING_SHA)
        self.assertEqual(value["readerSourceRefs"]["sourceManifestSha256"], m.READER_MANIFEST_SHA)
        self.assertEqual(value["sourceRefs"], {"resultSha256": "1" * 64, "inputSha256": "2" * 64})
        self.assertFalse(value["currentReadinessQualified"])

    def test_missing_candidate_and_changed_candidate_hash_refuse(self):
        with self.assertRaisesRegex(RuntimeError, "exact_local_receipt_hash"):
            self.renderer.render("a" * 64)
        del self.files[str(Path(h.ATTEMPT_BASE) / "candidate-result.json")]
        with self.assertRaisesRegex(RuntimeError, "missing_actual_candidate"):
            self.renderer.render(self.candidate_sha)

    def test_foreign_producer_domain_capsule_and_old_strict_success_refuse(self):
        for key, bad in [("operatorSha256", "8" * 64), ("format", "yunipals-ypal-ordinary-generation-candidate-v5c"),
                         ("capsuleResultFile", h.ATTEMPT_BASE + "/capsule-result.json"), ("originalStrictCapsuleVerifierPassed", True)]:
            candidate = copy.deepcopy(self.candidate); candidate[key] = bad
            digest = self.put(Path(h.ATTEMPT_BASE) / "candidate-result.json", candidate)
            with self.assertRaises(RuntimeError):
                self.renderer.render(digest)

    def test_candidate_and_operation_or_input_mismatch_refuse(self):
        for key in ["metadataInputSha256", "metadataOperationSha256", "metadataProvenanceSha256", "installSha256"]:
            candidate = copy.deepcopy(self.candidate); candidate[key] = "9" * 64
            digest = self.put(Path(h.ATTEMPT_BASE) / "candidate-result.json", candidate)
            with self.assertRaises(RuntimeError):
                self.renderer.render(digest)

    def test_acceptance_intent_or_worker_output_mismatch_refuse(self):
        path = Path(h.ATTEMPT_BASE) / "accept-intent.json"
        self.put(path, {"binding": {}, "reviewHash": "9" * 64, "automaticRetry": False})
        with self.assertRaises(RuntimeError):
            self.renderer.render(self.candidate_sha)
        self.accept()
        self.put(Path(h.ATTEMPT_WORK) / "child.stdout.private", {"event": "failed"})
        with self.assertRaisesRegex(RuntimeError, "exact_local_receipt_hash"):
            self.renderer.render(self.candidate_sha)

    def test_metadata_and_READ_private_lineage_changes_refuse(self):
        for path in [self.renderer.common.META_INPUT, self.renderer.common.META_BASE / m.PROVENANCE_FILE,
                     Path("/var/backups/yunipals-ypal-ordinary-read-input-v5b-20261025/input.json")]:
            raw = self.files[str(path)]; self.put(path, {"foreign": True})
            with self.assertRaisesRegex(RuntimeError, "exact_local_receipt_hash"):
                self.renderer.render(self.candidate_sha)
            self.files[str(path)] = raw

    def test_no_host_current_database_service_subprocess_or_writes(self):
        with patch.object(subprocess, "run", side_effect=AssertionError("subprocess")), \
             patch.object(subprocess, "Popen", side_effect=AssertionError("process")), \
             patch.object(Path, "write_bytes", side_effect=AssertionError("write")), \
             patch.object(h.Binding, "terminal", side_effect=AssertionError("live terminal")), \
             patch.object(self.renderer.binding.owner, "validate_candidate_database_current", side_effect=AssertionError("database")), \
             patch.object(self.renderer.binding.owner, "validate_retained_current", side_effect=AssertionError("current")):
            self.assertTrue(self.renderer.render(self.candidate_sha)["fileLineageValidated"])

    def reader_receipts(self):
        r = self.renderer
        rendered = r.render(self.candidate_sha)
        self.put(r.provider.INPUT, rendered["cacheInput"])
        self.put(r.provider.BASE / "prepared.json", {"format": r.provider.FORMAT, "operatorSha256": m.PROVIDER_SHA,
            "config": rendered["cacheInput"], "prepared": True, "nativeWorkerStarted": False, "nativeGenerationPublished": False})
        observer = h.load_code(m.OPS / r.manifest["contexts"]["observer"]["file"], r.manifest["contexts"]["observer"]["sha256"])
        self.put(observer.BASE / "result.json", {"format": observer.FORMAT, "operatorSha256": r.manifest["contexts"]["observer"]["sha256"],
            "mode": "new", "observerScopeOnly": True, "ordinarySustainedObserver": True})
        self.qualification = {"format": "yunipals-ordinary-reader-peer-bound-v1", "qualified": True,
            "producerSha256": r.manifest["transportQualification"]["newProducerSha256"],
            "wireManifestSha256": r.manifest["wireManifestSha256"], "peers": {"postgres": {}, "main": {}}}
        self.qualification_path = Path(r.manifest["transportQualification"]["newQualificationFile"])
        self.put(self.qualification_path, self.qualification)
        self.publisher_sha = self.put(Path("/var/backups/yunipals-ypal-generation-publisher-install-v1-20261024/result.json"), {"fixtureOnly": True})
        self.main_sha = self.put(Path("/var/backups/yunipals-ypal-latest-complete-main-api-install-v1-20261025/result.json"), {"fixtureOnly": True})
        self.reader_fixture = True
        return rendered

    def test_reader_ten_refs_use_actual_static_composed_core_never_context(self):
        rendered = self.reader_receipts()
        with patch.object(subprocess, "run", side_effect=AssertionError("subprocess")), \
             patch.object(subprocess, "Popen", side_effect=AssertionError("process")), \
             patch.object(Path, "write_bytes", side_effect=AssertionError("write")):
            inputs = self.renderer.reader_inputs(rendered)
        self.assertEqual(len(inputs), 10)
        self.assertNotIn("generationBindingSha256", inputs)
        self.assertEqual(inputs["cacheInputsSha256"], rendered["cacheInputsSha256"])
        self.assertEqual(inputs["transportQualificationSha256"], h.sha(self.files[str(self.qualification_path)]))

    def test_reader_refs_require_real_prepared_input_and_receipts(self):
        rendered = self.reader_receipts()
        for path in [self.renderer.provider.INPUT, self.renderer.provider.BASE / "prepared.json", self.qualification_path]:
            raw = self.files.pop(str(path))
            with self.assertRaises(RuntimeError):
                self.renderer.reader_inputs(rendered)
            self.files[str(path)] = raw

    def test_reader_old_qualification_and_foreign_prepared_domain_refuse(self):
        rendered = self.reader_receipts()
        for key, value in [("format", "yunipals-ordinary-reader-peer-v6"), ("producerSha256", "9" * 64), ("wireManifestSha256", "9" * 64)]:
            bad = {**self.qualification, key: value}; self.put(self.qualification_path, bad)
            with self.assertRaisesRegex(RuntimeError, "actual_new_bound_reader_transport"):
                self.renderer.reader_inputs(rendered)
        self.put(self.qualification_path, self.qualification)
        prepared_path = self.renderer.provider.BASE / "prepared.json"
        prepared = json.loads(self.files[str(prepared_path)]); prepared["format"] = "yunipals-ypal-ordinary-read-cache-v6"
        self.put(prepared_path, prepared)
        with self.assertRaisesRegex(RuntimeError, "actual_same_bound_cache_prepared"):
            self.renderer.reader_inputs(rendered)

    def test_default_and_import_have_no_reads_and_no_effects(self):
        with patch.object(Path, "read_bytes", side_effect=AssertionError("read")), \
             patch.object(Path, "lstat", side_effect=AssertionError("stat")), \
             patch.object(m, "helper", side_effect=AssertionError("helper")), redirect_stdout(io.StringIO()) as output:
            m.main([])
        self.assertTrue(json.loads(output.getvalue())["staticOnly"])
        raw = (HERE / "ypal-ordinary-publication-input-render-v1.py").read_bytes()
        with patch.object(Path, "read_bytes", side_effect=AssertionError("read")), patch.object(Path, "lstat", side_effect=AssertionError("stat")):
            exec(compile(raw, "inert_renderer_import.py", "exec"), {"__name__": "inert_renderer_import"})


if __name__ == "__main__":
    unittest.main()
