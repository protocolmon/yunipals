import hashlib
import json
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

assert socket.gethostname() == "yunipals-main" and os.geteuid() == 0

old_release = Path("/opt/yunipals-collector/releases/20260922-search")
release = Path("/opt/yunipals-collector/releases/20260923-rarity-range")
unit = Path("/etc/systemd/system/yunipals-collector-api.service")
candidate_unit = Path(
    "/etc/systemd/system/yunipals-collector-api-candidate.service"
)
backup = Path("/opt/yunipals-collector/rollout-20260923-rarity-range")
expected_server = "477be4db23ba7116bffd8501f98ea348d60e99d0860af54516710b9514f9323c"


def public_capabilities():
    output = subprocess.check_output(
        [
            "/opt/node-v24.18.1/bin/node",
            "--input-type=module",
            "-e",
            "const r=await fetch('https://api.yunipals.com/yunipals-indexer/v1/collector-capabilities',{signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error('Capabilities HTTP '+r.status);console.log(JSON.stringify(await r.json()));",
        ],
        text=True,
    )
    return json.loads(output)

assert old_release.exists() and release.exists() and unit.exists()
assert candidate_unit.exists()
assert hashlib.sha256((release / "server.mjs").read_bytes()).hexdigest() == expected_server
candidate_environment = (release / "collector.env").read_text()
assert "COLLECTOR_API_PORT=9013\n" in candidate_environment
assert "API_COLLECTOR_RARITY_RANGE_ENABLED=true\n" in candidate_environment
assert (
    subprocess.check_output(
        ["systemctl", "is-active", "yunipals-collector-api-candidate"],
        text=True,
    ).strip()
    == "active"
)
smoke = json.loads(
    Path("/tmp/yunipals-collector-production-smoke.json").read_text()
)
benchmark = json.loads(
    Path("/tmp/yunipals-rarity-range-production-benchmark.json").read_text()
)
assert smoke["passed"] is True
assert benchmark["errors"] == []
assert 0 < benchmark["p99Ms"] < 1000

before_capabilities = public_capabilities()
assert before_capabilities["version"] == 1
assert before_capabilities.get("rarityRange") is not True

backup.mkdir(mode=0o700)
before_unit = unit.read_text()
before_environment = (old_release / "collector.env").read_text()
(backup / "collector-api.service.before").write_text(before_unit)
(backup / "collector.env.before").write_text(before_environment)
legacy_pid = subprocess.check_output(
    ["systemctl", "show", "yunipals-api", "-p", "MainPID", "--value"],
    text=True,
).strip()

production_environment = candidate_environment.replace(
    "COLLECTOR_API_PORT=9013\n", "COLLECTOR_API_PORT=9012\n"
).replace("API_DB_POOL_MAX=2\n", "API_DB_POOL_MAX=4\n")
assert production_environment != candidate_environment
production_unit = before_unit.replace(str(old_release), str(release))
assert production_unit.count(str(release)) == 3

try:
    subprocess.run(
        ["systemctl", "stop", "yunipals-collector-api-candidate"], check=True
    )
    (release / "collector.env").write_text(production_environment)
    (release / "collector.env").chmod(0o600)
    unit.write_text(production_unit)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "restart", "yunipals-collector-api"], check=True)
    for attempt in range(15):
        try:
            with urllib.request.urlopen("http://127.0.0.1:9012/ready", timeout=2) as response:
                assert json.load(response) == {"status": "ready"}
            break
        except Exception:
            if attempt == 14:
                raise
            time.sleep(1)
    with urllib.request.urlopen(
        "http://127.0.0.1:9012/v1/collector-capabilities", timeout=2
    ) as response:
        assert json.load(response) == {
            "version": 1,
            "namePrefixSearch": False,
            "rarityRange": True,
        }
    assert public_capabilities() == {
        "version": 1,
        "namePrefixSearch": False,
        "rarityRange": True,
    }
    assert (
        subprocess.check_output(
            ["systemctl", "show", "yunipals-api", "-p", "MainPID", "--value"],
            text=True,
        ).strip()
        == legacy_pid
    )
except Exception:
    unit.write_text(before_unit)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "restart", "yunipals-collector-api"], check=True)
    raise

candidate_unit.unlink()
subprocess.run(["systemctl", "daemon-reload"], check=True)
record = {
    "status": "rarity-range-live",
    "release": str(release),
    "serverSha256": expected_server,
    "benchmarkP95Ms": benchmark["p95Ms"],
    "benchmarkP99Ms": benchmark["p99Ms"],
    "benchmarkErrors": benchmark["errors"],
    "legacyApiRestarted": False,
}
(backup / "backend.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record))
