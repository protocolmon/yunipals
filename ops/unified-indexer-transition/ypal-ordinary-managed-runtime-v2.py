#!/usr/bin/env python3
"""Observe an actual ordinary-paid managed EVM/Solana epoch, without starting it.

This foundation has no service/financial/consumer mutation CLI. It authenticates
real ordinary ancestry, separate current financial authority, the exact new
managed tree and a subsequent heartbeat. Installation/retirement, scheduled
Solana acceptance and supervised restart remain separate lifecycle proofs.
"""
import argparse
import ast
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types

FORMAT = "yunipals-ordinary-managed-runtime-v2"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
STAGE = OPS / "ypal-ordinary-managed-indexer-v1"
BASE = Path("/var/backups/yunipals-ordinary-managed-runtime-v2-20261025")
INPUT = Path("/var/backups/yunipals-ordinary-managed-runtime-input-v2-20261025/input.json")
PARENT = "yunipals-indexer.service"
SOURCE = "yunipals-ypal-combined-source.service"
NODE = "/opt/node-v24.18.1/bin/node"
NODE_SHA = "f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a"
PROJECT = "/var/lib/yunipals-booster-launch/20261022-source008/apps/yunipals-indexer"
SOLANA_PROJECT = "/var/lib/yunipals-unified-shadow/20261020-008028af-a/apps/yunipals-indexer"
ORDINARY_ENV = OPS / "ypal-alchemy-primary-queue-v1/source.ordinary.public.env"
PUBLIC = {
    "core.mjs": "d3e849e2f05a7c33c7164d649c6f1db28f6a70202b3308dada3989be634bc321",
    "launcher.mjs": "a4278c446a989aad7edcea4385dbf0031ed02ec1be117222195275aba7be5bfe",
    "service.public.env": "ea24aab003f1970e29f7a54d291665096c982efe3d4bc69e876b67edb91aacc2",
    "yunipals-indexer.service.example": "92adf17c97251ecf42e0f8b8b9d85a79f41b1d99e40462738aba2876d9ae3864"
}
CODE = {
    "ypal-managed-handover-v1.py": "f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea",
    "ypal-alchemy-ordinary-runtime-v1.py": "3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5",
    "ypal-alchemy-ordinary-financial-v1.py": "89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0",
    "ypal-alchemy-ordinary-consumer-context-v1.py": "5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986",
    "ypal-ordinary-observer-retained-prefix-v1.py": "451f1abe40d4bfba0d561e20f64c3e36c1c050ecbbea3415ecf318b00333e32e",
    "ypal-alchemy-source-switch-v1.host.py": "3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02"
}
HOST_METHODS = {"state", "definitions", "boot_link", "activation", "peer", "actor", "managed_settings", "retained_solana_auth", "peer_query", "sql_solana"}
HELPERS = {"need", "encoded", "sha", "pin", "boot", "mono", "identity", "protected", "document", "command", "link_record", "check_solana"}
READABLE_PEER = r'''import hashlib,json,os,pathlib,stat,sys
assert os.getuid()==os.geteuid()==970 and os.getgid()==os.getegid()==964 and os.getgroups()==[]
s=dict(line.split(':',1)for line in pathlib.Path('/proc/self/status').read_text().splitlines()if':'in line)
assert s['NoNewPrivs'].strip()=='1' and all(int(s[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])
paths=json.load(sys.stdin);assert isinstance(paths,list)and len(paths)==4
out={}
for path in paths:
 p=pathlib.Path(path);before=p.stat();assert stat.S_ISREG(before.st_mode)and before.st_size<=200000
 raw=p.read_bytes();after=p.stat()
 key=lambda row:(row.st_dev,row.st_ino,row.st_size,row.st_mtime_ns,row.st_ctime_ns)
 assert len(raw)==before.st_size and key(before)==key(after)
 out[path]=hashlib.sha256(raw).hexdigest()
print(json.dumps(out,sort_keys=True))
'''


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
def own_sha(): return sha(Path(__file__).read_bytes())
def pin(value): return isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value) is not None and value != "0" * 64


