#!/usr/bin/env python3
"""One owned old-source drain and fresh-source start; no reader/ACL switch.

Requires the actual inactive build and RPC admission receipts. All commands are
bound to fixed units and fresh identities. A lost acknowledgement is inspected,
never retried. An inverse restores only this owner's exact source/boot prefix.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import subprocess
import time
import types

FORMAT = "yunipals-ypal-source-start-v1"
BASE = Path("/var/backups/yunipals-ypal-source-start-v1-20261023")
INPUT = Path("/var/backups/yunipals-ypal-backend-input-v1-20261023")
PREPARED = Path("/var/backups/yunipals-ypal-backend-owner-v1-20261023")
PREPARE_FILE = INPUT / "ypal-backend-prepare-owner-v3.py"
PREPARE_SHA = "73a6de8dfe347cc3951fd53202013130f6f0ca9ff84f92c54999d03e7807daa0"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
RPC_FILE = OPS / "ypal-rpc-admission-v2.py"
RPC_SHA = "45cfa08ba3a2de5de775053081b954dbb5a5e732871e8db1b80fa0b16fe5591e"
RPC_RESULT_SHA = "14b54f8aba5179c26cafad5eda647106f1d1d57fe6639278846a4240661b85c7"
VIEM_ENTRY = Path("/var/lib/yunipals-unified-shadow/20261020-008028af-a/node_modules/.pnpm/viem@2.55.13_bufferutil@4.1.0_typescript@5.7.3_utf-8-validate@5.0.10_zod@3.24.2/node_modules/viem/_esm/index.js")
VIEM_ENTRY_SHA = "ea32975364e9f2d599b10639d81985ec6a3ed87f6942fe0cb73b1bf738959057"
SOURCE = "yunipals-booster-ypal-source.service"
OLD = "yunipals-booster-launch.service"
COMBINED = "yunipals-unified-source6-free-v2.service"
UNIT_FILE = Path("/etc/systemd/system") / SOURCE
BOOT_FILE = Path("/etc/systemd/system/multi-user.target.wants") / SOURCE
OLD_BOOT = Path("/etc/systemd/system/multi-user.target.wants") / OLD
SCHEMA = "yunipals_boosters_ypal_v1"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()

def self_sha(m): return sha(m.protected(Path(__file__).absolute()))

def activation(m, unit):
    need(unit in {OLD, SOURCE}, "fixed_source_activation_only")
    fields = ["WantedBy", "RequiredBy", "UpheldBy", "Triggers", "TriggeredBy", "NeedDaemonReload"]
    raw = m.command(["/usr/bin/systemctl", "show", "--all", unit, *["--property=" + k for k in fields]])
    value = dict(line.split("=", 1) for line in raw.decode().splitlines())
    need(set(value) == set(fields) and value["NeedDaemonReload"] == "no" and all(not value[k] for k in fields[:-1] if k != "WantedBy"), "hook_free_untriggered_source_required")
    return value

def link_record(m, path, target):
    info = path.lstat()
    need(stat.S_ISLNK(info.st_mode) and info.st_uid == 0 and os.readlink(path) == target, "exact_owned_boot_link_required")
    return {"identity": m.file_identity(info), "target": target}

def check_link(m, path, record):
    need(link_record(m, path, record["target"]) == record, "foreign_boot_link_inode_or_target")

def unlink_owned(m, path, record):
    check_link(m, path, record)
    need(m.file_identity(path.lstat()) == record["identity"], "boot_inode_changed_before_unlink")
    path.unlink(); m.sync(path.parent)

class Journal:
    def __init__(self, m): self.m = m
    def action(self, name, binding, effect):
        need(re.fullmatch("[a-z0-9-]+", name), "fixed_action_name_required")
        path = BASE / (name + "-intent.json")
        need(not os.path.lexists(path), "existing_action_requires_inspect_not_retry")
        intent = {"format": FORMAT, "operatorSha256": self_sha(self.m), "operationSha256": sha(self.m.protected(BASE / "operation.json")), "bootId": self.m.boot(), "monotonicNs": time.monotonic_ns(), "binding": binding, "automaticRetryAllowed": False}
        self.m.save(path, intent)
        result = effect(intent)
        self.m.save(BASE / (name + "-result.json"), {"format": FORMAT, "intentSha256": sha(self.m.protected(path)), "result": result})
        return result


def prepare_module():
    for path in [*PREPARE_FILE.parents, PREPARE_FILE]:
        info = path.lstat()
        need(info.st_uid == 0 and not info.st_mode & 0o022 and not stat.S_ISLNK(info.st_mode), "protected_preparation_producer_required")
    raw = PREPARE_FILE.read_bytes(); need(sha(raw) == PREPARE_SHA, "exact_frozen_inactive_owner_required")
    module = types.ModuleType("ypal_prepared_source"); module.__file__ = str(PREPARE_FILE)
    exec(compile(raw, str(PREPARE_FILE), "exec"), module.__dict__)
    return module.core()


def viem_entry_pin(m):
    # pnpm's reviewed immutable dependency can be hard-linked. It is not an
    # owner receipt: root-owned nonwritable exact public bytes remain mandatory.
    for path in [*VIEM_ENTRY.parents, VIEM_ENTRY]:
        info = path.lstat()
        need(info.st_uid == 0 and not info.st_mode & 0o022 and not stat.S_ISLNK(info.st_mode), "protected_exact_viem_dependency_required")
    before = VIEM_ENTRY.stat()
    need(stat.S_ISREG(before.st_mode) and before.st_size == 16476, "bounded_actual_viem_entry_required")
    raw = VIEM_ENTRY.read_bytes()
    need(sha(raw) == VIEM_ENTRY_SHA and m.file_identity(before) == m.file_identity(VIEM_ENTRY.stat()), "exact_existing_source008_viem_entry_required")
    return m.file_identity(before)


def manager(action, unit=None):
    need((action == "daemon-reload" and unit is None) or (action in {"start", "stop", "disable"} and unit in {OLD, SOURCE}), "source_only_fixed_manager_command")
    args = ["/usr/bin/systemctl", "--quiet", action] + ([unit] if unit else [])
    value = subprocess.run(args, env=ENV, capture_output=True, timeout=45)
    need(value.returncode == 0 and not value.stderr and not value.stdout, "source_command_ack_lost_inspect_before_inverse")


class Host:
    def __init__(self, m):
        self.m = m; self.h = m.Host()
        self.rpc = m.pinned_module(RPC_FILE, RPC_SHA)

    def policy(self):
        value = self.rpc.validate_current(RPC_RESULT_SHA)
        need(value.get("validated") is True and value.get("receiptSha256") == RPC_RESULT_SHA and value.get("profileId") == self.m.PROFILE_ID and value.get("endpoint") == "http://127.0.0.1:19212/unified" and value.get("freeOnly") is True and value.get("paidAuthority") is False and value.get("emptyPermits") is True and value.get("oldProxiesUnchanged") is True and value.get("budgetUnchanged") is True, "actual_acknowledged_fresh_RPC_admission_required")
        return value

    def prepared(self, pin, qualification_file, qualification_sha):
        raw = self.m.protected(PREPARED / "result.json"); value = json.loads(raw)
        need(sha(raw) == pin and value.get("format") == self.m.FORMAT and value.get("operatorSha256") == PREPARE_SHA and value.get("prepared") is True and value.get("sourceUnitInstalled") is False and value.get("sourceStarted") is False and value.get("oldSourceStopped") is False and value.get("APIChanged") is False and value.get("queueChanged") is False and value.get("databaseWrites") == value.get("grantChanges") == 0, "actual_inactive_preparation_receipt_required")
        operation = self.m.load(PREPARED / "operation.json")
        need(value["operationSha256"] == sha(self.m.protected(PREPARED / "operation.json")) and not (PREPARED / "inverse-result.json").exists(), "unabandoned_original_preparation_required")
        # Initial review only: the frozen prepare inspector intentionally expects
        # the original old source still active and the new unit still absent.
        original = self.m.Preparation(self.h, operation["qualification"]["file"], operation["qualification"]["sha256"])
        inspected = original.inspect(value["operationSha256"])
        need(inspected["preparedAcknowledged"] is True and inspected["resultSha256"] == pin, "fresh_qualified_inactive_preparation_required")
        ref, deployment, _ = self.m.read_qualification(qualification_file, qualification_sha)
        # Immutable identities come from the actual protected qualification.
        # ONE fresh full chain scan belongs immediately before a LIVE effect,
        # not every artifact review/inspection (or another inactive copy).
        return value, operation, ref, deployment

    def preflight(self, policy):
        # Explicit Base-only endpoints and exact NEW manifest; the all-chain
        # default/native source manifest is never passed or claimed to succeed.
        dependency = viem_entry_pin(self.m)
        code = "import{readFileSync}from'node:fs';import{registerHooks}from'node:module';import{pathToFileURL}from'node:url';const viem=import.meta.resolve('viem'),prefix=pathToFileURL(" + json.dumps(str(self.m.OLD_ROOT / "packages") + "/") + ").href;if(viem!==pathToFileURL(" + json.dumps(str(VIEM_ENTRY)) + ").href)throw Error('retained_app_viem_required');registerHooks({resolve(specifier,context,next){if(specifier==='viem'&&context.parentURL?.startsWith(prefix))return next(viem,context);return next(specifier,context)}});const{preflightUnifiedRpc}=await import('./lib/unified/rpc-preflight.ts');const p=JSON.parse(readFileSync(process.env.UNIFIED_RPC_PROFILE_FILE,'utf8'));const endpoint=" + json.dumps(policy["endpoint"]) + ";if(process.env.UNIFIED_RPC_PROFILE_ID!==" + json.dumps(policy["profileId"]) + "||process.env.PONDER_RPC_URL_8453!==endpoint)throw Error('exact_fresh_policy');const r=await preflightUnifiedRpc(p.manifest,process.env,{endpoints:{8453:endpoint}});if(r.diagnostics.length!==2||r.diagnostics.some(d=>d.chainId!==8453||d.replay.mode!=='free_only'))throw Error('fresh_base_only');console.log(JSON.stringify({passed:true,chainId:8453,profileId:process.env.UNIFIED_RPC_PROFILE_ID,allChainDefaultPreflight:false,paidAuthority:false}));"
        args = ["/usr/bin/env", "-i", "TSX_DISABLE_CACHE=1", self.m.NODE, "--max-old-space-size=256", "--env-file=" + str(self.m.ROOT / "launch.public.env"), "--import", "tsx", "--input-type=module", "-e", code]
        value = subprocess.run(args, cwd=self.m.PROJECT, env=ENV, capture_output=True, timeout=40)
        need(viem_entry_pin(self.m) == dependency, "viem_entry_changed_during_preflight")
        need(value.returncode == 0 and not value.stderr and len(value.stdout) <= 10000, "explicit_fresh_Base_only_preflight_required")
        proof = json.loads(value.stdout)
        need(proof == {"passed": True, "chainId": 8453, "profileId": policy["profileId"], "allChainDefaultPreflight": False, "paidAuthority": False}, "exact_new_profile_preflight_proof_required")
        return proof

    def old_actor(self): return self.h.observer.actor(self.h.core, OLD)
    def combined_actor(self): return self.h.observer.actor(self.h.core, COMBINED)

    def attribute(self, old):
        rows = self.h.observer.current_source_backends()
        return self.h.observer.attribute_old_sessions(old, rows, combined_actor=self.combined_actor())

    def unchanged(self, binding):
        self.h.unchanged(binding["preparationOperation"])
        need(self.h.code_proof() == binding["preparationOperation"]["source008"] and self.combined_actor() == binding["combinedActor"], "retained_source_code_or_combined_actor_changed")
        policy = self.policy()
        need(policy["profileId"] == binding["policy"]["profileId"] and policy["proxy"] == binding["policy"]["proxy"], "acknowledged_fresh_proxy_changed")

    def unit(self, binding):
        self.m.owned_file(UNIT_FILE, self.m.load(BASE / "unit-created.json"))
        state = self.m.unit_state(SOURCE)
        args = re.findall(r"argv\[\]=(.*?)\s+;", state["ExecStart"])
        need(state["FragmentPath"] == str(UNIT_FILE) and not state["DropInPaths"] and state["WorkingDirectory"] == str(self.m.PROJECT) and state["User"] == state["Group"] == "yunipals_unified_shadow" and len(args) == 1 and shlex.split(args[0]) == ["/usr/bin/env", "-i", *binding["argv"]], "exact_loaded_fresh_source_definition_required")
        for file, pin in binding["publicFilePins"].items(): self.m.owned_file(self.m.ROOT / file, pin)
        return state

    def fresh_actor(self, binding, intent=None):
        self.unit(binding)
        outer = self
        class Adapter:
            def state(self, name):
                need(name == SOURCE, "fixed_fresh_source_actor_only")
                return outer.m.unit_state(name)
            def peer_process_properties(self, pid): return outer.h.core.peer_process_properties(pid)
        value = self.h.observer.actor(Adapter(), SOURCE)
        need(len(value["actorPids"]) == 2, "wait_for_exact_Node_and_esbuild_source_actor")
        need((Path("/proc") / str(value["pid"]) / "cmdline").read_bytes().split(b"\0") == [*[a.encode() for a in binding["argv"]], b""], "exact_new_source_process_arguments_required")
        for pid in value["actorPids"]:
            if pid != value["pid"]:
                text = (Path("/proc") / str(pid) / "stat").read_text()
                need(int(text[text.rfind(")") + 2:].split()[1]) == value["pid"], "only_direct_pinned_esbuild_child_allowed")
        if intent is not None:
            start = intent["monotonicNs"] * os.sysconf("SC_CLK_TCK") // 1_000_000_000
            need(0 <= value["startTicks"] - start <= 45 * os.sysconf("SC_CLK_TCK"), "new_actor_not_bound_to_owned_start_intent")
        return value

    def native(self, binding):
        m = self.m; d = binding["deployment"]
        row = self.h.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + SCHEMA + "'),'owner',(SELECT nspowner::text FROM pg_namespace WHERE nspname='" + SCHEMA + "'),'app',(SELECT value FROM " + SCHEMA + "._ponder_meta WHERE key='app'),'checkpoint',(SELECT latest_checkpoint FROM " + SCHEMA + "._ponder_checkpoint WHERE chain_id=8453),'clock',floor(extract(epoch FROM statement_timestamp())*1000)::bigint,'types',(SELECT jsonb_agg(to_jsonb(t))FROM " + SCHEMA + ".booster_type t),'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'oid',c.oid::text,'owner',c.relowner::text,'kind',c.relkind)ORDER BY c.relname)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='" + SCHEMA + "'AND c.relname=ANY(ARRAY[" + ",".join("'" + t + "'" for t in m.TABLES) + "])), 'eventTail',(SELECT jsonb_build_array(count(*)::text,max(block_number)::text)FROM " + SCHEMA + ".booster_event), 'badAddresses',EXISTS(SELECT 1 FROM " + SCHEMA + ".booster_event WHERE address NOT IN('" + d["registry"].lower() + "','" + d["engine"].lower() + "','" + d["monsters"].lower() + "')))")
        app, point, clock = row["app"], row["checkpoint"], int(row["clock"])
        need(row["owner"] == "73004621" and app["build_id"] == binding["buildId"] and str(app["version"]) == "6" and str(app["is_dev"]) == "0" and str(app["is_locked"]) == str(app["is_ready"]) == "1" and 0 <= clock - int(app["heartbeat_at"]) <= 180000, "fresh_native_runtime_not_ready")
        need(isinstance(point, str) and re.fullmatch("[0-9]{75}", point) and int(point[10:26]) == 8453 and point[42:] == "9" * 33, "whole_native_Base_checkpoint_required")
        block, moment = int(point[26:42]), int(point[:10])
        need(block >= int(d["sourceStartBlock"]) and 0 <= clock - moment * 1000 <= 180000 and not row["badAddresses"], "fresh_native_source_coverage_required")
        rows = row["types"] or []
        expected = {"id": "8453:" + d["registry"].lower() + ":1", "registry": d["registry"].lower(), "engine": d["engine"].lower(), "payment_token": d["ypal"].lower(), "pack_type_id": "1", "price": "1000000000000000000", "interval_seconds": 86400, "mints_per_interval": 1, "total_variants": 264, "max_batch": 7, "catalog_hash": d["catalogHash"], "rule_hash": binding["expectedRuleHash"], "sales_paused": False, "manifest_uri": "https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/manifest.json", "metadata_base_uri": "https://api.yunipals.com/yunipals-indexer/v1/boosters/art/base-mainnet-standard-v1/"}
        need(len(rows) == 1 and all(str(rows[0].get(k)) == str(v) for k, v in expected.items()), "actual_native_YPAL_type1_rules_required")
        tables = row["tables"] or []
        need(sorted(t["name"] for t in tables) == m.TABLES and all(t["owner"] == "73004621" and t["kind"] == "r" for t in tables), "actual_native_ten_table_identities_required")
        header = self.rpc_header(block, binding["policy"])
        need(header["timestamp"] == moment, "native_checkpoint_header_time_changed")
        return {"ready": True, "schemaOid": row["schemaOid"], "buildId": app["build_id"], "readTableOids": {t["name"]: t["oid"] for t in tables}, "blockNumber": block, "blockHash": header["hash"], "timestamp": moment, "eventTail": row["eventTail"]}

    def rpc_header(self, number, policy):
        import urllib.request
        data = encoded({"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": [hex(number), False]})
        request = urllib.request.Request(policy["endpoint"], data=data, headers={"content-type": "application/json", "x-yunipals-unified-rpc-profile": policy["profileId"], "x-yunipals-rpc-workload": "unified_evidence"})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_): return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=8) as response:
            raw = response.read(500001); need(response.status == 200 and len(raw) <= 500000, "bounded_new_profile_header_required")
        value = json.loads(raw)
        need(not value.get("error") and value["result"]["number"] == hex(number), "canonical_new_profile_header_required")
        return {"hash": value["result"]["hash"], "timestamp": int(value["result"]["timestamp"], 16)}

    def quiet_acceptance(self, binding, expected_actor, seconds=150):
        end = time.monotonic() + seconds; first = None
        while True:
            need(self.fresh_actor(binding) == expected_actor, "fresh_source_restarted_during_acceptance")
            try:
                current = self.native(binding)
                if first and current["eventTail"] == first["eventTail"] and current["blockNumber"] >= first["blockNumber"] + 2:
                    need(current["schemaOid"] == first["schemaOid"] and current["readTableOids"] == first["readTableOids"] and self.rpc_header(first["blockNumber"], binding["policy"])["hash"] == first["blockHash"], "durable_native_identity_or_header_changed")
                    return {"ready": True, "first": first, "second": current, "quietBlockAdvances": current["blockNumber"] - first["blockNumber"]}
                if first is None or current["eventTail"] != first["eventTail"]: first = current
            except (RuntimeError, KeyError, TypeError):
                first = None
            need(time.monotonic() < end, "owned_source_started_but_native_acceptance_pending")
            time.sleep(1)

    def sessions(self, binding, actor):
        observer = self.h.observer; rows = observer.current_source_backends()
        combined = self.combined_actor(); need(combined == binding["combinedActor"], "same_combined_source_required")
        backends = observer.peer_fds([r["pid"] for r in rows], 111, 113)
        peers = observer.unix_peers(observer.run(["/usr/bin/ss", "-xHn"]))
        tcp = {**observer.tcp_clients(Path("/proc/net/tcp").read_bytes()), **observer.tcp_clients(Path("/proc/net/tcp6").read_bytes(), True)}
        fresh = observer.map_owned_backends(observer.peer_fds(actor["actorPids"], 970, 964), backends, rows, peers, tcp)
        shared = observer.map_owned_backends(observer.peer_fds(combined["actorPids"], 970, 964), backends, rows, peers, tcp)
        need(len(fresh) <= 5 and not {r["pid"] for r in fresh} & {r["pid"] for r in shared} and {r["pid"] for r in fresh + shared} == {r["pid"] for r in rows}, "only_fresh_five_pool_and_combined_owned_writer_sessions_allowed")
        need(observer.current_source_backends() == rows and self.fresh_actor(binding) == actor and self.combined_actor() == combined, "source_session_capture_changed")
        return {"complete": True, "freshSourceSessions": len(fresh), "combinedSessions": len(shared), "sharedRoleZeroSessionsRequired": False}

    def drained(self, binding):
        state = self.m.unit_state(OLD); self.m.quiet(state)
        need(state["InvocationID"] in {"", binding["oldActor"]["invocation"]}, "foreign_old_source_invocation_after_stop")
        for pid in binding["oldActor"]["actorPids"]:
            need(not Path("/proc", str(pid)).exists(), "old_source_process_still_present")
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.5); need(sock.connect_ex(("127.0.0.1", 9026)) != 0, "old_source_port_not_drained")
        app = self.h.query("SELECT value FROM " + self.m.OLD_SCHEMA + "._ponder_meta WHERE key='app'")
        need(str(app["is_locked"]) == "0", "old_native_source_still_locked")
        old = {(r["pid"], r["backendStart"]) for r in binding["oldSessionAttribution"]["oldBackends"]}
        rows = self.h.observer.current_source_backends()
        need(old.isdisjoint({(r["pid"], r["backendStart"]) for r in rows}), "old_kernel_owned_backend_tuples_still_live")
        current = self.combined_actor(); need(current == binding["combinedActor"], "combined_actor_changed_during_drain")
        observer = self.h.observer
        clients = observer.peer_fds(current["actorPids"], 970, 964)
        backends = observer.peer_fds([r["pid"] for r in rows], 111, 113)
        peers = observer.unix_peers(observer.run(["/usr/bin/ss", "-xHn"]))
        tcp = {**observer.tcp_clients(Path("/proc/net/tcp").read_bytes()), **observer.tcp_clients(Path("/proc/net/tcp6").read_bytes(), True)}
        matched = observer.map_owned_backends(clients, backends, rows, peers, tcp)
        need({(r["pid"], r["backendStart"]) for r in matched} == {(r["pid"], r["backendStart"]) for r in rows}, "all_remaining_writer_connections_must_have_current_combined_socket_ownership")
        need(self.h.observer.current_source_backends() == rows and self.combined_actor() == current, "combined_pool_changed_during_drain_capture")
        return {"oldBackendTuplesGone": True, "remainingCombinedBackends": matched, "sharedRoleZeroSessionsRequired": False, "oldNativeUnlocked": True, "oldPortClosed": True}



def actor_identity(value):
    return {k: value[k] for k in ("unit", "pid", "invocation", "startTicks", "cgroup")}


def wait_for(effect, code, seconds=35):
    deadline = time.monotonic() + seconds
    while True:
        try: return effect()
        except (RuntimeError, FileNotFoundError, KeyError):
            need(time.monotonic() < deadline, code)
            time.sleep(1)


class SourceStart:
    def __init__(self, host):
        self.h = host; self.m = host.m; self.journal = Journal(self.m)

    def review(self, prepared_sha, qualification_file, qualification_sha):
        m = self.m
        need(not os.path.lexists(BASE) and not os.path.lexists(UNIT_FILE) and not os.path.lexists(BOOT_FILE), "fresh_source_transition_required")
        prepared, operation, qualification, deployment = self.h.prepared(prepared_sha, qualification_file, qualification_sha)
        for parent in (Path("/etc/systemd/system"), Path("/run/systemd/system"), Path("/run/systemd/transient")):
            need(not os.path.lexists(parent / SOURCE) and not os.path.lexists(parent / (SOURCE + ".d")), "no_foreign_new_source_definition")
        m.unit_state(SOURCE, absent=True)
        old = self.h.old_actor(); combined = self.h.combined_actor()
        need(old == operation["snapshot"]["source"]["actor"], "original_old_actor_changed_before_transition")
        need(activation(m, OLD)["WantedBy"] == "multi-user.target", "only_known_old_boot_activation_allowed")
        old_link = link_record(m, OLD_BOOT, str(Path("/etc/systemd/system") / OLD))
        absent = self.h.h.query("SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='" + SCHEMA + "'))")
        need(absent is False, "fresh_source_schema_must_be_absent_initially")
        policy = self.h.policy(); preflight = self.h.preflight(policy)
        definition = m.protected(PREPARED / "source-unit.candidate")
        need(sha(definition) == operation["sourceUnitSha256"], "actual_offline_qualified_definition_required")
        argv = shlex.split(next(line.split("=", 1)[1] for line in definition.decode().splitlines() if line.startswith("ExecStart=")))
        need(argv[:2] == ["/usr/bin/env", "-i"], "clean_direct_source_exec_required")
        for path, pin in prepared["preparation"]["publicFilePins"].items(): m.owned_file(m.ROOT / path, pin)
        _, _, q = m.read_qualification(qualification_file, qualification_sha)
        binding = {"format": FORMAT, "operatorSha256": self_sha(m), "bootId": m.boot(), "preparedResultSha256": prepared_sha, "preparedOperationSha256": prepared["operationSha256"], "preparationOperation": operation, "qualification": qualification, "deployment": deployment, "expectedRuleHash": q["expectedRuleHash"], "policy": policy, "oldActor": old, "combinedActor": combined, "oldBootLink": old_link, "argv": argv[2:], "sourceUnitSha256": sha(definition), "publicFilePins": prepared["preparation"]["publicFilePins"], "buildId": prepared["preparation"]["build"]["buildId"]}
        need(binding["buildId"] == "8e88ea2e00", "actual_accepted_offline_build_required")
        self.h.unchanged(binding)
        return {"format": FORMAT, "binding": binding, "reviewHash": sha(encoded(binding)), "preflight": preflight, "sourceChanges": 0, "readerChanges": 0, "grantChanges": 0, "databaseWrites": 0, "liveBackendReady": False}

    def load(self, pin=None):
        m = self.m; raw = m.protected(BASE / "operation.json"); binding = json.loads(raw)
        need((pin is None or pin == sha(raw)) and binding["format"] == FORMAT and binding["operatorSha256"] == self_sha(m) and binding["bootId"] == m.boot(), "exact_owned_same_boot_transition_required")
        prepared = m.protected(PREPARED / "result.json")
        need(sha(prepared) == binding["preparedResultSha256"] and sha(m.protected(PREPARED / "operation.json")) == binding["preparedOperationSha256"], "unchanged_protected_preparation_required")
        self.h.unchanged(binding)
        return binding

    def action_record(self, name):
        m = self.m; intent = m.load(BASE / (name + "-intent.json"))
        need(intent["format"] == FORMAT and intent["operatorSha256"] == self_sha(m) and intent["bootId"] == m.boot() and intent["operationSha256"] == sha(m.protected(BASE / "operation.json")), "owned_exact_action_intent_required")
        result = m.load(BASE / (name + "-result.json"))
        need(result["format"] == FORMAT and result["intentSha256"] == sha(m.protected(BASE / (name + "-intent.json"))), "exact_action_acknowledgement_required")
        return intent, result["result"]

    def install(self, binding):
        m = self.m
        def effect(_):
            raw = m.protected(PREPARED / "source-unit.candidate")
            need(sha(raw) == binding["sourceUnitSha256"] and not os.path.lexists(UNIT_FILE), "fresh_exact_candidate_required")
            record = m.write_new(UNIT_FILE, raw, 0o644)
            m.save(BASE / "unit-created.json", record)
            manager("daemon-reload"); state = self.h.unit(binding); m.quiet(state)
            need(activation(m, SOURCE)["WantedBy"] == "", "new_source_must_not_be_enabled_before_owned_start")
            return record
        return self.journal.action("install-source-unit", {}, effect)

    def stop_old(self, binding):
        # Raw tuples are captured NOW, outside the pool-churn-stable review.
        # A normal connection replacement is allowed only by fresh kernel proof.
        old = self.h.old_actor(); need(old == binding["oldActor"], "foreign_old_source_before_stop")
        attribution = self.h.attribute(old)
        need(attribution["complete"] is True and attribution["applicationNameOrAgeInference"] is False and attribution["sharedRoleZeroSessionsRequired"] is False, "complete_fresh_kernel_attribution_required")
        capture = {**binding, "oldSessionAttribution": attribution}
        def effect(_):
            self.h.unchanged(binding); self.h.unit(binding)
            check_link(self.m, OLD_BOOT, binding["oldBootLink"])
            need(self.h.old_actor() == old, "foreign_replacement_must_not_be_stopped")
            manager("stop", OLD)
            proof = wait_for(lambda: self.h.drained(capture), "old_source_drain_pending_inspect_no_restart")
            return {"oldActor": old, "attribution": attribution, "drain": proof}
        return self.journal.action("stop-old-source", {"oldActor": old, "oldSessionAttribution": attribution}, effect)

    def disable_old(self, binding):
        m = self.m
        def effect(_):
            m.quiet(m.unit_state(OLD)); unlink_owned(m, OLD_BOOT, binding["oldBootLink"])
            manager("daemon-reload")
            self.old_terminal(binding)
            return {"oldSourceTerminal": True, "oldSourceDisabled": True}
        return self.journal.action("disable-old-source", {"oldBootLink": binding["oldBootLink"]}, effect)

    def old_terminal(self, binding):
        m = self.m; state = m.unit_state(OLD); m.quiet(state)
        need(state["InvocationID"] in {"", binding["oldActor"]["invocation"]} and state["UnitFileState"] == "disabled" and not os.path.lexists(OLD_BOOT) and activation(m, OLD)["WantedBy"] == "", "owned_old_source_terminal_disabled_required")
        for pid in binding["oldActor"]["actorPids"]:
            need(not Path("/proc", str(pid)).exists(), "original_old_source_actor_still_exists")
        value = self.h.h.query("SELECT value FROM " + self.m.OLD_SCHEMA + "._ponder_meta WHERE key='app'")
        need(str(value["is_locked"]) == "0" and value["build_id"] == binding["preparationOperation"]["snapshot"]["nativeOld"]["app"]["build_id"], "old_native_schema_must_remain_preserved_unlocked")
        return {"terminal": True, "enabled": False, "schemaPreserved": True}

    def start_new(self, binding):
        def effect(intent):
            self.h.unchanged(binding); self.old_terminal(binding)
            self.h.preflight(self.h.policy())
            state = self.h.unit(binding); self.m.quiet(state)
            manager("start", SOURCE)
            return wait_for(lambda: self.h.fresh_actor(binding, intent), "fresh_source_start_ack_pending_inspect_do_not_retry")
        return self.journal.action("start-new-source", {"unit": SOURCE, "definitionSha256": binding["sourceUnitSha256"]}, effect)

    def enable_new(self, binding):
        m = self.m
        if (BASE / "enable-new-source-result.json").exists():
            _, record = self.action_record("enable-new-source"); check_link(m, BOOT_FILE, record); return record
        def effect(_):
            need(not os.path.lexists(BOOT_FILE), "foreign_new_boot_link_must_not_be_overwritten")
            os.symlink(str(UNIT_FILE), BOOT_FILE); m.sync(BOOT_FILE.parent)
            record = link_record(m, BOOT_FILE, str(UNIT_FILE)); m.save(BASE / "boot-created.json", record)
            manager("daemon-reload"); check_link(m, BOOT_FILE, record)
            need(self.h.unit(binding)["UnitFileState"] == "enabled" and activation(m, SOURCE)["WantedBy"] == "multi-user.target", "owned_new_boot_link_not_loaded")
            return record
        return self.journal.action("enable-new-source", {}, effect)

    def owned_start(self):
        if (BASE / "start-new-source-result.json").exists():
            return self.action_record("start-new-source")
        m = self.m; intent = m.load(BASE / "start-new-source-intent.json")
        reconciled = m.load(BASE / "start-new-source-reconciled.json")
        need(intent["operationSha256"] == sha(m.protected(BASE / "operation.json")) and intent["operatorSha256"] == self_sha(m) and intent["bootId"] == m.boot() and reconciled["intentSha256"] == sha(m.protected(BASE / "start-new-source-intent.json")), "exact_owned_lost_start_reconciliation_required")
        return intent, reconciled["actor"]

    def reconcile_start(self, operation_sha):
        m = self.m; binding = self.load(operation_sha)
        need(not (BASE / "start-new-source-result.json").exists() and not (BASE / "start-new-source-reconciled.json").exists() and not (BASE / "inverse-intent.json").exists(), "only_unacknowledged_own_start_can_be_reconciled")
        intent = m.load(BASE / "start-new-source-intent.json")
        need(intent["format"] == FORMAT and intent["operationSha256"] == operation_sha and intent["operatorSha256"] == self_sha(m) and intent["bootId"] == m.boot(), "actual_same_boot_owned_start_intent_required")
        self.old_terminal(binding); actor = self.h.fresh_actor(binding, intent)
        value = {"format": FORMAT, "intentSha256": sha(m.protected(BASE / "start-new-source-intent.json")), "actor": actor, "originalStartAcknowledged": False, "reconciledCurrentOwnedIdentity": True, "sourceActions": 0, "automaticRetryAllowed": False}
        m.save(BASE / "start-new-source-reconciled.json", value)
        return value

    def accept(self, operation_sha):
        m = self.m; binding = self.load(operation_sha)
        need(not (BASE / "inverse-intent.json").exists() and not (BASE / "result.json").exists(), "existing_terminal_outcome_requires_inspect")
        intent, actor = self.owned_start()
        need(self.h.fresh_actor(binding, intent) == actor, "same_acknowledged_fresh_source_required")
        self.old_terminal(binding)
        proof = self.h.quiet_acceptance(binding, actor)
        self.h.unchanged(binding); self.old_terminal(binding)
        need(self.h.fresh_actor(binding) == actor, "fresh_actor_changed_after_acceptance")
        self.enable_new(binding)
        sessions = wait_for(lambda: self.h.sessions(binding, actor), "fresh_source_session_attribution_pending")
        result = {"format": FORMAT, "operatorSha256": self_sha(m), "bootId": m.boot(), "operationSha256": operation_sha, "preparedResultSha256": binding["preparedResultSha256"], "source": {**actor, "definitionSha256": binding["sourceUnitSha256"]}, "oldSource": self.old_terminal(binding), "schema": SCHEMA, "buildId": binding["buildId"], "schemaOid": proof["second"]["schemaOid"], "readTableOids": proof["second"]["readTableOids"], "acceptance": proof, "sessionProof": sessions, "independentActors": binding["preparationOperation"]["independentActors"], "sourceStarted": True, "ready": True, "readerChanges": 0, "grantChanges": 0, "oldSchemasRetained": True, "sharedSourceRestarted": False, "automaticRetryAllowed": False}
        m.save(BASE / "result.json", result)
        return result

    def apply(self, expected, prepared_sha, qualification_file, qualification_sha):
        reviewed = self.review(prepared_sha, qualification_file, qualification_sha)
        need(reviewed["reviewHash"] == expected, "exact_fresh_source_transition_review_required")
        binding = reviewed["binding"]
        # The only full state/receipt scan in this source transition. Immutable
        # qualified history is retained; current chain state is not inferred.
        fresh = self.h.h.chain(binding["deployment"])
        _, _, previous = self.m.read_qualification(qualification_file, qualification_sha)
        need(fresh["qualification"]["codeHashes"] == previous["qualification"]["codeHashes"] and fresh["qualification"]["transactions"] == previous["qualification"]["transactions"], "full_actual_chain_qualification_changed")
        self.h.unchanged(binding); need(self.h.old_actor() == binding["oldActor"], "old_actor_changed_after_chain_qualification")
        BASE.mkdir(mode=0o700); BASE.chmod(0o700); self.m.sync(BASE.parent)
        self.m.save(BASE / "operation.json", binding)
        self.m.save(BASE / "pre-transition-chain-qualification.json", fresh)
        self.install(binding); self.stop_old(binding); self.disable_old(binding); self.start_new(binding)
        return self.accept(sha(self.m.protected(BASE / "operation.json")))

    def inspect(self, operation_sha):
        binding = self.load(operation_sha)
        state = self.m.unit_state(SOURCE, absent=not os.path.lexists(UNIT_FILE))
        if os.path.lexists(UNIT_FILE): self.h.unit(binding)
        result = None
        if (BASE / "result.json").exists() and not (BASE / "inverse-intent.json").exists():
            result = validate_current(sha(self.m.protected(BASE / "result.json")), self.h)
        return {"format": FORMAT, "operationSha256": operation_sha, "sourceState": state, "acknowledgedReady": result is not None, "validation": result, "actionIntents": sorted(p.name for p in BASE.glob("*-intent.json")), "acknowledgements": sorted(p.name for p in BASE.glob("*-result.json")), "inverseAcknowledged": (BASE / "inverse-result.json").exists(), "automaticRetryAllowed": False, "sourceChanges": 0, "readerChanges": 0}

    def inverse(self, operation_sha):
        m = self.m; binding = self.load(operation_sha)
        need(not (BASE / "inverse-intent.json").exists(), "existing_inverse_requires_manual_reconciliation_not_retry")
        # Readers are outside this scope. Require their original configuration
        # first; after a reader switch its separately owned inverse must precede.
        self.h.h.core.admission.api_binding()
        for unit in (m.API, m.QUEUE, m.TIMER):
            current = self.h.h.observer.unit_packet(unit)
            original = binding["preparationOperation"]["snapshot"]["api"]["unit"] if unit == m.API else binding["preparationOperation"]["snapshot"]["queue"]["timer" if unit == m.TIMER else "service"]
            need(current["state"]["DropInPaths"] == original["state"]["DropInPaths"] and current["definitionFiles"] == original["definitionFiles"], "restore_owned_reader_configuration_before_source_inverse")
        m.save(BASE / "inverse-intent.json", {"format": FORMAT, "operationSha256": operation_sha, "operatorSha256": self_sha(m), "bootId": m.boot(), "automaticRetryAllowed": False})
        if not os.path.lexists(UNIT_FILE):
            need(not (BASE / "stop-old-source-intent.json").exists() and self.h.old_actor() == binding["oldActor"], "missing_unit_after_source_effect_requires_manual_reconciliation")
            check_link(m, OLD_BOOT, binding["oldBootLink"])
            result = {"format": FORMAT, "inverse": True, "operatorSha256": self_sha(m), "operationSha256": operation_sha, "oldSource": binding["oldActor"], "oldSourceNeverStopped": True, "sourceChanges": 0, "readerChanges": 0, "grantChanges": 0, "preparedOutputsRetained": True}
            m.save(BASE / "inverse-result.json", result); return result
        state = self.h.unit(binding)
        if state["MainPID"] != "0":
            intent, actor = self.owned_start()
            need(self.h.fresh_actor(binding, intent) == actor, "foreign_new_source_must_not_be_stopped")
            def stop_new(_):
                need(self.h.fresh_actor(binding, intent) == actor, "new_source_replaced_before_inverse_stop")
                manager("stop", SOURCE); m.quiet(self.h.unit(binding)); return {"stopped": actor}
            self.journal.action("inverse-stop-new-source", {}, stop_new)
        else: m.quiet(state)
        old_state = m.unit_state(OLD)
        if old_state["MainPID"] != "0":
            need(not (BASE / "start-new-source-intent.json").exists() and self.h.old_actor() == binding["oldActor"], "unexpected_active_old_source_requires_manual_reconciliation")
            check_link(m, OLD_BOOT, binding["oldBootLink"])
            m.remove_owned(UNIT_FILE, m.load(BASE / "unit-created.json")); manager("daemon-reload")
            result = {"format": FORMAT, "inverse": True, "operatorSha256": self_sha(m), "operationSha256": operation_sha, "oldSource": binding["oldActor"], "oldSourceNeverStopped": True, "freshSourceTerminal": True, "preparedOutputsRetained": True, "readerChanges": 0, "grantChanges": 0}
            m.save(BASE / "inverse-result.json", result); return result
        # A source start without an acknowledged identity is deliberately not
        # stopped automatically; inspect/reconcile that prefix first.
        self.old_terminal(binding) if (BASE / "disable-old-source-result.json").exists() else None
        self.h.h.query("SELECT 1")  # Read-only peer remains available.
        if (BASE / "start-new-source-intent.json").exists():
            exists = self.h.h.query("SELECT to_jsonb(to_regclass('" + SCHEMA + "._ponder_meta') IS NOT NULL)")
            if exists:
                app = self.h.h.query("SELECT value FROM " + SCHEMA + "._ponder_meta WHERE key='app'")
                need(str(app["is_locked"]) == "0", "fresh_native_lock_must_release_before_old_restart")
        # Reuse the real socket mapper: all current role sessions must be owned
        # by unchanged combined before reviving the old source.
        stop_intent = m.load(BASE / "stop-old-source-intent.json")
        need(stop_intent["format"] == FORMAT and stop_intent["operationSha256"] == operation_sha and stop_intent["operatorSha256"] == self_sha(m) and stop_intent["bootId"] == m.boot(), "owned_stop_intent_required_for_old_restart")
        drain_binding = {**binding, "oldSessionAttribution": stop_intent["binding"]["oldSessionAttribution"]}
        self.h.drained(drain_binding)
        if os.path.lexists(BOOT_FILE):
            record = m.load(BASE / "boot-created.json"); unlink_owned(m, BOOT_FILE, record)
        m.remove_owned(UNIT_FILE, m.load(BASE / "unit-created.json")); manager("daemon-reload")
        if not os.path.lexists(OLD_BOOT):
            need((BASE / "disable-old-source-intent.json").exists(), "no_authority_to_recreate_external_old_boot_link")
            os.symlink(binding["oldBootLink"]["target"], OLD_BOOT); m.sync(OLD_BOOT.parent)
            m.save(BASE / "restored-old-boot.json", link_record(m, OLD_BOOT, binding["oldBootLink"]["target"]))
            manager("daemon-reload")
        else: check_link(m, OLD_BOOT, binding["oldBootLink"])
        need(m.unit_state(OLD)["UnitFileState"] == "enabled" and activation(m, OLD)["WantedBy"] == "multi-user.target", "restored_owned_old_boot_authority_required")
        m.quiet(m.unit_state(OLD)); self.h.unchanged(binding)
        def restore_old(intent):
            m.quiet(m.unit_state(OLD)); self.h.unchanged(binding)
            manager("start", OLD)
            value = wait_for(self.h.old_actor, "old_source_start_requires_manual_reconciliation")
            need(value["startTicks"] >= intent["monotonicNs"] * os.sysconf("SC_CLK_TCK") // 1_000_000_000, "restored_old_actor_must_belong_to_inverse")
            return value
        old = self.journal.action("inverse-start-old-source", {}, restore_old)
        self.h.unchanged(binding)
        result = {"format": FORMAT, "inverse": True, "operatorSha256": self_sha(m), "operationSha256": operation_sha, "oldSource": old, "freshSourceTerminal": True, "freshSchemaRetained": True, "preparedOutputsRetained": True, "readerChanges": 0, "grantChanges": 0, "sharedSourceRestarted": False}
        m.save(BASE / "inverse-result.json", result)
        return result


def validate_current(result_sha, host=None):
    m = host.m if host else prepare_module(); host = host or Host(m)
    raw = m.protected(BASE / "result.json"); result = json.loads(raw)
    need(sha(raw) == result_sha and result["format"] == FORMAT and result["operatorSha256"] == self_sha(m) and result["bootId"] == m.boot() and result["ready"] is True and not (BASE / "inverse-intent.json").exists(), "actual_acknowledged_source_result_required")
    controller = SourceStart(host); binding = controller.load(result["operationSha256"])
    intent, actor = controller.owned_start()
    need(host.fresh_actor(binding, intent) == actor and actor_identity(actor) == actor_identity(result["source"]), "same_actual_owned_source_required")
    host.unit(binding); check_link(m, BOOT_FILE, m.load(BASE / "boot-created.json"))
    need(m.unit_state(SOURCE)["UnitFileState"] == "enabled" and activation(m, SOURCE)["WantedBy"] == "multi-user.target", "owned_fresh_boot_authority_required")
    old = controller.old_terminal(binding); native = host.native(binding)
    sessions = wait_for(lambda: host.sessions(binding, actor), "fresh_source_session_attribution_pending")
    need(native["schemaOid"] == result["schemaOid"] and native["readTableOids"] == result["readTableOids"] and host.rpc_header(result["acceptance"]["second"]["blockNumber"], binding["policy"])["hash"] == result["acceptance"]["second"]["blockHash"], "accepted_native_schema_or_boundary_changed")
    return {"validated": True, "receiptSha256": result_sha, "preparedResultSha256": binding["preparedResultSha256"], "source": result["source"], "oldSource": old, "schema": SCHEMA, "buildId": binding["buildId"], "schemaOid": native["schemaOid"], "readTableOids": native["readTableOids"], "native": native, "sessionProof": sessions, "independentActors": result["independentActors"], "readerChanges": 0, "grantChanges": 0, "sharedSourceRestarted": False}


def validate_owned(result_sha, terminal_ok=False):
    """Reader inverse authority only. Forward callers use validate_current.

    A terminal source must be its acknowledged invocation (or manager-GC empty),
    an empty cgroup and no surviving acknowledged PIDs. Native readiness is not
    claimed. The original result and its accepted real catalog remain bound.
    """
    if not terminal_ok: return validate_current(result_sha)
    m = prepare_module(); host = Host(m)
    raw = m.protected(BASE / "result.json"); result = json.loads(raw)
    need(sha(raw) == result_sha and result["format"] == FORMAT and result["operatorSha256"] == self_sha(m) and result["bootId"] == m.boot() and result["ready"] is True and not (BASE / "inverse-intent.json").exists(), "actual_owned_source_receipt_required_for_reader_inverse")
    owner = SourceStart(host); binding = owner.load(result["operationSha256"])
    state = host.unit(binding)
    if state["MainPID"] != "0": return validate_current(result_sha, host)
    m.quiet(state)
    need(state["InvocationID"] in {"", result["source"]["invocation"]} and all(not Path("/proc", str(pid)).exists() for pid in result["source"]["actorPids"]), "only_acknowledged_terminal_source_without_replacement_allowed")
    check_link(m, BOOT_FILE, m.load(BASE / "boot-created.json")); owner.old_terminal(binding)
    catalog = host.h.query("SELECT jsonb_build_object('schemaOid',(SELECT oid::text FROM pg_namespace WHERE nspname='" + SCHEMA + "'), 'buildId',(SELECT value->>'build_id'FROM " + SCHEMA + "._ponder_meta WHERE key='app'),'tables',(SELECT jsonb_object_agg(c.relname,c.oid::text)FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='" + SCHEMA + "'AND c.relowner=73004621 AND c.relkind='r'AND c.relname=ANY(ARRAY[" + ",".join("'" + t + "'" for t in m.TABLES) + "])))")
    need(catalog == {"schemaOid": result["schemaOid"], "buildId": binding["buildId"], "tables": result["readTableOids"]}, "same_owned_terminal_native_catalog_required")
    return {"validated": True, "receiptSha256": result_sha, "preparedResultSha256": binding["preparedResultSha256"], "source": result["source"], "sourceTerminal": True, "ready": False, "schema": SCHEMA, "buildId": binding["buildId"], "schemaOid": result["schemaOid"], "readTableOids": result["readTableOids"], "readerInverseOnly": True, "serviceChanges": 0, "databaseWrites": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", metavar="REVIEW_SHA")
    mode.add_argument("--accept", metavar="OPERATION_SHA")
    mode.add_argument("--reconcile-start", metavar="OPERATION_SHA")
    mode.add_argument("--inspect", metavar="OPERATION_SHA")
    mode.add_argument("--inverse", metavar="OPERATION_SHA")
    mode.add_argument("--validate-current", metavar="RESULT_SHA")
    parser.add_argument("--prepared-result-sha")
    parser.add_argument("--qualification-file"); parser.add_argument("--qualification-sha")
    args = parser.parse_args()
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError())); signal.alarm(540)
    m = prepare_module(); host = Host(m); owner = SourceStart(host)
    if args.validate_current: value = validate_current(args.validate_current, host)
    elif args.inspect: value = owner.inspect(args.inspect)
    elif args.accept: value = owner.accept(args.accept)
    elif args.reconcile_start: value = owner.reconcile_start(args.reconcile_start)
    elif args.inverse: value = owner.inverse(args.inverse)
    else:
        need(args.prepared_result_sha and args.qualification_file and args.qualification_sha, "actual_preparation_and_qualification_refs_required")
        value = owner.apply(args.apply, args.prepared_result_sha, args.qualification_file, args.qualification_sha) if args.apply else owner.review(args.prepared_result_sha, args.qualification_file, args.qualification_sha)
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    try: main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False, "errorClass": type(error).__name__, "fixedCode": str(error) if isinstance(error, RuntimeError) and re.fullmatch("[a-zA-Z0-9_]+", str(error)) else "private_diagnostics_withheld", "automaticRetryAllowed": False, "manualReconciliationRequired": True})); raise SystemExit(1)
