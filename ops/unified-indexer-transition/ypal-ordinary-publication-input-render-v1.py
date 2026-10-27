#!/usr/bin/env python3
"""Read-only file-lineage renderer. No current/runtime qualification authority."""
import hashlib
import json
from pathlib import Path
import re
import stat
import types

FORMAT = "yunipals-ypal-ordinary-publication-input-render-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
HELPER = OPS / "ypal-ordinary-generation-binding-v1.py"
HELPER_SHA = "acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962"
BINDING_SHA = "a6d4f0b8669eadcc44a1c880e76996f015e645ef9976b79e418e02e26bd1859b"
READER_MANIFEST = OPS / "ypal-ordinary-reader-bound-v1.manifest.json"
READER_MANIFEST_SHA = "bbd19325eded8dd90b2ea8c0e8844b9ad6134fd78416206bb0491978a07f3095"
PROVIDER = OPS / "ypal-ordinary-read-cache-bound-v1.py"
PROVIDER_SHA = "7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f"
COMMON = OPS / "ypal-ordinary-consumer-handover-v5.py"
COMMON_SHA = "dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c"
META_INPUT_SHA = "bc618a8559a94d4a34d5a6da91c98d2241161f2edd91e540857a5089e5bbe306"
SELECTED_SHA = "2829182fa96599513f07099118ab0c16b0ceff8d04330537a9c90bd5231e35ba"
PROVENANCE_FILE = "provenance-2-observed.json"
PROVENANCE_SHA = "6d8998f33db107a278097aff8b419cb0bea684151b2e73f7b72fc20a48906c1b"
SELECTOR_SHA = "451c497495c138e887bd95acfa426f40f5bf7194369ca22df42c85f6611b579b"
READ_CONFIG = {
    "admissionSha256": "fcebbe8dea9a71c474a8f355b61fb325885c578f64d81af6786637650d152e12",
    "readPlanSha256": "6c96ede2c1a6d5e088f40d061be217d18d250e0933a5e91c4d514ab963e32517",
    "readContextInputSha256": "8a5ca47b3879bee1fc451e40e2dac9085fa655bf36cc3c8d4d961790a20eb4e1"
}


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def helper():
    # This bootstrap performs protected reads only; it is never run on import.
    for path in [*HELPER.parents, HELPER]:
        row = path.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_renderer_helper_required")
    before = HELPER.lstat(); raw = HELPER.read_bytes(); after = HELPER.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < len(raw) == before.st_size < 100000 and
         hashlib.sha256(raw).hexdigest() == HELPER_SHA and all(getattr(before, key) == getattr(after, key) for key in
         ["st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_size", "st_mtime_ns", "st_ctime_ns"]),
         "exact_renderer_helper_required")
    value = types.ModuleType("renderer_generation_binding"); value.__file__ = str(HELPER)
    exec(compile(raw, str(HELPER), "exec"), value.__dict__)
    return value


