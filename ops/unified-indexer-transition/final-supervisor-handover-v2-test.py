#!/usr/bin/env python3
"""Failure boundaries of the actual final handover operator; no host mutation."""
import importlib.util
from copy import deepcopy
import json
from pathlib import Path
import stat
import tempfile
import time
import types
from unittest import TestCase, main
from unittest.mock import patch

path = Path(__file__).with_name("final-supervisor-handover-v2.py")
spec = importlib.util.spec_from_file_location("handover", path)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def state(name=h.UNIT, *, active=True, invocation="a" * 32, job="0"):
    return {"Id": name, "LoadState": "loaded", "ActiveState": "active" if active else "inactive",
            "SubState": "running" if active else "dead", "InvocationID": invocation,
            "MainPID": "42" if active else "0", "Job": job, "Result": "success", "ControlGroup": "",
            "process": {"pid": 42, "startTicks": 100, "uid": 970, "argvSha256": "b" * 64} if active else None}


def solana_snapshot():
    return {"manifest": {"count": 10000, "checksum": "a" * 64},
            "observedAt": "2026-10-22T17:00:00+00:00",
            "ledgerPrefix": {"throughId": "81", "rows": 81, "credits": "810", "sha256": "a" * 64},
            "ledgerCurrent": {"credits": "810", "rows": 81, "latestId": "81"},
            "state": {"publishedRunId": 123, "nextScanAt": "2026-10-22T17:01:00+00:00", "lastErrorPresent": False},
            "publishedRun": {"id": 123, "state": "published", "assetCount": 10000, "missingCount": 2,
                             "completedAt": "2026-10-22T16:46:00+00:00"},
            "runningScans": 0, "runningRunStates": [], "stage": {"rows": 10000, "sha256": "c" * 64},
            "workerLock": {"granted": 0, "waiting": 0}}


class Boundaries(TestCase):
    def test_stop_waits_same_live_process_even_when_manager_has_job(self):
        before = state()
        stopping = state(job="142")
        stopping["ActiveState"] = "deactivating"
        stopping["SubState"] = "stop-sigterm"
        after = state(active=False, invocation="")
        with patch.object(h, "unit", side_effect=[before, stopping, after]), \
             patch.object(h, "run") as commands, patch.object(h, "gone", return_value=True), \
             patch.object(h.time, "sleep"):
            self.assertEqual(h.stop_owned(h.UNIT, before), after)
        self.assertEqual(commands.call_count, 1)
        self.assertEqual(commands.call_args.args[0], ["/usr/bin/systemctl", "stop", "--no-block", h.UNIT])

    def test_foreign_invocation_is_not_stopped_as_ours(self):
        with patch.object(h, "unit", return_value=state(invocation="c" * 32)), patch.object(h, "run") as command:
            with self.assertRaisesRegex(RuntimeError, "saved_writer_changed"):
                h.stop_owned(h.UNIT, state())
        command.assert_not_called()

    def test_foreign_invocation_during_stop_is_retained_failure(self):
        before = state()
        with patch.object(h, "unit", side_effect=[before, state(invocation="c" * 32)]), \
             patch.object(h, "run") as command:
            with self.assertRaisesRegex(RuntimeError, "foreign_writer_invocation"):
                h.stop_owned(h.UNIT, before)
        self.assertEqual(command.call_count, 1)

    def test_pid_reuse_is_not_the_original_process(self):
        with patch.object(h, "process", return_value={"pid": 42, "startTicks": 101}):
            self.assertTrue(h.gone({"pid": 42, "startTicks": 100}))
        with patch.object(h, "process", return_value={"pid": 42, "startTicks": 100}):
            self.assertFalse(h.gone({"pid": 42, "startTicks": 100}))

    def test_existing_usage_prefix_cannot_be_changed_or_refunded(self):
        before = {"manifest": {"count": 10000}, "ledgerPrefix": {"throughId": "81", "rows": 81, "credits": "810", "sha256": "a" * 64},
                  "ledgerCurrent": {"credits": "810"}, "state": {"publishedRunId": 123}}
        after = json.loads(json.dumps(before))
        after["ledgerCurrent"]["credits"] = "820"
        after["state"]["publishedRunId"] = 124
        h.prefix_preserved(before, after)
        after["ledgerPrefix"]["sha256"] = "b" * 64
        with self.assertRaisesRegex(RuntimeError, "entire_existing_solana_usage_prefix"):
            h.prefix_preserved(before, after)
        after["ledgerPrefix"] = before["ledgerPrefix"]
        after["ledgerCurrent"]["credits"] = "800"
        with self.assertRaisesRegex(RuntimeError, "entire_existing_solana_usage_prefix"):
            h.prefix_preserved(before, after)

    def test_solana_publication_cannot_rewind(self):
        before = {"manifest": {}, "ledgerPrefix": {}, "ledgerCurrent": {"credits": "2"}, "state": {"publishedRunId": 15}}
        after = {**before, "state": {"publishedRunId": 14}}
        with self.assertRaisesRegex(RuntimeError, "publication_must_not_rewind"):
            h.prefix_preserved(before, after)

    def test_new_listener_does_not_substitute_for_native_readiness(self):
        native = {"release": {"id": h.RELEASE, "physical_schema": h.SCHEMA, "build_id": h.BUILD},
                  "app": {"build_id": h.BUILD, "is_dev": 0, "is_locked": 1, "is_ready": 0},
                  "checkpoints": [{"chain_id": c} for c in [1, 56, 137, 8453]], "active": [], "sessions": 2}
        with self.assertRaisesRegex(RuntimeError, "actual_native_ready_runtime"):
            h.native_identity(native, selected=[], running=True)

    def test_missing_or_failed_consumer_owner_inverse_blocks_source_rollback(self):
        refs = {name: {"file": "/root/" + name, "sha256": "a" * 64} for name in h.INSTALL_UNITS}
        refs["booster"] = {"file": "/root/booster", "sha256": "b" * 64}
        bad = {"format": h.CONSUMER_FORMAT, "rollbackApplied": False}
        with patch.object(h, "read", return_value=json.dumps(refs).encode()), patch.object(h, "document", return_value=bad):
            with self.assertRaisesRegex(RuntimeError, "actual_consumer_owner_rollback"):
                h.consumer_rollbacks("/root/rollback.json", {n: refs[n] for n in h.INSTALL_UNITS}, {"apiInvocation": "a" * 32})

    def test_unqualified_witness_cannot_be_sealed_as_acceptance(self):
        seal = {"format": "yunipals-final-source-acceptance-v1", "accepted": True, "sourceDigest": h.SOURCE,
                "physicalSchema": h.SCHEMA, "buildId": h.BUILD, "releaseId": h.RELEASE,
                "checks": {name: True for name in h.CHECKS},
                "proofs": {name: {"file": "/root/" + name, "sha256": "a" * 64} for name in h.CHECKS}}
        def load(ref):
            return seal if ref["file"] == "/root/seal" else {"format": "some_observation", "accepted": True}
        with patch.object(h, "document", side_effect=load):
            with self.assertRaisesRegex(RuntimeError, "actual_qualified_fixed_boundary_witness"):
                h.acceptance({"file": "/root/seal", "sha256": "a" * 64})


