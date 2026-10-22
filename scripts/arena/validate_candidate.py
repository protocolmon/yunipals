"""Validate one candidate via stdin without writing strategies to disk or logs."""

import json
import sys
from referee import validate

payload = json.loads(sys.stdin.read(1_000_001))
report = validate(payload["input"], payload["candidate"])
print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
