import hashlib
import json
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

assert socket.gethostname() == "yunipals-main" and os.geteuid() == 0

release = Path("/opt/yunipals-collector/releases/20260923-rarity-range")
upload = Path("/tmp/yunipals-rarity-range-release")
unit = Path("/etc/systemd/system/yunipals-collector-api-candidate.service")
expected_server = "477be4db23ba7116bffd8501f98ea348d60e99d0860af54516710b9514f9323c"
expected_map = "f198a003731e029ebf76fae52dbf740a2b7a37b34922233db81b13734645755d"

assert not release.exists() and not unit.exists()
assert hashlib.sha256((upload / "server.mjs").read_bytes()).hexdigest() == expected_server
assert hashlib.sha256((upload / "server.mjs.map").read_bytes()).hexdigest() == expected_map

release.mkdir(parents=True, mode=0o755)
for name in ["server.mjs", "server.mjs.map"]:
    (release / name).write_bytes((upload / name).read_bytes())
(release / "node_modules").symlink_to(
    "/root/indexer-next/node_modules", target_is_directory=True
)
(release / "collector.env").write_text(
    "COLLECTOR_API_PORT=9013\n"
    "API_DB_POOL_MAX=2\n"
    "API_DB_ACQUIRE_TIMEOUT_MS=1000\n"
    "API_DB_STATEMENT_TIMEOUT_MS=1000\n"
    "API_COLLECTOR_FILTERS_ENABLED=true\n"
    "API_COLLECTOR_RARITY_RANGE_ENABLED=false\n"
    "API_COLLECTOR_NAME_SEARCH_ENABLED=false\n"
)
(release / "collector.env").chmod(0o600)
unit.write_text(
    f"""[Unit]
Description=Yunipals collector rarity-range candidate
After=network.target postgresql.service
[Service]
Type=simple
WorkingDirectory={release}
EnvironmentFile=/root/indexer-next/.env
EnvironmentFile=/etc/yunipals-marketplace/production/indexer-rpc.env
EnvironmentFile={release}/collector.env
ExecStart=/opt/node-v24.18.1/bin/node {release}/server.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/tmp
MemoryMax=512M
CPUQuota=100%
"""
)

try:
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "start", unit.name], check=True)
    for attempt in range(15):
        try:
            with urllib.request.urlopen("http://127.0.0.1:9013/ready", timeout=2) as response:
                assert json.load(response) == {"status": "ready"}
            break
        except Exception:
            if attempt == 14:
                raise
            time.sleep(1)
    with urllib.request.urlopen(
        "http://127.0.0.1:9013/v1/collector-capabilities", timeout=2
    ) as response:
        capabilities = json.load(response)
    assert capabilities == {
        "version": 1,
        "namePrefixSearch": False,
        "rarityRange": False,
    }
except Exception:
    subprocess.run(["systemctl", "stop", unit.name], check=False)
    raise

print(
    json.dumps(
        {
            "status": "candidate-ready",
            "listener": "127.0.0.1:9013",
            "serverSha256": expected_server,
            "productionChanged": False,
        }
    )
)
