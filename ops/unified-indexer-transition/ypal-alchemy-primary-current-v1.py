#!/usr/bin/env python3
"""Read-only paid-quiescence and installed-deadline leaves. No financial import."""
import hashlib
import datetime
import json
import os
from pathlib import Path
import pwd
import re
import stat
import types
import time
import urllib.request

FORMAT = "yunipals-alchemy-primary-current-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-ypal-alchemy-source-switch-v1-20261024")
FINANCIAL = Path("/var/backups/yunipals-ypal-alchemy-catchup-financial-v1-20261024")
MANIFEST = OPS / "ypal-alchemy-source-switch-v1.sources.json"
LIFECYCLE = OPS / "ypal-alchemy-source-switch-v1.py"
PAID_ARTIFACT = OPS / "ypal-alchemy-primary-queue-v1/rpc-budget-proxy.mjs"
PROC = Path("/proc")
RPC_USER = "yunipals-market-prod-rpc"
SYSTEMD = Path("/etc/systemd/system")
ROUTES = OPS / "ypal-combined-rpc-routes-v1.py"
ROUTES_SHA = "5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff"
FREE_ARTIFACT = OPS / "ypal-combined-rpc-pool-one-v1/rpc-budget-proxy.mjs"
FREE_ARTIFACT_SHA = "8afd0184d8e51d920a303ecfa729354189f240b0164d5d62655fb172818cc69c"
CHAINS = {"ethereum": 19221, "base": 19222, "polygon": 19223, "bnb": 19224}
DEADLINES = {
    "yunipals-alchemy-catchup-close-v1.service": "--deadline-close",
    "yunipals-alchemy-catchup-close-v1.timer": None,
    "yunipals-alchemy-catchup-utc-v1.service": "--deadline-utc",
    "yunipals-alchemy-catchup-utc-v1.timer": None
}
ROUTE_JOURNALS = (
    "paid-definition-intent", "paid-definition-installed", "paid-start-intent", "paid-started",
    "paid-stop-intent", "paid-stopped", "free-definition-restored", "free-start-intent", "free-started"
)
QUIET_MODES = {"never-paid", "prepared-stopped", "paid-stopped"}
UNIT_SECURITY_FIELDS = (
    "User", "Group", "SupplementaryGroups", "NoNewPrivileges", "CapabilityBoundingSet", "AmbientCapabilities",
    "KillMode", "Restart", "RestartUSec", "ProtectSystem", "ProtectHome", "PrivateTmp", "PrivateDevices",
    "RestrictSUIDSGID", "RestrictNamespaces", "RestrictRealtime", "LockPersonality", "ProtectKernelTunables",
    "ProtectKernelModules", "ProtectControlGroups", "ProtectKernelLogs", "RestrictAddressFamilies",
    "SystemCallArchitectures", "ExecStartPre", "ExecStartPost", "ExecStop", "ExecStopPost", "ExecCondition",
    "OnFailure", "OnSuccess", "Requires", "Wants", "BindsTo", "PartOf", "Triggers", "TriggeredBy"
)


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def pin(value):
    return isinstance(value, str) and re.fullmatch("[a-f0-9]{64}", value) is not None and value != "0" * 64


def protected(path, expected=None):
    path = Path(path)
    need(path.is_absolute() and ".." not in path.parts, "fixed_absolute_receipt_or_public_source_required")
    for parent in [*path.parents, path]:
        row = parent.lstat()
        need(row.st_uid == 0 and not row.st_mode & 0o022 and not stat.S_ISLNK(row.st_mode),
             "protected_actual_receipt_and_source_required")
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 8000000,
         "bounded_single_link_actual_input_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, 8000001)
        identity = lambda row: tuple(getattr(row, k) for k in
            ["st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"])
        need(identity(before) == identity(os.fstat(fd)) == identity(path.lstat()) and len(raw) == before.st_size and
             (expected is None or pin(expected) and sha(raw) == expected), "exact_unchanged_actual_input_required")
        return raw
    finally:
        os.close(fd)


