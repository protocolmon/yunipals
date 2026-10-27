#!/usr/bin/env python3
"""Correct one public API catalog setting; no bundle, SQL or source changes."""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import time
import types

FORMAT = "yunipals-booster-birth-metadata-catalog-config-v2"
BASE = Path("/var/backups/yunipals-booster-birth-metadata-catalog-config-v2-20261023")
CORE = Path("/var/backups/yunipals-booster-birth-metadata-input-v1-20261023/rollout-birth-metadata-api-v1.py")
CORE_SHA = "c52bc1c081a1a002c0070da331b15c2032da4b108924fa51ddd7f7d656557959"
PRIOR_SHA = "166d85965f934e4d928fa989fe4b7f429048ba09665f39de96dbd0d4f51b2243"
OLD_UNIT_SHA = "e36c5ad113c7033e6e88c2798d5b8fb8ed548111bf3ed2a462098f50859a2f5a"
OLD_API = {"pid": 1660954, "invocation": "40c1f709f1584a358279f96e3bcbf8b8", "startTicks": 6617545610, "restarts": 0}
BAD_ENV = "BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-standard-v1"
GOOD_ENV = "BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-mainnet-standard-v1"
CATALOG_DIRECTORY = Path("/var/lib/yunipals-booster-artwork/catalogs")
CATALOGS = (
    ("1", "base-mainnet-smoke-v1", "1283230cddf7d3eedb7e617159a288976838798584e7cf3334a1495f18cc4adf"),
    ("2", "base-mainnet-standard-v1", "79e85ccfa753bb81d8115a17e963f3b427e276f5e68b24d0a3ee284d85c3c2bf")
)


def need(value, code):
    if not value: raise RuntimeError(code)


def core():
    # The imported historical source is immutable. None of its constants or
    # original operation/failed acceptance records are changed by this owner.
    for path in [CORE, *CORE.parents]:
        info = path.lstat()
        need(info.st_uid == 0 and not stat.S_ISLNK(info.st_mode) and not info.st_mode & 0o022,
             "protected_frozen_core_required")
    before = CORE.stat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size < 100000,
         "bounded_frozen_core_required")
    raw = CORE.read_bytes()
    import hashlib
    need(hashlib.sha256(raw).hexdigest() == CORE_SHA, "exact_frozen_core_required")
    module = types.ModuleType("birth_catalog_frozen_core"); module.__file__ = str(CORE)
    exec(compile(raw, str(CORE), "exec"), module.__dict__)
    need(module.sha(module.read(CORE)) == CORE_SHA, "protected_frozen_core_required")
    return module


def definition(c, raw):
    old = b"Environment=" + BAD_ENV.encode() + b"\n"
    need(c.sha(raw) == OLD_UNIT_SHA and raw.count(old) == 1 and GOOD_ENV.encode() not in raw,
         "exact_failed_catalog_unit_required")
    return raw.replace(old, b"Environment=" + GOOD_ENV.encode() + b"\n")


def catalogs(c):
    status, types = c.get("/v1/boosters/types")
    need(status == 200 and isinstance(types, dict), "existing_pack_types_required")
    result = []
    for pack_id, slug, pin in CATALOGS:
        raw = c.read(CATALOG_DIRECTORY / slug / "manifest.json")
        need(c.sha(raw) == pin, "exact_active_catalog_manifest_required")
        local = json.loads(raw)
        status, served = c.get("/v1/boosters/art/" + slug + "/manifest.json")
        rows = [row for row in types.get("items", []) if row.get("packTypeId") == pack_id]
        uri = "https://api.yunipals.com/yunipals-indexer/v1/boosters/art/" + slug + "/"
        need(status == 200 and served == local and local.get("slug") == slug and
             local.get("metadataBaseURI") == uri and len(rows) == 1 and
             rows[0].get("registry") == "0xeaee2da120a398f21729d50672ac5d1dd71d7274" and
             rows[0].get("engine") == c.ENGINE and rows[0].get("metadataBaseUri") == uri and
             rows[0].get("catalogHash") == local.get("catalogHash"),
             "actual_active_pack_catalog_match_required")
        result.append({"packTypeId": pack_id, "slug": slug, "manifestSha256": pin, "metadataBaseURI": uri, "catalogHash": local["catalogHash"]})
    return result


