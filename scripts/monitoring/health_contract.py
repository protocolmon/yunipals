"""Validate explicitly approved deployment artifacts and current listing policies."""
import json
import re
from pathlib import Path


def load_frontend_manifest(path):
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict) or data.get("formatVersion") != 1:
        raise ValueError("Invalid frontend manifest")
    for key, pattern in {
        "gitRevision": r"[0-9a-f]{40}",
        "deploymentId": r"dpl_[A-Za-z0-9]+",
        "htmlSha256": r"[0-9a-f]{64}",
        "jsSha256": r"[0-9a-f]{64}",
        "jsPath": r"/assets/[A-Za-z0-9_-]+\.js",
    }.items():
        if not isinstance(data.get(key), str) or not re.fullmatch(pattern, data[key]):
            raise ValueError(f"Invalid frontend manifest field: {key}")
    return data


def policy_is_valid(status, policy, chain, now):
    if status != 200 or not isinstance(policy, dict):
        return False
    if policy.get("source") != "opensea" or policy.get("chain") != chain:
        return False
    if policy.get("maxDurationSeconds") != "2592000":
        return False
    fees = policy.get("fees")
    if not isinstance(fees, list):
        return False
    total = 0
    for fee in fees:
        points = fee.get("basisPoints") if isinstance(fee, dict) else None
        if type(points) is not int or points < 0:
            return False
        total += points
    expires = policy.get("expiresAt")
    if not isinstance(expires, str) or not expires.isdecimal():
        return False
    return total <= 100 and int(expires) > now
