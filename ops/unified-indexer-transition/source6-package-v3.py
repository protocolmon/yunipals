#!/usr/bin/env python3
"""Review/build source6 from source5 plus three fixed patches; no install/deploy."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tarfile
import time
import types

FORMAT = "yunipals-source6-dependency-clone-package-v3"
OPS = Path("/opt/yunipals-unified/operations/source6-package-20261021")
BASE_DIGEST = "d727f87e341f3519c6a69cd38ac67d7366dc5e0c136d8b9a2746ec75eefb0eae"
BASE = Path("/opt/yunipals-unified/releases") / BASE_DIGEST
BASE_RUNTIME = Path("/var/tmp/yunipals-runtime-d727f87e-20261021")
BASE_MANIFEST_SHA = "ec5b8db7b1027c93732d56d34f97f06b56b24c4bbe4ef0597b85c687d04276ed"
BASE_INVENTORY_SHA = "06e9b013fc93785c48da7a2e755d051cdca557d67e4b32796b936ecf5737502e"
BASE_ARCHIVE_SHA = "d9d490e89bfd065a8e46bbfa7ccd28d6cf760e4c40df6ef6fec9b916a2c49293"
RUNTIME_HELPER_SHA = "49c1aef0a5aa38c3142e2132a1e88339889ebfcca917ea6f8dcb4e41f39793c4"
NATIVE_HELPER_SHA = "4c672f48a129fd459d97f197753131496875f5f9f1eba66ec9a3e37fbff14f7b"
SELECTORS_SHA = "40949c026ae31583fe5e6a2517508c87d987a7fd53880a99dbdff1d1063303a4"
PROFILE_SHA = "a3e6f755b8f13dce51ae4f9b053fb855533e7cc49ee182f14535701e0acc6232"
PATCHES = {
    "apps/yunipals-market-api/src/rpcBudgetProxy.ts": "0f3731e081401ec41e7bba7ac40c375b71c15834a4019a0b84e521e4ba38fb68",
    "apps/yunipals-market-api/src/rpcBudgetProxy.test.ts": "8fa83cbf7079753c7fbfafabfdca06fdf0a90701fe446c3e024f1cdf447ba30e",
    "apps/yunipals-market-api/src/rpcBudgetProxy.paidPrimary.test.ts": "de27c6d2c1245121b83f7ae5a6f812b38af323cb21e288c40ac0b6c42fef9c62"
}
WORK = Path("/tmp/yunipals-unified-release-Source6A")
NODE = "/opt/node-v24.18.1/bin/node"
NODE_SHA = "f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a"
NATIVE = "bf4939b3ff"
MANIFEST = "0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029"
RESERVE, WORK_CAP, DEADLINE = 25_000_000_000, 2_000_000_000, 1800
ENV = {"PATH": str(Path(NODE).parent) + ":/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC", "PYTHONDONTWRITEBYTECODE": "1", "COREPACK_ENABLE_NETWORK": "0", "TMPDIR": str(WORK / "tmp")}
CHANGED_BUNDLES = {"apps/yunipals-market-api/dist/rpc-budget-proxy.mjs", "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs.map"}


def fail(message):
    raise RuntimeError(message)


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for b in iter(lambda: f.read(1048576), b""):
            h.update(b)
    return h.hexdigest()


def trusted(path, maximum=20_000_000):
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        fail("Protected absolute public input required.")
    for item in [*path.parents, path]:
        s = item.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or (s.st_mode & 0o022 and not (stat.S_ISDIR(s.st_mode) and s.st_mode & stat.S_ISVTX)):
            fail("Public input ancestry is not protected.")
    s = path.stat()
    if not stat.S_ISREG(s.st_mode) or s.st_size > maximum:
        fail("Bounded regular public input required.")
    before = (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    raw = path.read_bytes()
    s = path.stat()
    if before != (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns) or len(raw) > maximum:
        fail("Public input changed while reading.")
    return raw


def pinned(path, expected, maximum=20_000_000):
    raw = trusted(path, maximum)
    if sha(raw) != expected:
        fail("Public package input checksum differs.")
    return raw


def checked_file_hash(path, expected, maximum):
    """Verify large public inputs without materializing them in controller RAM."""
    path = Path(path)
    if not path.is_absolute() or ".." in path.parts:
        fail("Protected absolute public input required.")
    for item in [*path.parents, path]:
        s = item.lstat()
        if stat.S_ISLNK(s.st_mode) or s.st_uid != 0 or (s.st_mode & 0o022 and not (stat.S_ISDIR(s.st_mode) and s.st_mode & stat.S_ISVTX)):
            fail("Public input ancestry is not protected.")
    s = path.stat()
    before = (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if not stat.S_ISREG(s.st_mode) or s.st_size > maximum or file_sha(path) != expected:
        fail("Bounded protected public checksum differs.")
    s = path.stat()
    if before != (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns):
        fail("Public input changed while hashing.")


def source_path(name):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9@_./+-]+", name) or any(x in {"", ".", ".."} or x.startswith(".") for x in name.split("/")):
        fail("Only frozen regular source paths are allowed.")
    return name


def candidate_manifest(before, patches):
    if before.get("format") != "yunipals-unified-source-release-v1" or before.get("sourceDigest") != BASE_DIGEST or sha(encoded(before.get("files"))) != BASE_DIGEST or set(patches) != set(PATCHES):
        fail("Exact source5 inventory and three patches required.")
    rows = []
    seen = set()
    added = "apps/yunipals-market-api/src/rpcBudgetProxy.paidPrimary.test.ts"
    anchor = "apps/yunipals-market-api/src/rpcBudgetProxy.rangeAdaptation.test.ts"
    for row in before["files"]:
        name = source_path(row["path"])
        if name in seen or name == added:
            fail("Duplicate or preexisting paid-primary source path.")
        seen.add(name)
        if name == anchor:
            rows.append({"path": added, "bytes": len(patches[added]), "sha256": sha(patches[added])})
        if name in patches:
            rows.append({"path": name, "bytes": len(patches[name]), "sha256": sha(patches[name])})
        else:
            rows.append(row)
    if not set(PATCHES).difference({added}).issubset(seen) or anchor not in seen:
        fail("Exact original proxy/test/anchor paths required.")
    for name, raw in patches.items():
        if sha(raw) != PATCHES[name]:
            fail("Reviewed patch checksum differs.")
    return {**before, "sourceDigest": sha(encoded(rows)), "files": rows}


def runtime_delta(old, new):
    a, b = ({r["path"]: r for r in v["entries"]} for v in [old, new])
    if len(a) != len(old["entries"]) or len(b) != len(new["entries"]) or a.keys() != b.keys() or old["roots"] != new["roots"]:
        fail("Runtime path/roots/duplicate closure differs.")
    changed = [p for p in a if a[p] != b[p]]
    if set(changed) != CHANGED_BUNDLES or any(any(a[p].get(k) != b[p].get(k) for k in ["type", "mode", "target"]) for p in changed):
        fail("Only the proxy bundle and map may differ; dependency/shim/metadata bytes must match.")
    packages = [p for p in a if a[p]["type"] == "directory" and p.startswith("node_modules/.pnpm/") and len(Path(p).parts) == 3 and Path(p).name != "node_modules"]
    if len(packages) != 330:
        fail("Exactly330 frozen dependency packages required.")
    return {"pathSetUnchanged": True, "typeModeSymlinkClosureUnchanged": True, "dependencyPackagesUnchanged": 330, "dependencyBytesLinksShimsAndMetadataUnchanged": True, "normalizationApplied": False, "changes": [{"path": p, "before": a[p], "after": b[p]} for p in sorted(changed)]}


def copy_source(base, destination, manifest):
    destination.mkdir(mode=0o700)
    for row in manifest["files"]:
        name = source_path(row["path"])
        raw = pinned(base / name, row["sha256"], 5_000_000)
        if len(raw) != row["bytes"]:
            fail("Frozen source size differs.")
        target = destination / name
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        target.write_bytes(raw)
        target.chmod(0o600)
    (destination / "RELEASE-MANIFEST.json").write_bytes(encoded(manifest))
    (destination / "SHA256SUMS").write_text("".join(f"{r['sha256']}  {r['path']}\n" for r in manifest["files"]))


def patch_source(root, manifest, patches):
    for name, raw in patches.items():
        target = root / name
        if target.is_symlink():
            fail("Patch target cannot be a symlink.")
        target.write_bytes(raw)
        target.chmod(0o600)
    (root / "RELEASE-MANIFEST.json").write_bytes(encoded(manifest))
    (root / "SHA256SUMS").write_text("".join(f"{r['sha256']}  {r['path']}\n" for r in manifest["files"]))


def source_archive(root, manifest, target):
    names = {"RELEASE-MANIFEST.json", "SHA256SUMS", *[r["path"] for r in manifest["files"]]}
    for name in list(names):
        names.update(p.as_posix() for p in Path(name).parents if p != Path("."))
    with target.open("xb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0, compresslevel=9) as gz:
        with tarfile.open(fileobj=gz, mode="w|", format=tarfile.GNU_FORMAT) as tar:
            for name in [".", *sorted(names)]:
                p = root / name
                s = p.lstat()
                item = tarfile.TarInfo("." if name == "." else "./" + name)
                item.uid = item.gid = item.mtime = 0
                item.uname = item.gname = ""
                if stat.S_ISDIR(s.st_mode):
                    item.type, item.mode = tarfile.DIRTYPE, 0o700
                    tar.addfile(item)
                elif stat.S_ISREG(s.st_mode):
                    item.size, item.mode = s.st_size, 0o600
                    with p.open("rb") as f:
                        tar.addfile(item, f)
                else:
                    fail("Only exact regular source files/directories may be archived.")


def empty_environment_files_via_dbus(unit):
    # This host omits the empty complex property even with show --all. Query its
    # typed D-Bus property directly; a missing/unknown/nonempty value refuses.
    command=["/usr/bin/busctl","--json=short"]
    raw=subprocess.run([*command,"call","org.freedesktop.systemd1","/org/freedesktop/systemd1","org.freedesktop.systemd1.Manager","GetUnit","s",unit],env=ENV,capture_output=True,text=True,timeout=5,check=True)
    value=json.loads(raw.stdout)
    if set(value)!={"type","data"}or value["type"]!="o"or not isinstance(value["data"],list)or len(value["data"])!=1 or not isinstance(value["data"][0],str)or not re.fullmatch(r"/org/freedesktop/systemd1/unit/[A-Za-z0-9_]+",value["data"][0]):
        fail("Exact service D-Bus object identity required.")
    raw=subprocess.run([*command,"get-property","org.freedesktop.systemd1",value["data"][0],"org.freedesktop.systemd1.Service","EnvironmentFiles"],env=ENV,capture_output=True,text=True,timeout=5,check=True)
    value=json.loads(raw.stdout)
    if value!={"type":"a(sb)","data":[]}:
        fail("Typed empty environment-file array required.")
    return ""


def check_unit(mode):
    fields = ["MainPID", "PrivateNetwork", "PrivateTmp", "RestrictAddressFamilies", "ProtectSystem", "NoNewPrivileges", "ReadWritePaths", "InaccessiblePaths", "MemoryMax", "MemorySwapMax", "CPUQuotaPerSecUSec", "RuntimeMaxUSec", "Restart", "EnvironmentFiles"]
    unit = f"yunipals-source6-package-v3-{mode}-20261021.service"
    completed = subprocess.run(["/usr/bin/systemctl", "show", "--all", unit, *["--property=" + k for k in fields]], env=ENV, capture_output=True, text=True, timeout=5, check=True)
    p = {}
    for line in completed.stdout.splitlines():
        key, sep, value = line.partition("=")
        if not sep or key not in fields or key in p:
            fail("Exact bounded source6 unit properties required.")
        p[key] = value
    if "EnvironmentFiles"not in p:
        p["EnvironmentFiles"]=empty_environment_files_via_dbus(unit)
    exact = {"MainPID": str(os.getpid()), "PrivateNetwork": "yes", "PrivateTmp": "no", "RestrictAddressFamilies": "AF_UNIX", "ProtectSystem": "strict", "NoNewPrivileges": "yes", "ReadWritePaths": str(WORK), "MemoryMax": "1610612736", "MemorySwapMax": "0", "CPUQuotaPerSecUSec": "1s", "RuntimeMaxUSec": "35min", "Restart": "no", "EnvironmentFiles": ""}
    if any(p.get(k) != v for k, v in exact.items()) or set(p.get("InaccessiblePaths", "").split()) != {"/run/postgresql", "/var/run/postgresql", "/var/lib/postgresql", "/mnt/HC_Volume_107222036"}:
        fail("Source6 must run in the exact offline bounded unit without credential files.")
    return {k: v for k, v in exact.items() if k != "MainPID"}


def load_runtime_helper():
    raw = pinned(OPS / "runtime-supplement.py", RUNTIME_HELPER_SHA)
    module = types.ModuleType("source6_frozen_runtime")
    module.__file__ = str(OPS / "runtime-supplement.py")
    exec(compile(raw, module.__file__, "exec"), module.__dict__)
    return module


def review(plan, mode):
    if os.geteuid() != 0 or plan != {"format": FORMAT, "work": str(WORK), "source5Root": str(BASE), "source5RuntimeDirectory": str(BASE_RUNTIME), "node": NODE, "operatorSha256": file_sha(Path(__file__).resolve())}:
        fail("Exact fixed source6 packaging plan/root required.")
    unit = check_unit(mode)
    if WORK.is_symlink() or not WORK.is_dir() or WORK.stat().st_uid != 0 or stat.S_IMODE(WORK.stat().st_mode) != 0o700 or any(WORK.iterdir()) or WORK.stat().st_dev != BASE.stat().st_dev:
        fail("A fresh empty root0700 work directory on the source/root filesystem is required.")
    if shutil.disk_usage(WORK).free < RESERVE + WORK_CAP:
        fail("Source6 requires25GB reserve plus2GB bounded build allowance.")
    before = json.loads(pinned(BASE / "RELEASE-MANIFEST.json", BASE_MANIFEST_SHA))
    helper = load_runtime_helper()
    helper.source_check(BASE, BASE_DIGEST)
    inventory = json.loads(pinned(BASE_RUNTIME / "runtime-supplement.inventory.json", BASE_INVENTORY_SHA, 40_000_000))
    archive = BASE_RUNTIME / "runtime-supplement.tar.gz"
    checked_file_hash(archive, BASE_ARCHIVE_SHA, 250_000_000)
    if inventory.get("sourceDigest") != BASE_DIGEST or inventory.get("archiveSha256") != BASE_ARCHIVE_SHA or len(inventory.get("entries", [])) != 60918:
        fail("Exact source5 runtime archive/inventory required.")
    checked_file_hash(Path(NODE), NODE_SHA, 150_000_000)
    helper.platform_check(NODE, inventory["runtime"])
    patches = {p: pinned(OPS / "patches" / p, h, 5_000_000) for p, h in PATCHES.items()}
    for name, h in [("native-build-offline.mjs", NATIVE_HELPER_SHA), ("source-selectors.json", SELECTORS_SHA), ("rpc-profile.json", PROFILE_SHA)]:
        pinned(OPS / name, h)
    manifest = candidate_manifest(before, patches)
    binding = {"format": FORMAT, "plan": plan, "unit": unit, "source5ManifestSha256": BASE_MANIFEST_SHA, "source5InventorySha256": BASE_INVENTORY_SHA, "source5ArchiveSha256": BASE_ARCHIVE_SHA, "runtimeHelperSha256": RUNTIME_HELPER_SHA, "nativeHelperSha256": NATIVE_HELPER_SHA, "nodeSha256": NODE_SHA, "selectorsSha256": SELECTORS_SHA, "profileSha256": PROFILE_SHA, "patches": PATCHES, "candidateSourceDigest": manifest["sourceDigest"], "candidateManifestSha256": sha(encoded(manifest)), "sourceFiles": len(manifest["files"]), "reserveBytes": RESERVE, "workCapBytes": WORK_CAP, "deadlineSeconds": DEADLINE, "dependencyMethod": "verified_source5_closure_clone_offline_rebuild", "packageManagerInstallPerformed": False, "providerCalls": 0, "databaseConnections": 0, "paidOptionConfiguredOrEnabled": False}
    return {"binding": binding, "reviewHash": sha(json.dumps(binding, sort_keys=True, separators=(",", ":")).encode())}, before, manifest, patches, inventory


class Build:
    def __init__(self, approved, before, manifest, patches, baseline):
        self.approved, self.before, self.manifest, self.patches, self.baseline = approved, before, manifest, patches, baseline
        self.started = time.monotonic()
        self.minimum_free = shutil.disk_usage(WORK).free
        self.maximum_allocated = 0
        self.steps = []
        self.child = None

    def guard(self):
        free = shutil.disk_usage(WORK).free
        self.minimum_free = min(self.minimum_free, free)
        allocated = 0
        for directory, dirs, files in os.walk(WORK, followlinks=False):
            try:
                allocated += Path(directory).lstat().st_blocks * 512
            except FileNotFoundError:
                continue
            for name in [*dirs, *files]:
                p = Path(directory) / name
                try:
                    if p.is_symlink() or not p.is_dir():
                        allocated += p.lstat().st_blocks * 512
                except FileNotFoundError:
                    continue  # Owned compiler temporary file completed between observations.
        self.maximum_allocated = max(self.maximum_allocated, allocated)
        if free < RESERVE or allocated > WORK_CAP or time.monotonic() - self.started > DEADLINE:
            fail("Source6 disk allowance/reserve/deadline reached.")

    def stop_child(self):
        if self.child is not None and self.child.poll() is None:
            os.killpg(self.child.pid, signal.SIGTERM)
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait(timeout=5)

    def run(self, name, args, cwd, timeout=300, extra=None):
        self.guard()
        started = time.monotonic()
        env = {**ENV, **(extra or {})}
        output, error = WORK / "proof" / (name + ".stdout"), WORK / "proof" / (name + ".stderr")
        with output.open("xb") as out, error.open("xb") as err:
            # esbuild recreates only this new owned dist tree. Preserve the exact
            # accepted0755/0644 output modes; all other commands remain private.
            child_umask = 0o022 if name == "market-build" else 0o077
            self.child = subprocess.Popen(args, cwd=cwd, env=env, stdout=out, stderr=err, start_new_session=True, umask=child_umask)
            try:
                while self.child.poll() is None:
                    self.guard()
                    if time.monotonic() - started > timeout or max(output.stat().st_size, error.stat().st_size) > 4_000_000:
                        fail("Owned source6 command time/output cap reached.")
                    time.sleep(1)
                if self.child.returncode != 0:
                    fail("Owned source6 command failed; retain attempt without retry.")
                if max(output.stat().st_size, error.stat().st_size) > 4_000_000:
                    fail("Owned source6 final command output cap reached.")
            finally:
                self.stop_child()
        self.steps.append({"name": name, "exitCode": self.child.returncode, "seconds": round(time.monotonic() - started, 3), "stdoutSha256": file_sha(output), "stderrSha256": file_sha(error)})
        (WORK / "proof" / "steps.json").write_bytes(encoded(self.steps))
        self.guard()

    def runtime_args(self, command, source, digest, runtime_dir):
        pinned(OPS / "runtime-supplement.py", RUNTIME_HELPER_SHA)
        args = ["/usr/bin/python3", "-B", str(OPS / "runtime-supplement.py"), command]
        if command == "build":
            return [*args, "--source", str(source), "--source-digest", digest, "--output", str(runtime_dir), "--node", NODE]
        inventory_file = runtime_dir / "runtime-supplement.inventory.json"
        inventory = json.loads(pinned(inventory_file, BASE_INVENTORY_SHA, 40_000_000) if runtime_dir == BASE_RUNTIME else inventory_file.read_bytes())
        if runtime_dir == BASE_RUNTIME and file_sha(runtime_dir / "runtime-supplement.tar.gz") != BASE_ARCHIVE_SHA:
            fail("Source5 runtime input changed after review.")
        return [*args, "--archive", str(runtime_dir / "runtime-supplement.tar.gz"), "--inventory", str(runtime_dir / "runtime-supplement.inventory.json"), "--archive-sha256", inventory["archiveSha256"], "--inventory-sha256", file_sha(runtime_dir / "runtime-supplement.inventory.json"), "--target", str(source), "--node", NODE]

    def execute(self):
        with (WORK / "BUILD-ATTEMPT.json").open("xb") as f:
            f.write(encoded(self.approved))
        (WORK / "proof").mkdir(mode=0o700)
        (WORK / "tmp").mkdir(mode=0o700)
        error = None
        try:
            return self.build()
        except BaseException as e:
            error = type(e).__name__
            raise
        finally:
            self.stop_child()
            (WORK / "attempt-result.json").write_bytes(encoded({"format": FORMAT, "reviewHash": self.approved["reviewHash"], "status": "failed" if error else "passed", "errorClass": error, "steps": self.steps, "minimumRootFilesystemFreeBytes": self.minimum_free, "maximumWorkAllocatedBytes": self.maximum_allocated, "automaticRetryAllowed": False, "existingArtifactsModified": False, "providerCalls": 0, "databaseConnections": 0}))

    def build(self):
        source, root, relocated = [WORK / x for x in ["source", "unpacked", "relocated"]]
        copy_source(BASE, source, self.before)
        patch_source(source, self.manifest, self.patches)
        copy_source(BASE, root, self.before)
        self.run("clone-source5-runtime", self.runtime_args("install", root, BASE_DIGEST, BASE_RUNTIME), WORK)
        patch_source(root, self.manifest, self.patches)
        for name in ["source.tar.gz", "source-repeat.tar.gz"]:
            source_archive(source, self.manifest, WORK / name)
            self.guard()
        if file_sha(WORK / "source.tar.gz") != file_sha(WORK / "source-repeat.tar.gz"):
            fail("Source captures differ.")
        self.run("source-verify", [NODE, "ops/unified-indexer/prepare-release.mjs", "--verify", str(root)], root)
        # All old outputs are in this new owned copy, never in the installed release.
        shutil.rmtree(root / "apps/yunipals-market-api/dist")
        for app, name in [("yunipals-indexer", "indexer-typecheck"), ("yunipals-market-api", "market-typecheck")]:
            self.run(name, [NODE, "--max-old-space-size=1024", "node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false", "--incremental", "false"], root / "apps" / app)
        self.run("market-build", [NODE, "scripts/build.mjs"], root / "apps/yunipals-market-api")
        self.run("catalog-smoke", [NODE, "--import", "tsx", "../../ops/unified-indexer/prepare-release.smoke.mjs"], root / "apps/yunipals-market-api")
        pinned(OPS / "native-build-offline.mjs", NATIVE_HELPER_SHA)
        pinned(OPS / "rpc-profile.json", PROFILE_SHA)
        selectors = json.loads(pinned(OPS / "source-selectors.json", SELECTORS_SHA))
        self.run("native-build", [NODE, "--import", str(root / "apps/yunipals-indexer/node_modules/tsx/dist/loader.mjs"), str(OPS / "native-build-offline.mjs"), str(root), str(OPS / "rpc-profile.json")], root / "apps/yunipals-indexer", timeout=180, extra=selectors)
        native = json.loads((WORK / "proof/native-build.stdout").read_bytes())
        if native.get("buildId") != NATIVE or native.get("manifestHash") != MANIFEST or native.get("mockedPreflightIdentityResponses") != 12 or native.get("realProviderCalls") != 0 or native.get("databaseConnections") != 0:
            fail("Actual installed native build identity proof differs.")
        for suffix in ["a", "b"]:
            self.run("runtime-capture-" + suffix, self.runtime_args("build", root, self.manifest["sourceDigest"], WORK / ("runtime-" + suffix)), root)
        for name in ["runtime-supplement.tar.gz", "runtime-supplement.inventory.json"]:
            if file_sha(WORK / "runtime-a" / name) != file_sha(WORK / "runtime-b" / name):
                fail("Runtime captures differ.")
        inventory = json.loads((WORK / "runtime-a/runtime-supplement.inventory.json").read_bytes())
        delta = runtime_delta(self.baseline, inventory)
        if len(inventory.get("bundleProof", {}).get("bundles", [])) != 34 or inventory.get("bundleProof", {}).get("allSourceContentsMatch") is not True:
            fail("All34 rebuilt bundle/source-map proofs required.")
        copy_source(source, relocated, self.manifest)
        self.run("runtime-verify", self.runtime_args("verify", relocated, self.manifest["sourceDigest"], WORK / "runtime-a"), WORK)
        self.run("exclusive-relocation", self.runtime_args("install", relocated, self.manifest["sourceDigest"], WORK / "runtime-a"), WORK)
        self.run("relocated-source-verify", [NODE, "ops/unified-indexer/prepare-release.mjs", "--verify", str(relocated)], relocated)
        self.run("relocated-catalog-smoke", [NODE, "--import", "tsx", "../../ops/unified-indexer/prepare-release.smoke.mjs"], relocated / "apps/yunipals-market-api")
        catalog = json.loads((WORK / "proof/relocated-catalog-smoke.stdout").read_bytes())
        installed = json.loads((WORK / "proof/exclusive-relocation.stdout").read_bytes())
        if catalog.get("islands") != 898 or catalog.get("identityProfiles") != 4 or installed.get("sourceDigest") != self.manifest["sourceDigest"] or installed.get("sourceUnchanged") is not True or installed.get("entriesVerified") != 60918 or installed.get("networkCalls") != 0:
            fail("Actual relocation/catalog checks differ.")
        source_check = load_runtime_helper().source_check(root, self.manifest["sourceDigest"])
        if source_check != self.manifest:
            fail("Built source changed.")
        proof = {"format": FORMAT, "status": "passed_verified_dependency_clone_offline_rebuild", "sourceDigest": self.manifest["sourceDigest"], "nativeBuildId": NATIVE, "manifestHash": MANIFEST, "composition": {"baseSourceDigest": BASE_DIGEST, "exactPatchedSources": PATCHES, "workspaceWideRecapture": False, "nativeSourceChanged": False}, "source": {"archive": str(WORK / "source.tar.gz"), "archiveSha256": file_sha(WORK / "source.tar.gz"), "sourceManifestSha256": sha(encoded(self.manifest)), "lockfileSha256": file_sha(source / "pnpm-lock.yaml"), "files": len(self.manifest["files"]), "byteIdenticalSecondCapture": True}, "runtime": {"archive": str(WORK / "runtime-a/runtime-supplement.tar.gz"), "archiveSha256": file_sha(WORK / "runtime-a/runtime-supplement.tar.gz"), "inventory": str(WORK / "runtime-a/runtime-supplement.inventory.json"), "inventorySha256": file_sha(WORK / "runtime-a/runtime-supplement.inventory.json"), "helperSha256": RUNTIME_HELPER_SHA, "buildRoot": str(root), "entries": len(inventory["entries"]), "byteIdenticalSecondCapture": True, "exactRuntimeDelta": delta, "proxyBundleSha256": file_sha(root / "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs")}, "verification": {"node": "24.18.1", "dependencyMethod": "verified_source5_closure_clone_offline_rebuild", "packageManagerInstallPerformed": False, "offlineInstall": {"performed": False, "packages": 330, "downloads": 0}, "indexerTypecheck": True, "marketTypecheck": True, "marketBuild": True, "marketEntrypoints": 34, "nativeBuild": native, "catalogSmoke": catalog, "cleanRelocationInstall": installed, "sourceReverified": True, "minimumRootFilesystemFreeBytes": self.minimum_free, "maximumWorkAllocatedBytes": self.maximum_allocated, "buildSteps": self.steps}, "qualifications": ["Fresh source6 source/build tree and regenerated outputs use the exact previously verified source5 dependency closure; no package-manager fresh install is claimed.", "Generated shims retain their original source5 build-root text unchanged. Supported runtime launchers use direct Node entrypoints, with NODE_PATH unset.", "Two captures prove byte-identical serialization of this source and rebuilt runtime, not two independent dependency installs or builds.", "No provider/DB call, secret input, source selector, endpoint, paid budget, permit or paid-primary option is enabled or changed by packaging.", "Previous frozen package validators are untouched and may deliberately reject this new dependency-clone evidence format; deployment needs an explicitly reviewed source6 validator.", "Runtime helper generic clean-build notes describe rebuilt source outputs; this combined proof explicitly disclaims a new dependency install.", "No source6 upload/backup, production installation, throughput or cutover acceptance is claimed."]}
        (WORK / "combined-source6-proof.json").write_bytes(encoded(proof))
        self.guard()
        return {"status": proof["status"], "sourceDigest": self.manifest["sourceDigest"], "sourceArchiveSha256": proof["source"]["archiveSha256"], "runtimeArchiveSha256": proof["runtime"]["archiveSha256"], "runtimeInventorySha256": proof["runtime"]["inventorySha256"], "proofSha256": file_sha(WORK / "combined-source6-proof.json"), "work": str(WORK), "deploymentPerformed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--build")
    args = parser.parse_args()
    os.umask(0o077)
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    result, before, manifest, patches, inventory = review(json.loads(trusted(args.plan)), "build" if args.build else "review")
    if args.build:
        if args.build != result["reviewHash"]:
            fail("Fresh exact source6 review hash required before build.")
        print(json.dumps(Build(result, before, manifest, patches, inventory).execute()))
    else:
        print(json.dumps({"format": FORMAT, "status": "reviewed_not_built", "reviewHash": result["reviewHash"], "sourceDigest": manifest["sourceDigest"], "sourceManifestSha256": sha(encoded(manifest)), "buildPerformed": False, "installOrDeploymentPerformed": False}))


if __name__ == "__main__":
    main()
