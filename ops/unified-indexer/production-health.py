#!/usr/bin/env python3
"""Read-only shared-source/product checks and continuous acceptance evidence."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime
import fcntl
import hashlib
import json
import os
import pwd
from pathlib import Path
import subprocess
import time
import urllib.request


def acceptance(previous, now, boot_id, healthy):
    continuous = (
        previous.get("healthy") is True
        and previous.get("bootId") == boot_id
        and 0 <= now - previous.get("checkedAtUnix", 0) <= 180
        and 0 <= previous.get("healthySinceUnix", now) <= now
    )
    since = previous["healthySinceUnix"] if healthy and continuous else now
    elapsed = now - since if healthy else 0
    return {
        "healthySinceUnix": since if healthy else None,
        "healthySeconds": int(elapsed),
        "oneHourPassed": healthy and elapsed >= 60 * 60
    }


def command(arguments, timeout=40):
    return subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)


def unit(name):
    if "@." in name:
        return {"ActiveState": "inactive", "UnitFileState": command(["systemctl", "is-enabled", name]).stdout.strip()}
    result = command(["systemctl", "show", name, "-p", "ActiveState", "-p", "UnitFileState", "-p", "MainPID", "-p", "NRestarts", "-p", "Result", "-p", "ExecMainStatus"])
    if result.returncode:
        return {}
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def endpoint(specification):
    result = {"name": specification["name"], "healthy": False}
    try:
        request = urllib.request.Request(specification["url"], headers={"User-Agent": "Yunipals-Shared-Health/1.0"})
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(2_000_001)
            if response.status != 200 or len(raw) > 2_000_000:
                return result
            body = json.loads(raw)
        for path, expected in specification.get("equals", {}).items():
            value = body
            for part in path.split("."):
                value = value[part]
            if value != expected:
                return result
        for path in specification.get("nonempty", []):
            value = body
            for part in path.split("."):
                value = value[part]
            if not value:
                return result
        result["healthy"] = True
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return result


def probe_report(path, owner, configuration_hash, kind, now):
    file = Path(path)
    info = file.lstat()
    assert not file.is_symlink() and info.st_uid == owner and not info.st_mode & 0o022
    record = json.loads(file.read_text())
    assert record["kind"] == kind and record["configurationSha256"] == configuration_hash
    assert 0 <= now - record["checkedAtUnix"] <= 120
    return record


def check(config, scope):
    failures = []
    details = {}
    try:
        source = probe_report(config["sourceReport"], pwd.getpwnam("yunipals_unified_support").pw_uid, config["configurationSha256"], "source", time.time())
        report = source["report"]
        good = (
            source["healthy"] is True
            and unit("yunipals-shared-source-health.service").get("Result") == "success"
            and unit("yunipals-shared-source-health.service").get("ExecMainStatus") == "0"
            and report["releaseId"] == config["releaseId"]
            and report["running"] is True
            and report["frameworkReady"] is True
            and {row["sourceId"] for row in report["sources"]} == set(config["sourceIds"])
            and all(row["ready"] is True for row in report["sources"])
            and report["providerCalls"] == 0 and report["writes"] == 0
        )
    except (OSError, AssertionError, ValueError, KeyError, TypeError):
        good = False
    details["sourceHealthy"] = good
    if not good:
        failures.append("shared_source_unhealthy")
    ponder = []
    solana = []
    for process in Path("/proc").iterdir():
        if not process.name.isdigit():
            continue
        try:
            arguments = (process / "cmdline").read_bytes().split(b"\0")
            if any(value.endswith(b"/ponder.js") for value in arguments):
                ponder.append(process)
            if b"lib/solana/worker.ts" in arguments:
                solana.append(process)
        except OSError:
            pass
    details["ponderProcesses"] = len(ponder)
    details["solanaProcesses"] = len(solana)
    if len(ponder) != 1 or len(solana) != 1:
        failures.append("ingestion_process_count")
    else:
        group = command(["systemctl", "show", "yunipals-indexer.service", "-p", "ControlGroup", "--value"]).stdout.strip()
        if not group or any(group not in (process / "cgroup").read_text().splitlines()[0] for process in ponder + solana):
            failures.append("ingestion_service_ownership")
    selected = [group for group in config["groups"] if scope == "all" or group == scope]
    units = {name: unit(name) for group in selected for name in config["groups"][group]["services"]}
    for name, state in units.items():
        if state.get("ActiveState") != "active":
            failures.append("service_inactive:" + name)
    details["services"] = units
    for name in config["requiredTimers"] if scope == "all" else []:
        state = unit(name)
        if state.get("ActiveState") != "active" or state.get("UnitFileState") != "enabled":
            failures.append("timer_unavailable:" + name)
    for name in config["requiredEnabled"] if scope == "all" else []:
        if unit(name).get("UnitFileState") != "enabled":
            failures.append("boot_unit_not_enabled:" + name)
    for name in config["retiredUnits"] if scope == "all" else []:
        state = unit(name)
        if state.get("ActiveState") == "active" or state.get("UnitFileState") != "masked":
            failures.append("retired_unit_available:" + name)
    specifications = [spec for group in selected for spec in config["groups"][group]["endpoints"]]
    with ThreadPoolExecutor(max_workers=3) as executor:
        endpoints = list(executor.map(endpoint, specifications))
    details["endpoints"] = endpoints
    failures.extend("endpoint_unhealthy:" + row["name"] for row in endpoints if not row["healthy"])
    if scope in ("all", "marketplace"):
        try:
            budgets = probe_report(config["budgetReport"], pwd.getpwnam("postgres").pw_uid, config["configurationSha256"], "budget", time.time())
            details["budgetChecks"] = budgets["checks"]
            state = unit("yunipals-shared-budget-health.service")
            good = state.get("Result") == "success" and state.get("ExecMainStatus") == "0" and budgets["healthy"] is True and {r["name"] for r in budgets["checks"]} == {r["name"] for r in config["budgetPolicyChecks"]} and all(r["matches"] is True for r in budgets["checks"])
        except (OSError, AssertionError, ValueError, KeyError, TypeError):
            good = False
        details["budgetPoliciesUnchanged"] = good
        if not good:
            failures.append("budget_policy_check_unavailable_or_changed")
    return failures, details


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--configuration", required=True)
    parser.add_argument("--state-directory", required=True)
    parser.add_argument("--scope", choices=["all", "source", "islands", "marketplace"], default="all")
    args = parser.parse_args()
    assert os.geteuid() == 0
    assert command(["hostname"]).stdout.strip() == "yunipals-main"
    configuration = Path(args.configuration)
    info = configuration.lstat()
    assert configuration.is_absolute() and not configuration.is_symlink() and info.st_uid == 0 and not info.st_mode & 0o022
    config = json.loads(configuration.read_text())
    configuration_hash = hashlib.sha256(configuration.read_bytes()).hexdigest()
    config["configurationSha256"] = configuration_hash
    assert len(config["sourceIds"]) == 13 and len(set(config["sourceIds"])) == 13
    state = Path(args.state_directory)
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (state / "check.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        checked = time.time()
        boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        latest = state / "latest.json"
        try:
            previous = json.loads(latest.read_text())
        except (OSError, ValueError):
            previous = {}
        if previous.get("configurationSha256") != configuration_hash or previous.get("scope") != args.scope:
            previous = {}
        try:
            failures, details = check(config, args.scope)
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            failures, details = ["health_check_execution_failed"], {}
        healthy = not failures
        record = {"checkedAt": datetime.datetime.fromtimestamp(checked, datetime.timezone.utc).isoformat(), "checkedAtUnix": checked, "bootId": boot_id, "releaseId": config["releaseId"], "configurationSha256": configuration_hash, "scope": args.scope, "healthy": healthy, "failures": failures, "details": details, **acceptance(previous, checked, boot_id, healthy)}
        encoded = json.dumps(record, sort_keys=True) + "\n"
        with (state / "history.jsonl").open("a") as history:
            history.write(encoded)
        temporary = state / "latest.next"
        temporary.write_text(encoded)
        temporary.replace(latest)
        if previous.get("failures") != failures or previous.get("oneHourPassed") != record["oneHourPassed"]:
            print(json.dumps({key: record[key] for key in ["checkedAt", "healthy", "failures", "healthySeconds", "oneHourPassed"]}))
        return 0 if healthy else 1


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())
