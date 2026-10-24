#!/usr/bin/env python3
"""Fixed host inspection primitives for the owned Alchemy source transition.

No admission, controller construction or service action occurs on import/default.
The lifecycle owner must authenticate its own operation and action journals.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import stat
import types

FORMAT = "yunipals-alchemy-source-switch-v1-host"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
RESTORE = OPS / "ypal-source-tail-restore-v1.py"
RESTORE_SHA = "de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34"
RESTORE_ACK = "0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1"
SOURCE = "yunipals-ypal-combined-source.service"
FRESH = "yunipals-booster-ypal-source.service"
API = "yunipals-booster-api.service"
SOURCE_DROP = Path("/etc/systemd/system") / (SOURCE + ".d/99-alchemy-catchup-v1.conf")
PROXY_DROP_NAME = "99-alchemy-catchup-v1.conf"
PORTS = {"ethereum": 19221, "base": 19222, "polygon": 19223, "bnb": 19224}


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def load(path, digest):
    """Authenticate the existing root-owned source before evaluating it."""
    path = Path(path)
    for parent in [*path.parents, path]:
        row = parent.lstat()
        need(row.st_uid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_fixed_host_primitive_source_required")
    before = path.lstat()
    identity = lambda row: tuple(getattr(row, key) for key in [
        "st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"])
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 200000,
         "bounded_actual_public_source_required")
    raw = path.read_bytes()
    need(sha(raw) == digest and identity(path.lstat()) == identity(before), "exact_unchanged_host_primitive_source_required")
    module = types.ModuleType("owned_alchemy_" + path.stem)
    module.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), module.__dict__)
    need(identity(path.lstat()) == identity(before) and sha(path.read_bytes()) == digest, "same_public_source_after_evaluation_required")
    return module


def kernel_backends(query, observer, role, actors, uid_gid, require_all):
    """Positive socket attribution, with host(client_addr) rather than inet text.

    This method returns only actual backend/process observations. It neither
    changes roles nor terminates sessions belonging to another process.
    """
    need(role in {73004621, 16394} and type(require_all) is bool and 0 <= len(actors) <= 12,
         "fixed_source_or_budget_role_and_bounded_actor_set_required")
    clause = " AND datid=17584" if role == 73004621 else ""
    sql = ("SELECT coalesce(jsonb_agg(jsonb_build_object('pid',pid,'backendStart',backend_start::text,"
           "'clientAddress',host(client_addr),'clientPort',client_port)ORDER BY pid),'[]'::jsonb) "
           "FROM pg_stat_activity WHERE usesysid=" + str(role) + clause)
    rows = query(sql)
    need(isinstance(rows, list) and len(rows) <= (32 if role == 73004621 else 16),
         "existing_role_connection_limit_must_bound_observation")
    backend_fds = observer.peer_fds([row["pid"] for row in rows], 111, 113)
    peers = observer.unix_peers(observer.run(["/usr/bin/ss", "-xHn"]))
    tcp = {**observer.tcp_clients(Path("/proc/net/tcp").read_bytes()),
           **observer.tcp_clients(Path("/proc/net/tcp6").read_bytes(), True)}
    result = {}
    for name, actor in actors.items():
        need(isinstance(name, str) and 1 <= len(actor["processes"]) <= 2,
             "actual_bounded_source_or_proxy_kernel_actor_required")
        uid, gid = uid_gid[name]
        own = observer.peer_fds([row["pid"] for row in actor["processes"]], uid, gid)
        need(all(type(row["pid"]) is int and type(row["startTicks"]) is int and row["startTicks"] > 0 and
                 own[str(row["pid"])]["startTicks"] == row["startTicks"] for row in actor["processes"]),
             "actual_client_FD_process_epoch_must_match_recorded_actor")
        result[name] = observer.map_owned_backends(own, backend_fds, rows, peers, tcp)
    ids = [row["pid"] for values in result.values() for row in values]
    need(len(ids) == len(set(ids)) and (not require_all or set(ids) == {row["pid"] for row in rows}) and query(sql) == rows,
         "all_required_backends_need_unique_positive_stable_kernel_attribution")
    return result


class Host:
    def __init__(self, plan, leaf):
        self.p, self.leaf = plan, leaf
        self.restore = load(RESTORE, RESTORE_SHA)
        self.r, self.m, self.source, self.ancestor = self.restore.load()
        self.rpc_m, self.a = leaf.routes_context()
        self.observer = self.source.raw.observer

    def initial_current(self):
        # This old whole-source qualification is permitted only before any new
        # financial or process effect. Changed epochs use this owner's records.
        return self.restore.validate_source_current(RESTORE_ACK)

    def definitions(self, state):
        return {path: {"sha256": sha(self.leaf.protected(path)), "identity": self.leaf.file_identity(path)}
                for path in [state["FragmentPath"], *state["DropInPaths"].split()] if path}

    def proxy_unit(self, chain):
        need(chain in PORTS, "one_fixed_proxy_chain_required")
        return "yunipals-combined-rpc@" + chain + ".service"

    def proxy_drop(self, chain):
        return Path("/etc/systemd/system") / (self.proxy_unit(chain) + ".d") / PROXY_DROP_NAME

    def free_route(self, chain):
        unit = self.proxy_unit(chain)
        state = self.a.state(self.rpc_m, unit)
        need(not state["DropInPaths"], "unmodified_original_free_proxy_definition_required")
        expected = dict(line.split("=", 1) for line in self.a.env_bytes(chain).decode().splitlines())
        actor = self.a.live_actor(self.rpc_m, state, expected)
        need(len(actor["processes"]) == 1 and actor["processes"][0]["commandSha256"] ==
             sha((self.a.NODE + "\0" + str(self.leaf.FREE_ARTIFACT) + "\0").encode()),
             "single_original_free_proxy_program_required")
        value = {"actor": actor, "definitions": self.definitions(state),
                 "environmentFiles": self.leaf.environment_files(self.rpc_m, unit),
                 "unitSecurity": self.leaf.unit_security(self.rpc_m, unit),
                 "activation": self.leaf.activation(self.rpc_m, unit)}
        need(self.a.live_actor(self.rpc_m, self.a.state(self.rpc_m, unit), expected) == actor,
             "free_proxy_actor_changed_during_complete_capture")
        return value

    def paid_route(self, chain, original, start, installed, allow_restart_for_stop=False):
        unit = self.proxy_unit(chain)
        state = self.a.state(self.rpc_m, unit)
        drop = self.proxy_drop(chain)
        need(state["DropInPaths"].split() == [str(drop)] and self.definitions(state) ==
             {**original["definitions"], str(drop): installed},
             "only_original_proxy_unit_and_exact_owned_paid_overlay_required")
        need(self.leaf.unit_security(self.rpc_m, unit) == original["unitSecurity"] and
             self.leaf.activation(self.rpc_m, unit) == original["activation"],
             "paid_overlay_must_preserve_original_proxy_security_and_boot")
        files = self.leaf.environment_files(self.rpc_m, unit)
        added = str(self.p.STAGE / (chain + ".public.env"))
        need(files["typed"]["data"] == original["environmentFiles"]["typed"]["data"] + [[added, False]] and
             {key: value for key, value in files["files"].items() if key != added} == original["environmentFiles"]["files"] and
             sha(self.leaf.protected(added)) == sha(self.p.proxy_environment(chain)),
             "complete_retained_private_chain_plus_one_last_public_override_required")
        expected = dict(line.split("=", 1) for line in (self.a.env_bytes(chain) + self.p.proxy_environment(chain)).decode().splitlines())
        actor = self.a.live_actor(self.rpc_m, state, expected)
        need(type(allow_restart_for_stop) is bool and start["bootId"] == self.m.boot() and
             (allow_restart_for_stop or state["NRestarts"] == "0") and
             start["notBeforeUs"] <= actor["startMonotonicMicroseconds"] <= self.m.mono() and
             (actor["startMonotonicMicroseconds"] <= start["notBeforeUs"] + 130000000 or
              allow_restart_for_stop and int(state["NRestarts"]) > 0) and
             actor["invocation"] != original["actor"]["invocation"] and
             len(actor["processes"]) == 1, "one_actual_new_paid_proxy_epoch_after_own_intent_required")
        process = actor["processes"][0]
        need(process["commandSha256"] == sha((self.a.NODE + "\0" + str(self.p.STAGE / "rpc-budget-proxy.mjs") + "\0").encode()) and
             sha(self.leaf.protected(self.p.STAGE / "rpc-budget-proxy.mjs")) == self.p.PROXY_ARTIFACT_SHA and
             process["privileges"]["NoNewPrivs"] == "1" and
             all(int(process["privileges"][key], 16) == 0 for key in ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]),
             "exact_new_queue_artifact_and_zero_capability_actor_required")
        need(self.a.live_actor(self.rpc_m, self.a.state(self.rpc_m, unit), expected) == actor,
             "paid_proxy_actor_changed_during_capture")
        return actor

    def source_sessions(self, source_actor, retained_current=None):
        if retained_current is None:
            actors = {FRESH: self.source.actor(FRESH)}
        else:
            value = retained_current()
            need(value["validated"] is True and value["sourceActorQualified"] is False and
                 value["financialAuthorityQualified"] is False and value["databaseWrites"] == value["serviceActions"] == 0,
                 "independently_qualified_current_temporary_actor_provider_required")
            actors = dict(value["actors"])
            if not actors:
                need(value["ownedTemporaryTerminal"] is True and self.m.pin(value["retirementIntentSha256"]),
                     "empty_temporary_actor_set_requires_actual_owned_stop_prefix")
        need(SOURCE not in actors and set(actors) <= {FRESH}, "only_current_source_and_owned_temporary_writer_allowed")
        if source_actor is not None:
            actors[SOURCE] = source_actor
        rows = kernel_backends(self.source.query, self.observer, 73004621, actors,
                               {name: (970, 964) for name in actors}, True)
        if source_actor is not None:
            need(len(rows[SOURCE]) >= 1, "positive_kernel_owned_source_backend_required")
        return rows

    def proxy_sessions(self, chain, actor):
        account = pwd.getpwnam("yunipals-market-prod-rpc")
        return kernel_backends(self.rpc_m.query, self.observer, 16394, {chain: actor},
                               {chain: (account.pw_uid, account.pw_gid)}, False)[chain]

    def source_epoch(self, operation, intent, mode, allow_restart_for_stop=False):
        need(mode in {"paid", "free"}, "explicit_owned_source_routing_epoch_required")
        state = self.source.state(SOURCE)
        original = operation["source"]
        expected_argv = list(original["parent"]["argv"])
        paths = dict(self.m.NAMESPACE)
        expected_environment = self.source.s.expected_env()
        definitions = dict(operation["sourceDefinitions"])
        if mode == "paid":
            need(sha(self.leaf.protected(SOURCE_DROP)) == sha(self.p.source_drop()),
                 "exact_reviewed_four_file_source_overlay_required")
            file_arg = "--env-file=" + str(self.p.STAGE / "source.public.env")
            entry = self.p.PROJECT + "/node_modules/ponder/dist/esm/bin/ponder.js"
            need(expected_argv.count(entry) == 1 and file_arg not in expected_argv,
                 "exact_original_three_file_source_argv_required")
            expected_argv.insert(expected_argv.index(entry), file_arg)
            expected_environment.update(dict(line.split("=", 1) for line in
                                             self.p.source_environment(operation["financialPlan"]).decode().splitlines()))
            paths[self.p.PROJECT + "/lib/unified/rpc-preflight.ts"] = str(self.p.OPS / "ypal-rpc-deadline-host-build-v1/rpc-preflight.ts")
            definitions[str(SOURCE_DROP)] = operation["sourceOverlay"]
        need(self.definitions(state) == definitions and self.source.runtime_properties() == operation["sourceRuntime"],
             "exact_source_definitions_hardening_resources_and_writable_mounts_required")
        actor = self.source.actor(SOURCE)
        need(actor["parent"]["argv"] == expected_argv and actor["parent"]["cwd"] == self.p.PROJECT and
             actor["parent"]["executable"] == original["parent"]["executable"] and
             actor["parent"]["startupInjectionAbsent"] is True and
             actor["unit"]["InvocationID"] != original["unit"]["InvocationID"] and
             type(allow_restart_for_stop) is bool and intent["bootId"] == self.m.boot() and intent["notBeforeUs"] <=
             int(actor["unit"]["ExecMainStartTimestampMonotonic"]) <= self.m.mono() and
             (allow_restart_for_stop or actor["unit"]["NRestarts"] == "0") and
             (int(actor["unit"]["ExecMainStartTimestampMonotonic"]) <= intent["notBeforeUs"] + 130000000 or
              allow_restart_for_stop and int(actor["unit"]["NRestarts"]) > 0),
             "actual_once_started_source_epoch_and_exact_program_arguments_required")
        compilers = {(tuple(row["argv"]), row["executable"]) for row in original["processes"]
                     if row["pid"] != original["parent"]["pid"]}
        need(all(row["pid"] == actor["parent"]["pid"] or
                 (row["parentPid"] == actor["parent"]["pid"] and (tuple(row["argv"]), row["executable"]) in compilers)
                 for row in actor["processes"]), "only_source_Node_and_original_direct_compiler_child_required")
        actual = json.loads(self.m.command(["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups",
            "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "/usr/bin/env", "-i", "/usr/bin/python3", "-I", "-B",
            "-c", self.m.NAMESPACE_PEER], encoded({"pid": actor["parent"]["pid"], "paths": paths})))
        expected = {}
        for inside, backing in paths.items():
            row = Path(backing).stat()
            expected[inside] = {"device": row.st_dev, "inode": row.st_ino, "uid": row.st_uid, "gid": row.st_gid,
                                "kind": stat.S_IFMT(row.st_mode)}
        public = json.loads(self.m.command(["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups",
            "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "/usr/bin/env", "-i", "/usr/bin/python3", "-I", "-B",
            "-c", self.source.s.PUBLIC_ENV_PEER, str(actor["parent"]["pid"]), json.dumps(expected_environment)]))
        need(actual == expected and public["presentKeysMatch"] is True and
             public["environmentSha256"] == actor["parent"]["environmentSha256"] and self.source.actor(SOURCE) == actor,
             "all_six_actual_source_mounts_and_public_process_environment_required")
        if allow_restart_for_stop:
            # A failed heartbeat, unavailable database or stale native metadata
            # must not prevent stopping our exact owned process. Success/current
            # acknowledgement separately requires the checks below. Terminal
            # actors use the lifecycle's explicit PID/epoch drain branch.
            return self.restore.canonical_actor(actor), None
        self.source.inputs()
        native = self.source.native()
        self.r.recovery_floor(operation["native"], native)
        self.r.epoch_heartbeat(native, intent)
        return self.restore.canonical_actor(actor), native

    def manager(self, verb, unit=None):
        allowed = {SOURCE, *(self.proxy_unit(chain) for chain in PORTS), *self.leaf.DEADLINES}
        need(verb in {"start", "stop", "daemon-reload"} and
             (unit is None if verb == "daemon-reload" else unit in allowed),
             "fixed_owned_source_proxy_or_deadline_manager_action_only")
        result = self.m.command(["/usr/bin/systemctl", verb, *([] if unit is None else [unit])], timeout=90)
        need(not result, "quiet_fixed_manager_completion_required")


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "sourceOnly": True, "hostQualified": False,
                      "financialAuthorityQualified": False, "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}))