def document(path, expected):
    need(pin(expected), "actual_nonplaceholder_receipt_hash_required")
    return json.loads(protected(path, expected))


def file_identity(path):
    row = Path(path).lstat()
    return {key: getattr(row, key) for key in
            ["st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink"]}


def link_record(path):
    row = Path(path).lstat()
    need(stat.S_ISLNK(row.st_mode) and row.st_uid == row.st_gid == 0, "owned_actual_timer_boot_link_required")
    return {"identity": file_identity(path), "target": os.readlink(path)}


def as_text(value):
    return value.decode() if isinstance(value, bytes) else value


def calendar(milliseconds):
    need(type(milliseconds) is int and milliseconds > 0, "actual_plan_deadline_milliseconds_required")
    value = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc) + datetime.timedelta(milliseconds=milliseconds)
    return value.strftime("%Y-%m-%d %H:%M:%S.%f UTC")


def uint_property(m, name, interface, property_name):
    obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in name)
    raw = json.loads(as_text(m.run(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1",
                                  obj, interface, property_name])))
    need(raw["type"] == "t", "actual_typed_timer_due_property_required")
    value = raw["data"]
    if isinstance(value, list) and len(value) == 1:
        value = value[0]
    need(type(value) is int and value > 0, "actual_armed_timer_microseconds_required")
    return value


def timer_due(m, name):
    return uint_property(m, name, "org.freedesktop.systemd1.Timer", "NextElapseUSecRealtime")


def environment_files(m, unit):
    obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in unit)
    value = json.loads(as_text(m.run(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1",
                                    obj, "org.freedesktop.systemd1.Service", "EnvironmentFiles"])))
    need(value["type"] == "a(sb)" and 1 <= len(value["data"]) <= 24,
         "complete_typed_ordered_proxy_environment_file_chain_required")
    files = {}
    for row in value["data"]:
        need(isinstance(row, list) and len(row) == 2 and isinstance(row[0], str) and
             Path(row[0]).is_absolute() and ".." not in Path(row[0]).parts and type(row[1]) is bool and row[0] not in files,
             "literal_unique_ordered_proxy_environment_file_required")
        path, optional = row
        if not os.path.lexists(path):
            need(optional, "required_proxy_environment_file_absent")
            files[path] = None
        else:
            files[path] = {"sha256": sha(protected(path)), "identity": file_identity(path)}
    return {"typed": value, "files": files}


def manager_properties(m, unit, fields):
    value = dict(line.split("=", 1) for line in as_text(m.run(["/usr/bin/systemctl", "show", unit,
                 *["--property=" + key for key in fields]])).splitlines())
    need(set(value) == set(fields), "complete_actual_manager_property_set_required")
    return value


def unit_security(m, unit):
    return manager_properties(m, unit, UNIT_SECURITY_FIELDS)


def unit_no_job(m, unit):
    need(unit in {"yunipals-combined-rpc@" + chain + ".service" for chain in CHAINS} | set(DEADLINES),
         "fixed_owned_proxy_or_deadline_job_only")
    obj = "/org/freedesktop/systemd1/unit/" + "".join(c if c.isalnum() else "_" + format(ord(c), "02x") for c in unit)
    job = json.loads(as_text(m.run(["/usr/bin/busctl", "--json=short", "get-property", "org.freedesktop.systemd1",
                                  obj, "org.freedesktop.systemd1.Unit", "Job"])))
    need(job["type"] == "(uo)" and job["data"] == [0, "/"], "actual_proxy_manager_must_have_no_job")