def baseline(c):
    status, ready = c.get("/readyz")
    need(status == 200 and ready.get("ready") is True and ready.get("engine") == c.ENGINE and ready.get("collection") == c.COLLECTION,
         "actual_booster_readiness_required")
    status, request = c.get(c.REQUEST_PATH)
    need(status == 200 and request.get("item", {}).get("id") == c.REQUEST_KEY and
         request["item"].get("status") == "completed" and request["item"].get("quantity") == 1,
         "genuine_completed_request_required")
    status, response = c.get(c.REQUEST_PATH + "/monsters")
    items = response.get("items", []) if isinstance(response, dict) else []
    need(status == 200 and response.get("status") == "completed" and response.get("quantity") == 1 and len(items) == 1 and
         items[0].get("requestKey") == c.REQUEST_KEY and items[0].get("collection") == c.COLLECTION and items[0].get("tokenId") == "1",
         "actual_request_scoped_monster_required")
    status, shared = c.get(c.SHARED_VARIANT_PATH)
    need(status == 200 and isinstance(shared, dict), "approved_shared_variant_required")
    status, birth = c.get(c.METADATA_PATH)
    need(status == 503 and birth == {"error": "booster_birth_metadata_unavailable"}, "exact_incorrect_catalog_baseline_required")
    return {"ready": True, "indexedBlock": ready["indexedBlock"], "requestMonstersStatus": 200,
            "birthMetadataStatus": 503, "birthMetadataError": birth["error"], "sharedMetadataSha256": c.sha(c.encoded(shared))}


def artifact(c):
    for name, pin in c.FILES.items():
        need(c.sha(c.read(c.NEW_ROOT / name)) == pin, "same_installed_api_artifacts_required")
    return {"root": str(c.NEW_ROOT), "bundleSha256": c.NEW_SHA, "files": c.FILES}


def review():
    c = core(); need(not os.path.lexists(BASE), "fresh_catalog_configuration_required")
    prior, pin = c.operation(PRIOR_SHA)
    current = c.inspect()
    need(current["operationSha256"] == pin == PRIOR_SHA and current["unitSha256"] == OLD_UNIT_SHA and current["api"] == OLD_API,
         "exact_owned_failed_rollout_required")
    raw = c.read(c.UNIT_FILE); new = definition(c, raw)
    proof = baseline(c); catalog_proof = catalogs(c)
    need(proof["sharedMetadataSha256"] == prior["approvedSharedVariantSha256"], "same_approved_shared_variant_required")
    binding = {"format": FORMAT, "operatorSha256": c.sha(c.read(Path(__file__).absolute())), "coreSha256": CORE_SHA,
               "priorOperationSha256": pin, "bootId": prior["bootId"], "oldApi": OLD_API,
               "oldUnitSha256": OLD_UNIT_SHA, "newUnitSha256": c.sha(new), "publicEnvironment": GOOD_ENV,
               "independentActors": prior["independentActors"], "approvedSharedVariantSha256": proof["sharedMetadataSha256"],
               "catalogs": catalog_proof, "artifact": artifact(c)}
    need(c.actor(c.NEW_ROOT) == OLD_API and c.independent() == binding["independentActors"], "runtime_changed_during_review")
    return {"binding": binding, "reviewHash": c.sha(c.encoded(binding)), "baseline": proof}


def operation(c, pin=None):
    raw = c.read(BASE / "operation.json"); saved = json.loads(raw)
    prior, prior_pin = c.operation(PRIOR_SHA)
    need((pin is None or c.sha(raw) == pin) and saved["operatorSha256"] == c.sha(c.read(Path(__file__).absolute())) and
         saved["coreSha256"] == CORE_SHA and saved["priorOperationSha256"] == prior_pin and saved["bootId"] == prior["bootId"],
         "same_owned_catalog_operation_required")
    artifact(c)
    need(c.independent() == saved["independentActors"], "independent_indexer_actor_changed")
    return saved, c.sha(raw)


def inspect():
    c = core(); saved, pin = operation(c)
    digest = c.sha(c.read(c.UNIT_FILE)); need(digest in {OLD_UNIT_SHA, saved["newUnitSha256"]}, "foreign_api_unit_definition")
    value = c.state(c.UNIT); current = None
    if value["ActiveState"] == "active":
        current = c.actor(c.NEW_ROOT)
        if current != saved["oldApi"]:
            need(digest == saved["newUnitSha256"], "only_owned_corrected_definition_allowed")
            intent = json.loads(c.read(BASE / "restart-intent.json"))
            delta = current["startTicks"] - intent["monotonicNs"] * os.sysconf("SC_CLK_TCK") // 1000000000
            need(0 <= delta <= 60 * os.sysconf("SC_CLK_TCK") and current["restarts"] == 0, "only_owned_api_start_may_be_reconciled")
    else:
        need(value["MainPID"] == "0" and value["Job"] == "" and value["ActiveState"] in {"inactive", "failed"}, "quiet_owned_api_required")
    return {"operationSha256": pin, "unitSha256": digest, "api": current, "state": value["ActiveState"], "independentActorsUnchanged": True}


def replace(c, raw, expected):
    need(c.sha(c.read(c.UNIT_FILE)) == expected, "owned_api_unit_changed_before_replace")
    temporary = c.UNIT_FILE.with_name(c.UNIT_FILE.name + ".catalog-config-v2.tmp")
    c.save(temporary, raw, 0o644)
    need(c.sha(c.read(c.UNIT_FILE)) == expected, "owned_api_unit_changed_before_atomic_replace")
    os.replace(temporary, c.UNIT_FILE); c.sync(c.UNIT_FILE.parent)


