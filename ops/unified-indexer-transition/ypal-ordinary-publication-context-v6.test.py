"""Actual V6 source graph and unchanged business bodies, without host effects."""
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
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


provider = load("ypal-ordinary-read-cache-v6.py")
reader = load("ypal-ordinary-reader-cutover-v6.py")
proof = load("ypal-ordinary-reader-proof-v6.py")
caller = load("ypal-ordinary-publication-caller-v6.py")
finish = load("ypal-ordinary-cache-finish-v6.py")
protocol = load("ypal-ordinary-publication-protocol-v6.py")
previous_cache_tests = load("ypal-ordinary-read-cache-v5.test.py")
previous_caller_tests = load("ypal-ordinary-publication-caller-v5.test.py")


def local(path, digest=None, maximum=200000):
    raw = (HERE / Path(path).name).read_bytes()
    if digest is not None:
        provider.need(provider.sha(raw) == digest, "exact_local_V6_source_required")
    return raw


def cache_namespace():
    old = previous_cache_tests
    c = old.c
    original = c.module
    read = old.readtest.namespace()
    read.protected = local
    delta = load(provider.READ.name)
    delta.namespace = lambda: read
    metadata = old.metatest.namespace()
    gen_tests = load("ypal-ordinary-generation-v5c.test.py")
    generation = gen_tests.namespaces()
    generation_entry = load(provider.GENERATION.name)
    generation_entry.namespace = lambda *_: generation
    selector = load("ypal-generation-cache-candidates-v1.py")

    def module(path, digest):
        local(path, digest)
        if path == provider.READ:
            return delta
        if path == provider.METADATA:
            return types.SimpleNamespace(namespace=lambda _: metadata)
        if path == provider.GENERATION:
            return generation_entry
        if path == provider.CANDIDATES:
            return types.SimpleNamespace(namespace=lambda _: selector)
        return original(path, digest)

    intake = types.SimpleNamespace(protected=local)
    with patch.object(provider, "common", return_value=c), patch.object(c, "public", local), \
            patch.object(c, "load_input", return_value=old.execution), \
            patch.object(c, "module", side_effect=module), patch.object(c, "intake", return_value=intake):
        return provider.namespace(copy.deepcopy(old.config))


def controller():
    facade = types.SimpleNamespace(
        manifest_sha="a" * 64,
        module=lambda name, digest: load(name) if local(name, digest) else None,
        transport_current=lambda: None
    )
    return reader.assemble(local(reader.TEMPLATE, reader.TEMPLATE_SHA), facade)