def activation(m, unit):
    need(unit in {"yunipals-combined-rpc@" + chain + ".service" for chain in CHAINS},
         "fixed_four_proxy_activation_only")
    unit_no_job(m, unit)
    links = {}
    root = SYSTEMD
    for directory in sorted(root.iterdir()):
        if not directory.name.endswith((".wants", ".requires")):
            continue
        row = directory.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022,
             "protected_literal_boot_activation_directory_required")
        path = directory / unit
        if os.path.lexists(path):
            links[str(path)] = link_record(path)
    state = manager_properties(m, unit, ("UnitFileState",))
    return {"unitFileState": state["UnitFileState"], "bootLinks": links}


def quiet_metrics(port):
    value = metrics(port)
    fallback_flags = ("paidFallbackOnFreeFailure", "foregroundPaidFallbackOnFreeFailure",
                      "orderPaidFallbackOnFreeFailure", "sourcePaidFallbackOnFreeFailure",
                      "salePaidFallbackOnFreeFailure")
    active, queued = value["activeUpstreamRequests"], value["queuedSourceRequests"]
    maximum, queue_limit = value["maximumConcurrentUpstreamRequests"], value["sourceQueueLimit"]
    need(value["unified"]["sourceRouting"] == "free_first" and
         type(value["traffic"]["paidCalls"]) is int and value["traffic"]["paidCalls"] == 0 and
         all(value[key] is False for key in fallback_flags) and
         all(type(v) is int for v in (active, queued, maximum, queue_limit)) and
         1 <= maximum <= 64 and queue_limit == 64 and
         0 <= active <= maximum and 0 <= queued <= queue_limit,
         "actual_free_route_without_paid_and_with_bounded_free_work_required")
    return True


def absent_journals(chain, names):
    for name in names:
        need(not os.path.lexists(BASE / (chain + "-" + name + ".json")),
             "never_attempted_owned_phase_must_have_no_intent_or_effect_journal")


def admission(value):
    """Authenticate the immutable pre-COMMIT operation and separate actual ACK link.

    Financial acknowledgement/XID ownership remains the financial caller's gate.
    This leaf neither imports that owner nor recursively validates current finance.
    """
    operation = document(BASE / "operation.json", value["operationSha256"])
    link = document(BASE / "financial-admission-link.json", value["admissionLinkSha256"])
    need(operation["operatorSha256"] == value["operatorSha256"] and
         operation["manifestSha256"] == value["manifestSha256"] and
         pin(operation["planSha256"]) and "financialResultSha256" not in operation and
         set(operation["originalFreeRoutes"]) == set(CHAINS),
         "immutable_pre_admission_operation_and_all_original_free_routes_required")
    need(link["format"] == "yunipals-alchemy-source-switch-v1-admission-link" and
         link["operationSha256"] == value["operationSha256"] and
         link["operatorSha256"] == value["operatorSha256"] and
         link["manifestSha256"] == value["manifestSha256"] and
         link["planSha256"] == operation["planSha256"] == value["planSha256"] and
         link["financialResultSha256"] == value["financialResultSha256"],
         "separate_actual_immutable_financial_admission_link_required")
    plan = document(FINANCIAL / "plan.json", operation["planSha256"])
    financial = document(FINANCIAL / "result.json", value["financialResultSha256"])
    need(financial["format"] == "yunipals-ypal-alchemy-catchup-financial-v1" and
         financial["phase"] == "admit" and financial["committed"] is True and
         financial["planSha256"] == operation["planSha256"] and
         financial["permits"] == plan["permits"] and
         financial["startMs"] == plan["startMs"] and financial["expiresMs"] == plan["expiresMs"],
         "actual_committed_financial_result_must_match_immutable_plan")
    return operation


