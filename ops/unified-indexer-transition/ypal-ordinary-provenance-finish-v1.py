#!/usr/bin/env python3
"""Finish a failed read-only verification; never repeat the metadata command."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import types

FORMAT = "yunipals-ypal-ordinary-provenance-finish-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
PARENT = OPS / "ypal-ordinary-provenance-completion-v2.py"
PARENT_SHA = "130c52fd3186f73fff122a5df1e7e443df94ed0c25864e6a4cb44a829fb9f77b"
BASE = Path("/var/backups/yunipals-ypal-ordinary-provenance-finish-v1-20261025")


def parent():
    # Reuse the already authenticated, effect-free loader without evaluating it.
    import hashlib
    import stat
    for path in [*PARENT.parents, PARENT]:
        info = path.lstat()
        if info.st_uid != 0 or stat.S_ISLNK(info.st_mode) or info.st_mode & 0o022:
            raise RuntimeError("protected_provenance_parent_required")
    raw = PARENT.read_bytes()
    if hashlib.sha256(raw).hexdigest() != PARENT_SHA:
        raise RuntimeError("exact_provenance_parent_required")
    value = types.ModuleType("acknowledged_provenance_verification_parent")
    value.__file__ = str(PARENT)
    exec(compile(raw, str(PARENT), "exec"), value.__dict__)
    return value


def capture(p, n, h, op, q):
    actual = p.capture(n, h, op, q)
    old = h.s.document(p.BASE / "intent.json")
    p.need(old == {"binding": actual, "officialCommandResent": False} and
           not os.path.lexists(p.BASE / "result.json"), "exact_unfinished_readonly_parent_required")
    return {
        "format": FORMAT, "operatorSha256": p.sha(p.protected(Path(__file__).absolute())),
        "parentSha256": PARENT_SHA, "parentIntentSha256": p.sha(p.protected(p.BASE / "intent.json")),
        "originalBinding": actual
    }


def attach_trace(p, h, q):
    """Observe the same bounded peer without changing arguments or its result."""
    real = subprocess.Popen

    class Traced:
        def __init__(self, *args, **kwargs):
            self.process = real(*args, **kwargs)

        def __getattr__(self, name):
            return getattr(self.process, name)

        def communicate(self, *args, **kwargs):
            out, err = self.process.communicate(*args, **kwargs)
            h.s.save(BASE / "publication.stdout.private", out)
            h.s.save(BASE / "publication.stderr.private", err)
            return out, err

    # q is a newly constructed module instance. No historical module is patched.
    q.subprocess = types.SimpleNamespace(Popen=Traced, PIPE=subprocess.PIPE)


def finish(p, n, h, op, q, binding, review_sha):
    p.need(p.sha(p.encoded(binding)) == review_sha, "fresh_provenance_finish_review_required")
    p.need(not os.path.lexists(BASE), "exclusive_provenance_finish_journal_required")
    BASE.mkdir(mode=0o700)
    h.s.sync(BASE.parent)
    h.s.save(BASE / "intent.json", binding)
    attach_trace(p, h, q)
    started = time.monotonic()
    proof = h.publication_proof()
    p.need(proof["allPublishedCanonical"] is True, "full_publication_comparison_must_pass")
    elapsed = time.monotonic() - started
    h.refresh()
    original = binding["originalBinding"]
    p.need(h.actor(op, True) == original["nativeActor"] and n.link(n.BOOT) == original["boot"],
           "same_native_actor_after_provenance_finish_required")
    db = h.database()
    p.need(db["remainingPublished"] == 0 and db["probe"] is True,
           "native_metadata_must_remain_complete")
    observed = {
        "officialResult": original["officialResult"], "remainingPublished": 0,
        "publicationProof": proof, "completeForCurrentPublishedArchiveBase": True,
        "unmatchedRowsNotDeletedOrManufactured": True,
        "completionOperatorSha256": binding["operatorSha256"], "queryAdapter": original["query"],
        "originalPhaseCliAcknowledgementClaimed": False, "officialCommandResent": False,
        "priorReadOnlyAttemptSha256": binding["parentIntentSha256"]
    }
    observed_sha = h.s.save(n.BASE / "provenance-2-observed.json", observed)
    result = {
        "format": FORMAT, "operatorSha256": binding["operatorSha256"], "completed": True,
        "observedReceiptSha256": observed_sha, "originalResultSha256": p.RESULT_SHA,
        "allPublishedCanonical": True, "publishedRows": proof["publishedRows"],
        "canonicalRows": proof["canonicalRows"], "verificationElapsedSeconds": elapsed,
        "originalPhaseCliAcknowledgementClaimed": False, "officialCommandResent": False,
        "databaseWrites": 0, "serviceActions": 0
    }
    digest = h.s.save(BASE / "result.json", result)
    return {**result, "resultSha256": digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", action="store_true")
    parser.add_argument("--finish")
    args = parser.parse_args()
    p = parent()
    p.need(args.review != bool(args.finish), "choose_review_or_finish")
    n, h, op, q = p.context()
    with n.lock():
        binding = capture(p, n, h, op, q)
        if args.review:
            print(json.dumps({"format": FORMAT, "reviewSha256": p.sha(p.encoded(binding)),
                              "databaseWrites": 0, "serviceActions": 0, "officialCommandResent": False}))
        else:
            print(json.dumps(finish(p, n, h, op, q, binding, args.finish), sort_keys=True))


if __name__ == "__main__":
    os.umask(0o077)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(RuntimeError("bounded_finish_deadline")))
    signal.alarm(300)
    try:
        main()
    finally:
        signal.alarm(0)
