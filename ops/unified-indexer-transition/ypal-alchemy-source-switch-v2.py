#!/usr/bin/env python3
"""Continue the actual ACTIVE v1 window; no second admission or extension.

Frozen business functions execute in new, explicit namespaces. Original source
modules, operation, financial admission and timer records are never modified.
"""
import argparse
import ast
import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import time
import types

FORMAT = "yunipals-alchemy-source-switch-v2"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-ypal-alchemy-source-switch-v2-20261024")
HOLD = Path("/etc/systemd/system/.ypal-alchemy-source-switch-v2")
CLOSE_BASE = Path("/var/backups/yunipals-ypal-alchemy-close-v2-20261024")
MANIFEST = OPS / "ypal-alchemy-source-switch-v2.sources.json"
INPUT = OPS / "ypal-alchemy-source-switch-v2.input.json"
PARENT = {
    "operatorSha256": "7ae9a516fe1145f25676ba97e98c92a86123bf8797cf7758537ef7fde855f5a6",
    "operationSha256": "517ea7a2d2dd79e16f92b2a397401edea158786b78213aee1aedc043f178ecca",
    "manifestSha256": "9c78438c4fa1b6a1b268a9f5f64b26081af3e5c8f5a9a8d7095714c0ac5a77b9",
    "inputSha256": "bda332121fd92efa31899638336637215392f9216627b979434eb312340b1733",
    "financialResultSha256": "546cd1d3273fc400e001b1816b635b1ec8d9c8adf2537d776357bddc3916d170",
    "planSha256": "8170ecb947f0d7e133d88c90f8211979cae48515ca61cdcf1cc1ad7a628e8e8b"
}
FILES = {
    "business": ("ypal-alchemy-source-switch-v1.py", PARENT["operatorSha256"]),
    "plan": ("ypal-alchemy-source-switch-v1.plan.py", "3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56"),
    "host": ("ypal-alchemy-source-switch-v1.host.py", "3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02"),
    "leaf": ("ypal-alchemy-primary-current-v1.py", "753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215"),
    "financial": ("ypal-alchemy-catchup-financial-v1.py", "19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803"),
    "identity": ("ypal-alchemy-source-identity-v2.py", "01e9bfb127a29edeb6a985702a3d921d706186c8a3680e8c3765bce5f68321c2")
}


def need(ok, code):
    if not ok: raise RuntimeError(code)


def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
def sha(raw): return hashlib.sha256(raw).hexdigest()


def source(path, digest):
    path = Path(path)
    for parent in [*path.parents, path]:
        st = parent.lstat()
        need(st.st_uid == 0 and not st.st_mode & 0o022 and not parent.is_symlink(), "protected_exact_successor_source_required")
    raw = path.read_bytes(); need(sha(raw) == digest, "exact_frozen_successor_dependency_required")
    return raw


def namespace(raw, filename, replacements=None, strings=None):
    """Only declared top-level assignments/literal identities change pre-exec."""
    replacements = replacements or {}; strings = strings or {}
    tree = ast.parse(raw, str(filename))
    seen = set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in replacements:
            key = node.targets[0].id; node.value = ast.parse(replacements[key], mode="eval").body; seen.add(key)
    need(seen == set(replacements), "all_declared_namespace_assignment_seams_must_exist")
    class Literals(ast.NodeTransformer):
        def visit_Constant(self, node):
            if isinstance(node.value, str) and node.value in strings:
                return ast.copy_location(ast.Constant(strings[node.value]), node)
            return node
    tree = Literals().visit(tree); ast.fix_missing_locations(tree)
    module = types.ModuleType("explicit_alchemy_v2_" + Path(filename).stem)
    module.__file__ = str(filename)
    exec(compile(tree, str(filename), "exec"), module.__dict__)
    return module


def dependencies(directory=OPS):
    return {key: source(Path(directory) / file, digest) for key, (file, digest) in FILES.items()}


def source_manifest(directory=OPS):
    directory = Path(directory); dependencies(directory)
    return {"format": FORMAT + "-sources", "lifecycle": {"file": Path(__file__).name, "sha256": sha(Path(__file__).read_bytes())},
            "parent": PARENT, "dependencies": {key: {"file": file, "sha256": digest} for key, (file, digest) in FILES.items()}}


