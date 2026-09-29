#!/usr/bin/env python3
"""Observe the first projection publication through live loopback read routes."""

from __future__ import annotations

from collections import Counter
import datetime as dt
import json
import subprocess
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen


ROUTES = {
    "api_ready": "http://127.0.0.1:9011/ready",
    "api_tokens": "http://127.0.0.1:9011/v1/tokens?chain=bnb&limit=1",
    "api_traits": "http://127.0.0.1:9011/v1/traits?chain=bnb",
    "collector_ready": "http://127.0.0.1:9012/ready",
    "collector_page": "http://127.0.0.1:9012/v2/owners/0x0000000000000000000000000000000000000001/tokens?chain=bnb&limit=1",
    "market_ready": "http://127.0.0.1:19013/health/ready",
    "market_catalog": "http://127.0.0.1:19013/v1/market/tokens?chain=bnb&limit=2",
}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def get(url: str) -> tuple[int | str, dict | None, float]:
    started = time.monotonic()
    try:
        with urlopen(url, timeout=12) as response:
            return response.status, json.load(response), time.monotonic() - started
    except HTTPError as error:
        return error.code, None, time.monotonic() - started
    except (URLError, TimeoutError, ValueError) as error:
        return type(error).__name__, None, time.monotonic() - started


def pointer() -> str:
    result = subprocess.run(
        ["runuser", "-u", "postgres", "--", "/usr/lib/postgresql/16/bin/psql",
         "-d", "yunipals_backfill", "-XAt", "-c",
         "SELECT current_id FROM metadata_projection.active WHERE singleton"],
        capture_output=True, text=True, timeout=5, check=True,
    )
    return result.stdout.strip()


def main() -> None:
    baseline = pointer()
    if not baseline.isdecimal():
        raise RuntimeError("No active projection generation")
    errors: Counter[str] = Counter()
    counts: Counter[str] = Counter()
    maximum_ms: dict[str, int] = {}
    retained: tuple[str, str, float] | None = None
    published: str | None = None
    continuation: int | str | None = None
    started = time.monotonic()
    next_read = 0.0
    next_snapshot = 0.0
    until = started + 7200
    after_publish: float | None = None
    print(json.dumps({"event": "started", "at": now(), "baseline": baseline}), flush=True)
    while time.monotonic() < until:
        moment = time.monotonic()
        if moment >= next_read:
            for name, url in ROUTES.items():
                status, _, elapsed = get(url)
                counts[name] += 1
                maximum_ms[name] = max(maximum_ms.get(name, 0), round(elapsed * 1000))
                if status != 200:
                    errors[f"{name}:{status}"] += 1
                    print(json.dumps({"event": "read_error", "at": now(), "route": name, "status": status}), flush=True)
            next_read = time.monotonic() + 15
        if published is None and moment >= next_snapshot:
            status, body, _ = get(ROUTES["market_catalog"])
            snapshot = body.get("snapshot") if isinstance(body, dict) else None
            cursor = body.get("nextCursor") if isinstance(body, dict) else None
            if status == 200 and isinstance(snapshot, dict) and isinstance(snapshot.get("id"), str) and isinstance(cursor, str):
                retained = (snapshot["id"], cursor, time.monotonic())
            else:
                errors[f"snapshot_capture:{status}"] += 1
            next_snapshot = time.monotonic() + 25
        current = pointer()
        if current != baseline and published is None:
            published = current
            after_publish = time.monotonic() + 30
            if retained:
                snapshot_id, cursor, captured = retained
                query = urlencode({"chain": "bnb", "limit": "2", "snapshot": snapshot_id, "cursor": cursor})
                continuation, _, _ = get("http://127.0.0.1:19013/v1/market/tokens?" + query)
                print(json.dumps({"event": "publication", "at": now(), "from": baseline,
                    "to": current, "retainedAgeSeconds": round(time.monotonic() - captured, 1),
                    "oldSnapshotPageStatus": continuation}), flush=True)
            else:
                errors["no_retained_snapshot"] += 1
                print(json.dumps({"event": "publication", "at": now(), "from": baseline,
                    "to": current, "oldSnapshotPageStatus": None}), flush=True)
        if after_publish is not None and time.monotonic() >= after_publish:
            break
        time.sleep(5)
    summary = {"event": "summary", "at": now(), "baseline": baseline, "published": published,
        "oldSnapshotPageStatus": continuation, "readCounts": counts,
        "readErrors": errors, "maxLatencyMs": maximum_ms,
        "durationSeconds": round(time.monotonic() - started)}
    print(json.dumps(summary), flush=True)
    if not published or continuation != 200 or errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