def stopped_route(chain, row, value, m):
    stopped = document(BASE / (chain + "-paid-stopped.json"), row["paidStopResultSha256"])
    intent = document(BASE / (chain + "-paid-stop-intent.json"), stopped["intentSha256"])
    need(stopped["terminal"] is True and stopped["operationSha256"] == value["operationSha256"] and
         intent["operationSha256"] == value["operationSha256"] and
         intent["chain"] == chain and intent["bootId"] == m.boot(),
         "actual_same_boot_owned_proxy_stop_acknowledgement_required")
    definition = document(BASE / (chain + "-paid-definition-intent.json"), intent["paidDefinitionIntentSha256"])
    need(definition["operationSha256"] == value["operationSha256"] and
         definition["chain"] == chain and definition["bootId"] == m.boot(),
         "actual_pre_stop_paid_definition_intent_required")
    if row["mode"] == "prepared-stopped":
        absent_journals(chain, ("paid-start-intent", "paid-started"))
        need(intent["startNeverAttempted"] is True and intent["processes"] == [] and intent["ownedBackends"] == [],
             "prepared_only_stop_must_not_invent_paid_process_or_backend_epochs")
    else:
        started_paid = document(BASE / (chain + "-paid-start-intent.json"), intent["paidStartIntentSha256"])
        need(started_paid["operationSha256"] == value["operationSha256"] and
             started_paid["chain"] == chain and started_paid["bootId"] == m.boot() and
             started_paid["admissionLinkSha256"] == value["admissionLinkSha256"] and
             intent.get("startNeverAttempted") is not True,
             "actual_admitted_paid_start_intent_required")
        if intent["processes"]:
            gone(intent["processes"])
        else:
            need(intent.get("terminalScanRequired") is True,
                 "lost_paid_start_identity_requires_explicit_full_uid_terminal_scan")
            assert_no_paid_proxy_processes()
    started = document(BASE / (chain + "-free-start-intent.json"), row["freeStartIntentSha256"])
    result = document(BASE / (chain + "-free-started.json"), row["freeStartResultSha256"])
    need(started["operationSha256"] == value["operationSha256"] and started["bootId"] == m.boot() and
         result["operationSha256"] == value["operationSha256"] and
         result["intentSha256"] == row["freeStartIntentSha256"] and result["actor"] == row["actor"],
         "same_boot_actual_once_owned_free_restart_acknowledgement_required")
    need(type(started["notBeforeUs"]) is int and started["notBeforeUs"] > 0 and
         started["notBeforeUs"] <= row["actor"]["startMonotonicMicroseconds"] <= started["notBeforeUs"] + 130000000,
         "exact_once_owned_new_free_proxy_epoch_required")
    return intent["ownedBackends"]


def producer(receipt):
    manifest = document(MANIFEST, receipt["manifestSha256"])
    need(manifest["format"] == "yunipals-alchemy-source-switch-v1-sources" and
         manifest["lifecycle"]["file"] == LIFECYCLE.name and
         pin(manifest["lifecycle"]["sha256"]) and
         receipt["operatorSha256"] == manifest["lifecycle"]["sha256"], "actual_owned_lifecycle_source_manifest_required")
    protected(LIFECYCLE, receipt["operatorSha256"])
    return manifest


def routes_context():
    raw = protected(ROUTES, ROUTES_SHA)
    module = types.ModuleType("alchemy_quiet_rpc_primitives")
    module.__file__ = str(ROUTES)
    exec(compile(raw, str(ROUTES), "exec"), module.__dict__)
    # Fixed state/process/file primitives only; never the old whole validator,
    # original admission/catalog proof or original invocation acknowledgement.
    m, a = module.core()
    return m, a


def gone(processes):
    need(isinstance(processes, list) and 1 <= len(processes) <= 2, "bounded_recorded_paid_proxy_processes_required")
    for row in processes:
        need(type(row["pid"]) is int and row["pid"] > 0 and type(row["startTicks"]) is int and row["startTicks"] > 0,
             "actual_known_paid_process_epoch_required")
        try:
            text = (Path("/proc") / str(row["pid"]) / "stat").read_text()
        except FileNotFoundError:
            continue
        need(int(text[text.rfind(")") + 2:].split()[19]) != row["startTicks"],
             "known_paid_process_must_be_gone_even_if_escaped")


