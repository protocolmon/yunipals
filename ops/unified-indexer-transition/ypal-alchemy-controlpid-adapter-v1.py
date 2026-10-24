#!/usr/bin/env python3
"""One API-shape adapter around the actual frozen v2 operation.

No new lifecycle namespace, admission, permit, source program or policy. The
only business seam supplies the actual typed ControlPID missing from a.state.
"""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import socket
import types

FORMAT = "yunipals-alchemy-controlpid-adapter-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BUSINESS = OPS / "ypal-alchemy-source-switch-v2.py"
BUSINESS_SHA = "440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f"
OPERATION_SHA = "f6879e532d6b9e3f6da4639d93181ee1fde954a57468fa5171039fd2081f5cb0"
MANIFEST_SHA = "839b4c9da45fbdc2b1ed52f9f777676abdd47af3abb31f3b3ed104764c233863"
INPUT_SHA = "1338ec569efeee14b221319bac5560047dea903c36e009c848f5c12a46f1d48d"
BASE = Path("/var/backups/yunipals-alchemy-controlpid-adapter-v1-20261024")
SYSTEM = Path("/etc/systemd/system")
HOLD = SYSTEM / ".ypal-alchemy-controlpid-adapter-v1"
CGROUP = Path("/sys/fs/cgroup/system.slice")
CHAINS = ("ethereum", "base", "polygon", "bnb")
UNITS = {"yunipals-combined-rpc@" + chain + ".service" for chain in CHAINS}


def need(ok, code):
    if not ok: raise RuntimeError(code)


def business():
    import hashlib
    for path in [*BUSINESS.parents, BUSINESS]:
        st = path.lstat(); need(st.st_uid == 0 and not st.st_mode & 0o022 and not path.is_symlink(), "protected_original_business_source_required")
    raw = BUSINESS.read_bytes(); need(hashlib.sha256(raw).hexdigest() == BUSINESS_SHA, "exact_actual_frozen_business_required")
    module = types.ModuleType("actual_frozen_alchemy_v2"); module.__file__ = str(BUSINESS)
    exec(compile(raw, str(BUSINESS), "exec"), module.__dict__)
    return module


def control_pid(m, unit):
    need(unit in UNITS, "only_four_owned_proxy_ControlPID_properties_allowed")
    obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in unit)
    value = json.loads(m.command(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", obj,
                                  "org.freedesktop.systemd1.Service", "ControlPID"]))
    need(value.get("type") == "u" and type(value.get("data")) is int and 0 <= value["data"] < 2**32,
         "actual_typed_Service_ControlPID_required_never_assumed_zero")
    return value["data"]


def adapt(owner, ns):
    original = owner.process_terminal
    def process_terminal(unit, processes):
        if unit not in UNITS:
            return original(unit, processes)
        ns.gone(processes)
        before = owner.h.a.state(owner.h.rpc_m, unit); first = control_pid(owner.m, unit)
        group = CGROUP / unit / "cgroup.procs"
        need(before["MainPID"] == "0" and first == 0 and before["ActiveState"] in {"inactive", "failed"} and
             (not group.exists() or not group.read_text().split()), "owned_proxy_unit_cgroup_and_real_ControlPID_must_be_terminal")
        after = owner.h.a.state(owner.h.rpc_m, unit); second = control_pid(owner.m, unit)
        need(after == before and second == first and (not group.exists() or not group.read_text().split()),
             "proxy_terminal_state_ControlPID_and_cgroup_changed_during_proof")
        ns.gone(processes)
        return None
    owner.process_terminal = process_terminal
    return owner


def audit(owner, module, capture=False):
    op = owner.operation()
    need(owner.digest("operation.json") == OPERATION_SHA and op["manifestSha256"] == MANIFEST_SHA and op["inputSha256"] == INPUT_SHA,
         "only_exact_actual_stopped_source_operation_may_use_adapter")
    value = {"format": FORMAT, "adapterSha256": module.sha(owner.m.protected(Path(__file__).absolute())),
             "businessSha256": BUSINESS_SHA, "operationSha256": OPERATION_SHA, "manifestSha256": MANIFEST_SHA,
             "inputSha256": INPUT_SHA, "bootId": owner.m.boot(), "scope": "typed-ControlPID-for-exact-four-proxy-terminal-checks",
             "oldRecordsRewritten": False, "newFinancialAdmission": False, "expiryExtended": False}
    path = BASE / "composition.json"
    if not path.exists():
        need(capture, "explicit_composition_capture_required_before_adapter_effects")
        need(not os.path.lexists(BASE), "fresh_adapter_audit_directory_required")
        BASE.mkdir(mode=0o700); owner.m.sync(BASE.parent); owner.m.save(path, value)
    need(owner.m.document(path) == value, "exact_same_boot_adapter_composition_required")
    return module.sha(owner.m.protected(path))