def protected(path, expected=None, maximum=2000000):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "absolute_managed_foundation_input_required")
    for item in [*path.parents, path]:
        st = item.lstat()
        need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
             "root_owned_nonwritable_managed_foundation_input_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        identity = lambda row: tuple(getattr(row, k) for k in ["st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"])
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
             "bounded_single_link_managed_foundation_input_required")
        raw = os.read(fd, maximum + 1)
        need(len(raw) == before.st_size and identity(before) == identity(os.fstat(fd)) == identity(path.lstat()) and
             (expected is None or pin(expected) and sha(raw) == expected), "same_exact_managed_foundation_bytes_required")
        return raw
    finally: os.close(fd)


def module(name):
    raw = protected(OPS / name, CODE[name]); value = types.ModuleType("managed_foundation_" + name)
    value.__file__ = str(OPS / name); exec(compile(raw, value.__file__, "exec"), value.__dict__)
    protected(OPS / name, CODE[name]); return value


def qualify_public_readability(command):
    """Fixed four public files only; no constructor, application import or DB."""
    paths = {str(STAGE / name): digest for name, digest in PUBLIC.items()}
    args = ["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all",
            "--bounding-set=-all", "--no-new-privs", "/usr/bin/env", "-i", "/usr/bin/python3", "-I", "-B", "-c", READABLE_PEER]
    actual = json.loads(command(args, encoded(list(paths)), timeout=8))
    need(actual == paths, "actual_UID970_cap0_must_read_all_four_exact_public_runtime_files")
    return {"format": FORMAT + "-public-readability", "qualified": True, "files": 4,
            "publicRuntimeSha256": sha(encoded(paths)), "uid": 970, "gid": 964,
            "sourceActorQualified": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}


def primitives(raw, filename):
    """New finite readonly namespace; the old Host constructor is absent."""
    need(sha(raw) == CODE["ypal-managed-handover-v1.py"], "exact_f5_readonly_primitives_required")
    tree = ast.parse(raw); body = []; changed = {"stage": 0, "transport": 0}; methods = set(); helpers = set()
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.Assign)):
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "STAGE":
                node.value = ast.parse("Path(" + repr(str(STAGE)) + ")", mode="eval").body; changed["stage"] += 1
            if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "NAMESPACE":
                class Transport(ast.NodeTransformer):
                    def visit_Constant(self, value):
                        if value.value == "ypal-combined-source-v1-stage/rpc-preflight.ts":
                            changed["transport"] += 1
                            return ast.copy_location(ast.Constant("ypal-rpc-deadline-host-build-v1/rpc-preflight.ts"), value)
                        return value
                node = Transport().visit(node)
            body.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in HELPERS:
            helpers.add(node.name); body.append(node)
        elif isinstance(node, ast.ClassDef) and node.name == "Host":
            node.name = "ReadonlyHost"
            node.body = [method for method in node.body if isinstance(method, ast.FunctionDef) and method.name in HOST_METHODS]
            methods = {method.name for method in node.body}; body.append(node)
    need(changed == {"stage": 1, "transport": 1} and methods == HOST_METHODS and helpers == HELPERS,
         "only_exact_readonly_primitive_methods_new_public_context_and690_transport_required")
    value = types.ModuleType("ordinary_managed_readonly_primitives"); value.__file__ = str(filename)
    exec(compile(ast.fix_missing_locations(ast.Module(body=body, type_ignores=[])), str(filename), "exec"), value.__dict__)
    return value


def canonical_actor(actor):
    value = copy.deepcopy(actor)
    # Typed ExecStart and literal live argv are checked separately every time.
    # The systemctl presentation contains volatile last-execution status.
    value["unit"].pop("ExecStart", None)
    return value


def solana_backend_primitive(raw, filename):
    """Same positive kernel join, explicitly narrowed to shared Solana role.

    Three audited expressions change: fixed role16388, fixed source DB17584,
    and the original managed-owner bound of64 rows. Source/budget helpers stay
    unchanged and this namespace cannot grant either financial authority.
    """
    need(sha(raw) == CODE["ypal-alchemy-source-switch-v1.host.py"], "exact_kernel_join_source_required")
    tree = ast.parse(raw); functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "kernel_backends"]
    need(len(functions) == 1, "one_exact_positive_kernel_join_required")
    changes = {"role": 0, "database": 0, "bound": 0}
    class Solana(ast.NodeTransformer):
        def visit_Compare(self, node):
            if ast.unparse(node) == "role in {73004621, 16394}":
                changes["role"] += 1
                return ast.copy_location(ast.parse("role == 16388", mode="eval").body, node)
            return self.generic_visit(node)
        def visit_IfExp(self, node):
            text = ast.unparse(node)
            if text == "' AND datid=17584' if role == 73004621 else ''":
                changes["database"] += 1; return ast.copy_location(ast.Constant(" AND datid=17584"), node)
            if text == "32 if role == 73004621 else 16":
                changes["bound"] += 1; return ast.copy_location(ast.Constant(64), node)
            return self.generic_visit(node)
    function = Solana().visit(functions[0]); function.name = "solana_backends"
    need(changes == {"role": 1, "database": 1, "bound": 1}, "only_three_explicit_Solana_kernel_join_seams_required")
    scope = {"Path": Path, "need": need}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[function], type_ignores=[])), str(filename), "exec"), scope)
    return scope["solana_backends"]


