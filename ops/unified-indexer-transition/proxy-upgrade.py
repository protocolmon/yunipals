#!/usr/bin/env python3
"""Review or stagger one pinned proxy upgrade; never starts an indexer/worker."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shlex
import socket
import stat
import subprocess
import time
import urllib.request

SOURCE = "008028af9defac0f22ba6094f5aefcf91165e27fca8134e595b57e2637851b78"
SOURCE_ARCHIVE_SHA = "ca9b086e02395055c3695a4b0307fe435b330df9b57982e1118b01e881a23e59"
ROOT = Path("/opt/yunipals-unified/releases") / SOURCE
OLD_ROOT = Path("/opt/yunipals-unified/releases/7e7375b029f3d009422f19ea25ed1dd439ebd0cf22f0b95233c258fae1119c27")
NODE = "/opt/node-v24.18.1/bin/node"
INVENTORY_SHA = "ebeb5a3f1ab9a2152500ff7bf859b81e62101fe8b15b9c0e4d5bb51d5b40da40"
ARCHIVE_SHA = "a7dc1ace5cb703f1a732f8bfae368d1fea6bf7b9c2d9164b6ff55a565c3c114a"
PROXY_SHA = "ece853a1df510791ecc46467999c894a58806a94fcb02b90d3fcd7bf2a63f525"
PROFILE = Path("/etc/yunipals-unified/shadow-20261020/rpc-profile.json")
PROFILE_SHA = "a3e6f755b8f13dce51ae4f9b053fb855533e7cc49ee182f14535701e0acc6232"
PROFILE_ID = "0x1f036a533d0dab415833e691f8fb63407ed49a031607950c08b3ae47684b3eb3"
MANIFEST = "0x153b9572dafa3b706a5a31a3f2530180639ac2b81abf1d7b15f4c095ef84a029"
NATIVE_BUILD = "bf4939b3ff"
CHAINS = {"ethereum": (1, 19201), "base": (8453, 19202), "polygon": (137, 19203), "bnb": (56, 19204)}
SYSTEMD = Path("/etc/systemd/system")
PROOFS = Path("/var/backups/yunipals-unified-free-replay-proxies-20261020")
OVERRIDE_NAME = "zzzzzzz-unified-free-replay-20261020.conf"
OLD_OVERRIDE_NAME = "zzzzzz-unified-shadow-20261020.conf"
PROFILE_ENV_KEYS = {"MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE", "MARKET_RPC_PROXY_UNIFIED_PROFILE_ID", "MARKET_RPC_PROXY_CHAIN_ID"}
CONFIG_KEYS = ["freeRouting", "freeLogRouting", "dedicatedFreeOrderRouting", "paidFallbackOnFreeFailure",
               "foregroundPaidFallbackOnFreeFailure", "orderPaidFallbackOnFreeFailure", "sourcePaidFallbackOnFreeFailure",
               "salePaidFallbackOnFreeFailure", "freeRequestTimeoutMs", "freeOrderRequestTimeoutMs",
               "freeFailureCooldownMs", "freeRateLimitCooldownMs", "freeSourceMinimumIntervalMs",
               "freeOrderMinimumIntervalMs", "freeMinimumIntervalMs", "maximumConcurrentUpstreamRequests"]
STATE_KEYS = ["User", "Group", "WorkingDirectory", "ActiveState", "SubState", "MainPID", "InvocationID",
              "ExecStart", "FragmentPath", "DropInPaths", "EnvironmentFiles", "Environment"]


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def sha_bytes(value):
    return hashlib.sha256(value).hexdigest()


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def safe_file(path, maximum=40_000_000):
    path = Path(path)
    if not path.is_absolute():
        raise RuntimeError("Absolute protected path required.")
    for ancestor in [*reversed(path.parents), path]:
        info = ancestor.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            # /var/tmp is deliberately sticky/world-writable; the actual
            # inventory must still be a protected root-owned regular file.
            if ancestor != Path("/var/tmp") or not stat.S_ISDIR(info.st_mode) or not info.st_mode & stat.S_ISVTX:
                raise RuntimeError("Unprotected or symlinked path ancestry.")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        raise RuntimeError("Bounded regular file required.")
    return path


def run(args, *, timeout=30, data=None):
    result = subprocess.run(args, input=data, capture_output=True, text=True, timeout=timeout,
                            env={"PATH": "/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"})
    if result.returncode:
        raise RuntimeError("Reviewed proxy command failed; private diagnostics suppressed.")
    return result.stdout.strip()


def request(port, path, payload=None, headers=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=body,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    # Do not inherit HTTP proxy settings, redirects, credentials or cookies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=5) as response:
        raw = response.read(2_000_001)
    if len(raw) > 2_000_000:
        raise RuntimeError("Oversized proxy response.")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise RuntimeError("Unexpected proxy response shape.")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise RuntimeError("Proxy redirects are forbidden.")


def headers(workload="unified_source"):
    # No permit header: even a free failure cannot become paid traffic.
    return {"x-yunipals-unified-rpc-profile": PROFILE_ID, "x-yunipals-rpc-workload": workload}


def legacy_health(port, chain):
    if request(port, "/health").get("status") != "ready":
        raise RuntimeError("Legacy proxy health failed.")
    metrics = request(port, "/metrics")
    if (metrics.get("freeRouting") is not True or metrics.get("paidFallbackOnFreeFailure") is not False or
            metrics.get("sourcePaidFallbackOnFreeFailure") is not False):
        raise RuntimeError("Free-only legacy health call cannot be guaranteed.")
    value = request(port, "/", {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []})
    if value.get("result") != hex(chain) or "error" in value:
        raise RuntimeError("Legacy free chain identity failed.")
    if any(key not in metrics for key in CONFIG_KEYS):
        raise RuntimeError("Incomplete legacy configuration metrics.")
    return {key: metrics[key] for key in CONFIG_KEYS}


def unified_preflight(port, chain):
    for workload in ["unified_source", "unified_evidence"]:
        value = request(port, "/unified/preflight", headers=headers(workload))
        if (value.get("profileId") != PROFILE_ID or value.get("chainId") != chain or
                value.get("manifestHash") != MANIFEST or value.get("scope") != "yunipals-opensea" or
                value.get("workload") != workload or value.get("paid") != "explicit_bounded_permit_only"):
            raise RuntimeError("Unified policy preflight identity changed.")
    value = request(port, "/unified", {"jsonrpc": "2.0", "id": 2, "method": "eth_chainId", "params": []}, headers())
    if value.get("result") != hex(chain) or "error" in value:
        raise RuntimeError("Unified free chain identity failed.")


def retry(check, *, seconds=45):
    deadline = time.monotonic() + seconds
    while True:
        try:
            return check()
        except Exception:
            if time.monotonic() >= deadline:
                raise
            time.sleep(1)


def state(unit):
    text = run(["systemctl", "show", unit, *["--property=" + key for key in STATE_KEYS]])
    props, repeated = {}, {"EnvironmentFiles": [], "Environment": []}
    for line in text.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in repeated:
            repeated[key].append(value)
        else:
            props[key] = value
    for key, values in repeated.items():
        if values:
            props[key] = " ".join(values)
    # systemctl can repeat these properties once per assignment/file. Keep
    # every file entry and its order; never serialize the raw environment.
    props["EnvironmentFilesEntries"] = repeated["EnvironmentFiles"]
    if (any(key not in props for key in STATE_KEYS) or props["ActiveState"] != "active" or
            props["SubState"] != "running" or not re.fullmatch(r"[0-9a-f]{32}", props["InvocationID"]) or
            not props["MainPID"].isdigit() or int(props["MainPID"]) <= 0):
        raise RuntimeError("Existing proxy must be active with an exact invocation identity.")
    return props


def private_settings(props):
    values = shlex.split(props["Environment"])
    if any("=" not in value for value in values):
        raise RuntimeError("Unexpected inline environment shape.")
    return {"User": props["User"], "Group": props["Group"],
            "orderedEnvironmentFiles": props.get("EnvironmentFilesEntries", [props["EnvironmentFiles"]]),
            "privateEnvironmentSha256": sha_bytes(encoded([value for value in values if value.split("=", 1)[0] not in PROFILE_ENV_KEYS]))}


def definitions(props):
    paths = [Path(props["FragmentPath"]), *map(Path, shlex.split(props["DropInPaths"]))]
    if len(paths) != len(set(paths)):
        raise RuntimeError("Duplicate systemd definition path.")
    return {str(path): digest(safe_file(path, 1_000_000)) for path in paths}


def verify_exec_start(props, root=None):
    root = ROOT if root is None else root
    expected = f"{NODE} {root}/apps/yunipals-market-api/dist/rpc-budget-proxy.mjs"
    argv = re.findall(r"argv\[\]=(.*?)\s+;", props["ExecStart"])
    paths = re.findall(r"(?:^|[ {;])path=([^ ;]+)", props["ExecStart"])
    if argv != [expected] or paths != [NODE] or props["WorkingDirectory"] != str(root / "apps/yunipals-market-api"):
        raise RuntimeError("Current ExecStart/WorkingDirectory differs from the pinned runtime.")


def approved_policy():
    safe_file(PROFILE, 2_000_000)
    if digest(PROFILE) != PROFILE_SHA:
        raise RuntimeError("Existing approved profile file changed.")
    sql = """BEGIN READ ONLY; SET LOCAL statement_timeout='5s';
      SELECT jsonb_build_object('enabled',enabled,'scope',scope,'manifestHash',manifest_hash,
        'policy',policy,'validForSample',expires_at>clock_timestamp()+interval '20 minutes')
      FROM yunipals_market.unified_rpc_profile WHERE profile_id='""" + PROFILE_ID + "'; ROLLBACK;"
    raw = run(["runuser", "-u", "postgres", "--", "env", "-i", "PATH=/usr/bin:/bin", "LANG=C.UTF-8",
               "PGHOST=/var/run/postgresql", "PGPORT=15438", "PGUSER=postgres", "PGDATABASE=yunipals_market_production",
               "PGOPTIONS=-c default_transaction_read_only=on -c lock_timeout=1500", "psql", "-XqAt", "-v", "ON_ERROR_STOP=1"], data=sql)
    value = json.loads(raw)
    if (value.get("policy") != json.loads(PROFILE.read_text()) or value.get("enabled") is not True or
            value.get("validForSample") is not True or value.get("scope") != "yunipals-opensea" or value.get("manifestHash") != MANIFEST):
        raise RuntimeError("The exact existing RPC profile is not approved.")
    return {"profileId": PROFILE_ID, "profileSha256": PROFILE_SHA, "manifestHash": MANIFEST}


