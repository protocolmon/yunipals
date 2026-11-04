#!/usr/bin/env python3
"""Run one read-only probe as its existing database account; publish no rows."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import subprocess
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["source", "budget"], required=True)
    parser.add_argument("--configuration", required=True)
    parser.add_argument("--output-directory", required=True)
    args = parser.parse_args()
    expected_user = "yunipals_unified_support" if args.kind == "source" else "postgres"
    assert pwd.getpwuid(os.geteuid()).pw_name == expected_user
    path = Path(args.configuration)
    info = path.lstat()
    assert path.is_absolute() and not path.is_symlink() and info.st_uid == 0 and not info.st_mode & 0o022
    raw = path.read_bytes()
    config = json.loads(raw)
    record = {"kind": args.kind, "checkedAtUnix": time.time(), "configurationSha256": hashlib.sha256(raw).hexdigest(), "healthy": False}
    try:
        if args.kind == "source":
            result = subprocess.run(config["sourceHealthCommand"], capture_output=True, text=True, timeout=50)
            report = next(json.loads(line) for line in result.stdout.splitlines() if json.loads(line).get("event") == "shared_source_health")
            record.update(healthy=result.returncode == 0, report=report)
        else:
            checks = []
            for specification in config["budgetPolicyChecks"]:
                result = subprocess.run(["/usr/lib/postgresql/16/bin/psql", "-h", "/var/run/postgresql", "-U", "postgres", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-p", "15438", "-d", "yunipals_market_production", "-c", "BEGIN READ ONLY;" + specification["query"] + ";ROLLBACK;"], capture_output=True, text=True, timeout=15, env={**os.environ, "PGCONNECT_TIMEOUT": "3", "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=8s"})
                actual = hashlib.sha256(result.stdout.strip().encode()).hexdigest()
                checks.append({"name": specification["name"], "matches": result.returncode == 0 and actual == specification["sha256"]})
            record.update(healthy=all(row["matches"] for row in checks), checks=checks)
    except (OSError, ValueError, KeyError, TypeError, StopIteration, subprocess.SubprocessError):
        pass
    destination = Path(args.output_directory)
    temporary = destination / "latest.next"
    temporary.write_text(json.dumps(record, sort_keys=True) + "\n")
    # Only public health/provenance and policy hashes are published. Raw rows,
    # subprocess errors, credentials and provider configuration are never stored.
    temporary.chmod(0o644)
    temporary.replace(destination / "latest.public.json")
    return 0 if record["healthy"] else 1


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())