class Renderer:
    def __init__(self):
        self.h = h = helper()
        self.binding = h.Binding(BINDING_SHA)
        self.manifest = json.loads(h.public(READER_MANIFEST, READER_MANIFEST_SHA, 100000))
        need(self.manifest["generationBinding"] == {"file": h.MANIFEST.name, "sha256": BINDING_SHA} and
             self.manifest["dataIdentity"] == h.DATA_IDENTITY and
             self.manifest["contexts"]["phase"] == {"file": PROVIDER.name, "sha256": PROVIDER_SHA},
             "same_actual_reader_provider_generation_binding_required")
        sources = {**self.manifest["dependencies"], **self.manifest["files"]}
        for source in self.manifest["contexts"].values():
            need(sources.get(source["file"]) == source["sha256"], "same_reader_context_source_pin_required")
        for name, digest in sources.items():
            need(type(name) is str and re.fullmatch(r"[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)", name) and h.pin(digest),
                 "finite_renderer_public_source_closure_required")
            h.public(OPS / name, digest, 4000000)
        self.provider = h.load_code(PROVIDER, PROVIDER_SHA)
        self.common = h.load_code(COMMON, COMMON_SHA)

    def document(self, path, digest=None):
        need(digest is None or self.h.pin(digest), "actual_renderer_receipt_digest_required")
        value = json.loads(self.h.public(path, digest, 4000000))
        need(type(value) is dict, "renderer_receipt_object_required")
        return value

    def metadata(self, candidate, operation, config):
        c = self.common
        meta = c.metadata_input(self.document(c.META_INPUT, META_INPUT_SHA))
        need(meta["readConfig"] == candidate["readConfig"] == READ_CONFIG and
             candidate["metadataInputSha256"] == config["metadataInputSha256"] == META_INPUT_SHA and
             candidate["metadataSelectedSha256"] == config["metadataSelectedSha256"] == SELECTED_SHA and
             candidate["metadataProvenanceSha256"] == config["metadataProvenanceSha256"] == PROVENANCE_SHA and
             operation["metadataProvenanceFile"] == config["metadataProvenanceFile"] == PROVENANCE_FILE and
             candidate["candidateSelectorsSha256"] == config["selectorCandidateSha256"] == SELECTOR_SHA,
             "actual_completed_metadata_selector_and_READ_lineage_required")
        sources = self.document(c.META_SOURCES, meta["sourcesSha256"])
        need(sources == {"format": c.META_FORMAT + "-sources", "provider": {"file": COMMON.name, "sha256": COMMON_SHA},
                        "readAdmission": {"file": c.READ.name, "sha256": c.READ_SHA}},
             "actual_metadata_public_source_refs_required")
        metadata_op = self.document(c.META_BASE / "operation.json", candidate["metadataOperationSha256"])
        selected = self.document(c.META_BASE / "selected.json", SELECTED_SHA)
        provenance = self.document(c.META_BASE / PROVENANCE_FILE, PROVENANCE_SHA)
        need(metadata_op["format"] == c.META_FORMAT and metadata_op["operatorSha256"] == self.provider.METADATA_SHA and
             metadata_op["readConfig"] == meta["readConfig"] and metadata_op["admissionSha256"] == READ_CONFIG["admissionSha256"] and
             selected["selected"] is True and provenance["completeForCurrentPublishedArchiveBase"] is True and
             provenance["remainingPublished"] == 0 and provenance["publicationProof"]["allPublishedCanonical"] is True,
             "recorded_actual_metadata_operation_selection_and_completed_provenance_required")
        admission = self.document(c.READ_RESULT, READ_CONFIG["admissionSha256"])
        read_base = Path("/var/backups/yunipals-ypal-ordinary-read-input-v5b-20261025")
        read_input = self.document(read_base / "input.json", READ_CONFIG["readContextInputSha256"])
        plan = self.document(read_base / "plan.json", READ_CONFIG["readPlanSha256"])
        need(admission["format"] == "yunipals-ypal-ordinary-read-admission-v5b" and admission["operatorSha256"] == c.READ_SHA and
             admission["planSha256"] == READ_CONFIG["readPlanSha256"] and
             admission["contextInputSha256"] == READ_CONFIG["readContextInputSha256"] and
             plan["operatorSha256"] == c.READ_SHA and plan["contextInputSha256"] == READ_CONFIG["readContextInputSha256"] and
             plan["input"] == read_input and read_input["ordinaryRuntime"] == meta["ordinaryRuntime"],
             "same_recorded_READ_plan_input_admission_and_ordinary_source_refs_required")
        selector_base = Path("/var/backups/yunipals-ypal-ordinary-generation-candidates-v5-20261025")
        selector = self.document(selector_base / "result.json", SELECTOR_SHA)
        intent = self.document(selector_base / "intent.json")
        need(selector == {**intent, "staged": True, "selected": False, "generationStarted": False, "cacheStarted": False,
                         "guardTransitionExecuted": False, "databaseWrites": 0, "servicesChanged": False,
                         "providerRequests": 0, "permissionAdmissionAcknowledged": False} and
             intent["readConfig"] == READ_CONFIG and intent["candidateInputSha256"] == meta["candidateInputSha256"] and
             intent["readSchema"] == self.h.DATA_IDENTITY["readSchema"] and intent["readIdentity"] == self.h.DATA_IDENTITY["readIdentity"],
             "same_recorded_unselected_actual_generation_selector_required")
        return c.source_refs(meta["ordinaryRuntime"])

    def render(self, candidate_sha):
        h, binding = self.h, self.binding
        need(h.pin(candidate_sha), "actual_accepted_V2_candidate_digest_required")
        candidate = self.document(Path(h.ATTEMPT_BASE) / "candidate-result.json", candidate_sha)
        operation = self.document(Path(h.ATTEMPT_BASE) / "operation.json", candidate["operationSha256"])
        owner = binding.owner
        # Only the pure, existing config validator is used. No Host, candidate
        # context, installation/current validator or terminal actor is invoked.
        config = owner.composition().config_checked(self.document(owner.INPUT, operation["inputSha256"]))
        cache_input = {
            "readAdmissionSha256": candidate["readConfig"]["admissionSha256"],
            "readPlanSha256": candidate["readConfig"]["readPlanSha256"],
            "readContextInputSha256": candidate["readConfig"]["readContextInputSha256"],
            "metadataSelectionSha256": candidate["metadataSelectedSha256"],
            "metadataProvenanceFile": config["metadataProvenanceFile"],
            "metadataProvenanceSha256": candidate["metadataProvenanceSha256"],
            "generationSha256": candidate_sha, "metadataInputSha256": candidate["metadataInputSha256"],
            "selectorCandidateSha256": candidate["candidateSelectorsSha256"], "generationBindingSha256": BINDING_SHA
        }
        self.provider.config_checked(cache_input)
        binding.candidate(candidate, cache_input)
        need(candidate["completed"] is candidate["built"] is candidate["validated"] is True and
             candidate["published"] is candidate["publicationAllowed"] is candidate["sourceReadinessQualified"] is False and
             candidate["separateCoordinatedCutoverRequired"] is True and
             re.fullmatch(r"[1-9][0-9]{0,18}", candidate["generationId"]) and candidate["generationId"] not in {"102", "103"} and
             candidate["predecessorGenerationId"] == "103", "actual_accepted_unpublished_V2_candidate_required")
        need(operation["format"] == owner.FORMAT and operation["operatorSha256"] == candidate["operatorSha256"] and
             operation["newExecutionFiles"] == owner.SOURCE_PINS and operation["adoptedRetainedLineage"] is True and
             operation["capsuleResultFile"] == h.RETAINED["capsuleFile"] and
             operation["capsuleResultSha256"] == h.RETAINED["capsuleSha256"] and
             operation["retainedOperationSha256"] == h.RETAINED["operationSha256"] and
             operation["recoveryComponent"] == h.RECOVERY_COMPONENT and operation["originalStrictCapsuleVerifierPassed"] is False,
             "same_actual_new_operation_source_closure_and_semantic_recovery_required")
        owner.semantic_verification(operation["capsuleSemanticVerification"])
        owner.semantic_verification(candidate["capsuleSemanticVerification"])
        for key in ["readAdmissionSha256", "readConfig", "metadataInputSha256", "metadataOperatorSha256", "metadataOperationSha256",
                    "historicalGenerationProducerSha256", "metadataSelectedSha256", "metadataProvenanceSha256"]:
            need(candidate[key] == operation[key], "same_candidate_operation_metadata_and_READ_ancestry_required")
        need(candidate["readAdmissionSha256"] == config["readAdmissionSha256"] == candidate["readConfig"]["admissionSha256"] and
             candidate["metadataOperationSha256"] == config["metadataOperationSha256"] and
             candidate["metadataOperatorSha256"] == self.provider.METADATA_SHA and
             candidate["artifactDigest"] == operation["artifactDigest"] == h.ARTIFACT["digest"] and
             candidate["artifactManifestSha256"] == operation["artifactManifestSha256"] == h.ARTIFACT["manifestSha256"] and
             candidate["installSha256"] == operation["installSha256"] == config["installSha256"] and
             candidate["originalInstallSha256"] == operation["originalInstallSha256"] == config["originalInstallSha256"],
             "same_candidate_operation_and_input_artifact_install_metadata_refs_required")
        accepted = self.document(Path(h.ATTEMPT_BASE) / "accept-intent.json")
        review = accepted["binding"]
        need(accepted == {"binding": review, "reviewHash": h.sha(h.encoded(review)), "automaticRetry": False} and
             all(review[key] == candidate[key] for key in ["operationSha256", "generationId", "generationValidationSha256",
                 "workerIntentSha256", "workerResultSha256", "stdoutSha256", "capsuleResultSha256", "originalGlobalObservation"]),
             "actual_accepted_candidate_review_intent_required")
        work = Path(h.ATTEMPT_WORK)
        runtime = self.document(work / "intent.json", candidate["workerIntentSha256"])
        result = self.document(work / "result.json", candidate["workerResultSha256"])
        stdout = h.public(work / "child.stdout.private", candidate["stdoutSha256"], 1000000)
        rows = [json.loads(line) for line in stdout.splitlines() if line.startswith(b"{")]
        need(runtime["unit"] == h.ATTEMPT_UNIT and runtime["applicationName"] == h.ATTEMPT_APP and
             result["invocation"] == runtime["invocation"] and re.fullmatch("[a-f0-9]{32}", runtime["invocation"]) and
             result["childExit"] == 0 and result["failure"] is None and result["automaticRetry"] is False and
             result["minimumAvailableBytes"] >= 30000000000 and runtime["automaticRetry"] is False and
             runtime["maximumSeconds"] == config["maximumSeconds"] and
             result["inputSha256"] == runtime["inputSha256Ref"] == operation["inputSha256"] and
             result["artifactDigest"] == runtime["artifactDigest"] == h.ARTIFACT["digest"] and len(rows) == 1 and
             rows[0]["event"] == "native_generation_prepared" and rows[0]["built"] is rows[0]["validated"] is rows[0]["prepared"] is True and
             rows[0]["published"] is False and rows[0]["generationId"] == candidate["generationId"] and
             h.sha(h.encoded(rows[0]["validation"])) == candidate["generationValidationSha256"] and
             rows[0]["validation"]["sourceSnapshot"] == candidate["sourceSnapshot"],
             "same_recorded_successful_actual_V2_worker_and_candidate_validation_required")
        source_refs = self.metadata(candidate, operation, config)
        binding.current()
        return {"format": FORMAT, "fileLineageValidated": True, "currentReadinessQualified": False,
                "candidateSha256": candidate_sha, "generationId": candidate["generationId"],
                "cacheInputFile": str(self.provider.INPUT), "cacheInput": cache_input,
                "cacheInputsSha256": h.sha(h.encoded(cache_input)), "sourceRefs": source_refs,
                "readerSourceRefs": {"sourceManifestSha256": READER_MANIFEST_SHA,
                    "generationBindingSha256": BINDING_SHA, "readPlanSha256": cache_input["readPlanSha256"],
                    "readContextInputSha256": cache_input["readContextInputSha256"],
                    "cacheInputsSha256": h.sha(h.encoded(cache_input))},
                "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0, "inputWrites": 0}

    def reader_inputs(self, rendered):
        """Only after real cache/transport/observer receipts exist; still no Host."""
        h, manifest = self.h, self.manifest
        route = manifest["acknowledgementRoute"]
        reader = h.load_code(OPS / route["file"], route["sha256"])
        _, proof = reader.core(READER_MANIFEST_SHA)  # Static core, never proof.Context.
        h.public(self.provider.INPUT, rendered["cacheInputsSha256"])
        def receipt(path):
            raw = h.public(path, maximum=4000000)
            value = json.loads(raw)
            need(type(value) is dict, "actual_reader_recorded_receipt_object_required")
            return value, h.sha(raw)
        prepared, prepared_sha = receipt(self.provider.BASE / "prepared.json")
        need(prepared["format"] == self.provider.FORMAT and prepared["operatorSha256"] == PROVIDER_SHA and
             prepared["config"] == rendered["cacheInput"] and prepared["prepared"] is True and
             prepared["nativeWorkerStarted"] is prepared["nativeGenerationPublished"] is False,
             "actual_same_bound_cache_prepared_receipt_required")
        observer_ref = manifest["contexts"]["observer"]
        observer = h.load_code(OPS / observer_ref["file"], observer_ref["sha256"])
        observed, observer_sha = receipt(observer.BASE / "result.json")
        need(observed["format"] == observer.FORMAT and observed["operatorSha256"] == observer_ref["sha256"] and
             observed["mode"] == "new" and observed["observerScopeOnly"] is observed["ordinarySustainedObserver"] is True,
             "actual_recorded_sustained_observer_source_ref_required")
        transport = manifest["transportQualification"]
        qualified, qualification_sha = receipt(Path(transport["newQualificationFile"]))
        need(qualified["format"] == "yunipals-ordinary-reader-peer-bound-v1" and
             qualified["qualified"] is True and qualified["producerSha256"] == transport["newProducerSha256"] and
             qualified["wireManifestSha256"] == manifest["wireManifestSha256"] and set(qualified["peers"]) == {"postgres", "main"},
             "actual_new_bound_reader_transport_qualification_ref_required")
        for name, digest in [("ypal-generation-publisher-install-v1.py", proof.PUBLISHER_INSTALL_SHA),
                             ("ypal-latest-complete-main-api-install-v1.py", proof.MAIN_INSTALL_SHA)]:
            installer = h.load_code(OPS / name, proof.pins[name])
            self.document(installer.BASE / "result.json", digest)  # Never installer.installed.
        refs = rendered["readerSourceRefs"]
        inputs = {key: refs[key] for key in ["sourceManifestSha256", "readPlanSha256", "readContextInputSha256", "cacheInputsSha256"]}
        inputs.update(cachePreparedSha256=prepared_sha, sustainedObserverSha256=observer_sha,
                      transportQualificationSha256=qualification_sha, publisherInstallSha256=proof.PUBLISHER_INSTALL_SHA,
                      mainInstallSha256=proof.MAIN_INSTALL_SHA, parityWitnessSha256=manifest["canonicalWitness"]["witnessSha256"])
        need(set(inputs) == proof._implementation.INPUT_KEYS and all(h.pin(value) for value in inputs.values()),
             "exact_ten_recorded_reader_input_refs_required")
        return inputs


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-sha")
    parser.add_argument("--cache-input-only", action="store_true")
    parser.add_argument("--reader-inputs", action="store_true")
    args = parser.parse_args(argv)
    if args.candidate_sha is None:
        need(not args.cache_input_only and not args.reader_inputs, "actual_candidate_digest_before_input_render_required")
        print(json.dumps({"format": FORMAT, "staticOnly": True, "inputWrites": 0, "databaseWrites": 0,
                          "serviceActions": 0, "providerCalls": 0}))
        return
    need(not (args.cache_input_only and args.reader_inputs), "one_explicit_renderer_output_mode_required")
    renderer = Renderer()
    value = renderer.render(args.candidate_sha)
    if args.reader_inputs:
        value["readerInputs"] = renderer.reader_inputs(value)
    print(json.dumps(value["cacheInput"] if args.cache_input_only else value, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = str(error)
        print(json.dumps({"format": FORMAT, "completed": False, "fixedCode": code if type(error) is RuntimeError and
              re.fullmatch("[A-Za-z0-9_]+", code) else "missing_or_invalid_protected_renderer_lineage", "inputWrites": 0}))
        raise SystemExit(1)