def verify_runtime(inventory_path):
    safe_file(inventory_path)
    if digest(inventory_path) != INVENTORY_SHA:
        raise RuntimeError("Runtime inventory pin differs.")
    value = json.loads(inventory_path.read_text())
    if (value.get("format") != "yunipals-runtime-supplement-v1" or value.get("sourceDigest") != SOURCE or
            value.get("archiveSha256") != ARCHIVE_SHA or value.get("bundleProof", {}).get("allSourceContentsMatch") is not True):
        raise RuntimeError("Runtime source/archive/bundle binding differs.")
    for name, key in [("RELEASE-MANIFEST.json", "sourceManifestSha256"), ("pnpm-lock.yaml", "lockfileSha256")]:
        if digest(safe_file(ROOT / name)) != value[key]:
            raise RuntimeError("Installed source manifest/lockfile differs.")
    manifest = json.loads((ROOT / "RELEASE-MANIFEST.json").read_text())
    if manifest.get("sourceDigest") != SOURCE:
        raise RuntimeError("Installed source identity differs.")
    verified = json.loads(run([NODE, str(ROOT / "ops/unified-indexer/prepare-release.mjs"), "--verify", str(ROOT)], timeout=120))
    if verified.get("sourceDigest") != SOURCE:
        raise RuntimeError("Frozen source verification differs.")
    actual = json.loads(run([NODE, "-p", "JSON.stringify({node:process.versions.node,platform:process.platform,arch:process.arch,modules:process.versions.modules,napi:process.versions.napi})"]))
    actual["libc"] = list(platform.libc_ver())
    if actual != value["runtime"]:
        raise RuntimeError("Installed runtime platform differs.")
    seen = set()
    for row in value["entries"]:
        relative = Path(row["path"])
        if relative.is_absolute() or ".." in relative.parts or row["path"] in seen:
            raise RuntimeError("Unsafe or duplicate inventory path.")
        seen.add(row["path"])
        path = ROOT / relative
        info = path.lstat()
        if info.st_uid != 0 or (row["type"] != "symlink" and info.st_mode & 0o7022):
            raise RuntimeError("Installed runtime ownership/permissions differ.")
        if not path.resolve(strict=True).is_relative_to(ROOT):
            raise RuntimeError("Installed runtime escapes source root.")
        if row["type"] == "symlink":
            if not stat.S_ISLNK(info.st_mode) or os.readlink(path) != row["target"]:
                raise RuntimeError("Installed runtime link differs.")
        elif row["type"] == "directory":
            if not stat.S_ISDIR(info.st_mode):
                raise RuntimeError("Installed runtime directory differs.")
        elif (row["type"] != "file" or not stat.S_ISREG(info.st_mode) or info.st_size != row["bytes"] or digest(path) != row["sha256"]):
            raise RuntimeError("Installed runtime file differs.")
    entry = ROOT / "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs"
    if digest(safe_file(entry)) != PROXY_SHA or str(entry.relative_to(ROOT)) not in seen:
        raise RuntimeError("Pinned proxy entrypoint differs.")
    return {"sourceRoot": str(ROOT), "sourceDigest": SOURCE, "sourceArchiveSha256": SOURCE_ARCHIVE_SHA,
            "runtimeInventoryPath": str(inventory_path), "runtimeInventorySha256": INVENTORY_SHA,
            "runtimeArchiveSha256": ARCHIVE_SHA, "runtimeSha256": PROXY_SHA,
            "manifestHash": MANIFEST, "expectedNativeBuildId": NATIVE_BUILD}