def source_arguments(env_files):
    need(len(env_files) == 4 and len(set(env_files)) == 4 and env_files[-1] == str(ORDINARY_ENV),
         "exact_four_ordered_managed_Node_environment_files_required")
    return [NODE, "--max-old-space-size=4096", *["--env-file=" + path for path in env_files],
            "node_modules/ponder/dist/esm/bin/ponder.js", "start", "--schema", "unified_ypal_20261023_v1", "--hostname", "127.0.0.1", "--port", "9028"]


def validate_tree(actor, evm_files, solana_file, predecessor):
    parent = actor["parent"]; rows = actor["processes"]; by_pid = {row["pid"]: row for row in rows}
    need(len(by_pid) == len(rows) and 3 <= len(rows) <= 4 and by_pid.get(parent["pid"]) == parent and
         parent["argv"] == [NODE, str(STAGE / "launcher.mjs")] and parent["cwd"] == "/" and
         parent["parentPrivateValuesAbsent"] is True, "actual_new_managed_parent_not_standalone_required")
    evm = [row for row in rows if row["argv"] == source_arguments(evm_files)]
    solana_args = [NODE, "--max-old-space-size=4096", "--env-file=" + solana_file, "--import", "tsx", "lib/solana/worker.ts"]
    solana = [row for row in rows if row["argv"] == solana_args]
    need(len(evm) == len(solana) == 1 and evm[0]["parentPid"] == solana[0]["parentPid"] == parent["pid"] and
         evm[0]["cwd"] == PROJECT and solana[0]["cwd"] == SOLANA_PROJECT and
         parent["startTicks"] > predecessor["parent"]["startTicks"], "new_parent_and_separate_EVM_Solana_children_required")
    for row in rows:
        need(row["uid"] == 970 and row["gid"] == 964 and set(row["groups"]) <= {964} and
             row["noNewPrivileges"] is row["capabilitiesZero"] is row["startupInjectionAbsent"] is True and
             row["cgroup"] == "0::/system.slice/" + PARENT, "all_managed_tree_processes_must_have_exact_zero_capability_identity")
        if row["pid"] in {parent["pid"], evm[0]["pid"], solana[0]["pid"]}:
            need(row["executable"] == NODE, "pinned_Node_executable_required_for_parent_and_both_children")
        else:
            need(row["parentPid"] == evm[0]["pid"] and row["argv"] == [row["executable"], "--service=0.25.12", "--ping"] and
                 row["executable"].endswith("/@esbuild/linux-x64/bin/esbuild"), "only_original_direct_EVM_compiler_child_allowed")
    return {"evm": evm[0], "solana": solana[0], "sourceActor": {"unit": actor["unit"], "parent": evm[0],
            "processes": [row for row in rows if row["pid"] == evm[0]["pid"] or row["parentPid"] == evm[0]["pid"]]}}


def heartbeat(native, intent):
    now, beat = native["clock"], native["app"]["heartbeat_at"]
    need(type(now) is int and not isinstance(beat, bool) and str(beat).isdigit() and
         str(native["app"]["is_locked"]) == "1" and str(native["app"].get("is_dev", "0")) == "0" and
         0 <= now - int(beat) <= 180000 and int(beat) >= intent["observationDatabaseClock"] and
         int(beat) > intent["heartbeatBeforeObservation"], "actual_managed_heartbeat_must_advance_after_own_observation_intent")


