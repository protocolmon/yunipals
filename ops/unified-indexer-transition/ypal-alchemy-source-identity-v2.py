#!/usr/bin/env python3
"""Pure source identity for an explicit successor; no receipt or host authority.

systemctl's ExecStart string contains command-result metadata which can reset
on daemon-reload. The typed executable/arguments and the complete process epoch
remain independently mandatory. Original packets are never modified.
"""
import copy
import hashlib
import json

FORMAT = "yunipals-alchemy-source-identity-v2"


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def program_identity(actor, typed):
    """Prove the typed clean command agrees with the actual Node argv."""
    argv = actor["parent"]["argv"]
    need(isinstance(argv, list) and 2 <= len(argv) <= 32 and
         all(isinstance(item, str) and item and "\0" not in item for item in argv),
         "bounded_actual_source_arguments_required")
    need(isinstance(typed, dict) and set(typed) == {"type", "data"} and
         typed["type"] == "a(sasbttttuii)" and isinstance(typed["data"], list) and len(typed["data"]) == 1,
         "one_actual_typed_source_command_required")
    row = typed["data"][0]
    need(isinstance(row, list) and len(row) == 10 and
         row[:3] == ["/usr/bin/env", ["/usr/bin/env", "-i", *argv], False] and type(row[2]) is bool and
         all(type(value) is int for value in row[3:]),
         "exact_typed_clean_source_program_and_full_arguments_required")
    return {"path": row[0], "argv": copy.deepcopy(row[1]), "ignoreFailure": row[2]}


def epoch_identity(actor):
    """A new identity projection, never a replacement SDK packet or receipt."""
    need(isinstance(actor, dict) and all(key in actor for key in ["unit", "parent", "processes"]) and
         isinstance(actor["unit"], dict) and isinstance(actor["unit"].get("ExecStart"), str) and
         type(actor["parent"]["pid"]) is int and actor["parent"]["pid"] > 1 and
         type(actor["parent"]["startTicks"]) is int and actor["parent"]["startTicks"] > 0 and
         isinstance(actor["processes"], list) and 1 <= len(actor["processes"]) <= 2,
         "complete_recorded_source_process_epoch_required")
    result = copy.deepcopy(actor)
    del result["unit"]["ExecStart"]
    return result


def compare_same_epoch(recorded, current, typed):
    """Caller authenticates receipts/static inputs and captures both live CASes.

    This pure comparison qualifies neither a running writer nor its database,
    permissions, canonical coverage, provider budget or old whole validator.
    """
    program = program_identity(current, typed)
    need(recorded["parent"]["argv"] == current["parent"]["argv"] and
         epoch_identity(recorded) == epoch_identity(current),
         "only_raw_ExecStart_presentation_may_differ_within_same_source_epoch")
    identity = {"actor": epoch_identity(current), "program": program}
    return {"format": FORMAT, "validated": True, "sameRecordedProcessEpoch": True,
            "identity": identity, "identitySha256": digest(identity),
            "recordedPacketSha256": digest(recorded), "currentPacketSha256": digest(current),
            "originalWholeValidatorPassed": False, "currentWriterQualified": False,
            "sourceReadinessQualified": False, "financialAuthorityQualified": False,
            "databaseWrites": 0, "serviceActions": 0, "providerCalls": 0}


if __name__ == "__main__":
    print(json.dumps({"format": FORMAT, "sourceOnly": True, "currentWriterQualified": False,
                      "financialAuthorityQualified": False, "databaseWrites": 0,
                      "serviceActions": 0, "providerCalls": 0}, sort_keys=True))