class SolanaLifecycle(TestCase):
    def test_stopped_boundary_preserves_partial_run_stage_schedule_and_every_charged_row(self):
        before = solana_snapshot()
        before["runningRunStates"] = [{"id": 124, "next_batch": 3, "request_count": 3}]
        before["runningScans"] = 1
        after = deepcopy(before)
        after["observedAt"] = "2026-10-22T17:00:01+00:00"
        h.stopped_solana_unchanged(before, after)
        mutations = [("state", "nextScanAt", "2026-10-22T16:59:00+00:00"),
                     ("stage", "sha256", "d" * 64), ("ledgerCurrent", "credits", "800"),
                     ("workerLock", "granted", 1)]
        for key, field, value in mutations:
            with self.subTest(field=field):
                changed = deepcopy(after)
                changed[key][field] = value
                with self.assertRaisesRegex(RuntimeError, "stopped_solana_publication_stage_schedule_and_ledger"):
                    h.stopped_solana_unchanged(before, changed)
        after["runningRunStates"][0]["next_batch"] = 0
        with self.assertRaisesRegex(RuntimeError, "stopped_solana_publication_stage_schedule_and_ledger"):
            h.stopped_solana_unchanged(before, after)

    def test_next_publication_must_be_a_new_scan_after_persisted_due_time(self):
        before = solana_snapshot()
        after = deepcopy(before)
        after["observedAt"] = "2026-10-22T17:02:01+00:00"
        after["state"].update(publishedRunId=124, nextScanAt="2026-10-22T17:17:00+00:00")
        after["publishedRun"].update(id=124, completedAt="2026-10-22T17:02:00+00:00")
        fresh = {"id": 124, "startedAt": "2026-10-22T17:01:00+00:00", "requestCount": 10,
                 "manifestChecksum": before["manifest"]["checksum"]}
        h.scheduled_solana_publication(before, after, fresh)
        for change in [{"startedAt": "2026-10-22T17:00:05+00:00"}, {"startedAt": "2026-10-22T18:00:00+00:00"}, {"requestCount": 0},
                       {"manifestChecksum": "b" * 64}, {"id": 125}]:
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "fresh_normally_scheduled_scan"):
                h.scheduled_solana_publication(before, after, {**fresh, **change})
        before["runningRunStates"] = [{"id": 124}]
        with self.assertRaisesRegex(RuntimeError, "cached_staged_publication"):
            h.scheduled_solana_publication(before, after, fresh)

    def restart(self, *, corrupt=False):
        events, before = [], solana_snapshot()
        binding, current = {"plan": {}}, state()
        result = {"reviewHash": "a" * 64, "selectedPointer": [], "effectiveUnit": {"reviewed": True}}
        points = [{"chain_id": n, "latest_checkpoint": 1, "safe_checkpoint": 1, "finalized_checkpoint": 1}
                  for n in [1, 56, 137, 8453]]
        quiet = {"checkpoints": points}
        changed = deepcopy(before)
        if corrupt:
            changed["stage"]["sha256"] = "e" * 64
        def command(name, *args):
            events.append(name)
            return "f" * 64
        def start(*args):
            events.append("start_shared")
            return state(invocation="b" * 32), {"ponder": {}, "solana": {}}, quiet
        with patch.object(h, "current_handover", return_value=(binding, result, current)), \
             patch.object(h.os.path, "lexists", return_value=False), \
             patch.object(h, "read", return_value=b'{"scheduledPublicationAccepted":true}'), \
             patch.object(h, "save", side_effect=lambda p, v: command(p.name)), \
             patch.object(h, "stop_owned", side_effect=lambda *args: command("stop_owned")), \
             patch.object(h, "native", return_value=quiet), patch.object(h, "native_identity"), \
             patch.object(h, "solana", side_effect=[before, changed, before]), \
             patch.object(h, "effective_unit", return_value=result["effectiveUnit"]), \
             patch.object(h, "same_proxies"), patch.object(h, "same_inputs"), \
             patch.object(h, "source_activation_retired"), patch.object(h, "legacy_activation_retired"), \
             patch.object(h, "start_shared", side_effect=start):
            review = h.restart_test(Path("/root/fake"))
            if corrupt:
                with self.assertRaisesRegex(RuntimeError, "stopped_solana_publication_stage_schedule_and_ledger"):
                    h.restart_test(Path("/root/fake"), review["reviewHash"])
            else:
                self.assertTrue(h.restart_test(Path("/root/fake"), review["reviewHash"])["restartAccepted"])
        return events

    def test_restart_stops_both_children_seals_latest_state_then_starts_once(self):
        events = self.restart()
        self.assertLess(events.index("stop_owned"), events.index("restart-stopped-solana.json"))
        self.assertLess(events.index("restart-stopped-solana.json"), events.index("start_shared"))
        self.assertEqual(events.count("start_shared"), 1)
        self.assertEqual(events[-1], "restart-result.json")

    def test_restart_does_not_start_over_changed_stopped_stage(self):
        events = self.restart(corrupt=True)
        self.assertNotIn("start_shared", events)
        self.assertEqual(events[-1], "restart-failed.json")

    def test_rollback_restores_definitions_and_selector_before_old_solana_start_preserving_latest_state(self):
        events, snapshot = [], solana_snapshot()
        directory = Path("/root/fake")
        current = state(active=False)
        checked = {"installed": {"/etc/systemd/system/" + h.UNIT: "a" * 64}, "shared": current,
                   "selectedPointer": [{"release_id": h.RELEASE}], "restartOriginalWriters": ["yunipals-solana.service"],
                   "featureInverse": {"validated": True}, "stoppedSolana": snapshot,
                   "consumerRollbacks": {"booster": {"sha256": "b" * 64}}}
        binding = {"priorPointer": [], "definitions": {h.UNIT: {"/etc/systemd/system/" + h.UNIT: "old"},
                   "yunipals-solana.service": {"old-scan": "original"}},
                   "writers": {name: {"UnitFileState": "disabled"} for name in h.LEGACY}}
        documents = {"review.json": binding, "originals.json": {"/etc/systemd/system/" + h.UNIT:
                     {"file": "/root/original", "sha256": h.sha(b"saved original"), "mode": 0o644}}}
        def read(path):
            return b"saved original" if str(path) == "/root/original" else json.dumps(documents[path.name]).encode()
        def command(argv, **kwargs):
            events.append(" ".join(argv[1:]))
            return ""
        def restore(*args):
            events.append("restore-definitions")
        def restore_pointer(*args, **kwargs):
            events.append("restore-selector")
            return []
        with patch.object(h, "rollback_review", return_value=checked), patch.object(h, "read", side_effect=read), \
             patch.object(h, "save", return_value="f" * 64), patch.object(h.os.path, "lexists", return_value=False), \
             patch.object(h, "combined_quiet", side_effect=lambda: events.append("already-owned-quiesced")), \
             patch.object(h, "native", return_value={}), patch.object(h, "native_identity"), \
             patch.object(h, "solana", side_effect=[snapshot, deepcopy(snapshot), deepcopy(snapshot)]), \
             patch.object(h, "replace", side_effect=restore), patch.object(h, "run", side_effect=command), \
             patch.object(h, "sql", side_effect=restore_pointer), patch.object(h, "restore_pointer_sql", return_value="owned inverse"), \
             patch.object(h, "restore_legacy_boot_links", side_effect=lambda *args: events.append("restore-legacy-bootlinks")), \
             patch.object(h, "legacy_boot_links_restored"), \
             patch.object(h, "unit", side_effect=[state(), state(name="yunipals-solana.service", active=False),
                                                  state(name="yunipals-solana.service", invocation="c" * 32)]), \
             patch.object(h, "definitions", side_effect=[binding["definitions"][h.UNIT], binding["definitions"]["yunipals-solana.service"]]):
            result = h.rollback(directory, h.sha(h.encode(checked)), "/root/consumer-inverse")
        self.assertTrue(result["rolledBack"])
        old_start = events.index("start --no-block yunipals-solana.service")
        self.assertLess(events.index("already-owned-quiesced"), events.index("restore-definitions"))
        self.assertLess(events.index("restore-definitions"), events.index("restore-selector"))
        self.assertLess(events.index("restore-selector"), old_start)
        self.assertFalse(any(h.SOURCE_UNIT in event for event in events), "Expired temporary source must never restart")

    def test_rollback_refuses_old_solana_start_while_shared_worker_lock_remains(self):
        snapshot = solana_snapshot()
        snapshot["workerLock"]["granted"] = 1
        checked = {"installed": {"owned": "a"}, "shared": state(), "selectedPointer": None}
        with patch.object(h, "rollback_review", return_value=checked), \
             patch.object(h, "read", return_value=b'{}'), patch.object(h, "save"), \
             patch.object(h, "combined_quiet"), patch.object(h, "solana", return_value=snapshot), \
             patch.object(h, "run") as command:
            with self.assertRaisesRegex(RuntimeError, "shared_solana_worker_must_be_completely_stopped"):
                h.rollback(Path("/root/fake"), h.sha(h.encode(checked)), "/root/consumer-inverse")
        command.assert_not_called()

    def test_effective_unit_enforces_numeric_provider_only_egress_restart_and_resources(self):
        cidrs = ["104.18.36.169/32", "172.64.151.87/32", "2606:4700:440d::6812:24a9/128", "2a06:98c1:3104::ac40:9757/128"]
        egress = ("[Service]\n# Accepted numeric Helius targets; future DNS stability is not claimed.\n" +
                  "".join("IPAddressAllow=" + value + "\n" for value in cidrs)).encode()
        self.assertEqual(h.sha(egress), h.HELIUS_SHA)
        transport = (Path(__file__).parents[1] / "unified-indexer/solana-consolidation-20261021/normal-transport-final-v4.conf.example").read_bytes()
        mounts = [line.split("=", 1)[1].split(":") + [False, 16384] for line in transport.decode().splitlines()
                  if line.startswith("BindReadOnlyPaths=")]
        resource = {"MemoryMax": "6442450944", "MemorySwapMax": "0", "Environment": "NODE_OPTIONS=--max-old-space-size=4096",
                    "ReadWritePaths": str(h.CWD / ".ponder") + " " + str(h.CWD / "ponder-env.d.ts"),
                    "BindReadOnlyPaths": "unused typed below", "KillMode": "control-group", "NoNewPrivileges": "yes"}
        network = "IPAddressAllow=127.0.0.0/8\nIPAddressAllow=::1/128 " + " ".join(cidrs) + "\nIPAddressDeny=0.0.0.0/0 ::/0\nRestart=on-failure\nRestartPreventExitStatus=75\nTimeoutStopUSec=2min\nConflicts=" + h.SOURCE_UNIT + " " + h.BOOSTER_UNIT + "\n"
        def execute(argv, **kwargs):
            if argv[0] == "/usr/bin/busctl":
                return json.dumps({"type": "a(ssbt)", "data": mounts if argv[-1] == "BindReadOnlyPaths" else []})
            return network if "--property=IPAddressAllow" in argv else "\n".join(k + "=" + v for k, v in resource.items())
        with patch.object(h, "read", side_effect=lambda p: transport if p == h.TRANSPORT else egress), \
             patch.object(h, "run", side_effect=execute):
            self.assertEqual(h.effective_unit()["MemoryMax"], "6442450944")
            for original, replacement in [("::/0", "::1/128"), ("RestartPreventExitStatus=75", "RestartPreventExitStatus="),
                                          ("IPAddressAllow=127.0.0.0/8", "IPAddressAllow=0.0.0.0/0")]:
                previous, network = network, network.replace(original, replacement)
                with self.subTest(replacement=replacement), self.assertRaisesRegex(RuntimeError, "retained_helius_only_egress"):
                    h.effective_unit()
                network = previous


