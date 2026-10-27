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
from pathlib import Path

RECEIPT_SHA = "91e6496cb4efc7548671318beeb63b2592602d545ab884dd3f6bb3f539f70fb8"
OPERATOR_SHA = "74984e4f678f642605edb2b1ca5cb729bbc831905c0ab149dca611df83aa1750"
ROLLOUT_OPERATION_SHA = '9ac0f77ecc1a460bbe839f6d09bf669f2f36abb64078dcb2ee3b2fd5554de10e'
ROLE = "yunipals_unified_collector"
ROLE_OID = "73187672"
API_BUNDLE_SHA = "b624dc518556756399a26e691bd1d53d319bd46d20134f9d6e1356dae3d96088"
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
    """Acknowledge the new actual producer; never relabel old d0e validation."""
    if hashlib.sha256(raw).hexdigest() != RECEIPT_SHA:
        fail("actual_collection_API_rollout_receipt_required")
    receipt = json.loads(raw)
    operation_raw = frozen_admission.protected(Path('/var/backups/yunipals-booster-collection-api-v1-20261023/operation.json'))
    operation = json.loads(operation_raw)
    operation_sha = ROLLOUT_OPERATION_SHA
    if (hashlib.sha256(operation_raw).hexdigest() != operation_sha
            or operation.get('operatorSha256') != OPERATOR_SHA
            or receipt.get('format') != 'yunipals-booster-collection-api-rollout-v1'
            or receipt.get('completed') is not True or receipt.get('operationSha256') != operation_sha
            or receipt.get('newBundleSha256') != API_BUNDLE_SHA
            or receipt.get('unitSha256') != frozen_admission.UNIT_SHA
            or receipt.get('publicEnvironment') != 'BOOSTER_ARTWORK_CATALOGS=base-mainnet-smoke-v1,base-mainnet-standard-v1'
            or any(receipt.get(k) != 0 for k in ('databaseWrites','grantChanges','schemaChanges','upstreamProviderCalls'))
            or receipt.get('independentActorsUnchanged') is not True
            or not all(receipt.get('readiness',{}).get(k) is True for k in ('birthMetadataVerified','globalBrowseVerified','requestMonstersVerified'))):
        fail("actual_successful_collection_birth_claim_API_rollout_required")
    frozen_admission.validate(current, True)
    env_sha = api.get('environmentSha256')
    old = frozen_admission.protected(Path('/etc/yunipals-unified/booster-api.env'))
    before = b'BOOSTER_DATABASE_SCHEMA=yunipals_boosters_launch_v1\n'
    after = b'BOOSTER_DATABASE_SCHEMA=unified_shadow_20261020_7e7375b0\n'
    canonical = old.replace(after,before)
    if hashlib.sha256(canonical).hexdigest() != QUEUE_INPUTS['/etc/yunipals-unified/booster-api.env'] or canonical.count(before) != 1 or env_sha != hashlib.sha256(old).hexdigest():
        fail("actual_owned_schema_selector_only_environment_required")
    expected_queue = {**QUEUE_INPUTS,'/etc/yunipals-unified/booster-api.env':env_sha}
    if (api.get('definitionSha256') != frozen_admission.UNIT_SHA
            or api.get('bundleSha256') != API_BUNDLE_SHA
            or api.get('ActiveState') != 'active' or api.get('SubState') != 'running'
            or api.get('ControlGroup') != '/system.slice/yunipals-booster-api.service'
            or not re.fullmatch('[0-9a-f]{32}',api.get('InvocationID',''))
            or any(not re.fullmatch('[1-9][0-9]*',api.get(k,''))for k in ('MainPID','ExecMainStartTimestampMonotonic'))
            or queue_inputs != expected_queue):
        fail("actual_live_collection_API_and_unchanged_queue_required")
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
