"""Publish verified replacement metadata; leave existing Ethereum and placeholder routes intact."""
import hashlib
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tarfile

assert socket.gethostname() == "yunipals-main"
root = Path("/srv/yunipals-islands/base-replacement-v2")
public = root / "public"
assert not public.exists(), "Release already published; inspect before replacing it"
stage = root / "public.staging"
assert not stage.exists()
stage.mkdir(mode=0o755)
with tarfile.open(root / "metadata-public.tar.gz") as archive:
    assert all(m.isfile() and not Path(m.name).is_absolute() and ".." not in Path(m.name).parts for m in archive.getmembers())
    archive.extractall(stage, filter="data")
release = json.loads((stage / "release.json").read_text())
assert release["tokenCount"] == 898
for name, expected in release["files"].items():
    assert hashlib.sha256((stage / name).read_bytes()).hexdigest() == expected
for path in stage.rglob("*"):
    path.chmod(0o755 if path.is_dir() else 0o644)
stage.rename(public)
snippet = Path("/etc/nginx/snippets/yunipals-island-metadata-v2.conf")
before = snippet.read_text()
assert "/v2/base-islands/" not in before
shutil.copyfile(snippet, root / "metadata-nginx-before.conf")
snippet.write_text(before + "\n" + (root / "metadata-location.conf").read_text())
try:
    subprocess.run(["nginx", "-t"], check=True)
    subprocess.run(["systemctl", "reload", "nginx"], check=True)
except Exception:
    snippet.write_text(before)
    raise
print(json.dumps({"contract": release["contract"], "metadataFilesPublished": 898, "metadataBaseUri": release["metadataBaseUri"]}, indent=2))
