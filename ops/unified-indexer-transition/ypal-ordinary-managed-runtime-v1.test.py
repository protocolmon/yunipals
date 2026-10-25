import ast
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / name)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
m = load("ypal-ordinary-managed-runtime-v1.py")
p = load("ypal-alchemy-source-switch-v1.plan.py")
f5 = load("ypal-managed-handover-v1.py")
recovery = load("ypal-source-tail-recovery-v2/recover.py")


def process(pid, argv, parent=10, cwd="/"):
    return {"pid": pid, "startTicks": pid * 100, "parentPid": parent, "argv": argv, "executable": m.NODE,
            "cwd": cwd, "uid": 970, "gid": 964, "groups": [964], "noNewPrivileges": True,
            "capabilitiesZero": True, "startupInjectionAbsent": True, "parentPrivateValuesAbsent": True,
            "cgroup": "0::/system.slice/" + m.PARENT}


def tree():
    envs = ["/one", "/two", "/three", str(m.ORDINARY_ENV)]
    parent = process(10, [m.NODE, str(m.STAGE / "launcher.mjs")], 1)
    evm = process(11, m.source_arguments(envs), 10, m.PROJECT)
    solana = process(12, [m.NODE, "--max-old-space-size=4096", "--env-file=/solana", "--import", "tsx", "lib/solana/worker.ts"], 10, m.SOLANA_PROJECT)
    actor = {"unit": {"Id": m.PARENT, "ExecStart": "volatile presentation"}, "parent": parent, "processes": [parent, evm, solana]}
    return actor, envs, {"parent": {"startTicks": 100}}


def native(clock=1000, heartbeat=900):
    return {"clock": clock, "schemaOid": "75963410", "tables": {str(i): {"oid": str(i)} for i in range(44)},
            "cache": {"oid": "cache"}, "app": {"build_id": "71e2a7f3b7", "is_ready": "1", "is_locked": "1", "is_dev": "0", "heartbeat_at": heartbeat},
            "checkpoints": {chain: {key: "1".zfill(75) for key in ["latest", "safe", "finalized"]} for chain in ["1", "56", "137", "8453"]}}


