#!/usr/bin/env python3
"""Deploy the hash-pinned API patch, retaining the prior release for rollback."""

import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.parse
import urllib.request


OLD = Path("/opt/yunipals/releases/exomon-jit-20261007-035c391")
NEW = Path("/opt/yunipals/releases/rarity-point-reads-20261014-c9894fc6")
BACKUP = Path("/opt/yunipals-ops/rarity-point-reads-20261014")
DROPIN = Path("/etc/systemd/system/yunipals-api.service.d/zzzzzzz-rarity-point-reads.conf")
BEFORE_SHA = "92b561e48d8a3660fbe7738aea79da538325352bbcc4174945de2d8e96da091b"
AFTER_SHA = "c9894fc66999a04afc7b60cc5df3c9ee787db78f8901c98a9c5f2e81c9600cb5"
SERVICE = "yunipals-api.service"
PUBLIC = "https://api.yunipals.com/yunipals-indexer"
QUERY = "/v1/tokens?limit=24&burned=false&metadata=all&sort=rarity-capped-desc"


def run(arguments):
    return subprocess.check_output(arguments, text=True, timeout=45).strip()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def probe(base, path, expect_tokens=False):
    started = time.monotonic()
    request = urllib.request.Request(base + path, headers={
        "Accept": "application/json", "Origin": "https://www.yunipals.com",
        "User-Agent": "Yunipals-Rarity-Deployment-Verification/1.0"
    })
    with urllib.request.urlopen(request, timeout=5) as response:
        data = json.loads(response.read(2 * 1024 * 1024))
        sample = {"path": path.split("&cursor=")[0], "status": response.status,
                  "seconds": round(time.monotonic() - started, 3),
                  "serverTiming": response.headers.get("Server-Timing")}
    assert sample["status"] == 200 and sample["seconds"] < 5, sample
    if expect_tokens:
        assert len(data.get("items", [])) == 24 and data.get("total", 0) >= 24
        assert all(item.get("burned") is not True for item in data["items"])
        sample.update(items=len(data["items"]), total=data["total"])
    return sample, data


def wait_ready(base):
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        try:
            return probe(base, "/ready")[0]
        except Exception:
            time.sleep(0.5)
    raise RuntimeError("Candidate API did not become ready")


def save(report):
    destination = BACKUP / "deployment.json"
    destination.write_text(json.dumps(report, indent=2) + "\n")
    destination.chmod(0o600)


