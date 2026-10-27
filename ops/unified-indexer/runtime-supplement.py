#!/usr/bin/env python3
"""Package/verify/install only immutable-release dependencies and built bundles.

No package manager, network client, environment file or application worker is
loaded. An installation requires independently pinned archive/inventory hashes,
the exact frozen source, matching platform/Node, and entirely absent payload
roots. Extraction uses a separate staging directory and never tar.extract().
"""
from __future__ import annotations

import argparse
import ctypes
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile


MAX_UNPACKED = 1_000_000_000
MAX_ARCHIVE = 250_000_000
MAX_ENTRIES = 100_000
ALLOWLIST = (
    "node_modules",
    "apps/yunipals-indexer/node_modules",
    "apps/yunipals-market-api/node_modules",
    "packages/yunipals-indexer-client/node_modules",
    "packages/yunipals-indexer-server/node_modules",
    "packages/yunipals-market-core/node_modules",
    "apps/yunipals-market-api/dist",
)
FORBIDDEN = {".git", ".ponder", ".env", "__pycache__"}


def fail(message):
    raise RuntimeError(message)


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def allocated_bound(rows):
    # Include directory/link blocks and round every file up; this supplement is
    # reviewed for the host's ordinary 4KiB filesystem allocation, not just size.
    return sum(((row["bytes"] + 4095) // 4096) * 4096 if row["type"] == "file" else 4096 for row in rows)


def safe_path(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        fail("Invalid relative payload path.")
    parts = name.split("/")
    if any(p in {"", ".", ".."} or p in FORBIDDEN or p.startswith(".env.") for p in parts):
        fail(f"Unsafe/private payload path: {name}")
    if PurePosixPath(name).is_absolute():
        fail("Absolute payload path is forbidden.")
    return name


def allowed(name):
    safe_path(name)
    return any(name == root or name.startswith(root + "/") for root in ALLOWLIST)


def plain_ancestors(root, name):
    current = root
    if root.is_symlink():
        fail("Release root cannot be a symlink.")
    for part in PurePosixPath(name).parts:
        current = current / part
        if current.is_symlink():
            fail(f"Symlink in a regular source/target ancestry: {name}")


def source_check(root, expected):
    manifest_path = root / "RELEASE-MANIFEST.json"
    plain_ancestors(root, "RELEASE-MANIFEST.json")
    manifest = json.loads(manifest_path.read_text())
    if (manifest.get("format") != "yunipals-unified-source-release-v1" or
            manifest.get("sourceDigest") != expected or
            hashlib.sha256(encoded(manifest["files"])).hexdigest() != expected):
        fail("Frozen source inventory identity differs.")
    seen = set()
    for row in manifest["files"]:
        name = safe_path(row["path"])
        if name in seen or allowed(name):
            fail("Source inventory overlaps runtime or contains duplicate paths.")
        seen.add(name)
        plain_ancestors(root, name)
        path = root / name
        if not path.is_file() or path.stat().st_size != row["bytes"] or digest(path) != row["sha256"]:
            fail(f"Frozen source checksum differs: {name}")
    sums = "".join(f"{row['sha256']}  {row['path']}\n" for row in manifest["files"])
    if (root / "SHA256SUMS").read_text() != sums:
        fail("Frozen source checksum list differs.")
    return manifest


def platform_check(node, expected=None):
    completed = subprocess.run([node, "-p", "JSON.stringify({node:process.versions.node,platform:process.platform,arch:process.arch,modules:process.versions.modules,napi:process.versions.napi})"],
                               capture_output=True, text=True, timeout=10, check=True)
    value = json.loads(completed.stdout)
    value["libc"] = list(platform.libc_ver())
    if value["node"] != "24.18.1" or value["platform"] != "linux" or value["arch"] != "x64":
        fail("Use Node24.18.1 on Linux x86_64.")
    if expected is not None and value != expected:
        fail("Runtime platform/Node ABI/libc differs from pinned supplement.")
    return value


def inventory_entries(root):
    roots = [name for name in ALLOWLIST if (root / name).exists()]
    rows = []
    for name in roots:
        plain_ancestors(root, name)
        if not (root / name).is_dir():
            fail("Payload roots must be real directories.")
        pending = [name]
        while pending:
            name = pending.pop()
            if not allowed(name):
                fail("Payload is outside the runtime allowlist.")
            path = root / name
            info = path.lstat()
            mode = stat.S_IMODE(info.st_mode)
            if not stat.S_ISLNK(info.st_mode) and mode & 0o7022:
                fail(f"Writable/special runtime mode is forbidden: {name}")
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(path)
                if PurePosixPath(target).is_absolute():
                    fail("Absolute symlink is forbidden.")
                resolved = path.resolve(strict=True)
                if not resolved.is_relative_to(root):
                    fail("Symlink leaves the frozen release.")
                rows.append({"path": name, "type": "symlink", "mode": 0o777, "target": target})
            elif stat.S_ISDIR(info.st_mode):
                rows.append({"path": name, "type": "directory", "mode": mode})
                pending.extend(sorted((f"{name}/{p.name}" for p in path.iterdir()), reverse=True))
            elif stat.S_ISREG(info.st_mode):
                rows.append({"path": name, "type": "file", "mode": mode,
                             "bytes": info.st_size, "sha256": digest(path)})
            else:
                fail("Special/hardlinked archive entries are forbidden.")
            if len(rows) > MAX_ENTRIES:
                fail("Runtime entry cap exceeded.")
    rows.sort(key=lambda row: row["path"])
    if not roots or "node_modules" not in roots or "apps/yunipals-market-api/dist" not in roots:
        fail("Missing runtime closure or compiled bundles.")
    if sum(x.get("bytes", 0) for x in rows) > MAX_UNPACKED or allocated_bound(rows) > MAX_UNPACKED:
        fail("Unpacked runtime cap exceeded.")
    return roots, rows


def bundle_proof(root, manifest):
    frozen = {x["path"]: x for x in manifest["files"]}
    bundles = []
    sources = set()
    for path in sorted((root / "apps/yunipals-market-api/dist").glob("*.mjs")):
        mapping = path.with_suffix(path.suffix + ".map")
        data = json.loads(mapping.read_text())
        if len(data["sources"]) != len(data["sourcesContent"]):
            fail("Bundle sourcemap omits source contents.")
        names = []
        for name, content in zip(data["sources"], data["sourcesContent"]):
            source = (mapping.parent / name).resolve(strict=True)
            if not source.is_relative_to(root):
                fail("Bundled source leaves the frozen release.")
            relative = source.relative_to(root).as_posix()
            if relative not in frozen or hashlib.sha256(content.encode()).hexdigest() != frozen[relative]["sha256"]:
                fail(f"Bundled source differs from frozen source: {relative}")
            sources.add(relative)
            names.append(relative)
        bundles.append({"path": path.relative_to(root).as_posix(), "sha256": digest(path),
                        "sourceMapSha256": digest(mapping), "sourcePaths": names})
    if not bundles:
        fail("No compiled source entrypoints found.")
    return {"bundles": bundles, "uniqueFrozenSourceFiles": len(sources), "allSourceContentsMatch": True}


def build(args):
    root = Path(args.source).absolute()
    output = Path(args.output).absolute()
    if output.exists():
        fail("Use a new output directory.")
    manifest = source_check(root, args.source_digest)
    runtime = platform_check(args.node)
    roots, rows = inventory_entries(root)
    proof = bundle_proof(root, manifest)
    output.mkdir(mode=0o700)
    archive = output / "runtime-supplement.tar.gz"
    with archive.open("xb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0, compresslevel=6) as compressed:
        with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT) as tar:
            for row in rows:
                item = tarfile.TarInfo(row["path"])
                item.mode = row["mode"]
                item.mtime = item.uid = item.gid = 0
                item.uname = item.gname = ""
                if row["type"] == "directory":
                    item.type = tarfile.DIRTYPE
                    tar.addfile(item)
                elif row["type"] == "symlink":
                    item.type = tarfile.SYMTYPE
                    item.linkname = row["target"]
                    tar.addfile(item)
                else:
                    item.size = row["bytes"]
                    with (root / row["path"]).open("rb") as handle:
                        tar.addfile(item, handle)
    if archive.stat().st_size > MAX_ARCHIVE:
        fail("Compressed runtime cap exceeded.")
    # Detect source/runtime changes during capture instead of silently packaging a mixed build.
    source_check(root, args.source_digest)
    if inventory_entries(root) != (roots, rows):
        fail("Runtime input changed during capture.")
    inventory = {"format": "yunipals-runtime-supplement-v1", "sourceDigest": args.source_digest,
                 "sourceManifestSha256": digest(root / "RELEASE-MANIFEST.json"),
                 "lockfileSha256": digest(root / "pnpm-lock.yaml"), "runtime": runtime,
                 "roots": roots, "entries": rows, "bundleProof": proof,
                 "archiveSha256": digest(archive), "archiveBytes": archive.stat().st_size,
                 "unpackedRegularBytes": sum(x.get("bytes", 0) for x in rows),
                 "limits": {"unpackedBytes": MAX_UNPACKED, "archiveBytes": MAX_ARCHIVE, "entries": MAX_ENTRIES},
                 "notes": ["No pnpm/build/network step performed; bytes copied from the clean offline build.",
                           "Generated pnpm shims retain their build-time NODE_PATH text; supported launchers use direct Node entrypoints with NODE_PATH unset.",
                           "Dependency packages may include unused platform prebuilds; pinned Linux x64/glibc/Node proof controls installation.",
                           "No env, .ponder, user data, credentials, .git or source file is packaged."]}
    inventory_path = output / "runtime-supplement.inventory.json"
    inventory_path.write_bytes(encoded(inventory))
    pins = {"archiveSha256": inventory["archiveSha256"], "inventorySha256": digest(inventory_path),
            "sourceDigest": args.source_digest, "archiveBytes": inventory["archiveBytes"],
            "unpackedRegularBytes": inventory["unpackedRegularBytes"], "entries": len(rows)}
    (output / "runtime-supplement.pins.json").write_bytes(encoded(pins))
    print(json.dumps(pins))


def checked_inputs(args):
    archive, inventory_path = Path(args.archive), Path(args.inventory)
    for expected in [args.archive_sha256, args.inventory_sha256]:
        if not re.fullmatch(r"[a-f0-9]{64}", expected):
            fail("Exact independent SHA256 pins are required.")
    if archive.stat().st_size > MAX_ARCHIVE or digest(archive) != args.archive_sha256:
        fail("Archive checksum/size differs.")
    if inventory_path.stat().st_size > 40_000_000 or digest(inventory_path) != args.inventory_sha256:
        fail("Inventory checksum/size differs.")
    inventory = json.loads(inventory_path.read_text())
    if (inventory["format"] != "yunipals-runtime-supplement-v1" or
            inventory["archiveSha256"] != args.archive_sha256 or inventory["archiveBytes"] != archive.stat().st_size):
        fail("Pinned inventory/archive binding differs.")
    target = Path(args.target).absolute()
    source_check(target, inventory["sourceDigest"])
    if (digest(target / "RELEASE-MANIFEST.json") != inventory["sourceManifestSha256"] or
            digest(target / "pnpm-lock.yaml") != inventory["lockfileSha256"]):
        fail("Frozen source/lockfile differs from the built runtime.")
    platform_check(args.node, inventory["runtime"])
    expected = {}
    for row in inventory["entries"]:
        name = row["path"]
        if not allowed(name) or name in expected or row["type"] not in {"directory", "file", "symlink"}:
            fail("Inventory contains duplicate/disallowed entries.")
        if row["type"] != "symlink" and (not isinstance(row["mode"], int) or row["mode"] & 0o7022):
            fail("Inventory contains unsafe modes.")
        expected[name] = row
    if (len(expected) > MAX_ENTRIES or sum(x.get("bytes", 0) for x in expected.values()) > MAX_UNPACKED or
            allocated_bound(expected.values()) > MAX_UNPACKED):
        fail("Inventory exceeds runtime caps.")
    for name in expected:
        for ancestor in PurePosixPath(name).parents:
            row = expected.get(str(ancestor))
            if row is not None and row["type"] != "directory":
                fail("Inventory path descends through a link or regular file.")
    if inventory["roots"] != [name for name in ALLOWLIST if name in expected]:
        fail("Inventory root allowlist differs.")
    for name in inventory["roots"]:
        plain_ancestors(target, str(PurePosixPath(name).parent))
        if os.path.lexists(target / name):
            fail(f"Runtime root already exists; no overwrite is allowed: {name}")
    return archive, inventory, target, expected


def extract_checked(archive, expected, staging=None):
    seen = set()
    links = []
    total = 0
    with tarfile.open(archive, mode="r|gz") as tar:
        for item in tar:
            name = item.name.rstrip("/") if item.isdir() else item.name
            safe_path(name)
            row = expected.get(name)
            if not row or name in seen or not allowed(name):
                fail("Archive contains duplicate or nonallowlisted entries.")
            seen.add(name)
            kind = "directory" if item.isdir() else "file" if item.isfile() else "symlink" if item.issym() else "forbidden"
            if kind != row["type"] or item.mode != row["mode"] or item.uid != 0 or item.gid != 0:
                fail("Archive type/mode/ownership differs from inventory.")
            if kind == "directory":
                if staging is not None:
                    path = staging / name
                    path.mkdir(parents=True, exist_ok=True)
                    path.chmod(row["mode"])
            elif kind == "symlink":
                if item.linkname != row["target"] or PurePosixPath(item.linkname).is_absolute():
                    fail("Symlink target differs/is absolute.")
                links.append(row)
            elif kind == "file":
                if item.size != row["bytes"] or item.size < 0:
                    fail("Archive file size differs.")
                total += item.size
                if total > MAX_UNPACKED:
                    fail("Archive inflated byte cap exceeded.")
                body = tar.extractfile(item)
                value = hashlib.sha256()
                out = None
                try:
                    if staging is not None:
                        path = staging / name
                        path.parent.mkdir(parents=True, exist_ok=True)
                        out = path.open("xb")
                    for chunk in iter(lambda: body.read(1024 * 1024), b""):
                        value.update(chunk)
                        if out:
                            out.write(chunk)
                finally:
                    body.close()
                    if out:
                        out.close()
                if value.hexdigest() != row["sha256"]:
                    fail("Archive regular-file checksum differs.")
                if staging is not None:
                    path.chmod(row["mode"])
    if seen != expected.keys():
        fail("Archive does not exactly match inventory.")
    # Resolve all links before adding any: a malicious inventory cannot redirect file writes.
    import posixpath
    for row in links:
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(row["path"]), row["target"]))
        if resolved == ".." or resolved.startswith("../") or resolved.startswith("/"):
            fail("Relative symlink escapes release.")
        if staging is not None:
            path = staging / row["path"]
            plain_ancestors(staging, str(PurePosixPath(row["path"]).parent))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.symlink_to(row["target"])
    return total


def rename_no_replace(source, target):
    function = ctypes.CDLL(None, use_errno=True).renameat2
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    if function(-100, os.fsencode(source), -100, os.fsencode(target), 1) != 0:
        error = ctypes.get_errno()
        raise OSError(error, "Exclusive runtime-root installation refused.")


def verify_or_install(args):
    archive, inventory, target, expected = checked_inputs(args)
    staging = None
    installed = []
    try:
        if args.command == "install":
            staging = Path(tempfile.mkdtemp(prefix=".yunipals-runtime-", dir=target.parent))
        total = extract_checked(archive, expected, staging)
        if staging is not None:
            # All final relative links must resolve within release after installation.
            for name in inventory["roots"]:
                plain_ancestors(target, str(PurePosixPath(name).parent))
                if not (target / name).parent.is_dir():
                    fail("Frozen source parent directory is missing.")
                rename_no_replace(staging / name, target / name)
                installed.append(name)
            for row in inventory["entries"]:
                if row["type"] == "symlink":
                    path = target / row["path"]
                    if not path.resolve(strict=True).is_relative_to(target):
                        fail("Installed symlink leaves release.")
            source_check(target, inventory["sourceDigest"])
        print(json.dumps({"command": args.command, "sourceDigest": inventory["sourceDigest"],
                          "entriesVerified": len(expected), "regularBytesVerified": total,
                          "installedRoots": installed, "sourceUnchanged": True, "networkCalls": 0}))
    except BaseException:
        # Remove only roots installed by this invocation, never pre-existing paths.
        for name in reversed(installed):
            shutil.rmtree(target / name)
        raise
    finally:
        if staging is not None:
            shutil.rmtree(staging)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("build")
    prepare.add_argument("--source", required=True)
    prepare.add_argument("--source-digest", required=True)
    prepare.add_argument("--output", required=True)
    prepare.add_argument("--node", required=True)
    for name in ["verify", "install"]:
        command = commands.add_parser(name)
        for key in ["archive", "inventory", "archive-sha256", "inventory-sha256", "target", "node"]:
            command.add_argument("--" + key, required=True)
    args = parser.parse_args()
    if args.command == "build":
        build(args)
    else:
        verify_or_install(args)


if __name__ == "__main__":
    main()