def canonical_security(value):
    result = copy.deepcopy(value)
    for key in ["Requires", "Wants"]:
        tokens = result[key].split()
        need(len(tokens) == len(set(tokens)), "unique_systemd_dependency_tokens_required")
        result[key] = " ".join(sorted(tokens))
    return result


def typed_command(m, unit):
    obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in unit)
    return json.loads(m.command(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", obj,
                                 "org.freedesktop.systemd1.Service", "ExecStart"]))


def proxy_program(m, unit, node, artifact):
    typed = typed_command(m, unit)
    need(typed["type"] == "a(sasbttttuii)" and len(typed["data"]) == 1, "one_typed_proxy_program_required")
    row = typed["data"][0]
    need(len(row) == 10 and row[:3] == [node, [node, str(artifact)], False] and type(row[2]) is bool and
         all(type(v) is int for v in row[3:]), "exact_typed_proxy_executable_arguments_required")
    return {"path": row[0], "argv": row[1], "ignoreFailure": row[2]}


def source_restore(restore, h, m, identity, unit):
    class Restore:
        def __getattr__(self, key): return getattr(restore, key)
        def canonical_actor(self, actor):
            actor = restore.canonical_actor(actor)
            if actor["unit"].get("Id") == unit:
                identity.program_identity(actor, typed_command(m, unit))
                if "ExecStart" in actor["unit"]:
                    actor = identity.epoch_identity(actor)
                else:
                    current = restore.canonical_actor(h.source.actor(unit))
                    identity.program_identity(current, typed_command(m, unit))
                    need(actor == identity.epoch_identity(current), "projected_source_must_equal_current_actual_typed_epoch")
            return actor
    return Restore()


def close_owner_class(f, original, financial):
    class CloseOwner(f.Owner):
        def admitted(self, result_sha):
            need(result_sha == PARENT["financialResultSha256"], "original_financial_admission_only")
            return original.admitted(result_sha)
        def validate_admission_before(self, current, row):
            financial.validate_current(PARENT["financialResultSha256"])
        def transaction(self, phase, *args, **kwargs):
            need(phase in {"close", "utc"}, "successor_cannot_admit_or_rearm")
            return super().transaction(phase, *args, **kwargs)
    return CloseOwner