def override_content(chain):
    return ("[Service]\nExecStart=\nExecStart=" + NODE + " " + str(ROOT / "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs") +
            "\nWorkingDirectory=" + str(ROOT / "apps/yunipals-market-api") +
            "\nEnvironment=MARKET_RPC_PROXY_UNIFIED_PROFILE_FILE=" + str(PROFILE) +
            "\nEnvironment=MARKET_RPC_PROXY_UNIFIED_PROFILE_ID=" + PROFILE_ID +
            f"\nEnvironment=MARKET_RPC_PROXY_CHAIN_ID={chain}\n")


def review(chain_name, inventory_path):
    chain, port = CHAINS[chain_name]
    unit = f"yunipals-market-production-rpc@{chain_name}.service"
    target = SYSTEMD / (unit + ".d") / OVERRIDE_NAME
    if os.path.lexists(target):
        raise RuntimeError("New proxy override already exists; retained attempts are never overwritten.")
    runtime = verify_runtime(inventory_path)
    policy = approved_policy()
    props = state(unit)
    verify_exec_start(props, OLD_ROOT)
    hashes = definitions(props)
    old = str(SYSTEMD / (unit + ".d") / OLD_OVERRIDE_NAME)
    if old not in hashes or any(Path(path).name >= OVERRIDE_NAME for path in list(hashes)[1:]):
        raise RuntimeError("Existing shadow override or final override ordering differs.")
    before = legacy_health(port, chain)
    if before["freeSourceMinimumIntervalMs"] < 400 or before["maximumConcurrentUpstreamRequests"] > 8:
        raise RuntimeError("Existing pacing/concurrency exceeds the reviewed production bounds.")
    content = override_content(chain)
    return {"format": "yunipals-proxy-free-replay-upgrade-v1", "unit": unit, "chain": chain_name, "chainId": chain, "port": port,
            **runtime, "profileId": PROFILE_ID, "profile": policy, "beforeInvocationId": props["InvocationID"],
            "originalMainPid": props["MainPID"], "originalExecStartSha256": sha_bytes(props["ExecStart"].encode()),
            "originalWorkingDirectory": props["WorkingDirectory"], "originalDefinitionHashes": hashes,
            "privateSettings": private_settings(props), "legacyConfiguration": before,
            "overridePath": str(target), "overrideSha256": sha_bytes(content.encode()), "override": content}


