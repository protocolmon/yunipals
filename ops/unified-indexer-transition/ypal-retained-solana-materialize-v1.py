#!/usr/bin/env python3
"""Materialize the already qualified private child file, without activation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types

FORMAT = "yunipals-retained-solana-materialize-v1"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
STAGED = Path("/opt/yunipals-unified/operations/solana-consolidation-20261021")
TARGET = Path("/etc/yunipals-unified/solana.env")
BASE = Path("/var/backups/yunipals-retained-solana-materialize-v1-20261024")
STAGE_SHA = "35093ff3fee4532b29e017f91451bde8f7fb4deeafeff4f80524e81647dd4a60"
STAGE_REVIEW = "77ee7e43e791e4972d32da6b5f7b72b783c45f6e48ef747f6961fefe3051df5a"
RESTORE_SHA = "de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34"
RESTORE_ACK = "0ee963f2dd62d2acafa7cc8f9a96a5c95330bd89b16ec9f874eff9e6343029e1"


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def identity(path, directory=False):
    path = Path(path)
    for parent in path.parents:
        row = parent.lstat()
        need(stat.S_ISDIR(row.st_mode) and row.st_uid == 0 and not row.st_mode & 0o022,
             "protected_existing_parent_required")
    row = path.lstat()
    need(row.st_uid == 0 and not row.st_mode & 0o022 and
         (stat.S_ISDIR(row.st_mode) if directory else stat.S_ISREG(row.st_mode) and row.st_nlink == 1),
         "protected_single_regular_input_or_real_directory_required")
    keys = ("st_dev", "st_ino", "st_uid", "st_gid", "st_mode")
    if not directory:
        keys += ("st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
    return {key: getattr(row, key) for key in keys}


def protected(path, digest=None):
    before = identity(path)
    need(before["st_size"] <= 200000, "bounded_existing_input_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        raw = os.read(fd, 200001)
        need(before == {key: getattr(os.fstat(fd), key) for key in before} == identity(path) and
             len(raw) == before["st_size"] and (digest is None or sha(raw) == digest),
             "same_recorded_input_bytes_and_inode_required")
        return raw
    finally:
        os.close(fd)


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def exclusive(path, raw, mode=0o600, gid=0):
    identity(path.parent, True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchown(fd, 0, gid)
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    sync(path.parent)


def new_directory(path, mode):
    identity(path.parent, True)
    path.mkdir(mode=mode)
    sync(path.parent)
    need(stat.S_IMODE(path.lstat().st_mode) == mode, "exact_new_directory_mode_required")


class Host:
    def __init__(self):
        path = OPS / "ypal-source-tail-restore-v1.py"
        raw = protected(path, RESTORE_SHA)
        module = types.ModuleType("retained_solana_source_preservation")
        module.__file__ = str(path)
        exec(compile(raw, str(path), "exec"), module.__dict__)
        self.restore = module
        self.r, self.sdk, self.h, self.op = module.load()
        self.owner = module.Owner(self.r, self.sdk, self.h, self.op)

    def snapshot(self):
        receipt = json.loads(protected(self.restore.BASE / "result.json", RESTORE_ACK))
        actor = self.restore.canonical_actor(self.owner.owned())
        native = self.h.native()
        need(actor == receipt["source"] and native["tables"] == receipt["native"]["tables"] and
             native["cache"] == receipt["native"]["cache"], "same_restored_source_native44_and_cache_required")
        self.owner.floors(native)
        inventory = object.__new__(self.sdk.Host)
        return {"source": actor, "peers": self.owner.preserved(), "inputs": self.h.inputs(),
                "solanaActor": inventory.actor(self.sdk.SOLANA),
                "solanaActivation": inventory.activation(self.sdk.SOLANA), "native": native}

    def unchanged(self, before, after):
        need({k: v for k, v in before.items() if k != "native"} ==
             {k: v for k, v in after.items() if k != "native"}, "existing_source_services_or_private_inputs_changed")
        self.r.recovery_floor(before["native"], after["native"])

    def readable(self, expected):
        code = ("import hashlib,json,os,pathlib;assert os.getuid()==970 and os.getgid()==964 and os.getgroups()==[];"
                "s=dict(x.split(':',1)for x in pathlib.Path('/proc/self/status').read_text().splitlines()if ':'in x);"
                "assert s['NoNewPrivs'].strip()=='1' and all(int(s[k],16)==0 for k in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']);"
                "print(json.dumps({'sha256':hashlib.sha256(pathlib.Path('/etc/yunipals-unified/solana.env').read_bytes()).hexdigest()}))")
        result = json.loads(self.sdk.command(["/usr/bin/setpriv", "--reuid=970", "--regid=964", "--clear-groups",
            "--inh-caps=-all", "--ambient-caps=-all", "--bounding-set=-all", "--no-new-privs", "/usr/bin/env", "-i",
            "PATH=/usr/bin:/bin", "/usr/bin/python3", "-I", "-B", "-c", code]))
        need(result == {"sha256": expected}, "same_uid970_no_import_private_file_readability_required")


def inputs():
    stage = json.loads(protected(STAGED / "staged.json", STAGE_SHA))
    review = json.loads(protected(STAGED / "review.json"))
    need(stage["staged"] is stage["sourceUidReadabilityVerified"] is True and
         stage["reviewHash"] == review["reviewHash"] == STAGE_REVIEW and
         sha(json.dumps(review["binding"], sort_keys=True, separators=(",", ":")).encode()) == STAGE_REVIEW,
         "actual_unchanged_qualified_solana_stage_required")
    files = review["binding"]["files"]
    names = ["/etc/yunipals-indexer/indexer.env", "/etc/yunipals-indexer/solana.env"]
    originals = {}
    for name in names:
        row = review["binding"]["sourceInputs"][name]
        protected(Path(name), row["sha256"])
        ident = identity(Path(name))
        need(ident["st_gid"] == 0 and stat.S_IMODE(ident["st_mode"]) == 0o600,
             "original_root_only_configuration_must_stay_unchanged")
        originals[name] = {"sha256": row["sha256"], "identity": ident}
    source = STAGED / "private/solana.env"
    raw = protected(source, files["private/solana.env"]["sha256"])
    ident = identity(source)
    need(ident["st_gid"] == 964 and stat.S_IMODE(ident["st_mode"]) == 0o640,
         "same_previously_qualified_child_read_permission_required")
    return {"stageSha256": STAGE_SHA, "stageReviewHash": STAGE_REVIEW, "originals": originals,
            "sourceSha256": sha(raw), "sourceIdentity": ident}, raw


def review(host):
    need(not os.path.lexists(BASE) and not os.path.lexists(TARGET), "fresh_absent_audit_and_target_required")
    first = host.snapshot()
    selected, raw = inputs()
    parent = identity(TARGET.parent, True) if os.path.lexists(TARGET.parent) else None
    if parent is None:
        identity(TARGET.parent.parent, True)
    else:
        need(parent["st_gid"] == 0 and stat.S_IMODE(parent["st_mode"]) == 0o755,
             "existing_target_directory_must_remain_root0755")
    host.unchanged(first, host.snapshot())
    binding = {"format": FORMAT, "operatorSha256": sha(protected(Path(__file__).absolute())),
               "selected": selected, "targetParent": parent,
               "preserved": {k: v for k, v in first.items() if k != "native"}}
    return {"binding": binding, "native": first["native"], "reviewHash": sha(encoded(binding))}, raw


def stage(host, expected):
    value, raw = review(host)
    need(value["reviewHash"] == expected, "exact_actual_private_materialization_review_required")
    new_directory(BASE, 0o700)
    exclusive(BASE / "before.json", encoded(value))
    if value["binding"]["targetParent"] is None:
        exclusive(BASE / "directory-intent.json", encoded({"target": str(TARGET.parent), "mode": 0o755}))
        new_directory(TARGET.parent, 0o755)
    else:
        need(identity(TARGET.parent, True) == value["binding"]["targetParent"], "same_existing_target_parent_required")
    selected, current = inputs()
    need(selected == value["binding"]["selected"] and current == raw, "selected_private_source_changed_before_copy")
    exclusive(BASE / "copy-intent.json", encoded({"target": str(TARGET), "sha256": sha(raw), "mode": 0o640, "gid": 964}))
    exclusive(TARGET, raw, 0o640, 964)
    protected(TARGET, sha(raw))
    host.readable(sha(raw))
    after = host.snapshot()
    host.unchanged({**value["binding"]["preserved"], "native": value["native"]}, after)
    need(inputs()[0] == selected, "original_private_inputs_must_remain_exact")
    result = {"format": FORMAT, "completed": True, "reviewHash": expected,
              "sourceStageSha256": STAGE_SHA, "privateFileSha256": sha(raw),
              "newTargetMode": 0o640, "newTargetGid": 964, "UID970ReadableWithoutImports": True,
              "existingFilesAndPermissionsUnchanged": True, "sourceAndServingPeersUnchanged": True,
              "privateValuesExported": False, "newCredentialsCreated": False, "newPrincipalAdmitted": False,
              "serviceActions": 0, "databaseWrites": 0, "providerCalls": 0, "managedActivationQualified": False}
    result_raw = encoded(result)
    exclusive(BASE / "result.json", result_raw)
    return {**result, "actualResultSha256": sha(result_raw)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--review", action="store_true")
    group.add_argument("--stage")
    args = parser.parse_args()
    if not (args.review or args.stage):
        print(json.dumps({"format": FORMAT, "staticOnly": True, "serviceActions": 0,
                          "databaseWrites": 0, "providerCalls": 0}))
        return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == "yunipals-main", "fixed_root_host_required")
    signal.signal(signal.SIGALRM, lambda *_: need(False, "bounded_materialization_expired"))
    signal.alarm(300)
    host = Host()
    with host.sdk.lock():
        if args.stage:
            result = stage(host, args.stage)
        else:
            value, _ = review(host)
            result = {"format": FORMAT, "reviewHash": value["reviewHash"],
                      "sourceStageSha256": STAGE_SHA, "privateValuesExported": False,
                      "serviceActions": 0, "databaseWrites": 0, "providerCalls": 0}
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        print(json.dumps({"format": FORMAT, "completed": False,
            "fixedCode": str(error) if type(error) is RuntimeError and re.fullmatch("[A-Za-z0-9_]+", str(error)) else type(error).__name__,
            "automaticRetryAllowed": False, "privateRawDiagnosticsExported": False,
            "serviceActions": 0, "databaseWrites": 0, "providerCalls": 0}))
        raise SystemExit(1)