def definitions(owner, module):
    op = owner.operation(); plan = op["financialPlan"]; result = {}
    for name, data in owner.p.deadline_definitions(plan, op["planSha256"]).items():
        replacement = name.replace("yunipals-alchemy-catchup-", "yunipals-alchemy-controlpid-").replace("-v2.", "-v1.")
        text = data.decode().replace("yunipals-alchemy-catchup-", "yunipals-alchemy-controlpid-").replace("-v2.service", "-v1.service")
        text = text.replace(str(BUSINESS), str(Path(__file__).absolute()))
        text = text.replace("ReadWritePaths=", "ReadWritePaths=" + str(BASE) + " ")
        if name.endswith(".timer") and "-close-" in name:
            text = text.replace("OnCalendar=" + owner.p.calendar(plan["expiresMs"]),
                                "OnCalendar=" + owner.p.calendar(plan["expiresMs"] - 300000))
        result[replacement] = text.encode()
    need(len(result) == 4, "exact_two_supplemental_services_and_timers_required")
    return result


def guards_current(owner, module, audit_sha):
    expected = definitions(owner, module); record = owner.m.document(BASE / "guards.json")
    result = owner.m.document(BASE / "guards-installed.json")
    need(record["compositionSha256"] == result["compositionSha256"] == audit_sha and
         result["guardsSha256"] == module.sha(owner.m.protected(BASE / "guards.json")) and set(record["files"]) == set(expected),
         "exact_current_supplemental_guard_receipt_required")
    for name, raw in expected.items():
        target = SYSTEM / name; item = record["files"][name]
        need(module.sha(owner.leaf.protected(target)) == item["sha256"] == module.sha(raw) and
             owner.leaf.file_identity(target) == module.six(item["identity"]), "current_supplemental_guard_file_identity_required")
        fields = ["Id", "FragmentPath", "DropInPaths", "ActiveState", "UnitFileState"]
        if name.endswith(".service"): fields.append("MainPID")
        state = owner.leaf.manager_properties(owner.h.rpc_m, name, fields)
        need(state["Id"] == name and state["FragmentPath"] == str(target) and not state["DropInPaths"] and
             state["ActiveState"] == ("active" if name.endswith(".timer") else "inactive") and
             (name.endswith(".timer") or state["MainPID"] == "0"), "actual_loaded_supplemental_timer_and_dormant_service_required")
        obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in name)
        job = json.loads(owner.m.command(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", obj,
                                         "org.freedesktop.systemd1.Unit", "Job"]))
        need(job == {"type": "(uo)", "data": [0, "/"]}, "supplemental_guard_manager_must_have_no_job")
        if name.endswith(".timer"):
            need(state["UnitFileState"] == "enabled" and owner.leaf.link_record(SYSTEM / "timers.target.wants" / name) == record["bootLinks"][name],
                 "current_supplemental_timer_boot_identity_required")
            plan = owner.operation()["financialPlan"]; due = plan["nextUtcMs"] if "-utc-" in name else plan["expiresMs"] - 300000
            value = json.loads(owner.m.command(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", obj,
                                               "org.freedesktop.systemd1.Timer", "NextElapseUSecRealtime"]))
            need(value == {"type": "t", "data": due * 1000}, "current_supplemental_timer_due_required")
    return result


