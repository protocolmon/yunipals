import json
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

assert socket.gethostname() == "yunipals-main" and os.geteuid() == 0

environment = Path(
    "/opt/yunipals-collector/releases/20260923-rarity-range/collector.env"
)
before = environment.read_text()
disabled = "API_COLLECTOR_RARITY_RANGE_ENABLED=false\n"
enabled = "API_COLLECTOR_RARITY_RANGE_ENABLED=true\n"
assert before.count(disabled) == 1 and enabled not in before
environment.write_text(before.replace(disabled, enabled))
environment.chmod(0o600)

try:
    subprocess.run(
        ["systemctl", "restart", "yunipals-collector-api-candidate"], check=True
    )
    for attempt in range(15):
        try:
            with urllib.request.urlopen("http://127.0.0.1:9013/ready", timeout=2) as response:
                assert json.load(response) == {"status": "ready"}
            with urllib.request.urlopen(
                "http://127.0.0.1:9013/v1/collector-capabilities", timeout=2
            ) as response:
                assert json.load(response) == {
                    "version": 1,
                    "namePrefixSearch": False,
                    "rarityRange": True,
                }
            break
        except Exception:
            if attempt == 14:
                raise
            time.sleep(1)
except Exception:
    environment.write_text(before)
    environment.chmod(0o600)
    subprocess.run(
        ["systemctl", "restart", "yunipals-collector-api-candidate"], check=False
    )
    raise

print(json.dumps({"status": "candidate-rarity-range-enabled"}))
