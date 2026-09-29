#!/usr/bin/env python3
"""Record 24 hours of production projection read health and storage headroom."""

from __future__ import annotations

from collections import Counter, defaultdict
import datetime as dt
from http.client import HTTPException
import json
import os
import subprocess
import time
from urllib.error import HTTPError, URLError
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


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def status(url: str) -> tuple[int | str, int]:
    started = time.monotonic()
    try:
        with urlopen(url, timeout=12) as response:
            response.read()
            code: int | str = response.status
    except HTTPError as error:
        code = error.code
    except (URLError, OSError, HTTPException) as error:
        code = type(error).__name__
    return code, round((time.monotonic() - started) * 1000)


def pointer() -> str:
    result = subprocess.run(
        ["runuser", "-u", "postgres", "--", "/usr/lib/postgresql/16/bin/psql",
         "-d", "yunipals_backfill", "-XAt", "-c",
         "SELECT current_id FROM metadata_projection.active WHERE singleton"],
        capture_output=True, text=True, timeout=5, check=True,
    )
    return result.stdout.strip()


def free_bytes() -> int:
    stat = os.statvfs("/")
    return stat.f_bavail * stat.f_frsize


def percentile(values: list[int], quantile: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, int(len(ordered) * quantile + 0.999999) - 1))]


def report(event: str, counts: Counter[str], errors: Counter[str], latencies: dict[str, list[int]],
           generations: Counter[str], minimum_free: int) -> None:
    print(json.dumps({"event": event, "at": utc_now(), "samples": counts,
        "errors": errors, "generations": generations, "minimumFreeBytes": minimum_free,
        "p95LatencyMs": {name: percentile(values, 0.95) for name, values in latencies.items()},
        "maxLatencyMs": {name: max(values) for name, values in latencies.items()}}), flush=True)


def main() -> None:
    duration = int(os.environ.get("PROJECTION_OBSERVE_SECONDS", "86400"))
    if duration < 60 or duration > 86400:
        raise RuntimeError("Invalid observation duration")
    counts: Counter[str] = Counter()
    errors: Counter[str] = Counter()
    generations: Counter[str] = Counter()
    latencies: dict[str, list[int]] = defaultdict(list)
    minimum_free = free_bytes()
    started = time.monotonic()
    next_checkpoint = started + 3600
    print(json.dumps({"event": "started", "at": utc_now(), "durationSeconds": duration,
        "generation": pointer()}), flush=True)
    while time.monotonic() - started < duration:
        cycle = time.monotonic()
        for name, url in ROUTES.items():
            code, elapsed = status(url)
            counts[name] += 1
            latencies[name].append(elapsed)
            if code != 200:
                errors[f"{name}:{code}"] += 1
                print(json.dumps({"event": "read_error", "at": utc_now(), "route": name,
                    "status": code}), flush=True)
        try:
            generations[pointer()] += 1
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            errors["pointer:unavailable"] += 1
            print(json.dumps({"event": "pointer_error", "at": utc_now()}), flush=True)
        minimum_free = min(minimum_free, free_bytes())
        if time.monotonic() >= next_checkpoint:
            report("checkpoint", counts, errors, latencies, generations, minimum_free)
            next_checkpoint += 3600
        time.sleep(max(0, 60 - (time.monotonic() - cycle)))
    report("summary", counts, errors, latencies, generations, minimum_free)
    if errors or minimum_free < 25_000_000_000:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