class Controls(unittest.TestCase):
    def test_exact_real_dependency_and_public_package_pins(self):
        for name, digest in m.CODE.items(): self.assertEqual(m.sha((HERE / name).read_bytes()), digest)
        for name, digest in m.PUBLIC.items(): self.assertEqual(m.sha((HERE / "ypal-ordinary-managed-indexer-v1" / name).read_bytes()), digest)

    def test_readonly_namespace_has_no_constructor_or_mutation_and_unchanged_methods(self):
        raw = (HERE / "ypal-managed-handover-v1.py").read_bytes(); ns = m.primitives(raw, Path(m.__file__))
        self.assertIs(ns.ReadonlyHost.__init__, object.__init__)
        for name in ["manager", "private_inputs", "leaves", "source_current"]: self.assertFalse(hasattr(ns.ReadonlyHost, name))
        for name in m.HOST_METHODS: self.assertEqual(getattr(ns.ReadonlyHost, name).__code__.co_code, getattr(f5.Host, name).__code__.co_code)
        self.assertEqual(ns.STAGE, m.STAGE)
        self.assertEqual(ns.NAMESPACE[m.PROJECT + "/lib/unified/rpc-preflight.ts"], str(m.OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts"))
        self.assertNotEqual(ns.STAGE, f5.STAGE)
        with self.assertRaises(RuntimeError): m.primitives(raw + b"\n# drift", Path(m.__file__))

    def test_fixed_public_readability_peer_needs_no_Host_or_future_receipt(self):
        calls = []
        def command(args, raw, timeout):
            calls.append(args)
            self.assertEqual(timeout, 8)
            self.assertIn("--bounding-set=-all", args); self.assertIn("--clear-groups", args); self.assertIn("--no-new-privs", args)
            self.assertEqual(json.loads(raw), [str(m.STAGE / name) for name in m.PUBLIC])
            return json.dumps({str(m.STAGE / name): digest for name, digest in m.PUBLIC.items()}).encode()
        proof = m.qualify_public_readability(command)
        self.assertTrue(proof["qualified"]); self.assertFalse(proof["sourceActorQualified"]); self.assertEqual(len(calls), 1)
        with self.assertRaisesRegex(RuntimeError, "must_read_all_four"):
            m.qualify_public_readability(lambda *args, **kwargs: b"{}")

    def test_new_tree_has_two_separate_children_and_source_subset(self):
        actor, envs, predecessor = tree(); proof = m.validate_tree(actor, envs, "/solana", predecessor)
        self.assertEqual(len(proof["sourceActor"]["processes"]), 1)
        self.assertEqual(proof["sourceActor"]["parent"]["pid"], 11)
        self.assertNotIn(proof["solana"], proof["sourceActor"]["processes"])
        self.assertEqual(actor["processes"][1]["argv"].count("--env-file=" + str(m.ORDINARY_ENV)), 1)

    def test_tree_rejects_standalone_old_epoch_caps_private_parent_and_foreign_compiler(self):
        for mutate in [lambda a: a["parent"]["argv"].__setitem__(1, "/old/ponder.js"),
                       lambda a: a["parent"].__setitem__("startTicks", 50),
                       lambda a: a["parent"].__setitem__("parentPrivateValuesAbsent", False),
                       lambda a: a["processes"][1].__setitem__("capabilitiesZero", False),
                       lambda a: a["processes"][2].__setitem__("parentPid", 99),
                       lambda a: a["processes"][1]["argv"].remove("--env-file=" + str(m.ORDINARY_ENV))]:
            actor, envs, predecessor = tree(); mutate(actor)
            with self.assertRaises(RuntimeError): m.validate_tree(actor, envs, "/solana", predecessor)

    def typed(self):
        bindings = {name: {"type": "a(ssbt)", "data": [["/cache/" + str(i), m.PROJECT + "/" + name + str(i), False, 16384] for i in range(3)]}
                    for name in ["BindPaths", "BindReadOnlyPaths"]}
        bindings["BindReadOnlyPaths"]["data"][-1] = [str(m.OPS / "ypal-combined-source-v1-stage/rpc-preflight.ts"), m.PROJECT + "/lib/unified/rpc-preflight.ts", False, 16384]
        actual = copy.deepcopy(bindings)
        actual["BindReadOnlyPaths"]["data"][-1][0] = str(m.OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")
        actual["ExecStart"] = {"type": "a(sasbttttuii)", "data": [[m.NODE, [m.NODE, str(m.STAGE / "launcher.mjs")], False, 0, 0, 0, 0, 10, 0, 0]]}
        owner = m.Owner.__new__(m.Owner); owner.ordinary = types.SimpleNamespace(original={"sourceBindings": bindings})
        owner.core = types.SimpleNamespace(command=lambda args: json.dumps(actual[args[-1]]).encode())
        return owner, actual

    def test_actual_typed_shape_and690_three_RW_three_RO_positive(self):
        owner, _ = self.typed(); owner.loaded_command_and_bindings()

    def test_zero_RW_changed_flags_wrong_parent_command_and_boolean_PID_refuse(self):
        for mutate in [lambda a: a["BindPaths"]["data"].clear(), lambda a: a["BindPaths"]["data"][0].__setitem__(3, 0),
                       lambda a: a["ExecStart"]["data"][0][1].append("--extra"),
                       lambda a: a["ExecStart"]["data"][0].__setitem__(7, False)]:
            owner, actual = self.typed(); mutate(actual)
            with self.assertRaises(RuntimeError): owner.loaded_command_and_bindings()

    def test_heartbeat_is_new_observation_proof_not_still_fresh_predecessor(self):
        intent = {"observationDatabaseClock": 1000, "heartbeatBeforeObservation": 900}
        m.heartbeat(native(1300, 1200), intent)
        for value in [native(1300, 950), native(1300, 900), native(300000, 1200), native(1300, True)]:
            with self.assertRaises(RuntimeError): m.heartbeat(value, intent)
        value = native(1300, 1200); value["app"]["is_ready"] = "0"; m.heartbeat(value, intent)

    def fixture(self, root):
        owner = m.Owner.__new__(m.Owner); owner.input_sha = "a" * 64
        owner.core = types.SimpleNamespace(boot=lambda: "boot")
        owner.ordinary = types.SimpleNamespace(p=p, h=types.SimpleNamespace(r=types.SimpleNamespace(recovery_floor=recovery.recovery_floor)))
        actor, _, _ = tree()
        binding = owner.envelope(sourceRelease="release", manifestHash="manifest", schema="schema", schemaOid="75963410", buildId="71e2a7f3b7",
            nativeTables=native()["tables"], poolMaximum=5, transportSha256="690", currentManagedEpoch=actor,
            sourceKernelActors={m.PARENT: {"processes": [actor["processes"][1]]}}, routes={"chainRouting": {"bnb": "paid_logs_free_blocks"}})
        owner.value = {"binding": binding, "native": native(), "kernelSessions": {m.PARENT: [{"pid": 123, "backendStart": "epoch"}]}, "solana": {"scheduledPublicationAccepted": False}}
        owner.snapshot = lambda: copy.deepcopy(owner.value)
        return owner

    def test_real_exclusive_intent_ACK_current_and_lost_ACK_readonly_finish(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root, patch.object(m, "BASE", Path(root) / "audit"):
            owner = self.fixture(root); intent = owner.begin(); self.assertTrue(intent["observedEpochNotStartedHere"])
            with self.assertRaisesRegex(RuntimeError, "no_unknown_retry"): owner.begin()
            owner.value["native"] = native(1300, 1200); result = owner.finish(); path = m.BASE / "result.json"
            inode, raw = path.stat().st_ino, path.read_bytes()
            owner.value["native"] = native(1600, 1500); self.assertEqual(owner.finish(), result)
            self.assertEqual((path.stat().st_ino, path.read_bytes()), (inode, raw))
            proof = owner.current(result["receiptSha256"])
            self.assertTrue(proof["currentWriterQualified"]); self.assertEqual(proof["sourceKind"], "managed")
            self.assertFalse(proof["lifecycleAuthorityQualified"]); self.assertFalse(proof["scheduledSolanaAcceptanceQualified"])
            self.assertFalse(proof["financialAuthorityQualified"]); self.assertFalse(proof["currentCanonicalCoverageQualified"])

    def test_wrong_receipt_changed_epoch_and_stale_heartbeat_refuse(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root, patch.object(m, "BASE", Path(root) / "audit"):
            owner = self.fixture(root); owner.begin(); owner.value["native"] = native(1300, 1200); result = owner.finish()
            with self.assertRaises(RuntimeError): owner.current("b" * 64)
            owner.value["binding"]["poolMaximum"] = 8
            with self.assertRaisesRegex(RuntimeError, "same_acknowledged"): owner.current(result["receiptSha256"])
            owner.value["binding"]["poolMaximum"] = 5; owner.value["native"] = native(1300, 900)
            with self.assertRaisesRegex(RuntimeError, "heartbeat"): owner.current(result["receiptSha256"])

    def test_real_recovery_floor_uses_actual_first_ACK_and_not_only_old_predecessor(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root, patch.object(m, "BASE", Path(root) / "audit"):
            owner = self.fixture(root); owner.begin(); owner.value["native"] = native(1300, 1200)
            for row in owner.value["native"]["checkpoints"].values(): row.update({key: "3".zfill(75) for key in row})
            result = owner.finish(); owner.value["native"] = native(1600, 1500)
            for row in owner.value["native"]["checkpoints"].values(): row.update({key: "2".zfill(75) for key in row})
            with self.assertRaisesRegex(RuntimeError, "must_not_rewind"): owner.current(result["receiptSha256"])
            with self.assertRaisesRegex(RuntimeError, "must_not_rewind"): owner.finish()

    def test_canonical_actor_is_idempotent_and_changes_only_ExecStart_presentation(self):
        actor, _, _ = tree(); projected = m.canonical_actor(actor)
        self.assertEqual(m.canonical_actor(projected), projected); self.assertIn("ExecStart", actor["unit"])
        expected = copy.deepcopy(actor); expected["unit"].pop("ExecStart"); self.assertEqual(projected, expected)

    def test_routes_compose_actual_financial_four_and_separate_retained_five(self):
        owner = m.Owner.__new__(m.Owner); calls = []
        plan = {"permits": [{"permitId": str(i)} for i in range(4)], "ordinaryPolicy": {"source": "1500000"}}
        ack = {"validated": True, "financialQualified": True, "sourceActorQualified": False, "receiptSha256": "a" * 64,
               "permits": plan["permits"], "dailyPolicy": plan["ordinaryPolicy"], "profileId": "profile", "expiresMs": 999}
        retained = {str(i): {"retained": True} for i in range(5)}
        owner.financial = types.SimpleNamespace(validate_current=lambda value: calls.append(("finance", value)) or ack)
        owner.runtime = types.SimpleNamespace(CHAINS=("ethereum", "base", "polygon", "bnb"))
        owner.ordinary = types.SimpleNamespace(config={"financialReceiptSha256": "a" * 64}, plan=plan,
            proxy_actor=lambda c: {"chain": c}, journal=lambda name: {"actor": {"chain": name.removesuffix("-started.json")}},
            c=types.SimpleNamespace(proxy_environment=lambda *args: None, retained=lambda: retained), original={"retainedRPC": retained},
            p=types.SimpleNamespace(proxy_mode=lambda c: "paid_logs_free_blocks" if c == "bnb" else "paid_primary"))
        value = owner.routes(); self.assertEqual(len(value["ordinaryFour"]), 4); self.assertEqual(len(value["retainedFive"]), 5)
        self.assertEqual(value["chainRouting"]["bnb"], "paid_logs_free_blocks"); self.assertEqual(calls, [("finance", "a" * 64)])

    def test_idle_Solana_requires_future_schedule_and_never_claims_publication(self):
        packet = {"workerLock": {"granted": 0, "waiting": 0}, "runningScans": 0,
                  "observedAt": "2026-10-24T23:00:00Z", "state": {"nextScanAt": "2026-10-24T23:10:00+00:00"}}
        m.solana_idle(packet)
        for mutate in [lambda p: p["state"].__setitem__("nextScanAt", "2026-10-24T22:59:00Z"),
                       lambda p: p.__setitem__("runningScans", 1), lambda p: p["workerLock"].__setitem__("granted", 1)]:
            value = copy.deepcopy(packet); mutate(value)
            with self.assertRaises(RuntimeError): m.solana_idle(value)

    def test_Solana_kernel_join_has_exact_three_seams_fixedDB_and_no_source_or_budget_role(self):
        raw = (HERE / "ypal-alchemy-source-switch-v1.host.py").read_bytes()
        fn = m.solana_backend_primitive(raw, Path(m.__file__))
        for role in [73004621, 16394]:
            with self.assertRaisesRegex(RuntimeError, "fixed_source_or_budget"):
                fn(lambda _: None, None, role, {}, {}, False)
        calls = []
        observer = types.SimpleNamespace(peer_fds=lambda *args: {}, unix_peers=lambda _: {}, run=lambda _: b"",
            tcp_clients=lambda *args: {}, map_owned_backends=lambda *args: [])
        rows = fn(lambda sql: calls.append(sql) or [], observer, 16388, {}, {}, False)
        self.assertEqual(rows, {}); self.assertEqual(len(calls), 2)
        self.assertTrue(all("datid=17584" in sql and "host(client_addr)" in sql and "usesysid=16388" in sql for sql in calls))

    def full_snapshot(self, root):
        root = Path(root); stage = root / "runtime"; system = root / "system"
        stage.mkdir(mode=0o755); system.mkdir(mode=0o755)
        for name in m.PUBLIC: (stage / name).write_bytes((HERE / "ypal-ordinary-managed-indexer-v1" / name).read_bytes())
        (system / m.PARENT).write_bytes((stage / "yunipals-indexer.service.example").read_bytes())
        envs = [root / (str(i) + ".env") for i in range(5)]
        for path in envs: path.write_bytes(b"FIXTURE=yes\n"); path.chmod(0o600)
        scope = [patch.object(m, "STAGE", stage), patch.object(m, "ORDINARY_ENV", envs[3])]
        for item in scope: item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(scope)])
        owner, typed = self.typed(); core = m.primitives((HERE / "ypal-managed-handover-v1.py").read_bytes(), Path(m.__file__))
        core.SYSTEM = system; core.ENV_FILES = tuple(str(path) for path in [*envs[:3], envs[4]])
        core.command = lambda args: json.dumps(typed[args[-1]]).encode()
        owner.core = core; owner.input_sha = "a" * 64
        actor, _, predecessor = tree(); actor["processes"][1]["argv"] = m.source_arguments([str(path) for path in envs[:4]])
        actor["processes"][2]["argv"][2] = "--env-file=" + str(envs[4]); predecessor["processes"] = []
        owner.predecessor = {"source": predecessor}; owner.config = {"ordinaryResultSha256": "b" * 64, "observerResultSha256": "c" * 64}
        current = native(); owner.op = {"native": current}; calls = []
        owner.dependencies = lambda: calls.append("dependencies")
        owner.routes = lambda: {"financialReceiptSha256": "d" * 64, "ordinaryFour": {}, "retainedFive": {}}
        owner.namespace = lambda row, paths: calls.append(("namespace", row["pid"], len(paths)))
        owner.solana_current = lambda parent, child: {"pid": child["pid"], "scheduledPublicationAccepted": False}
        owner.h = types.SimpleNamespace(
            state=lambda unit: {"MainPID": "10", "ControlPID": "0", "ActiveState": "active", "User": "yunipals_unified_shadow", "Group": "yunipals_unified_shadow",
                                "NRestarts": "0", "FragmentPath": str(system / m.PARENT), "DropInPaths": ""} if unit == m.PARENT else
                               {"MainPID": "0", "ControlPID": "0", "ActiveState": "inactive"},
            actor=lambda unit, *args: copy.deepcopy(actor) if unit == m.PARENT else None,
            managed_settings=lambda: calls.append("settings"),
            peer=lambda pid, **kwargs: copy.deepcopy(next(row for row in actor["processes"] if row["pid"] == pid)),
            activation=lambda _: {"boot": {"target": "/owned"}})
        leaf = load("ypal-alchemy-primary-current-v1.py")
        owner.ordinary.old = types.SimpleNamespace(ns=types.SimpleNamespace(gone=lambda _: calls.append("known-source-gone"), native_order=lambda _: calls.append("native-order")))
        owner.ordinary.leaf = leaf; owner.ordinary.p = types.SimpleNamespace(TIMEOUT_SHA="690")
        owner.ordinary.source_environment = lambda: b"UNIFIED_RPC_REPLAY_PERMIT_ID_56=fixture\n"
        owner.ordinary.h = types.SimpleNamespace(source=types.SimpleNamespace(query=lambda _: None, native=lambda: copy.deepcopy(current),
             s=types.SimpleNamespace(expected_env=lambda: {})), r=types.SimpleNamespace(recovery_floor=lambda *args: calls.append("recovery-floor")), observer=object())
        data = {"schemaOid": current["schemaOid"], "nativeTableIdentities": current["tables"], "syncCacheIdentity": current["cache"], "buildId": "71e2a7f3b7",
                "sourceRelease": "release", "manifestHash": "manifest", "schema": "unified_ypal_20261023_v1"}
        owner.intake = types.SimpleNamespace(query_components=lambda: {"dataIdentity": copy.deepcopy(data)})
        observer = {"validated": True, "observerCurrentQualified": True, "ordinarySustainedObserver": True, "sourceActorQualified": False,
                    "currentWriterQualified": False, "paidAuthority": False, "operatorSha256": "e" * 64, "receiptSha256": "c" * 64,
                    "actor": {"observer": True}, "bootLink": {"owned": True}, "dataIdentity": {"schemaOid": "75963410"}}
        owner.observer = types.SimpleNamespace(validate_current=lambda _: copy.deepcopy(observer))
        def kernel(query, observation, role, actors, ids, require_all):
            self.assertEqual(role, 73004621); self.assertTrue(require_all); self.assertEqual(ids, {m.PARENT: (970, 964)})
            self.assertEqual([p["pid"] for p in actors[m.PARENT]["processes"]], [11])
            calls.append("all-native-backends"); return {m.PARENT: [{"pid": 123, "backendStart": "epoch"}]}
        owner.host = types.SimpleNamespace(kernel_backends=kernel)
        return owner, calls

    def test_full_snapshot_executes_current_composition_with_positive_EVM_subset(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root:
            owner, calls = self.full_snapshot(root); result = owner.snapshot()
            self.assertEqual(result["binding"]["sourceKind"], "managed")
            self.assertFalse(result["binding"]["recordedStandaloneCurrentClaimed"])
            self.assertEqual(result["solana"]["pid"], 12)
            self.assertIn(("namespace", 11, 6), calls); self.assertIn("all-native-backends", calls)
            self.assertEqual(calls.count("dependencies"), 2)

    def test_full_snapshot_refuses_zero_kernel_backend_and_late_parent_change(self):
        with tempfile.TemporaryDirectory(dir=HERE) as root:
            owner, _ = self.full_snapshot(root); owner.host.kernel_backends = lambda *args: {m.PARENT: []}
            with self.assertRaisesRegex(RuntimeError, "positive_managed_EVM"): owner.snapshot()
        with tempfile.TemporaryDirectory(dir=HERE) as root:
            owner, _ = self.full_snapshot(root); original = owner.h.actor; counter = [0]
            def late(unit, *args):
                row = original(unit, *args)
                if unit == m.PARENT:
                    counter[0] += 1
                    if counter[0] > 1: row["unit"]["InvocationID"] = "foreign"
                return row
            owner.h.actor = late
            with self.assertRaisesRegex(RuntimeError, "tree_changed"): owner.snapshot()


if __name__ == "__main__": unittest.main()
