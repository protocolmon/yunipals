"""Create Base metadata while preserving the published reveal assignments and assets."""
import hashlib
import json
from pathlib import Path
import shutil
import tarfile

root = Path(__file__).resolve().parents[2]
contract_root = root / "contracts/islands-base-v2"
source = Path("/root/yunipals/docs/islands/arena-artwork-production-v2/https-releases/4d50ebe8ec0d1ae8c0b9b9f94ad3daef21a7235b06d07df2412fb33c139fc1f9/public")
output = root / "docs/audit/base-islands-v2"
public = output / "public"
public.mkdir(parents=True, exist_ok=True)
(public / "metadata").mkdir(exist_ok=True)
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
preflight = json.loads((contract_root / "deployments/replacement-v2/preflight.json").read_text())
plan = json.loads((contract_root / "data/distribution.json").read_text())
original_manifest = json.loads((source / "release-manifest.json").read_text())
assert original_manifest["assignmentSha256"] == plan["revealAssignmentsSha256"]
assert preflight["snapshotSha256"] == plan["snapshotSha256"]
assert preflight["distributionRoot"] == plan["root"]
files = {}
for entry in original_manifest["metadata"]:
    original = source / entry["file"]
    assert sha(original) == entry["sha256"]
    document = json.loads(original.read_text())
    token = entry["tokenId"]
    assert document["properties"]["token_id"] == token
    properties = document["properties"]
    properties["original_island"] = {
        "chain_id": properties["chain_id"], "contract": properties["contract"], "token_id": token
    }
    properties["chain_id"] = 8453
    properties["contract"] = preflight["contract"]
    properties["replacement_snapshot"] = {
        **plan["source"], "sha256": plan["snapshotSha256"], "distribution_root": plan["root"]
    }
    document["external_url"] = f"https://www.yunipals.com/collection/base-islands/{token}"
    target = public / "metadata" / f"{token}.json"
    target.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    files[f"metadata/{token}.json"] = sha(target)
assert len(files) == 898
for name in ("snapshot.json", "distribution.json", "distribution.manifest.json"):
    shutil.copyfile(contract_root / "data" / name, public / name)
    files[name] = sha(public / name)
release = {
    "version": "base-islands-replacement-v2", "chainId": 8453, "contract": preflight["contract"],
    "replacesContract": plan["source"]["contract"], "metadataBaseUri": plan["metadataBaseUri"],
    "snapshot": plan["source"], "snapshotSha256": plan["snapshotSha256"], "distributionRoot": plan["root"],
    "recipientPolicy": "current-base-owner-at-finalized-snapshot", "tokenCount": 898,
    "revealAssignmentsSha256": plan["revealAssignmentsSha256"],
    "revealCommitmentSha256": plan["revealCommitmentSha256"],
    "originalRevealResults": "ipfs://bafybeifrtiw522twmcqujd5w2qbhfuetim45fzjvaenwagf5m4elgjvgd4",
    "files": files
}
(public / "release.json").write_text(json.dumps(release, indent=2) + "\n")
shutil.copyfile(public / "release.json", output / "metadata-release.json")
with tarfile.open(output / "metadata-public.tar.gz", "w:gz") as archive:
    for path in sorted(public.rglob("*")):
        if path.is_file(): archive.add(path, arcname=str(path.relative_to(public)))
print(json.dumps({"contract": preflight["contract"], "metadataFiles": 898, "archiveSha256": sha(output / "metadata-public.tar.gz")}, indent=2))
