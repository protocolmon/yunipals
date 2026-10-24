#!/usr/bin/env python3
"""Ownership protocol controls; explicit socket fixtures, no production work."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest

HERE = Path(__file__).absolute().parent
spec = importlib.util.spec_from_file_location("alchemy_host", HERE / "ypal-alchemy-source-switch-v1.host.py")
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
spec = importlib.util.spec_from_file_location("actual_frozen_socket_join", HERE.parent / "booster-launch/ypal-old-runtime-inventory-v1.py")
join = importlib.util.module_from_spec(spec); spec.loader.exec_module(join)


class Observer:
    def __init__(self, assignments): self.assignments = assignments
    def peer_fds(self, pids, uid, gid):
        return {str(pid): {"socketInodes": self.assignments.get(pid, []), "startTicks": 1234} for pid in pids}
    def run(self, args):
        if args != ["/usr/bin/ss", "-xHn"]: raise AssertionError("unexpected_fixture_program")
        return b"explicit socket fixture"
    def unix_peers(self, raw): return {}
    def tcp_clients(self, raw, ipv6=False):
        return {} if ipv6 else {50: {"clientAddress": "127.0.0.1", "clientPort": 54321, "transport": "tcp"}}
    map_owned_backends = staticmethod(join.map_owned_backends)


class Kernel(unittest.TestCase):
    def setUp(self):
        self.rows = [{"pid": 800, "backendStart": "actual-fixture-epoch", "clientAddress": "127.0.0.1", "clientPort": 54321}]
        self.actors = {"source": {"processes": [{"pid": 11, "startTicks": 1234}]}}
        self.ids = {"source": (970, 964)}
        self.observer = Observer({11: [50], 800: []})

    def query(self, sql):
        self.assertIn("host(client_addr)", sql)
        self.assertNotIn("client_addr::text", sql)
        self.assertIn("usesysid=73004621 AND datid=17584", sql)
        return copy.deepcopy(self.rows)

    def test_actual_frozen_tcp_join_positive_source_attribution(self):
        rows = h.kernel_backends(self.query, self.observer, 73004621, self.actors, self.ids, True)
        self.assertEqual(rows, {"source": [{"pid": 800, "backendStart": "actual-fixture-epoch", "transport": "tcp"}]})

    def test_unattributed_shared_writer_or_duplicate_owner_refuses(self):
        self.rows.append({"pid": 801, "backendStart": "other", "clientAddress": "127.0.0.1", "clientPort": 54322})
        with self.assertRaises(RuntimeError): h.kernel_backends(self.query, self.observer, 73004621, self.actors, self.ids, True)
        self.rows.pop(); actors = {**self.actors, "temporary": self.actors["source"]}
        with self.assertRaises(RuntimeError): h.kernel_backends(self.query, self.observer, 73004621, actors,
                                                               {**self.ids, "temporary": (970, 964)}, True)

    def test_budget_subset_never_claims_unrelated_sessions_drained(self):
        self.rows.append({"pid": 801, "backendStart": "other", "clientAddress": "127.0.0.1", "clientPort": 54322})
        def query(sql):
            self.assertIn("usesysid=16394", sql); self.assertNotIn("datid=17584", sql)
            return copy.deepcopy(self.rows)
        rows = h.kernel_backends(query, self.observer, 16394, self.actors, self.ids, False)
        self.assertEqual([row["pid"] for row in rows["source"]], [800])

    def test_backend_epoch_churn_refuses_instead_of_returning_ownership(self):
        count = 0
        def query(sql):
            nonlocal count
            count += 1
            rows = copy.deepcopy(self.rows)
            if count == 2: rows[0]["backendStart"] = "replacement"
            return rows
        with self.assertRaises(RuntimeError): h.kernel_backends(query, self.observer, 73004621, self.actors, self.ids, True)

    def test_fixed_role_and_role_limit_bound_before_kernel_work(self):
        with self.assertRaises(RuntimeError): h.kernel_backends(self.query, self.observer, 123, self.actors, self.ids, True)
        self.rows *= 33
        with self.assertRaises(RuntimeError): h.kernel_backends(self.query, self.observer, 73004621, self.actors, self.ids, True)

    def test_same_pid_different_kernel_epoch_cannot_inherit_actor_ownership(self):
        self.actors["source"]["processes"][0]["startTicks"] = 1233
        with self.assertRaisesRegex(RuntimeError, "actual_client_FD_process_epoch"):
            h.kernel_backends(self.query, self.observer, 73004621, self.actors, self.ids, True)


class Boundaries(unittest.TestCase):
    def test_default_import_does_not_construct_host_or_call_manager(self):
        result = subprocess.run(["python3", "-I", "-B", str(HERE / "ypal-alchemy-source-switch-v1.host.py")],
                                capture_output=True, text=True, check=True, timeout=5)
        value = json.loads(result.stdout)
        self.assertTrue(value["sourceOnly"])
        self.assertFalse(value["hostQualified"])
        self.assertEqual((value["databaseWrites"], value["serviceActions"], value["providerCalls"]), (0, 0, 0))

    def test_manager_rejects_unrelated_units_and_verbs_before_command(self):
        host = h.Host.__new__(h.Host)
        host.leaf = types.SimpleNamespace(DEADLINES={"yunipals-alchemy-catchup-close-v1.timer": None})
        calls = []
        host.m = types.SimpleNamespace(command=lambda args, timeout: calls.append(args) or b"")
        for verb, unit in [("restart", h.SOURCE), ("stop", h.FRESH), ("stop", h.API),
                           ("start", "ssh.service"), ("daemon-reload", h.SOURCE)]:
            with self.subTest(verb=verb, unit=unit), self.assertRaises(RuntimeError): host.manager(verb, unit)
        self.assertEqual(calls, [])
        host.manager("stop", h.SOURCE)
        self.assertEqual(calls, [["/usr/bin/systemctl", "stop", h.SOURCE]])

    def test_verified_loader_refuses_symlink_and_foreign_bytes_before_evaluation(self):
        with tempfile.TemporaryDirectory(prefix=".alchemy-host-", dir=HERE) as tmp:
            root = Path(tmp); marker = root / "effect"
            path = root / "public.py"
            raw = ("from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('executed')\n").encode()
            path.write_bytes(raw)
            with self.assertRaises(RuntimeError): h.load(path, "f" * 64)
            self.assertFalse(marker.exists())
            alias = root / "link.py"; alias.symlink_to(path)
            with self.assertRaises(RuntimeError): h.load(alias, h.sha(raw))
            self.assertFalse(marker.exists())
            safe = b"SOURCE_ONLY = True\n"; path.write_bytes(safe)
            value = h.load(path, h.sha(safe))
            self.assertTrue(value.SOURCE_ONLY)


class Restarts(unittest.TestCase):
    def test_paid_restart_inside_initial_window_refuses_ack_but_allows_owned_stop_inspection(self):
        host = h.Host.__new__(h.Host)
        candidate = b"explicit inactive artifact fixture"
        stage = Path("/opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-primary-queue-v1")
        host.p = types.SimpleNamespace(STAGE=stage, PROXY_ARTIFACT_SHA=h.sha(candidate),
                                      proxy_environment=lambda chain: b"PAID_PRIMARY=true\n")
        state = {"DropInPaths": str(host.proxy_drop("bnb")), "NRestarts": "1"}
        original = {"actor": {"invocation": "old"}, "definitions": {"/original": {"sha256": "old"}},
                    "unitSecurity": {"retained": True}, "activation": {"retained": True},
                    "environmentFiles": {"typed": {"data": [["/original.env", False]]},
                                         "files": {"/original.env": {"sha256": "old"}}}}
        added = str(stage / "bnb.public.env")
        actor = {"invocation": "new", "startMonotonicMicroseconds": 2000,
                 "processes": [{"commandSha256": h.sha(("/node\0" + str(stage / "rpc-budget-proxy.mjs") + "\0").encode()),
                                "privileges": {"NoNewPrivs": "1", **{key: "0" for key in ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]}}}]}
        host.m = types.SimpleNamespace(boot=lambda: "boot", mono=lambda: 3000)
        host.rpc_m = object()
        host.a = types.SimpleNamespace(NODE="/node", state=lambda m, unit: state,
                                      env_bytes=lambda chain: b"PAID_PRIMARY=false\n",
                                      live_actor=lambda m, state, expected: actor)
        host.leaf = types.SimpleNamespace(unit_security=lambda m, unit: original["unitSecurity"],
            activation=lambda m, unit: original["activation"],
            environment_files=lambda m, unit: {"typed": {"data": [["/original.env", False], [added, False]]},
                                                "files": {"/original.env": {"sha256": "old"}, added: {"sha256": "new"}}},
            protected=lambda path: b"PAID_PRIMARY=true\n" if str(path) == added else candidate)
        installed = {"sha256": "fixture", "identity": {"inode": 99}}
        host.definitions = lambda value: {**original["definitions"], str(host.proxy_drop("bnb")): installed}
        start = {"bootId": "boot", "notBeforeUs": 1000}
        with self.assertRaises(RuntimeError): host.paid_route("bnb", original, start, installed)
        self.assertEqual(host.paid_route("bnb", original, start, installed, allow_restart_for_stop=True), actor)
        state["NRestarts"] = "0"
        self.assertEqual(host.paid_route("bnb", original, start, installed), actor)

    def test_source_restart_inside_initial_window_cannot_reach_ack_namespace(self):
        host = h.Host.__new__(h.Host)
        parent = {"pid": 12, "argv": ["/node", "/project/ponder.js"], "cwd": "/project",
                  "executable": "/node", "startupInjectionAbsent": True}
        actor = {"parent": parent, "processes": [parent],
                 "unit": {"InvocationID": "new", "ExecMainStartTimestampMonotonic": "2000", "NRestarts": "1"}}
        operation = {"source": {"parent": {**parent, "pid": 11}, "processes": [{**parent, "pid": 11}],
                                 "unit": {"InvocationID": "old"}}, "sourceDefinitions": {"retained": {}}, "sourceRuntime": {}}
        host.p = types.SimpleNamespace(PROJECT="/project")
        def reached(*args): raise RuntimeError("fixture_namespace_inspection_reached")
        host.m = types.SimpleNamespace(NAMESPACE={}, NAMESPACE_PEER="fixture", boot=lambda: "boot", mono=lambda: 3000, command=reached)
        host.source = types.SimpleNamespace(state=lambda unit: {}, runtime_properties=lambda: {}, actor=lambda unit: actor,
                                            s=types.SimpleNamespace(expected_env=lambda: {}))
        host.definitions = lambda state: operation["sourceDefinitions"]
        intent = {"bootId": "boot", "notBeforeUs": 1000}
        with self.assertRaisesRegex(RuntimeError, "actual_once_started_source_epoch"):
            host.source_epoch(operation, intent, "free")
        with self.assertRaisesRegex(RuntimeError, "fixture_namespace_inspection_reached"):
            host.source_epoch(operation, intent, "free", allow_restart_for_stop=True)


class NarrowRootPeer(unittest.TestCase):
    def test_four_cap_root_inspects_owner_only_cache_through_cap0_source_uid(self):
        with tempfile.TemporaryDirectory(prefix="alchemy-backing-peer-") as tmp:
            root = Path(tmp); root.chmod(0o755)
            cache = root / "cache"; cache.mkdir(mode=0o700)
            paths = {}
            for index in range(6):
                path = (cache if index < 3 else root) / ("backing" + str(index))
                if index < 2: path.mkdir(mode=0o700)
                else: path.write_bytes(b"public fixture"); path.chmod(0o600 if index < 3 else 0o644)
                if index < 3: os.chown(path, 970, 964)
                paths["/fixture/inside" + str(index)] = str(path)
            os.chown(cache, 970, 964)
            wrapper = r'''import json,os,pathlib,subprocess,sys
data=json.load(sys.stdin)
status=dict(line.split(':',1)for line in pathlib.Path('/proc/self/status').read_text().splitlines()if':'in line)
assert os.geteuid()==0 and int(status['CapEff'],16)==int(status['CapBnd'],16)==0x1e0
try:pathlib.Path(next(iter(data['paths'].values()))).stat();raise AssertionError('root_DAC_bypass_unexpected')
except PermissionError:pass
args=['/usr/bin/setpriv','--reuid=970','--regid=964','--clear-groups','--inh-caps=-all','--ambient-caps=-all','--bounding-set=-all','--no-new-privs','/usr/bin/env','-i','/usr/bin/python3','-I','-B','-c',data['peer']]
result=subprocess.run(args,input=json.dumps(data['paths']).encode(),capture_output=True,timeout=8)
assert result.returncode==0 and not result.stderr
print(result.stdout.decode(),end='')
'''
            result = subprocess.run(["/usr/bin/setpriv", "--clear-groups",
                "--bounding-set=-all,+setuid,+setgid,+setpcap,+kill", "--inh-caps=-all", "--ambient-caps=-all",
                "--no-new-privs", "/usr/bin/env", "-i", "/usr/bin/python3", "-I", "-B", "-c", wrapper],
                input=h.encoded({"paths": paths, "peer": h.BACKING_STAT_PEER}), capture_output=True, timeout=12)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            actual = json.loads(result.stdout)
            self.assertEqual(set(actual), set(paths))
            for inside, backing in paths.items():
                row = Path(backing).stat()
                self.assertEqual((actual[inside]["device"], actual[inside]["inode"], actual[inside]["uid"], actual[inside]["gid"]),
                                 (row.st_dev, row.st_ino, row.st_uid, row.st_gid))
    def test_owned_source_stop_identity_is_independent_of_database_and_heartbeat_health(self):
        host = h.Host.__new__(h.Host)
        parent = {"pid": 12, "argv": ["/node", "/project/ponder.js"], "cwd": "/project",
                  "executable": "/node", "startupInjectionAbsent": True, "environmentSha256": "fixture-env"}
        actor = {"parent": parent, "processes": [parent],
                 "unit": {"InvocationID": "new", "ExecMainStartTimestampMonotonic": "2000", "NRestarts": "0"}}
        operation = {"source": {"parent": {**parent, "pid": 11}, "processes": [{**parent, "pid": 11}],
                                 "unit": {"InvocationID": "old"}}, "sourceDefinitions": {}, "sourceRuntime": {}}
        host.p = types.SimpleNamespace(PROJECT="/project")
        def command(args, *values):
            if args[-2] == "-c": return b'{}'
            return h.encoded({"presentKeysMatch": True, "environmentSha256": "fixture-env"})
        host.m = types.SimpleNamespace(NAMESPACE={}, NAMESPACE_PEER="fixture", boot=lambda: "boot", mono=lambda: 3000, command=command)
        def unavailable(): raise RuntimeError("fixture_database_and_heartbeat_unavailable")
        host.source = types.SimpleNamespace(state=lambda unit: {}, runtime_properties=lambda: {}, actor=lambda unit: actor,
            inputs=unavailable, native=unavailable, s=types.SimpleNamespace(expected_env=lambda: {}, PUBLIC_ENV_PEER="public-fixture"))
        host.restore = types.SimpleNamespace(canonical_actor=lambda value: value)
        host.definitions = lambda state: {}
        intent = {"bootId": "boot", "notBeforeUs": 1000}
        self.assertEqual(host.source_epoch(operation, intent, "free", allow_restart_for_stop=True), (actor, None))
        with self.assertRaisesRegex(RuntimeError, "fixture_database_and_heartbeat_unavailable"):
            host.source_epoch(operation, intent, "free")


if __name__ == "__main__":
    unittest.main()