def rpc_process_snapshot(uid, deadline):
    """Read UID metadata for selection; only same-account stat/argv afterwards.

    No environment, executable contents, private configuration or foreign argv
    is read. A vanished PID is not a current paid actor. Same-UID identity or
    argv changes between the two complete scans refuse rather than normalize.
    """
    paths = [path for path in PROC.iterdir() if path.name.isdecimal()]
    need(len(paths) <= 65536, "bounded_complete_process_inventory_required")
    result = []

    def bounded(path, maximum):
        need(time.monotonic() <= deadline, "full_uid_terminal_scan_deadline_expired")
        with path.open("rb") as f:
            raw = f.read(maximum + 1)
        need(len(raw) <= maximum, "bounded_process_metadata_and_command_required")
        return raw

    def uids(path):
        lines = bounded(path / "status", 65536).splitlines()
        rows = [line.split(b":", 1)[1].split() for line in lines if line.startswith(b"Uid:")]
        need(len(rows) == 1 and len(rows[0]) == 4 and all(v.isdigit() for v in rows[0]),
             "complete_actual_process_uid_metadata_required")
        return [int(v) for v in rows[0]]

    def epoch(raw):
        fields = raw[raw.rfind(b")") + 2:].split()
        need(len(fields) >= 20 and fields[19].isdigit() and int(fields[19]) > 0,
             "actual_process_state_and_start_ticks_required")
        return fields[0].decode(), int(fields[19])

    for path in paths:
        try:
            actual_uids = uids(path)
            if uid not in actual_uids:
                continue
            need(actual_uids == [uid] * 4, "unambiguous_same_uid_process_required")
            before = epoch(bounded(path / "stat", 16384))
            command = bounded(path / "cmdline", 131072)
            need((command and command.endswith(b"\0")) or before[0] in {"Z", "X"},
                 "unknown_live_same_uid_program_refused")
            need(str(PAID_ARTIFACT).encode() not in command,
                 "no_paid_artifact_invocation_may_survive_even_outside_owned_cgroup")
            need(epoch(bounded(path / "stat", 16384)) == before and uids(path) == actual_uids,
                 "same_uid_process_changed_during_terminal_scan")
        except FileNotFoundError:
            # The second complete scan catches newly appearing same-account
            # epochs; an already vanished process cannot issue paid requests.
            continue
        result.append({"pid": int(path.name), "startTicks": before[1], "state": before[0],
                       "commandSha256": sha(command)})
    return sorted(result, key=lambda row: row["pid"])


