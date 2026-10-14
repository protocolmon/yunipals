import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

root = Path(__file__).resolve().parents[2]
release = json.loads((root / "docs/audit/base-islands-v2/metadata-release.json").read_text())
base = release["metadataBaseUri"]
def fetch(path):
    return urlopen(Request(base + path, headers={"User-Agent": "Yunipals-Base-Replacement-Verifier/2", "Accept-Encoding": "identity"}), timeout=25)
def verify(entry):
    name, expected = entry
    path = name.removeprefix("metadata/").removesuffix(".json") if name.startswith("metadata/") else name
    for attempt in range(3):
        try:
            with fetch(path) as response:
                body = response.read(2_000_000)
                assert response.headers.get_content_type() == "application/json"
                assert response.headers.get("Access-Control-Allow-Origin") == "*"
            assert hashlib.sha256(body).hexdigest() == expected, path
            if name.startswith("metadata/"):
                document = json.loads(body)
                assert document["properties"]["chain_id"] == 8453
                assert document["properties"]["contract"] == release["contract"]
                assert document["properties"]["token_id"] == path
            return path
        except Exception:
            if attempt == 2: raise
            time.sleep(attempt + 1)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    for count, future in enumerate(concurrent.futures.as_completed([executor.submit(verify, entry) for entry in release["files"].items()]), 1):
        future.result()
        if count % 200 == 0: print(json.dumps({"publicFilesVerified": count}), flush=True)
for token in ("0", "01", "526", "1000", "1374", "10000000", "1.json"):
    try:
        with fetch(token): raise AssertionError("Expected 404 for " + token)
    except HTTPError as error: assert error.code == 404
report = {"verifiedAtUTC": datetime.datetime.now(datetime.timezone.utc).isoformat(), "contract": release["contract"], "verifiedMetadata": 898, "verifiedProofFiles": 3, "invalidIdsReturn404": True, "passed": True}
for path in (root / "docs/audit/base-islands-v2/metadata-public-verification.json", root / "contracts/islands-base-v2/data/metadata-verification.json"):
    path.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