def build(manifest_sha, input_sha):
    raw = dependencies(); own = Path(__file__).absolute()
    original = namespace(raw["business"], OPS / FILES["business"][0])
    prior_context = original.Context(PARENT["manifestSha256"], PARENT["inputSha256"])
    prior = original.Owner(prior_context); old = prior.operation()
    m = prior.m
    need(prior.digest("operation.json") == PARENT["operationSha256"] and old["planSha256"] == PARENT["planSha256"], "exact_actual_parent_operation_required")
    manifest = m.document(MANIFEST, manifest_sha); config = m.document(INPUT, input_sha)
    need(manifest == source_manifest() and config == {**prior_context.config, "format": FORMAT + "-input", "parent": PARENT},
         "exact_successor_manifest_and_actual_parent_input_required")
    identity = namespace(raw["identity"], OPS / FILES["identity"][0])
    p = namespace(raw["plan"], own, {"BASE": "Path(" + repr(str(BASE)) + ")",
        "LIFECYCLE": "Path(" + repr(str(own)) + ")", "FINANCIAL_BASE": "Path(" + repr(str(CLOSE_BASE)) + ")"}, {"-v1": "-v2"})
    leaf = namespace(raw["leaf"], own, {"BASE": "Path(" + repr(str(BASE)) + ")", "MANIFEST": "Path(" + repr(str(MANIFEST)) + ")",
        "LIFECYCLE": "Path(" + repr(str(own)) + ")", "FORMAT": repr("yunipals-alchemy-primary-current-v2")},
        {"yunipals-alchemy-source-switch-v1-sources": FORMAT + "-sources", "yunipals-alchemy-source-switch-v1-admission-link": FORMAT + "-admission-link",
         "yunipals-alchemy-source-switch-v1-paid-quiet": FORMAT + "-paid-quiet", "yunipals-alchemy-source-switch-v1-deadline-prepared": FORMAT + "-deadline-prepared",
         **{name: name.replace("-v1.", "-v2.") for name in prior.leaf.DEADLINES}})
    # New namespace only: the original frozen leaf and its globals are untouched.
    raw_security = leaf.unit_security
    leaf.unit_security = lambda client, unit: canonical_security(raw_security(client, unit))
    ns = namespace(raw["business"], own, {"FORMAT": repr(FORMAT), "BASE": "Path(" + repr(str(BASE)) + ")",
        "HOLD": "Path(" + repr(str(HOLD)) + ")", "MANIFEST": "Path(" + repr(str(MANIFEST)) + ")",
        "INPUT": "Path(" + repr(str(INPUT)) + ")", "FINANCIAL_BASE": "Path(" + repr(str(CLOSE_BASE)) + ")"})
    host_module = prior_context.host_module
    h = host_module.Host(p, leaf)
    restore = h.restore
    h.restore = source_restore(restore, h, m, identity, ns.SOURCE)
    raw_free = h.free_route; raw_paid = h.paid_route
    def free_route(chain):
        value = raw_free(chain); proxy_program(m, h.proxy_unit(chain), h.a.NODE, leaf.FREE_ARTIFACT)
        return value
    def paid_route(chain, *args):
        value = raw_paid(chain, *args); proxy_program(m, h.proxy_unit(chain), h.a.NODE, p.STAGE / "rpc-budget-proxy.mjs")
        return value
    h.free_route = free_route; h.paid_route = paid_route
    # Reuse only exact five already-owned public inputs. Every new journal,
    # overlay and deadline file remains exclusive and no-replace.
    exclusive = p.exclusive
    def public_or_exclusive(path, data, mode=0o600):
        path = Path(path)
        if path.parent == p.STAGE and path.name in old["publicFiles"]:
            expected = old["publicFiles"][path.name]
            need(sha(m.protected(path)) == sha(data) == expected["sha256"] and p.identity(path) == expected["identity"],
                 "exact_parent_owned_public_file_inode_and_bytes_required")
            return copy.deepcopy(expected)
        return exclusive(path, data, mode)
    p.exclusive = public_or_exclusive
    c = ns.Context.__new__(ns.Context)
    c.__dict__.update(prior_context.__dict__)
    c.manifest_sha = manifest_sha; c.input_sha = input_sha; c.manifest = {**prior_context.manifest, "format": FORMAT + "-sources", "lifecycle": manifest["lifecycle"]}
    c.config = config; c.p = p; c.leaf = leaf; c.h = h
    # The original immutable/dependency checks expect their original manifest
    # fields. This explicit successor checks both actual files, then delegates
    # only the source/static/dependency portions without rewriting either file.
    def immutable(operation):
        need(m.document(MANIFEST, manifest_sha) == manifest and m.document(INPUT, input_sha) == config and source_manifest() == manifest,
             "successor_public_sources_and_input_must_stay_exact")
        need(h.source.inputs() == operation["inputs"] and m.link_record(h.r.BOOT) == operation["sourceBoot"] and
             c.retained() == operation["retainedRPC"], "same_source_private_boot_and_retained_RPC_required")
        c.private_current(operation); c.stage_current()
    c.immutable = immutable
    original_stage = ns.Context.stage_current
    c.stage_current = lambda initial=False: original_stage(c, False)
    def parent_current():
        prior_context.financial.validate_current(PARENT["financialResultSha256"])
        need(not prior.exists("source-initial-stop-intent.json") and not prior.exists("paid-quiet.json") and
             not any(prior.exists(chain + "-paid-start-intent.json") for chain in p.CHAINS), "parent_must_have_no_runtime_or_close_effects")
        actual = restore.canonical_actor(h.source.actor(ns.SOURCE))
        identity.compare_same_epoch(old["source"], actual, typed_command(m, ns.SOURCE))
        need(h.definitions(h.source.state(ns.SOURCE)) == old["sourceDefinitions"] and h.source.runtime_properties() == old["sourceRuntime"] and
             h.source.inputs() == old["inputs"] and m.link_record(h.r.BOOT) == old["sourceBoot"] and
             c.source_bindings() == old["sourceBindings"] and c.source_private_inputs(actual) == old["sourcePrivateInputs"],
             "complete_parent_source_static_private_six_mount_identity_required")
        h.r.recovery_floor(old["native"], h.source.native())
        for chain in p.CHAINS:
            before = copy.deepcopy(old["originalFreeRoutes"][chain]); before["unitSecurity"] = canonical_security(before["unitSecurity"])
            need(h.free_route(chain) == before, "only_parent_proxy_dependency_order_may_differ")
        return {"validated": True, "parentOperationSha256": PARENT["operationSha256"], "originalWholeValidatorPassed": False}
    h.initial_current = parent_current
    # Close-only successor reuses the frozen model, Client and XID protocol.
    f = namespace(raw["financial"], own, {"FORMAT": repr("yunipals-ypal-alchemy-close-v2"), "BASE": "Path(" + repr(str(CLOSE_BASE)) + ")"})
    class FinancialHost:
        def __getattr__(self, key): return getattr(prior_context.fowner.h, key)
        def quiet(self, quiet_sha, result_sha):
            need(result_sha == PARENT["financialResultSha256"], "only_original_actual_admission_may_close")
            return leaf.validate_paid_quiet(quiet_sha, result_sha)
        def unchanged_sources(self):
            prior_context.fowner.h.unchanged_sources()
            need(source_manifest() == manifest, "same_successor_before_financial_COMMIT_required")
    CloseOwner = close_owner_class(f, prior_context.fowner, prior_context.financial)
    closer = CloseOwner(FinancialHost())
    f.acknowledgement = prior_context.financial.acknowledgement
    c.fowner = closer
    class Financial:
        financial_lock = staticmethod(prior_context.financial.financial_lock)
        acknowledgement = staticmethod(prior_context.financial.acknowledgement)
        def validate_current(self, result_sha):
            need(not any((CLOSE_BASE / name).exists() for name in ["close-commit-attempt.json", "close-commit-intent.json", "utc-commit-attempt.json", "utc-commit-intent.json"]),
                 "successor_closure_started_no_paid_effects_allowed")
            proof = prior_context.financial.validate_current(result_sha)
            if (BASE / "operation.json").exists():
                owner = ns.Owner(c)
                leaf.validate_deadline_prepared(PARENT["planSha256"], owner.digest("deadline-prepared.json"))
            return proof
    c.financial = Financial()
    # Review uses the actual ACTIVE admission, never a second fresh-admit check.
    closer.prepared = lambda: {**prior_context.fprepared}
    business_owner = ns.Owner
    class Owner(business_owner):
        def review(self):
            value, review = super().review()
            value["parent"] = PARENT; value["sourceIdentityProjection"] = "typed-program-and-epoch-without-volatile-ExecStart"
            return value, sha(encoded({"businessReview": review, "parent": PARENT}))
        def prepare(self, review_sha):
            result = super().prepare(review_sha)
            CLOSE_BASE.mkdir(mode=0o700); m.sync(CLOSE_BASE.parent)
            prepared = copy.deepcopy(prior_context.fprepared)
            prepared.update(format=f.FORMAT, operatorSha256=sha(m.protected(own)), parentAdmissionSha256=PARENT["financialResultSha256"], admissionAlreadyCommitted=True)
            m.save(CLOSE_BASE / "plan.json", c.plan); m.save(CLOSE_BASE / "prepared.json", prepared)
            self.admission()
            return {**result, "financialAdmitted": True, "parentAdmissionAlreadyCommitted": True, "newFinancialAdmission": False}
        def install_deadlines(self):
            need((CLOSE_BASE / "prepared.json").exists(), "actual_successor_close_context_required_before_timers")
            inherited_prepared(closer); self.admission()
            return super().install_deadlines()
        def operation(self):
            value = super().operation(); need(value["parent"] == PARENT, "exact_actual_active_parent_ancestry_required")
            return value
        def admission(self, result_sha=None, active=False):
            if result_sha is not None: need(result_sha == PARENT["financialResultSha256"], "only_original_admission_link_allowed")
            return super().admission(PARENT["financialResultSha256"], active)
    ns.Owner = Owner
    # After preparation all close proofs authenticate their own immutable chain.
    inherited_prepared = f.Owner.prepared
    def prepared():
        if (CLOSE_BASE / "prepared.json").exists(): return inherited_prepared(closer)
        return copy.deepcopy(prior_context.fprepared)
    closer.prepared = prepared
    return ns, c, Owner(c), manifest


