"""Bounded, operator-authored maintenance records for public request checks."""

import json
import math
import os
from pathlib import Path
import re
import stat


DEFAULT_PATH = Path("/run/yunipals-maintenance/requests.json")
MAX_WINDOW_SECONDS = 24 * 3600


def validate_maintenance(value):
    if not isinstance(value, dict) or value.get("formatVersion") != 1:
        raise ValueError("Invalid maintenance record")
    if not isinstance(value.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value["id"]):
        raise ValueError("Invalid maintenance identifier")
    for key in ("startsAt", "expiresAt"):
        if isinstance(value.get(key), bool) or not isinstance(value.get(key), (int, float)) or not math.isfinite(value[key]):
            raise ValueError("Invalid maintenance time")
    if not 0 < value["expiresAt"] - value["startsAt"] <= MAX_WINDOW_SECONDS:
        raise ValueError("Invalid maintenance duration")
    if not isinstance(value.get("reason"), str) or not 1 <= len(value["reason"]) <= 200 or any(ord(c) < 32 for c in value["reason"]):
        raise ValueError("Invalid maintenance reason")
    urls = value.get("urls")
    if not isinstance(urls, list) or not 1 <= len(urls) <= 12 or len(set(urls)) != len(urls):
        raise ValueError("Invalid maintenance URLs")
    from urllib.parse import urlsplit
    for url in urls:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise ValueError("Invalid maintenance URL")
    return value


def load_maintenance(path=DEFAULT_PATH):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return None
    with os.fdopen(fd) as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 16384:
            raise ValueError("Untrusted maintenance record")
        return validate_maintenance(json.load(source))


def expected_maintenance(record, route, sample, now):
    return bool(record and record["startsAt"] <= now < record["expiresAt"]
                and route["url"] in record["urls"] and sample["status"] == 503
                and sample.get("maintenanceId") == record["id"])
