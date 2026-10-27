"""Actual thin namespaces and explicit lineage; synthetic data, no host effects."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


h = load("ypal-ordinary-generation-binding-v1.py")
p = load("ypal-ordinary-read-cache-bound-v1.py")
r = load("ypal-ordinary-reader-bound-v1.py")
a = load("ypal-ordinary-publication-bound-v1.py")
builder = load("ypal-ordinary-publication-bound-manifest-v1.py")
old_cache = load("ypal-ordinary-read-cache-v5.test.py")


def encoded(value):
    return (json.dumps(value, sort_keys=True, indent=2) + "\n").encode()


def documents():
    return builder.build()


def local(manifests):
    def read(path, digest=None, maximum=200000):
        name = Path(path).name
        raw = encoded(manifests[name]) if name in manifests else (HERE / name).read_bytes()
        h.need(len(raw) <= maximum and (digest is None or h.sha(raw) == digest), "actual_local_bound_source_required")
        return raw
    return read


class Controls(unittest.TestCase):
    def setUp(self):
        self.manifests = documents()
        self.public = local(self.manifests)
        self.enterContext(patch.object(h, "public", side_effect=self.public))
        for module in [p, r, a]:
            self.enterContext(patch.object(module, "helper", return_value=h))
        self.binding_sha = h.sha(encoded(self.manifests[h.MANIFEST.name]))
        self.reader_sha = h.sha(encoded(self.manifests[r.MANIFEST.name]))

    def binding(self):
        return h.Binding(self.binding_sha)

    def provider_namespace(self):
        b = self.binding()
        self.enterContext(patch.object(b.owner, "public", side_effect=self.public))
        c = old_cache.c
        original = c.module
        read = old_cache.readtest.namespace()
        read.protected = self.public
        delta = load(p.FROZEN.name.replace("read-cache-v6", "read-admission-v5b"))
        delta.namespace = lambda: read
        metadata = old_cache.metatest.namespace()
        selector = load("ypal-generation-cache-candidates-v1.py")
        config = {**old_cache.config, "generationBindingSha256": self.binding_sha}
        real_composed = p.composed
        def composed(binding):
            module = real_composed(binding)
            module.common = lambda: c
            return module
        def module(path, digest):
            self.public(path, digest)
            if Path(path).name == "ypal-ordinary-read-admission-v5b.py":
                return delta
            if Path(path).name == "ypal-ordinary-metadata-handover-v5.py":
                return types.SimpleNamespace(namespace=lambda _: metadata)
            if Path(path).name == h.OWNER_FILE:
                return b.owner
            if Path(path).name == "ypal-ordinary-generation-candidates-v5.py":
                return types.SimpleNamespace(namespace=lambda _: selector)
            return original(path, digest)
        with patch.object(p, "composed", side_effect=composed), patch.object(c, "public", side_effect=self.public), \
                patch.object(c, "load_input", return_value=old_cache.execution), patch.object(c, "module", side_effect=module), \
                patch.object(c, "intake", return_value=types.SimpleNamespace(protected=self.public)):
            value = p.namespace(config)
        return value, config

    def test_actual_binding_source_closure_and_artifact_no_candidate_or_install_success(self):
        binding = self.binding()
        self.assertEqual(binding.value, self.manifests[h.MANIFEST.name])
        self.assertEqual(binding.value["dataIdentity"], load("ypal-ordinary-reader-proof-v6.py").DATA_IDENTITY)
        self.assertEqual(binding.value["retained"]["currentGeneration"], "103")
        self.assertEqual(binding.value["retained"]["previousGeneration"], "102")
        self.assertEqual(binding.value["artifact"]["digest"], "a39b937dbe2278478ccbecb16af362707e9b8160092488c15e513a28e5a2878a")
        self.assertNotIn("candidateSha256", binding.value)
        self.assertNotIn("installAcknowledged", binding.value)
        self.assertGreater(len(binding.value["files"]), 100)
        self.assertEqual(binding.value["files"], {h.OWNER_FILE: h.sha(self.public(h.OWNER_FILE)), **h.literal_source_pins(self.public(h.OWNER_FILE))})

    def test_authenticate_whole_literal_closure_before_owner_evaluation(self):
        events = []
        actual = h.load_code
        def source(path, *args):
            events.append(Path(path).name)
            return self.public(path, *args)
        def execute(path, digest):
            self.assertTrue(set(self.manifests[h.MANIFEST.name]["files"]) <= set(events))
            events.append("evaluate-owner")
            return actual(path, digest)
        with patch.object(h, "public", side_effect=source), patch.object(h, "load_code", side_effect=execute):
            self.binding()
        self.assertIn("evaluate-owner", events)
        with patch.object(h, "load_code", side_effect=AssertionError("untrusted owner evaluated")):
            def changed(path, *args):
                if Path(path).name == "ypal-ordinary-generation-watch-v5c.py":
                    raise RuntimeError("changed_old_monitor")
                return self.public(path, *args)
            with patch.object(h, "public", side_effect=changed), self.assertRaisesRegex(RuntimeError, "changed_old_monitor"):
                self.binding()

    def test_paths_versions_domains_data_identity_and_real_retained_refs_are_finite(self):
        original = self.manifests[h.MANIFEST.name]
        for change in [lambda v: v["owner"].update(file="https://example.invalid/owner.py"),
                       lambda v: v["owner"].update(base=h.RETAINED_BASE),
                       lambda v: v["owner"].update(candidateFormat="yunipals-ypal-ordinary-generation-candidate-v5c"),
                       lambda v: v["retained"].update(capsuleSha256="f" * 64),
                       lambda v: v["dataIdentity"].update(readSchema="invented_v7"),
                       lambda v: v["artifact"].update(digest="0" * 64),
                       lambda v: v.update(version=True),
                       lambda v: v["files"].update({"../foreign.py": "a" * 64})]:
            value = copy.deepcopy(original); change(value)
            with self.assertRaises(RuntimeError):
                h.contract(value)
        for raw in [b"SOURCE_PINS = dict()", b"SOURCE_PINS = {}; SOURCE_PINS = {}"]:
            with self.assertRaises(RuntimeError):
                h.literal_source_pins(raw)

    def test_real_provider_has_new_identity_V5_data_actual_owner_and_same_transaction_bodies(self):
        n, config = self.provider_namespace()
        runtime = n.cache_runtime()
        old = load("ypal-cache-guard-owner-v1.py")
        self.assertEqual(runtime.FORMAT, p.FORMAT)
        self.assertEqual(runtime.BASE, p.BASE)
        self.assertEqual(runtime.GENERATION_OWNER.name, h.OWNER_FILE)
        self.assertEqual(runtime.GENERATION.parent, Path(h.ATTEMPT_BASE))
        self.assertIn(h.CANDIDATE_FORMAT, runtime.Host.prerequisites.__code__.co_consts)
        self.assertEqual(runtime.IDENTITY, h.DATA_IDENTITY["readIdentity"])
        self.assertIn(360, runtime._sql_child.__code__.co_consts)
        for name in ["commit", "reconcile_commit", "inverse", "reconcile_inverse", "drain", "prepare_ack"]:
            self.assertEqual(getattr(runtime, name).__code__.co_code, getattr(old, name).__code__.co_code, name)
        self.assertEqual(p.config_checked(config), config)
        with self.assertRaises(RuntimeError):
            p.config_checked({key: value for key, value in config.items() if key != "generationBindingSha256"})

    def test_real_phase_reads_retained_capsule_path_without_old_candidate_alias(self):
        n, config = self.provider_namespace(); runtime = n.cache_runtime(); read = n.read_module()
        candidate = {"format": h.CANDIDATE_FORMAT, "operatorSha256": self.binding().value["owner"]["sha256"],
                     "built": True, "validated": True, "completed": True, "published": False,
                     "sourceRelease": h.DATA_IDENTITY["sourceRelease"], "readIdentity": h.DATA_IDENTITY["readIdentity"],
                     "predecessorGenerationId": "103", "readAdmissionSha256": config["readAdmissionSha256"],
                     "readConfig": {"admissionSha256": config["readAdmissionSha256"], "readPlanSha256": config["readPlanSha256"], "readContextInputSha256": config["readContextInputSha256"]},
                     "metadataOperatorSha256": p.METADATA_SHA, "metadataSelectedSha256": config["metadataSelectionSha256"],
                     "metadataProvenanceSha256": config["metadataProvenanceSha256"], "operationSha256": "c" * 64,
                     "retainedOperationSha256": h.RETAINED["operationSha256"], "capsuleResultFile": h.RETAINED["capsuleFile"],
                     "capsuleResultSha256": h.RETAINED["capsuleSha256"],
                     "recoveryComponent": copy.deepcopy(h.RECOVERY_COMPONENT), "originalStrictCapsuleVerifierPassed": False}
        op = {"format": h.OWNER_FORMAT, "operatorSha256": candidate["operatorSha256"], "bootId": "fixture-boot",
              "readAdmissionSha256": config["readAdmissionSha256"]}
        capsule = {"actualRetainedFixture": True}; paths = []
        def document(path, digest=None):
            paths.append(str(path))
            if Path(path) == runtime.GENERATION: return candidate
            if Path(path) == Path(h.ATTEMPT_BASE) / "operation.json": return op
            if str(path) == h.RETAINED["capsuleFile"]: return capsule
            self.fail("Unexpected generation path " + str(path))
        phase = object.__new__(n.Phase); phase.cache = runtime
        phase.host = types.SimpleNamespace(config=config, new_read=read)
        with patch.object(read, "document", side_effect=document), patch.object(read, "boot", return_value="fixture-boot"):
            result = phase.generation()
            self.assertEqual(result[1:], (candidate, op, capsule))
            self.assertIn(h.RETAINED["capsuleFile"], paths)
            self.assertNotIn(str(Path(h.ATTEMPT_BASE) / "capsule-result.json"), paths)
            candidate["format"] = "yunipals-ypal-ordinary-generation-candidate-v5c"
            with self.assertRaises(RuntimeError): phase.generation()

    def test_real_bound_proof_and_coordinator_retain_all_forward_inverse_transaction_bodies(self):
        proof = r.Proof(self.reader_sha)
        self.assertEqual(proof.READ, h.DATA_IDENTITY["readSchema"])
        self.assertIsNone(proof._authorized_dependencies)
        self.assertEqual(proof.CACHE_SHA, h.sha(self.public(p.FILE)))
        self.assertEqual(proof.pure.SOURCE_MANIFEST, r.MANIFEST)
        self.assertIn(r.FORMAT, proof.pure.SourceIndependentReaderMethods.logins_enabled.__code__.co_consts)
        self.assertIn(r.FILE.name, proof.pure.SourceIndependentReaderMethods.logins_enabled.__code__.co_consts)
        root = r.assemble(self.public(r.TEMPLATE, r.TEMPLATE_SHA), proof)
        original = load("ypal-native-cutover-v1.py")
        self.assertEqual(root.FORMAT, r.FORMAT)
        self.assertEqual(root.MANIFEST, r.MANIFEST)
        self.assertEqual(root.PROOF, r.FILE.name)
        self.assertEqual(root.ENTRY.name, r.SQL)
        self.assertEqual(root.__file__, str(r.FILE))
        for name in ["publish", "admit_readers", "reconcile_roles", "reconcile_publication", "inverse", "inverse_global", "validate_current"]:
            self.assertEqual(getattr(root, name).__code__.co_code, getattr(original, name).__code__.co_code, name)
        self.assertIn(360, root.child.__code__.co_consts)
        self.assertEqual(root.MAX_PREPARATION_SECONDS, 1200)

    def test_actual_semantic_component_routes_through_SQL_wire_peer_and_both_parent_launches(self):
        wire_builder = load("ypal-ordinary-reader-recovery-wire-v1.py")
        for name, raw in wire_builder.build().items():
            self.assertEqual((HERE / name).read_bytes(), raw)
        sql = self.public(r.SQL).decode()
        self.assertEqual(sql.count(h.RECOVERY_COMPONENT["sha256"]), 2)
        self.assertNotIn("ypal-ordinary-generation-recovery-v5.mjs", sql)
        self.assertNotIn(h.RECOVERY_COMPONENT["semantics"]["predecessorComponentSha256"], sql)
        proof = r.Proof(self.reader_sha)
        self.assertEqual(proof.generation_binding.value["recoveryComponent"], h.RECOVERY_COMPONENT)
        self.assertEqual(proof._implementation.WIRE_SHA, r.WIRE_SHA)
        self.assertEqual(proof._implementation.TRANSPORT, r.TRANSPORT)
        self.assertEqual(proof._implementation.TRANSPORT_SHA, r.TRANSPORT_SHA)
        self.assertEqual(proof._implementation.NEW_QUALIFICATION, r.QUALIFICATION)
        root = r.assemble(self.public(r.TEMPLATE, r.TEMPLATE_SHA), proof)
        self.assertIn(r.WIRE_SHA, root.child.__code__.co_consts)
        self.assertIn(r.WIRE_SHA, root.action_preflight.__code__.co_consts)
        self.assertNotIn("f38f5636bdd5681159eece772e2a981fde910ee26d745712df7b05f05fe879c4", root.child.__code__.co_consts)
        peer = proof.transport_module()
        self.assertEqual(h.sha(self.public(r.TRANSPORT)), r.TRANSPORT_SHA)
        self.assertEqual(peer.PINS[r.WIRE], r.WIRE_SHA)
        self.assertEqual(peer.PINS[h.RECOVERY_COMPONENT["file"]], h.RECOVERY_COMPONENT["sha256"])
        self.assertNotIn("ypal-ordinary-generation-recovery-v5.mjs", peer.PINS)
        self.assertEqual(self.manifests[r.MANIFEST.name]["transportQualification"]["newProducerSha256"], r.TRANSPORT_SHA)
        self.assertEqual(self.manifests[r.MANIFEST.name]["transportQualification"]["newQualificationFile"], str(r.QUALIFICATION))
        n, _ = self.provider_namespace()
        self.assertEqual(n.cache_runtime().ENTRY.name, "ypal-ordinary-cache-sql-v6.mjs")
        self.assertEqual(h.sha(self.public("ypal-ordinary-cache-sql-v6.mjs")), "a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705")
        self.assertEqual(h.sha(self.public("ypal-ordinary-cache-peer-v6.py")), "4ddd3b021c31e7a2f663df82bb7e3308c22b5b2f1cec5345979286efcff59e04")

    def test_candidate_requires_actual_semantic_identity_and_no_old_strict_success_alias(self):
        binding = self.binding()
        candidate = {"format": h.CANDIDATE_FORMAT, "operatorSha256": binding.value["owner"]["sha256"],
                     "capsuleResultFile": h.RETAINED["capsuleFile"], "capsuleResultSha256": h.RETAINED["capsuleSha256"],
                     "retainedOperationSha256": h.RETAINED["operationSha256"], "recoveryComponent": copy.deepcopy(h.RECOVERY_COMPONENT),
                     "originalStrictCapsuleVerifierPassed": False,
                     "sourceRelease": h.DATA_IDENTITY["sourceRelease"], "readIdentity": h.DATA_IDENTITY["readIdentity"]}
        config = {"generationBindingSha256": self.binding_sha}
        self.assertIs(binding.candidate(candidate, config), candidate)
        for change in [lambda v: v.update(originalStrictCapsuleVerifierPassed=True),
                       lambda v: v.update(format="yunipals-ypal-ordinary-generation-attempt-candidate-v1"),
                       lambda v: v["recoveryComponent"].update(sha256=h.RECOVERY_COMPONENT["semantics"]["predecessorComponentSha256"]),
                       lambda v: v["recoveryComponent"]["semantics"].update(allocatedBytes="identity")]:
            value = copy.deepcopy(candidate); change(value)
            with self.assertRaises(RuntimeError): binding.candidate(value, config)

    def test_actual_cache_finish_namespace_uses_bound_manifest_and_retains_all_bodies(self):
        proof = r.Proof(self.reader_sha)
        root = r.assemble(self.public(r.TEMPLATE, r.TEMPLATE_SHA), proof)
        root.public_input = self.public
        context = types.SimpleNamespace(proof=proof, inputs={"sourceManifestSha256": self.reader_sha})
        finish = proof.cache_finish_module(root, context)
        original = load("ypal-cache-finish-v2.py")
        self.assertEqual(finish.FORMAT, r.CACHE_FORMAT)
        self.assertEqual(finish.BASE, r.CACHE_BASE)
        self.assertEqual(finish.MANIFEST, r.MANIFEST)
        self.assertEqual(finish.__file__, str(r.FILE))
        for name in ["context", "review", "start", "reconcile_start", "accept", "validate_cache_leaf", "drain_for_inverse", "restore_old"]:
            self.assertEqual(getattr(finish, name).__code__.co_code, getattr(original, name).__code__.co_code, name)
        self.assertEqual(finish.load(self.reader_sha), (root, proof))
        with self.assertRaises(RuntimeError): finish.load(r.FROZEN_MANIFEST_SHA)
        seen = []
        operation_raw = b"synthetic actual bound cache prerequisite operation"
        receipt = {"completed": True, "operationSha256": h.sha(operation_raw), "sourceManifestSha256": self.reader_sha}
        root.validate_current = lambda result_sha, manifest_sha: seen.append((result_sha, manifest_sha))
        root.operation = lambda _: {"synthetic": True}
        root.current_context = lambda *_: context
        root.document = lambda *_: receipt
        root.public_input = lambda _: operation_raw
        proof.pure.protected = self.public
        result = finish.context(root, proof, "a" * 64)
        self.assertIs(result[0], context)
        self.assertEqual(seen, [("a" * 64, self.reader_sha)])

    def test_bound_manifest_real_closure_new_ack_route_and_no_source_hash_cycle(self):
        binding = self.binding(); manifest = self.manifests[r.MANIFEST.name]
        self.assertEqual(r.manifest_contract(manifest, binding), manifest)
        self.assertEqual(manifest["acknowledgementRoute"], {"file": r.FILE.name, "sha256": h.sha(self.public(r.FILE)), "method": "acknowledgement"})
        self.assertNotEqual(manifest["contexts"]["phase"]["file"], "ypal-ordinary-read-cache-v6.py")
        self.assertIn("ypal-ordinary-read-cache-v6.py", manifest["dependencies"])
        self.assertNotIn(a.FILE.name, h.literal_source_pins(self.public(h.OWNER_FILE)))
        for change in [lambda v: v["acknowledgementRoute"].update(file="ypal-ordinary-reader-cutover-v6.py"),
                       lambda v: v["contexts"]["generation"].update(file="ypal-ordinary-generation-v5c.py"),
                       lambda v: v["dependencies"].update({h.MANIFEST.name: "f" * 64})]:
            value = copy.deepcopy(manifest); change(value)
            with self.assertRaises(RuntimeError): r.manifest_contract(value, binding)

    def test_bound_acknowledgement_uses_actual_new_records_and_refuses_frozen_success(self):
        module = r.coordinator_module()
        operation_bytes = b"synthetic bound operation"
        publication_bytes = b"synthetic bound publication"
        config = {"readAdmissionSha256": "1" * 64, "readPlanSha256": "2" * 64,
                  "readContextInputSha256": "3" * 64}
        inputs = {"readPlanSha256": config["readPlanSha256"], "readContextInputSha256": config["readContextInputSha256"],
                  "cacheInputsSha256": "4" * 64, "cachePreparedSha256": "5" * 64}
        operator_sha = h.sha(self.public(r.FILE))
        op = {"binding": {"operatorSha256": operator_sha, "inputs": inputs}}
        result = {"format": r.FORMAT, "completed": True, "readersCutOver": True, "nativeGenerationPublished": True,
                  "operatorSha256": operator_sha, "operationSha256": h.sha(operation_bytes),
                  "sourceManifestSha256": self.reader_sha, "publicationSha256": h.sha(publication_bytes),
                  "readerActors": {"fixtureOnly": True}}
        seen = []
        def public_input(path):
            seen.append(Path(path))
            return operation_bytes if Path(path).name == "operation.json" else publication_bytes
        c = types.SimpleNamespace(intake=lambda: types.SimpleNamespace(document=lambda *_: config),
                                  authenticate_recorded_read=lambda refs: seen.append(refs))
        phase = types.SimpleNamespace(INPUT=p.INPUT, common=lambda: c)
        proof = types.SimpleNamespace(module_context=lambda _: phase, READ=h.DATA_IDENTITY["readSchema"],
                                      IDENTITY=h.DATA_IDENTITY["readIdentity"], RELEASE=h.DATA_IDENTITY["sourceRelease"])
        root = types.SimpleNamespace(published=lambda _: (op, {}, {}), document=lambda *_: result,
                                     public_input=public_input, PUBLICATION=r.BASE / "publication")
        with patch.object(module, "core", return_value=(root, proof)), patch.object(module, "protected", side_effect=self.public):
            ack = module.acknowledgement("6" * 64, self.reader_sha)
            self.assertEqual(ack["operatorSha256"], operator_sha)
            self.assertEqual(ack["manifestSha256"], self.reader_sha)
            self.assertTrue(ack["immutableReaderAcknowledgementOnly"])
            self.assertFalse(ack["currentReadersQualified"])
            self.assertIn(r.BASE / "operation.json", seen)
            result["format"] = "yunipals-ypal-ordinary-reader-cutover-v6"
            with self.assertRaises(RuntimeError): module.acknowledgement("6" * 64, self.reader_sha)

    def test_terminal_api_is_narrow_owner_proof_not_prepublication_database_assertion(self):
        binding = self.binding(); candidate = {"operationSha256": "c" * 64}; candidate_sha = "d" * 64
        value = {"validated": True, "readOnly": True, "candidateSha256": candidate_sha,
                 "operatorSha256": binding.value["owner"]["sha256"], "operationSha256": candidate["operationSha256"],
                 "retainedOperationSha256": h.RETAINED["operationSha256"], "capsuleSha256": h.RETAINED["capsuleSha256"],
                 "capsuleFile": h.RETAINED["capsuleFile"], "originalBootArchive": h.RETAINED["originalBootArchive"],
                 "legacyTerminal": True, "failedWorkerTerminal": True, "attemptWorkerTerminal": True,
                 "actualFailedApplicationEmpty": True, "actualAttemptApplicationEmpty": True,
                 "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}
        with patch.object(binding.owner, "validate_retained_current", return_value=value), \
                patch.object(binding.owner, "validate_candidate_database_current", side_effect=AssertionError("unpublished validation is a separate gate")):
            self.assertEqual(binding.terminal(candidate_sha, candidate), value)
            for key in ["actualFailedApplicationEmpty", "actualAttemptApplicationEmpty", "failedWorkerTerminal", "legacyTerminal"]:
                value[key] = False
                with self.assertRaises(RuntimeError): binding.terminal(candidate_sha, candidate)
                value[key] = True
            value["originalBootArchive"] = str(Path(h.ATTEMPT_BASE) / "original-boot-link")
            with self.assertRaises(RuntimeError): binding.terminal(candidate_sha, candidate)

    def test_actual_timing_domains_reject_frozen_and_other_binding_receipts(self):
        m = a.composed(); m.own_sha = lambda: h.sha(self.public(a.FILE))
        protocol = load("ypal-ordinary-publication-protocol-v6.py")
        session = types.SimpleNamespace(key={"target": "cache", "inputSha256": "fixture-input", "direction": "forward"},
                    host=types.SimpleNamespace(config={"generationBindingSha256": self.binding_sha}), protocol=protocol)
        key = m.timing_key(session, "cache-prepared")
        self.assertEqual(key["generationBindingSha256"], self.binding_sha)
        self.assertEqual(key["providerSha256"], h.sha(self.public(p.FILE)))
        self.assertEqual(key["readerSha256"], h.sha(self.public(r.FILE)))
        self.assertEqual(key["proofSha256"], key["readerSha256"])
        self.assertNotEqual(key["operatorSha256"], a.FROZEN_SHA)
        receipt = {"binding": key, "completed": True, "elapsedNanoseconds": 20779000000, "reservedEffectNanoseconds": 0,
                   "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0, "syntheticTimingInputOnly": True}
        session.g = types.SimpleNamespace(public=lambda *_: h.encoded(receipt))
        ref = {"captureId": "synthetic-current", "sha256": "a" * 64}
        self.assertEqual(m.require_timing(session, ref, "cache-prepared"), receipt)
        for changed in [{"generationBindingSha256": "f" * 64}, {"operatorSha256": a.FROZEN_SHA}, {"providerSha256": p.FROZEN_SHA}, {"mode": "cache-inverse"}]:
            receipt["binding"] = {**key, **changed}
            with self.assertRaises(RuntimeError): m.require_timing(session, ref, "cache-prepared")

    def test_typed_external_bound_feature_hook_authenticates_actual_route_without_recursion(self):
        proof = r.Proof(self.reader_sha)
        owner_raw, context_raw = self.public(r.FEATURE), self.public(r.FEATURE_CONTEXT)
        refs = {"resultSha256": "1" * 64, "manifestSha256": "2" * 64, "inputSha256": "3" * 64,
                "producerSha256": h.sha(owner_raw), "contextSha256": h.sha(context_raw)}
        manifest = {"format": r.FEATURE_FORMAT + "-code", "files": {r.FEATURE: refs["producerSha256"], r.FEATURE_CONTEXT: refs["contextSha256"]},
                    "dependencies": {r.FILE.name: h.sha(self.public(r.FILE)), p.FILE.name: h.sha(self.public(p.FILE))}}
        result_raw = b"synthetic completed bound reader receipt"
        recorded = {"operatorSha256": h.sha(self.public(r.FILE)), "manifestSha256": self.reader_sha,
                    "operationSha256": "4" * 64, "publicationSha256": "5" * 64,
                    "readConfig": {"admissionSha256": "8" * 64, "readPlanSha256": "9" * 64, "readContextInputSha256": "a" * 64}, "cachePreparedSha256": "6" * 64,
                    "cacheInputsSha256": "7" * 64, "immutableReaderAcknowledgementOnly": True, "validated": True}
        ancestry = {"readerResultSha256": h.sha(result_raw), "readerManifestSha256": self.reader_sha,
                    "readerOperatorSha256": recorded["operatorSha256"], "readerOperationSha256": recorded["operationSha256"],
                    "readerPublicationSha256": recorded["publicationSha256"], "readConfig": recorded["readConfig"],
                    "cachePreparedSha256": recorded["cachePreparedSha256"], "cacheInputsSha256": recorded["cacheInputsSha256"]}
        feature = {"format": r.FEATURE_FORMAT, "operatorSha256": refs["producerSha256"], "contextSha256": refs["contextSha256"],
                   "receiptSha256": refs["resultSha256"], "manifestSha256": refs["manifestSha256"], "inputSha256": refs["inputSha256"],
                   "readerAncestry": ancestry, "validated": True, "temporarySourceRetired": True, "collectorOnlyCurrentGraphQualified": True,
                   **{key: False for key in ["sourceActorQualified", "financialAuthorityQualified", "independentPeerLifecyclesQualified",
                       "allConfiguredSourcesQualified", "originalWholeValidatorsPassed", "current143WholeGraphQualified"]}}
        # Real thin feature context produces the envelope from synthetic
        # retained-leaf-shaped data and an immutable ACK fixture. No event,
        # runtime actor or successful business receipt is supplied by this test.
        feature_context = load(r.FEATURE_CONTEXT)
        manifest["dependencies"] = {**feature_context.PINNED, **manifest["dependencies"],
                                    feature_context.READER_MANIFEST: self.reader_sha}
        recorded.update(receiptSha256=h.sha(result_raw), published=True,
                        readSchema=h.DATA_IDENTITY["readSchema"], readIdentity=h.DATA_IDENTITY["readIdentity"],
                        sourceRelease=h.DATA_IDENTITY["sourceRelease"], currentReadersQualified=False,
                        currentWriterQualified=False, sourceActorQualified=False,
                        databaseWrites=0, serviceActions=0, providerCalls=0)
        feature_host = types.SimpleNamespace(
            config={"readerResultSha256": h.sha(result_raw), "readerManifestSha256": self.reader_sha,
                    "readAdmissionSha256": "8" * 64, "readPlanSha256": "9" * 64, "readContextInputSha256": "a" * 64,
                    "cachePreparedSha256": "6" * 64, "cacheInputsSha256": "7" * 64},
            manifest=manifest, manifest_pin=refs["manifestSha256"], input_pin=refs["inputSha256"],
            intake=types.SimpleNamespace(DATA=h.DATA_IDENTITY),
            b=types.SimpleNamespace(document=lambda *_: self.manifests[r.MANIFEST.name]),
            coordinator=types.SimpleNamespace(MANIFEST=r.MANIFEST, acknowledgement=lambda *_: recorded)
        )
        retained_leaf = {key: value for key, value in feature.items()
                         if key not in {"manifestSha256", "inputSha256", "contextSha256", "readerAncestry"}}
        retained_leaf.update(databaseWrites=0, serviceActions=0, providerCalls=0)
        with patch.object(feature_context, "helper", return_value=h):
            feature = feature_context.feature_leaf_binding(feature_host, retained_leaf)
        self.assertEqual(feature["readerAncestry"], ancestry)
        context = types.SimpleNamespace(inputs={"cachePreparedSha256": recorded["cachePreparedSha256"], "cacheInputsSha256": recorded["cacheInputsSha256"]})
        events = []
        def source(path, digest=None, maximum=200000):
            name = Path(path).name
            if path == r.FEATURE_MANIFEST: return json.dumps(manifest).encode()
            if name in {r.FEATURE, r.FEATURE_CONTEXT}:
                raw = owner_raw if name == r.FEATURE else context_raw
                self.assertEqual(h.sha(raw), digest); events.append(name); return raw
            if Path(path) == r.BASE / "result.json": return result_raw
            events.append(name)
            return self.public(path, digest, maximum)
        owner = types.SimpleNamespace(FORMAT=r.FEATURE_FORMAT, CONTEXT=r.OPS / r.FEATURE_CONTEXT,
                                      validate_feature_leaf=lambda *_: feature)
        def evaluate(path, digest):
            self.assertTrue({r.FEATURE, r.FEATURE_CONTEXT, r.FILE.name, p.FILE.name} <= set(events))
            events.append("evaluate-feature")
            return owner
        with patch.object(h, "public", side_effect=source), patch.object(h, "load_code", side_effect=evaluate), \
                patch.object(r, "acknowledgement", return_value=recorded) as acknowledgement:
            self.assertIs(proof.external_feature_leaf(context, refs), feature)
            acknowledgement.assert_called_once_with(h.sha(result_raw), self.reader_sha)
            feature["readerAncestry"] = {**ancestry, "readerManifestSha256": r.FROZEN_MANIFEST_SHA}
            with self.assertRaisesRegex(RuntimeError, "exact_actual_bound_reader"):
                proof.external_feature_leaf(context, refs)
            feature["readerAncestry"] = ancestry
            feature["sourceActorQualified"] = True
            with self.assertRaises(RuntimeError): proof.external_feature_leaf(context, refs)
            feature["sourceActorQualified"] = False
            manifest["dependencies"][r.FILE.name] = r.FROZEN_READER_SHA
            events.clear()
            with self.assertRaisesRegex(RuntimeError, "real_reader_provider"):
                proof.external_feature_leaf(context, refs)
            self.assertNotIn("evaluate-feature", events)
            manifest["dependencies"][r.FILE.name] = h.sha(self.public(r.FILE))
            manifest["format"] = "yunipals-ypal-ordinary-feature-handover-v6-code"
            with self.assertRaises(RuntimeError): proof.external_feature_leaf(context, refs)

    def test_reader_inverse_and_unrouted_frozen_feature_remain_closed(self):
        proof = r.Proof(self.reader_sha)
        with self.assertRaisesRegex(RuntimeError, "five_refs"):
            proof.external_feature_leaf(None, {})
        m = a.composed(); calls = []
        names = ["review", "admit_readers", "publication_review", "publish", "continue_review", "continue_readers", "reconcile_roles",
                 "reconcile_publication", "inverse_review", "inverse", "reconcile_inverse"]
        root = types.SimpleNamespace(**{name: lambda *_: calls.append("effect") for name in names})
        session = types.SimpleNamespace(root=root, proof=object(), source=types.SimpleNamespace(inverse=True))
        with self.assertRaisesRegex(RuntimeError, "separate_context_and_mode"):
            m.execute_reader(session, "inverse", [], "synthetic-inverse")
        self.assertEqual(calls, [])

    def test_default_entrypoints_no_runtime_constructor_or_effect_dispatch(self):
        for module in [h, p, r, a, builder]:
            result = subprocess.run(["/usr/bin/python3", "-I", "-B", module.__file__], capture_output=True, check=True)
            value = json.loads(result.stdout)
            self.assertTrue(value.get("staticOnly", False))
            self.assertEqual(value["databaseWrites"], 0)
            self.assertEqual(value["serviceActions"], 0)
            self.assertEqual(value["providerCalls"], 0)
            self.assertEqual(result.stderr, b"")
        for module in [p, r, a]:
            result = subprocess.run(["/usr/bin/python3", "-I", "-B", module.__file__, "--commit"], capture_output=True)
            self.assertNotEqual(result.returncode, 0)

    def test_frozen_source_bytes_remain_immutable_and_adapters_are_small(self):
        for path, digest in [(p.FROZEN, p.FROZEN_SHA), (r.FROZEN_READER, r.FROZEN_READER_SHA),
                             (r.FROZEN_PROOF, r.FROZEN_PROOF_SHA), (a.FROZEN, a.FROZEN_SHA), (r.FROZEN_MANIFEST, r.FROZEN_MANIFEST_SHA)]:
            self.assertEqual(h.sha(self.public(path)), digest)
        for module in [p, r, a]:
            self.assertLess(Path(module.__file__).stat().st_size, 22000)
        with self.assertRaises(RuntimeError): h.derive(b"bad frozen bytes", p.FROZEN_SHA, p.FILE)


if __name__ == "__main__":
    unittest.main(verbosity=2)
