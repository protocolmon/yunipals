#!/usr/bin/env python3
"""One ordinary source/proxy epoch after the acknowledged catch-up closure.

No SQL or financial admission is executed here. Historical operators and
receipts remain unchanged; starts, retirement and recovery have their own ACKs.
"""
import argparse
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import time
import types

FORMAT = "yunipals-alchemy-ordinary-runtime-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-alchemy-ordinary-runtime-v1-20261024")
HOLD = Path("/etc/systemd/system/.ypal-alchemy-ordinary-runtime-v1")
SYSTEM = Path("/etc/systemd/system")
INPUT = OPS / "ypal-alchemy-ordinary-runtime-v1.input.json"
SOURCE = "yunipals-ypal-combined-source.service"
DROP = SYSTEM / (SOURCE + ".d/99-alchemy-ordinary-v1.conf")
CHAINS = ("ethereum", "base", "polygon", "bnb")
PINS = {
    "ypal-alchemy-source-completion-v1.py": "0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0",
    "ypal-alchemy-ordinary-financial-v1.py": "89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0",
    "ypal-alchemy-restart-cache-v1.py": "35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4",
    "ypal-alchemy-restart-cache-v1.filters.json": "394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675"
}


def need(ok, code):
    if not ok: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()
def own_sha(): return sha(Path(__file__).read_bytes())


def load(path, pin):
    path = Path(path)
    for item in [*path.parents, path]:
        st = item.lstat()
        need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
             "protected_exact_ordinary_runtime_dependency_required")
    before = path.lstat(); raw = path.read_bytes()
    key = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and len(raw) < 200000 and
         key(before) == key(path.lstat()) and sha(raw) == pin, "exact_ordinary_runtime_source_before_evaluation_required")
    result = types.ModuleType("ordinary_" + path.stem); result.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), result.__dict__)
    need(key(before) == key(path.lstat()) and sha(path.read_bytes()) == pin, "ordinary_dependency_changed_during_evaluation")
    return result


def cache_namespace(raw, filename):
    """New honest cache domain; the 80-fragment algorithm is unchanged."""
    tree = ast.parse(raw); counts = {"format": 0, "plan": 0}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "FORMAT":
            node.value = ast.Constant(FORMAT + "-cache"); counts["format"] += 1
    class PlanDomain(ast.NodeTransformer):
        def visit_Constant(self, node):
            if node.value == "yunipals-ypal-alchemy-catchup-financial-v1-plan":
                counts["plan"] += 1
                return ast.copy_location(ast.Constant("yunipals-ypal-alchemy-ordinary-plan-v1"), node)
            return node
    tree = PlanDomain().visit(tree); ast.fix_missing_locations(tree)
    need(counts == {"format": 1, "plan": 1}, "exact_cache_domain_only_two_AST_seams_required")
    result = types.ModuleType("ordinary_cache"); result.__file__ = str(filename)
    exec(compile(tree, str(filename), "exec"), result.__dict__)
    return result