class SourceSuccessorAndFeatureRetirement(TestCase):
    def receipt(self):
        return {"format": "yunipals-booster-source-retirement-v1", "activationPathsAbsent": True, "oldSchemaPreserved": True,
                "parity": {"reportSha256": "a" * 64, "boundary": 52960000, "headerHash": "0x" + "a" * 64},
                "postSwitchParity": {"reportSha256": "c" * 64, "boundary": 52960003, "headerHash": "0x" + "c" * 64},
                "readerHandover": {"receiptSha256": "b" * 64, "schema": h.SCHEMA, "apiInvocation": "b" * 32,
                                   "queueEnabled": True, "publicReady": True, "switchBoundary": 52960001},
                "freshEvent": {"blockNumber": 52960002, "blockHash": "0x" + "a" * 64,
                               "transactionHash": "0x" + "b" * 64, "logIndex": 2},
                "source": {"unit": h.BOOSTER_UNIT, "priorInvocation": "a" * 32, "terminal": True, "pid": 0, "enabled": False}}

    def retired_state(self):
        return {**state(name=h.BOOSTER_UNIT, active=False), "UnitFileState": "disabled", "TriggeredBy": "", "Triggers": ""}

    def checkpoint(self, block=52960002, complete=True):
        return f"{1792690000:010d}{8453:016d}{block:016d}" + ("9" if complete else "0") * 33

    def verify(self, receipt=None, actual=None, activation=None, proof=None):
        receipt = receipt or self.receipt()
        actual = actual or self.retired_state()
        activation = activation or {"WantedBy": "", "RequiredBy": "", "UpheldBy": ""}
        proof = proof or {"checkpoint": self.checkpoint(), "eventMatches": 1, "headerHash": "0x" + "a" * 64}
        with patch.object(h, "document", return_value=receipt), patch.object(h, "unit", return_value=actual), \
             patch.object(h, "activation_paths", return_value=activation), patch.object(h, "sql", return_value=proof) as query:
            result = h.booster_retirement({"file": "/root/actual-owned-retirement", "sha256": "a" * 64})
        self.assertIn(h.SCHEMA + ".booster_event", query.call_args.args[0])
        return result

    def test_only_real_retirement_with_post_switch_indexed_canonical_event_qualifies(self):
        self.assertEqual(self.verify()["priorInvocation"], "a" * 32)
        self.assertIn(h.BOOSTER_UNIT, h.WRITERS)
        self.assertNotIn(h.BOOSTER_UNIT, h.LEGACY)
        self.assertNotIn(h.SOURCE_UNIT, h.LEGACY)

    def test_missing_retirement_is_explicit_before_native_sessions_or_other_gates(self):
        with patch.object(h, "native") as native, patch.object(h, "acceptance") as acceptance:
            with self.assertRaisesRegex(RuntimeError, "temporary_booster_source_requires_owned_retirement_receipt"):
                h.review({"format": h.FORMAT})
        native.assert_not_called()
        acceptance.assert_not_called()

    def test_active_enabled_foreign_or_triggered_temporary_source_is_not_accepted(self):
        for change in [{"UnitFileState": "enabled"}, {"ActiveState": "active", "SubState": "running"},
                       {"InvocationID": "c" * 32}, {"TriggeredBy": "restart.timer"}, {"MainPID": "91"}]:
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "terminal_disabled_and_untriggered"):
                self.verify(actual={**self.retired_state(), **change})
        with self.assertRaisesRegex(RuntimeError, "automatic_activation_paths_must_be_absent"):
            self.verify(activation={"WantedBy": "multi-user.target", "RequiredBy": "", "UpheldBy": ""})

    def test_reader_old_schema_pending_queue_or_pre_switch_event_cannot_qualify(self):
        for section, key, value in [("readerHandover", "schema", "yunipals_boosters_launch_v1"),
                                    ("readerHandover", "queueEnabled", False), ("readerHandover", "publicReady", False),
                                    ("freshEvent", "blockNumber", 52960001), ("parity", "reportSha256", "0" * 64)]:
            changed = self.receipt()
            changed[section][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "parity_readers_and_post_switch_event"):
                self.verify(receipt=changed)

    def test_partial_native_coverage_wrong_hash_or_missing_actual_event_refuses_retirement(self):
        proof = {"checkpoint": self.checkpoint(), "eventMatches": 1, "headerHash": "0x" + "a" * 64}
        for change in [{"checkpoint": self.checkpoint(complete=False)}, {"eventMatches": 0},
                       {"eventMatches": 2}, {"headerHash": "0x" + "d" * 64}]:
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "cover_actual_post_handover_booster_event"):
                self.verify(proof={**proof, **change})

    def test_retirement_requires_actual_post_event_full_parity(self):
        for change in [{"boundary": 52960001}, {"reportSha256": "0" * 64}, {"headerHash": "0x" + "0" * 64}]:
            receipt = self.receipt()
            receipt["postSwitchParity"].update(change)
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "post_event_full_booster_parity"):
                self.verify(receipt=receipt)

    def test_normal_source_binding_is_exact_acknowledged_runtime_and_tested_v2_operator(self):
        pin = "e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f"
        binding = h.SOURCE_BINDINGS[pin]
        self.assertEqual(binding["helperSha256"], "c8c06c03d4bb929f0171876939bb0887254a08f135e4c25a31fbaa238ae166fb")
        self.assertEqual(binding["kind"], "normal-free-base1")
        actual = json.loads((Path(__file__).parents[2] / "docs/unified-indexer/production-normal-free-replay-2026-10-22.json").read_text())
        self.assertEqual(actual["actualRuntime"]["runtimeReceiptSha256"], pin)
        self.assertEqual(actual["operatorSha256"], binding["helperSha256"])
        self.assertEqual(actual["actualRuntime"]["bootLink"]["inode"], 131541)

    def test_forward_review_records_actual_normal_authority_and_v7_install_refs(self):
        source = {**state(h.SOURCE_UNIT), "WorkingDirectory": str(h.CWD), "UnitFileState": "enabled"}
        source["process"]["pid"] = 716994
        pin = "e0772a5a895626690ca5bb221ab653bf5c88f4caa3ca0ebeb189985d6cda157f"
        normal = h.SOURCE_BINDINGS[pin]
        raw = b"fixed proxy input"
        plan = {"format": h.FORMAT, "runId": "future-real-cutover", "sourceRecovery": {"file": normal["file"], "sha256": pin},
                "sourceHelperSha256": normal["helperSha256"], "boosterRetirement": {"file": "/root/actual-retirement", "sha256": "b" * 64},
                "acceptance": {"file": "/root/actual-seal", "sha256": "c" * 64},
                "sourceRuntime": {"process": source["process"], "invocation": source["InvocationID"],
                                  "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip()},
                "proxyInputs": {n: {"unit": "yunipals-market-production-rpc@" + n + ".service", "invocation": "a" * 32,
                                    "files": {"/root/proxy-" + n: h.sha(raw)}} for n in h.CHAINS}}
        installs = {n: {"file": "/root/accepted-" + n, "sha256": "d" * 64} for n in h.INSTALL_UNITS}
        link = {"file": "actual-owned-normal-boot-link"}
        validated = {"runtime": {"pid": 716994, "startTicks": 100, "invocation": "a" * 32},
                     "kind": "normal-free-base1", "bootLink": link}
        def unit(name):
            if name == h.SOURCE_UNIT: return source
            active = name in {h.UNIT, "yunipals-solana.service"} or name.startswith("yunipals-market-production-rpc@")
            return {**state(name, active=active), "UnitFileState": "disabled", "TriggeredBy": "", "Triggers": ""}
        source.update({"TriggeredBy": "", "Triggers": ""})
        native = {"release": {"id": h.RELEASE, "physical_schema": h.SCHEMA, "build_id": h.BUILD}, "active": [], "sessions": 5,
                  "app": {"build_id": h.BUILD, "is_dev": 0, "is_locked": 1, "is_ready": 1, "heartbeat_at": int(time.time()*1000)},
                  "checkpoints": [{"chain_id": n} for n in [1,56,137,8453]]}
        with patch.object(h, "booster_retirement", return_value={"retired": True}), \
             patch.object(h, "acceptance", return_value={"proofs": {}, "consumerInstalls": installs}), \
             patch.object(h, "current_source", return_value=validated), patch.object(h, "unit", side_effect=unit), \
             patch.object(h, "candidates", return_value=({}, {})), patch.object(h, "read", return_value=raw), \
             patch.object(h, "definitions", side_effect=lambda state:{"fixed-" + state["Id"]:"e"*64}), \
             patch.object(h, "activation_paths", return_value={"WantedBy":"multi-user.target","RequiredBy":"","UpheldBy":""}), \
             patch.object(h, "source_boot_link"), patch.object(h, "proxy_health"), patch.object(h, "native", return_value=native), \
             patch.object(h, "health"), patch.object(h, "capture_legacy_boot_links", return_value={n:None for n in h.LEGACY_BOOT_UNITS}):
            binding = h.review(plan)
        self.assertEqual(binding["consumerInstalls"], installs)
        self.assertEqual(binding["sourceSuccessor"]["bootLink"], link)
        self.assertEqual(binding["inputs"][normal["helper"]], normal["helperSha256"])
        self.assertEqual(binding["inputs"][normal["file"]], pin)

    def test_normal_source_validates_exact_runtime_without_old_bounded_deadline(self):
        identity = {"pid": 716994, "startTicks": 6611794751, "invocation": "c3463c9a2e1240e8890e318ba1360cf4"}
        link = {"file": "actual-owned-link"}
        receipt = {"format": "yunipals-source6-normal-free-successor", "baseSourceConcurrency": 1,
                   "heapMiB": 4096, "memoryMaxBytes": 6442450944, "runtime": identity, "bootLink": link}
        validated = {"validated": True, "normalOperationalRuntime": "infinity", "financialWindowRenewed": False,
                     "financialExpiresAt": h.datetime.fromtimestamp(time.time() + 86400, h.timezone.utc).isoformat(), "runtime": identity,
                     "freeOnly": True, "paidAuthority": False}
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        program = ("import types\ndef modules():return None,None,types.SimpleNamespace(BOOT=" + repr(boot) +
                   ")\ndef validate(r,b,s,pin):return " + repr(validated)).encode()
        binding = {"file": "/root/actual-normal-runtime", "helper": "/root/tested-normal-helper",
                   "helperSha256": h.sha(program), "kind": "normal-free-base1"}
        plan = {"sourceRecovery": {"file": binding["file"], "sha256": "a" * 64}, "sourceHelperSha256": h.sha(program)}
        with patch.object(h, "SOURCE_BINDINGS", {"a" * 64: binding}), patch.object(h, "document", return_value=receipt), \
             patch.object(h, "read", return_value=program):
            proof = h.current_source(plan)
        self.assertEqual(proof["bootLink"], link)
        self.assertNotIn("expiresMonotonicMicroseconds", proof)

    def test_final_transport_retains_actual_base1_and_historical_bind_without_modifying_v3(self):
        directory = Path(__file__).parents[1] / "unified-indexer/solana-consolidation-20261021"
        successor = (directory / "normal-transport-final-v4.conf.example").read_bytes()
        self.assertEqual(h.sha(successor), h.TRANSPORT_SHA)
        self.assertIn(str(h.BASE_RPC).encode() + b":", successor)
        self.assertIn(b"source6-selective-historical-v3:", successor)
        self.assertNotIn(b"source6-rpc-file-v3/", successor)
        self.assertEqual(h.sha((directory / "normal-transport-final-v3.conf.example").read_bytes()),
                         "0c3254240bb93b8dab256feb229e856a3c0c1726f9770762a7633bc97cce5377")

    def bounded_source(self, *, expires=None):
        identity = {"pid": 676577, "startTicks": 6611554871, "invocation": "ae6089caba3049faa95442c254556b6c",
                    "startMonotonicMicroseconds": 66115548732268}
        expires = expires or time.monotonic_ns() // 1000 + 1200_000_000
        receipt = {"format": "yunipals-source6-base-priority-resume", "started": True, "baseSourceConcurrency": 1,
                   "schema": h.SCHEMA, "buildId": h.BUILD, "rpcSha256": h.BASE_RPC_SHA, "runtime": identity,
                   "expiresMonotonicMicroseconds": expires, "originalDeadlineMonotonicMicroseconds": expires}
        validated = {"runtimeReceiptSha256": "a" * 64, "runtime": identity, "freeOnly": True, "paidAuthority": False}
        boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        program = ("import types\ndef modules():return None,types.SimpleNamespace(BOOT=" + repr(boot) +
                   ",inputs=lambda:None,financial=lambda:None)\ndef inspect(b,s):return " + repr(validated)).encode()
        binding = {"file": "/root/acknowledged-bounded-runtime", "helper": "/root/frozen-bounded-reader.py",
                   "helperSha256": h.sha(program), "kind": "bounded-base1"}
        plan = {"sourceRecovery": {"file": binding["file"], "sha256": "a" * 64}, "sourceHelperSha256": h.sha(program)}
        return plan, receipt, binding, program

    def test_current_bounded_reader_uses_real_receipt_contract_without_stale_heap_validate(self):
        plan, receipt, binding, program = self.bounded_source()
        with patch.object(h, "SOURCE_BINDINGS", {"a" * 64: binding}), patch.object(h, "document", return_value=receipt), \
             patch.object(h, "read", return_value=program):
            result = h.current_source(plan)
        self.assertEqual(result["kind"], "bounded-base1")
        self.assertEqual(result["runtime"]["pid"], 676577)
        self.assertIsNone(result["bootLink"])
        self.assertNotIn("526793cc20412f988175502a57625848f442626b04f6d2f888fd530e1192b797", h.SOURCE_BINDINGS)

    def test_unacknowledged_or_expiring_successor_never_falls_back_to_generic_validation(self):
        with patch.object(h, "read") as reader:
            with self.assertRaisesRegex(RuntimeError, "unacknowledged_source_successor"):
                h.current_source({"sourceRecovery": {"file": "/root/future", "sha256": "0" * 64}, "sourceHelperSha256": "a" * 64})
        reader.assert_not_called()
        plan, receipt, binding, program = self.bounded_source(expires=time.monotonic_ns() // 1000 + 300_000_000)
        with patch.object(h, "SOURCE_BINDINGS", {"a" * 64: binding}), patch.object(h, "document", return_value=receipt), \
             patch.object(h, "read", return_value=program):
            with self.assertRaisesRegex(RuntimeError, "handover_deadline_headroom"):
                h.current_source(plan)

    def test_normal_boot_link_cas_binds_actual_created_inode_before_removal(self):
        link = {"file": "/etc/systemd/system/multi-user.target.wants/" + h.SOURCE_UNIT,
                "target": "/etc/systemd/system/" + h.SOURCE_UNIT, "uid": 0, "gid": 0, "device": 5, "inode": 8}
        directory = types.SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0, st_gid=0)
        actual = types.SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0, st_gid=0, st_dev=5, st_ino=8)
        def metadata(path):
            return actual if str(path) == link["file"] else directory
        with patch.object(Path, "lstat", metadata), patch.object(h.os, "readlink", return_value=link["target"]):
            self.assertEqual(str(h.source_boot_link(link, present=True)), link["file"])
            actual.st_ino = 9
            with self.assertRaisesRegex(RuntimeError, "only_exact_owned_normal_boot_link_may_change"):
                h.source_boot_link(link, present=True)

    def test_owned_normal_boot_retirement_precedes_shared_start_and_changes_no_source_definition(self):
        link = {"file": "/etc/systemd/system/multi-user.target.wants/" + h.SOURCE_UNIT,
                "target": "/etc/systemd/system/" + h.SOURCE_UNIT, "uid": 0, "gid": 0, "device": 5, "inode": 8}
        binding = {"sourceSuccessor": {"bootLink": link}, "definitions": {h.SOURCE_UNIT: {"source": "unchanged"}}}
        actual = {**state(name=h.SOURCE_UNIT, active=False), "UnitFileState": "static"}
        events = []
        with patch.object(h, "source_boot_link", return_value=Path("/root/fake-owned-link")) as verified, \
             patch.object(h, "unit", return_value=actual), patch.object(h, "definitions", return_value={"source": "unchanged"}), \
             patch.object(h, "save", side_effect=lambda p, v: events.append(p.name)), \
             patch.object(Path, "unlink", side_effect=lambda: events.append("unlink-owned-boot")), \
             patch.object(h, "sync_dir"), patch.object(h, "run", side_effect=lambda argv: events.append(argv[-1])), \
             patch.object(h, "activation_paths", return_value={"WantedBy": "", "RequiredBy": "", "UpheldBy": ""}):
            self.assertTrue(h.retire_source_boot(binding, Path("/root/fake-operation")))
        verified.assert_called_once_with(link, present=True)
        self.assertEqual(events, ["normal-source-boot-retire-intent.json", "unlink-owned-boot", "daemon-reload", "normal-source-boot-retired.json"])

    def test_normal_boot_inverse_records_new_link_identity_without_restarting_expired_runtime(self):
        link = {"file": "/etc/systemd/system/multi-user.target.wants/" + h.SOURCE_UNIT,
                "target": "/etc/systemd/system/" + h.SOURCE_UNIT, "uid": 0, "gid": 0, "device": 5, "inode": 8}
        binding = {"sourceSuccessor": {"bootLink": link}, "definitions": {h.SOURCE_UNIT: {"source": "unchanged"}}}
        actual = {**state(name=h.SOURCE_UNIT, active=False), "UnitFileState": "static"}
        staging = Path(link["file"]).parent / (".yunipals-normal-restore-" + "a" * 32 + ".link")
        replacement = {**link, "inode": 19}
        docs = {"normal-source-boot-retire-intent.json": link,
                "normal-source-boot-restore-intent.json": {"original": link, "stageFile": str(staging)},
                "normal-source-boot-created.json": {"replacement": replacement, "stageFile": str(staging)}}
        with patch.object(h.os.path, "lexists", side_effect=lambda p:Path(p).name in docs), \
             patch.object(h, "read", side_effect=lambda p:json.dumps(docs[p.name]).encode()), \
             patch.object(h, "unit", side_effect=[actual, actual, {**actual, "UnitFileState": "enabled"}]), \
             patch.object(h, "definitions", return_value={"source": "unchanged"}), \
             patch.object(h, "source_boot_link", return_value=Path(link["file"])), \
             patch.object(h.os, "link") as create, patch.object(h, "sync_dir"), \
             patch.object(h, "save") as save, patch.object(h, "run") as command, \
             patch.object(Path, "lstat", return_value=types.SimpleNamespace(st_mode=stat.S_IFLNK|0o777,st_uid=0,st_gid=0,st_dev=5,st_ino=19)), \
             patch.object(h.os, "readlink", return_value=link["target"]):
            self.assertTrue(h.restore_source_boot(binding, Path("/root/fake-operation")))
        create.assert_called_once_with(staging, Path(link["file"]), follow_symlinks=False)
        command.assert_called_once_with(["/usr/bin/systemctl", "daemon-reload"])
        self.assertEqual(save.call_args.args[1]["inode"], 19)
        self.assertIs(save.call_args.args[1]["priorRuntimeRestarted"], False)

    def test_failure_after_boot_retire_intent_but_before_unlink_preserves_original_link(self):
        link = {"file": "/etc/systemd/system/multi-user.target.wants/" + h.SOURCE_UNIT,
                "target": "/etc/systemd/system/" + h.SOURCE_UNIT, "uid": 0, "gid": 0, "device": 5, "inode": 8}
        binding = {"sourceSuccessor": {"bootLink": link}, "definitions": {h.SOURCE_UNIT: {"source": "unchanged"}}}
        with patch.object(h.os.path, "lexists", side_effect=lambda p:str(p)==link["file"] or p.name=="normal-source-boot-retire-intent.json"), \
             patch.object(h, "read", return_value=json.dumps(link).encode()), \
             patch.object(h, "unit", return_value=state(name=h.SOURCE_UNIT, active=False)), \
             patch.object(h, "definitions", return_value={"source": "unchanged"}), patch.object(h, "source_boot_link") as verify, \
             patch.object(h.os, "symlink") as create, patch.object(h, "run") as command:
            self.assertFalse(h.restore_source_boot(binding, Path("/root/fake-operation")))
        verify.assert_called_once_with(link, present=True)
        create.assert_not_called()
        command.assert_not_called()

    def test_prior_source_cannot_be_reenabled_or_relinked_after_shared_start(self):
        actual = {**state(name=h.SOURCE_UNIT, active=False), "UnitFileState": "static", "TriggeredBy": "", "Triggers": ""}
        with patch.object(h, "unit", return_value=actual), \
             patch.object(h, "activation_paths", return_value={"WantedBy": "", "RequiredBy": "", "UpheldBy": ""}), \
             patch.object(h.os.path, "lexists", return_value=False):
            h.source_activation_retired({})
            actual["UnitFileState"] = "enabled"
            with self.assertRaisesRegex(RuntimeError, "all_owned_activation_paths_must_remain_retired"):
                h.source_activation_retired({})
            actual["UnitFileState"] = "static"
            with patch.object(h.os.path, "lexists", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "all_owned_activation_paths_must_remain_retired"):
                    h.source_activation_retired({})


