#!/usr/bin/env python3
"""One versioned HTTP API update; no indexer, schema, credential or proxy changes.

Default review is read-only. An explicit inverse restores the recorded API unit
and restarts only that HTTP service. Unknown starts are inspected, never retried.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import subprocess
import time
import urllib.error
import urllib.request

FORMAT = "yunipals-booster-birth-metadata-api-rollout-v1"
HERE = Path(__file__).parent
BASE = Path("/var/backups/yunipals-booster-birth-metadata-api-v1-20261023")
UNIT = "yunipals-booster-api.service"
UNIT_FILE = Path("/etc/systemd/system") / UNIT
OLD_SHA = "8ec7c082de7cbf232923493be6c548f02a4a7a24612807b5845360431c65095c"
NEW_SHA = "ba5c82cb8d587b8f5826fbce72c4630d2098ed36ce892ea92196ec5a5cf9b6db"
OLD_ROOT = Path("/opt/yunipals-unified/booster-api-releases") / OLD_SHA
NEW_ROOT = OLD_ROOT.parent / NEW_SHA
OLD_UNIT_SHA = "21179b01409153e52f27eea67a8c2c5b1b941fb6f94b8acf8c145c6b54cfcd6f"
OLD_API = {"pid": 1634534, "invocation": "0d69de93429a4c03859963d2273889aa"}
NODE = "/opt/node-v24.18.1/bin/node"
FILES = {"booster-api.mjs": NEW_SHA,
         "booster-artwork-sync.mjs": "e2b150124335827d6466d284043050f192066e9fedd782416259c1823cd85e33",
         "manifest.json": "72238adfb06ab3ce7f553cf025f74c410901b9fa6de6b9bd3118770bf903c3a4"}
UNCHANGED = ("yunipals-unified-source6-free-v2.service", "yunipals-booster-launch.service",
             "yunipals-market-production-rpc@bnb.service", "yunipals-bnb.service")
ENGINE = "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609"
COLLECTION = "0x105319be2182018c31fb10b1be198c3cf238a146"
REQUEST_ID = "95398210973416432093304839780870626144645280554838792215361305546672924156888"
REQUEST_KEY = "8453:" + ENGINE + ":" + REQUEST_ID
REQUEST_PATH = "/v1/boosters/requests/" + ENGINE + "/" + REQUEST_ID
METADATA_PATH = "/v1/boosters/metadata/" + COLLECTION + "/1.json"
SHARED_VARIANT_PATH = "/v1/boosters/art/base-mainnet-smoke-v1/73.json"
PUBLIC_ENVIRONMENT = "BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-standard-v1"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"}


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def read(path, maximum=2000000):
    path = Path(path)
    for parent in [path, *path.parents]:
        info = parent.lstat()
        need(info.st_uid == 0 and not stat.S_ISLNK(info.st_mode) and not info.st_mode & 0o022,
             "protected_public_input_required")
    before = path.stat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= maximum,
         "bounded_regular_input_required")
    raw = path.read_bytes()
    need((before.st_ino, before.st_dev, before.st_mtime_ns, before.st_ctime_ns) ==
         tuple(getattr(path.stat(), key) for key in ["st_ino", "st_dev", "st_mtime_ns", "st_ctime_ns"]),
         "input_changed_while_reading")
    return raw


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def save(path, value, mode=0o600):
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "wb") as stream:
        os.fchmod(stream.fileno(), mode); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    sync(path.parent)
    return sha(raw)


def run(args, timeout=12):
    allowed = args[:3] == ["/usr/bin/systemctl", "show", "--all"] or args == ["/usr/bin/systemctl", "daemon-reload"] or args == ["/usr/bin/systemctl", "restart", UNIT]
    need(allowed, "only_api_manager_actions_allowed")
    result = subprocess.run(args, env=ENV, capture_output=True, timeout=timeout)
    need(result.returncode == 0 and not result.stderr and len(result.stdout) < 100000,
         "manager_acknowledgement_unavailable_inspect_before_inverse")
    return result.stdout


def state(unit):
    keys = ["Id", "ActiveState", "SubState", "MainPID", "InvocationID", "NRestarts", "Job",
            "FragmentPath", "DropInPaths", "ExecStart", "WorkingDirectory", "User", "Group"]
    raw = run(["/usr/bin/systemctl", "show", "--all", unit, *["--property=" + k for k in keys]])
    values = dict(line.split("=", 1) for line in raw.decode().splitlines())
    need(set(values) == set(keys) and values["Id"] == unit, "complete_fixed_unit_state_required")
    return values


def independent():
    result = {}
    for unit in UNCHANGED:
        value = state(unit)
        result[unit] = {k: value[k] for k in ["ActiveState", "SubState", "MainPID", "InvocationID", "NRestarts"]}
    source = result[UNCHANGED[0]]
    need(source["MainPID"] == "716994" and source["InvocationID"] == "c3463c9a2e1240e8890e318ba1360cf4" and source["ActiveState"] == "active",
         "same_shared_source_required")
    return result


def actor(root, loaded_root=None):
    loaded_root = root if loaded_root is None else loaded_root
    value = state(UNIT)
    need(value["ActiveState"] == "active" and value["SubState"] == "running" and value["Job"] == "" and
         value["FragmentPath"] == str(UNIT_FILE) and value["DropInPaths"] == "" and
         value["WorkingDirectory"] == str(loaded_root) and value["User"] == value["Group"] == "yunipals_unified_collector",
         "exact_api_runtime_required")
    expected = [NODE, "--max-old-space-size=256", str(root / "booster-api.mjs")]
    args = re.findall(r"argv\[\]=(.*?)\s+;", value["ExecStart"])
    need(len(args) == 1 and shlex.split(args[0]) == [NODE, "--max-old-space-size=256", str(loaded_root / "booster-api.mjs")], "exact_api_argv_required")
    pid = int(value["MainPID"]); proc = Path("/proc") / str(pid)
    before = (proc / "stat").read_text(); ticks = int(before[before.rfind(")") + 2:].split()[19])
    status = dict(line.split(":", 1) for line in (proc / "status").read_text().splitlines() if ":" in line)
    need(set(status["Uid"].split()) == {"967"} and set(status["Gid"].split()) == {"961"} and
         (proc / "cmdline").read_bytes().split(b"\0") == [*[x.encode() for x in expected], b""] and
         (proc / "cgroup").read_text().splitlines() == ["0::/system.slice/" + UNIT], "exact_api_actor_required")
    after = (proc / "stat").read_text()
    need(ticks == int(after[after.rfind(")") + 2:].split()[19]) and state(UNIT) == value, "api_actor_changed")
    return {"pid": pid, "invocation": value["InvocationID"], "startTicks": ticks, "restarts": int(value["NRestarts"])}


def get(path):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try: response = opener.open("http://127.0.0.1:9030" + path, timeout=4)
    except urllib.error.HTTPError as error: response = error
    with response:
        raw = response.read(500001)
        need(len(raw) <= 500000, "bounded_api_response_required")
        try: value = json.loads(raw)
        except ValueError: value = None
        return response.status, value


def checks(new):
    status, ready = get("/readyz")
    need(status == 200 and ready.get("ready") is True and ready.get("engine") == ENGINE and ready.get("collection") == COLLECTION,
         "actual_booster_readiness_required")
    status, types = get("/v1/boosters/types")
    need(status == 200 and {"1", "2"} <= {row["packTypeId"] for row in types.get("items", [])}, "existing_pack_types_required")
    status, request = get(REQUEST_PATH)
    row = (request or {}).get("item", {})
    need(status == 200 and row.get("id") == REQUEST_KEY and row.get("status") == "completed" and row.get("quantity") == 1,
         "genuine_completed_request_required")
    status, result = get(REQUEST_PATH + "/monsters")
    items = (result or {}).get("items", [])
    need(status == 200 and result.get("status") == "completed" and result.get("quantity") == 1 and len(items) == 1 and
         items[0].get("requestKey") == REQUEST_KEY and items[0].get("collection") == COLLECTION and items[0].get("tokenId") == "1",
         "actual_request_scoped_monster_required")
    status, shared = get(SHARED_VARIANT_PATH)
    traits = (shared or {}).get("attributes", [])
    shared_identity = (shared or {}).get("yunipals", {})
    need(status == 200 and isinstance(shared, dict) and isinstance(shared.get("image"), str) and
         shared["image"].startswith("https://") and isinstance(traits, list) and len(traits) == 4 and
         all(isinstance(item, dict) for item in traits) and
         {item.get("trait_type") for item in traits} == {"Type", "Color", "Horn", "Glitter"} and
         shared_identity.get("variantId") == 73 and shared_identity.get("status") == "ready" and
         isinstance(shared_identity.get("holo"), dict) and bool(shared_identity["holo"]),
         "approved_shared_variant_required")
    shared_digest = sha(encoded(shared))
    status, metadata = get(METADATA_PATH)
    if new:
        identity = (metadata or {}).get("yunipals", {})
        attributes = (metadata or {}).get("attributes", [])
        born = identity.get("bornAt")
        need(status == 200 and isinstance(metadata, dict) and
             type(identity.get("birthMetadataVersion")) is int and identity["birthMetadataVersion"] == 1 and
             identity.get("chainId") == 8453 and identity.get("collection") == COLLECTION and
             identity.get("tokenId") == identity.get("originalTokenId") == "1" and identity.get("isOriginal") is True and
             type(identity.get("birthDay")) is int and identity["birthDay"] == 0 and
             isinstance(born, str) and re.fullmatch(r"[1-9][0-9]{0,15}", born) and
             identity.get("originalBornAt") == born and identity.get("mint") == identity.get("originalMint") and
             isinstance(identity.get("mint"), dict) and bool(identity["mint"]),
             "actual_original_birth_metadata_required")
        need(metadata.get("image") == shared["image"] and isinstance(attributes, list) and len(attributes) == 6 and
             attributes[:4] == traits and attributes[4] == {"trait_type": "Birth day", "display_type": "number", "value": 0} and
             attributes[5] == {"trait_type": "Born", "display_type": "date", "value": int(born)} and
             all(identity.get(key) == value for key, value in shared_identity.items()) and
             all(metadata.get(key) == value for key, value in shared.items() if key not in {"attributes", "yunipals"}),
             "approved_artwork_and_traits_must_be_unchanged")
    else: need(status == 404, "old_api_route_baseline_required")
    return {"ready": True, "indexedBlock": ready["indexedBlock"], "existingRequestId": REQUEST_ID,
            "requestMonstersStatus": 200, "requestMonstersVerified": True,
            "birthMetadataStatus": status, "birthMetadataVerified": new,
            "sharedMetadataSha256": shared_digest, "sharedVariantId": 73,
            "birthTokenId": "1", "birthDay": 0 if new else None}


def wait_checks(new):
    end = time.monotonic() + 12
    while True:
        try: return checks(new)
        except (RuntimeError, urllib.error.URLError, OSError):
            if time.monotonic() >= end: raise
            time.sleep(0.5)


def new_unit(raw):
    marker = b"EnvironmentFile=/etc/yunipals-unified/booster-api.env\n"
    need(sha(raw) == OLD_UNIT_SHA and raw.count(str(OLD_ROOT).encode()) == 2 and
         raw.count(marker) == 1 and b"BOOSTER_ARTWORK_CATALOGS=" not in raw,
         "exact_old_unit_bytes_required")
    return raw.replace(str(OLD_ROOT).encode(), str(NEW_ROOT).encode()).replace(
        marker, marker + b"Environment=" + PUBLIC_ENVIRONMENT.encode() + b"\n")


def artifact_binding():
    for name, pin in FILES.items(): need(sha(read(HERE / name)) == pin, "exact_built_candidate_required")
    manifest = json.loads(read(HERE / "manifest.json"))
    need(manifest["sha256"] == NEW_SHA and manifest["poolMaximum"] == 2 and manifest["defaultTransactionReadOnly"] is True,
         "unchanged_readonly_api_pool_required")
    need(sha(read(OLD_ROOT / "booster-api.mjs")) == OLD_SHA, "immutable_original_bundle_required")
    modules = OLD_ROOT / "node_modules"
    need(modules.exists(), "existing_dependencies_required")
    info = modules.lstat()
    need(info.st_uid == 0 and (modules.is_symlink() or not info.st_mode & 0o022), "protected_existing_dependencies_required")
    return {"candidate": FILES, "oldNodeModules": {"inode": info.st_ino, "device": info.st_dev,
            "symlink": os.readlink(modules) if modules.is_symlink() else None}}


def review():
    need(not os.path.lexists(BASE) and not os.path.lexists(NEW_ROOT), "fresh_api_rollout_required")
    raw = read(UNIT_FILE); candidate = new_unit(raw); current = actor(OLD_ROOT)
    need(all(current[k] == v for k, v in OLD_API.items()) and current["restarts"] == 0, "exact_recorded_old_api_invocation_required")
    binding = {"format": FORMAT, "operatorSha256": sha(read(Path(__file__).absolute())), "bootId": Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
               "oldApi": current, "oldUnitSha256": OLD_UNIT_SHA, "newUnitSha256": sha(candidate),
               "artifacts": artifact_binding(), "independentActors": independent()}
    proof = checks(False)
    binding["approvedSharedVariantSha256"] = proof["sharedMetadataSha256"]
    binding["publicEnvironment"] = PUBLIC_ENVIRONMENT
    need(actor(OLD_ROOT) == current and independent() == binding["independentActors"], "runtime_changed_during_review")
    return {"binding": binding, "reviewHash": sha(encoded(binding)), "readiness": proof}


def replace_unit(raw, expected):
    need(sha(read(UNIT_FILE)) == expected, "owned_api_unit_changed_before_replace")
    temporary = UNIT_FILE.with_name(UNIT_FILE.name + ".birth-metadata-v1.tmp")
    save(temporary, raw, 0o644)
    need(sha(read(UNIT_FILE)) == expected, "owned_api_unit_changed_before_atomic_replace")
    os.replace(temporary, UNIT_FILE); sync(UNIT_FILE.parent)


def operation(pin=None):
    raw = read(BASE / "operation.json"); value = json.loads(raw)
    need(pin is None or sha(raw) == pin, "exact_owned_api_operation_required")
    need(value["operatorSha256"] == sha(read(Path(__file__).absolute())) and value["bootId"] == Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
         "same_boot_owned_api_operation_required")
    return value, sha(raw)


def inspect():
    saved, pin = operation()
    need(independent() == saved["independentActors"], "independent_indexer_actor_changed")
    digest = sha(read(UNIT_FILE)); need(digest in {OLD_UNIT_SHA, saved["newUnitSha256"]}, "foreign_api_unit_definition")
    value = state(UNIT)
    current = None
    if value["ActiveState"] == "active":
        if value["MainPID"] == str(saved["oldApi"]["pid"]) and value["InvocationID"] == saved["oldApi"]["invocation"]:
            loaded = Path(value["WorkingDirectory"])
            need(loaded in {OLD_ROOT, NEW_ROOT}, "only_owned_loaded_api_definition_allowed")
            current = actor(OLD_ROOT, loaded_root=loaded)
            need(current == saved["oldApi"], "only_recorded_old_api_may_remain_running")
        else:
            need(digest == saved["newUnitSha256"], "only_owned_new_api_definition_allowed")
            need(sha(read(NEW_ROOT / "booster-api.mjs")) == NEW_SHA, "exact_installed_api_bundle_required")
            current = actor(NEW_ROOT)
            intent = json.loads(read(BASE / "restart-intent.json"))
            delta = current["startTicks"] - intent["monotonicNs"] * os.sysconf("SC_CLK_TCK") // 1000000000
            need(0 <= delta <= 60 * os.sysconf("SC_CLK_TCK") and current["restarts"] == 0,
                 "only_owned_api_start_may_be_reconciled")
    else: need(value["MainPID"] == "0" and value["Job"] == "" and value["ActiveState"] in {"inactive", "failed"}, "quiet_owned_api_required")
    return {"operationSha256": pin, "unitSha256": digest, "api": current,
            "state": value["ActiveState"], "independentActorsUnchanged": True}


def apply(expected):
    checked = review(); need(checked["reviewHash"] == expected, "exact_fresh_api_review_required")
    BASE.mkdir(mode=0o700); sync(BASE.parent)
    pin = save(BASE / "operation.json", checked["binding"])
    old = read(UNIT_FILE); save(BASE / "original-unit.service", old)
    NEW_ROOT.mkdir(mode=0o755); os.chmod(NEW_ROOT, 0o755); sync(NEW_ROOT.parent)
    for name in FILES: save(NEW_ROOT / name, read(HERE / name), 0o644)
    os.symlink(str(OLD_ROOT / "node_modules"), NEW_ROOT / "node_modules"); sync(NEW_ROOT)
    need(actor(OLD_ROOT) == checked["binding"]["oldApi"] and independent() == checked["binding"]["independentActors"], "runtime_changed_before_api_replace")
    replace_unit(new_unit(old), OLD_UNIT_SHA)
    run(["/usr/bin/systemctl", "daemon-reload"])
    save(BASE / "restart-intent.json", {"monotonicNs": time.monotonic_ns(), "oldApi": checked["binding"]["oldApi"]})
    run(["/usr/bin/systemctl", "restart", UNIT], timeout=30)
    current = inspect()
    need(current["api"] is not None and current["api"] != checked["binding"]["oldApi"] and current["unitSha256"] == checked["binding"]["newUnitSha256"], "new_api_did_not_start")
    proof = wait_checks(True)
    need(proof["sharedMetadataSha256"] == checked["binding"]["approvedSharedVariantSha256"],
         "approved_shared_artwork_changed_during_rollout")
    need(independent() == checked["binding"]["independentActors"], "independent_indexer_actor_changed")
    result = {"format": FORMAT, "completed": True, **current, "readiness": proof,
              "newBundleSha256": NEW_SHA, "serviceRestarted": UNIT, "environmentFilesRead": False,
              "publicEnvironment": PUBLIC_ENVIRONMENT, "grantChanges": 0,
              "schemaChanges": 0, "databaseWrites": 0, "upstreamProviderCalls": 0,
              "futureConsumerBindingRequiresThisReceipt": True}
    save(BASE / "result.json", result)
    return result


def rollback(pin):
    saved, actual = operation(pin)
    need(not os.path.lexists(BASE / "rollback-intent.json"), "inspect_existing_inverse_before_retry")
    current = inspect(); original = read(BASE / "original-unit.service")
    need(sha(original) == OLD_UNIT_SHA, "exact_recorded_original_unit_required")
    need(sha(read(OLD_ROOT / "booster-api.mjs")) == OLD_SHA, "immutable_original_bundle_required")
    save(BASE / "rollback-intent.json", {"operationSha256": actual, "before": current})
    if current["unitSha256"] != OLD_UNIT_SHA:
        replace_unit(original, saved["newUnitSha256"]); run(["/usr/bin/systemctl", "daemon-reload"])
    if current["api"] != saved["oldApi"]:
        run(["/usr/bin/systemctl", "restart", UNIT], timeout=30)
    restored = actor(OLD_ROOT); proof = wait_checks(False)
    need(proof["sharedMetadataSha256"] == saved["approvedSharedVariantSha256"],
         "approved_shared_artwork_changed_before_inverse")
    need(independent() == saved["independentActors"], "independent_indexer_actor_changed")
    result = {"format": FORMAT, "restored": True, "operationSha256": actual,
              "api": restored, "readiness": proof, "originalUnitSha256": sha(read(UNIT_FILE)),
              "originalBundlePreserved": sha(read(OLD_ROOT / "booster-api.mjs")) == OLD_SHA,
              "independentActorsUnchanged": True, "serviceRestartedOnly": UNIT}
    save(BASE / "rollback-result.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply"); modes.add_argument("--rollback"); modes.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(RuntimeError("bounded_api_operation_expired"))); signal.alarm(90)
    lock = None
    try:
        if args.apply or args.rollback:
            lock = os.open("/run/lock/yunipals-booster-birth-metadata-api-v1.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            info = os.fstat(lock); need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, "owned_api_operation_lock_required")
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = apply(args.apply) if args.apply else rollback(args.rollback) if args.rollback else inspect() if args.inspect else review()
        print(json.dumps(result, sort_keys=True))
    finally:
        if lock is not None: os.close(lock)


if __name__ == "__main__":
    try: main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch("[a-z_]+", str(error)) else "api_operation_failed_inspect_before_inverse"
        print(json.dumps({"format": FORMAT, "completed": False, "fixedCode": code,
                          "automaticRetryAllowed": False, "operationReceipt": str(BASE / "operation.json")}))
        raise SystemExit(1)