def unchanged_original(value, props, *, rollback=False):
    actual = definitions(props)
    expected = value["originalDefinitionHashes"]
    if not rollback:
        actual.pop(value["overridePath"], None)
    if actual != expected or private_settings(props) != value["privateSettings"]:
        raise RuntimeError("Original definitions or private service settings changed.")


def save_new(path, data, mode=0o600):
    with Path(path).open("xb") as handle:
        os.fchmod(handle.fileno(), mode)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def proof_directory(chain, review_hash):
    for path in [PROOFS, PROOFS / chain]:
        path.mkdir(mode=0o700, exist_ok=True)
        info = path.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise RuntimeError("Private root-owned proof ancestry required.")
    proof = PROOFS / chain / review_hash
    proof.mkdir(mode=0o700, exist_ok=False)
    return proof


def apply(value, review_hash):
    if sha_bytes(encoded(value)) != review_hash:
        raise RuntimeError("Exact canonical review hash required.")
    unit, chain, port = value["unit"], value["chainId"], value["port"]
    target = Path(value["overridePath"])
    # A failed proof directory is retained. A new attempt needs fresh review.
    proof = proof_directory(value["chain"], review_hash)
    save_new(proof / "review.json", encoded(value))
    for index, path in enumerate(value["originalDefinitionHashes"]):
        save_new(proof / f"original-{index}.conf", Path(path).read_bytes())
    phase, installed = "pre_install_race_check", False
    try:
        props = state(unit)
        unchanged_original(value, props, rollback=True)
        if props["InvocationID"] != value["beforeInvocationId"] or sha_bytes(props["ExecStart"].encode()) != value["originalExecStartSha256"]:
            raise RuntimeError("Original proxy invocation changed before installation.")
        if digest(PROFILE) != PROFILE_SHA or digest(ROOT / "apps/yunipals-market-api/dist/rpc-budget-proxy.mjs") != PROXY_SHA:
            raise RuntimeError("Reviewed profile/runtime changed before installation.")
        phase = "exclusive_override_install"
        save_new(target, value["override"].encode(), 0o644)
        installed = True
        phase = "daemon_reload"
        run(["systemctl", "daemon-reload"])
        phase = "graceful_restart"
        run(["systemctl", "restart", unit], timeout=150)
        phase = "legacy_health"
        after_config = retry(lambda: legacy_health(port, chain))
        if after_config != value["legacyConfiguration"]:
            raise RuntimeError("Legacy proxy configuration changed.")
        phase = "unified_preflight"
        retry(lambda: unified_preflight(port, chain))
        phase = "runtime_and_original_settings"
        after = state(unit)
        unchanged_original(value, after)
        verify_exec_start(after)
        if (after["InvocationID"] == value["beforeInvocationId"] or digest(safe_file(target)) != value["overrideSha256"] or
                str(target) not in definitions(after)):
            raise RuntimeError("New proxy invocation/override not selected.")
        result = {"generatedAt": datetime.now(timezone.utc).isoformat(), "reviewHash": review_hash, "review": value,
                  "proofDirectory": str(proof), "applied": True, "unit": unit, "chainId": chain, "sourceRoot": str(ROOT),
                  "sourceDigest": SOURCE, "profileId": PROFILE_ID, "runtimeSha256": PROXY_SHA,
                  "runtimeInventorySha256": INVENTORY_SHA, "runtimeArchiveSha256": ARCHIVE_SHA,
                  "overridePath": str(target), "overrideSha256": value["overrideSha256"],
                  "beforeInvocationId": value["beforeInvocationId"], "afterInvocationId": after["InvocationID"],
                  "verifyExecStart": True, "legacyHealthPassed": True, "legacyConfigurationPreserved": True,
                  "privateSettingsChanged": False, "ingestorStarted": False, "sourceSelectionChanged": False,
                  "paidCalls": 0, "newPermits": False}
        output = json.dumps(result, indent=2) + "\n"
        save_new(proof / "result.json", output.encode())
        return output
    except Exception as error:
        failed = {"phase": phase, "errorType": type(error).__name__, "rollbackAttempted": False, "rollbackSucceeded": False}
        if installed and not target.is_symlink() and target.is_file() and digest(target) == value["overrideSha256"]:
            failed["rollbackAttempted"] = True
            try:
                target.unlink()
                run(["systemctl", "daemon-reload"])
                run(["systemctl", "restart", unit], timeout=150)
                restored = retry(lambda: legacy_health(port, chain))
                original = state(unit)
                unchanged_original(value, original, rollback=True)
                verify_exec_start(original, OLD_ROOT)
                if restored != value["legacyConfiguration"] or original["WorkingDirectory"] != value["originalWorkingDirectory"]:
                    raise RuntimeError("Original proxy selection not restored.")
                failed["rollbackSucceeded"] = True
            except Exception as rollback_error:
                failed["rollbackErrorType"] = type(rollback_error).__name__
        save_new(proof / "failed-check.json", encoded(failed))
        raise RuntimeError("Proxy upgrade failed; retained proof records guarded rollback status.") from None