def assert_no_paid_proxy_processes():
    account = pwd.getpwnam(RPC_USER)
    need(0 < account.pw_uid < 65536, "actual_unprivileged_rpc_account_required_for_terminal_scan")
    deadline = time.monotonic() + 8
    first = rpc_process_snapshot(account.pw_uid, deadline)
    second = rpc_process_snapshot(account.pw_uid, deadline)
    need(first == second, "complete_same_uid_process_inventory_must_be_stable")
    return {"validated": True, "zeroPaid": True, "accountUid": account.pw_uid,
            "scannedAccountProcesses": len(first), "scanSha256": sha(encoded(first)),
            "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}


def metrics(port):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open("http://127.0.0.1:" + str(port) + "/metrics", timeout=5) as response:
        raw = response.read(2000001)
        need(response.status == 200 and len(raw) <= 2000000, "bounded_actual_proxy_metrics_required")
        return json.loads(raw)


def validate_paid_quiet(quiet_result_sha, financial_result_sha):
    value = document(BASE / "paid-quiet.json", quiet_result_sha)
    need(value["format"] == "yunipals-alchemy-source-switch-v1-paid-quiet" and
         value["financialResultSha256"] == financial_result_sha and set(value["routes"]) == set(CHAINS),
         "actual_four_proxy_quiet_receipt_and_financial_parent_required")
    producer(value)
    operation = admission(value)
    m, a = routes_context()
    need(operation["bootId"] == m.boot(), "same_actual_operation_boot_required")
    actors = {}
    drained = []
    for chain, port in CHAINS.items():
        row = value["routes"][chain]
        original = operation["originalFreeRoutes"][chain]
        need(row["mode"] in QUIET_MODES and row["definitions"] == original["definitions"] and
             row["environmentFiles"] == original["environmentFiles"],
             "explicit_route_recovery_mode_and_original_free_inputs_required")
        if row["mode"] == "never-paid":
            absent_journals(chain, ROUTE_JOURNALS)
            need(row["actor"] == original["actor"], "never_paid_must_retain_exact_original_free_actor")
        else:
            drained.extend(stopped_route(chain, row, value, m))
        unit = "yunipals-combined-rpc@" + chain + ".service"
        state = a.state(m, unit)
        need(state["MainPID"] != "0" and state["ActiveState"] == "active" and not state["DropInPaths"],
             "actual_restored_original_free_proxy_unit_required")
        paths = [state["FragmentPath"], *state["DropInPaths"].split()]
        need(set(paths) == set(row["definitions"]), "complete_current_free_unit_definition_set_required")
        for path, expected in row["definitions"].items():
            need(sha(m.protected(path)) == expected["sha256"] and file_identity(path) == expected["identity"],
                 "same_owned_restored_definition_bytes_and_inode_required")
        need(environment_files(m, unit) == row["environmentFiles"], "same_complete_original_proxy_private_file_chain_required")
        need(unit_security(m, unit) == original["unitSecurity"] and activation(m, unit) == original["activation"],
             "same_original_loaded_security_and_boot_activation_required")
        expected = dict(line.split("=", 1) for line in a.env_bytes(chain).decode().splitlines())
        actor = a.live_actor(m, state, expected)
        protected(FREE_ARTIFACT, FREE_ARTIFACT_SHA)
        process = actor["processes"][0]
        privileges = process["privileges"]
        need(process["commandSha256"] == sha((a.NODE + "\0" + str(FREE_ARTIFACT) + "\0").encode()) and
             privileges["NoNewPrivs"] == "1" and
             all(int(privileges[k], 16) == 0 for k in ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]),
             "original_free_program_and_zero_capability_proxy_required")
        need(actor == row["actor"] and len(actor["processes"]) == 1,
             "exact_acknowledged_single_original_free_program_epoch_required")
        quiet_metrics(port)
        need(a.live_actor(m, a.state(m, unit), expected) == actor, "free_proxy_actor_changed_during_metrics_check")
        actors[chain] = actor
    need(len(drained) <= 8 and all(type(v["pid"]) is int and v["pid"] > 0 and
         isinstance(v["backendStart"], str) and 0 < len(v["backendStart"]) <= 100 for v in drained),
         "bounded_actual_owned_proxy_backend_epochs_required")
    rows = m.query("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start::text)), '[]'::jsonb) "
                   "FROM pg_stat_activity WHERE usesysid=16394")
    need(not any(v["pid"] == current["pid"] and v["backendStart"] == current["backendStart"]
                 for v in drained for current in rows), "all_recorded_paid_backend_epochs_must_be_drained")
    for chain, port in CHAINS.items():
        row = value["routes"][chain]
        unit = "yunipals-combined-rpc@" + chain + ".service"
        state = a.state(m, unit)
        expected = dict(line.split("=", 1) for line in a.env_bytes(chain).decode().splitlines())
        need(a.live_actor(m, state, expected) == actors[chain] and not state["DropInPaths"] and
             {state["FragmentPath"]} == set(row["definitions"]) and
             environment_files(m, unit) == row["environmentFiles"] and
             unit_security(m, unit) == operation["originalFreeRoutes"][chain]["unitSecurity"] and
             activation(m, unit) == operation["originalFreeRoutes"][chain]["activation"],
             "all_four_free_proxy_actors_and_private_inputs_must_still_match")
        for path, original in row["definitions"].items():
            need(sha(m.protected(path)) == original["sha256"] and file_identity(path) == original["identity"],
                 "all_four_free_definition_bytes_and_inodes_must_still_match")
        quiet_metrics(port)
        # The second observation must fence every earlier metrics call too.
        need(a.live_actor(m, a.state(m, unit), expected) == actors[chain],
             "free_proxy_actor_changed_during_final_metrics_check")
        if row["mode"] == "never-paid":
            absent_journals(chain, ROUTE_JOURNALS)
        elif row["mode"] == "prepared-stopped":
            absent_journals(chain, ("paid-start-intent", "paid-started"))
    for chain, row in value["routes"].items():
        if row["mode"] == "paid-stopped":
            stopped = document(BASE / (chain + "-paid-stopped.json"), row["paidStopResultSha256"])
            intent = document(BASE / (chain + "-paid-stop-intent.json"), stopped["intentSha256"])
            if not intent["processes"]:
                need(intent.get("terminalScanRequired") is True,
                     "lost_paid_start_identity_requires_explicit_full_uid_terminal_scan")
                assert_no_paid_proxy_processes()
    for chain in CHAINS:
        row = value["routes"][chain]
        original = operation["originalFreeRoutes"][chain]
        unit = "yunipals-combined-rpc@" + chain + ".service"
        state = a.state(m, unit)
        expected = dict(line.split("=", 1) for line in a.env_bytes(chain).decode().splitlines())
        need(not state["DropInPaths"] and {state["FragmentPath"]} == set(row["definitions"]) and
             environment_files(m, unit) == row["environmentFiles"] and
             unit_security(m, unit) == original["unitSecurity"] and activation(m, unit) == original["activation"],
             "complete_final_four_input_and_activation_CAS_required")
        for path, expected_file in row["definitions"].items():
            need(sha(m.protected(path)) == expected_file["sha256"] and file_identity(path) == expected_file["identity"],
                 "complete_final_four_definition_CAS_required")
        need(a.live_actor(m, state, expected) == actors[chain],
             "complete_final_four_actor_CAS_required")
    admission(value)
    protected(BASE / "paid-quiet.json", quiet_result_sha)
    return {"format": FORMAT + "-quiet", "validated": True, "paidRequestsQuiet": True,
            "quietResultSha256": quiet_result_sha, "financialResultSha256": financial_result_sha,
            "planSha256": operation["planSha256"], "operationSha256": value["operationSha256"],
            "admissionLinkSha256": value["admissionLinkSha256"],
            "routeModes": {chain: row["mode"] for chain, row in value["routes"].items()},
            "currentFreeActorsSha256": sha(encoded(actors)), "sourceActorQualified": False,
            "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}


def validate_deadline_prepared(plan_sha, deadline_receipt_sha):
    plan = document(FINANCIAL / "plan.json", plan_sha)
    need(type(plan["expiresMs"]) is type(plan["nextUtcMs"]) is int and
         plan["startMs"] < plan["expiresMs"] <= plan["nextUtcMs"], "actual_finite_same_day_plan_deadlines_required")
    value = document(BASE / "deadline-prepared.json", deadline_receipt_sha)
    need(value["format"] == "yunipals-alchemy-source-switch-v1-deadline-prepared" and
         value["planSha256"] == plan_sha and set(value["units"]) == set(DEADLINES),
         "actual_owned_close_and_UTC_deadline_receipt_required")
    producer(value)
    operation = document(BASE / "operation.json", value["operationSha256"])
    need(operation["planSha256"] == plan_sha and "financialResultSha256" not in operation and
         operation["operatorSha256"] == value["operatorSha256"] and
         operation["manifestSha256"] == value["manifestSha256"],
         "actual_pre_admission_operation_must_bind_installed_deadline_plan")
    m, _ = routes_context()
    need(operation["bootId"] == m.boot(), "same_boot_prepared_deadline_operation_required")
    for name, verb in DEADLINES.items():
        row = value["units"][name]
        path = SYSTEMD / name
        raw = protected(path, row["sha256"])
        need(file_identity(path) == row["identity"], "same_owned_installed_deadline_definition_inode_required")
        if verb:
            expected = "ExecStart=/usr/bin/python3 -I -B " + str(LIFECYCLE) + " " + verb + " " + plan_sha
            need(raw.decode().splitlines().count(expected) == 1 and "Type=oneshot" in raw.decode().splitlines(),
                 "exact_literal_bounded_deadline_program_and_plan_arguments_required")
        else:
            due_ms = plan["nextUtcMs"] if "-utc-" in name else plan["expiresMs"]
            need("Persistent=true" in raw.decode().splitlines() and
                 "Unit=" + name.replace(".timer", ".service") in raw.decode().splitlines() and
                 raw.decode().splitlines().count("OnCalendar=" + calendar(due_ms)) == 1 and
                 "AccuracySec=1us" in raw.decode().splitlines() and
                 "RandomizedDelaySec=0" in raw.decode().splitlines(),
                 "persistent_owned_timer_and_exact_service_target_required")
        # MainPID belongs to Service, not Timer. Actual timer show omits it.
        fields = ["Id", "LoadState", "ActiveState", "UnitFileState", "FragmentPath", "DropInPaths"]
        if verb:
            fields.append("MainPID")
        state = dict(line.split("=", 1) for line in as_text(m.run(["/usr/bin/systemctl", "show", name,
                     *["--property=" + key for key in fields]])).splitlines())
        need(state["Id"] == name and state["LoadState"] == "loaded" and state["FragmentPath"] == str(path) and
             not state["DropInPaths"] and (not verb or state["MainPID"] == "0"),
             "actual_loaded_unstarted_deadline_unit_required")
        unit_no_job(m, name)
        need(state["ActiveState"] == ("inactive" if verb else "active"), "actual_prepared_timer_or_dormant_service_required")
        if not verb:
            need(state["UnitFileState"] == "enabled" and
                 link_record(SYSTEMD / "timers.target.wants" / name) == row["bootLink"],
                 "exact_owned_enabled_timer_boot_inode_required")
            need(timer_due(m, name) == due_ms * 1000,
                 "same_actual_armed_deadline_timer_due_time_required")
        else:
            fields = ["Type", "User", "Group", "Restart", "NoNewPrivileges", "KillMode"]
            service = dict(line.split("=", 1) for line in as_text(m.run(["/usr/bin/systemctl", "show", name,
                           *["--property=" + key for key in fields]])).splitlines())
            need(service["Type"] == "oneshot" and service["User"] in {"", "root"} and
                 service["Group"] in {"", "root"} and service["Restart"] == "no" and
                 service["NoNewPrivileges"] == "yes" and service["KillMode"] == "control-group" and
                 uint_property(m, name, "org.freedesktop.systemd1.Service", "TimeoutStartUSec") == 900000000 and
                 uint_property(m, name, "org.freedesktop.systemd1.Service", "TimeoutStopUSec") == 90000000,
                 "bounded_root_owned_nonrestarting_deadline_executor_required")
    for name, verb in DEADLINES.items():
        row = value["units"][name]
        path = SYSTEMD / name
        protected(path, row["sha256"])
        need(file_identity(path) == row["identity"], "final_all_four_deadline_definition_inode_CAS_required")
        unit_no_job(m, name)
        if not verb:
            due_ms = plan["nextUtcMs"] if "-utc-" in name else plan["expiresMs"]
            need(timer_due(m, name) == due_ms * 1000 and
                 link_record(SYSTEMD / "timers.target.wants" / name) == row["bootLink"],
                 "final_both_actual_timer_due_and_boot_link_CAS_required")
    protected(BASE / "deadline-prepared.json", deadline_receipt_sha)
    return {"format": FORMAT + "-deadline", "validated": True, "deadlinePrepared": True,
            "planSha256": plan_sha, "deadlineReceiptSha256": deadline_receipt_sha,
            "sourceActorQualified": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "sourceOnly": True, "hostQualified": False,
                      "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