class Controls(unittest.TestCase):
    def test_all_real_graph_pins_and_actual_V5_dataset(self):
        manifest = json.loads(local(reader.MANIFEST))
        self.assertEqual(proof.manifest_contract(manifest), manifest)
        for name, digest in {**manifest["files"], **manifest["dependencies"]}.items():
            self.assertEqual(provider.sha(local(name)), digest, name)
        self.assertEqual(proof.DATA_IDENTITY, load("ypal-ordinary-reader-proof-v5.py").DATA_IDENTITY)
        self.assertEqual(proof.DATA_IDENTITY["readSchema"], "yunipals_ownership_4e77f52b_v5")
        self.assertEqual(proof.DATA_IDENTITY["readSchemaOid"], "77370532")
        self.assertEqual(manifest["contexts"]["generation"]["file"], "ypal-ordinary-generation-v5c.py")
        self.assertEqual(provider.sha(local(provider.GENERATION)), provider.GENERATION_SHA)
        self.assertEqual(provider.sha(local(caller.GUARD)), caller.GUARD_SHA)
        self.assertEqual(provider.sha(local(caller.PROTOCOL)), caller.PROTOCOL_SHA)
        self.assertEqual(provider.sha(local(caller.QUERY)), caller.QUERY_SHA)
        for key, path in [(caller.PROVIDER_SHA, caller.PROVIDER), (caller.READER_SHA, caller.READER), (caller.PROOF_SHA, caller.PROOF)]:
            self.assertEqual(provider.sha(local(path)), key)
        bad = copy.deepcopy(manifest)
        bad["contexts"]["generation"] = {"file": "ypal-ordinary-generation-v5b.py", "sha256": "1" * 64}
        with self.assertRaises(RuntimeError):
            proof.manifest_contract(bad)

    def test_static_entrypoints_and_closed_unguarded_operational_CLIs(self):
        for module in [provider, reader, finish, caller]:
            result = subprocess.run(["/usr/bin/python3", "-I", "-B", module.__file__], capture_output=True, check=True)
            value = json.loads(result.stdout)
            self.assertTrue(value["staticOnly"])
            self.assertEqual(value["databaseWrites"], 0)
            self.assertEqual(value["serviceActions"], 0)
            self.assertEqual(result.stderr, b"")
        for module in [provider, reader, finish]:
            result = subprocess.run(["/usr/bin/python3", "-I", "-B", module.__file__, "--commit"], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            if module is not finish:
                self.assertIn(b"caller_context_and_timing_gate", result.stdout)

    def test_provider_uses_actual_V5c_namespace_not_a_relabeled_candidate(self):
        n = cache_namespace()
        runtime = n.cache_runtime()
        self.assertEqual(runtime.GENERATION_OWNER.name, "ypal-ordinary-generation-v5c.py")
        self.assertEqual(runtime.GENERATION.parent, Path("/var/backups/yunipals-ypal-ordinary-generation-v5c-20261025"))
        self.assertIn("yunipals-ypal-ordinary-generation-candidate-v5c", runtime.Host.prerequisites.__code__.co_consts)
        self.assertEqual(runtime.IDENTITY, proof.DATA_IDENTITY["readIdentity"])
        self.assertIn(360, runtime._sql_child.__code__.co_consts)
        self.assertIn(900, n.main.__code__.co_consts)
        self.assertNotIn(100, runtime._sql_child.__code__.co_consts)
        old = load("ypal-cache-guard-owner-v1.py")
        for name in ["commit", "inverse", "reconcile_commit", "reconcile_inverse", "drain", "rehearsal", "read_extension"]:
            self.assertEqual(getattr(runtime, name).__code__.co_code, getattr(old, name).__code__.co_code, name)
            self.assertIsNot(getattr(runtime, name).__globals__, getattr(old, name).__globals__)

    def test_real_phase_catalog_sessions_and_dependency_controls_under_new_provider(self):
        old = previous_cache_tests
        names = [
            "test_actual_phase_constructor_uses_new_static_ACKs_and_never_current_source",
            "test_actual_cache_sessions_host_address_avoids_genuine_inet_mapper_failure",
            "test_exact_installed_dependency_authority_precedes_any_new_SQL_child_evaluation",
            "test_transport_only_pins_new_three_public_modules",
            "test_catalog_sql_exact_V5_enhancement_and_wrapper_request_digest"
        ]
        with patch.object(old, "m", provider), patch.object(old, "namespace", cache_namespace):
            for name in names:
                with self.subTest(control=name):
                    getattr(old.Controls(), name)()

    def test_reader_exact_window_seams_and_business_bodies(self):
        root = controller()
        old = load("ypal-native-cutover-v1.py")
        self.assertEqual(root.ENTRY.name, "ypal-ordinary-reader-sql-v6.mjs")
        self.assertIn(360, root.child.__code__.co_consts)
        self.assertEqual(root.MAX_PREPARATION_SECONDS, 1200)
        self.assertIn("V6_parent_deadline_expired_before_literal_ACK_reconcile_only", root.child.__code__.co_consts)
        for name in ["publish", "reconcile_publication", "admit_readers", "reconcile_roles", "inverse", "inverse_global", "validate_current", "validate_reader_leaf"]:
            self.assertEqual(getattr(root, name).__code__.co_code, getattr(old, name).__code__.co_code, name)
        runtime = finish.assemble(local(finish.TEMPLATE, finish.TEMPLATE_SHA), root, types.SimpleNamespace())
        old_finish = load(finish.TEMPLATE)
        for name in ["start", "accept", "validate_cache_leaf", "drain_for_inverse", "restore_old"]:
            self.assertEqual(getattr(runtime, name).__code__.co_code, getattr(old_finish, name).__code__.co_code, name)

    def test_proof_static_construction_authenticates_new_graph(self):
        manifest_sha = provider.sha(local(reader.MANIFEST))
        with patch.object(proof, "protected", side_effect=local):
            p = proof.Proof(manifest_sha)
        self.assertEqual(p.READ, proof.DATA_IDENTITY["readSchema"])
        self.assertFalse(proof.EXCLUDED_METHODS & set(p.pure.SourceIndependentReaderMethods.__dict__))
        self.assertIsNone(p._authorized_dependencies)
        self.assertEqual(p.manifest["externalFeatureContract"]["ownerFile"], "ypal-ordinary-feature-handover-v6.py")
        self.assertNotIn("ypal-ordinary-feature-handover-v6.py", p.pins)

    def test_PreparedMetadata_binds_genuine_query_at_actual_constructor_instance(self):
        fixture = load("ypal-ordinary-publication-query-v2.test.py")
        adapter = fixture.m
        host = fixture.host()
        host.query = lambda sql: host.h.query(sql)
        host.refresh = lambda: None
        creator = types.SimpleNamespace(
            __file__="/actual/creator.py", BASE=Path("/actual/creator"), INPUT=Path("/actual/input.json"), PLAN=Path("/actual/plan.json"),
            PLAN_SHA="d" * 64, FACTORY=Path("/actual/factory.py"), FACTORY_SHA="f" * 64, TEMPLATE=Path("/actual/template.py"), TEMPLATE_SHA="e" * 64,
            READ_SCHEMA=proof.DATA_IDENTITY["readSchema"], READ_IDENTITY=proof.DATA_IDENTITY["readIdentity"], validate_plan=lambda value: value
        )
        creator.intake = lambda: types.SimpleNamespace(
            module=lambda *_: types.SimpleNamespace(namespace=lambda *_: types.SimpleNamespace(target_sql=lambda _: "SELECT marker")),
            protected=lambda *_: b"static creator", document=lambda *_: {}
        )
        primitives = {"reader": creator, "readConfig": {}, "admission_ref": {}, "created": {"target": {"marker": True}}}
        namespace = types.SimpleNamespace(
            __file__="/actual/metadata.py", INPUT=Path("/actual/meta-input.json"), SOURCES=Path("/actual/sources.json"), CANDIDATES=Path("/actual/candidates"),
            construct_context=lambda *_: host
        )
        phase = types.SimpleNamespace(metadata_primitives=lambda: primitives)
        calls = []
        guard = types.SimpleNamespace(module=lambda path, digest: calls.append((path, digest)) or adapter,
                                      read_data_identity=lambda value: value, file_frame=lambda paths: {path: "actual" for path in paths})
        relation = "(SELECT * FROM " + adapter.READ_SCHEMA + ".base_metadata_event WHERE chain_event_block_hash IS NOT NULL)"
        with patch.object(subprocess, "run", return_value=types.SimpleNamespace(returncode=0, stderr=b"", stdout=json.dumps({"sql": relation}).encode())):
            slot = caller.PreparedMetadata(namespace, phase, lambda: None, False, guard)
        self.assertEqual(calls, [(caller.QUERY, caller.QUERY_SHA)])
        self.assertTrue(slot.publication_query_binding["readOnly"])
        self.assertEqual(host.query("SELECT ordinary"), {"originalQuery": "SELECT ordinary"})
        with patch.object(adapter, "peer_read", return_value={"canonicalRows": 440194, "publishedRows": 440194, "probe": True}) as peer:
            host.h.query(host.h.sql)
            peer.assert_called_once_with(host.h.sql)
        self.assertIn(str(caller.QUERY), slot.paths)
        self.assertIn(str(caller.PROTOCOL), slot.paths)

    def test_prepared_whole_metadata_body_keeps_actor_private_database_and_refreshes(self):
        with patch.object(previous_caller_tests, "m", caller):
            previous_caller_tests.Controls().test_preconstructed_metadata_runs_genuine_whole_business_body_and_fresh_refreshes()
            previous_caller_tests.Controls().test_inverse_metadata_constructor_waits_for_actual_post_cache_prefix()
            previous_caller_tests.Controls().test_forward_reader_phase_dispatches_real_metadata_method_not_namespace_attribute()

    def test_real_guard_V5_inverse_removes_only_ready_operand(self):
        guard = load(caller.GUARD.name)
        with patch.object(guard, "public", side_effect=local):
            inverse = caller.inverse_active_authority(guard)
        original = ast.parse(local(caller.GUARD))
        cls = next(node for node in original.body if isinstance(node, ast.ClassDef) and node.name == "Authority")
        fn = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == "_native")
        self.assertIn("is_ready", ast.unparse(fn))
        self.assertNotIn("is_ready", str(inverse._native.__code__.co_consts))
        self.assertIn("schemaOid", inverse._native.__code__.co_consts)
        self.assertIn("nativeTableIdentities", inverse._native.__code__.co_consts)

    def test_actual_context_mode_and_arithmetic_gate_accept_measured20s_refuse_wrong_modes(self):
        session = types.SimpleNamespace(key={"target": "reader", "direction": "forward", "inputsSha256": "actual"}, protocol=protocol)
        receipt = {"binding": caller.timing_key(session, "reader-before-login"), "completed": True,
                   "elapsedNanoseconds": 20_779_000_000, "reservedEffectNanoseconds": 70_000_000_000,
                   "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0, "syntheticTimingInputOnly": True}
        session.g = types.SimpleNamespace(public=lambda *_: caller.encoded(receipt))
        ref = {"captureId": "fixture-capture", "sha256": "1" * 64}
        self.assertEqual(caller.require_timing(session, ref, "reader-before-login"), receipt)
        for update in [{"elapsedNanoseconds": 170_000_000_000}, {"elapsedNanoseconds": True}, {"reservedEffectNanoseconds": 0},
                       {"binding": caller.timing_key(session, "reader-after-login")}, {"serviceActions": 1}]:
            saved = copy.deepcopy(receipt)
            receipt.update(update)
            with self.assertRaises(RuntimeError):
                caller.require_timing(session, ref, "reader-before-login")
            receipt.clear()
            receipt.update(saved)

    def test_no_timing_no_effect_and_reader_inverse_dispatch_stays_closed(self):
        with patch.object(previous_caller_tests, "m", caller):
            previous_caller_tests.Controls().test_no_timing_no_effect_entry_and_no_automatic_unknown_COMMIT_resend()
            previous_caller_tests.Controls().test_exact_prepared_callback_save_is_only_redirected_not_COMMIT_or_predicates()
        calls = []
        actions = ["review", "admit_readers", "publication_review", "publish", "continue_review", "continue_readers", "reconcile_roles",
                   "reconcile_publication", "inverse_review", "inverse", "reconcile_inverse"]
        root = types.SimpleNamespace(**{name: lambda *_: calls.append("effect") for name in actions})
        session = types.SimpleNamespace(root=root, proof=object(), source=types.SimpleNamespace(inverse=True))
        with self.assertRaisesRegex(RuntimeError, "separate_context_and_mode"):
            caller.execute_reader(session, "inverse", [], "fixture-attempt")
        self.assertEqual(calls, [])

    def test_external_feature_cannot_supply_old_or_unrelated_reader_ancestry(self):
        refs = {key: digit * 64 for key, digit in zip(
            ["resultSha256", "manifestSha256", "inputSha256", "producerSha256", "contextSha256"], "12345")}
        manifest = {"format": "yunipals-ypal-ordinary-feature-handover-v6-code",
                    "files": {proof.FEATURE: refs["producerSha256"], proof.FEATURE_CONTEXT: refs["contextSha256"]},
                    "dependencies": {reader.MANIFEST.name.replace(".manifest.json", ".py"): caller.READER_SHA, provider.FILE.name: caller.PROVIDER_SHA}}
        recorded = {"operatorSha256": caller.READER_SHA, "operationSha256": "6" * 64, "publicationSha256": "7" * 64,
                    "readConfig": {"admissionSha256": "actual-read", "readPlanSha256": "actual-plan", "readContextInputSha256": "actual-context"}, "cachePreparedSha256": "actual-cache", "cacheInputsSha256": "actual-input"}
        result_sha = provider.sha(b"actual completed reader")
        ancestry = {"readerResultSha256": result_sha, "readerManifestSha256": "8" * 64, "readerOperatorSha256": caller.READER_SHA,
                    "readerOperationSha256": recorded["operationSha256"], "readerPublicationSha256": recorded["publicationSha256"],
                    "readConfig": recorded["readConfig"], "cachePreparedSha256": "actual-cache", "cacheInputsSha256": "actual-input"}
        value = {"format": "yunipals-ypal-ordinary-feature-handover-v6", "operatorSha256": refs["producerSha256"],
                 "contextSha256": refs["contextSha256"], "receiptSha256": refs["resultSha256"], "manifestSha256": refs["manifestSha256"],
                 "inputSha256": refs["inputSha256"], "readerAncestry": ancestry,
                 "validated": True, "temporarySourceRetired": True, "collectorOnlyCurrentGraphQualified": True,
                 **{key: False for key in ["sourceActorQualified", "financialAuthorityQualified", "independentPeerLifecyclesQualified",
                    "allConfiguredSourcesQualified", "originalWholeValidatorsPassed", "current143WholeGraphQualified"]}}
        # Exercise the real companion context's return envelope. Its input is
        # synthetic retained-leaf-shaped data, never an event/runtime receipt.
        feature_context = load("ypal-ordinary-feature-context-v6.py")
        recorded.update(validated=True, immutableReaderAcknowledgementOnly=True, published=True,
                        receiptSha256=result_sha, manifestSha256="8" * 64,
                        readSchema=proof.DATA_IDENTITY["readSchema"], readIdentity=proof.DATA_IDENTITY["readIdentity"],
                        sourceRelease=proof.DATA_IDENTITY["sourceRelease"], currentReadersQualified=False,
                        currentWriterQualified=False, sourceActorQualified=False,
                        databaseWrites=0, serviceActions=0, providerCalls=0)
        host = types.SimpleNamespace(
            config={"readerResultSha256": result_sha, "readerManifestSha256": "8" * 64,
                    "readAdmissionSha256": "actual-read", "readPlanSha256": "actual-plan", "readContextInputSha256": "actual-context",
                    "cachePreparedSha256": "actual-cache", "cacheInputsSha256": "actual-input"},
            manifest=manifest, manifest_pin=refs["manifestSha256"], input_pin=refs["inputSha256"],
            intake=types.SimpleNamespace(DATA=proof.DATA_IDENTITY),
            coordinator=types.SimpleNamespace(acknowledgement=lambda *_: recorded)
        )
        retained_leaf = {key: item for key, item in value.items()
                         if key not in {"manifestSha256", "inputSha256", "contextSha256", "readerAncestry"}}
        retained_leaf.update(databaseWrites=0, serviceActions=0, providerCalls=0)
        value = feature_context.feature_leaf_binding(host, retained_leaf)
        self.assertEqual(value["readerAncestry"], ancestry)
        p = object.__new__(proof.Proof)
        p.manifest_sha = "8" * 64
        p.pins = {"ypal-ordinary-reader-cutover-v6.py": caller.READER_SHA}
        p.module = lambda *_: types.SimpleNamespace(acknowledgement=lambda *_: recorded)
        context = types.SimpleNamespace(inputs={"cachePreparedSha256": "actual-cache", "cacheInputsSha256": "actual-input"})
        owner = types.SimpleNamespace(CONTEXT=proof.OPS / proof.FEATURE_CONTEXT, validate_feature_leaf=lambda *_: value)
        def protected(path, *args, **kwargs):
            return json.dumps(manifest).encode() if Path(path).suffix == ".json" and Path(path).name != "result.json" else b"actual completed reader"
        with patch.object(proof, "protected", side_effect=protected), patch.object(proof, "load", return_value=owner):
            self.assertIs(p.external_feature_leaf(context, refs), value)
            value["readerAncestry"] = {**ancestry, "readerManifestSha256": "9" * 64}
            with self.assertRaisesRegex(RuntimeError, "exact_recorded_publication"):
                p.external_feature_leaf(context, refs)
            value["readerAncestry"] = ancestry
            manifest["dependencies"][provider.FILE.name] = "a" * 64
            with self.assertRaisesRegex(RuntimeError, "actual_publication_producers"):
                p.external_feature_leaf(context, refs)


if __name__ == "__main__":
    unittest.main(verbosity=2)