def source_bytes(original, p):
    argv = list(original["source"]["parent"]["argv"])
    entry = p.PROJECT + "/node_modules/ponder/dist/esm/bin/ponder.js"
    need(argv.count(entry) == 1 and sum(x.startswith("--env-file=") for x in argv) == 3,
         "original_three_private_Node_envfiles_and_exact_entry_required")
    argv.insert(argv.index(entry), "--env-file=" + str(p.STAGE / "source.ordinary.public.env"))
    need(all(re.fullmatch(r"[A-Za-z0-9_./:@=,+-]+", value) for value in argv), "literal_systemd_arguments_without_expansion_required")
    ro = copy.deepcopy(original["sourceBindings"]["BindReadOnlyPaths"]["data"])
    rw = original["sourceBindings"]["BindPaths"]["data"]
    need(len(rw) == len(ro) == 3 and all(len(row) == 4 and row[2] is False and row[3] == 16384 for row in [*rw, *ro]),
         "exact_original_three_RW_three_RO_mounts_and_flags_required")
    for row in ro:
        if row[1].endswith("/lib/unified/rpc-preflight.ts"):
            row[0] = str(OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")
    # systemd's empty RO assignment clears BOTH lists. Append every RW only
    # after that reset; the actual typed six-list proof is mandatory at start.
    return ("[Service]\nExecStart=\nExecStart=/usr/bin/env -i " + " ".join(argv) +
            "\nBindReadOnlyPaths=\nBindReadOnlyPaths=" + " ".join(a + ":" + b for a, b, _, _ in ro) +
            "\nBindPaths=" + " ".join(a + ":" + b for a, b, _, _ in rw) + "\n").encode()


def host_namespace(raw, filename, loaded_runtime):
    tree = ast.parse(raw); counts = {"runtime": 0, "source": 0, "proxy": 0}
    class Seams(ast.NodeTransformer):
        def visit_Compare(visitor, node):
            if ast.unparse(node) == "self.source.runtime_properties() == operation['sourceRuntime']":
                counts["runtime"] += 1
                return ast.copy_location(ast.parse("ordinary_loaded(self, operation, mode)", mode="eval").body, node)
            return visitor.generic_visit(node)
        def visit_Constant(visitor, node):
            if node.value == "source.public.env": counts["source"] += 1; return ast.copy_location(ast.Constant("source.ordinary.public.env"), node)
            if node.value == ".public.env": counts["proxy"] += 1; return ast.copy_location(ast.Constant(".ordinary.public.env"), node)
            return node
    tree = Seams().visit(tree); ast.fix_missing_locations(tree)
    need(counts == {"runtime": 1, "source": 1, "proxy": 1}, "only_three_explicit_ordinary_Host_AST_seams_required")
    result = types.ModuleType("ordinary_host"); result.__file__ = str(filename)
    result.__dict__["ordinary_loaded"] = loaded_runtime
    exec(compile(tree, str(filename), "exec"), result.__dict__)
    result.SOURCE_DROP = DROP; result.PROXY_DROP_NAME = DROP.name
    return result


class Owner:
    def __init__(self, input_sha):
        self.completion_module = load(OPS / "ypal-alchemy-source-completion-v1.py", PINS["ypal-alchemy-source-completion-v1.py"])
        self.old = self.completion_module.load(); self.c = self.old.c
        self.m, self.p, self.leaf = self.old.m, self.old.p, self.old.leaf
        self.config = self.m.document(INPUT, input_sha); self.input_sha = input_sha
        need(set(self.config) == {"format", "financialReceiptSha256", "financialInputSha256"} and
             self.config["format"] == FORMAT + "-input" and all(self.m.pin(self.config[k]) for k in ["financialReceiptSha256", "financialInputSha256"]),
             "actual_ordinary_financial_receipt_and_input_required")
        self.financial = load(OPS / "ypal-alchemy-ordinary-financial-v1.py", PINS["ypal-alchemy-ordinary-financial-v1.py"])
        self.fo = self.financial.saved_owner()
        need(self.fo.h.input_sha == self.config["financialInputSha256"] and
             self.fo.digest("admitted.json") == self.config["financialReceiptSha256"], "exact_new_financial_ACK_and_immutable_input_required")
        admitted = self.fo.receipt("admitted.json"); self.finance_review = self.fo.reviewed(admitted["reviewSha256"])
        self.plan = self.finance_review["proposal"]; self.fo.p.validate_proposal(self.plan)
        self.original = self.old.owner.operation()
        raw = self.m.protected(OPS / "ypal-alchemy-restart-cache-v1.py")
        need(sha(raw) == PINS["ypal-alchemy-restart-cache-v1.py"], "exact_frozen_cache_core_required")
        self.cache = cache_namespace(raw, OPS / "ypal-alchemy-restart-cache-v1.py")
        self.h = self.host()

    def has(self, name): return os.path.lexists(BASE / name)
    def get(self, name): return self.m.document(BASE / name)
    def digest(self, name): return sha(self.m.protected(BASE / name))
    def put(self, name, value): self.p.exclusive(BASE / name, encoded(value))
    def envelope(self, **values):
        return {"format": FORMAT, "operatorSha256": own_sha(), "inputSha256": self.input_sha,
                "bootId": self.m.boot(), **values}
    def record(self, **values): return self.envelope(operationSha256=self.digest("operation.json"), **values)
    def journal(self, name):
        value = self.get(name)
        need(all(value[k] == v for k, v in self.record().items()), "exact_owned_same_boot_ordinary_runtime_journal_required")
        return value
    def operation(self):
        op = self.get("operation.json")
        need(all(op[k] == v for k, v in self.envelope().items()) and op["financialReceiptSha256"] == self.config["financialReceiptSha256"],
             "same_ordinary_runtime_operation_and_financial_parent_required")
        return op
    def financial_current(self): return self.financial.validate_current(self.config["financialReceiptSha256"])

    def host(self):
        file, pin = self.old.v.FILES["host"]; raw = self.m.protected(OPS / file)
        need(sha(raw) == pin, "exact_reviewed_host_core_required")
        ns = host_namespace(raw, Path(__file__).absolute(), self.loaded_runtime)
        plan = types.SimpleNamespace(**self.p.__dict__)
        plan.source_environment = lambda p: self.source_environment()
        plan.source_drop = lambda: source_bytes(self.original, self.p)
        h = ns.Host(plan, self.leaf)
        h.restore = self.old.v.source_restore(h.restore, h, self.m, self.old.v.namespace(
            self.m.protected(OPS / self.old.v.FILES["identity"][0]), OPS / self.old.v.FILES["identity"][0]), SOURCE)
        return h

    def source_environment(self):
        return "".join("UNIFIED_RPC_REPLAY_PERMIT_ID_" + str(row["chainId"]) + "=" + row["permitId"] + "\n"
                       for row in sorted(self.plan["permits"], key=lambda row: row["chainId"])).encode()

    def proxy_drop(self, chain):
        need(chain in CHAINS, "one_fixed_ordinary_chain_required")
        return ("[Service]\nEnvironmentFile=" + str(self.p.STAGE / (chain + ".ordinary.public.env")) +
                "\nExecStart=\nExecStart=" + self.p.NODE + " " + str(self.p.STAGE / "rpc-budget-proxy.mjs") + "\n").encode()

    def host_op(self):
        op = self.operation()
        return {**self.original, "native": op["native"], "financialPlan": self.plan, "sourceOverlay": op["overlays"]["source"]}

    def loaded_runtime(self, host, op, mode):
        current = host.source.runtime_properties(); before = op["sourceRuntime"]
        ignored = {"BindPaths", "BindReadOnlyPaths"}
        need({k:v for k,v in current.items() if k not in ignored} == {k:v for k,v in before.items() if k not in ignored},
             "all_nonmount_source_runtime_properties_must_stay_exact")
        actual = self.c.source_bindings()
        wanted = copy.deepcopy(op["sourceBindings"])
        if mode == "paid":
            for row in wanted["BindReadOnlyPaths"]["data"]:
                if row[1].endswith("/lib/unified/rpc-preflight.ts"):
                    row[0] = str(OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")
        need(actual == wanted and all(actual[name]["type"] == "a(ssbt)" and len(actual[name]["data"]) == 3
             for name in ["BindPaths", "BindReadOnlyPaths"]), "actual_exact_three_RW_three_RO_and_empty_systemd_envfiles_required")
        return True

    def peers(self): return self.c.current_peer_frame()
    def static(self):
        need(self.m.document(INPUT, self.input_sha) == self.config and self.h.source.inputs() == self.original["inputs"] and
             self.m.link_record(self.h.r.BOOT) == self.original["sourceBoot"] and self.c.retained() == self.original["retainedRPC"],
             "ordinary_static_private_boot_and_retained_five_RPC_must_stay_exact")
        self.c.private_current(self.original); self.c.stage_current()
        if self.has("operation.json"):
            for name, item in self.operation()["publicFiles"].items():
                path = self.p.STAGE / (name + ".ordinary.public.env")
                need(sha(self.leaf.protected(path)) == item["sha256"] and
                     self.old.ns.six(self.p.identity(path)) == self.old.ns.six(item["identity"]),
                     "all_five_owned_ordinary_public_env_inodes_and_hashes_required")
        native = self.h.source.native(); self.h.r.recovery_floor(self.original["native"], native)
        need(native["tables"] == self.original["native"]["tables"] and native["cache"] == self.original["native"]["cache"] and
             native["app"]["build_id"] == "71e2a7f3b7", "same_71e_native44_cache_and_recovery_floors_required")
        return native

    def terminal(self, unit, processes, retained_current=None):
        self.old.owner.process_terminal(unit, processes)
        if unit == SOURCE: self.h.source_sessions(None, retained_current)

    def manager(self, verb, unit=None):
        allowed = {SOURCE, *(self.h.proxy_unit(c) for c in CHAINS)}
        if self.has("operation.json"): allowed.update(self.operation()["retirement"]["units"])
        need(verb in {"start", "stop", "daemon-reload"} and (unit is None if verb == "daemon-reload" else unit in allowed),
             "only_fixed_owned_source_proxy_and_retired_deadline_manager_scope")
        need(not self.m.command(["/usr/bin/systemctl", verb, *([] if unit is None else [unit])], timeout=90), "quiet_owned_manager_ACK_required")

    def move(self, label, source, target, expected, link=False):
        intent = label + "-move-intent.json"
        if not self.has(intent): self.put(intent, self.record(source=str(source), target=str(target), expected=expected, link=link))
        row = self.journal(intent)
        need(row["source"] == str(source) and row["target"] == str(target) and row["expected"] == expected and row["link"] == link,
             "exact_same_owned_no_replace_move_required")
        check = lambda path: self.leaf.link_record(path) if link else {"sha256": sha(self.leaf.protected(path)), "identity": self.leaf.file_identity(path)}
        if os.path.lexists(source):
            need(check(source) == expected and not os.path.lexists(target), "owned_source_and_absent_destination_before_move_required")
            if link: self.old.ns.move_link(self.p, self.leaf, source, target, expected)
            else: self.p.move_owned(source, target, {"sha256": expected["sha256"], "identity": self.p.identity(source)})
        need(not os.path.lexists(source) and check(target) == expected, "same_owned_moved_bytes_inode_or_boot_required")

    def reload(self, tag, complete=False):
        need(tag in {"retired", "source-paid", "source-free", *(c + "-paid" for c in CHAINS), *(c + "-free" for c in CHAINS)}, "fixed_ordinary_reload_phase_required")
        intent, result = tag + "-reload-intent.json", tag + "-reloaded.json"
        if self.has(result): self.journal(result); return
        if self.has(intent): need(complete, "unknown_reload_requires_explicit_configuration_only_completion")
        else: self.put(intent, self.record())
        self.configuration_current()
        self.manager("daemon-reload"); self.put(result, self.record(intentSha256=self.digest(intent), completed=True))

    def configuration_current(self):
        op = self.operation()
        def exact_one(paths, item, link=False):
            actual = [path for path in paths if os.path.lexists(path)]
            need(len(actual) == 1, "one_exact_owned_definition_or_retained_boot_location_required")
            if link: need(self.leaf.link_record(actual[0]) == item, "same_retained_owned_boot_inode_required")
            else: self.check_file(actual[0], item)
        for name, item in op["overlays"].items():
            target = DROP if name == "source" else self.h.proxy_drop(name)
            exact_one([target, HOLD / (name + ".conf"), HOLD / (name + ".removed.conf")], item)
        for path, item in op["retirement"]["files"].items():
            p = Path(path); label = p.name if p.parent == SYSTEM else p.parent.name + "." + p.name
            exact_one([p, HOLD / label], item)
        for path, item in op["retirement"]["links"].items(): exact_one([Path(path), HOLD / (Path(path).name + ".boot")], item, True)
        exact_one([self.old.ns.SOURCE_DROP, HOLD / "old-source99.conf"], self.original["sourceOverlay"])

    def retirement(self):
        result = {"files": {}, "links": {}, "units": []}
        original_base = Path("/var/backups/yunipals-ypal-alchemy-source-switch-v1-20261024")
        first = self.m.document(original_base / "operation.json", self.old.v.PARENT["operationSha256"])
        for op, base in [(first, original_base), (self.original, self.old.v.BASE)]:
            ack = self.m.document(base / "deadline-prepared.json")
            need(set(ack["units"]) == set(op["deadlineFiles"]), "actual_original_deadline_prepared_scope_required")
            for name, item in op["deadlineFiles"].items():
                need({k:v for k,v in ack["units"][name].items() if k != "bootLink"} == item,
                     "deadline_ACK_must_bind_exact_prepared_definition_inode")
                result["files"][str(SYSTEM / name)] = item; result["units"].append(name)
                if name.endswith(".timer"):
                    need(ack["units"][name]["bootLink"] == op["deadlineBootLinks"][name], "deadline_ACK_must_bind_exact_prepared_boot_inode")
                    result["links"][str(SYSTEM / "timers.target.wants" / name)] = ack["units"][name]["bootLink"]
        guard = self.m.document(self.old.a.BASE / "guards.json")
        self.old.guards_current()
        for name, item in guard["files"].items():
            result["files"][str(SYSTEM / name)] = {"sha256": item["sha256"], "identity": self.old.ns.six(item["identity"])}
            result["units"].append(name)
            if name.endswith(".timer"): result["links"][str(SYSTEM / "timers.target.wants" / name)] = guard["bootLinks"][name]
        for name, item in self.old.record("guard-overlays.json")["files"].items():
            result["files"][str(self.old.guard_path(name))] = {"sha256": item["sha256"], "identity": self.old.ns.six(item["identity"])}
        need(len(result["units"]) == 12 and len(set(result["units"])) == 12 and len(result["files"]) == 14 and len(result["links"]) == 6,
             "exact_six_old_services_six_timers_six_boots_two_completion_drops_required")
        return result

    def prepare(self):
        need(not os.path.lexists(BASE) and not os.path.lexists(HOLD), "fresh_ordinary_runtime_namespace_required")
        self.financial_current(); self.fo.h.old_closed_live(); self.old.bindfix()
        need(not os.path.lexists(self.completion_module.ZZ), "old_owned_RW_supplement_must_be_removed_by_actual_close")
        self.terminal(SOURCE, self.old.owner.known_source_processes()); native = self.static(); peers = self.peers()
        routes = {c: self.old.h.free_route(c) for c in CHAINS}; retirement = self.retirement()
        BASE.mkdir(mode=0o700); HOLD.mkdir(mode=0o700); self.p.sync(BASE.parent); self.p.sync(HOLD.parent)
        public = {}; overlays = {}
        for name, raw in [("source", self.source_environment()), *[(c, self.p.proxy_environment(c)) for c in CHAINS]]:
            public[name] = self.p.exclusive(self.p.STAGE / (name + ".ordinary.public.env"), raw, 0o644)
            data = source_bytes(self.original, self.p) if name == "source" else self.proxy_drop(name)
            item = self.p.exclusive(HOLD / (name + ".conf"), data, 0o644)
            overlays[name] = {"sha256": item["sha256"], "identity": self.old.ns.six(item["identity"])}
        self.financial_current(); self.terminal(SOURCE, self.old.owner.known_source_processes())
        need(self.peers() == peers and {c:self.old.h.free_route(c) for c in CHAINS} == routes, "same_serving_peers_and_four_free_epochs_before_operation_required")
        self.put("operation.json", self.envelope(financialReceiptSha256=self.config["financialReceiptSha256"],
            financialProposalSha256=sha(self.financial.encoded(self.plan)), oldOperationSha256=self.old.a.OPERATION_SHA,
            originalFreeRoutes=routes, native=native, peers=peers, retirement=retirement, publicFiles=public, overlays=overlays))
        return {"prepared": True, "operationSha256": self.digest("operation.json"), "serviceActions": 0}

    def check_file(self, path, item):
        need({"sha256": sha(self.leaf.protected(path)), "identity": self.leaf.file_identity(path)} == item,
             "exact_recorded_owned_file_inode_and_bytes_required")

    def retired_current(self):
        row = self.journal("retired.json"); op = self.operation()
        for path in [*op["retirement"]["files"], *op["retirement"]["links"], str(self.old.ns.SOURCE_DROP)]:
            need(not os.path.lexists(path), "all_recorded_old_deadlines_boots_and_source99_must_remain_retired")
        for name in op["retirement"]["units"]:
            self.unit_terminal(name)
        need(row["retiredUnits"] == 12 and row["retiredBoots"] == 6, "actual_complete_deadline_retirement_ACK_required")

    def unit_terminal(self, unit):
        fields = ["Id", "LoadState", "ActiveState", "Job"]
        row = self.leaf.manager_properties(self.h.rpc_m, unit, fields)
        need(row["LoadState"] in {"loaded", "not-found"} and row["ActiveState"] in {"inactive", "failed"} and row["Job"] == "",
             "old_deadline_unit_must_be_terminal_and_jobless")
        group = Path("/sys/fs/cgroup/system.slice") / unit / "cgroup.procs"
        need(not group.exists() or not group.read_text().split(), "retired_deadline_cgroup_must_be_empty")
        if row["LoadState"] == "not-found":
            need(not os.path.lexists(SYSTEM / unit), "not_found_deadline_must_have_no_installed_definition")
            return
        obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in unit)
        job = json.loads(self.m.command(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", obj, "org.freedesktop.systemd1.Unit", "Job"]))
        need(job == {"type": "(uo)", "data": [0, "/"]}, "old_deadline_unit_must_have_no_pending_job")

    def retire(self):
        op = self.operation(); self.financial_current(); self.terminal(SOURCE, self.old.owner.known_source_processes())
        for path, item in op["retirement"]["files"].items():
            if os.path.lexists(path): self.check_file(Path(path), item)
        for name in op["retirement"]["units"]:
            if name.endswith(".service"): self.unit_terminal(name); continue
            intent = name + "-stop-intent.json"
            if not self.has(intent):
                self.put(intent, self.record(unit=name)); self.manager("stop", name)
            self.unit_terminal(name)
        for path, item in op["retirement"]["links"].items(): self.move(Path(path).name + "-boot", Path(path), HOLD / (Path(path).name + ".boot"), item, True)
        for path, item in op["retirement"]["files"].items():
            p = Path(path); label = p.name if p.parent == SYSTEM else p.parent.name + "." + p.name
            self.move(label, p, HOLD / label, item)
        old_drop = self.old.ns.SOURCE_DROP
        self.terminal(SOURCE, self.old.owner.known_source_processes())
        self.move("old-source99", old_drop, HOLD / "old-source99.conf", self.original["sourceOverlay"])
        self.reload("retired")
        if not self.has("retired.json"): self.put("retired.json", self.record(retiredUnits=12, retiredBoots=6, oldSourceOverlayRetired=True))
        self.retired_current(); return {"retired": True, "oldUnits": 12, "oldBoots": 6}

    def publish(self, label, target):
        item = self.operation()["overlays"][label]
        if label == "source": self.terminal(SOURCE, self.known_source())
        if not target.parent.exists(): target.parent.mkdir(mode=0o755); self.p.sync(target.parent.parent)
        self.move(label + "-publish", HOLD / (label + ".conf"), target, item)

    def proxy_actor(self, chain, stop=False):
        return self.h.paid_route(chain, self.operation()["originalFreeRoutes"][chain],
            self.journal(chain + "-start-intent.json"), self.operation()["overlays"][chain], stop)

    def switch_proxy(self, chain):
        need(chain in CHAINS, "one_fixed_chain_required"); op = self.operation()
        self.retired_current(); self.financial_current(); self.terminal(SOURCE, self.old.owner.known_source_processes())
        if self.has(chain + "-start-intent.json"):
            return self.observe_proxy(chain)
        tag = chain + "-stop-free-intent.json"; original = op["originalFreeRoutes"][chain]
        if not self.has(tag):
            need(self.old.h.free_route(chain) == original, "same_original_free_route_before_owned_stop")
            self.put(tag, self.record(actor=original["actor"], backends=self.h.proxy_sessions(chain, original["actor"])))
            need(self.old.h.free_route(chain) == original, "free_proxy_final_CAS_after_durable_stop_intent")
            self.manager("stop", self.h.proxy_unit(chain))
        self.terminal(self.h.proxy_unit(chain), original["actor"]["processes"])
        self.old.owner.budget_backends_gone(self.journal(tag)["backends"])
        self.publish(chain, self.h.proxy_drop(chain)); self.reload(chain + "-paid")
        start = chain + "-start-intent.json"
        if not self.has(start):
            self.financial_current(); self.put(start, self.record(notBeforeUs=self.m.mono()))
            self.terminal(self.h.proxy_unit(chain), original["actor"]["processes"]); self.financial_current()
            self.manager("start", self.h.proxy_unit(chain))
        return self.observe_proxy(chain)

    def observe_proxy(self, chain):
        start = chain + "-start-intent.json"
        actor = self.old.ns.wait_read(lambda:self.proxy_actor(chain)); sessions = self.h.proxy_sessions(chain, actor)
        need(self.proxy_actor(chain) == actor, "ordinary_proxy_final_actor_CAS_required")
        if not self.has(chain + "-started.json"): self.put(chain + "-started.json", self.record(actor=actor, ownedBackends=sessions, intentSha256=self.digest(start)))
        need(self.journal(chain + "-started.json")["actor"] == actor, "same_once_started_ordinary_proxy_ACK_required")
        return {"chain": chain, "acknowledged": True}

    def source_actor(self, mode="paid", stop=False):
        return self.h.source_epoch(self.host_op(), self.journal("source-" + mode + "-start-intent.json"), mode, stop)

    def loaded_source(self, mode):
        op = self.host_op(); wanted = dict(op["sourceDefinitions"])
        if mode == "paid": wanted[str(DROP)] = op["sourceOverlay"]
        need(self.h.definitions(self.h.source.state(SOURCE)) == wanted and self.m.link_record(self.h.r.BOOT) == self.original["sourceBoot"],
             "exact_current_ordinary_source_definitions_and_boot_required")
        self.loaded_runtime(self.h, op, mode)
        argv = list(op["source"]["parent"]["argv"])
        if mode == "paid": argv.insert(argv.index(self.p.PROJECT + "/node_modules/ponder/dist/esm/bin/ponder.js"),
                                       "--env-file=" + str(self.p.STAGE / "source.ordinary.public.env"))
        value = self.old.v.typed_command(self.m, SOURCE)
        need(value["type"] == "a(sasbttttuii)" and len(value["data"]) == 1 and len(value["data"][0]) == 10 and
             value["data"][0][:3] == ["/usr/bin/env", ["/usr/bin/env", "-i", *argv], False],
             "actual_loaded_clean_source_command_and_three_plus_one_envfiles_required")

    def start_source(self, mode="paid", disabled_sha=None):
        need(mode in {"paid", "free"}, "one_owned_ordinary_source_phase_required")
        op = self.operation(); self.retired_current()
        name = "source-" + mode + "-start-intent.json"
        if self.has(name):
            return self.observe_source(mode, disabled_sha)
        if mode == "paid":
            self.financial_current()
            for chain in CHAINS: need(self.proxy_actor(chain) == self.journal(chain + "-started.json")["actor"], "all_four_ordinary_proxy_ACKs_required")
            self.publish("source", DROP); self.reload("source-paid")
        else:
            self.disabled_current(disabled_sha); self.quiet_current()
            if os.path.lexists(DROP): self.move("source-remove", DROP, HOLD / "source.removed.conf", op["overlays"]["source"])
            self.reload("source-free")
        if not self.has(name):
            self.terminal(SOURCE, self.known_source()); native = self.static()
            cache = self.cache.validate_restart_capture(self.h.source.query, self.plan, native)
            peers = self.peers(); self.put(name, self.record(notBeforeUs=self.m.mono(), preStartDatabaseClock=native["clock"],
                predecessorHeartbeat=int(native["app"]["heartbeat_at"]), peers=peers, restartCacheProof=cache, disabledReceiptSha256=disabled_sha))
            if mode == "paid": self.financial_current()
            else: self.disabled_current(disabled_sha)
            self.terminal(SOURCE, self.known_source()); self.loaded_source(mode)
            need(self.peers() == peers, "serving_peer_frame_CAS_immediately_before_once_source_start")
            self.manager("start", SOURCE)
        return self.observe_source(mode, disabled_sha)

    def observe_source(self, mode, disabled_sha=None):
        """Complete an existing start intent using reads; never resend effects."""
        need(mode in {"paid", "free"}, "one_owned_ordinary_source_phase_required")
        name = "source-" + mode + "-start-intent.json"; intent = self.journal(name)
        need(intent["disabledReceiptSha256"] == disabled_sha and (disabled_sha is None if mode == "paid" else self.m.pin(disabled_sha)),
             "same_financial_or_disabled_parent_for_existing_source_start_intent")
        self.static(); self.retired_current(); self.loaded_source(mode)
        if mode == "paid":
            self.financial_current()
            for chain in CHAINS:
                need(self.proxy_actor(chain) == self.journal(chain + "-started.json")["actor"], "same_four_ordinary_proxy_epochs_for_source_observation")
        else:
            self.disabled_current(disabled_sha); self.free_routes_current(); self.leaf.assert_no_paid_proxy_processes()
        actor, native = self.old.ns.wait_read(lambda:self.source_actor(mode)); sessions = self.h.source_sessions(actor)
        need(self.source_actor(mode)[0] == actor and self.peers() == self.journal(name)["peers"], "new_source_and_serving_peer_final_CAS_required")
        self.c.current_pack_ready()
        if mode == "paid": self.financial_current()
        else: self.disabled_current(disabled_sha)
        need(self.source_actor(mode)[0] == actor, "same_source_epoch_immediately_before_ordinary_ACK")
        target = "result.json" if mode == "paid" else "free-result.json"
        if not self.has(target): self.put(target, self.record(completed=True, mode=mode, source=actor, native=native,
            sourceKernelSessions=sessions, intentSha256=self.digest(name), financialReceiptSha256=self.config["financialReceiptSha256"], disabledReceiptSha256=disabled_sha))
        need(self.journal(target)["source"] == actor, "same_ordinary_source_ACK_epoch_required")
        return {"acknowledged": True, "mode": mode, "receiptSha256": self.digest(target)}

    def known_source(self):
        rows = {(x["pid"],x["startTicks"]):x for x in self.old.owner.known_source_processes()}
        for name in ["result.json", "free-result.json"]:
            if self.has(name):
                for row in self.journal(name)["source"]["processes"]: rows[(row["pid"],row["startTicks"])]=row
        return list(rows.values())

    def stop_source(self):
        name = "source-stop-intent.json"
        if not self.has(name):
            state = self.h.source.state(SOURCE); actor = self.source_actor(stop=True)[0] if state["MainPID"] != "0" else None
            self.put(name, self.record(actor=actor, knownProcesses=self.known_source()))
            if actor is not None:
                need(self.source_actor(stop=True)[0] == actor, "owned_source_final_health_independent_stop_CAS")
                self.manager("stop", SOURCE)
        row = self.journal(name)
        self.old.owner.process_terminal(SOURCE, row["knownProcesses"] + ([] if row["actor"] is None else row["actor"]["processes"]))
        # Source DB health cannot prevent stopping owned processes or returning
        # the proxies. Full writer/backend qualification remains a separate gate.
        drained = True
        try: self.h.source_sessions(None)
        except (RuntimeError, OSError): drained = False
        if not self.has("source-stopped.json"): self.put("source-stopped.json", self.record(sourceProcessesTerminal=True, sourceDrainedQualified=drained, intentSha256=self.digest(name)))
        return {"sourceStopped": True, "sourceDrainedQualified": drained}

    def return_free(self):
        if self.has("free-result.json"):
            self.current(self.digest("free-result.json"))
            return {"paidRequestsQuiet": True, "financialDisabled": True, "sourceRestoredFree": True}
        self.stop_source(); op = self.operation()
        for chain in CHAINS:
            original = op["originalFreeRoutes"][chain]; unit = self.h.proxy_unit(chain)
            if self.has(chain + "-free-started.json"):
                self.free_routes_current(chain); continue
            if self.has(chain + "-free-start-intent.json"):
                self.observe_free(chain); continue
            if not self.has(chain + "-start-intent.json") and not os.path.lexists(self.h.proxy_drop(chain)):
                actual = self.old.h.free_route(chain)
                need(actual == original, "never_switched_proxy_must_remain_exact_original")
                self.put(chain + "-free-started.json", self.record(actor=actual["actor"], retainedOriginal=True)); continue
            stop = chain + "-stop-paid-intent.json"
            if not self.has(stop):
                state = self.h.a.state(self.h.rpc_m, unit); actor = self.proxy_actor(chain, True) if state["MainPID"] != "0" else None
                self.put(stop, self.record(actor=actor, ownedBackends=[] if actor is None else self.h.proxy_sessions(chain,actor)))
                if actor is not None:
                    need(self.proxy_actor(chain,True) == actor, "owned_proxy_final_health_independent_stop_CAS"); self.manager("stop",unit)
            stopped = self.journal(stop); processes = [] if stopped["actor"] is None else stopped["actor"]["processes"]
            self.terminal(unit,processes + original["actor"]["processes"]); self.old.owner.budget_backends_gone(stopped["ownedBackends"])
            if os.path.lexists(self.h.proxy_drop(chain)):
                self.move(chain+"-remove",self.h.proxy_drop(chain),HOLD/(chain+".removed.conf"),op["overlays"][chain])
            self.reload(chain+"-free"); start=chain+"-free-start-intent.json"
            if not self.has(start):
                self.put(start,self.record(notBeforeUs=self.m.mono()));self.terminal(unit,processes);self.manager("start",unit)
            self.observe_free(chain)
        self.leaf.assert_no_paid_proxy_processes(); self.quiet_current()
        if not self.has("quiet.json"):self.put("quiet.json",self.record(paidRequestsQuiet=True,sourceTerminal=True,routes={c:self.journal(c+"-free-started.json")for c in CHAINS}))
        return {"paidRequestsQuiet":True,"receiptSha256":self.digest("quiet.json"),"financialDisabled":False}

    def observe_free(self, chain):
        original=self.operation()["originalFreeRoutes"][chain];intent=self.journal(chain+"-free-start-intent.json")
        stop=self.journal(chain+"-stop-paid-intent.json")
        self.old.ns.gone([]if stop["actor"]is None else stop["actor"]["processes"])
        self.old.owner.budget_backends_gone(stop["ownedBackends"])
        actual=self.old.ns.wait_read(lambda:self.old.h.free_route(chain))
        need(intent["notBeforeUs"] <= actual["actor"]["startMonotonicMicroseconds"] <= intent["notBeforeUs"] + 130000000 and
             self.h.a.state(self.h.rpc_m,self.h.proxy_unit(chain))["NRestarts"] == "0" and actual["actor"]["invocation"]!=original["actor"]["invocation"] and
             {k:v for k,v in actual.items()if k!="actor"}=={k:v for k,v in original.items()if k!="actor"},"exact_new_free_proxy_program_private_security_boot_epoch_required")
        need(self.old.h.free_route(chain)==actual,"actual_free_proxy_final_CAS_after_old_budget_drain")
        name=chain+"-free-started.json"
        if not self.has(name):self.put(name,self.record(actor=actual["actor"],retainedOriginal=False,intentSha256=self.digest(chain+"-free-start-intent.json")))
        need(self.journal(name)["actor"]==actual["actor"],"same_once_started_free_proxy_ACK_required")

    def free_routes_current(self, only=None):
        for chain in [only]if only else CHAINS:
            row=self.journal(chain+"-free-started.json")
            need(self.old.h.free_route(chain)["actor"]==row["actor"],"same_restored_free_proxy_epoch_required")
            if not row["retainedOriginal"]:
                stopped=self.journal(chain+"-stop-paid-intent.json")
                self.old.ns.gone([]if stopped["actor"]is None else stopped["actor"]["processes"])
                self.old.owner.budget_backends_gone(stopped["ownedBackends"])

    def quiet_current(self):
        self.old.owner.process_terminal(SOURCE,self.known_source());self.leaf.assert_no_paid_proxy_processes()
        self.free_routes_current()

    def disabled_current(self, receipt_sha):
        need(self.m.pin(receipt_sha) and self.fo.digest("disabled.json")==receipt_sha,"actual_separate_ordinary_disabled_ACK_required")
        row=self.fo.receipt("disabled.json");review=self.fo.reviewed(row["reviewSha256"])
        need(review["proposal"]==self.plan,"disabled_ACK_must_reference_same_actual_ordinary_permits")
        current=self.fo.h.snapshot();self.fo.disabled(review["before"],current,review["proposal"])
        self.financial.monotonic(self.fo.m,row["after"],current);self.fo.h.immutable()
        need(row["committed"]is True,"acknowledged_ordinary_disable_required")

    def current(self, result_sha, retained_current=None, inverse=False):
        target="free-result.json"if self.has("free-result.json")else"result.json"
        need(self.digest(target)==result_sha,"actual_own_ordinary_source_receipt_SHA_required")
        row=self.journal(target);mode=row["mode"];self.static();self.retired_current()
        if inverse:
            self.journal("source-stopped.json");self.loaded_source(mode)
            self.terminal(SOURCE,self.known_source(),retained_current)
            return self.record(validated=True,sourceState="owned-terminal",terminalInverseOnly=True,currentWriterQualified=False,
                receiptSha=result_sha,sourceActorQualified=False,financialAuthorityQualified=False,databaseWrites=0,serviceActions=0,providerCalls=0)
        actor,native=self.source_actor(mode);need(actor==row["source"],"same_current_ordinary_source_acknowledged_epoch")
        if mode=="paid":
            self.financial_current()
            for c in CHAINS:need(self.proxy_actor(c)==self.journal(c+"-started.json")["actor"],"same_current_four_ordinary_proxy_epochs")
        else:
            self.disabled_current(row["disabledReceiptSha256"]);self.free_routes_current();self.leaf.assert_no_paid_proxy_processes()
        sessions=self.h.source_sessions(actor,retained_current)
        need(self.source_actor(mode)[0]==actor,"source_epoch_changed_after_positive_kernel_attribution")
        binding=self.record(receiptSha=result_sha,currentEpochReceiptSha256=self.digest(target),sourceBoot=self.original["sourceBoot"],
            sourcePrivateInputSha256=sha(encoded(self.original["sourcePrivateInputs"])),source=actor,
            retiredReceiptSha256=self.digest("retired.json"),financialReceiptSha256=self.config["financialReceiptSha256"],
            financialProducerSha256=PINS["ypal-alchemy-ordinary-financial-v1.py"],disabledReceiptSha256=row["disabledReceiptSha256"],
            routingMode=mode,chainRouting={c:self.p.proxy_mode(c)if mode=="paid"else"free_first"for c in CHAINS},
            profileId=self.plan["profileId"],manifestHash=self.plan["manifestHash"],profileExpiresMs=self.plan["expiresMs"],
            ordinaryPolicy=self.plan["ordinaryPolicy"],permitIds=[p["permitId"]for p in self.plan["permits"]],
            nativeIdentity={"schemaOid":native["schemaOid"],"tables":native["tables"],"cache":native["cache"],"buildId":native["app"]["build_id"]})
        return self.record(validated=True,sourceState="acknowledged-active",terminalInverseOnly=False,receiptSha=result_sha,
            sourceRelease=self.c.fowner.m.RELEASE,manifestHash=self.c.fowner.m.MANIFEST,schema="unified_ypal_20261023_v1",schemaOid=native["schemaOid"],
            buildId=native["app"]["build_id"],nativeTables=native["tables"],sourceKernelActors={SOURCE:actor},
            currentWriterQualified=True,sourceReadinessQualified=str(native["app"]["is_ready"])=="1",currentCanonicalCoverageQualified=False,
            financialAuthorityQualified=False,managedHandoverAllowed=mode=="free",ordinaryFinancialClosed=mode=="free",routingMode=mode,
            chainRouting={c:self.p.proxy_mode(c)if mode=="paid"else"free_first"for c in CHAINS},
            binding=binding,bindingSha256=sha(encoded(binding)),
            observation={"native":native,"positiveKernelSessions":sum(map(len,sessions.values()))},
            databaseWrites=0,serviceActions=0,providerCalls=0)


def validate_current_source(result_sha, input_sha, retained_current=None, inverse=False):
    return Owner(input_sha).current(result_sha, retained_current, inverse)


def sources():
    return {"format": FORMAT + "-sources", "producerSha256": own_sha(), "dependencies": PINS,
            "newSourceAndProxyEpochs": True, "databaseWrites": 0, "financialAdmissionPerformed": False,
            "historicalReceiptsRewritten": False}


def input_value(financial_receipt_sha, financial_input_sha):
    need(all(isinstance(x, str) and re.fullmatch("[a-f0-9]{64}", x) and x != "0" * 64
             for x in [financial_receipt_sha, financial_input_sha]), "two_actual_ordinary_financial_hashes_required")
    return {"format": FORMAT + "-input", "financialReceiptSha256": financial_receipt_sha, "financialInputSha256": financial_input_sha}


def output(value):
    # Full source actors, mount/private paths and native observations are an
    # in-process component interface. CLI output is a finite safe aggregate.
    allowed = {"prepared", "operationSha256", "retired", "oldUnits", "oldBoots", "chain", "acknowledged", "mode", "receiptSha256",
               "paidRequestsQuiet", "financialDisabled", "sourceRestoredFree", "validated", "sourceState", "terminalInverseOnly",
               "receiptSha", "currentWriterQualified", "sourceReadinessQualified", "currentCanonicalCoverageQualified",
               "financialAuthorityQualified", "managedHandoverAllowed", "ordinaryFinancialClosed", "routingMode", "chainRouting", "bindingSha256"}
    result = {key:item for key,item in value.items() if key in allowed}
    if "nativeTables" in value: result["nativeTableCount"] = len(value["nativeTables"])
    if "observation" in value: result["positiveKernelSessions"] = value["observation"]["positiveKernelSessions"]
    print(json.dumps({"format":FORMAT,**result,"databaseWrites":0,"providerCalls":0},sort_keys=True))


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--input-sha");g=p.add_mutually_exclusive_group()
    g.add_argument("--sources",action="store_true");g.add_argument("--input",nargs=2,metavar=("FINANCIAL_ACK_SHA", "FINANCIAL_INPUT_SHA"))
    g.add_argument("--prepare",action="store_true");g.add_argument("--retire",action="store_true");g.add_argument("--proxy",choices=CHAINS)
    g.add_argument("--start",action="store_true");g.add_argument("--return-free",action="store_true");g.add_argument("--resume-free")
    g.add_argument("--current");g.add_argument("--reload");a=p.parse_args()
    if a.sources: print(json.dumps(sources(),sort_keys=True));return
    if a.input: print(json.dumps(input_value(*a.input),sort_keys=True));return
    if not any([a.prepare,a.retire,a.proxy,a.start,a.return_free,a.resume_free,a.current,a.reload]):
        print(json.dumps({"format":FORMAT,"sourceOnly":True,"databaseWrites":0,"serviceActions":0,"providerCalls":0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=="yunipals-main","fixed_root_production_host_required")
    os.umask(0o077);signal.signal(signal.SIGALRM,lambda *_:need(False,"bounded_ordinary_runtime_timeout"));signal.alarm(600)
    o=Owner(a.input_sha)
    with o.old.v.transition_lock(o.m):
        if a.prepare:r=o.prepare()
        elif a.retire:r=o.retire()
        elif a.proxy:r=o.switch_proxy(a.proxy)
        elif a.start:r=o.start_source()
        elif a.return_free:r=o.return_free()
        elif a.resume_free:r=o.start_source("free",a.resume_free)
        elif a.current:r=o.current(a.current)
        else:r=o.reload(a.reload,True)
    output(r or {})


if __name__=="__main__":
    try:main()
    except BaseException as error:
        print(json.dumps({"format":FORMAT,"completed":False,"errorClass":type(error).__name__,"rawMessagesExported":False,"automaticRetryAllowed":False}));raise SystemExit(1)
