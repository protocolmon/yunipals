#!/usr/bin/env python3
"""Passive durations plus one exact public generation-bridge family label."""
import ast
import hashlib
import json
from pathlib import Path
import stat
import types

FORMAT = "yunipals-readonly-run-duration-v2"
OPS = Path("/opt/yunipals-unified/operations/free-replay-20261020")
FROZEN = "ypal-readonly-run-duration-v1.py"
GENERATION = "ypal-restored-generation-v1.py"
ORDINARY = "ypal-ordinary-generation-v5c.py"
PRIMITIVES = "retained-workers-stage-v1.py"
BRIDGE_SHA = "0a2276924a29fa829125ad1ba61d557feb527c77c98dd6897db14313e5bab755"
SOURCE_PINS = {
    FROZEN: "00b35f20a783307f5a83351c34876d0fa2777cea95ae1a817f399704a1be67a4",
    GENERATION: "48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946",
    ORDINARY: "ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da",
    PRIMITIVES: "4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416"
}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def public(path, digest):
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             "protected_fixed_readonly_timer_source_required")
    before = path.lstat()
    raw = path.read_bytes()
    after = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < len(raw) == before.st_size <= 100000 and
         hashlib.sha256(raw).hexdigest() == digest and all(getattr(before, key) == getattr(after, key) for key in
         ["st_dev", "st_ino", "st_uid", "st_gid", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"]),
         "same_actual_fixed_readonly_timer_source_bytes_required")
    return raw


def literal(raw, name):
    rows = [node.value for node in ast.parse(raw).body if isinstance(node, ast.Assign) and len(node.targets) == 1 and
            isinstance(node.targets[0], ast.Name) and node.targets[0].id == name]
    need(len(rows) == 1, "one_actual_public_bridge_or_primitives_literal_required")
    return ast.literal_eval(rows[0])


def references():
    # Only authenticated public source is read. None of its Host, query,
    # generation, metadata or current constructors is executed.
    sources = {name: public(OPS / name, digest) for name, digest in SOURCE_PINS.items()}
    bridge = literal(sources[GENERATION], "BRIDGE")
    need(type(bridge) is str and bridge.count("./ypal-cache-guard-transition-v1.mjs") == 1,
         "one_retained_ordinary_bridge_import_identity_seam_required")
    # This is the exact counted public import seam in the frozen V5 producer.
    # The complete producer bytes above are authenticated before deriving it.
    bridge = bridge.replace("./ypal-cache-guard-transition-v1.mjs", "./ypal-ordinary-cache-transition-v5.mjs")
    need(hashlib.sha256(bridge.encode()).hexdigest() == BRIDGE_SHA,
         "exact_actual_ordinary_public_bridge_JavaScript_required")
    node = literal(sources[PRIMITIVES], "NODE")
    clean = literal(sources[PRIMITIVES], "CLEAN")
    need(node == "/opt/node-v24.18.1/bin/node" and clean == {
        "PATH": "/opt/node-v24.18.1/bin:/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "TZ": "UTC"
    }, "exact_fixed_public_Node_and_clean_environment_literals_required")
    argv = ("/usr/bin/setpriv", "--reuid=111", "--regid=113", "--clear-groups", "/usr/bin/env", "-i",
            *[key + "=" + value for key, value in clean.items()], node, "--input-type=module", "-e", bridge)
    frozen = types.ModuleType("exact_frozen_readonly_run_duration")
    frozen.__file__ = str(OPS / FROZEN)
    exec(compile(sources[FROZEN], frozen.__file__, "exec"), frozen.__dict__)
    return frozen, argv


def command_family(args, kwargs, public_argv):
    value = args[0] if args else kwargs.get("args")
    if type(value) not in (list, tuple) or len(value) != len(public_argv):
        return "unclassified"
    if not all(type(item) is str for item in value):
        return "unclassified"
    return "generation-recovery-read-bridge" if tuple(value) == public_argv else "unclassified"


def RunDurations(maximum_calls=10000):
    """Keep the complete frozen observer; add only a fixed diagnostic family.

    Stdin is never read or parsed. In particular, the verifier/observer phase
    lives in stdin and this observer deliberately makes no phase claim.
    """
    base, public_argv = references()

    class Observed(base.RunDurations):
        def _start(self, args, kwargs):
            row = super()._start(args, kwargs)
            if row is not None:
                try:
                    row["publicCommandFamily"] = command_family(args, kwargs, public_argv)
                except base._BOOKKEEPING_ERRORS:
                    self.bookkeeping_errors += 1
            return row

        def snapshot(self):
            return {
                **super().snapshot(), "format": FORMAT,
                "frozenTimerSourceSha256": SOURCE_PINS[FROZEN],
                "publicBridgeJavaScriptSha256": BRIDGE_SHA,
                "publicBridgeSourceSha256": SOURCE_PINS[GENERATION],
                "publicOrdinaryProducerSha256": SOURCE_PINS[ORDINARY],
                "fixedPublicFamilyLabelOnly": True,
                "stdinReadOrParsed": False,
                "bridgePhaseClassified": False,
                "rawArgumentsOrCodeRetained": False,
                "stackOrFrameHooksInstalled": False
            }

    return Observed(maximum_calls=maximum_calls)


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "staticOnly": True, "subprocessObserverInstalled": False,
                      "timingQualificationClaimed": False, "effectsDispatchedByObserver": False}))