def main():
    assert socket.gethostname() == "yunipals-main", "Wrong deployment host"
    assert run(["systemctl", "show", SERVICE, "-p", "WorkingDirectory", "--value"]) == str(OLD)
    assert sha(OLD / "lib/api/server.ts") == BEFORE_SHA, "Live source changed"
    assert not NEW.exists() and not DROPIN.exists() and not BACKUP.exists(), "Deployment already staged"
    BACKUP.mkdir(mode=0o700)
    shutil.copyfile(OLD / "lib/api/server.ts", BACKUP / "server.ts.before")
    (BACKUP / "service.before").write_text(run(["systemctl", "cat", SERVICE]))
    (BACKUP / "service.before").chmod(0o600)
    shutil.copytree(OLD, NEW, symlinks=True, ignore=shutil.ignore_patterns(".git", ".ponder", ".env"))
    target = NEW / "lib/api/server.ts"
    assert target.resolve() == target, "Candidate source must be an independent file"
    source = target.read_text()
    old_import = 'import { cachedSearchReadRelation, cachedSearchReadRelationFor, cachedMissingKeys } from "../metadata/read-cache.js";'
    new_import = 'import { cachedSearchReadRelationFor, cachedMissingKeys } from "../metadata/read-cache.js";'
    old_query = '  const searchRelation = cachedProofs ? cachedSearchReadRelation(chains, projectionId!) : projectionId ? metadataSearchReadRelationAt(projectionId) : metadataSearchReadRelation;'
    new_query = '''  // Point lookups need token-correlated proofs even while the bulk cache is
  // invalid. Its fallback can otherwise scan Base event history per candidate.
  // Keep cached relations for bulk counts and missing-metadata candidates below.
  const searchRelation = projectionId ? metadataSearchReadRelationAt(projectionId) : metadataSearchReadRelation;'''
    assert source.count(old_import) == source.count(old_query) == 1
    target.write_text(source.replace(old_import, new_import).replace(old_query, new_query))
    assert sha(target) == AFTER_SHA
    # Preserve effective runtime credentials and options without printing them.
    pid = run(["systemctl", "show", SERVICE, "-p", "MainPID", "--value"])
    environment = dict(value.split("=", 1) for value in Path(f"/proc/{pid}/environ").read_text().split("\0") if "=" in value)
    live_port = int(environment.get("API_PORT", "9011"))
    candidate_port = 19214
    assert live_port != candidate_port
    with socket.socket() as port_check:
        port_check.bind(("127.0.0.1", candidate_port))
    environment.update(API_PORT=str(candidate_port), API_HOST="127.0.0.1")
    report = {"preparedAt": now(), "oldRelease": str(OLD), "newRelease": str(NEW),
              "beforeSha256": BEFORE_SHA, "afterSha256": AFTER_SHA,
              "candidateChecks": [], "publicChecks": [], "productionChanged": False}
    with (BACKUP / "candidate.log").open("w") as output:
        candidate = subprocess.Popen(["/opt/node-v24.18.1/bin/node", "--import", "tsx", str(target)],
                                     cwd=NEW, env=environment, stdout=output, stderr=subprocess.STDOUT)
        try:
            base = f"http://127.0.0.1:{candidate_port}"
            report["candidateChecks"].append(wait_ready(base))
            for sort in ("rarity-capped-desc", "rarity-capped-asc", "rarity-desc", "rarity-asc"):
                path = QUERY.replace("rarity-capped-desc", sort)
                sample, first = probe(base, path, True)
                report["candidateChecks"].append(sample)
                assert first.get("nextCursor"), "First page has no continuation"
                sample, second = probe(base, path + "&cursor=" + urllib.parse.quote(first["nextCursor"], safe=""), True)
                sample["continuation"] = True
                report["candidateChecks"].append(sample)
                keys = lambda page: {(item["chain"], item["tokenId"]) for item in page["items"]}
                assert len(keys(first)) == len(keys(second)) == 24 and not keys(first) & keys(second)
            sample, solana = probe(base, QUERY + "&chain=solana", True)
            assert all(item["chain"] == "solana" for item in solana["items"])
            report["candidateChecks"].append(sample)
        finally:
            candidate.terminate()
            try:
                candidate.wait(timeout=10)
            except subprocess.TimeoutExpired:
                candidate.kill()
                candidate.wait(timeout=5)
    save(report)
    print(json.dumps({"candidatePassed": True, "checks": report["candidateChecks"]}), flush=True)
    assert run(["systemctl", "show", SERVICE, "-p", "WorkingDirectory", "--value"]) == str(OLD)
    assert sha(OLD / "lib/api/server.ts") == BEFORE_SHA and not DROPIN.exists()
    dropin = f"[Service]\nWorkingDirectory={NEW}\nExecStart=\nExecStart=/opt/node-v24.18.1/bin/node --import tsx {target}\n"
    try:
        DROPIN.write_text(dropin)
        DROPIN.chmod(0o644)
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "restart", SERVICE])
        wait_ready(f"http://127.0.0.1:{live_port}")
        assert run(["systemctl", "show", SERVICE, "-p", "WorkingDirectory", "--value"]) == str(NEW)
        report["deployedAt"] = now()
        for path in (QUERY, QUERY + "&chain=solana", "/v2/collections/ethereum-islands/tokens?limit=24"):
            report["publicChecks"].append(probe(PUBLIC, path, True)[0])
        report.update(productionChanged=True, serviceActive=run(["systemctl", "is-active", SERVICE]),
                      automaticRestarts=int(run(["systemctl", "show", SERVICE, "-p", "NRestarts", "--value"])),
                      rollback={"removeDropIn": str(DROPIN), "restartService": SERVICE, "retainedRelease": str(OLD)})
        save(report)
        print(json.dumps(report), flush=True)
    except Exception:
        if DROPIN.exists():
            assert DROPIN.read_text() == dropin, "Override changed; refusing to remove another operator's change"
            DROPIN.unlink()
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "restart", SERVICE])
        report.update(rolledBackAt=now(), productionChanged=False)
        save(report)
        raise


if __name__ == "__main__":
    main()