def apply(pin):
    c = core(); checked = review(); need(checked["reviewHash"] == pin, "exact_fresh_catalog_review_required")
    BASE.mkdir(mode=0o700); c.sync(BASE.parent)
    c.save(BASE / "operation.json", checked["binding"])
    raw = c.read(c.UNIT_FILE); c.save(BASE / "original-unit.service", raw)
    need(c.actor(c.NEW_ROOT) == OLD_API and c.independent() == checked["binding"]["independentActors"], "runtime_changed_before_configuration")
    replace(c, definition(c, raw), OLD_UNIT_SHA)
    c.run(["/usr/bin/systemctl", "daemon-reload"])
    c.save(BASE / "restart-intent.json", {"monotonicNs": time.monotonic_ns(), "oldApi": OLD_API})
    need(c.actor(c.NEW_ROOT) == OLD_API and c.independent() == checked["binding"]["independentActors"], "runtime_changed_before_restart")
    c.run(["/usr/bin/systemctl", "restart", c.UNIT], timeout=30)
    current = inspect()
    need(current["api"] is not None and current["api"] != OLD_API and current["unitSha256"] == checked["binding"]["newUnitSha256"], "corrected_api_did_not_start")
    proof = c.wait_checks(True)
    need(proof["sharedMetadataSha256"] == checked["binding"]["approvedSharedVariantSha256"] and
         catalogs(c) == checked["binding"]["catalogs"] and c.independent() == checked["binding"]["independentActors"],
         "approved_catalog_or_independent_runtime_changed")
    result = {"format": FORMAT, "completed": True, **current, "priorOperationSha256": PRIOR_SHA, "readiness": proof,
              "publicEnvironment": GOOD_ENV, "apiBundleUnchanged": True, "artifactInstallations": 0,
              "schemaChanges": 0, "grantChanges": 0, "databaseWrites": 0, "environmentFilesRead": False,
              "serviceRestartedOnly": c.UNIT, "upstreamProviderCalls": 0, "futureConsumerBindingRequiresThisReceipt": True}
    c.save(BASE / "result.json", result); return result


def rollback(pin):
    c = core(); saved, actual = operation(c, pin)
    need(not os.path.lexists(BASE / "rollback-intent.json"), "inspect_existing_inverse_before_retry")
    current = inspect(); original = c.read(BASE / "original-unit.service")
    need(c.sha(original) == OLD_UNIT_SHA, "exact_recorded_original_unit_required")
    c.save(BASE / "rollback-intent.json", {"operationSha256": actual, "before": current})
    if current["unitSha256"] != OLD_UNIT_SHA:
        replace(c, original, saved["newUnitSha256"]); c.run(["/usr/bin/systemctl", "daemon-reload"])
    if current["api"] != saved["oldApi"]:
        state = c.state(c.UNIT)
        need((current["api"] is not None and c.actor(c.NEW_ROOT) == current["api"]) or
             (current["api"] is None and state["MainPID"] == "0" and state["Job"] == "" and state["ActiveState"] in {"inactive", "failed"}),
             "runtime_changed_before_inverse_restart")
        c.run(["/usr/bin/systemctl", "restart", c.UNIT], timeout=30)
    restored = c.actor(c.NEW_ROOT); proof = baseline(c)
    need(proof["sharedMetadataSha256"] == saved["approvedSharedVariantSha256"] and c.independent() == saved["independentActors"], "inverse_runtime_or_art_changed")
    result = {"format": FORMAT, "restored": True, "operationSha256": actual, "api": restored,
              "originalUnitSha256": c.sha(c.read(c.UNIT_FILE)), "readiness": proof, "publicEnvironment": BAD_ENV,
              "apiBundleUnchanged": True, "serviceRestartedOnly": c.UNIT, "birthMetadataRestoredToKnownFailure": True}
    c.save(BASE / "rollback-result.json", result); return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply"); modes.add_argument("--rollback"); modes.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    need(os.geteuid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    os.umask(0o077); signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(RuntimeError("bounded_catalog_operation_expired"))); signal.alarm(90)
    lock = None
    try:
        if args.apply or args.rollback:
            lock = os.open("/run/lock/yunipals-booster-birth-metadata-catalog-config-v2.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            info = os.fstat(lock); need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, "owned_catalog_operation_lock_required")
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = apply(args.apply) if args.apply else rollback(args.rollback) if args.rollback else inspect() if args.inspect else review()
        print(json.dumps(result, sort_keys=True))
    finally:
        if lock is not None: os.close(lock)


if __name__ == "__main__":
    try: main()
    except Exception as error:
        code = str(error) if type(error) is RuntimeError and re.fullmatch("[a-z_]+", str(error)) else "catalog_operation_failed_inspect_before_inverse"
        print(json.dumps({"format": FORMAT, "completed": False, "fixedCode": code, "automaticRetryAllowed": False, "operationReceipt": str(BASE / "operation.json")}))
        raise SystemExit(1)