@contextmanager
def chain_lock(chain):
    path = Path("/run/lock") / f"yunipals-free-replay-proxy-{chain}.lock"
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(descriptor)
        if info.st_uid != 0 or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise RuntimeError("Unprotected proxy upgrade lock.")
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chain", choices=CHAINS, required=True)
    parser.add_argument("--runtime-inventory", type=Path, required=True)
    parser.add_argument("--apply")
    args = parser.parse_args()
    if socket.gethostname() != "yunipals-main" or os.geteuid() != 0:
        raise RuntimeError("Exact production root/host required.")
    if args.apply:
        if not re.fullmatch(r"[0-9a-f]{64}", args.apply):
            raise RuntimeError("Exact review hash required.")
        with chain_lock(args.chain):
            value = review(args.chain, args.runtime_inventory)
            if sha_bytes(encoded(value)) != args.apply:
                raise RuntimeError("Proxy review changed; nothing applied.")
            output = apply(value, args.apply)
    else:
        value = review(args.chain, args.runtime_inventory)
        output = json.dumps({"generatedAt": datetime.now(timezone.utc).isoformat(), "reviewHash": sha_bytes(encoded(value)),
                             "review": value, "applied": False, "paidCalls": 0, "sourceSelectionChanged": False}, indent=2) + "\n"
    print(output, end="")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"completed": False, "errorType": type(error).__name__}))
        raise SystemExit(1)