@contextlib.contextmanager
def transition_lock(m):
    # The preserved old timers share this lock. Waiting for their read-only
    # refusal is safe; no manager/SQL action is retried by this acquisition.
    end = time.monotonic() + 45
    while True:
        lock = m.lock()
        try:
            lock.__enter__()
            break
        except BlockingIOError:
            need(time.monotonic() < end, "bounded_transition_lock_wait_expired")
            time.sleep(0.25)
    try: yield
    finally: lock.__exit__(None, None, None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest-sha"); parser.add_argument("--input-sha")
    actions = parser.add_mutually_exclusive_group()
    for flag in ["sources", "input", "review", "install-deadlines", "stop-source", "start-paid-source", "resume-free-source", "close", "utc"]:
        actions.add_argument("--" + flag, action="store_true")
    for flag in ["prepare", "switch-proxy", "deadline-close", "deadline-utc", "complete-config-reload"]:
        actions.add_argument("--" + flag)
    args = parser.parse_args()
    if args.sources: print(json.dumps(source_manifest(Path(__file__).parent), sort_keys=True)); return
    if args.input:
        raw = dependencies(); original = namespace(raw["business"], OPS / FILES["business"][0]); h = namespace(raw["host"], OPS / FILES["host"][0])
        leaf = h.load(OPS / FILES["leaf"][0], FILES["leaf"][1]); value = leaf.document(original.INPUT, PARENT["inputSha256"])
        print(json.dumps({**value, "format": FORMAT + "-input", "parent": PARENT}, sort_keys=True)); return
    if not any(v for key, v in vars(args).items() if key not in {"manifest_sha", "input_sha"}):
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "newAdmission": False, "serviceActions": 0, "databaseWrites": 0, "providerCalls": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_production_root_host_required")
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_unknown_outcome_no_retry")); signal.alarm(850)
    if args.deadline_close or args.deadline_utc:
        h = namespace(source(OPS / FILES["host"][0], FILES["host"][1]), OPS / FILES["host"][0])
        leaf = h.load(OPS / FILES["leaf"][0], FILES["leaf"][1]); op = json.loads(leaf.protected(BASE / "operation.json"))
        need(op["planSha256"] == (args.deadline_close or args.deadline_utc) == PARENT["planSha256"], "original_literal_plan_deadline_only")
        args.manifest_sha, args.input_sha = op["manifestSha256"], op["inputSha256"]
    ns, context, owner, _ = build(args.manifest_sha, args.input_sha)
    with transition_lock(owner.m):
        if args.review: value = {"reviewHash": owner.review()[1], "serviceActions": 0, "databaseWrites": 0}
        elif args.prepare: value = owner.prepare(args.prepare)
        elif args.install_deadlines: value = owner.install_deadlines()
        elif args.stop_source: owner.admission(active=True); value = owner.source_stop("initial")
        elif args.switch_proxy: value = owner.switch_proxy(args.switch_proxy)
        elif args.start_paid_source: value = owner.start_source("paid")
        elif args.resume_free_source: value = owner.start_source("free")
        elif args.complete_config_reload: value = owner.complete_reload(args.complete_config_reload)
        else: value = owner.close(utc=bool(args.utc or args.deadline_utc), resume=bool(args.deadline_close))
    if value.get("terminal"): value = {"sourceTerminal": True, "receiptRecorded": True}
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    try: main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False, "fixedCode": str(error) if type(error) is RuntimeError and re.fullmatch("[A-Za-z0-9_]+", str(error)) else type(error).__name__, "automaticRetryAllowed": False}))
        raise SystemExit(1)