class CoordinatedInverseAndTypedUnits(TestCase):
    def test_peer_probe_drops_to_fixed_existing_identity_and_exports_only_fixed_booleans(self):
        result={"startTicks":100,"bashExecutable":False,"nodeExecutable":True,"heapEnvironment4096":True,"heapArgument4096":False}
        with patch.object(h,"run",return_value=json.dumps(result))as command:
            self.assertEqual(h.peer_process_properties(42),result)
            argv=command.call_args.args[0]
            self.assertEqual(argv[:7],["/usr/bin/setpriv","--reuid=970","--regid=964","--clear-groups","--no-new-privs","--inh-caps=-all","--ambient-caps=-all"])
            self.assertEqual(argv[-1],"42")
            command.reset_mock()
            with self.assertRaisesRegex(RuntimeError,"fixed_source_peer_pid"):
                h.peer_process_properties(True)
            command.assert_not_called()
        with patch.object(h,"run",return_value=json.dumps({**result,"rawEnvironment":"forbidden fixture field"})):
            with self.assertRaisesRegex(RuntimeError,"fixed_peer_process_properties"):
                h.peer_process_properties(42)

    def test_feature_binding_is_peer_qualified_immutable_v5_and_not_superseded_owners(self):
        self.assertEqual(h.FEATURE_HELPER.name,"booster-feature-handover-v5.py")
        source=Path(__file__).with_name(h.FEATURE_HELPER.name)
        self.assertEqual(h.sha(source.read_bytes()),h.FEATURE_HELPER_SHA)
        self.assertNotIn(h.FEATURE_HELPER_SHA,{"3b96e86f8e629773969ff803af5707115ea3206f563deb02b9b2d327275f480f",
                                             "cc9f80670824c10f60c65aadb43f012485b2bff32d0bab068951e863305dff79",
                                             "80abc9e7687097e3380f815ce8cff06109ab4fea9f8cb3d4cfe8825115a3d5ce"})

    def test_receipt_producer_and_feature_loader_share_exact_marketplace_ack_entry(self):
        here=Path(__file__).parent
        spec=importlib.util.spec_from_file_location("actual_receipt_specific_entry",here/"consumer-operational-marketplace-ack-v2.py")
        entry=importlib.util.module_from_spec(spec);spec.loader.exec_module(entry)
        entry.OPS=here.absolute()
        installer=entry.core("install")
        self.assertEqual(installer.FORMAT,h.CONSUMER_FORMAT)
        self.assertEqual(installer.__file__,str((here/"consumer-operational-marketplace-ack-v2.py").absolute()))
        self.assertEqual(h.sha(Path(installer.__file__).read_bytes()),h.CONSUMER_OPERATOR_SHA)
        feature_spec=importlib.util.spec_from_file_location("actual_feature_receipt_loader",here/h.FEATURE_HELPER.name)
        feature=importlib.util.module_from_spec(feature_spec);feature_spec.loader.exec_module(feature)
        self.assertEqual(feature.DEPS["consumer-operational-marketplace-ack-v2.py"],h.CONSUMER_OPERATOR_SHA)
        self.assertEqual(feature.DEPS[entry.HISTORY],entry.HISTORY_SHA)
        self.assertEqual(h.sha((here/entry.HISTORY).read_bytes()),entry.HISTORY_SHA)
        self.assertNotEqual(h.CONSUMER_OPERATOR_SHA,entry.CORES["install"][1])

    def test_unreviewed_corrective_feature_owner_blocks_forward_candidate_and_inverse_before_io(self):
        with patch.object(h, "FEATURE_HELPER_SHA", None), patch.object(h, "read") as read:
            for action in [h.candidates, lambda:h.feature_inverse({"file":"/root/old","sha256":"a"*64},"b"*64)]:
                with self.assertRaisesRegex(RuntimeError, "reviewed_feature_inverse_owner_binding"):
                    action()
            read.assert_not_called()

    def test_lost_selector_commit_ack_recognizes_only_exact_intended_row(self):
        binding = {"priorPointer": [], "plan": {"sourceRuntime": {"bootId": "actual-boot"}}}
        desired = h.desired_pointer([], "2026-10-22T18:20:00.123400+00:00")
        intent = {"format": h.FORMAT, "before": [], "desired": desired, "originalReviewHash": h.sha(h.encode(binding)),
                  "bootId": "actual-boot"}
        actual = [{**desired, "published_at": "2026-10-22T18:20:00.1234+00:00"}]
        self.assertEqual(h.committed_selector_intent(binding, intent, actual), actual)
        self.assertIn("'2026-10-22T18:20:00.123400+00:00'::timestamptz", h.pointer_sql([], published_at=desired["published_at"]))
        for key,value in [("epoch",2),("release_id","foreign"),("published_at","2026-10-22T18:20:01.1234+00:00")]:
            changed = [{**actual[0],key:value}]
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError,"only_exact_committed_selector_intent"):
                h.committed_selector_intent(binding,intent,changed)

    def test_lost_start_ack_has_durable_bounded_stop_authority_before_manager_call(self):
        before = state(active=False)
        intents = {}
        def save(path,value):intents[path.name]=value
        with patch.object(h,"unit",return_value=before),patch.object(h,"definitions",return_value={"owned":"f"*64}), \
             patch.object(h,"save",side_effect=save),patch.object(h,"run",side_effect=TimeoutError("ACK lost after start accepted")):
            with self.assertRaises(TimeoutError):h.start_shared(Path("/root/operation"),"started-process.json",[])
        intent=intents["started-process-intent.json"]
        self.assertEqual(intent["definitions"],{"owned":"f"*64})
        current={**state(invocation="b"*32),"NRestarts":"0","ControlGroup":"/system.slice/"+h.UNIT,
                 "User":"yunipals_unified_shadow","Group":"yunipals_unified_shadow","WorkingDirectory":str(h.CWD)}
        current["process"]={"pid":42,"startTicks":intent["monotonicMicroseconds"]*h.os.sysconf("SC_CLK_TCK")//1000000,
                            "uid":970,"argvSha256":h.sha(b"/usr/bin/bash\0"+str(h.STAGE/"run-indexer.sh").encode()+b"\0")}
        with patch.object(h,"definitions",return_value=intent["definitions"]),patch.object(h,"process",return_value=current["process"]), \
             patch.object(h,"peer_process_properties",return_value={"bashExecutable":True,"startTicks":current["process"]["startTicks"]}):
            proof=h.shared_start_identity(current,intent)
            self.assertTrue(proof["reconciledForStopOnly"]);self.assertFalse(proof["readinessAccepted"])
            current["NRestarts"]="1"
            with self.assertRaisesRegex(RuntimeError,"only_exact_owned_shared_start"):
                h.shared_start_identity(current,intent)

    def test_real_boot_link_lost_reload_ack_finishes_without_recreation_or_repeated_reload(self):
        self.boot_fixture(lost_reload=True)

    def test_real_boot_link_lost_publish_ack_finishes_only_prepared_inode(self):
        self.boot_fixture(lost_publish=True)

    def test_interrupted_inverse_reenters_public_boot_finish_without_repeating_legacy_starts(self):
        self.boot_fixture(lost_reload=True,outer=True)

    def boot_fixture(self, lost_reload=False, lost_publish=False, outer=False):
        with tempfile.TemporaryDirectory(prefix="yunipals-boot-restore-") as temporary:
            root=Path(temporary);directory=root/"operation";directory.mkdir();parent=root/"wants";parent.mkdir()
            path=parent/h.SOURCE_UNIT;target="/etc/systemd/system/"+h.SOURCE_UNIT
            held=root/"retired-original.link";h.os.symlink(target,held);info=held.lstat()
            link={"file":str(path),"target":target,"uid":0,"gid":0,"device":info.st_dev,"inode":info.st_ino}
            (directory/"normal-source-boot-retire-intent.json").write_text(json.dumps(link))
            binding={"sourceSuccessor":{"bootLink":link},"definitions":{h.SOURCE_UNIT:{"source":"same"}}}
            enabled=False;calls=[];publish_calls=0;real_link=h.os.link
            legacy={name:{**state(name,active=False),"UnitFileState":"disabled"}for name in h.LEGACY}
            def verify(link,present):
                if not present:self.assertFalse(h.os.path.lexists(path));return path
                actual=path.lstat()
                h.require((actual.st_dev,actual.st_ino)==(link["device"],link["inode"]) and h.os.readlink(path)==target,
                          "only_exact_owned_normal_boot_link_may_change")
                return path
            def unit(name):
                if name==h.SOURCE_UNIT:return {**state(h.SOURCE_UNIT,active=False),"UnitFileState":"enabled"if enabled else"static"}
                return legacy[name]
            def command(argv,**kwargs):
                nonlocal enabled
                calls.append(argv)
                if argv[-1]=="daemon-reload":
                    enabled=True
                    if lost_reload and len(calls)==1:raise TimeoutError("reload succeeded; ACK lost")
                elif argv[1]=="start":legacy[argv[-1]]={**state(argv[-1],invocation="c"*32),"UnitFileState":"disabled"}
                return ""
            def publish(*args,**kwargs):
                nonlocal publish_calls
                publish_calls+=1;real_link(*args,**kwargs)
                if lost_publish and publish_calls==1:raise TimeoutError("hardlink published; caller stopped")
            with patch.object(h,"source_boot_link",side_effect=verify),patch.object(h,"unit",side_effect=unit), \
                 patch.object(h,"definitions",side_effect=lambda state:binding["definitions"][state["Id"]]), \
                 patch.object(h,"read",side_effect=lambda p:Path(p).read_bytes()), \
                 patch.object(h,"run",side_effect=command),patch.object(h.os,"link",side_effect=publish):
                if outer:
                    binding.update({"plan":{"sourceRuntime":{"bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip()},
                                            "boosterRetirement":{"sha256":"e"*64}},"priorPointer":[],
                                    "writers":deepcopy(legacy),"legacyBootLinks":{name:None for name in h.LEGACY_BOOT_UNITS},"consumerInstalls":{n:{"sha256":"d"*64}for n in h.INSTALL_UNITS}})
                    binding["definitions"].update({name:{"original-"+name:"a"*64}for name in h.LEGACY})
                    (directory/"review.json").write_text(json.dumps(binding));(directory/"originals.json").write_text('{}')
                    refs={n:{"file":"/root/"+n,"sha256":"b"*64}for n in [*h.INSTALL_UNITS,"booster"]}
                    checked={"format":h.FORMAT,"originalReviewHash":h.sha(h.encode(binding)),"installed":{},"selectedPointer":None,
                             "restartOriginalWriters":["yunipals-solana.service"],"featureInverse":self.restored(),
                             "consumerRollbacks":refs,"stoppedSolana":solana_snapshot(),"shared":state(active=False)}
                    with patch.object(h,"EVIDENCE",root),patch.object(h,"rollback_review",return_value=checked), \
                         patch.object(h,"combined_quiet",return_value={}),patch.object(h,"native",return_value=self.native()), \
                         patch.object(h,"solana",return_value=solana_snapshot()),patch.object(h,"feature_inverse",return_value=self.restored()), \
                         patch.object(h,"consumer_rollback_refs",return_value=refs), \
                         patch.object(h,"activation_paths",return_value={"WantedBy":"","RequiredBy":"","UpheldBy":""}):
                        with self.assertRaises(TimeoutError):h.rollback(directory,h.rollback_review_hash(checked),"/root/inverses")
                        self.assertTrue((directory/"rollback-intent.json").exists())
                        prior_start=directory/"rollback-start-intent-yunipals-solana.service.json"
                        prior_start.write_text('{}')
                        with self.assertRaisesRegex(RuntimeError,"boot_finish_cannot_repeat_any_legacy_start"):
                            h.rollback_boot_finish_review(directory)
                        prior_start.unlink()
                        review=h.rollback_boot_finish_review(directory)
                        self.assertTrue(h.rollback_boot_finish(directory,h.rollback_review_hash(review))["rolledBack"])
                        starts=[argv[-1]for argv in calls if len(argv)>1 and argv[1]=="start"]
                        self.assertEqual(starts,["yunipals-solana.service"])
                        with self.assertRaisesRegex(RuntimeError,"actual_interrupted_owned_boot_inverse"):
                            h.rollback_boot_finish_review(directory)
                    return
                with self.assertRaises(TimeoutError):h.restore_source_boot(binding,directory)
                public_inode=path.lstat().st_ino
                self.assertTrue(h.restore_source_boot(binding,directory))
                self.assertEqual(path.lstat().st_ino,public_inode)
                self.assertTrue(h.restore_source_boot(binding,directory))
                self.assertEqual(len(calls),1);self.assertEqual(publish_calls,1)
                self.assertTrue(json.loads((directory/"normal-source-boot-restored.json").read_text())["sourceRemainsStopped"])
                path.rename(root/"held-restored.link");h.os.symlink(target,path)
                with self.assertRaisesRegex(RuntimeError,"only_exact_owned_normal_boot_link"):
                    h.restore_source_boot(binding,directory)

    def native(self, sessions=2):
        return {"release": {"id": h.RELEASE, "physical_schema": h.SCHEMA, "build_id": h.BUILD},
                "app": {"build_id": h.BUILD, "is_dev": 0, "is_locked": 0}, "active": [], "sessions": sessions,
                "checkpoints": [{"chain_id": n} for n in [1, 56, 137, 8453]]}

    def restored(self, child=True):
        source = {"unit": h.BOOSTER_UNIT, "schema": "yunipals_boosters_launch_v1", "buildId": "6d581272ce",
                  "uid": 970, "gid": 964, "pid": 52, "cgroup": "/system.slice/" + h.BOOSTER_UNIT,
                  "actorPids": [52], "allowedChildProofs": [], "completeUidInventory": True,
                  "nativeLocked": True, "nativeReady": True, "sourceRoleSessions": 3}
        if child:
            source["actorPids"].append(53)
            source["allowedChildProofs"] = [{"pid": 53, "parentPid": 52, "executableSha256": h.FEATURE_ESBUILD_SHA,
                                             "argvSha256": h.FEATURE_ESBUILD_ARGV_SHA}]
        return {"format": "yunipals-booster-feature-inverse-validation-v1", "validated": True, "source": source,
                "apiInvocation": "c" * 32}

    def test_unlocked_combined_accepts_only_pinned_restored_booster_actor_and_bounded_pool(self):
        for child in [False, True]:
            h.native_identity(self.native(), selected=[], running=False, restored_booster=self.restored(child))
        changes = [{"sourceRoleSessions": 6}, {"actorPids": [52, 53, 99]}, {"buildId": "bf4939b3ff"},
                   {"completeUidInventory": False}, {"nativeLocked": False}]
        for change in changes:
            proof = self.restored(); proof["source"].update(change)
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "only_exact_owned_restored_booster"):
                h.native_identity(self.native(), selected=[], running=False, restored_booster=proof)
        with self.assertRaisesRegex(RuntimeError, "quiet_native_role"):
            h.native_identity(self.native(), selected=[], running=False)
        with self.assertRaisesRegex(RuntimeError, "only_exact_owned_restored_booster_sessions"):
            h.native_identity(self.native(6), selected=[], running=False, restored_booster=self.restored())

    def test_foreign_esbuild_child_is_not_attributed_to_owned_inverse(self):
        for key, value in [("parentPid", 99), ("executableSha256", "a" * 64), ("argvSha256", "b" * 64)]:
            proof = self.restored(); proof["source"]["allowedChildProofs"][0][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "only_exact_owned_restored_booster_child"):
                h.native_identity(self.native(), selected=[], running=False, restored_booster=proof)

    def test_review_binds_owned_actor_but_allows_fresh_indexing_and_pool_progress(self):
        checked = {"featureInverse": self.restored(), "quiesceResultSha256": "a" * 64,
                   "consumerRollbacks": {"booster": {"file": "/root/actual-inverse", "sha256": "b" * 64}}}
        checked["featureInverse"]["source"]["completeBlock"] = 52960001
        pin = h.rollback_review_hash(checked)
        progressed = deepcopy(checked)
        progressed["featureInverse"]["source"].update({"completeBlock": 52960005, "sourceRoleSessions": 5})
        self.assertEqual(h.rollback_review_hash(progressed), pin)
        for key, value in [("pid", 99), ("invocation", "e" * 32), ("actorPids", [52, 99])]:
            changed = deepcopy(progressed); changed["featureInverse"]["source"][key] = value
            with self.subTest(key=key): self.assertNotEqual(h.rollback_review_hash(changed), pin)
        progressed["featureInverse"]["apiInvocation"] = "f" * 32
        self.assertNotEqual(h.rollback_review_hash(progressed), pin)

    def test_typed_empty_environmentfiles_completes_only_the_actual_omission(self):
        base = {key: "" for key in h.KEYS if key != "EnvironmentFiles"}
        base.update({"Id": h.SOURCE_UNIT, "MainPID": "0"})
        output = "\n".join(key + "=" + value for key, value in base.items())
        with patch.object(h, "run", side_effect=[output, json.dumps({"type": "a(sb)", "data": []})]) as command:
            self.assertEqual(h.unit(h.SOURCE_UNIT)["EnvironmentFiles"], "[]")
        self.assertEqual(command.call_args.args[0][-1], "EnvironmentFiles")
        with patch.object(h, "run", side_effect=[output, json.dumps({"type": "a(sb)", "data": [["/private/file", False]]})]):
            with self.assertRaisesRegex(RuntimeError, "typed_empty_environment_files"):
                h.unit(h.SOURCE_UNIT)
        with patch.object(h, "run", return_value=output.replace("Result=\n", "")):
            with self.assertRaisesRegex(RuntimeError, "exact_unit_state"):
                h.unit(h.SOURCE_UNIT)

    def test_actual_v7_collector_login_is_preserved_and_all_inverses_follow_feature_inverse(self):
        refs = {n: {"file": "/root/" + n, "sha256": "a" * 64} for n in [*h.INSTALL_UNITS, "booster"]}
        installs = {n: {"sha256": "b" * 64} for n in h.INSTALL_UNITS}
        def receipt(ref):
            name = ref["file"].split("/")[-1]
            return {"format": h.CONSUMER_FORMAT, "rollbackApplied": True, "roleStateRestored": True,
                    "roleLoginAfter": name == "collector", "installResultSha256": "b" * 64,
                    "ownedBoosterReader": {"apiInvocation": "c" * 32}, "unit": h.INSTALL_UNITS[name],
                    "restoredInvocation": "d" * 32}
        def current(name): return state(name, invocation="d" * 32)
        with patch.object(h, "read", return_value=json.dumps(refs).encode()), patch.object(h, "document", side_effect=receipt), \
             patch.object(h, "unit", side_effect=current):
            self.assertEqual(h.consumer_rollbacks("/root/inverses", installs, self.restored()), refs)
            with self.assertRaisesRegex(RuntimeError, "actual_consumer_owner_rollback"):
                h.consumer_rollbacks("/root/inverses", installs, {"apiInvocation": "e" * 32})

    def test_quiesce_stops_exact_combined_and_shared_before_feature_can_restart_old_source(self):
        events = []
        checked = {"source": state(h.SOURCE_UNIT), "shared": state(), "solanaWriter": state("yunipals-solana.service"),
                   "selectedPointer": [], "originalReviewHash": "a" * 64}
        with patch.object(h, "rollback_state", return_value=checked), patch.object(h.os.path, "lexists", return_value=False), \
             patch.object(h, "save", side_effect=lambda p,v: events.append(p.name) or "b" * 64), \
             patch.object(h, "stop_owned", side_effect=lambda name,saved: events.append("stop " + name)), \
             patch.object(h, "combined_quiet", side_effect=lambda: events.append("combined quiet") or {}), \
             patch.object(h, "native", return_value=self.native(0)), patch.object(h, "read", return_value=b'{"priorPointer":[]}'), \
             patch.object(h, "solana", return_value=solana_snapshot()):
            result = h.rollback_quiesce(Path("/root/operation"), h.sha(h.encode(checked)))
        self.assertTrue(result["quiesced"])
        self.assertLess(events.index("stop " + h.SOURCE_UNIT), events.index("combined quiet"))
        self.assertLess(events.index("stop " + h.UNIT), events.index("combined quiet"))
        self.assertFalse(result["sourceSelectionChanged"])
        self.assertFalse(result["originalWritersStarted"])

    def test_feature_inverse_loads_only_reviewed_owner_and_same_forward_retirement(self):
        program = b"# frozen read-only feature owner fixture\n"
        pin = h.sha(program)
        ref = {"file": "/root/actual-feature-inverse", "sha256": "a" * 64}
        receipt = {"format": "yunipals-booster-feature-inverse-v1", "operatorSha256": pin,
                   "retirementReceiptSha256": "b" * 64, "restoredSchema": "yunipals_boosters_launch_v1", "publicReady": True}
        proof = {**self.restored(), "operatorSha256": pin, "inverseReceiptSha256": ref["sha256"],
                 "oldNineReadsPreserved": True, "priorTwoTargetReadsPreserved": True}
        module = types.ModuleType("fixed_feature_fixture")
        calls = []
        module.validate_inverse = lambda path,pin: calls.append((path,pin)) or proof
        with patch.object(h, "FEATURE_HELPER_SHA", pin), patch.object(h, "document", return_value=receipt), \
             patch.object(h, "read", return_value=program) as read, patch.object(h.types, "ModuleType", return_value=module):
            self.assertEqual(h.feature_inverse(ref, "b" * 64), proof)
            self.assertEqual(calls, [(ref["file"], ref["sha256"])])
            read.reset_mock()
            with self.assertRaisesRegex(RuntimeError, "actual_matching_owned_feature_inverse"):
                h.feature_inverse(ref, "c" * 64)
            read.assert_not_called()

    def test_quiet_requires_both_terminal_cgroups_and_connection_refused_not_an_unknown_failure(self):
        connection = types.SimpleNamespace(settimeout=lambda _:None, connect_ex=lambda _:h.errno.ECONNREFUSED)
        from unittest.mock import MagicMock
        socket = MagicMock(); socket.__enter__.return_value = connection
        with patch.object(h, "unit", side_effect=lambda name:state(name, active=False)), \
             patch.object(Path, "exists", return_value=False), patch.object(h.socket, "socket", return_value=socket):
            self.assertTrue(h.combined_quiet()["port9024Closed"])
            for result in [0, h.errno.ETIMEDOUT]:
                connection.connect_ex = lambda _,result=result:result
                with self.subTest(result=result), self.assertRaisesRegex(RuntimeError, "listener_must_be_closed"):
                    h.combined_quiet()

    def test_stopped_quiesce_intent_can_be_confirmed_without_repeating_any_stop(self):
        intent = {"source": state(h.SOURCE_UNIT), "shared": state(), "solanaWriter": state("yunipals-solana.service"),
                  "originalReviewHash": "a" * 64}
        checked = {"source": state(h.SOURCE_UNIT, active=False), "shared": state(active=False),
                   "solanaWriter": state("yunipals-solana.service", active=False), "originalReviewHash": "a" * 64, "selectedPointer": []}
        raw = json.dumps(intent).encode()
        def read(path): return b'{"priorPointer":[]}' if path.name == "review.json" else raw
        with patch.object(h, "rollback_state", return_value=checked), \
             patch.object(h.os.path, "lexists", side_effect=lambda p:p.name == "rollback-quiesce-intent.json"), \
             patch.object(h, "gone", return_value=True), patch.object(h, "read", side_effect=read), \
             patch.object(h, "save", return_value="b" * 64), patch.object(h, "combined_quiet", return_value={}), \
             patch.object(h, "native", return_value=self.native(0)), patch.object(h, "solana", return_value=solana_snapshot()), \
             patch.object(h, "stop_owned") as stop:
            review = h.rollback_quiesce(Path("/root/operation"))
            result = h.rollback_quiesce(Path("/root/operation"), review["reviewHash"])
            self.assertTrue(result["quiesced"])
            stop.assert_not_called()
            checked["source"] = state(h.SOURCE_UNIT, invocation="c" * 32)
            with self.assertRaisesRegex(RuntimeError, "only_terminal_owned_quiesce"):
                h.rollback_quiesce(Path("/root/operation"))


if __name__ == "__main__":
    main()
