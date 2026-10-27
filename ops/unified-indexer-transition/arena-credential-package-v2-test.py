#!/usr/bin/env python3
"""Offline composition and boundary controls; no application build/host mutation."""
import copy
import json
import os
from pathlib import Path
import stat
import sys
import subprocess
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
ROOT = HERE.parents[1]


def module(path):
    value = types.ModuleType(path.stem)
    value.__file__ = str(path)
    exec(compile(path.read_bytes(), str(path), "exec"), value.__dict__)
    return value


m = module(HERE / "arena-credential-package-v2.py")
p = module(HERE / "source6-package-v3.py")
PROPOSAL = json.loads((ROOT / "ops/arena-consumer-release-review/proposal.v1.json").read_bytes())
REFERENCE = Path(PROPOSAL["baseConsumer"]["localVerifiedReference"])
# Reconstruct the exact accepted public manifest from its retained predecessor
# and the frozen three-row patch receipt, without copying/building any runtime.
BEFORE = json.loads((REFERENCE / "RELEASE-MANIFEST.json").read_bytes())
refs = {row["path"]: row for row in PROPOSAL["sourcePatch"]}
rows = []
for row in BEFORE["files"]:
    if row["path"] == m.PREFIX + "server.ts":
        rows.append({key: refs[m.PREFIX + "selectedSourceRuntime.ts"][key] for key in ["path", "bytes", "sha256"]})
    rows.append({key: refs[row["path"]][key] for key in ["path", "bytes", "sha256"]} if row["path"] in refs else row)
BEFORE = {**BEFORE, "files": rows, "sourceDigest": m.sha(m.encoded(rows))}
PATCHES = lambda: {name: (ROOT / name).read_bytes() for name in m.PATCHES}
TEMPLATES = {m.template_path(w): (REFERENCE / m.template_path(w)).read_bytes() for w in PROPOSAL["workers"]}


def runtime_pair():
    names = ["apps/yunipals-market-api/dist/arena-native-disclosure.mjs", "apps/yunipals-market-api/dist/arena-native-disclosure.mjs.map", "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs", "node_modules/dep/index.js"]
    rows = [{"path": name, "type": "file", "mode": 0o644, "bytes": 1, "sha256": "a" * 64} for name in names]
    before = {"roots": ["node_modules", "apps/yunipals-market-api/dist"], "entries": rows, "bundleProof": {"bundles": [{"path": names[0], "sourcePaths": [m.PREFIX + "config.ts"]}]}}
    after = copy.deepcopy(before)
    for row in after["entries"][:2]: row["sha256"] = "b" * 64
    return before, after