def solana_idle(packet):
    # The unchanged pg.Pool may close every idle connection while the official
    # worker sleeps. A future recorded wake-up is not a completed scan proof.
    def instant(value):
        need(isinstance(value, str) and len(value) <= 64, "actual_Solana_schedule_timestamp_required")
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        need(parsed.utcoffset() == datetime.timedelta(0), "actual_UTC_Solana_schedule_required")
        return parsed
    need(packet["workerLock"] == {"granted": 0, "waiting": 0} and packet["runningScans"] == 0 and
         instant(packet["state"]["nextScanAt"]) > instant(packet["observedAt"]),
         "zero_idle_Solana_backends_require_actual_future_schedule_and_no_running_scan")


class Owner:
    def __init__(self, input_sha):
        need(pin(input_sha), "actual_managed_foundation_input_hash_required")
        self.input_sha = input_sha; self.config = json.loads(protected(INPUT, input_sha))
        need(set(self.config) == {"format", "ordinaryResultSha256", "ordinaryInputSha256", "solanaAuthSha256", "observerResultSha256"} and
             self.config["format"] == FORMAT + "-input" and all(pin(v) for k, v in self.config.items() if k != "format"),
             "actual_fixed_predecessor_observer_Solana_refs_no_future_placeholder_required")
        self.runtime = module("ypal-alchemy-ordinary-runtime-v1.py"); self.ordinary = self.runtime.Owner(self.config["ordinaryInputSha256"])
        self.op = self.ordinary.operation(); self.predecessor = self.ordinary.journal("result.json")
        need(self.ordinary.digest("result.json") == self.config["ordinaryResultSha256"] and self.predecessor["mode"] == "paid" and
             self.predecessor["source"]["unit"]["Id"] == SOURCE and self.predecessor["completed"] is True,
             "actual_recorded_ordinary_paid_standalone_ACK_required_not_current_managed_authority")
        self.core = primitives(protected(OPS / "ypal-managed-handover-v1.py", CODE["ypal-managed-handover-v1.py"]), Path(__file__))
        self.h = self.core.ReadonlyHost(); self.h.config = {"solanaAuthSha256": self.config["solanaAuthSha256"]}
        self.host = module("ypal-alchemy-source-switch-v1.host.py")
        self.solana_backends = solana_backend_primitive(protected(OPS / "ypal-alchemy-source-switch-v1.host.py", CODE["ypal-alchemy-source-switch-v1.host.py"]), Path(__file__))
        self.intake = module("ypal-alchemy-ordinary-consumer-context-v1.py")
        self.observer = module("ypal-ordinary-observer-retained-prefix-v1.py")
        self.financial = module("ypal-alchemy-ordinary-financial-v1.py")

    def envelope(self, **values):
        return {"format": FORMAT, "operatorSha256": own_sha(), "inputSha256": self.input_sha,
                "bootId": self.core.boot(), **values}

    def record(self, name, expected=None):
        self.audit_directory()
        value = json.loads(protected(BASE / name, expected))
        need(all(value.get(k) == v for k, v in self.envelope().items()), "same_owned_managed_observation_producer_input_and_boot_required")
        return value

    def save(self, name, value):
        self.audit_directory()
        self.ordinary.p.exclusive(BASE / name, encoded(value))

    def audit_directory(self):
        row = BASE.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and stat.S_IMODE(row.st_mode) == 0o700,
             "exact_owned_private_managed_observation_directory_required")

    def dependencies(self):
        need(json.loads(protected(INPUT, self.input_sha)) == self.config, "same_exact_managed_observation_input_required")
        for name, digest in CODE.items(): protected(OPS / name, digest)
        need(stat.S_IMODE(STAGE.lstat().st_mode) == 0o755 and {path.name for path in STAGE.iterdir()} == set(PUBLIC),
             "only_four_public_managed_runtime_files_in_owned_0755_directory_required")
        for name, digest in PUBLIC.items():
            protected(STAGE / name, digest)
            need(stat.S_IMODE((STAGE / name).lstat().st_mode) == 0o644, "managed_runtime_files_must_be_public_0644")
        qualify_public_readability(self.core.command)
        protected(NODE, NODE_SHA, 256000000)
        need(protected(ORDINARY_ENV) == self.ordinary.source_environment(), "fourth_public_file_must_contain_exact_actual89a_permits_only")
        self.ordinary.c.private_current(self.ordinary.original); self.ordinary.c.stage_current()
        need(self.ordinary.h.source.inputs() == self.ordinary.original["inputs"], "same_base_code_private_inputs_pool5_and_source_role32_required")
        self.ordinary.retired_current()
        self.h.retained_solana_auth()
        protected(OPS / "ypal-managed-handover-v1.solana.sql", self.core.SQL_SHA)
        manifest = self.core.document(Path(PROJECT).parents[1] / "BASE-SOURCE-MANIFEST.json")
        rows = {row["path"]: row["sha256"] for row in manifest["files"]}
        for name in self.core.SOLANA_SOURCES:
            need(sha(protected(Path(SOLANA_PROJECT) / name)) == rows["apps/yunipals-indexer/" + name],
                 "same_retained_thirteen_Solana_program_sources_required")

    def routes(self):
        finance = self.financial.validate_current(self.ordinary.config["financialReceiptSha256"])
        need(finance["validated"] is finance["financialQualified"] is True and finance["sourceActorQualified"] is False and
             finance["receiptSha256"] == self.ordinary.config["financialReceiptSha256"] and
             finance["permits"] == self.ordinary.plan["permits"] and finance["dailyPolicy"] == self.ordinary.plan["ordinaryPolicy"],
             "separate_actual89a_current_financial_authority_for_same_four_permits_required")
        four = {}
        for chain in self.runtime.CHAINS:
            actor = self.ordinary.proxy_actor(chain)
            need(actor == self.ordinary.journal(chain + "-started.json")["actor"], "same_four_acknowledged_ordinary_proxy_epochs_required")
            self.ordinary.c.proxy_environment(chain, actor); four[chain] = actor
        five = self.ordinary.c.retained()
        need(five == self.ordinary.original["retainedRPC"] and len(five) == 5,
             "five_retained_RPC_epochs_profiles_private_files_must_stay_separate_and_exact")
        return {"financialReceiptSha256": finance["receiptSha256"], "financialProducerSha256": CODE["ypal-alchemy-ordinary-financial-v1.py"],
                "profileId": finance["profileId"], "expiresMs": finance["expiresMs"], "permits": finance["permits"],
                "dailyPolicy": finance["dailyPolicy"], "ordinaryFour": four, "retainedFive": five,
                "chainRouting": {chain: self.ordinary.p.proxy_mode(chain) for chain in self.runtime.CHAINS}}

    def snapshot(self):
        self.dependencies(); routes = self.routes()
        for unit in self.core.WRITERS:
            if unit != PARENT:
                row = self.h.state(unit)
                need(row["MainPID"] == row["ControlPID"] == "0" and row["ActiveState"] in {"inactive", "failed"} and self.h.actor(unit, True) is None,
                     "every_other_known_writer_must_be_terminal_for_managed_current_proof")
        self.ordinary.old.ns.gone(self.predecessor["source"]["processes"])
        state = self.h.state(PARENT)
        need(state["User"] == state["Group"] == "yunipals_unified_shadow" and state["NRestarts"] == "0" and
             state["FragmentPath"] == str(self.core.SYSTEM / PARENT) and not state["DropInPaths"],
             "new_restricted_managed_unit_without_old_legacy_dropins_required")
        need(sha(protected(self.core.SYSTEM / PARENT)) == PUBLIC["yunipals-indexer.service.example"], "exact_new_managed_unit_bytes_required")
        self.h.managed_settings(); actor = self.h.actor(PARENT)
        self.loaded_command_and_bindings()
        evm_files = [str(path) for path in self.core.ENV_FILES[:3]] + [str(ORDINARY_ENV)]
        children = validate_tree(actor, evm_files, self.core.ENV_FILES[3], self.predecessor["source"])
        public = dict(line.split("=", 1) for line in protected(STAGE / "service.public.env").decode().splitlines() if line and not line.startswith("#"))
        need(self.h.peer(actor["parent"]["pid"], public=public, require_public=True) == actor["parent"], "exact_public_parent_environment_without_child_credentials_required")
        paths = dict(self.core.NAMESPACE)
        paths[PROJECT + "/lib/unified/rpc-preflight.ts"] = str(OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")
        self.namespace(children["evm"], paths)
        expected = self.ordinary.h.source.s.expected_env()
        expected.update(dict(line.split("=", 1) for line in self.ordinary.source_environment().decode().splitlines()))
        need(self.h.peer(children["evm"]["pid"], public=expected) == children["evm"], "present_managed_EVM_public_permits_must_match_actual_fourth_file")
        native = self.ordinary.h.source.native(); self.ordinary.h.r.recovery_floor(self.op["native"], native)
        self.ordinary.old.ns.native_order(native)
        data = self.intake.query_components()["dataIdentity"]
        need(native["schemaOid"] == data["schemaOid"] == "75963410" and native["tables"] == data["nativeTableIdentities"] == self.op["native"]["tables"] and
             len(native["tables"]) == 44 and native["cache"] == data["syncCacheIdentity"] == self.op["native"]["cache"] and
             native["app"]["build_id"] == data["buildId"] == "71e2a7f3b7", "same_build_native44_cache_registered_manifest_and_read_identity_required")
        observer = self.observer.validate_current(self.config["observerResultSha256"])
        need(observer["validated"] is observer["observerCurrentQualified"] is observer["ordinarySustainedObserver"] is True and
             observer["sourceActorQualified"] is observer["currentWriterQualified"] is observer["paidAuthority"] is False and
             observer["dataIdentity"]["schemaOid"] == data["schemaOid"], "independent_unchanged_logical_observer_required_not_writer_authority")
        sessions = self.host.kernel_backends(self.ordinary.h.source.query, self.ordinary.h.observer, 73004621,
            {PARENT: children["sourceActor"]}, {PARENT: (970, 964)}, True)
        need(len(sessions[PARENT]) >= 1, "positive_managed_EVM_kernel_backend_and_no_foreign_native_role_session_required")
        solana = self.solana_current(actor, children["solana"])
        need(self.h.actor(PARENT) == actor, "managed_tree_changed_after_full_current_kernel_and_dataset_proof")
        activation = self.h.activation(PARENT)
        need(activation["boot"] is not None, "literal_owned_managed_multi_user_boot_link_required")
        files = {path: {"sha256": sha(protected(path)), "identity": self.ordinary.leaf.file_identity(path)} for path in [*evm_files, self.core.ENV_FILES[3]]}
        binding = self.envelope(sourceKind="managed", sourceRelease=data["sourceRelease"], manifestHash=data["manifestHash"],
            schema=data["schema"], schemaOid=data["schemaOid"], buildId=data["buildId"], nativeTables=native["tables"], syncCache=native["cache"],
            currentManagedEpoch=canonical_actor(actor), sourceKernelActors={PARENT: canonical_actor(children["sourceActor"])},
            activation=activation, privateAndPublicFiles=files, routes=routes, observer={key: observer[key] for key in
                ["operatorSha256", "receiptSha256", "actor", "bootLink", "dataIdentity"]},
            recordedStandaloneReceiptSha256=self.config["ordinaryResultSha256"], recordedStandaloneProducerSha256=CODE["ypal-alchemy-ordinary-runtime-v1.py"],
            recordedStandaloneCurrentClaimed=False, poolMaximum=5, transportSha256=self.ordinary.p.TIMEOUT_SHA)
        self.dependencies(); need(self.routes() == routes and canonical_actor(self.h.actor(PARENT)) == binding["currentManagedEpoch"],
                                  "managed_route_private_and_tree_final_compare_and_swap_required")
        return {"binding": binding, "native": native, "kernelSessions": sessions, "solana": solana}

    def solana_current(self, actor, child):
        owned = {"unit": actor["unit"], "parent": child, "processes": [child]}
        sessions = self.solana_backends(self.ordinary.h.source.query, self.ordinary.h.observer, 16388,
            {"managed-solana": owned}, {"managed-solana": (970, 964)}, False)["managed-solana"]
        sql = ("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'granted',granted) ORDER BY pid),'[]'::jsonb) FROM pg_locks "
               "WHERE locktype='advisory' AND database=17584 AND classid=((hashtext('solana:indexer:worker')::bigint>>32)&4294967295)::oid "
               "AND objid=(hashtext('solana:indexer:worker')::bigint&4294967295)::oid AND objsubid=1")
        locks = self.ordinary.h.source.query(sql)
        need(len(locks) <= 1 and all(row["granted"] is True and row["pid"] in {backend["pid"] for backend in sessions} for row in locks),
             "current_Solana_worker_lock_must_be_absent_or_owned_by_actual_managed_child")
        packet = self.h.sql_solana()
        need(packet["workerLock"]["waiting"] == 0 and packet["workerLock"]["granted"] == len(locks),
             "same_current_Solana_manifest_budget_schedule_and_single_lock_bound_required")
        if not sessions: solana_idle(packet)
        need(self.ordinary.h.source.query(sql) == locks, "Solana_worker_lock_changed_during_kernel_and_schedule_observation")
        return {"kernelSessions": sessions, "lockHolders": locks, "state": packet,
                "positiveKernelSessionObserved": bool(sessions), "scheduledPublicationAccepted": False, "financialAuthorityQualified": False}

    def loaded_command_and_bindings(self):
        obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in PARENT)
        def typed(name):
            return json.loads(self.core.command(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", obj,
                "org.freedesktop.systemd1.Service", name]))
        command = typed("ExecStart")
        need(command.get("type") == "a(sasbttttuii)" and isinstance(command.get("data"), list) and len(command["data"]) == 1,
             "one_actual_typed_managed_Node_start_command_required")
        row = command["data"][0]
        need(isinstance(row, list) and len(row) == 10 and row[:3] == [NODE, [NODE, str(STAGE / "launcher.mjs")], False] and
             type(row[2]) is bool and all(type(value) is int and value >= 0 for value in row[3:8]) and
             all(type(value) is int for value in row[8:]), "exact_typed_managed_parent_program_and_no_extra_hook_required")
        expected = copy.deepcopy(self.ordinary.original["sourceBindings"])
        for row in expected["BindReadOnlyPaths"]["data"]:
            if row[1] == PROJECT + "/lib/unified/rpc-preflight.ts":
                row[0] = str(OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")
        for name in ["BindPaths", "BindReadOnlyPaths"]:
            actual = typed(name)
            need(actual == expected[name] and actual["type"] == "a(ssbt)" and len(actual["data"]) == 3,
                 "all_six_typed_original_bindings_and_original_flags_required_zero_RW_refused")

    def namespace(self, evm, paths):
        prefix = ["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups", "--inh-caps=-all", "--ambient-caps=-all",
                  "--bounding-set=-all", "--no-new-privs", "/usr/bin/env", "-i", "/usr/bin/python3", "-I", "-B", "-c"]
        actual = json.loads(self.core.command([*prefix, self.core.NAMESPACE_PEER], encoded({"pid": evm["pid"], "paths": paths}), timeout=8))
        wanted = json.loads(self.core.command([*prefix, self.host.BACKING_STAT_PEER], encoded(paths), timeout=8))
        need(actual == wanted and len(actual) == 6, "actual_managed_EVM_three_RW_three_RO_namespace_inodes_required")

    def begin(self):
        need(not os.path.lexists(BASE), "new_observed_managed_epoch_namespace_required_no_unknown_retry")
        snapshot = self.snapshot(); native = snapshot["native"]
        need(type(native["clock"]) is int and str(native["app"]["heartbeat_at"]).isdigit() and
             0 <= int(native["app"]["heartbeat_at"]) <= native["clock"], "actual_observation_database_clock_and_heartbeat_required")
        BASE.mkdir(mode=0o700); self.ordinary.p.sync(BASE.parent)
        self.save("observation-intent.json", self.envelope(binding=snapshot["binding"], native=native,
            observationDatabaseClock=native["clock"], heartbeatBeforeObservation=int(native["app"]["heartbeat_at"]),
            observationOnly=True, serviceStartIssued=False))
        return {"observationIntentSha256": sha(protected(BASE / "observation-intent.json")), "observedEpochNotStartedHere": True}

    def finish(self):
        intent = self.record("observation-intent.json"); current = self.snapshot()
        need(intent["observationOnly"] is True and intent["serviceStartIssued"] is False and current["binding"] == intent["binding"],
             "same_actual_managed_observation_epoch_required")
        heartbeat(current["native"], intent)
        self.ordinary.h.r.recovery_floor(intent["native"], current["native"])
        result = self.envelope(completed=True, observedManagedEpochQualified=True, serviceStartIssued=False,
            observationIntentSha256=sha(protected(BASE / "observation-intent.json")), binding=intent["binding"],
            bindingSha256=sha(encoded(intent["binding"])))
        if not os.path.lexists(BASE / "result.json"):
            self.save("result.json", {**result, "nativeAtAcknowledgement": current["native"]})
        saved = self.record("result.json")
        need({key: value for key, value in saved.items() if key != "nativeAtAcknowledgement"} == result,
             "same_own_observed_epoch_result_required")
        self.ordinary.h.r.recovery_floor(saved["nativeAtAcknowledgement"], current["native"])
        return {"receiptSha256": sha(protected(BASE / "result.json")), "bindingSha256": result["bindingSha256"], "currentWriterQualified": True}

    def current(self, result_sha):
        result = self.record("result.json", result_sha); intent = self.record("observation-intent.json")
        need(result["completed"] is result["observedManagedEpochQualified"] is True and result["serviceStartIssued"] is False and
             intent["observationOnly"] is True and intent["serviceStartIssued"] is False and
             result["observationIntentSha256"] == sha(protected(BASE / "observation-intent.json")) and
             result["binding"] == intent["binding"] and result["bindingSha256"] == sha(encoded(result["binding"])), "actual_own_managed_observation_ACK_chain_required")
        value = self.snapshot(); heartbeat(value["native"], intent)
        self.ordinary.h.r.recovery_floor(result["nativeAtAcknowledgement"], value["native"])
        need(value["binding"] == result["binding"], "same_acknowledged_current_managed_epoch_required")
        return {"format": FORMAT, "validated": True, "receiptSha256": result_sha, "operatorSha256": own_sha(),
            "inputSha256": self.input_sha, "sourceKind": "managed", "sourceState": "acknowledged-observed-active",
            **{key: result["binding"][key] for key in ["sourceRelease", "manifestHash", "schema", "schemaOid", "buildId", "nativeTables", "poolMaximum", "transportSha256"]},
            "currentManagedEpoch": result["binding"]["currentManagedEpoch"], "sourceKernelActors": result["binding"]["sourceKernelActors"],
            "binding": result["binding"], "bindingSha256": result["bindingSha256"], "currentWriterQualified": True,
            "managedProcessTreeQualified": True, "allSixMountsQualified": True, "routingMode": "ordinary-paid",
            "chainRouting": result["binding"]["routes"]["chainRouting"],
            "sourceReadinessQualified": str(value["native"]["app"]["is_ready"]) == "1", "currentCanonicalCoverageQualified": False,
            "financialAuthorityQualified": False, "lifecycleAuthorityQualified": False, "consumerAuthorityQualified": False,
            "legacyRetirementQualified": False, "scheduledSolanaAcceptanceQualified": False, "supervisedRestartQualified": False,
            "allConfiguredSourcesQualified": False,
            "observation": {"native": value["native"], "positiveKernelSessions": len(value["kernelSessions"][PARENT]), "solana": value["solana"]},
            "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}


def validate_current_source(result_sha, input_sha): return Owner(input_sha).current(result_sha)


def sources():
    return {"format": FORMAT + "-sources", "operator": {"file": Path(__file__).name, "sha256": own_sha()},
            "code": dict(CODE), "publicRuntime": dict(PUBLIC), "nodeSha256": NODE_SHA,
            "retainedSolanaSqlSha256": "2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0"}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--input-sha")
    group = parser.add_mutually_exclusive_group(); group.add_argument("--begin", action="store_true"); group.add_argument("--finish", action="store_true"); group.add_argument("--current"); group.add_argument("--sources", action="store_true")
    args = parser.parse_args()
    if args.sources:
        need(args.input_sha is None, "source_manifest_needs_no_runtime_inputs")
        print(json.dumps(sources(), sort_keys=True)); return
    if not (args.begin or args.finish or args.current):
        need(args.input_sha is None, "explicit_readonly_observation_phase_required")
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "currentWriterQualified": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_managed_observation_host_required")
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_managed_observation_unknown_no_retry")); signal.alarm(300)
    owner = Owner(args.input_sha)
    with owner.ordinary.old.v.transition_lock(owner.ordinary.m):
        value = owner.begin() if args.begin else owner.finish() if args.finish else owner.current(args.current)
    print(json.dumps({"format": FORMAT, "validated": value.get("validated", False), "receiptSha256": value.get("receiptSha256"),
        "observationIntentSha256": value.get("observationIntentSha256"), "bindingSha256": value.get("bindingSha256"),
        "currentWriterQualified": value.get("currentWriterQualified", False), "sourceKind": "managed",
        "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}, sort_keys=True))


if __name__ == "__main__":
    try: main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False, "automaticRetryAllowed": False,
            "errorClass": type(error).__name__, "fixedCode": str(error) if type(error) is RuntimeError and re.fullmatch("[A-Za-z0-9_]+", str(error)) else None,
            "rawMessagesExported": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0})); raise SystemExit(1)
