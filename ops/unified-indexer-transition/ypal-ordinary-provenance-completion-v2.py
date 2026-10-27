#!/usr/bin/env python3
"""Finish the read-only verification tail of acknowledged provenance batch 2.

No metadata command, SQL write, service action or original receipt is replayed.
The failed original phase stays failed. This producer owns the missing observed
receipt and separately identifies the bounded publication-query adapter.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import time
import types

FORMAT = "yunipals-ypal-ordinary-provenance-completion-v2"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
BASE = Path("/var/backups/yunipals-ypal-ordinary-provenance-completion-v2-20261025")
OWNER = OPS / "ypal-ordinary-metadata-handover-v5.py"
OWNER_SHA = "9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f"
INPUT_SHA = "bc618a8559a94d4a34d5a6da91c98d2241161f2edd91e540857a5089e5bbe306"
OPERATION_SHA = "8aa248a21585cfffd2dc936968f214a2b007b3460f866e2d1346c1432d42a70d"
SELECTED_SHA = "2829182fa96599513f07099118ab0c16b0ceff8d04330537a9c90bd5231e35ba"
QUERY = OPS / "ypal-ordinary-publication-query-v2.py"
QUERY_SHA = "deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c"
RESULT_SHA = "c552b820c31a9814945a828b7207f74d351da75b3c8c047c539c5b1841a382f1"
PRIOR = (
    "7fb229306d5d57ac9da859cd224351006e2fa915cf9c86c4546b9d4bf1e5e765",
    "c43937c1ee27feb444eb91b54b7f2aa8640462ff9330c8723e3333868b6338aa"
)


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def protected(path, digest=None):
    for item in [*path.parents, path]:
        info = item.lstat()
        need(info.st_uid == 0 and not stat.S_ISLNK(info.st_mode) and not info.st_mode & 0o022,
             "protected_provenance_completion_path_required")
    info = path.lstat()
    raw = path.read_bytes()
    after = path.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and len(raw) < 2000000 and
         all(getattr(info, key) == getattr(after, key) for key in
             ["st_dev", "st_ino", "st_mode", "st_uid", "st_gid", "st_size", "st_mtime_ns", "st_ctime_ns"]) and
         (digest is None or sha(raw) == digest), "exact_provenance_completion_file_required")
    return raw


def module(path, digest):
    raw = protected(path, digest)
    value = types.ModuleType(path.stem)
    value.__file__ = str(path)
    exec(compile(raw, str(path), "exec"), value.__dict__)
    return value


def context():
    owner = module(OWNER, OWNER_SHA)
    n = owner.namespace(INPUT_SHA)
    h = owner.cli_context(INPUT_SHA)
    op = n.operation(h, OPERATION_SHA)
    query = module(QUERY, QUERY_SHA)
    return n, h, op, query


def capture(n, h, op, query):
    selected = h.s.document(n.BASE / "selected.json", SELECTED_SHA)
    actor = h.actor(op, True)
    need(actor == selected["nativeActor"] and n.link(n.BOOT) == selected["boot"],
         "same_selected_native_metadata_actor_and_boot_required")
    files = {}
    for index, digest in enumerate(PRIOR):
        path = n.BASE / ("provenance-" + str(index) + "-observed.json")
        protected(path, digest)
        files[path.name] = digest
    prefix = "provenance-2"
    for name in [prefix + "-intent.json", prefix + "-child.json", prefix + "-result.json",
                 prefix + ".stdout.private", prefix + ".stderr.private"]:
        files[name] = sha(protected(n.BASE / name))
    result = h.s.document(n.BASE / (prefix + "-result.json"), RESULT_SHA)
    need(result == {"event": "base_metadata_native-provenance", "stamped": 0},
         "exact_acknowledged_zero_row_original_command_required")
    intent = h.s.document(n.BASE / (prefix + "-intent.json"))
    child = h.s.document(n.BASE / (prefix + "-child.json"))
    need(intent["command"] == "native-provenance" and intent["automaticRetryAllowed"] is False and
         not n.identity_alive(h.m, child), "original_command_must_be_acknowledged_and_terminal")
    out = protected(n.BASE / (prefix + ".stdout.private"))
    lines = [line for line in out.splitlines() if line.startswith(b"{")]
    need(len(lines) == 1 and json.loads(lines[0]) == result and
         not protected(n.BASE / (prefix + ".stderr.private")), "original_acknowledgement_streams_required")
    need(not os.path.lexists(n.BASE / (prefix + "-observed.json")),
         "completion_must_not_overwrite_an_observed_receipt")
    db = h.database()
    need(db["remainingPublished"] == 0 and db["probe"] is True and
         db["scan"]["ingestion_mode"] == "native" and db["approval"]["state"] == "ready",
         "complete_ready_native_metadata_required")
    query_binding = query.bind(h)
    binding = {
        "format": FORMAT, "operatorSha256": sha(protected(Path(__file__).absolute())),
        "originalOwnerSha256": OWNER_SHA, "originalOperationSha256": OPERATION_SHA,
        "metadataInputSha256": INPUT_SHA, "selectedReceiptSha256": SELECTED_SHA,
        "prefixFiles": files, "query": query_binding, "nativeActor": actor,
        "boot": selected["boot"], "bootId": h.s.boot(), "officialResult": result
    }
    return binding


def complete(n, h, op, query, binding, review_sha):
    need(sha(encoded(binding)) == review_sha, "fresh_completion_review_required")
    need(not os.path.lexists(BASE), "exclusive_completion_journal_required")
    BASE.mkdir(mode=0o700)
    h.s.sync(BASE.parent)
    h.s.save(BASE / "intent.json", {"binding": binding, "officialCommandResent": False})
    started = time.monotonic()
    proof = h.publication_proof()
    need(proof["allPublishedCanonical"] is True, "full_publication_comparison_must_pass")
    elapsed = time.monotonic() - started
    h.refresh()
    need(h.actor(op, True) == binding["nativeActor"] and n.link(n.BOOT) == binding["boot"],
         "same_native_actor_and_boot_after_full_verification_required")
    db = h.database()
    need(db["remainingPublished"] == 0 and db["probe"] is True,
         "native_metadata_must_remain_complete_after_verification")
    observed = {
        "officialResult": binding["officialResult"], "remainingPublished": 0,
        "publicationProof": proof, "completeForCurrentPublishedArchiveBase": True,
        "unmatchedRowsNotDeletedOrManufactured": True,
        "completionOperatorSha256": binding["operatorSha256"],
        "queryAdapter": binding["query"], "originalPhaseCliAcknowledgementClaimed": False,
        "officialCommandResent": False
    }
    observed_sha = h.s.save(n.BASE / "provenance-2-observed.json", observed)
    result = {
        "format": FORMAT, "operatorSha256": binding["operatorSha256"], "completed": True,
        "observedReceiptSha256": observed_sha, "originalResultSha256": RESULT_SHA,
        "publishedRows": proof["publishedRows"], "canonicalRows": proof["canonicalRows"],
        "allPublishedCanonical": True, "verificationElapsedSeconds": elapsed,
        "originalPhaseCliAcknowledgementClaimed": False, "officialCommandResent": False,
        "databaseWrites": 0, "serviceActions": 0
    }
    result_sha = h.s.save(BASE / "result.json", result)
    return {**result, "resultSha256": result_sha}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    parser.add_argument("--complete")
    args = parser.parse_args()
    need(args.review != bool(args.complete), "choose_review_or_complete")
    n, h, op, query = context()
    with n.lock():
        binding = capture(n, h, op, query)
        if args.review:
            print(json.dumps({"format": FORMAT, "reviewSha256": sha(encoded(binding)),
                              "databaseWrites": 0, "serviceActions": 0, "officialCommandResent": False}))
        else:
            print(json.dumps(complete(n, h, op, query, binding, args.complete), sort_keys=True))


if __name__ == "__main__":
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_provenance_completion_deadline"))
    signal.alarm(300)
    try:
        main()
    finally:
        signal.alarm(0)