class Tests(unittest.TestCase):
    def test_exact_accepted_manifest_and_helper_pins(self):
        self.assertEqual(BEFORE["sourceDigest"], m.BASE_DIGEST)
        self.assertEqual(m.sha(m.encoded(BEFORE)), m.BASE_MANIFEST_SHA)
        self.assertEqual(len(BEFORE["files"]), 1746)
        self.assertEqual(m.sha((HERE / "source6-package-v3.py").read_bytes()), m.PRIMITIVES_SHA)
        self.assertEqual(m.sha((ROOT / "ops/unified-indexer/runtime-supplement.py").read_bytes()), m.RUNTIME_HELPER_SHA)
        self.assertEqual(m.sha((ROOT / "ops/arena-consumer-release-review/proposal.v1.json").read_bytes()), m.PROPOSAL_SHA)
        self.assertEqual(m.sha((HERE / "arena-consumer-package-v4.py").read_bytes()), "846e4d641b57c5de5e44ba281636a98b3dedc328e1ffcbf460f3ce156de0793b")

    def test_only_config_and_two_new_sources_change(self):
        value = m.candidate_manifest(BEFORE, PATCHES(), PROPOSAL)
        a = {row["path"]: row for row in BEFORE["files"]}; b = {row["path"]: row for row in value["files"]}
        self.assertEqual({name for name in a.keys() | b.keys() if a.get(name) != b.get(name)}, set(m.PATCHES))
        self.assertEqual(len(b), 1748)
        self.assertEqual(m.sha(m.encoded(value["files"])), value["sourceDigest"])
        self.assertEqual(value["repositoryHead"], BEFORE["repositoryHead"])

    def test_wrong_patch_missing_file_extra_source_or_baseline_refused(self):
        for name in m.PATCHES:
            with self.assertRaises(m.PackageFailure): m.candidate_manifest(BEFORE, {**PATCHES(), name: PATCHES()[name] + b"\n"}, PROPOSAL)
        for value in [{k: v for k, v in PATCHES().items() if k.endswith("config.ts")}, {**PATCHES(), "unrelated.ts": b"x"}]:
            with self.assertRaises(m.PackageFailure): m.candidate_manifest(BEFORE, value, PROPOSAL)
        wrong = copy.deepcopy(BEFORE); wrong["files"][0]["sha256"] = "0" * 64
        with self.assertRaises(m.PackageFailure): m.candidate_manifest(wrong, PATCHES(), PROPOSAL)

    def test_dependency_other_bundle_mode_link_and_path_drift_refused(self):
        before, after = runtime_pair()
        self.assertEqual(m.runtime_changes(before, after), sorted(row["path"] for row in after["entries"][:2]))
        for index, key, value in [(3, "sha256", "c" * 64), (2, "sha256", "c" * 64), (0, "mode", 0o755), (0, "type", "symlink"), (0, "target", "different")]:
            wrong = copy.deepcopy(after); wrong["entries"][index][key] = value
            with self.assertRaises(m.PackageFailure): m.runtime_changes(before, wrong)
        for entries in [after["entries"][:-1], after["entries"] + [after["entries"][0]], before["entries"]]:
            with self.assertRaises(m.PackageFailure): m.runtime_changes(before, {**after, "entries": entries})

    def test_old_sourcemap_must_authorize_changed_bundle(self):
        before, after = runtime_pair()
        before["bundleProof"]["bundles"][0]["sourcePaths"] = [m.PREFIX + "runtime.ts"]
        with self.assertRaises(m.PackageFailure): m.runtime_changes(before, after)

    def test_new_reader_in_each_old_config_bundle_and_no_test_in_runtime(self):
        before, after = runtime_pair()
        bundles = [{"path": before["bundleProof"]["bundles"][0]["path"], "sourcePaths": [m.PREFIX + "config.ts", m.PREFIX + "privateFile.ts"]}]
        m.credential_bundle_sources(before, bundles)
        for values in [[], [{**bundles[0], "sourcePaths": [m.PREFIX + "config.ts"]}], [{**bundles[0], "sourcePaths": [*bundles[0]["sourcePaths"], m.PREFIX + "privateFile.test.ts"]}]]:
            with self.assertRaises(m.PackageFailure): m.credential_bundle_sources(before, values)

    def test_real_tiny_archive_is_repeated_and_excludes_unlisted_env(self):
        with tempfile.TemporaryDirectory() as raw:
            work = Path(raw); source = work / "source"; source.mkdir(); (source / "app").mkdir()
            manifest = {"files": [{"path": "app/index.ts", "bytes": 4, "sha256": m.sha(b"test")}], "sourceDigest": "fixture"}
            (source / "app/index.ts").write_bytes(b"test")
            (source / "RELEASE-MANIFEST.json").write_bytes(m.encoded(manifest)); (source / "SHA256SUMS").write_text("fixture\n")
            (source / ".env").write_bytes(b"excluded")
            for name in ["a.tar.gz", "b.tar.gz"]: p.source_archive(source, manifest, work / name)
            self.assertEqual((work / "a.tar.gz").read_bytes(), (work / "b.tar.gz").read_bytes())
            with tarfile.open(work / "a.tar.gz") as archive:
                self.assertNotIn("./.env", archive.getnames())
                self.assertEqual(archive.extractfile("./app/index.ts").read(), b"test")
                self.assertTrue(all(row.uid == row.gid == row.mtime == 0 for row in archive))

    def test_hidden_volume_siblings_and_no_unquoted_names(self):
        with tempfile.TemporaryDirectory() as raw:
            volume = Path(raw); work = volume / "owned"; work.mkdir(); (volume / "retained").mkdir(); (volume / "lost+found").mkdir(); (volume / ".yunipals-full-restore-v1.lock").touch()
            with patch.object(m, "VOLUME", volume), patch.object(m, "WORK", work):
                self.assertEqual(m.hidden_children(), sorted([str(volume / "retained"), str(volume / "lost+found")]))
                (volume / "unsafe name").mkdir()
                with self.assertRaises(m.PackageFailure): m.hidden_children()

    def test_hardened_unit_only_fresh_work_writable_and_no_credentials(self):
        unit = m.unit_text("review", {"hiddenVolumeChildren": [str(m.VOLUME / "retained")]})
        for line in ["PrivateNetwork=yes", "RestrictAddressFamilies=AF_UNIX", "CapabilityBoundingSet=", "AmbientCapabilities=", "NoNewPrivileges=yes", "ProtectSystem=strict", "ProtectHome=yes", "ReadWritePaths=" + str(m.WORK), "MemoryMax=2G", "RuntimeMaxSec=35min", "TimeoutStartSec=35min", "KillMode=control-group", "Restart=no"]: self.assertIn(line, unit)
        for name in m.PRIVATE | {str(m.VOLUME / "retained")}: self.assertIn(name, unit)
        self.assertNotIn("EnvironmentFile=", unit); self.assertNotIn("LoadCredential=", unit)
        self.assertNotIn("--build", unit); self.assertIn("--build REVIEW_HASH", m.unit_text("build", {"hiddenVolumeChildren": []}))

    def test_effective_properties_reject_network_env_caps_and_extra_write(self):
        plan = {"hiddenVolumeChildren": []}
        values = {"Id": "yunipals-arena-credential-package-v2-review-20261022.service", "MainPID": str(os.getpid()), "Type": "oneshot", "User": "root", "Group": "root", "Environment": "PYTHONDONTWRITEBYTECODE=1", "EnvironmentFiles": "", "PrivateNetwork": "yes", "PrivateTmp": "no", "ProtectSystem": "strict", "ProtectHome": "yes", "NoNewPrivileges": "yes", "CapabilityBoundingSet": "", "AmbientCapabilities": "", "RestrictAddressFamilies": "AF_UNIX", "ReadWritePaths": str(m.WORK), "MemoryMax": "2147483648", "MemorySwapMax": "0", "CPUQuotaPerSecUSec": "1s", "RuntimeMaxUSec": "35min", "TimeoutStartUSec": "35min", "TimeoutStopUSec": "30s", "KillMode": "control-group", "Restart": "no", "InaccessiblePaths": " ".join(sorted(m.PRIVATE)), "IOReadBandwidthMax": "/dev/sdb 52428800", "IOWriteBandwidthMax": "/dev/sdb 52428800"}
        status = "\n".join([*[key + ":\t0" for key in ["CapPrm", "CapEff", "CapInh", "CapAmb", "CapBnd"]], "NoNewPrivs:\t1"])
        def invoke(properties):
            result = types.SimpleNamespace(stdout="\n".join(key + "=" + value for key, value in properties.items()))
            with patch.object(m.subprocess, "run", return_value=result), patch.object(Path, "read_text", return_value=status):
                return m.check_unit(types.SimpleNamespace(), "review", plan)
        self.assertEqual(invoke(values)["PrivateNetwork"], "yes")
        for key, value in [("PrivateNetwork", "no"), ("EnvironmentFiles", "/private"), ("Environment", "SECRET=x"), ("CapabilityBoundingSet", "cap_dac_override"), ("ReadWritePaths", str(m.VOLUME)), ("KillMode", "process")]:
            with self.assertRaises(m.PackageFailure): invoke({**values, key: value})

    def test_real_tiny_child_has_clean_environment_and_correct_modes(self):
        with tempfile.TemporaryDirectory() as raw:
            work = Path(raw); (work / "proof").mkdir(); (work / "tmp").mkdir()
            env = {**m.ENV, "TMPDIR": str(work / "tmp")}
            mini = types.SimpleNamespace(file_sha=lambda path: m.sha(Path(path).read_bytes()))
            with patch.object(m, "WORK", work), patch.object(m, "ENV", env):
                build = m.Build({"binding": {}}, mini, None, None, None, None, None, None); build.guard = lambda **_: None
                code = "import os,pathlib;assert set(os.environ)<=set(" + repr(list(env)) + ");pathlib.Path('made').write_bytes(b'x')"
                build.run("tiny-build", [sys.executable, "-c", code], work, build=True)
                self.assertEqual(stat.S_IMODE((work / "made").stat().st_mode), 0o644)
                (work / "made").unlink(); build.run("tiny-private", [sys.executable, "-c", code], work)
                self.assertEqual(stat.S_IMODE((work / "made").stat().st_mode), 0o600)

    def test_failure_retains_attempt_and_withholds_arbitrary_messages(self):
        with tempfile.TemporaryDirectory() as raw:
            with patch.object(m, "WORK", Path(raw)):
                build = m.Build({"reviewHash": "a" * 64}, None, None, None, None, None, None, None)
                build.build = lambda: (_ for _ in ()).throw(RuntimeError("unapproved arbitrary message"))
                with self.assertRaises(RuntimeError): build.execute()
                result = json.loads((Path(raw) / "attempt-result.json").read_bytes())
                self.assertEqual(result["fixedCode"], "external_operation_failed")
                self.assertFalse(result["automaticRetryAllowed"])
                self.assertNotIn("unapproved arbitrary message", json.dumps(result))
                with self.assertRaises(FileExistsError): build.execute()

    def test_resource_guard_refuses_replaced_root_or_low_free_space(self):
        with tempfile.TemporaryDirectory() as raw:
            work = Path(raw); own = work.lstat()
            binding = {"workIdentity": [own.st_dev, own.st_ino, own.st_uid, own.st_gid, own.st_mode]}
            with patch.object(m, "WORK", work), patch.object(m.shutil, "disk_usage", return_value=types.SimpleNamespace(free=50_000_000_000)):
                build = m.Build({"binding": binding}, None, None, None, None, None, None, None)
                build.guard(force=True)
                with patch.object(m.shutil, "disk_usage", return_value=types.SimpleNamespace(free=24_000_000_000)):
                    with self.assertRaises(m.PackageFailure): build.guard(force=True)
                work.rename(work.parent / (work.name + "-old")); work.mkdir()
                try:
                    with self.assertRaises(m.PackageFailure): build.guard(force=True)
                finally:
                    work.rmdir(); (work.parent / (work.name + "-old")).rename(work)

    def test_rendered_units_keep_eight_roles_and_private_paths_as_public_text(self):
        units = m.render_units(PROPOSAL, "d" * 64, TEMPLATES)
        self.assertEqual(len(units), 8)
        for name, text in units.items():
            self.assertIn("/opt/yunipals-unified/releases/" + "d" * 64, text)
            self.assertIn("ARENA_ENTRIES_ENABLED=false", text); self.assertIn("ARENA_NEW_LOBBIES_ENABLED=false", text)
        self.assertIn("LoadCredential=execution.key:/etc/yunipals-arena/operator.key", units["yunipals-arena-native-execution@lobby.service"])

    def test_successor_preserves_failed_v1_and_changes_only_fixed_attempt_identity(self):
        original = (HERE / "arena-credential-package-v1.py").read_bytes()
        self.assertEqual(m.sha(original), "e0770439a818dd6fa131f5915fe6281fa6bda1d75b82b7c64e2b566102c23a74")
        expected = original.decode().replace("arena-credential-dependency-clone-package-v1", "arena-credential-dependency-clone-package-v2").replace("arena-credential-package-v1", "arena-credential-package-v2").replace("arena-credential-package-20261022", "arena-credential-package-20261022-b").replace("e4be62c1cea651f4f93f4069bec24a65bdc8e54a828222fb9a978a8f494825cf", "2b2aa80c0732db2814d8484b968b96159d22379aa67c0ceba90902191ae59b54")
        self.assertEqual(Path(m.__file__).read_text(), expected)
        self.assertNotEqual(m.WORK.name, "arena-credential-package-20261022")

    def test_actual_node24_fixture_suite_under_builder_umask077(self):
        node = Path("/root/.nvm/versions/node/v24.18.1/bin/node")
        self.assertTrue(node.is_file(), "Existing pinned local Node24 required; never install/download.")
        with tempfile.TemporaryDirectory() as raw:
            env = {"PATH": str(node.parent) + ":/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC", "TMPDIR": raw}
            command = [str(node), "--import", "tsx", "--input-type=module", "-e", 'process.umask(0o077); await import("./src/arena/live/privateFile.test.ts")']
            result = subprocess.run(command, cwd=ROOT / "apps/yunipals-market-api", env=env, capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0)
            self.assertTrue(result.stdout, "Empty subprocess output is not test evidence.")
            self.assertRegex(result.stdout, r"(?m)^(?:#|ℹ) tests 79$")
            self.assertRegex(result.stdout, r"(?m)^(?:#|ℹ) pass 79$")
            self.assertRegex(result.stdout, r"(?m)^(?:#|ℹ) fail 0$")
            self.assertEqual(result.stderr, "")


if __name__ == "__main__": unittest.main()
