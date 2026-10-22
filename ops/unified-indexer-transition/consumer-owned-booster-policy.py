"""Pure successor-policy checks. No SQL, service actions, or pack-launch imports.

Callers collect protected live observations and independently prove ownership of
any new consumer process. This module does not authorize additional sessions or
replace the existing source/capacity guards. Historical staged helpers stay fixed.
"""
import copy
import hashlib
import json
import re
from typing import NamedTuple

RECEIPT_SHA = "0fa89a0a8ee6cd5a2ca721dd21e6a3480c0b4df43abfaed21fde252281515f08"
OPERATOR_SHA = "c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e"
ROLE = "yunipals_unified_collector"
ROLE_OID = "73187672"
API_BUNDLE_SHA = "d0e269b0f3d43cc0cea2bcf53cc3b390357576e8901988942d17ffeb11f5cc4a"
API_DYNAMIC_FIELDS = {"InvocationID", "MainPID", "ExecMainStartTimestampMonotonic"}
QUEUE_INPUTS = {
    "/etc/systemd/system/yunipals-booster-artwork-queue.service": "98af81f91cac104665cb21f514be4b5ec59945a64c9b5c720f4cdf645f702d4e",
    "/etc/systemd/system/yunipals-booster-artwork-queue.timer": "a5aa3752a7781bddf970908229699a87a1d9d319242f0b422d0852e8e5d96211",
    "/etc/yunipals-unified/booster-api.env": "0c055ac01166d9b4218f498f795d16e2f895d17b60c8b96dd82890415306d400",
    "/opt/yunipals-unified/booster-api-releases/e2b150124335827d6466d284043050f192066e9fedd782416259c1823cd85e33/booster-artwork-sync.mjs": "e2b150124335827d6466d284043050f192066e9fedd782416259c1823cd85e33"
}


class OwnedFeature(NamedTuple):
    receipt_sha256: str
    role: str
    role_oid: str


def fail(message):
    raise RuntimeError(message)


def validate_owned_feature(raw, current, api, queue_inputs, frozen_admission):
    """Verify the actual receipt and separate feature graph, ignoring only counts.

    frozen_admission is the hash-checked c627... operator module; its capture and
    api_binding observations must come from the protected production reader.
    No role flag or privilege is normalized while validating the feature itself.
    """
    if hashlib.sha256(raw).hexdigest() != RECEIPT_SHA:
        fail("exact_owned_feature_receipt_required")
    receipt = json.loads(raw)
    if (receipt.get("format") != "yunipals-booster-api-admission"
            or receipt.get("committed") is not True
            or receipt.get("operatorSha256") != OPERATOR_SHA
            or receipt.get("role") != ROLE or receipt.get("roleOid") != ROLE_OID
            or receipt.get("noRoleWritesGranted") is not True):
        fail("actual_committed_feature_admission_required")
    frozen_admission.validate(current, True)
    if type(current.get("sessions")) is not int or not 0 <= current["sessions"] <= 6:
        fail("collector_session_count_exceeds_fixed_role_limit")
    if frozen_admission.comparable(current) != receipt["after"]:
        fail("owned_feature_read_graph_changed")
    saved_api = receipt["api"]
    if (set(api) != set(saved_api)
            or any(api[key] != saved_api[key] for key in api if key not in API_DYNAMIC_FIELDS)
            or api.get("ActiveState") != "active"
            or api.get("SubState") != "running"
            or api.get("bundleSha256") != API_BUNDLE_SHA
            or api.get("ControlGroup") != "/system.slice/yunipals-booster-api.service"
            or not re.fullmatch("[0-9a-f]{32}", api.get("InvocationID", ""))
            or any(not re.fullmatch("[1-9][0-9]*", api.get(key, "")) for key in ("MainPID", "ExecMainStartTimestampMonotonic"))):
        fail("owned_live_feature_API_binding_changed")
    if queue_inputs != QUEUE_INPUTS:
        fail("owned_queue_files_changed")
    return OwnedFeature(RECEIPT_SHA, ROLE, ROLE_OID)


def historical_comparison_copy(catalog, proof):
    """Only for old receipt equality; actual SQL before/after retain true LOGIN."""
    if proof != OwnedFeature(RECEIPT_SHA, ROLE, ROLE_OID):
        fail("verified_owned_feature_required")
    value = copy.deepcopy(catalog)
    matches = [row for row in value["roles"] if row["name"] == ROLE]
    if len(matches) != 1 or str(matches[0]["oid"]) != ROLE_OID or matches[0]["login"] is not True:
        fail("owned_collector_true_LOGIN_required")
    matches[0]["login"] = False
    return value


def login_effect(role, login_before, proof):
    """A successor restores its recorded state; it never disables the feature."""
    if role == ROLE:
        if proof != OwnedFeature(RECEIPT_SHA, ROLE, ROLE_OID) or login_before is not True:
            fail("verified_existing_collector_LOGIN_required")
        return {"alterLogin": False, "loginBefore": True, "restoreLogin": True}
    if role not in {"yunipals_unified_api", "yunipals_unified_islands_api", "yunipals_unified_read_cache"} or login_before is not False:
        fail("other_role_requires_its_own_dormant_admission")
    return {"alterLogin": True, "loginBefore": False, "restoreLogin": False}


def collector_connection_budget(candidate_api=2, candidate_worker=0, peer_probe=1):
    """Only applies after exact candidate code/ownership and global room checks."""
    values = (candidate_api, candidate_worker, peer_probe)
    if any(type(value) is not int or value < 0 for value in values):
        fail("bounded_pool_allowances_required")
    total = 2 + 1 + sum(values)
    if total > 6:
        fail("collector_six_connection_budget_exceeded")
    return {"featureApi": 2, "artworkQueue": 1, "candidateApi": candidate_api,
            "candidateWorker": candidate_worker, "peerProbe": peer_probe,
            "total": total, "roleLimit": 6}