def install_guards(owner, module, audit_sha):
    p = owner.p; leaf = owner.leaf; expected = definitions(owner, module); path = BASE / "guards.json"
    if (BASE / "guards-installed.json").exists():
        guards_current(owner, module, audit_sha)
        return {"supplementalGuardsInstalled": True, "guardsReceiptSha256": module.sha(owner.m.protected(BASE / "guards-installed.json"))}
    if not path.exists():
        need(not os.path.lexists(HOLD), "fresh_supplemental_guard_holding_directory_required")
        HOLD.mkdir(mode=0o700); p.sync(SYSTEM)
        files = {}; links = {}
        for name, raw in expected.items():
            need(not os.path.lexists(SYSTEM / name), "supplemental_guard_target_must_be_absent")
            files[name] = p.exclusive(HOLD / name, raw, 0o644)
            if name.endswith(".timer"):
                link = HOLD / (name + ".boot"); link.symlink_to(SYSTEM / name); p.sync(HOLD)
                links[name] = leaf.link_record(link)
        owner.m.save(path, {"format": FORMAT + "-guards", "compositionSha256": audit_sha, "files": files, "bootLinks": links})
    record = owner.m.document(path)
    need(record["format"] == FORMAT + "-guards" and record["compositionSha256"] == audit_sha and set(record["files"]) == set(expected),
         "same_exact_supplemental_guard_preparation_required")
    for name, raw in expected.items():
        item = record["files"][name]; target = SYSTEM / name; prepared = HOLD / name
        need(item["sha256"] == module.sha(raw), "same_supplemental_guard_program_and_calendar_required")
        if not os.path.lexists(target):
            owner.m.save(BASE / (name + ".publish-intent.json"), {"compositionSha256": audit_sha, "file": item})
            p.move_owned(prepared, target, item)
        need(module.sha(leaf.protected(target)) == item["sha256"] and leaf.file_identity(target) == module.six(item["identity"]),
             "exact_supplemental_guard_definition_inode_required")
        if name.endswith(".timer"):
            destination = SYSTEM / "timers.target.wants" / name
            if not os.path.lexists(destination):
                owner.m.save(BASE / (name + ".boot-intent.json"), {"compositionSha256": audit_sha, "link": record["bootLinks"][name]})
                module.move_link(p, leaf, HOLD / (name + ".boot"), destination, record["bootLinks"][name])
            need(leaf.link_record(destination) == record["bootLinks"][name], "exact_supplemental_guard_boot_inode_required")
    # Manager requests have separate durable intent and ACK; unknown requests
    # are never silently resent by another install invocation.
    for label, args in [("reload", ["daemon-reload"]), *[(name, ["start", name]) for name in expected if name.endswith(".timer")]]:
        intent = BASE / (label + ".manager-intent.json"); ack = BASE / (label + ".manager-ack.json")
        if not intent.exists():
            owner.m.save(intent, {"compositionSha256": audit_sha, "args": args})
            owner.m.command(["/usr/bin/systemctl", *args], timeout=90)
            owner.m.save(ack, {"compositionSha256": audit_sha, "args": args, "acknowledged": True})
        need(owner.m.document(ack) == {"compositionSha256": audit_sha, "args": args, "acknowledged": True}, "unknown_guard_manager_ACK_requires_explicit_inspection")
    for name in expected:
        obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in name)
        if name.endswith(".timer"):
            due = owner.operation()["financialPlan"]["nextUtcMs"] if "-utc-" in name else owner.operation()["financialPlan"]["expiresMs"] - 300000
            actual = json.loads(owner.m.command(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1", obj,
                                                "org.freedesktop.systemd1.Timer", "NextElapseUSecRealtime"]))
            need(actual["type"] == "t" and actual["data"] == due * 1000, "actual_armed_supplemental_timer_calendar_required")
    owner.m.save(BASE / "guards-installed.json", {"format": FORMAT + "-guards-installed", "compositionSha256": audit_sha,
                 "guardsSha256": module.sha(owner.m.protected(path)), "sameOriginalExpiryAndUTC": True})
    guards_current(owner, module, audit_sha)
    return {"supplementalGuardsInstalled": True, "guardsReceiptSha256": module.sha(owner.m.protected(BASE / "guards-installed.json"))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    for name in ["qualify", "capture", "install-guards", "start-paid-source", "resume-free-source", "close", "utc"]:
        group.add_argument("--" + name, action="store_true")
    for name in ["switch-proxy", "deadline-close", "deadline-utc", "complete-config-reload"]:
        group.add_argument("--" + name)
    args = parser.parse_args()
    if not any(vars(args).values()):
        print(json.dumps({"format": FORMAT, "sourceOnly": True, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_production_root_host_required")
    signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_unknown_outcome_no_retry")); signal.alarm(850); os.umask(0o077)
    module = business(); ns, context, owner, _ = module.build(MANIFEST_SHA, INPUT_SHA); adapt(owner, ns)
    with module.transition_lock(owner.m):
        if args.qualify:
            values = {unit: control_pid(owner.m, unit) for unit in UNITS}
            value = {"qualified": True, "actualControlPIDProperties": len(values), "databaseWrites": 0, "serviceActions": 0}
        else:
            captured = audit(owner, ns, capture=args.capture)
            if args.capture: value = {"compositionCaptured": True, "compositionSha256": captured}
            elif args.install_guards: value = install_guards(owner, ns, captured)
            elif args.switch_proxy:
                guards_current(owner, ns, captured)
                value = owner.switch_proxy(args.switch_proxy)
            elif args.start_paid_source:
                guards_current(owner, ns, captured)
                value = owner.start_source("paid")
            elif args.resume_free_source: value = owner.start_source("free")
            elif args.complete_config_reload: value = owner.complete_reload(args.complete_config_reload)
            else:
                if args.deadline_close or args.deadline_utc:
                    need((args.deadline_close or args.deadline_utc) == owner.operation()["planSha256"], "same_original_deadline_plan_required")
                value = owner.close(utc=bool(args.utc or args.deadline_utc), resume=bool(args.deadline_close))
    print(json.dumps(value, sort_keys=True))


if __name__ == "__main__":
    try: main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False, "fixedCode": str(error) if type(error) is RuntimeError and re.fullmatch("[A-Za-z0-9_]+", str(error)) else type(error).__name__, "automaticRetryAllowed": False}))
        raise SystemExit(1)
