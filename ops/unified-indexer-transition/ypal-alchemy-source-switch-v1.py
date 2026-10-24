#!/usr/bin/env python3
"""One acknowledged four-chain catch-up and return to the original free source.

Default is source-only. Every manager effect has a durable exclusive intent;
an existing start/stop intent is inspected, never issued a second time.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import subprocess
import time
import urllib.request

FORMAT = "yunipals-alchemy-source-switch-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-ypal-alchemy-source-switch-v1-20261024")
HOLD = Path("/etc/systemd/system/.ypal-alchemy-source-switch-v1")
MANIFEST = OPS / "ypal-alchemy-source-switch-v1.sources.json"
INPUT = OPS / "ypal-alchemy-source-switch-v1.input.json"
SOURCE = "yunipals-ypal-combined-source.service"
FRESH = "yunipals-booster-ypal-source.service"
API = "yunipals-booster-api.service"
SOURCE_DROP = Path("/etc/systemd/system") / (SOURCE + ".d/99-alchemy-catchup-v1.conf")
PINS = {
    "plan": ("ypal-alchemy-source-switch-v1.plan.py", "3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56"),
    "host": ("ypal-alchemy-source-switch-v1.host.py", "3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02"),
    "leaf": ("ypal-alchemy-primary-current-v1.py", "753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215"),
    "financial": ("ypal-alchemy-catchup-financial-v1.py", "19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803")
}
STAGER = "ypal-alchemy-primary-stage-v1.py"
STAGER_SHA = "01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73"
STAGE_BASE = Path("/var/backups/yunipals-alchemy-primary-stage-v1-20261024")
FINANCIAL_BASE = Path("/var/backups/yunipals-ypal-alchemy-catchup-financial-v1-20261024")
DEADLINE_BUILD = Path("/var/backups/yunipals-rpc-deadline-host-build-v1-20261024/result.json")
DEADLINE_BUILD_SHA = "551f6a98bb2725444d8a65887912f442967cc5b657cdf082029e007672c769f7"
CACHE_SHA = "35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4"
CACHE_FILTERS_SHA = "394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675"
QUALIFICATION = {"file":"/var/backups/yunipals-alchemy-primary-import-v2-20261024/qualification-result.json",
    "sha256":"e2ef0d552fea4a0bedd6efe91cd3b23148ae53c6b396593c6dfd5c5615762334",
    "operatorFile":"ypal-alchemy-primary-import-v2.py","operatorSha256":"44d502b19bdae6a484db2da719bae154c9a96480d006d7bb9536f0c4ea36f083",
    "format":"yunipals-alchemy-primary-import-v2"}
SIX_KEYS = ("st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink")


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pin(value):
    return isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value) and value != "0" * 64


def six(record):
    return {key: record[key] for key in SIX_KEYS}


def native_order(native):
    need(set(native["checkpoints"])=={"1","56","137","8453"} and
         all(all(isinstance(row[key],str)and re.fullmatch("[0-9]{75}",row[key])for key in ["latest","safe","finalized"])and
             row["latest"]>=row["safe"]for row in native["checkpoints"].values()),
         "actual_all_four_current_latest_at_or_after_native_safe_required")


def gone(processes):
    for row in processes:
        need(type(row["pid"]) is type(row["startTicks"]) is int and row["pid"] > 1 and row["startTicks"] > 0,
             "actual_known_process_epoch_required")
        try:
            raw = (Path("/proc") / str(row["pid"]) / "stat").read_text()
        except FileNotFoundError:
            continue
        need(int(raw[raw.rfind(")") + 2:].split()[19]) != row["startTicks"], "known_process_epoch_still_exists_even_outside_cgroup")


def source_scan():
    """Two stable UID970 argv/stat inventories; no environment or foreign argv."""
    snapshots = []
    deadline = time.monotonic() + 8
    for _ in range(2):
        rows = {}
        for directory in Path("/proc").iterdir():
            if not directory.name.isdigit():
                continue
            need(time.monotonic() < deadline, "bounded_source_terminal_scan_required")
            try:
                before = directory.stat()
                if before.st_uid != 970:
                    continue
                raw = (directory / "stat").read_text(); parts = raw[raw.rfind(")") + 2:].split()
                ticks = int(parts[19]); command = (directory / "cmdline").read_bytes()
                need(len(command) <= 1000000 and (command or parts[0] in {"Z", "X", "x"}), "bounded_unambiguous_source_command_required")
                if command:
                    argv = command.rstrip(b"\0").split(b"\0")
                    need(not (b"--schema" in argv and b"unified_ypal_20261023_v1" in argv and any(b"ponder.js" in x for x in argv)),
                         "no_unacknowledged_combined_writer_anywhere_required")
                later = (directory / "stat").read_text()
                need(int(later[later.rfind(")") + 2:].split()[19]) == ticks and directory.stat().st_uid == 970,
                     "same_UID_source_scan_epoch_required")
                rows[int(directory.name)] = [ticks, sha(command)]
            except FileNotFoundError:
                continue
        snapshots.append(rows)
    need(snapshots[0] == snapshots[1], "stable_full_source_UID_terminal_scan_required")
    return sha(encoded(snapshots[0]))


def wait_read(check, seconds=90):
    end = time.monotonic() + seconds
    last = None
    while time.monotonic() < end:
        try:
            return check()
        except (RuntimeError, FileNotFoundError) as error:
            last = error
            time.sleep(0.25)
    raise RuntimeError("bounded_observation_incomplete_no_manager_retry") from last


def move_link(p, leaf, source, target, expected):
    need(leaf.link_record(source) == expected, "exact_prepared_deadline_boot_symlink_required")
    p.directory(source.parent); p.directory(target.parent)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renameat2(-100, os.fsencode(source), -100, os.fsencode(target), 1):
        raise OSError(ctypes.get_errno(), "owned_no_replace_boot_move_refused")
    p.sync(source.parent); p.sync(target.parent)
    need(leaf.link_record(target) == expected, "same_owned_published_boot_inode_required")


class Context:
    def __init__(self, manifest_sha, input_sha):
        # Bootstrap through the independently reviewed Host loader; no Host or
        # obsolete whole-source validator is constructed by importing modules.
        import types
        path = OPS / PINS["host"][0]
        for parent in [*path.parents, path]:
            row = parent.lstat()
            need(row.st_uid == 0 and not row.st_mode & 0o022 and not stat.S_ISLNK(row.st_mode), "protected_lifecycle_bootstrap_required")
        raw = path.read_bytes(); need(sha(raw) == PINS["host"][1], "exact_reviewed_lifecycle_host_required")
        bootstrap = types.ModuleType("alchemy_lifecycle_bootstrap"); bootstrap.__file__ = str(path)
        exec(compile(raw, str(path), "exec"), bootstrap.__dict__)
        leaf = bootstrap.load(OPS / PINS["leaf"][0], PINS["leaf"][1])
        self.manifest_sha, self.input_sha = manifest_sha, input_sha
        self.manifest = leaf.document(MANIFEST, manifest_sha); self.config = leaf.document(INPUT, input_sha)
        need(self.manifest["format"] == FORMAT + "-sources" and set(self.manifest) == {"format", "lifecycle", *PINS, "stager", "cacheGate","cacheFilters","stageQualificationReceipt"} and
             self.manifest["lifecycle"] == {"file": Path(__file__).name, "sha256": sha(leaf.protected(Path(__file__).absolute()))},
             "actual_frozen_lifecycle_and_finite_manifest_required")
        for key, (name, digest) in PINS.items():
            need(self.manifest[key] == {"file": name, "sha256": digest}, "exact_frozen_business_component_required")
        self.p = bootstrap.load(OPS / PINS["plan"][0], PINS["plan"][1]); self.leaf = leaf
        self.financial = bootstrap.load(OPS / PINS["financial"][0], PINS["financial"][1])
        stage = self.manifest["stager"]
        need(stage == {"file": STAGER, "sha256": STAGER_SHA}, "actual_reviewed_stager_required")
        self.stager = bootstrap.load(OPS / stage["file"], stage["sha256"])
        cache = self.manifest["cacheGate"]
        need(cache == {"file":"ypal-alchemy-restart-cache-v1.py","sha256":CACHE_SHA} and
             self.manifest["cacheFilters"]=={"file":"ypal-alchemy-restart-cache-v1.filters.json","sha256":CACHE_FILTERS_SHA} and
             sha(leaf.protected(OPS/self.manifest["cacheFilters"]["file"]))==CACHE_FILTERS_SHA and self.manifest["stageQualificationReceipt"]==QUALIFICATION,
             "actual_reviewed_restart_cache_and_v2_import_components_required")
        self.cache = bootstrap.load(OPS / cache["file"], cache["sha256"])
        need(callable(self.cache.validate_restart_capture), "concrete_readonly_cache_restart_gate_required")
        need(set(self.config) == {"format", "stageResultSha256", "qualificationResultSha256", "financialPreparedSha256", "planSha256"} and
             self.config["format"] == FORMAT + "-input" and all(pin(self.config[k]) for k in self.config if k != "format"),
             "actual_stage_import_financial_preparation_and_plan_refs_required")
        self.h = bootstrap.Host(self.p, leaf); self.m = self.h.m
        self.host_module = bootstrap
        self.fowner = self.financial.load_saved()
        self.fprepared = self.fowner.prepared()
        need(sha(self.m.protected(FINANCIAL_BASE / "prepared.json")) == self.config["financialPreparedSha256"] and
             self.fprepared["planSha256"] == self.config["planSha256"], "exact_actual_financial_preparation_required")
        self.plan = self.fprepared["plan"]

    def stage_current(self, initial=False):
        staged = self.m.document(STAGE_BASE / "stage-result.json", self.config["stageResultSha256"])
        qualified = self.m.document(Path(QUALIFICATION["file"]), self.config["qualificationResultSha256"])
        need(self.config["qualificationResultSha256"]==QUALIFICATION["sha256"] and qualified["format"]==QUALIFICATION["format"] and
             sha(self.m.protected(OPS/QUALIFICATION["operatorFile"]))==QUALIFICATION["operatorSha256"] and
             staged["staged"] is True and staged["operatorSha256"] == self.manifest["stager"]["sha256"] and
             qualified["operatorSha256"]==QUALIFICATION["operatorSha256"] and
             qualified["qualified"] is True and qualified["stageResultSha256"] == self.config["stageResultSha256"] and
             qualified["qualificationIntentSha256"] == sha(self.m.protected(Path(QUALIFICATION["file"]).parent / "qualification-intent.json")) and
             qualified["observation"]["counts"] == {"network": 0, "listen": 0, "database": 0, "pool": 0, "spawn": 0} and
             qualified["observation"]["nativeMetadataReads"]==1 and
             qualified["observation"]["actualUnprivilegedImport"] is True, "actual_guarded_RPC_peer_import_required")
        if initial:
            self.stager.qualified_stage(self.config["stageResultSha256"])
        retained, _ = self.stager.retained()
        need(retained == staged["retained"] and self.stager.peer() == staged["peer"] and
             six(self.stager.identity(self.stager.TARGET)) == six(staged["targetIdentity"]) and
             self.stager.identity(self.stager.TARGET / "node_modules") == staged["dependencyLink"]["identity"] and
             os.readlink(self.stager.TARGET / "node_modules") == str(self.stager.CONTEXT),
             "actual_qualified_runtime_context_and_dependency_link_must_stay_exact")
        for name, (digest, _) in self.stager.PAYLOAD.items():
            self.stager.read(self.stager.TARGET / name, digest)
        loaded = qualified["observation"]["loadedDependencies"]
        need(len(loaded) == qualified["observation"]["loadedDependencyFiles"] and 0 < len(loaded) <= 20000,
             "actual_finite_loaded_dependency_subset_required")
        for relative, digest in loaded:
            need(not Path(relative).is_absolute() and ".." not in Path(relative).parts and pin(digest), "literal_qualified_dependency_path_required")
            self.stager.read(self.stager.RELEASE / relative, digest, 200000000)
        build = self.m.document(DEADLINE_BUILD, DEADLINE_BUILD_SHA); actual = build["actual"]
        need(build["format"] == "yunipals-rpc-deadline-host-build-v1" and build["completed"] is True and
             build["operatorSha256"] == "e9e84e7450debf66295279c92ffd67d0a5e8a28a2b3afc3599338c11ce271f90" and
             build["nativeAndCacheIdentityPreserved"] is build["safeRecoveryFloorsPreserved"] is build["ownTransientCollected"] is True and
             actual["uid"] == 970 and actual["gid"] == 964 and actual["buildId"] == "71e2a7f3b7" and
             actual["poolMax"] == actual["effectivePoolMax"] == 5 and actual["candidateTransportSha256"] == self.p.TIMEOUT_SHA and
             actual["socketAttempts"] == actual["databaseCalls"] == actual["realProviderRequests"] == 0 and
             actual["interceptedFixtureRequests"] == 12 and
             sha(self.m.protected(self.p.OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")) == self.p.TIMEOUT_SHA,
             "actual_same71e_pool5_zero_effect_host_build_and_exact690_transport_required")
        return {"stageResultSha256": self.config["stageResultSha256"], "qualificationResultSha256": self.config["qualificationResultSha256"],
                "deadlineHostBuildReceiptSha256": DEADLINE_BUILD_SHA}

    def retained(self):
        rpc = self.h.source.rpc
        parser = rpc.module(rpc.PARSER, rpc.PARSER_SHA)
        result = {}
        for unit in rpc.PROXY_UNITS:
            packet = rpc.packet(self.h.rpc_m, self.h.a, unit)
            result[unit] = {"packet": packet, "boot": rpc.proxy_boot(packet),
                            "environment": rpc.proxy_environment(self.h.rpc_m, self.h.a, packet, parser)}
        return result

    def proxy_environment(self,chain,actor):
        rpc=self.h.source.rpc;parser=rpc.module(rpc.PARSER,rpc.PARSER_SHA)
        unit=self.h.proxy_unit(chain);packet=rpc.packet(self.h.rpc_m,self.h.a,unit)
        need(packet["actor"]==actor,"same_owned_proxy_before_full_merged_environment_proof_required")
        proof=rpc.proxy_environment(self.h.rpc_m,self.h.a,packet,parser)
        need(rpc.packet(self.h.rpc_m,self.h.a,unit)==packet,"same_owned_proxy_after_full_merged_environment_proof_required")
        return proof

    def peers(self):
        h = self.h
        return {"actors": {name: h.restore.canonical_actor(h.source.actor(name)) for name in [FRESH, API]},
                "packets": h.source.pack_packets(), "boots": h.source.pack_boots()}

    def og(self):
        import types
        pure = self.m.module(OPS / "ypal-combined-read-admission-v2.py", "c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd")
        peer = types.SimpleNamespace(m=types.SimpleNamespace(run=self.m.command,protected=self.m.protected))
        # Only pure definition/environment and scoped process-metadata
        # preservation; no legacy environ/exe peer or installed-app claim.
        sdk = self.m.Host.__new__(self.m.Host)
        unit = "yunipals-indexer.service"
        consumers=pure.consumer_frame(peer)
        return {"consumers":consumers,"currentFrames":{name:self.unit_preservation(name)for name in consumers},
                "legacyParent":{"frame":self.unit_preservation(unit),"activation":sdk.activation(unit),"definitions":sdk.definitions(unit),
                    "preservationOnly":True,"otherRuntimeAuthorityQualified":False},
                "installedApplicationClosureQualified":False,"retirementQualified":False}

    def unit_preservation(self,unit):
        need(unit in {FRESH,API,"yunipals-api.service","yunipals-collector-api.service","yunipals-islands-api.service","yunipals-metadata.service","yunipals-indexer.service"},
             "finite_current_peer_preservation_units_required")
        fields=["Id","FragmentPath","DropInPaths","MainPID","InvocationID","ControlGroup","ActiveState","SubState","UnitFileState","User","Group",
                "WorkingDirectory","After","Requires","Wants","PartOf","BindsTo","TriggeredBy","Triggers","WantedBy","RequiredBy","UpheldBy"]
        state=self.leaf.manager_properties(self.h.rpc_m,unit,fields)
        for key in ["After","Requires","Wants","PartOf","BindsTo","TriggeredBy","Triggers","WantedBy","RequiredBy","UpheldBy"]:
            state[key]=" ".join(sorted(state[key].split()))
        definitions={path:{"sha256":sha(self.m.protected(path)),"identity":self.leaf.file_identity(path)}for path in
                     [state["FragmentPath"],*state["DropInPaths"].split()]if path}
        object_path="/org/freedesktop/systemd1/unit/"+"".join(c if c.isalnum()else"_"+format(ord(c),"02x")for c in unit)
        typed=json.loads(self.m.command(["/usr/bin/busctl","--json=short","get-property","org.freedesktop.systemd1",object_path,"org.freedesktop.systemd1.Service","EnvironmentFiles"]))
        need(typed["type"]=="a(sb)"and len(typed["data"])<=32,"finite_typed_current_peer_environment_files_required")
        private={}
        for path,optional in typed["data"]:
            need(type(optional)is bool and Path(path).is_absolute()and".."not in Path(path).parts,"literal_current_peer_private_input_required")
            if not os.path.lexists(path):need(optional,"required_current_peer_input_absent");private[path]=None
            else:private[path]={"sha256":sha(self.m.protected(path)),"identity":self.leaf.file_identity(path)}
        group=Path("/sys/fs/cgroup/system.slice")/unit/"cgroup.procs"
        pids=sorted(int(v)for v in group.read_text().split())if group.exists()else[]
        need(len(pids)<=16 and (state["MainPID"]=="0"or int(state["MainPID"])in pids),"bounded_current_peer_cgroup_frame_required")
        processes=[];node_inputs={}
        for pid in pids:
            proc=Path("/proc")/str(pid);raw=(proc/"stat").read_text();ticks=int(raw[raw.rfind(")")+2:].split()[19])
            command=(proc/"cmdline").read_bytes();need(len(command)<=1000000,"bounded_current_peer_command_required")
            argv=command.rstrip(b"\0").decode().split("\0")if command else[];declared=[]
            for index,item in enumerate(argv):
                if item.startswith("--env-file="):declared.append(item.split("=",1)[1])
                elif item=="--env-file":
                    need(index+1<len(argv),"literal_current_Node_envfile_argument_required");declared.append(argv[index+1])
            need(len(declared)<=16 and all(Path(path).is_absolute()and".."not in Path(path).parts for path in declared),"bounded_literal_current_Node_private_files_required")
            node_inputs[str(pid)]=declared
            for path in declared:private[path]={"sha256":sha(self.m.protected(path)),"identity":self.leaf.file_identity(path)}
            status=dict(v.split(":",1)for v in(proc/"status").read_text().splitlines()if":"in v)
            processes.append({"pid":pid,"startTicks":ticks,"commandSha256":sha(command),"privileges":{k:status[k].strip()for k in
                ["Uid","Gid","Groups","NoNewPrivs","CapInh","CapPrm","CapEff","CapBnd","CapAmb"]}})
            later=(proc/"stat").read_text();need(int(later[later.rfind(")")+2:].split()[19])==ticks,"same_current_peer_process_epoch_required")
        links={};directories=list(self.p.SYSTEM.iterdir());need(len(directories)<=2048,"bounded_current_peer_boot_directory_required")
        for directory in directories:
            if directory.name.endswith((".wants",".requires")):
                path=directory/unit
                if os.path.lexists(path):links[str(path)]=self.leaf.link_record(path)
        need((sorted(int(v)for v in group.read_text().split())if group.exists()else[])==pids,"current_peer_cgroup_changed_during_frame")
        after=self.leaf.manager_properties(self.h.rpc_m,unit,fields)
        for key in ["After","Requires","Wants","PartOf","BindsTo","TriggeredBy","Triggers","WantedBy","RequiredBy","UpheldBy"]:
            after[key]=" ".join(sorted(after[key].split()))
        need(after==state,"current_peer_manager_identity_changed_during_frame")
        return {"state":state,"definitions":definitions,"orderedEnvironmentFiles":typed,"privateInputHashes":private,
                "orderedNodeEnvironmentFiles":node_inputs,"processes":processes,"bootLinks":links,"preservationOnly":True,"otherRuntimeAuthorityQualified":False}

    def current_peer_frame(self):
        sdk=self.m.Host.__new__(self.m.Host)
        return {"freshActor":sdk.actor(FRESH,True),"freshDefinitions":sdk.definitions(FRESH),"freshActivation":sdk.activation(FRESH),
            "freshFrame":self.unit_preservation(FRESH),"apiFrame":self.unit_preservation(API),
            "api":self.h.source.rpc.packet(self.h.rpc_m,self.h.a,API),"og":self.og(),
            "preservationOnly":True,"otherRuntimeAuthorityQualified":False,"retirementQualified":False}

    def source_subset(self,actor):
        rows=self.host_module.kernel_backends(self.h.source.query,self.h.observer,73004621,{SOURCE:actor},{SOURCE:(970,964)},False)[SOURCE]
        need(len(rows)>=1,"positive_current_owned_source_backend_subset_required")
        return {SOURCE:rows}

    def source_bindings(self):
        object_path="/org/freedesktop/systemd1/unit/"+"".join(c if c.isalnum()else"_"+format(ord(c),"02x")for c in SOURCE)
        result={}
        for name in ["BindPaths","BindReadOnlyPaths","EnvironmentFiles"]:
            result[name]=json.loads(self.m.command(["/usr/bin/busctl","--json=short","get-property","org.freedesktop.systemd1",object_path,"org.freedesktop.systemd1.Service",name]))
        need(result["EnvironmentFiles"]=={"type":"a(sb)","data":[]},"source_must_use_only_literal_Node_envfiles_with_clean_exec")
        return result

    def source_private_inputs(self,actor):
        paths=[value.split("=",1)[1]for value in actor["parent"]["argv"]if value.startswith("--env-file=")]
        need(len(paths)==3 and len(set(paths))==3 and all(Path(path).is_absolute()and".."not in Path(path).parts for path in paths),
             "exact_original_three_ordered_private_Node_environment_files_required")
        return [{"path":path,"sha256":sha(self.m.protected(path)),"identity":self.leaf.file_identity(path)}for path in paths]

    def private_current(self,op):
        need(self.source_private_inputs(op["source"])==op["sourcePrivateInputs"],"same_original_private_Node_files_and_inodes_required")

    def remaining_source_facts(self):
        frame=self.current_peer_frame();actor=frame["freshActor"];actors={}if actor is None else{FRESH:actor}
        values=self.host_module.kernel_backends(self.h.source.query,self.h.observer,73004621,actors,{FRESH:(970,964)},True)
        need(self.current_peer_frame()==frame,"current_retained_peer_changed_during_kernel_absence_proof")
        return {"actualRemainingAttribution":values,"otherRuntimeAuthorityQualified":False,"retirementQualified":False}

    def current_pack_ready(self):
        manifest=self.fowner.h.profile["manifest"]["sources"]
        contracts={v["contractName"].lower():v["address"].lower()for v in manifest if v["enabled"]and v["feature"]=="boosters"}
        expected={"collection":contracts["boostermonsters"],"engine":contracts["boosterengine"]}
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args):return None
        for url in ["http://127.0.0.1:9030/readyz","https://api.yunipals.com/yunipals-indexer/v1/boosters/types"]:
            request=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0","Origin":"https://www.yunipals.com"})
            with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(request,timeout=8)as response:
                raw=response.read(1000001);need(response.status==200 and len(raw)<=1000000,"bounded_current_pack_HTTP200_required")
            value=json.loads(raw);need(all(value[k].lower()==v for k,v in expected.items()),"actual_pinned_fresh_YPAL_contracts_required")
            if url.endswith("/readyz"):need(value["ready"]is True and value["buildId"]in{"8e88ea2e00","71e2a7f3b7"},"current_owned_pack_reader_must_be_ready")
            else:need(value["enabled"]is True and len(value["items"])==1 and value["items"][0]["packTypeId"]=="1","one_current_public_YPAL_pack_required")
        return {"actualCurrentLocalAndPublicPack200":True,"otherRuntimeAuthorityQualified":False}

    def immutable(self, op):
        need(self.m.document(MANIFEST, self.manifest_sha) == self.manifest and self.m.document(INPUT, self.input_sha) == self.config and
             self.h.source.inputs() == op["inputs"] and self.m.link_record(self.h.r.BOOT) == op["sourceBoot"] and
             self.retained() == op["retainedRPC"], "same_source_inputs_boot_and_five_retained_RPC_actors_required")
        self.private_current(op)
        self.stage_current()
        need(sha(self.m.protected(OPS/self.manifest["cacheFilters"]["file"]))==CACHE_FILTERS_SHA,"same_official_filter_matrix_required")
        for name, digest in [("lifecycle", op["operatorSha256"]), *[(k, v[1]) for k, v in PINS.items()], ("cacheGate", self.manifest["cacheGate"]["sha256"])]:
            need(sha(self.m.protected(OPS / self.manifest[name]["file"])) == digest, "all_lifecycle_code_sources_must_stay_exact")


class Owner:
    def __init__(self, context):
        self.c = context; self.h = context.h; self.m = context.m; self.p = context.p; self.leaf = context.leaf

    def get(self, name): return self.m.document(BASE / name)
    def digest(self, name): return sha(self.m.protected(BASE / name))
    def exists(self, name): return os.path.lexists(BASE / name)
    def put(self, name, value): return self.p.exclusive(BASE / name, encoded(value))
    def producer(self): return sha(self.m.protected(Path(__file__).absolute()))

    def operation(self):
        op = self.get("operation.json")
        need(op["format"] == FORMAT and op["operatorSha256"] == self.producer() and op["manifestSha256"] == self.c.manifest_sha and
             op["inputSha256"] == self.c.input_sha and op["bootId"] == self.m.boot() and op["financialPlan"] == self.c.plan and
             op["chainRouting"]=={chain:self.p.proxy_mode(chain)for chain in self.p.CHAINS}and
             op["planSha256"] == self.c.config["planSha256"] and "financialResultSha256" not in op,
             "same_immutable_pre_financial_operation_required")
        return op

    def common(self):
        op = self.operation(); self.c.immutable(op); self.h.source.pack_ready()
        self.verify_published_configuration()
        need(self.c.peers() == op["peers"], "same_temporary_pack_source_API_private_inputs_and_boot_required")
        need(self.c.og() == op["og"], "same_legacy_OG_reader_and_writer_runtime_private_inputs_and_boot_required")
        native = self.h.source.native(); self.h.r.recovery_floor(op["native"], native)
        native_order(native)
        return op, native

    def source_context(self):
        op=self.operation();self.c.immutable(op);self.verify_published_configuration()
        native=self.h.source.native();self.h.r.recovery_floor(op["native"],native)
        native_order(native)
        return op,native

    def loaded_source(self,mode):
        op=self.operation();state=self.h.source.state(SOURCE);definitions=dict(op["sourceDefinitions"])
        if mode=="paid":definitions[str(SOURCE_DROP)]=op["sourceOverlay"]
        need(self.h.definitions(state)==definitions and self.h.source.runtime_properties()==op["sourceRuntime"] and
             self.m.link_record(self.h.r.BOOT)==op["sourceBoot"],"exact_loaded_source_definitions_hardening_RW_and_boot_required")
        object_path="/org/freedesktop/systemd1/unit/"+"".join(c if c.isalnum()else"_"+format(ord(c),"02x")for c in SOURCE)
        def typed(name):return json.loads(self.m.command(["/usr/bin/busctl","--json=short","get-property","org.freedesktop.systemd1",object_path,"org.freedesktop.systemd1.Service",name]))
        pairs=list(self.m.NAMESPACE.items());original=op["sourceBindings"];current=self.c.source_bindings()
        for property_name,wanted in [("BindPaths",pairs[:3]),("BindReadOnlyPaths",pairs[3:])]:
            if mode=="paid"and property_name=="BindReadOnlyPaths":
                wanted=[(inside,str(self.p.OPS/"ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")if inside.endswith("/lib/unified/rpc-preflight.ts")else backing)for inside,backing in wanted]
            value=current[property_name];before=original[property_name]
            need(value["type"]=="a(ssbt)"and len(value["data"])==len(wanted)==3 and
                 all(len(row)==4 and row[:3]==[backing,inside,False]and type(row[3])is int and row[3]in{0,16384}for row,(inside,backing)in zip(value["data"],wanted)),
                 "exact_three_RW_and_three_RO_loaded_source_bindings_required")
            need(before["type"]==value["type"]and len(before["data"])==len(value["data"])and
                 all(old[3]==new[3]for old,new in zip(before["data"],value["data"])),"exact_original_loaded_source_mount_flags_required")
        argv=list(op["source"]["parent"]["argv"])
        if mode=="paid":argv.insert(argv.index(self.p.PROJECT+"/node_modules/ponder/dist/esm/bin/ponder.js"),"--env-file="+str(self.p.STAGE/"source.public.env"))
        value=typed("ExecStart")
        need(value["type"]=="a(sasbttttuii)"and len(value["data"])==1 and len(value["data"][0])==10 and
             value["data"][0][:3]==["/usr/bin/env",["/usr/bin/env","-i",*argv],False],"exact_loaded_clean_source_command_and_ordered_Node_envfiles_required")
        return True

    def review(self):
        need(not os.path.lexists(BASE) and not os.path.lexists(HOLD) and not os.path.lexists(SOURCE_DROP), "fresh_lifecycle_paths_required")
        self.c.stage_current(True)
        need(not (FINANCIAL_BASE / "admission-commit-attempt.json").exists(), "initial_source_whole_check_only_before_any_financial_commit_attempt")
        self.c.fowner.validate_admission_before(self.c.fowner.h.snapshot(), self.c.fprepared)
        self.h.initial_current()
        actor = self.h.restore.canonical_actor(self.h.source.actor(SOURCE)); native = self.h.source.native(); self.h.r.heartbeat(native)
        self.h.r.recovery_floor(native, native); sessions = self.h.source_sessions(actor)
        native_order(native)
        routes = {chain: self.h.free_route(chain) for chain in self.p.CHAINS}
        value = {"format": FORMAT, "operatorSha256": self.producer(), "manifestSha256": self.c.manifest_sha, "inputSha256": self.c.input_sha,
                 "bootId": self.m.boot(), "financialPlan": self.c.plan, "planSha256": self.c.config["planSha256"], "source": actor,
                 "chainRouting":{chain:self.p.proxy_mode(chain)for chain in self.p.CHAINS},
                 "sourceDefinitions": self.h.definitions(actor["unit"]), "sourceRuntime": self.h.source.runtime_properties(),"sourceBindings":self.c.source_bindings(),
                 "sourcePrivateInputs":self.c.source_private_inputs(actor),
                 "sourceBoot": self.m.link_record(self.h.r.BOOT), "inputs": self.h.source.inputs(), "native": native,
                 "sourceKernelSessions": sessions, "originalFreeRoutes": routes, "retainedRPC": self.c.retained(), "peers": self.c.peers(),"og":self.c.og()}
        need(self.h.restore.canonical_actor(self.h.source.actor(SOURCE)) == actor and {k: self.h.free_route(k) for k in self.p.CHAINS} == routes,
             "initial_source_and_four_free_route_final_CAS_required")
        stable = {k: v for k, v in value.items() if k not in {"native", "sourceKernelSessions"}}
        stable["nativeIdentity"] = {k: native[k] for k in ["schemaOid", "tables", "cache"]}
        return value, sha(encoded(stable))

    def prepare(self, review_sha):
        value, fresh = self.review(); need(pin(review_sha) and fresh == review_sha, "exact_fresh_initial_lifecycle_review_required")
        BASE.mkdir(mode=0o700); HOLD.mkdir(mode=0o700); self.p.sync(BASE.parent); self.p.sync(HOLD.parent)
        prepared = {}
        for name, raw in [("source", self.p.source_drop()), *[(chain, self.p.proxy_drop(chain)) for chain in self.p.CHAINS]]:
            record = self.p.exclusive(HOLD / (name + ".conf"), raw, 0o644)
            prepared[name] = {"sha256": record["sha256"], "identity": six(record["identity"])}
        public_files = {}
        for name, raw in [("source.public.env", self.p.source_environment(self.c.plan)), *[(chain + ".public.env", self.p.proxy_environment(chain)) for chain in self.p.CHAINS]]:
            public_files[name] = self.p.exclusive(self.p.STAGE / name, raw, 0o644)
        deadlines = {}; boots = {}
        for name, raw in self.p.deadline_definitions(value["financialPlan"], value["planSha256"]).items():
            target = self.p.SYSTEM / name
            need(not os.path.lexists(target), "no_existing_deadline_unit_may_be_replaced")
            record = self.p.exclusive(HOLD / name, raw, 0o644)
            deadlines[name] = {"sha256": record["sha256"], "identity": six(record["identity"])}
            if name.endswith(".timer"):
                link = HOLD / (name + ".boot"); link.symlink_to(target); self.p.sync(HOLD)
                boots[name] = self.leaf.link_record(link)
        value.update({"reviewHash": fresh, "overlays": prepared, "sourceOverlay": prepared["source"], "publicFiles": public_files,
                      "deadlineFiles": deadlines, "deadlineBootLinks": boots})
        need(self.h.restore.canonical_actor(self.h.source.actor(SOURCE)) == value["source"] and self.c.peers() == value["peers"] and self.c.retained() == value["retainedRPC"],
             "pre_operation_actor_and_peer_CAS_required")
        need(self.c.og()==value["og"],"pre_operation_OG_consumer_and_legacy_writer_CAS_required")
        self.put("operation.json", value)
        return {"prepared": True, "operationSha256": self.digest("operation.json"), "planSha256": value["planSha256"], "financialAdmitted": False}

    def record(self, **fields):
        return {"format": FORMAT, "operatorSha256": self.producer(), "manifestSha256": self.c.manifest_sha,
                "operationSha256": self.digest("operation.json"), "planSha256": self.operation()["planSha256"], "bootId": self.m.boot(), **fields}

    def journal(self, name):
        value = self.get(name)
        need(value["operatorSha256"] == self.producer() and value["manifestSha256"] == self.c.manifest_sha and
             value["operationSha256"] == self.digest("operation.json") and value["bootId"] == self.m.boot(), "actual_same_operation_journal_required")
        return value

    def publish(self, name, target):
        op = self.operation(); expected = op["overlays"][name]; staged = HOLD / (name + ".conf")
        parent = target.parent
        if not parent.exists():
            parent.mkdir(mode=0o755); self.p.sync(parent.parent)
        self.p.directory(parent)
        record = {"sha256": expected["sha256"], "identity": self.p.identity(staged)}
        need(six(record["identity"]) == expected["identity"], "actual_prepared_overlay_inode_required")
        self.p.move_owned(staged, target, record)
        need({"sha256": sha(self.leaf.protected(target)), "identity": self.leaf.file_identity(target)} == expected, "exact_published_overlay_inode_required")

    def reload(self, tag):
        name = tag + "-reload-intent.json"
        if self.exists(name):
            self.journal(name)
            need(self.exists(tag + "-reloaded.json"), "unknown_daemon_reload_requires_explicit_configuration_only_completion")
            return
        self.put(name, self.record())
        self.h.manager("daemon-reload")
        self.put(tag + "-reloaded.json", self.record(completed=True, intentSha256=self.digest(name)))

    def complete_reload(self, tag):
        need(tag in {"deadline", "source-paid", "source-free", *[c + "-paid" for c in self.p.CHAINS], *[c + "-free" for c in self.p.CHAINS]},
             "fixed_owned_configuration_reload_phase_required")
        self.journal(tag + "-reload-intent.json"); need(not self.exists(tag + "-reloaded.json"), "unacknowledged_configuration_reload_only")
        self.verify_published_configuration(); self.h.manager("daemon-reload")
        self.put(tag + "-reloaded.json", self.record(completed=True, intentSha256=self.digest(tag + "-reload-intent.json"), explicitConfigurationOnlyCompletion=True))
        return {"configurationReloadCompleted": True, "sourceOrProxyStartStopRepeated": False}

    def verify_published_configuration(self):
        op = self.operation()
        for name, target in [("source", SOURCE_DROP), *[(c, self.h.proxy_drop(c)) for c in self.p.CHAINS]]:
            source = target if os.path.lexists(target) else HOLD / (name + ".conf")
            if not os.path.lexists(source): source = HOLD / (name + ".removed.conf")
            need({"sha256": sha(self.leaf.protected(source)), "identity": self.leaf.file_identity(source)} == op["overlays"][name], "all_owned_overlay_inodes_and_bytes_required")
        for name, record in op["publicFiles"].items():
            need(sha(self.leaf.protected(self.p.STAGE / name)) == record["sha256"] and six(self.p.identity(self.p.STAGE / name)) == six(record["identity"]),
                 "all_owned_public_environment_inodes_required")

    def install_deadlines(self):
        op, _ = self.common(); definitions = self.p.deadline_definitions(op["financialPlan"], op["planSha256"])
        for name, raw in definitions.items():
            intent = name + "-definition-intent.json"; target = self.p.SYSTEM / name
            if not self.exists(intent):
                need(not os.path.lexists(target), "fresh_owned_deadline_definition_required")
                self.put(intent, self.record(sha256=sha(raw), prepared=op["deadlineFiles"][name]))
            if not os.path.lexists(target):
                staged = HOLD / name
                need({"sha256":sha(self.leaf.protected(staged)),"identity":self.leaf.file_identity(staged)} == op["deadlineFiles"][name],
                     "actual_prepared_deadline_file_required")
                self.p.move_owned(staged, target, {"sha256":sha(raw),"identity":self.p.identity(staged)})
            need({"sha256":sha(self.leaf.protected(target)),"identity":self.leaf.file_identity(target)} == op["deadlineFiles"][name],
                 "exact_owned_deadline_definition_inode_required")
        self.reload("deadline")
        units = {}
        for name, raw in definitions.items():
            target = self.p.SYSTEM / name
            units[name] = {"sha256": sha(raw), "identity": self.leaf.file_identity(target)}
            if name.endswith(".timer"):
                directory = self.p.SYSTEM / "timers.target.wants"
                if not directory.exists(): directory.mkdir(mode=0o755); self.p.sync(directory.parent)
                boot = directory / name; tag = name + "-boot-intent.json"
                if not self.exists(tag):
                    need(not os.path.lexists(boot), "fresh_owned_deadline_boot_link_required")
                    self.put(tag, self.record(target=str(target),prepared=op["deadlineBootLinks"][name]))
                if not os.path.lexists(boot):
                    move_link(self.p,self.leaf,HOLD/(name+".boot"),boot,op["deadlineBootLinks"][name])
                need(self.leaf.link_record(boot)==op["deadlineBootLinks"][name],"same_prepared_deadline_boot_inode_required")
                if not self.exists(name + "-boot-result.json"):
                    self.put(name + "-boot-result.json", self.record(bootLink=self.leaf.link_record(boot)))
                saved = self.journal(name + "-boot-result.json")
                need(self.leaf.link_record(boot) == saved["bootLink"], "same_owned_deadline_boot_inode_required")
                units[name]["bootLink"] = saved["bootLink"]
                start = name + "-start-intent.json"
                if not self.exists(start):
                    self.put(start, self.record(notBeforeUs=self.m.mono())); self.common(); self.h.manager("start", name)
        value = self.record(format=FORMAT + "-deadline-prepared", units=units)
        # Validate the actual wire using the frozen leaf before publishing its
        # final receipt; a temporary protected candidate is never an ACK alias.
        if not self.exists("deadline-prepared.json"):
            self.put("deadline-prepared.json", value)
        need(self.get("deadline-prepared.json") == value, "same_actual_deadline_receipt_required")
        self.leaf.validate_deadline_prepared(op["planSha256"], self.digest("deadline-prepared.json"))
        return {"deadlinePrepared": True, "deadlineReceiptSha256": self.digest("deadline-prepared.json")}

    def admission(self, result_sha=None, active=False):
        op = self.operation()
        if not self.exists("financial-admission-link.json"):
            need(pin(result_sha), "actual_financial_commit_ACK_required")
            proof = self.c.financial.acknowledgement(result_sha)
            need(proof["planSha256"] == op["planSha256"], "only_this_operation_financial_plan_may_link")
            self.put("financial-admission-link.json", self.record(format=FORMAT + "-admission-link", financialResultSha256=result_sha))
        value = self.journal("financial-admission-link.json")
        if result_sha is not None: need(value["financialResultSha256"] == result_sha, "same_actual_financial_admission_link_required")
        proof = self.c.financial.validate_current(value["financialResultSha256"]) if active else self.c.financial.acknowledgement(value["financialResultSha256"])
        need(proof["validated"] is True and proof["planSha256"] == op["planSha256"], "actual_own_financial_ACK_required")
        return value["financialResultSha256"]

    def process_terminal(self,unit,processes):
        gone(processes)
        if unit == SOURCE:
            need(self.h.source.actor(SOURCE, True) is None, "owned_source_unit_must_be_terminal")
            return source_scan()
        else:
            state = self.h.a.state(self.h.rpc_m, unit)
            group = Path("/sys/fs/cgroup/system.slice") / unit / "cgroup.procs"
            need(state["MainPID"] == state["ControlPID"] == "0" and state["ActiveState"] in {"inactive", "failed"} and
                 (not group.exists() or not group.read_text().split()), "owned_proxy_unit_cgroup_must_be_terminal")
            return None

    def terminal(self, unit, processes, budget_rows=None, retained_current=None):
        scan=self.process_terminal(unit,processes)
        remaining=self.h.source_sessions(None,retained_current)if unit==SOURCE else None
        self.budget_backends_gone(budget_rows)
        return {"terminal": True, "sourceScanSha256": scan, "remainingWriterAttribution": remaining}

    def budget_backends_gone(self, budget_rows):
        if budget_rows:
            rows = self.h.rpc_m.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start::text)),'[]'::jsonb)FROM pg_stat_activity WHERE usesysid=16394")
            need(not any((old["pid"], old["backendStart"]) == (row["pid"], row["backendStart"])
                         for old in budget_rows for row in rows), "actual_owned_paid_budget_backends_must_drain")

    def source_stop(self, mode, partial_ok=False):
        op = self.operation(); tag = "source-" + mode + "-stop"; name = tag + "-intent.json"
        if not self.exists(name):
            native = None
            if mode == "initial":
                self.common(); self.admission(active=True)
                actor = self.h.restore.canonical_actor(self.h.source.actor(SOURCE))
                need(actor == op["source"], "same_initial_source_epoch_before_stop_required")
            else:
                self.verify_published_configuration();self.c.private_current(op)
                intent = self.journal("source-paid-start-intent.json")
                state = self.h.source.state(SOURCE)
                if state["MainPID"] == "0":
                    actor = None
                    need(self.h.source.actor(SOURCE, True) is None, "lost_start_source_must_be_terminal")
                else: actor, _ = self.h.source_epoch(op, intent, "paid", True)
            try: sessions = self.c.source_subset(actor)if mode=="paid"and actor is not None else self.h.source_sessions(actor); observed = True
            except (RuntimeError, OSError):
                need(mode == "paid", "actual_current_initial_source_sessions_required")
                sessions = self.journal("source-paid-started.json")["sourceKernelSessions"] if self.exists("source-paid-started.json") else None
                observed = False
            self.put(name, self.record(mode=mode, actor=actor, sourceKernelSessions=sessions, sessionObservationCurrent=observed,
                     knownProcesses=self.known_source_processes(), terminalScanRequired=actor is None))
            if actor is not None:
                need(self.h.restore.canonical_actor(self.h.source.actor(SOURCE)) == self.h.restore.canonical_actor(actor), "final_source_actor_CAS_after_durable_stop_intent")
                self.h.manager("stop", SOURCE)
        intent = self.journal(name)
        processes = intent["actor"]["processes"] if intent["actor"] is not None else intent["knownProcesses"]
        if mode=="paid"and partial_ok:
            scan=wait_read(lambda:self.process_terminal(SOURCE,processes))
            if not self.exists(tag+"-processes-terminal.json"):
                self.put(tag+"-processes-terminal.json",self.record(sourceProcessesTerminal=True,sourceDrainedQualified=False,sourceScanSha256=scan,intentSha256=self.digest(name)))
            try:
                remaining=self.c.remaining_source_facts();native=self.h.source.native();self.h.r.recovery_floor(op["native"],native)
                terminal={"terminal":True,"sourceScanSha256":scan,"remainingWriterAttribution":remaining}
            except (RuntimeError,OSError,subprocess.SubprocessError):
                return {"sourceProcessesTerminal":True,"sourceDrainedQualified":False,"sourceRestorePending":True}
        else:
            terminal = wait_read(lambda: self.terminal(SOURCE, processes))
            native = self.h.source.native(); self.h.r.recovery_floor(op["native"], native)
        if not self.exists(tag + "ped.json"):
            self.put(tag + "ped.json", self.record(**terminal, native=native, intentSha256=self.digest(name)))
        return self.journal(tag + "ped.json")

    def switch_proxy(self, chain):
        need(chain in self.p.CHAINS, "one_fixed_proxy_chain_required")
        op, _ = self.common(); self.admission(active=True); self.terminal(SOURCE, self.journal("source-initial-stop-intent.json")["actor"]["processes"])
        original = op["originalFreeRoutes"][chain]; tag = chain + "-paid-definition-intent.json"
        if not self.exists(tag):
            need(self.h.free_route(chain) == original, "same_original_free_route_immediately_before_stop")
            self.put(tag, self.record(chain=chain, originalFreeActor=original["actor"], overlay=op["overlays"][chain]))
            need(self.h.free_route(chain) == original, "final_free_route_CAS_after_paid_definition_intent")
            self.admission(active=True); self.h.manager("stop", self.h.proxy_unit(chain))
        if not self.exists(chain + "-paid-definition-installed.json"):
            self.terminal(self.h.proxy_unit(chain), original["actor"]["processes"])
            target = self.h.proxy_drop(chain)
            if not os.path.lexists(target): self.publish(chain, target)
            need({"sha256": sha(self.leaf.protected(target)), "identity": self.leaf.file_identity(target)} == op["overlays"][chain], "exact_paid_proxy_overlay_required")
            self.reload(chain + "-paid")
            self.put(chain + "-paid-definition-installed.json", self.record(chain=chain, definition=op["overlays"][chain]))
        start = chain + "-paid-start-intent.json"
        if not self.exists(start):
            self.admission(active=True); self.common()
            self.terminal(self.h.proxy_unit(chain), original["actor"]["processes"])
            self.put(start, self.record(chain=chain, notBeforeUs=self.m.mono(), admissionLinkSha256=self.digest("financial-admission-link.json")))
            self.terminal(self.h.proxy_unit(chain), original["actor"]["processes"])
            self.admission(active=True); self.h.manager("start", self.h.proxy_unit(chain))
        actor = wait_read(lambda: self.h.paid_route(chain, original, self.journal(start), op["overlays"][chain]))
        environment=self.c.proxy_environment(chain,actor)
        backends = self.h.proxy_sessions(chain, actor)
        need(self.h.paid_route(chain, original, self.journal(start), op["overlays"][chain]) == actor, "same_paid_proxy_after_kernel_session_capture_required")
        if not self.exists(chain + "-paid-started.json"):
            self.put(chain + "-paid-started.json", self.record(chain=chain, actor=actor, ownedBackends=backends,environmentProof=environment, intentSha256=self.digest(start)))
        need(self.journal(chain + "-paid-started.json")["actor"] == actor, "same_actual_paid_proxy_ACK_required")
        return {"chain": chain, "paidProxyAcknowledged": True}

    def start_source(self, mode):
        need(mode in {"paid", "free"}, "fixed_source_routing_mode_required")
        if mode=="free"and(not self.exists("source-initial-stop-intent.json")or self.exists("source-initial-stop-noeffect.json")):
            return self.retained_free()
        op,native=self.common()if mode=="paid"else self.source_context();name = "source-" + mode + "-start-intent.json"
        if mode == "paid":
            stopped=self.journal("source-initial-stopped.json")
            need(stopped["terminal"] is True and stopped["intentSha256"]==self.digest("source-initial-stop-intent.json"),
                 "actual_initial_source_stop_and_drain_ACK_required")
            self.admission(active=True)
            for chain in self.p.CHAINS:
                row = self.journal(chain + "-paid-started.json")
                need(self.h.paid_route(chain, op["originalFreeRoutes"][chain], self.journal(chain + "-paid-start-intent.json"), op["overlays"][chain]) == row["actor"],
                     "all_four_actual_paid_proxy_epochs_required_before_source_start")
            if not os.path.lexists(SOURCE_DROP):
                if not self.exists("source-paid-definition-intent.json"):
                    self.put("source-paid-definition-intent.json", self.record(overlay=op["sourceOverlay"]))
                self.journal("source-paid-definition-intent.json")
                self.publish("source", SOURCE_DROP)
            self.reload("source-paid")
        else:
            self.closed_finance(); self.leaf.validate_paid_quiet(self.digest("paid-quiet.json"), self.admission())
            if os.path.lexists(SOURCE_DROP):
                if not self.exists("source-free-definition-intent.json"): self.put("source-free-definition-intent.json", self.record())
                self.remove_overlay("source", SOURCE_DROP)
            self.reload("source-free")
        if not self.exists(name):
            if mode=="paid":self.terminal(SOURCE,self.known_source_processes())
            else:self.process_terminal(SOURCE,self.known_source_processes());self.c.remaining_source_facts()
            native = self.h.source.native(); self.h.r.recovery_floor(op["native"], native)
            need(str(native["app"]["is_locked"]) == "0" or native["clock"] >= int(native["app"]["heartbeat_at"]) + 25000,
                 "official_Ponder_lock_wait_required_before_once_source_start")
            cache = self.c.cache.validate_restart_capture(self.h.source.query, op["financialPlan"], native)
            need(cache["validated"] is cache["cacheCoverageQualified"] is True and cache["providerCalls"] == cache["databaseWrites"] == 0,
                 "actual_all_filter_cache_resume_within_permit_required")
            peer_frame=self.c.current_peer_frame()if mode=="free"else None
            self.put(name, self.record(mode=mode, notBeforeUs=self.m.mono(), preStartDatabaseClock=native["clock"],peerFrame=peer_frame,
                     predecessorHeartbeat=int(native["app"]["heartbeat_at"]), restartCacheProof=cache,
                     admissionLinkSha256=self.digest("financial-admission-link.json")))
            if mode=="paid":self.terminal(SOURCE,self.known_source_processes());self.common()
            else:
                self.process_terminal(SOURCE,self.known_source_processes());self.c.remaining_source_facts();self.source_context()
                need(self.c.current_peer_frame()==peer_frame,"current_peer_preservation_CAS_before_free_restart_required")
            if mode == "paid": self.admission(active=True)
            else: self.closed_finance()
            self.loaded_source(mode)
            self.h.manager("start", SOURCE)
        actor, native = wait_read(lambda: self.h.source_epoch(op, self.journal(name), mode))
        native_order(native)
        sessions=self.h.source_sessions(actor)if mode=="paid"else self.c.source_subset(actor)
        need(self.h.source_epoch(op, self.journal(name), mode)[0] == actor, "source_epoch_changed_after_positive_kernel_backend_proof")
        if mode=="paid":self.common()
        else:
            self.source_context();need(self.c.current_peer_frame()==self.journal(name)["peerFrame"],"same_current_serving_peer_frame_after_free_restart_required")
            wait_read(self.c.current_pack_ready)
        if mode == "paid": self.admission(active=True)
        else: self.closed_finance()
        value = self.record(mode=mode, source=actor, native=native, sourceKernelSessions=sessions, intentSha256=self.digest(name),
                            financialResultSha256=self.admission(), routingMode=mode)
        target = "source-" + mode + "-started.json"
        if not self.exists(target): self.put(target, value)
        need(self.journal(target)["source"] == actor, "same_acknowledged_current_source_epoch_required")
        result = "result.json" if mode == "paid" else "free-result.json"
        if not self.exists(result): self.put(result, self.record(format=FORMAT + "-result", completed=True, routingMode=mode, currentEpochReceiptSha256=self.digest(target)))
        return {"sourceAcknowledged": True, "routingMode": mode,"chainRouting":{chain:"free_first"for chain in self.p.CHAINS}if mode=="free"else op["chainRouting"],
                "resultSha256": self.digest(result), "managedHandoverAllowed": mode == "free"}

    def known_source_processes(self):
        result = {(p["pid"], p["startTicks"]): p for p in self.operation()["source"]["processes"]}
        for name in ["source-paid-started.json", "source-free-started.json", "source-paid-stop-intent.json", "source-initial-stop-intent.json"]:
            if self.exists(name):
                row = self.journal(name); actor = row.get("source", row.get("actor"))
                if actor is not None:
                    for process in actor["processes"]: result[(process["pid"], process["startTicks"])] = process
        return list(result.values())

    def routes_current(self, mode):
        op=self.operation();result={}
        quiet=self.journal("paid-quiet.json")if mode=="free"else None
        for chain in self.p.CHAINS:
            if mode=="paid":
                actor=self.h.paid_route(chain,op["originalFreeRoutes"][chain],self.journal(chain+"-paid-start-intent.json"),op["overlays"][chain])
                need(actor==self.journal(chain+"-paid-started.json")["actor"],"same_all_four_paid_proxy_epochs_required")
                self.c.proxy_environment(chain,actor)
                result[chain]=actor
            else:
                current=self.h.free_route(chain);record=quiet["routes"][chain]
                need(current=={key:record[key]for key in current}and self.h.a.state(self.h.rpc_m,self.h.proxy_unit(chain))["NRestarts"]=="0",
                     "same_all_four_acknowledged_free_proxy_epochs_and_inputs_required")
                self.c.proxy_environment(chain,current["actor"])
                result[chain]=current["actor"]
        return result

    def retained_initial_actor(self):
        op=self.operation();self.c.private_current(op);self.loaded_source("free")
        raw=self.h.source.actor(SOURCE);actor=self.h.restore.canonical_actor(raw)
        need(actor==op["source"],"exact_original_retained_process_epoch_program_environment_and_privileges_required")
        paths=dict(self.m.NAMESPACE)
        prefix=["/usr/bin/setpriv","--reuid=970","--regid=964","--clear-groups","--inh-caps=-all","--ambient-caps=-all",
                "--bounding-set=-all","--no-new-privs","/usr/bin/env","-i","/usr/bin/python3","-I","-B","-c"]
        actual=json.loads(self.m.command([*prefix,self.m.NAMESPACE_PEER],encoded({"pid":actor["parent"]["pid"],"paths":paths})))
        expected=json.loads(self.m.command([*prefix,self.c.host_module.BACKING_STAT_PEER],encoded(paths)))
        public=json.loads(self.m.command([*prefix,self.h.source.s.PUBLIC_ENV_PEER,str(actor["parent"]["pid"]),json.dumps(self.h.source.s.expected_env())]))
        need(actual==expected and public["presentKeysMatch"]is True and public["environmentSha256"]==actor["parent"]["environmentSha256"]and
             self.h.restore.canonical_actor(self.h.source.actor(SOURCE))==actor,"retained_original_six_mounts_public_environment_and_final_PID_CAS_required")
        native=self.h.source.native();self.h.r.recovery_floor(op["native"],native);native_order(native);self.h.r.heartbeat(native)
        return actor,native

    def retained_free(self):
        op,native=self.source_context();self.closed_finance();self.routes_current("free");frame=self.c.current_peer_frame()
        need((not self.exists("source-initial-stop-intent.json")or self.exists("source-initial-stop-noeffect.json"))and not self.exists("source-paid-start-intent.json")and not os.path.lexists(SOURCE_DROP),
             "retained_initial_source_must_never_have_been_stopped_or_paid")
        if self.exists("source-initial-stop-noeffect.json"):
            proof=self.journal("source-initial-stop-noeffect.json")
            need(proof["stopIntentSha256"]==self.digest("source-initial-stop-intent.json")and proof["source"]==op["source"]and
                 proof["originalEpochStillActive"]is True and proof["newSourceStartClaimed"]is False,"actual_retained_original_epoch_no_stop_effect_proof_required")
        # Own original-epoch proof uses cap-dropped metadata peers, not the
        # predecessor's root-only backing stat or a fictitious new start.
        actor,native=self.retained_initial_actor()
        need(actor==op["source"],"exact_unchanged_initial_free_source_epoch_required")
        self.h.r.heartbeat(native);sessions=self.c.source_subset(actor)
        need(self.h.restore.canonical_actor(self.h.source.actor(SOURCE))==actor,"retained_initial_free_source_final_CAS_required")
        wait_read(self.c.current_pack_ready);need(self.c.current_peer_frame()==frame,"same_current_peer_frame_around_retained_free_acknowledgement_required")
        name="source-free-started.json"
        if not self.exists(name):self.put(name,self.record(mode="free",source=actor,native=native,sourceKernelSessions=sessions,
            retainedInitialActor=True,newSourceStartClaimed=False,initialOperationSourceSha256=sha(encoded(op["source"])),financialResultSha256=self.admission(),peerFrame=frame))
        if not self.exists("free-result.json"):self.put("free-result.json",self.record(format=FORMAT+"-result",completed=True,routingMode="free",currentEpochReceiptSha256=self.digest(name)))
        return {"sourceAcknowledged":True,"routingMode":"free","retainedInitialActor":True,"newSourceStartClaimed":False,
                "resultSha256":self.digest("free-result.json"),"managedHandoverAllowed":True}

    def remove_overlay(self, name, target):
        op = self.operation(); destination = HOLD / (name + ".removed.conf")
        journal = name + "-overlay-remove-intent.json"
        if not self.exists(journal): self.put(journal,self.record(overlay=op["overlays"][name]))
        need(self.journal(journal)["overlay"]==op["overlays"][name],"same_owned_overlay_remove_intent_required")
        if not os.path.lexists(target):
            need({"sha256": sha(self.leaf.protected(destination)), "identity": self.leaf.file_identity(destination)} == op["overlays"][name], "same_already_removed_overlay_inode_required")
            return
        need({"sha256": sha(self.leaf.protected(target)), "identity": self.leaf.file_identity(target)} == op["overlays"][name], "only_own_exact_overlay_may_be_removed")
        self.p.move_owned(target, destination, {"sha256": op["overlays"][name]["sha256"], "identity": self.p.identity(target)})

    def stop_paid_proxies(self):
        op = self.operation()
        for chain in self.p.CHAINS:
            definition = chain + "-paid-definition-intent.json"
            if not self.exists(definition): continue
            if self.exists(chain + "-free-started.json"):
                self.restored_proxy(chain)
                continue
            name = chain + "-paid-stop-intent.json"; attempted = self.exists(chain + "-paid-start-intent.json")
            if not self.exists(name):
                actor = None; processes = []; backends = []
                original_free=None
                state = self.h.a.state(self.h.rpc_m, self.h.proxy_unit(chain))
                if attempted and state["MainPID"] != "0":
                    actor = self.h.paid_route(chain, op["originalFreeRoutes"][chain], self.journal(chain + "-paid-start-intent.json"), op["overlays"][chain], True)
                    processes = actor["processes"]
                    try: backends = self.h.proxy_sessions(chain, actor)
                    except (RuntimeError, OSError):
                        if self.exists(chain + "-paid-started.json"): backends = self.journal(chain + "-paid-started.json")["ownedBackends"]
                elif not attempted and state["MainPID"]!="0":
                    original_free=self.h.free_route(chain)
                    need(original_free==op["originalFreeRoutes"][chain]and not os.path.lexists(self.h.proxy_drop(chain)),
                         "only_exact_idle_original_free_actor_may_complete_prepared_cleanup")
                self.put(name, self.record(chain=chain, processes=processes, ownedBackends=backends, startNeverAttempted=not attempted,
                    terminalScanRequired=attempted and not processes, paidDefinitionIntentSha256=self.digest(definition),
                    originalFreeCleanupActor=original_free,
                    paidStartIntentSha256=self.digest(chain + "-paid-start-intent.json") if attempted else None))
                if actor is not None:
                    need(self.h.paid_route(chain, op["originalFreeRoutes"][chain], self.journal(chain + "-paid-start-intent.json"), op["overlays"][chain], True) == actor,
                         "final_paid_proxy_stop_actor_CAS_after_intent")
                    self.h.manager("stop", self.h.proxy_unit(chain))
                elif original_free is not None:
                    # This explicit CLOSE action owns a fresh one-stop intent
                    # for the positively observed idle original free epoch. It
                    # never reissues the earlier definition-phase intent.
                    need(self.h.free_route(chain)==original_free,"original_free_cleanup_final_actor_CAS_after_new_stop_intent")
                    self.h.manager("stop",self.h.proxy_unit(chain))
                else:
                    self.terminal(self.h.proxy_unit(chain), [])
        # All paid units are stopped before a missing-start-ACK full UID scan.
        self.leaf.assert_no_paid_proxy_processes()
        for chain in self.p.CHAINS:
            name = chain + "-paid-stop-intent.json"
            if not self.exists(name): continue
            if self.exists(chain + "-free-started.json"):
                self.restored_proxy(chain)
                continue
            intent = self.journal(name)
            terminal = wait_read(lambda: self.terminal(self.h.proxy_unit(chain), intent["processes"], intent["ownedBackends"]))
            if not self.exists(chain + "-paid-stopped.json"):
                self.put(chain + "-paid-stopped.json", self.record(chain=chain, terminal=True, intentSha256=self.digest(name)))

    def restored_proxy(self, chain):
        # A completed close owns a live FREE epoch. Repeated/UTC close must
        # prove its earlier paid epoch gone without demanding this unit stop.
        op = self.operation(); original = op["originalFreeRoutes"][chain]
        route = self.h.free_route(chain)
        result = self.journal(chain + "-free-started.json")
        restored = self.journal(chain + "-free-definition-restored.json")
        stopped = self.journal(chain + "-paid-stopped.json")
        intent = self.journal(chain + "-paid-stop-intent.json")
        start = chain + "-free-start-intent.json"
        self.journal(start); self.journal(chain + "-paid-definition-intent.json")
        attempted = self.exists(chain + "-paid-start-intent.json")
        if attempted: self.journal(chain + "-paid-start-intent.json")
        row = {"mode": "paid-stopped" if attempted else "prepared-stopped", **route,
               "paidStopResultSha256": self.digest(chain + "-paid-stopped.json"),
               "freeStartIntentSha256": self.digest(start), "freeStartResultSha256": self.digest(chain + "-free-started.json")}
        need(result["chain"] == restored["chain"] == stopped["chain"] == intent["chain"] == chain and
             stopped["intentSha256"] == self.digest(chain + "-paid-stop-intent.json") and
             restored["definitions"] == original["definitions"] and
             {key: route[key] for key in ["definitions", "environmentFiles", "unitSecurity", "activation"]} ==
             {key: original[key] for key in ["definitions", "environmentFiles", "unitSecurity", "activation"]} and
             result["actor"] == route["actor"] and route["actor"]["invocation"] != original["actor"]["invocation"] and
             not os.path.lexists(self.h.proxy_drop(chain)) and
             self.h.a.state(self.h.rpc_m, self.h.proxy_unit(chain))["NRestarts"] == "0",
             "exact_acknowledged_restored_free_epoch_original_inputs_and_boot_required")
        backends = self.leaf.stopped_route(chain, row, self.record(admissionLinkSha256=self.digest("financial-admission-link.json")), self.m)
        need(backends == intent["ownedBackends"], "same_recorded_paid_backend_epochs_required")
        gone(original["actor"]["processes"]); gone(intent["processes"])
        self.budget_backends_gone(backends)
        self.leaf.quiet_metrics(self.h.PORTS[chain] if hasattr(self.h, "PORTS") else {"ethereum":19221,"base":19222,"polygon":19223,"bnb":19224}[chain])
        need(self.c.proxy_environment(chain, route["actor"]) == result["environmentProof"] and
             self.h.free_route(chain) == route and
             self.h.a.state(self.h.rpc_m, self.h.proxy_unit(chain))["NRestarts"] == "0",
             "restored_free_full_environment_and_final_actor_CAS_required")
        return row

    def restore_proxy(self, chain):
        op = self.operation(); original = op["originalFreeRoutes"][chain]
        if not self.exists(chain + "-paid-definition-intent.json"):
            need(self.h.free_route(chain) == original, "never_paid_route_must_preserve_original_actor_inputs_boot")
            return {"mode": "never-paid", **original}
        if self.exists(chain + "-free-started.json"):
            return self.restored_proxy(chain)
        self.journal(chain + "-paid-stopped.json")
        gone(original["actor"]["processes"])
        target = self.h.proxy_drop(chain)
        if os.path.lexists(target): self.remove_overlay(chain, target)
        # An interruption before publication leaves the original prepared file.
        elif os.path.lexists(HOLD / (chain + ".conf")):
            need(not self.exists(chain + "-paid-definition-installed.json"), "installed_overlay_must_not_disappear")
        self.reload(chain + "-free")
        if not self.exists(chain + "-free-definition-restored.json"):
            self.put(chain + "-free-definition-restored.json", self.record(chain=chain, definitions=original["definitions"]))
        start = chain + "-free-start-intent.json"
        if not self.exists(start):
            self.terminal(self.h.proxy_unit(chain), self.journal(chain + "-paid-stop-intent.json")["processes"])
            self.put(start, self.record(chain=chain, notBeforeUs=self.m.mono()))
            self.terminal(self.h.proxy_unit(chain), self.journal(chain + "-paid-stop-intent.json")["processes"])
            self.h.manager("start", self.h.proxy_unit(chain))
        route = wait_read(lambda: self.h.free_route(chain)); intent = self.journal(start)
        need(intent["notBeforeUs"] <= route["actor"]["startMonotonicMicroseconds"] <= intent["notBeforeUs"] + 130000000 and
             route["actor"]["invocation"] != original["actor"]["invocation"] and
             self.h.a.state(self.h.rpc_m,self.h.proxy_unit(chain))["NRestarts"]=="0"and
             {k: route[k] for k in ["definitions", "environmentFiles", "unitSecurity", "activation"]} ==
             {k: original[k] for k in ["definitions", "environmentFiles", "unitSecurity", "activation"]}, "actual_owned_free_proxy_epoch_and_original_inputs_required")
        self.leaf.quiet_metrics(self.h.PORTS[chain] if hasattr(self.h, "PORTS") else {"ethereum":19221,"base":19222,"polygon":19223,"bnb":19224}[chain])
        environment=self.c.proxy_environment(chain,route["actor"])
        if not self.exists(chain + "-free-started.json"):
            self.put(chain + "-free-started.json", self.record(chain=chain, actor=route["actor"],environmentProof=environment, intentSha256=self.digest(start)))
        need(self.journal(chain + "-free-started.json")["actor"] == route["actor"], "same_owned_free_proxy_ACK_required")
        return {"mode": "paid-stopped" if self.exists(chain + "-paid-start-intent.json") else "prepared-stopped", **route,
                "paidStopResultSha256": self.digest(chain + "-paid-stopped.json"), "freeStartIntentSha256": self.digest(start),
                "freeStartResultSha256": self.digest(chain + "-free-started.json")}

    def closed_finance(self):
        result_sha = self.admission(); owner = self.c.fowner
        closed = owner.close_result()
        current = owner.h.snapshot()
        target = owner.receipt("utc-result.json", "utc")["after"] if (FINANCIAL_BASE / "utc-result.json").exists() else closed["after"]
        owner.m.validate_closed(current, target, owner.prepared()["plan"])
        return {"validated": True, "financialResultSha256": result_sha, "closeResultSha256": sha(self.m.protected(FINANCIAL_BASE / "close-result.json")), "currentPaidAuthorityQualified": False}

    def no_admission(self):
        owner = self.c.fowner; row = owner.prepared()
        status = "no-durable-commit-intent"
        if (FINANCIAL_BASE / "admission-commit-intent.json").exists():
            # Read-only XID reconciliation can recover a committed expired ACK.
            intent=owner.intent("admission-commit-intent.json");status=owner.xid_status(intent["xid"])
            need(status in {"committed","aborted"},"actual_financial_XID_outcome_must_be_known_before_deadline_recovery")
            if status=="committed":
                if not (FINANCIAL_BASE / "result.json").exists(): owner.acknowledge("admission-commit-intent.json", "admit", True)
                return False
        # Without a durable intent this pinned financial producer cannot have
        # issued COMMIT. The financial lock excludes an active protocol client;
        # the actual backend check excludes an abandoned still-open transaction.
        current = owner.h.snapshot(); owner.m.baseline(current, owner.h.profile)
        active = owner.h.query("SELECT jsonb_build_object('otherFinancialClients',(SELECT count(*)FROM pg_stat_activity WHERE datname='yunipals_market_production'AND application_name='ypal_alchemy_catchup_financial_v1'AND pid<>pg_backend_pid()))")
        need(active == {"otherFinancialClients": 0}, "no_unresolved_financial_SQL_client_required")
        need(owner.m.static(current) == owner.m.static(row["before"]) and
             not any(p["permitId"] in {x["permitId"] for x in row["plan"]["permits"]} for p in current["permits"]), "actual_original_budget_and_absent_owned_permits_required_for_deadline_noop")
        return {"noFinancialAdmissionOccurred":True,"transactionStatus":status,"actualOriginalCatalogSha256":owner.m.digest(owner.m.static(current)),
                "ownedPermitRowsPresent":False,"otherFinancialClients":0,"databaseWrites":0,"serviceActions":0}

    def close(self, utc=False, resume=False):
        op = self.operation()
        if not self.exists("financial-admission-link.json"):
            with self.c.financial.financial_lock(): absent = self.no_admission()
            if absent:
                self.common();name="utc-no-admission.json"if utc else"close-no-admission.json"
                if not self.exists(name):self.put(name,self.record(**absent))
                return {"closed": False, "noFinancialAdmissionOccurred": True,"noAdmissionReceiptSha256":self.digest(name), "databaseWrites": 0, "serviceActions": 0}
            self.admission(sha(self.m.protected(FINANCIAL_BASE / "result.json")))
        result_sha = self.admission()
        # Paid source failure cannot block its own stop. A missing start intent
        # means the initial source is either untouched or already owned-terminal.
        free_started = self.exists("source-free-start-intent.json") or self.exists("free-result.json")
        restore_pending=False
        if self.exists("source-paid-start-intent.json") and not free_started:
            restored=self.source_stop("paid",partial_ok=True);restore_pending=restored.get("sourceDrainedQualified")is False
        elif self.exists("source-initial-stop-intent.json") and not free_started:
            state=self.h.source.state(SOURCE)
            if state["MainPID"]!="0":
                actor=self.h.restore.canonical_actor(self.h.source.actor(SOURCE))
                need(actor==op["source"]and not os.path.lexists(SOURCE_DROP)and
                     not any(self.exists(c+"-paid-start-intent.json")for c in self.p.CHAINS),
                     "only_exact_still_running_original_free_source_can_prove_no_stop_effect")
                if not self.exists("source-initial-stop-noeffect.json"):
                    self.put("source-initial-stop-noeffect.json",self.record(source=actor,stopIntentSha256=self.digest("source-initial-stop-intent.json"),
                        originalEpochStillActive=True,newSourceStartClaimed=False))
            else:self.terminal(SOURCE, self.known_source_processes())
        self.stop_paid_proxies()
        routes = {chain: self.restore_proxy(chain) for chain in self.p.CHAINS}
        value = self.record(format=FORMAT + "-paid-quiet", financialResultSha256=result_sha,
                            admissionLinkSha256=self.digest("financial-admission-link.json"), routes=routes)
        if not self.exists("paid-quiet.json"): self.put("paid-quiet.json", value)
        need(self.get("paid-quiet.json") == value, "same_actual_all_four_paid_quiet_receipt_required")
        quiet_sha = self.digest("paid-quiet.json"); self.leaf.validate_paid_quiet(quiet_sha, result_sha)
        with self.c.financial.financial_lock():
            if not (FINANCIAL_BASE / "close-result.json").exists():
                if (FINANCIAL_BASE / "close-commit-intent.json").exists(): self.c.fowner.acknowledge("close-commit-intent.json", "close", True)
                else: self.c.fowner.transaction("close", True, quiet_sha=quiet_sha, result_sha=result_sha)
        self.closed_finance()
        if utc:
            with self.c.financial.financial_lock():
                if not (FINANCIAL_BASE / "utc-result.json").exists():
                    if (FINANCIAL_BASE / "utc-commit-intent.json").exists(): self.c.fowner.acknowledge("utc-commit-intent.json", "utc", True)
                    else: self.c.fowner.transaction("utc", True, quiet_sha=quiet_sha, result_sha=result_sha)
        if resume and restore_pending:
            return {"financialClosed":True,"sourceRestorePending":True,"sourceDrainedQualified":False,"paidQuietSha256":quiet_sha}
        if resume and self.exists("source-initial-stop-intent.json") and not self.exists("source-initial-stop-noeffect.json")and not self.exists("free-result.json"):
            return self.start_source("free")
        if resume and(not self.exists("source-initial-stop-intent.json")or self.exists("source-initial-stop-noeffect.json"))and not self.exists("free-result.json"):
            return self.retained_free()
        required=self.exists("source-initial-stop-intent.json")and not self.exists("free-result.json")
        return {"closed": True,"financialClosed":True, "UTCOriginalPolicyRestored": utc, "sourceRestarted": False,
                "sourceRestorePending":bool(restore_pending or required),"sourceDrainedQualified":not restore_pending and self.exists("source-paid-stopped.json"),
                "paidQuietSha256": quiet_sha}


def load_owner(manifest_sha, input_sha): return Owner(Context(manifest_sha, input_sha))


def validate_current_source(result_sha, manifest_sha, input_sha, retained_current=None, inverse=False):
    owner = load_owner(manifest_sha, input_sha); op = owner.operation(); c = owner.c
    candidates = ["free-result.json", "result.json"] + (["source-paid-stopped.json", "source-initial-stopped.json"] if inverse else [])
    matching = [name for name in candidates if owner.exists(name) and owner.digest(name) == result_sha]
    need(len(matching) == 1, "one_actual_fixed_source_result_or_inverse_terminal_receipt_required")
    result_file = matching[0]
    result = owner.m.document(BASE / result_file, result_sha)
    terminal_receipt = result_file.endswith("stopped.json")
    need((not terminal_receipt and result["format"] == FORMAT + "-result" and result["completed"] is True) or
         (inverse and terminal_receipt and result["terminal"] is True), "actual_acknowledged_source_result_required")
    owner.journal(result_file); mode = "paid" if terminal_receipt else result["routingMode"]
    epoch_name = result_file if terminal_receipt else "source-" + mode + "-started.json"
    epoch = owner.journal(epoch_name)
    if not terminal_receipt: need(result["currentEpochReceiptSha256"] == owner.digest(epoch_name), "actual_current_source_epoch_receipt_required")
    c.immutable(op); owner.verify_published_configuration()
    if inverse:
        need(terminal_receipt or owner.exists("source-" + mode + "-stop-intent.json"), "explicit_owned_source_terminal_inverse_prefix_required")
        terminal = owner.terminal(SOURCE, owner.known_source_processes(), retained_current=retained_current)
        actor = None; native = owner.h.source.native()
        owner.h.r.recovery_floor(op["native"], native); sessions = terminal["remainingWriterAttribution"]
        owner.loaded_source("paid"if os.path.lexists(SOURCE_DROP)else"free")
    else:
        if epoch.get("retainedInitialActor")is True:
            need(mode=="free"and epoch["newSourceStartClaimed"]is False and (not owner.exists("source-initial-stop-intent.json")or owner.exists("source-initial-stop-noeffect.json"))and
                 not owner.exists("source-paid-start-intent.json")and not os.path.lexists(SOURCE_DROP),"actual_never_stopped_never_paid_retained_initial_source_required")
            if owner.exists("source-initial-stop-noeffect.json"):
                no_effect=owner.journal("source-initial-stop-noeffect.json")
                need(no_effect["stopIntentSha256"]==owner.digest("source-initial-stop-intent.json")and no_effect["source"]==op["source"]and
                     no_effect["originalEpochStillActive"]is True,"actual_original_source_no_stop_effect_epoch_required")
            actor,native=owner.retained_initial_actor()
            need(actor==op["source"],"same_actual_retained_initial_source_epoch_required")
            owner.h.r.heartbeat(native);owner.h.r.recovery_floor(op["native"],native)
        else:
            intent = owner.journal("source-" + mode + "-start-intent.json")
            actor, native = owner.h.source_epoch(op, intent, mode)
        need(actor == epoch["source"], "same_acknowledged_source_process_epoch_required")
        routes=owner.routes_current(mode)
        sessions = owner.h.source_sessions(actor, retained_current)
        if epoch.get("retainedInitialActor")is True:
            need(owner.h.restore.canonical_actor(owner.h.source.actor(SOURCE))==actor,"same_current_initial_source_after_sessions_CAS_required")
        else:need(owner.h.source_epoch(op, intent, mode)[0] == actor, "final_current_source_after_sessions_CAS_required")
        need(owner.routes_current(mode)==routes,"final_all_four_routing_epochs_after_source_sessions_CAS_required")
    if mode == "paid":
        owner.admission(active=not inverse); closed = False
    else:
        owner.closed_finance(); closed = True
    native_order(native)
    stable = {"format": FORMAT + "-source-binding", "operatorSha256": owner.producer(), "operationSha256": owner.digest("operation.json"),
              "manifestSha256":manifest_sha,"inputSha256":input_sha,
              "receiptSha256": result_sha, "currentEpochReceiptSha256": owner.digest(epoch_name), "routingMode": mode,
              "profileId": owner.p.PROFILE, "financialResultSha256": owner.admission(), "financialClosed": closed,
              "chainRouting":{chain:"free_first"for chain in owner.p.CHAINS}if mode=="free"else op["chainRouting"],
              "source": actor, "nativeIdentity": {k: native[k] for k in ["schemaOid", "tables", "cache"]},
              "sourceBoot": op["sourceBoot"], "inputs": op["inputs"]}
    return {"format": FORMAT + "-source-current", "validated": True, "sourceState": "owned-terminal" if inverse else "acknowledged-active",
            "terminalInverseOnly": bool(inverse), "receiptSha256": result_sha, "operatorSha256": owner.producer(),
            "manifestSha256":manifest_sha,"inputSha256":input_sha,
            "routingMode":mode,"chainRouting":stable["chainRouting"],
            "operationSha256": owner.digest("operation.json"), "currentEpochReceiptSha256": owner.digest(epoch_name),
            "sourceRelease": owner.c.fowner.m.RELEASE, "manifestHash": owner.c.fowner.m.MANIFEST, "schema": "unified_ypal_20261023_v1", "schemaOid": native["schemaOid"],
            "buildId": native["app"]["build_id"], "nativeTables": native["tables"], "sourceKernelActors": {} if inverse else {SOURCE: actor},
            "sourceKernelSessions": sessions, "currentWriterQualified": not inverse, "sourceReadinessQualified": not inverse and str(native["app"]["is_ready"]) == "1",
            "currentCanonicalCoverageQualified": False, "financialAuthorityQualified": False, "managedHandoverAllowed": not inverse and mode == "free" and closed,
            "binding": stable, "bindingSha256": sha(encoded(stable)), "observation": {"native": native}, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-sha"); parser.add_argument("--input-sha")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--review", action="store_true"); group.add_argument("--prepare")
    group.add_argument("--install-deadlines", action="store_true"); group.add_argument("--link-financial")
    group.add_argument("--stop-source", action="store_true"); group.add_argument("--switch-proxy", choices=["ethereum", "base", "polygon", "bnb"])
    group.add_argument("--start-paid-source", action="store_true"); group.add_argument("--resume-free-source", action="store_true")
    group.add_argument("--close", action="store_true"); group.add_argument("--utc", action="store_true")
    group.add_argument("--deadline-close"); group.add_argument("--deadline-utc"); group.add_argument("--complete-config-reload")
    args = parser.parse_args()
    actions = [args.review, args.prepare, args.install_deadlines, args.link_financial, args.stop_source, args.switch_proxy,
               args.start_paid_source, args.resume_free_source, args.close, args.utc, args.deadline_close, args.deadline_utc, args.complete_config_reload]
    if not any(actions):
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "financialAdmitted": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_source_lifecycle_host_required")
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_lifecycle_unknown_outcome_inspect_no_retry")); signal.alarm(850)
    if args.deadline_close or args.deadline_utc:
        # Literal timer arguments contain only the exact plan; actual immutable
        # operation determines its reviewed source/input hashes.
        host_path, host_sha = PINS["host"]
        import types
        raw = (OPS / host_path).read_bytes(); need(sha(raw) == host_sha, "exact_deadline_bootstrap_host_required")
        h = types.ModuleType("deadline_bootstrap"); h.__file__ = str(OPS / host_path); exec(compile(raw, h.__file__, "exec"), h.__dict__)
        leaf = h.load(OPS / PINS["leaf"][0], PINS["leaf"][1]); op = json.loads(leaf.protected(BASE / "operation.json"))
        need(op["planSha256"] == (args.deadline_close or args.deadline_utc), "literal_actual_deadline_plan_required")
        args.manifest_sha, args.input_sha = op["manifestSha256"], op["inputSha256"]
    owner = load_owner(args.manifest_sha, args.input_sha)
    with owner.m.lock():
        if args.review:
            _, review = owner.review(); value = {"reviewHash": review, "serviceActions": 0, "providerCalls": 0}
        elif args.prepare: value = owner.prepare(args.prepare)
        elif args.install_deadlines: value = owner.install_deadlines()
        elif args.link_financial: value = {"financialResultSha256": owner.admission(args.link_financial)}
        elif args.stop_source: owner.admission(active=True); value = owner.source_stop("initial")
        elif args.switch_proxy: value = owner.switch_proxy(args.switch_proxy)
        elif args.start_paid_source: value = owner.start_source("paid")
        elif args.resume_free_source: value = owner.start_source("free")
        elif args.complete_config_reload: value = owner.complete_reload(args.complete_config_reload)
        else: value = owner.close(utc=bool(args.utc or args.deadline_utc), resume=bool(args.deadline_close))
    # No process argv, private file paths/values or raw catalog escapes stdout.
    if value.get("terminal"):
        value = {"sourceTerminal": True, "receiptRecorded": True}
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False, "fixedCode": str(error) if type(error) is RuntimeError and
              re.fullmatch("[A-Za-z0-9_]+", str(error)) else type(error).__name__, "automaticRetryAllowed": False})); raise SystemExit(1)
